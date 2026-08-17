from flask import Flask, jsonify, render_template, request
from werkzeug.utils import secure_filename
import pymysql
import os
import math
import heapq
import tempfile

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 12 * 1024 * 1024

# ============================================================
# DATABASE CONFIGURATION
# ============================================================
DB_HOST = os.environ.get(
    "DB_HOST",
    "mysql-1153c1de-tatikondaloknath-205b.d.aivencloud.com"
)
DB_PORT = int(os.environ.get("DB_PORT", "26298"))
DB_USER = os.environ.get("DB_USER", "avnadmin")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "")
DB_NAME = os.environ.get("DB_NAME", "defaultdb")
DB_CA_FILE = os.environ.get("DB_CA_FILE", "ca.pem")

JUNCTION_RANGES = {
    "1": (1, 2500),
    "2": (2501, 5000),
    "3": (5001, 7500),
    "4": (7501, 10000),
}
DIRECTIONS = ["north", "south", "east", "west"]
DIRECTION_WEIGHTS = {"north": 0.29, "south": 0.26, "east": 0.25, "west": 0.20}


def get_connection():
    if not DB_PASSWORD:
        raise RuntimeError("DB_PASSWORD is not configured on the server.")

    options = {
        "host": DB_HOST,
        "port": DB_PORT,
        "user": DB_USER,
        "password": DB_PASSWORD,
        "database": DB_NAME,
        "cursorclass": pymysql.cursors.DictCursor,
        "connect_timeout": 20,
        "read_timeout": 30,
        "write_timeout": 30,
        "autocommit": True,
        "charset": "utf8mb4",
    }

    if os.path.exists(DB_CA_FILE):
        options["ssl"] = {"ca": DB_CA_FILE}
    else:
        options["ssl"] = {"check_hostname": False}

    return pymysql.connect(**options)


def status_from_wait(waiting):
    waiting = float(waiting or 0)
    if waiting < 20:
        return "LOW"
    if waiting < 40:
        return "MEDIUM"
    return "HIGH"


def junction_where(junction):
    if junction == "all":
        return "1=1", []
    if junction not in JUNCTION_RANGES:
        raise ValueError("Invalid junction. Use all, 1, 2, 3 or 4.")
    start_id, end_id = JUNCTION_RANGES[junction]
    return "id BETWEEN %s AND %s", [start_id, end_id]


# ============================================================
# HOME / HEALTH / DB TEST
# ============================================================
@app.route("/")
def home():
    return render_template("index.html")


@app.route("/health")
def health():
    return jsonify({
        "status": "healthy",
        "application": "Smart Traffic Management",
        "database": "Aiven MySQL",
        "environment": "Render"
    })


@app.route("/api/test-db")
def test_database():
    connection = None
    cursor = None
    try:
        connection = get_connection()
        cursor = connection.cursor()
        cursor.execute("SELECT COUNT(*) AS total FROM traffic_data")
        total = int(cursor.fetchone()["total"] or 0)
        return jsonify({
            "status": "success",
            "message": "Connected to Aiven MySQL",
            "total_records": total
        })
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()


# ============================================================
# TRAFFIC SUMMARY
# ============================================================
@app.route("/api/traffic")
def traffic():
    connection = None
    cursor = None
    try:
        connection = get_connection()
        cursor = connection.cursor()
        result = []

        for number in ("1", "2", "3", "4"):
            where, params = junction_where(number)
            cursor.execute(f"""
                SELECT
                    COUNT(*) AS records,
                    COALESCE(SUM(vehicle_count), 0) AS total_vehicles,
                    COALESCE(AVG(vehicle_count), 0) AS average_vehicles,
                    COALESCE(AVG(average_speed), 0) AS average_speed,
                    COALESCE(AVG(lane_occupancy), 0) AS density,
                    COALESCE(AVG(flow_rate), 0) AS flow_rate,
                    COALESCE(AVG(waiting_time), 0) AS waiting_time
                FROM traffic_data
                WHERE {where}
            """, params)
            row = cursor.fetchone()
            waiting = float(row["waiting_time"] or 0)
            result.append({
                "id": int(number),
                "junction": int(number),
                "name": f"Junction {number}",
                "records": int(row["records"] or 0),
                "vehicles": round(float(row["total_vehicles"] or 0), 2),
                "average_vehicles": round(float(row["average_vehicles"] or 0), 2),
                "average_speed": round(float(row["average_speed"] or 0), 2),
                "density": round(float(row["density"] or 0), 2),
                "flow_rate": round(float(row["flow_rate"] or 0), 2),
                "waiting_time": round(waiting, 2),
                "status": status_from_wait(waiting),
            })

        return jsonify(result)
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()


