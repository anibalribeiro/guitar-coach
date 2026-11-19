// The microphone adapter: permission states, the one stop path and one poll's two events.
// Every device seam is injected, so no permission prompt and no real audio are involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MIC_STATES, createMic, micWindowStep } from '../app/src/mic.js';
import { SCORE, outputTimeMs, tapOffsetMs } from '../app/src/score.js';
import { createFakeAudioContext, createFakeMediaStream, createFakeTimer } from './helpers/fakes.js';
import { analyserFrame, pitch } from './fixtures/mic.js';

// A capture stub with the shape pitch.js returns: one analyser and a start/stop pair.
function stubCapture({ frame = analyserFrame() } = {}) {
  const calls = [];
  const stub = {
    calls,
    startCount: 0,
    stopCount: 0,
    onPitch: null,
    analyser: {
      getFloatTimeDomainData(target) { target.set(frame.subarray(0, target.length)); },
    },
    async start() { stub.startCount++; return stub; },
    stop() { stub.stopCount++; },
  };
  const factory = options => {
    calls.push(options);
    stub.onPitch = options.onPitch;
    return stub;
  };
  return { factory, stub };
}

test('MIC_STATES is the seven-state vocabulary in order', () => {
  assert.deepEqual(MIC_STATES, ['off', 'requesting', 'on', 'listening', 'calibrating', 'denied', 'unavailable']);
});

test('a granted permission arms the mic and reaches on', async () => {
  const stream = createFakeMediaStream();
  const states = [];
  const mic = createMic({
    ctx: createFakeAudioContext(),
    getUserMedia: async () => stream,
    timer: createFakeTimer(),
    onState: state => states.push(state),
  });
  assert.equal(mic.state, 'off');
  assert.equal(await mic.arm(), 'on');
  assert.deepEqual(states, ['requesting', 'on']);
});

test('a denied permission is a state, not a throw', async () => {
  const mic = createMic({
    ctx: createFakeAudioContext(),
    getUserMedia: () => Promise.reject(new Error('denied')),
    timer: createFakeTimer(),
  });
  await assert.doesNotReject(async () => { await mic.arm(); });
  assert.equal(mic.state, 'denied');
});

test('a missing mediaDevices reports unavailable instead of throwing', async () => {
  const mic = createMic({ ctx: createFakeAudioContext() });
  await assert.doesNotReject(async () => { await mic.arm(); });
  assert.equal(mic.state, 'unavailable');
});

test('a capture that throws on start reports denied and closes what it built', async () => {
  const { factory, stub } = stubCapture();
  const mic = createMic({
    ctx: createFakeAudioContext(),
    getUserMedia: async () => createFakeMediaStream(),
    capture: options => { factory(options); throw new Error('no device'); },
  });
  assert.equal(await mic.arm(), 'denied');
  assert.equal(mic.state, 'denied');
  assert.equal(stub.startCount, 0);

  const failing = createMic({
    ctx: createFakeAudioContext(),
    getUserMedia: async () => createFakeMediaStream(),
    capture: () => ({
      analyser: null,
      async start() { throw new Error('device busy'); },
      stop() { stub.stopCount++; },
    }),
  });
  assert.equal(await failing.arm(), 'denied');
  assert.equal(stub.stopCount, 1, 'a partially built capture is stopped');
});

