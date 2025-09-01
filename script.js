// Main game logic; starts directly in game view
const FILE = 'Clues.json';

// Elements
const welcome = document.getElementById('welcome'); // may be null (welcome removed)
const game = document.getElementById('game');
const gridEl = document.getElementById('grid');
const clueHeaderEl = document.getElementById('clueHeader');
const clueTextEl = document.getElementById('clueText');
const mobileInput = document.getElementById('mobileInput');

// Top menu removed
const topMenuWrap = document.getElementById('topMenuWrap');
const btnMenu = document.getElementById('btnMenu');
const menuPanel = document.getElementById('menuPanel');
const menuHelp = document.getElementById('menuHelp');
const menuRestart = document.getElementById('menuRestart');
const hintDropdown = document.getElementById('hintDropdown');

// Help + Hints
const btnHelp = document.getElementById('btnHelp'); // was on welcome; may be null
const btnHelpGame = document.getElementById('btnHelpGame'); // may be null
const btnHelpBottom = document.getElementById('btnHelpBottom');
const helpModal = document.getElementById('helpModal');
const helpClose = document.getElementById('helpClose');

const btnHints = document.getElementById('btnHints');
const hintMenu = document.getElementById('hintMenu');
const btnHintDef = document.getElementById('hintDef');
const btnHintLetter = document.getElementById('hintLetter');
const btnHintAnalyse = document.getElementById('hintWordplay');

const btnBack = document.getElementById('btnBack');

// Additional controls
const btnGiveUp = document.getElementById('btnGiveUp');

// Share modal elements
const shareModal = document.getElementById('shareModal');
const shareClose = document.getElementById('shareClose');
const shareGrid = document.getElementById('shareGrid');
const btnCopyResult = document.getElementById('copyResult');
const copyToast = document.getElementById('copyToast');

let puzzle = null;
let grid = [];
let cellMap = new Map();
let entries = [];
let currentEntry = null;
let activeCellKey = null;
let lastClickedCellKey = null;
const dirToggle = new Map();
let puzzleFinished = false;

const TIP = {
  acrostic: 'Take first letters.',
  hidden: 'Look within the fodder.',
  anagram: 'Shuffle the letters.',
  deletion: 'Remove letters.',
  charade: 'Build from parts.',
  lit: 'Whole clue is both definition and wordplay.'
};

// Mapping from clue numbers to their highlight colours. Both the across and
// down clues with the same number share a colour.
const NUMBER_COLOURS = { '1': 'green', '2': 'yellow', '3': 'purple' };

// Actual colour values used when rendering the grid.  These are fairly light so
// that the black text remains legible over them.
const BASE_COLOUR_VALUES = {
  green: '#a8e6a8',
  yellow: '#fff59d',
  purple: '#d8b4fe'
};
const GREY_VALUE = '#bbb';

function key(r,c){ return `${r},${c}`; }

// ----- Grid build -----
function buildGrid(){
  const { rows, cols, blocks = [], numbers = {} } = puzzle.grid;
  const blockSet = new Set(blocks.map(([r,c]) => key(r,c)));
  gridEl.innerHTML = '';
  grid = [];
  cellMap.clear();

  for (let r=0;r<rows;r++){
    const rowArr = [];
    for (let c=0;c<cols;c++){
      const k = key(r,c);
      const cell = {
        r,c,
        block:blockSet.has(k),
        letter:'',
        // baseColour: "none" until a clue covering this cell is solved.
        baseColour: 'none',
        // isGrey marks whether a hint has touched this cell.
        isGrey: false,

        // locked letters cannot be overwritten once the clue is solved.
        locked: false,
        entries:[],
        el:document.createElement('div'),
        nums:[]
      };
      cell.el.className = 'cell' + (cell.block ? ' block' : '');
      cell.el.setAttribute('role','gridcell');
      if (!cell.block) cell.el.addEventListener('click', () => handleCellClick(k));
      gridEl.appendChild(cell.el);
      rowArr.push(cell);
      cellMap.set(k, cell);
    }
    grid.push(rowArr);
  }

  // Numbers (if present)
  const all = numbers.all || [];
  all.forEach(([r,c,label]) => {
    const cell = cellMap.get(key(r,c));
    if (!cell || cell.block) return;
    cell.nums.push(String(label));
    const numEl = document.createElement('div');
    numEl.className = 'num';
    numEl.textContent = String(label);
    cell.el.appendChild(numEl);
  });
}

