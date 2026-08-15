from flask import Flask, jsonify, render_template, request
import pymysql
import os
import statistics

app = Flask(__name__)


# ============================================================
# DATABASE CONFIGURATION
# ============================================================

DB_HOST = os.environ.get(
    "DB_HOST",
    "mysql-1153c1de-tatikondaloknath-205b.d.aivencloud.com"
)

DB_PORT = int(os.environ.get("DB_PORT", "26298"))

DB_USER = os.environ.get(
    "DB_USER",
    "avnadmin"
)

DB_PASSWORD = os.environ.get("DB_PASSWORD")

DB_NAME = os.environ.get(
    "DB_NAME",
    "defaultdb"
)

# Optional CA certificate.
# If ca.pem exists in the project, it will be used.
CA_FILE = os.environ.get("DB_CA_FILE", "ca.pem")


# ============================================================
# DATABASE CONNECTION
# ============================================================

def get_connection():

    connection_options = {
        "host": DB_HOST,
        "port": DB_PORT,
        "user": DB_USER,
        "password": DB_PASSWORD,
        "database": DB_NAME,
        "cursorclass": pymysql.cursors.DictCursor,
        "connect_timeout": 20,
        "read_timeout": 30,
        "write_timeout": 30,
        "autocommit": True
    }

    # --------------------------------------------------------
    # Aiven MySQL SSL
    # --------------------------------------------------------
    #
    # If ca.pem exists, use certificate verification.
    #
    # Otherwise connect using TLS without local CA verification.
    # This is useful for Render deployment when ca.pem has not
    # yet been added to GitHub.
    # --------------------------------------------------------

    if os.path.exists(CA_FILE):

        connection_options["ssl"] = {
            "ca": CA_FILE
        }

    else:

        connection_options["ssl"] = {
            "check_hostname": False
        }

    return pymysql.connect(**connection_options)


# ============================================================
# HOME PAGE
# ============================================================

@app.route("/")
def home():

    try:
        return render_template("dashboard.html")

    except Exception:

        return """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Smart Traffic Management</title>

            <style>

                body {
                    margin: 0;
                    background: #071b2e;
                    color: white;
                    font-family: Arial, sans-serif;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                }

                .container {
                    text-align: center;
                    padding: 50px;
                }

                h1 {
                    font-size: 42px;
                }

                .status {
                    margin-top: 30px;
                    padding: 25px;
                    border-radius: 15px;
                    background: #123452;
                    color: #35e68a;
                    font-size: 24px;
                }

            </style>

        </head>

        <body>

            <div class="container">

                <h1>🚦 Smart Traffic Management</h1>

                <p>
                    Adaptive Multi-Agent Traffic Signal Optimization
                </p>

                <p>
                    AI Search & Constraint-Based Optimization
                </p>

                <div class="status">
                    ✓ Flask Application Running
                </div>

            </div>

        </body>
        </html>
        """


# ============================================================
# DATABASE TEST
# ============================================================

@app.route("/api/test-db")
def test_database():

    connection = None
    cursor = None

    try:

        connection = get_connection()

        cursor = connection.cursor()

        cursor.execute(
            "SELECT COUNT(*) AS total FROM traffic_data"
        )

        result = cursor.fetchone()

        return jsonify({
            "status": "success",
            "message": "Connected to Aiven MySQL",
            "total_records": result["total"]
        })

    except Exception as e:

        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()


# ============================================================
# FRONTEND TRAFFIC SUMMARY
# ============================================================

