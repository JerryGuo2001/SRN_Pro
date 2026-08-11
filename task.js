// task.js (updated)

// ======================= GLOBALS =======================
let aGraphs = [];
let bGraphs = [];
let graphMetadata = [];
let inBreak = false;
let breakStartTime = null;

let pairs = [];
let pairMetadata = [];

// ===== Graph pools keyed by (block_id,node_count) =====
let graphPools = {};   // key -> [{ structure:Array<number>, row }]
let poolOrder = {};    // key -> shuffled index order (deterministic)
let poolCursor = {};   // key -> next draw position
let metaList  = [];    // [{ key, block_id, node_count }]
let allGraphsFlat = []; // for probe_space random display

// Keep live cy refs so we can snapshot exact render state
let lastCyLeft = null;
let lastCyRight = null;

//skip out warning
let probeWrongCount = 0;  // increments on incorrect or timeout for probe trials
let TotalProbeTrialWrongAccepted = 5
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
  // cyrb128 already mixes the input into four usable 32-bit words. XORing
  // all four words cancels to zero because of how those words are derived.
  // Use one mixed word instead so each participant/salt gets a stable,
  // participant-specific seed.
  return cyrb128(s + "|" + salt)[0];
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

// ===== Small random graph generator for "size probe" =====
// Returns a flattened NxN 0/1 adjacency matrix (undirected, no self-loops), connected.
function makeRandomGraphStructure(n, randFn) {
  // start with all zeros
  const A = Array(n*n).fill(0);

  const setEdge = (i, j) => { if (i !== j) { A[i*n + j] = 1; A[j*n + i] = 1; } };

  // ensure connectivity with a simple random spanning chain
  const order = [...Array(n).keys()];
  // Fisher-Yates using provided RNG
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(randFn() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (let k = 0; k < n - 1; k++) setEdge(order[k], order[k+1]);

  // add a few extra random edges (sparse)
  const extraEdges = Math.floor(randFn() * Math.max(1, n - 1)); // 0..(n-2)
  for (let e = 0; e < extraEdges; e++) {
    const i = Math.floor(randFn() * n);
    const j = Math.floor(randFn() * n);
    setEdge(i, j);
  }
  return A;
}


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

  saveCSV(); // uploads only; NO redirect on ended_early
}

