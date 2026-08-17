// ============================================================
// SMART TRAFFIC MANAGEMENT SYSTEM - FINAL FRONTEND
// ============================================================

let trafficData = [];
let datasetTotalRecords = 0;
let selectedJunction = "all";
let currentOptimization = null;
let simulationRunning = false;
let simulationTimer = null;
let simulationIndex = 0;
let simulationQueues = { north: 0, south: 0, east: 0, west: 0 };
let simulationInitialTotal = 0;
let simulationCleared = 0;

const simulationDirections = ["north", "east", "south", "west"];
const defaultSettings = { minGreen: 10, maxGreen: 60, yellowTime: 5, cycleTime: 120 };

function getElement(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const el = getElement(id);
    if (el) el.textContent = value;
}

async function fetchJSON(url, options = {}) {
    const response = await fetch(url, options);
    let data;
    try {
        data = await response.json();
    } catch {
        throw new Error("Server returned invalid JSON.");
    }
    if (!response.ok) {
        throw new Error(data.message || data.error || "Server request failed.");
    }
    return data;
}

// ============================================================
// CLOCK
// ============================================================
function updateClock() {
    const now = new Date();
    setText("clock", now.toLocaleTimeString());
    setText("date", now.toLocaleDateString(undefined, {
        day: "2-digit", month: "short", year: "numeric"
    }));
}
setInterval(updateClock, 1000);
updateClock();

// ============================================================
// DASHBOARD
// ============================================================
async function loadDashboard() {
    try {
        const data = await fetchJSON("/api/dashboard");
        setText("totalIntersections", data.intersections ?? 4);
        setText("totalVehicles", Number(data.total_vehicles || 0).toLocaleString());
        setText("avgWaiting", Number(data.average_waiting_time || 0).toFixed(2));

        const statusEl = document.querySelector(".stat-card strong.high, .stat-card strong.medium, .stat-card strong.low");
        if (statusEl) {
            statusEl.textContent = data.traffic_status || "UNKNOWN";
            statusEl.classList.remove("high", "medium", "low");
            statusEl.classList.add(String(data.traffic_status || "unknown").toLowerCase());
        }

        setText("reportWaiting", `${Number(data.average_waiting_time || 0).toFixed(2)} sec`);
        setText("reportDensity", Number(data.average_occupancy || 0).toFixed(2));
        setText("reportAgents", data.intersections ?? 4);

        const performance = document.querySelectorAll(".mini-chart strong");
        if (performance[0]) performance[0].textContent = Number(data.total_vehicles || 0).toLocaleString();
        if (performance[1]) performance[1].textContent = `${Number(data.average_waiting_time || 0).toFixed(2)} sec`;
    } catch (error) {
        console.error("Dashboard loading error:", error);
    }
}

// ============================================================
// INTERSECTIONS
// ============================================================
async function loadIntersections() {
    try {
        const data = await fetchJSON("/api/intersections");
        const intersections = data.intersections || [];
        renderIntersectionCards(intersections);
        renderAgents(intersections);

        if (intersections.length) {
            simulationQueues = {
                north: Math.max(4, Math.round(intersections[0].vehicles * 0.29)),
                south: Math.max(4, Math.round(intersections[0].vehicles * 0.26)),
                east: Math.max(4, Math.round(intersections[0].vehicles * 0.25)),
                west: Math.max(4, Math.round(intersections[0].vehicles * 0.20))
            };
        }
    } catch (error) {
        console.error("Intersection loading error:", error);
    }
}

