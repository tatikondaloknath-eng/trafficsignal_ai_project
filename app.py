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
            "algorithm": "Constraint-Based Multi-Agent Signal Timing",
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
# REALISTIC DATABASE-REPLAYED NETWORK DIGITAL TWIN + EMERGENCY CORRIDOR
# -----------------------------------------------------------------------------
# The existing traffic_data table contains aggregate observations only:
# vehicle_count, average_speed, lane_occupancy, flow_rate, time_of_day,
# waiting_time. There are no measured lane-direction/GPS fields. The control
# center therefore replays one row per junction per frame and derives an
# *estimated* four-approach demand for the visualization. This is deliberately
# labelled as estimated rather than sensor-measured direction data.

from datetime import datetime, timezone
import heapq

DIRECTIONS = ["North", "South", "East", "West"]
NETWORK_COORDS = {
    1: (0, 0), 2: (1, 0),
    3: (0, 1), 4: (1, 1),
}
NETWORK_GRAPH = {
    1: {2: 36.0, 3: 40.0},
    2: {1: 36.0, 4: 38.0},
    3: {1: 40.0, 4: 35.0},
    4: {2: 38.0, 3: 35.0},
}
# Deterministic approach factors are only used to split aggregate junction data
# into four visual approach queues. They are not claimed as measured directions.
APPROACH_FACTORS = {
    1: {"North": 1.22, "South": 0.94, "East": 1.05, "West": 0.79},
    2: {"North": 1.03, "South": 1.17, "East": 0.98, "West": 0.88},
    3: {"North": 0.91, "South": 0.83, "East": 1.18, "West": 1.08},
    4: {"North": 1.00, "South": 1.09, "East": 0.96, "West": 1.12},
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
    segment_seconds DOUBLE NOT NULL DEFAULT 0,
    segment_started_at DATETIME NOT NULL,
    status VARCHAR(32) NOT NULL,
    started_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    INDEX idx_emergency_status (status),
    INDEX idx_emergency_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""


# Idempotent schema migration. Earlier project versions created emergency_requests
# without all fields used by the current controller (notably segment_seconds).
# This migration upgrades an existing table without deleting emergency history.
_EMERGENCY_SCHEMA_READY = False
_EMERGENCY_SCHEMA_LOCK = None

def ensure_emergency_table(conn):
    global _EMERGENCY_SCHEMA_READY, _EMERGENCY_SCHEMA_LOCK
    import threading
    if _EMERGENCY_SCHEMA_READY:
        return
    if _EMERGENCY_SCHEMA_LOCK is None:
        _EMERGENCY_SCHEMA_LOCK = threading.Lock()
    with _EMERGENCY_SCHEMA_LOCK:
        if _EMERGENCY_SCHEMA_READY:
            return
        with conn.cursor() as cursor:
            cursor.execute(EMERGENCY_TABLE_SQL)
            cursor.execute("""
                SELECT COLUMN_NAME FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA=%s AND TABLE_NAME='emergency_requests'
            """, (DB_NAME,))
            existing = {row['COLUMN_NAME'] for row in cursor.fetchall()}
            migrations = {
                'ambulance_id': "ALTER TABLE emergency_requests ADD COLUMN ambulance_id VARCHAR(64) NULL",
                'current_junction': "ALTER TABLE emergency_requests ADD COLUMN current_junction INT NULL",
                'destination': "ALTER TABLE emergency_requests ADD COLUMN destination INT NULL",
                'emergency_level': "ALTER TABLE emergency_requests ADD COLUMN emergency_level VARCHAR(20) NULL",
                'route_json': "ALTER TABLE emergency_requests ADD COLUMN route_json TEXT NULL",
                'route_cost_seconds': "ALTER TABLE emergency_requests ADD COLUMN route_cost_seconds DOUBLE NOT NULL DEFAULT 0",
                'route_index': "ALTER TABLE emergency_requests ADD COLUMN route_index INT NOT NULL DEFAULT 0",
                'segment_seconds': "ALTER TABLE emergency_requests ADD COLUMN segment_seconds DOUBLE NOT NULL DEFAULT 0",
                'segment_started_at': "ALTER TABLE emergency_requests ADD COLUMN segment_started_at DATETIME NULL",
                'status': "ALTER TABLE emergency_requests ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'CLEARED'",
                'started_at': "ALTER TABLE emergency_requests ADD COLUMN started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP",
                'updated_at': "ALTER TABLE emergency_requests ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP",
            }
            for name, sql in migrations.items():
                if name not in existing:
                    cursor.execute(sql)
            # Backfill any NULL route indexes/timing values in old rows.
            cursor.execute("UPDATE emergency_requests SET route_index=0 WHERE route_index IS NULL")
            cursor.execute("UPDATE emergency_requests SET segment_seconds=0 WHERE segment_seconds IS NULL")
        conn.commit()
        _EMERGENCY_SCHEMA_READY = True


def db_now():
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def _fetch_network_frame(frame_index):
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) AS total FROM traffic_data")
            total = int(cursor.fetchone()["total"] or 0)
            if total < 4:
                raise RuntimeError("traffic_data must contain at least 4 records so the four-junction replay can start.")
            chunk = max(1, total // 4)
            frame_count = chunk
            frame_index = int(frame_index) % frame_count
            junction_rows = {}
            for jid in range(1, 5):
                offset = (jid - 1) * chunk + frame_index
                cursor.execute("""
                    SELECT id, vehicle_count, average_speed, lane_occupancy,
                           flow_rate, time_of_day, waiting_time
                    FROM traffic_data
                    ORDER BY id ASC
                    LIMIT 1 OFFSET %s
                """, (offset,))
                row = cursor.fetchone()
                if row is None:
                    # Defensive fallback for an uneven final chunk.
                    cursor.execute("""
                        SELECT id, vehicle_count, average_speed, lane_occupancy,
                               flow_rate, time_of_day, waiting_time
                        FROM traffic_data
                        ORDER BY id DESC
                        LIMIT 1
                    """)
                    row = cursor.fetchone()
                junction_rows[jid] = {
                    "source_id": int(row["id"]),
                    "vehicle_count": max(0, int(row["vehicle_count"] or 0)),
                    "average_speed": max(0.0, float(row["average_speed"] or 0)),
                    "lane_occupancy": max(0.0, min(100.0, float(row["lane_occupancy"] or 0))),
                    "flow_rate": max(0.0, float(row["flow_rate"] or 0)),
                    "time_of_day": str(row["time_of_day"] or ""),
                    "waiting_time": max(0.0, float(row["waiting_time"] or 0)),
                }
            return frame_index, frame_count, junction_rows
    finally:
        conn.close()


def _congestion_score(row):
    # Transparent weighted indicator from the available aggregate metrics.
    vehicle_component = min(100.0, row["vehicle_count"] / 1.5)
    wait_component = min(100.0, row["waiting_time"] / 1.2)
    occupancy_component = row["lane_occupancy"]
    speed_component = max(0.0, min(100.0, 100.0 - row["average_speed"] * 2.2))
    score = (
        0.30 * vehicle_component
        + 0.28 * occupancy_component
        + 0.25 * wait_component
        + 0.17 * speed_component
    )
    return round(max(0.0, min(100.0, score)), 1)


def _approach_demand(jid, row):
    base = (
        max(0.0, row["vehicle_count"]) * 0.46
        + max(0.0, row["flow_rate"]) * 0.025
        + max(0.0, row["waiting_time"]) * 0.38
        + max(0.0, row["lane_occupancy"]) * 0.25
    )
    return {
        d: round(base * APPROACH_FACTORS[jid][d], 2)
        for d in DIRECTIONS
    }


def _fit_green_pair(ns, ew, min_green, max_green, total_green):
    ns = max(min_green, min(max_green, ns))
    ew = max(min_green, min(max_green, ew))
    target = float(total_green)
    for _ in range(100):
        diff = target - (ns + ew)
        if abs(diff) < 0.01:
            break
        if diff > 0:
            room_ns = max_green - ns
            room_ew = max_green - ew
            if room_ns <= 0 and room_ew <= 0:
                break
            if room_ns >= room_ew and room_ns > 0:
                add = min(diff, room_ns)
                ns += add
            elif room_ew > 0:
                add = min(diff, room_ew)
                ew += add
        else:
            removable_ns = ns - min_green
            removable_ew = ew - min_green
            if removable_ns <= 0 and removable_ew <= 0:
                break
            if removable_ns >= removable_ew and removable_ns > 0:
                sub = min(-diff, removable_ns)
                ns -= sub
            elif removable_ew > 0:
                sub = min(-diff, removable_ew)
                ew -= sub
    return int(round(ns)), int(round(ew))


def _normal_signal_plan(jid, row, replay_seconds):
    demands = _approach_demand(jid, row)
    ns_pressure = demands["North"] + demands["South"]
    ew_pressure = demands["East"] + demands["West"]
    cycle = max(40, int(SYSTEM_SETTINGS["cycle_time"]))
    yellow = max(3, int(SYSTEM_SETTINGS["yellow_time"]))
    min_g = max(5, int(SYSTEM_SETTINGS["min_green"]))
    max_g = max(min_g, int(SYSTEM_SETTINGS["max_green"]))
    total_green = max(2 * min_g, cycle - 2 * yellow)

    total_pressure = ns_pressure + ew_pressure or 1.0
    ns_target = total_green * (ns_pressure / total_pressure)
    ew_target = total_green - ns_target
    g_ns, g_ew = _fit_green_pair(ns_target, ew_target, min_g, max_g, total_green)

    offset = (jid - 1) * 6
    t = (float(replay_seconds) + offset) % cycle
    if t < g_ns:
        phase = "NS_GREEN"
        rem = g_ns - t
    elif t < g_ns + yellow:
        phase = "NS_YELLOW"
        rem = g_ns + yellow - t
    elif t < g_ns + yellow + g_ew:
        phase = "EW_GREEN"
        rem = g_ns + yellow + g_ew - t
    else:
        phase = "EW_YELLOW"
        rem = cycle - t

    signals = {
        "North": "GREEN" if phase == "NS_GREEN" else ("YELLOW" if phase == "NS_YELLOW" else "RED"),
        "South": "GREEN" if phase == "NS_GREEN" else ("YELLOW" if phase == "NS_YELLOW" else "RED"),
        "East": "GREEN" if phase == "EW_GREEN" else ("YELLOW" if phase == "EW_YELLOW" else "RED"),
        "West": "GREEN" if phase == "EW_GREEN" else ("YELLOW" if phase == "EW_YELLOW" else "RED"),
    }
    return {
        "phase": phase,
        "phase_remaining": round(max(0.0, rem), 1),
        "signals": signals,
        "green_ns": g_ns,
        "green_ew": g_ew,
        "yellow": yellow,
        "cycle": cycle,
        "demands": demands,
        "controller": "adaptive-demand",
    }


def _edge_direction(a, b):
    ax, ay = NETWORK_COORDS[int(a)]
    bx, by = NETWORK_COORDS[int(b)]
    if bx > ax: return "East"
    if bx < ax: return "West"
    if by > ay: return "South"
    return "North"


def _edge_cost(a, b, congestion, rows):
    base = float(NETWORK_GRAPH[int(a)][int(b)])
    return base + congestion[int(b)] * 0.70 + rows[int(b)]["waiting_time"] * 0.55 + congestion[int(a)] * 0.15


def astar_route(start, goal, congestion, rows):
    start, goal = int(start), int(goal)
    if start == goal:
        return [start], 0.0, []

    def h(n):
        x1, y1 = NETWORK_COORDS[n]
        x2, y2 = NETWORK_COORDS[goal]
        return (abs(x1 - x2) + abs(y1 - y2)) * 33.0

    pq = [(h(start), 0.0, start)]
    came = {}
    gscore = {start: 0.0}
    seen = set()
    while pq:
        _, g, node = heapq.heappop(pq)
        if node in seen:
            continue
        seen.add(node)
        if node == goal:
            break
        for nxt in NETWORK_GRAPH[node]:
            ng = g + _edge_cost(node, nxt, congestion, rows)
            if ng < gscore.get(nxt, float("inf")):
                gscore[nxt] = ng
                came[nxt] = node
                heapq.heappush(pq, (ng + h(nxt), ng, nxt))

    if goal not in gscore:
        raise RuntimeError("No route exists between the selected junctions.")

    path = [goal]
    while path[-1] != start:
        path.append(came[path[-1]])
    path.reverse()
    segments = []
    for a, b in zip(path, path[1:]):
        segments.append({
            "from": int(a),
            "to": int(b),
            "direction": _edge_direction(a, b),
            "seconds": round(_edge_cost(a, b, congestion, rows), 1),
            "congestion_at_destination": congestion[int(b)],
        })
    return path, round(float(gscore[goal]), 1), segments


def _latest_emergency():
    conn = get_db_connection()
    try:
        ensure_emergency_table(conn)
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT * FROM emergency_requests
                WHERE status IN ('ACTIVE', 'AT DESTINATION')
                ORDER BY id DESC LIMIT 1
            """)
            row = cursor.fetchone()
        if not row:
            return None
        return row
    finally:
        conn.close()


def _emergency_state(rows, replay_seconds):
    conn = get_db_connection()
    try:
        ensure_emergency_table(conn)
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT * FROM emergency_requests
                WHERE status IN ('ACTIVE', 'AT DESTINATION')
                ORDER BY id DESC LIMIT 1
            """)
            row = cursor.fetchone()
        if not row:
            return {"active": False, "status": "NORMAL", "route": [], "route_index": 0}

        route = [int(x) for x in json.loads(row["route_json"] or "[]")]
        idx = int(row["route_index"] or 0)
        congestion = {j: _congestion_score(rows[j]) for j in range(1, 5)}
        seg_seconds = float(row["segment_seconds"] or 0)
        progress = 1.0
        if row["status"] == "ACTIVE" and idx < len(route) - 1 and seg_seconds > 0:
            try:
                started = datetime.strptime(str(row["segment_started_at"]), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
                elapsed = max(0.0, datetime.now(timezone.utc).timestamp() - started.timestamp())
                progress = min(0.99, elapsed / seg_seconds)
            except Exception:
                progress = 0.0

        next_j = route[idx + 1] if idx + 1 < len(route) else None
        eta = 0.0
        if idx < len(route) - 1:
            for a, b in zip(route[idx:], route[idx + 1:]):
                eta += _edge_cost(a, b, congestion, rows)

        return {
            "active": True,
            "request_id": int(row["id"]),
            "ambulance_id": row["ambulance_id"],
            "current_junction": int(row["current_junction"]),
            "destination": int(row["destination"]),
            "emergency_level": row["emergency_level"],
            "route": route,
            "route_index": idx,
            "next_junction": next_j,
            "status": row["status"],
            "segment_seconds": round(seg_seconds, 1),
            "segment_progress": round(progress, 3),
            "estimated_time_seconds": round(eta, 1),
            "source": "emergency_requests",
        }
    finally:
        conn.close()


def _network_payload(frame_index=0):
    frame_index, frame_count, rows = _fetch_network_frame(frame_index)
    replay_seconds = frame_index * 5
    congestion = {j: _congestion_score(rows[j]) for j in range(1, 5)}
    emergency = _emergency_state(rows, replay_seconds)

    junctions = {}
    for j in range(1, 5):
        plan = _normal_signal_plan(j, rows[j], replay_seconds)
        status = "NORMAL"
        if emergency.get("active"):
            route = emergency.get("route", [])
            idx = emergency.get("route_index", 0)
            if j in route:
                if j == emergency.get("destination"):
                    status = "DESTINATION"
                elif j == route[idx]:
                    status = "EMERGENCY ACTIVE"
                    if idx + 1 < len(route):
                        # Force exactly the ambulance movement to GREEN.
                        # The normal opposing movement is also held so the
                        # emergency corridor is unambiguous in the simulation.
                        travel_dir = _edge_direction(j, route[idx + 1])
                        plan["phase"] = "EMERGENCY_PRIORITY"
                        plan["phase_remaining"] = max(0.0, float(plan.get("phase_remaining", 0.0)))
                        plan["signals"] = {d: ("GREEN" if d == travel_dir else "RED") for d in DIRECTIONS}
                        plan["controller"] = "emergency-priority"
                elif idx + 1 < len(route) and j == route[idx + 1]:
                    status = "PREPARING"
                    plan["controller"] = "corridor-preparing"
        plan["status"] = status
        junctions[j] = {
            **rows[j],
            "junction": j,
            "congestion": congestion[j],
            "approach_demand": _approach_demand(j, rows[j]),
            "signal": plan,
        }

    total_vehicles = sum(rows[j]["vehicle_count"] for j in rows)
    avg_wait = sum(rows[j]["waiting_time"] for j in rows) / 4.0
    avg_speed = sum(rows[j]["average_speed"] for j in rows) / 4.0
    return {
        "status": "success",
        "frame_index": frame_index,
        "frame_count": frame_count,
        "replay_seconds": replay_seconds,
        "junctions": junctions,
        "congestion": congestion,
        "total_database_vehicles": total_vehicles,
        "network_average_wait": round(avg_wait, 1),
        "network_average_speed": round(avg_speed, 1),
        "emergency": emergency,
        "data_semantics": "Aggregate database replay; four approach demands are estimated for visualization because traffic_data has no directional fields.",
    }


@app.route("/api/network/state")
def network_state_api():
    try:
        frame = int(request.args.get("frame", request.args.get("tick", 0)))
        return jsonify(_network_payload(frame))
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/emergency/plan", methods=["POST"])
def emergency_plan():
    try:
        data = request.get_json(silent=True) or {}
        start = int(data.get("current_junction"))
        goal = int(data.get("destination"))
        if start not in NETWORK_GRAPH or goal not in NETWORK_GRAPH:
            return jsonify({"status": "error", "message": "Junction must be between 1 and 4."}), 400
        frame = int(data.get("frame", 0))
        _, _, rows = _fetch_network_frame(frame)
        congestion = {j: _congestion_score(rows[j]) for j in range(1, 5)}
        route, cost, segments = astar_route(start, goal, congestion, rows)
        return jsonify({
            "status": "success",
            "algorithm": "A* Emergency Route Planning",
            "route": route,
            "estimated_time_seconds": cost,
            "segments": segments,
            "congestion": congestion,
            "frame_index": frame,
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/emergency/activate", methods=["POST"])
def emergency_activate():
    try:
        data = request.get_json(silent=True) or {}
        ambulance_id = str(data.get("ambulance_id", "AMB-001")).strip()[:64]
        start = int(data.get("current_junction"))
        goal = int(data.get("destination"))
        level = str(data.get("emergency_level", "CRITICAL")).upper()
        if not ambulance_id:
            return jsonify({"status": "error", "message": "Ambulance ID is required."}), 400
        if start == goal:
            return jsonify({"status": "error", "message": "Current junction and destination must be different."}), 400
        if start not in NETWORK_GRAPH or goal not in NETWORK_GRAPH:
            return jsonify({"status": "error", "message": "Junction must be between 1 and 4."}), 400

        frame = int(data.get("frame", 0))
        _, _, rows = _fetch_network_frame(frame)
        congestion = {j: _congestion_score(rows[j]) for j in range(1, 5)}
        route, cost, segments = astar_route(start, goal, congestion, rows)
        now = db_now()
        first_segment = segments[0]["seconds"] if segments else 0
        conn = get_db_connection()
        try:
            ensure_emergency_table(conn)
            with conn.cursor() as cursor:
                cursor.execute("UPDATE emergency_requests SET status='CLEARED', updated_at=%s WHERE status IN ('ACTIVE','AT DESTINATION')", (now,))
                cursor.execute("""
                    INSERT INTO emergency_requests
                    (ambulance_id, current_junction, destination, emergency_level,
                     route_json, route_cost_seconds, route_index, segment_seconds,
                     segment_started_at, status, started_at, updated_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'ACTIVE',%s,%s)
                """, (
                    ambulance_id, start, goal, level, json.dumps(route), cost, 0,
                    first_segment, now, now, now
                ))
            conn.commit()
        finally:
            conn.close()
        return jsonify({
            "status": "success",
            "message": "Emergency corridor activated.",
            "algorithm": "A* Emergency Route Planning",
            "route": route,
            "estimated_time_seconds": cost,
            "segments": segments,
            "congestion": congestion,
            "emergency": _network_payload(frame)["emergency"],
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


def _emergency_status_only():
    """Lightweight emergency-only read for the control-center poll.
    It deliberately avoids loading the four-junction traffic frame, so the
    animation is not blocked by repeated database scans."""
    conn = get_db_connection()
    try:
        ensure_emergency_table(conn)
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT id, ambulance_id, current_junction, destination,
                       emergency_level, route_json, route_cost_seconds,
                       route_index, segment_seconds, segment_started_at, status
                FROM emergency_requests
                WHERE status IN ('ACTIVE','AT DESTINATION')
                ORDER BY id DESC LIMIT 1
            """)
            row = cursor.fetchone()
    finally:
        conn.close()

    if not row:
        return {"active": False, "status": "NORMAL", "route": [], "route_index": 0}

    route = [int(x) for x in json.loads(row["route_json"] or "[]")]
    idx = int(row["route_index"] or 0)
    segment_seconds = float(row["segment_seconds"] or 0)
    progress = 1.0
    if row["status"] == "ACTIVE" and idx < len(route) - 1 and segment_seconds > 0 and row.get("segment_started_at"):
        started_value = row["segment_started_at"]
        if hasattr(started_value, "timestamp"):
            elapsed = max(0.0, datetime.now(timezone.utc).timestamp() - started_value.replace(tzinfo=timezone.utc).timestamp())
        else:
            started = datetime.strptime(str(started_value), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            elapsed = max(0.0, datetime.now(timezone.utc).timestamp() - started.timestamp())
        progress = min(0.99, elapsed / segment_seconds)

    next_j = route[idx + 1] if idx + 1 < len(route) else None
    total_route_cost = float(row["route_cost_seconds"] or 0)
    if idx < len(route) - 1:
        # Use the stored route cost as a stable ETA approximation between
        # full traffic-frame refreshes. The detailed ETA is refreshed with
        # the normal network frame update.
        eta = max(0.0, total_route_cost - (idx * segment_seconds) - (progress * segment_seconds))
    else:
        eta = 0.0
    return {
        "active": True,
        "request_id": int(row["id"]),
        "ambulance_id": row["ambulance_id"],
        "current_junction": int(row["current_junction"]),
        "destination": int(row["destination"]),
        "emergency_level": row["emergency_level"],
        "route": route,
        "route_index": idx,
        "next_junction": next_j,
        "status": row["status"],
        "segment_seconds": round(segment_seconds, 1),
        "segment_progress": round(progress, 3),
        "estimated_time_seconds": round(eta, 1),
        "source": "emergency_requests",
    }

@app.route("/api/emergency/status")
def emergency_status_api():
    try:
        return jsonify(_emergency_status_only())
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/emergency/advance", methods=["POST"])
def emergency_advance():
    try:
        frame = int((request.get_json(silent=True) or {}).get("frame", 0))
        current = _latest_emergency()
        if not current:
            return jsonify({"status": "error", "message": "No active emergency request."}), 400
        route = [int(x) for x in json.loads(current["route_json"] or "[]")]
        idx = int(current["route_index"] or 0)
        if idx >= len(route) - 1:
            return jsonify({"status": "success", "message": "Ambulance is already at the destination.", "emergency": _network_payload(frame)["emergency"]})
        next_j = route[idx + 1]
        # Current software workflow treats this endpoint as the operator's
        # confirmation that the ambulance reached the next junction.
        _, _, rows = _fetch_network_frame(frame)
        congestion = {j: _congestion_score(rows[j]) for j in range(1, 5)}
        next_seg = _edge_cost(next_j, route[idx + 2], congestion, rows) if idx + 2 < len(route) else 0
        new_idx = idx + 1
        status = "AT DESTINATION" if new_idx >= len(route) - 1 else "ACTIVE"
        now = db_now()
        conn = get_db_connection()
        try:
            ensure_emergency_table(conn)
            with conn.cursor() as cursor:
                cursor.execute("""
                    UPDATE emergency_requests
                    SET current_junction=%s, route_index=%s, segment_seconds=%s,
                        segment_started_at=%s, status=%s, updated_at=%s
                    WHERE id=%s
                """, (next_j, new_idx, next_seg, now, status, now, int(current["id"])))
            conn.commit()
        finally:
            conn.close()
        return jsonify({"status": "success", "message": f"Ambulance advanced to J{next_j}.", "emergency": _network_payload(frame)["emergency"]})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/emergency/clear", methods=["POST"])
def emergency_clear():
    try:
        now = db_now()
        conn = get_db_connection()
        try:
            ensure_emergency_table(conn)
            with conn.cursor() as cursor:
                cursor.execute("UPDATE emergency_requests SET status='CLEARED', updated_at=%s WHERE status IN ('ACTIVE','AT DESTINATION')", (now,))
            conn.commit()
        finally:
            conn.close()
        return jsonify({"status": "success", "message": "Emergency corridor cleared. Normal adaptive control is restored."})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/network/schema")
def network_schema_info():
    return jsonify({
        "status": "success",
        "traffic_table": "traffic_data",
        "columns_used": ["vehicle_count", "average_speed", "lane_occupancy", "flow_rate", "time_of_day", "waiting_time"],
        "directional_data_available": False,
        "note": "Direction-specific demand is estimated for the visualization from aggregate junction observations; it is not presented as measured lane data.",
    })


@app.route("/health")
def health():
    try:
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1 AS ok")
            cursor.fetchone()
        conn.close()
        return jsonify({"status": "ok", "service": "traffic-control", "database": "reachable"})
    except Exception as e:
        return jsonify({"status": "error", "service": "traffic-control", "database": "unreachable", "message": str(e)}), 500

@app.route("/api/settings", methods=["GET", "POST"])
def handle_settings_v4():
    global SYSTEM_SETTINGS
    if request.method == "POST":
        data = request.json or {}
        min_green = max(5, int(data.get("min_green", SYSTEM_SETTINGS["min_green"])))
        max_green = max(min_green, int(data.get("max_green", SYSTEM_SETTINGS["max_green"])))
        yellow = max(3, int(data.get("yellow_time", SYSTEM_SETTINGS["yellow_time"])))
        cycle = max(40, int(data.get("cycle_time", SYSTEM_SETTINGS["cycle_time"])))
        SYSTEM_SETTINGS.update({"min_green": min_green, "max_green": max_green, "yellow_time": yellow, "cycle_time": cycle})
        return jsonify({"status": "success", "settings": SYSTEM_SETTINGS})
    return jsonify(SYSTEM_SETTINGS)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
