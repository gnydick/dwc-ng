---
status: 🟢
---
# Dependency policy

Moved 2026-09-02 from CLAUDE.md § Dependency policy (security); history stays there. Only
this project's concrete values are here; the policy itself is universal: machinery plugin:
rules/environment-and-platform.md § Dependencies.

## Dependency policy

- The settings that implement the policy live in `pnpm-workspace.yaml` and `package.json`,
  and these are their values: pnpm 10 or newer, with `packageManager` currently pinning
  `pnpm@11.3.0`; lifecycle build scripts blocked by default with `onlyBuiltDependencies`
  allowlisting `esbuild` and nothing else; `minimumReleaseAge: 4320` (refuse anything
  published less than three days ago); frozen-lockfile installs only.
- The owner whose explicit authorization a new dependency needs is Gabe, and it is asked
  for before the dependency is added, not after. Prefer zero-dependency or
  low-dependency packages.