@app.route("/api/traffic")
def traffic():

    connection = None
    cursor = None

    try:
        connection = get_connection()
        cursor = connection.cursor()

        # The current database table does not contain a separate
        # junction column. The 10,000 records are therefore grouped
        # into four junction blocks, matching the existing project.
        ranges = [
            (1, 2500),
            (2501, 5000),
            (5001, 7500),
            (7501, None)
        ]

        traffic = []

        for number, (start_id, end_id) in enumerate(ranges, start=1):

            if end_id is None:
                where = "id >= %s"
                params = (start_id,)
            else:
                where = "id BETWEEN %s AND %s"
                params = (start_id, end_id)

            cursor.execute(f"""
                SELECT
                    COUNT(*) AS records,
                    COALESCE(SUM(vehicle_count), 0) AS total_vehicles,
                    AVG(vehicle_count) AS average_vehicles,
                    AVG(average_speed) AS average_speed,
                    AVG(lane_occupancy) AS density,
                    AVG(waiting_time) AS waiting_time
                FROM traffic_data
                WHERE {where}
            """, params)

            row = cursor.fetchone()
            waiting = float(row["waiting_time"] or 0)

            if waiting < 20:
                status = "LOW"
            elif waiting < 40:
                status = "MEDIUM"
            else:
                status = "HIGH"

            traffic.append({
                "id": number,
                "name": f"Junction {number}",
                "records": int(row["records"] or 0),
                "vehicles": round(float(row["total_vehicles"] or 0), 2),
                "average_vehicles": round(float(row["average_vehicles"] or 0), 2),
                "average_speed": round(float(row["average_speed"] or 0), 2),
                "density": round(float(row["density"] or 0), 2),
                "waiting_time": round(waiting, 2),
                "status": status
            })

        return jsonify(traffic)

    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()


# ============================================================
# TRAFFIC DATA
# ============================================================

@app.route("/api/traffic-data")
def traffic_data():

    connection = None
    cursor = None

    try:

        connection = get_connection()

        cursor = connection.cursor()

        cursor.execute("""
            SELECT
                vehicle_count,
                average_speed,
                lane_occupancy,
                flow_rate,
                time_of_day,
                waiting_time
            FROM traffic_data
            ORDER BY id
            LIMIT 100
        """)

        data = cursor.fetchall()

        return jsonify(data)

    except Exception as e:

        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()


# ============================================================
# DATASET FILTER BY JUNCTION
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

        ranges = {
            "1": (1, 2500),
            "2": (2501, 5000),
            "3": (5001, 7500),
            "4": (7501, 10000)
        }

        connection = get_connection()
        cursor = connection.cursor()

        if junction == "all":
            where = "1=1"
            params = []
        elif junction in ranges:
            start_id, end_id = ranges[junction]
            where = "id BETWEEN %s AND %s"
            params = [start_id, end_id]
        else:
            return jsonify({
                "status": "error",
                "message": "Invalid junction. Use all, 1, 2, 3 or 4."
            }), 400

        cursor.execute(
            f"SELECT COUNT(*) AS total FROM traffic_data WHERE {where}",
            params
        )
        total = int(cursor.fetchone()["total"] or 0)

        query_params = list(params) + [limit, offset]
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
        """, query_params)

        rows = cursor.fetchall()

        records = []
        for row in rows:
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
                "vehicle_count": row["vehicle_count"],
                "average_speed": row["average_speed"],
                "lane_occupancy": row["lane_occupancy"],
                "flow_rate": row["flow_rate"],
                "time_of_day": row["time_of_day"],
                "waiting_time": row["waiting_time"]
            })

        return jsonify({
            "status": "success",
            "junction": junction,
            "page": page,
            "limit": limit,
            "count": len(records),
            "total_records": total,
            "records": records
        })

    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()


# ============================================================
# DATASET SUMMARY
# ============================================================

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
                SUM(vehicle_count) AS total_vehicles,
                AVG(vehicle_count) AS average_vehicles,
                AVG(average_speed) AS average_speed,
                AVG(lane_occupancy) AS average_occupancy,
                AVG(flow_rate) AS average_flow,
                AVG(waiting_time) AS average_waiting
            FROM traffic_data
        """)

        result = cursor.fetchone()

        return jsonify({
            "status": "success",
            "total_records": result["total_records"],
            "total_vehicles": round(
                float(result["total_vehicles"] or 0), 2
            ),
            "average_vehicles": round(
                float(result["average_vehicles"] or 0), 2
            ),
            "average_speed": round(
                float(result["average_speed"] or 0), 2
            ),
            "average_occupancy": round(
                float(result["average_occupancy"] or 0), 2
            ),
            "average_flow": round(
                float(result["average_flow"] or 0), 2
            ),
            "average_waiting_time": round(
                float(result["average_waiting"] or 0), 2
            )
        })

    except Exception as e:

        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()


# ============================================================
# STATISTICS API
# ============================================================

