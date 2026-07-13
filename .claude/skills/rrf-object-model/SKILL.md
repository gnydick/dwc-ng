---
name: rrf-object-model
description: Reference for RepRapFirmware's object model (OM) tree, seqs-driven change detection, and the chunked-fetch + subtree-replacement merge strategy used by dwc-ng. Use whenever working with object-model data: defining typed OM structures, implementing the poll → seqs → rr_model → reconcile loop, deciding what to re-fetch, or interpreting any OM subtree (heat, move, state, job, sensors, tools…). The authoritative shape lives in the vendored `@duet3d/objectmodel` TS classes and the vendored PollConnector under reference/ — source from there, never from memory.
---

# RepRapFirmware object model (OM)

The dwc-ng UI is a live mirror of RRF's object model. This skill covers the
tree's shape, how change detection works via `seqs`, and how we merge updates.
Two things drive everything: the OM is large, and RRF's embedded server is
weak — so we fetch the *minimum* changed data and replace subtrees wholesale.

## Authoritative sources (do not reconstruct from memory)

Everything below is **vendored locally** (read-only) under `reference/`,
pinned to the 3.6.3 firmware line. See `reference/README.md` for provenance.

- **Typed OM classes (TS)** — the source of truth for field names, types,
  nullability: `reference/objectmodel/src/` (`@duet3d/objectmodel` 3.6.3).
  One file/dir per top-level key; the root is `objectmodel/src/ObjectModel.ts`.
  This is also the package CLAUDE.md wants to evaluate for direct reuse.
- **`seqs` semantics & the poll loop** — the authoritative implementation:
  `reference/connectors/src/PollConnector.ts` (`@duet3d/connectors` 3.6.0).
  These are **not** in the OM class definitions; see "seqs" below.
- **`rr_model` / M409 flag letters & array chunking** — verbatim spec snapshot:
  `reference/rrf-m409-object-model.md` (`f v n o d a p`, `a<n>`/`next`, the
  `move.axes` 9-element truncation rule).
- HTTP endpoint mechanics: the [`duet-http-api`](../duet-http-api/SKILL.md)
  skill.

> The root keys table below was generated from the vendored source; when in
> doubt, read the `.ts` file, not this table.

## Root keys (from `objectmodel/src/ObjectModel.ts`)

Each maps to a same-named file/dir under `reference/objectmodel/src/`. Read the
subtree file before relying on any field. `ModelCollection<T | null>` denotes a
sparse array (slots can be null).

| Key | TS type | Notes |
|---|---|---|
| `boards` | `ModelCollection<Board>` | **First item = main board**. |
| `directories` | `Directories` | May be absent if no mass storage. |
| `fans` | `ModelCollection<Fan \| null>` | Sparse. |
| `global` | `ModelDictionary<any>` | User global vars; may reset to null on reconnect. |
| `heat` | `Heat` | Heaters, bed/chamber, live temps (volatile). |
| `inputs` | `ModelCollection<InputChannel \| null>` | Per G/M/T-code channel state. |
| `job` | `Job` | Current print/job progress (volatile during print). |
| `ledStrips` | `ModelCollection<LedStrip>` | |
| `limits` | `Limits` | Machine configuration limits (mostly static). |
| `messages` | `ModelCollection<Message>` | Generic + M118 messages. **Must be cleared manually after updates**; standalone poll ignores it. |
| `move` | `Move` | Axes, extruders, kinematics, live position (volatile). |
| `network` | `Network` | Interfaces, protocols. |
| `plugins` | `ModelDictionary<Plugin>` | **SBC mode mostly**; ignored by standalone poll. |
| `sbc` | `SBC \| null` | **`null` in standalone mode**; ignored by standalone poll. |
| `sensors` | `Sensors` | Z-probes, endstops, analog sensors. |
| `spindles` | `ModelCollection<Spindle \| null>` | CNC; sparse. |
| `state` | `State` | Machine status, current tool, MCU state (volatile). |
| `tools` | `ModelCollection<Tool \| null>` | Sparse. |
| `volumes` | `ModelCollection<Volume>` | Mass storages. |

