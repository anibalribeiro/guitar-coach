// Test doubles for the browser seams. No production module may import this file.
export function createFakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const writes = [];
  return {
    map,
    writes,
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { writes.push({ key, value: String(value) }); map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    dump() { return Object.fromEntries(map); },
  };
}

// Storage that can fail either seam on demand; the existing fake's defaults are untouched.
export function createThrowingStorage(initial = {}, { failGet = false, failSet = true } = {}) {
  const inner = createFakeStorage(initial);
  return {
    map: inner.map,
    writes: inner.writes,
    getItem(key) {
      if (failGet) throw new Error('storage unreadable');
      return inner.getItem(key);
    },
    setItem(key, value) {
      if (failSet) throw new Error('storage quota exceeded');
      inner.setItem(key, value);
    },
    removeItem(key) { inner.removeItem(key); },
    dump() { return inner.dump(); },
  };
}

// Fixed clock for the progress model: every function under test takes `now`.
export function createFakeClock(start = 0) {
  let current = start;
  return {
    now() { return current; },
    advance(ms) { current += Number(ms) || 0; return current; },
    set(ms) { current = Number(ms) || 0; return current; },
  };
}

export function createFakeLedSink() {
  const frames = [];
  return {
    frames,
    send(frame) { frames.push(Uint8Array.from(frame)); },
    last() { return frames.length ? frames[frames.length - 1] : null; },
    clear() { frames.length = 0; },
  };
}

export function createFakeCharacteristic(uuid) {
  const listeners = [];
  return {
    uuid,
    writes: [],
    notificationsStarted: false,
    async writeValueWithoutResponse(frame) { this.writes.push(Uint8Array.from(frame)); },
    addEventListener(type, fn) { if (type === 'characteristicvaluechanged') listeners.push(fn); },
    async startNotifications() { this.notificationsStarted = true; },
    emit(bytes) {
      const value = new DataView(Uint8Array.from(bytes).buffer);
      for (const fn of listeners) fn({ target: { value } });
    },
    emitView(value) {
      for (const fn of listeners) fn({ target: { value } });
    },
  };
}

// Fake T2 GATT peripheral: connect/getPrimaryService/getCharacteristic/notify plus a
// disconnect dispatcher that fires 'gattserverdisconnected' like Web Bluetooth does.
export function createFakeGattDevice({ name = 'poputar T2', address = 'fake-t2' } = {}) {
  const deviceListeners = new Map();
  const write = createFakeCharacteristic(0xdc86);
  const notify = createFakeCharacteristic(0xffa3);
  const service = {
    uuid: 0xffa0,
    async getCharacteristic(uuid) {
      if (uuid === 0xdc86) return write;
      if (uuid === 0xffa3) return notify;
      throw new Error(`Unknown characteristic: ${uuid}`);
    },
  };
  const device = {
    name,
    address,
    write,
    notify,
    requestedServices: [],
    gatt: {
      connected: false,
      async connect() {
        this.connected = true;
        return {
          async getPrimaryService(uuid) {
            device.requestedServices.push(uuid);
            if (uuid === 0xffa0) return service;
            throw new Error(`Unknown service: ${uuid}`);
          },
        };
      },
      disconnect() {
        this.connected = false;
        device.dispatch('gattserverdisconnected');
      },
    },
    addEventListener(type, fn) {
      if (!deviceListeners.has(type)) deviceListeners.set(type, []);
      deviceListeners.get(type).push(fn);
    },
    dispatch(type, event = {}) {
      for (const fn of deviceListeners.get(type) || []) fn(event);
    },
  };
  return device;
}

export function createFakeParam(value = 0) {
  return {
    value,
    ramps: [],
    // Scheduled values and ramps are recorded separately from `setTargetAtTime`'s `ramps`, so
    // every existing "no extra re-attack" assertion keeps its meaning. A scheduled value is not
    // the current value: only `setTargetAtTime` moves `.value`, which is what a gain reads.
    values: [],
    linRamps: [],
    expRamps: [],
    setTargetAtTime(target, time, constant) {
      this.value = target;
      this.ramps.push({ target, time, constant });
    },
    setValueAtTime(target, time) {
      this.values.push({ target, time });
    },
    linearRampToValueAtTime(target, time) {
      this.linRamps.push({ target, time });
    },
    exponentialRampToValueAtTime(target, time) {
      this.expRamps.push({ target, time });
    },
  };
}

function createFakeNode(kind) {
  const node = {
    kind,
    connections: [],
    connect(target) { node.connections.push(target); return target; },
    disconnect() { node.connections.length = 0; },
  };
  return node;
}

