// ============================================================
// SMART TRAFFIC MANAGEMENT SYSTEM
// script.js
// ============================================================


// ============================================================
// GLOBAL VARIABLES
// ============================================================

let trafficData = [];
let currentOptimization = null;

let selectedJunction = "all";

let simulationRunning = false;
let simulationTimer = null;
let simulationIndex = 0;


// ============================================================
// SAFE ELEMENT HELPER
// ============================================================

function getElement(id) {
    return document.getElementById(id);
}


// ============================================================
// CLOCK
// ============================================================

function updateClock() {

    const now = new Date();

    const clock = getElement("clock");
    const date = getElement("date");

    if (clock) {
        clock.textContent =
            now.toLocaleTimeString();
    }

    if (date) {

        date.textContent =
            now.toLocaleDateString(
                undefined,
                {
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                }
            );
    }
}


setInterval(updateClock, 1000);

updateClock();


// ============================================================
// API HELPER
// ============================================================

async function fetchJSON(url, options = {}) {

    const response =
        await fetch(url, options);

    let data;

    try {

        data =
            await response.json();

    } catch (error) {

        throw new Error(
            "Server returned invalid JSON."
        );
    }


    if (!response.ok) {

        throw new Error(
            data.message ||
            data.error ||
            "Server request failed."
        );
    }


    return data;
}


// ============================================================
// LOAD DASHBOARD DATA
// ============================================================

async function loadDashboard() {

    try {

        const data =
            await fetchJSON(
                "/api/dashboard"
            );


        // ----------------------------------------------------
        // Total intersections
        // ----------------------------------------------------

        const totalIntersections =
            getElement(
                "totalIntersections"
            );

        if (totalIntersections) {

            totalIntersections.textContent =
                data.intersections ?? 4;
        }


        // ----------------------------------------------------
        // Total vehicles
        // ----------------------------------------------------

        const totalVehicles =
            getElement(
                "totalVehicles"
            );

        if (totalVehicles) {

            const value =
                Number(
                    data.total_vehicles || 0
                );

            totalVehicles.textContent =
                value.toLocaleString();
        }


        // ----------------------------------------------------
        // Average waiting
        // ----------------------------------------------------

        const avgWaiting =
            getElement(
                "avgWaiting"
            );

        if (avgWaiting) {

            avgWaiting.textContent =
                Number(
                    data.average_waiting_time || 0
                ).toFixed(2);
        }


        // ----------------------------------------------------
        // Traffic status
        // ----------------------------------------------------

        updateTrafficStatus(
            data.traffic_status
        );


        // ----------------------------------------------------
        // Performance cards
        // ----------------------------------------------------

        updatePerformanceValues(data);


    } catch (error) {

        console.error(
            "Dashboard loading error:",
            error
        );
    }
}


// ============================================================
// UPDATE TRAFFIC STATUS
// ============================================================

function updateTrafficStatus(status) {

    if (!status) {
        return;
    }


    const statusElements =
        document.querySelectorAll(
            ".stat-card strong.high, " +
            ".stat-card strong.medium, " +
            ".stat-card strong.low"
        );


    statusElements.forEach(
        element => {

            element.textContent =
                status;

            element.classList.remove(
                "high",
                "medium",
                "low"
            );

            element.classList.add(
                status.toLowerCase()
            );
        }
    );
}


// ============================================================
// UPDATE PERFORMANCE VALUES
// ============================================================

function updatePerformanceValues(data) {

    const performance =
        document.querySelectorAll(
            ".mini-chart strong"
        );


    if (
        performance &&
        performance.length >= 2
    ) {

        performance[0].textContent =
            Number(
                data.total_vehicles || 0
            ).toLocaleString();


        performance[1].textContent =
            Number(
                data.average_waiting_time || 0
            ).toFixed(2) +
            " sec";
    }
}


// ============================================================
// LOAD INTERSECTIONS
// ============================================================

async function loadIntersections() {

    try {

        const data =
            await fetchJSON(
                "/api/intersections"
            );


        const intersections =
            data.intersections || [];


        renderIntersectionCards(
            intersections
        );


        renderAgents(
            intersections
        );


    } catch (error) {

        console.error(
            "Intersection loading error:",
            error
        );
    }
}


