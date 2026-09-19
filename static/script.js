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
            if (targetView === "ambulance") { loadAmbulanceDashboard(); }
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
    // DATABASE-DRIVEN LIVE NETWORK + AMBULANCE CONTROL
    // -------------------------------------------------------------------------
    const emergencyCanvas = document.getElementById("emergencyNetworkCanvas");
    const emergencyCtx = emergencyCanvas ? emergencyCanvas.getContext("2d") : null;
    const networkNodePos = {1:{x:230,y:190}, 2:{x:900,y:190}, 3:{x:230,y:500}, 4:{x:900,y:500}};
    const networkEdges = [[1,2],[2,4],[4,3],[3,1]];
    const dirs = ["North","South","East","West"];
    let networkState = null;
    let networkFrame = null;
    let networkAnim = null;
    let networkLastTime = performance.now();
    let emergencySnapshot = null;
    let emergencyRoute = [];
    let emergencyMoveFrom = null;
    let emergencyMoveTo = null;
    let emergencyMoveStarted = 0;
    let emergencyMoveDuration = 0;
    let emergencyMoveToken = 0;
    let emergencyAutoTimer = null;
    let networkStartedAt = performance.now();
    let networkPollingTimer = null;

    const vehicleStates = {};
    const directionVectors = {
        North: {x:0,y:-1}, South:{x:0,y:1}, East:{x:1,y:0}, West:{x:-1,y:0}
    };

    function junctionLabel(id){ return `J${id}`; }
    function statusFor(j){
        const s=networkState?.junction_status||{};
        return s[j]||s[String(j)]||"NORMAL";
    }

    function resizeEmergencyCanvas(){
        if(!emergencyCanvas || !emergencyCtx) return;
        const rect=emergencyCanvas.getBoundingClientRect();
        const dpr=Math.max(1,Math.min(2,window.devicePixelRatio||1));
        emergencyCanvas.width=Math.max(800,Math.floor(rect.width*dpr));
        emergencyCanvas.height=Math.max(520,Math.floor(rect.height*dpr));
        emergencyCtx.setTransform(dpr,0,0,dpr,0,0);
    }

    function startNetworkLoop(){
        if(networkAnim) return;
        resizeEmergencyCanvas();
        networkLastTime=performance.now();
        networkAnim=requestAnimationFrame(networkLoop);
        if(!networkPollingTimer){
            refreshNetworkState();
            networkPollingTimer=setInterval(refreshNetworkState,5000);
        }
    }

    function stopNetworkLoop(){
        if(networkAnim) cancelAnimationFrame(networkAnim);
        networkAnim=null;
        if(networkPollingTimer) clearInterval(networkPollingTimer);
        networkPollingTimer=null;
    }

    function networkLoop(now){
        const dt=Math.min(0.05,Math.max(0.001,(now-networkLastTime)/1000));
        networkLastTime=now;
        updateDatabaseDrivenVehicles(dt);
        drawDatabaseDrivenNetwork(now);
        networkAnim=requestAnimationFrame(networkLoop);
    }

    function currentTick(){ return Math.floor(Date.now()/5000); }

    async function refreshNetworkState(forceTick=null){
        try{
            const tick=forceTick==null?currentTick():forceTick;
            const res=await fetch(`/api/network/state?tick=${tick}`,{cache:"no-store"});
            const data=await res.json();
            if(!res.ok || data.status!=="success") throw new Error(data.message||"Network state request failed");
            networkState=data;
            emergencySnapshot={
                status:data.status,
                emergency:data.emergency,
                junction_status:data.junction_status,
                congestion:Object.fromEntries(Object.entries(data.junctions||{}).map(([k,v])=>[k,Math.min(100,Math.round(v.lane_occupancy*0.55+v.waiting_time*0.35+v.vehicle_count*0.1))])),
                estimated_time_seconds:data.emergency_eta_seconds,
                next_junction:data.emergency_next_junction,
                segment_time_seconds:data.emergency_segment_time_seconds
            };
            if(data.emergency?.route) emergencyRoute=data.emergency.route.map(Number);
            renderNetworkDashboard(data);
            syncEmergencyMotionFromServer(data);
            document.getElementById("network-db-status")?.replaceChildren(document.createTextNode("CONNECTED"));
        }catch(err){
            console.error("Network state error",err);
            const el=document.getElementById("network-db-status");
            if(el) el.innerText="DATABASE ERROR";
        }
    }

    function renderNetworkDashboard(data){
        const e=data.emergency||{};
        const active=!!e.active;
        const badge=document.getElementById("emergency-mode-badge");
        if(badge){
            badge.classList.toggle("active",active);
            badge.innerHTML=`<span class="status-dot-mini"></span>${active?"EMERGENCY PRIORITY ACTIVE":"NORMAL AI MODE"}`;
        }
        const frame=document.getElementById("network-db-frame");
        if(frame) frame.innerText=`DB FRAME ${data.tick} • J1:${data.junctions?.["1"]?.record_id||"--"} J2:${data.junctions?.["2"]?.record_id||"--"} J3:${data.junctions?.["3"]?.record_id||"--"} J4:${data.junctions?.["4"]?.record_id||"--"}`;
        if(document.getElementById("network-vehicles")) document.getElementById("network-vehicles").innerText=Number(data.total_database_vehicles||0).toLocaleString();
        if(document.getElementById("network-avg-wait")) document.getElementById("network-avg-wait").innerText=`${Number(data.network_avg_waiting||0).toFixed(1)}s`;
        if(document.getElementById("network-avg-speed")) document.getElementById("network-avg-speed").innerText=`${Number(data.network_avg_speed||0).toFixed(1)} km/h`;
        if(document.getElementById("network-route-state")) document.getElementById("network-route-state").innerText=active?"EMERGENCY CORRIDOR":"AI OPTIMIZED";
        const banner=document.getElementById("network-emergency-banner");
        if(banner) banner.classList.toggle("hidden",!active);
        const bannerText=document.getElementById("network-banner-text");
        if(bannerText) bannerText.innerText=active?`${e.ambulance_id||"AMB-001"} • ${e.emergency_level||"CRITICAL"} • GREEN CORRIDOR ACTIVE`:"";
        if(document.getElementById("network-ambulance-id")) document.getElementById("network-ambulance-id").innerText=active?(e.ambulance_id||"AMB-001"):"No active request";
        if(document.getElementById("emergency-route-text")) document.getElementById("emergency-route-text").innerText=emergencyRoute.length?emergencyRoute.map(junctionLabel).join(" → "):"—";
        if(document.getElementById("emergency-current-readout")) document.getElementById("emergency-current-readout").innerText=active?junctionLabel(e.current_junction):"—";
        if(document.getElementById("emergency-next-readout")) document.getElementById("emergency-next-readout").innerText=active&&data.emergency_next_junction?junctionLabel(data.emergency_next_junction):(active?"Destination":"—");
        if(document.getElementById("emergency-eta")) document.getElementById("emergency-eta").innerText=active?formatSeconds(data.emergency_eta_seconds):"—";
        if(document.getElementById("emergency-level-readout")) document.getElementById("emergency-level-readout").innerText=active?(e.emergency_level||"CRITICAL"):"—";
        const progress=emergencyRoute.length>1?(Number(e.route_index||0)/(emergencyRoute.length-1))*100:0;
        const pf=document.getElementById("emergency-progress-fill"); if(pf) pf.style.width=`${Math.max(0,Math.min(100,progress))}%`;
        const pl=document.getElementById("emergency-progress-label"); if(pl) pl.innerText=active?`${junctionLabel(e.current_junction)} → ${junctionLabel(e.destination)}`:"Normal traffic operation";
        renderEmergencyRouteSteps(data);
        renderNetworkJunctionCards(data);
        renderNetworkDataGrid(data);
        renderAmbulanceSnapshot(data);
    }

    function renderEmergencyRouteSteps(data){
        const box=document.getElementById("emergency-route-steps");
        if(!box) return;
        const e=data.emergency||{};
        if(!e.active||!emergencyRoute.length){box.innerHTML=`<div class="empty-state">No active emergency corridor.</div>`;return;}
        const idx=Number(e.route_index||0);
        const statuses=data.junction_status||{};
        box.innerHTML=emergencyRoute.map((j,i)=>{
            const s=statuses[j]||statuses[String(j)]||"NORMAL";
            const marker=i===idx?"CURRENT":i<idx?"PASSED":"NEXT";
            return `<div class="route-step ${s.toLowerCase().replaceAll(' ','-')}"><span class="step-index">${i+1}</span><strong>${junctionLabel(j)}</strong><span>${s}</span><em>${marker}</em></div>`;
        }).join("");
    }

    function renderNetworkJunctionCards(data){
        const box=document.getElementById("emergency-junction-cards");
        if(!box) return;
        const statuses=data.junction_status||{};
        box.innerHTML=[1,2,3,4].map(j=>{
            const v=data.junctions?.[String(j)]||{};
            const s=statuses[j]||statuses[String(j)]||"NORMAL";
            const signals=Object.values(v.approaches||{}).map(a=>a.signal);
            const green=signals.filter(x=>x==="GREEN").length;
            const yellow=signals.filter(x=>x==="YELLOW").length;
            const red=signals.filter(x=>x==="RED").length;
            return `<div class="junction-live-card ${s.toLowerCase().replaceAll(' ','-')} data-junction-card">
                <div class="junction-live-head"><strong>J${j}</strong><span>${s}</span></div>
                <div class="junction-card-signals"><span class="signal-pill green">G ${green}</span><span class="signal-pill yellow">Y ${yellow}</span><span class="signal-pill red">R ${red}</span></div>
                <div class="junction-card-data"><span>DB vehicles <b>${Number(v.vehicle_count||0).toLocaleString()}</b></span><span>Speed <b>${Number(v.average_speed||0).toFixed(1)}</b></span></div>
                <div class="junction-card-data"><span>Occ <b>${Number(v.lane_occupancy||0).toFixed(1)}%</b></span><span>Wait <b>${Number(v.waiting_time||0).toFixed(1)}s</b></span></div>
            </div>`;
        }).join("");
    }

    function renderNetworkDataGrid(data){
        const box=document.getElementById("network-data-grid");
        if(!box) return;
        box.innerHTML=[1,2,3,4].map(j=>{
            const v=data.junctions?.[String(j)]||{};
            return `<div class="card network-data-card"><div class="card-title-row"><h3>J${j} — Database Record #${v.record_id||"--"}</h3><span class="small-muted">${v.time_of_day||"unknown"}</span></div>
                <div class="network-record-metrics"><div><span>Vehicles</span><strong>${Number(v.vehicle_count||0).toLocaleString()}</strong></div><div><span>Flow rate</span><strong>${Number(v.flow_rate||0).toFixed(0)}</strong></div><div><span>Occupancy</span><strong>${Number(v.lane_occupancy||0).toFixed(1)}%</strong></div><div><span>Waiting</span><strong>${Number(v.waiting_time||0).toFixed(1)}s</strong></div></div></div>`;
        }).join("");
    }

    function renderAmbulanceSnapshot(data){
        const box=document.getElementById("ambulance-snapshot-grid");
        if(!box) return;
        const src=document.getElementById("ambulance-db-source");
        if(src) src.innerText=`Live frame ${data.tick} • ${data.source||"traffic_data"}`;
        box.innerHTML=[1,2,3,4].map(j=>{
            const v=data.junctions?.[String(j)]||{};
            const traffic=v.lane_occupancy>=70?"HIGH":v.lane_occupancy>=40?"MEDIUM":"LOW";
            return `<div class="snapshot-tile"><div class="snapshot-junction">J${j}</div><div><span>Vehicles</span><strong>${v.vehicle_count??"--"}</strong></div><div><span>Flow</span><strong>${Number(v.flow_rate||0).toFixed(0)}</strong></div><div><span>Wait</span><strong>${Number(v.waiting_time||0).toFixed(1)}s</strong></div><div><span>Traffic</span><strong>${traffic}</strong></div></div>`;
        }).join("");
    }

    function formatSeconds(sec){
        const s=Math.max(0,Number(sec||0));
        if(s<60) return `${s.toFixed(0)} s`;
        const m=Math.floor(s/60),r=Math.round(s%60);
        return `${m}m ${String(r).padStart(2,'0')}s`;
    }

    function updateDatabaseDrivenVehicles(dt){
        if(!networkState?.junctions) return;
        Object.entries(networkState.junctions).forEach(([jid, data])=>{
            if(!vehicleStates[jid]) vehicleStates[jid]={};
            dirs.forEach((dir,di)=>{
                const a=data.approaches?.[dir];
                if(!a) return;
                const key=`${jid}-${dir}`;
                const target=a.visible_vehicles||0;
                if(!vehicleStates[jid][dir]){
                    vehicleStates[jid][dir]=Array.from({length:target},(_,i)=>({t:(i+1)/(target+1),lane:i%2,seed:i}));
                }
                let arr=vehicleStates[jid][dir];
                if(arr.length<target){
                    for(let i=arr.length;i<target;i++) arr.push({t:(i+1)/(target+1),lane:i%2,seed:i});
                } else if(arr.length>target){ arr.length=target; }
                const speedNorm=Math.max(0.012,Math.min(0.075,(Number(a.speed_kmh||20)/65)*0.055));
                arr.forEach(v=>{
                    const state=a.signal;
                    const stop=0.84;
                    const canMove=state==="GREEN" || (state==="YELLOW" && v.t>0.76);
                    if(canMove) v.t+=speedNorm*dt;
                    else if(v.t>stop) v.t=stop;
                    if(v.t>1.08){v.t=0.02 + ((v.seed*17)%13)/100;}
                });
            });
        });
    }

    function roundRectPath(ctx,x,y,w,h,r){
        const rr=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath();
    }

    function drawRoadSegment(ctx,a,b,width=76){
        const ax=a.x,ay=a.y,bx=b.x,by=b.y;
        const dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;
        ctx.save();
        ctx.strokeStyle="#1b2745";ctx.lineWidth=width;ctx.lineCap="butt";ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);ctx.stroke();
        ctx.strokeStyle="#374765";ctx.lineWidth=width-6;ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);ctx.stroke();
        ctx.strokeStyle="rgba(255,255,255,.18)";ctx.lineWidth=2;ctx.setLineDash([18,18]);ctx.beginPath();ctx.moveTo(ax+nx*9,ay+ny*9);ctx.lineTo(bx+nx*9,by+ny*9);ctx.stroke();
        ctx.beginPath();ctx.moveTo(ax-nx*9,ay-ny*9);ctx.lineTo(bx-nx*9,by-ny*9);ctx.stroke();ctx.setLineDash([]);
        ctx.restore();
    }

    function drawArmRoad(ctx,p,dir){
        const v=directionVectors[dir], L=170;
        const q={x:p.x-v.x*L,y:p.y-v.y*L};
        drawRoadSegment(ctx,q,p,76);
        // stop line is before the junction
        const s={x:p.x-v.x*34,y:p.y-v.y*34}, n={x:-v.y,y:v.x};
        ctx.save();ctx.strokeStyle="rgba(255,255,255,.78)";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(s.x+n.x*28,s.y+n.y*28);ctx.lineTo(s.x-n.x*28,s.y-n.y*28);ctx.stroke();ctx.restore();
    }

    function drawSignalHead(ctx,x,y,state){
        ctx.save();roundRectPath(ctx,x,y,18,42,5);ctx.fillStyle="#0c1327";ctx.fill();
        const colors={RED:"#ef476f",YELLOW:"#ffd166",GREEN:"#06d6a0"};
        ["RED","YELLOW","GREEN"].forEach((c,i)=>{ctx.beginPath();ctx.arc(x+9,y+8+i*13,4,0,Math.PI*2);ctx.fillStyle=state===c?colors[c]:"#29344b";ctx.shadowBlur=state===c?10:0;ctx.shadowColor=colors[c];ctx.fill();});
        ctx.restore();
    }

    function drawJunction(ctx,jid,data){
        const p=networkNodePos[jid];
        const status=statusFor(jid);
        const ring=status==="ACTIVE"?"#ff3ea5":status==="PREPARING"?"#ffd166":"#466180";
        // central intersection box
        ctx.save();ctx.beginPath();ctx.arc(p.x,p.y,58,0,Math.PI*2);ctx.fillStyle="#0a1328";ctx.fill();ctx.lineWidth=5;ctx.strokeStyle=ring;ctx.shadowBlur=status!=="NORMAL"?26:13;ctx.shadowColor=ring;ctx.stroke();ctx.shadowBlur=0;
        ctx.fillStyle="#e7efff";ctx.font="900 18px Segoe UI";ctx.textAlign="center";ctx.fillText(`J${jid}`,p.x,p.y+6);
        ctx.fillStyle=ring;ctx.font="800 10px Segoe UI";ctx.fillText(status,p.x,p.y+77);ctx.restore();
        const headOffset=76;
        drawSignalHead(ctx,p.x-headOffset,p.y-94,data.approaches.North.signal);
        drawSignalHead(ctx,p.x-headOffset,p.y+52,data.approaches.South.signal);
        drawSignalHead(ctx,p.x+58,p.y-headOffset,data.approaches.West.signal);
        drawSignalHead(ctx,p.x-20,p.y-headOffset,data.approaches.East.signal);
    }

    function drawVehiclesAtJunction(ctx,jid,data){
        const p=networkNodePos[jid];
        dirs.forEach(dir=>{
            const a=data.approaches?.[dir]; if(!a) return;
            const v=directionVectors[dir], n={x:-v.y,y:v.x};
            const arr=vehicleStates[jid]?.[dir]||[];
            arr.forEach((car,idx)=>{
                const dist=170*(1-car.t);
                const cx=p.x+v.x*dist+n.x*(car.lane===0?12:-12);
                const cy=p.y+v.y*dist+n.y*(car.lane===0?12:-12);
                const w=22,h=11;
                ctx.save();ctx.translate(cx,cy);ctx.rotate(Math.atan2(v.y,v.x));
                roundRectPath(ctx,-w/2,-h/2,w,h,3);
                const palettes=["#48cae4","#64dfdf","#90e0ef","#f8cf6a","#6ee7b7","#d7ddea"];
                ctx.fillStyle=palettes[(idx+jid)%palettes.length];ctx.fill();
                ctx.fillStyle="rgba(7,12,25,.72)";ctx.fillRect(-5,-4,7,3);ctx.restore();
            });
        });
    }

    function drawAStarCorridor(ctx){
        if(!emergencyRoute||emergencyRoute.length<2) return;
        ctx.save();ctx.strokeStyle="#ff3ea5";ctx.lineWidth=7;ctx.globalAlpha=.25;ctx.setLineDash([16,12]);ctx.beginPath();
        emergencyRoute.forEach((j,i)=>{const p=networkNodePos[j];if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});ctx.stroke();
        ctx.globalAlpha=1;ctx.strokeStyle="#ff3ea5";ctx.lineWidth=3;ctx.setLineDash([10,8]);ctx.beginPath();
        emergencyRoute.forEach((j,i)=>{const p=networkNodePos[j];if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});ctx.stroke();ctx.restore();
    }

    function drawEmergencyAmbulance(ctx,now){
        const e=networkState?.emergency; if(!e?.active || !e.route?.length) return;
        let from=e.route[e.route_index]||e.current_junction;
        let to=from,t=0;
        if(emergencyMoveFrom!=null && emergencyMoveTo!=null){
            from=emergencyMoveFrom;to=emergencyMoveTo;
            t=Math.max(0,Math.min(1,(now-emergencyMoveStarted)/Math.max(500,emergencyMoveDuration)));
        }
        const a=networkNodePos[from],b=networkNodePos[to]; if(!a||!b)return;
        const x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;
        const angle=Math.atan2(b.y-a.y,b.x-a.x);
        ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.shadowBlur=28;ctx.shadowColor="#ff3ea5";
        roundRectPath(ctx,-26,-12,52,24,6);ctx.fillStyle="#f7f8ff";ctx.fill();
        ctx.fillStyle="#ef476f";ctx.fillRect(-26,-3,52,6);ctx.fillStyle="#a7e9ff";ctx.fillRect(-9,-9,16,6);
        ctx.fillStyle="#111827";ctx.beginPath();ctx.arc(-15,13,5,0,Math.PI*2);ctx.arc(15,13,5,0,Math.PI*2);ctx.fill();
        ctx.fillStyle="#ff3ea5";ctx.fillRect(10,-12,10,4);ctx.fillStyle="#111";ctx.font="900 9px Segoe UI";ctx.textAlign="center";ctx.fillText("AMB",0,3);ctx.restore();
    }

    function drawDatabaseDrivenNetwork(now){
        if(!emergencyCtx||!emergencyCanvas) return;
        const rect=emergencyCanvas.getBoundingClientRect(),W=rect.width,H=rect.height,ctx=emergencyCtx;
        ctx.clearRect(0,0,W,H);
        ctx.fillStyle="#061025";ctx.fillRect(0,0,W,H);
        // grid
        ctx.strokeStyle="rgba(91,119,156,.09)";ctx.lineWidth=1;
        for(let x=0;x<W;x+=36){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
        for(let y=0;y<H;y+=36){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
        // network roads
        const p=networkNodePos;
        drawRoadSegment(ctx,p[1],p[2],76);drawRoadSegment(ctx,p[3],p[4],76);drawRoadSegment(ctx,p[1],p[3],76);drawRoadSegment(ctx,p[2],p[4],76);
        [1,2,3,4].forEach(j=>dirs.forEach(d=>drawArmRoad(ctx,p[j],d)));
        drawAStarCorridor(ctx);
        if(networkState?.junctions){[1,2,3,4].forEach(j=>drawVehiclesAtJunction(ctx,j,networkState.junctions[String(j)]||{}));[1,2,3,4].forEach(j=>drawJunction(ctx,j,networkState.junctions[String(j)]||{}));}
        drawEmergencyAmbulance(ctx,now);
        // labels on roads
        ctx.fillStyle="#7283a2";ctx.font="700 10px Segoe UI";ctx.textAlign="center";ctx.fillText("NORTH",p[1].x,p[1].y-150);ctx.fillText("SOUTH",p[3].x,p[3].y+150);ctx.fillText("WEST",p[1].x-145,p[1].y-7);ctx.fillText("EAST",p[2].x+145,p[2].y-7);
        const elapsed=Math.floor((now-networkStartedAt)/1000);const clock=document.getElementById("network-clock");if(clock)clock.innerText=`${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`;
    }

    function syncEmergencyMotionFromServer(data){
        const e=data.emergency;
        if(!e?.active){ emergencyMoveFrom=null; emergencyMoveTo=null; return; }
        if(emergencyMoveFrom!=null && emergencyMoveTo!=null) return;
        if(Number(e.route_index)<e.route.length-1){
            emergencyMoveFrom=e.route[e.route_index];
            emergencyMoveTo=e.route[e.route_index+1];
        }
    }

    async function startEmergencySegment(){
        const e=networkState?.emergency;
        if(!e?.active || !e.route?.length) return false;
        const idx=Number(e.route_index||0);
        if(idx>=e.route.length-1){stopEmergencyAuto();return false;}
        emergencyMoveFrom=e.route[idx];
        emergencyMoveTo=e.route[idx+1];
        const serverSeconds=Number(networkState.emergency_segment_time_seconds||60);
        const speed=Number(document.getElementById("network-sim-speed")?.value||8);
        emergencyMoveDuration=Math.max(1200,(serverSeconds*1000)/Math.max(1,speed));
        emergencyMoveStarted=performance.now();
        const moveToken=++emergencyMoveToken;
        setTimeout(async()=>{
            if(moveToken!==emergencyMoveToken) return;
            try{
                const res=await fetch("/api/emergency/update",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({current_junction:emergencyMoveTo})});
                const data=await res.json();
                if(data.status!=="success") throw new Error(data.message||"Emergency movement failed");
                networkState={...(networkState||{}),emergency:data.emergency,junction_status:data.junction_status,emergency_eta_seconds:data.estimated_time_seconds,emergency_next_junction:data.next_junction,emergency_segment_time_seconds:data.segment_time_seconds};
                emergencySnapshot=data; emergencyRoute=data.emergency?.route||[];
                emergencyMoveFrom=null;emergencyMoveTo=null;
                renderNetworkDashboard(networkState);
                if(data.emergency?.status==="AT DESTINATION") stopEmergencyAuto();
                else if(emergencyAutoTimer) startEmergencySegment();
            }catch(err){console.error(err);stopEmergencyAuto();alert(err.message);}
        },emergencyMoveDuration);
        return true;
    }

    function stopEmergencyAuto(){
        emergencyMoveToken++;
        if(emergencyAutoTimer) clearTimeout(emergencyAutoTimer);
        emergencyAutoTimer=null;
        const b=document.getElementById("emergency-auto-btn");
        if(b)b.innerHTML=`<i class="fa-solid fa-play"></i> Start Auto Movement`;
    }

    async function advanceEmergency(){
        if(!networkState?.emergency?.active) return;
        stopEmergencyAuto();
        await startEmergencySegment();
    }

    document.getElementById("emergency-auto-btn")?.addEventListener("click",async()=>{
        if(emergencyAutoTimer){stopEmergencyAuto();return;}
        if(!networkState?.emergency?.active)return;
        emergencyAutoTimer=true;
        document.getElementById("emergency-auto-btn").innerHTML=`<i class="fa-solid fa-pause"></i> Pause Auto Movement`;
        const started=await startEmergencySegment();
        if(!started) stopEmergencyAuto();
    });
    document.getElementById("emergency-next-btn")?.addEventListener("click",()=>advanceEmergency());
    document.getElementById("emergency-clear-btn")?.addEventListener("click",async()=>{
        stopEmergencyAuto();
        try{const res=await fetch("/api/emergency/clear",{method:"POST"});const data=await res.json();if(data.status!=="success")throw new Error(data.message||"Clear failed");emergencyMoveFrom=null;emergencyMoveTo=null;await refreshNetworkState();}catch(err){alert(err.message);}
    });

    // Ambulance Dashboard
    async function loadAmbulanceDashboard(){
        try{await refreshNetworkState();}catch(e){console.error(e);}
    }

    function renderAmbulancePlan(data){
        const empty=document.getElementById("ambulance-route-empty");const result=document.getElementById("ambulance-route-result");
        if(!result||!empty)return;
        empty.classList.add("hidden");result.classList.remove("hidden");
        document.getElementById("ambulance-route-text").innerText=(data.route||[]).map(junctionLabel).join(" → ");
        document.getElementById("ambulance-route-time").innerText=formatSeconds(data.estimated_time_seconds);
        const vals=Object.values(data.congestion||{}).map(Number);const avg=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;
        document.getElementById("ambulance-route-congestion").innerText=`${avg.toFixed(0)}% network avg`;
        const steps=document.getElementById("ambulance-route-steps");
        steps.innerHTML=(data.route||[]).map((j,i)=>`<div class="route-step ${i===0?'active':''}"><span class="step-index">${i+1}</span><strong>${junctionLabel(j)}</strong><span>${i===0?'CURRENT':i===data.route.length-1?'DESTINATION':'CORRIDOR'}</span><em>${i===0?'START':'STEP '+i}</em></div>`).join("");
    }

    document.getElementById("ambulance-plan-btn")?.addEventListener("click",async()=>{
        const start=Number(document.getElementById("ambulance-current").value),dest=Number(document.getElementById("ambulance-destination").value);
        if(start===dest){alert("Current Junction and Destination Junction must be different.");return;}
        const b=document.getElementById("ambulance-plan-btn");b.disabled=true;
        try{
            const res=await fetch("/api/emergency/plan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({current_junction:start,destination:dest})});
            const data=await res.json();if(!res.ok||data.status!=="success")throw new Error(data.message||"Route planning failed");renderAmbulancePlan(data);
        }catch(err){alert(err.message);}finally{b.disabled=false;}
    });

    document.getElementById("ambulance-form")?.addEventListener("submit",async(e)=>{
        e.preventDefault();
        const start=Number(document.getElementById("ambulance-current").value),dest=Number(document.getElementById("ambulance-destination").value);
        if(start===dest){alert("Current Junction and Destination Junction must be different.");return;}
        const b=document.getElementById("ambulance-activate-btn");b.disabled=true;
        try{
            const res=await fetch("/api/emergency/activate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ambulance_id:document.getElementById("ambulance-id").value,current_junction:start,destination:dest,emergency_level:document.getElementById("ambulance-level").value})});
            const data=await res.json();if(!res.ok||data.status!=="success")throw new Error(data.message||"Emergency activation failed");
            renderAmbulancePlan(data);
            document.getElementById("ambulance-dashboard-status").innerHTML='<span class="status-dot-mini"></span>ACTIVE';
            // Move operator directly to the live control centre.
            document.querySelector('.nav-item[data-view="emergency"]')?.click();
            networkState={...(networkState||{}),emergency:data.emergency,junction_status:data.junction_status,emergency_eta_seconds:data.estimated_time_seconds,emergency_next_junction:data.next_junction,emergency_segment_time_seconds:data.segment_time_seconds};
            emergencyRoute=data.emergency.route||[];
            emergencyMoveFrom=null;emergencyMoveTo=null;
            renderNetworkDashboard(networkState);
            stopEmergencyAuto();
            emergencyAutoTimer=true;
            document.getElementById("emergency-auto-btn").innerHTML=`<i class="fa-solid fa-pause"></i> Pause Auto Movement`;
            setTimeout(()=>startEmergencySegment(),300);
        }catch(err){alert(err.message);}finally{b.disabled=false;}
    });

    document.getElementById("ambulance-open-network")?.addEventListener("click",()=>document.querySelector('.nav-item[data-view="emergency"]')?.click());
    document.getElementById("network-refresh-btn")?.addEventListener("click",()=>refreshNetworkState());
    window.addEventListener("resize",()=>resizeEmergencyCanvas());

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
