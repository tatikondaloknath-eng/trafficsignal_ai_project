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
    // REALISTIC NETWORK DIGITAL TWIN
    // -------------------------------------------------------------------------
    const emergencyCanvas = document.getElementById("emergencyNetworkCanvas");
    const emergencyCtx = emergencyCanvas ? emergencyCanvas.getContext("2d") : null;
    const nodePos = {1:{x:245,y:185},2:{x:955,y:185},3:{x:245,y:535},4:{x:955,y:535}};
    const nodeNames = {1:"J1",2:"J2",3:"J3",4:"J4"};
    const edges = [[1,2],[2,4],[4,3],[3,1]];
    const dirs = ["North","South","East","West"];
    let networkState=null;
    let networkAnim=null;
    let networkTimer=null;
    let frameTimer=null;
    let replayFrame=0;
    let replayRunning=true;
    let lastFrameAt=performance.now();
    let lastFrameWall=performance.now();
    let emergencyClearBusy=false;

    function junctionLabel(id){return `J${id}`;}
    function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
    function formatSeconds(s){s=Number(s||0);if(!isFinite(s))return "—";if(s<60)return `${Math.round(s)}s`;return `${Math.floor(s/60)}m ${Math.round(s%60)}s`;}
    function statusFor(j){return String(networkState?.junctions?.[j]?.signal?.status||"NORMAL");}

    function resizeEmergencyCanvas(){
        if(!emergencyCanvas||!emergencyCtx)return;
        const r=emergencyCanvas.getBoundingClientRect();const dpr=Math.max(1,Math.min(2,window.devicePixelRatio||1));
        emergencyCanvas.width=Math.max(900,Math.floor(r.width*dpr));emergencyCanvas.height=Math.max(600,Math.floor(r.height*dpr));
        emergencyCtx.setTransform(dpr,0,0,dpr,0,0);
    }

    function startNetworkLoop(){
        if(!emergencyCanvas)return;
        resizeEmergencyCanvas();
        if(!networkAnim) networkAnim=requestAnimationFrame(networkLoop);
        if(!networkTimer){refreshNetworkState();networkTimer=true;}
        scheduleFrameReplay();
    }

    function networkLoop(now){
        const dt=Math.min(.05,Math.max(.001,(now-lastFrameWall)/1000));lastFrameWall=now;
        drawRealNetwork(now,dt);networkAnim=requestAnimationFrame(networkLoop);
    }

    async function refreshNetworkState(){
        try{
            const res=await fetch(`/api/network/state?frame=${replayFrame}`,{cache:"no-store"});
            const data=await res.json();if(!res.ok||data.status!=="success")throw new Error(data.message||"Network state failed");
            networkState=data;replayFrame=Number(data.frame_index||0);document.getElementById("network-frame")?.setAttribute("value",String(replayFrame));
            renderNetworkDashboard(data);resizeEmergencyCanvas();
        }catch(e){
            console.error(e);document.getElementById("network-db-status")?.replaceChildren(document.createTextNode("ERROR"));
        }
    }

    function renderNetworkDashboard(data){
        const e=data.emergency||{};const active=!!e.active;
        const badge=document.getElementById("emergency-mode-badge");
        if(badge){badge.innerHTML=`<span class="status-dot-mini"></span>${active?"EMERGENCY CORRIDOR ACTIVE":"NORMAL ADAPTIVE CONTROL"}`;badge.classList.toggle("active",active);}
        const banner=document.getElementById("network-emergency-banner");
        if(banner){banner.classList.toggle("hidden",!active);if(active)document.getElementById("network-banner-text").textContent=`${e.ambulance_id} • ${e.emergency_level} • GREEN CORRIDOR`}
        document.getElementById("network-db-frame")?.replaceChildren(document.createTextNode(`DB FRAME ${data.frame_index+1} / ${data.frame_count}`));
        document.getElementById("network-vehicles")?.replaceChildren(document.createTextNode(Number(data.total_database_vehicles||0).toLocaleString()));
        document.getElementById("network-avg-wait")?.replaceChildren(document.createTextNode(`${Number(data.network_average_wait||0).toFixed(1)}s`));
        document.getElementById("network-avg-speed")?.replaceChildren(document.createTextNode(`${Number(data.network_average_speed||0).toFixed(1)} km/h`));
        document.getElementById("network-route-state")?.replaceChildren(document.createTextNode(active?"EMERGENCY COORDINATION":"NORMAL"));
        if(active){
            document.getElementById("network-ambulance-id").textContent=e.ambulance_id||"—";
            document.getElementById("emergency-route-text").textContent=(e.route||[]).map(junctionLabel).join(" → ");
            document.getElementById("emergency-current-readout").textContent=junctionLabel(e.current_junction);
            document.getElementById("emergency-next-readout").textContent=e.next_junction?junctionLabel(e.next_junction):"DESTINATION";
            document.getElementById("emergency-eta").textContent=formatSeconds(e.estimated_time_seconds);
            document.getElementById("emergency-level-readout").textContent=e.emergency_level||"—";
        }else{
            ["network-ambulance-id","emergency-route-text","emergency-current-readout","emergency-next-readout","emergency-eta","emergency-level-readout"].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent="—";});
            document.getElementById("network-ambulance-id").textContent="No active request";
        }
        renderJunctionStatusCards(data);
        renderRouteSteps(data);
        renderDataCards(data);
    }

    function renderJunctionStatusCards(data){
        const box=document.getElementById("emergency-junction-cards");if(!box)return;
        box.innerHTML=[1,2,3,4].map(j=>{
            const v=data.junctions[String(j)]||data.junctions[j];const s=v.signal||{};const st=s.status||"NORMAL";
            return `<div class="junction-status-card ${st.toLowerCase().replace(/ /g,'-')}">
              <div class="jsc-head"><strong>${junctionLabel(j)}</strong><span>${st}</span></div>
              <div class="signal-row">${dirs.map(d=>`<span class="signal-dot ${String(s.signals?.[d]||'RED').toLowerCase()}" title="${d}"></span>`).join('')}</div>
              <div class="jsc-meta"><span>${v.vehicle_count} vehicles</span><span>${Number(v.waiting_time).toFixed(1)}s wait</span></div>
              <div class="jsc-meta"><span>${Number(v.average_speed).toFixed(1)} km/h</span><span>${Number(v.lane_occupancy).toFixed(1)}% occ</span></div>
              <div class="jsc-phase">${s.phase} <b>${Number(s.phase_remaining||0).toFixed(1)}s</b></div>
            </div>`;
        }).join('');
    }

    function renderRouteSteps(data){
        const box=document.getElementById("emergency-route-steps");if(!box)return;const e=data.emergency||{};
        if(!e.active){box.innerHTML='<div class="empty-state">No active emergency corridor.</div>';document.getElementById("emergency-progress-fill").style.width='0%';document.getElementById("emergency-progress-label").textContent='Normal traffic operation';return;}
        const route=e.route||[];const idx=Number(e.route_index||0);
        box.innerHTML=route.map((j,i)=>`<div class="route-step ${i===idx?'active':''} ${i<idx?'passed':''} ${i===idx+1?'preparing':''}"><span class="step-index">${i+1}</span><strong>${junctionLabel(j)}</strong><span>${i<idx?'PASSED':i===idx?'ACTIVE':i===route.length-1?'DESTINATION':'PREPARING'}</span><em>${i===idx?'CURRENT':i+1===route.length?'FINAL':'CORRIDOR'}</em></div>`).join('');
        const pct=((idx+Math.min(Number(e.segment_progress||0),.99))/(Math.max(1,route.length-1)))*100;document.getElementById("emergency-progress-fill").style.width=`${pct}%`;
        document.getElementById("emergency-progress-label").textContent=e.status==='AT DESTINATION'?"Ambulance reached destination":`J${e.current_junction} → ${e.next_junction?`J${e.next_junction}`:'destination'}`;
    }

    function renderDataCards(data){
        const box=document.getElementById("network-data-grid");if(!box)return;
        box.innerHTML=[1,2,3,4].map(j=>{const v=data.junctions[String(j)]||data.junctions[j];return `<div class="card network-data-card"><div class="card-title-row"><h3>${junctionLabel(j)} <span class="badge-accent">DB #${v.source_id}</span></h3><span class="small-muted">${v.time_of_day||'—'}</span></div><div class="network-record-metrics"><div><span>Vehicle count</span><strong>${v.vehicle_count}</strong></div><div><span>Flow rate</span><strong>${Number(v.flow_rate).toFixed(1)}</strong></div><div><span>Occupancy</span><strong>${Number(v.lane_occupancy).toFixed(1)}%</strong></div><div><span>Waiting</span><strong>${Number(v.waiting_time).toFixed(1)}s</strong></div></div></div>`}).join('');
    }

    function roadEnds(a,b){const pa=nodePos[a],pb=nodePos[b];return {x1:pa.x,y1:pa.y,x2:pb.x,y2:pb.y};}
    function drawRoad(ctx,a,b){
        const {x1,y1,x2,y2}=roadEnds(a,b);const horizontal=y1===y2;
        ctx.save();ctx.lineWidth=92;ctx.strokeStyle='#263451';ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
        ctx.lineWidth=2;ctx.setLineDash([22,18]);ctx.strokeStyle='rgba(104,123,153,.65)';ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.setLineDash([]);
        ctx.lineWidth=1;ctx.strokeStyle='rgba(122,142,175,.30)';
        if(horizontal){for(const off of [-28,28]){ctx.beginPath();ctx.moveTo(x1,y1+off);ctx.lineTo(x2,y2+off);ctx.stroke();}}
        else {for(const off of [-28,28]){ctx.beginPath();ctx.moveTo(x1+off,y1);ctx.lineTo(x2+off,y2);ctx.stroke();}}
        ctx.restore();
    }
    function drawApproach(ctx,j,dir){
        const p=nodePos[j], L=125;let x2=p.x,y2=p.y;if(dir==='North')y2-=L;if(dir==='South')y2+=L;if(dir==='East')x2+=L;if(dir==='West')x2-=L;
        ctx.save();ctx.lineWidth=92;ctx.strokeStyle='#263451';ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(x2,y2);ctx.stroke();
        ctx.setLineDash([18,16]);ctx.lineWidth=2;ctx.strokeStyle='rgba(104,123,153,.62)';ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(x2,y2);ctx.stroke();ctx.restore();
    }
    function drawSignal(ctx,x,y,state){const c=state==='GREEN'?'#19d38a':state==='YELLOW'?'#ffd166':'#ff4e73';ctx.save();ctx.fillStyle='#0b1327';ctx.strokeStyle='#52627f';ctx.lineWidth=1;ctx.roundRect(x-7,y-7,14,14,4);ctx.fill();ctx.stroke();ctx.fillStyle=c;ctx.beginPath();ctx.arc(x,y,3.5,0,Math.PI*2);ctx.fill();ctx.restore();}
    function drawJunction(ctx,j,v){
        const p=nodePos[j], s=v.signal, active=s.status!=='NORMAL';
        ctx.save();ctx.shadowBlur=active?25:12;ctx.shadowColor=active?'rgba(255,62,165,.75)':'rgba(72,202,228,.26)';ctx.fillStyle=active?'#35163a':'#0b1830';ctx.strokeStyle=active?'#ff3ea5':'#4e6590';ctx.lineWidth=active?4:2;ctx.beginPath();ctx.arc(p.x,p.y,47,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0;
        ctx.fillStyle='#eef4ff';ctx.font='900 18px Segoe UI';ctx.textAlign='center';ctx.fillText(junctionLabel(j),p.x,p.y+6);
        ctx.font='700 9px Segoe UI';ctx.fillStyle=active?'#ff9bd1':'#7081a0';ctx.fillText(s.status,p.x,p.y+64);ctx.restore();
        drawSignal(ctx,p.x-60,p.y-60,s.signals.North);drawSignal(ctx,p.x+60,p.y+60,s.signals.South);drawSignal(ctx,p.x+60,p.y-60,s.signals.East);drawSignal(ctx,p.x-60,p.y+60,s.signals.West);
    }
    function seeded(j,dir,i){let n=j*92821+i*313+dir.charCodeAt(0)*97;return (Math.sin(n)*43758.5453)%1;}
    function drawVehicle(ctx,x,y,angle,type='car',emergency=false){ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.fillStyle=emergency?'#ff3ea5':(type==='truck'?'#ffc857':'#52c5ff');ctx.strokeStyle='#dce7ff';ctx.lineWidth=1;ctx.roundRect(-8,-4,16,8,3);ctx.fill();ctx.stroke();ctx.fillStyle='#0c162b';ctx.fillRect(-3,-2,6,4);ctx.restore();}
    function drawApproachVehicles(ctx,j,dir,v,now){
        const p=nodePos[j];const state=v.signal.signals[dir];const count=Math.min(8,Math.max(0,Math.round(v.approach_demand[dir]/14)));if(!count)return;
        const speedKph=Math.max(2,Number(v.average_speed)||2);const speedPx=(speedKph/3.6)*0.55;const t=now/1000;const stop=78;
        for(let i=0;i<count;i++){
            let dist=((t*speedPx)+(i*32)+Math.abs(seeded(j,dir,i))*26)%210;
            let d=dist;if(state!=='GREEN')d=Math.min(d,stop-i*24);if(d<18)d=18;
            let x=p.x,y=p.y,ang=0;
            if(dir==='North'){x+=-18+(i%2)*36;y=p.y-d;ang=Math.PI/2;}if(dir==='South'){x+=-18+(i%2)*36;y=p.y+d;ang=-Math.PI/2;}if(dir==='East'){x=p.x+d;y+=-18+(i%2)*36;ang=Math.PI;}if(dir==='West'){x=p.x-d;y+=-18+(i%2)*36;ang=0;}
            drawVehicle(ctx,x,y,ang, i===0&&count>5?'truck':'car');
        }
    }
    function edgeInboundDirection(from,to){
        const a=nodePos[from],b=nodePos[to];
        if(b.x>a.x)return 'West';
        if(b.x<a.x)return 'East';
        if(b.y>a.y)return 'North';
        return 'South';
    }
    function drawEdgeTraffic(ctx,a,b,dataA,dataB,now){
        const pa=nodePos[a],pb=nodePos[b];const horizontal=pa.y===pb.y;
        const len=horizontal?Math.abs(pb.x-pa.x):Math.abs(pb.y-pa.y);
        const avgSpeed=Math.max(3,(Number(dataA.average_speed)+Number(dataB.average_speed))/2);
        const count=Math.min(9,Math.max(2,Math.round((dataA.vehicle_count+dataB.vehicle_count)/25)));
        const t=now/1000;
        for(let i=0;i<count;i++){
            for(let dirSign=0;dirSign<2;dirSign++){
                const from=dirSign===0?a:b,to=dirSign===0?b:a,fromP=dirSign===0?pa:pb,toP=dirSign===0?pb:pa;
                let prog=((t*(avgSpeed/3.6)*0.50/len)+(i*0.12)+dirSign*0.46)%1;
                const dstSignal=(networkState.junctions[String(to)]?.signal?.signals||{})[edgeInboundDirection(from,to)]||'RED';
                if(dstSignal!=='GREEN') prog=Math.min(prog,0.82-i*0.035);
                const x=fromP.x+(toP.x-fromP.x)*prog;
                const y=fromP.y+(toP.y-fromP.y)*prog + (horizontal?(dirSign===0?-18:18):(dirSign===0?18:-18));
                const ang=Math.atan2(toP.y-fromP.y,toP.x-fromP.x);
                drawVehicle(ctx,x,y,ang,'car',false);
            }
        }
    }
    function drawAmbulance(ctx,e,now){
        if(!e?.active||!e.route?.length)return;
        const idx=Number(e.route_index||0);if(idx>=e.route.length-1){const p=nodePos[e.current_junction];drawVehicle(ctx,p.x,p.y,0,'car',true);drawAmbulanceLabel(ctx,p.x,p.y-62,`AMB ${e.ambulance_id}`);return;}
        const from=nodePos[e.route[idx]],to=nodePos[e.route[idx+1]];const p=clamp(Number(e.segment_progress||0),0,.99);const x=from.x+(to.x-from.x)*p,y=from.y+(to.y-from.y)*p;const angle=Math.atan2(to.y-from.y,to.x-from.x);drawVehicle(ctx,x,y,angle,'car',true);drawAmbulanceLabel(ctx,x,y-35,`${e.ambulance_id} • ${e.emergency_level}`);
    }
    function drawAmbulanceLabel(ctx,x,y,text){ctx.save();ctx.font='800 9px Segoe UI';const w=ctx.measureText(text).width+16;ctx.fillStyle='rgba(255,62,165,.17)';ctx.strokeStyle='rgba(255,62,165,.7)';ctx.roundRect(x-w/2,y-12,w,21,6);ctx.fill();ctx.stroke();ctx.fillStyle='#ffb7dc';ctx.textAlign='center';ctx.fillText(text,x,y+2);ctx.restore();}
    function drawRoute(ctx,e){if(!e?.active||!e.route?.length)return;ctx.save();ctx.lineWidth=6;ctx.setLineDash([14,10]);ctx.strokeStyle='#ff3ea5';ctx.shadowBlur=15;ctx.shadowColor='rgba(255,62,165,.55)';ctx.beginPath();for(let i=0;i<e.route.length;i++){const p=nodePos[e.route[i]];if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);}ctx.stroke();ctx.setLineDash([]);ctx.restore();}
    function drawRealNetwork(now){
        if(!emergencyCtx||!networkState)return;const ctx=emergencyCtx;const W=emergencyCanvas.clientWidth,H=emergencyCanvas.clientHeight;ctx.clearRect(0,0,W,H);
        ctx.fillStyle='#071126';ctx.fillRect(0,0,W,H);ctx.strokeStyle='rgba(78,98,133,.14)';ctx.lineWidth=1;for(let x=0;x<W;x+=32){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}for(let y=0;y<H;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
        [1,2,3,4].forEach(j=>dirs.forEach(d=>drawApproach(ctx,j,d)));edges.forEach(([a,b])=>drawRoad(ctx,a,b));
        // outer approach traffic makes the network feel continuous rather than four isolated boxes
        [1,2,3,4].forEach(j=>{const v=networkState.junctions[String(j)];dirs.forEach(d=>drawApproachVehicles(ctx,j,d,v,now));});
        edges.forEach(([a,b])=>drawEdgeTraffic(ctx,a,b,networkState.junctions[String(a)],networkState.junctions[String(b)],now));
        drawRoute(ctx,networkState.emergency);[1,2,3,4].forEach(j=>drawJunction(ctx,j,networkState.junctions[String(j)]));drawAmbulance(ctx,networkState.emergency,now);
        const clock=document.getElementById('network-clock');if(clock)clock.textContent=`FRAME ${Number(networkState.frame_index)+1} • ${networkState.junctions['1'].time_of_day||''}`;
    }

    function scheduleFrameReplay(){
        if(frameTimer)clearTimeout(frameTimer);
        const speed=Math.max(.25,Number(document.getElementById("network-sim-speed")?.value||4));
        frameTimer=setTimeout(()=>{if(replayRunning&&networkState){replayFrame=(Number(networkState.frame_index)+1)%Math.max(1,Number(networkState.frame_count||1));refreshNetworkState();}scheduleFrameReplay();},Math.max(500,2500/speed));
    }
    document.getElementById("network-frame")?.addEventListener("change",e=>{replayFrame=Math.max(0,Number(e.target.value||0));refreshNetworkState();});
    document.getElementById("network-sim-speed")?.addEventListener("change",()=>scheduleFrameReplay());
    document.getElementById("network-refresh-btn")?.addEventListener("click",()=>refreshNetworkState());
    document.getElementById("network-pause-btn")?.addEventListener("click",e=>{replayRunning=!replayRunning;e.currentTarget.innerHTML=replayRunning?'<i class="fa-solid fa-pause"></i> Pause Replay':'<i class="fa-solid fa-play"></i> Resume Replay';scheduleFrameReplay();});
    window.addEventListener("resize",()=>resizeEmergencyCanvas());
    document.getElementById("emergency-clear-btn")?.addEventListener("click",async()=>{
        if(emergencyClearBusy)return;emergencyClearBusy=true;try{const r=await fetch('/api/emergency/clear',{method:'POST'});const d=await r.json();if(!r.ok||d.status!=='success')throw new Error(d.message||'Failed to clear emergency');await refreshNetworkState();}catch(e){alert(e.message);}finally{emergencyClearBusy=false;}
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