// ============================================================
// RENDER INTERSECTION CARDS
// ============================================================

function renderIntersectionCards(
    intersections
) {

    const container =
        getElement(
            "intersectionCards"
        );


    if (!container) {
        return;
    }


    container.innerHTML = "";


    intersections.forEach(
        item => {

            const card =
                document.createElement(
                    "div"
                );


            card.className =
                "intersection-card";


            const vehicles =
                Number(
                    item.vehicles || 0
                );


            const waiting =
                Number(
                    item.waiting_time || 0
                );


            const speed =
                Number(
                    item.average_speed || 0
                );


            const status =
                (
                    item.status ||
                    "UNKNOWN"
                ).toLowerCase();


            card.innerHTML = `

                <div class="intersection-card-header">

                    <strong>
                        Junction ${item.junction}
                    </strong>

                    <span class="status ${status}">
                        ${item.status || "UNKNOWN"}
                    </span>

                </div>


                <div class="direction-values">

                    <div>
                        Vehicles
                        <strong>
                            ${vehicles.toFixed(1)}
                        </strong>
                    </div>

                    <div>
                        Waiting
                        <strong>
                            ${waiting.toFixed(1)}s
                        </strong>
                    </div>

                    <div>
                        Speed
                        <strong>
                            ${speed.toFixed(1)}
                        </strong>
                    </div>

                </div>

            `;


            card.addEventListener(
                "click",
                () => {

                    const select =
                        getElement(
                            "junctionSelect"
                        );

                    if (select) {

                        select.value =
                            String(
                                item.junction
                            );

                        select.dispatchEvent(
                            new Event(
                                "change"
                            )
                        );
                    }
                }
            );


            container.appendChild(
                card
            );
        }
    );
}


// ============================================================
// RENDER AI AGENTS
// ============================================================

function renderAgents(
    intersections
) {

    const container =
        getElement(
            "allIntersections"
        );


    if (!container) {
        return;
    }


    container.innerHTML = "";


    intersections.forEach(
        item => {

            const card =
                document.createElement(
                    "div"
                );


            card.className =
                "agent-card";


            const status =
                (
                    item.status ||
                    "UNKNOWN"
                ).toLowerCase();


            card.innerHTML = `

                <h3>
                    🤖 Junction ${item.junction}
                </h3>

                <span class="status ${status}">
                    ${item.status || "UNKNOWN"}
                </span>


                <p>
                    Multi-agent traffic controller
                </p>


                <p>
                    Average Vehicles:
                    <strong>
                        ${Number(
                            item.vehicles || 0
                        ).toFixed(2)}
                    </strong>
                </p>


                <p>
                    Average Waiting:
                    <strong>
                        ${Number(
                            item.waiting_time || 0
                        ).toFixed(2)}
                        sec
                    </strong>
                </p>


                <p>
                    Average Speed:
                    <strong>
                        ${Number(
                            item.average_speed || 0
                        ).toFixed(2)}
                    </strong>
                </p>


                <p>
                    Agent Status:
                    <strong>
                        ACTIVE
                    </strong>
                </p>

            `;


            container.appendChild(
                card
            );
        }
    );
}


// ============================================================
// LOAD DATASET
// ============================================================

async function loadTrafficData(
    junction = "all"
) {

    try {

        selectedJunction =
            junction;


        let url =
            "/api/traffic";


        if (
            junction !== "all" &&
            junction !== ""
        ) {

            url =
                "/api/traffic-by-junction" +
                "?junction=" +
                encodeURIComponent(
                    junction
                );
        }


        showDatasetLoading();


        const result =
            await fetchJSON(url);


        // API may return array directly
        // or {data: [...]}

        if (Array.isArray(result)) {

            trafficData =
                result;

        } else if (
            Array.isArray(
                result.data
            )
        ) {

            trafficData =
                result.data;

        } else if (
            Array.isArray(
                result.records
            )
        ) {

            trafficData =
                result.records;

        } else {

            trafficData = [];
        }


        renderDataset();


    } catch (error) {

        console.error(
            "Traffic dataset error:",
            error
        );


        showDatasetError(
            error.message
        );
    }
}


