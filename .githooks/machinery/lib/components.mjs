// Which recorded components a commit touches — plan Task B2, owner answer 45: `components` in
// .claude/machinery/config.json maps a component name to a path prefix, and a staged path touches
// the component whose prefix it starts with. Prefix means path-segment prefix: `pkg-a` matches
// `pkg-a/src/x.txt` and never `pkg-ab/x.txt`. The mapping is read here and nowhere else; an
// unrecorded mapping throws readSetting's own error, which the hook turns into its refusal.
import { readSetting } from './settings.mjs';

const normalise = (p) => p.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');

export function componentsOf(root, stagedPaths) {
  const mapping = readSetting(root, 'components');
  const staged = stagedPaths.map(normalise);
  const touched = [];
  for (const [name, prefix] of Object.entries(mapping)) {
    const p = normalise(prefix);
    if (staged.some((s) => s === p || s.startsWith(p + '/'))) touched.push(name);
  }
  return touched;
}
