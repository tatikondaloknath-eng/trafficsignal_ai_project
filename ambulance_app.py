
from flask import Flask, jsonify, request, render_template
from traffic_core import fetch_network_frame, congestion, astar_route, activate_emergency, latest_emergency, emergency_payload, advance_emergency, clear_emergency, get_db_connection

app = Flask(__name__, template_folder='templates_ambulance', static_folder='static_ambulance')

@app.route('/')
def index():
    return render_template('ambulance_index.html')

@app.route('/api/plan', methods=['POST'])
def plan():
    try:
        data=request.get_json(silent=True) or {}
        start=int(data.get('current_junction')); goal=int(data.get('destination')); frame=int(data.get('frame',0))
        if start==goal: return jsonify({'status':'error','message':'Current junction and destination must be different.'}),400
        _,_,rows=fetch_network_frame(frame); cong={j:congestion(rows[j]) for j in range(1,5)}
        route,cost,segments=astar_route(start,goal,cong,rows)
        return jsonify({'status':'success','algorithm':'A* Emergency Route Planning','route':route,'estimated_time_seconds':cost,'segments':segments,'congestion':cong,'frame_index':frame})
    except Exception as e: return jsonify({'status':'error','message':str(e)}),400

@app.route('/api/activate', methods=['POST'])
def activate():
    try:
        data=request.get_json(silent=True) or {}
        ambulance_id=str(data.get('ambulance_id','AMB-001')).strip()[:64]
        start=int(data.get('current_junction')); goal=int(data.get('destination')); level=str(data.get('emergency_level','CRITICAL')).upper(); frame=int(data.get('frame',0))
        if start==goal: return jsonify({'status':'error','message':'Current junction and destination must be different.'}),400
        if start not in (1,2,3,4) or goal not in (1,2,3,4): return jsonify({'status':'error','message':'Junction must be between 1 and 4.'}),400
        if not ambulance_id: return jsonify({'status':'error','message':'Ambulance ID is required.'}),400
        result=activate_emergency(ambulance_id,start,goal,level,frame)
        _,_,rows=fetch_network_frame(frame)
        result['emergency']=emergency_payload(rows)
        return jsonify({'status':'success',**result})
    except Exception as e: return jsonify({'status':'error','message':str(e)}),400

@app.route('/api/status')
def status():
    try:
        frame=int(request.args.get('frame',0)); _,_,rows=fetch_network_frame(frame)
        return jsonify({'status':'success','emergency':emergency_payload(rows)})
    except Exception as e:return jsonify({'status':'error','message':str(e)}),500

@app.route('/api/advance', methods=['POST'])
def advance():
    try:
        frame=int((request.get_json(silent=True) or {}).get('frame',0)); r=advance_emergency(frame)
        if not r['ok']: return jsonify({'status':'error','message':r['message']}),400
        _,_,rows=fetch_network_frame(frame)
        return jsonify({'status':'success','message':r['message'],'emergency':emergency_payload(rows)})
    except Exception as e:return jsonify({'status':'error','message':str(e)}),400

@app.route('/api/clear', methods=['POST'])
def clear():
    try: clear_emergency(); return jsonify({'status':'success','message':'Emergency cleared.'})
    except Exception as e:return jsonify({'status':'error','message':str(e)}),500

@app.route('/api/traffic')
def traffic():
    try:
        frame=int(request.args.get('frame',0)); fi,fc,rows=fetch_network_frame(frame)
        return jsonify({'status':'success','frame_index':fi,'frame_count':fc,'junctions':{j:{**rows[j],'congestion':congestion(rows[j])} for j in rows}})
    except Exception as e:return jsonify({'status':'error','message':str(e)}),500

@app.route('/health')
def health():
    try:
        conn=get_db_connection(); conn.close(); return jsonify({'status':'ok','database':'reachable'})
    except Exception as e:return jsonify({'status':'error','database':'unreachable','message':str(e)}),500

@app.route('/healthz')
def healthz():
    return jsonify({'status':'ok','service':'ambulance-dispatch'})

if __name__=='__main__':
    import os
    app.run(host='0.0.0.0',port=int(os.environ.get('PORT',5050)),debug=False)