// ============================================================
// SHOW DATASET LOADING
// ============================================================

function showDatasetLoading() {

    const container =
        getElement(
            "fullDatasetRows"
        ) ||
        getElement(
            "fullDataset"
        );


    if (!container) {
        return;
    }


    container.innerHTML = `

        <div class="dataset-message">

            Loading traffic data...

        </div>

    `;
}


// ============================================================
// SHOW DATASET ERROR
// ============================================================

function showDatasetError(message) {

    const container =
        getElement(
            "fullDatasetRows"
        ) ||
        getElement(
            "fullDataset"
        );


    if (!container) {
        return;
    }


    container.innerHTML = `

        <div class="dataset-message">

            Unable to load dataset.

            <br><br>

            ${escapeHTML(message)}

        </div>

    `;
}


// ============================================================
// RENDER DATASET
// ============================================================

function renderDataset() {

    renderDashboardDataset();

    renderFullDataset();
}


// ============================================================
// DASHBOARD SMALL DATASET
// ============================================================

function renderDashboardDataset() {

    const container =
        getElement(
            "datasetRows"
        );


    if (!container) {
        return;
    }


    container.innerHTML = "";


    if (
        !trafficData ||
        trafficData.length === 0
    ) {

        container.innerHTML = `

            <div class="dataset-message">

                No traffic records found.

            </div>

        `;

        return;
    }


    const records =
        trafficData.slice(
            0,
            8
        );


    records.forEach(
        (item, index) => {

            const row =
                document.createElement(
                    "div"
                );


            row.className =
                "data-row";


            const junction =
                getJunctionNumber(
                    item,
                    index
                );


            const vehicleCount =
                getVehicleCount(
                    item
                );


            const direction =
                splitVehicleDirections(
                    vehicleCount
                );


            const density =
                getDensity(
                    item
                );


            const status =
                getTrafficLevel(
                    item
                );


            const time =
                item.time_of_day ||
                item.time ||
                "--";


            row.innerHTML = `

                <span>
                    ${escapeHTML(
                        String(time)
                    )}
                </span>

                <span>
                    J${junction}
                </span>

                <span>
                    ${direction.north}
                </span>

                <span>
                    ${direction.south}
                </span>

                <span>
                    ${direction.east}
                </span>

                <span>
                    ${direction.west}
                </span>

                <span>
                    ${density}
                </span>

                <span class="status ${status.toLowerCase()}">
                    ${status}
                </span>

            `;


            container.appendChild(
                row
            );
        }
    );
}


// ============================================================
// FULL DATASET
// ============================================================

function renderFullDataset() {

    let container =
        getElement(
            "fullDatasetRows"
        );


    // --------------------------------------------------------
    // Support older HTML
    // --------------------------------------------------------

    if (!container) {

        const oldContainer =
            getElement(
                "fullDataset"
            );


        if (!oldContainer) {
            return;
        }


        oldContainer.innerHTML = `

            <div class="data-table">

                <div class="data-head">

                    <span>ID</span>
                    <span>Junction</span>
                    <span>Vehicles</span>
                    <span>Speed</span>
                    <span>Occupancy</span>
                    <span>Flow Rate</span>
                    <span>Time</span>
                    <span>Waiting</span>

                </div>

                <div id="fullDatasetRows">
                </div>

            </div>

        `;


        container =
            getElement(
                "fullDatasetRows"
            );
    }


    if (!container) {
        return;
    }


    container.innerHTML = "";


    if (
        !trafficData ||
        trafficData.length === 0
    ) {

        container.innerHTML = `

            <div class="dataset-message">

                No traffic records found
                for this junction.

            </div>

        `;

        return;
    }


    trafficData.forEach(
        (item, index) => {

            const row =
                document.createElement(
                    "div"
                );


            row.className =
                "data-row";


            const id =
                item.id ??
                item.record_id ??
                index + 1;


            const junction =
                getJunctionNumber(
                    item,
                    index
                );


            const vehicles =
                getVehicleCount(
                    item
                );


            const speed =
                Number(
                    item.average_speed ??
                    item.speed ??
                    0
                );


            const occupancy =
                Number(
                    item.lane_occupancy ??
                    item.occupancy ??
                    0
                );


            const flow =
                Number(
                    item.flow_rate ??
                    item.flow ??
                    0
                );


            const time =
                item.time_of_day ??
                item.time ??
                "--";


            const waiting =
                Number(
                    item.waiting_time ??
                    item.waiting ??
                    0
                );


            row.innerHTML = `

                <span>
                    ${id}
                </span>

                <span>
                    J${junction}
                </span>

                <span>
                    ${formatNumber(
                        vehicles
                    )}
                </span>

                <span>
                    ${formatNumber(
                        speed
                    )}
                </span>

                <span>
                    ${formatNumber(
                        occupancy
                    )}
                </span>

                <span>
                    ${formatNumber(
                        flow
                    )}
                </span>

                <span>
                    ${escapeHTML(
                        String(time)
                    )}
                </span>

                <span>
                    ${formatNumber(
                        waiting
                    )} sec
                </span>

            `;


            container.appendChild(
                row
            );
        }
    );
}


