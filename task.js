let aGraphs = [];
let bGraphs = [];
let graphMetadata = [];
let inBreak = false;
let breakStartTime = null;

let pairs = [];
let pairMetadata = [];

// Keep live cy refs so we can snapshot exact render state
let lastCyLeft = null;
let lastCyRight = null;


// ====== Deterministic RNG (so resumes match exact original order) ======
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1^h2^h3^h4)>>>0, (h2^h1)>>>0, (h3^h1)>>>0, (h4^h1)>>>0];
}
function seedFromString(s, salt="") {
  const [a,b,c,d] = cyrb128(s + "|" + salt);
  return (a ^ b ^ c ^ d) >>> 0;
}
// Global seeds & PRNGs (set after we know id)
let PAIR_SEED = 0;
let PROBE_SEED = 0;
let PICK_SEED  = 0;   // selecting one graph per block + per-probe random drawings
let randPairs = Math.random;
let randProbes = Math.random;
let randPick = Math.random;
function initPRNGsFromId(id) {
  PAIR_SEED  = seedFromString(id, "pair");
  PROBE_SEED = seedFromString(id, "probe");
  PICK_SEED  = seedFromString(id, "pick");

  randPairs  = mulberry32(PAIR_SEED);
  randProbes = mulberry32(PROBE_SEED);
  randPick   = mulberry32(PICK_SEED);
}
function randInt(randFn, max) { return Math.floor(randFn() * max); }

// ===== Fullscreen checks =====
let fullscreenViolations = 0;
let pausedForFullscreen = false;
let currentKeyListener = null;   // per-trial key handler (so we can remove it cleanly)
let currentTimeoutId = null;     // per-trial 10s timeout (so we can clear it)
let endedEarly = false;          // set when we terminate due to violations

function isFullscreenActive() {
  return !!(document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.msFullscreenElement);
}

function ensureFsOverlay() {
  let el = document.getElementById('fsWarningOverlay');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'fsWarningOverlay';
  Object.assign(el.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(0,0,0,0.8)',
    color: '#fff',
    display: 'none',
    zIndex: 10000,
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: '24px',
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif'
  });

  const inner = document.createElement('div');
  inner.style.maxWidth = '800px';
  inner.innerHTML = `
    <h2 style="margin:0 0 12px 0;font-size:28px;">Please stay in fullscreen</h2>
    <p id="fsWarningText" style="font-size:18px;line-height:1.5;margin:0 0 16px 0;"></p>
    <p style="opacity:.85;margin:0 0 16px 0;">
      Press <strong>SPACE</strong> to re-enter fullscreen and resume the task.
    </p>
    <p style="font-size:14px;opacity:.7;">Leaving fullscreen more than twice will end the experiment.</p>
  `;

  el.appendChild(inner);
  document.body.appendChild(el);
  return el;
}

function showFsOverlay(violations) {
  const overlay = ensureFsOverlay();
  const txt = document.getElementById('fsWarningText');
  txt.textContent = `Warning ${violations}/2 — You exited fullscreen. The task is paused.`;
  overlay.style.display = 'flex';
}

function hideFsOverlay() {
  const overlay = document.getElementById('fsWarningOverlay');
  if (overlay) overlay.style.display = 'none';
}

function pauseForFullscreenExit() {
  if (pausedForFullscreen || endedEarly) return;
  pausedForFullscreen = true;

  if (currentKeyListener) {
    document.removeEventListener('keydown', currentKeyListener);
    currentKeyListener = null;
  }
  if (currentTimeoutId) {
    clearTimeout(currentTimeoutId);
    currentTimeoutId = null;
  }

  fullscreenViolations += 1;
  if (fullscreenViolations >= 2) {
    endExperimentEarly();
    return;
  }

  showFsOverlay(fullscreenViolations);

  const resumeHandler = async (e) => {
    if (e.code !== 'Space') return;

    // Try to (re)enter fullscreen on SPACE
    const elem = document.documentElement;
    if (!isFullscreenActive()) {
      try {
        if (elem.requestFullscreen) await elem.requestFullscreen();
        else if (elem.webkitRequestFullscreen) await elem.webkitRequestFullscreen();
        else if (elem.msRequestFullscreen) await elem.msRequestFullscreen();
      } catch (_) { /* ignore */ }
    }

    if (!isFullscreenActive()) return; // still not fullscreen -> keep overlay up

    document.removeEventListener('keydown', resumeHandler);
    hideFsOverlay();
    pausedForFullscreen = false;
    runTrial(); // re-run same trial
  };

  document.addEventListener('keydown', resumeHandler);
}

