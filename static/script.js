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
            if (targetView === "emergency") { resizeEmergencyCanvas(); refreshEmergencyStatus(); }
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
    // LIVE NETWORK & AMBULANCE EMERGENCY PAGE
    // -------------------------------------------------------------------------
    const emergencyCanvas = document.getElementById("emergencyNetworkCanvas");
    const emergencyCtx = emergencyCanvas ? emergencyCanvas.getContext("2d") : null;
    const emergencyNodePos = {1:{x:270,y:185}, 2:{x:930,y:185}, 3:{x:270,y:465}, 4:{x:930,y:465}};
    const emergencyEdges = [[1,2],[2,4],[4,3],[3,1]];
    const emergencyCars = [];
    let emergencyRoute = [];
    let emergencySnapshot = null;
    let emergencyAutoTimer = null;
    let emergencyAnim = null;
    let emergencyMoveFrom = null;
    let emergencyMoveTo = null;
    let emergencyMoveStarted = 0;
    const emergencyMoveDuration = 2800;
    let emergencyNetworkStarted = performance.now();

    function junctionLabel(id) { return `J${id}`; }
    function statusFor(j) {
        const s = emergencySnapshot?.junction_status || {};
        return s[j] || s[String(j)] || "NORMAL";
    }
    function isRouteEdge(a,b) {
        if (!emergencyRoute.length) return false;
        for (let i=0;i<emergencyRoute.length-1;i++) {
            if ((emergencyRoute[i]===a && emergencyRoute[i+1]===b) || (emergencyRoute[i]===b && emergencyRoute[i+1]===a)) return true;
        }
        return false;
    }
    function seedEmergencyCars() {
        if (emergencyCars.length) return;
        const edges = [[1,2],[2,4],[4,3],[3,1],[2,1],[4,2],[3,4],[1,3]];
        edges.forEach((edge, idx) => {
            for (let k=0;k<4;k++) emergencyCars.push({edge, t:(idx*0.17+k*0.21)%1, speed:0.035+(k%3)*0.006, lane:(k%2)});
        });
    }
    function resizeEmergencyCanvas() {
        if (!emergencyCanvas) return;
        const rect = emergencyCanvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        emergencyCanvas.width = Math.max(600, Math.floor(rect.width*dpr));
        emergencyCanvas.height = Math.max(420, Math.floor(rect.height*dpr));
        emergencyCtx.setTransform(dpr,0,0,dpr,0,0);
    }
    function scaleEmergencyPoint(p) {
        const w = emergencyCanvas?.getBoundingClientRect().width || 1200;
        const h = emergencyCanvas?.getBoundingClientRect().height || 650;
        return {x:p.x/1200*w, y:p.y/650*h};
    }
    function roundedRect(ctx,x,y,w,h,r) {
        const rr=Math.min(r,w/2,h/2); ctx.beginPath(); ctx.moveTo(x+rr,y); ctx.arcTo(x+w,y,x+w,y+h,rr); ctx.arcTo(x+w,y+h,x,y+h,rr); ctx.arcTo(x,y+h,x,y,rr); ctx.arcTo(x,y,x+w,y,rr); ctx.closePath();
    }
    function drawRoadNetwork(now) {
        if (!emergencyCtx || !emergencyCanvas) return;
        const rect=emergencyCanvas.getBoundingClientRect(), W=rect.width, H=rect.height;
        const sx=W/1200, sy=H/650;
        const ctx=emergencyCtx;
        ctx.clearRect(0,0,W,H);
        ctx.save(); ctx.scale(sx,sy);
        // background
        const bg=ctx.createLinearGradient(0,0,1200,650); bg.addColorStop(0,"#081127"); bg.addColorStop(1,"#101d3b"); ctx.fillStyle=bg; ctx.fillRect(0,0,1200,650);
        // subtle grid
        ctx.strokeStyle="rgba(72,202,228,.045)"; ctx.lineWidth=1;
        for(let x=0;x<1200;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,650);ctx.stroke();}
        for(let y=0;y<650;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1200,y);ctx.stroke();}
        // route corridor first
        if(emergencyRoute.length>1){
            ctx.lineCap="round"; ctx.lineJoin="round"; ctx.strokeStyle="rgba(255,62,165,.18)"; ctx.lineWidth=54;
            for(let i=0;i<emergencyRoute.length-1;i++){const a=emergencyNodePos[emergencyRoute[i]],b=emergencyNodePos[emergencyRoute[i+1]];ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
            ctx.setLineDash([18,12]); ctx.strokeStyle="#ff3ea5"; ctx.lineWidth=6;
            for(let i=0;i<emergencyRoute.length-1;i++){const a=emergencyNodePos[emergencyRoute[i]],b=emergencyNodePos[emergencyRoute[i+1]];ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
            ctx.setLineDash([]);
        }
        // roads
        ctx.lineCap="butt";
        emergencyEdges.forEach(([a,b])=>{
            const p=emergencyNodePos[a], q=emergencyNodePos[b];
            ctx.strokeStyle=isRouteEdge(a,b)?"#2d3154":"#293653"; ctx.lineWidth=86;
            ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();
            ctx.strokeStyle="#1c2946"; ctx.lineWidth=4; ctx.setLineDash([22,18]);
            ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();ctx.setLineDash([]);
            ctx.strokeStyle="#4b5d7c"; ctx.lineWidth=1.5;
            ctx.beginPath();ctx.moveTo(p.x,p.y-38);ctx.lineTo(q.x,q.y-38);ctx.stroke();
            ctx.beginPath();ctx.moveTo(p.x,p.y+38);ctx.lineTo(q.x,q.y+38);ctx.stroke();
        });
        // outside approach roads
        [[{x:0,y:185},{x:270,y:185}],[{x:930,y:185},{x:1200,y:185}],[{x:0,y:465},{x:270,y:465}],[{x:930,y:465},{x:1200,y:465}],[{x:270,y:0},{x:270,y:185}],[{x:930,y:0},{x:930,y:185}],[{x:270,y:465},{x:270,y:650}],[{x:930,y:465},{x:930,y:650}]].forEach(([p,q])=>{ctx.strokeStyle="#293653";ctx.lineWidth=86;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();ctx.strokeStyle="#1c2946";ctx.lineWidth=4;ctx.setLineDash([22,18]);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();ctx.setLineDash([]);});
        // cars
        seedEmergencyCars();
        emergencyCars.forEach((car,idx)=>{
            car.t=(car.t+car.speed*0.016)%1; const a=emergencyNodePos[car.edge[0]],b=emergencyNodePos[car.edge[1]];
            const x=a.x+(b.x-a.x)*car.t, y=a.y+(b.y-a.y)*car.t;
            const horizontal=Math.abs(b.x-a.x)>Math.abs(b.y-a.y);
            ctx.save();ctx.translate(x,y); if(!horizontal)ctx.rotate(Math.PI/2);
            ctx.fillStyle=idx%4===0?"#48cae4":idx%4===1?"#ffd166":idx%4===2?"#06d6a0":"#b8c4d6";
            roundedRect(ctx,-13,-7,26,14,3);ctx.fill();ctx.fillStyle="#dce8ff";ctx.fillRect(1,-5,7,10);ctx.restore();
        });
        // junctions and signal heads
        [1,2,3,4].forEach(j=>drawEmergencyJunction(ctx,j));
        // ambulance
        drawEmergencyAmbulance(ctx,now);
        ctx.restore();
        document.getElementById("network-clock")?.replaceChildren(document.createTextNode(formatNetworkTime(now)));
    }
    function formatNetworkTime(now){const s=Math.floor((now-emergencyNetworkStarted)/1000);return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
    function drawEmergencyJunction(ctx,j){
        const p=emergencyNodePos[j], status=statusFor(j);
        const ring=status==="ACTIVE"?"#ff3ea5":status==="PREPARING"?"#ffd166":"#4b5d7c";
        ctx.save();
        ctx.shadowBlur=status==="ACTIVE"?28:status==="PREPARING"?18:8; ctx.shadowColor=ring;
        ctx.fillStyle="#101a34";ctx.strokeStyle=ring;ctx.lineWidth=5;ctx.beginPath();ctx.arc(p.x,p.y,52,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0;
        ctx.fillStyle="#f0f4f8";ctx.font="800 22px Segoe UI";ctx.textAlign="center";ctx.fillText(`J${j}`,p.x,p.y+7);
        ctx.font="700 11px Segoe UI";ctx.fillStyle=ring;ctx.fillText(status,p.x,p.y+72);
        // signal heads: actual colors are red/yellow/green
        const signalMode=status==="ACTIVE"?"GREEN":status==="PREPARING"?"YELLOW":(Math.floor((performance.now()-emergencyNetworkStarted)/4500)+j)%3===0?"GREEN":"RED";
        [[p.x-67,p.y-67],[p.x+55,p.y-67],[p.x-67,p.y+55],[p.x+55,p.y+55]].forEach((sp,i)=>{
            ctx.fillStyle="#111827";roundedRect(ctx,sp[0],sp[1],22,32,5);ctx.fill();
            ["RED","YELLOW","GREEN"].forEach((c,k)=>{ctx.beginPath();ctx.arc(sp[0]+11,sp[1]+7+k*9,3.3,0,Math.PI*2);ctx.fillStyle=signalMode===c?({RED:"#ef476f",YELLOW:"#ffd166",GREEN:"#06d6a0"}[c]):"#2c3549";ctx.fill();});
        });
        ctx.restore();
    }
    function drawEmergencyAmbulance(ctx,now){
        const e=emergencySnapshot?.emergency; if(!e?.active || !e.route?.length)return;
        let from=e.route[e.route_index]||e.current_junction, to=from, t=0;
        if(emergencyMoveFrom!=null && emergencyMoveTo!=null){from=emergencyMoveFrom;to=emergencyMoveTo;t=Math.min(1,(now-emergencyMoveStarted)/emergencyMoveDuration);}
        const a=emergencyNodePos[from],b=emergencyNodePos[to],x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;
        ctx.save();ctx.translate(x,y);ctx.shadowBlur=25;ctx.shadowColor="#ff3ea5";ctx.fillStyle="#f7f7f7";roundedRect(ctx,-25,-13,50,26,6);ctx.fill();ctx.fillStyle="#ef476f";ctx.fillRect(-25,-3,50,6);ctx.fillStyle="#bde9ff";ctx.fillRect(-10,-10,18,7);ctx.fillStyle="#ff3ea5";ctx.fillRect(14,-10,7,7);ctx.fillStyle="#111";ctx.beginPath();ctx.arc(-15,13,5,0,Math.PI*2);ctx.arc(15,13,5,0,Math.PI*2);ctx.fill();ctx.fillStyle="#fff";ctx.font="900 10px Segoe UI";ctx.textAlign="center";ctx.fillText("AMB",0,3);ctx.restore();
    }
    function emergencyAnimationLoop(now){drawRoadNetwork(now);emergencyAnim=requestAnimationFrame(emergencyAnimationLoop);}
    if(emergencyCanvas){resizeEmergencyCanvas();seedEmergencyCars();emergencyAnim=requestAnimationFrame(emergencyAnimationLoop);window.addEventListener("resize",resizeEmergencyCanvas);}

    function renderEmergencyNetwork(data){
        if(!data)return;
        emergencySnapshot=data; emergencyRoute=data.emergency?.route||[];
        const statuses=data.junction_status||{}, congestion=data.congestion||{}, e=data.emergency||{};
        const active=!!e.active;
        const badge=document.getElementById("emergency-mode-badge");
        badge.classList.toggle("active",active); badge.innerHTML=`<span class="status-dot-mini"></span>${active?"EMERGENCY PRIORITY ACTIVE":"NORMAL AI MODE"}`;
        document.getElementById("network-route-state").innerText=active?"EMERGENCY CORRIDOR":"AI OPTIMIZED";
        document.getElementById("network-emergency-banner").classList.toggle("hidden",!active);
        document.getElementById("network-banner-text").innerText=active?`${e.ambulance_id||"AMB-001"} • ${e.emergency_level||"CRITICAL"} • GREEN CORRIDOR ACTIVE`:"";
        document.getElementById("emergency-route-text").innerText=emergencyRoute.length?emergencyRoute.map(junctionLabel).join(" → "):"Waiting for emergency";
        document.getElementById("emergency-eta").innerText=data.estimated_time_seconds?`${Math.max(1,Math.round(data.estimated_time_seconds/60))} min`:"--";
        document.getElementById("emergency-current-readout").innerText=e.current_junction?junctionLabel(e.current_junction):"—";
        const nextIdx=e.route_index!=null?Number(e.route_index)+1:-1;
        document.getElementById("emergency-next-readout").innerText=active&&nextIdx<emergencyRoute.length?junctionLabel(emergencyRoute[nextIdx]):(active?"Destination":"—");
        document.getElementById("emergency-level-readout").innerText=active?(e.emergency_level||"CRITICAL"):"—";
        [1,2,3,4].forEach(j=>{const c=Number(congestion[j]??congestion[String(j)]??0);document.getElementById(`congestion-j${j}`).innerText=`${c.toFixed(0)}%`;});
        renderEmergencySteps(e,statuses); renderEmergencyCards(e,statuses,congestion);
        const progress=emergencyRoute.length>1&&e.route_index!=null?(Number(e.route_index)/(emergencyRoute.length-1))*100:0;
        document.getElementById("emergency-progress-fill").style.width=`${Math.max(0,Math.min(100,progress))}%`;
        document.getElementById("emergency-progress-label").innerText=active?`${junctionLabel(e.current_junction)} → ${junctionLabel(e.destination)}`:"Normal traffic operation";
        document.getElementById("network-vehicles").innerText=Math.round(24+Object.values(congestion).reduce((a,v)=>a+Number(v||0),0)/25);
        document.getElementById("network-avg-wait").innerText=`${Math.round(Object.values(congestion).reduce((a,v)=>a+Number(v||0),0)/4)}s`;
        if(active){document.getElementById("emergency-current").value=String(e.current_junction||1);}
    }
    function renderEmergencySteps(e,statuses){
        const box=document.getElementById("emergency-route-steps");
        if(!emergencyRoute.length){box.innerHTML=`<div class="empty-state">Activate an emergency to calculate the route.</div>`;return;}
        box.innerHTML=emergencyRoute.map((j,i)=>{const s=statuses[j]||statuses[String(j)]||"NORMAL";const stateClass=s.toLowerCase();const marker=i===Number(e.route_index)?"NOW":i<Number(e.route_index||0)?"PASSED":"NEXT";return `<div class="route-step ${stateClass}"><span class="step-index">${i+1}</span><strong>${junctionLabel(j)}</strong><span>${s}</span><em>${marker}</em></div>`;}).join("");
    }
    function renderEmergencyCards(e,statuses,congestion){
        const box=document.getElementById("emergency-junction-cards");
        box.innerHTML=[1,2,3,4].map(j=>{const s=statuses[j]||statuses[String(j)]||"NORMAL";const c=Number(congestion[j]??congestion[String(j)]??0);const traffic=c>=70?"HIGH":c>=40?"MEDIUM":"LOW";const sig=s==="ACTIVE"?"GREEN":s==="PREPARING"?"YELLOW":"RED";return `<div class="junction-live-card ${s.toLowerCase()}"><div class="junction-live-head"><strong>J${j}</strong><span>${s}</span></div><div class="junction-card-signals"><i class="signal-light red ${sig==='RED'?'on':''}"></i><i class="signal-light yellow ${sig==='YELLOW'?'on':''}"></i><i class="signal-light green ${sig==='GREEN'?'on':''}"></i></div><div class="junction-card-data"><span>Traffic <b>${traffic}</b></span><span>Congestion <b>${c.toFixed(0)}%</b></span></div><small>${s==="ACTIVE"?"🚑 Ambulance priority active":s==="PREPARING"?"🟡 Preparing green corridor":"AI signal optimization active"}</small></div>`;}).join("");
    }
    async function refreshEmergencyStatus(){try{const res=await fetch("/api/emergency/status");const data=await res.json();if(data.status==="success")renderEmergencyNetwork(data);}catch(e){console.error("Emergency status error:",e);}}

    document.getElementById("emergency-form")?.addEventListener("submit",async(e)=>{
        e.preventDefault(); const current=Number(document.getElementById("emergency-current").value),destination=Number(document.getElementById("emergency-destination").value); if(current===destination){alert("Current Junction and Destination must be different.");return;}
        const btn=document.getElementById("emergency-activate-btn");btn.disabled=true;stopEmergencyAuto();
        try{const res=await fetch("/api/emergency/activate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ambulance_id:document.getElementById("emergency-ambulance-id").value,current_junction:current,destination,emergency_level:document.getElementById("emergency-level").value})});const data=await res.json();if(!res.ok||data.status!=="success")throw new Error(data.message||"Emergency activation failed"); emergencyMoveFrom=null;emergencyMoveTo=null;renderEmergencyNetwork(data);}catch(err){alert(err.message);}finally{btn.disabled=false;}
    });
    async function advanceEmergency(){
        try{const sres=await fetch("/api/emergency/status"),s=await sres.json(),e=s.emergency;if(!e?.active||!e.route?.length)return;const idx=Number(e.route_index||0);if(idx>=e.route.length-1){stopEmergencyAuto();return;}emergencyMoveFrom=e.route[idx];emergencyMoveTo=e.route[idx+1];emergencyMoveStarted=performance.now();setTimeout(async()=>{const res=await fetch("/api/emergency/update",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({current_junction:emergencyMoveTo})});const data=await res.json();if(data.status==="success"){emergencyMoveFrom=null;emergencyMoveTo=null;renderEmergencyNetwork(data);if(Number(data.emergency.route_index)>=data.emergency.route.length-1)stopEmergencyAuto();}},emergencyMoveDuration);}catch(err){console.error(err);}
    }
    function stopEmergencyAuto(){if(emergencyAutoTimer)clearInterval(emergencyAutoTimer);emergencyAutoTimer=null;const b=document.getElementById("emergency-auto-btn");if(b)b.innerHTML=`<i class="fa-solid fa-play"></i> Auto Move Ambulance`;}
    document.getElementById("emergency-next-btn")?.addEventListener("click",()=>{if(emergencySnapshot?.emergency?.active)advanceEmergency();});
    document.getElementById("emergency-auto-btn")?.addEventListener("click",()=>{if(emergencyAutoTimer){stopEmergencyAuto();return;}if(!emergencySnapshot?.emergency?.active)return;advanceEmergency();emergencyAutoTimer=setInterval(advanceEmergency,emergencyMoveDuration+350);document.getElementById("emergency-auto-btn").innerHTML=`<i class="fa-solid fa-pause"></i> Pause Ambulance`;});
    document.getElementById("emergency-clear-btn")?.addEventListener("click",async()=>{stopEmergencyAuto();try{await fetch("/api/emergency/clear",{method:"POST"});await refreshEmergencyStatus();}catch(e){console.error(e);}});

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

    refreshEmergencyStatus();

    // Initial Dashboard Load
    loadDashboardStats();
    executeOptimization(1);
    drawIntersection();
});