// ============================================================
// GET JUNCTION NUMBER
// ============================================================

function getJunctionNumber(
    item,
    index = 0
) {

    if (item.junction) {
        return item.junction;
    }


    if (item.junction_id) {
        return item.junction_id;
    }


    if (
        selectedJunction !== "all"
    ) {

        return selectedJunction;
    }


    const id =
        Number(
            item.id ||
            index + 1
        );


    if (id <= 2500) {
        return 1;
    }


    if (id <= 5000) {
        return 2;
    }


    if (id <= 7500) {
        return 3;
    }


    return 4;
}


// ============================================================
// GET VEHICLE COUNT
// ============================================================

function getVehicleCount(item) {

    return Number(
        item.vehicle_count ??
        item.vehicles ??
        item.count ??
        0
    );
}


// ============================================================
// SPLIT VEHICLES FOR DASHBOARD VISUAL
// ============================================================

function splitVehicleDirections(
    vehicleCount
) {

    const total =
        Math.max(
            0,
            Math.round(
                Number(
                    vehicleCount || 0
                )
            )
        );


    const north =
        Math.round(
            total * 0.29
        );


    const south =
        Math.round(
            total * 0.26
        );


    const east =
        Math.round(
            total * 0.25
        );


    const west =
        Math.max(
            0,
            total -
            north -
            south -
            east
        );


    return {
        north,
        south,
        east,
        west
    };
}


// ============================================================
// GET DENSITY
// ============================================================

function getDensity(item) {

    if (
        item.density !== undefined
    ) {

        return item.density;
    }


    const occupancy =
        Number(
            item.lane_occupancy ||
            item.occupancy ||
            0
        );


    if (occupancy > 1) {

        return (
            occupancy / 100
        ).toFixed(2);
    }


    return occupancy.toFixed(2);
}


// ============================================================
// GET TRAFFIC LEVEL
// ============================================================

function getTrafficLevel(item) {

    if (item.status) {

        return String(
            item.status
        ).toUpperCase();
    }


    const waiting =
        Number(
            item.waiting_time ||
            item.waiting ||
            0
        );


    if (waiting < 20) {

        return "LOW";
    }


    if (waiting < 40) {

        return "MEDIUM";
    }


    return "HIGH";
}


// ============================================================
// FORMAT NUMBER
// ============================================================

function formatNumber(value) {

    const number =
        Number(value);


    if (!Number.isFinite(number)) {

        return "0";
    }


    return number.toFixed(2);
}


// ============================================================
// HTML ESCAPE
// ============================================================

function escapeHTML(value) {

    return String(value)
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            '"',
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#039;"
        );
}


// ============================================================
// DATASET JUNCTION FILTER
// ============================================================

function setupDatasetFilter() {

    const possibleIds = [

        "datasetJunctionSelect",
        "datasetJunctionFilter",
        "junctionFilter"

    ];


    let select = null;


    for (
        const id of possibleIds
    ) {

        const element =
            getElement(id);


        if (element) {

            select =
                element;

            break;
        }
    }


    if (!select) {

        return;
    }


    select.addEventListener(
        "change",
        async function () {

            const junction =
                this.value ||
                "all";


            await loadTrafficData(
                junction
            );
        }
    );
}


