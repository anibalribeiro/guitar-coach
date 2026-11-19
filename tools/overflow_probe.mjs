// ---------- Overflow probe ----------
// Manual NAV-05 gate: no view (and no open More sheet) may scroll the page sideways at 360, 390,
// 768, 1024 or 1440px. CI has no Chrome, so this is run by hand before a release:
//
//   node tools/overflow_probe.mjs            (from the repository root)
//   CHROME=/path/to/chrome node tools/overflow_probe.mjs
//
// Dependency-free (Node 24 built-ins: fetch, WebSocket, child_process, net). It serves app/ with
// python3 on a free 127.0.0.1 port, drives a headless Chrome over the DevTools protocol on the
// port Chrome itself picks (read from DevToolsActivePort in a fresh temporary profile: a reused
// profile could answer from a cached service worker and measure an old shell, and a fixed port
// could attach to someone else's server or browser), and prints one JSON line per measurement.
// Exit 0 = clean, 1 = a positive scrollWidth - clientWidth somewhere, 2 = Chrome, the server or
// the app shell did not start. Both child processes and the temporary profile are always cleaned up.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const SEND_TIMEOUT_MS = 30000;
const WIDTHS = [360, 390, 768, 1024, 1440];
const VIEWS = ['today', 'practice', 'progress', 'library'];
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const children = [];
let profile = '';

function cleanup() {
  for (const child of children) { try { child.kill('SIGKILL'); } catch {} }
  if (profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  process.on(signal, () => { cleanup(); process.exit(code); });
}

// A port the OS just handed out on HOST, so the server never shares one with a stranger.
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, HOST, () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

// Resolves null when the child exits or fails to spawn: an early exit is a failed start, never a
// cue to fall through to whatever else answers on that port.
const exited = child => new Promise(resolve => { child.once('exit', () => resolve(null)); child.once('error', () => resolve(null)); });

// Chrome writes its chosen DevTools port as the first line of DevToolsActivePort in the profile.
async function devToolsPort(dir, ms) {
  const until = Date.now() + ms;
  const file = path.join(dir, 'DevToolsActivePort');
  while (Date.now() < until) {
    try {
      const port = Number(fs.readFileSync(file, 'utf8').split('\n')[0]);
      if (Number.isInteger(port) && port > 0) return port;
    } catch {}
    await sleep(150);
  }
  return null;
}
process.on('uncaughtException', e => { console.error(e.message); cleanup(); process.exit(2); });

// Poll a local URL until it answers, or give up after `ms`. The body is always read to the end:
// an unread body on a socket the server then closes trips an assertion inside Node's fetch.
async function waitFor(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(url, { headers: { connection: 'close' } });
      const body = await res.text();
      if (res.ok) return body;
    } catch {}
    await sleep(150);
  }
  return null;
}

// One DevTools session: numbered commands, and one-shot waiters for events.
function session(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let next = 0;
  const pending = new Map();
  const waiters = [];
  ws.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    } else if (msg.method) {
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].method === msg.method) { waiters[i].resolve(msg.params); waiters.splice(i, 1); }
      }
    }
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('DevTools socket error')), { once: true });
  });
  // A dead Chrome must fail the run, never hang it: every pending call rejects when the socket closes.
  ws.addEventListener('close', () => {
    for (const { reject } of pending.values()) reject(new Error('DevTools socket closed'));
    pending.clear();
  });
  return {
    opened,
    send(method, params = {}) {
      const id = ++next;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timed out waiting for ${method}`)); }, SEND_TIMEOUT_MS);
        const done = fn => value => { clearTimeout(timer); fn(value); };
        pending.set(id, { resolve: done(resolve), reject: done(reject) });
      });
    },
    once(method, ms = 15000) {
      return new Promise((resolve, reject) => {
        waiters.push({ method, resolve });
        setTimeout(() => reject(new Error(`timed out waiting for ${method}`)), ms);
      });
    },
    close() { try { ws.close(); } catch {} },
  };
}

// Runs in the page: the page-level overflow and up to five offenders outside .board-wrap.
const MEASURE = `(() => {
  const root = document.documentElement;
  const width = root.clientWidth;
  const diff = root.scrollWidth - width;
  const offenders = diff > 0 ? [...document.querySelectorAll('body *')].filter(el => {
    if (el.closest('.board-wrap')) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.right > width + 0.5;
  }).slice(0, 5).map(el => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '')) + ' right=' + Math.round(el.getBoundingClientRect().right)) : [];
  return { diff, offenders };
})()`;

async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
}

async function main() {
  const APP_PORT = await freePort();
  const server = spawn('python3', ['-m', 'http.server', String(APP_PORT), '--bind', HOST, '--directory', APP_DIR], { stdio: 'ignore' });
  children.push(server);
  const serving = await Promise.race([waitFor(`http://${HOST}:${APP_PORT}/`, 10000), exited(server)]);
  if (!serving) { console.error('The static server did not start on ' + APP_PORT + '.'); return 2; }

  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'overflow-probe-'));
  let chrome;
  try {
    chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--remote-debugging-address=${HOST}`,
      '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    children.push(chrome);
  } catch (e) { console.error(`Chrome did not start: ${e.message}. Set CHROME to its path.`); return 2; }
  const CDP_PORT = await Promise.race([devToolsPort(profile, 15000), exited(chrome)]);
  const started = CDP_PORT && await Promise.race([waitFor(`http://${HOST}:${CDP_PORT}/json/version`, 15000), exited(chrome)]);
  if (!started) { console.error('Chrome did not open its DevTools port. Set CHROME to its path.'); return 2; }

  const target = await (await fetch(`http://${HOST}:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const cdp = session(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  let overflow = false;
  let bootFailed = false;
  const report = row => { console.log(JSON.stringify(row)); if (row.diff > 0) overflow = true; };
  try {
    for (const width of WIDTHS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: width < 1024 });
      const loaded = cdp.once('Page.loadEventFired');
      await cdp.send('Page.navigate', { url: `http://${HOST}:${APP_PORT}/` });
      await loaded;
      await sleep(1500);
      const booted = await evaluate(cdp, `!document.getElementById('appShell')?.hidden`);
      // A shell that never shows is a failed start (exit 2), not an overflow.
      if (!booted) { bootFailed = true; console.log(JSON.stringify({ width, view: 'boot', error: '#appShell stayed hidden' })); continue; }
      for (const view of VIEWS) {
        const clicked = await evaluate(cdp, `(() => {
          const tab = [...document.querySelectorAll('[data-view="${view}"]')].find(el => el.offsetParent !== null);
          if (tab) tab.click();
          return !!tab;
        })()`);
        await sleep(300);
        const m = clicked ? await evaluate(cdp, MEASURE) : { diff: 1, offenders: ['no visible tab'] };
        report({ width, view, ...m });
      }
      await evaluate(cdp, `document.getElementById('moreBtn').click()`);
      await sleep(300);
      report({ width, view: 'more-sheet', ...await evaluate(cdp, MEASURE) });
      await evaluate(cdp, `document.getElementById('moreSheet').close()`);
    }
  } finally {
    cdp.close();
  }
  return bootFailed ? 2 : overflow ? 1 : 0;
}

let code = 2;
try { code = await main(); } catch (e) { console.error(e.message); code = 2; }
cleanup();
process.exit(code);