test('the capture is built with the shared poll interval and the injected timer', async () => {
  const ctx = createFakeAudioContext({ sampleRate: 48000 });
  const timer = createFakeTimer();
  const stream = createFakeMediaStream();
  const events = [];
  const mic = createMic({
    ctx,
    getUserMedia: async () => stream,
    timer,
    now: () => 500,
    onEvent: event => events.push(event),
  });

  assert.equal(await mic.arm(), 'on');
  const [handle] = [...timer.intervals.keys()];
  assert.equal([...timer.intervals.values()][0].ms, SCORE.pollMs, 'one poll is SCORE.pollMs');
  assert.equal(ctx.created.analyser[0].fftSize, 4096);

  mic.startListening();
  ctx.created.analyser[0].samples = pitch(69); // A4 440 Hz: an attack and a note
  timer.tickInterval(handle);
  assert.deepEqual(events.map(event => event.type), ['onset', 'pitch']);
  assert.equal(events[0].atMs, 500);
  assert.equal(events[1].midi, 69);

  mic.stop();
  assert.equal(timer.intervals.size, 0, 'no timer survives stop()');
  assert.equal(stream.tracks[0].stopped, true, 'no track survives stop()');
  assert.equal(mic.state, 'off');
});

test('stop() stops every track and returns to off', async () => {
  const ctx = createFakeAudioContext({ sampleRate: 48000 });
  const timer = createFakeTimer();
  const stream = createFakeMediaStream();
  stream.tracks.push({ stopped: false, stop() { this.stopped = true; } });
  const mic = createMic({ ctx, getUserMedia: async () => stream, timer });
  await mic.arm();
  mic.startListening();
  mic.stop();
  assert.equal(stream.tracks.length, 2);
  for (const track of stream.tracks) assert.equal(track.stopped, true);
  assert.equal(mic.state, 'off');
});

test('startListening opens the window and stopListening closes it', async () => {
  const { factory } = stubCapture();
  const mic = createMic({ ctx: {}, getUserMedia: async () => ({}), capture: factory });
  assert.equal(mic.startListening(), 'off', 'a poll window needs an armed mic');
  await mic.arm();
  assert.equal(mic.startListening(), 'listening');
  assert.equal(mic.stopListening(), 'on');
  assert.equal(mic.stopListening(), 'on', 'closing a closed window is a no-op');
});

test('calibrate and endCalibration move on to calibrating and back', async () => {
  const { factory } = stubCapture();
  const mic = createMic({ ctx: {}, getUserMedia: async () => ({}), capture: factory });
  assert.equal(mic.calibrate(), 'off', 'calibration needs an armed mic');
  await mic.arm();
  assert.equal(mic.calibrate(), 'calibrating');
  assert.equal(mic.endCalibration(), 'on');
  assert.equal(mic.endCalibration(), 'on');
});

test('disarm stops the device and returns to off', async () => {
  const stream = createFakeMediaStream();
  const timer = createFakeTimer();
  const mic = createMic({ ctx: createFakeAudioContext(), getUserMedia: async () => stream, timer });
  await mic.arm();
  mic.startListening();
  mic.disarm();
  assert.equal(mic.state, 'off');
  assert.equal(stream.tracks[0].stopped, true);
  assert.equal(timer.intervals.size, 0);
});

test('one poll emits one onset and one pitch event at the audio time', async () => {
  const { factory, stub } = stubCapture({ frame: analyserFrame({ amplitude: 0.5 }) });
  const events = [];
  const mic = createMic({
    ctx: {},
    getUserMedia: async () => ({}),
    capture: factory,
    now: () => 1234,
    onEvent: event => events.push(event),
  });

  await mic.arm();
  assert.equal(stub.calls[0].intervalMs, SCORE.pollMs, 'the capture polls at SCORE.pollMs');
  assert.equal(typeof stub.calls[0].getUserMedia, 'function', 'the injected request is forwarded, not called');
  assert.equal(stub.calls[0].now, undefined, 'the capture keeps its own clock');

  mic.startListening();
  stub.onPitch(440, 69);
  assert.deepEqual(events.map(event => event.type), ['onset', 'pitch']);
  assert.equal(events[0].atMs, 1234);
  assert.ok(Math.abs(events[0].rms - 0.5) < 1e-6);
  assert.deepEqual(events[1], { type: 'pitch', atMs: 1234, midi: 69, freq: 440 });
});