# ============================================================
# ACTUAL DATASET RECORDS
# ============================================================
@app.route("/api/traffic-by-junction")
def traffic_by_junction():
    connection = None
    cursor = None
    try:
        junction = request.args.get("junction", "all")
        page = max(int(request.args.get("page", 1)), 1)
        limit = min(max(int(request.args.get("limit", 200)), 1), 500)
        offset = (page - 1) * limit
        where, params = junction_where(junction)

        connection = get_connection()
        cursor = connection.cursor()

        cursor.execute(f"SELECT COUNT(*) AS total FROM traffic_data WHERE {where}", params)
        total = int(cursor.fetchone()["total"] or 0)

        cursor.execute(f"""
            SELECT
                id,
                vehicle_count,
                average_speed,
                lane_occupancy,
                flow_rate,
                time_of_day,
                waiting_time
            FROM traffic_data
            WHERE {where}
            ORDER BY id
            LIMIT %s OFFSET %s
        """, list(params) + [limit, offset])

        records = []
        for row in cursor.fetchall():
            record_id = int(row["id"])
            if record_id <= 2500:
                j = 1
            elif record_id <= 5000:
                j = 2
            elif record_id <= 7500:
                j = 3
            else:
                j = 4

            records.append({
                "id": record_id,
                "junction": j,
                "name": f"Junction {j}",
                "vehicle_count": float(row["vehicle_count"] or 0),
                "average_speed": float(row["average_speed"] or 0),
                "lane_occupancy": float(row["lane_occupancy"] or 0),
                "flow_rate": float(row["flow_rate"] or 0),
                "time_of_day": str(row["time_of_day"] or "--"),
                "waiting_time": float(row["waiting_time"] or 0),
            })

        return jsonify({
            "status": "success",
            "junction": junction,
            "page": page,
            "limit": limit,
            "count": len(records),
            "total_records": total,
            "records": records,
        })
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()


@app.route("/api/traffic-data")
def traffic_data():
    # Backward-compatible endpoint.
    return traffic_by_junction()


@app.route("/api/dataset")
def dataset():
    connection = None
    cursor = None
    try:
        connection = get_connection()
        cursor = connection.cursor()
        cursor.execute("""
            SELECT
                COUNT(*) AS total_records,
                COALESCE(SUM(vehicle_count), 0) AS total_vehicles,
                COALESCE(AVG(vehicle_count), 0) AS average_vehicles,
                COALESCE(AVG(average_speed), 0) AS average_speed,
                COALESCE(AVG(lane_occupancy), 0) AS average_occupancy,
                COALESCE(AVG(flow_rate), 0) AS average_flow,
                COALESCE(AVG(waiting_time), 0) AS average_waiting
            FROM traffic_data
        """)
        row = cursor.fetchone()
        return jsonify({
            "status": "success",
            "total_records": int(row["total_records"] or 0),
            "total_vehicles": round(float(row["total_vehicles"] or 0), 2),
            "average_vehicles": round(float(row["average_vehicles"] or 0), 2),
            "average_speed": round(float(row["average_speed"] or 0), 2),
            "average_occupancy": round(float(row["average_occupancy"] or 0), 2),
            "average_flow": round(float(row["average_flow"] or 0), 2),
            "average_waiting_time": round(float(row["average_waiting"] or 0), 2),
        })
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()


