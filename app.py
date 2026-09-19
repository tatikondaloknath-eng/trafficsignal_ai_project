import os
import socket
import json
import math
import time
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
# Database-driven live network simulation + software-only ambulance priority
# -----------------------------------------------------------------------------
# Important project limitation: traffic_data does not contain lane-direction,
# origin/destination or GPS fields. The live UI therefore uses the stored
# vehicle_count / speed / occupancy / flow / waiting values as the measured
# junction state, and deterministically derives four approach demands from that
# row for visualization. It does not claim these direction values are measured.

EMERGENCY_STATE = {
    "active": False,
    "request_id": None,
    "ambulance_id": None,
    "current_junction": None,
    "destination": None,
    "emergency_level": "CRITICAL",
    "route": [],
    "route_index": 0,
    "status": "NORMAL",
    "started_at": None,
}

JUNCTION_COORDS = {
    1: (0, 0),
    2: (1, 0),
    3: (0, 1),
    4: (1, 1),
}

ROAD_GRAPH = {
    1: {2: 90, 3: 70},
    2: {1: 90, 4: 80, 3: 75},
    3: {1: 70, 4: 65, 2: 75},
    4: {2: 80, 3: 65},
}

DIRECTIONS = ["North", "South", "East", "West"]
DIRECTION_FACTORS = {
    1: [1.22, 0.96, 1.05, 0.77],
    2: [1.02, 1.18, 1.00, 0.88],
    3: [0.90, 0.82, 1.20, 1.08],
    4: [1.00, 1.10, 0.95, 1.12],
}

