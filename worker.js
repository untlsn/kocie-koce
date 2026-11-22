// Builds puzzles off the main thread so the board never freezes while a hard one is searched for.
importScripts('logic.js' + self.location.search);

self.onmessage = (e) => {
  const { id, n, diff, seed } = e.data;
  const gen = self.KK.generator(n, diff, self.KK.mulberry32(seed));
  let puzzle = null;
  while (!(puzzle = gen.step(4)));
  self.postMessage({ id, puzzle });
};