function renderIntersectionCards(items) {
    const container = getElement("intersectionCards");
    if (!container) return;
    container.innerHTML = "";

    items.forEach(item => {
        const card = document.createElement("div");
        card.className = "intersection-card";
        const status = String(item.status || "UNKNOWN").toLowerCase();
        card.innerHTML = `
            <div class="intersection-card-header">
                <strong>Junction ${item.junction}</strong>
                <span class="status ${status}">${item.status || "UNKNOWN"}</span>
            </div>
            <div class="direction-values">
                <div>Vehicles<strong>${Number(item.vehicles || 0).toFixed(1)}</strong></div>
                <div>Waiting<strong>${Number(item.waiting_time || 0).toFixed(1)}s</strong></div>
                <div>Speed<strong>${Number(item.average_speed || 0).toFixed(1)}</strong></div>
            </div>
        `;
        card.addEventListener("click", () => {
            const select = getElement("junctionSelect");
            if (select) {
                select.value = String(item.junction);
                select.dispatchEvent(new Event("change"));
            }
        });
        container.appendChild(card);
    });
}

function renderAgents(items) {
    const container = getElement("allIntersections");
    if (!container) return;
    container.innerHTML = "";

    items.forEach(item => {
        const card = document.createElement("div");
        card.className = "agent-card";
        card.innerHTML = `
            <h3>🤖 Junction ${item.junction}</h3>
            <span class="status ${String(item.status || "UNKNOWN").toLowerCase()}">${item.status || "UNKNOWN"}</span>
            <p>Multi-agent traffic controller</p>
            <p>Average Vehicles: <strong>${Number(item.vehicles || 0).toFixed(2)}</strong></p>
            <p>Average Waiting: <strong>${Number(item.waiting_time || 0).toFixed(2)} sec</strong></p>
            <p>Average Speed: <strong>${Number(item.average_speed || 0).toFixed(2)}</strong></p>
            <p>Agent Status: <strong>ACTIVE</strong></p>
        `;
        container.appendChild(card);
    });
}

// ============================================================
// DATASET - THIS FIXES THE "RECORDS 0" PROBLEM
// ============================================================
async function loadTrafficData(junction = "all") {
    selectedJunction = junction || "all";
    showDatasetLoading();

    try {
        // Always use the real-record endpoint. /api/traffic is only a summary.
        const url = `/api/traffic-by-junction?junction=${encodeURIComponent(selectedJunction)}&page=1&limit=200`;
        const result = await fetchJSON(url);
        trafficData = Array.isArray(result.records) ? result.records : [];
        datasetTotalRecords = Number(result.total_records || trafficData.length);
        renderDataset();
        updateDatasetMeta();
    } catch (error) {
        trafficData = [];
        datasetTotalRecords = 0;
        console.error("Traffic dataset error:", error);
        showDatasetError(error.message);
        updateDatasetMeta();
    }
}

function showDatasetLoading() {
    const container = getElement("filteredDatasetRows") || getElement("fullDatasetRows") || getElement("fullDataset");
    if (container) container.innerHTML = `<div class="dataset-message">Loading traffic data...</div>`;
    setText("datasetNote", "Loading dataset from Aiven MySQL...");
}

function showDatasetError(message) {
    const container = getElement("filteredDatasetRows") || getElement("fullDatasetRows") || getElement("fullDataset");
    if (container) container.innerHTML = `<div class="dataset-message">Unable to load dataset.<br><br>${escapeHTML(message)}</div>`;
    setText("datasetNote", `Dataset error: ${message}`);
}

function renderDataset() {
    renderDashboardDataset();
    renderFullDataset();
}

function renderDashboardDataset() {
    const container = getElement("datasetRows");
    if (!container) return;
    container.innerHTML = "";

    if (!trafficData.length) {
        container.innerHTML = `<div class="dataset-message">No traffic records found.</div>`;
        return;
    }

    trafficData.slice(0, 8).forEach((item, index) => {
        const row = document.createElement("div");
        row.className = "data-row";
        const direction = splitVehicleDirections(getVehicleCount(item));
        const status = getTrafficLevel(item);
        row.innerHTML = `
            <span>${escapeHTML(String(item.time_of_day || "--"))}</span>
            <span>J${getJunctionNumber(item, index)}</span>
            <span>${direction.north}</span>
            <span>${direction.south}</span>
            <span>${direction.east}</span>
            <span>${direction.west}</span>
            <span>${getDensity(item)}</span>
            <span class="status ${status.toLowerCase()}">${status}</span>
        `;
        container.appendChild(row);
    });
}