function endExperimentEarly() {
  endedEarly = true;
  hideFsOverlay();
  const taskEl = document.getElementById('task');
  if (taskEl) taskEl.style.display = 'none';

  let term = document.getElementById('terminated');
  if (!term) {
    term = document.createElement('div');
    term.id = 'terminated';
    term.style.padding = '32px';
    term.style.fontFamily = 'system-ui,-apple-system,Segoe UI,Roboto,Arial';
    term.innerHTML = `
      <h2>Experiment ended</h2>
      <p>You left fullscreen too many times. The session will end now.</p>
      <p>Your data so far will be saved.</p>
    `;
    document.body.appendChild(term);
  } else {
    term.style.display = 'block';
  }

  if (currentKeyListener) {
    document.removeEventListener('keydown', currentKeyListener);
    currentKeyListener = null;
  }
  if (currentTimeoutId) {
    clearTimeout(currentTimeoutId);
    currentTimeoutId = null;
  }

  saveCSV(); // uploads + redirects
}

function attachFullscreenGuards() {
  if (attachFullscreenGuards._bound) return;
  attachFullscreenGuards._bound = true;

  const onFsChange = () => {
    const taskVisible = document.getElementById('task')?.style.display === 'block';
    if (taskVisible && !isFullscreenActive()) pauseForFullscreenExit();
  };

  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  document.addEventListener('msfullscreenchange', onFsChange);
}

// ===== Consent / Instructions =====
const CONSENT_PDF_URL = 'consent/consent.pdf';
let consentScrolledToEnd = false;

const INSTR_DIR = 'instructions';
const INSTR_MAX = 200;

let instructionPages = [];
let instrIndex = 0;

function preloadInstructionPNGs() {
  const tryLoad = (n) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ ok: true, url: `${INSTR_DIR}/${n}.png` });
    img.onerror = () => resolve({ ok: false });
    img.src = `${INSTR_DIR}/${n}.png?cachebust=${Date.now()}`;
  });

  return (async () => {
    const found = [];
    for (let i = 1; i <= INSTR_MAX; i++) {
      const res = await tryLoad(i);
      if (!res.ok) break;
      found.push(res.url);
    }
    return found;
  })();
}

function renderInstructionPage() {
  const imgEl = document.getElementById('instructionImage');
  const pagerEl = document.getElementById('instrPager');
  const prevBtn = document.getElementById('instrPrev');
  const nextBtn = document.getElementById('instrNext');
  const startBtn = document.getElementById('instrStart');

  if (!instructionPages.length) {
    imgEl.alt = 'No instruction images found';
    pagerEl.textContent = '';
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    startBtn.style.display = 'none';
    return;
  }

  imgEl.src = instructionPages[instrIndex];
  pagerEl.textContent = `Page ${instrIndex + 1} of ${instructionPages.length}`;
  prevBtn.disabled = (instrIndex === 0);
  nextBtn.disabled = (instrIndex === instructionPages.length - 1);
  startBtn.style.display = (instrIndex === instructionPages.length - 1) ? 'inline-block' : 'none';
}

function showInstructionCarousel() {
  document.getElementById('instructionCarousel').style.display = 'block';
  document.getElementById('task').style.display = 'none';
  document.getElementById('instruction').style.display = 'none';

  document.getElementById('instrPrev').onclick = () => {
    if (instrIndex > 0) { instrIndex--; renderInstructionPage(); }
  };
  document.getElementById('instrNext').onclick = () => {
    if (instrIndex < instructionPages.length - 1) { instrIndex++; renderInstructionPage(); }
  };
  document.getElementById('instrStart').onclick = beginExperiment;

  document.addEventListener('keydown', instructionKeyHandler);
  renderInstructionPage();
}

function hideInstructionCarousel() {
  document.getElementById('instructionCarousel').style.display = 'none';
  document.removeEventListener('keydown', instructionKeyHandler);
}

function instructionKeyHandler(e) {
  if (e.key === 'ArrowLeft') {
    if (instrIndex > 0) { instrIndex--; renderInstructionPage(); }
  } else if (e.key === 'ArrowRight') {
    if (instrIndex < instructionPages.length - 1) { instrIndex++; renderInstructionPage(); }
  }
}

function beginExperiment() {
  const elem = document.documentElement;
  if (elem.requestFullscreen) elem.requestFullscreen();
  else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
  else if (elem.msRequestFullscreen) elem.msRequestFullscreen();

  hideInstructionCarousel();
  document.getElementById('task').style.display = 'block';
  attachFullscreenGuards();
  runTrial();
}

