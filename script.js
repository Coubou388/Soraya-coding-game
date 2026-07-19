// ---------- Constants ----------
const CELL = 60;
const ORDER = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
const DIR_DELTA = { UP: [-1, 0], RIGHT: [0, 1], DOWN: [1, 0], LEFT: [0, -1] };
const DIR_ROTATION = { UP: 0, RIGHT: 90, DOWN: 180, LEFT: 270 };
const LABELS = {
  move: '⬆️ Move Forward',
  turnLeft: '↺ Turn Left',
  turnRight: '↻ Turn Right',
  repeat: '🔁 Repeat',
};
// Plain-text versions for speech (no emoji, no arrows)
const SPEAK_LABELS = {
  move: 'Move forward',
  turnLeft: 'Turn left',
  turnRight: 'Turn right',
  repeat: 'Repeat',
};

// ---------- Levels ----------
const levels = [
  {
    rows: 5, cols: 5,
    start: { row: 2, col: 0, dir: 'RIGHT' },
    goal: { row: 2, col: 2 },
    path: [[2, 0], [2, 1], [2, 2]],
    allowedBlocks: ['move'],
    hint: "Tap the Move Forward block to send the robot to the star!",
  },
  {
    rows: 5, cols: 5,
    start: { row: 2, col: 0, dir: 'RIGHT' },
    goal: { row: 2, col: 4 },
    path: [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4]],
    allowedBlocks: ['move'],
    hint: "This path is longer. Add more Move Forward blocks!",
  },
  {
    rows: 5, cols: 5,
    start: { row: 0, col: 0, dir: 'RIGHT' },
    goal: { row: 2, col: 2 },
    path: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
    allowedBlocks: ['move', 'turnLeft', 'turnRight'],
    hint: "The path turns! Use Turn Right at the right moment.",
  },
  {
    rows: 5, cols: 5,
    start: { row: 0, col: 0, dir: 'RIGHT' },
    goal: { row: 1, col: 3 },
    path: [[0, 0], [0, 1], [1, 1], [1, 2], [1, 3]],
    allowedBlocks: ['move', 'turnLeft', 'turnRight'],
    hint: "This path turns twice. Watch which way you go!",
  },
  {
    rows: 5, cols: 5,
    start: { row: 2, col: 0, dir: 'RIGHT' },
    goal: { row: 2, col: 4 },
    path: [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4]],
    allowedBlocks: ['move', 'repeat'],
    hint: "Tip: the Repeat block can move forward several times at once!",
  },
  {
    rows: 5, cols: 5,
    start: { row: 0, col: 0, dir: 'RIGHT' },
    goal: { row: 3, col: 3 },
    path: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3], [2, 3], [3, 3]],
    allowedBlocks: ['move', 'turnLeft', 'turnRight', 'repeat'],
    hint: "Combine Repeat and Turn Right to finish the course!",
  },
];

// ---------- State ----------
let currentLevelIndex = 0;
let level = null;
let pathSet = new Set();
let program = [];
let activeContainer = program;
let activeContainerLabel = null;
let robotState = { row: 0, col: 0, dir: 'RIGHT' };
let completedLevels = new Set();
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

// ---------- DOM ----------
const boardEl = document.getElementById('board');
const paletteEl = document.getElementById('palette');
const programListEl = document.getElementById('programList');
const hintBoxEl = document.getElementById('hintBox');
const levelDotsEl = document.getElementById('levelDots');
const activeBannerEl = document.getElementById('activeBanner');
const activeBannerTextEl = document.getElementById('activeBannerText');
const btnBackToMain = document.getElementById('btnBackToMain');
const btnRun = document.getElementById('btnRun');
const btnClear = document.getElementById('btnClear');
const btnStep = document.getElementById('btnStep');
const btnSound = document.getElementById('btnSound');
const winModal = document.getElementById('winModal');
const winText = document.getElementById('winText');
const btnNextLevel = document.getElementById('btnNextLevel');
const btnReplay = document.getElementById('btnReplay');
const failToast = document.getElementById('failToast');

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
}

// ---------- Level loading ----------
function loadLevel(index) {
  currentLevelIndex = index;
  level = levels[index];
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
  renderLevelDots();
  hintBoxEl.textContent = level.hint;
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
        cell.textContent = '⭐';
      } else if (!isPath) {
        cell.textContent = '🌳';
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

// ---------- Level dots ----------
function renderLevelDots() {
  levelDotsEl.innerHTML = '';
  levels.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'level-dot' + (i === currentLevelIndex ? ' current' : '') + (completedLevels.has(i) ? ' done' : '');
    dot.textContent = completedLevels.has(i) ? '✓' : String(i + 1);
    dot.onclick = () => { if (!isRunning) loadLevel(i); };
    levelDotsEl.appendChild(dot);
  });
}

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
  await sleep(200);

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

// ---------- Win handling ----------
function onLevelSuccess() {
  completedLevels.add(currentLevelIndex);
  renderLevelDots();
  const isLast = currentLevelIndex === levels.length - 1;
  winText.textContent = isLast
    ? "You finished all the levels! You're a coding champion! 🏆"
    : 'You solved the level!';
  btnNextLevel.textContent = isLast ? '🎉 Play Again' : 'Next Level ▶️';
  winModal.classList.add('show');
  speak(isLast
    ? "Congratulations! You finished all the levels! You're a coding champion!"
    : 'Great job! You solved it!');
}

btnNextLevel.onclick = () => {
  winModal.classList.remove('show');
  if (currentLevelIndex + 1 < levels.length) loadLevel(currentLevelIndex + 1);
  else loadLevel(0);
};
btnReplay.onclick = () => {
  winModal.classList.remove('show');
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
