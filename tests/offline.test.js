import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../app/sw.js', import.meta.url), 'utf8');
function worker({ sourceText = source, stores = new Map(), fail = '', release = 'old' } = {}) {
  const listeners = {};
  const base = 'http://localhost:8765/coach/sw.js';
  const keyOf = value => new URL(typeof value === 'string' ? value : value.url, base).href;
  const caches = {
    async keys() { return [...stores.keys()]; },
    async delete(key) { return stores.delete(key); },
    async open(key) {
      if (!stores.has(key)) stores.set(key, new Map());
      const entries = stores.get(key);
      return {
        async addAll(urls) {
          if (urls.some(url => url.includes(fail) && fail)) throw new Error('network interrupted');
          for (const url of urls) entries.set(keyOf(url), release + ':' + url);
        },
        async put(request, response) { entries.set(keyOf(request), await response.text()); },
        async add(url) { entries.set(keyOf(url), release + ':' + url); },
        async match(request) { const body = entries.get(keyOf(request)); return body ? new Response(body) : undefined; },
      };
    },
    async match(request) { for (const key of stores.keys()) { const response = await (await this.open(key)).match(request); if (response) return response; } },
  };
  const self = { location: new URL(base), registration: { scope: 'http://localhost:8765/coach/' }, clients: { claim: async () => {} }, skipWaiting: async () => {}, addEventListener: (name, fn) => { listeners[name] = fn; } };
  vm.runInNewContext(sourceText, { self, caches, URL, fetch: async () => new Response('NETWORK:' + release) });
  return {
    stores,
    async install() { let done; listeners.install({ waitUntil: p => { done = p; } }); await done; },
    async activate() { let done; listeners.activate({ waitUntil: p => { done = p; } }); await done; },
    async read(path, mode = 'cors', destination = 'script') {
      let response; listeners.fetch({ request: { url: new URL(path, base).href, method: 'GET', mode, destination }, respondWith: p => { response = p; }, waitUntil() {} });
      return (await response).text();
    },
  };
}

test('a controlled shell reads every file from one installed release', async () => {
  const w = worker(); await w.install(); await w.activate();
  assert.equal(await w.read('./index.html', 'navigate', 'document'), 'old:./index.html');
  assert.equal(await w.read('./src/main.js'), 'old:./src/main.js');
});

test('a failed shell install leaves the prior release available', async () => {
  const old = worker(); await old.install();
  const next = worker({ stores: old.stores, sourceText: source.replace(/v\d+/, 'v999'), fail: 'main.js', release: 'new' });
  await assert.rejects(next.install(), /network interrupted/);
  assert.equal(await old.read('./src/main.js'), 'old:./src/main.js');
});

test('activation preserves another application cache', async () => {
  const stores = new Map([['another-app', new Map()]]);
  const w = worker({ stores }); await w.install(); await w.activate();
  assert.equal(stores.has('another-app'), true);
});

test('recovery unregisters and clears only this app scope', async () => {
  const bootstrap = fs.readFileSync(new URL('../app/bootstrap.js', import.meta.url), 'utf8');
  let recover;
  const unregistered = [];
  const deleted = [];
  const prefix = 't2coach:' + encodeURIComponent('/coach/') + ':';
  const registrations = ['/coach/', '/another/'].map(path => ({ scope: 'http://localhost:8765' + path, unregister: async () => { unregistered.push(path); } }));
  vm.runInNewContext(bootstrap, {
    URL,
    localStorage: { getItem: () => null },
    document: {
      readyState: 'complete', baseURI: 'http://localhost:8765/coach/index.html', documentElement: { dataset: {} },
      getElementById: id => id === 'recoverApp' ? { addEventListener: (type, callback) => { recover = callback; } } : null,
    },
    navigator: { serviceWorker: { getRegistrations: async () => registrations } },
    caches: { keys: async () => [prefix + 'v23', 'other-app', 't2coach:%2Fanother%2F:v23'], delete: async key => { deleted.push(key); } },
    location: { reload() {} },
    addEventListener() {},
  });
  await recover();
  assert.deepEqual(unregistered, ['/coach/']);
  assert.deepEqual(deleted, [prefix + 'v23']);
});