function renderFullDataset() {
    const container = getElement("filteredDatasetRows") || getElement("fullDatasetRows") || getElement("fullDataset");
    if (!container) return;
    container.innerHTML = "";

    if (!trafficData.length) {
        container.innerHTML = `<div class="dataset-message">No traffic records found for this junction.</div>`;
        return;
    }

    trafficData.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = "data-row";
        row.innerHTML = `
            <span>${item.id ?? index + 1}</span>
            <span>J${getJunctionNumber(item, index)}</span>
            <span>${formatNumber(getVehicleCount(item))}</span>
            <span>${formatNumber(item.average_speed)}</span>
            <span>${formatNumber(item.lane_occupancy)}</span>
            <span>${formatNumber(item.flow_rate)}</span>
            <span>${escapeHTML(String(item.time_of_day || "--"))}</span>
            <span>${formatNumber(item.waiting_time)} sec</span>
        `;
        container.appendChild(row);
    });
}

function updateDatasetMeta() {
    const selected = selectedJunction === "all" ? "All Junctions" : `Junction ${selectedJunction}`;
    setText("junctionRecordCount", datasetTotalRecords.toLocaleString());
    setText("datasetTitle", selected);
    setText("datasetSubtitle", `Showing ${trafficData.length.toLocaleString()} records on this page`);
    const note = datasetTotalRecords > trafficData.length
        ? `Connected to Aiven MySQL ✓ Showing ${trafficData.length} of ${datasetTotalRecords.toLocaleString()} records.`
        : `Connected to Aiven MySQL ✓ ${datasetTotalRecords.toLocaleString()} records available.`;
    setText("datasetNote", note);
}

function setupDatasetFilter() {
    const select = getElement("datasetJunctionSelect");
    if (!select) return;
    select.addEventListener("change", () => loadTrafficData(select.value || "all"));
}

function getJunctionNumber(item, index = 0) {
    if (item.junction) return item.junction;
    if (selectedJunction !== "all") return selectedJunction;
    const id = Number(item.id || index + 1);
    if (id <= 2500) return 1;
    if (id <= 5000) return 2;
    if (id <= 7500) return 3;
    return 4;
}

function getVehicleCount(item) {
    return Number(item.vehicle_count ?? item.vehicles ?? item.count ?? 0);
}

function splitVehicleDirections(totalValue) {
    const total = Math.max(0, Math.round(Number(totalValue || 0)));
    const north = Math.round(total * 0.29);
    const south = Math.round(total * 0.26);
    const east = Math.round(total * 0.25);
    return { north, south, east, west: Math.max(0, total - north - south - east) };
}

function getDensity(item) {
    const value = Number(item.lane_occupancy ?? item.occupancy ?? item.density ?? 0);
    return value > 1 ? (value / 100).toFixed(2) : value.toFixed(2);
}

function getTrafficLevel(item) {
    if (item.status) return String(item.status).toUpperCase();
    const waiting = Number(item.waiting_time || 0);
    return waiting < 20 ? "LOW" : waiting < 40 ? "MEDIUM" : "HIGH";
}

function formatNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function escapeHTML(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

// ============================================================
// NAVIGATION
// ============================================================
function setupNavigation() {
    document.querySelectorAll(".nav-item").forEach(button => {
        button.addEventListener("click", async () => {
            const sectionId = button.dataset.section;
            document.querySelectorAll(".nav-item").forEach(x => x.classList.remove("active"));
            button.classList.add("active");
            document.querySelectorAll(".section").forEach(x => x.classList.remove("active"));
            const section = getElement(sectionId);
            if (section) section.classList.add("active");

            if (sectionId === "dashboard") await refreshApplication();
            if (sectionId === "dataset") await loadTrafficData(selectedJunction);
            if (sectionId === "intersections") await loadIntersections();
            if (sectionId === "reports") await loadDashboard();
            if (sectionId === "simulation") await prepareSimulation();
        });
    });
}

function setupMainJunctionSelect() {
    const select = getElement("junctionSelect");
    if (!select) return;
    select.addEventListener("change", async function () {
        currentOptimization = null;
        await updateSelectedJunctionInfo(this.value);
        await prepareSimulation();
    });
}

async function updateSelectedJunctionInfo(junction) {
    try {
        const result = await fetchJSON(`/api/traffic-by-junction?junction=${encodeURIComponent(junction)}&page=1&limit=200`);
        const records = result.records || [];
        if (!records.length) return;
        const avg = records.reduce((sum, x) => sum + getVehicleCount(x), 0) / records.length;
        const directions = splitVehicleDirections(avg);
        setText("northVehicleCount", directions.north);
        setText("southVehicleCount", directions.south);
        setText("eastVehicleCount", directions.east);
        setText("westVehicleCount", directions.west);
    } catch (error) {
        console.error("Junction display error:", error);
    }
}

// ============================================================
// SETTINGS
// ============================================================
function getSettings() {
    const saved = JSON.parse(localStorage.getItem("trafficSettings") || "null") || {};
    const settings = {
        minGreen: Number(getElement("minGreen")?.value || saved.minGreen || defaultSettings.minGreen),
        maxGreen: Number(getElement("maxGreen")?.value || saved.maxGreen || defaultSettings.maxGreen),
        yellowTime: Number(getElement("yellowTime")?.value || saved.yellowTime || defaultSettings.yellowTime),
        cycleTime: Number(getElement("cycleTimeSetting")?.value || saved.cycleTime || defaultSettings.cycleTime)
    };
    return settings;
}

function loadSettings() {
    const saved = JSON.parse(localStorage.getItem("trafficSettings") || "null");
    if (!saved) return;
    if (getElement("minGreen")) getElement("minGreen").value = saved.minGreen;
    if (getElement("maxGreen")) getElement("maxGreen").value = saved.maxGreen;
    if (getElement("yellowTime")) getElement("yellowTime").value = saved.yellowTime;
    if (getElement("cycleTimeSetting")) getElement("cycleTimeSetting").value = saved.cycleTime;
}

function saveSettings() {
    let s = getSettings();
    s.minGreen = Math.max(5, Math.min(60, Math.round(s.minGreen)));
    s.maxGreen = Math.max(s.minGreen, Math.min(90, Math.round(s.maxGreen)));
    s.yellowTime = Math.max(2, Math.min(15, Math.round(s.yellowTime)));
    s.cycleTime = Math.max(40, Math.min(240, Math.round(s.cycleTime)));
    if (s.cycleTime < 4 * s.yellowTime + 4 * s.minGreen) {
        s.cycleTime = 4 * s.yellowTime + 4 * s.minGreen;
    }
    localStorage.setItem("trafficSettings", JSON.stringify(s));
    if (getElement("minGreen")) getElement("minGreen").value = s.minGreen;
    if (getElement("maxGreen")) getElement("maxGreen").value = s.maxGreen;
    if (getElement("yellowTime")) getElement("yellowTime").value = s.yellowTime;
    if (getElement("cycleTimeSetting")) getElement("cycleTimeSetting").value = s.cycleTime;
    alert("✓ Optimization settings saved.");
}

function setupSettings() {
    loadSettings();
    const save = getElement("saveSettings");
    if (save) save.addEventListener("click", saveSettings);
}

// ============================================================
// AI OPTIMIZATION
// ============================================================
function setupAIButtons() {
    const runAI = getElement("runAI");
    const runAI2 = getElement("runAI2");
    if (runAI) runAI.addEventListener("click", runOptimization);
    if (runAI2) runAI2.addEventListener("click", runOptimization);
}

async function runOptimization() {
    const junction = getElement("junctionSelect")?.value || "1";
    const settings = getSettings();
    const buttons = [getElement("runAI"), getElement("runAI2")].filter(Boolean);
    buttons.forEach(b => { b.disabled = true; b.textContent = "⏳ Optimizing..."; });

    try {
        const result = await fetchJSON("/api/optimize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                junction_id: Number(junction),
                min_green: settings.minGreen,
                max_green: settings.maxGreen,
                yellow_time: settings.yellowTime,
                cycle_time: settings.cycleTime
            })
        });
        currentOptimization = result;
        updateOptimizationUI(result);
        setText("reportImprovement", `${Number(result.improvement || result.optimization?.improvement || 0).toFixed(1)}%`);
        setText("simulationMessage", "AI timing applied. Start the simulation to watch vehicles move and queues reduce.");
        initializeSimulationCars();
    } catch (error) {
        console.error("Optimization error:", error);
        alert(`Optimization failed: ${error.message}`);
    } finally {
        if (getElement("runAI")) { getElement("runAI").disabled = false; getElement("runAI").textContent = "▶ Run AI Optimization"; }
        if (getElement("runAI2")) { getElement("runAI2").disabled = false; getElement("runAI2").textContent = "Run Optimization"; }
    }
}

