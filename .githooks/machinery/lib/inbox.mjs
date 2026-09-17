// Story: hooks/rule-capture.md (entry shape) and skills/rule-intake (dispositions). Parse, don't validate (spec I8).
import fs from 'node:fs';
import path from 'node:path';

// SPEC joined the marks in #81 (owner ruling, 2026-09-07: "make spec: work just like rules"). One
// entry shape, one parser, one disposition contract — a spec entry is a rule entry in every respect
// but which inbox it lands in and which gate leg reads it.
const HEAD = /^## (PENDING|FILED|DISMISSED) (\S+) (PRULE|URULE|SPEC) (\S+)\s*$/;
const DISP = /^disposition: (.*)$/;

export function parseInbox(text) {
  const lines = text.split(/\r?\n/), entries = [];
  for (let i = 0; i < lines.length; i++) {
    const m = HEAD.exec(lines[i]);
    if (!m) continue;
    let j = i + 1, disposition = null, body = [];
    while (j < lines.length && !HEAD.test(lines[j])) {
      const d = DISP.exec(lines[j]);
      if (d) { disposition = d[1]; j++; break; }
      body.push(lines[j]); j++;
    }
    if (disposition === null) throw new Error(`malformed inbox: entry at line ${i + 1} has no disposition line`);
    const bodyText = body.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
    entries.push({ state: m[1], stamp: m[2], marker: m[3], session: m[4], text: bodyText, disposition, start: i, end: j });
    i = j - 1;
  }
  return entries;
}

// The entry shape, spelled once: appendEntry writes it, and a caller that must know before writing
// whether an entry will read back (scripts/issue-tracking.mjs record-project) formats it the same way.
export const newStamp = (date = new Date()) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
export const formatEntry = ({ stamp, marker, text, session }) => `\n## PENDING ${stamp} ${marker} ${session}\n\n${text.trim()}\n\ndisposition: PENDING\n`;

export function appendEntry(file, { marker, text, session, stamp = newStamp() }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, formatEntry({ stamp, marker, text, session }), 'utf8');
  return { state: 'PENDING', stamp, marker, session, text: text.trim(), disposition: 'PENDING' };
}

export function setDisposition(file, stamp, { state, detail }) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const entries = parseInbox(lines.join('\n'));
  const e = entries.find((x) => x.stamp === stamp);
  if (!e) throw new Error(`no inbox entry with stamp ${stamp}`);
  lines[e.start] = lines[e.start].replace(/^## \w+/, `## ${state}`);
  lines[e.end - 1] = `disposition: ${detail}`;
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
}

export function pending(file) {
  if (!fs.existsSync(file)) return [];
  return parseInbox(fs.readFileSync(file, 'utf8')).filter((e) => e.state === 'PENDING');
}
