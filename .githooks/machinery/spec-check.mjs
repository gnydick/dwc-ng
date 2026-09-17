import path from 'node:path';
import fs from 'node:fs';
import { parseInbox } from './lib/inbox.mjs';
import { report } from './lib/report.mjs';
import { filedPath, insideSpecArea } from './lib/layout.mjs';

// Ticket #81. Before this, a specification dictated with SPEC: was captured by nothing, addressed to
// a location no code could resolve, and blocked nothing — rung 0, and the symptom the owner reported
// (other projects not treating the location as durable) is what rung 0 looks like from outside. This
// leg is the third part: a pending spec entry blocks, and a disposition naming a path outside the
// project's spec area is refused.
//
// The honest limit, restated so nobody claims more later: WHICH specification file owns a given
// subsystem is a judgement no check can make. What is mechanised here is that a filed path lives
// under the declared spec area, and that nothing stays pending.
export const declaration = Object.freeze({
  id: 'spec_check',
  run: 'specCheck',
  blocking: true,
  wired: true,
});

const toPosix = (p) => p.split(path.sep).join('/');

// {specsDir, specInbox, root} → true if it passes. Never writes (spec I23). The spec index and its
// comparison are gone (recalibration decision 10).
export function specCheck({ specsDir, specInbox, root }) {
  let ok = true;
  let entries = [];
  try { entries = fs.existsSync(specInbox) ? parseInbox(fs.readFileSync(specInbox, 'utf8')) : []; }
  catch (e) { report('spec_check', 1, 1, `spec inbox malformed — ${e.message}`); return false; }

  const pend = entries.filter((e) => e.state === 'PENDING');
  report('spec_check', pend.length, entries.length, `spec inbox entr${entries.length === 1 ? 'y' : 'ies'} undispositioned (must be 0)`);
  if (pend.length) {
    // A refusal names the inbox and the one fix, and offers no bypass (recalibration decision 3).
    process.stdout.write(`commit refused: ${pend.length} pending entr${pend.length === 1 ? 'y' : 'ies'} in ${toPosix(path.relative(root, specInbox))} — run /machinery:rule-process\n`);
    ok = false;
  }

  // There is deliberately no "spec area missing" leg. The location is FIXED and known — owner,
  // 2026-09-07: "we just need a unique location to persist those specs", then "i don't want specs
  // under .claude/rules i want docs/dicatated-specs" — so there is no declaration to be absent and
  // nothing for a project to get wrong. A docs/dictated-specs that does not exist yet is a project
  // that has filed no specification, not a misconfiguration.
  const filed = entries.filter((e) => e.state === 'FILED');
  const outside = filed.filter((e) => { const p = filedPath(e.disposition); return p === null || !insideSpecArea(root, specsDir, p); });
  report('spec_check', outside.length, filed.length, `filed spec path(s) outside ${toPosix(path.relative(root, specsDir))}/`);
  const area = `${toPosix(path.relative(root, specsDir))}/`;
  for (const e of outside) process.stdout.write(`commit refused: ${e.stamp} is filed at ${filedPath(e.disposition) ?? e.disposition}, outside ${area} — dismiss it with disposition.mjs --dismissed or file it under ${area}\n`);
  if (outside.length) ok = false;
  return ok;
}