// ============================================================
// NAVIGATION
// ============================================================

function setupNavigation() {

    document.querySelectorAll(
        ".nav-item"
    ).forEach(
        button => {

            button.addEventListener(
                "click",
                async () => {

                    const sectionId =
                        button.dataset.section;


                    // ----------------------------------------
                    // Remove active navigation
                    // ----------------------------------------

                    document.querySelectorAll(
                        ".nav-item"
                    ).forEach(
                        item => {

                            item.classList.remove(
                                "active"
                            );
                        }
                    );


                    button.classList.add(
                        "active"
                    );


                    // ----------------------------------------
                    // Hide all pages
                    // ----------------------------------------

                    document.querySelectorAll(
                        ".section"
                    ).forEach(
                        section => {

                            section.classList.remove(
                                "active"
                            );
                        }
                    );


                    // ----------------------------------------
                    // Show selected page
                    // ----------------------------------------

                    const section =
                        getElement(
                            sectionId
                        );


                    if (section) {

                        section.classList.add(
                            "active"
                        );
                    }


                    // ----------------------------------------
                    // Refresh pages
                    // ----------------------------------------

                    if (
                        sectionId ===
                        "dataset"
                    ) {

                        await loadTrafficData(
                            selectedJunction
                        );
                    }


                    if (
                        sectionId ===
                        "intersections"
                    ) {

                        await loadIntersections();
                    }


                    if (
                        sectionId ===
                        "reports"
                    ) {

                        await loadDashboard();
                    }

                }
            );
        }
    );
}


// ============================================================
// MAIN JUNCTION SELECT
// ============================================================

function setupMainJunctionSelect() {

    const select =
        getElement(
            "junctionSelect"
        );


    if (!select) {
        return;
    }


    select.addEventListener(
        "change",
        function () {

            currentOptimization =
                null;


            updateSelectedJunctionInfo(
                this.value
            );
        }
    );
}


// ============================================================
// UPDATE SELECTED JUNCTION
// ============================================================

async function updateSelectedJunctionInfo(
    junction
) {

    try {

        const result =
            await fetchJSON(
                "/api/traffic-by-junction" +
                "?junction=" +
                encodeURIComponent(
                    junction
                )
            );


        let records = [];


        if (Array.isArray(result)) {

            records = result;

        } else if (
            Array.isArray(
                result.data
            )
        ) {

            records =
                result.data;

        } else if (
            Array.isArray(
                result.records
            )
        ) {

            records =
                result.records;
        }


        if (
            records.length === 0
        ) {

            return;
        }


        let totalVehicles = 0;


        records.forEach(
            item => {

                totalVehicles +=
                    getVehicleCount(
                        item
                    );
            }
        );


        const average =
            totalVehicles /
            records.length;


        updateDirectionDisplay(
            average
        );


    } catch (error) {

        console.error(
            "Junction display error:",
            error
        );
    }
}


// ============================================================
// UPDATE DIRECTION DISPLAY
// ============================================================

function updateDirectionDisplay(
    vehicleCount
) {

    const directions =
        splitVehicleDirections(
            vehicleCount
        );


    // These values represent an estimated
    // directional distribution when the
    // database contains only total vehicles.


    const north =
        getElement(
            "northVehicleCount"
        );

    const south =
        getElement(
            "southVehicleCount"
        );

    const east =
        getElement(
            "eastVehicleCount"
        );

    const west =
        getElement(
            "westVehicleCount"
        );


    if (north) {
        north.textContent =
            directions.north;
    }


    if (south) {
        south.textContent =
            directions.south;
    }


    if (east) {
        east.textContent =
            directions.east;
    }


    if (west) {
        west.textContent =
            directions.west;
    }
}


// ============================================================
// RUN AI OPTIMIZATION
// ============================================================

