from flask import Flask, render_template, jsonify, request
from datetime import datetime
import math

app = Flask(__name__)

# ============================================================
# SAMPLE TRAFFIC DATA
# Later this will come from Aiven MySQL
# ============================================================

traffic_data = [
    {
        "id": 1,
        "name": "Junction 1",
        "north": 45,
        "south": 32,
        "east": 18,
        "west": 20,
        "density": 0.78,
        "status": "HIGH"
    },
    {
        "id": 2,
        "name": "Junction 2",
        "north": 28,
        "south": 25,
        "east": 30,
        "west": 22,
        "density": 0.65,
        "status": "MEDIUM"
    },
    {
        "id": 3,
        "name": "Junction 3",
        "north": 15,
        "south": 10,
        "east": 12,
        "west": 8,
        "density": 0.35,
        "status": "LOW"
    },
    {
        "id": 4,
        "name": "Junction 4",
        "north": 35,
        "south": 28,
        "east": 20,
        "west": 18,
        "density": 0.60,
        "status": "MEDIUM"
    }
]


# ============================================================
# HOME
# ============================================================

@app.route("/")
def home():
    return render_template("index.html")


# ============================================================
# GET TRAFFIC DATA
# ============================================================

@app.route("/api/traffic")
def get_traffic():
    return jsonify(traffic_data)


# ============================================================
# A* SEARCH
# ============================================================

def heuristic(vehicle_count, green_time):
    """
    Estimates how far the current green time is
    from the ideal green time.
    """

    ideal_time = 10 + (vehicle_count * 0.75)

    return abs(ideal_time - green_time)


def astar_signal_optimization(vehicle_count):
    """
    Simple A* based search for optimal green signal time.

    State = possible green time
    Cost  = waiting/congestion cost
    """

    possible_times = list(range(10, 61, 5))

    start_time = 30

    open_set = []
    visited = set()

    open_set.append({
        "time": start_time,
        "g": 0,
        "f": heuristic(vehicle_count, start_time)
    })

    best_time = start_time
    best_score = float("inf")

    while open_set:

        open_set.sort(key=lambda x: x["f"])

        current = open_set.pop(0)

        current_time = current["time"]

        if current_time in visited:
            continue

        visited.add(current_time)

        # Cost function
        waiting_cost = max(
            0,
            vehicle_count * 2 - current_time
        )

        congestion_cost = (
            vehicle_count /
            max(current_time, 1)
        ) * 10

        total_cost = (
            waiting_cost +
            congestion_cost +
            current["g"]
        )

        if total_cost < best_score:
            best_score = total_cost
            best_time = current_time

        # Explore neighboring signal times
        for next_time in possible_times:

            if next_time in visited:
                continue

            step_cost = abs(next_time - current_time)

            g = current["g"] + step_cost

            h = heuristic(vehicle_count, next_time)

            f = g + h

            open_set.append({
                "time": next_time,
                "g": g,
                "f": f
            })

    return best_time


# ============================================================
# CONSTRAINT BASED OPTIMIZATION
# ============================================================

def apply_constraints(timings):

    MIN_GREEN = 10
    MAX_GREEN = 60
    YELLOW_TIME = 5
    TOTAL_CYCLE = 120

    # Minimum and maximum constraints
    for direction in timings:

        timings[direction] = max(
            MIN_GREEN,
            min(MAX_GREEN, timings[direction])
        )

    # Total green time
    total_green = sum(timings.values())

    # Available green time
    available_green = TOTAL_CYCLE - (
        4 * YELLOW_TIME
    )

    if total_green > available_green:

        scale = available_green / total_green

        for direction in timings:

            timings[direction] = round(
                timings[direction] * scale
            )

            timings[direction] = max(
                MIN_GREEN,
                timings[direction]
            )

    return timings


# ============================================================
# OPTIMIZATION API
# ============================================================

@app.route("/api/optimize", methods=["POST"])
def optimize():

    data = request.get_json()

    junction_id = int(
        data.get("junction_id", 1)
    )

    junction = next(
        (
            item for item in traffic_data
            if item["id"] == junction_id
        ),
        traffic_data[0]
    )

    # A* search
    timings = {

        "north": astar_signal_optimization(
            junction["north"]
        ),

        "south": astar_signal_optimization(
            junction["south"]
        ),

        "east": astar_signal_optimization(
            junction["east"]
        ),

        "west": astar_signal_optimization(
            junction["west"]
        )
    }

    # Constraint optimization
    timings = apply_constraints(timings)

    total_green = sum(timings.values())

    total_cycle = total_green + 20

    # Estimate improvement
    vehicle_total = (
        junction["north"]
        + junction["south"]
        + junction["east"]
        + junction["west"]
    )

    before_wait = vehicle_total * 2.5

    after_wait = max(
        before_wait * 0.78,
        10
    )

    improvement = (
        (before_wait - after_wait)
        / before_wait
    ) * 100

    result = {

        "junction": junction["name"],

        "timings": timings,

        "yellow": 5,

        "cycle": total_cycle,

        "algorithm": "A* Search + CSP",

        "before_waiting": round(
            before_wait,
            1
        ),

        "after_waiting": round(
            after_wait,
            1
        ),

        "improvement": round(
            improvement,
            1
        ),

        "timestamp":
            datetime.now().strftime(
                "%H:%M:%S"
            )
    }

    return jsonify(result)


# ============================================================
# STATISTICS
# ============================================================

@app.route("/api/statistics")
def statistics():

    total_vehicles = sum(
        item["north"]
        + item["south"]
        + item["east"]
        + item["west"]
        for item in traffic_data
    )

    average_density = sum(
        item["density"]
        for item in traffic_data
    ) / len(traffic_data)

    average_waiting = 48.6

    high_count = sum(
        1
        for item in traffic_data
        if item["status"] == "HIGH"
    )

    return jsonify({

        "intersections":
            len(traffic_data),

        "vehicles":
            total_vehicles,

        "waiting":
            average_waiting,

        "density":
            round(average_density, 2),

        "high":
            high_count
    })


# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=False
    )
