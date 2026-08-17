import os
import pandas as pd
import pymysql

DB_HOST = os.environ.get("DB_HOST", "YOUR_AIVEN_HOST")
DB_PORT = int(os.environ.get("DB_PORT", 26298))
DB_USER = os.environ.get("DB_USER", "avnadmin")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "YOUR_PASSWORD")
DB_NAME = os.environ.get("DB_NAME", "defaultdb")
DB_CA_FILE = os.environ.get("DB_CA_FILE", "ca.pem")

CSV_FILE = "traffic_dataset.csv"

def upload():
    if not os.path.exists(CSV_FILE):
        print(f"Error: {CSV_FILE} not found.")
        return

    print("Reading dataset...")
    df = pd.read_csv(CSV_FILE)
    if "Unnamed: 0" in df.columns:
        df = df.drop(columns=["Unnamed: 0"])

    ssl_config = {"ca": DB_CA_FILE} if os.path.exists(DB_CA_FILE) else None

    conn = pymysql.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME,
        charset="utf8mb4",
        ssl=ssl_config
    )

    with conn.cursor() as cursor:
        print("Creating table schema...")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS traffic_data (
                id INT AUTO_INCREMENT PRIMARY KEY,
                vehicle_count INT,
                average_speed FLOAT,
                lane_occupancy FLOAT,
                flow_rate FLOAT,
                time_of_day VARCHAR(30),
                waiting_time FLOAT
            );
        """)
        cursor.execute("TRUNCATE TABLE traffic_data;")

        print(f"Inserting {len(df)} records into Aiven MySQL...")
        sql = """
            INSERT INTO traffic_data 
            (vehicle_count, average_speed, lane_occupancy, flow_rate, time_of_day, waiting_time) 
            VALUES (%s, %s, %s, %s, %s, %s)
        """
        records = [tuple(x) for x in df[['vehicle_count', 'average_speed', 'lane_occupancy', 'flow_rate', 'time_of_day', 'waiting_time']].to_numpy()]
        cursor.executemany(sql, records)
        conn.commit()

        cursor.execute("SELECT COUNT(*) FROM traffic_data;")
        count = cursor.fetchone()[0]
        print(f"Upload complete. Verified records in database: {count}")

    conn.close()

if __name__ == "__main__":
    upload()