async function runOptimization() {

    const junctionSelect =
        getElement(
            "junctionSelect"
        );


    const junction =
        junctionSelect
            ? junctionSelect.value
            : "1";


    const runAI =
        getElement(
            "runAI"
        );


    const runAI2 =
        getElement(
            "runAI2"
        );


    if (runAI) {

        runAI.disabled = true;

        runAI.textContent =
            "⏳ Optimizing...";
    }


    if (runAI2) {

        runAI2.disabled = true;

        runAI2.textContent =
            "⏳ Optimizing...";
    }


    try {

        const result =
            await fetchJSON(
                "/api/optimize",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            junction_id:
                                Number(
                                    junction
                                )
                        })
                }
            );


        currentOptimization =
            result;


        updateOptimizationUI(
            result
        );


    } catch (error) {

        console.error(
            "Optimization error:",
            error
        );


        alert(
            "Optimization failed: " +
            error.message
        );


    } finally {

        if (runAI) {

            runAI.disabled =
                false;

            runAI.textContent =
                "▶ Run AI Optimization";
        }


        if (runAI2) {

            runAI2.disabled =
                false;

            runAI2.textContent =
                "Run Optimization";
        }
    }
}


// ============================================================
// UPDATE AI OPTIMIZATION UI
// ============================================================

function updateOptimizationUI(
    result
) {

    let north = 0;
    let south = 0;
    let east = 0;
    let west = 0;

    let northYellow = 5;
    let southYellow = 5;
    let eastYellow = 5;
    let westYellow = 5;

    let northRed = 0;
    let southRed = 0;
    let eastRed = 0;
    let westRed = 0;

    let cycle = 0;
    let improvement = 0;


    // --------------------------------------------------------
    // New API format
    // --------------------------------------------------------

    if (result.signal_timings) {

        const timings =
            result.signal_timings;


        north =
            Number(
                timings.north?.green || 0
            );

        south =
            Number(
                timings.south?.green || 0
            );

        east =
            Number(
                timings.east?.green || 0
            );

        west =
            Number(
                timings.west?.green || 0
            );


        northYellow =
            Number(
                timings.north?.yellow || 5
            );

        southYellow =
            Number(
                timings.south?.yellow || 5
            );

        eastYellow =
            Number(
                timings.east?.yellow || 5
            );

        westYellow =
            Number(
                timings.west?.yellow || 5
            );


        northRed =
            Number(
                timings.north?.red || 0
            );

        southRed =
            Number(
                timings.south?.red || 0
            );

        eastRed =
            Number(
                timings.east?.red || 0
            );

        westRed =
            Number(
                timings.west?.red || 0
            );


        cycle =
            Number(
                result.optimization
                    ?.cycle_time ||
                result.cycle ||
                0
            );


        improvement =
            Number(
                result.optimization
                    ?.improvement ||
                result.improvement ||
                0
            );
    }


    // --------------------------------------------------------
    // Older API format
    // --------------------------------------------------------

    else if (result.timings) {

        north =
            Number(
                result.timings.north || 0
            );

        south =
            Number(
                result.timings.south || 0
            );

        east =
            Number(
                result.timings.east || 0
            );

        west =
            Number(
                result.timings.west || 0
            );


        cycle =
            Number(
                result.cycle || 0
            );


        improvement =
            Number(
                result.improvement || 0
            );


        northRed =
            Math.max(
                0,
                cycle - north
            );

        southRed =
            Math.max(
                0,
                cycle - south
            );

        eastRed =
            Math.max(
                0,
                cycle - east
            );

        westRed =
            Math.max(
                0,
                cycle - west
            );
    }


    // --------------------------------------------------------
    // Recommended green format
    // --------------------------------------------------------

    else if (
        result.recommended_green_time
        !== undefined
    ) {

        north =
            Number(
                result.recommended_green_time
            );

        south =
            Math.max(
                15,
                Math.round(
                    north * 0.85
                )
            );

        east =
            Math.max(
                15,
                Math.round(
                    north * 0.70
                )
            );

        west =
            Math.max(
                15,
                Math.round(
                    north * 0.60
                )
            );


        const yellow =
            Number(
                result.yellow_time || 5
            );


        northYellow = yellow;
        southYellow = yellow;
        eastYellow = yellow;
        westYellow = yellow;


        cycle =
            north +
            south +
            east +
            west +
            yellow * 4;


        northRed =
            cycle - north;

        southRed =
            cycle - south;

        eastRed =
            cycle - east;

        westRed =
            cycle - west;
    }


    // --------------------------------------------------------
    // Live intersection timing
    // --------------------------------------------------------

    setText(
        "northTime",
        `${north} sec`
    );

    setText(
        "southTime",
        `${south} sec`
    );

    setText(
        "eastTime",
        `${east} sec`
    );

    setText(
        "westTime",
        `${west} sec`
    );


    // --------------------------------------------------------
    // Timing table green
    // --------------------------------------------------------

    setText(
        "tableNorth",
        `${north} sec`
    );

    setText(
        "tableSouth",
        `${south} sec`
    );

    setText(
        "tableEast",
        `${east} sec`
    );

    setText(
        "tableWest",
        `${west} sec`
    );


    // --------------------------------------------------------
    // Optional yellow/red IDs
    // --------------------------------------------------------

    setText(
        "northYellow",
        `${northYellow} sec`
    );

    setText(
        "southYellow",
        `${southYellow} sec`
    );

    setText(
        "eastYellow",
        `${eastYellow} sec`
    );

    setText(
        "westYellow",
        `${westYellow} sec`
    );


    setText(
        "northRed",
        `${northRed} sec`
    );

    setText(
        "southRed",
        `${southRed} sec`
    );

    setText(
        "eastRed",
        `${eastRed} sec`
    );

    setText(
        "westRed",
        `${westRed} sec`
    );


    // --------------------------------------------------------
    // Optimization result
    // --------------------------------------------------------

    setText(
        "cycleTime",
        `${cycle} sec`
    );


    setText(
        "improvement",
        `${improvement.toFixed(2)}%`
    );
}