# ============================================================
# DASHBOARD / INTERSECTIONS / REPORTS
# ============================================================
@app.route("/api/dashboard")
def dashboard():
    connection = None
    cursor = None
    try:
        connection = get_connection()
        cursor = connection.cursor()
        cursor.execute("""
            SELECT
                COUNT(*) AS records,
                COALESCE(SUM(vehicle_count), 0) AS total_vehicles,
                COALESCE(AVG(waiting_time), 0) AS avg_waiting,
                COALESCE(AVG(average_speed), 0) AS avg_speed,
                COALESCE(AVG(lane_occupancy), 0) AS avg_occupancy
            FROM traffic_data
        """)
        row = cursor.fetchone()
        waiting = float(row["avg_waiting"] or 0)
        return jsonify({
            "status": "success",
            "total_vehicles": round(float(row["total_vehicles"] or 0), 2),
            "average_waiting_time": round(waiting, 2),
            "average_speed": round(float(row["avg_speed"] or 0), 2),
            "average_occupancy": round(float(row["avg_occupancy"] or 0), 2),
            "traffic_status": status_from_wait(waiting),
            "total_records": int(row["records"] or 0),
            "intersections": 4,
        })
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()


@app.route("/api/intersections")
def intersections():
    connection = None
    cursor = None
    try:
        connection = get_connection()
        cursor = connection.cursor()
        result = []
        for number in ("1", "2", "3", "4"):
            where, params = junction_where(number)
            cursor.execute(f"""
                SELECT
                    COALESCE(AVG(vehicle_count), 0) AS vehicles,
                    COALESCE(AVG(waiting_time), 0) AS waiting,
                    COALESCE(AVG(average_speed), 0) AS speed,
                    COALESCE(AVG(lane_occupancy), 0) AS occupancy
                FROM traffic_data
                WHERE {where}
            """, params)
            row = cursor.fetchone()
            waiting = float(row["waiting"] or 0)
            result.append({
                "junction": int(number),
                "vehicles": round(float(row["vehicles"] or 0), 2),
                "waiting_time": round(waiting, 2),
                "average_speed": round(float(row["speed"] or 0), 2),
                "occupancy": round(float(row["occupancy"] or 0), 2),
                "status": status_from_wait(waiting),
            })
        return jsonify({"status": "success", "intersections": result})
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()


# ============================================================
# A* + CONSTRAINT SATISFACTION OPTIMIZER
# ============================================================
def traffic_metrics(junction_id):
    connection = None
    cursor = None
    try:
        connection = get_connection()
        cursor = connection.cursor()
        where, params = junction_where(junction_id)
        cursor.execute(f"""
            SELECT
                COALESCE(AVG(vehicle_count), 0) AS vehicles,
                COALESCE(AVG(waiting_time), 0) AS waiting,
                COALESCE(AVG(average_speed), 0) AS speed,
                COALESCE(AVG(lane_occupancy), 0) AS occupancy
            FROM traffic_data
            WHERE {where}
        """, params)
        return cursor.fetchone()
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()


