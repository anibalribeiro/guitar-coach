// The pure scorer: onsets, pitch classes, step scoring, bar scoring and calibration.
// Every input is a plain number or an array, so this suite runs with no browser at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCORE, calibrationOffset, createOnsetState, frameRms, median, nextPitchStreak, outputTimeMs, pitchClassOf,
  pushFrame, scoreBars, scoreSteps, scoreSummary, tapOffsetMs,
} from '../app/src/score.js';
import {
  BLOCK_MS, attack, doubleAttack, framesOf, pitchFrames, silence, sustain,
} from './fixtures/mic.js';

// 375 Hz is exactly eight cycles over 1024 samples at 48 kHz, so the RMS is analytic.
const BUFFER = length => {
  const buf = new Float32Array(length);
  for (let i = 0; i < length; i++) buf[i] = Math.sin((2 * Math.PI * 375 * i) / 48000) * 0.5;
  return buf;
};

// Run the onset detector over a block sequence exactly as one pass would.
function onsetsOf(frames, state = createOnsetState()) {
  const onsets = [];
  let next = state;
  for (const frame of frames) {
    const result = pushFrame(next, frameRms(frame.block), frame.atMs);
    next = result.state;
    if (result.onset) onsets.push(result.onset);
  }
  return { onsets, state: next };
}

const pitchEvents = list => list.map(([atMs, midi]) => ({ type: 'pitch', atMs, midi }));
const stepsOf = (midis, { bpmBeats = [0, 1, 2, 3] } = {}) => midis.map((midi, index) => ({
  index,
  beat: bpmBeats[index],
  target: { midi },
}));

test('SCORE carries the documented constants', () => {
  assert.deepEqual(SCORE, {
    pollMs: 25,
    rmsWindow: 1024,
    windowMs: 250,
    earlyMs: 120,
    pitchStreak: 2,
    barEarlyMs: 60,
    barLateMs: 300,
    refractoryMs: 90,
    minCalibrationTaps: 3,
    maxCalibrationMs: 250,
    strayTapMs: 500,
  });
});

test('frameRms reads the last window and never returns NaN', () => {
  assert.ok(Math.abs(frameRms(BUFFER(1024)) - Math.sqrt(0.125)) < 1e-3, 'a full sine of amplitude .5');
  assert.equal(frameRms(new Float32Array(0)), 0, 'an empty buffer is silence');
  assert.equal(frameRms(null), 0);
  assert.equal(frameRms(undefined), 0);
  assert.equal(frameRms('not a buffer'), 0);
  // A loud tail is what the window measures: the quiet head is outside `size`.
  const mixed = new Float32Array(2048);
  for (let i = 1024; i < 2048; i++) mixed[i] = 0.5;
  assert.equal(frameRms(mixed, 1024), 0.5);
  assert.equal(frameRms(mixed, 2048), Math.sqrt(256 / 2048));
});

test('median is the lower-middle average and null for an empty list', () => {
  assert.equal(median([]), null);
  assert.equal(median(null), null);
  assert.equal(median([5]), 5);
  assert.equal(median([30, 10, 20]), 20);
  assert.equal(median([40, 10, 30, 20]), 25);
  assert.equal(median([10, 'x', 30]), 20, 'non-numbers are dropped, not coerced');
});

test('pitchClassOf wraps negatives and rejects non-finite values', () => {
  assert.equal(pitchClassOf(60), 0);
  assert.equal(pitchClassOf(72), 0);
  assert.equal(pitchClassOf(67), 7);
  assert.equal(pitchClassOf(-1), 11);
  assert.equal(pitchClassOf(-13), 11);
  assert.equal(pitchClassOf(null), null);
  assert.equal(pitchClassOf(undefined), null);
  assert.equal(pitchClassOf(Infinity), null);
});

test('nextPitchStreak needs the configured identical readings and resets on a new note', () => {
  let streak = { midi: null, count: 0 };
  streak = nextPitchStreak(streak, 60);
  assert.deepEqual(streak, { midi: 60, count: 1, hit: false }, 'one reading is not enough');
  streak = nextPitchStreak(streak, 60);
  assert.deepEqual(streak, { midi: 60, count: 2, hit: true }, 'two identical readings commit');
  streak = nextPitchStreak(streak, 62);
  assert.deepEqual(streak, { midi: 62, count: 1, hit: false }, 'a new note restarts the streak');
  assert.deepEqual(nextPitchStreak(streak, NaN), { midi: null, count: 0, hit: false });
});

