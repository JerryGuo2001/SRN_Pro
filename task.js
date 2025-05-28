let aGraphs = [];
let bGraphs = [];
let graphMetadata = [];
let inBreak = false;
let breakStartTime = null;

let pairs = [];
let pairMetadata = [];

async function loadGraphsFromJSON() {
    // Clear old data
    aGraphs = [];
    bGraphs = [];
    graphMetadata = [];

    // Pull fresh from server
    const response = await fetch('Block_Graph.json');
    const jsonData = await response.json();

    // Step 1: Group graphs by block_id and node_count
    const grouped = {};
    for (const row of jsonData) {
        const key = `${row.block_id}_${row.node_count}`;
        if (!grouped[key]) {
            grouped[key] = [];
        }
        grouped[key].push(row);
    }

    // Step 2: For each group, pick 1 random graph
    for (const key in grouped) {
        const graphs = grouped[key];
        const randomGraph = graphs[Math.floor(Math.random() * graphs.length)]; // randomly select 1

        const structure = randomGraph.graph_structure
            .replace('[', '')
            .replace(']', '')
            .split(',')
            .map(n => parseInt(n.trim(), 10));

        aGraphs.push(structure);
        bGraphs.push(structure);
        graphMetadata.push({
            block_id: randomGraph.block_id,
            node_count: randomGraph.node_count,
            pc_one: randomGraph.pc_one,
            pc_two: randomGraph.pc_two,
        });
    }
}


function generateUniquePairs() {
    pairs = [];
    pairMetadata = [];

    const n = aGraphs.length;
    const allPairs = [];

    // Step 1: Generate all unique unordered pairs
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            allPairs.push([i, j]);
        }
    }

    // Step 2: Shuffle the pairs
    for (let i = allPairs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allPairs[i], allPairs[j]] = [allPairs[j], allPairs[i]];
    }

    // Step 3: Push shuffled pairs to your main array
    for (const [i, j] of allPairs) {
        pairs.push([i, j]);
        pairMetadata.push({
            indexA: i,
            indexB: j,
            blockA: graphMetadata[i].block_id,
            blockB: graphMetadata[j].block_id,
            nodeCountA: graphMetadata[i].node_count,
            nodeCountB: graphMetadata[j].node_count,
            pc1_A:graphMetadata[i].pc_one,
            pc2_A:graphMetadata[i].pc_two,
            pc1_B:graphMetadata[j].pc_one,
            pc2_B:graphMetadata[j].pc_two
        });
    }
}



///INIT TASK
let currentIndex = 0;
let graphIndex = 0;  // <-- NEW: keeps track of which pair to use

let fastCount = 0;
let trialData = [];
let id = "";

let debugmode=true

let totalGraphTrials, totalProbeTrials;
if (debugmode){
    totalGraphTrials = 20; 
    totalProbeTrials = 20;
}else{
    totalGraphTrials = 465;
    totalProbeTrials = 20;
}

let totaltrial = totalGraphTrials + totalProbeTrials;

let trialSequence = Array.from({ length: totaltrial }, (_, i) => ({
    type: "graph",
    index: i
}));

// Randomly assign `totalProbeTrials` indices as probes
let probeSet = new Set();
while (probeSet.size < totalProbeTrials) {
    let idx = Math.floor(Math.random() * totaltrial);
    if (!probeSet.has(idx)) {
        probeSet.add(idx);
        trialSequence[idx] = { type: "probe" };
    }
}

window.onload = async () => {
    await loadGraphsFromJSON();
    generateUniquePairs();

    const urlParams = new URLSearchParams(window.location.search);
    const paramId = urlParams.get("ParticipantId");

    if (paramId) {
        id = paramId;
        document.getElementById("instruction").style.display = "none";
        document.getElementById("task").style.display = "block";
        startTask(true); // autoStart = true
    } else {
        const input = document.getElementById("participantId");
        if (input) input.value = '';  // Optional: clear input
    }
};



function startTask(autoStart = false) {
    const inputEl = document.getElementById("participantId");

    if (autoStart) {
        // id already set from URL
    } else {
        const inputId = inputEl?.value.trim();
        if (!inputId) return alert("Please enter your ID");
        id = inputId;

        // Redirect to include the ID in URL
        window.location.href = `?ParticipantId=${encodeURIComponent(id)}`;
        return;
    }

    // Hide initial input and show instructions
    document.getElementById("instruction").style.display = "none";
    document.getElementById("preTaskInstruction").style.display = "block";

    const listener = (e) => {
        if (e.code === "Space") {
            document.removeEventListener("keydown", listener);

            // Request fullscreen
            const elem = document.documentElement;
            if (elem.requestFullscreen) {
                elem.requestFullscreen();
            } else if (elem.webkitRequestFullscreen) {
                elem.webkitRequestFullscreen();
            } else if (elem.msRequestFullscreen) {
                elem.msRequestFullscreen();
            }

            document.getElementById("preTaskInstruction").style.display = "none";
            document.getElementById("task").style.display = "block";
            runTrial();
        }
    };

    document.addEventListener("keydown", listener);
}