async function renderConsentPDF(url, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  const pdf = await pdfjsLib.getDocument(url).promise;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1.5 });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    container.appendChild(canvas);
    await page.render({ canvasContext: ctx, viewport }).promise;
  }
}

function showConsent() {
  const view = document.getElementById('consentView');
  const wrap = document.getElementById('consentScrollWrap');
  const checkbox = document.getElementById('consentCheckbox');
  const agreeBtn = document.getElementById('consentAgreeBtn');
  const progress = document.getElementById('consentProgress');

  consentScrolledToEnd = false;
  checkbox.checked = false;
  checkbox.disabled = true;
  agreeBtn.disabled = true;
  agreeBtn.style.cursor = 'not-allowed';
  agreeBtn.style.opacity = '.5';
  progress.textContent = 'Scroll to the end to enable the button.';

  view.style.display = 'block';
  const instrEl = document.getElementById('instructionCarousel');
  if (instrEl) instrEl.style.display = 'none';

  document.getElementById('instruction').style.display = 'none';
  document.getElementById('task').style.display = 'none';

  renderConsentPDF(CONSENT_PDF_URL, 'consentPdfContainer').then(() => {
    wrap.scrollTop = 0;
  });

  function onScroll() {
    const atBottom = Math.ceil(wrap.scrollTop + wrap.clientHeight) >= (wrap.scrollHeight - 4);
    if (atBottom && !consentScrolledToEnd) {
      consentScrolledToEnd = true;
      checkbox.disabled = false;
      progress.textContent = 'You’ve reached the end. Check the box to enable the button.';
    }
  }
  wrap.removeEventListener('scroll', onScroll);
  wrap.addEventListener('scroll', onScroll);

  checkbox.onchange = () => {
    if (checkbox.checked && consentScrolledToEnd) {
      agreeBtn.disabled = false;
      agreeBtn.style.cursor = 'pointer';
      agreeBtn.style.opacity = '1';
    } else {
      agreeBtn.disabled = true;
      agreeBtn.style.cursor = 'not-allowed';
      agreeBtn.style.opacity = '.5';
    }
  };

  agreeBtn.onclick = () => {
    if (agreeBtn.disabled) return;
    view.style.display = 'none';
    showInstructionCarousel();
  };
}

// ===== Choice banner =====
function ensureChoiceBanner() {
  let el = document.getElementById('choiceBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'choiceBanner';
    Object.assign(el.style, {
      position: 'fixed',
      left: '50%',
      bottom: '16px',
      transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.75)',
      color: '#fff',
      padding: '8px 14px',
      borderRadius: '10px',
      fontSize: '18px',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
      zIndex: 9999,
      display: 'none',
      pointerEvents: 'none',
      letterSpacing: '0.25px'
    });
    document.body.appendChild(el);
  }
}
function showChoiceBanner(text) {
  const el = document.getElementById('choiceBanner');
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
}
function hideChoiceBanner() {
  const el = document.getElementById('choiceBanner');
  if (el) el.style.display = 'none';
}