// ---------- Onsets ----------
test('silence yields no onset', () => {
  const { onsets } = onsetsOf(framesOf(silence(1024 * 4)));
  assert.equal(onsets.length, 0);
});

test('one attack yields exactly one onset', () => {
  const { onsets } = onsetsOf(framesOf(attack({ amplitude: 0.2 })));
  assert.equal(onsets.length, 1);
  assert.ok(Math.abs(onsets[0].rms - 0.2) < 1e-6);
  assert.equal(onsets[0].atMs, 0);
});

test('a frame below the gate is not an onset', () => {
  const { onsets } = onsetsOf([{ atMs: 0, block: attack({ amplitude: 0.01 }) }]);
  assert.equal(onsets.length, 0);
});

test('a double attack yields two onsets', () => {
  const { onsets } = onsetsOf(framesOf(doubleAttack({ gapMs: 200, burstMs: 60 })));
  assert.equal(onsets.length, 2);
  assert.ok(Math.abs((onsets[1].atMs - onsets[0].atMs) - 200) <= BLOCK_MS);
});

test('a refractory window suppresses a second onset 40 ms later', () => {
  const frames = framesOf(doubleAttack({ gapMs: 40, burstMs: 24 }));
  const { onsets } = onsetsOf(frames);
  assert.equal(onsets.length, 1, 'the 40 ms repeat is inside the 90 ms refractory window');

  // The same rule, stated directly: a frame 40 ms after an onset is too soon, 100 ms is not.
  const first = pushFrame(createOnsetState(), 0.2, 0);
  assert.ok(first.onset);
  const soon = pushFrame(first.state, 0.5, 40);
  assert.equal(soon.onset, null);
  const later = pushFrame(first.state, 0.5, 100);
  assert.ok(later.onset);
});

test('pushFrame never mutates the state it is given and keeps the floor under the frame', () => {
  const state = createOnsetState();
  const before = { ...state };
  const result = pushFrame(state, 0.2, 500);
  assert.deepEqual(state, before, 'the input state is untouched');
  assert.notEqual(result.state, state);
  assert.ok(result.state.floor <= 0.2, 'the floor never sits above the current frame');

  let next = createOnsetState();
  for (const level of [0.4, 0.05, 0, 0.2, 0.3]) {
    next = pushFrame(next, level, 1000).state;
    assert.ok(next.floor <= level + 1e-12, `floor ${next.floor} above frame ${level}`);
  }
});

// ---------- scoreSteps ----------
test('a two-second sustain credits exactly one step of three', () => {
  const frames = framesOf(sustain({ amplitude: 0.2, seconds: 2 }));
  const { onsets } = onsetsOf(frames);
  assert.equal(onsets.length, 1, 'one attack, one onset');

  const events = frames.map(frame => ({ type: 'pitch', atMs: frame.atMs, midi: 60 }));
  const steps = stepsOf([60, 62, 64]);
  const score = scoreSteps(events, steps, { bpm: 60 });
  assert.equal(score.hits, 1, 'a sustained C4 is one note, not three');
  assert.equal(score.planned, 3);
  assert.equal(score.onsets, 0, 'no onset events were supplied');
  assert.equal(score.perStep.filter(step => step.hit).length, 1);
});

test('a scale target requires the correct octave and rejects a neighbouring note', () => {
  const steps = stepsOf([60]);
  const octave = scoreSteps(pitchEvents([[0, 72]]), steps, { bpm: 60 });
  assert.equal(octave.hits, 0, 'C5 is not the requested C4');
  const neighbour = scoreSteps(pitchEvents([[0, 62]]), steps, { bpm: 60 });
  assert.equal(neighbour.hits, 0);
});

test('the timing median is correct for odd and even hit counts', () => {
  const odd = scoreSteps(
    pitchEvents([[10, 60], [1030, 62], [2020, 64]]),
    stepsOf([60, 62, 64]),
    { bpm: 60 },
  );
  assert.deepEqual(odd.perStep.map(step => step.offsetMs), [10, 30, 20]);
  assert.equal(odd.timing.medianMs, 20);

  const even = scoreSteps(
    pitchEvents([[10, 60], [1020, 62], [2030, 64], [3040, 65]]),
    stepsOf([60, 62, 64, 65]),
    { bpm: 60 },
  );
  assert.deepEqual(even.perStep.map(step => step.offsetMs), [10, 20, 30, 40]);
  assert.equal(even.timing.medianMs, 25);
});

