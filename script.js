// ---------- Constants ----------
const CELL = 56;
const ORDER = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
const DIR_DELTA = { UP: [-1, 0], RIGHT: [0, 1], DOWN: [1, 0], LEFT: [0, -1] };
const DIR_ROTATION = { UP: 0, RIGHT: 90, DOWN: 180, LEFT: 270 };
const LABELS = {
  move: '⬆️ Move Forward',
  turnLeft: '↺ Turn Left',
  turnRight: '↻ Turn Right',
  repeat: '🔁 Repeat',
};
const SPEAK_LABELS = {
  move: 'Move forward',
  turnLeft: 'Turn left',
  turnRight: 'Turn right',
  repeat: 'Repeat',
};
const CONFETTI_COLORS = ['#F72FA0', '#7B2FF7', '#14FFEC', '#FFE55C', '#F5622D', '#5CFF8F'];

// ---------- Infinite level generation ----------
const levelCache = {};

function pickAllowedBlocks(idx) {
  if (idx < 3) return ['move'];
  if (idx < 7) return ['move', 'turnLeft', 'turnRight'];
  return ['move', 'turnLeft', 'turnRight', 'repeat'];
}

function pickGridSize(idx) {
  return Math.min(5 + Math.floor(idx / 4), 9);
}

function pickPathLength(idx, gridSize) {
  const base = 3 + Math.floor(idx * 0.8);
  return Math.max(3, Math.min(base, gridSize * gridSize - 2, 20));
}

function pickTurnChance(idx) {
  if (idx < 3) return 0;
  return Math.min(0.15 + idx * 0.03, 0.55);
}

function dirBetween([r1, c1], [r2, c2]) {
  if (r2 < r1) return 'UP';
  if (r2 > r1) return 'DOWN';
  if (c2 > c1) return 'RIGHT';
  return 'LEFT';
}

function generateFallbackPath(gridSize) {
  const row = Math.floor(gridSize / 2);
  const len = Math.min(gridSize, 4);
  const path = [];
  for (let c = 0; c < len; c++) path.push([row, c]);
  return path;
}

function generatePath(gridSize, targetLen, turnChance) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const visited = new Set();
    let cur = [Math.floor(Math.random() * gridSize), Math.floor(Math.random() * gridSize)];
    let curDir = ORDER[Math.floor(Math.random() * 4)];
    const path = [cur];
    visited.add(cur.join(','));
    let success = true;

    while (path.length < targetLen) {
      let preferredDir = curDir;
      if (path.length > 1 && Math.random() < turnChance) {
        const perp = (curDir === 'UP' || curDir === 'DOWN') ? ['LEFT', 'RIGHT'] : ['UP', 'DOWN'];
        preferredDir = perp[Math.floor(Math.random() * 2)];
      }
      const tryOrder = [preferredDir, curDir, ...ORDER].filter((d, i, a) => a.indexOf(d) === i);
      let moved = false;
      for (const d of tryOrder) {
        const [dr, dc] = DIR_DELTA[d];
        const tr = cur[0] + dr;
        const tc = cur[1] + dc;
        if (tr >= 0 && tr < gridSize && tc >= 0 && tc < gridSize && !visited.has(`${tr},${tc}`)) {
          cur = [tr, tc];
          curDir = d;
          path.push(cur);
          visited.add(cur.join(','));
          moved = true;
          break;
        }
      }
      if (!moved) { success = false; break; }
    }
    if (success && path.length === targetLen) return path;
  }
  return generateFallbackPath(gridSize);
}

function pickHint(idx, allowedBlocks) {
  if (!allowedBlocks.includes('turnLeft')) {
    return 'Tap Move Forward to guide the robot to the planet!';
  }
  if (!allowedBlocks.includes('repeat')) {
    return 'This path turns! Use Turn Left and Turn Right to follow it.';
  }
  return 'Tip: use the Repeat block to make your program shorter!';
}

function generateLevel(idx) {
  const gridSize = pickGridSize(idx);
  const allowedBlocks = pickAllowedBlocks(idx);
  const targetLen = pickPathLength(idx, gridSize);
  const turnChance = pickTurnChance(idx);
  const path = generatePath(gridSize, targetLen, turnChance);
  const start = {
    row: path[0][0],
    col: path[0][1],
    dir: path.length > 1 ? dirBetween(path[0], path[1]) : 'RIGHT',
  };
  const goal = { row: path[path.length - 1][0], col: path[path.length - 1][1] };
  return {
    rows: gridSize,
    cols: gridSize,
    start,
    goal,
    path,
    allowedBlocks,
    hint: pickHint(idx, allowedBlocks),
  };
}