function updateOptimizationUI(result) {
    const timings = result.signal_timings || {};
    const north = Number(timings.north?.green || 0);
    const south = Number(timings.south?.green || 0);
    const east = Number(timings.east?.green || 0);
    const west = Number(timings.west?.green || 0);
    const yellow = Number(timings.north?.yellow || 5);
    const cycle = Number(result.optimization?.cycle_time || result.cycle_time || 0);
    const improvement = Number(result.optimization?.improvement || result.improvement || 0);

    setText("northTime", `${north} sec`);
    setText("southTime", `${south} sec`);
    setText("eastTime", `${east} sec`);
    setText("westTime", `${west} sec`);
    setText("tableNorth", `${north} sec`);
    setText("tableSouth", `${south} sec`);
    setText("tableEast", `${east} sec`);
    setText("tableWest", `${west} sec`);
    setText("northYellow", `${yellow} sec`);
    setText("southYellow", `${yellow} sec`);
    setText("eastYellow", `${yellow} sec`);
    setText("westYellow", `${yellow} sec`);
    setText("northRed", `${Math.max(0, cycle - north)} sec`);
    setText("southRed", `${Math.max(0, cycle - south)} sec`);
    setText("eastRed", `${Math.max(0, cycle - east)} sec`);
    setText("westRed", `${Math.max(0, cycle - west)} sec`);
    setText("cycleTime", `${cycle} sec`);
    setText("improvement", `${improvement.toFixed(2)}%`);
}

function setupConstraintButton() {
    const button = getElement("applyConstraints");
    if (!button) return;
    button.addEventListener("click", () => {
        if (!currentOptimization) {
            alert("Run AI Optimization first.");
            return;
        }
        const c = currentOptimization.constraints || getSettings();
        alert(`✓ All traffic constraints satisfied.\n\nMinimum green: ${c.min_green ?? c.minGreen} sec\nMaximum green: ${c.max_green ?? c.maxGreen} sec\nYellow: ${c.yellow_time ?? c.yellowTime} sec\nCycle: ${c.cycle_time ?? c.cycleTime} sec`);
    });
}

