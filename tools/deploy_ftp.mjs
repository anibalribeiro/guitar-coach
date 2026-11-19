// ---------- FTPS deploy ----------
// Mirrors the git-tracked files of app/ into <FTP_DIR>/<FTP_TARGET> on a shared host over
// FTPS with certificate verification. Only that one folder is written or pruned; everything
// else on the host is left alone. Credentials come from the environment (GitHub secrets in CI).
//
//   FTP_HOST=... FTP_USER=... FTP_PASS=... [FTP_DIR=public_html] [FTP_TARGET=guitar-coach] \
//     node tools/deploy_ftp.mjs
//
// Needs `basic-ftp` resolvable (CI installs it with `npm install --no-save basic-ftp@6.2.1`).
import { Client } from 'basic-ftp';
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(REPO, 'app');

const missing = ['FTP_HOST', 'FTP_USER', 'FTP_PASS'].filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Missing ${missing.join(', ')}. Set them as repository secrets or in the environment.`);
  process.exit(1);
}
const ROOT = process.env.FTP_DIR || 'public_html';
const TARGET = process.env.FTP_TARGET || 'guitar-coach';
if (!/^[a-z0-9][a-z0-9._-]*$/i.test(TARGET)) {
  console.error(`Refusing FTP_TARGET "${TARGET}": use one plain folder name.`);
  process.exit(1);
}

// Tracked files only, so local-only media never leaves the machine. The shell goes last:
// modules and media land before the page and worker that reference them.
const LAST = ['sw.js', 'index.html'];
const files = execFileSync('git', ['-C', REPO, 'ls-files', 'app'], { encoding: 'utf8' })
  .trim().split('\n').map(p => p.slice('app/'.length))
  .sort((a, b) => LAST.indexOf(a) - LAST.indexOf(b));

async function listRecursive(client, dir) {
  const found = [];
  for (const entry of await client.list(dir).catch(() => [])) {
    if (entry.name === '.' || entry.name === '..') continue;
    const child = `${dir}/${entry.name}`;
    if (entry.isDirectory) found.push(...(await listRecursive(client, child)));
    else if (entry.isFile) found.push(child);
  }
  return found;
}

const client = new Client(60_000);
try {
  await client.access({ host: process.env.FTP_HOST, user: process.env.FTP_USER, password: process.env.FTP_PASS, secure: true });
  await client.cd(ROOT);
  const base = await client.pwd();
  const home = async () => { await client.cd(base); };

  for (const file of files) {
    await home();
    const dir = dirname(file);
    await client.ensureDir(dir === '.' ? TARGET : `${TARGET}/${dir}`);
    await client.uploadFrom(join(APP, file), file.split('/').pop());
  }
  await home();
  console.log(`uploaded:  ${files.length} files to ${base}/${TARGET}`);

  // A single client runs one task at a time, so these stay sequential.
  const wanted = new Set(files.map(f => `${TARGET}/${f}`));
  const stale = (await listRecursive(client, TARGET)).filter(p => !wanted.has(p));
  for (const path of stale) { await client.remove(path); console.log(`  - pruned ${path}`); }
  console.log(`pruned:    ${stale.length} stale file(s)`);

  const bad = [];
  for (const file of files) {
    const size = await client.size(`${TARGET}/${file}`).catch(() => -1);
    if (size !== statSync(join(APP, file)).size) bad.push(file);
  }
  if (bad.length) throw new Error(`${bad.length} file(s) did not match after upload: ${bad.join(', ')}`);
  console.log(`verified:  all ${files.length} files match local size`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.close();
}