test('calibrationMs is subtracted from the observed time', () => {
  const steps = stepsOf([60], { bpmBeats: [1] }); // expected 1000 ms at 60 BPM
  const raw = scoreSteps(pitchEvents([[1050, 60]]), steps, { bpm: 60 });
  assert.equal(raw.perStep[0].offsetMs, 50);
  const calibrated = scoreSteps(pitchEvents([[1050, 60]]), steps, { bpm: 60, calibrationMs: 50 });
  assert.equal(calibrated.perStep[0].offsetMs, 0);
  assert.equal(calibrated.timing.medianMs, 0);
});

test('a real pitch on the click is not blacklisted by timing alone', () => {
  const steps = stepsOf([60], { bpmBeats: [1] });
  const near = scoreSteps(pitchEvents([[1030, 60]]), steps, { bpm: 60, clickTimesMs: [1000] });
  assert.equal(near.hits, 1);
  assert.equal(near.perStep[0].offsetMs, 30);
  const click = scoreSteps(pitchEvents([[1000, 84]]), steps, { bpm: 60, clickTimesMs: [1000] });
  assert.equal(click.hits, 0, 'the C6 click is outside the requested octave');
});

test('a pass with nothing played never reports 0 as a measured value', () => {
  const nothingPlanned = scoreSteps([], [], { bpm: 60 });
  assert.equal(nothingPlanned.accuracy, null);
  assert.equal(nothingPlanned.timing.medianMs, null);
  assert.equal(nothingPlanned.planned, 0);

  const planned = scoreSteps([], stepsOf([60, 62, 64]), { bpm: 60 });
  assert.equal(planned.accuracy, 0, 'three planned notes and none on pitch is a real zero');
  assert.equal(planned.timing.medianMs, null, 'no hits is an absent measurement, not 0 ms');
  assert.equal(planned.hits, 0);
});

test('only pitch events credit a step; onsets alone do not', () => {
  const steps = stepsOf([60]);
  const onsets = [{ type: 'onset', atMs: 0, rms: 0.2 }];
  assert.equal(scoreSteps(onsets, steps, { bpm: 60 }).hits, 0);
  const mixed = [...onsets, { type: 'pitch', atMs: 10, midi: 60 }];
  const score = scoreSteps(mixed, steps, { bpm: 60 });
  assert.equal(score.hits, 1);
  assert.equal(score.onsets, 1, 'onset events are counted, not credited');
});

test('a step outside the early and late window is missed', () => {
  const steps = stepsOf([60], { bpmBeats: [1] }); // expected 1000, window 880-1250
  assert.equal(scoreSteps(pitchEvents([[870, 60]]), steps, { bpm: 60 }).hits, 0);
  assert.equal(scoreSteps(pitchEvents([[1260, 60]]), steps, { bpm: 60 }).hits, 0);
  assert.equal(scoreSteps(pitchEvents([[880, 60]]), steps, { bpm: 60 }).hits, 1);
  assert.equal(scoreSteps(pitchEvents([[1250, 60]]), steps, { bpm: 60 }).hits, 1);
});

test('the chart steps of a real scale run are scored in chart time', () => {
  // A one-octave C major run at 60 BPM with a four-beat count-in: step i is at beat 4 + i.
  const steps = ['C', 'D', 'E'].map((_, index) => ({
    index, beat: 4 + index, target: { midi: 60 + index * 2 },
  }));
  const events = [
    { type: 'pitch', atMs: 4000 + 10, midi: 60 },
    { type: 'pitch', atMs: 5000 + 20, midi: 62 },
    { type: 'pitch', atMs: 6000 + 30, midi: 64 },
  ];
  const score = scoreSteps(events, steps, { bpm: 60 });
  assert.equal(score.hits, 3);
  assert.equal(score.accuracy, 1);
  assert.equal(score.timing.medianMs, 20);
});

// ---------- scoreBars ----------
// The production adapter emits the onset first and its pitch for the same frame at the
// same timestamp (`mic.js`), so a bar is counted from an onset and its root is read from
// the pitch at or after that onset. An onset has no `midi`, and a chord left ringing must
// not claim the next bar (CR-03, Pitfall 4).
const barEvents = list => list.flatMap(([atMs, midi]) => [
  { type: 'onset', atMs, rms: 0.2 },
  ...(Number.isFinite(midi) ? [{ type: 'pitch', atMs, midi }] : []),
]);