function placeEntries(){
  entries = (puzzle.entries||[]).map(e => ({
    id: e.id,
    direction: e.direction, // 'across'|'down'
    row: e.row,
    col: e.col,
    answer: e.answer.toUpperCase(),
    clue: e.clue,
    cells: [],
    iActive: 0,
    // Track whether the clue has been solved.
    status: 'unsolved'
  }));

  entries.forEach(ent => {
    for (let i=0;i<ent.answer.length;i++){
      const r = ent.row + (ent.direction==='down' ? i : 0);
      const c = ent.col + (ent.direction==='across' ? i : 0);
      const cell = cellMap.get(key(r,c));
      if (!cell || cell.block) continue;
      ent.cells.push(cell);
      cell.entries.push(ent);
    }
  });
}

// ----- Events -----
// Return the highlight colour for a given clue id.
function colourForClue(id){
  const num = (id.match(/^\d+/) || [])[0];
  return NUMBER_COLOURS[num] || null;
}

// Called when a clue is solved.  Colours the cells of the clue according to the
// mapping above but never overwrites an existing baseColour.
function onClueSolved(clueId){
  const ent = entries.find(e => e.id === clueId);
  if (!ent || ent.status === 'solved') return;
  ent.status = 'solved';
  const colour = colourForClue(clueId);

  ent.cells.forEach(cell => {
    if (colour && cell.baseColour === 'none') cell.baseColour = colour;
    // lock the cell so its letter cannot be changed
    cell.locked = true;
  });
  renderLetters();
  checkForCompletion();

  if (colour){
    ent.cells.forEach(cell => {
      if (cell.baseColour === 'none') cell.baseColour = colour;
    });
  }
  renderLetters();

}

// Called when a hint is used on a clue.  For non reveal-letter hints we simply
// grey out a random cell.  For reveal-letter hints we also fill in the correct
// letter for one not-yet-correct cell.
function onHintUsed(clueId, type){
  const ent = entries.find(e => e.id === clueId);

  if (!ent || ent.status === 'solved') return;

  if (!ent) return;


  if (type === 'reveal-letter'){
    const candidates = ent.cells
      .map((c,i) => ({ cell:c, idx:i }))
      .filter(({cell, idx}) => (cell.letter || '').toUpperCase() !== ent.answer[idx]);
    if (!candidates.length) return;
    const { cell, idx } = candidates[Math.floor(Math.random()*candidates.length)];
    cell.letter = ent.answer[idx];
    cell.isGrey = true;
    ent.iActive = idx;
    activeCellKey = key(cell.r, cell.c);

    // Check both this entry and any crossing entry in case the revealed
    // letter completes another clue.
    cell.entries.forEach(checkIfSolved);

  } else {
    const candidates = ent.cells.filter(c => !c.isGrey);
    const cell = (candidates.length
      ? candidates[Math.floor(Math.random()*candidates.length)]
      : ent.cells[Math.floor(Math.random()*ent.cells.length)]);
    cell.isGrey = true;

    // Greying doesn't change letters, but the clue might already be correct.
    checkIfSolved(ent);
  }
  renderLetters();
}

function checkIfSolved(ent){
  const guess = ent.cells.map(c => c.letter || '').join('').toUpperCase();
  if (guess === ent.answer.toUpperCase()) onClueSolved(ent.id);
}

// Check whether every cell matches its answer; if so, trigger completion.
function checkForCompletion(){
  if (puzzleFinished) return;
  const done = entries.every(ent =>
    ent.cells.every((cell, idx) => (cell.letter || '').toUpperCase() === ent.answer[idx])
  );
  if (done){
    puzzleFinished = true;
    onPuzzleComplete();
  }
}

function onPuzzleComplete(){
  renderSharePreview();
  openShareModal();
  finishGame();
}

// Build the share preview grid shown in the modal
function renderSharePreview(){
  if (!shareGrid || !puzzle) return;
  const { rows, cols } = puzzle.grid;
  shareGrid.innerHTML = '';
  shareGrid.style.gridTemplateColumns = `repeat(${cols},16px)`;
  shareGrid.style.gridTemplateRows = `repeat(${rows},16px)`;
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const cell = grid[r][c];
      const d = document.createElement('div');
      d.className = 'share-cell';
      let bg = '#000';
      if (!cell.block){
        if (cell.isGrey) bg = GREY_VALUE;
        else if (cell.baseColour !== 'none') bg = BASE_COLOUR_VALUES[cell.baseColour];
        else bg = '#fff';
      }
      d.style.background = bg;
      shareGrid.appendChild(d);
    }
  }
}