// ===== Data loading / pairing (deterministic) =====
async function loadGraphsFromJSON() {
  aGraphs = [];
  bGraphs = [];
  graphMetadata = [];

  const response = await fetch('Block_Graph.json');
  const jsonData = await response.json();

  const grouped = {};
  for (const row of jsonData) {
    const key = `${row.block_id}_${row.node_count}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  }

  for (const key in grouped) {
    const graphs = grouped[key];
    const pickIdx = randInt(randPick, graphs.length); // deterministic pick
    const randomGraph = graphs[pickIdx];

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

function shuffleInPlaceDeterministic(arr, randFn) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(randFn() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function generateUniquePairs() {
  pairs = [];
  pairMetadata = [];

  const n = aGraphs.length;
  const allPairs = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      allPairs.push([i, j]);
    }
  }
  shuffleInPlaceDeterministic(allPairs, randPairs);

  for (const [i, j] of allPairs) {
    pairs.push([i, j]);
    pairMetadata.push({
      indexA: i,
      indexB: j,
      blockA: graphMetadata[i].block_id,
      blockB: graphMetadata[j].block_id,
      nodeCountA: graphMetadata[i].node_count,
      nodeCountB: graphMetadata[j].node_count,
      pc1_A: graphMetadata[i].pc_one,
      pc2_A: graphMetadata[i].pc_two,
      pc1_B: graphMetadata[j].pc_one,
      pc2_B: graphMetadata[j].pc_two
    });
  }
}

// ===== Init / trial plan =====
let currentIndex = 0;
let graphIndex = 0;

let fastCount = 0;
let trialData = [];
let id = "";
let remainingtime_setup
let debugmode = true;

let totalGraphTrials, totalProbeTrials;
if (debugmode){
  totalGraphTrials = 20;
  totalProbeTrials = 20;
  remainingtime_setup=60
}else{
  totalGraphTrials = 190;
  totalProbeTrials = 20;
  remainingtime_setup=40
}

let totaltrial = totalGraphTrials + totalProbeTrials;

let trialSequence = []; // will be filled by buildTrialSequence()

function buildTrialSequence() {
  // totaltrial already = totalGraphTrials + totalProbeTrials
  // Clamp probe count to [0, totaltrial]
  totalProbeTrials = Math.max(0, Math.min(totalProbeTrials, totaltrial));

  // Start all as graph trials
  trialSequence = Array.from({ length: totaltrial }, () => ({ type: "graph" }));

  // Choose probe slots deterministically
  const slots = Array.from({ length: totaltrial }, (_, i) => i);
  shuffleInPlaceDeterministic(slots, randProbes);
  for (let k = 0; k < totalProbeTrials; k++) {
    trialSequence[slots[k]] = { type: "probe" };
  }
}


function reconstructIndicesFromLoadedRows() {
  // currentIndex: number of total trials already recorded (graph + probe), excluding SESSION rows
  const nonSessionRows = trialData.filter(r => r && r.type && r.type !== 'SESSION');
  currentIndex = nonSessionRows.length;

  // graphIndex: number of *graph* rows already recorded
  const graphRows = nonSessionRows.filter(r => r.type === 'graph');
  graphIndex = graphRows.length;
}

function integrateResumeState(summary) {
  // summary may contain: { status, pairSeed, probeSeed, fullscreenViolations, endedEarly, currentIndex, graphIndex }
  if (!summary) {
    reconstructIndicesFromLoadedRows();
    return;
  }
  if (typeof summary.fullscreenViolations === 'number') {
    fullscreenViolations = summary.fullscreenViolations;
  }
  if (summary.endedEarly === true) {
    // Show completed/ended page instead of resuming
    showAlreadyDonePage(summary.status || 'ended_early');
    return 'blocked';
  }
  if (summary.status === 'completed') {
    showAlreadyDonePage('completed');
    return 'blocked';
  }

  // Prefer saved indices if present; otherwise infer
  if (typeof summary.currentIndex === 'number') currentIndex = summary.currentIndex;
  if (typeof summary.graphIndex === 'number')   graphIndex   = summary.graphIndex;
  if (!(typeof summary.currentIndex === 'number') || !(typeof summary.graphIndex === 'number')) {
    reconstructIndicesFromLoadedRows();
  }
  return 'resume';
}

function showAlreadyDonePage(status='completed') {
  const root = document.getElementById('instruction') || document.body;
  const el = document.createElement('div');
  el.style.padding = '24px';
  el.style.fontFamily = 'system-ui,-apple-system,Segoe UI,Roboto,Arial';
  el.innerHTML = (status === 'completed')
    ? `<h2>You have already completed this task</h2><p>Please return the study on the platform. Thank you!</p>`
    : `<h2>Your session can’t continue</h2><p>Our records show this task was ended early for this ID. Please return the study.</p>`;
  root.innerHTML = '';
  root.appendChild(el);
}

// ===== Start / Onload =====
window.onload = async () => {
  // If landing with worker_id in the URL, init seeds immediately
  const urlParams = new URLSearchParams(window.location.search);
  const workerId = urlParams.get("worker_id");
  ensureChoiceBanner();

  if (workerId) {
    id = workerId;
    initPRNGsFromId(id);

    // Build deterministic structure
    await loadGraphsFromJSON();
    generateUniquePairs();
    buildTrialSequence();

    // Try to resume (if a previous CSV exists)
    const resumeResult = await checkAndMaybeResume(id);
    if (resumeResult === 'blocked') return; // completed/ended — don’t proceed

    if (resumeResult === 'resume') {
      // Skip consent/instructions; go straight in
      document.getElementById("instruction")?.style && (document.getElementById("instruction").style.display = "none");
      document.getElementById("task").style.display = "block";
      attachFullscreenGuards();
      runTrial();
      return;
    }

    // No prior data -> normal flow
    instructionPages = await preloadInstructionPNGs();
    document.getElementById("instruction").style.display = "none";
    showConsent();
    if (elem.requestFullscreen) elem.requestFullscreen();
    else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
    else if (elem.msRequestFullscreen) elem.msRequestFullscreen();
    return;
  }

  // If no worker_id in URL yet, load instruction pages but wait for startTask()
  instructionPages = await preloadInstructionPNGs();
  const input = document.getElementById("participantId");
  if (input) input.value = '';
};

// ===== Start task entry points =====
function startTask(autoStart = false) {
  const inputEl = document.getElementById("participantId");

  if (!autoStart) {
    const inputId = inputEl?.value.trim();
    if (!inputId) return alert("Please enter your ID");
    id = inputId;

    // Redirect with worker_id; onload will resume/continue as needed
    window.location.href = `?worker_id=${encodeURIComponent(id)}`;
    return;
  }

  // (AutoStart path used by your UI if needed)
  document.getElementById("instruction").style.display = "none";
  document.getElementById("preTaskInstruction").style.display = "block";

  const listener = (e) => {
    if (e.code === "Space") {
      document.removeEventListener("keydown", listener);

      const elem = document.documentElement;
      if (elem.requestFullscreen) elem.requestFullscreen();
      else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
      else if (elem.msRequestFullscreen) elem.msRequestFullscreen();

      document.getElementById("preTaskInstruction").style.display = "none";
      document.getElementById("task").style.display = "block";
      attachFullscreenGuards();
      runTrial();
    }
  };

  document.addEventListener("keydown", listener);
}

// ===== Break logic =====
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

  document.addEventListener("keydown", handleSpacePress);

  function handleSpacePress(e) {
    if (e.code === 'Space') {
      if (awaitingExtension) {
        clearInterval(interval);
        earlyResumeMsg.style.display = "none";
        awaitingExtension = false;
        startBreak(30);
      } else if (allowEarlyResume) {
        clearInterval(interval);
        endBreak();
      }
    }
  }

  function startBreak(duration) {
    let remaining = duration;
    awaitingExtension = false;
    allowEarlyResume = duration === 30;
    earlyResumeMsg.style.display = "none";
    countdownDisplay.textContent = `: ${remaining} seconds`;

    interval = setInterval(() => {
      remaining--;
      countdownDisplay.textContent = `: ${remaining} seconds`;

      if (duration === 60 && remaining === remainingtime_setup) {
        allowEarlyResume = true;
        earlyResumeMsg.style.display = "block";
        earlyResumeMsg.textContent = "You may press SPACE to resume early.";
      } else if (duration === 30) {
        allowEarlyResume = true;
        earlyResumeMsg.style.display = "block";
        earlyResumeMsg.textContent = "You may press SPACE to resume early.";
      }

      if (remaining <= 0) {
        clearInterval(interval);
        allowEarlyResume = false;
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
        if (!awaitingExtension) return;
        endBreak();
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

//position store
function snapshotCy(cy) {
  if (!cy) return { error: "no cy" };

  // Node positions in rendered/model coordinates
  const nodes = {};
  cy.nodes().forEach(n => {
    const p = n.position();               // model coords (layout)
    const rp = n.renderedPosition();      // pixel coords on canvas
    nodes[n.id()] = {
      x: +p.x.toFixed(3),
      y: +p.y.toFixed(3),
      rx: +rp.x.toFixed(3),
      ry: +rp.y.toFixed(3)
    };
  });

  // Edge list (source/target by id)
  const edges = cy.edges().map(e => ({
    source: e.source().id(),
    target: e.target().id()
  }));

  // Viewport + container
  const view = {
    zoom: +cy.zoom().toFixed(5),
    pan: cy.pan(),                        // {x, y}
    width: cy.width(),
    height: cy.height()
  };

  // Try to pull layout options if available
  let layoutInfo = {};
  try {
    const opts = cy._private && cy._private.layout && cy._private.layout.options ? cy._private.layout.options : {};
    layoutInfo = {
      name: opts.name || 'unknown',
      nodeRepulsion: opts.nodeRepulsion ?? null,
      idealEdgeLength: opts.idealEdgeLength ?? null,
      gravity: opts.gravity ?? null,
      animate: opts.animate ?? null
    };
  } catch (_) {/* noop */}

  return { nodes, edges, view, layout: layoutInfo, ts: Date.now() };
}

// Convenience: produce a JSON string ready for CSV
function snapshotCyForCSV(cy) {
  return JSON.stringify(snapshotCy(cy));
}


// ===== Trial loop =====
function runTrial() {
  if (pausedForFullscreen || endedEarly) return;

  // In runTrial(), replace the breakPoints lines with:
  const quarter = Math.floor(totaltrial / 4);
  const breakPoints = [quarter, quarter * 2, quarter * 3]
    .filter(i => i > 0 && i < totaltrial);

  hideChoiceBanner();

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
  if (graphIndex >= pairs.length) {
    // No more unique pairs available; end cleanly.
    document.getElementById("task").style.display = "none";
    document.getElementById("thanks").style.display = "block";
    saveCSV();
    return;
  }

  const trial = trialSequence[currentIndex];
  const instructionsEl = document.getElementById("instructionsText");

  if (trial.type === "probe") {
    instructionsEl.innerHTML = 'Press <strong>SPACE</strong> button.';
    instructionsEl.style.color = 'red';

    const randA = randInt(randPick, aGraphs.length);
    const randB = randInt(randPick, bGraphs.length);
    const graphA = aGraphs[randA];
    const graphB = bGraphs[randB];
    lastCyLeft  = drawGraph(graphA, "graph-left");
    lastCyRight = drawGraph(graphB, "graph-right");


  } else {
    const pair = pairs[graphIndex];
    const graphA = aGraphs[pair[0]];
    const graphB = bGraphs[pair[1]];

    lastCyLeft  = drawGraph(graphA, "graph-left");
    lastCyRight = drawGraph(graphB, "graph-right");


    instructionsEl.innerHTML = 'If you think the left graph resembles the reality more, press <strong>F<strong>. <br> Alternatively, if you think the right graph resembles the reality more, press <strong>J<strong>.';
    instructionsEl.style.color = 'black';
  }

  document.getElementById("warning").style.display = "none";
  document.getElementById("graph-container").style.display = "flex";

  const trialStart = performance.now();
  let responded = false;

  const keyListener = (e) => {
    if (responded || pausedForFullscreen || endedEarly) return;

    if ((trial.type === "probe" && (e.code === "Space" || e.key === "f" || e.key === "j")) ||
        (trial.type === "graph" && (e.key === "f" || e.key === "j"))) {

      responded = true;
      const rt = performance.now() - trialStart;

      if (trial.type === "probe") {
        if (e.code === "Space") {
          showChoiceBanner("You pressed SPACE");
        } else if (e.key === "f" || e.key === "F") {
          showChoiceBanner("You pressed F (Left)");
        } else if (e.key === "j" || e.key === "J") {
          showChoiceBanner("You pressed J (Right)");
        } else {
          showChoiceBanner(`You pressed: ${e.key}`);
        }
      } else {
        const side = (e.key === "f" || e.key === "F") ? "Left" :
                     (e.key === "j" || e.key === "J") ? "Right" : e.key;
        showChoiceBanner(`You chose ${side}`);
      }

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
          posA: snapshotCyForCSV(lastCyLeft),
          posB: snapshotCyForCSV(lastCyRight)

        });
      } else {
        const [indexA, indexB] = pairs[graphIndex];
        const metaA = graphMetadata[indexA];
        const metaB = graphMetadata[indexB];
        const graphA = aGraphs[indexA];
        const graphB = bGraphs[indexB];

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
          posA: snapshotCyForCSV(lastCyLeft),
          posB: snapshotCyForCSV(lastCyRight)

        });
        graphIndex++;
      }

      if (rt < 100) {
        fastCount++;
      } else {
        fastCount = 0;
      }

      if (currentKeyListener) {
        document.removeEventListener("keydown", currentKeyListener);
        currentKeyListener = null;
      }
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

  currentKeyListener = keyListener;
  document.addEventListener("keydown", currentKeyListener);

  currentTimeoutId = setTimeout(() => {
    currentTimeoutId = null;
    if (!responded && !pausedForFullscreen && !endedEarly) {
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
          posA: snapshotCyForCSV(lastCyLeft),
          posB: snapshotCyForCSV(lastCyRight)

        });
      } else {
        const [indexA, indexB] = pairs[graphIndex];
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
          posA: snapshotCyForCSV(lastCyLeft),
          posB: snapshotCyForCSV(lastCyRight)

        });
        graphIndex++;
      }

      if (currentKeyListener) {
        document.removeEventListener("keydown", currentKeyListener);
        currentKeyListener = null;
      }
      currentIndex++;
      runTrial();
    }
  }, 10000);
}

// ===== Graph drawing =====
function drawGraph(graphStructure, containerId) {
  const elements = [];
  const size = Math.sqrt(graphStructure.length);

  for (let i = 0; i < size; i++) elements.push({ data: { id: `n${i}` } });
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

  const containerEl = document.getElementById(containerId);

  // Destroy previous cy for this container (avoid leaks, stale refs)
  if (containerEl.__cy) {
    try { containerEl.__cy.destroy(); } catch(_) {}
    containerEl.__cy = null;
  }

  const cy = cytoscape({
    container: containerEl,
    elements,
    style: [
      { selector: 'node', style: { width: '15px', height: '15px', 'background-color': 'blue' } },
      { selector: 'edge', style: { 'line-color': 'gray', width: 2 } }
    ],
    layout: {
      name: 'cose',
      nodeRepulsion,
      idealEdgeLength: 10,
      gravity: 0.25,
      animate: false
    },
    minZoom: 0.05,
    maxZoom: 4,
    zoomingEnabled: true,
    panningEnabled: true,
    userZoomingEnabled: false,
    userPanningEnabled: false,
    boxSelectionEnabled: false,
    autoungrabify: true
  });

  const PADDING = 20;

  function fitAndCenter() {
    cy.fit(cy.elements(), PADDING);
    if (cy.zoom() > 1) cy.zoom(1);
    cy.center();

    const bb = cy.elements().boundingBox();
    const w = cy.width(), h = cy.height();
    const overflows = bb.x1 < 0 || bb.y1 < 0 || bb.x2 > w || bb.y2 > h;
    if (overflows) {
      cy.zoom(cy.zoom() * 0.95);
      cy.center();
    }
  }

  cy.on('layoutstop', () => {
    // ensure settled viewport; we’ll snapshot later when logging
    fitAndCenter();
  });

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      cy.resize();
      fitAndCenter();
    });
    ro.observe(containerEl);
  } else {
    window.addEventListener('resize', () => {
      cy.resize();
      fitAndCenter();
    });
  }

  // Keep a handle on the container for later snapshots
  containerEl.__cy = cy;
  return cy;
}


// ===== CSV save / upload (+ SESSION summary row) =====
function formatPositionsForCSV(posObj) {
  return Object.entries(posObj)
    .map(([key, val]) => `${key}:${val.x.toFixed(1)},${val.y.toFixed(1)}`)
    .join(';');
}

function RUNSHEET_KEY(id) { return `maindata_${id}.csv`; }
function RUNSHEET_GET_URL(key) {
  // Primary GET endpoint; adjust if your API path differs
  return `https://srnpro.vercel.app/api/runsheet?key=${encodeURIComponent(key)}`;
}
function RUNSHEET_GET_URL_FALLBACK(key) {
  // Some backends support GET on the upload endpoint; harmless to try
  return `https://srnpro.vercel.app/api/upload-runsheet?key=${encodeURIComponent(key)}`;
}

async function fetchExistingCSV(id) {
  const key = RUNSHEET_KEY(id);
  // Try main
  let res = await fetch(RUNSHEET_GET_URL(key));
  if (res.ok) return await res.text();
  // Fallback
  res = await fetch(RUNSHEET_GET_URL_FALLBACK(key));
  if (res.ok) return await res.text();
  return null; // not found
}

function parseCSVTextToRows(text) {
  // very simple CSV parser for our rows; assumes no embedded commas except in the quoted JSON arrays (we extracted as strings)
  // We’ll split lines, then split by commas but respecting simple quotes. For robustness, use a real CSV parser if you prefer.
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { header: [], rows: [] };
  const header = lines[0].split(',');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // naive: split only first 16 commas for our known 17 columns
    // columns: id,trial,type,rt,choice,block_a,node_count_a,block_b,node_count_b,graphA,graphB,pc1_A,pc2_A,pc1_B,pc2_B,posA,posB
    const parts = [];
    let cur = '';
    let inQuotes = false;
    for (let ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; cur += ch; continue; }
      if (ch === ',' && !inQuotes) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur);

    // Build object
    const obj = {};
    header.forEach((h, idx) => obj[h] = parts[idx] ?? '');
    rows.push(obj);
  }
  return { header, rows };
}