function showBreakScreen() {
    inBreak = true;
    breakStartTime = performance.now();

    document.getElementById("task").style.display = "none";
    document.getElementById("breakScreen").style.display = "block";

    const countdownDisplay = document.getElementById("breakCountdown");
    const earlyResumeMsg = document.getElementById("earlyResumeMessage");

    earlyResumeMsg.style.display = "none";

    let interval;
    let awaitingExtension = false;
    let allowEarlyResume = false;
    let breakTimerStarted = false;

    document.addEventListener("keydown", handleSpacePress);

    function handleSpacePress(e) {
        if (e.code === 'Space') {
            if (awaitingExtension) {
                clearInterval(interval);
                earlyResumeMsg.style.display = "none";
                awaitingExtension = false;
                startBreak(30); // Extend by 30s
            } else if (allowEarlyResume) {
                clearInterval(interval);
                endBreak(); // Resume early
            }
        }
    }

    function startBreak(duration) {
        let remaining = duration;
        awaitingExtension = false;
        allowEarlyResume = duration === 30; // enable early resume if it's an extension
        earlyResumeMsg.style.display = "none";
        countdownDisplay.textContent = `: ${remaining} seconds`;

        interval = setInterval(() => {
            remaining--;
            countdownDisplay.textContent = `: ${remaining} seconds`;

            // For initial 60s, enable early resume after 30s have passed
            if (duration === 60 && remaining === 30) {
                allowEarlyResume = true;
                earlyResumeMsg.style.display = "block";
                earlyResumeMsg.textContent = "You may press SPACE to resume early.";
            }else if(duration === 30) {
                allowEarlyResume = true;
                earlyResumeMsg.style.display = "block";
                earlyResumeMsg.textContent = "You may press SPACE to resume early.";
            }

            if (remaining <= 0) {
                clearInterval(interval);
                allowEarlyResume = false; // disable early resume during countdown
                startExtensionCountdown();
            }
        }, 1000);
    }

    function startExtensionCountdown() {
        let countdown = 5;
        awaitingExtension = true;
        earlyResumeMsg.style.display = "block";
        earlyResumeMsg.textContent = `Break ending in ${countdown}... Press SPACE to continue break.`;

        interval = setInterval(() => {
            countdown--;
            earlyResumeMsg.textContent = `Break ending in ${countdown}... Press SPACE to continue break.`;

            if (countdown <= 0) {
                clearInterval(interval);
                if (!awaitingExtension) return; // Already extended
                endBreak(); // No SPACE pressed — resume task
            }
        }, 1000);
    }

    function endBreak() {
        inBreak = false;
        awaitingExtension = false;
        allowEarlyResume = false;
        document.removeEventListener("keydown", handleSpacePress);
        document.getElementById("breakScreen").style.display = "none";
        document.getElementById("task").style.display = "block";
        runTrial();
    }

    startBreak(60);
}




const breakPointsTriggered = new Set();