test('scoreBars counts one change per bar and reads the root from the onset’s own pitch', () => {
  // Bars run at 0, 4000, 8000 and 12000 ms: one chord per bar, four bars.
  const events = barEvents([[10, 48], [4010, 55], [8000, 57], [12000, 50]]);
  const score = scoreBars(events, { barSpanMs: 4000, bars: 4, expectedRoots: [0, 7, 9, 2] });
  assert.equal(score.counted, 4);
  assert.equal(score.planned, 4, 'the planned bar count rides the score for the mic line');
  assert.equal(score.rootsChecked, 4);
  assert.equal(score.rootsOnPitch, 4);
  assert.deepEqual(score.perBar.map(bar => bar.counted), [true, true, true, true]);
  assert.deepEqual(score.perBar.map(bar => bar.root), [0, 7, 9, 2]);
});

test('a ringing chord claims no bar of its own without an onset', () => {
  // One strum on bar 1 keeps sounding: pitch frames keep arriving at bar 2's line, but
  // the player never changed chord. Only the onset counts (CR-03, Pitfall 4).
  const events = [
    { type: 'onset', atMs: 10, rms: 0.2 },
    { type: 'pitch', atMs: 10, midi: 48 },
    { type: 'pitch', atMs: 1010, midi: 48 },
    // Still ringing 10 ms after bar 2's line, well inside the change window.
    { type: 'pitch', atMs: 4010, midi: 48 },
  ];
  const score = scoreBars(events, { barSpanMs: 4000, bars: 4, expectedRoots: [0, 7, 9, 2] });
  assert.equal(score.counted, 1);
  assert.deepEqual(score.perBar.map(bar => bar.counted), [true, false, false, false]);
});

test('scoreBars counts one bar once and ignores a strum mid-bar', () => {
  const events = barEvents([[10, 48], [1000, 48], [12000, 50]]);
  const score = scoreBars(events, { barSpanMs: 4000, bars: 4, expectedRoots: [0, 7, 9, 2] });
  assert.equal(score.counted, 2);
  assert.deepEqual(score.perBar.map(bar => bar.counted), [true, false, false, true]);
});

test('an unreadable root is not checked, never wrong', () => {
  const events = barEvents([[10, null], [4010, 55]]);
  const score = scoreBars(events, { barSpanMs: 4000, bars: 2, expectedRoots: [0, 7] });
  assert.equal(score.counted, 2);
  assert.equal(score.rootsChecked, 1, 'only the bar whose root was actually read is checked');
  assert.equal(score.rootsOnPitch, 1);
  assert.equal(score.perBar[0].onPitch, false);
  assert.equal(score.perBar[0].root, 0, 'the expected root is still reported');
  assert.equal(score.perBar[1].onPitch, true);
});

test('scoreBars skips a bar whose chart carries no root', () => {
  const score = scoreBars(
    barEvents([[10, 48]]),
    { barSpanMs: 4000, bars: 1, expectedRoots: [null] },
  );
  assert.equal(score.counted, 1);
  assert.equal(score.planned, 1);
  assert.equal(score.rootsChecked, 0);
  assert.equal(score.rootsOnPitch, 0);
});

// ---------- calibrationOffset ----------
test('calibrationOffset asks for at least three taps', () => {
  assert.deepEqual(calibrationOffset([]), { ok: false, offsetMs: null, reason: 'none' });
  assert.deepEqual(calibrationOffset([10, 20]), { ok: false, offsetMs: null, reason: 'tooFew' });
  assert.deepEqual(calibrationOffset([10, 20, 30]), { ok: true, offsetMs: 20, reason: null });
});

test('calibrationOffset drops a stray tap before taking the median', () => {
  const result = calibrationOffset([12, 900, 20, 30]);
  assert.equal(result.ok, true);
  assert.equal(result.offsetMs, 20, 'the 900 ms tap is outside strayTapMs');
  assert.equal(result.reason, null);
});

test('calibrationOffset warns above the working range and clamps to 0-250', () => {
  const large = calibrationOffset([300, 310, 320]);
  assert.equal(large.ok, true, 'a large but usable median is still saved');
  assert.equal(large.reason, 'large');
  assert.equal(large.offsetMs, SCORE.maxCalibrationMs);

  const negative = calibrationOffset([-40, -30, -20]);
  assert.equal(negative.ok, true);
  assert.equal(negative.offsetMs, 0, 'a negative offset clamps to zero');
  assert.equal(negative.reason, null);
});

