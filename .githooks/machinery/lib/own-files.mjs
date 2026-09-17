// Machinery's own files in an adopting project — STATUS decision 51 (amended 2026-09-14): the one
// spelling of machinery's own files, read by install.mjs (what it stages) and by tiers.mjs (what a
// commit may stage and still be exempt from the tiers/components refusal, because none of it is code
// a test could cover). Two lists would drift; test/tiers.test.mjs pins the install's staged set to
// a subset of this one and names the entries another script writes (config.json: setup.mjs).
// Entries are paths relative to the project root, POSIX-separated: a file, or a directory whose
// whole tree is machinery's.
import { INBOX, SPEC_INBOX, DOCS_DIR, SPECS_DIR, MACHINERY_DIR, RULES_DIR, CONFIG } from './layout.mjs';
import { isObsolete } from './migrations.mjs';

export const MACHINERY_OWN = Object.freeze([
  `.claude/${RULES_DIR}`,
  `${DOCS_DIR}/${SPECS_DIR}`,
  `.claude/${MACHINERY_DIR}/${INBOX}`,
  `.claude/${MACHINERY_DIR}/${SPEC_INBOX}`,
  `.claude/${MACHINERY_DIR}/tool-catalog.json`,
  `.claude/${MACHINERY_DIR}/${CONFIG}`,
  '.gitignore',
  '.githooks',
]);

// True when a staged path (as git prints it: POSIX, root-relative) is one of machinery's own — the
// current list, or a file an older plugin wrote that a migrated install has staged as removed (#107).
export const isOwnFile = (p) => MACHINERY_OWN.some((e) => p === e || p.startsWith(e + '/')) || isObsolete(p);