function getLevel(idx) {
  if (!levelCache[idx]) levelCache[idx] = generateLevel(idx);
  return levelCache[idx];
}

function getRank(stars) {
  if (stars >= 30) return '🌌 Galaxy Master';
  if (stars >= 20) return '🚀 Star Pilot';
  if (stars >= 10) return '🛰️ Space Cadet';
  if (stars >= 5) return '👨‍🚀 Junior Astronaut';
  return 'Explorer';
}

// ---------- State ----------
let currentLevelIndex = 0;
let level = null;
let pathSet = new Set();
let program = [];
let activeContainer = program;
let activeContainerLabel = null;
let robotState = { row: 0, col: 0, dir: 'RIGHT' };
let completedLevels = new Set();
let maxUnlockedIndex = 0;
let isRunning = false;
let stepQueue = null;
let stepIndex = 0;
let blockIdCounter = 1;
let blockEls = {};
let robotEl = null;
let toastTimer = null;

// ---------- Speech ----------
let voiceEnabled = true;
let englishVoice = null;

function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices();
  englishVoice = voices.find((v) => v.lang === 'en-US')
    || voices.find((v) => v.lang && v.lang.startsWith('en'))
    || voices[0]
    || null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

function speak(text) {
  if (!voiceEnabled || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (englishVoice) u.voice = englishVoice;
  u.lang = 'en-US';
  u.rate = 0.92;
  u.pitch = 1.05;
  speechSynthesis.speak(u);
}

// ---------- Sound effects (Web Audio) ----------
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function beep({ freq = 440, duration = 120, type = 'sine', volume = 0.15, sweepTo = null, delay = 0 }) {
  if (!voiceEnabled) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  const startAt = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, startAt + duration / 1000);
  gain.gain.setValueAtTime(volume, startAt);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration / 1000);
}

function sfxAdd() { beep({ freq: 620, duration: 90, type: 'triangle', volume: 0.12 }); }
function sfxRemove() { beep({ freq: 260, duration: 90, type: 'triangle', volume: 0.1 }); }
function sfxRun() { beep({ freq: 300, duration: 220, type: 'sine', volume: 0.12, sweepTo: 700 }); }
function sfxFail() { beep({ freq: 220, duration: 300, type: 'sawtooth', volume: 0.12, sweepTo: 90 }); }
function sfxWin() {
  [523, 659, 784, 1047].forEach((f, i) => beep({ freq: f, duration: 180, type: 'triangle', volume: 0.14, delay: i * 0.12 }));
}

// ---------- DOM ----------
const boardEl = document.getElementById('board');
const paletteEl = document.getElementById('palette');
const programListEl = document.getElementById('programList');
const hintBoxEl = document.getElementById('hintBox');
const levelNumberEl = document.getElementById('levelNumber');
const starCountEl = document.getElementById('starCount');
const rankLabelEl = document.getElementById('rankLabel');
const btnPrevLevel = document.getElementById('btnPrevLevel');
const btnNextLevelNav = document.getElementById('btnNextLevelNav');
const activeBannerEl = document.getElementById('activeBanner');
const activeBannerTextEl = document.getElementById('activeBannerText');
const btnBackToMain = document.getElementById('btnBackToMain');
const btnRun = document.getElementById('btnRun');
const btnClear = document.getElementById('btnClear');
const btnStep = document.getElementById('btnStep');
const btnSound = document.getElementById('btnSound');
const winModal = document.getElementById('winModal');
const winTitle = document.getElementById('winTitle');
const winText = document.getElementById('winText');
const btnNextLevel = document.getElementById('btnNextLevel');
const btnReplay = document.getElementById('btnReplay');
const failToast = document.getElementById('failToast');
const confettiContainer = document.getElementById('confettiContainer');

btnSound.onclick = () => {
  voiceEnabled = !voiceEnabled;
  btnSound.textContent = voiceEnabled ? '🔊' : '🔇';
  btnSound.classList.toggle('muted', !voiceEnabled);
  if (!voiceEnabled && 'speechSynthesis' in window) speechSynthesis.cancel();
};

// ---------- Helpers ----------
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const leftOf = (d) => ORDER[(ORDER.indexOf(d) + 3) % 4];
const rightOf = (d) => ORDER[(ORDER.indexOf(d) + 1) % 4];

function showToast(msg) {
  failToast.textContent = msg;
  failToast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => failToast.classList.remove('show'), 2200);
}

