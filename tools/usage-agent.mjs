// Node 22; run from any directory. Importing this file does not start the agent.
import { createSign } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFileSync, closeSync, createReadStream, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { homedir, uptime } from 'node:os';
import { isLockStale, shouldRefresh } from './usage-agent-policy.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);

export function parseTickets(text, log = console.error) {
  const rows = [], notes = new Map();
  const redact = (text) => text.replace(/\b[A-Z]:[\\/][^\s\])}]+/gi, '(local path)');
  let note;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const heading = line.match(/^###\s+(T\d+)\b/);
    if (heading) { note = heading[1]; notes.set(note, []); }
    else if (/^#{1,3}\s/.test(line)) note = null;
    else if (note) notes.get(note).push(line);
    if (!/^\|\s*T\d+\s*\|/.test(line)) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((s) => s.trim().replace(/\\\|/g, '|'));
    if (cells.length !== 8) {
      log(`Skipping malformed ticket ${cells[0]}: expected eight columns, got ${cells.length}`);
      continue;
    }
    const [id, status, size, type, tags, title, todo, updated] = cells.map(redact);
    rows.push({ id, status, size, type, tags: [...new Set(tags.split(',').map((s) => s.trim()).filter(Boolean))], title, todo, updated });
  }
  return { rows: rows.map((row) => ({ ...row, note: redact((notes.get(row.id) || []).join('\n').trim()) })) };
}

const istDay = (time) => new Date(time + 19800e3).toISOString().slice(0, 10);
const tokenNumber = (n) => Number.isFinite(n) && n >= 0 ? n : 0;
function freshTokens(usage, codex = false) {
  return Math.max(0, tokenNumber(usage.input_tokens) - (codex ? tokenNumber(usage.cached_input_tokens) : 0))
    + tokenNumber(usage.output_tokens) + tokenNumber(usage.cache_creation_input_tokens ?? usage.cache_write_input_tokens);
}

// An async iterable lets the disk reader stream transcripts; arrays make the same tally easy to test.
export async function tallyTokens(records, now) {
  const days = Array.from({ length: 14 }, (_, i) => istDay(now - (13 - i) * 864e5));
  const totals = new Map(days.map((day) => [day, { day, Rook: 0, Bishop: 0, Knight: 0 }]));
  const messages = new Map(), sessions = new Map();
  for await (const { agent, session, event } of records) {
    const time = Date.parse(event.timestamp);
    if (!Number.isFinite(time) || time > now) continue;
    const day = istDay(time);
    if ((agent === 'Rook' || agent === 'Bishop') && event.type === 'assistant' && event.message?.usage) {
      const { id, usage } = event.message;
      if (!id) continue;
      const key = `${agent}|${id}|${event.requestId || ''}`;
      const tokens = freshTokens(usage), previous = messages.get(key);
      // Split assistant blocks repeat the message, sometimes with a later output-token count.
      if (!previous || tokens > previous.tokens) messages.set(key, { agent, day, tokens });
    } else if (agent === 'Knight' && event.payload?.type === 'token_count' && event.payload.info?.total_token_usage) {
      const total = freshTokens(event.payload.info.total_token_usage, true);
      let tokens = total - (sessions.get(session) || 0);
      if (tokens < 0) tokens = total; // A restarted counter begins a new run.
      sessions.set(session, total);
      if (totals.has(day)) totals.get(day).Knight += tokens;
    }
  }
  for (const { agent, day, tokens } of messages.values()) if (totals.has(day)) totals.get(day)[agent] += tokens;
  return { rows: [...totals.values()] };
}

export async function collectTokens(home = homedir(), now = Date.now()) {
  async function* walk(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) yield* walk(path);
      else if (entry.isFile() && path.endsWith('.jsonl') && (await stat(path)).mtimeMs >= now - 15 * 864e5) yield path;
    }
  }
  async function* records() {
    for (const [agent, directory] of [['Rook', '.claude/projects'], ['Bishop', '.claude-account2/projects'], ['Knight', '.codex/sessions']]) {
      for await (const path of walk(join(home, directory))) {
        const input = createReadStream(path, { encoding: 'utf8' });
        const lines = createInterface({ input, crlfDelay: Infinity });
        try {
          for await (const line of lines) {
            if (!line.includes('usage')) continue;
            let event;
            try { event = JSON.parse(line); } catch { continue; } // A running transcript may end mid-line.
            yield { agent, session: path, event };
          }
        } finally { lines.close(); input.destroy(); }
      }
    }
  }
  return tallyTokens(records(), now);
}

