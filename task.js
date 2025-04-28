let aGraphs = [];
let bGraphs = [];
let graphMetadata = [];

let pairs = [];
let pairMetadata = [];

async function loadGraphsFromJSON() {
    const response = await fetch('Block_Graph.json');
    const jsonData = await response.json();

    const seen = new Set();

    for (const row of jsonData) {
        const key = `${row.block_id}_${row.node_count}`;
        if (!seen.has(key)) {
            seen.add(key);

            const structure = row.graph_structure
                .replace('[', '')
                .replace(']', '')
                .split(',')
                .map(n => parseInt(n.trim(), 10));
            aGraphs.push(structure);
            bGraphs.push(structure);
            graphMetadata.push({
                block_id: row.block_id,
                node_count: row.node_count,
                pc_one: row.pc_one,
                pc_two: row.pc_two,
            });
        }
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



window.onload = async () => {
    await loadGraphsFromJSON();
    generateUniquePairs();
};


///INIT TASK
let currentIndex = 0;
let graphIndex = 0;  // <-- NEW: keeps track of which pair to use

let fastCount = 0;
let trialData = [];
let id = "";

let totalGraphTrials = 435;  // Number of graph comparison trials
let totalProbeTrials = 20;
// let totaltrial = totalGraphTrials + totalProbeTrials;
let totaltrial = 21
let trialSequence = Array.from({ length: totaltrial }, (_, i) => ({
    type: "graph",
    index: i  // This will be overwritten for probe later
}));

// Randomly assign `totalProbeTrials` indices as probes
let probeSet = new Set();
while (probeSet.size < totalProbeTrials) {
    let idx = Math.floor(Math.random() * totalGraphTrials)+1;
    if (!probeSet.has(idx)) {
        probeSet.add(idx);
        trialSequence[idx] = { type: "probe" };
    }
}



// Function to start the task
function startTask() {
    id = document.getElementById("participantId").value.trim();
    if (!id) return alert("Please enter your ID");
    document.getElementById("instruction").style.display = "none";
    document.getElementById("task").style.display = "block";
    runTrial();
}

// Function to run each trial
function runTrial() {
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
        instructionsEl.innerHTML = 'Press <strong>P</strong> button.';
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
    
        instructionsEl.innerHTML = 'Press <strong>F</strong> if you prefer the <strong>left</strong> graph, <strong>J</strong> for the <strong>right</strong> graph.';
        instructionsEl.style.color = 'black';
    }    
    document.getElementById("warning").style.display = "none";
    document.getElementById("graph-container").style.display = "flex";

    const trialStart = performance.now();
    let responded = false;
    
    const keyListener = (e) => {
        if (responded) return;
        if  ((trial.type === "probe" && e.key === "p"||(e.key === "f" || e.key === "j")) ||
        (trial.type === "graph" && (e.key === "f" || e.key === "j"))){
            if (trial.type === "probe"){
                responded = true;
                const rt = performance.now() - trialStart;
        
                trialData.push({
                    id,
                    trial: currentIndex,
                    type: trial.type,
                    rt: Math.round(rt),
                    choice: e.key,
                    block_a: [],
                    node_count_a: [],
                    block_b: [],
                    node_count_b: [],
                    graphA:[],
                    graphB: [],
                    pc1_A: [],
                    pc2_A: [],
                    pc1_B: [],
                    pc2_B: [],
                    posA:[],
                    posB:[]
                });
            if (rt < 100) {
                fastCount++;
            } else {
                fastCount = 0;
            }
        }else if (trial.type === "graph"){
            responded = true;
            const rt = performance.now() - trialStart;
            const[indexA, indexB] = pairs[graphIndex];;
            const metaA = graphMetadata[indexA];
            const metaB = graphMetadata[indexB];
            const graphA = aGraphs[indexA];
            const graphB = bGraphs[indexB];
    
            // Later, during logging:
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
            if (rt < 100) {
                fastCount++;
            } else {
                fastCount = 0;
            }
        }
            document.removeEventListener("keydown", keyListener);
            if (fastCount >= 3) {
                // Hide graphs, show countdown
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
            if(trial.type === "probe"){
                trialData.push({
                    id,
                    trial: currentIndex,
                    type: trial.type,
                    rt: "timeout",
                    choice: "none",
                    block_a: [],
                    node_count_a: [],
                    block_b:[],
                    node_count_b:[],
                    graphA: [],
                    graphB:[],
                    pc1_A: [],
                    pc2_A: [],
                    pc1_B: [],
                    pc2_B: [],
                    posA: [],
                    posB: []
                });
        
                document.removeEventListener("keydown", keyListener);
                currentIndex++;
                runTrial();
            }else if( trial.type === "graph"){
                const[indexA, indexB] = pairs[graphIndex];;
                const metaA = graphMetadata[indexA];
                const metaB = graphMetadata[indexB];
                const graphA = aGraphs[indexA];
                const graphB = bGraphs[indexB];

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
                document.removeEventListener("keydown", keyListener);
                currentIndex++;
                runTrial();
            }
        }
        console.log("timeout")
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





function saveCSV() {
    const header = 'id,trial,type,rt,choice,block_a,node_count_a,block_b,node_count_b,graphA,graphB,pc1_A,pc2_A,pc1_B,pc2_B,posA,posB';
    const rows = trialData.map(row => {
        return `${row.id},${row.trial},${row.type},${row.rt},${row.choice},${row.block_a},${row.node_count_a},${row.block_b},${row.node_count_b},"${JSON.stringify(row.graphA)}","${JSON.stringify(row.graphB)}",${row.pc1_A},${row.pc1_B},${row.pc2_A},${row.pc2_B},"${row.posA}","${row.posB}"`;
    });

    const csv = [header, ...rows].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `data_${id}.csv`;
    link.click();
}



