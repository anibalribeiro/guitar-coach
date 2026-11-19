import test from 'node:test';
import assert from 'node:assert/strict';
import { createMic } from '../app/src/mic.js';
import { scoreSteps } from '../app/src/score.js';
import { addDays, applyResult, emptyProgress, skillState, validateProgress } from '../app/src/progress.js';
import { buildScaleRunChart, createRun, reduce, summarizeDrill } from '../app/src/drills.js';
import { CLEAN_RESULT, FIXED_NOW } from './fixtures/progress.js';

const steps = [0, 1, 2].map(beat => ({ beat, target: { midi: 60 } }));

test('one sustained pitch cannot satisfy repeated notes', () => {
  const events = [{ type: 'onset', atMs: 0 }, ...[0, 250, 500, 750, 1000].map(atMs => ({ type: 'pitch', atMs, midi: 60 }))];
  assert.equal(scoreSteps(events, steps, { bpm: 120 }).hits, 1);
});

test('correct attacks on the click are scored at the attack time', () => {
  const events = [0, 500, 1000].flatMap(atMs => [{ type: 'onset', atMs }, { type: 'pitch', atMs: atMs + 50, midi: 60 }]);
  const score = scoreSteps(events, steps, { bpm: 120, clickTimesMs: [0, 500, 1000] });
  assert.equal(score.hits, 3);
  assert.equal(score.timing.medianMs, 0);
});

test('an octave mistake does not pass a scale target', () => {
  assert.equal(scoreSteps([{ type: 'pitch', atMs: 0, midi: 72 }], steps, { bpm: 120 }).hits, 0);
});

test('stopping a pending microphone arm disposes the late capture', async () => {
  let grant;
  let stops = 0;
  const mic = createMic({ getUserMedia: () => {}, capture: () => ({ start: () => new Promise(resolve => { grant = resolve; }), stop: () => { stops++; } }) });
  const pending = mic.arm();
  mic.stop(); grant(); await pending;
  assert.equal(mic.state, 'off');
  assert.equal(stops, 1);
});

test('concurrent microphone arms share one capture', async () => {
  let grant;
  let starts = 0;
  const mic = createMic({ getUserMedia: () => {}, capture: () => ({ start: () => { starts++; return new Promise(resolve => { grant = resolve; }); }, stop() {} }) });
  const first = mic.arm();
  const second = mic.arm();
  assert.equal(starts, 1);
  grant(); await Promise.all([first, second]); mic.stop();
});

test('a scheduled 30-day review is not lapsed on day 15', () => {
  assert.equal(skillState({ masteredAt: FIXED_NOW, lastCleanRecallAt: FIXED_NOW, dueAt: addDays(FIXED_NOW, 30) }, addDays(FIXED_NOW, 15)), 'mastered');
});

test('negative timing bias survives persistence validation', () => {
  const progress = applyResult(emptyProgress(), { ...CLEAN_RESULT, syncScore: { accuracy: 1, timing: { medianMs: -50 } } }, { now: FIXED_NOW });
  assert.equal(validateProgress(progress).skills[CLEAN_RESULT.skillId].medianTimingMs, -50);
});

test('known failed recall does not earn mastery from a clean self report', () => {
  const chart = buildScaleRunChart({ bpm: 120 });
  let run = { ...createRun(chart), hintLevel: 3 };
  for (const event of [{ type: 'START', at: 0, wallAt: FIXED_NOW }, { type: 'TICK', beat: 4 }, { type: 'FINISH', at: 27000, wallAt: FIXED_NOW + 27000, syncScore: { accuracy: 0, timing: { medianMs: 500 } } }, { type: 'SELF_REPORT', clean: true }]) run = reduce(run, event).state;
  const summary = summarizeDrill(run);
  assert.equal(summary.mastered, false);
  assert.equal(applyResult(emptyProgress(), summary, { now: FIXED_NOW }).skills[chart.id].masteredAt, null);
});

test('same-day repetitions do not advance the review interval', () => {
  const first = applyResult(emptyProgress(), CLEAN_RESULT, { now: FIXED_NOW });
  const second = applyResult(first, { ...CLEAN_RESULT, sessionId: 'another' }, { now: FIXED_NOW + 1000 });
  assert.equal(second.skills[CLEAN_RESULT.skillId].intervalIndex, first.skills[CLEAN_RESULT.skillId].intervalIndex);
  assert.equal(second.skills[CLEAN_RESULT.skillId].dueAt, first.skills[CLEAN_RESULT.skillId].dueAt);
});

test('only an independent check on a later day earns retained status', () => {
  const first = applyResult(emptyProgress(), CLEAN_RESULT, { now: FIXED_NOW });
  const assessment = { source: 'selfReport', passed: null, coldRecall: false };
  const result = { ...CLEAN_RESULT, sessionId: 'tomorrow', passes: CLEAN_RESULT.passes.map(pass => ({ ...pass, assessment })) };
  const tomorrow = addDays(FIXED_NOW, 1);
  const warm = applyResult(first, result, { now: tomorrow });
  assert.equal(warm.skills[CLEAN_RESULT.skillId].retainedAt, null);
  assert.equal(warm.skills[CLEAN_RESULT.skillId].intervalIndex, first.skills[CLEAN_RESULT.skillId].intervalIndex);
  const cold = applyResult(first, { ...result, passes: result.passes.map(pass => ({ ...pass, assessment: { ...assessment, coldRecall: true } })) }, { now: tomorrow });
  assert.equal(validateProgress(cold).skills[CLEAN_RESULT.skillId].retainedAt, tomorrow);
  assert.equal(cold.skills[CLEAN_RESULT.skillId].intervalIndex, first.skills[CLEAN_RESULT.skillId].intervalIndex + 1);
});

