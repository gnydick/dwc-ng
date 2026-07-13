---
name: solid-patterns
description: SolidJS + TypeScript conventions and reactivity rules for the dwc-ng codebase. Use whenever writing or reviewing SolidJS components, signals, stores, or JSX in this repo — creating a component, wiring reactive state, merging the RRF object model, or lazy-loading a heavy dependency. These rules are reviewed for; follow them even when the task doesn't mention Solid explicitly.
---

# SolidJS patterns for dwc-ng

This project is a live mirror of RRF's object model, rendered with SolidJS
under a hard bundle budget (< ~300KB gzipped). Solid's fine-grained
reactivity is what makes that budget achievable — but only if you respect
how it tracks dependencies. The rules below exist because breaking them
produces components that *look* correct, compile fine, and silently stop
updating. Those bugs are expensive to find, so we prevent them by
convention.

## Reactivity rules (reviewed for)

These three are the ones most likely to cause silent staleness. The author
of this codebase reviews every change against them.

### 1. Never destructure props

Destructuring reads the value once, at component-setup time, and throws away
the reactive getter. The component keeps rendering the *first* value forever.

```tsx
// WRONG — `temp` is a dead snapshot; the heater reading never updates
function HeaterBadge({ temp }: { temp: number }) {
  return <span>{temp}°C</span>;
}

// RIGHT — read through props at the point of use, inside the JSX
function HeaterBadge(props: { temp: number }) {
  return <span>{props.temp}°C</span>;
}
```

When you genuinely need to separate props (e.g. to forward `rest` to a child
while consuming a few locally), use `splitProps`, which preserves reactivity:

```tsx
import { splitProps } from "solid-js";

function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["variant", "loading"]);
  return <button classList={{ [local.variant]: true }} {...rest} />;
}
```

### 2. Control flow via `<Show>` / `<For>` / `<Switch>`, not JS

Early returns and `.map()` in JSX run once during setup, so they can't react
to later changes. Solid's control-flow components subscribe to their source
and re-run only the affected branch — which is also what keeps updates cheap
enough for the poll loop.

```tsx
// WRONG — .map snapshots the array; early return freezes the branch
function ToolList(props: { tools: Tool[] }) {
  if (!props.tools.length) return <Empty />;
  return <ul>{props.tools.map((t) => <li>{t.name}</li>)}</ul>;
}

// RIGHT
import { Show, For } from "solid-js";

function ToolList(props: { tools: Tool[] }) {
  return (
    <Show when={props.tools.length} fallback={<Empty />}>
      <ul>
        <For each={props.tools}>{(t) => <li>{t.name}</li>}</For>
      </ul>
    </Show>
  );
}
```

Use `<Switch>`/`<Match>` for more than two mutually-exclusive branches
(e.g. connection state: connecting / connected / faulted / disconnected).

### 3. Read signals and stores only inside tracking scopes

A signal read only creates a subscription when it happens inside a tracking
scope — JSX, an `effect`, a `memo`, or a control-flow component's accessor.
Reading in plain setup code (or logging it once) gets a value but no
subscription, so nothing re-runs when it changes.

```tsx
// WRONG — reads once at setup, never tracks
const label = `Status: ${status()}`;
return <span>{label}</span>;

// RIGHT — the read happens inside JSX, which tracks
return <span>Status: {status()}</span>;

// RIGHT — derive with createMemo when the value is reused/expensive
const label = createMemo(() => `Status: ${status()}`);
```

## Object-model merging: store + `reconcile()`

The RRF object model is polled and merged as **wholesale subtree
replacement** (see CLAUDE.md). Use a Solid store and `reconcile()` so that
replacing a subtree only notifies the signals whose values actually changed
— not every consumer of the whole tree. That surgical invalidation is the
whole point of using a store here.

```tsx
import { createStore, reconcile } from "solid-js/store";

const [om, setOM] = createStore<ObjectModel>(initial);

// On a changed subtree from rr_model, replace it under reconcile:
setOM("heat", "heaters", reconcile(freshHeaters));
```

Do not hand-merge with spreads or mutate nested objects in place — that
either over-notifies (spreading the root) or under-notifies (mutation Solid
never sees).

## Lazy-load heavy dependencies

The bundle budget forbids pulling large libraries into the initial load.
uPlot is light enough to include; CodeMirror 6 and Three.js are **lazy-loaded
only when their feature is reached** (config editor, 3D views). Use dynamic
import with Solid's `lazy` for route/feature-level components:

```tsx
import { lazy } from "solid-js";
const ConfigEditor = lazy(() => import("./ConfigEditor")); // pulls in CM6
```

Wrap lazy components in `<Suspense>` with a lightweight fallback.

## Quick checklist before finishing a component

- No prop destructuring anywhere (params typed as `props: ...`).
- No `.map`, `&&`, ternaries, or early returns for reactive branching — use
  `<Show>`/`<For>/<Switch>`.
- Every signal/store read that should update the UI is inside JSX, a memo,
  or an effect.
- Object-model updates go through `setStore(..., reconcile(fresh))`.
- Any dependency over a few KB is behind `lazy()` + `<Suspense>`.