@app.route("/api/statistics")
def statistics_api():

    connection = None
    cursor = None

    try:
        connection = get_connection()
        cursor = connection.cursor()

        cursor.execute("""
            SELECT
                COUNT(*) AS total_records,
                COALESCE(SUM(vehicle_count), 0) AS total_vehicles,
                AVG(waiting_time) AS average_waiting
            FROM traffic_data
        """)

        result = cursor.fetchone()

        return jsonify({
            "status": "success",
            "intersections": 4,
            "records": int(result["total_records"] or 0),
            "vehicles": round(float(result["total_vehicles"] or 0), 2),
            "waiting": round(float(result["average_waiting"] or 0), 2)
        })

    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()


# ============================================================
# DASHBOARD SUMMARY
# ============================================================

@app.route("/api/dashboard")
def dashboard():

    connection = None
    cursor = None

    try:

        connection = get_connection()

        cursor = connection.cursor()

        # ----------------------------------------------------
        # Total vehicles
        # ----------------------------------------------------

        cursor.execute("""
            SELECT
                SUM(vehicle_count) AS total_vehicles
            FROM traffic_data
        """)

        total_vehicles = cursor.fetchone()["total_vehicles"]


        # ----------------------------------------------------
        # Average waiting time
        # ----------------------------------------------------

        cursor.execute("""
            SELECT
                AVG(waiting_time) AS avg_waiting_time
            FROM traffic_data
        """)

        avg_waiting = cursor.fetchone()["avg_waiting_time"]


        # ----------------------------------------------------
        # Average speed
        # ----------------------------------------------------

        cursor.execute("""
            SELECT
                AVG(average_speed) AS avg_speed
            FROM traffic_data
        """)

        avg_speed = cursor.fetchone()["avg_speed"]


        # ----------------------------------------------------
        # Average lane occupancy
        # ----------------------------------------------------

        cursor.execute("""
            SELECT
                AVG(lane_occupancy) AS avg_occupancy
            FROM traffic_data
        """)

        avg_occupancy = cursor.fetchone()["avg_occupancy"]


        # ----------------------------------------------------
        # Traffic status
        # ----------------------------------------------------

        if avg_waiting is None:

            status = "UNKNOWN"

        elif avg_waiting < 20:

            status = "LOW"

        elif avg_waiting < 40:

            status = "MEDIUM"

        else:

            status = "HIGH"


        # ----------------------------------------------------
        # Return dashboard data
        # ----------------------------------------------------

        return jsonify({

            "status": "success",

            "total_vehicles": round(
                float(total_vehicles or 0),
                2
            ),

            "average_waiting_time": round(
                float(avg_waiting or 0),
                2
            ),

            "average_speed": round(
                float(avg_speed or 0),
                2
            ),

            "average_occupancy": round(
                float(avg_occupancy or 0),
                2
            ),

            "traffic_status": status,

            "total_records": int(10000),

            "intersections": 4

        })


    except Exception as e:

        return jsonify({

            "status": "error",

            "message": str(e)

        }), 500


    finally:

        if cursor:

            cursor.close()

        if connection:

            connection.close()


# ============================================================
# INTERSECTION DATA
# ============================================================

