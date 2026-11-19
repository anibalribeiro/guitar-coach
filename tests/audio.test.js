// SC5 fake-AudioContext smoke test: pluck and root drone are wired through one master gain;
// the backing band is four stem gains summed behind one limiter into that same master (D-56),
// and its five synthesized voices each land on their own stem and stop every node they start.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio, STEMS } from '../app/src/audio.js';
import { backingEvents } from '../app/src/backing.js';
import { createFakeAudioContext } from './helpers/fakes.js';

// The stem plane is identified by topology, never by creation index (PATTERNS F4): every stem
// gain feeds the one bus, the bus feeds the one limiter and the limiter feeds the master.
function stemPlane(ctx, audio) {
  const limiter = ctx.created.compressor[0];
  assert.ok(limiter, 'the graph has one limiter');
  const bus = ctx.created.gain.find(g => g !== audio.master && g.connections.length === 1 && g.connections[0] === limiter);
  assert.ok(bus, 'the stems sum into one bus that feeds the limiter');
  const gains = ctx.created.gain.filter(g => g !== bus && g !== audio.master && g.connections.length === 1 && g.connections[0] === bus);
  assert.equal(gains.length, 4, 'exactly four stem gains');
  // Creation order is the only external signal for the stems' names, and it follows STEMS.
  const stems = Object.fromEntries(STEMS.map((name, i) => [name, gains[i]]));
  return { limiter, bus, gains, stems };
}

// The drone gain carries the one 0.06 attack ramp; the stem gains carry 1s and the click's own
// gain carries 0.14/0.22, so the ramp target is the finder, not the creation index.
const droneGainOf = ctx => ctx.created.gain.find(g => g.gain.ramps[0] && g.gain.ramps[0].target === 0.06);

test('pluck creates a buffer source through a gain into the master gain', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  const { bus } = stemPlane(ctx, audio);
  const src = audio.pluck(45, 1.25);

  assert.ok(src);
  assert.equal(ctx.created.bufferSource.length, 1);
  assert.ok(src.buffer, 'buffer source must have a generated buffer');
  assert.deepEqual(src.startCalls, [1.25]);

  const pluckGain = ctx.created.gain.find(g => g.connections.includes(audio.master) && g.gain.value === 0.35);
  assert.ok(pluckGain, 'pluck must create its own gain');
  assert.equal(pluckGain.gain.value, 0.35);
  assert.deepEqual(src.connections, [pluckGain]);
  assert.deepEqual(pluckGain.connections, [audio.master]);
  // The reference note is not a stem and is deliberately not limited.
  assert.ok(!pluckGain.connections.includes(bus), 'the pluck bypasses the stem bus');
  assert.deepEqual(audio.master.connections, [ctx.destination]);
});

test('pluck caches one Karplus-Strong buffer per MIDI note', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  audio.pluck(40);
  audio.pluck(40);
  audio.pluck(45);
  assert.equal(ctx.created.buffer.length, 2);
  assert.equal(ctx.created.bufferSource.length, 3);
});

// IN-05: `pluck` stays outside the stem plane and the limiter on purpose, but it is still a
// scheduled source: it stops at the end of its own buffer, so every node in the graph has an
// explicit `stop` and none outlives its sound.
test('pluck stops its source at the end of its own buffer (IN-05)', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  const src = audio.pluck(45, 2);
  assert.deepEqual(src.startCalls, [2]);
  assert.equal(src.stopCalls.length, 1, 'one stop, exactly like every backing voice');
  assert.ok(src.stopCalls[0] > src.startCalls[0], 'the stop is after the start');
  assert.equal(src.stopCalls[0], 2 + src.buffer.length / ctx.sampleRate, 'the stop is the buffer end');
  // The reference note is still not a stem and still bypasses the limiter.
  const { bus } = stemPlane(ctx, audio);
  assert.ok(!src.connections.some(node => node === bus), 'the pluck bypasses the stem bus');
});

