// Synthetic microphone material for the score and mic suites: deterministic Float32Array
// envelopes and fixed pitch frames at fixed audio timestamps. Nothing here reads a clock,
// a device or Math.random, so every onset count in the tests is exact and repeatable.
export const FIXTURE_SR = 48000;
// One analyser frame at SCORE.rmsWindow: 1024 samples ≈ 21.33 ms at 48 kHz.
export const BLOCK = 1024;
export const BLOCK_MS = (BLOCK / FIXTURE_SR) * 1000;
// pitch.js sets analyser.fftSize = 4096: one poll reads this many samples.
export const FULL_FRAME = 4096;

export const secondsToSamples = seconds => Math.round(seconds * FIXTURE_SR);
export const msToSamples = ms => Math.round((ms / 1000) * FIXTURE_SR);
export const hzOf = midi => 440 * Math.pow(2, (midi - 69) / 12);

// A square wave, so the RMS of a full block is exactly the amplitude.
const tone = (length, amplitude, phase = 0) => {
  const buf = new Float32Array(Math.max(0, Math.round(length)));
  for (let i = 0; i < buf.length; i++) buf[i] = (i + phase) % 2 ? -amplitude : amplitude;
  return buf;
};

export function silence(length = BLOCK) {
  return new Float32Array(Math.max(0, Math.round(length)));
}

// A single attack: the whole block is the tone, so the first frame is a rising edge.
export function attack({ amplitude = 0.2, length = BLOCK } = {}) {
  return tone(length, amplitude);
}

// Two attacks `gapMs` apart, measured from the start of one burst to the start of the
// next: 200 ms is outside the refractory window, 40 ms is inside it.
export function doubleAttack({ amplitude = 0.2, gapMs = 200, burstMs = 60 } = {}) {
  const burst = Math.max(1, msToSamples(burstMs));
  const start = Math.max(burst, msToSamples(gapMs));
  const buf = new Float32Array(start + burst);
  buf.set(tone(burst, amplitude), 0);
  buf.set(tone(burst, amplitude, 1), start);
  return buf;
}

// A constant-amplitude sustain: one attack, then a level that never rises again.
export function sustain({ amplitude = 0.2, seconds = 2 } = {}) {
  return tone(secondsToSamples(seconds), amplitude);
}

// A fixed pitch frame at a known MIDI value. Full analyser length, so the tail window and
// the whole frame read the same tone.
export function pitch(midi, { amplitude = 0.3, length = FULL_FRAME, sr = FIXTURE_SR } = {}) {
  const buf = new Float32Array(length);
  const hz = hzOf(midi);
  for (let i = 0; i < length; i++) buf[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sr);
  return buf;
}

// One loud analyser frame of the length a real poll reads.
export function analyserFrame({ amplitude = 0.5, length = FULL_FRAME } = {}) {
  return tone(length, amplitude);
}

// Fixed pitch frames at fixed audio timestamps: no clock, no detector, no drift.
export const PITCH_FRAMES = [
  { atMs: 1000, midi: 60 }, // C4
  { atMs: 1250, midi: 64 }, // E4
  { atMs: 1500, midi: 67 }, // G4
  { atMs: 2000, midi: 72 }, // C5
];

export function pitchFrames(list = PITCH_FRAMES) {
  return list.map(entry => ({ atMs: entry.atMs, midi: entry.midi, block: pitch(entry.midi) }));
}

// Slice a long envelope into the blocks one poll reads, each stamped with its audio time.
export function framesOf(envelope, { block = BLOCK, sr = FIXTURE_SR } = {}) {
  const frames = [];
  for (let offset = 0; offset + block <= envelope.length; offset += block) {
    frames.push({ atMs: (offset / sr) * 1000, block: envelope.slice(offset, offset + block) });
  }
  return frames;
}
