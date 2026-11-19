// Pitch detector and capture-harness parity (fake getUserMedia, no permission prompt).
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, createPitchCapture, tunerReading } from '../app/src/pitch.js';
import { createFakeAudioContext, createFakeTimer, createFakeMediaStream } from './helpers/fakes.js';

const SR = 48000;

function sine(freq, amp = 0.5, length = 4096) {
  const buf = new Float32Array(length);
  for (let i = 0; i < length; i++) buf[i] = amp * Math.sin(2 * Math.PI * freq * i / SR);
  return buf;
}

function deterministicNoise(length = 4096) {
  let seed = 123456789;
  const buf = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    seed = (1103515245 * seed + 12345) % 2147483648;
    buf[i] = (seed / 2147483648 * 2 - 1) * 0.5;
  }
  return buf;
}

test('detects generated guitar frequencies within 1 Hz', () => {
  for (const freq of [82.4, 110, 440, 880]) {
    const got = detectPitch(sine(freq), SR);
    assert.ok(Math.abs(got - freq) < 1, `expected ${freq}, got ${got}`);
  }
});

test('silence and deterministic noise return the -1 sentinel', () => {
  assert.equal(detectPitch(new Float32Array(4096), SR), -1);
  assert.equal(detectPitch(deterministicNoise(), SR), -1);
});

test('the detector never returns 0, Infinity or NaN on degenerate signals (IN-08)', () => {
  const signals = [
    new Float32Array(4096).fill(0.5),
    new Float32Array(4096).fill(-0.25),
    sine(82.4, 0.5),
    sine(440, 0.9),
    deterministicNoise(),
  ];
  for (const buf of signals) {
    const freq = detectPitch(buf, SR);
    assert.ok(freq === -1 || (Number.isFinite(freq) && freq > 0), `got ${freq}`);
  }
});

test('the capture harness maps a non-finite detector result to the -1 sentinel (IN-08)', async () => {
  const ctx = createFakeAudioContext({ sampleRate: SR });
  const timer = createFakeTimer();
  const pitches = [];
  const capture = createPitchCapture({
    ctx,
    getUserMedia: async () => createFakeMediaStream(),
    timer,
    onPitch: (freq, midi) => pitches.push([freq, midi]),
  });
  await capture.start();
  capture.analyser.samples = new Float32Array(4096).fill(0.5);
  capture.tick();
  assert.deepEqual(pitches.at(-1), [-1, null]);
  capture.stop();
});

test('capture harness wires the analyser without a real permission prompt', async () => {
  const ctx = createFakeAudioContext({ sampleRate: SR });
  const timer = createFakeTimer();
  const stream = createFakeMediaStream();
  let constraints = null;
  const getUserMedia = async options => { constraints = options; return stream; };
  const pitches = [];
  const capture = createPitchCapture({ ctx, getUserMedia, timer, onPitch: (freq, midi) => pitches.push([freq, midi]) });

  await capture.start();
  assert.deepEqual(constraints, { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  assert.equal(capture.analyser.fftSize, 4096);
  assert.equal(ctx.created.mediaStreamSource[0].stream, stream);
  assert.deepEqual(ctx.created.mediaStreamSource[0].connections, [capture.analyser]);
  assert.equal([...timer.intervals.values()][0].ms, 45);

  capture.analyser.samples = sine(440);
  timer.tickInterval([...timer.intervals.keys()][0]);
  assert.ok(Math.abs(pitches[0][0] - 440) < 1);
  assert.equal(pitches[0][1], 69);

  capture.analyser.samples = new Float32Array(4096);
  capture.tick();
  assert.deepEqual(pitches[1], [-1, null]);

  capture.stop();
  assert.equal(timer.intervals.size, 0);
  assert.equal(stream.tracks[0].stopped, true);
  assert.equal(capture.analyser, null);
});

test('the tuner names the nearest note and the cents offset', () => {
  const a4 = tunerReading(440);
  assert.deepEqual(a4, { note: 'A', octave: 4, cents: 0, midi: 69 });
  const slightlySharp = tunerReading(440 * Math.pow(2, 10 / 1200));
  assert.equal(slightlySharp.note, 'A');
  assert.equal(slightlySharp.cents, 10);
  const flatE = tunerReading(82.41 * Math.pow(2, -20 / 1200));
  assert.equal(flatE.note, 'E');
  assert.equal(flatE.octave, 2);
  assert.equal(flatE.cents, -20);
  assert.equal(tunerReading(0), null);
  assert.equal(tunerReading(-1), null);
  assert.equal(tunerReading(Number.NaN), null);
});