test('setSound gates pluck without touching the drone', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  audio.setSound(false);
  assert.equal(audio.pluck(40), null);
  assert.equal(ctx.created.bufferSource.length, 0);
  audio.setSound(true);
  audio.setDrone(true, 0);
  assert.ok(audio.pluck(40));
  assert.equal(ctx.created.oscillator.length, 3);
});

test('drone creates three oscillators through a lowpass into the master gain', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  audio.setDrone(true, 9);

  assert.equal(ctx.created.oscillator.length, 3);
  assert.equal(ctx.created.biquad.length, 1);
  const lp = ctx.created.biquad[0];
  assert.equal(lp.type, 'lowpass');
  assert.equal(lp.frequency.value, 700);
  assert.deepEqual(ctx.created.oscillator.map(o => o.connections[0]), [lp, lp, lp]);
  assert.deepEqual(ctx.created.oscillator.map(o => o.type), ['sawtooth', 'sawtooth', 'sawtooth']);

  const droneGain = droneGainOf(ctx);
  assert.ok(droneGain, 'the drone gain carries the 0.06 attack');
  assert.notEqual(droneGain, audio.master);
  assert.deepEqual(lp.connections, [droneGain]);
  assert.deepEqual(droneGain.connections, [audio.master]);
  assert.equal(droneGain.gain.ramps[0].target, 0.06);

  // A root drone is root, fifth and octave of the selected pitch class (A2 = 110 Hz).
  assert.ok(Math.abs(ctx.created.oscillator[0].frequency.value - 110) < 0.01);
  assert.ok(Math.abs(ctx.created.oscillator[1].frequency.value - 165) < 0.01);
  assert.ok(Math.abs(ctx.created.oscillator[2].frequency.value - 220.33) < 0.01);
});

test('setDrone(false) ramps the drone gain down and stops all three oscillators', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  audio.setDrone(true, 0);
  const droneGain = droneGainOf(ctx);
  audio.setDrone(false);

  assert.equal(droneGain.gain.value, 0);
  assert.equal(droneGain.gain.ramps.at(-1).target, 0);
  for (const osc of ctx.created.oscillator) assert.equal(osc.stopCalls.length, 1);
  assert.equal(ctx.created.oscillator.length, 3);

  audio.setDrone(false);
  assert.equal(ctx.created.oscillator.length, 3, 'stopping an absent drone is a no-op');
});

test('setDrone keeps the running stack when the request is unchanged (WR-05)', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  audio.setDrone(true, 9);
  const droneGain = droneGainOf(ctx);

  audio.setDrone(true, 9);
  audio.setDrone(true, 21); // same pitch class as 9
  audio.setDrone(true, -3); // same pitch class again
  assert.equal(ctx.created.oscillator.length, 3, 'an unchanged drone must not rebuild');
  assert.equal(ctx.created.biquad.length, 1);
  assert.equal(droneGain.gain.ramps.length, 1, 'no extra re-attack ramp');
  for (const osc of ctx.created.oscillator) assert.equal(osc.stopCalls.length, 0);

  audio.setDrone(true, 10);
  assert.equal(ctx.created.oscillator.length, 6, 'a new root does rebuild');
  assert.equal(ctx.created.biquad.length, 2);
});

test('click creates a short unpitched noise tick with an accent and sound gating', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  const { limiter, bus, stems } = stemPlane(ctx, audio);
  const normal = audio.click(1.5, false);
  const accent = audio.click(2.5, true);

  assert.ok(normal && accent);
  assert.equal(ctx.created.bufferSource.length, 2);
  assert.equal(ctx.created.oscillator.length, 0);
  assert.equal(normal.connections[0].type, 'highpass');
  assert.equal(accent.connections[0].type, 'highpass');
  assert.deepEqual(normal.stopCalls, [1.515]);
  assert.deepEqual(accent.stopCalls, [2.515]);

  // click -> its own gain -> the click stem -> the bus -> the limiter -> the master -> out.
  assert.deepEqual(normal.connections[0].connections[0].connections, [stems.click]);
  assert.deepEqual(accent.connections[0].connections[0].connections, [stems.click]);
  assert.deepEqual(stems.click.connections, [bus]);
  assert.deepEqual(bus.connections, [limiter]);
  assert.deepEqual(limiter.connections, [audio.master]);
  assert.deepEqual(audio.master.connections, [ctx.destination]);

  audio.setSound(false);
  assert.equal(audio.click(3, false), null);
  assert.equal(ctx.created.bufferSource.length, 2);
});

