---
name: duet-gcode
description: Full Duet/RRF G/M/T-code dictionary (reference/duet-gcode.md) — what each command does, its parameters, examples, and firmware-version support. Use whenever you need to look up or verify a G-code: what a code means, which parameters it takes, whether it exists and since which RRF version, or how a meta-command keyword (if/while/echo/var…) works. Grep `^## <CODE>:` in the reference and read that one section — do not recall command forms from memory. This is a LOOKUP reference only: the exact strings the UI emits live in `packages/ui/src/control/commands.ts`, verified against `reference/dwc` and the real machine macros. Never copy a form out of this file into code, and if this scraped wiki doc disagrees with `reference/dwc` or the board, dwc + the board win.
---

# Duet / RRF G-code dictionary

`reference/duet-gcode.md` is the full Duet3D wiki G-code page (docs.duet3d.com
`/User_manual/Reference/Gcodes`), hand-cleaned into plain Markdown. It covers
essentially every G, M, and T command RRF knows, plus the meta-command
keywords (`abort echo elif else global if set var while`) and the line
protocol (line numbers, checksums, CRC, command order/queueing).

It is large (~9k lines, hundreds of commands). **Never read it whole** — look
up the one command you need.

## How to look one up

Every command is a level-2 heading, and the commands are the G/M/T-prefixed
ones: `## <CODE>: <title>`. So:

- **Find / enumerate commands:** grep `^## (G|M|T)` — every command heading
  starts with a G, M, or T code. (A few prose sections share the prefix, e.g.
  `## GCodes not implemented` and `## Multiple commands on a single line`, so
  skip the headings that don't have a `<code>:` shape.)
- **A specific code:** anchor with the trailing colon — `^## G1:`, `^## M568:`,
  `^## T:`. Grep matches by prefix, so the bare `^## G1` also catches G10, G11,
  G17…; the `:` pins it to exactly that code. (Note a code can appear more than
  once — G10 has three separate entries — so read each match.)
- Read from the heading to the next `##` — that block is the whole entry.
- Within an entry the subsections are `###`: **Parameters**, **Order
  dependency**, **Examples**, **Notes**, and version banners like
  *"Support in RepRapFirmware 3.5 and later"*.

Non-command sections also exist at `##` (Comments, Fields, Command queueing,
Conditional execution, Filenames and Paths, …) — useful for the line protocol
and meta-command semantics.

## What to trust it for

- **What a code does** and what its **parameters/letters** mean.
- **Whether a code exists** and its **firmware-version floor** (this repo is
  pinned to the 3.6.3 line — mind the "since 3.x" banners).
- Meta-command / conditional-GCode keyword behaviour.

## Warnings (read before relying on it)

- **Reference only — never copy a form into code.** Per CLAUDE.md's hard rule,
  everything under `reference/` is read-to-understand, never transcribed. The
  authoritative string we actually send is built in
  `packages/ui/src/control/commands.ts`, whose forms are verified against
  `reference/dwc` (DWC's own dialogs) and the real toolchange/filament macros.
  Use this dictionary to *understand* a code; use `commands.ts` + `dwc` +
  the board to decide the exact bytes we emit.
- **On disagreement, dwc + the board win.** This is a general wiki page. It can
  lag a firmware release, describe a parameter a specific build rejects, or
  differ from what DWC actually sends. When it conflicts with `reference/dwc`
  or a real board reply, believe dwc / the board.
- **Superset, not a spec of our surface.** It documents hundreds of commands;
  this appliance only emits the handful its controls map to (1:1). A code being
  in here is not a reason to build a control for it — build to Gabe's actual
  workflow.
- **Scraped formatting is imperfect.** Code blocks, tables, and inline escaping
  (`\[...\]`) survived the wiki→Markdown conversion unevenly. Trust the facts,
  not the layout.

## Related

- Emitted command builders: `packages/ui/src/control/commands.ts`.
- `rr_model` / M409 flag letters (a different kind of "G-code"): the
  `rrf-object-model` skill + `reference/rrf-m409-object-model.md`.
- HTTP transport for sending codes (`rr_gcode`): the `duet-http-api` skill.