function resetRobotToStart() {
  robotState = { row: level.start.row, col: level.start.col, dir: level.start.dir };
}

function invalidateStepQueue() {
  stepQueue = null;
  stepIndex = 0;
  updateControlsDisabled();
}

function updateControlsDisabled() {
  btnRun.disabled = isRunning || stepQueue !== null;
  btnStep.disabled = isRunning;
  btnClear.disabled = isRunning;
  btnPrevLevel.disabled = isRunning || currentLevelIndex === 0;
  btnNextLevelNav.disabled = isRunning || currentLevelIndex >= maxUnlockedIndex;
}

function updateHeaderStats() {
  levelNumberEl.textContent = currentLevelIndex + 1;
  starCountEl.textContent = completedLevels.size;
  rankLabelEl.textContent = getRank(completedLevels.size);
}

// ---------- Level loading ----------
function loadLevel(index) {
  currentLevelIndex = index;
  level = getLevel(index);
  pathSet = new Set(level.path.map(([r, c]) => `${r},${c}`));
  program = [];
  activeContainer = program;
  activeContainerLabel = null;
  blockIdCounter = 1;
  blockEls = {};
  stepQueue = null;
  stepIndex = 0;
  isRunning = false;
  resetRobotToStart();

  renderBoard();
  renderPalette();
  renderProgram();
  hintBoxEl.textContent = level.hint;
  updateHeaderStats();
  updateControlsDisabled();
  speak(`Level ${index + 1}. ${level.hint}`);
}

// ---------- Board rendering ----------
function renderBoard() {
  boardEl.innerHTML = '';
  boardEl.style.gridTemplateColumns = `repeat(${level.cols}, ${CELL}px)`;
  boardEl.style.gridTemplateRows = `repeat(${level.rows}, ${CELL}px)`;

  for (let r = 0; r < level.rows; r++) {
    for (let c = 0; c < level.cols; c++) {
      const cell = document.createElement('div');
      const isPath = pathSet.has(`${r},${c}`);
      cell.className = 'cell ' + (isPath ? 'path' : 'wall');
      if (isPath && r === level.goal.row && c === level.goal.col) {
        cell.textContent = '🪐';
        cell.classList.add('goal-cell');
      } else if (!isPath) {
        cell.textContent = '🪨';
      }
      boardEl.appendChild(cell);
    }
  }

  robotEl = document.createElement('div');
  robotEl.className = 'robot';
  robotEl.textContent = '🤖';
  boardEl.appendChild(robotEl);
  renderRobotPosition();
}

function renderRobotPosition() {
  robotEl.style.left = robotState.col * CELL + 'px';
  robotEl.style.top = robotState.row * CELL + 'px';
  robotEl.style.transform = `rotate(${DIR_ROTATION[robotState.dir]}deg)`;
}

function renderRobotBump() {
  robotEl.classList.add('bump');
  setTimeout(() => robotEl.classList.remove('bump'), 350);
}

// ---------- Palette ----------
function renderPalette() {
  paletteEl.innerHTML = '';
  level.allowedBlocks.forEach((type) => {
    const btn = document.createElement('button');
    btn.className = 'palette-block ' + type;
    btn.textContent = LABELS[type];
    btn.onclick = () => addBlock(type);
    paletteEl.appendChild(btn);
  });
}

function addBlock(type) {
  if (isRunning || stepQueue !== null) return;
  const block = { id: blockIdCounter++, type };
  if (type === 'repeat') {
    block.count = 2;
    block.children = [];
  }
  activeContainer.push(block);
  if (type === 'repeat') {
    activeContainer = block.children;
    activeContainerLabel = block;
  }
  invalidateStepQueue();
  renderProgram();
  sfxAdd();
  speak(SPEAK_LABELS[type]);
}