test('muteForPause and restore ramp the master gain', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  ctx.currentTime = 4;
  audio.muteForPause();
  assert.equal(audio.master.gain.ramps.at(-1).target, 0);
  audio.restore();
  assert.equal(audio.master.gain.ramps.at(-1).target, 1);
});

// ---------- 03-03 Task 1: one gain owner with three targets (T-03-14) ----------
test('setMonitor writes full, ducked and silent targets through the one master gain', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  const gainCount = ctx.created.gain.length;

  audio.setMonitor({ listening: true });
  assert.equal(audio.master.gain.ramps.at(-1).target, 0.1, 'a listening pass sits at 10%');
  audio.setMonitor({ paused: true });
  assert.equal(audio.master.gain.ramps.at(-1).target, 0, 'a paused pass is silent');
  audio.setMonitor({});
  assert.equal(audio.master.gain.ramps.at(-1).target, 1, 'everything else is full');
  audio.setMonitor();
  assert.equal(audio.master.gain.ramps.at(-1).target, 1, 'the default argument restores');
  audio.setMonitor({ paused: true, listening: true });
  assert.equal(audio.master.gain.ramps.at(-1).target, 0, 'pause wins over ducking');

  assert.equal(ctx.created.gain.length, gainCount, 'setMonitor never creates a second gain');
  for (const ramp of audio.master.gain.ramps) assert.equal(ramp.constant, 0.02);
});

test('muteForPause and restore are setMonitor under their original names', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  ctx.currentTime = 4;
  audio.muteForPause();
  assert.deepEqual(audio.master.gain.ramps.at(-1), { target: 0, time: 4, constant: 0.02 });
  audio.restore();
  assert.deepEqual(audio.master.gain.ramps.at(-1), { target: 1, time: 4, constant: 0.02 });
});

// ---------- 04-01 Task 1: four stems, one summing bus, one limiter, one mix writer ----------
test('the stem plane is built once: four stem gains, one summing bus and one limiter', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  const { limiter, bus, gains } = stemPlane(ctx, audio);

  // Six nodes join the master at construction: four stem gains, one bus and one limiter.
  assert.equal(ctx.created.gain.length, 6, 'master + four stem gains + the summing bus');
  assert.equal(ctx.created.compressor.length, 1, 'one limiter for the whole band');
  assert.deepEqual(bus.connections, [limiter], 'the stems sum into the bus');
  assert.deepEqual(limiter.connections, [audio.master], 'the limiter sits between the stems and the master');
  assert.deepEqual(audio.master.connections, [ctx.destination], 'the master is still the one output');

  assert.equal(limiter.threshold.value, -6);
  assert.equal(limiter.knee.value, 6);
  assert.equal(limiter.ratio.value, 12);
  assert.equal(limiter.attack.value, 0.003);
  assert.equal(limiter.release.value, 0.25);
  assert.equal(limiter.reduction, 0);

  // A pass plays voices and writes the mix; the plane's own nodes are the same objects.
  for (let i = 0; i < 12; i++) {
    audio.click(i * 0.5, i % 4 === 0);
    audio.pluck(40, i * 0.5);
  }
  audio.setMix({ stems: { pad: false }, verify: true });
  const after = stemPlane(ctx, audio);
  assert.equal(after.limiter, limiter, 'no second limiter');
  assert.equal(after.bus, bus, 'no second bus');
  for (let i = 0; i < 4; i++) assert.equal(after.gains[i], gains[i], 'the stem gains are never rebuilt');
  assert.equal(ctx.created.compressor.length, 1);
});