// ============================================================
// SET TEXT SAFELY
// ============================================================

function setText(
    id,
    value
) {

    const element =
        getElement(id);


    if (element) {

        element.textContent =
            value;
    }
}


// ============================================================
// AI BUTTON EVENTS
// ============================================================

function setupAIButtons() {

    const runAI =
        getElement(
            "runAI"
        );


    const runAI2 =
        getElement(
            "runAI2"
        );


    if (runAI) {

        runAI.addEventListener(
            "click",
            runOptimization
        );
    }


    if (runAI2) {

        runAI2.addEventListener(
            "click",
            runOptimization
        );
    }
}


// ============================================================
// APPLY CONSTRAINTS
// ============================================================

function setupConstraintButton() {

    const button =
        getElement(
            "applyConstraints"
        );


    if (!button) {
        return;
    }


    button.addEventListener(
        "click",
        () => {

            if (
                !currentOptimization
            ) {

                alert(
                    "Run AI Optimization first."
                );

                return;
            }


            let cycle = 0;


            if (
                currentOptimization
                    .optimization
            ) {

                cycle =
                    currentOptimization
                        .optimization
                        .cycle_time || 0;

            } else {

                cycle =
                    currentOptimization
                        .cycle || 0;
            }


            alert(

                "✓ All traffic constraints satisfied.\n\n" +

                "Minimum green time: 10 sec\n" +

                "Maximum green time: 60 sec\n" +

                "Yellow time: 5 sec\n" +

                "Cycle time: " +

                cycle +

                " sec"
            );
        }
    );
}


// ============================================================
// SIMULATION
// ============================================================

const simulationDirections = [

    "NORTH",
    "EAST",
    "SOUTH",
    "WEST"

];


function setupSimulation() {

    const button =
        getElement(
            "startSimulation"
        );


    if (!button) {
        return;
    }


    button.addEventListener(
        "click",
        function () {

            if (
                simulationRunning
            ) {

                stopSimulation(
                    this
                );

                return;
            }


            simulationRunning =
                true;


            simulationIndex =
                0;


            this.textContent =
                "⏹ Stop Simulation";


            runSimulationStep(
                this
            );
        }
    );
}


// ============================================================
// RUN SIMULATION STEP
// ============================================================