// ---------- Program tree ----------
function buildBlockNode(block) {
  if (block.type === 'repeat') {
    const wrap = document.createElement('div');
    wrap.className = 'prog-block repeat';

    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('span');
    label.textContent = '🔁 Repeat';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '×';
    removeBtn.onclick = (e) => { e.stopPropagation(); removeBlock(block.id); };
    row.append(label, removeBtn);

    const countSel = document.createElement('div');
    countSel.className = 'count-select';
    [2, 3, 4, 5].forEach((n) => {
      const b = document.createElement('button');
      b.className = 'count-btn' + (block.count === n ? ' selected' : '');
      b.textContent = n + '×';
      b.onclick = (e) => {
        e.stopPropagation();
        if (isRunning || stepQueue !== null) return;
        block.count = n;
        invalidateStepQueue();
        renderProgram();
      };
      countSel.appendChild(b);
    });

    const childrenDiv = document.createElement('div');
    childrenDiv.className = 'repeat-children' + (activeContainer === block.children ? ' is-active' : '');
    childrenDiv.onclick = (e) => {
      e.stopPropagation();
      if (isRunning || stepQueue !== null) return;
      activeContainer = block.children;
      activeContainerLabel = block;
      renderProgram();
    };
    if (block.children.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'repeat-empty';
      empty.textContent = '(empty — tap here, then add blocks)';
      childrenDiv.appendChild(empty);
    } else {
      block.children.forEach((child) => childrenDiv.appendChild(buildBlockNode(child)));
    }

    wrap.append(row, countSel, childrenDiv);
    blockEls[block.id] = wrap;
    return wrap;
  }

  const el = document.createElement('div');
  el.className = 'prog-block ' + block.type;
  const label = document.createElement('span');
  label.textContent = LABELS[block.type];
  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-btn';
  removeBtn.textContent = '×';
  removeBtn.onclick = (e) => { e.stopPropagation(); removeBlock(block.id); };
  el.append(label, removeBtn);
  blockEls[block.id] = el;
  return el;
}

function renderProgram() {
  blockEls = {};
  programListEl.innerHTML = '';
  if (program.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-msg';
    p.textContent = 'Tap blocks on the left to build your program!';
    programListEl.appendChild(p);
  } else {
    program.forEach((b) => programListEl.appendChild(buildBlockNode(b)));
  }
  programListEl.classList.toggle('is-active', activeContainer === program && program.length > 0);
  programListEl.onclick = (e) => {
    if (e.target === programListEl) {
      if (isRunning || stepQueue !== null) return;
      activeContainer = program;
      activeContainerLabel = null;
      renderProgram();
    }
  };
  updateActiveBanner();
}

function removeFromTree(list, id) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) { list.splice(i, 1); return true; }
    if (list[i].type === 'repeat' && removeFromTree(list[i].children, id)) return true;
  }
  return false;
}

function removeBlock(id) {
  if (isRunning || stepQueue !== null) return;
  removeFromTree(program, id);
  activeContainer = program;
  activeContainerLabel = null;
  invalidateStepQueue();
  renderProgram();
  sfxRemove();
}

function updateActiveBanner() {
  if (activeContainerLabel) {
    activeBannerEl.style.display = 'flex';
    activeBannerTextEl.textContent = `Adding to: Repeat block (${activeContainerLabel.count}×)`;
  } else {
    activeBannerEl.style.display = 'none';
  }
}
btnBackToMain.onclick = () => {
  activeContainer = program;
  activeContainerLabel = null;
  renderProgram();
};

// ---------- Level navigation ----------
btnPrevLevel.onclick = () => {
  if (isRunning || currentLevelIndex === 0) return;
  loadLevel(currentLevelIndex - 1);
};
btnNextLevelNav.onclick = () => {
  if (isRunning || currentLevelIndex >= maxUnlockedIndex) return;
  loadLevel(currentLevelIndex + 1);
};

// ---------- Execution ----------
function flatten(list, out) {
  list.forEach((b) => {
    if (b.type === 'repeat') {
      for (let i = 0; i < b.count; i++) flatten(b.children, out);
    } else {
      out.push({ type: b.type, blockId: b.id });
    }
  });
}

function clearHighlights() {
  document.querySelectorAll('.active-step').forEach((e) => e.classList.remove('active-step'));
}

function highlightBlock(id) {
  clearHighlights();
  const el = blockEls[id];
  if (el) el.classList.add('active-step');
}

function executeSingleStep(step) {
  if (step.type === 'move') {
    const [dr, dc] = DIR_DELTA[robotState.dir];
    const nr = robotState.row + dr;
    const nc = robotState.col + dc;
    if (pathSet.has(`${nr},${nc}`)) {
      robotState.row = nr;
      robotState.col = nc;
      renderRobotPosition();
      return true;
    }
    renderRobotBump();
    return false;
  }
  if (step.type === 'turnLeft') { robotState.dir = leftOf(robotState.dir); renderRobotPosition(); return true; }
  if (step.type === 'turnRight') { robotState.dir = rightOf(robotState.dir); renderRobotPosition(); return true; }
  return true;
}

function checkGoalReachedOrToast() {
  if (robotState.row === level.goal.row && robotState.col === level.goal.col) {
    onLevelSuccess();
  } else {
    showToast('🚶 Not there yet, keep going!');
    speak('Not quite there yet. Keep going!');
  }
}

