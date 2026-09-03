---
status: 🟢
---
# Hard constraints

Moved 2026-09-02 from CLAUDE.md § Hard constraints (these drive everything); history
stays there. These drive everything else in the project. The universal form of the last
bullet is machinery plugin: rules/design-invariants.md § The mandate.

## Hard constraints

- RRF's embedded HTTP server is weak: very few concurrent connections, small output
  buffers, requests are expensive. Minimize request count and total payload.
  **Standalone only:** emit pre-gzipped assets (RRF serves .gz transparently).
  **Never gzip for DSF/SBC** — verified 2026-07-24 on a Duet 3 + SBC: DuetWebServer
  (Kestrel) neither compresses on the fly nor serves .gz transparently, so a .gz deploy
  404s every asset. The packager derives compression from the SERVING STACK (which
  server will answer the browser), not from the transport that wrote the files —
  re-seated 2026-07-31 so one protocol, e.g. FTP, can serve either mode; see
  docs/superpowers/specs/2026-07-24-deployment-packaging-design.md.
- No heavy component libraries. Hand-rolled CSS. The old "under ~300KB gzipped" bundle
  target is **non-binding** — Gabe, 2026-07-24: "that size is not a problem at all".
  Measured: eager 96.9 KB gz, total 665 KB gz, Babylon 232 KB of it and lazy.
- The UI is a live mirror of RRF's object model, updated via polling: lightweight status
  polls, watch `seqs` counters, re-fetch changed subtrees via chunked `rr_model` queries
  (depth/frequency flags, array offsets). Merge = wholesale subtree replacement.
- Nothing should be able to break by construction.
