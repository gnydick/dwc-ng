---
status: 🟢
---
# Stack

Moved 2026-09-02 from CLAUDE.md § Stack (already decided, do not relitigate); history
stays there.

## Stack (already decided, do not relitigate)

- SolidJS + TypeScript + Vite, pnpm workspaces.
- `packages/ui` — the app. `packages/mock-duet` — mock RRF server.
- Solid store + `reconcile()` for object model merging.
- uPlot for temperature charts, CodeMirror 6 (lazy-loaded) for config editing, Three.js
  (lazy-loaded) only if/when gcode/heightmap 3D happens.
