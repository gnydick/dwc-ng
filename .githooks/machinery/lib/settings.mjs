// The project's recorded settings — plan Task B1 (recalibration decisions 22, 39, 41; owner answers
// 45–47). One declaration of every key: which setup item asks for it, what it accepts, and its
// default where one exists. No default other than `worktree` (decision 39): reading an unrecorded
// key stops and names the `/machinery:setup <item>` to run.
import fs from 'node:fs';
import path from 'node:path';
import { MACHINERY_DIR, CONFIG } from './layout.mjs';

export const KEYS = Object.freeze({
  worktree: { item: 'worktree', accepts: ['always', 'multi-commit', 'never'], default: 'always' },
  // Component name → path prefix; `tiers.fast` runs on the components a staged path starts with (owner 45).
  components: { item: 'tiers', mapping: true },
  // Build/format checks, run by the pre-commit before `tiers.fast` (owner 46).
  'checks.commit': { item: 'tiers' },
  'tiers.declaration': { item: 'tiers' },
  'tiers.fast': { item: 'tiers', placeholder: '<components>' },
  'tiers.merge': { item: 'tiers' },
  'tiers.heavy': { item: 'tiers' },
  'tiers.assignment': { item: 'tiers', accepts: ['ask-per-test', 'propose-per-commit', 'claude-decides'] }, // owner 47
  comparisonAgent: { item: 'comparison-agent' },
  comparisonPaths: { item: 'comparison-agent', list: true },
  reviewBeforeMain: { item: 'review', accepts: ['no-review', 'person', 'agent', 'person-and-agent'] },
});
export const configFile = (root) => path.join(root, '.claude', MACHINERY_DIR, CONFIG);
const or = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} or ${a.at(-1)}` : a[0]);
const at = (doc, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);

function load(root) {
  const file = configFile(root);
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`${file}: not valid JSON (${e.message}) — fix or delete the file, then run /machinery:setup`); }
}

export function validate(key, values) {
  const spec = KEYS[key];
  if (!spec) throw new Error(`${key}: not a setting — use ${or(Object.keys(KEYS))}`);
  if (spec.list) {
    if (!values.length || values.some((v) => !v.trim())) throw new Error(`${key}: give one or more non-empty values`);
    return values;
  }
  if (spec.mapping) {
    if (!values.length) throw new Error(`${key}: give one or more <name>=<path prefix> pairs`);
    const mapping = {};
    for (const v of values) {
      const eq = v.indexOf('=');
      const name = eq > 0 ? v.slice(0, eq).trim() : '';
      const prefix = eq > 0 ? v.slice(eq + 1).trim() : '';
      if (!name || !prefix) throw new Error(`${key}: '${v}' is not <name>=<path prefix> — give one pair per component`);
      mapping[name] = prefix;
    }
    return mapping;
  }
  const value = values.join(' ').trim();
  if (!value) throw new Error(`${key}: an empty value records nothing`);
  if (spec.accepts && !spec.accepts.includes(value)) throw new Error(`${key}: '${value}' is not accepted — use ${or(spec.accepts)}`);
  if (spec.placeholder && !value.includes(spec.placeholder)) throw new Error(`${key}: '${value}' has no ${spec.placeholder} placeholder — write the command with ${spec.placeholder} where the component names go`);
  return value;
}

export function setSetting(root, key, values) {
  const value = validate(key, values);
  const doc = load(root);
  const parts = key.split('.');
  let node = doc;
  for (const p of parts.slice(0, -1)) node = node[p] ??= {};
  node[parts.at(-1)] = value;
  fs.mkdirSync(path.dirname(configFile(root)), { recursive: true });
  fs.writeFileSync(configFile(root), JSON.stringify(doc, null, 2) + '\n', 'utf8');
  return value;
}

export function recorded(root, key) { return at(load(root), key); }

export function readSetting(root, key) {
  const v = recorded(root, key);
  if (v !== undefined) return v;
  if ('default' in KEYS[key]) return KEYS[key].default;
  throw new Error(`${key} is not recorded in .claude/machinery/config.json — run /machinery:setup ${KEYS[key].item}`);
}

// One rendering of a recorded value for `show`: a list joins with `, `, a mapping as `name=prefix` pairs.
export function render(value) {
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return Object.entries(value).map(([k, v]) => `${k}=${v}`).join(', ');
  return String(value);
}