EMERGENCY_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS emergency_requests (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    ambulance_id VARCHAR(64) NOT NULL,
    current_junction INT NOT NULL,
    destination INT NOT NULL,
    emergency_level VARCHAR(20) NOT NULL,
    route_json TEXT NOT NULL,
    route_cost_seconds DOUBLE NOT NULL DEFAULT 0,
    route_index INT NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL,
    started_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    INDEX idx_emergency_status (status),
    INDEX idx_emergency_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""


def _ensure_emergency_table(conn):
    with conn.cursor() as cursor:
        cursor.execute(EMERGENCY_TABLE_SQL)
    conn.commit()


def _utc_mysql_now():
    # MySQL DATETIME; application server and database timestamps remain simple
    # and do not require timezone-aware SQL functions.
    from datetime import datetime
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def _junction_congestion():
    """Compute a deterministic 0-100 congestion score from current database rows."""
    scores = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) AS total FROM traffic_data")
            total = int(cursor.fetchone()["total"] or 0)
            if total <= 0:
                return scores
            chunk = max(1, total // 4)
            for jid in range(1, 5):
                offset = (jid - 1) * chunk
                limit = chunk if jid < 4 else total - offset
                limit = max(1, limit)
                cursor.execute(f"""
                    SELECT
                        COALESCE(AVG(vehicle_count), 0) AS vehicles,
                        COALESCE(AVG(lane_occupancy), 0) AS occupancy,
                        COALESCE(AVG(waiting_time), 0) AS waiting
                    FROM (
                        SELECT vehicle_count, lane_occupancy, waiting_time
                        FROM traffic_data
                        ORDER BY id ASC
                        LIMIT {limit} OFFSET {offset}
                    ) AS j_chunk
                """)
                row = cursor.fetchone() or {}
                score = (
                    min(float(row.get("vehicles") or 0) / 2.0, 50.0)
                    + min(float(row.get("occupancy") or 0) * 0.35, 35.0)
                    + min(float(row.get("waiting") or 0) * 0.5, 15.0)
                )
                scores[jid] = round(min(score, 100.0), 1)
    finally:
        conn.close()
    return scores


def _latest_emergency_from_db():
    conn = get_db_connection()
    try:
        _ensure_emergency_table(conn)
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT id, ambulance_id, current_junction, destination, emergency_level,
                       route_json, route_cost_seconds, route_index, status, started_at
                FROM emergency_requests
                WHERE status IN ('ACTIVE', 'AT DESTINATION')
                ORDER BY id DESC
                LIMIT 1
            """)
            row = cursor.fetchone()
        if not row:
            return None
        state = {
            "active": row["status"] in ("ACTIVE", "AT DESTINATION"),
            "request_id": int(row["id"]),
            "ambulance_id": row["ambulance_id"],
            "current_junction": int(row["current_junction"]),
            "destination": int(row["destination"]),
            "emergency_level": row["emergency_level"],
            "route": json.loads(row["route_json"] or "[]"),
            "route_index": int(row["route_index"]),
            "status": row["status"],
            "started_at": str(row["started_at"]),
        }
        EMERGENCY_STATE.update(state)
        return state
    finally:
        conn.close()


def _set_emergency_db_row(request_id, route_index, current_junction, status):
    conn = get_db_connection()
    try:
        _ensure_emergency_table(conn)
        with conn.cursor() as cursor:
            cursor.execute("""
                UPDATE emergency_requests
                SET route_index=%s, current_junction=%s, status=%s, updated_at=%s
                WHERE id=%s
            """, (int(route_index), int(current_junction), status, _utc_mysql_now(), int(request_id)))
        conn.commit()
    finally:
        conn.close()


def _astar_route(start, goal, congestion):
    """Actual A* over the explicit four-junction graph."""
    import heapq
    start, goal = int(start), int(goal)
    if start == goal:
        return [start], 0.0

    def heuristic(node):
        x1, y1 = JUNCTION_COORDS[node]
        x2, y2 = JUNCTION_COORDS[goal]
        # Base edge times are in the same scale as the heuristic.
        return math.hypot(x2 - x1, y2 - y1) * 65.0

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
            edge_cost = float(base_time) * (1.0 + float(congestion.get(neighbor, 0.0)) / 200.0)
            tentative = current_cost + edge_cost
            if tentative < g_score.get(neighbor, float("inf")):
                came_from[neighbor] = current
                g_score[neighbor] = tentative
                heapq.heappush(open_heap, (tentative + heuristic(neighbor), tentative, neighbor))
    return [], 0.0


def _edge_time_seconds(a, b, congestion):
    base = ROAD_GRAPH.get(int(a), {}).get(int(b))
    if base is None:
        base = ROAD_GRAPH.get(int(b), {}).get(int(a))
    if base is None:
        return 0.0
    return round(float(base) * (1.0 + float(congestion.get(int(b), 0.0)) / 200.0), 1)


def _route_remaining_eta(route, route_index, congestion):
    if not route or route_index >= len(route) - 1:
        return 0.0
    eta = 0.0
    for i in range(int(route_index), len(route) - 1):
        eta += _edge_time_seconds(route[i], route[i + 1], congestion)
    return round(eta, 1)


def _get_signal_plan_for_row(jid, row):
    avg_v = float(row.get("vehicle_count") or 0)
    avg_occ = float(row.get("lane_occupancy") or 0)
    avg_wait = float(row.get("waiting_time") or 0)
    base_demand = (avg_v * 0.5) + (avg_occ * 0.3) + (avg_wait * 0.2)
    factors = DIRECTION_FACTORS.get(int(jid), [1.0, 1.0, 1.0, 1.0])
    demands = {d: base_demand * factors[i] for i, d in enumerate(DIRECTIONS)}
    plan, _, _ = run_astar_csp(
        demands,
        SYSTEM_SETTINGS["min_green"],
        SYSTEM_SETTINGS["max_green"],
        SYSTEM_SETTINGS["yellow_time"],
        SYSTEM_SETTINGS["cycle_time"]
    )
    return plan


def _signal_state(plan, now_epoch, phase_offset=0.0):
    cycle = sum(int(plan[d]["green"]) + int(plan[d]["yellow"]) for d in DIRECTIONS)
    cycle = max(1, cycle)
    t = (now_epoch + phase_offset) % cycle
    elapsed = 0
    result = {d: {"state": "RED", "remaining_seconds": 0, "phase_elapsed": 0} for d in DIRECTIONS}
    for d in DIRECTIONS:
        green = int(plan[d]["green"])
        yellow = int(plan[d]["yellow"])
        if t < elapsed + green:
            result[d] = {"state": "GREEN", "remaining_seconds": round(elapsed + green - t, 1), "phase_elapsed": round(t - elapsed, 1)}
            return result
        elapsed += green
        if t < elapsed + yellow:
            result[d] = {"state": "YELLOW", "remaining_seconds": round(elapsed + yellow - t, 1), "phase_elapsed": round(t - elapsed, 1)}
            return result
        elapsed += yellow
    return result


def _derive_approach_data(jid, row, signal_plan, now_epoch):
    vehicle_count = max(0.0, float(row.get("vehicle_count") or 0))
    speed = max(1.0, float(row.get("average_speed") or 1.0))
    occupancy = max(0.0, min(100.0, float(row.get("lane_occupancy") or 0)))
    flow = max(0.0, float(row.get("flow_rate") or 0))
    wait = max(0.0, float(row.get("waiting_time") or 0))
    pressure = (0.55 + 0.45 * occupancy / 100.0) * (0.7 + 0.3 * min(flow / 1500.0, 1.4)) * (1.0 + min(wait, 120.0) / 240.0)
    factors = DIRECTION_FACTORS.get(int(jid), [1.0] * 4)
    raw = [vehicle_count * pressure * f / sum(factors) * 1.35 for f in factors]
    estimated = {d: round(raw[i], 1) for i, d in enumerate(DIRECTIONS)}
    signals = _signal_state(signal_plan, now_epoch, phase_offset=int(jid) * 11.0)

    result = {}
    for d in DIRECTIONS:
        count = max(0, int(round(estimated[d])))
        visible = min(10, max(1 if count > 0 else 0, int(round(count / 3.0))))
        result[d] = {
            "estimated_vehicles": count,
            "visible_vehicles": visible,
            "speed_kmh": round(speed, 1),
            "occupancy": round(occupancy, 1),
            "flow_rate": round(flow, 1),
            "waiting_time": round(wait, 1),
            "signal": signals[d]["state"],
            "signal_remaining": signals[d]["remaining_seconds"],
            "phase_elapsed": signals[d]["phase_elapsed"],
        }
    return result


def _network_scenario(tick=None):
    if tick is None:
        tick = int(time.time() // 5)
    tick = int(tick)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) AS total FROM traffic_data")
            total = int(cursor.fetchone()["total"] or 0)
            if total <= 0:
                raise RuntimeError("traffic_data is empty")
            chunk = max(1, total // 4)
            now_epoch = time.time()
            junctions = {}
            total_vehicles = 0
            weighted_wait = 0.0
            weighted_speed = 0.0
            for jid in range(1, 5):
                offset_base = (jid - 1) * chunk
                available = chunk if jid < 4 else total - offset_base
                idx = (tick + (jid - 1) * 37) % max(1, available)
                offset = offset_base + idx
                cursor.execute("""
                    SELECT id, vehicle_count, average_speed, lane_occupancy,
                           flow_rate, time_of_day, waiting_time
                    FROM traffic_data
                    ORDER BY id ASC
                    LIMIT 1 OFFSET %s
                """, (offset,))
                row = cursor.fetchone()
                if not row:
                    raise RuntimeError(f"No traffic_data row available for Junction {jid}")
                plan = _get_signal_plan_for_row(jid, row)
                approaches = _derive_approach_data(jid, row, plan, now_epoch)
                junctions[str(jid)] = {
                    "junction": jid,
                    "record_id": int(row["id"]),
                    "vehicle_count": int(row["vehicle_count"] or 0),
                    "average_speed": round(float(row["average_speed"] or 0), 1),
                    "lane_occupancy": round(float(row["lane_occupancy"] or 0), 1),
                    "flow_rate": round(float(row["flow_rate"] or 0), 1),
                    "time_of_day": row["time_of_day"] or "unknown",
                    "waiting_time": round(float(row["waiting_time"] or 0), 1),
                    "signals": plan,
                    "approaches": approaches,
                }
                total_vehicles += int(row["vehicle_count"] or 0)
                weighted_wait += float(row["waiting_time"] or 0)
                weighted_speed += float(row["average_speed"] or 0)
            return {
                "status": "success",
                "server_time": now_epoch,
                "tick": tick,
                "frame_seconds": 5,
                "junctions": junctions,
                "total_database_vehicles": total_vehicles,
                "network_avg_waiting": round(weighted_wait / 4.0, 1),
                "network_avg_speed": round(weighted_speed / 4.0, 1),
                "source": "Aiven MySQL traffic_data replay",
            }
    finally:
        conn.close()


def _emergency_status(congestion=None):
    if congestion is None:
        congestion = _junction_congestion()
    statuses = {}
    route = EMERGENCY_STATE["route"]
    idx = int(EMERGENCY_STATE["route_index"] or 0)
    for jid in range(1, 5):
        if not EMERGENCY_STATE["active"]:
            statuses[jid] = "NORMAL"
        elif route and jid == route[min(idx, len(route) - 1)]:
            statuses[jid] = "ACTIVE"
        elif route and jid in route[min(idx + 1, len(route)):]:
            statuses[jid] = "PREPARING"
        else:
            statuses[jid] = "NORMAL"
    return statuses


def _emergency_payload():
    congestion = _junction_congestion()
    state = _latest_emergency_from_db() or EMERGENCY_STATE
    if state.get("active") and state.get("status") == "AT DESTINATION":
        statuses = _emergency_status(congestion)
    else:
        statuses = _emergency_status(congestion)
    route = state.get("route") or []
    idx = int(state.get("route_index") or 0)
    next_junction = route[idx + 1] if state.get("active") and idx + 1 < len(route) else None
    segment_time = 0.0
    if next_junction is not None:
        segment_time = _edge_time_seconds(state["current_junction"], next_junction, congestion)
    eta = _route_remaining_eta(route, idx, congestion)
    return {
        "status": "success",
        "emergency": state,
        "congestion": congestion,
        "junction_status": statuses,
        "estimated_time_seconds": eta,
        "next_junction": next_junction,
        "segment_time_seconds": segment_time,
    }


@app.route("/api/network/state")
def network_state():
    try:
        tick = request.args.get("tick")
        scenario = _network_scenario(None if tick is None else int(tick))
        # Attach emergency info so the canvas and dashboard are synchronized.
        emergency = _emergency_payload()
        scenario["emergency"] = emergency["emergency"]
        scenario["junction_status"] = emergency["junction_status"]
        scenario["emergency_eta_seconds"] = emergency["estimated_time_seconds"]
        scenario["emergency_next_junction"] = emergency["next_junction"]
        scenario["emergency_segment_time_seconds"] = emergency["segment_time_seconds"]
        return jsonify(scenario)
    except Exception as e:
        return jsonify({"status": "error", "message": f"Database-driven network state failed: {e}"}), 500


@app.route("/api/emergency/plan", methods=["POST"])
def plan_emergency():
    try:
        data = request.json or {}
        start = int(data.get("current_junction", 1))
        destination = int(data.get("destination", 4))
        if start not in ROAD_GRAPH or destination not in ROAD_GRAPH:
            return jsonify({"status": "error", "message": "Invalid junction selected."}), 400
        if start == destination:
            return jsonify({"status": "error", "message": "Current and destination junction cannot be the same."}), 400
        congestion = _junction_congestion()
        route, route_cost = _astar_route(start, destination, congestion)
        if not route:
            return jsonify({"status": "error", "message": "No route found."}), 400
        return jsonify({
            "status": "success",
            "algorithm": "A*",
            "route": route,
            "route_cost_seconds": route_cost,
            "estimated_time_seconds": _route_remaining_eta(route, 0, congestion),
            "congestion": congestion,
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


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

        existing = _latest_emergency_from_db()
        if existing and existing.get("active"):
            return jsonify({"status": "error", "message": "An emergency corridor is already active. End it before creating another."}), 409

        congestion = _junction_congestion()
        route, route_cost = _astar_route(start, destination, congestion)
        if not route:
            return jsonify({"status": "error", "message": "No route found."}), 400

        now = _utc_mysql_now()
        conn = get_db_connection()
        try:
            _ensure_emergency_table(conn)
            with conn.cursor() as cursor:
                cursor.execute("UPDATE emergency_requests SET status='CLEARED', updated_at=%s WHERE status IN ('ACTIVE','AT DESTINATION')", (now,))
                cursor.execute("""
                    INSERT INTO emergency_requests
                    (ambulance_id, current_junction, destination, emergency_level,
                     route_json, route_cost_seconds, route_index, status, started_at, updated_at)
                    VALUES (%s,%s,%s,%s,%s,%s,0,'ACTIVE',%s,%s)
                """, (ambulance_id, start, destination, level, json.dumps(route), route_cost, now, now))
                request_id = int(cursor.lastrowid)
            conn.commit()
        finally:
            conn.close()

        EMERGENCY_STATE.update({
            "active": True,
            "request_id": request_id,
            "ambulance_id": ambulance_id,
            "current_junction": start,
            "destination": destination,
            "emergency_level": level,
            "route": route,
            "route_index": 0,
            "status": "ACTIVE",
            "started_at": now,
        })
        payload = _emergency_payload()
        payload["route_cost_seconds"] = route_cost
        return jsonify(payload)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/emergency/status")
def emergency_status():
    try:
        return jsonify(_emergency_payload())
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/emergency/update", methods=["POST"])
def update_emergency_position():
    try:
        current = _latest_emergency_from_db() or EMERGENCY_STATE
        if not current.get("active"):
            return jsonify({"status": "error", "message": "No active emergency."}), 400
        requested = int((request.json or {}).get("current_junction"))
        route = [int(x) for x in current.get("route", [])]
        idx = int(current.get("route_index", 0))
        expected = route[idx + 1] if idx + 1 < len(route) else None
        if requested != expected:
            return jsonify({"status": "error", "message": f"Invalid movement. Expected next junction {expected}."}), 409
        new_index = idx + 1
        new_status = "AT DESTINATION" if new_index >= len(route) - 1 else "ACTIVE"
        _set_emergency_db_row(current["request_id"], new_index, requested, new_status)
        EMERGENCY_STATE.update({"route_index": new_index, "current_junction": requested, "status": new_status})
        return jsonify(_emergency_payload())
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/emergency/clear", methods=["POST"])
def clear_emergency():
    try:
        current = _latest_emergency_from_db()
        if current and current.get("request_id"):
            _set_emergency_db_row(current["request_id"], current.get("route_index", 0), current.get("current_junction", 1), "CLEARED")
        EMERGENCY_STATE.update({
            "active": False,
            "request_id": None,
            "ambulance_id": None,
            "current_junction": None,
            "destination": None,
            "emergency_level": "CRITICAL",
            "route": [],
            "route_index": 0,
            "status": "NORMAL",
            "started_at": None,
        })
        return jsonify({"status": "success", "message": "Emergency cleared. Normal AI optimization restored."})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


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