function endDueToProbeErrors() {
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
      <h2>Session ended</h2>
      <p>Your session is ended due to too many missed trials.</p>
      <p>Please return the study with this code: <strong>RETURN</strong>.</p>
      <p>Your data so far will be saved.</p>
    `;
    document.body.appendChild(term);
  } else {
    term.innerHTML = `
      <h2>Session ended</h2>
      <p>Your session is ended due to too many missed trials.</p>
      <p>Please return the study with this code: <strong>RETURN</strong>.</p>
      <p>Your data so far will be saved.</p>
    `;
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

  // Save immediately; DO NOT redirect
  saveCSV();
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
  graphPools = {};
  metaList = [];
  allGraphsFlat = [];

  const response = await fetch('Block_Graph.json');
  const jsonData = await response.json();

  // Build pools keyed by "block_id_node_count"
  for (const row of jsonData) {
    const key = `${row.block_id}_${row.node_count}`;

    const structure = row.graph_structure
      .replace('[', '')
      .replace(']', '')
      .split(',')
      .map(n => parseInt(n.trim(), 10));

    if (!graphPools[key]) graphPools[key] = [];
    graphPools[key].push({ structure, row });

    allGraphsFlat.push(structure);
  }

  // Stable list of unique keys (order doesn’t matter; shuffle later)
  metaList = Object.keys(graphPools).map(k => {
    const [block_id, node_count] = k.split('_');
    return {
      key: k,
      block_id: block_id,
      node_count: parseInt(node_count, 10)
    };
  });

  // Reset deterministic per-key orders/cursors
  poolOrder = {};
  poolCursor = {};
}


function shuffleInPlaceDeterministic(arr, randFn) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(randFn() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}


function ensurePoolOrder(key) {
  const n = graphPools[key]?.length || 0;
  if (n === 0) throw new Error(`No graphs available for key ${key}`);

  if (!poolOrder[key] || poolOrder[key].length !== n) {
    poolOrder[key] = Array.from({ length: n }, (_, i) => i);
    shuffleInPlaceDeterministic(poolOrder[key], randPick); // deterministic per participant
    poolCursor[key] = 0;
  } else if (poolCursor[key] >= n) {
    // Exhausted this pool; reshuffle deterministically and cycle
    shuffleInPlaceDeterministic(poolOrder[key], randPick);
    poolCursor[key] = 0;
  }
}

function drawOneFromKey(key) {
  ensurePoolOrder(key);
  const idx = poolOrder[key][poolCursor[key]++];
  return graphPools[key][idx]; // -> { structure, row }
}


function generateUniquePairs() {
  pairs = [];
  pairMetadata = [];

  const n = metaList.length;
  const allPairs = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Randomize orientation separately from trial order. Without this flip,
      // early metaList conditions are always left and later ones always right.
      allPairs.push(randPairs() < 0.5 ? [i, j] : [j, i]);
    }
  }
  shuffleInPlaceDeterministic(allPairs, randPairs);

  for (const [i, j] of allPairs) {
    const A = metaList[i];
    const B = metaList[j];
    pairs.push([i, j]);
    pairMetadata.push({
      indexA: i,
      indexB: j,
      blockA: A.block_id,
      blockB: B.block_id,
      nodeCountA: A.node_count,
      nodeCountB: B.node_count,
      // pc fields will be taken from the actual row we draw at runtime
      pc1_A: '',
      pc2_A: '',
      pc1_B: '',
      pc2_B: ''
    });
  }
}


// ===== Init / trial plan =====
let currentIndex = 0;
let graphIndex = 0;

let fastCount = 0;
let trialData = [];
let id = "";
let debugmode = true;

let totalGraphTrials, totalProbeTrials;
if (debugmode){
  totalGraphTrials = 20;
  totalProbeTrials = 5;
}else{
  totalGraphTrials = 190;
  totalProbeTrials = 20;
}

let totaltrial = totalGraphTrials + totalProbeTrials;

let trialSequence = []; // will be filled by buildTrialSequence()

function buildTrialSequence() {
  // Never request more graph trials than the generated pair pool contains.
  if (totalGraphTrials > pairs.length) {
    console.warn(
      `Requested ${totalGraphTrials} graph trials, but only ${pairs.length} pairs are available. ` +
      `Using ${pairs.length} graph trials.`
    );
    totalGraphTrials = pairs.length;
  }
  totaltrial = totalGraphTrials + totalProbeTrials;
  totalProbeTrials = Math.max(0, Math.min(totalProbeTrials, totaltrial));

  // Start with all graph trials
  trialSequence = Array.from({ length: totaltrial }, () => ({ type: "graph" }));

  // Pick probe slots deterministically
  const slots = Array.from({ length: totaltrial }, (_, i) => i);
  shuffleInPlaceDeterministic(slots, randProbes);

  // Split probe trials roughly half/half between the two types
  const nSpace  = Math.floor(totalProbeTrials / 2);
  const nSize   = totalProbeTrials - nSpace;

  // First assign size probes, then space probes (order doesn't matter due to random slots)
  for (let k = 0; k < nSize; k++) {
    trialSequence[slots[k]] = { type: "probe_size" };
  }
  for (let k = nSize; k < totalProbeTrials; k++) {
    trialSequence[slots[k]] = { type: "probe_space" };
  }
}


function reconstructIndicesFromLoadedRows() {
  const nonSessionRows = trialData.filter(r => r && r.type && r.type !== 'SESSION');
  currentIndex = nonSessionRows.length;
  const graphRows = nonSessionRows.filter(r => r.type === 'graph');
  graphIndex = graphRows.length;
}

function integrateResumeState(summary) {
  if (!summary) {
    reconstructIndicesFromLoadedRows();
    return;
  }
  if (typeof summary.fullscreenViolations === 'number') {
    fullscreenViolations = summary.fullscreenViolations;
  }
  if (summary.endedEarly === true) {
    showAlreadyDonePage(summary.status || 'ended_early');
    return 'blocked';
  }
  if (summary.status === 'completed') {
    showAlreadyDonePage('completed');
    return 'blocked';
  }
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

async function runsheetExists(workerId) {
  const filename = `maindata_${workerId}.csv`;
  const url = `https://srnpro.vercel.app/api/fetch-runsheet?key=${encodeURIComponent(filename)}&exists=1`;
  try {
    const resp = await fetch(url);
    if (resp.status === 200) return true;
    if (resp.status === 404) return false;
    // For unexpected statuses, assume not found but log it
    console.warn('Unexpected status checking runsheet:', resp.status);
    return false;
  } catch (e) {
    console.error('Error checking runsheet existence:', e);
    return false;
  }
}


