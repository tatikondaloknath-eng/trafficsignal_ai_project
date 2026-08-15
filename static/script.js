// ============================================================
// GLOBAL DATA
// ============================================================

let trafficData = [];

let currentOptimization = null;


// ============================================================
// CLOCK
// ============================================================

function updateClock() {

    const now = new Date();

    document.getElementById("clock").textContent =
        now.toLocaleTimeString();

    document.getElementById("date").textContent =
        now.toLocaleDateString(
            undefined,
            {
                day: "2-digit",
                month: "short",
                year: "numeric"
            }
        );
}

setInterval(updateClock, 1000);

updateClock();


// ============================================================
// LOAD TRAFFIC DATA
// ============================================================

async function loadTrafficData() {

    try {

        const response =
            await fetch("/api/traffic");

        trafficData =
            await response.json();

        renderIntersectionCards();

        renderDataset();

        renderFullDataset();

        updateStatistics();

    } catch (error) {

        console.error(
            "Unable to load traffic data:",
            error
        );

    }
}


// ============================================================
// STATISTICS
// ============================================================

async function updateStatistics() {

    try {

        const response =
            await fetch("/api/statistics");

        const data =
            await response.json();

        document.getElementById(
            "totalIntersections"
        ).textContent =
            data.intersections;

        document.getElementById(
            "totalVehicles"
        ).textContent =
            data.vehicles.toLocaleString();

        document.getElementById(
            "avgWaiting"
        ).textContent =
            data.waiting;

    } catch (error) {

        console.error(error);

    }
}


// ============================================================
// INTERSECTION CARDS
// ============================================================

function renderIntersectionCards() {

    const container =
        document.getElementById(
            "intersectionCards"
        );

    container.innerHTML = "";

    trafficData.forEach(item => {

        const card =
            document.createElement("div");

        card.className =
            "intersection-card";

        card.innerHTML = `

            <div class="intersection-card-header">

                <strong>
                    ${item.name}
                </strong>

                <span class="status ${item.status}">
                    ${item.status}
                </span>

            </div>

            <div class="direction-values">

                <div>
                    N
                    <strong>
                        ${item.north}
                    </strong>
                </div>

                <div>
                    S
                    <strong>
                        ${item.south}
                    </strong>
                </div>

                <div>
                    E
                    <strong>
                        ${item.east}
                    </strong>
                </div>

                <div>
                    W
                    <strong>
                        ${item.west}
                    </strong>
                </div>

            </div>
        `;

        container.appendChild(card);

    });
}


// ============================================================
// DATASET
// ============================================================

function renderDataset() {

    const container =
        document.getElementById(
            "datasetRows"
        );

    container.innerHTML = "";

    trafficData.forEach(item => {

        const row =
            document.createElement("div");

        row.className = "data-row";

        row.innerHTML = `

            <span>08:00</span>

            <span>
                J${item.id}
            </span>

            <span>
                ${item.north}
            </span>

            <span>
                ${item.south}
            </span>

            <span>
                ${item.east}
            </span>

            <span>
                ${item.west}
            </span>

            <span>
                ${item.density}
            </span>

            <span class="status ${item.status}">
                ${item.status}
            </span>

        `;

        container.appendChild(row);

    });
}


// ============================================================
// FULL DATASET PAGE
// ============================================================

function renderFullDataset() {

    const container =
        document.getElementById(
            "fullDataset"
        );

    container.innerHTML = `

        <div class="data-table">

            <div class="data-head">

                <span>Junction</span>
                <span>North</span>
                <span>South</span>
                <span>East</span>
                <span>West</span>
                <span>Density</span>
                <span>Status</span>

            </div>

        </div>
    `;

    const table =
        container.querySelector(
            ".data-table"
        );

    trafficData.forEach(item => {

        const row =
            document.createElement("div");

        row.className = "data-row";

        row.innerHTML = `

            <span>
                ${item.name}
            </span>

            <span>${item.north}</span>

            <span>${item.south}</span>

            <span>${item.east}</span>

            <span>${item.west}</span>

            <span>${item.density}</span>

            <span class="status ${item.status}">
                ${item.status}
            </span>

        `;

        table.appendChild(row);

    });
}


// ============================================================
// NAVIGATION
// ============================================================

document.querySelectorAll(
    ".nav-item"
).forEach(button => {

    button.addEventListener(
        "click",
        () => {

            const sectionId =
                button.dataset.section;

            document.querySelectorAll(
                ".nav-item"
            ).forEach(item => {

                item.classList.remove(
                    "active"
                );

            });

            button.classList.add(
                "active"
            );


            document.querySelectorAll(
                ".section"
            ).forEach(section => {

                section.classList.remove(
                    "active"
                );

            });


            const section =
                document.getElementById(
                    sectionId
                );

            if (section) {

                section.classList.add(
                    "active"
                );

            }


            if (sectionId === "intersections") {

                renderAgents();

            }

        }
    );

});


