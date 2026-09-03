// Rule identity = file § section (union: rules/rule-governance.md § Where a rule lives). Parse, don't validate.
const STATUSES = new Set(['🟢', '🟡', '🔴']);

function parseFrontmatter(lines) {
  if (lines[0]?.trim() !== '---') return { meta: { status: '🟢', supersedes: [] }, body: lines };
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new Error('frontmatter never closes');
  const meta = { status: '🟢', supersedes: [] };
  let cur = null;
  for (const raw of lines.slice(1, end)) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if ((m = /^status:\s*(\S+)$/.exec(line))) { if (!STATUSES.has(m[1])) throw new Error(`unknown status '${m[1]}' (🟢|🟡|🔴)`); meta.status = m[1]; }
    else if (/^supersedes:\s*$/.test(line)) cur = 'supersedes';
    else if (cur === 'supersedes' && (m = /^\s+-\s+section:\s*(.+)$/.exec(line))) meta.supersedes.push({ section: m[1].trim(), by: null, date: null });
    else if (cur === 'supersedes' && (m = /^\s+by:\s*(.+)$/.exec(line))) meta.supersedes.at(-1).by = m[1].trim();
    else if (cur === 'supersedes' && (m = /^\s+date:\s*(\S+)$/.exec(line))) meta.supersedes.at(-1).date = m[1];
    else if (line.trim()) throw new Error(`unrecognised frontmatter line: ${line}`);
  }
  for (const s of meta.supersedes) if (!s.by || !s.date) throw new Error(`supersedes entry for '${s.section}' needs by and date`);
  return { meta, body: lines.slice(end + 1) };
}

export function parseRuleFile(text, name) {
  const { meta, body } = parseFrontmatter(text.split(/\r?\n/));
  const sections = [];
  let inFence = false;
  for (const line of body) {
    if (line.startsWith('```')) inFence = !inFence;
    if (inFence) continue;
    const h = /^## (.+)$/.exec(line);
    if (h) { sections.push({ heading: h[1].trim(), rules: 0 }); continue; }
    if (/^- /.test(line) && sections.length) sections.at(-1).rules++;
  }
  return { name, status: meta.status, supersedes: meta.supersedes, sections, rules: sections.reduce((n, s) => n + s.rules, 0) };
}