// Assemble plain-text emoji grid for clipboard sharing
function buildShareText(){
  const { rows, cols } = puzzle.grid;
  const lines = [];
  for (let r=0;r<rows;r++){
    let line = '';
    for (let c=0;c<cols;c++){
      const cell = grid[r][c];
      let emoji = '⬛';
      if (!cell.block){
        if (cell.isGrey) emoji = '⬜';
        else if (cell.baseColour === 'green') emoji = '🟩';
        else if (cell.baseColour === 'yellow') emoji = '🟨';
        else if (cell.baseColour === 'purple') emoji = '🟪';
        else emoji = '⬜';
      }
      line += emoji;
    }
    lines.push(line);
  }
  lines.push('I beat todays cryptic crossword!');
  lines.push('https://mvpgarden.vercel.app/');
  return lines.join('\n');
}

let lastFocused = null;
function openShareModal(){
  if (!shareModal) return;
  lastFocused = document.activeElement;
  shareModal.hidden = false;
  const focusables = shareModal.querySelectorAll('button, [href]');
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const trap = (e) => {
    if (e.key === 'Tab'){
      if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    } else if (e.key === 'Escape'){ closeShareModal(); }
  };
  shareModal.addEventListener('keydown', trap);
  shareModal._trap = trap;
  (first || shareModal).focus();
}

function closeShareModal(){
  if (!shareModal) return;
  shareModal.hidden = true;
  if (shareModal._trap) shareModal.removeEventListener('keydown', shareModal._trap);
  if (lastFocused) lastFocused.focus();

  renderLetters();
}

function renderClue(ent){
  const segs = (ent.clue && ent.clue.segments) || [];
  let html;
  if (segs.length) {
    html = segs.map(seg => {
      const cls = seg.type === 'definition' ? 'def' : seg.type;
      const tip = seg.tooltip || TIP[seg.category] || '';
      return `<span class="${cls}" data-tooltip="${escapeHtml(tip)}">${escapeHtml(seg.text)}</span>`;
    }).join(' ');
    const enumeration = ent.answer ? String(ent.answer.length) : '';
    if (enumeration) {
      html += ` (<span class="enumeration">${enumeration}</span>)`;
    }
  } else {
    html = escapeHtml((ent.clue && ent.clue.surface) || '');
  }
  const dirLabel = ent.direction[0].toUpperCase() + ent.direction.slice(1);
  clueHeaderEl.textContent = `${ent.id} — ${dirLabel}`;
  clueTextEl.className = 'clue';
  clueTextEl.innerHTML = html;
}

function renderLetters(){
  grid.flat().forEach(cell => {
    [...cell.el.childNodes].forEach(n => {
      if (n.nodeType === 1 && n.classList.contains('num')) return;
      cell.el.removeChild(n);
    });
    cell.el.classList.remove('active');
    if (cell.block) return;

    // Apply colouring rules.  Grey overlay takes precedence over baseColour.
    let bg = '#fff';
    if (cell.isGrey) bg = GREY_VALUE;
    else if (cell.baseColour !== 'none') bg = BASE_COLOUR_VALUES[cell.baseColour];
    cell.el.style.background = bg;
    cell.el.style.color = '#000'; // keep text legible over grey
  });

  grid.flat().forEach(cell => {
    if (cell.letter) {
      const d = document.createElement('div');
      d.className = 'letter';
      d.style.display = 'grid';
      d.style.placeItems = 'center';
      d.style.width = '100%';
      d.style.height = '100%';
      d.style.fontWeight = '700';
      d.textContent = cell.letter;
      cell.el.appendChild(d);
    }
  });
  highlightActive();
}

function setCurrentEntry(ent, fromCellKey=null){
  currentEntry = ent;
  if (!ent) return;
  renderClue(ent);
  if (fromCellKey){
    const i = ent.cells.findIndex(c => key(c.r,c.c)===fromCellKey);
    ent.iActive = (i>=0 ? i : 0);
  } else if (ent.iActive==null){
    ent.iActive = 0;
  }
  if (ent.cells[ent.iActive].locked) {
    nextCell(+1) || nextCell(-1);
  }
  const cell = ent.cells[ent.iActive];
  activeCellKey = key(cell.r,cell.c);
  renderLetters();
}

function highlightActive(){
  if (!currentEntry) return;
  const cell = currentEntry.cells[currentEntry.iActive];
  if (cell) cell.el.classList.add('active');
}

function handleCellClick(k){
  const cell = cellMap.get(k);
  if (!cell || cell.block) return;
  const belongs = cell.entries || [];
  if (!belongs.length) return;

  let pref = dirToggle.get(k) || 'across';
  if (lastClickedCellKey === k) pref = pref==='across' ? 'down' : 'across';
  lastClickedCellKey = k;

  const ent = belongs.find(e => e.direction===pref) || belongs[0];
  dirToggle.set(k, ent.direction);
  setCurrentEntry(ent, k);
}