//break time over
function runTrial() {
    const quarter = Math.floor(totaltrial / 4);
    const breakPoints = [quarter, quarter * 2, quarter * 3];

    if (breakPoints.includes(currentIndex) && !breakPointsTriggered.has(currentIndex)) {
        breakPointsTriggered.add(currentIndex); 
        showBreakScreen();
        return;
    }


    if (currentIndex >= totaltrial) {
        document.getElementById("task").style.display = "none";
        document.getElementById("thanks").style.display = "block";
        saveCSV();
        return;
    }

    const trial = trialSequence[currentIndex];
    console.log(trial)
    const instructionsEl = document.getElementById("instructionsText");

    if (trial.type === "probe") {
        instructionsEl.innerHTML = 'Press <strong>SPACE</strong> button.';
        instructionsEl.style.color = 'red';

        const graphA = aGraphs[Math.floor(Math.random() * 30)];
        const graphB = bGraphs[Math.floor(Math.random() * 30)];
        drawGraph(graphA, "graph-left");
        drawGraph(graphB, "graph-right");

    } else {
        const pair = pairs[graphIndex];
        const graphA = aGraphs[pair[0]];
        const graphB = bGraphs[pair[1]];

        drawGraph(graphA, "graph-left");
        drawGraph(graphB, "graph-right");

        instructionsEl.innerHTML = 'With your gut feelings, which one looks more like a social network to you?<br>Press <strong>F</strong> if you prefer the <strong>left</strong> graph, <strong>J</strong> for the <strong>right</strong> graph.';
        instructionsEl.style.color = 'black';
    }

    document.getElementById("warning").style.display = "none";
    document.getElementById("graph-container").style.display = "flex";

    const trialStart = performance.now();
    let responded = false;

    const keyListener = (e) => {
        if (responded) return;
        if ((trial.type === "probe" &&(e.code === "Space" ||e.key === "f" || e.key === "j")) || (trial.type === "graph" && (e.key === "f" || e.key === "j"))) {
            responded = true;
            const rt = performance.now() - trialStart;

            if (trial.type === "probe") {
                trialData.push({
                    id,
                    trial: currentIndex,
                    type: trial.type,
                    rt: Math.round(rt),
                    choice: e.code === "Space" ? "SPACE" : e.key,
                    block_a: [],
                    node_count_a: [],
                    block_b: [],
                    node_count_b: [],
                    graphA: [],
                    graphB: [],
                    pc1_A: [],
                    pc2_A: [],
                    pc1_B: [],
                    pc2_B: [],
                    posA: [],
                    posB: []
                });
            } else {
                const [indexA, indexB] = pairs[graphIndex];
                const metaA = graphMetadata[indexA];
                const metaB = graphMetadata[indexB];
                const graphA = aGraphs[indexA];
                const graphB = bGraphs[indexB];
                const posA = JSON.parse(document.getElementById("graph-left").dataset.positions || "{}");
                const posB = JSON.parse(document.getElementById("graph-right").dataset.positions || "{}");

                trialData.push({
                    id,
                    trial: currentIndex,
                    type: trial.type,
                    rt: Math.round(rt),
                    choice: e.key,
                    block_a: metaA.block_id,
                    node_count_a: metaA.node_count,
                    block_b: metaB.block_id,
                    node_count_b: metaB.node_count,
                    graphA: graphA,
                    graphB: graphB,
                    pc1_A: metaA.pc_one,
                    pc2_A: metaA.pc_two,
                    pc1_B: metaB.pc_one,
                    pc2_B: metaB.pc_two,
                    posA: formatPositionsForCSV(posA),
                    posB: formatPositionsForCSV(posB)
                });
                graphIndex++;
            }

            if (rt < 100) {
                fastCount++;
            } else {
                fastCount = 0;
            }

            document.removeEventListener("keydown", keyListener);
            if (fastCount >= 3) {
                document.getElementById("graph-container").style.display = "none";
                let warningElement = document.getElementById("warning");
                let timeLeft = 10;
                warningElement.style.display = "block";
                warningElement.textContent = `⚠️ You're responding too fast! Please slow down. (${timeLeft}s)`;

                const countdown = setInterval(() => {
                    timeLeft--;
                    if (timeLeft > 0) {
                        warningElement.textContent = `⚠️ You're responding too fast! Please slow down. (${timeLeft}s)`;
                    } else {
                        clearInterval(countdown);
                        warningElement.style.display = "none";
                        fastCount = 0;
                        currentIndex++;
                        runTrial();
                    }
                }, 1000);
            } else {
                setTimeout(() => {
                    currentIndex++;
                    runTrial();
                }, 500);
            }
        }
    };

    document.addEventListener("keydown", keyListener);

    setTimeout(() => {
        if (!responded) {
            if (trial.type === "probe") {
                trialData.push({
                    id,
                    trial: currentIndex,
                    type: trial.type,
                    rt: "timeout",
                    choice: "none",
                    block_a: [],
                    node_count_a: [],
                    block_b: [],
                    node_count_b: [],
                    graphA: [],
                    graphB: [],
                    pc1_A: [],
                    pc2_A: [],
                    pc1_B: [],
                    pc2_B: [],
                    posA: [],
                    posB: []
                });
            } else {
                const [indexA, indexB] = pairs[graphIndex];
                const metaA = graphMetadata[indexA];
                const metaB = graphMetadata[indexB];
                const graphA = aGraphs[indexA];
                const graphB = bGraphs[indexB];
                const posA = JSON.parse(document.getElementById("graph-left").dataset.positions || "{}");
                const posB = JSON.parse(document.getElementById("graph-right").dataset.positions || "{}");

                trialData.push({
                    id,
                    trial: currentIndex,
                    type: trial.type,
                    rt: "timeout",
                    choice: "none",
                    block_a: metaA.block_id,
                    node_count_a: metaA.node_count,
                    block_b: metaB.block_id,
                    node_count_b: metaB.node_count,
                    graphA: graphA,
                    graphB: graphB,
                    pc1_A: metaA.pc_one,
                    pc2_A: metaA.pc_two,
                    pc1_B: metaB.pc_one,
                    pc2_B: metaB.pc_two,
                    posA: formatPositionsForCSV(posA),
                    posB: formatPositionsForCSV(posB)
                });
                graphIndex++;
            }

            document.removeEventListener("keydown", keyListener);
            currentIndex++;
            runTrial();
        }
    }, 10000);
}


