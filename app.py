from flask import Flask, jsonify, render_template
import pymysql
import os

app = Flask(__name__)

# ==========================================
# AIVEN MYSQL CONFIGURATION
# ==========================================

DB_HOST = "mysql-1153c1de-tatikondaloknath-205b.d.aivencloud.com"
DB_PORT = 26298
DB_USER = "avnadmin"
DB_PASSWORD = "AVNS_xWYifAAJBCzufPNZN8z"
DB_NAME = "defaultdb"
CA_FILE = "ca.pem"


# ==========================================
# DATABASE CONNECTION
# ==========================================

def get_connection():

    connection = pymysql.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME,
        ssl={
            "ca": CA_FILE
        },
        cursorclass=pymysql.cursors.DictCursor
    )

    return connection


# ==========================================
# HOME PAGE
# ==========================================

@app.route("/")
def home():

    return render_template("dashboard.html")


# ==========================================
# TEST DATABASE
# ==========================================

@app.route("/api/test-db")
def test_database():

    try:

        connection = get_connection()

        cursor = connection.cursor()

        cursor.execute("SELECT COUNT(*) AS total FROM traffic_data")

        result = cursor.fetchone()

        cursor.close()
        connection.close()

        return jsonify({
            "status": "success",
            "message": "Connected to Aiven MySQL",
            "total_records": result["total"]
        })

    except Exception as e:

        return jsonify({
            "status": "error",
            "message": str(e)
        })


# ==========================================
# TRAFFIC DATA
# ==========================================

@app.route("/api/traffic-data")
def traffic_data():

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

        cursor.close()
        connection.close()

        return jsonify(data)

    except Exception as e:

        return jsonify({
            "status": "error",
            "message": str(e)
        })


# ==========================================
# DASHBOARD SUMMARY
# ==========================================

@app.route("/api/dashboard")
def dashboard():

    try:

        connection = get_connection()

        cursor = connection.cursor()

        # Total vehicles
        cursor.execute("""
            SELECT SUM(vehicle_count) AS total_vehicles
            FROM traffic_data
        """)

        total_vehicles = cursor.fetchone()["total_vehicles"]


        # Average waiting time
        cursor.execute("""
            SELECT AVG(waiting_time) AS avg_waiting_time
            FROM traffic_data
        """)

        avg_waiting = cursor.fetchone()["avg_waiting_time"]


        # Average speed
        cursor.execute("""
            SELECT AVG(average_speed) AS avg_speed
            FROM traffic_data
        """)

        avg_speed = cursor.fetchone()["avg_speed"]


        # Average lane occupancy
        cursor.execute("""
            SELECT AVG(lane_occupancy) AS avg_occupancy
            FROM traffic_data
        """)

        avg_occupancy = cursor.fetchone()["avg_occupancy"]


        cursor.close()
        connection.close()


        # Traffic status
        if avg_waiting is None:

            status = "UNKNOWN"

        elif avg_waiting < 20:

            status = "LOW"

        elif avg_waiting < 40:

            status = "MEDIUM"

        else:

            status = "HIGH"


        return jsonify({

            "total_vehicles": round(total_vehicles or 0),

            "average_waiting_time":
                round(avg_waiting or 0, 2),

            "average_speed":
                round(avg_speed or 0, 2),

            "average_occupancy":
                round(avg_occupancy or 0, 2),

            "traffic_status": status,

            "total_records": 10000

        })


    except Exception as e:

        return jsonify({

            "status": "error",

            "message": str(e)

        })


# ==========================================
# RUN APPLICATION
# ==========================================

if __name__ == "__main__":

    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000)),
        debug=True
    )
