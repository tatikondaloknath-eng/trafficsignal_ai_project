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
            if (targetView === "reports") loadReports("all");
            if (targetView === "settings") loadSettings();
            if (targetView === "simulation") {
                const currentSimJ = document.getElementById("sim-junction-select")?.value || 1;
                loadSimJunctionConfig(currentSimJ);
            }
            if (targetView === "emergency") { resizeEmergencyCanvas(); startNetworkLoop(); refreshNetworkState(); }
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

    // 4. AI OPTIMIZATION & DASHBOARD SYNC
    async function executeOptimization(junctionId = 1) {
        try {
            const res = await fetch(`/api/optimize?junction=${junctionId}`);
            const result = await res.json();

            if (result.status === "success") {
                const optCycle = document.getElementById("opt-cycle-disp");
                const optImpr = document.getElementById("opt-impr-disp");
                if (optCycle) optCycle.innerText = `${result.cycle_time}s`;
                if (optImpr) optImpr.innerText = `+${result.improvement}%`;

                const dashOptCycle = document.getElementById("dash-opt-cycle");
                const dashOptImpr = document.getElementById("dash-opt-impr");
                if (dashOptCycle) dashOptCycle.innerText = `${result.cycle_time} sec`;
                if (dashOptImpr) dashOptImpr.innerText = `+${result.improvement}%`;

                if (document.getElementById("sig-N")) document.getElementById("sig-N").innerText = `${result.signals.North.green} sec`;
                if (document.getElementById("sig-S")) document.getElementById("sig-S").innerText = `${result.signals.South.green} sec`;
                if (document.getElementById("sig-E")) document.getElementById("sig-E").innerText = `${result.signals.East.green} sec`;
                if (document.getElementById("sig-W")) document.getElementById("sig-W").innerText = `${result.signals.West.green} sec`;

                if (document.getElementById("tbl-n-g")) document.getElementById("tbl-n-g").innerText = `${result.signals.North.green} sec`;
                if (document.getElementById("tbl-s-g")) document.getElementById("tbl-s-g").innerText = `${result.signals.South.green} sec`;
                if (document.getElementById("tbl-e-g")) document.getElementById("tbl-e-g").innerText = `${result.signals.East.green} sec`;
                if (document.getElementById("tbl-w-g")) document.getElementById("tbl-w-g").innerText = `${result.signals.West.green} sec`;

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
            console.error("Optimization failed:", e);
            return null;
        }
    }

    const dashJunctionSelect = document.getElementById("dash-junction-select");
    dashJunctionSelect?.addEventListener("change", (e) => {
        executeOptimization(e.target.value);
    });

    document.getElementById("dash-opt-btn")?.addEventListener("click", () => {
        const jId = dashJunctionSelect ? dashJunctionSelect.value : 1;
        executeOptimization(jId);
    });

    document.getElementById("run-opt-btn")?.addEventListener("click", () => {
        const jId = document.getElementById("opt-junction-select")?.value || 1;
        executeOptimization(jId);
    });

    // 5. MICROSCOPIC TRAFFIC SIMULATION ENGINE (CANVAS + DYNAMIC HUD)
    const canvas = document.getElementById("trafficCanvas");
    const ctx = canvas ? canvas.getContext("2d") : null;
    let simAnimationId = null;
    let simRunning = false;
    let simTimerInterval = null;
    let completedCycles = 1;

    let simSpawnRate = 0.06;
    let phases = [
        { dir: "NORTH", duration: 8, color: "#06d6a0", text: "NORTH GREEN" },
        { dir: "NORTH_Y", duration: 2, color: "#ffd166", text: "NORTH YELLOW" },
        { dir: "SOUTH", duration: 6, color: "#06d6a0", text: "SOUTH GREEN" },
        { dir: "SOUTH_Y", duration: 2, color: "#ffd166", text: "SOUTH YELLOW" },
        { dir: "EAST", duration: 5, color: "#06d6a0", text: "EAST GREEN" },
        { dir: "EAST_Y", duration: 2, color: "#ffd166", text: "EAST YELLOW" },
        { dir: "WEST", duration: 4, color: "#06d6a0", text: "WEST GREEN" },
        { dir: "WEST_Y", duration: 2, color: "#ffd166", text: "WEST YELLOW" }
    ];

    let currentPhaseIndex = 0;
    let phaseTimeRemaining = phases[0].duration;
    let vehiclesList = [];

    class Vehicle {
        constructor(direction) {
            this.direction = direction;
            this.speed = 2.2;
            this.length = 20;
            this.width = 12;
            this.crossed = false;

            if (direction === "NORTH") { this.x = 335; this.y = 0; this.vx = 0; this.vy = this.speed; this.color = "#48cae4"; }
            if (direction === "SOUTH") { this.x = 355; this.y = 500; this.vx = 0; this.vy = -this.speed; this.color = "#06d6a0"; }
            if (direction === "EAST")  { this.x = 0; this.y = 265; this.vx = this.speed; this.vy = 0; this.color = "#ffd166"; }
            if (direction === "WEST")  { this.x = 700; this.y = 235; this.vx = -this.speed; this.vy = 0; this.color = "#f72585"; }
        }

        update(activeDirection) {
            const canPass = activeDirection.startsWith(this.direction);
            
            const ahead = vehiclesList.find(other => {
                if (other === this || other.direction !== this.direction) return false;
                if (this.direction === "NORTH") return other.y > this.y && (other.y - this.y) < 28;
                if (this.direction === "SOUTH") return other.y < this.y && (this.y - other.y) < 28;
                if (this.direction === "EAST")  return other.x > this.x && (other.x - this.x) < 28;
                if (this.direction === "WEST")  return other.x < this.x && (this.x - other.x) < 28;
                return false;
            });

            const nearStopLine = (
                (this.direction === "NORTH" && this.y >= 195 && this.y <= 212) ||
                (this.direction === "SOUTH" && this.y <= 295 && this.y >= 278) ||
                (this.direction === "EAST"  && this.x >= 295 && this.x <= 312) ||
                (this.direction === "WEST"  && this.x <= 395 && this.x >= 378)
            );

            if ((nearStopLine && !canPass && !this.crossed) || ahead) {
                // Halt
            } else {
                this.x += this.vx;
                this.y += this.vy;
                if (this.x > 315 && this.x < 385 && this.y > 215 && this.y < 285) {
                    this.crossed = true;
                }
            }
        }

        draw(ctx) {
            ctx.fillStyle = this.crossed ? "#70e000" : this.color;
            ctx.beginPath();
            ctx.roundRect(this.x - this.width/2, this.y - this.length/2, this.width, this.length, [3]);
            ctx.fill();

            // Headlights
            ctx.fillStyle = "#ffffff";
            if (this.direction === "NORTH") {
                ctx.fillRect(this.x - 5, this.y + 7, 2, 2);
                ctx.fillRect(this.x + 3, this.y + 7, 2, 2);
            } else if (this.direction === "SOUTH") {
                ctx.fillRect(this.x - 5, this.y - 9, 2, 2);
                ctx.fillRect(this.x + 3, this.y - 9, 2, 2);
            } else if (this.direction === "EAST") {
                ctx.fillRect(this.x + 7, this.y - 5, 2, 2);
                ctx.fillRect(this.x + 7, this.y + 3, 2, 2);
            } else if (this.direction === "WEST") {
                ctx.fillRect(this.x - 9, this.y - 5, 2, 2);
                ctx.fillRect(this.x - 9, this.y + 3, 2, 2);
            }
        }
    }

    // Dynamic Junction Config Loader (Direct DOM & State update)
    async function loadSimJunctionConfig(selectedId = 1) {
        const jId = parseInt(selectedId);
        try {
            const [optRes, trafficRes] = await Promise.all([
                fetch(`/api/optimize?junction=${jId}`),
                fetch("/api/traffic")
            ]);
            const optData = await optRes.json();
            const trafficData = await trafficRes.json();

            // Match accurately on numerical ID
            const jTraffic = trafficData.find(j => parseInt(j.id) === jId) || trafficData[0];
            
            simSpawnRate = Math.min(0.09, Math.max(0.03, (jTraffic.density / 100) * 0.1));

            // Update top blue info badge
            const statsBox = document.getElementById("sim-junction-stats");
            if (statsBox) {
                statsBox.innerText = `Junction ${jId}: Avg Vehicles: ${jTraffic.average_vehicles} | Density: ${jTraffic.density}% | Speed: ${jTraffic.average_speed} km/h`;
            }

            // Update speed metric
            const speedBox = document.getElementById("sim-speed-val");
            if (speedBox) {
                speedBox.innerText = `${jTraffic.average_speed} km/h`;
            }

            // Recalculate phases for the selected junction
            if (optData.status === "success") {
                const s = optData.signals;
                phases = [
                    { dir: "NORTH", duration: Math.max(3, Math.round(s.North.green / 5)), color: "#06d6a0", text: "NORTH GREEN" },
                    { dir: "NORTH_Y", duration: 2, color: "#ffd166", text: "NORTH YELLOW" },
                    { dir: "SOUTH", duration: Math.max(3, Math.round(s.South.green / 5)), color: "#06d6a0", text: "SOUTH GREEN" },
                    { dir: "SOUTH_Y", duration: 2, color: "#ffd166", text: "SOUTH YELLOW" },
                    { dir: "EAST", duration: Math.max(3, Math.round(s.East.green / 5)), color: "#06d6a0", text: "EAST GREEN" },
                    { dir: "EAST_Y", duration: 2, color: "#ffd166", text: "EAST YELLOW" },
                    { dir: "WEST", duration: Math.max(3, Math.round(s.West.green / 5)), color: "#06d6a0", text: "WEST GREEN" },
                    { dir: "WEST_Y", duration: 2, color: "#ffd166", text: "WEST YELLOW" }
                ];
                currentPhaseIndex = 0;
                phaseTimeRemaining = phases[0].duration;
            }
        } catch (e) {
            console.error("Failed to load junction simulation config:", e);
        }
    }

    const simJunctionSelect = document.getElementById("sim-junction-select");
    simJunctionSelect?.addEventListener("change", (e) => {
        resetSimulation();
        loadSimJunctionConfig(e.target.value);
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

        // Asphalt roads
        ctx.fillStyle = "#1c2541";
        ctx.fillRect(310, 0, 80, 500);
        ctx.fillRect(0, 210, 700, 80);

        // Center box
        ctx.fillStyle = "#232f55";
        ctx.fillRect(310, 210, 80, 80);

        // Center dashed markings
        ctx.setLineDash([8, 8]);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(350, 0); ctx.lineTo(350, 210);
        ctx.moveTo(350, 290); ctx.lineTo(350, 500);
        ctx.moveTo(0, 250); ctx.lineTo(310, 250);
        ctx.moveTo(390, 250); ctx.lineTo(700, 250);
        ctx.stroke();
        ctx.setLineDash([]);

        // Stop Lines
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(310, 210); ctx.lineTo(390, 210);
        ctx.moveTo(310, 290); ctx.lineTo(390, 290);
        ctx.moveTo(310, 210); ctx.lineTo(310, 290);
        ctx.moveTo(390, 210); ctx.lineTo(390, 290);
        ctx.stroke();

        // Traffic Light Indicator
        const currentP = phases[currentPhaseIndex];
        ctx.fillStyle = currentP.color;
        ctx.shadowColor = currentP.color;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(350, 250, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
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

        vehiclesList = vehiclesList.filter(v => v.x >= -30 && v.x <= 730 && v.y >= -30 && v.y <= 530);
        
        const queuedCount = vehiclesList.filter(v => !v.crossed).length;
        if (document.getElementById("sim-queue-count")) {
            document.getElementById("sim-queue-count").innerText = queuedCount;
        }

        simAnimationId = requestAnimationFrame(simLoop);
    }

    function resetSimulation() {
        simRunning = false;
        clearInterval(simTimerInterval);
        cancelAnimationFrame(simAnimationId);
        vehiclesList = [];
        currentPhaseIndex = 0;
        completedCycles = 1;
        phaseTimeRemaining = phases[0].duration;
        drawIntersection();

        const startBtn = document.getElementById("sim-start-btn");
        if (startBtn) {
            startBtn.innerHTML = `<i class="fa-solid fa-play"></i> Start Simulation`;
            startBtn.className = "btn btn-success";
        }
        if (document.getElementById("sim-status-tag")) {
            document.getElementById("sim-status-tag").innerText = "STOPPED";
            document.getElementById("sim-status-tag").style.color = "var(--accent-red)";
        }
        if (document.getElementById("sim-cycle-count")) document.getElementById("sim-cycle-count").innerText = "1";
        if (document.getElementById("sim-queue-count")) document.getElementById("sim-queue-count").innerText = "0";
        if (document.getElementById("sim-timer")) document.getElementById("sim-timer").innerText = "0s";
    }

    const startBtn = document.getElementById("sim-start-btn");
    startBtn?.addEventListener("click", () => {
        if (!simRunning) {
            simRunning = true;
            startBtn.innerHTML = `<i class="fa-solid fa-pause"></i> Pause Simulation`;
            startBtn.className = "btn btn-secondary";

            if (document.getElementById("sim-status-tag")) {
                document.getElementById("sim-status-tag").innerText = "RUNNING";
                document.getElementById("sim-status-tag").style.color = "var(--accent-green)";
            }

            simLoop();

            simTimerInterval = setInterval(() => {
                phaseTimeRemaining--;
                if (phaseTimeRemaining <= 0) {
                    currentPhaseIndex = (currentPhaseIndex + 1) % phases.length;
                    if (currentPhaseIndex === 0) {
                        completedCycles++;
                        if (document.getElementById("sim-cycle-count")) {
                            document.getElementById("sim-cycle-count").innerText = completedCycles;
                        }
                    }
                    phaseTimeRemaining = phases[currentPhaseIndex].duration;
                    const p = phases[currentPhaseIndex];
                    if (document.getElementById("sim-active-phase")) {
                        document.getElementById("sim-active-phase").innerText = p.text;
                        document.getElementById("sim-active-phase").style.color = p.color;
                    }
                }
                if (document.getElementById("sim-timer")) {
                    document.getElementById("sim-timer").innerText = `${phaseTimeRemaining}s`;
                }
            }, 1000);
        } else {
            simRunning = false;
            clearInterval(simTimerInterval);
            cancelAnimationFrame(simAnimationId);

            startBtn.innerHTML = `<i class="fa-solid fa-play"></i> Resume Simulation`;
            startBtn.className = "btn btn-success";

            if (document.getElementById("sim-status-tag")) {
                document.getElementById("sim-status-tag").innerText = "PAUSED";
                document.getElementById("sim-status-tag").style.color = "var(--accent-yellow)";
            }
        }
    });

    document.getElementById("sim-reset-btn")?.addEventListener("click", resetSimulation);




    // -------------------------------------------------------------------------
    // REAL TRAFFIC NETWORK DIGITAL TWIN v5
    // -------------------------------------------------------------------------
    // This renderer models four connected signalised junctions with:
    // - deterministic traffic demand derived from the current database frame
    // - one controlled lane per travel direction
    // - red/yellow/green signal obedience
    // - stop-line + following-distance logic (no overlapping vehicles)
    // - continuous movement over four connected roads
    // - emergency corridor priority from the separate ambulance web
    //
    // The database contains aggregate observations only, so the directional
    // split is explicitly a deterministic simulation allocation, not measured
    // per-vehicle GPS data.

    const emergencyCanvas = document.getElementById("emergencyNetworkCanvas");
    const emergencyCtx = emergencyCanvas ? emergencyCanvas.getContext("2d") : null;
    const dirs = ["North","South","East","West"];
    const junctionIds = [1,2,3,4];

    let networkState = null;
    let networkAnim = null;
    let networkTimer = null;
    let emergencyPollTimer = null;
    let frameTimer = null;
    let replayFrame = 0;
    let replayRunning = true;
    let lastNetworkWall = performance.now();
    let emergencyClearBusy = false;

    // Four junction geometry. Coordinates are calculated from canvas size.
    let geom = null;

    // Vehicles are persistent objects. They are not re-created every paint frame.
    const sim = {
        vehicles: new Map(),
        nextId: 1,
        junctionLocks: new Map(),
        phaseClock: new Map(),
        lastDbFrame: -1,
        lastEmergencyKey: "",
        laneOrder: new Map(),
        lastDrawAt: 0
    };

    const corridors = [
        {id:"TOP_E",   movement:"East",  nodes:[null,1,2,null], axis:"h"},
        {id:"TOP_W",   movement:"West",  nodes:[null,2,1,null], axis:"h"},
        {id:"BOT_E",   movement:"East",  nodes:[null,3,4,null], axis:"h"},
        {id:"BOT_W",   movement:"West",  nodes:[null,4,3,null], axis:"h"},
        {id:"LEFT_S",  movement:"South", nodes:[null,1,3,null], axis:"v"},
        {id:"LEFT_N",  movement:"North", nodes:[null,3,1,null], axis:"v"},
        {id:"RIGHT_S", movement:"South", nodes:[null,2,4,null], axis:"v"},
        {id:"RIGHT_N", movement:"North", nodes:[null,4,2,null], axis:"v"}
    ];

    function junctionLabel(id){ return `J${id}`; }
    function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
    function formatSeconds(s){
        s=Number(s||0);
        if(!isFinite(s)) return "—";
        if(s<60) return `${Math.round(s)}s`;
        return `${Math.floor(s/60)}m ${Math.round(s%60)}s`;
    }

    function resizeEmergencyCanvas(){
        if(!emergencyCanvas || !emergencyCtx) return;
        const r=emergencyCanvas.getBoundingClientRect();
        const dpr=Math.max(1,Math.min(2,window.devicePixelRatio||1));
        emergencyCanvas.width=Math.max(960,Math.floor(r.width*dpr));
        emergencyCanvas.height=Math.max(600,Math.floor(r.height*dpr));
        emergencyCtx.setTransform(dpr,0,0,dpr,0,0);
        const W=r.width, H=r.height;
        geom={
            W,H,
            leftX: W*0.27,
            rightX: W*0.73,
            topY: H*0.30,
            bottomY: H*0.70,
            roadW: Math.min(96,Math.max(76,W*0.075)),
            laneOffset: Math.min(20,Math.max(15,W*0.015))
        };
    }

    function nodePoint(j, laneOffset=0, axis=null, sign=0){
        const g=geom;
        const p={
            1:{x:g.leftX,y:g.topY},
            2:{x:g.rightX,y:g.topY},
            3:{x:g.leftX,y:g.bottomY},
            4:{x:g.rightX,y:g.bottomY}
        }[j];
        if(!axis || !sign) return {...p};
        if(axis==="h") return {x:p.x,y:p.y+sign*laneOffset};
        return {x:p.x+sign*laneOffset,y:p.y};
    }

    function corridorLane(c){
        // Right-side driving layout: positive lane offset is south for E/W
        // roads and east for N/S roads.
        const laneSign = {
            TOP_E:+1, TOP_W:-1,
            BOT_E:+1, BOT_W:-1,
            LEFT_S:-1, LEFT_N:+1,
            RIGHT_S:-1, RIGHT_N:+1
        }[c.id];
        const pts = [];
        const start = c.id==="TOP_E"||c.id==="TOP_W"
            ? {x:-80,y:(c.id==="TOP_E"?geom.topY+geom.laneOffset:geom.topY-geom.laneOffset)}
            : c.id==="BOT_E"||c.id==="BOT_W"
            ? {x:-80,y:(c.id==="BOT_E"?geom.bottomY+geom.laneOffset:geom.bottomY-geom.laneOffset)}
            : c.id==="LEFT_S"||c.id==="LEFT_N"
            ? {x:(c.id==="LEFT_S"?geom.leftX-geom.laneOffset:geom.leftX+geom.laneOffset),y:-70}
            : {x:(c.id==="RIGHT_S"?geom.rightX-geom.laneOffset:geom.rightX+geom.laneOffset),y:-70};

        if(c.axis==="h"){
            const y = start.y;
            pts.push({x:start.x,y});
            const orderedNodes = c.nodes.slice(1,3);
            orderedNodes.forEach(j=>pts.push(nodePoint(j,geom.laneOffset,"h",laneSign)));
            pts.push({x:geom.W+80,y});
        } else {
            const x=start.x;
            // For northbound, start at bottom; for southbound, start at top.
            const isSouth = c.movement==="South";
            const y0 = isSouth ? -70 : geom.H+70;
            const y1 = isSouth ? geom.H+70 : -70;
            const jOrder = isSouth ? c.nodes.slice(1,3) : c.nodes.slice(1,3);
            pts.length=0;
            pts.push({x,y:y0});
            ordered:
            for(const j of jOrder) pts.push(nodePoint(j,geom.laneOffset,"v",laneSign));
            pts.push({x,y:y1});
        }
        return pts;
    }

    function distance(a,b){ return Math.hypot(b.x-a.x,b.y-a.y); }
    function polylineLengths(pts){
        const lens=[0];
        for(let i=1;i<pts.length;i++) lens[i]=lens[i-1]+distance(pts[i-1],pts[i]);
        return lens;
    }
    function samplePolyline(pts,lens,s){
        if(s<=0) return {x:pts[0].x,y:pts[0].y,angle:Math.atan2(pts[1].y-pts[0].y,pts[1].x-pts[0].x)};
        const total=lens[lens.length-1];
        if(s>=total){
            const n=pts.length-1;
            return {x:pts[n].x,y:pts[n].y,angle:Math.atan2(pts[n].y-pts[n-1].y,pts[n].x-pts[n-1].x)};
        }
        let i=1;
        while(i<lens.length && lens[i]<s)i++;
        const a=pts[i-1],b=pts[i],seg=Math.max(0.001,lens[i]-lens[i-1]),t=(s-lens[i-1])/seg;
        return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,angle:Math.atan2(b.y-a.y,b.x-a.x)};
    }

    function corridorInfo(c){
        const pts=corridorLane(c);
        return {pts,lens:polylineLengths(pts),total:polylineLengths(pts).at(-1)};
    }

    function corridorTargets(){
        if(!networkState) return {};
        const D = networkState.junctions;
        const demand = (j,d)=>Number(D[String(j)]?.approach_demand?.[d]||0);
        const average=(a,b)=>((a+b)/2);
        // The scale changes only the number of visual vehicles; the source
        // pressure remains the database observation.
        const scale = 18;
        return {
            TOP_E: clamp(Math.round(average(demand(1,"East"),demand(2,"East"))/scale),1,10),
            TOP_W: clamp(Math.round(average(demand(2,"West"),demand(1,"West"))/scale),1,10),
            BOT_E: clamp(Math.round(average(demand(3,"East"),demand(4,"East"))/scale),1,10),
            BOT_W: clamp(Math.round(average(demand(4,"West"),demand(3,"West"))/scale),1,10),
            LEFT_S: clamp(Math.round(average(demand(1,"South"),demand(3,"South"))/scale),1,10),
            LEFT_N: clamp(Math.round(average(demand(3,"North"),demand(1,"North"))/scale),1,10),
            RIGHT_S: clamp(Math.round(average(demand(2,"South"),demand(4,"South"))/scale),1,10),
            RIGHT_N: clamp(Math.round(average(demand(4,"North"),demand(2,"North"))/scale),1,10)
        };
    }

    function approachKeyForJunction(j, movement){
        return `${j}:${movement}`;
    }

    function signalFor(j,movement){
        const v=networkState?.junctions?.[String(j)];
        return String(v?.signal?.signals?.[movement]||"RED");
    }

    function emergencyMovementFor(j){
        const e=networkState?.emergency;
        if(!e?.active || !Array.isArray(e.route) || e.route.length<2) return null;
        const idx=Number(e.route_index||0);
        if(j===Number(e.current_junction) && idx+1<e.route.length){
            const a=e.route[idx], b=e.route[idx+1];
            const pa={1:[0,0],2:[1,0],3:[0,1],4:[1,1]}[a];
            const pb={1:[0,0],2:[1,0],3:[0,1],4:[1,1]}[b];
            if(pb[0]>pa[0]) return "East";
            if(pb[0]<pa[0]) return "West";
            if(pb[1]>pa[1]) return "South";
            return "North";
        }
        return null;
    }

    function allowedToEnterIntersection(vehicle,j,dt){
        const sig=signalFor(j,vehicle.movement);
        if(sim.junctionLocks.get(j)){
            return sim.junctionLocks.get(j)===vehicle.id;
        }
        if(networkState?.emergency?.active){
            const e=networkState.emergency;
            if(Number(e.current_junction)===j){
                return emergencyMovementFor(j)===vehicle.movement && sig==="GREEN";
            }
        }
        return sig==="GREEN";
    }

    function isNearNode(vehicle,j,info){
        const nodeIdx = info.nodeS.get(j);
        if(nodeIdx===undefined) return false;
        const stopS=Math.max(0,nodeIdx-54);
        return vehicle.s>=stopS-2 && vehicle.s<=nodeIdx+36;
    }

    function nextJunctionForVehicle(vehicle,info){
        const candidates=[];
        for(const j of vehicle.nodes){
            const s=info.nodeS.get(j);
            if(s!==undefined && s>vehicle.s+1)candidates.push([s,j]);
        }
        candidates.sort((a,b)=>a[0]-b[0]);
        return candidates[0]?.[1] ?? null;
    }

    function buildCorridorRuntime(c){
        const base=corridorLane(c);
        const lens=polylineLengths(base);
        const nodeS=new Map();
        // The two internal points in each corridor are the junction points.
        c.nodes.slice(1,3).forEach((j,i)=>{
            nodeS.set(j, lens[i+1]);
        });
        return {pts:base,lens,total:lens.at(-1),nodeS};
    }

    // cache corridor geometry because it is reused for every car
    let corridorRuntime={};
    function rebuildCorridors(){
        corridorRuntime={};
        corridors.forEach(c=>corridorRuntime[c.id]=buildCorridorRuntime(c));
    }

    function createVehicle(c,slot){
        const rt=corridorRuntime[c.id];
        const baseGap=30;
        const initialS=-(slot+1)*baseGap;
        const id=`${c.id}-${sim.nextId++}`;
        return {
            id,corridor:c.id,movement:c.movement,nodes:c.nodes.slice(1,3),
            rt,s:initialS,speed:26+((slot*3)%9),
            desiredSpeed:26,laneOffset:0,passedNodes:new Set(),
            color:["#46c6ef","#72d6a2","#f5c85b","#a9b8ff","#7dd3fc"][slot%5],
            wait:0,active:true
        };
    }

    function reconcilePopulation(){
        if(!networkState || !geom) return;
        rebuildCorridors();
        const targets=corridorTargets();

        if(sim.lastDbFrame!==Number(networkState.frame_index||0)) {
            sim.junctionLocks.clear();
            sim.lastDrawAt=0;
        }
        for(const c of corridors){
            const existing=[...sim.vehicles.values()].filter(v=>v.corridor===c.id);
            const target=targets[c.id]||0;
            if(existing.length<target){
                for(let i=existing.length;i<target;i++){
                    const v=createVehicle(c,i);
                    // Deterministic spacing from the database frame. This is
                    // intentionally not Math.random().
                    const offset=((Number(networkState.frame_index||0)*7+i*13)%40);
                    v.s=-(i+1)*34-offset;
                    sim.vehicles.set(v.id,v);
                }
            } else if(existing.length>target){
                existing.sort((a,b)=>b.s-a.s);
                existing.slice(target).forEach(v=>sim.vehicles.delete(v.id));
            }
        }
        sim.lastDbFrame=Number(networkState.frame_index||0);
    }

    function updateVehicle(v,dt){
        const rt=v.rt;
        const nextJ=nextJunctionForVehicle(v,rt);
        const speedKph = (() => {
            const junction = networkState?.junctions?.[String(nextJ)];
            return Math.max(10, Math.min(55, Number(junction?.average_speed||35)));
        })();
        v.desiredSpeed=(speedKph/3.6)*18;

        let targetSpeed=v.desiredSpeed;
        if(nextJ!==null && isNearNode(v,nextJ,rt)){
            const sig=signalFor(nextJ,v.movement);
            if(sig!=="GREEN" && v.s < (rt.nodeS.get(nextJ)+10)){
                targetSpeed=0;
                v.wait+=dt;
            }
            if(sig==="YELLOW" && v.s >= (rt.nodeS.get(nextJ)-18)){
                targetSpeed=v.desiredSpeed; // clear the junction once committed
            }
            if(sig==="GREEN" && !sim.junctionLocks.has(nextJ)){
                // The movement has right-of-way.
                sim.junctionLocks.set(nextJ,v.id);
            }
        }

        // Following-distance control. leaderRef is prepared once per paint
        // cycle instead of scanning every vehicle for every vehicle (O(n^2)).
        const leader=v.leaderRef;
        if(leader && leader.active){
            const gap=leader.s-v.s;
            const minGap=30;
            if(gap<minGap) targetSpeed=0;
            else if(gap<minGap+35) targetSpeed=Math.min(targetSpeed,(gap-minGap)*4.0);
        }

        // If a junction is occupied by another vehicle, stop before it.
        if(nextJ!==null && sim.junctionLocks.has(nextJ) && sim.junctionLocks.get(nextJ)!==v.id){
            const stopS=Math.max(0,(rt.nodeS.get(nextJ)||0)-54);
            if(v.s<stopS+2) targetSpeed=0;
        }

        const accel=24;
        if(v.speed<targetSpeed) v.speed=Math.min(targetSpeed,v.speed+accel*dt);
        else v.speed=Math.max(targetSpeed,v.speed-accel*dt);
        const oldS=v.s;
        v.s += v.speed*dt;
        if(oldS<0 && v.s>=0) v.active=true;

        // Release intersection lock once vehicle is clear.
        for(const [j,s] of rt.nodeS.entries()){
            if(v.s>s+55 && sim.junctionLocks.get(j)===v.id){
                sim.junctionLocks.delete(j);
                v.passedNodes.add(j);
            }
        }

        if(v.s>rt.total+80) v.active=false;
    }

    function purgeExited(){
        for(const [id,v] of sim.vehicles.entries()){
            if(!v.active) sim.vehicles.delete(id);
        }
    }

    function roundRectCompat(ctx,x,y,w,h,r){
        if(ctx.roundRect) ctx.roundRect(x,y,w,h,r);
        else ctx.rect(x,y,w,h);
    }

    function drawCar(ctx,v){
        if(!v.active) return;
        const p=samplePolyline(v.rt.pts,v.rt.lens,v.s);
        ctx.save();
        ctx.translate(p.x,p.y);
        ctx.rotate(p.angle);
        const L=18,W=9;
        ctx.fillStyle=v.color;
        ctx.strokeStyle="#e8f4ff";
        ctx.lineWidth=1;
        ctx.beginPath();roundRectCompat(ctx,-L/2,-W/2,L,W,3);ctx.fill();ctx.stroke();
        ctx.fillStyle="rgba(7,16,35,.75)";ctx.fillRect(-2.5,-W/2+1,6,3);
        ctx.fillStyle="#f8fbff";
        ctx.fillRect(L/2-2,-W/2+1,2,2);
        ctx.fillRect(L/2-2,W/2-3,2,2);
        ctx.restore();
    }

    function drawAmbulance(ctx,e){
        if(!e?.active||!Array.isArray(e.route)||e.route.length<2) return;
        const idx=Number(e.route_index||0);
        if(idx>=e.route.length-1){
            const j=e.current_junction;
            const p=nodePoint(j);
            drawEmergencyVehicle(ctx,p.x,p.y,0,e.ambulance_id);
            return;
        }
        const a=e.route[idx], b=e.route[idx+1];
        const pa=nodePoint(a),pb=nodePoint(b);
        const t=clamp(Number(e.segment_progress||0),0,.995);
        const x=pa.x+(pb.x-pa.x)*t;
        const y=pa.y+(pb.y-pa.y)*t;
        const angle=Math.atan2(pb.y-pa.y,pb.x-pa.x);
        drawEmergencyVehicle(ctx,x,y,angle,e.ambulance_id);
    }

    function drawEmergencyVehicle(ctx,x,y,angle,id){
        ctx.save();ctx.translate(x,y);ctx.rotate(angle);
        ctx.fillStyle="#ff3ea5";ctx.strokeStyle="#fff0fa";ctx.lineWidth=1.5;
        ctx.beginPath();roundRectCompat(ctx,-12,-5,24,10,3);ctx.fill();ctx.stroke();
        ctx.fillStyle="#13203a";ctx.fillRect(-2,-3,7,5);
        ctx.fillStyle="#fff";ctx.fillRect(6,-3,4,2);ctx.fillRect(6,1,4,2);
        ctx.fillStyle="#ff3ea5";ctx.fillRect(-3,-9,6,3);
        ctx.restore();
        ctx.save();ctx.font="800 10px Segoe UI";ctx.textAlign="center";
        ctx.fillStyle="#ffb8dd";ctx.fillText(id||"AMB",x,y-15);ctx.restore();
    }

    function drawRoadSurface(ctx){
        const g=geom,W=g.W,H=g.H;
        ctx.fillStyle="#061026";ctx.fillRect(0,0,W,H);
        ctx.strokeStyle="rgba(93,120,158,.12)";ctx.lineWidth=1;
        for(let x=0;x<W;x+=32){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
        for(let y=0;y<H;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}

        ctx.fillStyle="#263451";
        ctx.fillRect(0,g.topY-g.roadW/2,W,g.roadW);
        ctx.fillRect(0,g.bottomY-g.roadW/2,W,g.roadW);
        ctx.fillRect(g.leftX-g.roadW/2,0,g.roadW,H);
        ctx.fillRect(g.rightX-g.roadW/2,0,g.roadW,H);

        ctx.strokeStyle="#677a9b";ctx.lineWidth=1;
        ctx.setLineDash([22,18]);
        for(const y of [g.topY,g.bottomY]){
            ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();
        }
        for(const x of [g.leftX,g.rightX]){
            ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();
        }
        ctx.setLineDash([]);

        // Lane separators + road shoulders.
        ctx.strokeStyle="rgba(190,210,236,.20)";
        for(const y of [g.topY-g.roadW/2+8,g.topY+g.roadW/2-8,g.bottomY-g.roadW/2+8,g.bottomY+g.roadW/2-8]){
            ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();
        }
        for(const x of [g.leftX-g.roadW/2+8,g.leftX+g.roadW/2-8,g.rightX-g.roadW/2+8,g.rightX+g.roadW/2-8]){
            ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();
        }

        // Stop lines and zebra crossings at all junctions.
        junctionIds.forEach(j=>{
            const p=nodePoint(j);
            const stop=46;
            ctx.strokeStyle="rgba(245,247,252,.82)";ctx.lineWidth=3;
            // Four stop bars.
            ctx.beginPath();ctx.moveTo(p.x-g.roadW/2,p.y-stop);ctx.lineTo(p.x+g.roadW/2,p.y-stop);ctx.stroke();
            ctx.beginPath();ctx.moveTo(p.x-g.roadW/2,p.y+stop);ctx.lineTo(p.x+g.roadW/2,p.y+stop);ctx.stroke();
            ctx.beginPath();ctx.moveTo(p.x-stop,p.y-g.roadW/2);ctx.lineTo(p.x-stop,p.y+g.roadW/2);ctx.stroke();
            ctx.beginPath();ctx.moveTo(p.x+stop,p.y-g.roadW/2);ctx.lineTo(p.x+stop,p.y+g.roadW/2);ctx.stroke();
            ctx.strokeStyle="rgba(255,255,255,.23)";ctx.lineWidth=2;
            for(let i=-2;i<=2;i++){
                ctx.beginPath();ctx.moveTo(p.x+i*12,p.y-stop-17);ctx.lineTo(p.x+i*12,p.y-stop-5);ctx.stroke();
                ctx.beginPath();ctx.moveTo(p.x+i*12,p.y+stop+5);ctx.lineTo(p.x+i*12,p.y+stop+17);ctx.stroke();
            }
        });
    }

    function drawArrow(ctx,x,y,angle,label){
        ctx.save();ctx.translate(x,y);ctx.rotate(angle);
        ctx.fillStyle="rgba(218,229,246,.40)";ctx.beginPath();
        ctx.moveTo(12,0);ctx.lineTo(-6,-5);ctx.lineTo(-6,5);ctx.closePath();ctx.fill();
        ctx.font="700 9px Segoe UI";ctx.textAlign="center";ctx.fillText(label,0,18);
        ctx.restore();
    }

    function drawSignalHead(ctx,x,y,state,label,angle=0){
        const active = state;
        const colors={RED:"#ff4e73",YELLOW:"#ffd166",GREEN:"#19d38a"};
        ctx.save();ctx.translate(x,y);ctx.rotate(angle);
        ctx.fillStyle="#0a1224";ctx.strokeStyle="#546887";ctx.lineWidth=1;
        ctx.beginPath();ctx.roundRect(-9,-22,18,44,6);ctx.fill();ctx.stroke();
        [["RED",-12],["YELLOW",0],["GREEN",12]].forEach(([c,yy])=>{
            ctx.fillStyle=colors[c];
            ctx.globalAlpha=active===c?1:.18;
            ctx.beginPath();ctx.arc(0,yy,4.2,0,Math.PI*2);ctx.fill();
            ctx.globalAlpha=1;
        });
        ctx.restore();
    }

    function drawJunction(ctx,j,v){
        const p=nodePoint(j);
        const sig=v.signal?.signals||{};
        const status=v.signal?.status||"NORMAL";
        const active=status!=="NORMAL";
        ctx.save();
        ctx.fillStyle=active?"rgba(255,62,165,.10)":"rgba(8,18,40,.84)";
        ctx.strokeStyle=active?"#ff3ea5":"#526a91";
        ctx.lineWidth=active?3:2;
        ctx.beginPath();ctx.arc(p.x,p.y,40,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.fillStyle="#f3f7ff";ctx.font="900 16px Segoe UI";ctx.textAlign="center";ctx.fillText(junctionLabel(j),p.x,p.y+5);
        ctx.fillStyle=active?"#ffb8dd":"#7c8da8";ctx.font="700 8px Segoe UI";ctx.fillText(status,p.x,p.y+55);
        ctx.restore();

        const o=geom.roadW/2+18;
        drawSignalHead(ctx,p.x,p.y-o,sig.North,"N",0);
        drawSignalHead(ctx,p.x,p.y+o,sig.South,"S",Math.PI);
        drawSignalHead(ctx,p.x+o,p.y,sig.East,"E",Math.PI/2);
        drawSignalHead(ctx,p.x-o,p.y,sig.West,"W",-Math.PI/2);

        // Direction arrows.
        drawArrow(ctx,p.x,p.y-o-34,Math.PI/2,"S");
        drawArrow(ctx,p.x,p.y+o+34,-Math.PI/2,"N");
        drawArrow(ctx,p.x+o+34,p.y,Math.PI,"W");
        drawArrow(ctx,p.x-o-34,p.y,0,"E");
    }

    function drawEmergencyRoute(ctx,e){
        if(!e?.active||!Array.isArray(e.route)||e.route.length<2)return;
        ctx.save();
        ctx.strokeStyle="rgba(255,62,165,.22)";ctx.lineWidth=14;ctx.lineCap="round";
        ctx.beginPath();
        e.route.forEach((j,i)=>{const p=nodePoint(j);if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});
        ctx.stroke();
        ctx.strokeStyle="#ff3ea5";ctx.lineWidth=4;ctx.setLineDash([12,9]);
        ctx.beginPath();
        e.route.forEach((j,i)=>{const p=nodePoint(j);if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});
        ctx.stroke();ctx.setLineDash([]);ctx.restore();
    }

    function drawNetwork(now){
        if(!emergencyCtx || !networkState || !geom)return;
        const ctx=emergencyCtx;
        const W=geom.W,H=geom.H;
        ctx.clearRect(0,0,W,H);
        drawRoadSurface(ctx);

        // Stable database-driven population.
        const targetFrame=Number(networkState.frame_index||0);
        if(sim.lastDbFrame!==targetFrame) reconcilePopulation();

        // Update every individual vehicle with real signal/spacing constraints.
        // Build lane leaders once per frame to keep the browser responsive.
        sim.laneOrder.clear();
        for(const v of sim.vehicles.values()){
            const list=sim.laneOrder.get(v.corridor)||[];
            list.push(v);
            sim.laneOrder.set(v.corridor,list);
        }
        for(const list of sim.laneOrder.values()){
            list.sort((a,b)=>b.s-a.s);
            for(let i=0;i<list.length;i++) list[i].leaderRef=list[i-1]||null;
        }
        const dt=Math.min(.06,Math.max(.01,(now-lastNetworkWall)/1000));
        for(const v of sim.vehicles.values()) updateVehicle(v,dt);
        purgeExited();
        // Drop locks that belong to vehicles removed/replaced by a new DB frame.
        for(const [j,id] of sim.junctionLocks.entries()){
            if(!sim.vehicles.has(id)) sim.junctionLocks.delete(j);
        }

        for(const v of sim.vehicles.values()) drawCar(ctx,v);
        drawEmergencyRoute(ctx,networkState.emergency);
        junctionIds.forEach(j=>drawJunction(ctx,j,networkState.junctions[String(j)]));
        drawAmbulance(ctx,networkState.emergency);

        const e=networkState.emergency||{};
        const clock=document.getElementById("network-clock");
        if(clock) clock.textContent=`DB FRAME ${Number(networkState.frame_index)+1} • ${networkState.junctions["1"]?.time_of_day||""}`;
    }

    function networkLoop(now){
        if(!lastNetworkWall)lastNetworkWall=now;
        if(now-sim.lastDrawAt>=32){
            drawNetwork(now);
            sim.lastDrawAt=now;
            lastNetworkWall=now;
        }
        networkAnim=requestAnimationFrame(networkLoop);
    }

    function startNetworkLoop(){
        if(!emergencyCanvas)return;
        resizeEmergencyCanvas();
        rebuildCorridors();
        if(!networkAnim)networkAnim=requestAnimationFrame(networkLoop);
        if(!networkTimer){refreshNetworkState();networkTimer=true;}
        if(!emergencyPollTimer){
            emergencyPollTimer=setInterval(async()=>{
                try{
                    const res=await fetch(`/api/emergency/status?frame=${replayFrame}`,{cache:"no-store"});
                    const e=await res.json();
                    if(e && e.active!==undefined){
                        const prev=networkState?.emergency?.request_id;
                        networkState.emergency=e;
                        renderNetworkDashboard(networkState);
                        if(prev!==e.request_id) reconcilePopulation();
                    }
                }catch(err){console.warn("Emergency status poll failed",err);}
            },1000);
        }
        scheduleFrameReplay();
    }

    async function refreshNetworkState(){
        try{
            const res=await fetch(`/api/network/state?frame=${replayFrame}`,{cache:"no-store"});
            const data=await res.json();
            if(!res.ok||data.status!=="success")throw new Error(data.message||"Network state failed");
            networkState=data;
            replayFrame=Number(data.frame_index||0);
            document.getElementById("network-frame")?.setAttribute("value",String(replayFrame));
            renderNetworkDashboard(data);
            resizeEmergencyCanvas();
            reconcilePopulation();
            document.getElementById("network-db-status")?.replaceChildren(document.createTextNode("CONNECTED"));
        }catch(e){
            console.error(e);
            document.getElementById("network-db-status")?.replaceChildren(document.createTextNode("ERROR"));
        }
    }

    function renderNetworkDashboard(data){
        const e=data.emergency||{};
        const active=!!e.active;
        const badge=document.getElementById("emergency-mode-badge");
        if(badge){
            badge.innerHTML=`<span class="status-dot-mini"></span>${active?"EMERGENCY CORRIDOR ACTIVE":"NORMAL ADAPTIVE CONTROL"}`;
            badge.classList.toggle("active",active);
        }
        const banner=document.getElementById("network-emergency-banner");
        if(banner){
            banner.classList.toggle("hidden",!active);
            if(active)document.getElementById("network-banner-text").textContent=`${e.ambulance_id} • ${e.emergency_level} • GREEN CORRIDOR ACTIVE`;
        }
        document.getElementById("network-db-frame")?.replaceChildren(document.createTextNode(`DB FRAME ${data.frame_index+1} / ${data.frame_count}`));
        document.getElementById("network-vehicles")?.replaceChildren(document.createTextNode(Number(data.total_database_vehicles||0).toLocaleString()));
        document.getElementById("network-avg-wait")?.replaceChildren(document.createTextNode(`${Number(data.network_average_wait||0).toFixed(1)}s`));
        document.getElementById("network-avg-speed")?.replaceChildren(document.createTextNode(`${Number(data.network_average_speed||0).toFixed(1)} km/h`));
        document.getElementById("network-route-state")?.replaceChildren(document.createTextNode(active?"EMERGENCY COORDINATION":"NORMAL ADAPTIVE"));
        if(active){
            document.getElementById("network-ambulance-id").textContent=e.ambulance_id||"—";
            document.getElementById("emergency-route-text").textContent=(e.route||[]).map(junctionLabel).join(" → ");
            document.getElementById("emergency-current-readout").textContent=junctionLabel(e.current_junction);
            document.getElementById("emergency-next-readout").textContent=e.next_junction?junctionLabel(e.next_junction):"DESTINATION";
            document.getElementById("emergency-eta").textContent=formatSeconds(e.estimated_time_seconds);
            document.getElementById("emergency-level-readout").textContent=e.emergency_level||"—";
        }else{
            ["network-ambulance-id","emergency-route-text","emergency-current-readout","emergency-next-readout","emergency-eta","emergency-level-readout"].forEach(id=>{
                const el=document.getElementById(id);if(el)el.textContent="—";
            });
            document.getElementById("network-ambulance-id").textContent="No active request";
        }
        renderJunctionStatusCards(data);
        renderRouteSteps(data);
        renderDataCards(data);
    }

    function renderJunctionStatusCards(data){
        const box=document.getElementById("emergency-junction-cards");if(!box)return;
        box.innerHTML=[1,2,3,4].map(j=>{
            const v=data.junctions[String(j)]||data.junctions[j];
            const s=v.signal||{},st=s.status||"NORMAL";
            return `<div class="junction-status-card ${st.toLowerCase().replace(/ /g,'-')}">
                <div class="jsc-head"><strong>${junctionLabel(j)}</strong><span>${st}</span></div>
                <div class="signal-row">${dirs.map(d=>`<span class="signal-dot ${String(s.signals?.[d]||'RED').toLowerCase()}" title="${d}"></span>`).join('')}</div>
                <div class="jsc-meta"><span>${v.vehicle_count} DB vehicles</span><span>${Number(v.waiting_time).toFixed(1)}s wait</span></div>
                <div class="jsc-meta"><span>${Number(v.average_speed).toFixed(1)} km/h</span><span>${Number(v.lane_occupancy).toFixed(1)}% occ</span></div>
                <div class="jsc-phase">${s.phase} <b>${Number(s.phase_remaining||0).toFixed(1)}s</b></div>
            </div>`;
        }).join("");
    }

    function renderRouteSteps(data){
        const box=document.getElementById("emergency-route-steps");if(!box)return;
        const e=data.emergency||{};
        if(!e.active){
            box.innerHTML='<div class="empty-state">No active emergency corridor.</div>';
            document.getElementById("emergency-progress-fill").style.width='0%';
            document.getElementById("emergency-progress-label").textContent='Normal traffic operation';
            return;
        }
        const route=e.route||[],idx=Number(e.route_index||0);
        box.innerHTML=route.map((j,i)=>`
            <div class="route-step ${i===idx?'active':''} ${i<idx?'passed':''} ${i===idx+1?'preparing':''}">
                <span class="step-index">${i+1}</span><strong>${junctionLabel(j)}</strong>
                <span>${i<idx?'PASSED':i===idx?'ACTIVE':i===route.length-1?'DESTINATION':'PREPARING'}</span>
                <em>${i===idx?'CURRENT':i+1===route.length?'FINAL':'CORRIDOR'}</em>
            </div>`).join("");
        const pct=((idx+Math.min(Number(e.segment_progress||0),.99))/(Math.max(1,route.length-1)))*100;
        document.getElementById("emergency-progress-fill").style.width=`${pct}%`;
        document.getElementById("emergency-progress-label").textContent=
            e.status==='AT DESTINATION'?"Ambulance reached destination":
            `J${e.current_junction} → ${e.next_junction?`J${e.next_junction}`:'destination'}`;
    }

    function renderDataCards(data){
        const box=document.getElementById("network-data-grid");if(!box)return;
        box.innerHTML=[1,2,3,4].map(j=>{
            const v=data.junctions[String(j)]||data.junctions[j];
            return `<div class="card network-data-card">
                <div class="card-title-row"><h3>${junctionLabel(j)} <span class="badge-accent">DB #${v.source_id}</span></h3><span class="small-muted">${v.time_of_day||'—'}</span></div>
                <div class="network-record-metrics">
                    <div><span>Vehicle count</span><strong>${v.vehicle_count}</strong></div>
                    <div><span>Flow rate</span><strong>${Number(v.flow_rate).toFixed(1)}</strong></div>
                    <div><span>Occupancy</span><strong>${Number(v.lane_occupancy).toFixed(1)}%</strong></div>
                    <div><span>Waiting</span><strong>${Number(v.waiting_time).toFixed(1)}s</strong></div>
                </div>
            </div>`;
        }).join("");
    }

    function scheduleFrameReplay(){
        if(frameTimer)clearTimeout(frameTimer);
        const speed=Math.max(.25,Number(document.getElementById("network-sim-speed")?.value||4));
        frameTimer=setTimeout(()=>{
            if(replayRunning && networkState){
                replayFrame=(Number(networkState.frame_index)+1)%Math.max(1,Number(networkState.frame_count||1));
                refreshNetworkState();
            }
            scheduleFrameReplay();
        },Math.max(1400,5000/speed));
    }

    document.getElementById("network-frame")?.addEventListener("change",e=>{
        replayFrame=Math.max(0,Number(e.target.value||0));
        refreshNetworkState();
    });
    document.getElementById("network-sim-speed")?.addEventListener("change",()=>scheduleFrameReplay());
    document.getElementById("network-refresh-btn")?.addEventListener("click",()=>refreshNetworkState());
    document.getElementById("network-pause-btn")?.addEventListener("click",e=>{
        replayRunning=!replayRunning;
        e.currentTarget.innerHTML=replayRunning
            ? '<i class="fa-solid fa-pause"></i> Pause Replay'
            : '<i class="fa-solid fa-play"></i> Resume Replay';
        scheduleFrameReplay();
    });
    window.addEventListener("resize",()=>{
        resizeEmergencyCanvas();
        rebuildCorridors();
        for(const v of sim.vehicles.values()) v.rt=corridorRuntime[v.corridor];
    });

    document.getElementById("emergency-clear-btn")?.addEventListener("click",async()=>{
        if(emergencyClearBusy)return;
        emergencyClearBusy=true;
        try{
            const r=await fetch('/api/emergency/clear',{method:'POST'});
            const d=await r.json();
            if(!r.ok||d.status!=='success')throw new Error(d.message||'Failed to clear emergency');
            await refreshNetworkState();
        }catch(e){alert(e.message)}
        finally{emergencyClearBusy=false}
    });

    // 6. REPORTS WITH DYNAMIC JUNCTION SELECTION
    async function loadReports(junctionId = "all") {
        try {
            const res = await fetch(`/api/reports?junction=${junctionId}`);
            const r = await res.json();
            if (r.status === "success") {
                document.getElementById("rep-wait").innerText = `${r.avg_waiting_time}s`;
                document.getElementById("rep-impr").innerText = `+${r.optimization_improvement}%`;
                document.getElementById("rep-density").innerText = r.traffic_density;
                document.getElementById("rep-agents").innerText = r.active_agents;

                if (document.getElementById("rep-speed")) {
                    document.getElementById("rep-speed").innerText = `${r.avg_speed} km/h`;
                }
                if (document.getElementById("rep-total-veh")) {
                    document.getElementById("rep-total-veh").innerText = Number(r.total_vehicles).toLocaleString();
                }
                if (document.getElementById("reports-header-badge")) {
                    document.getElementById("reports-header-badge").innerText = 
                        junctionId === "all" ? "Network View: 4 Active Agents" : `Junction ${junctionId}: Agent ${junctionId} Analytics`;
                }
            }
        } catch (e) {
            console.error("Reports fetch error:", e);
        }
    }

    document.getElementById("reports-junction-select")?.addEventListener("change", (e) => {
        loadReports(e.target.value);
    });

    // 7. SETTINGS HANDLERS
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
        executeOptimization(dashJunctionSelect ? dashJunctionSelect.value : 1);
    });

    document.getElementById("refresh-global-btn")?.addEventListener("click", () => {
        loadDashboardStats();
        executeOptimization(dashJunctionSelect ? dashJunctionSelect.value : 1);
    });

    startNetworkLoop();
    refreshNetworkState();

    // Initial Dashboard Load
    loadDashboardStats();
    executeOptimization(1);
    drawIntersection();
});