> **Standalone caveat:** this is one unified shape covering both DSF and
> standalone. `sbc` and `plugins` are null/empty in standalone, and the real
> `PollConnector` explicitly skips `["messages", "plugins", "sbc"]` in its key
> loop (`connectors/src/PollConnector.ts:20`). Per the Duet wiki, this is a
> general rule, not limited to those keys: **some fields are only maintained
> by DSF and/or DWC** and never appear in standalone mode. Tolerate missing
> subtrees/fields everywhere — never bind the UI to one that may not exist on
> the target. (The converse also holds: `seqs` below is standalone-only and
> absent in SBC mode, so captures taken from an SBC machine have no `seqs`.)
>
> **Wiki doc notation:** the OM wiki appends class names in braces to paths
> where multiple item types can be configured, and marks inheritance with a
> colon — `LaserFilamentMonitor : FilamentMonitor` inherits every base
> FilamentMonitor property. Useful when reading the vendored M409 snapshot in
> `reference/`.

## `seqs` — the change-detection counter (standalone)

`seqs` is **not** in the DSF C# root class; it is a RepRapFirmware *standalone*
construct exposed via `rr_model?key=seqs`. It holds a small integer per
top-level subtree that RRF **increments whenever that subtree changes**.

The vendored `PollConnector` implements it exactly like this
(`connectors/src/PollConnector.ts`):

1. On connect, fetch `rr_model?key=seqs` and store it as `lastSeqs` (`:502`).
   Also fetch the full model once, key by key (`:514`).
2. Each cycle, poll live values with `rr_model?flags=d99fn`; the response
   carries a fresh `seqs` object, which the connector strips out (it is
   connector-maintained, not part of the merged model) (`:544-548`).
3. For every key where `seqs[key] !== lastSeqs[key]`, re-fetch **only that
   subtree** via chunked `rr_model` (`:573-577`), then set `lastSeqs = seqs`.
4. Special counters: `seqs.reply` bumping means a new G-code reply is waiting
   → drain `rr_reply` (`:504`, `:623`); `seqs.volChanges[]` is a per-volume
   array tracked separately (`:507`, `:597-603`).

Note `seqs` is **not** a property of the OM classes — it exists only in the
`rr_model` wire protocol. Don't look for it in `objectmodel/src/`.

## Merge strategy: chunked fetch + wholesale replacement

The vendored connector's `queryObjectModel` is the authoritative chunked fetch
(`connectors/src/PollConnector.ts:469-485`):

```ts
// Fetch one key, transparently paginating large arrays via the `a<offset>` flag
async queryObjectModel(key, flags, requestArray = false) {
  let keyResult = null, next = 0;
  do {
    const res = await this.request("GET", "rr_model", {
      key, flags: flags + ((next !== 0 || requestArray) ? `a${next}` : "")
    });
    next = res.next ?? 0;                              // 0 = no more segments
    keyResult = (keyResult instanceof Array)
      ? keyResult.concat(res.result) : res.result;     // stitch array chunks
  } while (next !== 0);
  return keyResult;                                    // whole subtree, replace as a unit
}
```

Large arrays (heaters, axes, tools) come back in **segments at an index
offset** (`a<next>`); the connector stitches them and hands back the complete
subtree. Apply that as a **wholesale replacement of the subtree** — not a deep
field-by-field patch. (For very large axis arrays it re-fetches `move.axes`
separately, `:518-519` / `:576-577`.)

In our SolidJS store this is exactly `reconcile()` on the subtree path (see
[`solid-patterns`](../solid-patterns/SKILL.md) → "Object-model merging").
`reconcile()` gives us wholesale semantics with fine-grained notification:
only the signals whose values actually changed re-run.

```tsx
// After fetching the changed `heat` subtree from rr_model:
setOM("heat", reconcile(freshHeat));
```

## Volatile vs static subtrees

Knowing what changes often guides polling frequency and what to memoize:

- **Volatile (poll-driven, change constantly during operation):** `state`,
  `heat` (live temps), `move` (live position/speeds), `job` (progress),
  `sensors`.
- **Semi-static (change on config/user action):** `tools`, `fans`, `spindles`,
  `network`, `boards`.
- **Static (rarely change after boot):** `limits`, `directories`.

Treat this as a **starting heuristic** to confirm against the per-subtree
classes and `seqs` behavior — RRF is the authority on what actually bumps a
counter, not this list.

## Where to go next

- Field-level shape of a subtree → read `reference/objectmodel/src/<key>/`.
- The HTTP calls that carry this data → [`duet-http-api`](../duet-http-api/SKILL.md).
- Storing/rendering it reactively → [`solid-patterns`](../solid-patterns/SKILL.md).