// ---------- scoreSummary ----------
test('scoreSummary is the unscored aggregator shaped like scoreSteps', () => {
  const events = [
    { type: 'onset', atMs: 0, rms: 0.2 },
    { type: 'onset', atMs: 500, rms: 0.2 },
    { type: 'pitch', atMs: 500, midi: 60 },
  ];
  const summary = scoreSummary(events, { steps: [{ beat: 0 }, { beat: 1 }, { beat: 2 }] });
  assert.equal(summary.onsets, 2);
  assert.equal(summary.hits, 2, 'without a pitch step model the onsets are the count');
  assert.equal(summary.planned, 3);
  assert.equal(summary.accuracy, null, 'an unscored pass never reads as 0%');
  assert.deepEqual(summary.timing, { medianMs: null, meanAbsMs: null, onTimeRate: null });
  assert.equal(scoreSummary([], {}).planned, 0);
});

// ---------- The two-clock bridge and one tap (T-03-15) ----------
test('outputTimeMs bridges the performance clock onto the audio clock', () => {
  // `contextTime` is in seconds, `performanceTime` and `perfNow` in milliseconds.
  assert.equal(outputTimeMs({ contextTime: 2, performanceTime: 1000 }, 1500, 3), 2500);
  assert.equal(outputTimeMs({ contextTime: 2, performanceTime: 1000 }, 1000, 3), 2000, 'a tap on the timestamp is its context time');
  // A context that cannot report a pair falls back to its own current time.
  assert.equal(outputTimeMs(null, 1500, 3), 3000, 'a missing timestamp uses currentTime');
  assert.equal(outputTimeMs(undefined, 1500, 3), 3000);
  assert.equal(outputTimeMs({ contextTime: 0, performanceTime: 0 }, 1500, 3), 3000, 'zeros mean "not available"');
  assert.equal(outputTimeMs({ contextTime: 2 }, 1500, 3), 3000, 'half a pair is no pair');
  assert.equal(outputTimeMs({ contextTime: NaN, performanceTime: 1000 }, 1500, 3), 3000);
  assert.equal(outputTimeMs(null, 1500, 0), 0, 'no clock at all reads zero, never NaN');
  assert.equal(outputTimeMs(null, NaN, undefined), 0);
});

test('tapOffsetMs resolves a tap to the nearest click on the grid', () => {
  const t0 = 1.6, spb = 0.6667;
  // 2000 ms sits closer to click 1 (2266.7 ms) than to click 0 (1600 ms).
  const offset = tapOffsetMs(2000, t0, spb, {});
  assert.ok(offset !== null, 'a tap inside the grid resolves');
  assert.ok(Math.abs(offset - (2000 - (t0 + spb) * 1000)) < 1e-9, 'the offset is tap minus the nearest click');
  // 20 ms from a click is still that click, and the offset is the small difference.
  const near = tapOffsetMs((t0 + 2 * spb) * 1000 + 20, t0, spb, {});
  assert.ok(Math.abs(near - 20) < 1e-6, 'a tap 20 ms from a click resolves to it');
  const early = tapOffsetMs(t0 * 1000 - 30, t0, spb, {});
  assert.ok(Math.abs(early + 30) < 1e-6, 'an early tap is a negative offset');
});

test('tapOffsetMs rejects a stray tap, an off-grid tap and a non-number', () => {
  const t0 = 1.6;
  assert.equal(tapOffsetMs((t0 + 0.9) * 1000, t0, 2, {}), null, 'a 900 ms tap is beyond SCORE.strayTapMs');
  assert.equal(tapOffsetMs(20000, 0, 0.6667, {}), null, 'index 30 is outside the eight clicks');
  assert.equal(tapOffsetMs(t0 * 1000 - 1200, t0, 0.5, {}), null, 'a tap two clicks before click zero has no click');
  assert.equal(tapOffsetMs(2000, t0, 0, {}), null, 'no click grid, no offset');
  assert.equal(tapOffsetMs('2000', t0, 0.6667, {}), null);
  assert.equal(tapOffsetMs(NaN, t0, 0.6667, {}), null);
  // The stray window is the caller's, so a tighter test is honoured.
  assert.equal(tapOffsetMs(t0 * 1000 + 40, t0, 0.6667, { strayTapMs: 20 }), null);
  assert.ok(tapOffsetMs(t0 * 1000 + 40, t0, 0.6667, {}) !== null);
  // The click count is a parameter: a five-click test has no sixth click.
  assert.equal(tapOffsetMs((t0 + 5 * 0.6667) * 1000, t0, 0.6667, { clicks: 5 }), null);
});

test('the fixtures expose fixed pitch frames at fixed audio timestamps', () => {
  const frames = pitchFrames();
  assert.deepEqual(frames.map(frame => frame.atMs), [1000, 1250, 1500, 2000]);
  assert.deepEqual(frames.map(frame => frame.midi), [60, 64, 67, 72]);
  for (const frame of frames) assert.equal(frame.block.length, 4096);
});