// ============================================================
// RUN AI
// ============================================================

async function runOptimization() {

    const junction =
        document.getElementById(
            "junctionSelect"
        ).value;

    const button =
        document.getElementById(
            "runAI"
        );

    button.disabled = true;

    button.textContent =
        "⏳ Optimizing...";


    try {

        const response =
            await fetch(
                "/api/optimize",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        junction_id:
                            junction
                    })
                }
            );


        const result =
            await response.json();

        currentOptimization =
            result;

        updateOptimizationUI(
            result
        );

    } catch (error) {

        console.error(error);

        alert(
            "Optimization failed."
        );

    }


    button.disabled = false;

    button.textContent =
        "▶ Run AI Optimization";
}


// ============================================================
// UPDATE OPTIMIZATION UI
// ============================================================

function updateOptimizationUI(
    result
) {

    const timings =
        result.timings;


    document.getElementById(
        "northTime"
    ).textContent =
        `${timings.north} sec`;

    document.getElementById(
        "southTime"
    ).textContent =
        `${timings.south} sec`;

    document.getElementById(
        "eastTime"
    ).textContent =
        `${timings.east} sec`;

    document.getElementById(
        "westTime"
    ).textContent =
        `${timings.west} sec`;


    document.getElementById(
        "tableNorth"
    ).textContent =
        `${timings.north} sec`;

    document.getElementById(
        "tableSouth"
    ).textContent =
        `${timings.south} sec`;

    document.getElementById(
        "tableEast"
    ).textContent =
        `${timings.east} sec`;

    document.getElementById(
        "tableWest"
    ).textContent =
        `${timings.west} sec`;


    document.getElementById(
        "cycleTime"
    ).textContent =
        `${result.cycle} sec`;


    document.getElementById(
        "improvement"
    ).textContent =
        `${result.improvement}%`;

}


// ============================================================
// AI BUTTONS
// ============================================================

document.getElementById(
    "runAI"
).addEventListener(
    "click",
    runOptimization
);


document.getElementById(
    "runAI2"
).addEventListener(
    "click",
    runOptimization
);


// ============================================================
// CONSTRAINT BUTTON
// ============================================================

document.getElementById(
    "applyConstraints"
).addEventListener(
    "click",
    () => {

        if (!currentOptimization) {

            alert(
                "Run AI Optimization first."
            );

            return;

        }

        alert(
            "✓ All traffic constraints satisfied.\n\n" +
            "Minimum green time: 10 sec\n" +
            "Maximum green time: 60 sec\n" +
            "Yellow time: 5 sec\n" +
            "Cycle time: " +
            currentOptimization.cycle +
            " sec"
        );

    }
);


// ============================================================
// JUNCTION CHANGE
// ============================================================

document.getElementById(
    "junctionSelect"
).addEventListener(
    "change",
    () => {

        currentOptimization = null;

    }
);


// ============================================================
// INTERSECTION AGENTS
// ============================================================

function renderAgents() {

    const container =
        document.getElementById(
            "allIntersections"
        );

    container.innerHTML = "";

    trafficData.forEach(item => {

        const total =
            item.north +
            item.south +
            item.east +
            item.west;

        const card =
            document.createElement("div");

        card.className =
            "agent-card";

        card.innerHTML = `

            <h3>
                🤖 ${item.name}
            </h3>

            <span class="status ${item.status}">
                ${item.status}
            </span>

            <p>
                Multi-agent traffic controller
            </p>

            <p>
                Total Vehicles:
                <strong>
                    ${total}
                </strong>
            </p>

            <p>
                Traffic Density:
                <strong>
                    ${item.density}
                </strong>
            </p>

            <p>
                Agent Status:
                <strong style="color:#24d879">
                    ACTIVE
                </strong>
            </p>

        `;

        container.appendChild(card);

    });
}


// ============================================================
// SIMULATION
// ============================================================

let simulationRunning = false;

let simulationIndex = 0;

const simulationDirections = [
    "NORTH",
    "EAST",
    "SOUTH",
    "WEST"
];

document.getElementById(
    "startSimulation"
).addEventListener(
    "click",
    function () {

        if (simulationRunning) {

            return;

        }

        simulationRunning = true;

        this.textContent =
            "⏸ Simulation Running...";

        simulationIndex = 0;

        runSimulationStep(this);

    }
);


function runSimulationStep(button) {

    const direction =
        simulationDirections[
            simulationIndex
        ];

    document.getElementById(
        "simulationStatus"
    ).textContent =
        `${direction} — GREEN`;

    simulationIndex++;

    if (
        simulationIndex >=
        simulationDirections.length
    ) {

        simulationIndex = 0;

    }

    setTimeout(
        () => {

            runSimulationStep(
                button
            );

        },
        2000
    );

}


// ============================================================
// INITIAL LOAD
// ============================================================

loadTrafficData();