function tryExtractSessionSummary(rows) {
  // Find last row with type == 'SESSION' and parse posB as JSON
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if ((r.type || '').toUpperCase() === 'SESSION') {
      try {
        const payload = JSON.parse(r.posB || '{}');
        return payload;
      } catch (e) {
        return null;
      }
    }
  }
  return null;
}

function loadTrialsFromRows(rows) {
  const trials = [];
  for (const r of rows) {
    if ((r.type || '').toUpperCase() === 'SESSION') continue;
    const coerce = (v) => (v === '' || v === undefined) ? [] : JSON.parse(v);
    trials.push({
      id: r.id,
      trial: (r.trial === '' ? null : (isNaN(+r.trial) ? r.trial : +r.trial)),
      type: r.type,
      rt: (r.rt === 'timeout' ? 'timeout' : (isNaN(+r.rt) ? r.rt : +r.rt)),
      choice: r.choice,
      block_a: r.block_a,
      node_count_a: (r.node_count_a === '' ? '' : +r.node_count_a),
      block_b: r.block_b,
      node_count_b: (r.node_count_b === '' ? '' : +r.node_count_b),
      graphA: coerce(r.graphA),
      graphB: coerce(r.graphB),
      pc1_A: (r.pc1_A === '' ? '' : +r.pc1_A),
      pc2_A: (r.pc2_A === '' ? '' : +r.pc2_A),
      pc1_B: (r.pc1_B === '' ? '' : +r.pc1_B),
      pc2_B: (r.pc2_B === '' ? '' : +r.pc2_B),
      posA: r.posA,
      posB: r.posB
    });
  }
  return trials;
}