test('setMix is the only writer of a stem gain and writes audible x verify', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  const { stems } = stemPlane(ctx, audio);
  const gainCount = ctx.created.gain.length;
  const masterRamps = audio.master.gain.ramps.length;

  ctx.currentTime = 2;
  audio.setMix({ stems: { bass: false }, verify: false });
  assert.deepEqual(STEMS.map(name => stems[name].gain.value), [1, 1, 0, 1], 'a muted stem is silent, the rest stay full');
  for (const name of STEMS) {
    const ramp = stems[name].gain.ramps.at(-1);
    assert.equal(ramp.constant, 0.02, 'every stem level is a 20 ms ramp, never a click');
    assert.equal(ramp.time, 2);
  }

  audio.setMix({ verify: true });
  assert.deepEqual(STEMS.map(name => stems[name].gain.value), [0.1, 0.1, 0, 0],
    'the verify table is click .1 / drums .1 / bass 0 / pad 0');
  audio.setMix({ stems: { click: false }, verify: true });
  assert.equal(stems.click.gain.value, 0, 'a mute still wins inside the verify mix');

  // The verify duck is the stem plane's, not a second master write (T-04-07).
  assert.equal(audio.master.gain.ramps.length, masterRamps, 'setMix never touches the master gain');
  assert.equal(ctx.created.gain.length, gainCount, 'setMix creates no gain node');
  assert.equal(ctx.created.compressor.length, 1);
});

test('setMonitor keeps the master three targets and never writes a stem', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  const { stems } = stemPlane(ctx, audio);
  const stemRamps = STEMS.map(name => stems[name].gain.ramps.length);

  audio.setMonitor({ listening: true });
  assert.equal(audio.master.gain.ramps.at(-1).target, 0.1);
  audio.muteForPause();
  assert.equal(audio.master.gain.ramps.at(-1).target, 0);
  audio.restore();
  assert.equal(audio.master.gain.ramps.at(-1).target, 1);

  assert.deepEqual(STEMS.map(name => stems[name].gain.ramps.length), stemRamps, 'the master plane never writes a stem');
  assert.equal(ctx.created.compressor.length, 1);
});

// ---------- 04-01 Task 2: five synthesized voices, each stopping, on its own stem ----------
// The fakes record a node's own `start(when)`/`stop(when)` and an AudioParam's scheduled values,
// linear and exponential ramps separately, so every assertion below reads the voice graph, never
// a creation index (PATTERNS F4).
const stemGainOf = (ctx, stem) => ctx.created.gain.find(g => g.connections.length === 1 && g.connections[0] === stem);

test('kick, snare and hat land on the drums stem through their own envelope and their own filter', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  const { stems } = stemPlane(ctx, audio);
  const kick = audio.kick(1.5);
  const snare = audio.snare(2);
  const hat = audio.hat(3);

  assert.ok(kick && snare && hat);
  // Kick: a sine -> its own gain -> the drums stem.
  assert.equal(ctx.created.oscillator.length, 1);
  assert.equal(kick.type, 'sine');
  assert.equal(kick.connections.length, 1);
  assert.deepEqual(kick.connections[0].connections, [stems.drums]);
  // Snare: the shared noise source -> a 1.8 kHz highpass -> its own gain -> the drums stem.
  assert.equal(snare.connections.length, 1);
  assert.equal(snare.connections[0].type, 'highpass');
  assert.equal(snare.connections[0].frequency.value, 1800);
  assert.deepEqual(snare.connections[0].connections[0].connections, [stems.drums]);
  // Hat: the same shape through a 7 kHz highpass.
  assert.equal(hat.connections[0].type, 'highpass');
  assert.equal(hat.connections[0].frequency.value, 7000);
  assert.deepEqual(hat.connections[0].connections[0].connections, [stems.drums]);

  assert.equal(ctx.created.gain.length, 9, 'six construction gains plus one envelope per drum hit');
  assert.equal(ctx.created.bufferSource.length, 2, 'the snare and the hat are buffer sources, never oscillators');
  assert.equal(ctx.created.buffer.length, 1, 'one shared noise buffer');
  assert.equal(ctx.created.biquad.length, 2);
  assert.deepEqual(audio.master.connections, [ctx.destination], 'the voices stay behind the limiter, not on the master');
});