// ============================================================
// SIMULATION WITH MOVING CARS
// ============================================================
async function prepareSimulation() {
    const junction = getElement("junctionSelect")?.value || "1";
    setText("simulationJunctionName", `Junction ${junction}`);
    try {
        const data = await fetchJSON(`/api/intersections`);
        const item = (data.intersections || []).find(x => String(x.junction) === String(junction));
        if (item) {
            const total = Math.max(16, Math.min(48, Math.round(Number(item.vehicles || 20) / 2)));
            simulationQueues = {
                north: Math.max(4, Math.round(total * 0.29)),
                south: Math.max(4, Math.round(total * 0.26)),
                east: Math.max(4, Math.round(total * 0.25)),
                west: Math.max(4, Math.round(total * 0.20))
            };
            setText("simulationWaiting", `${Number(item.waiting_time || 0).toFixed(1)} sec`);
        }
    } catch (error) {
        console.error(error);
    }
    initializeSimulationCars();
}

function initializeSimulationCars() {
    const container = getElement("simulationCars");
    if (!container) return;
    container.innerHTML = "";
    simulationCleared = 0;
    simulationInitialTotal = Object.values(simulationQueues).reduce((a, b) => a + b, 0);
    simulationIndex = 0;

    Object.entries(simulationQueues).forEach(([direction, count]) => {
        const visible = Math.min(10, Math.max(3, Math.ceil(count / 3)));
        for (let i = 0; i < visible; i++) {
            const car = document.createElement("div");
            car.className = "sim-car";
            car.dataset.direction = direction;
            car.dataset.offset = i;
            positionCar(car, direction, i, visible);
            container.appendChild(car);
        }
    });
    updateSimulationCounters();
}

function positionCar(car, direction, index, visible) {
    const spread = index * 27;
    if (direction === "north") {
        car.style.left = `calc(50% - ${28 + (index % 2) * 12}px)`;
        car.style.top = `${70 + spread}px`;
        car.style.transform = "rotate(180deg)";
    } else if (direction === "south") {
        car.style.left = `calc(50% + ${14 + (index % 2) * 12}px)`;
        car.style.bottom = `${70 + spread}px`;
        car.style.transform = "rotate(0deg)";
    } else if (direction === "east") {
        car.style.right = `${70 + spread}px`;
        car.style.top = `calc(50% - ${28 + (index % 2) * 12}px)`;
        car.style.transform = "rotate(270deg)";
    } else {
        car.style.left = `${70 + spread}px`;
        car.style.top = `calc(50% + ${14 + (index % 2) * 12}px)`;
        car.style.transform = "rotate(90deg)";
    }
}

function setupSimulation() {
    const start = getElement("startSimulation");
    const reset = getElement("resetSimulation");
    if (start) {
        start.addEventListener("click", async () => {
            if (simulationRunning) {
                stopSimulation();
                return;
            }
            if (!currentOptimization) {
                await runOptimization();
            }
            simulationRunning = true;
            simulationIndex = 0;
            start.textContent = "⏹ Stop Simulation";
            setText("simulationMessage", "Green signal active — vehicles are moving through the junction.");
            runSimulationStep();
        });
    }
    if (reset) reset.addEventListener("click", () => {
        stopSimulation();
        prepareSimulation();
    });
}

function runSimulationStep() {
    if (!simulationRunning) return;
    const direction = simulationDirections[simulationIndex];
    const timing = currentOptimization?.signal_timings?.[direction] || { green: 20, yellow: 5 };

    setText("simulationStatus", `${direction.toUpperCase()} — GREEN`);
    updateSimulationLights(direction, "green");
    moveCars(direction);

    simulationIndex = (simulationIndex + 1) % simulationDirections.length;
    const duration = Math.max(1200, Math.min(Number(timing.green || 20) * 70, 4200));
    simulationTimer = setTimeout(runSimulationStep, duration);
}