async function checkAndMaybeResume(id) {
  try {
    const text = await fetchExistingCSV(id);
    if (!text) return 'none';

    const { header, rows } = parseCSVTextToRows(text);
    if (!rows.length) return 'none';

    const summary = tryExtractSessionSummary(rows);
    // Important: seeds must match original
    if (summary && typeof summary.pairSeed === 'number' && typeof summary.probeSeed === 'number' && typeof summary.pickSeed === 'number') {
      PAIR_SEED = summary.pairSeed;
      PROBE_SEED = summary.probeSeed;
      PICK_SEED  = summary.pickSeed;
      randPairs  = mulberry32(PAIR_SEED);
      randProbes = mulberry32(PROBE_SEED);
      randPick   = mulberry32(PICK_SEED);
      // Rebuild deterministic structures with those seeds
      aGraphs = []; bGraphs = []; graphMetadata = [];
      await loadGraphsFromJSON();
      pairs = []; pairMetadata = [];
      generateUniquePairs();
      buildTrialSequence();
    }

    // Load previous rows into memory so final upload contains full history
    trialData = loadTrialsFromRows(rows);
    const mode = integrateResumeState(summary);
    return mode || 'resume';
  } catch (e) {
    console.warn('Resume check failed:', e);
    return 'none';
  }
}

