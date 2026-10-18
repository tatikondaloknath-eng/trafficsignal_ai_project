import hashlib
import os
import secrets
import time
from datetime import datetime, timezone

from flask import Flask, jsonify, request, render_template
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

from traffic_core import (
    fetch_network_frame, congestion, astar_route, activate_emergency,
    latest_emergency, emergency_payload, advance_emergency, clear_emergency,
    get_db_connection,
)

app = Flask(__name__, template_folder='templates_ambulance', static_folder='static_ambulance')
app.config['MAX_CONTENT_LENGTH'] = 6 * 1024 * 1024  # photo <= 5 MB, with multipart overhead
app.config['SECRET_KEY'] = os.environ.get('SESSION_SECRET') or 'development-only-change-this-session-secret'
challenge_serializer = URLSafeTimedSerializer(app.config['SECRET_KEY'], salt='ambulance-live-photo-v1')
CHALLENGE_MAX_AGE_SECONDS = 180
MAX_PHOTO_BYTES = 5 * 1024 * 1024


def error(message, status=400):
    return jsonify({'status': 'error', 'message': message}), status


@app.errorhandler(413)
def too_large(_exc):
    return error('Photo request is too large. Retake a smaller photo (maximum 5 MB).', 413)


def parse_iso_timestamp(value):
    if not value:
        raise ValueError('Photo capture timestamp is missing. Retake the photo.')
    try:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except Exception as exc:
        raise ValueError('Photo capture timestamp is invalid. Retake the photo.') from exc
    if dt.tzinfo is None:
        raise ValueError('Photo timestamp must include a timezone. Retake the photo.')
    dt = dt.astimezone(timezone.utc)
    delta = (datetime.now(timezone.utc) - dt).total_seconds()
    if delta < -15 or delta > CHALLENGE_MAX_AGE_SECONDS:
        raise ValueError('The photo is not fresh or the challenge expired. Request a new photo challenge.')
    return dt


def detect_image_mime(blob):
    if blob.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if blob.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if len(blob) >= 12 and blob[:4] == b'RIFF' and blob[8:12] == b'WEBP':
        return 'image/webp'
    return None


@app.route('/')
def index():
    return render_template('ambulance_index.html')


@app.route('/api/plan', methods=['POST'])
def plan():
    try:
        data = request.get_json(silent=True) or {}
        start = int(data.get('current_junction'))
        goal = int(data.get('destination'))
        frame = int(data.get('frame', 0))
        if start == goal:
            return error('Current junction and destination must be different.')
        if start not in (1, 2, 3, 4) or goal not in (1, 2, 3, 4):
            return error('Junction must be between 1 and 4.')
        _, _, rows = fetch_network_frame(frame)
        cong = {j: congestion(rows[j]) for j in range(1, 5)}
        route, cost, segments = astar_route(start, goal, cong, rows)
        return jsonify({'status':'success','algorithm':'A* Emergency Route Planning','route':route,'estimated_time_seconds':cost,'segments':segments,'congestion':cong,'frame_index':frame})
    except Exception as exc:
        return error(str(exc), 400)


@app.route('/api/verification/challenge', methods=['POST'])
def verification_challenge():
    """Create a short-lived signed challenge to watermark a new camera capture."""
    data = request.get_json(silent=True) or {}
    ambulance_id = str(data.get('ambulance_id', '')).strip()[:64]
    if not ambulance_id:
        return error('Enter the ambulance ID before requesting photo verification.')
    code_alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    code = ''.join(secrets.choice(code_alphabet) for _ in range(6))
    payload = {
        'challenge_id': secrets.token_hex(16),
        'ambulance_id': ambulance_id,
        'code': code,
        'issued_at': int(time.time()),
    }
    token = challenge_serializer.dumps(payload)
    return jsonify({
        'status': 'success',
        'challenge_token': token,
        'challenge_id': payload['challenge_id'],
        'code': code,
        'expires_in_seconds': CHALLENGE_MAX_AGE_SECONDS,
        'message': 'Capture a fresh photo with the camera. This one-time code will be watermarked on the captured image.'
    })