function showAlreadyEndedPage() {
  const root = document.getElementById("instruction") || document.body;
  const el = document.createElement("div");
  el.style.padding = "24px";
  el.style.fontFamily = "system-ui,-apple-system,Segoe UI,Roboto,Arial";
  el.innerHTML = `
    <h2>Your session has already ended</h2>
    <p>Our records show you have already completed or ended this task.</p>
    <p>Please return the study on the platform. Thank you!</p>
  `;
  root.innerHTML = "";
  root.appendChild(el);
}

// ===== Inside window.onload =====
window.onload = async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const workerId = urlParams.get("worker_id");
  ensureChoiceBanner();

  if (workerId) {
    id = workerId;
    initPRNGsFromId(id);

  const exists = await runsheetExists(workerId);
  if (exists) {
    showAlreadyEndedPage();
    return;
  }

    // Otherwise normal flow
    await loadGraphsFromJSON();
    generateUniquePairs();
    buildTrialSequence();

    instructionPages = await preloadInstructionPNGs();
    document.getElementById("instruction").style.display = "none";
    showConsent();
    return;
  }

  // No worker_id yet → show ID input
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
    window.location.href = `?worker_id=${encodeURIComponent(id)}`;
    return;
  }

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

      if (duration === 60 && remaining === 58) {
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

// ===== Position snapshot helpers =====
function snapshotCy(cy) {
  if (!cy) return { error: "no cy" };

  const nodes = {};
  cy.nodes().forEach(n => {
    const p = n.position();               // model coords
    const rp = n.renderedPosition();      // pixel coords on canvas
    nodes[n.id()] = {
      x: +p.x.toFixed(3),
      y: +p.y.toFixed(3),
      rx: +rp.x.toFixed(3),
      ry: +rp.y.toFixed(3)
    };
  });

  const edges = cy.edges().map(e => ({
    source: e.source().id(),
    target: e.target().id()
  }));

  const view = {
    zoom: +cy.zoom().toFixed(5),
    pan: cy.pan(),
    width: cy.width(),
    height: cy.height()
  };

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

// single “box” CSV string for both sides (rendered coords + viewport)
function positionsCSVForBoth(cyLeft, cyRight) {
  const a = snapshotCy(cyLeft);
  const b = snapshotCy(cyRight);

  const fmtNodes = (obj) =>
    Object.entries(obj.nodes)
      .map(([id, v]) => `${id}:${v.rx.toFixed(1)},${v.ry.toFixed(1)}`)
      .join(';');

  const fmtView = (obj) =>
    `zoom:${obj.view.zoom.toFixed(3)},pan:${Math.round(obj.view.pan.x)},${Math.round(obj.view.pan.y)}`;

  // Example:
  // A[n0:12.3,45.6;n1:...;...]@zoom:1.000,pan:0,0|B[n0:..., ...]@zoom:1.000,pan:0,0
  const left = `A[${fmtNodes(a)}]@${fmtView(a)}`;
  const right = `B[${fmtNodes(b)}]@${fmtView(b)}`;
  return `${left}|${right}`;
}

// ===== Trial loop =====
function runTrial() {
  if (pausedForFullscreen || endedEarly) return;

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
  const trial = trialSequence[currentIndex];
  if (trial.type === "graph" && graphIndex >= pairs.length) {
    console.error("Trial sequence requested more graph trials than there are graph pairs.");
    document.getElementById("task").style.display = "none";
    document.getElementById("thanks").style.display = "block";
    saveCSV();
    return;
  }

  const instructionsEl = document.getElementById("instructionsText");
  let activeGraphMeta = null;

  if (trial.type === "probe_space") {
    instructionsEl.innerHTML = 'Press the <strong>SPACE</strong> button.';
    instructionsEl.style.color = 'red';

    // Option A: pick any two graphs from all available structures
    const L = allGraphsFlat.length;
    const g1 = allGraphsFlat[randInt(randPick, L)];
    const g2 = allGraphsFlat[randInt(randPick, L)];

    lastCyLeft  = drawGraph(g1, "graph-left");
    lastCyRight = drawGraph(g2, "graph-right");
  } else if (trial.type === "probe_size") {
  // --- New probe: choose the SMALLER node-count graph ---
  instructionsEl.innerHTML =
    'Choose the <strong>graph with fewer nodes</strong>. Press <strong>F</strong> for left, <strong>J</strong> for right.';
  instructionsEl.style.color = 'red';

  // Pick sizes deterministically
  const smallChoices = [2, 3];
  const largeChoices = [4, 5, 6];

  const smallN = smallChoices[randInt(randPick, smallChoices.length)];
  const largeN = largeChoices[randInt(randPick, largeChoices.length)];

  // Randomize which side is smaller
  const smallOnLeft = randPick() < 0.5;

  const leftN  = smallOnLeft ? smallN : largeN;
  const rightN = smallOnLeft ? largeN : smallN;

  const leftGraph  = makeRandomGraphStructure(leftN,  randPick);
  const rightGraph = makeRandomGraphStructure(rightN, randPick);

  lastCyLeft  = drawGraph(leftGraph,  "graph-left");
  lastCyRight = drawGraph(rightGraph, "graph-right");

  // stash per-trial “correct side” info on the trial object so we can save it on response/timeout
  trial._sizeProbeMeta = {
    smallN, largeN,
    smallSide: smallOnLeft ? "Left" : "Right",
    correctSide: smallOnLeft ? "Left" : "Right",
    leftN, rightN,
    leftGraph, rightGraph
  };
  } else {
    // --- Normal graph choice trial (draw fresh graphs per side) ---
    if (!trial._graphMeta) {
      const [idxA, idxB] = pairs[graphIndex];
      const pickA = drawOneFromKey(metaList[idxA].key);
      const pickB = drawOneFromKey(metaList[idxB].key);
      trial._graphMeta = {
        graphA: pickA.structure,
        graphB: pickB.structure,
        metaA: pickA.row,
        metaB: pickB.row
      };
    }
    activeGraphMeta = trial._graphMeta;

    lastCyLeft  = drawGraph(activeGraphMeta.graphA, "graph-left");
    lastCyRight = drawGraph(activeGraphMeta.graphB, "graph-right");

    instructionsEl.innerHTML =
      'If you think the left graph is more likely to come from the real-world friendship data, press <strong>F</strong>. <br> Alternatively, if you think the right graph is more likely to come from the real-world friendship data., press <strong>J</strong>.';
    instructionsEl.style.color = 'black';
  }


  document.getElementById("warning").style.display = "none";
  document.getElementById("graph-container").style.display = "flex";

  const trialStart = performance.now();
  let responded = false;

const keyListener = (e) => {
  if (responded || pausedForFullscreen || endedEarly) return;

  const isFJ = (e.key === "f" || e.key === "F" || e.key === "j" || e.key === "J");
  const isSpace = (e.code === "Space");

  const okForSpaceProbe = (trial.type === "probe_space") && (isSpace || isFJ);
  const okForSizeProbe  = (trial.type === "probe_size") && isFJ;
  const okForGraph      = (trial.type === "graph") && isFJ;

  if (!(okForSpaceProbe || okForSizeProbe || okForGraph)) return;

  responded = true;
  const rt = performance.now() - trialStart;

  // Small toast/bottom banner
  if (trial.type === "probe_space") {
    if (isSpace)      showChoiceBanner("You pressed SPACE");
    else if (e.key.toLowerCase() === "f") showChoiceBanner("You pressed F (Left)");
    else if (e.key.toLowerCase() === "j") showChoiceBanner("You pressed J (Right)");
    else showChoiceBanner(`You pressed: ${e.key}`);
  } else {
    const side = (e.key.toLowerCase() === "f") ? "Left" : "Right";
    showChoiceBanner(`You chose ${side}`);
  }

    // ==== SAVE ROWS ====
    if (trial.type === "probe_space") {
      const isCorrect = isSpace ? 1 : 0;
      trialData.push({
        id,
        trial: currentIndex,
        type: trial.type,
        rt: Math.round(rt),
        choice: isSpace ? "SPACE" : e.key,
        block_a: '',
        node_count_a: '',
        block_b: '',
        node_count_b: '',
        graphA: [],
        graphB: [],
        pc1_A: '',
        pc2_A: '',
        pc1_B: '',
        pc2_B: '',
        small_n: '',
        large_n: '',
        small_side: '',
        correct_side: '',
        is_correct: isCorrect,
        positions: positionsCSVForBoth(lastCyLeft, lastCyRight)
      });

      if (!isCorrect) {
          probeWrongCount++;
          if (probeWrongCount >= TotalProbeTrialWrongAccepted) {
            // cleanup listeners/timeouts already done below; just end now
            if (currentTimeoutId) { clearTimeout(currentTimeoutId); currentTimeoutId = null; }
            if (currentKeyListener) { document.removeEventListener("keydown", currentKeyListener); currentKeyListener = null; }
            endDueToProbeErrors();
            return;
          }
        }

    } else if (trial.type === "probe_size") {
      const side = (e.key.toLowerCase() === "f") ? "Left" : "Right";
      const meta = trial._sizeProbeMeta;
      const isCorrect = (side === meta.correctSide) ? 1 : 0;

      trialData.push({
        id,
        trial: currentIndex,
        type: trial.type,
        rt: Math.round(rt),
        choice: e.key,
        block_a: '',
        node_count_a: meta.leftN,
        block_b: '',
        node_count_b: meta.rightN,
        graphA: meta.leftGraph,
        graphB: meta.rightGraph,
        pc1_A: '',
        pc2_A: '',
        pc1_B: '',
        pc2_B: '',
        small_n: meta.smallN,
        large_n: meta.largeN,
        small_side: meta.smallSide,
        correct_side: meta.correctSide,
        is_correct: isCorrect,
        positions: positionsCSVForBoth(lastCyLeft, lastCyRight)
      });

      if (!isCorrect) {
        probeWrongCount++;
        if (probeWrongCount >= TotalProbeTrialWrongAccepted) {
          if (currentTimeoutId) { clearTimeout(currentTimeoutId); currentTimeoutId = null; }
          if (currentKeyListener) { document.removeEventListener("keydown", currentKeyListener); currentKeyListener = null; }
          endDueToProbeErrors();
          return;
        }
      }

    } else {
      // normal graph trial
      const { graphA, graphB, metaA, metaB } = activeGraphMeta;
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
        small_n: '',
        large_n: '',
        small_side: '',
        correct_side: '',
        is_correct: '',
        positions: positionsCSVForBoth(lastCyLeft, lastCyRight)
      });
      graphIndex++;
    }

    // --- shared cleanup (applies to ALL trial types) ---
    if (currentTimeoutId) { clearTimeout(currentTimeoutId); currentTimeoutId = null; }
    if (currentKeyListener) {
      document.removeEventListener("keydown", currentKeyListener);
      currentKeyListener = null;
    }

    // --- advance logic ---
    // Only the main graph trials use the fast-response penalty.
    // Probes just advance after 500ms.
    if (trial.type === "graph") {
      if (rt < 100) { fastCount++; } else { fastCount = 0; }

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
    } else {
      // probe_space / probe_size
      fastCount = 0; // keep probes from tripping fast penalty streaks
      setTimeout(() => {
        currentIndex++;
        runTrial();
      }, 500);
    }
  };

  currentKeyListener = keyListener;
  document.addEventListener("keydown", currentKeyListener);

  currentTimeoutId = setTimeout(() => {
    currentTimeoutId = null;
    if (!responded && !pausedForFullscreen && !endedEarly) {
      if (trial.type === "probe_space") {
        // same as before, with blanks for size-probe extras
        trialData.push({
          id, trial: currentIndex, type: trial.type, rt: "timeout", choice: "none",
          block_a: '', node_count_a: '', block_b: '', node_count_b: '',
          graphA: [], graphB: [], pc1_A: '', pc2_A: '', pc1_B: '', pc2_B: '',
          small_n: '', large_n: '', small_side: '', correct_side: '', is_correct: 0,
          positions: positionsCSVForBoth(lastCyLeft, lastCyRight)
        });
        probeWrongCount++;
        if (probeWrongCount >= TotalProbeTrialWrongAccepted) {
          if (currentKeyListener) { document.removeEventListener("keydown", currentKeyListener); currentKeyListener = null; }
          endDueToProbeErrors();
          return;
        }

      } else if (trial.type === "probe_size") {
        const meta = trial._sizeProbeMeta || { smallN:'', largeN:'', smallSide:'', correctSide:'', leftN:'', rightN:'', leftGraph:[], rightGraph:[] };
        trialData.push({
          id, trial: currentIndex, type: trial.type, rt: "timeout", choice: "none",
          block_a: '', node_count_a: meta.leftN, block_b: '', node_count_b: meta.rightN,
          graphA: meta.leftGraph, graphB: meta.rightGraph,
          pc1_A: '', pc2_A: '', pc1_B: '', pc2_B: '',
          small_n: meta.smallN, large_n: meta.largeN,
          small_side: meta.smallSide, correct_side: meta.correctSide, is_correct: 0,
          positions: positionsCSVForBoth(lastCyLeft, lastCyRight)
        });

        probeWrongCount++;
        if (probeWrongCount >= TotalProbeTrialWrongAccepted) {
          if (currentKeyListener) { document.removeEventListener("keydown", currentKeyListener); currentKeyListener = null; }
          endDueToProbeErrors();
          return;
        }

      } else {
        // Save the exact graph pair that was displayed. Drawing again here
        // would record unseen stimuli and advance the graph pools twice.
        const { graphA, graphB, metaA, metaB } = activeGraphMeta;

        trialData.push({
          id, trial: currentIndex, type: trial.type, rt: "timeout", choice: "none",
          block_a: metaA.block_id, node_count_a: metaA.node_count,
          block_b: metaB.block_id, node_count_b: metaB.node_count,
          graphA: graphA, graphB: graphB,
          pc1_A: metaA.pc_one, pc2_A: metaA.pc_two, pc1_B: metaB.pc_one, pc2_B: metaB.pc_two,
          small_n: '', large_n: '', small_side: '', correct_side: '', is_correct: '',
          positions: positionsCSVForBoth(lastCyLeft, lastCyRight)
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

  containerEl.__cy = cy;
  return cy;
}

// ===== CSV save / upload (+ SESSION summary row) =====
function RUNSHEET_KEY(id) { return `maindata_${id}.csv`; }
function RUNSHEET_GET_URL(key) {
  return `https://srnpro.vercel.app/api/runsheet?key=${encodeURIComponent(key)}`;
}
function RUNSHEET_GET_URL_FALLBACK(key) {
  return `https://srnpro.vercel.app/api/upload-runsheet?key=${encodeURIComponent(key)}`;
}

// Disable CSV GET/resume for now
async function fetchExistingCSV(_id) { return null; }
async function checkAndMaybeResume(_id) { return 'none'; }

// Export header now uses a single "positions" field (no posA/posB)
async function saveCSV() {
  const status =
    endedEarly
      ? (probeWrongCount >= 5 ? 'ended_probe_errors' : 'ended_early')
      : (currentIndex >= totaltrial ? 'completed' : 'partial');


  const header = 'id,trial,type,rt,choice,block_a,node_count_a,block_b,node_count_b,graphA,graphB,pc1_A,pc2_A,pc1_B,pc2_B,small_n,large_n,small_side,correct_side,is_correct,positions';
  const rows = trialData.map(row => {
    return `${row.id},${row.trial},${row.type},${row.rt},${row.choice},${row.block_a},${row.node_count_a},${row.block_b},${row.node_count_b},"${JSON.stringify(row.graphA)}","${JSON.stringify(row.graphB)}",${row.pc1_A},${row.pc2_A},${row.pc1_B},${row.pc2_B},${row.small_n},${row.large_n},${row.small_side},${row.correct_side},${row.is_correct},"${row.positions}"`;
  });


  // Append SESSION summary row (JSON in positions)
  const sessionPayload = {
    status,
    pairSeed: PAIR_SEED,
    probeSeed: PROBE_SEED,
    pickSeed: PICK_SEED,
    fullscreenViolations,
    endedEarly,
    currentIndex,
    graphIndex,
    timestamp: Date.now()
  };
  const sessionRow = `${id},${currentIndex},SESSION,,"",,,,,,,,,"",,,,"","",${JSON.stringify(sessionPayload).replace(/"/g,'""')}`;
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

    // Only redirect on COMPLETED; do NOT redirect if ended early
    if (status === 'completed') {
      window.location.href = `https://jerryguo2001.github.io/Brokerage_Survey/?worker_id=${encodeURIComponent(id)}`;
    }
  } catch (err) {
    console.error("Upload error:", err);
    alert("Upload failed: " + err.message);
  }
}
