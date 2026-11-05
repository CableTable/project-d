// Only the first user message identifies a Rook run; later messages may quote other sessions.
export function retroSessions(text, n) {
  for (const line of text.split(/\r?\n/)) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.type !== 'user') continue;
    const content = entry.message?.content;
    const first = typeof content === 'string' ? content : (Array.isArray(content) ? content : []).filter((c) => c?.type === 'text').map((c) => c.text).join('\n');
    if (!new RegExp(`resume-rook-S${n}[a-z]*\\b|runs${n}/resume-rook\\b`).test(first)) return null;
    return [...new Set(first.match(new RegExp(`\\bS${n}[a-z]*\\b`, 'g')) ?? [])];
  }
  return null;
}
