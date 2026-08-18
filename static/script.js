document.addEventListener("DOMContentLoaded", () => {
    // Navigation State
    const navItems = document.querySelectorAll(".nav-item");
    const views = document.querySelectorAll(".content-view");
    const pageTitle = document.getElementById("page-title");

    let currentDatasetPage = 1;
    let currentDatasetJunction = "all";

    // View Navigation Handler
    navItems.forEach(item => {
        item.addEventListener("click", () => {
            navItems.forEach(n => n.classList.remove("active"));
            views.forEach(v => v.classList.remove("active"));

            item.classList.add("active");
            const targetView = item.getAttribute("data-view");
            document.getElementById(`view-${targetView}`).classList.add("active");
            pageTitle.innerText = item.innerText.trim();

            if (targetView === "dataset") loadDataset(1);
            if (targetView === "intersections") loadIntersections();
            if (targetView === "reports") loadReports();
            if (targetView === "settings") loadSettings();
            if (targetView === "simulation") loadSimJunctionConfig();
        });
    });

    // 1. DASHBOARD & GLOBAL STATS
    async function loadDashboardStats() {
        try {
            const [statsRes, trafficRes] = await Promise.all([
                fetch("/api/statistics"),
                fetch("/api/traffic")
            ]);
            const stats = await statsRes.json();
            const traffic = await trafficRes.json();

            if (stats.status === "success") {
                document.getElementById("dash-intersections").innerText = stats.intersections;
                document.getElementById("dash-vehicles").innerText = Number(stats.vehicles).toLocaleString();
                document.getElementById("dash-waiting").innerText = `${stats.waiting}s`;
            }

            if (Array.isArray(traffic)) {
                renderJunctions("dash-junctions-container", traffic);
            }
        } catch (err) {
            console.error("Dashboard load failed:", err);
        }
    }

    function renderJunctions(containerId, data) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = data.map(j => `
            <div class="junction-card">
                <div class="junction-card-header">
                    <h4>${j.name}</h4>
                    <span class="badge-accent">${j.status}</span>
                </div>
                <p>Vehicles: <strong>${j.average_vehicles}</strong></p>
                <p>Waiting Time: <strong>${j.waiting_time}s</strong></p>
                <p>Avg Speed: <strong>${j.average_speed} km/h</strong></p>
                <p>Density: <strong>${j.density}%</strong></p>
            </div>
        `).join("");
    }

    // 2. DATASET TABLE & PAGINATION
    async function loadDataset(page = 1) {
        currentDatasetPage = page;
        const tbody = document.getElementById("dataset-table-body");
        tbody.innerHTML = `<tr><td colspan="8" class="text-center">Loading dataset...</td></tr>`;

        try {
            const res = await fetch(`/api/dataset?page=${page}&per_page=50&junction=${currentDatasetJunction}`);
            const json = await res.json();

            if (json.status === "success" && json.data.length > 0) {
                document.getElementById("dataset-records-total").innerText = json.total_records.toLocaleString();
                document.getElementById("page-indicator").innerText = `Page ${json.page} of ${json.total_pages}`;

                tbody.innerHTML = json.data.map(r => `
                    <tr>
                        <td>${r.id}</td>
                        <td>${r.junction}</td>
                        <td>${r.vehicle_count}</td>
                        <td>${r.average_speed}</td>
                        <td>${r.lane_occupancy}%</td>
                        <td>${r.flow_rate}</td>
                        <td>${r.time_of_day || 'N/A'}</td>
                        <td>${r.waiting_time}</td>
                    </tr>
                `).join("");

                document.getElementById("page-prev-btn").disabled = (json.page <= 1);
                document.getElementById("page-next-btn").disabled = (json.page >= json.total_pages);
            } else {
                tbody.innerHTML = `<tr><td colspan="8" class="text-center">No records found.</td></tr>`;
                document.getElementById("dataset-records-total").innerText = "0";
            }
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Failed to fetch database records.</td></tr>`;
            console.error("Dataset API Error:", err);
        }
    }

    document.getElementById("dataset-junction-select")?.addEventListener("change", (e) => {
        currentDatasetJunction = e.target.value;
        loadDataset(1);
    });

    document.getElementById("page-prev-btn")?.addEventListener("click", () => {
        if (currentDatasetPage > 1) loadDataset(currentDatasetPage - 1);
    });

    document.getElementById("page-next-btn")?.addEventListener("click", () => {
        loadDataset(currentDatasetPage + 1);
    });

    // 3. INTERSECTIONS PAGE
    async function loadIntersections() {
        try {
            const res = await fetch("/api/traffic");
            const data = await res.json();
            if (Array.isArray(data)) renderJunctions("intersections-page-container", data);
        } catch (e) {
            console.error(e);
        }
    }

    // 4. DYNAMIC OPTIMIZATION & DASHBOARD LIVE INTERSECTION SYNC
    async function executeOptimization(junctionId = 1, timeOfDay = "all") {
        try {
            const res = await fetch(`/api/optimize?junction=${junctionId}&time_of_day=${timeOfDay}`);
            const result = await res.json();

            if (result.status === "success") {
                const optCycle = document.getElementById("opt-cycle-disp");
                const optImpr = document.getElementById("opt-impr-disp");
                if (optCycle) optCycle.innerText = `${result.cycle_time}s`;
                if (optImpr) optImpr.innerText = `+${result.improvement}%`;

                // Update Dashboard summary tags
                const dashOptCycle = document.getElementById("dash-opt-cycle");
                const dashOptImpr = document.getElementById("dash-opt-impr");
                if (dashOptCycle) dashOptCycle.innerText = `${result.cycle_time} sec`;
                if (dashOptImpr) dashOptImpr.innerText = `+${result.improvement}%`;

                // Update Crossroad live direction timers
                if (document.getElementById("sig-N")) document.getElementById("sig-N").innerText = `${result.signals.North.green} sec`;
                if (document.getElementById("sig-S")) document.getElementById("sig-S").innerText = `${result.signals.South.green} sec`;
                if (document.getElementById("sig-E")) document.getElementById("sig-E").innerText = `${result.signals.East.green} sec`;
                if (document.getElementById("sig-W")) document.getElementById("sig-W").innerText = `${result.signals.West.green} sec`;

                // Update Dashboard Timings Table
                if (document.getElementById("tbl-n-g")) document.getElementById("tbl-n-g").innerText = `${result.signals.North.green} sec`;
                if (document.getElementById("tbl-s-g")) document.getElementById("tbl-s-g").innerText = `${result.signals.South.green} sec`;
                if (document.getElementById("tbl-e-g")) document.getElementById("tbl-e-g").innerText = `${result.signals.East.green} sec`;
                if (document.getElementById("tbl-w-g")) document.getElementById("tbl-w-g").innerText = `${result.signals.West.green} sec`;

                // Update AI Optimization page table
                const tbody = document.getElementById("opt-table-body");
                if (tbody) {
                    tbody.innerHTML = Object.entries(result.signals).map(([dir, plan]) => `
                        <tr>
                            <td><strong>${dir}</strong></td>
                            <td class="text-success">${plan.green} sec</td>
                            <td>${plan.yellow} sec</td>
                            <td>${plan.red} sec</td>
                        </tr>
                    `).join("");
                }
            }
            return result;
        } catch (e) {
            console.error("Optimization execution failed:", e);
            return null;
        }
    }

    // Dashboard Dropdown Listeners
    const dashJunctionSelect = document.getElementById("dash-junction-select");
    const dashTimeSelect = document.getElementById("dash-time-select");

    function triggerDashboardOpt() {
        const jId = dashJunctionSelect ? dashJunctionSelect.value : 1;
        const tod = dashTimeSelect ? dashTimeSelect.value : "all";
        executeOptimization(jId, tod);
    }

    dashJunctionSelect?.addEventListener("change", triggerDashboardOpt);
    dashTimeSelect?.addEventListener("change", triggerDashboardOpt);
    document.getElementById("dash-opt-btn")?.addEventListener("click", triggerDashboardOpt);

    // AI Optimization View Listeners
    document.getElementById("run-opt-btn")?.addEventListener("click", () => {
        const jId = document.getElementById("opt-junction-select")?.value || 1;
        const tod = document.getElementById("opt-time-select")?.value || "all";
        executeOptimization(jId, tod);
    });

    // 5. MICROSCOPIC TRAFFIC SIMULATION ENGINE
    const canvas = document.getElementById("trafficCanvas");
    const ctx = canvas ? canvas.getContext("2d") : null;
    let simAnimationId = null;
    let simRunning = false;
    let simTimerInterval = null;

    let simSpawnRate = 0.05;
    let phases = [
        { dir: "NORTH", duration: 8, color: "#06d6a0" },
        { dir: "NORTH_Y", duration: 2, color: "#ffd166" },
        { dir: "SOUTH", duration: 6, color: "#06d6a0" },
        { dir: "SOUTH_Y", duration: 2, color: "#ffd166" },
        { dir: "EAST", duration: 4, color: "#06d6a0" },
        { dir: "EAST_Y", duration: 2, color: "#ffd166" },
        { dir: "WEST", duration: 3, color: "#06d6a0" },
        { dir: "WEST_Y", duration: 2, color: "#ffd166" }
    ];

    let currentPhaseIndex = 0;
    let phaseTimeRemaining = phases[0].duration;
    let vehiclesList = [];

    class Vehicle {
        constructor(direction) {
            this.direction = direction;
            this.speed = 2.0;
            this.length = 18;
            this.width = 10;
            this.crossed = false;

            if (direction === "NORTH") { this.x = 335; this.y = 0; this.vx = 0; this.vy = this.speed; }
            if (direction === "SOUTH") { this.x = 355; this.y = 500; this.vx = 0; this.vy = -this.speed; }
            if (direction === "EAST")  { this.x = 0; this.y = 265; this.vx = this.speed; this.vy = 0; }
            if (direction === "WEST")  { this.x = 700; this.y = 235; this.vx = -this.speed; this.vy = 0; }
        }

        update(activeDirection) {
            const canPass = activeDirection.startsWith(this.direction);
            
            const nearStopLine = (
                (this.direction === "NORTH" && this.y >= 200 && this.y <= 215) ||
                (this.direction === "SOUTH" && this.y <= 295 && this.y >= 280) ||
                (this.direction === "EAST" && this.x >= 300 && this.x <= 315) ||
                (this.direction === "WEST" && this.x <= 395 && this.x >= 380)
            );

            if (nearStopLine && !canPass && !this.crossed) {
                // Halt at stop line
            } else {
                this.x += this.vx;
                this.y += this.vy;
                if (this.x > 320 && this.x < 380 && this.y > 210 && this.y < 290) {
                    this.crossed = true;
                }
            }
        }

        draw(ctx) {
            ctx.fillStyle = this.crossed ? "#48cae4" : "#ef476f";
            ctx.fillRect(this.x - this.width/2, this.y - this.length/2, this.width, this.length);
        }
    }

    async function loadSimJunctionConfig() {
        const jId = document.getElementById("sim-junction-select")?.value || 1;
        const tod = document.getElementById("sim-time-select")?.value || "all";
        try {
            const [optRes, trafficRes] = await Promise.all([
                fetch(`/api/optimize?junction=${jId}&time_of_day=${tod}`),
                fetch("/api/traffic")
            ]);
            const optData = await optRes.json();
            const trafficData = await trafficRes.json();

            const jTraffic = trafficData.find(j => j.id == jId) || trafficData[0];
            simSpawnRate = Math.min(0.09, Math.max(0.03, (jTraffic.density / 100) * 0.1));
            
            if (document.getElementById("sim-junction-stats")) {
                document.getElementById("sim-junction-stats").innerText = 
                    `Junction ${jId} (${tod}): Avg Vehicles: ${jTraffic.average_vehicles} | Density: ${jTraffic.density}% | Speed: ${jTraffic.average_speed} km/h`;
            }
            if (document.getElementById("sim-speed-val")) {
                document.getElementById("sim-speed-val").innerText = `${jTraffic.average_speed} km/h`;
            }

            if (optData.status === "success") {
                const s = optData.signals;
                phases = [
                    { dir: "NORTH", duration: Math.max(3, Math.round(s.North.green / 5)), color: "#06d6a0" },
                    { dir: "NORTH_Y", duration: 2, color: "#ffd166" },
                    { dir: "SOUTH", duration: Math.max(3, Math.round(s.South.green / 5)), color: "#06d6a0" },
                    { dir: "SOUTH_Y", duration: 2, color: "#ffd166" },
                    { dir: "EAST", duration: Math.max(3, Math.round(s.East.green / 5)), color: "#06d6a0" },
                    { dir: "EAST_Y", duration: 2, color: "#ffd166" },
                    { dir: "WEST", duration: Math.max(3, Math.round(s.West.green / 5)), color: "#06d6a0" },
                    { dir: "WEST_Y", duration: 2, color: "#ffd166" }
                ];
                currentPhaseIndex = 0;
                phaseTimeRemaining = phases[0].duration;
            }
        } catch (e) {
            console.error("Failed to load junction simulation config:", e);
        }
    }

    document.getElementById("sim-junction-select")?.addEventListener("change", () => {
        loadSimJunctionConfig();
        resetSimulation();
    });
    document.getElementById("sim-time-select")?.addEventListener("change", () => {
        loadSimJunctionConfig();
        resetSimulation();
    });

    function spawnTraffic() {
        if (Math.random() < simSpawnRate) {
            const dirs = ["NORTH", "SOUTH", "EAST", "WEST"];
            const chosen = dirs[Math.floor(Math.random() * dirs.length)];
            vehiclesList.push(new Vehicle(chosen));
        }
    }

    function drawIntersection() {
        if (!ctx) return;
        ctx.clearRect(0, 0, 700, 500);

        ctx.fillStyle = "#1c2541";
        ctx.fillRect(310, 0, 80, 500);
        ctx.fillRect(0, 210, 700, 80);

        ctx.fillStyle = "#232f55";
        ctx.fillRect(310, 210, 80, 80);

        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(310, 210); ctx.lineTo(390, 210);
        ctx.moveTo(310, 290); ctx.lineTo(390, 290);
        ctx.moveTo(310, 210); ctx.lineTo(310, 290);
        ctx.moveTo(390, 210); ctx.lineTo(390, 290);
        ctx.stroke();

        const currentP = phases[currentPhaseIndex];
        ctx.fillStyle = currentP.color;
        ctx.beginPath();
        ctx.arc(350, 250, 10, 0, Math.PI * 2);
        ctx.fill();
    }

    function simLoop() {
        if (!simRunning) return;
        spawnTraffic();
        drawIntersection();

        const activeDir = phases[currentPhaseIndex].dir;
        vehiclesList.forEach(v => {
            v.update(activeDir);
            v.draw(ctx);
        });

        vehiclesList = vehiclesList.filter(v => v.x >= 0 && v.x <= 700 && v.y >= 0 && v.y <= 500);
        
        const queuedCount = vehiclesList.filter(v => !v.crossed).length;
        document.getElementById("sim-queue-count").innerText = queuedCount;

        simAnimationId = requestAnimationFrame(simLoop);
    }

    function resetSimulation() {
        simRunning = false;
        clearInterval(simTimerInterval);
        cancelAnimationFrame(simAnimationId);
        vehiclesList = [];
        currentPhaseIndex = 0;
        phaseTimeRemaining = phases[0].duration;
        drawIntersection();
        document.getElementById("sim-queue-count").innerText = "0";
        document.getElementById("sim-timer").innerText = "0s";
    }

    document.getElementById("sim-start-btn")?.addEventListener("click", () => {
        if (simRunning) return;
        simRunning = true;
        simLoop();

        simTimerInterval = setInterval(() => {
            phaseTimeRemaining--;
            if (phaseTimeRemaining <= 0) {
                currentPhaseIndex = (currentPhaseIndex + 1) % phases.length;
                phaseTimeRemaining = phases[currentPhaseIndex].duration;
                const p = phases[currentPhaseIndex];
                document.getElementById("sim-active-phase").innerText = `${p.dir.replace('_', ' ')}`;
                document.getElementById("sim-active-phase").style.color = p.color;
            }
            document.getElementById("sim-timer").innerText = `${phaseTimeRemaining}s`;
        }, 1000);
    });

    document.getElementById("sim-reset-btn")?.addEventListener("click", resetSimulation);

    // 6. REPORTS & SETTINGS
    async function loadReports() {
        try {
            const res = await fetch("/api/reports");
            const r = await res.json();
            if (r.status === "success") {
                document.getElementById("rep-wait").innerText = `${r.avg_waiting_time}s`;
                document.getElementById("rep-impr").innerText = `+${r.optimization_improvement}%`;
                document.getElementById("rep-density").innerText = r.traffic_density;
                document.getElementById("rep-agents").innerText = r.active_agents;
            }
        } catch (e) { console.error(e); }
    }

    async function loadSettings() {
        try {
            const res = await fetch("/api/settings");
            const s = await res.json();
            document.getElementById("set-min-green").value = s.min_green;
            document.getElementById("set-max-green").value = s.max_green;
            document.getElementById("set-yellow").value = s.yellow_time;
            document.getElementById("set-cycle").value = s.cycle_time;
        } catch (e) { console.error(e); }
    }

    document.getElementById("settings-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const payload = {
            min_green: parseInt(document.getElementById("set-min-green").value),
            max_green: parseInt(document.getElementById("set-max-green").value),
            yellow_time: parseInt(document.getElementById("set-yellow").value),
            cycle_time: parseInt(document.getElementById("set-cycle").value)
        };
        await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        alert("Constraints saved successfully!");
        triggerDashboardOpt();
    });

    document.getElementById("refresh-global-btn")?.addEventListener("click", () => {
        loadDashboardStats();
        triggerDashboardOpt();
    });

    // Initial Dashboard Load
    loadDashboardStats();
    triggerDashboardOpt();
    drawIntersection();
});