test('the drum voices never touch the bass or pad stems, and bass and pad land on theirs', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  const { stems } = stemPlane(ctx, audio);
  audio.kick(0);
  audio.snare(0.5);
  audio.hat(1);
  assert.equal(ctx.created.gain.filter(g => g.connections[0] === stems.bass).length, 0, 'no drum reaches the bass stem');
  assert.equal(ctx.created.gain.filter(g => g.connections[0] === stems.pad).length, 0, 'no drum reaches the pad stem');
  assert.equal(ctx.created.gain.filter(g => g.connections[0] === stems.click).length, 0, 'no drum reaches the click stem');

  const bass = audio.bass(40, 4, 1);
  assert.equal(bass.type, 'triangle');
  assert.equal(bass.connections[0].type, 'lowpass');
  assert.equal(bass.connections[0].frequency.value, 400);
  assert.deepEqual(bass.connections[0].connections[0].connections, [stems.bass]);
  assert.ok(Math.abs(bass.frequency.value - 82.41) < 0.1, 'MIDI 40 is E2');

  const pad = audio.pad([60, 64, 67], 4, 2);
  assert.equal(pad.length, 3);
  const padLp = pad[0].connections[0];
  assert.equal(padLp.type, 'lowpass');
  assert.equal(padLp.frequency.value, 900);
  assert.deepEqual(padLp.connections[0].connections, [stems.pad]);
  assert.deepEqual(pad.map(osc => osc.connections[0]), [padLp, padLp, padLp], 'one chord, one lowpass');
  assert.ok(Math.abs(pad[0].frequency.value - 261.63) < 0.1);
  assert.ok(Math.abs(pad[1].frequency.value - 329.63 * 1.002) < 0.1, 'the upper voices are detuned');
  assert.ok(Math.abs(pad[2].frequency.value - 392 * 1.002) < 0.1);
  assert.equal(stemGainOf(ctx, stems.bass), bass.connections[0].connections[0]);
  assert.equal(stemGainOf(ctx, stems.pad), padLp.connections[0]);
});

test('every voice stops every node it starts, exactly once (T-04-04)', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  const kick = audio.kick(1);
  const snare = audio.snare(1);
  const hat = audio.hat(1);
  const bass = audio.bass(40, 1, 1);
  const pad = audio.pad([60, 64, 67], 1, 2);

  assert.deepEqual(kick.stopCalls, [1.32]);
  assert.deepEqual(snare.stopCalls, [1.2]);
  assert.deepEqual(hat.stopCalls, [1.06]);
  assert.deepEqual(bass.stopCalls, [2.02], 'the bass releases with its own hit');
  for (const osc of pad) assert.deepEqual(osc.stopCalls, [3.02], 'a pad chord is released with its bar');

  for (const node of [...ctx.created.oscillator, ...ctx.created.bufferSource]) {
    assert.equal(node.startCalls.length, 1, 'every source starts once');
    assert.equal(node.stopCalls.length, 1, 'every source stops once');
    assert.ok(Number.isFinite(node.stopCalls[0]) && node.stopCalls[0] > node.startCalls[0], 'the stop is after the start');
  }
  assert.equal(ctx.created.oscillator.length + ctx.created.bufferSource.length, 7, 'four oscillators and three sources');
});