function drawGraph(graphStructure, containerId) {
    const elements = [];
    const size = Math.sqrt(graphStructure.length);
    const localPositions = {}; // Local to this graph render

    for (let i = 0; i < size; i++) {
        elements.push({ data: { id: `n${i}` } });
    }

    for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
            if (graphStructure[i * size + j] === 1) {
                elements.push({ data: { source: `n${i}`, target: `n${j}` } });
            }
        }
    }

    const edgeCount = elements.filter(e => e.data.source && e.data.target).length;
    const nodeCount = size;
    const maxEdges = nodeCount * (nodeCount - 1) / 2;
    const edgeDensity = edgeCount / maxEdges;

    let nodeRepulsion;
    if (edgeDensity > 1.25) nodeRepulsion = 20000000;
    else if (edgeDensity > 1) nodeRepulsion = 15000000;
    else if (edgeDensity > 0.75) nodeRepulsion = 10000000;
    else if (edgeDensity > 0.5) nodeRepulsion = 750000;
    else if (edgeDensity > 0.25) nodeRepulsion = 50000;
    else nodeRepulsion = 2500000;

    const cy = cytoscape({
        container: document.getElementById(containerId),
        elements: elements,
        style: [
            { selector: 'node', style: { width: '15px', height: '15px', 'background-color': 'blue' }},
            { selector: 'edge', style: { 'line-color': 'gray', width: 2 }}
        ],
        layout: {
            name: 'cose',
            nodeRepulsion: nodeRepulsion,
            idealEdgeLength: 10,
            gravity: 0.25,
            animate: true
        },
        zoomingEnabled: false,
        panningEnabled: false,
        userZoomingEnabled: false,
        userPanningEnabled: false,
        boxSelectionEnabled: false,
        autoungrabify: true
    });

    cy.on('layoutstop', () => {
        const boundingBox = cy.elements().boundingBox();
        const centerX = boundingBox.x1 + boundingBox.w / 2;
        const centerY = boundingBox.y1 + boundingBox.h / 2;
        const offsetX = cy.width() / 2 - centerX;
        const offsetY = cy.height() / 2 - centerY;

        cy.nodes().positions((node) => {
            const pos = node.position();
            const adjusted = {
                x: pos.x + offsetX,
                y: pos.y + offsetY
            };
            localPositions[node.id()] = adjusted;
            return adjusted;
        });

        // Optional: assign globally if needed
        storedPositions = localPositions;

        // Store to the canvas itself for access
        document.getElementById(containerId).dataset.positions = JSON.stringify(localPositions);
    });

    // Return handle to possibly use later (optional)
    return cy;
}


function formatPositionsForCSV(posObj) {
    return Object.entries(posObj)
        .map(([key, val]) => `${key}:${val.x.toFixed(1)},${val.y.toFixed(1)}`)  // <-- comma between x and y
        .join(';');  // <-- semicolon between nodes
}





async function saveCSV() {
    const header = 'id,trial,type,rt,choice,block_a,node_count_a,block_b,node_count_b,graphA,graphB,pc1_A,pc3_A,pc1_B,pc3_B,posA,posB';
    const rows = trialData.map(row => {
      return `${row.id},${row.trial},${row.type},${row.rt},${row.choice},${row.block_a},${row.node_count_a},${row.block_b},${row.node_count_b},"${JSON.stringify(row.graphA)}","${JSON.stringify(row.graphB)}",${row.pc1_A},${row.pc2_A},${row.pc1_B},${row.pc2_B},"${row.posA}","${row.posB}"`;
    });
  
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
  
    // Dynamically set filename from participant ID
    const id = trialData[0]?.id || `anon_${Date.now()}`;
    const filename = `maindata_${id}.csv`;
  
    const formData = new FormData();
    formData.append("file", blob, filename);
  
    try {
      const response = await fetch(`https://srnpro.vercel.app/api/upload-runsheet?key=${filename}`, {
        method: "POST",
        body: formData,
      });
  
      if (!response.ok) throw new Error("Upload failed");
      const result = await response.json();
      alert("Upload successful!");
      console.log("Upload response:", result);
    } catch (err) {
      console.error("Upload error:", err);
      alert("Upload failed: " + err.message);
    }
  }
  