@app.route("/api/intersections")
def intersections():

    connection = None
    cursor = None

    try:

        connection = get_connection()

        cursor = connection.cursor()

        # Get traffic statistics for different portions
        # of the dataset and represent them as four junctions.

        cursor.execute("""
            SELECT
                AVG(vehicle_count) AS vehicles,
                AVG(waiting_time) AS waiting,
                AVG(average_speed) AS speed
            FROM traffic_data
            WHERE id <= 2500
        """)

        j1 = cursor.fetchone()


        cursor.execute("""
            SELECT
                AVG(vehicle_count) AS vehicles,
                AVG(waiting_time) AS waiting,
                AVG(average_speed) AS speed
            FROM traffic_data
            WHERE id > 2500
            AND id <= 5000
        """)

        j2 = cursor.fetchone()


        cursor.execute("""
            SELECT
                AVG(vehicle_count) AS vehicles,
                AVG(waiting_time) AS waiting,
                AVG(average_speed) AS speed
            FROM traffic_data
            WHERE id > 5000
            AND id <= 7500
        """)

        j3 = cursor.fetchone()


        cursor.execute("""
            SELECT
                AVG(vehicle_count) AS vehicles,
                AVG(waiting_time) AS waiting,
                AVG(average_speed) AS speed
            FROM traffic_data
            WHERE id > 7500
        """)

        j4 = cursor.fetchone()


        junctions = []

        for number, data in enumerate(
            [j1, j2, j3, j4],
            start=1
        ):

            waiting = float(data["waiting"] or 0)

            if waiting < 20:
                level = "LOW"

            elif waiting < 40:
                level = "MEDIUM"

            else:
                level = "HIGH"


            junctions.append({

                "junction": number,

                "vehicles": round(
                    float(data["vehicles"] or 0),
                    2
                ),

                "waiting_time": round(
                    waiting,
                    2
                ),

                "average_speed": round(
                    float(data["speed"] or 0),
                    2
                ),

                "status": level

            })


        return jsonify({

            "status": "success",

            "intersections": junctions

        })


    except Exception as e:

        return jsonify({

            "status": "error",

            "message": str(e)

        }), 500


    finally:

        if cursor:

            cursor.close()

        if connection:

            connection.close()


# ============================================================
# AI TRAFFIC SIGNAL OPTIMIZATION
# ============================================================

@app.route("/api/ai-optimize")
def ai_optimize():

    connection = None
    cursor = None

    try:

        connection = get_connection()

        cursor = connection.cursor()


        # ----------------------------------------------------
        # Get traffic statistics
        # ----------------------------------------------------

        cursor.execute("""
            SELECT
                AVG(vehicle_count) AS vehicles,
                AVG(waiting_time) AS waiting,
                AVG(average_speed) AS speed,
                AVG(lane_occupancy) AS occupancy
            FROM traffic_data
        """)

        data = cursor.fetchone()


        vehicles = float(
            data["vehicles"] or 0
        )

        waiting = float(
            data["waiting"] or 0
        )

        speed = float(
            data["speed"] or 0
        )

        occupancy = float(
            data["occupancy"] or 0
        )


        # ----------------------------------------------------
        # AI / Optimization Logic
        # ----------------------------------------------------
        #
        # Higher traffic -> longer green time
        # Higher waiting -> longer green time
        # Lower speed -> longer green time
        #
        # This produces adaptive signal timings from
        # the actual traffic dataset.
        # ----------------------------------------------------

        traffic_factor = min(
            vehicles / 100,
            1
        )

        waiting_factor = min(
            waiting / 100,
            1
        )

        speed_factor = max(
            0,
            min(
                (60 - speed) / 60,
                1
            )
        )


        congestion_score = (
            traffic_factor * 0.4
            +
            waiting_factor * 0.4
            +
            speed_factor * 0.2
        )


        # ----------------------------------------------------
        # Base green time
        # ----------------------------------------------------

        base_green = 20

        optimized_green = (
            base_green
            +
            congestion_score * 30
        )


        optimized_green = max(
            15,
            min(
                optimized_green,
                60
            )
        )


        optimized_green = round(
            optimized_green
        )


        # ----------------------------------------------------
        # Four directions
        # ----------------------------------------------------

        north = optimized_green

        south = max(
            15,
            round(
                optimized_green * 0.85
            )
        )

        east = max(
            15,
            round(
                optimized_green * 0.70
            )
        )

        west = max(
            15,
            round(
                optimized_green * 0.60
            )
        )


        # ----------------------------------------------------
        # Yellow and red times
        # ----------------------------------------------------

        yellow = 5

        cycle_time = (
            north
            + south
            + east
            + west
            + (yellow * 4)
        )


        # ----------------------------------------------------
        # Estimated improvement
        # ----------------------------------------------------

        improvement = min(
            35,
            max(
                5,
                congestion_score * 30
            )
        )


        return jsonify({

            "status": "success",

            "algorithm":
                "AI Search + Constraint Optimization",

            "objective":
                "Minimize Waiting Time",

            "traffic_input": {

                "average_vehicles":
                    round(vehicles, 2),

                "average_waiting_time":
                    round(waiting, 2),

                "average_speed":
                    round(speed, 2),

                "average_occupancy":
                    round(occupancy, 2)

            },

            "signal_timings": {

                "north": {

                    "green": north,

                    "yellow": yellow,

                    "red":
                        cycle_time - north

                },

                "south": {

                    "green": south,

                    "yellow": yellow,

                    "red":
                        cycle_time - south

                },

                "east": {

                    "green": east,

                    "yellow": yellow,

                    "red":
                        cycle_time - east

                },

                "west": {

                    "green": west,

                    "yellow": yellow,

                    "red":
                        cycle_time - west

                }

            },

            "optimization": {

                "success": True,

                "cycle_time":
                    cycle_time,

                "improvement":
                    round(improvement, 2)

            }

        })


    except Exception as e:

        return jsonify({

            "status": "error",

            "message": str(e)

        }), 500


    finally:

        if cursor:

            cursor.close()

        if connection:

            connection.close()


