# Named config backups — design

**Date:** 2026-07-25
**Source:** `USER_AUDIT.md` line 20
**Status:** approved (Gabe, 2026-07-25)

> prompt for save name when save to machine is clicked

Clarified by Gabe: *"since there are backups, we should be able to name the save
so we know what we're restoring."*

## What already exists

`config/store.ts` keeps a rolling history of overlay backups:

```ts
export interface ConfigSnapshot {
    takenAt: number;
    label: string;
    overlay: ConfigOverlay;
}
```

`snapshot(label)` appends one and trims to `MAX_SNAPSHOTS` (10). The Settings
"Saved versions" card lists them with a timestamp and a one-click **revert**.
Every save already takes one:

```ts
async saveToMachine(connector) {
    store.snapshot("saved");
    ...
}
```

The label field is therefore already plumbed end to end — and every entry in the
list reads `saved`, so the card cannot answer the only question it exists to
answer: *which of these do I want back?*

The snapshot is taken from the overlay **being saved**, so naming it names
exactly the state that went to the SD card. The semantics already line up; only
the string is missing.

## Scope

**In:** a name prompt on Save to machine, carried into the snapshot label.

**Out, deliberately:**

- *Named files on the SD card.* Restoring reads the local snapshot list, not the
  SD. Profiles would need an active-config pointer, a picker, and a boot story —
  none of which the request implies.
- *Writing the name into the SD payload* (`savedAs`). Nothing would read it.

## Design

### Data path

`saveToMachine(connector, label?)` forwards the label to the existing
`snapshot()` call. `ConfigSnapshot`, `revert`, `MAX_SNAPSHOTS`, the card, and
the persisted cache format are all unchanged.

An absent or blank label falls back to `"saved"` — today's exact behaviour. The
prompt must never be able to *block* a save, and a row still carries its
timestamp, so an unnamed backup remains identifiable if not descriptive.

### The one new invariant

Snapshot labels reach `localStorage` (via `persistCache()`) and render into a
fixed-width list. An unbounded label bloats the cache and breaks the card's
layout — the standing positional-stability concern.

`snapshot()` is the sole entry point for creating a snapshot, so the rule is
enforced there and nowhere else: **trim, then cap at `MAX_LABEL_LEN` (60);
whitespace-only becomes the fallback.** No call site can introduce a label the
list cannot render, and a future caller inherits the guarantee without knowing
it exists.

This is a shared-choke-point enforcement (rung 6), not a type. Promoting to a
sole-constructor `SnapshotLabel` was considered and rejected as disproportionate
for one string with one producer; recorded here as the promotion path if labels
ever gain a second source.

### UX

The app's convention for single-field entry is inline and in place — the rename
row and the armed-delete confirm strip both work this way; there is no modal for
a text field anywhere in the UI. The save bar follows it.

Clicking **Save to machine** does not save. It arms the bar:

```
[ Unsaved changes ]           [ Save to machine ]   Reset everything
        | click
        v
[ Name this backup          ]  [ Save ]  [ Cancel ]
```

- Enter saves; Escape cancels.
- Cancel returns to the unarmed bar, saving nothing.
- The field autofocuses on arm.
- Save proceeds with `"saved"` when the field is blank.
- Disarms on success. On failure the existing `Save failed: …` hint shows and
  the bar disarms — the error is about the upload, not the name.

`captureScreenGeometry(app.config)` must still run at the moment of the actual
save, not at arm time, so geometry changed while the field is open is included.

### Card height

`config-save` is `rowSpan: 26` in `compose/defs.ts`; the armed state adds a row.
The default is measured and bumped, and the compositions in `compose/screens.ts`
that restate it are updated in step — geometry lives in up to three tiers and
the most specific wins.

Stale saved layouts are no longer a problem: the reflow shipped earlier today
(`docs/superpowers/specs/2026-07-25-card-overlap-reflow-design.md`) adopts a
grown span on load and pushes displaced neighbours clear. This is its first real
exercise.

## Tests

`packages/ui/test/` against the store and the label rule:

1. a label passed to `saveToMachine` reaches the snapshot
2. an absent label falls back to `"saved"`
3. a blank / whitespace-only label falls back to `"saved"`
4. a label longer than 60 chars is capped, and the cap is applied by
   `snapshot()` itself (called directly, not via `saveToMachine`)
5. surrounding whitespace is trimmed
6. the 10-entry cap still holds with labels present
7. a labelled save uploads the byte-identical payload an unlabelled one does —
   the label must not leak into the SD file
8. a labelled save still clears `dirty`

## Verification (must be able to fail)

Live, after deploy: make a change, click Save to machine, type a distinctive
name, confirm, and read the Saved versions card. **Before** this change every
row reads `saved`. **After**, the newest row must read the typed name while
older rows still read `saved`. Both outcomes are observable and distinguishable,
so the check can fail.