export function refreshFailure(error) {
  // Only the CLI's fixed summary crosses into Firestore; command output stays in the local log.
  const summary = String(error.stderr || '').match(/^USAGE_ERROR: (.+)$/m)?.[1];
  return summary && /^(?:(?:Rook|Bishop|Knight) usage probe failed, exit (?:\d+|unknown)|(?:Main|Second) account: 100%, limit reached)$/.test(summary)
    ? summary : 'Usage refresh failed; see the local agent log';
}

export function parseTodo(text) {
  const sections = [];
  let section, item;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const heading = line.match(/^#{2,6}\s+(.+)$/);
    const numbered = line.match(/^(\d+)\.\s+(.*)$/);
    if (heading) {
      section = { title: heading[1], items: [] };
      sections.push(section); item = null;
    } else if (section && numbered) {
      item = { num: Number(numbered[1]), body: numbered[2] };
      section.items.push(item);
    } else if (item && /^\s+\S/.test(line)) item.body += ' ' + line.trim();
    else if (line.trim()) item = null;
  }
  for (const section of sections) {
    const unique = new Map();
    section.items = section.items.map(({ num, body }) => {
      const done = /^✅\s*/u.test(body);
      body = body.replace(/^✅\s*/u, '');
      const bold = body.match(/\*\*(.+?)\*\*/);
      const title = bold ? bold[1] : body.split(/(?<=[.!?])\s|:\s|\s+\((?:S(?:[–-]M)?|M|L)\)/)[0];
      const size = body.match(/\((?:[^()]*,\s*)?(S(?:[–-]M)?|M|L)\)/)?.[1] || '';
      const text = body.replace(bold ? bold[0] : title, '').replace(/\*\*/g, '').replace(/^\s*:\s*/, '').replace(/\s{2,}/g, ' ').trim();
      const item = { num, title, size, done, text };
      if (!unique.get(num)?.done) unique.set(num, item);
      return item;
    }).filter((item) => unique.get(item.num) === item);
  }
  return { sections };
}

export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const records = [];
  let row = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field); field = ''; closed = false;
      if (c !== ',') {
        if (row.length > 1 || row[0] !== '') records.push(row);
        row = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
      }
    } else if (c === '"' && field === '' && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new Error('Invalid CSV quoting');
      field += c;
    }
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (field !== '' || row.length || closed) { row.push(field); records.push(row); }
  if (!records.length) return [];
  const headers = records.shift();
  if (headers.some((h) => !h) || new Set(headers).size !== headers.length) throw new Error('Invalid CSV headers');
  return records.map((r, i) => {
    if (r.length !== headers.length) throw new Error(`CSV row ${i + 2}: expected ${headers.length} columns, got ${r.length}`);
    return Object.fromEntries(headers.map((h, j) => [h, r[j]]));
  });
}

export function firestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date && Number.isFinite(+value)) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) {
    if (value.some(Array.isArray)) throw new Error('Firestore does not support nested arrays');
    return { arrayValue: { values: value.map(firestoreValue) } };
  }
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, firestoreValue(v)])) } };
  }
  throw new Error(`Unsupported Firestore value: ${String(value)}`);
}

export function assertKeyOutsideRepo(keyPath, repoPath = repo) {
  // Check both the written path and its real target, including junctions/symlinks.
  for (const real of [false, true]) {
    const key = real ? realpathSync(keyPath) : resolve(keyPath);
    const root = real ? realpathSync(repoPath) : resolve(repoPath);
    const rel = relative(root, key);
    if (rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))) {
      throw new Error('Refusing to start: Firebase key path is inside the repo folder. Move it to %APPDATA%\\ProjectD\\firebase-key.json.');
    }
  }
}

