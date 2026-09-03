import { git } from './lib/git.mjs';
// Ported from sweep_guard.sh. ADVISORY: never affects the outcome; silent when nothing to say.
const DOCS = /^(CLAUDE\.md$|docs\/|\.claude\/rules\/|\.claude\/machinery\/)/;
const TOOLING = /^(scripts\/|\.githooks\/)/;
export function sweepGuard({ root }) {
  const staged = git(['diff', '--cached', '--name-only'], root).stdout.split('\n').filter(Boolean);
  const added = git(['diff', '--cached', '--diff-filter=A', '--name-only'], root).stdout.split('\n').filter(Boolean);
  const suspects = added.filter((f) => !DOCS.test(f));
  if (!suspects.length) return;
  if (!staged.some((f) => DOCS.test(f))) return;
  const addedSet = new Set(added);
  const others = staged.filter((f) => !addedSet.has(f) && !DOCS.test(f) && !TOOLING.test(f));
  if (others.length) return;
  process.stdout.write(`ADVISORY: sweep-guard denominator: ${staged.length} staged, ${added.length} newly-tracked, ${suspects.length} non-doc suspect(s).\n`);
  for (const f of suspects) process.stdout.write(`ADVISORY: docs commit stages a newly-tracked non-doc file: ${f} - confirm not swept by a wildcard git add.\n`);
}