@app.route('/api/activate', methods=['POST'])
def activate():
    """A corridor cannot activate until fresh camera evidence passes server-side checks."""
    try:
        ambulance_id = str(request.form.get('ambulance_id', '')).strip()[:64]
        if not ambulance_id:
            return error('Ambulance ID is required.')

        token = str(request.form.get('challenge_token', ''))
        try:
            challenge = challenge_serializer.loads(token, max_age=CHALLENGE_MAX_AGE_SECONDS)
        except SignatureExpired:
            return error('Photo challenge expired. Click Activate Corridor and capture a new photo.')
        except (BadSignature, Exception):
            return error('Photo verification challenge is invalid. Start the photo verification again.')

        if challenge.get('ambulance_id') != ambulance_id:
            return error('The photo challenge belongs to a different ambulance ID.')
        if str(request.form.get('challenge_code', '')).strip().upper() != str(challenge.get('code', '')).upper():
            return error('The photo verification code does not match. Retake the photo.')

        photo = request.files.get('photo')
        if photo is None or not photo.filename:
            return error('A live camera photo is required before the emergency corridor can activate.')
        photo_blob = photo.read(MAX_PHOTO_BYTES + 1)
        if not photo_blob:
            return error('The captured photo is empty. Please take another photo.')
        if len(photo_blob) > MAX_PHOTO_BYTES:
            return error('Photo is larger than 5 MB. Retake using the in-app camera.')
        photo_mime = detect_image_mime(photo_blob)
        if photo_mime is None:
            return error('Photo must be a valid JPEG, PNG, or WebP image.')

        captured_at = parse_iso_timestamp(request.form.get('captured_at', ''))
        if int(captured_at.timestamp()) < int(challenge.get('issued_at', 0)) - 3:
            return error('The image timestamp is earlier than the verification challenge. Retake the photo.')
        if request.form.get('privacy_ack') != 'yes':
            return error('Confirm that you are authorized to capture this evidence and will avoid unnecessary patient-identifying details.')

        start = int(request.form.get('current_junction', '0'))
        goal = int(request.form.get('destination', '0'))
        level = str(request.form.get('emergency_level', 'CRITICAL')).upper()
        frame = int(request.form.get('frame', '0'))
        if start not in (1, 2, 3, 4) or goal not in (1, 2, 3, 4):
            return error('Junction must be between 1 and 4.')
        if start == goal:
            return error('Current junction and destination must be different.')
        if level not in ('CRITICAL', 'HIGH', 'URGENT'):
            return error('Invalid emergency level.')

        # Location is supporting metadata only and is not required for a software-only demo.
        lat = request.form.get('latitude', '').strip()
        lon = request.form.get('longitude', '').strip()
        acc = request.form.get('location_accuracy', '').strip()
        try:
            lat = float(lat) if lat else None
            lon = float(lon) if lon else None
            acc = float(acc) if acc else None
            if lat is not None and not -90 <= lat <= 90: raise ValueError()
            if lon is not None and not -180 <= lon <= 180: raise ValueError()
            if acc is not None and acc < 0: raise ValueError()
        except ValueError:
            return error('Phone location metadata is invalid. Retry the request.')

        verification = {
            'challenge_id': str(challenge['challenge_id']),
            'challenge_code': str(challenge['code']),
            'captured_at': captured_at.strftime('%Y-%m-%d %H:%M:%S'),
            'photo_sha256': hashlib.sha256(photo_blob).hexdigest(),
            'photo_mime': photo_mime,
            'photo_blob': photo_blob,
            'latitude': lat,
            'longitude': lon,
            'location_accuracy': acc,
            'privacy_ack': 1,
        }
        result = activate_emergency(ambulance_id, start, goal, level, frame, verification=verification)
        _, _, rows = fetch_network_frame(frame)
        result['emergency'] = emergency_payload(rows)
        result['photo_verification'] = {
            'status': 'PHOTO_RECEIVED',
            'sha256': verification['photo_sha256'],
            'captured_at': verification['captured_at'],
            'location_provided': lat is not None and lon is not None,
            'note': 'A fresh image was received and recorded. Photo submission alone does not medically verify emergency severity.'
        }
        return jsonify({'status':'success', **result})
    except Exception as exc:
        app.logger.exception('Emergency activation failed')
        return error(str(exc), 400)


@app.route('/api/status')
def status():
    try:
        frame = int(request.args.get('frame', 0))
        _, _, rows = fetch_network_frame(frame)
        return jsonify({'status':'success','emergency':emergency_payload(rows)})
    except Exception as exc:
        return error(str(exc), 500)


@app.route('/api/advance', methods=['POST'])
def advance():
    try:
        frame = int((request.get_json(silent=True) or {}).get('frame', 0))
        result = advance_emergency(frame)
        if not result['ok']:
            return error(result['message'])
        _, _, rows = fetch_network_frame(frame)
        return jsonify({'status':'success','message':result['message'],'emergency':emergency_payload(rows)})
    except Exception as exc:
        return error(str(exc), 400)


@app.route('/api/clear', methods=['POST'])
def clear():
    try:
        clear_emergency()
        return jsonify({'status':'success','message':'Emergency cleared.'})
    except Exception as exc:
        return error(str(exc), 500)


@app.route('/api/traffic')
def traffic():
    try:
        frame = int(request.args.get('frame', 0))
        fi, fc, rows = fetch_network_frame(frame)
        return jsonify({'status':'success','frame_index':fi,'frame_count':fc,'junctions':{j:{**rows[j],'congestion':congestion(rows[j])} for j in rows}})
    except Exception as exc:
        return error(str(exc), 500)


@app.route('/health')
def health():
    try:
        conn = get_db_connection(); conn.close()
        return jsonify({'status':'ok','database':'reachable'})
    except Exception as exc:
        return error('Database is unreachable: ' + str(exc), 500)


@app.route('/healthz')
def healthz():
    return jsonify({'status':'ok','service':'ambulance-dispatch'})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5050)), debug=False)