function acquireLock(path) {
  // Serialize stale-lock recovery too, so simultaneous starters cannot delete a new lock.
  const gate = path + '.guard';
  try { mkdirSync(gate); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    throw new Error(`Agent lock is being checked. If no agent is starting, remove the abandoned directory: ${gate}`);
  }
  try {
    if (existsSync(path)) {
      const mtimeMs = statSync(path).mtimeMs, bootTime = Date.now() - uptime() * 1000;
      if (!isLockStale(mtimeMs, bootTime)) {
        const pid = Number(readFileSync(path, 'utf8'));
        if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Invalid agent lock: ${path}; remove it after checking no agent is running.`);
        let stale = false;
        try { process.kill(pid, 0); }
        catch (e) { stale = isLockStale(mtimeMs, bootTime, e); }
        if (!stale) throw new Error(`Usage agent already running (pid ${pid}).`);
      }
      unlinkSync(path);
    }
    const fd = openSync(path, 'wx');
    writeFileSync(fd, String(process.pid)); closeSync(fd);
  } finally { rmdirSync(gate); }
  process.on('exit', () => {
    try { if (readFileSync(path, 'utf8') === String(process.pid)) unlinkSync(path); } catch { /* Already removed. */ }
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));
}

async function main() {
  if (!process.env.APPDATA) throw new Error('APPDATA is missing; run this agent on your Windows PC.');
  const home = join(process.env.APPDATA, 'ProjectD');
  mkdirSync(home, { recursive: true });
  const logPath = join(home, 'usage-agent.log');
  function log(message) {
    try {
      const line = `${new Date().toISOString()} ${message.replace(/[\r\n]+/g, ' ')}\n`;
      let old = '';
      try { if (statSync(logPath).size + Buffer.byteLength(line) > 1_000_000) old = readFileSync(logPath, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (old) {
        const tail = Buffer.from(old).subarray(-500_000).toString('utf8');
        writeFileSync(logPath, tail.slice(tail.indexOf('\n') + 1));
      }
      appendFileSync(logPath, line);
    } catch (e) { console.error(`Cannot write agent log: ${e.message}`); }
  }
  try {
    const keyPath = resolve(process.env.PROJECTD_FIREBASE_KEY || join(home, 'firebase-key.json'));
    assertKeyOutsideRepo(keyPath);
    const key = JSON.parse(readFileSync(keyPath, 'utf8'));
    if (key.type !== 'service_account' || !key.project_id || !key.client_email || !key.private_key) throw new Error('Expected a Firebase service-account JSON key.');
    acquireLock(join(home, 'usage-agent.lock'));
    const database = `projects/${encodeURIComponent(key.project_id)}/databases/(default)/documents`;
    const endpoint = `https://firestore.googleapis.com/v1/${database}`;
    let token = '', expires = 0;

    async function accessToken() {
      if (token && Date.now() < expires - 60_000) return token;
      const now = Math.floor(Date.now() / 1000);
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
        iss: key.client_email, scope: 'https://www.googleapis.com/auth/datastore',
        aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
      });
      const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', signal: AbortSignal.timeout(20_000),
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + signature }),
      });
      if (!response.ok) throw new Error(`OAuth token exchange: HTTP ${response.status}`);
      const data = await response.json();
      if (!data.access_token || !(data.expires_in > 0)) throw new Error('OAuth response missing token/expiry');
      token = data.access_token; expires = Date.now() + data.expires_in * 1000;
      return token;
    }

    async function request(suffix, body) {
      const response = await fetch(endpoint + suffix, {
        method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (response.status === 401) { token = ''; expires = 0; }
      if (response.status === 404 && !body) return null;
      if (!response.ok) throw new Error(`Firestore ${suffix}: HTTP ${response.status} ${(await response.text()).slice(0, 500)}`);
      return response.json();
    }
    const timestamp = (fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' });
    const statusWrite = (fields, data = {}) => ({
      update: { name: `${database}/usage/status`, fields: firestoreValue(data).mapValue.fields },
      updateMask: { fieldPaths: Object.keys(data) }, updateTransforms: fields.map(timestamp),
    });
    const heartbeat = () => request(':commit', { writes: [statusWrite(['agentHeartbeat'])] });
    let lastHandled = 0, nextRefresh = 0, nextHeartbeat = 0, busy = false;

    async function refresh(requestedAt) {
      busy = true;
      nextRefresh = Date.now() + 3600_000;
      try {
        const probe = await run(process.execPath, ['tools/rook.mjs', 'usage'], { cwd: repo, windowsHide: true, timeout: 180_000, maxBuffer: 1024 * 1024 });
        if (probe.stderr) log(`probe recovered: ${probe.stderr}`);
        const dataDir = join(repo, 'mockups', '_design', 'usage');
        const docs = ['limits', 'history', 'runs'].map((name) => {
          const path = join(dataDir, name + '.csv');
          let rows = name === 'runs' && !existsSync(path) ? [] : parseCsv(readFileSync(path, 'utf8'));
          if (name === 'history') rows = rows.slice(-2000);
          return [name, { rows }];
        });
        const analysisPath = join(dataDir, 'analysis.json');
        const items = existsSync(analysisPath) ? JSON.parse(readFileSync(analysisPath, 'utf8')) : [];
        if (!Array.isArray(items) || items.some((i) => !i || typeof i.id !== 'string' || typeof i.topic !== 'string' || typeof i.note !== 'string')) throw new Error('analysis.json must be an array of {id, topic, note} strings');
        docs.push(['analysis', { items }]);
        docs.push(['todo', parseTodo(readFileSync(join(repo, 'TODO.md'), 'utf8'))]);
        try { docs.push(['tickets', parseTickets(readFileSync(join(repo, '..', 'support', 'tickets.md'), 'utf8'), log)]); }
        catch (e) { if (e.code !== 'ENOENT') throw e; }
        docs.push(['tokens', await collectTokens()]);
        const writes = docs.map(([name, data]) => {
          const fields = firestoreValue(data).mapValue.fields;
          // shortcut: refuse oversized docs; split runs/analysis into pages if they outgrow one document.
          if (Buffer.byteLength(JSON.stringify(fields)) > 900_000) throw new Error(`${name} exceeds the safe document size (900 KB encoded)`);
          return { update: { name: `${database}/usage/${name}`, fields } };
        });
        writes.push(statusWrite(['lastUpdate', 'agentHeartbeat'], { lastError: '', lastErrorAt: null }));
        await request(':commit', { writes });
        log('refresh OK');
      } catch (e) {
        log(`refresh ERROR: ${e.stack || e.message}\n${e.stdout || ''}\n${e.stderr || ''}`);
        try {
          await request(':commit', { writes: [statusWrite(['lastErrorAt', 'agentHeartbeat'], { lastError: refreshFailure(e) })] });
        } catch (error) { log(`error status ERROR: ${error.message}`); }
      } finally { lastHandled = requestedAt; busy = false; }
    }

    console.log(`Usage agent running; log: ${logPath}`);
    for (;;) {
      const tick = Date.now();
      if (Date.now() >= nextHeartbeat) {
        nextHeartbeat = Date.now() + 60_000;
        heartbeat().catch((e) => log(`heartbeat ERROR: ${e.message}`));
      }
      try {
        const control = await request('/control/refresh');
        const value = control?.fields?.requestedAt?.timestampValue;
        const requestedAt = value ? Date.parse(value) : 0;
        if (shouldRefresh({ busy, now: Date.now(), nextRefresh, requestedAt, lastHandled })) void refresh(requestedAt);
      } catch (e) {
        log(`poll ERROR: ${e.message}`);
        if (!busy && Date.now() >= nextRefresh) void refresh(lastHandled);
      }
      await delay(Math.max(0, 10_000 - (Date.now() - tick)));
    }
  } catch (e) { log(`startup ERROR: ${e.message}`); throw e; }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((e) => { console.error(`Usage agent: ${e.message}`); process.exitCode = 1; });
}