test('no exponential ramp targets 0 and every voice decays to the 0.001 floor (Pitfall 9, T-04-05)', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  const { stems } = stemPlane(ctx, audio);
  audio.kick(0);
  audio.snare(0);
  audio.hat(0);
  audio.bass(40, 0, 1);
  audio.pad([60, 64, 67], 0, 2);

  const params = [
    ...ctx.created.oscillator.map(o => o.frequency),
    ...ctx.created.gain.map(g => g.gain),
    ...ctx.created.biquad.map(b => b.frequency),
  ];
  const ramps = params.flatMap(p => p.expRamps);
  assert.ok(ramps.length >= 5, 'the sweep is not vacuous');
  for (const ramp of ramps) {
    assert.ok(ramp.target > 0, `an exponential ramp targets ${ramp.target}`);
    assert.ok(Number.isFinite(ramp.time), 'an exponential ramp has a finite time');
  }

  const envelopeGains = ctx.created.gain.filter(g => g.connections.length === 1
    && [stems.drums, stems.bass, stems.pad].includes(g.connections[0]) && g.gain.expRamps.length);
  assert.equal(envelopeGains.length, 5, 'kick, snare, hat, bass and pad each own one envelope gain');
  for (const gain of envelopeGains) assert.equal(gain.gain.expRamps.at(-1).target, 0.001, 'every envelope ends at the floor');
  assert.deepEqual(ctx.created.oscillator[0].frequency.expRamps, [{ target: 45, time: 0.09 }], 'the kick sweep is 140 -> 45 Hz in 90 ms');
});

test('pad voices at most three oscillators and an empty or unpitched chord creates nothing (T-04-04)', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  assert.deepEqual(audio.pad([]), [], 'an empty chord is no voice');
  assert.deepEqual(audio.pad(), []);
  assert.deepEqual(audio.pad([NaN, undefined]), [], 'a chord with no real pitch is no voice');
  assert.equal(ctx.created.oscillator.length, 0);
  assert.equal(ctx.created.biquad.length, 0);
  assert.equal(ctx.created.gain.length, 6, 'not even an envelope gain');

  const pad = audio.pad([60, 64, 67, 72, 76], 0, 2);
  assert.equal(pad.length, 3, 'a pad is three voices at most');
  assert.equal(ctx.created.oscillator.length, 3);
  assert.equal(ctx.created.biquad.length, 1);
  assert.equal(ctx.created.gain.length, 7, 'one envelope gain for the chord');
});

test('two snare hits share one memoised noise buffer', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  audio.snare(0);
  audio.snare(0.5);
  audio.hat(1);
  assert.equal(ctx.created.buffer.length, 1, 'one two-second noise buffer for the whole kit');
  const noise = ctx.created.buffer[0];
  assert.equal(noise.numberOfChannels, 1);
  assert.equal(noise.length, ctx.sampleRate * 2);
  assert.deepEqual(ctx.created.bufferSource.map(src => src.buffer), [noise, noise, noise]);

  audio.pluck(40);
  assert.equal(ctx.created.buffer.length, 2, 'the pluck cache is a separate map; a real note still builds its own buffer');
});

test('a pad stops at or after its release, so a chord never outlives its bar', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  const { stems } = stemPlane(ctx, audio);
  const pad = audio.pad([60, 64, 67], 4, 2);
  const gain = stemGainOf(ctx, stems.pad);
  const release = gain.gain.expRamps.at(-1);
  assert.deepEqual(release, { target: 0.001, time: 6 }, 'the release lands on the bar line, two seconds after the hit');
  assert.equal(gain.gain.expRamps[0].target, 0.16, 'the pad peaks at 0.16');
  assert.equal(gain.gain.values[0].time, 4, 'the attack starts at the hit, never at ctx.currentTime');
  assert.equal(gain.gain.values[1].time, 5.92, 'the hold begins before the release');
  for (const osc of pad) assert.ok(osc.stopCalls[0] >= release.time, 'a noisy source is stopped after its envelope');
});