function nextCell(inc){
  if (!currentEntry) return null;
  let i = currentEntry.iActive;
  do {
    i += inc;
  } while (i >= 0 && i < currentEntry.cells.length && currentEntry.cells[i].locked);
  if (i < 0 || i >= currentEntry.cells.length) return null;
  currentEntry.iActive = i;
  const cell = currentEntry.cells[i];
  activeCellKey = key(cell.r,cell.c);
  return cell;
}

function typeChar(ch){
  if (!currentEntry) return;
  let cell = currentEntry.cells[currentEntry.iActive];
  if (cell.locked){
    cell = nextCell(+1);
    if (!cell || cell.locked) return;
  }
  cell.letter = ch.toUpperCase();
  // Check every entry that uses this cell so crossing clues can
  // auto-solve when their final letter is entered.
  cell.entries.forEach(checkIfSolved);
  nextCell(+1);
  renderLetters();
}

function backspace(){
  if (!currentEntry) return;
  let cell = currentEntry.cells[currentEntry.iActive];
  if (cell.locked){
    cell = nextCell(-1);
    if (!cell || cell.locked) return;
  }
  cell.letter = '';
  nextCell(-1);
  renderLetters();
}

function submitAnswer(){
  if (!currentEntry) return;
  const guess = currentEntry.cells.map(c => c.letter||' ').join('').toUpperCase();
  const target = currentEntry.answer.toUpperCase();
  if (guess === target){
    onClueSolved(currentEntry.id);
    game.classList.add('flash-green');
      setTimeout(() => {
        game.classList.remove('flash-green');
        const idx = entries.indexOf(currentEntry);
        const next = entries[idx+1];
        if (next) setCurrentEntry(next);
      }, 650);
    } else {
      game.classList.add('flash-red');
      setTimeout(() => game.classList.remove('flash-red'), 450);
    }
}

function finishGame(){
  var fireworks = document.getElementById('fireworks');
  if (fireworks) fireworks.classList.add('on');
}

