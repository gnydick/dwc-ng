// Migration of an adopting project's machinery layout — #107 (owner, 2026-09-15: "Updated installs
// have to handle migration"). A project keeps whatever its last install wrote; when a later plugin
// version stops writing a file, the file stays behind, tracked or not, and the old gate copy beside
// it keeps naming remedies the plugin no longer ships (ferrislicer: "run /machinery:reindex").
//
// THE ONE PLACE: every file a past version wrote and the current one does not is listed here, with
// the versions that wrote it, so an install from any older version reaches the current layout in
// one run. A future removal adds its entry here and nowhere else. Nothing of the developer's own is
// ever named: each entry is a file only machinery wrote.
//
// Read by install.mjs (which runs the migration and reports each step) and by own-files.mjs (a
// staged removal of one of these is machinery's own, exempt from the tiers/components refusal
// exactly as the current own files are).
import fs from 'node:fs';
import path from 'node:path';

// Paths relative to the project root, POSIX-separated.
export const OBSOLETE = Object.freeze([
  { path: '.claude/machinery/INDEX.md', wroteBy: '0.1.37–0.1.99', why: 'generated rules index; the register and its reindex went in the September 2026 recalibration (decision 10)' },
  { path: '.claude/machinery/RULES_INDEX.md', wroteBy: '0.1.100–0.1.114', why: 'generated rules index (renamed from INDEX.md by #81); gone with the recalibration (decision 10)' },
  { path: '.claude/machinery/SPEC_INDEX.md', wroteBy: '0.1.10x–0.1.114', why: 'generated spec index; gone with the recalibration (decision 10)' },
  { path: 'docs/dictated-specs/SPEC_INDEX.md', wroteBy: '0.1.100', why: 'generated spec index at its first location (#81 moved it); gone with the recalibration (decision 10)' },
]);

export const isObsolete = (p) => OBSOLETE.some((o) => o.path === p);

// Removes every obsolete file from disk and, where tracked, from the git index (staged as a
// removal, so the next commit carries it). `git(args, cwd)` is lib/git.mjs's runner. Returns one
// step per file that was on disk or tracked: { path, wroteBy, why, tracked }. A file neither on
// disk nor tracked is not a step, so a second run returns [] and changes nothing.
export function migrate(root, git) {
  const steps = [];
  for (const o of OBSOLETE) {
    const abs = path.join(root, ...o.path.split('/'));
    const tracked = git(['ls-files', '--error-unmatch', '--', o.path], root).code === 0;
    const onDisk = fs.existsSync(abs);
    if (!tracked && !onDisk) continue;
    if (tracked) {
      const rm = git(['rm', '--cached', '--quiet', '--', o.path], root);
      if (rm.code !== 0) throw new Error(`migration: git rm --cached ${o.path} failed: ${rm.stderr}`);
    }
    if (onDisk) fs.rmSync(abs, { force: true });
    steps.push({ ...o, tracked });
  }
  return steps;
}
