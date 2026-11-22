# Kocie Koce

A mobile-only logic puzzle: every coloured blanket holds exactly one sleeping cat, with one cat per row and column and no two cats touching, even diagonally.

- Tap an empty cell for ×, tap × for a cat, tap a cat to remove it.
- Drag a finger from an empty cell to mark × along the whole path; drag from × to erase.
- A cat placed where it cannot sleep is a mistake ("wtopa"). Mistakes and hints reset the streak ("passa") of boards solved cleanly in a row.

It is a single static `index.html` with no build step, ready for GitHub Pages (deploy from the `main` branch root).

Run locally: `bunx serve .`