// ----- Help & hints & misc -----
function setupHandlers(){
  // Help modal open/close
  const openHelp = () => { helpModal.hidden = false; };
  const closeHelp = () => { helpModal.hidden = true; };
  if (btnHelp) btnHelp.addEventListener('click', openHelp);
  if (btnHelpGame) btnHelpGame.addEventListener('click', openHelp);
  if (btnHelpBottom) btnHelpBottom.addEventListener('click', openHelp);
  if (helpClose) helpClose.addEventListener('click', closeHelp);

  // Hints dropdown
  if (btnHints) btnHints.addEventListener('click', () => {
    const expanded = btnHints.getAttribute('aria-expanded') === 'true';
    btnHints.setAttribute('aria-expanded', String(!expanded));
    if (hintMenu) hintMenu.setAttribute('aria-hidden', String(expanded));
    if (hintDropdown){
      if (expanded) hintDropdown.classList.remove('open'); else hintDropdown.classList.add('open');
    }
  });
  if (btnHintDef) btnHintDef.addEventListener('click', () => {
    if (!currentEntry) return;
    const shown = clueTextEl.classList.toggle('help-on');
    if (shown) onHintUsed(currentEntry.id, 'definition');
  });
  if (btnHintLetter) btnHintLetter.addEventListener('click', () => {
    if (!currentEntry) return;
    onHintUsed(currentEntry.id, 'reveal-letter');
  });
  if (btnHintAnalyse) btnHintAnalyse.addEventListener('click', () => {
    if (!currentEntry) return;
    const shown = clueTextEl.classList.toggle('annot-on');
    if (shown) onHintUsed(currentEntry.id, 'analyse');
  });

  // Top Menu dropdown — removed; guards keep this safe if elements don't exist
  if (btnMenu) btnMenu.addEventListener('click', () => {
    const expanded = btnMenu.getAttribute('aria-expanded') === 'true';
    btnMenu.setAttribute('aria-expanded', String(!expanded));
    if (menuPanel) menuPanel.setAttribute('aria-hidden', String(expanded));
    if (topMenuWrap){
      if (expanded) topMenuWrap.classList.remove('open'); else topMenuWrap.classList.add('open');
    }
  });
  if (menuHelp) menuHelp.addEventListener('click', () => {
    if (helpModal) helpModal.hidden = false;
  });
  if (menuRestart) menuRestart.addEventListener('click', () => {
    restartGame();
    if (btnMenu) btnMenu.setAttribute('aria-expanded','false');
    if (menuPanel) menuPanel.setAttribute('aria-hidden','true');
    if (topMenuWrap) topMenuWrap.classList.remove('open');
  });

  // Reveal answer: fill the current entry with the correct letters and mark it as solved
  if (btnGiveUp) btnGiveUp.addEventListener('click', () => {
    if (!currentEntry) return;
    currentEntry.cells.forEach((cell, idx) => {
      cell.letter = currentEntry.answer[idx];
    });
    // After revealing, re-check all affected clues.
    currentEntry.cells.forEach(cell => cell.entries.forEach(checkIfSolved));
    renderLetters();
    submitAnswer();
  });

  // Share modal handlers
  if (shareClose) shareClose.addEventListener('click', closeShareModal);
  if (btnCopyResult) btnCopyResult.addEventListener('click', () => {
    const text = buildShareText();
    navigator.clipboard.writeText(text).then(() => {
      if (copyToast){
        copyToast.hidden = false;
        setTimeout(() => { copyToast.hidden = true; }, 1500);
      }
    });
  });

  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    const t = e.target;
    // Hints
    if (hintDropdown && !hintDropdown.contains(t)){
      if (hintDropdown.classList.contains('open')){
        hintDropdown.classList.remove('open');
        if (btnHints) btnHints.setAttribute('aria-expanded','false');
        if (hintMenu) hintMenu.setAttribute('aria-hidden','true');
      }
    }
    // Top menu
    if (topMenuWrap && !topMenuWrap.contains(t)){
      if (topMenuWrap.classList.contains('open')){
        topMenuWrap.classList.remove('open');
        if (btnMenu) btnMenu.setAttribute('aria-expanded','false');
        if (menuPanel) menuPanel.setAttribute('aria-hidden','true');
      }
    }
  });

  // Back (welcome removed) — guard
  if (btnBack) btnBack.addEventListener('click', () => {
    if (game) game.hidden = true;
    if (welcome) welcome.hidden = false;
  });

  // Typing
  if (mobileInput) mobileInput.addEventListener('input', e => {
    const char = e.data || e.target.value;
    if (/^[a-zA-Z]$/.test(char)) typeChar(char);
    e.target.value = '';
  });
  document.addEventListener('keydown', e => {
    if (/^[a-zA-Z]$/.test(e.key)) typeChar(e.key);
    else if (e.key === 'Backspace'){ e.preventDefault(); backspace(); }
    else if (e.key === 'Enter'){ submitAnswer(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp'){ nextCell(-1); renderLetters(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown'){ nextCell(+1); renderLetters(); }
  });
}
function restartGame(){
  entries.forEach(ent => {
    ent.status = 'unsolved';
    ent.cells.forEach(c => {
      c.letter = '';
      c.baseColour = 'none';
      c.isGrey = false;

      c.locked = false;
    });
  });
  puzzleFinished = false;
  if (shareModal) shareModal.hidden = true;
  if (copyToast) copyToast.hidden = true;
  const fireworks = document.getElementById('fireworks');
  if (fireworks) fireworks.classList.remove('on');

  setCurrentEntry(entries[0]);
  renderLetters();
}

function escapeHtml(s=''){
  return String(s).replace(/[&<>"']/g, m => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]
  ));
}

// ----- Boot -----
window.addEventListener('load', () => {
  // Set up UI handlers immediately
  setupHandlers();

  // Try inline JSON first
  let inlineLoaded = false;
  const inline = document.getElementById('puzzleData');
  if (inline && inline.textContent) {
    try {
      puzzle = JSON.parse(inline.textContent);
      inlineLoaded = true;
    } catch (e) {
      console.error('Inline JSON parse failed', e);
    }
  }
  if (inlineLoaded) {
    buildGrid();
    placeEntries();
    setCurrentEntry((puzzle.entries || [])[0]);
    if (mobileInput) mobileInput.focus();
    return;
  }
  // Fallback to fetching a file
  fetch(FILE)
    .then(r => {
      if (!r.ok) throw new Error(`Failed to load ${FILE}: ${r.status}`);
      return r.json();
    })
    .then(json => {
      puzzle = json;
      buildGrid();
      placeEntries();
      setCurrentEntry((puzzle.entries || [])[0]);
      if (mobileInput) mobileInput.focus();
    })
    .catch(err => {
      console.warn('All data sources failed, using tiny placeholder:', err);
      puzzle = {
        grid: { rows: 5, cols: 5, blocks: [] },
        entries: [{ id: '1A', direction: 'across', row: 0, col: 0, answer: 'HELLO', clue: { surface: 'Wave politely (5)' } }]
      };
      buildGrid();
      placeEntries();
      setCurrentEntry(puzzle.entries[0]);
      if (mobileInput) mobileInput.focus();
    });
});