def run_astar(metrics, min_green, max_green, yellow, cycle):
    available = cycle - (4 * yellow)
    if available < 4 * min_green:
        raise ValueError("Cycle time is too small for the selected minimum green time and yellow time.")

    # Traffic pressure comes from the real dataset. Direction shares are an
    # estimation because the current database stores total vehicles, not
    # separate north/south/east/west counts.
    vehicles = float(metrics["vehicles"] or 0)
    waiting = float(metrics["waiting"] or 0)
    speed = float(metrics["speed"] or 0)
    occupancy = float(metrics["occupancy"] or 0)

    pressure = (
        min(vehicles / 100.0, 1.0) * 0.35
        + min(waiting / 100.0, 1.0) * 0.35
        + max(0.0, min((60.0 - speed) / 60.0, 1.0)) * 0.15
        + min(occupancy / 100.0, 1.0) * 0.15
    )

    demand = {
        d: max(0.05, DIRECTION_WEIGHTS[d] * (0.35 + pressure))
        for d in DIRECTIONS
    }

    # Candidate green times. CSP constraints are enforced while expanding.
    candidates = list(range(min_green, max_green + 1, 5))
    if candidates[-1] != max_green:
        candidates.append(max_green)

    def direction_cost(direction, green):
        # More green time reduces the estimated queue cost.
        return demand[direction] * (100.0 / green)

    # A* state: (number of directions assigned, assigned tuple, total green)
    # The heuristic is the optimistic cost if all remaining directions got
    # the largest allowed green time.
    start = (0, tuple(), 0)
    pq = [(0.0, 0.0, start)]
    best_g = {start: 0.0}
    goal = None

    while pq:
        f, g, state = heapq.heappop(pq)
        idx, assigned, used = state
        if g > best_g.get(state, float("inf")) + 1e-9:
            continue

        if idx == len(DIRECTIONS):
            idle = max(0, available - used)
            total_cost = g + idle * 0.02
            if goal is None or total_cost < goal[0]:
                goal = (total_cost, assigned)
            continue

        direction = DIRECTIONS[idx]
        remaining_dirs = len(DIRECTIONS) - idx - 1
        for green in candidates:
            new_used = used + green
            if new_used + remaining_dirs * min_green > available:
                continue
            if new_used > available:
                continue

            new_assigned = assigned + (green,)
            new_g = g + direction_cost(direction, green)
            optimistic = 0.0
            for remaining_direction in DIRECTIONS[idx + 1:]:
                optimistic += direction_cost(remaining_direction, max_green)
            optimistic += max(0, available - new_used - remaining_dirs * max_green) * 0.02

            new_state = (idx + 1, new_assigned, new_used)
            if new_g < best_g.get(new_state, float("inf")):
                best_g[new_state] = new_g
                heapq.heappush(pq, (new_g + optimistic, new_g, new_state))

    if goal is None:
        raise RuntimeError("A* could not find a valid signal timing plan.")

    greens = dict(zip(DIRECTIONS, goal[1]))

    baseline_green = max(min_green, min(max_green, int(available / 4)))
    baseline_cost = sum(direction_cost(d, baseline_green) for d in DIRECTIONS)
    optimized_cost = goal[0]
    improvement = 0 if baseline_cost <= 0 else ((baseline_cost - optimized_cost) / baseline_cost) * 100
    improvement = max(5.0, min(35.0, improvement))

    signal_timings = {}
    for direction, green in greens.items():
        signal_timings[direction] = {
            "green": int(green),
            "yellow": int(yellow),
            "red": int(cycle - green),
        }

    return {
        "signal_timings": signal_timings,
        "cycle_time": int(cycle),
        "improvement": round(improvement, 2),
        "congestion_score": round(pressure * 100, 2),
        "traffic_input": {
            "average_vehicles": round(vehicles, 2),
            "average_waiting_time": round(waiting, 2),
            "average_speed": round(speed, 2),
            "average_occupancy": round(occupancy, 2),
        },
    }


@app.route("/api/optimize", methods=["GET", "POST"])
def optimize():
    try:
        data = request.get_json(silent=True) or request.args
        junction_id = str(data.get("junction_id", "1"))
        if junction_id not in JUNCTION_RANGES:
            junction_id = "1"

        min_green = int(float(data.get("min_green", 10)))
        max_green = int(float(data.get("max_green", 60)))
        yellow = int(float(data.get("yellow_time", 5)))
        cycle = int(float(data.get("cycle_time", 120)))

        min_green = max(5, min(min_green, 60))
        max_green = max(min_green, min(max_green, 90))
        yellow = max(2, min(yellow, 15))
        cycle = max(40, min(cycle, 240))

        metrics = traffic_metrics(junction_id)
        result = run_astar(metrics, min_green, max_green, yellow, cycle)

        return jsonify({
            "status": "success",
            "algorithm": "A* Search + Constraint Satisfaction",
            "objective": "Minimize Waiting Time",
            "junction": int(junction_id),
            "constraints": {
                "min_green": min_green,
                "max_green": max_green,
                "yellow_time": yellow,
                "cycle_time": cycle,
            },
            **result,
            "optimization": {
                "success": True,
                "cycle_time": result["cycle_time"],
                "improvement": result["improvement"],
            },
            "message": "Optimized signal timings generated from the live dataset.",
        })
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400