test('setSound(false) makes every voice return without creating a node', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  audio.setSound(false);
  assert.equal(audio.kick(0), null);
  assert.equal(audio.snare(0), null);
  assert.equal(audio.hat(0), null);
  assert.equal(audio.bass(40), null);
  assert.equal(audio.pad([60, 64, 67]), null);
  assert.deepEqual(
    [ctx.created.oscillator.length, ctx.created.bufferSource.length, ctx.created.buffer.length, ctx.created.biquad.length, ctx.created.gain.length],
    [0, 0, 0, 0, 6],
    'Sound off silences the band exactly as it silences the click',
  );

  audio.setSound(true);
  assert.ok(audio.kick(0));
  assert.ok(audio.snare(0));
  assert.ok(audio.hat(0));
  assert.ok(audio.bass(40));
  assert.equal(audio.pad([60, 64, 67]).length, 3);
});

test('bass refuses a note it cannot play instead of scheduling a NaN frequency', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  assert.equal(audio.bass(NaN), null);
  assert.equal(audio.bass(undefined), null);
  assert.equal(audio.bass('40'), null, 'a stringified note is not a note');
  assert.equal(audio.bass(Infinity), null);
  assert.equal(ctx.created.oscillator.length, 0);
  assert.equal(ctx.created.gain.length, 6);
  assert.equal(ctx.created.biquad.length, 0);
});

test('a twelve-bar pass is a bounded node count, counted by kind (T-04-04)', () => {
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  const chords = Array.from({ length: 12 }, (_, i) => ({ rootMidi: 40 + (i % 3), padMidis: [60, 64, 67] }));
  const events = backingEvents({ beatsPerBar: 4, countInBeats: 4, bars: 12, chords });
  const hits = { kick: 0, snare: 0, hat: 0, bass: 0, pad: 0 };
  for (const event of events) {
    if (event.type === 'click') continue;
    hits[event.type] += 1;
    const when = event.beat * 0.5;
    if (event.type === 'kick') audio.kick(when);
    else if (event.type === 'snare') audio.snare(when);
    else if (event.type === 'hat') audio.hat(when);
    else if (event.type === 'bass') audio.bass(event.midi, when, event.durBeats * 0.5);
    else audio.pad(event.midis, when, event.durBeats * 0.5);
  }

  // PATTERNS[4] per bar: 2 kicks, 2 snares, 4 hats, 2 basses and one pad; the ending bar adds one
  // kick, one bass and one pad. Counted per kind, not as one total, so a bar played twice or a
  // voice that forgot its stop is visible as a count instead of a silent CPU climb.
  assert.deepEqual(hits, { kick: 25, snare: 24, hat: 48, bass: 25, pad: 13 });
  assert.equal(ctx.created.oscillator.length, hits.kick + hits.bass + hits.pad * 3, 'one oscillator per kick and bass, three per pad');
  assert.equal(ctx.created.bufferSource.length, hits.snare + hits.hat, 'one source per snare and per hat');
  assert.equal(ctx.created.buffer.length, 1, 'the noise buffer is built once for the whole pass');
  assert.equal(ctx.created.biquad.length, hits.snare + hits.hat + hits.bass + hits.pad, 'one filter per voice');
  assert.equal(ctx.created.gain.length, 6 + hits.kick + hits.snare + hits.hat + hits.bass + hits.pad, 'one envelope per hit plus the six construction nodes');
  assert.equal(ctx.created.compressor.length, 1, 'one limiter for the whole pass, never one per bar');

  assert.ok(ctx.created.oscillator.length / 12 <= 8, 'at most 8 oscillators per 4/4 bar');
  assert.ok(ctx.created.bufferSource.length / 12 <= 6, 'at most 6 buffer sources per 4/4 bar');
  for (const node of [...ctx.created.oscillator, ...ctx.created.bufferSource]) {
    assert.equal(node.stopCalls.length, 1, 'every node of the pass is stopped exactly once');
  }
});