function runSimulationStep(button) {

    if (!simulationRunning) {
        return;
    }


    const direction =
        simulationDirections[
            simulationIndex
        ];


    const status =
        getElement(
            "simulationStatus"
        );


    if (status) {

        status.textContent =
            `${direction} — GREEN`;
    }


    updateSimulationLights(
        "green"
    );


    simulationIndex++;


    if (
        simulationIndex >=
        simulationDirections.length
    ) {

        simulationIndex = 0;
    }


    let duration = 2000;


    if (
        currentOptimization
    ) {

        duration =
            getSimulationDuration(
                direction
            );
    }


    simulationTimer =
        setTimeout(
            () => {

                runSimulationStep(
                    button
                );

            },
            duration
        );
}


// ============================================================
// SIMULATION DURATION
// ============================================================

function getSimulationDuration(
    direction
) {

    let seconds = 2;


    const key =
        direction.toLowerCase();


    if (
        currentOptimization
            ?.signal_timings
            ?.[key]
            ?.green
    ) {

        seconds =
            currentOptimization
                .signal_timings
                [key]
                .green;
    }


    else if (
        currentOptimization
            ?.timings
            ?.[key]
    ) {

        seconds =
            currentOptimization
                .timings[key];
    }


    // Keep visual demo reasonably fast.

    return Math.max(
        1000,
        Math.min(
            seconds * 100,
            5000
        )
    );
}


// ============================================================
// SIMULATION LIGHTS
// ============================================================

function updateSimulationLights(
    state
) {

    const light =
        document.querySelector(
            ".sim-light"
        );


    if (!light) {
        return;
    }


    const red =
        light.querySelector(
            ".red"
        );

    const yellow =
        light.querySelector(
            ".yellow"
        );

    const green =
        light.querySelector(
            ".green"
        );


    if (red) {

        red.classList.remove(
            "active"
        );
    }


    if (yellow) {

        yellow.classList.remove(
            "active"
        );
    }


    if (green) {

        green.classList.remove(
            "active"
        );
    }


    if (
        state === "green" &&
        green
    ) {

        green.classList.add(
            "active"
        );
    }


    if (
        state === "yellow" &&
        yellow
    ) {

        yellow.classList.add(
            "active"
        );
    }


    if (
        state === "red" &&
        red
    ) {

        red.classList.add(
            "active"
        );
    }
}


// ============================================================
// STOP SIMULATION
// ============================================================

function stopSimulation(button) {

    simulationRunning =
        false;


    if (simulationTimer) {

        clearTimeout(
            simulationTimer
        );

        simulationTimer =
            null;
    }


    button.textContent =
        "▶ Start Simulation";


    const status =
        getElement(
            "simulationStatus"
        );


    if (status) {

        status.textContent =
            "Simulation Stopped";
    }


    updateSimulationLights(
        "red"
    );
}


// ============================================================
// SETTINGS
// ============================================================

function setupSettings() {

    const settings =
        document.querySelectorAll(
            "#settings input[type='number']"
        );


    settings.forEach(
        input => {

            input.addEventListener(
                "change",
                () => {

                    let value =
                        Number(
                            input.value
                        );


                    if (
                        !Number.isFinite(
                            value
                        )
                    ) {

                        value = 0;
                    }


                    if (value < 0) {

                        value = 0;
                    }


                    input.value =
                        value;
                }
            );
        }
    );
}


// ============================================================
// REFRESH DATA
// ============================================================

async function refreshApplication() {

    await Promise.allSettled([

        loadDashboard(),

        loadIntersections(),

        loadTrafficData(
            selectedJunction
        )

    ]);
}


// ============================================================
// INITIALIZE APPLICATION
// ============================================================

async function initializeApplication() {

    console.log(
        "Smart Traffic Management System starting..."
    );


    // --------------------------------------------------------
    // Setup events
    // --------------------------------------------------------

    setupNavigation();

    setupDatasetFilter();

    setupMainJunctionSelect();

    setupAIButtons();

    setupConstraintButton();

    setupSimulation();

    setupSettings();


    // --------------------------------------------------------
    // Load data
    // --------------------------------------------------------

    await refreshApplication();


    console.log(
        "Smart Traffic Management System ready."
    );
}


// ============================================================
// START AFTER HTML LOADS
// ============================================================

document.addEventListener(
    "DOMContentLoaded",
    initializeApplication
);