async function saveCSV() {
  const header = 'id,trial,type,rt,choice,block_a,node_count_a,block_b,node_count_b,graphA,graphB,pc1_A,pc2_A,pc1_B,pc2_B,posA,posB';
  const rows = trialData.map(row => {
    return `${row.id},${row.trial},${row.type},${row.rt},${row.choice},${row.block_a},${row.node_count_a},${row.block_b},${row.node_count_b},"${JSON.stringify(row.graphA)}","${JSON.stringify(row.graphB)}",${row.pc1_A},${row.pc2_A},${row.pc1_B},${row.pc2_B},"${row.posA}","${row.posB}"`;
  });

  // Append SESSION summary row (JSON in posB)
  const sessionPayload = {
    status: endedEarly ? 'ended_early' : (currentIndex >= totaltrial ? 'completed' : 'partial'),
    pairSeed: PAIR_SEED,
    probeSeed: PROBE_SEED,
    pickSeed: PICK_SEED,
    fullscreenViolations,
    endedEarly,
    currentIndex,
    graphIndex,
    timestamp: Date.now()
  };
  const sessionRow = `${id},${currentIndex},SESSION,,"",,,,,,,,,,,"",${JSON.stringify(sessionPayload)}`;
  rows.push(sessionRow);

  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });

  const filename = RUNSHEET_KEY(id);

  const formData = new FormData();
  formData.append("file", blob, filename);

  try {
    const response = await fetch(`https://srnpro.vercel.app/api/upload-runsheet?key=${encodeURIComponent(filename)}`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) throw new Error("Upload failed");
    const result = await response.json();
    console.log("Upload response:", result);
    window.location.href = `https://jerryguo2001.github.io/Brokerage_Survey/?worker_id=${encodeURIComponent(id)}`;
  } catch (err) {
    console.error("Upload error:", err);
    alert("Upload failed: " + err.message);
  }
}