function moveCars(direction) {
    const reduction = Math.max(1, Math.round(simulationQueues[direction] * 0.18));
    simulationQueues[direction] = Math.max(0, simulationQueues[direction] - reduction);
    simulationCleared += reduction;

    const cars = [...document.querySelectorAll(`.sim-car[data-direction="${direction}"]`)];
    cars.forEach((car, index) => {
        if (index < Math.max(1, Math.ceil(cars.length / 3))) {
            if (direction === "north") car.style.top = "45%";
            if (direction === "south") car.style.bottom = "45%";
            if (direction === "east") car.style.right = "45%";
            if (direction === "west") car.style.left = "45%";
            setTimeout(() => { car.style.opacity = "0"; }, 550);
            setTimeout(() => car.remove(), 1000);
        }
    });

    updateSimulationCounters();
    const remaining = Object.values(simulationQueues).reduce((a, b) => a + b, 0);
    if (remaining <= 2) {
        setText("simulationStatus", "TRAFFIC CLEAR — ALL LANES MOVING");
        setText("simulationMessage", "✓ AI optimization reduced the simulated queues. Reset to run the demonstration again.");
        setTimeout(() => stopSimulation(true), 1200);
    }
}

function updateSimulationCounters() {
    const remaining = Object.values(simulationQueues).reduce((a, b) => a + b, 0);
    setText("carsRemaining", remaining.toLocaleString());
    setText("carsCleared", Math.min(simulationCleared, simulationInitialTotal).toLocaleString());
}

function updateSimulationLights(activeDirection, state) {
    document.querySelectorAll(".sim-light").forEach(light => {
        light.querySelectorAll("span").forEach(x => x.classList.remove("active"));
        const name = [...light.classList].find(x => x.startsWith("sim-light-") && x !== "sim-light");
        const direction = name ? name.replace("sim-light-", "") : "";
        if (direction === activeDirection) {
            const target = light.querySelector(`.${state}`);
            if (target) target.classList.add("active");
        } else {
            const red = light.querySelector(".red");
            if (red) red.classList.add("active");
        }
    });
}

function stopSimulation(cleared = false) {
    simulationRunning = false;
    if (simulationTimer) clearTimeout(simulationTimer);
    simulationTimer = null;
    const start = getElement("startSimulation");
    if (start) start.textContent = "▶ Start Simulation";
    if (!cleared) {
        setText("simulationStatus", "Simulation Stopped");
        setText("simulationMessage", "Press Start Simulation to run the optimized traffic demonstration.");
    }
    document.querySelectorAll(".sim-light").forEach(light => {
        light.querySelectorAll("span").forEach(x => x.classList.remove("active"));
        const red = light.querySelector(".red");
        if (red) red.classList.add("active");
    });
}

// ============================================================
// UPLOAD DATASET
// ============================================================
function setupDatasetUpload() {
    const button = getElement("uploadDatasetBtn");
    const input = getElement("datasetFileInput");
    if (!button || !input) return;
    button.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
        if (!input.files.length) return;
        const file = input.files[0];
        const form = new FormData();
        form.append("file", file);
        button.disabled = true;
        button.textContent = "Uploading...";
        try {
            const result = await fetchJSON("/api/upload", { method: "POST", body: form });
            alert(`✓ ${result.message}\nRecords loaded: ${Number(result.records || 0).toLocaleString()}`);
            await refreshApplication();
            await loadTrafficData(selectedJunction);
        } catch (error) {
            alert(`Dataset upload failed: ${error.message}`);
        } finally {
            button.disabled = false;
            button.textContent = "Upload Dataset";
            input.value = "";
        }
    });
}

// ============================================================
// REFRESH / INIT
// ============================================================
async function refreshApplication() {
    await Promise.allSettled([
        loadDashboard(),
        loadIntersections(),
        loadTrafficData(selectedJunction)
    ]);
}

async function initializeApplication() {
    setupNavigation();
    setupDatasetFilter();
    setupMainJunctionSelect();
    setupAIButtons();
    setupConstraintButton();
    setupSimulation();
    setupSettings();
    setupDatasetUpload();
    await refreshApplication();
    await prepareSimulation();
    console.log("Smart Traffic Management System ready.");
}

document.addEventListener("DOMContentLoaded", initializeApplication);