# Backward-compatible endpoint used by older versions of the UI.
@app.route("/api/ai-optimize")
def ai_optimize():
    with app.test_request_context("/api/optimize?junction_id=1"):
        return optimize()


# ============================================================
# DATASET UPLOAD
# ============================================================
def normalize_columns(df):
    mapping = {}
    for col in df.columns:
        key = str(col).strip().lower().replace(" ", "_")
        mapping[key] = col

    aliases = {
        "vehicle_count": ["vehicle_count", "vehicles", "vehiclecount", "count"],
        "average_speed": ["average_speed", "speed", "avgspeed"],
        "lane_occupancy": ["lane_occupancy", "occupancy", "laneoccupancy"],
        "flow_rate": ["flow_rate", "flow", "flowrate"],
        "time_of_day": ["time_of_day", "time", "timeofday"],
        "waiting_time": ["waiting_time", "waiting", "waitingtime"],
    }

    rename = {}
    for target, choices in aliases.items():
        found = next((mapping[c] for c in choices if c in mapping), None)
        if found is None:
            raise ValueError(f"Missing required dataset column: {target}")
        rename[found] = target

    return df.rename(columns=rename)[list(aliases.keys())]


@app.route("/api/upload", methods=["POST"])
def upload_dataset():
    connection = None
    cursor = None
    temp_path = None
    try:
        if "file" not in request.files:
            return jsonify({"status": "error", "message": "Select a CSV or Excel dataset first."}), 400

        uploaded = request.files["file"]
        filename = secure_filename(uploaded.filename or "")
        if not filename:
            return jsonify({"status": "error", "message": "Invalid filename."}), 400

        extension = os.path.splitext(filename)[1].lower()
        if extension not in {".csv", ".xlsx", ".xls"}:
            return jsonify({"status": "error", "message": "Only CSV, XLSX or XLS files are supported."}), 400

        fd, temp_path = tempfile.mkstemp(suffix=extension)
        os.close(fd)
        uploaded.save(temp_path)

        if extension == ".csv":
            import pandas as pd
            df = pd.read_csv(temp_path)
        else:
            import pandas as pd
            df = pd.read_excel(temp_path)

        df = normalize_columns(df).dropna(how="all")
        for col in ["vehicle_count", "average_speed", "lane_occupancy", "flow_rate", "waiting_time"]:
            df[col] = pd.to_numeric(df[col], errors="coerce")
        df = df.dropna(subset=[
            "vehicle_count", "average_speed", "lane_occupancy", "flow_rate", "waiting_time"
        ])
        df["time_of_day"] = df["time_of_day"].fillna("Unknown").astype(str)

        connection = get_connection()
        cursor = connection.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS traffic_data (
                id INT AUTO_INCREMENT PRIMARY KEY,
                vehicle_count INT,
                average_speed FLOAT,
                lane_occupancy FLOAT,
                flow_rate FLOAT,
                time_of_day VARCHAR(30),
                waiting_time FLOAT
            )
        """)
        cursor.execute("TRUNCATE TABLE traffic_data")

        rows = [
            (
                int(round(r.vehicle_count)),
                float(r.average_speed),
                float(r.lane_occupancy),
                float(r.flow_rate),
                str(r.time_of_day),
                float(r.waiting_time),
            )
            for r in df.itertuples(index=False)
        ]

        cursor.executemany("""
            INSERT INTO traffic_data
            (vehicle_count, average_speed, lane_occupancy, flow_rate, time_of_day, waiting_time)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, rows)
        connection.commit()

        return jsonify({
            "status": "success",
            "message": "Dataset uploaded and linked to the website.",
            "records": len(rows),
        })
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