test('a missed microphone reading needs an explicit correction and preserves its measurement', () => {
  const chart = buildScaleRunChart({ bpm: 120 });
  let run = { ...createRun(chart), hintLevel: 3 };
  for (const event of [{ type: 'START', wallAt: FIXED_NOW }, { type: 'TICK', beat: 4 }, { type: 'FINISH', syncScore: { accuracy: 0, timing: { medianMs: -40 } } }, { type: 'SELF_REPORT', clean: true, corrected: true }]) run = reduce(run, event).state;
  const summary = summarizeDrill(run);
  assert.equal(summary.mastered, true);
  const saved = validateProgress(applyResult(emptyProgress(), summary, { now: FIXED_NOW }));
  assert.equal(saved.sessions[0].passes[0].assessment.corrected, true);
  assert.equal(saved.sessions[0].passes[0].assessment.accuracy, 0);
});

test('early chord changes use the same calibrated window live and in the final score', async () => {
  const { barForOnset, scoreBars } = await import('../app/src/score.js');
  const { buildChordChangeChart } = await import('../app/src/drills.js');
  const chart = buildChordChangeChart({ pairId: 'C-G', bpm: 120, bars: 8 });
  for (const calibrationMs of [0, 100]) {
    const atMs = 3970 + calibrationMs;
    const bar = barForOnset(atMs - 2000, { barSpanMs: 2000, bars: 8, calibrationMs });
    let run = reduce(createRun(chart), { type: 'START' }).state;
    run = reduce(run, { type: 'TICK', beat: 7.94 }).state;
    run = reduce(run, { type: 'CHANGE_ONSET', atMs, bar, calibrationMs }).state;
    const score = scoreBars([{ type: 'onset', atMs: atMs - 2000 }], { barSpanMs: 2000, bars: 8, calibrationMs });
    assert.equal(bar, 1);
    assert.equal(run.changes.counted, 1);
    assert.equal(score.counted, run.changes.counted);
  }
});

test('metronome clicks avoid a periodic tone in the guitar pitch range', async () => {
  const { createAudio } = await import('../app/src/audio.js');
  const { createFakeAudioContext } = await import('./helpers/fakes.js');
  const ctx = createFakeAudioContext();
  const audio = createAudio(ctx);
  const click = audio.click(1, true);
  assert.equal(ctx.created.oscillator.length, 0);
  assert.ok(click.buffer);
  assert.ok(click.stopCalls[0] - click.startCalls[0] <= 0.02);
});

test('a measured missed chord-change pass needs correction before it can be clean', async () => {
  const { buildChordChangeChart } = await import('../app/src/drills.js');
  const chart = buildChordChangeChart({ pairId: 'C-G', bpm: 120 });
  let run = reduce(createRun(chart), { type: 'START' }).state;
  run = reduce(run, { type: 'TICK', beat: 4 }).state;
  run = reduce(run, { type: 'FINISH', syncScore: { counted: 0, planned: 8, rootsChecked: 0, rootsOnPitch: 0 } }).state;
  run = reduce(run, { type: 'SELF_REPORT', clean: true }).state;
  assert.equal(run.selfReport, 'shaky');
});

test('one manually corrected note does not override the whole failed microphone assessment', () => {
  const chart = buildScaleRunChart({ bpm: 120 });
  let run = { ...createRun(chart), hintLevel: 3 };
  for (const event of [{ type: 'START', wallAt: FIXED_NOW }, { type: 'TICK', beat: 4 }, { type: 'FINISH', syncScore: { accuracy: 0.02, manualHits: 1, timing: { medianMs: 500, meanAbsMs: 500 } } }, { type: 'SELF_REPORT', clean: true }]) run = reduce(run, event).state;
  assert.equal(summarizeDrill(run).mastered, false);
  assert.equal(run.passes[0].assessment.corrected, false);
});

test('guided practice does not overwrite the last qualifying review date', () => {
  const initial = applyResult(emptyProgress(), CLEAN_RESULT, { now: FIXED_NOW });
  const tomorrow = addDays(FIXED_NOW, 1);
  const result = (sessionId, coldRecall) => ({ ...CLEAN_RESULT, sessionId, passes: CLEAN_RESULT.passes.map(pass => ({ ...pass, assessment: { source: 'selfReport', coldRecall, passed: null } })) });
  const guided = applyResult(initial, result('guided', false), { now: tomorrow });
  const independent = applyResult(guided, result('independent', true), { now: tomorrow + 1000 });
  assert.equal(independent.skills[CLEAN_RESULT.skillId].retainedAt, tomorrow + 1000);
  assert.equal(independent.skills[CLEAN_RESULT.skillId].intervalIndex, initial.skills[CLEAN_RESULT.skillId].intervalIndex + 1);
});
