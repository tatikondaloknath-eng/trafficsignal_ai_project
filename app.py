from flask import Flask, jsonify, render_template
import pymysql
import os

app = Flask(__name__)


# ============================================================
# AIVEN MYSQL CONFIGURATION
# ============================================================

DB_HOST = os.getenv("DB_HOST")
DB_PORT = int(os.getenv("DB_PORT", "26298"))
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_NAME = os.getenv("DB_NAME", "defaultdb")


# ============================================================
# CHECK ENVIRONMENT VARIABLES
# ============================================================

def check_database_config():

    missing = []

    if not DB_HOST:
        missing.append("DB_HOST")

    if not DB_USER:
        missing.append("DB_USER")

    if not DB_PASSWORD:
        missing.append("DB_PASSWORD")

    if not DB_NAME:
        missing.append("DB_NAME")

    if missing:
        raise RuntimeError(
            "Missing Render environment variables: "
            + ", ".join(missing)
        )


# ============================================================
# DATABASE CONNECTION
# ============================================================

def get_connection():

    check_database_config()

    # --------------------------------------------------------
    # Try Aiven SSL connection.
    #
    # If ca.pem exists in the project, it will be used.
    # Otherwise encrypted SSL is used without certificate
    # verification.
    # --------------------------------------------------------

    ca_file = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "ca.pem"
    )

    if os.path.exists(ca_file):

        connection = pymysql.connect(
            host=DB_HOST,
            port=DB_PORT,
            user=DB_USER,
            password=DB_PASSWORD,
            database=DB_NAME,

            ssl={
                "ca": ca_file
            },

            cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=15
        )

    else:

        connection = pymysql.connect(
            host=DB_HOST,
            port=DB_PORT,
            user=DB_USER,
            password=DB_PASSWORD,
            database=DB_NAME,

            # Aiven requires encrypted MySQL connection.
            ssl={
                "check_hostname": False
            },

            cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=15
        )

    return connection


# ============================================================
# HOME PAGE
# ============================================================

@app.route("/")
def home():

    return render_template("dashboard.html")


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

        # Test database connection
        cursor.execute("SELECT 1 AS test")

        result = cursor.fetchone()

        # Count traffic records
        cursor.execute(
            "SELECT COUNT(*) AS total FROM traffic_data"
        )

        total = cursor.fetchone()["total"]

        return jsonify({
            "status": "success",
            "message": "Connected to Aiven MySQL successfully",
            "database": DB_NAME,
            "test": result["test"],
            "total_records": total
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
        # TOTAL VEHICLES
        # ----------------------------------------------------

        cursor.execute("""
            SELECT
                COALESCE(SUM(vehicle_count), 0)
                AS total_vehicles
            FROM traffic_data
        """)

        total_vehicles = cursor.fetchone()["total_vehicles"]


        # ----------------------------------------------------
        # AVERAGE WAITING TIME
        # ----------------------------------------------------

        cursor.execute("""
            SELECT
                AVG(waiting_time) AS avg_waiting_time
            FROM traffic_data
        """)

        avg_waiting = cursor.fetchone()["avg_waiting_time"]


        # ----------------------------------------------------
        # AVERAGE SPEED
        # ----------------------------------------------------

        cursor.execute("""
            SELECT
                AVG(average_speed) AS avg_speed
            FROM traffic_data
        """)

        avg_speed = cursor.fetchone()["avg_speed"]


        # ----------------------------------------------------
        # AVERAGE LANE OCCUPANCY
        # ----------------------------------------------------

        cursor.execute("""
            SELECT
                AVG(lane_occupancy) AS avg_occupancy
            FROM traffic_data
        """)

        avg_occupancy = cursor.fetchone()["avg_occupancy"]


        # ----------------------------------------------------
        # TOTAL RECORDS
        # ----------------------------------------------------

        cursor.execute("""
            SELECT COUNT(*) AS total_records
            FROM traffic_data
        """)

        total_records = cursor.fetchone()["total_records"]


        # ----------------------------------------------------
        # TRAFFIC STATUS
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
        # RETURN DASHBOARD DATA
        # ----------------------------------------------------

        return jsonify({

            "status": "success",

            "total_vehicles":
                round(total_vehicles or 0),

            "average_waiting_time":
                round(avg_waiting or 0, 2),

            "average_speed":
                round(avg_speed or 0, 2),

            "average_occupancy":
                round(avg_occupancy or 0, 2),

            "traffic_status":
                status,

            "total_records":
                total_records
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
# HEALTH CHECK
# ============================================================

@app.route("/health")
def health():

    return jsonify({

        "status": "healthy",

        "application":
            "Smart Traffic Management",

        "database_host":
            DB_HOST if DB_HOST else "NOT CONFIGURED"

    })


# ============================================================
# RUN APPLICATION
# ============================================================

if __name__ == "__main__":

    port = int(os.environ.get("PORT", 5000))

    app.run(
        host="0.0.0.0",
        port=port,
        debug=False
    )