// Fake AudioContext recording every node and connection the audio engine makes. A context
// may also report an output timestamp — the calibration bridge reads it to place a
// `performance.now()` tap on the audio clock — and a context built without one models the
// browsers that cannot report a pair (the call falls back to `currentTime`).
export function createFakeAudioContext({ sampleRate = 8000, currentTime = 0, outputTimestamp = null } = {}) {
  const created = { gain: [], buffer: [], bufferSource: [], oscillator: [], biquad: [], compressor: [], analyser: [], mediaStreamSource: [] };
  const ctx = {
    sampleRate,
    currentTime,
    state: 'running',
    destination: createFakeNode('destination'),
    created,
    createGain() {
      const n = createFakeNode('gain');
      n.gain = createFakeParam(1);
      created.gain.push(n);
      return n;
    },
    createBuffer(channels, length, sr) {
      const data = new Float32Array(length);
      const buf = { numberOfChannels: channels, length, sampleRate: sr, data, getChannelData: () => data };
      created.buffer.push(buf);
      return buf;
    },
    createBufferSource() {
      const n = createFakeNode('bufferSource');
      n.buffer = null;
      n.startCalls = [];
      n.stopCalls = [];
      n.start = when => n.startCalls.push(when);
      n.stop = when => n.stopCalls.push(when);
      created.bufferSource.push(n);
      return n;
    },
    createOscillator() {
      const n = createFakeNode('oscillator');
      n.type = 'sine';
      n.frequency = createFakeParam(440);
      n.startCalls = [];
      n.stopCalls = [];
      n.start = when => n.startCalls.push(when);
      n.stop = when => n.stopCalls.push(when);
      created.oscillator.push(n);
      return n;
    },
    createBiquadFilter() {
      const n = createFakeNode('biquad');
      n.type = 'lowpass';
      n.frequency = createFakeParam(350);
      created.biquad.push(n);
      return n;
    },
    // The limiter sits between the summed stems and the master gain; the five parameters are
    // the compressor's own AudioParams and `reduction` is a plain read-only float in the spec.
    createDynamicsCompressor() {
      const n = createFakeNode('compressor');
      n.threshold = createFakeParam(-24);
      n.knee = createFakeParam(30);
      n.ratio = createFakeParam(12);
      n.attack = createFakeParam(0.003);
      n.release = createFakeParam(0.25);
      n.reduction = 0;
      created.compressor.push(n);
      return n;
    },
    createAnalyser() {
      const n = createFakeNode('analyser');
      n.fftSize = 2048;
      n.samples = null;
      n.getFloatTimeDomainData = target => {
        if (n.samples) target.set(n.samples.subarray(0, target.length));
        else target.fill(0);
      };
      created.analyser.push(n);
      return n;
    },
    createMediaStreamSource(stream) {
      const n = createFakeNode('mediaStreamSource');
      n.stream = stream;
      created.mediaStreamSource.push(n);
      return n;
    },
    resume() { ctx.state = 'running'; return Promise.resolve(); },
  };
  // `setOutputTimestamp(null)` removes the method again, so one fake covers "the browser
  // reports a pair", "it reports zeros" and "it has nothing to report".
  ctx.setOutputTimestamp = value => {
    if (value) ctx.getOutputTimestamp = () => ({ ...value });
    else delete ctx.getOutputTimestamp;
    return ctx;
  };
  if (outputTimestamp) ctx.setOutputTimestamp(outputTimestamp);
  return ctx;
}

export function createFakeTimer() {
  let nextId = 0;
  const intervals = new Map(), timeouts = new Map();
  return {
    intervals,
    timeouts,
    setInterval(fn, ms) { intervals.set(++nextId, { fn, ms }); return nextId; },
    clearInterval(handle) { intervals.delete(handle); },
    setTimeout(fn, ms) { timeouts.set(++nextId, { fn, ms }); return nextId; },
    clearTimeout(handle) { timeouts.delete(handle); },
    tickInterval(handle) { intervals.get(handle)?.fn(); },
  };
}

export function createFakeBluetooth({ device = null, known = [], availability = true } = {}) {
  return {
    device,
    known,
    availability,
    requests: [],
    async getAvailability() { return this.availability; },
    async requestDevice(options) { this.requests.push(options); return this.device; },
    async getDevices() { return this.known; },
  };
}

// Fake Screen Wake Lock navigator surface: it records every request, hands back a sentinel whose
// own `release()` is recorded, and can be told to refuse on demand. `request` is async, so a
// second synchronous call is genuinely a second frame before the first promise settles — which
// is exactly the "one in-flight request, one sentinel" invariant. No browser is touched.
export function createFakeWakeLock({ rejectWith = null } = {}) {
  const calls = [];
  const sentinels = [];
  return {
    calls,
    sentinels,
    get sentinelCount() { return sentinels.length; },
    get sentinel() { return sentinels.length ? sentinels[sentinels.length - 1] : null; },
    get sentinelReleases() { return sentinels.filter(s => s.released).length; },
    wakeLock: {
      async request(type) {
        calls.push(type);
        if (rejectWith) throw rejectWith;
        const sentinel = {
          type,
          released: false,
          addEventListener() {},
          async release() { sentinel.released = true; },
        };
        sentinels.push(sentinel);
        return sentinel;
      },
    },
  };
}

export function createFakeMediaStream() {
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  return { tracks, getTracks() { return tracks; } };
}