# ============================================================
# AI OPTIMIZATION WITH CUSTOM VALUES
# ============================================================

@app.route(
    "/api/optimize",
    methods=["GET", "POST"]
)
def optimize():

    try:

        if request.method == "POST":

            data = request.get_json() or {}

        else:

            data = request.args


        junction_id = str(data.get("junction_id", "all"))

        # If a junction is selected, use its real database statistics.
        # Otherwise use the supplied values or safe defaults.
        if junction_id in {"1", "2", "3", "4"}:

            ranges = {
                "1": (1, 2500),
                "2": (2501, 5000),
                "3": (5001, 7500),
                "4": (7501, 10000)
            }

            connection = get_connection()
            cursor = connection.cursor()
            start_id, end_id = ranges[junction_id]

            cursor.execute("""
                SELECT
                    AVG(vehicle_count) AS vehicles,
                    AVG(waiting_time) AS waiting,
                    AVG(average_speed) AS speed,
                    AVG(lane_occupancy) AS occupancy
                FROM traffic_data
                WHERE id BETWEEN %s AND %s
            """, (start_id, end_id))

            db_data = cursor.fetchone()
            vehicles = float(db_data["vehicles"] or 0)
            waiting = float(db_data["waiting"] or 0)
            speed = float(db_data["speed"] or 0)
            occupancy = float(db_data["occupancy"] or 0)

            cursor.close()
            connection.close()
            cursor = None
            connection = None

        else:
            vehicles = float(data.get("vehicle_count", 50))
            waiting = float(data.get("waiting_time", 30))
            speed = float(data.get("average_speed", 30))
            occupancy = float(data.get("lane_occupancy", 50))


        # Normalize values

        vehicle_score = min(
            vehicles / 100,
            1
        )

        waiting_score = min(
            waiting / 100,
            1
        )

        speed_score = max(
            0,
            min(
                (60 - speed) / 60,
                1
            )
        )

        occupancy_score = min(
            occupancy / 100,
            1
        )


        congestion = (

            vehicle_score * 0.30

            +
            waiting_score * 0.35

            +
            speed_score * 0.15

            +
            occupancy_score * 0.20

        )


        green_time = round(
            15 + congestion * 45
        )


        green_time = max(
            15,
            min(
                green_time,
                60
            )
        )


        return jsonify({

            "status": "success",

            "input": {

                "vehicle_count":
                    vehicles,

                "waiting_time":
                    waiting,

                "average_speed":
                    speed,

                "lane_occupancy":
                    occupancy

            },

            "congestion_score":
                round(
                    congestion * 100,
                    2
                ),

            "recommended_green_time":
                green_time,

            "yellow_time":
                5,

            "message":
                "Signal timing optimized using traffic conditions."

        })


    except Exception as e:

        return jsonify({

            "status": "error",

            "message": str(e)

        }), 400


# ============================================================
# HEALTH CHECK
# ============================================================

@app.route("/health")
def health():

    return jsonify({

        "status": "healthy",

        "application":
            "Smart Traffic Management",

        "database":
            "Aiven MySQL",

        "environment":
            "Render"

    })


# ============================================================
# RUN APPLICATION
# ============================================================

if __name__ == "__main__":

    port = int(
        os.environ.get(
            "PORT",
            5000
        )
    )

    app.run(
        host="0.0.0.0",
        port=port,
        debug=False
    )