async function runProgram() {
  if (isRunning || stepQueue !== null) return;
  if (program.length === 0) {
    showToast('🧩 Add some blocks before running!');
    speak('Add some blocks first!');
    return;
  }

  isRunning = true;
  updateControlsDisabled();
  resetRobotToStart();
  renderRobotPosition();
  clearHighlights();
  sfxRun();
  await sleep(250);

  const steps = [];
  flatten(program, steps);
  let failed = false;

  for (const step of steps) {
    highlightBlock(step.blockId);
    speak(SPEAK_LABELS[step.type]);
    await sleep(320);
    const ok = executeSingleStep(step);
    await sleep(480);
    if (!ok) {
      failed = true;
      showToast('💥 Oops! A wall is in the way. Try again.');
      speak("Oops! There's a wall in the way. Try again.");
      sfxFail();
      break;
    }
  }

  clearHighlights();
  isRunning = false;
  updateControlsDisabled();
  if (!failed) checkGoalReachedOrToast();
}

function stepOnce() {
  if (isRunning) return;
  if (stepQueue === null) {
    if (program.length === 0) {
      showToast('🧩 Add some blocks before starting!');
      speak('Add some blocks first!');
      return;
    }
    resetRobotToStart();
    renderRobotPosition();
    clearHighlights();
    stepQueue = [];
    flatten(program, stepQueue);
    stepIndex = 0;
    updateControlsDisabled();
    return;
  }
  if (stepIndex >= stepQueue.length) {
    clearHighlights();
    checkGoalReachedOrToast();
    stepQueue = null;
    updateControlsDisabled();
    return;
  }
  const step = stepQueue[stepIndex];
  highlightBlock(step.blockId);
  speak(SPEAK_LABELS[step.type]);
  const ok = executeSingleStep(step);
  stepIndex++;
  if (!ok) {
    showToast('💥 Oops! A wall is in the way. Try again.');
    speak("Oops! There's a wall in the way. Try again.");
    sfxFail();
    stepQueue = null;
    stepIndex = 0;
    updateControlsDisabled();
    return;
  }
  if (stepIndex >= stepQueue.length) {
    setTimeout(() => {
      clearHighlights();
      checkGoalReachedOrToast();
      stepQueue = null;
      updateControlsDisabled();
    }, 350);
  }
}

// ---------- Confetti ----------
function launchConfetti() {
  confettiContainer.innerHTML = '';
  const pieceCount = 40;
  for (let i = 0; i < pieceCount; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    piece.style.animationDuration = (1.6 + Math.random() * 1.4) + 's';
    piece.style.animationDelay = (Math.random() * 0.6) + 's';
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    confettiContainer.appendChild(piece);
  }
}

// ---------- Win handling ----------
function onLevelSuccess() {
  const wasNewLevel = !completedLevels.has(currentLevelIndex);
  completedLevels.add(currentLevelIndex);
  maxUnlockedIndex = Math.max(maxUnlockedIndex, currentLevelIndex + 1);
  updateHeaderStats();
  updateControlsDisabled();

  const stars = completedLevels.size;
  const isMilestone = wasNewLevel && stars > 0 && stars % 5 === 0;

  winTitle.textContent = isMilestone ? `🌟 Rank Up: ${getRank(stars)}!` : 'Mission Complete!';
  winText.textContent = isMilestone
    ? `Amazing! You've completed ${stars} levels!`
    : 'You solved the level!';
  btnNextLevel.textContent = 'Next Level ▶️';
  winModal.classList.add('show');
  launchConfetti();
  sfxWin();
  speak(isMilestone
    ? `Amazing! You've completed ${stars} levels! You're now a ${getRank(stars).replace(/[^a-zA-Z ]/g, '')}!`
    : 'Great job! You solved it!');
}

btnNextLevel.onclick = () => {
  winModal.classList.remove('show');
  confettiContainer.innerHTML = '';
  loadLevel(currentLevelIndex + 1);
};
btnReplay.onclick = () => {
  winModal.classList.remove('show');
  confettiContainer.innerHTML = '';
  loadLevel(currentLevelIndex);
};

// ---------- Controls ----------
btnRun.onclick = runProgram;
btnStep.onclick = stepOnce;
btnClear.onclick = () => {
  if (isRunning) return;
  program = [];
  activeContainer = program;
  activeContainerLabel = null;
  stepQueue = null;
  stepIndex = 0;
  resetRobotToStart();
  renderRobotPosition();
  renderProgram();
  updateControlsDisabled();
};

// ---------- Init ----------
loadLevel(0);
