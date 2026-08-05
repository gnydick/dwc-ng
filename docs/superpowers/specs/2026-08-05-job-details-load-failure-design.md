# Job details: a failed read is a visible failure, and a hard stop

**Date:** 2026-08-05
**Status:** approved (Gabe, 2026-08-05)
**Touches:** `packages/ui/src/cards/FileCards.tsx`, `packages/ui/src/compose/services.ts`,
`packages/ui/src/files/fileInfoError.ts` (new), `packages/ui/src/app.css`

## The problem

Selecting a job file whose metadata cannot be read leaves the details card showing
the fixed string `No metadata` — three words, in the same muted style used for
"No selection", with no indication that anything went wrong and no way to try
again. Reported 2026-08-04 as "jobs card is failing to load the job file".

The information needed to say something useful is already reaching the card and
being discarded. DSF reports a metadata failure as a 500 with a text body, and
`DsfConnector.request` already preserves that body verbatim into
`OperationFailedError(detail)` (`DsfConnector.ts:547`). The card throws it away.

Verified against the machine on 2026-08-05, so the healthy path is not in
question: `GET /machine/directory/0:/gcodes` returns 413 files; `GET
/machine/fileinfo/<path>` returns 200 with every key the parser reads, correctly
typed, including for filenames containing spaces; `?readThumbnailContent=true`
returns two QOI thumbnails whose offsets match the ones the metadata call
reports. The endpoint and the encoding are sound. What is missing is the
card's behaviour when they are not.

## Decisions

### D1 — A failed read blocks the run. No exceptions.

Any error loading the file is a failure, and a failure is a hard no on action
(Gabe, 2026-08-05). `Start print` and `Simulate` are not offered in the error
state, whatever the error was.

This **narrows** the standing rule that the GUI encodes no safeties, verdicts, or
gating because the firmware is the authority (`controls-are-1to1-with-gcode`).
The tension was raised explicitly — a metadata read failing is not proof the file
will not print, and DSF's scanner can choke on a header while the G-code body
runs fine — and was overruled on the grounds that launching a file the machine
could not read is too dangerous. Recorded as a decision so it does not read later
as drift, and so the next person to find a GUI-side gate here knows it was
deliberate.

The scope of the narrowing is exactly this: the job-details card withholds the
run actions when it could not read the file. It is not licence for other cards to
form verdicts about what the machine can do.

### D2 — The summary says only what is known.

The card leads with a plain-language line and puts the machine's own words
underneath it, in monospace.

An earlier draft had the summary say "This file appears to be corrupt". It
cannot: the connector maps a DSF non-ok response and a network/timeout failure to
the same `OperationFailedError` (`DsfConnector.ts:536` and `:547`), so that
wording would accuse a healthy file of being corrupt after a Wi-Fi blip. Making
the two distinguishable at the seam was designed and then dropped — once D1 makes
*every* error blocking, the taxonomy earns nothing, and the honest wording costs
nothing.

| error | summary |
| --- | --- |
| `FileNotFoundError` | This file is no longer on the machine. |
| `InvalidPasswordError` | The session expired. |
| anything else | Could not read this file. |

The machine's text carries the specifics. If a future need arises to say
"corrupt" as a fact rather than a guess, the change is at the one seam: throw a
distinct type from the `catch` around `fetch`, leaving the typed-error mapping
the single choke point it already is.

### D3 — Retry is offered.

`createResource` already returns `refetch`; `jobsBrowserService` discards it
today. Threading it through is the whole of the work, and without it the only way
to re-read a file is to select something else and select it back.

## Design

### `files/fileInfoError.ts` (new)

```
describeFileInfoError(err: unknown): { summary: string; detail: string }
```

Pure, exported, unit-tested. `summary` from the table in D2; `detail` is the
error's own message, verbatim and untouched, empty when there is none. The
wording lives here rather than in JSX conditions so there is one place it can be
got wrong, and so the mapping can be tested without a DOM.

Deliberately does NOT return a `blocksRun` flag. D1 makes blocking unconditional,
and a flag whose value is always `true` is an invitation for someone to set it to
`false`.

### `compose/services.ts`

`const [info, { refetch: refetchInfo }] = createResource(...)`, returned from
`jobsBrowserService` alongside `info`.

### `cards/FileCards.tsx`

The error `<Match>` gains a real body: summary, the machine's text, and a Retry
button wired to `refetchInfo`.

The action row moves INSIDE the success branch. This is the structural half of
D1: today the row sits in the same fragment as the metadata, which happens to be
inside `<Match when={svc.info()}>` already — keeping it there, and never adding a
second action site, is what makes "an error is showing" and "the run actions are
offered" states that cannot both hold. There is no condition to evaluate,
because there is no place for one.

### `app.css`

A `.job-error` block: the summary in the fault colour, the detail in the
monospace face at a smaller size, wrapping and selectable (an operator will want
to copy it). Reuses existing tokens; no new palette.

## Testing

- `describeFileInfoError` per error type, including an `unknown` non-Error value
  and an error with an empty message — the card must never render a bare label
  with nothing under it.
- The detail is the error's message verbatim: a test asserting a DSF-shaped
  message survives unaltered, since silently trimming or prettifying the
  machine's words is the failure mode this whole change exists to fix.
- A source-level pin that `FileCards.tsx` contains exactly one `Start print`
  action site, so the run actions cannot be reintroduced into the error branch.

## Out of scope

- Finding the corrupt file on the machine. Scanning all 413 files means making
  the board parse every one of them; it was `busy` when this was written, and the
  card's behaviour is the deliverable regardless of which file provoked it.
- The standalone (`rr_`) path is unchanged. `PollConnector.getFileInfo` throws the
  same typed errors, so the card behaves identically there without edits.