test('nothing is emitted outside a listening window or after the stream stops', async () => {
  const { factory, stub } = stubCapture({ frame: analyserFrame({ amplitude: 0.5 }) });
  const events = [];
  const mic = createMic({
    ctx: {}, getUserMedia: async () => ({}), capture: factory, now: () => 1000,
    onEvent: event => events.push(event),
  });

  await mic.arm();
  stub.onPitch(440, 69);
  assert.equal(events.length, 0, 'an armed but closed window scores nothing');

  mic.startListening();
  stub.onPitch(440, 69);
  assert.equal(events.length, 2);

  mic.stop();
  stub.onPitch(440, 69);
  assert.equal(events.length, 2, 'a stopped stream cannot score');
});

test('a detector miss emits an onset without a pitch event, and never throws', async () => {
  const { factory, stub } = stubCapture();
  const events = [];
  const mic = createMic({
    ctx: {}, getUserMedia: async () => ({}), capture: factory, now: () => 0,
    onEvent: event => events.push(event),
  });
  await mic.arm();
  mic.startListening();
  stub.onPitch(-1, null);
  assert.deepEqual(events.map(event => event.type), ['onset']);

  // A throwing consumer must not take the adapter (or the pass) down with it.
  mic.startListening();
  const throwing = createMic({
    ctx: {}, getUserMedia: async () => ({}), capture: stubCapture().factory,
    onEvent: () => { throw new Error('consumer'); },
  });
  await throwing.arm();
  throwing.startListening();
  assert.doesNotThrow(() => throwing.stop());
});

// ---------- The listening window across a pass boundary (CR-01) ----------
test('a pass boundary re-arms the stream before the next window opens', () => {
  // The count-in of a later pass: the stream a boundary closed is re-armed there, so the
  // first active beat is already listening instead of silently unscored.
  assert.equal(micWindowStep({ streamWanted: true, windowWanted: false, open: false, state: 'off' }), 'arm');
  assert.equal(micWindowStep({ streamWanted: true, windowWanted: true, open: false, state: 'off' }), 'arm');
  // Once armed, the count-in holds and the first active frame opens the window.
  assert.equal(micWindowStep({ streamWanted: true, windowWanted: false, open: false, state: 'on' }), 'idle');
  assert.equal(micWindowStep({ streamWanted: true, windowWanted: true, open: false, state: 'on' }), 'open');
  // An open, listening window is left alone; a window whose stream died is torn down.
  assert.equal(micWindowStep({ streamWanted: true, windowWanted: true, open: true, state: 'listening' }), 'idle');
  assert.equal(micWindowStep({ streamWanted: true, windowWanted: true, open: true, state: 'on' }), 'close');
  // The adapter already listening is adopted rather than opened twice.
  assert.equal(micWindowStep({ streamWanted: true, windowWanted: true, open: false, state: 'listening' }), 'idle');
});

test('a denied, absent or requesting device is never re-asked and a parked pass closes', () => {
  for (const state of ['denied', 'unavailable', 'requesting', 'calibrating']) {
    assert.equal(micWindowStep({ streamWanted: true, windowWanted: true, open: false, state }), 'idle', state);
    assert.equal(micWindowStep({ streamWanted: true, windowWanted: false, open: false, state }), 'idle', state);
  }
  // No pass wants the stream: an open window is closed, a closed one is left alone.
  assert.equal(micWindowStep({ streamWanted: false, windowWanted: false, open: true, state: 'listening' }), 'close');
  assert.equal(micWindowStep({ streamWanted: false, windowWanted: false, open: false, state: 'on' }), 'idle');
  assert.equal(micWindowStep({}), 'idle', 'the default is no decision');
});

