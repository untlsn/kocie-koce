// Kocie Koce puzzle logic: generator, human-style solver and difficulty rating.
// Plain script (no modules) so it runs in the page, in a Web Worker and under Bun tests.
(function (root) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const orth = (n, i) => {
    const r = (i / n) | 0, c = i % n, out = [];
    if (r > 0) out.push(i - n);
    if (r < n - 1) out.push(i + n);
    if (c > 0) out.push(i - 1);
    if (c < n - 1) out.push(i + 1);
    return out;
  };

  // ---------- generation ----------

  function randomSolution(n, rng) {
    const sol = [], used = new Array(n).fill(false);
    const rec = (r) => {
      if (r === n) return true;
      for (const c of shuffle([...Array(n).keys()], rng)) {
        if (used[c] || (r > 0 && Math.abs(c - sol[r - 1]) <= 1)) continue;
        used[c] = true; sol[r] = c;
        if (rec(r + 1)) return true;
        used[c] = false;
      }
      return false;
    };
    rec(0);
    return sol;
  }

  // Grows one blanket around each cat. Blankets below `minSize` get priority, so small ones fill up first.
  function growRegions(n, sol, rng, minSize) {
    const N = n * n, reg = new Array(N).fill(-1), size = new Array(n).fill(1);
    for (let r = 0; r < n; r++) reg[r * n + sol[r]] = r;
    let left = N - n;
    while (left > 0) {
      const all = [], needy = [];
      let needMin = Infinity;
      for (let i = 0; i < N; i++) {
        if (reg[i] !== -1) continue;
        for (const j of orth(n, i)) {
          const g = reg[j];
          if (g === -1) continue;
          all.push(i, g);
          if (size[g] < minSize) {
            if (size[g] < needMin) { needMin = size[g]; needy.length = 0; }
            if (size[g] === needMin) needy.push(i, g);
          }
        }
      }
      const pool = needy.length && rng() < 0.92 ? needy : all;
      const k = Math.floor(rng() * (pool.length / 2)) * 2;
      reg[pool[k]] = pool[k + 1]; size[pool[k + 1]]++;
      left--;
    }
    return { reg, size };
  }

  function findOtherSolution(n, reg, sol) {
    const colUsed = new Uint8Array(n), regUsed = new Uint8Array(n), cur = [];
    let found = null;
    const rec = (r, prev, same) => {
      if (r === n) { if (!same) found = cur.slice(); return !same; }
      for (let c = 0; c < n; c++) {
        if (colUsed[c] || (prev >= 0 && Math.abs(c - prev) <= 1)) continue;
        const g = reg[r * n + c];
        if (regUsed[g]) continue;
        colUsed[c] = 1; regUsed[g] = 1; cur[r] = c;
        if (rec(r + 1, c, same && c === sol[r])) return true;
        colUsed[c] = 0; regUsed[g] = 0;
      }
      return false;
    };
    rec(0, -1, true);
    return found;
  }

  function regionStaysConnected(n, reg, without) {
    const g = reg[without], cells = [];
    for (let i = 0; i < n * n; i++) if (i !== without && reg[i] === g) cells.push(i);
    if (!cells.length) return false;
    const seen = new Set([cells[0]]), stack = [cells[0]];
    while (stack.length) {
      const i = stack.pop();
      for (const j of orth(n, i)) {
        if (j === without || reg[j] !== g || seen.has(j)) continue;
        seen.add(j); stack.push(j);
      }
    }
    return seen.size === cells.length;
  }

  // True when every blanket is one piece.
  function regionsConnected(n, reg) {
    const seen = new Uint8Array(n * n), pieces = new Map();
    for (let i = 0; i < n * n; i++) {
      if (seen[i]) continue;
      const g = reg[i];
      if (pieces.has(g)) return false;
      pieces.set(g, 1);
      seen[i] = 1;
      const stack = [i];
      while (stack.length) {
        const k = stack.pop();
        for (const j of orth(n, k)) if (!seen[j] && reg[j] === g) { seen[j] = 1; stack.push(j); }
      }
    }
    return true;
  }

  // Moves one cell of a rival solution into a neighbouring blanket, which always breaks that rival.
  // Never shrinks a blanket below `minSize`.
  function repair(n, reg, size, sol, alt, rng, minSize) {
    const isSol = new Uint8Array(n * n);
    for (let r = 0; r < n; r++) isSol[r * n + sol[r]] = 1;
    const isAlt = new Uint8Array(n * n);
    const cand = [];
    for (let r = 0; r < n; r++) { isAlt[r * n + alt[r]] = 1; if (alt[r] !== sol[r]) cand.push(r * n + alt[r]); }
    // A blanket at the floor first takes one spare cell from a bigger neighbour, so it can give one away.
    const borrow = (g) => {
      const spare = [];
      for (let j = 0; j < n * n; j++) {
        if (reg[j] === g || isSol[j] || isAlt[j] || size[reg[j]] <= minSize) continue;
        if (!orth(n, j).some((k) => reg[k] === g)) continue;
        spare.push(j);
      }
      for (const j of shuffle(spare, rng)) {
        if (!regionStaysConnected(n, reg, j)) continue;
        size[reg[j]]--; size[g]++; reg[j] = g;
        return true;
      }
      return false;
    };
    for (const i of shuffle(cand, rng)) {
      if (isSol[i]) continue;
      const neighbours = () => {
        const out = [];
        for (const j of orth(n, i)) if (reg[j] !== reg[i] && !out.includes(reg[j])) out.push(reg[j]);
        return out;
      };
      if (!neighbours().length) continue;
      if (size[reg[i]] <= minSize && !borrow(reg[i])) continue;
      if (!regionStaysConnected(n, reg, i)) continue;
      // Read the neighbours only now: a borrow may have taken one of them over.
      const opts = neighbours();
      if (!opts.length) continue;
      const to = opts[Math.floor(rng() * opts.length)];
      size[reg[i]]--; size[to]++; reg[i] = to;
      return true;
    }
    return false;
  }

  // One attempt at a board with a unique solution and every blanket at least `minSize` cells.
  function uniqueBoard(n, rng, minSize) {
    const sol = randomSolution(n, rng);
    const { reg, size } = growRegions(n, sol, rng, minSize);
    if (Math.min(...size) < minSize) return null;
    for (let fix = 0; fix < n * 8; fix++) {
      const alt = findOtherSolution(n, reg, sol);
      if (!alt) return regionsConnected(n, reg) ? { reg, sol, minRegion: Math.min(...size) } : null;
      if (!repair(n, reg, size, sol, alt, rng, minSize)) return null;
    }
    return null;
  }

  // ---------- human-style solver ----------
  // Technique levels:
  //  1  single: a row, column or blanket has one cell left
  //  2  confinement (a blanket fits in one row/column, or the reverse) and shadow
  //     (a cell whose cat would wipe out every option of another row, column or blanket)
  //  3  sets: k blankets squeezed into k rows/columns (k >= 2), or the reverse
  //  4  trial: assume a cat, follow levels 1-3, and drop the cell if that breaks the board

  function geometry(n, reg) {
    const N = n * n, units = [];
    for (let r = 0; r < n; r++) units.push([...Array(n).keys()].map((c) => r * n + c));
    for (let c = 0; c < n; c++) units.push([...Array(n).keys()].map((r) => r * n + c));
    for (let g = 0; g < n; g++) units.push([]);
    for (let i = 0; i < N; i++) units[2 * n + reg[i]].push(i);
    const cu = [], kill = [];
    for (let i = 0; i < N; i++) {
      const r = (i / n) | 0, c = i % n;
      cu.push([r, n + c, 2 * n + reg[i]]);
      const k = new Set();
      for (const u of cu[i]) for (const j of units[u]) k.add(j);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < n && cc < n) k.add(rr * n + cc);
      }
      k.delete(i);
      kill.push([...k]);
    }
    // Which unit of each family a cell belongs to: 0 rows, 1 cols, 2 blankets.
    const fam = [0, 1, 2].map((f) => Array.from({ length: N }, (_, i) => cu[i][f]));
    return { n, N, units, cu, kill, fam };
  }

  const newState = (geo) => ({ cand: new Uint8Array(geo.N).fill(1), done: new Uint8Array(3 * geo.n), cats: 0 });
  const cloneState = (st) => ({ cand: st.cand.slice(), done: st.done.slice(), cats: st.cats });

  function place(geo, st, i) {
    st.cand[i] = 0; st.cats++;
    for (const j of geo.kill[i]) st.cand[j] = 0;
    for (const u of geo.cu[i]) st.done[u] = 1;
  }
  // 1 solved, -1 broken, 0 still open
  function status(geo, st) {
    if (st.cats === geo.n) return 1;
    for (let u = 0; u < 3 * geo.n; u++) {
      if (st.done[u]) continue;
      let any = false;
      for (const i of geo.units[u]) if (st.cand[i]) { any = true; break; }
      if (!any) return -1;
    }
    return 0;
  }
  function cands(geo, st, u) {
    const out = [];
    for (const i of geo.units[u]) if (st.cand[i]) out.push(i);
    return out;
  }

  function stepSingle(geo, st) {
    for (let u = 0; u < 3 * geo.n; u++) {
      if (st.done[u]) continue;
      const c = cands(geo, st, u);
      if (c.length === 1) { place(geo, st, c[0]); return true; }
    }
    return false;
  }

  // k units of family A whose options all sit inside k units of family B:
  // those B units belong to them, so every other option in the B units goes.
  const FAMILY_PAIRS = [[2, 0], [2, 1], [0, 2], [1, 2], [0, 1], [1, 0]];
  function stepSets(geo, st, kMin, kMax) {
    const n = geo.n;
    for (let k = kMin; k <= kMax; k++) {
      for (const [fa, fb] of FAMILY_PAIRS) {
        const open = [];
        for (let a = 0; a < n; a++) {
          const u = fa * n + a;
          if (st.done[u]) continue;
          const bs = new Set();
          for (const i of geo.units[u]) if (st.cand[i]) bs.add(geo.fam[fb][i]);
          if (bs.size <= k) open.push({ u, bs });
        }
        if (open.length < k) continue;
        const pick = [];
        const rec = (start, union) => {
          if (pick.length === k) {
            if (union.size !== k) return false;
            const own = new Set(pick.map((p) => p.u));
            let changed = false;
            for (const b of union) {
              for (const i of geo.units[b]) {
                if (st.cand[i] && !own.has(geo.fam[fa][i])) { st.cand[i] = 0; changed = true; }
              }
            }
            return changed;
          }
          for (let x = start; x < open.length; x++) {
            const nu = new Set(union);
            for (const b of open[x].bs) nu.add(b);
            if (nu.size > k) continue;
            pick.push(open[x]);
            if (rec(x + 1, nu)) return true;
            pick.pop();
          }
          return false;
        };
        if (rec(0, new Set())) return true;
      }
    }
    return false;
  }

  function stepShadow(geo, st) {
    const n = geo.n, mark = new Uint8Array(geo.N);
    for (let c = 0; c < geo.N; c++) {
      if (!st.cand[c]) continue;
      for (const j of geo.kill[c]) mark[j] = 1;
      let bad = false;
      for (let u = 0; u < 3 * n && !bad; u++) {
        if (st.done[u] || geo.cu[c].includes(u)) continue;
        let left = 0;
        for (const i of geo.units[u]) if (st.cand[i] && !mark[i]) { left++; break; }
        if (!left) bad = true;
      }
      for (const j of geo.kill[c]) mark[j] = 0;
      if (bad) { st.cand[c] = 0; return true; }
    }
    return false;
  }

  function stepTrial(geo, st) {
    for (let c = 0; c < geo.N; c++) {
      if (!st.cand[c]) continue;
      const t = cloneState(st);
      place(geo, t, c);
      let s;
      while ((s = status(geo, t)) === 0) {
        if (!(stepSingle(geo, t) || stepSets(geo, t, 1, 1) || stepShadow(geo, t) || stepSets(geo, t, 2, 4))) break;
      }
      if (s === -1) { st.cand[c] = 0; return true; }
    }
    return false;
  }

  // Solves like a person would and reports which techniques it needed.
  // `maxLevel` stops early once a harder technique would be needed (cheap rejection while generating).
  function rate(n, reg, givens, maxLevel = 4) {
    const geo = geometry(n, reg), st = newState(geo);
    for (const g of givens) place(geo, st, g);
    const used = [0, 0, 0, 0, 0];
    const over = (lvl) => ({ solved: false, level: lvl, used, capped: true });
    for (let guard = 0; guard < 2000; guard++) {
      const s = status(geo, st);
      if (s === 1) return { solved: true, level: used.findLastIndex((v, i) => i > 0 && v > 0) || 1, used };
      if (s === -1) return { solved: false, level: 9, used };
      if (stepSingle(geo, st)) { used[1]++; continue; }
      if (maxLevel < 2) return over(2);
      if (stepSets(geo, st, 1, 1) || stepShadow(geo, st)) { used[2]++; continue; }
      if (maxLevel < 3) return over(3);
      if (stepSets(geo, st, 2, 4)) { used[3]++; continue; }
      if (maxLevel < 4) return over(4);
      if (stepTrial(geo, st)) { used[4]++; continue; }
      return { solved: false, level: 5, used };
    }
    return { solved: false, level: 9, used };
  }

  // ---------- difficulty ----------
  const DIFFS = ['easy', 'medium', 'hard', 'expert'];
  function classify(r) {
    if (!r.solved) return null;
    if (r.level <= 1) return 'easy';
    if (r.level === 2) return r.used[2] <= 2 ? 'easy' : 'medium';
    if (r.level === 3) return 'hard';
    return 'expert';
  }

  // Picks the revealed cat: the one that leaves the board closest to the wanted difficulty.
  const CAP = { easy: 2, medium: 2, hard: 3, expert: 4 };
  function chooseGiven(n, reg, sol, diff, rng) {
    const want = DIFFS.indexOf(diff);
    // A revealed cat only makes a board easier, so a board that is too easy bare is useless here.
    if (want >= 2) {
      const bare = rate(n, reg, [], CAP[diff]);
      if (bare.solved && DIFFS.indexOf(classify(bare)) < want) return null;
    }
    let best = null;
    for (const r of shuffle([...Array(n).keys()], rng)) {
      const given = r * n + sol[r];
      const rating = rate(n, reg, [given], CAP[diff]);
      const cls = classify(rating);
      if (!cls) continue;
      const dist = Math.abs(DIFFS.indexOf(cls) - want);
      if (!best || dist < best.dist) best = { given, rating, cls, dist };
      if (dist === 0) break;
    }
    return best;
  }

  // Generator: call step() repeatedly (it does a small batch of work) until it returns a puzzle.
  // Blanket floor starts at 5 cells and drops to 4, then 3 only if bigger ones keep failing.
  function generator(n, diff, rng) {
    let attempts = 0, fallback = null;
    const floorFor = (a) => (a < 6000 ? 5 : a < 9000 ? 4 : 3);
    return {
      step(batch = 3) {
        for (let b = 0; b < batch; b++) {
          attempts++;
          const minSize = Math.min(floorFor(attempts), n - 1);
          const board = uniqueBoard(n, rng, minSize);
          if (!board) continue;
          const pick = chooseGiven(n, board.reg, board.sol, diff, rng);
          if (!pick) continue;
          const puzzle = { n, reg: board.reg, sol: board.sol, given: pick.given, diff: pick.cls, rating: pick.rating, minRegion: board.minRegion, attempts };
          if (pick.dist === 0) return puzzle;
          if (!fallback || pick.dist < fallback.dist) fallback = { ...puzzle, dist: pick.dist };
        }
        // After a long search take the closest board found so far rather than hang.
        if (attempts >= 12000 && fallback) return fallback;
        return null;
      },
      get attempts() { return attempts; },
    };
  }

  root.KK = { mulberry32, hashStr, shuffle, randomSolution, growRegions, regionsConnected, uniqueBoard, findOtherSolution, rate, classify, chooseGiven, generator, DIFFS };
})(typeof self !== 'undefined' ? self : globalThis);
