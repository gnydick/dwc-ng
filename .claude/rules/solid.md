---
status: 🟢
---
# Solid-specific rules

Moved 2026-09-02 from CLAUDE.md § Solid-specific rules (I will be reviewing for these);
history stays there. Gabe reviews for these.

## Solid-specific rules

- Never destructure props (kills reactivity). Use `props.x` or `splitProps`.
- Use `<Show>` / `<For>` / `<Switch>`, not early returns or `.map` in JSX.
- Signals and stores are accessed inside tracking scopes only.
