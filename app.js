(() => {
  'use strict';
  const KK = window.KK;
  const EMPTY = 0, X = 1, CAT = 2;
  const SIZES = [6, 7, 8, 9, 10];
  const DIFFS = ['easy', 'medium', 'hard', 'expert'];
  const DIFF_LABEL = { easy: 'Łatwy', medium: 'Średni', hard: 'Trudny', expert: 'Ekspert' };
  const DAILY = { n: 8, diff: 'hard' };
  const LS = 'kocie-koce-v1';
  const $ = (id) => document.getElementById(id);
  const board = $('board'), wrap = $('wrap');

  let S;          // persisted: { size, diff, daily, games, next, best, streak, settings }
  let G = null;   // current game (also lives in S.games[key])
  let undo = [], redo = [];
  let cellEls = [], viewCache = [];
  let cursor = 0;
  let generating = 0;

  const fresh = () => ({
    size: 8, diff: 'medium', daily: false, games: {}, next: {}, best: {},
    streak: { cur: 0, best: 0 }, settings: { autoX: true, vibe: true },
  });
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) {} };
  const load = () => { try { const v = localStorage.getItem(LS); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
  const modeKey = () => (S.daily ? 'daily' : `${S.size}-${S.diff}`);

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const fmt = (ms) => {
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
  };
  const vibe = (ms) => { if (!S.settings.vibe) return; try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

  // The message line under the board shows a short note for a moment, then falls back to the board's own line.
  let toastT = null;
  function idleMsg() {
    if (!G) return '';
    if (G.done) return 'Wszystkie koty śpią. Dotknij „Nowa”, by grać dalej.';
    const b = S.best[G.key];
    const base = G.daily ? 'Plansza dnia, taka sama dla wszystkich' : (b ? `Twój rekord na tym poziomie: ${fmt(b)}` : 'Na każdym kocu śpi jeden kot');
    return S.streak.cur > 0 ? `${base} · passa ${S.streak.cur}` : base;
  }
  function showIdle() { if (toastT) return; const t = $('toast'); t.textContent = idleMsg(); t.classList.remove('on'); }
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => { toastT = null; showIdle(); }, 2600);
  }

  // ---------- puzzle factory (Web Workers, with a main-thread fallback) ----------
  function makeFactory() {
    let worker = null;
    const pending = new Map();
    let seq = 0;
    const local = (n, diff, seed) => new Promise((resolve) => {
      const g = KK.generator(n, diff, KK.mulberry32(seed));
      const step = () => { const p = g.step(2); if (p) resolve(p); else setTimeout(step, 0); };
      setTimeout(step, 0);
    });
    try {
      worker = new Worker('worker.js');
      worker.onmessage = (e) => {
        const p = pending.get(e.data.id);
        if (p) { pending.delete(e.data.id); p.resolve(e.data.puzzle); }
      };
      worker.onerror = () => {
        worker = null;
        for (const [id, p] of pending) { pending.delete(id); local(...p.args).then(p.resolve); }
      };
    } catch (e) { worker = null; }
    return {
      make(n, diff, seed) {
        if (!worker) return local(n, diff, seed);
        const id = ++seq;
        return new Promise((resolve) => {
          pending.set(id, { resolve, args: [n, diff, seed] });
          worker.postMessage({ id, n, diff, seed });
        });
      },
    };
  }
  const fg = makeFactory();   // the board the player is waiting for
  const bg = makeFactory();   // the next board, prepared while they play
  const prefetching = new Set();

  function prefetch(key, n, diff) {
    if (key === 'daily' || (S.next[key] && S.next[key].v === 2) || prefetching.has(key)) return;
    prefetching.add(key);
    bg.make(n, diff, (Math.random() * 2 ** 32) >>> 0).then((p) => {
      prefetching.delete(key);
      S.next[key] = { ...p, v: 2 };
      save();
    });
  }

  // ---------- modes ----------
  function renderModes() {
    const diffs = $('diffs'); diffs.innerHTML = '';
    for (const d of [...DIFFS, 'daily']) {
      const b = document.createElement('button');
      b.type = 'button'; b.id = 'diff-' + d;
      b.textContent = d === 'daily' ? 'Dzienna' : DIFF_LABEL[d];
      b.setAttribute('aria-pressed', String(d === 'daily' ? S.daily : !S.daily && S.diff === d));
      if (d === 'daily') b.classList.add('daily');
      b.addEventListener('click', () => {
        if (d === 'daily') S.daily = true; else { S.daily = false; S.diff = d; }
        switchMode();
      });
      diffs.appendChild(b);
    }
    const sizes = $('sizes'); sizes.innerHTML = '';
    if (S.daily) {
      const span = document.createElement('span');
      span.className = 'daily-note';
      span.textContent = `Plansza dnia ${today().slice(5).split('-').reverse().join('.')} · ${DAILY.n}×${DAILY.n} · ${DIFF_LABEL[DAILY.diff]}`;
      sizes.appendChild(span);
      return;
    }
    for (const n of SIZES) {
      const b = document.createElement('button');
      b.type = 'button'; b.id = 'size-' + n; b.textContent = `${n}×${n}`;
      b.setAttribute('aria-pressed', String(S.size === n));
      b.addEventListener('click', () => { S.size = n; switchMode(); });
      sizes.appendChild(b);
    }
  }
  function switchMode() {
    renderModes(); save();
    const key = modeKey();
    const g = S.games[key];
    if (g && g.v === 2 && (key !== 'daily' || g.daily === today())) startGame(g);
    else newGame();
  }

  // ---------- new boards ----------
  function gameFrom(p, key, daily) {
    const cells = new Array(p.n * p.n).fill(EMPTY);
    cells[p.given] = CAT;
    return { v: 2, key, n: p.n, diff: p.diff, reg: p.reg, sol: p.sol, given: p.given, cells,
      elapsed: 0, oops: 0, hints: 0, done: false, daily };
  }
  function newGame() {
    const key = modeKey();
    const daily = key === 'daily' ? today() : null;
    const n = daily ? DAILY.n : S.size, diff = daily ? DAILY.diff : S.diff;
    const ready = S.next[key];
    if (ready && ready.v === 2) {
      delete S.next[key];
      const g = gameFrom(ready, key, null);
      S.games[key] = g; save();
      startGame(g);
      return;
    }
    const token = ++generating;
    $('gen').textContent = diff === 'expert' || n >= 10 ? 'Szukam porządnej planszy…' : 'Rozkładam koce…';
    $('gen').hidden = false;
    const seed = daily ? KK.hashStr('kocie-koce/' + daily) : (Math.random() * 2 ** 32) >>> 0;
    fg.make(n, diff, seed).then((p) => {
      if (token !== generating) return;
      generating = 0; $('gen').hidden = true;
      const g = gameFrom(p, key, daily);
      S.games[key] = g; save();
      if (modeKey() === key) startGame(g);
    });
  }

  // ---------- board ----------
  function startGame(g) {
    generating = 0; $('gen').hidden = true;
    G = g; undo = []; redo = [];
    const n = G.n;
    board.style.setProperty('--n', n);
    board.innerHTML = ''; cellEls = []; viewCache = [];
    for (let i = 0; i < n * n; i++) {
      const d = document.createElement('div');
      d.className = 'c'; d.setAttribute('role', 'gridcell');
      d.style.background = `var(--r${G.reg[i] % 10})`;
      board.appendChild(d); cellEls.push(d); viewCache.push('');
    }
    cursor = Math.min(cursor, n * n - 1);
    wrap.classList.toggle('won', G.done);
    $('win').hidden = true;
    render(); renderStatus(); updateButtons();
    if (!G.daily) prefetch(G.key, G.n, G.key.split('-')[1]);
  }
  function blockedMap() {
    const n = G.n, blk = new Uint8Array(n * n);
    if (!S.settings.autoX || G.done) return blk;
    for (let i = 0; i < n * n; i++) {
      if (G.cells[i] !== CAT) continue;
      const r = (i / n) | 0, c = i % n, g = G.reg[i];
      for (let j = 0; j < n * n; j++) {
        const rr = (j / n) | 0, cc = j % n;
        if (rr === r || cc === c || G.reg[j] === g || (Math.abs(rr - r) <= 1 && Math.abs(cc - c) <= 1)) blk[j] = 1;
      }
    }
    return blk;
  }
  function render() {
    const blk = blockedMap();
    for (let i = 0; i < cellEls.length; i++) {
      const s = G.cells[i];
      const key = s === CAT ? (i === G.given ? 'cat given' : 'cat') : s === X ? 'x' : blk[i] ? 'ax' : '';
      const full = key + (i === cursor ? ' cur' : '');
      if (viewCache[i] === full) continue;
      const el = cellEls[i];
      const anim = el.classList.contains('oops') ? ' oops' : el.classList.contains('flash') ? ' flash' : '';
      if (viewCache[i].replace(' cur', '') !== key) {
        el.innerHTML = s === CAT ? '<svg><use href="#i-cat"/></svg>' : (key === 'x' || key === 'ax') ? '<svg><use href="#i-x"/></svg>' : '';
      }
      el.className = 'c' + (key ? ' ' + key : '') + (i === cursor ? ' cur' : '') + anim;
      viewCache[i] = full;
    }
  }
  function renderStatus() {
    const cats = G.cells.filter((s) => s === CAT).length;
    $('count').textContent = `${cats}/${G.n}`;
    $('oops').innerHTML = G.oops ? `<span class="oops">wtopy: ${G.oops}</span>` : (G.hints ? `podpowiedzi: ${G.hints}` : '');
    $('kicker').textContent = `${G.daily ? 'Dzienna · ' : ''}${DIFF_LABEL[G.diff]} · ${G.n}×${G.n}`;
    showIdle();
    $('streakCur').textContent = S.streak.cur;
    $('streakBest').textContent = S.streak.best;
    $('streak').classList.toggle('broken', !G.done && (G.oops > 0 || G.hints > 0));
  }
  function updateButtons() {
    $('bUndo').disabled = !undo.length || G.done;
    $('bRedo').disabled = !redo.length || G.done;
    $('bHint').disabled = G.done;
    $('bClear').disabled = G.done || !G.cells.includes(X);
    $('bNew').disabled = !!G.daily;
  }

  // ---------- moves ----------
  function flashCell(i, cls) {
    const el = cellEls[i]; el.classList.remove('oops', 'flash'); void el.offsetWidth; el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), cls === 'flash' ? 2400 : 700);
  }
  function breakStreak() {
    if (S.streak.cur > 0) toast(`Passa ${S.streak.cur} przerwana`);
    S.streak.cur = 0;
  }
  function givenTouched() {
    flashCell(G.given, 'flash');
    toast('Ten kot śpi tu od początku');
  }
  // Places a cat; returns false (and records a mistake) when the cat cannot sleep there.
  function placeCat(i) {
    const r = (i / G.n) | 0, c = i % G.n;
    if (G.sol[r] === c) { G.cells[i] = CAT; vibe(12); return true; }
    G.cells[i] = X; G.oops++;
    const hadStreak = S.streak.cur > 0;
    breakStreak();
    flashCell(i, 'oops');
    vibe([30, 40, 30]);
    if (!hadStreak) toast('Wtopa. Tu kot nie zaśnie.');
    return false;
  }
  function commit(before) {
    const changed = before.some((v, i) => v !== G.cells[i]);
    if (changed) { undo.push(before); if (undo.length > 300) undo.shift(); redo = []; }
    render(); renderStatus(); updateButtons(); save();
    checkWin();
  }
  function checkWin() {
    if (G.done) return;
    if (G.cells.filter((s) => s === CAT).length !== G.n) return;
    G.done = true;
    tickTimer();
    const clean = G.oops === 0 && G.hints === 0;
    if (clean) {
      S.streak.cur++;
      S.streak.best = Math.max(S.streak.best, S.streak.cur);
      const s = $('streak'); s.classList.remove('bump'); void s.offsetWidth; s.classList.add('bump');
    }
    let record = false;
    if (!G.daily && clean && (!S.best[G.key] || G.elapsed < S.best[G.key])) { S.best[G.key] = G.elapsed; record = true; }
    for (let i = 0; i < G.n * G.n; i++) if (G.cells[i] === X) G.cells[i] = EMPTY;
    viewCache = viewCache.map(() => '#');
    render(); renderStatus(); updateButtons(); save();
    wrap.classList.add('won');
    vibe([20, 60, 20, 60, 40]);
    $('winTime').textContent = fmt(G.elapsed);
    $('winMode').textContent = `${DIFF_LABEL[G.diff]} · ${G.n}×${G.n}${G.daily ? ' · plansza dnia' : ''}`;
    $('winInfo').textContent = clean
      ? (record ? 'Nowy rekord. ' : '') + `Bez wtopy. Passa: ${S.streak.cur}.`
      : `Wtopy: ${G.oops}, podpowiedzi: ${G.hints}. Passa wraca do zera.`;
    $('winNext').textContent = G.daily ? 'Graj dalej' : 'Następna plansza';
    setTimeout(() => { $('win').hidden = false; $('winNext').focus(); }, 450);
  }

  // ---------- pointer input ----------
  let drag = null;
  let rect = null;
  function cellAt(x, y) {
    if (!rect) return -1;
    const n = G.n;
    const c = Math.floor((x - rect.left) / (rect.width / n));
    const r = Math.floor((y - rect.top) / (rect.height / n));
    if (r < 0 || c < 0 || r >= n || c >= n) return -1;
    return r * n + c;
  }
  function lineCells(a, b) {
    const n = G.n, out = [];
    let r0 = (a / n) | 0, c0 = a % n; const r1 = (b / n) | 0, c1 = b % n;
    const dr = Math.abs(r1 - r0), dc = Math.abs(c1 - c0), sr = r0 < r1 ? 1 : -1, sc = c0 < c1 ? 1 : -1;
    let err = dc - dr;
    for (;;) {
      out.push(r0 * n + c0);
      if (r0 === r1 && c0 === c1) break;
      const e2 = 2 * err;
      if (e2 > -dr) { err -= dr; c0 += sc; }
      if (e2 < dc) { err += dc; r0 += sr; }
    }
    return out;
  }
  function paint(i) {
    if (drag.mode === 'mark' && G.cells[i] === EMPTY) G.cells[i] = X;
    else if (drag.mode === 'erase' && G.cells[i] === X) G.cells[i] = EMPTY;
  }
  board.addEventListener('pointerdown', (e) => {
    if (!G || G.done || generating || drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    rect = board.getBoundingClientRect();
    const i = cellAt(e.clientX, e.clientY);
    if (i < 0) return;
    e.preventDefault();
    try { board.setPointerCapture(e.pointerId); } catch (err) {}
    const start = G.cells[i];
    drag = { id: e.pointerId, start: i, startState: start, last: i, moved: false, before: G.cells.slice(), mode: null, right: e.button === 2 };
    cursor = i;
    if (start === EMPTY) { G.cells[i] = X; drag.mode = 'mark'; }
    else if (drag.right && start === X) { G.cells[i] = EMPTY; drag.mode = 'erase'; }
    render();
  });
  board.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const pts = evs.length ? evs : [e];
    let changed = false;
    for (const p of pts) {
      const i = cellAt(p.clientX, p.clientY);
      if (i < 0 || i === drag.last) continue;
      if (!drag.moved) {
        drag.moved = true;
        if (!drag.mode) {
          drag.mode = 'erase';
          if (drag.startState === X) G.cells[drag.start] = EMPTY;
        }
      }
      for (const j of lineCells(drag.last, i)) paint(j);
      drag.last = i; cursor = i; changed = true;
    }
    if (changed) render();
  });
  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (!d.moved && !cancelled && !d.right) {
      if (d.start === G.given) givenTouched();
      else if (d.startState === X) placeCat(d.start);
      else if (d.startState === CAT) G.cells[d.start] = EMPTY;
    }
    commit(d.before);
  }
  board.addEventListener('pointerup', (e) => endDrag(e, false));
  board.addEventListener('pointercancel', (e) => endDrag(e, true));
  board.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('resize', () => { rect = null; });

  // ---------- keyboard ----------
  board.addEventListener('keydown', (e) => {
    if (!G || G.done) return;
    const n = G.n; let r = (cursor / n) | 0, c = cursor % n;
    const k = e.key;
    if (k.startsWith('Arrow')) {
      if (k === 'ArrowUp') r = Math.max(0, r - 1);
      if (k === 'ArrowDown') r = Math.min(n - 1, r + 1);
      if (k === 'ArrowLeft') c = Math.max(0, c - 1);
      if (k === 'ArrowRight') c = Math.min(n - 1, c + 1);
      cursor = r * n + c; render(); e.preventDefault(); return;
    }
    if (![' ', 'Enter', 'x', 'X', 'c', 'C', 'Backspace', 'Delete'].includes(k)) return;
    e.preventDefault();
    if (cursor === G.given) { givenTouched(); return; }
    const before = G.cells.slice(), s = G.cells[cursor];
    if (k === ' ' || k === 'Enter') { if (s === EMPTY) G.cells[cursor] = X; else if (s === X) placeCat(cursor); else G.cells[cursor] = EMPTY; }
    else if (k === 'x' || k === 'X') { if (s !== CAT) G.cells[cursor] = s === X ? EMPTY : X; }
    else if (k === 'c' || k === 'C') { if (s === CAT) G.cells[cursor] = EMPTY; else placeCat(cursor); }
    else G.cells[cursor] = EMPTY;
    commit(before);
  });
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
    else if (e.key === 'y' || (e.key === 'z' && e.shiftKey) || e.key === 'Z') { e.preventDefault(); doRedo(); }
  });

  // ---------- tools ----------
  function doUndo() {
    if (!G || G.done || !undo.length) return;
    redo.push(G.cells.slice()); G.cells = undo.pop();
    render(); renderStatus(); updateButtons(); save();
  }
  function doRedo() {
    if (!G || G.done || !redo.length) return;
    undo.push(G.cells.slice()); G.cells = redo.pop();
    render(); renderStatus(); updateButtons(); save();
  }
  $('bUndo').addEventListener('click', doUndo);
  $('bRedo').addEventListener('click', doRedo);
  $('bClear').addEventListener('click', () => {
    if (!G || G.done) return;
    const before = G.cells.slice();
    G.cells = G.cells.map((s) => (s === X ? EMPTY : s));
    commit(before);
    toast('Krzyżyki zmazane, koty zostały');
  });
  $('bHint').addEventListener('click', () => {
    if (!G || G.done || generating) return;
    const n = G.n, before = G.cells.slice();
    G.hints++;
    breakStreak();
    // An × sitting on a cat's spot is the most misleading mistake, so point at it first.
    for (let r = 0; r < n; r++) {
      const i = r * n + G.sol[r];
      if (G.cells[i] === X) { G.cells[i] = EMPTY; commit(before); flashCell(i, 'flash'); toast('Tu nie powinno być ×. Ktoś tu śpi.'); return; }
    }
    // Otherwise lay down the cat of the smallest blanket that still lacks one.
    const size = new Array(n).fill(0);
    for (const g of G.reg) size[g]++;
    let pick = -1;
    for (let r = 0; r < n; r++) {
      const i = r * n + G.sol[r];
      if (G.cells[i] === CAT) continue;
      if (pick < 0 || size[G.reg[i]] < size[G.reg[pick]]) pick = i;
    }
    if (pick < 0) return;
    G.cells[pick] = CAT;
    commit(before); flashCell(pick, 'flash');
    toast('Ten kot śpi tutaj');
  });
  let armT = null;
  $('bNew').addEventListener('click', () => {
    if (!G || G.daily || generating) return;
    const b = $('bNew');
    const inProgress = !G.done && G.cells.some((s, i) => s !== EMPTY && i !== G.given);
    if (inProgress && !b.classList.contains('armed')) {
      b.classList.add('armed'); b.lastChild.textContent = 'Na pewno?';
      clearTimeout(armT);
      armT = setTimeout(() => { b.classList.remove('armed'); b.lastChild.textContent = 'Nowa'; }, 3000);
      return;
    }
    clearTimeout(armT); b.classList.remove('armed'); b.lastChild.textContent = 'Nowa';
    newGame();
  });
  $('winClose').addEventListener('click', () => { $('win').hidden = true; });
  $('winNext').addEventListener('click', () => {
    $('win').hidden = true;
    if (G.daily) { S.daily = false; switchMode(); } else newGame();
  });

  // ---------- rules sheet ----------
  const openSheet = () => { $('sheet').hidden = false; };
  const closeSheet = () => { $('sheet').hidden = true; try { localStorage.setItem(LS + '-seen', '1'); } catch (e) {} };
  $('bMenu').addEventListener('click', openSheet);
  $('bSet').addEventListener('click', () => { openSheet(); $('settingsTitle').scrollIntoView({ block: 'start' }); });
  $('sheetClose').addEventListener('click', closeSheet);
  $('sheetBackdrop').addEventListener('click', closeSheet);

  // ---------- settings ----------
  function bindSettings() {
    const a = $('optAuto'), v = $('optVibe');
    a.checked = S.settings.autoX; v.checked = S.settings.vibe;
    a.addEventListener('change', () => { S.settings.autoX = a.checked; save(); if (G) render(); });
    v.addEventListener('change', () => { S.settings.vibe = v.checked; save(); });
  }

  // ---------- timer ----------
  let lastTick = performance.now();
  function tickTimer() {
    const now = performance.now();
    if (G && !G.done && !generating && document.visibilityState === 'visible' && $('win').hidden && $('sheet').hidden) G.elapsed += now - lastTick;
    lastTick = now;
    if (G) $('timer').textContent = fmt(G.elapsed);
  }
  setInterval(tickTimer, 500);
  document.addEventListener('visibilitychange', () => { tickTimer(); save(); });
  window.addEventListener('pagehide', save);

  // ---------- boot ----------
  function start() {
    const def = fresh();
    S = load() || def;
    // Boards from the first version had no revealed cat and no rating; drop them, keep the streak.
    S.games = Object.fromEntries(Object.entries(S.games || {}).filter(([, g]) => g && g.v === 2));
    S.next = Object.fromEntries(Object.entries(S.next || {}).filter(([, g]) => g && g.v === 2));
    S.settings = Object.assign(def.settings, S.settings || {});
    S.streak = Object.assign(def.streak, S.streak || {});
    S.best = Object.fromEntries(Object.entries(S.best || {}).filter(([k]) => k.includes('-')));
    if (!SIZES.includes(S.size)) S.size = 8;
    if (!DIFFS.includes(S.diff)) S.diff = 'medium';
    S.daily = !!S.daily;
    delete S.mode;
    bindSettings();
    switchMode();
    let seen = false;
    try { seen = !!localStorage.getItem(LS + '-seen'); } catch (e) {}
    if (!seen) openSheet();
  }
  start();
})();