test('a re-armed adapter reaches listening again on the second pass', async () => {
  const ctx = createFakeAudioContext({ sampleRate: 48000 });
  const timer = createFakeTimer();
  const stream = createFakeMediaStream();
  const mic = createMic({ ctx, getUserMedia: async () => stream, timer });
  // Pass 1: armed, then the boundary tears the stream down.
  await mic.arm();
  mic.startListening();
  assert.equal(mic.state, 'listening');
  mic.stop();
  assert.equal(mic.state, 'off');
  // Pass 2: the boundary step says arm, and the same adapter can listen again.
  assert.equal(micWindowStep({ streamWanted: true, windowWanted: true, open: false, state: mic.state }), 'arm');
  await mic.arm();
  assert.equal(mic.state, 'on');
  assert.equal(micWindowStep({ streamWanted: true, windowWanted: true, open: false, state: mic.state }), 'open');
  assert.equal(mic.startListening(), 'listening');
  assert.equal(micWindowStep({ streamWanted: true, windowWanted: true, open: true, state: mic.state }), 'idle');
});

// ---------- The calibration clock bridge (D-48, T-03-15) ----------
// `main.audioTimeOf` reads the context's output timestamp and hands the pair to the pure
// bridge; these two cases pin what the tap resolves to with and without that pair.
const audioTimeOf = (ctx, perfNow) => outputTimeMs(
  typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null,
  perfNow,
  ctx.currentTime,
);

test('a tap is placed on the audio clock through the output timestamp', () => {
  const ctx = createFakeAudioContext({ currentTime: 3, outputTimestamp: { contextTime: 4, performanceTime: 2000 } });
  // 600 ms after the timestamp's performance time is 600 ms after its context time.
  assert.equal(audioTimeOf(ctx, 2600), 4600);
  const t0 = 4, spb = 0.6667;
  const offset = tapOffsetMs(audioTimeOf(ctx, 2600), t0, spb, {});
  assert.ok(offset !== null, 'the bridged tap lands on the click grid');
  assert.ok(Math.abs(offset - (4600 - (t0 + spb) * 1000)) < 1e-9, 'the nearest click is click 1');
});

test('the bridge falls back to currentTime when the context reports no timestamp', () => {
  const missing = createFakeAudioContext({ currentTime: 5 });
  assert.equal(typeof missing.getOutputTimestamp, 'undefined', 'this fake cannot report a pair');
  assert.equal(audioTimeOf(missing, 2600), 5000, 'the fallback is the context clock in milliseconds');
  assert.equal(tapOffsetMs(audioTimeOf(missing, 2600), 5, 0.6667, {}), 0, 'a tap on click zero is a zero offset');

  // Browsers that answer with an all-zero pair cannot be trusted either: zeros are the
  // documented "not available" value, so the same fallback applies.
  const zeros = createFakeAudioContext({ currentTime: 5, outputTimestamp: { contextTime: 0, performanceTime: 0 } });
  assert.deepEqual(zeros.getOutputTimestamp(), { contextTime: 0, performanceTime: 0 });
  assert.equal(audioTimeOf(zeros, 2600), 5000);
  zeros.setOutputTimestamp(null);
  assert.equal(typeof zeros.getOutputTimestamp, 'undefined');
  assert.equal(audioTimeOf(zeros, 2600), 5000);
});

test('a tap outside the click grid is dropped instead of clamped', () => {
  const ctx = createFakeAudioContext({ currentTime: 5 });
  const t0 = 5.9;
  // A press before the first click is not a sample, so one early tap cannot move the median.
  assert.equal(tapOffsetMs(audioTimeOf(ctx, 5000), t0, 0.6667, {}), null);
  // Once the clock reaches the grid the same press lands on click zero.
  ctx.currentTime = 5.9;
  assert.equal(tapOffsetMs(audioTimeOf(ctx, 6800), t0, 0.6667, {}), 0, 'a tap on click zero is a zero offset');
  // A tap 900 ms from the nearest click on a slow grid is a stray, not a sample.
  assert.equal(tapOffsetMs(t0 * 1000 + 900, t0, 2, {}), null);
});

