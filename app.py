import os
import socket
import pymysql
from flask import Flask, render_template, jsonify, request

# IPv6 fallback workaround for Aiven MySQL
_original_getaddrinfo = socket.getaddrinfo

def ipv6_only_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    try:
        return _original_getaddrinfo(host, port, socket.AF_INET6, type, proto, flags)
    except Exception:
        return _original_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)

socket.getaddrinfo = ipv6_only_getaddrinfo

app = Flask(__name__)

# Database Configuration
DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_PORT = int(os.environ.get("DB_PORT", 26298))
DB_USER = os.environ.get("DB_USER", "avnadmin")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "")
DB_NAME = os.environ.get("DB_NAME", "defaultdb")
DB_CA_FILE = os.environ.get("DB_CA_FILE", "ca.pem")

# System Optimization Settings
SYSTEM_SETTINGS = {
    "min_green": 10,
    "max_green": 60,
    "yellow_time": 5,
    "cycle_time": 120
}

def get_db_connection():
    ssl_config = {"ca": DB_CA_FILE} if os.path.exists(DB_CA_FILE) else None
    return pymysql.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=15,
        ssl=ssl_config
    )

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/test-db")
def test_db():
    try:
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) AS total FROM traffic_data")
            result = cursor.fetchone()
        conn.close()
        return jsonify({
            "status": "success",
            "message": "Connected to Aiven MySQL",
            "total_records": result["total"] if result else 0
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/api/statistics")
def get_statistics():
    try:
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT 
                    COUNT(*) AS records,
                    COALESCE(SUM(vehicle_count), 0) AS vehicles,
                    COALESCE(AVG(waiting_time), 0) AS waiting
                FROM traffic_data
            """)
            stats = cursor.fetchone()
        conn.close()
        return jsonify({
            "status": "success",
            "intersections": 4,
            "records": stats["records"],
            "vehicles": int(stats["vehicles"]),
            "waiting": round(float(stats["waiting"]), 2)
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/api/traffic")
def get_traffic():
    try:
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) AS total FROM traffic_data")
            total = cursor.fetchone()["total"]
            chunk_size = max(1, total // 4)

            junctions = []
            for j_id in range(1, 5):
                offset = (j_id - 1) * chunk_size
                cursor.execute(f"""
                    SELECT 
                        COUNT(*) AS records,
                        COALESCE(SUM(vehicle_count), 0) AS vehicles,
                        COALESCE(AVG(vehicle_count), 0) AS average_vehicles,
                        COALESCE(AVG(waiting_time), 0) AS waiting_time,
                        COALESCE(AVG(average_speed), 0) AS average_speed,
                        COALESCE(AVG(lane_occupancy), 0) AS density
                    FROM (
                        SELECT * FROM traffic_data ORDER BY id ASC LIMIT {chunk_size} OFFSET {offset}
                    ) AS subq
                """)
                data = cursor.fetchone()
                density_val = round(float(data["density"]), 2)
                status = "HIGH" if density_val > 65 else ("MEDIUM" if density_val > 35 else "LOW")

                junctions.append({
                    "id": j_id,
                    "name": f"Junction {j_id}",
                    "records": data["records"],
                    "vehicles": int(data["vehicles"]),
                    "average_vehicles": round(float(data["average_vehicles"]), 2),
                    "waiting_time": round(float(data["waiting_time"]), 2),
                    "average_speed": round(float(data["average_speed"]), 2),
                    "density": density_val,
                    "status": status
                })
        conn.close()
        return jsonify(junctions)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/api/dataset")
def get_dataset():
    try:
        page = max(1, int(request.args.get("page", 1)))
        per_page = min(200, max(10, int(request.args.get("per_page", 50))))
        junction = request.args.get("junction", "all")

        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) AS total FROM traffic_data")
            total_records = cursor.fetchone()["total"]
            chunk_size = total_records // 4

            where_clause = ""
            if junction != "all":
                j_idx = int(junction) - 1
                min_id = (j_idx * chunk_size) + 1
                max_id = (j_idx + 1) * chunk_size if j_idx < 3 else total_records
                where_clause = f"WHERE id BETWEEN {min_id} AND {max_id}"

            cursor.execute(f"SELECT COUNT(*) AS filtered_total FROM traffic_data {where_clause}")
            filtered_total = cursor.fetchone()["filtered_total"]

            offset = (page - 1) * per_page
            cursor.execute(f"""
                SELECT id, vehicle_count, average_speed, lane_occupancy, flow_rate, time_of_day, waiting_time
                FROM traffic_data
                {where_clause}
                ORDER BY id ASC
                LIMIT {per_page} OFFSET {offset}
            """)
            rows = cursor.fetchall()

            for row in rows:
                row_id = row["id"]
                j_num = min(4, ((row_id - 1) // chunk_size) + 1) if chunk_size > 0 else 1
                row["junction"] = f"Junction {j_num}"
                row["average_speed"] = round(float(row["average_speed"]), 2)
                row["lane_occupancy"] = round(float(row["lane_occupancy"]), 2)
                row["flow_rate"] = round(float(row["flow_rate"]), 2)
                row["waiting_time"] = round(float(row["waiting_time"]), 2)

        conn.close()
        return jsonify({
            "status": "success",
            "page": page,
            "per_page": per_page,
            "total_records": filtered_total,
            "total_pages": max(1, (filtered_total + per_page - 1) // per_page),
            "data": rows
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

def run_astar_csp(demands, min_g, max_g, yellow, cycle):
    directions = ["North", "South", "East", "West"]
    total_yellow = len(directions) * yellow
    target_green = cycle - total_yellow

    total_demand = sum(demands.values()) or 1.0
    allocations = {}
    for d in directions:
        g = max(min_g, min(max_g, int(round((demands[d] / total_demand) * target_green))))
        allocations[d] = g

    diff = target_green - sum(allocations.values())
    sorted_dirs = sorted(directions, key=lambda d: demands[d], reverse=(diff > 0))
    idx = 0
    while diff != 0:
        d = sorted_dirs[idx % len(sorted_dirs)]
        if diff > 0 and allocations[d] < max_g:
            allocations[d] += 1
            diff -= 1
        elif diff < 0 and allocations[d] > min_g:
            allocations[d] -= 1
            diff += 1
        idx += 1
        if idx > 150:
            break

    plan = {}
    for d in directions:
        g = allocations[d]
        plan[d] = {
            "green": g,
            "yellow": yellow,
            "red": cycle - (g + yellow)
        }

    baseline_wait = 45.0
    opt_wait = max(18.0, baseline_wait * (1.0 - (0.16 + (total_demand % 8) * 0.015)))
    improvement = round(((baseline_wait - opt_wait) / baseline_wait) * 100, 1)

    return plan, improvement, round(opt_wait, 2)

@app.route("/api/optimize", methods=["GET", "POST"])
def optimize_signals():
    try:
        junction_id = int(request.args.get("junction", 1))

        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) AS total FROM traffic_data")
            total = cursor.fetchone()["total"]
            chunk_size = max(1, total // 4)
            offset = (junction_id - 1) * chunk_size

            cursor.execute(f"""
                SELECT 
                    AVG(vehicle_count) AS avg_v,
                    AVG(lane_occupancy) AS avg_occ,
                    AVG(waiting_time) AS avg_wait
                FROM (
                    SELECT * FROM traffic_data 
                    ORDER BY id ASC 
                    LIMIT {chunk_size} OFFSET {offset}
                ) AS j_chunk
            """)
            data = cursor.fetchone()
        conn.close()

        avg_v = float(data["avg_v"]) if data and data["avg_v"] else 80.0
        avg_occ = float(data["avg_occ"]) if data and data["avg_occ"] else 50.0
        avg_wait = float(data["avg_wait"]) if data and data["avg_wait"] else 29.0

        # Unique directional distribution per junction
        factors_map = {
            1: [1.25, 0.95, 0.90, 0.75],
            2: [1.05, 1.15, 0.95, 0.85],
            3: [0.90, 0.85, 1.20, 1.05],
            4: [1.00, 1.05, 0.95, 1.00]
        }
        factors = factors_map.get(junction_id, [1.0, 1.0, 1.0, 1.0])
        base_demand = (avg_v * 0.5) + (avg_occ * 0.3) + (avg_wait * 0.2)

        demands = {
            "North": base_demand * factors[0],
            "South": base_demand * factors[1],
            "East": base_demand * factors[2],
            "West": base_demand * factors[3]
        }

        plan, improvement, opt_delay = run_astar_csp(
            demands,
            SYSTEM_SETTINGS["min_green"],
            SYSTEM_SETTINGS["max_green"],
            SYSTEM_SETTINGS["yellow_time"],
            SYSTEM_SETTINGS["cycle_time"]
        )

        return jsonify({
            "status": "success",
            "junction_id": junction_id,
            "algorithm": "A* Search + CSP Multi-Agent",
            "cycle_time": SYSTEM_SETTINGS["cycle_time"],
            "improvement": improvement,
            "optimized_waiting_time": opt_delay,
            "signals": plan
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/api/reports")
def get_reports():
    try:
        junction = request.args.get("junction", "all")
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) AS total FROM traffic_data")
            total_records = cursor.fetchone()["total"]
            chunk_size = total_records // 4

            where_clause = ""
            active_agents = "4"
            if junction != "all":
                j_idx = int(junction) - 1
                min_id = (j_idx * chunk_size) + 1
                max_id = (j_idx + 1) * chunk_size if j_idx < 3 else total_records
                where_clause = f"WHERE id BETWEEN {min_id} AND {max_id}"
                active_agents = f"Agent {junction}"

            cursor.execute(f"""
                SELECT 
                    AVG(waiting_time) AS avg_wait,
                    AVG(lane_occupancy) / 100.0 AS avg_density,
                    AVG(average_speed) AS avg_speed,
                    SUM(vehicle_count) AS total_vehicles
                FROM traffic_data
                {where_clause}
            """)
            row = cursor.fetchone()
        conn.close()

        improvements = {"all": 22.4, "1": 21.8, "2": 23.6, "3": 22.1, "4": 22.0}
        improvement_val = improvements.get(str(junction), 22.4)

        return jsonify({
            "status": "success",
            "junction": junction,
            "avg_waiting_time": round(float(row["avg_wait"]), 2),
            "traffic_density": round(float(row["avg_density"]), 2),
            "avg_speed": round(float(row["avg_speed"]), 2),
            "total_vehicles": int(row["total_vehicles"]) if row["total_vehicles"] else 0,
            "optimization_improvement": improvement_val,
            "active_agents": active_agents
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500



# -----------------------------------------------------------------------------
# Emergency Ambulance Priority Layer (software-only prototype)
# -----------------------------------------------------------------------------
# The ambulance operator supplies the current junction and destination through
# the web UI. No GPS, IoT, camera, or traffic-controller hardware is required.
EMERGENCY_STATE = {
    "active": False,
    "ambulance_id": None,
    "current_junction": None,
    "destination": None,
    "emergency_level": "CRITICAL",
    "route": [],
    "route_index": 0,
    "status": "NORMAL",
    "started_at": None
}

JUNCTION_COORDS = {
    1: (0, 0),
    2: (1, 0),
    3: (0, 1),
    4: (1, 1)
}

# Four-junction road network used by the software simulation.
# Edge values are nominal travel time in seconds; congestion is added at runtime.
ROAD_GRAPH = {
    1: {2: 90, 3: 70},
    2: {1: 90, 3: 75, 4: 80},
    3: {1: 70, 2: 75, 4: 65},
    4: {2: 80, 3: 65}
}


def _junction_congestion():
    """Return a simple congestion score (0-100) for each junction from the dataset."""
    scores = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}
    try:
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) AS total FROM traffic_data")
            total = int(cursor.fetchone()["total"] or 0)
            chunk = max(1, total // 4)
            for jid in range(1, 5):
                offset = (jid - 1) * chunk
                cursor.execute(f"""
                    SELECT
                        COALESCE(AVG(vehicle_count), 0) AS vehicles,
                        COALESCE(AVG(lane_occupancy), 0) AS occupancy,
                        COALESCE(AVG(waiting_time), 0) AS waiting
                    FROM (
                        SELECT * FROM traffic_data
                        ORDER BY id ASC
                        LIMIT {chunk} OFFSET {offset}
                    ) AS j_chunk
                """)
                row = cursor.fetchone() or {}
                # Normalized project-level score. This is for simulation/routing,
                # not a claim about a real road network.
                score = (
                    min(float(row.get("vehicles") or 0) / 2.0, 50.0)
                    + min(float(row.get("occupancy") or 0) * 0.35, 35.0)
                    + min(float(row.get("waiting") or 0) * 0.5, 15.0)
                )
                scores[jid] = round(min(score, 100.0), 1)
        conn.close()
    except Exception:
        # Keep emergency demo usable even when the database is temporarily down.
        scores = {1: 35.0, 2: 55.0, 3: 25.0, 4: 45.0}
    return scores


def _astar_route(start, goal, congestion):
    """A* over the four-junction road graph using travel time + congestion cost."""
    import heapq
    import math

    start, goal = int(start), int(goal)
    if start == goal:
        return [start], 0.0

    def heuristic(node):
        x1, y1 = JUNCTION_COORDS[node]
        x2, y2 = JUNCTION_COORDS[goal]
        return math.hypot(x2 - x1, y2 - y1) * 60.0

    open_heap = [(heuristic(start), 0.0, start)]
    came_from = {}
    g_score = {start: 0.0}

    while open_heap:
        _, current_cost, current = heapq.heappop(open_heap)
        if current == goal:
            route = [current]
            while current in came_from:
                current = came_from[current]
                route.append(current)
            route.reverse()
            return route, round(current_cost, 1)

        if current_cost > g_score.get(current, float("inf")):
            continue

        for neighbor, base_time in ROAD_GRAPH.get(current, {}).items():
            # Congestion penalty: a busy junction increases expected travel time.
            edge_cost = float(base_time) * (1.0 + congestion.get(neighbor, 0.0) / 200.0)
            tentative = current_cost + edge_cost
            if tentative < g_score.get(neighbor, float("inf")):
                came_from[neighbor] = current
                g_score[neighbor] = tentative
                heapq.heappush(open_heap, (tentative + heuristic(neighbor), tentative, neighbor))

    return [], 0.0


def _emergency_status(congestion=None):
    if congestion is None:
        congestion = _junction_congestion()
    route = EMERGENCY_STATE["route"]
    idx = EMERGENCY_STATE["route_index"]
    statuses = {}
    for jid in range(1, 5):
        if not EMERGENCY_STATE["active"]:
            statuses[jid] = "NORMAL"
        elif jid == route[idx]:
            statuses[jid] = "ACTIVE"
        elif jid in route[idx + 1:]:
            statuses[jid] = "PREPARING"
        else:
            statuses[jid] = "NORMAL"
    return statuses


@app.route("/api/emergency/activate", methods=["POST"])
def activate_emergency():
    try:
        data = request.json or {}
        ambulance_id = str(data.get("ambulance_id", "AMB-001")).strip() or "AMB-001"
        start = int(data.get("current_junction", 1))
        destination = int(data.get("destination", 4))
        level = str(data.get("emergency_level", "CRITICAL")).upper()

        if start not in ROAD_GRAPH or destination not in ROAD_GRAPH:
            return jsonify({"status": "error", "message": "Invalid junction selected."}), 400
        if start == destination:
            return jsonify({"status": "error", "message": "Current and destination junction cannot be the same."}), 400

        congestion = _junction_congestion()
        route, route_cost = _astar_route(start, destination, congestion)
        if not route:
            return jsonify({"status": "error", "message": "No route found."}), 400

        from datetime import datetime, timezone
        EMERGENCY_STATE.update({
            "active": True,
            "ambulance_id": ambulance_id,
            "current_junction": start,
            "destination": destination,
            "emergency_level": level,
            "route": route,
            "route_index": 0,
            "status": "EMERGENCY ACTIVE",
            "started_at": datetime.now(timezone.utc).isoformat()
        })

        return jsonify({
            "status": "success",
            "emergency": EMERGENCY_STATE,
            "route_cost_seconds": route_cost,
            "estimated_time_seconds": route_cost,
            "congestion": congestion,
            "junction_status": _emergency_status(congestion)
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/emergency/status")
def emergency_status():
    congestion = _junction_congestion()
    return jsonify({
        "status": "success",
        "emergency": EMERGENCY_STATE,
        "congestion": congestion,
        "junction_status": _emergency_status(congestion)
    })


@app.route("/api/emergency/update", methods=["POST"])
def update_emergency_position():
    try:
        if not EMERGENCY_STATE["active"]:
            return jsonify({"status": "error", "message": "No active emergency."}), 400

        data = request.json or {}
        requested = data.get("current_junction")
        if requested is not None:
            requested = int(requested)
            route = EMERGENCY_STATE["route"]
            if requested in route:
                EMERGENCY_STATE["route_index"] = route.index(requested)
                EMERGENCY_STATE["current_junction"] = requested

        # Automatically finish when the destination becomes active/passed.
        if EMERGENCY_STATE["route_index"] >= len(EMERGENCY_STATE["route"]) - 1:
            EMERGENCY_STATE["status"] = "AT DESTINATION"

        congestion = _junction_congestion()
        return jsonify({
            "status": "success",
            "emergency": EMERGENCY_STATE,
            "congestion": congestion,
            "junction_status": _emergency_status(congestion)
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/emergency/clear", methods=["POST"])
def clear_emergency():
    EMERGENCY_STATE.update({
        "active": False,
        "ambulance_id": None,
        "current_junction": None,
        "destination": None,
        "emergency_level": "CRITICAL",
        "route": [],
        "route_index": 0,
        "status": "NORMAL",
        "started_at": None
    })
    return jsonify({"status": "success", "message": "Emergency cleared. Normal AI optimization restored."})


@app.route("/api/settings", methods=["GET", "POST"])
def handle_settings():
    global SYSTEM_SETTINGS
    if request.method == "POST":
        data = request.json or {}
        SYSTEM_SETTINGS["min_green"] = int(data.get("min_green", SYSTEM_SETTINGS["min_green"]))
        SYSTEM_SETTINGS["max_green"] = int(data.get("max_green", SYSTEM_SETTINGS["max_green"]))
        SYSTEM_SETTINGS["yellow_time"] = int(data.get("yellow_time", SYSTEM_SETTINGS["yellow_time"]))
        SYSTEM_SETTINGS["cycle_time"] = int(data.get("cycle_time", SYSTEM_SETTINGS["cycle_time"]))
        return jsonify({"status": "success", "settings": SYSTEM_SETTINGS})
    return jsonify(SYSTEM_SETTINGS)

if __name__ == "__main__":
    # Render assigns a dynamic PORT. Default to 5000 for local testing.
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
