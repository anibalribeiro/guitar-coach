// Drill engine contract: chart shape, transition matrix, frame precedence and the
// single RunSummary object. All pure; no DOM and no audio.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScaleRunChart, buildNoteQuizChart, buildChordChangeChart, buildPlayAlongChart,
  createRun, reduce, frameAt, summarize, summarizeDrill, resumeFromBeat, stepIndexFor,
  CHANGE_WINDOW, CHART_CHANGES, songSectionBars, sectionAtBar, playAlongIdleFrame, readoutFrame, chartIdFor,
  shownLevel, songFadeOffset,
} from '../app/src/drills.js';
import { CHORD_FAMILIES, CHORD_PAIRS, chordById, chordPairById, PROGRESSIONS, progressionById, SONGS, songById } from '../app/src/content.js';
import { anchorNotes } from '../app/src/fade.js';
import { expandChord, expandProgression, expandSongSection, voiceChord } from '../app/src/theory.js';
import { BACKUP_SCHEMA_VERSION, applyResult, emptyProgress, exportDoc, validateBackup } from '../app/src/progress.js';
import { sceneFromNotes, frameForScene, frameHex, ledCounts, ledFrame, lightable } from '../app/src/leds.js';

const instance = {
  scaleId: 'minPent', keyPc: 9, positionId: 's6f0', direction: 'up', bpm: 80,
};

const chart = () => buildScaleRunChart(instance);

function started(c = chart()) {
  return reduce(createRun(c), { type: 'START', at: 1000 }).state;
}

function active(c = chart(), beat = 4) {
  return reduce(started(c), { type: 'TICK', beat }).state;
}

function syntheticChart(steps) {
  return {
    id: 'scaleRun:test:0:all',
    kind: 'scaleRun',
    bpm: 60,
    beatsPerBar: 4,
    countInBeats: 4,
    direction: 'up',
    content: { scaleId: 'major', keyPc: 0, positionId: 'all' },
    steps: steps.map((target, index) => ({ index, beat: 4 + index, target })),
    shape: steps.map(t => ({ ...t })),
    audioEvents: [],
    totalBeats: 4 + steps.length,
  };
}

// A play-along chart from the curated table: one bar per `degrees` entry plus the ending
// step, built through the same `expandProgression` the composition root uses.
// FADE-12: the LED set never holds fret 0, so expectations built from a shape or a chord's
// cells drop the open cells the T2 cannot light (Pitfall 10: fix the expectation, not the code).
const litOnly = cells => cells.filter(n => n.f >= 1);
const litKeys = keys => keys.filter(key => !key.endsWith(':0'));

function syntheticPlayChart({ id = 'I-IV-V', keyPc = 0, bpm = 80, meter = [4, 4], startLevel = 0 } = {}) {
  const prog = progressionById[id] || PROGRESSIONS[0];
  return buildPlayAlongChart({
    family: 'progression',
    progressionId: prog.id,
    keyPc,
    bpm,
    bars: expandProgression(prog, keyPc),
    meter,
    startLevel,
  });
}

test('chart builds one step per beat with a four-beat count-in and sorted audio', () => {
  const c = chart();
  assert.equal(c.id, 'scaleRun:minPent:9:s6f0');
  assert.equal(c.kind, 'scaleRun');
  assert.equal(c.bpm, 80);
  assert.equal(c.beatsPerBar, 4);
  assert.equal(c.countInBeats, 4);
  assert.equal(c.totalBeats, 4 + c.steps.length);
  assert.equal(c.anchorMode, 'box');
  assert.equal(c.startLevel, 0);
  assert.deepEqual(c.steps.map(s => s.beat), c.steps.map((_, i) => 4 + i));
  assert.equal(c.audioEvents.filter(e => e.type === 'click').length, c.totalBeats);
  assert.equal(c.audioEvents.filter(e => e.type === 'pluck').length, c.steps.length);
  assert.deepEqual(c.audioEvents.map(e => e.beat), [...c.audioEvents.map(e => e.beat)].sort((a, b) => a - b));
  for (const e of c.audioEvents.filter(e => e.type === 'click')) assert.equal(e.accent, e.beat % c.beatsPerBar === 0);
  for (const step of c.steps) {
    assert.ok(c.audioEvents.some(e => e.type === 'pluck' && e.beat === step.beat && e.midi === step.target.midi));
  }
});

test('direction changes the step order and up-and-down repeats neither endpoint', () => {
  const up = buildScaleRunChart({ ...instance, direction: 'up' });
  const down = buildScaleRunChart({ ...instance, direction: 'down' });
  const updown = buildScaleRunChart({ ...instance, direction: 'updown' });
  const n = up.steps.length;
  assert.ok(n > 2);
  assert.equal(down.steps.length, n);
  assert.deepEqual(down.steps.map(s => s.target), [...up.steps.map(s => s.target)].reverse());
  assert.equal(updown.steps.length, n * 2 - 2);
  assert.deepEqual(updown.steps.slice(0, n).map(s => s.target), up.steps.map(s => s.target));
  assert.deepEqual(updown.steps.slice(n).map(s => s.target), up.steps.slice(1, -1).map(s => s.target).reverse());
  const all = buildScaleRunChart({ ...instance, positionId: 'all', direction: 'up' });
  assert.equal(all.id, 'scaleRun:minPent:9:all');
  assert.ok(all.steps.length > 0);
});

test('START enters count-in from idle and TICK reaches active at the count-in boundary', () => {
  const c = chart();
  let result = reduce(createRun(c), { type: 'START', at: 1000 });
  assert.equal(result.state.phase, 'countIn');
  assert.equal(result.state.startedAt, 1000);
  assert.deepEqual(result.effects.map(e => e.type), ['startTransport', 'announce']);
  assert.equal(result.effects[1].key, 'count-in');

  result = reduce(result.state, { type: 'TICK', beat: 3.9 });
  assert.equal(result.state.phase, 'countIn');
  result = reduce(result.state, { type: 'TICK', beat: 4 });
  assert.equal(result.state.phase, 'active');
  assert.equal(result.state.beat, 4);
  assert.equal(result.state.stepIndex, 0);
});

test('START seeds the drill clock and the session id from the wall clock', () => {
  const c = chart();
  const state = reduce(createRun(c), { type: 'START', at: 1000, wallAt: 1700000000000 }).state;
  assert.equal(state.drillStartedAt, 1000);
  assert.equal(state.drillWallStartedAt, 1700000000000);
  assert.equal(state.sessionId, c.id + ':1700000000000');

  const review = reduce(active(c, 4), { type: 'FINISH', at: 4000, wallAt: 1700000004000 }).state;
  assert.equal(review.drillWallEndedAt, 1700000004000);
  const ended = reduce(review, { type: 'END_DRILL', at: 5000, wallAt: 1700000005000 }).state;
  assert.equal(ended.drillWallEndedAt, 1700000005000);
});

test('START_FAILED is legal from idle only and enters paused with the audio reason', () => {
  const c = chart();
  let result = reduce(createRun(c), { type: 'START_FAILED', reason: 'audio', at: 1 });
  assert.equal(result.state.phase, 'paused');
  assert.equal(result.state.pausedBeat, 0);
  assert.equal(result.state.pauseReason, 'audio');
  assert.equal(result.state.resumeFromBeat, c.countInBeats);
  assert.equal(result.state.activeStartBeat, c.countInBeats);
  assert.deepEqual(result.effects.map(e => e.type), ['holdLeds', 'announce']);
  assert.equal(result.effects[1].key, 'paused-audio');
  assert.ok(!result.effects.some(e => e.type === 'startTransport'));

  result = reduce(result.state, { type: 'RESUME' });
  assert.equal(result.state.phase, 'countIn');
  assert.equal(result.state.activeStartBeat, c.countInBeats);
  assert.deepEqual(result.state.pauseReason, null);
  assert.ok(result.effects.some(e => e.type === 'startTransport'));

  const running = active(c, 6);
  const ignored = reduce(running, { type: 'START_FAILED', reason: 'audio' });
  assert.equal(ignored.state, running);
  assert.deepEqual(ignored.effects, []);
});

// CR-01: a drill that starts through the audio-failure pause still reaches the
// result with one stable session identity, so progress can never be applied twice.
test('START_FAILED seeds the drill identity and every later resume keeps it', () => {
  const c = chart();
  const failed = reduce(createRun(c), {
    type: 'START_FAILED', reason: 'audio', at: 10, wallAt: 1700000000000,
  }).state;
  assert.equal(failed.drillWallStartedAt, 1700000000000);
  assert.equal(failed.sessionId, c.id + ':1700000000000');

  const resumed = reduce(failed, { type: 'RESUME', at: 20, wallAt: 1700000001000 }).state;
  assert.equal(resumed.sessionId, failed.sessionId, 'Resume never rewrites the identity');
  assert.equal(resumed.drillWallStartedAt, 1700000000000);

  const restarted = reduce({ ...resumed, phase: 'active' }, {
    type: 'RESTART', at: 30, wallAt: 1700000002000,
  }).state;
  assert.equal(restarted.sessionId, failed.sessionId, 'Restart never rewrites the identity');

  const review = reduce({ ...restarted, phase: 'active', beat: 4 }, {
    type: 'FINISH', at: 40, wallAt: 1700000005000,
  }).state;
  const summary = summarizeDrill(review);
  assert.equal(summary.sessionId, failed.sessionId);
  assert.equal(summary.startedWallAt, 1700000000000);
  assert.equal(summary.endedWallAt, 1700000005000);
});

test('RESUME lazily establishes identity for a run paused without one', () => {
  const c = chart();
  const legacy = {
    ...createRun(c),
    phase: 'paused',
    pausedBeat: 0,
    pauseReason: 'audio',
    resumeFromBeat: c.countInBeats,
    activeStartBeat: c.countInBeats,
  };
  assert.equal(legacy.sessionId, null);
  const resumed = reduce(legacy, { type: 'RESUME', at: 1, wallAt: 1700000003000 }).state;
  assert.equal(resumed.sessionId, c.id + ':1700000003000');
  assert.equal(resumed.drillWallStartedAt, 1700000003000);
});

// The end-to-end CR-01 reproduction: a full drill that began on the audio-failure
// pause records one session and one recall report, and a re-report adds nothing.
test('a drill started through START_FAILED records one session and one report', () => {
  const c = chart();
  let state = reduce(createRun(c), {
    type: 'START_FAILED', reason: 'audio', at: 10, wallAt: 1700000000000,
  }).state;
  state = reduce(state, { type: 'RESUME', at: 20, wallAt: 1700000001000 }).state;

  for (let level = 0; level < 3; level++) {
    for (let pass = 0; pass < 3; pass++) {
      state = finishPass(state, c, { clean: true });
      state = reduce(state, { type: 'NEXT_PASS' }).state;
    }
  }
  const finished = reduce({ ...state, phase: 'active', beat: 4 }, {
    type: 'FINISH', at: 9000, wallAt: 1700000010000,
  }).state;
  assert.equal(finished.phase, 'result');
  assert.equal(finished.sessionId, c.id + ':1700000000000');

  const first = applyResult(emptyProgress(), summarizeDrill(finished), { now: 1700000010000 });
  assert.equal(first.totals.sessionCount, 1);
  assert.equal(first.totals.totalMs > 0, true);
  assert.equal(first.skills[c.id].withoutLights.cleanPasses, 0);

  const reported = reduce(finished, { type: 'SELF_REPORT', clean: true }).state;
  const afterReport = applyResult(first, summarizeDrill(reported), { now: 1700000011000 });
  const skill = afterReport.skills[c.id];
  assert.equal(skill.cleanPasses, 10, 'nine with-hints passes plus the recall');
  assert.equal(skill.withoutLights.cleanPasses, 1);
  assert.equal(skill.intervalIndex, 1);
  assert.equal(afterReport.sessions.length, 1);

  const again = applyResult(afterReport, summarizeDrill(reported), { now: 1700000012000 });
  assert.equal(again.skills[c.id].cleanPasses, 10, 'a repeated report never multiplies the passes');
  assert.equal(again.skills[c.id].withoutLights.cleanPasses, 1);
  assert.equal(again.skills[c.id].intervalIndex, 1);
  assert.equal(again.sessions.length, 1);
});

test('PAUSE only works from count-in or active and names its reason', () => {
  const c = chart();
  const pausedFromIdle = reduce(createRun(c), { type: 'PAUSE', reason: 'ble', beat: 0 });
  assert.equal(pausedFromIdle.state.phase, 'idle');

  let result = reduce(started(c), { type: 'PAUSE', reason: 'hidden', beat: 2 });
  assert.equal(result.state.phase, 'paused');
  assert.equal(result.state.pauseReason, 'hidden');
  assert.equal(result.state.resumeFromBeat, c.countInBeats);
  assert.deepEqual(result.effects.map(e => e.type), ['pauseTransport', 'holdLeds', 'announce']);
  assert.equal(result.effects[2].key, 'paused-hidden');

  result = reduce(active(c, 13), { type: 'PAUSE', reason: 'ble', beat: 13 });
  assert.equal(result.state.pauseReason, 'ble');
  assert.equal(result.state.resumeFromBeat, 12);

  const twice = reduce(result.state, { type: 'PAUSE', reason: 'audio', beat: 14 });
  assert.equal(twice.state, result.state);
  assert.deepEqual(twice.effects, []);
});

test('RESUME re-enters count-in at the paused bar and starts the transport at its first beat', () => {
  const c = chart();
  const paused = reduce(active(c, 13), { type: 'PAUSE', reason: 'ble', beat: 13 }).state;
  const result = reduce(paused, { type: 'RESUME' });
  assert.equal(result.state.phase, 'countIn');
  assert.equal(result.state.activeStartBeat, 12);
  assert.equal(result.state.beat, 8);
  assert.equal(result.state.stepIndex, 8);
  assert.equal(result.state.pausedBeat, null);
  assert.equal(result.state.pauseReason, null);
  assert.ok(result.effects.some(e => e.type === 'startTransport'));
});

test('resumeFromBeat maps count-in, bar boundaries and mid-bar pauses exactly', () => {
  const c = chart();
  const cases = [[0, 4], [3.9, 4], [4, 4], [7.9, 4], [8, 8], [11.9, 8], [12, 12], [13, 12]];
  for (const [beat, expected] of cases) {
    const state = { ...createRun(c), phase: 'paused', pausedBeat: beat, resumeFromBeat: beat };
    assert.equal(resumeFromBeat(state), expected, `paused at beat ${beat}`);
  }
  assert.equal(resumeFromBeat({ ...createRun(c), phase: 'idle' }), c.countInBeats);

  // At or past the final beat the resume clamps to the last bar that has a step.
  const lastBar = Math.floor((c.totalBeats - 1) / c.beatsPerBar) * c.beatsPerBar;
  for (const beat of [c.totalBeats, c.totalBeats + 0.5, c.totalBeats + 5.7]) {
    const state = { ...createRun(c), phase: 'paused', pausedBeat: beat };
    assert.equal(resumeFromBeat(state), lastBar, `paused at beat ${beat}`);
    assert.ok(lastBar < c.totalBeats, 'the resume target must still be inside the chart');
  }
});

test('a pause recorded at or after the final beat still resumes and finishes (WR-02)', () => {
  const c = chart();
  const late = reduce(active(c, 5), { type: 'PAUSE', reason: 'hidden', beat: c.totalBeats + 5.7 }).state;
  assert.equal(late.phase, 'paused');
  const lastBar = Math.floor((c.totalBeats - 1) / c.beatsPerBar) * c.beatsPerBar;
  assert.equal(late.resumeFromBeat, lastBar);
  assert.equal(late.resumeFromBeat % c.beatsPerBar, 0);

  const resumed = reduce(late, { type: 'RESUME' }).state;
  assert.equal(resumed.phase, 'countIn');
  assert.ok(resumed.activeStartBeat < c.totalBeats, 'the resume segment is not already finished');

  const ticking = reduce(resumed, { type: 'TICK', beat: resumed.activeStartBeat }).state;
  assert.equal(ticking.phase, 'active');
  const finished = reduce(ticking, { type: 'FINISH', at: 9000 }).state;
  assert.equal(finished.phase, 'passReview', 'FINISH must be legal after the clamped resume');
  assert.equal(finished.passes.length, 1);
});

test('STOP during count-in cancels to idle; STOP during active or paused yields a result', () => {
  const c = chart();
  let result = reduce(started(c), { type: 'STOP' });
  assert.equal(result.state.phase, 'idle');
  assert.equal(result.state.completed, false);
  assert.equal(result.state.stoppedEarly, false);
  assert.deepEqual(result.effects.map(e => e.type), ['stopTransport', 'zeroLeds', 'announce']);

  result = reduce(active(c, 6), { type: 'STOP', at: 2000 });
  assert.equal(result.state.phase, 'result');
  assert.equal(result.state.stoppedEarly, true);
  assert.equal(result.state.completed, false);
  assert.equal(result.state.endedAt, 2000);
  assert.deepEqual(result.effects.map(e => e.type), ['stopTransport', 'zeroLeds', 'announce']);

  const paused = reduce(active(c, 6), { type: 'PAUSE', reason: 'hidden', beat: 6 }).state;
  result = reduce(paused, { type: 'STOP' });
  assert.equal(result.state.phase, 'result');
  assert.equal(result.state.stoppedEarly, true);

  const idleStop = reduce(createRun(c), { type: 'STOP' });
  assert.equal(idleStop.state.phase, 'idle');
  assert.deepEqual(idleStop.effects, []);
});

test('FINISH closes the pass, records it and opens the pass review', () => {
  const c = chart();
  let result = reduce(active(c, 4), { type: 'FINISH', at: 5000 });
  assert.equal(result.state.phase, 'passReview');
  assert.equal(result.state.stoppedEarly, false);
  assert.equal(result.state.stepIndex, c.steps.length);
  assert.deepEqual(result.effects.map(e => e.type), ['stopTransport', 'zeroLeds', 'announce']);
  assert.equal(result.effects[2].key, 'pass-review');
  assert.equal(result.state.passes.length, 1);
  assert.deepEqual(result.state.passes[0], {
    index: 1,
    hintLevel: 0,
    bpm: 80,
    completedSteps: c.steps.length,
    plannedSteps: c.steps.length,
    selfReport: null,
    assessment: { source: 'selfReport', coldRecall: false, accuracy: null, medianTimingMs: null, meanAbsMs: null, passed: null, corrected: false },
    unguidedMs: 0,
    aborted: false,
    brightened: false,
    reasonKey: null,
    activeMs: 9000,
  });

  const early = reduce(started(c), { type: 'FINISH' });
  assert.equal(early.state.phase, 'countIn', 'FINISH is not a count-in transition');
});

test('the pass plan is a live estimate: remaining levels x clean reps, growing on a hold', () => {
  const c = chart();
  let state = reduce(createRun(c), { type: 'START', at: 1000 }).state;
  assert.deepEqual(state.plan, { passIndex: 1, totalPasses: 10 });

  state = reduce(active(c, 4), { type: 'FINISH', at: 4000 }).state;
  state = reduce(state, { type: 'SELF_REPORT', clean: true }).state;
  assert.equal(state.levelChange.reasonKey, 'holdClean');
  state = reduce(state, { type: 'NEXT_PASS' }).state;
  assert.equal(state.plan.passIndex, 2);
  assert.equal(state.plan.totalPasses, 10, 'the three clean reps are already budgeted');
  assert.equal(state.hintLevel, 0);
  assert.equal(state.phase, 'countIn');
  assert.equal(state.beat, 0);
  assert.equal(state.stepIndex, 0);
  assert.equal(state.resumeFromBeat, c.countInBeats);
  assert.equal(state.activeStartBeat, c.countInBeats);

  const atRecallEdge = {
    ...state,
    phase: 'passReview',
    hintLevel: 2,
    levelChange: { direction: 'none', fromLevel: 2, toLevel: 2, reasonKey: 'holdClean' },
    plan: { passIndex: 4, totalPasses: 4 },
  };
  const advanced = reduce(atRecallEdge, { type: 'NEXT_PASS' }).state;
  assert.equal(advanced.hintLevel, 2);
  assert.equal(advanced.plan.passIndex, 5);
  assert.equal(advanced.plan.totalPasses, 6, 'one remaining level-2 rep plus the recall');
});

test('three clean passes at Full pattern decide Anchors and the next pass starts there', () => {
  const c = chart();
  let state = reduce(createRun(c), { type: 'START', at: 1000 }).state;
  for (let pass = 1; pass <= 3; pass++) {
    state = reduce({ ...state, phase: 'active', beat: 4 }, { type: 'FINISH', at: 4000 }).state;
    state = reduce(state, { type: 'SELF_REPORT', clean: true }).state;
    if (pass < 3) {
      assert.equal(state.levelChange.reasonKey, 'holdClean', `pass ${pass} holds`);
      state = reduce(state, { type: 'NEXT_PASS' }).state;
    }
  }
  assert.equal(state.levelChange.reasonKey, 'advance');
  assert.equal(state.levelChange.direction, 'up');
  assert.equal(state.levelChange.fromLevel, 0);
  assert.equal(state.levelChange.toLevel, 1);

  state = reduce(state, { type: 'NEXT_PASS' }).state;
  assert.equal(state.phase, 'countIn');
  assert.equal(state.hintLevel, 1);
  const frame = frameAt(state, { phase: 'countIn', beat: 0, activeStartBeat: 4 });
  assert.ok(frame.notes.length > 0);
  assert.equal(frame.notes.every(n => n.anchor || n.target), true, 'the next pass renders anchors plus target only');
});

test('entering the pass review already carries the skipped-report decision', () => {
  const c = chart();
  const review = reduce(active(c, 4), { type: 'FINISH', at: 4000 }).state;
  assert.deepEqual(review.levelChange, {
    direction: 'none', fromLevel: 0, toLevel: 0, reasonKey: 'holdSkip',
  });
  assert.equal(review.selfReport, null);
});

// CR-04: the boundary decision is computed once. Replaying NEXT_PASS on an
// already-advanced boundary must not count the same pass again.
test('NEXT_PASS consumes the boundary decision instead of recomputing it', () => {
  const c = chart();
  let review = reduce(active(c, 4), { type: 'FINISH', at: 4000 }).state;
  review = reduce(review, { type: 'SELF_REPORT', clean: true }).state;
  assert.equal(review.pendingDecision.cleanStreak, 1, 'the report updates the stored decision');
  assert.equal(review.cleanStreak, 0, 'the live streak is still pre-decision');

  const next = reduce(review, { type: 'NEXT_PASS' }).state;
  assert.equal(next.cleanStreak, 1);
  assert.equal(next.failStreak, 0);
  assert.equal(next.hintLevel, 0, 'one clean pass holds Full pattern');
  assert.equal(next.pendingDecision.cleanStreak, 1, 'the decision is not consumed destructively');

  const replay = reduce({ ...next, phase: 'passReview' }, { type: 'NEXT_PASS' }).state;
  assert.equal(replay.cleanStreak, 1, 'a replayed boundary never counts the pass twice');
  assert.equal(replay.failStreak, 0);
  assert.equal(replay.hintLevel, 0);
  assert.equal(replay.plan.passIndex, next.plan.passIndex + 1);
});

test('NEXT_PASS takes the next level from the decision, never a stale levelChange', () => {
  const c = chart();
  const review = reduce(active(c, 4), { type: 'FINISH', at: 4000 }).state;
  assert.equal(review.pendingDecision.level, 0);
  const stale = {
    ...review,
    levelChange: { direction: 'up', fromLevel: 0, toLevel: 3, reasonKey: 'advance' },
  };
  const next = reduce(stale, { type: 'NEXT_PASS' }).state;
  assert.equal(next.hintLevel, 0, 'the stored decision wins over levelChange.toLevel');
});

// WR-02: Stop during a later count-in ends the drill with the completed passes,
// never re-opens the previous boundary as if the cancelled pass had run.
test('Stop during a later count-in yields a stopped-early result, not a phantom review', () => {
  const c = chart();
  let state = reduce(active(c, 4), { type: 'FINISH', at: 4000 }).state;
  state = reduce(state, { type: 'SELF_REPORT', clean: true }).state;
  state = reduce(state, { type: 'NEXT_PASS' }).state;
  assert.equal(state.phase, 'countIn');
  assert.equal(state.plan.passIndex, 2);

  const stopped = reduce(state, { type: 'STOP', at: 5000, wallAt: 1700000006000 }).state;
  assert.equal(stopped.phase, 'result');
  assert.equal(stopped.stoppedEarly, true);
  assert.equal(stopped.completed, false);
  assert.equal(stopped.passes.length, 1, 'only the completed pass is recorded');
  assert.equal(stopped.plan.passIndex, 2, 'no extra pass is invented');
  const summary = summarizeDrill(stopped);
  assert.equal(summary.withHints.passes.length, 1);
  assert.equal(summary.mastered, false);
});

test('skipping the report inserts a repeat pass without changing the streaks', () => {
  const c = chart();
  let state = reduce(active(c, 4), { type: 'FINISH', at: 4000 }).state;
  const before = { level: state.hintLevel, clean: state.cleanStreak, fail: state.failStreak };
  state = reduce(state, { type: 'NEXT_PASS' }).state;
  assert.equal(state.hintLevel, before.level);
  assert.equal(state.cleanStreak, before.clean);
  assert.equal(state.failStreak, before.fail);
  assert.equal(state.plan.passIndex, 2);
  assert.equal(state.plan.totalPasses, 11, 'the held level grows Pass N of M by one');
});

test('a second shaky pass demotes and the next pass starts one hint back', () => {
  const c = chart();
  const record = {
    index: 2,
    hintLevel: 2,
    bpm: 80,
    completedSteps: c.steps.length,
    plannedSteps: c.steps.length,
    selfReport: null,
    unguidedMs: 0,
    aborted: false,
    reasonKey: null,
  };
  const base = {
    ...createRun(c),
    phase: 'passReview',
    hintLevel: 2,
    cleanStreak: 0,
    failStreak: 1,
    plan: { passIndex: 3, totalPasses: 4 },
    passes: [record],
    levelChange: { direction: 'none', fromLevel: 2, toLevel: 2, reasonKey: 'holdSkip' },
  };
  let state = reduce(base, { type: 'SELF_REPORT', clean: false }).state;
  assert.equal(state.levelChange.reasonKey, 'demote');
  assert.equal(state.levelChange.direction, 'down');
  assert.equal(state.levelChange.toLevel, 1);
  state = reduce(state, { type: 'NEXT_PASS' }).state;
  assert.equal(state.hintLevel, 1);
  assert.equal(state.cleanStreak, 0);
  assert.equal(state.failStreak, 0);
});

test('summarize reports the ladder start and final levels', () => {
  const c = chart();
  const summary = summarize({ ...createRun(c), startLevel: 0, hintLevel: 1 });
  assert.equal(summary.startLevel, 0);
  assert.equal(summary.finalLevel, 1);
  assert.equal(summary.hintLevel, 1);
});

test('NEXT_PASS applies the decided level and starts a count-in', () => {
  const c = chart();
  let state = reduce(active(c, 4), { type: 'FINISH', at: 4000 }).state;
  state = reduce(state, { type: 'SELF_REPORT', clean: true }).state;
  const result = reduce(state, { type: 'NEXT_PASS' });
  assert.equal(result.state.phase, 'countIn');
  assert.equal(result.state.hintLevel, 0, 'one clean pass holds Full pattern');
  assert.equal(result.state.selfReport, null);
  assert.deepEqual(result.state.recall, { attempted: false, completed: false, selfReport: null, bpm: 80 });
  assert.deepEqual(result.effects.map(e => e.type), ['startTransport', 'announce']);
  assert.equal(result.effects[1].key, 'pass-start');

  const atAnchors = {
    ...state,
    hintLevel: 1,
    cleanStreak: 2,
    levelChange: { direction: 'up', fromLevel: 0, toLevel: 1, reasonKey: 'advance' },
  };
  const next = reduce(atAnchors, { type: 'NEXT_PASS' }).state;
  assert.equal(next.hintLevel, 1);
  assert.equal(next.phase, 'countIn');
  assert.equal(next.levelChange.toLevel, 1);
});

test('END_DRILL keeps the completed passes and yields a stopped-early result', () => {
  const c = chart();
  let state = reduce(active(c, 4), { type: 'FINISH', at: 4000 }).state;
  state = reduce(state, { type: 'SELF_REPORT', clean: true }).state;
  const result = reduce(state, { type: 'END_DRILL', at: 5000 });
  assert.equal(result.state.phase, 'result');
  assert.equal(result.state.completed, false);
  assert.equal(result.state.stoppedEarly, true);
  assert.equal(result.state.endedAt, 5000);
  assert.equal(result.state.passes.length, 1);
  assert.deepEqual(result.effects.map(e => e.type), ['stopTransport', 'zeroLeds', 'announce']);
  assert.equal(result.effects[2].key, 'result-stopped');
});

test('RESTART restarts only the current pass and REPEAT starts a fresh drill', () => {
  const c = chart();
  const passReview = reduce(active(c, 4), { type: 'FINISH', at: 4000 }).state;
  const nextPass = reduce(reduce(passReview, { type: 'SELF_REPORT', clean: true }).state, { type: 'NEXT_PASS' }).state;
  let result = reduce(nextPass, { type: 'RESTART', at: 3000 });
  assert.equal(result.state.phase, 'countIn');
  assert.equal(result.state.stepIndex, 0);
  assert.equal(result.state.beat, 0);
  assert.equal(result.state.startedAt, 3000);
  assert.equal(result.state.chart, c);
  assert.equal(result.state.hintLevel, nextPass.hintLevel, 'Restart never rewinds the ladder');
  assert.equal(result.state.plan.passIndex, nextPass.plan.passIndex);
  assert.deepEqual(result.state.passes, nextPass.passes);
  assert.equal(result.state.drillStartedAt, nextPass.drillStartedAt);
  assert.ok(result.effects.some(e => e.type === 'startTransport'));

  const ended = reduce(passReview, { type: 'END_DRILL', at: 5000 }).state;
  result = reduce(ended, { type: 'REPEAT', at: 6000 });
  assert.equal(result.state.phase, 'countIn');
  assert.equal(result.state.selfReport, null);
  assert.equal(result.state.completed, false);
  assert.equal(result.state.chart, c);
  assert.equal(result.state.passes.length, 0, 'a new drill starts with no pass history');
  assert.ok(result.effects.some(e => e.type === 'startTransport'));
});

// IN-03: the REPEAT branch is currently routed through startDrill, but if it is ever
// used it must still seed a session identity.
test('REPEAT seeds the session identity for the fresh drill', () => {
  const c = chart();
  const ended = reduce(reduce(active(c, 4), { type: 'FINISH', at: 4000 }).state, { type: 'END_DRILL', at: 5000 }).state;
  const repeat = reduce(ended, { type: 'REPEAT', at: 6000, wallAt: 1700000007000 }).state;
  assert.equal(repeat.sessionId, c.id + ':1700000007000');
  assert.equal(repeat.drillWallStartedAt, 1700000007000);
  assert.equal(repeat.drillStartedAt, 6000);
  assert.equal(repeat.plan.passIndex, 1);
});

test('SELF_REPORT stamps the pass at the review and the recall report at a completed result', () => {
  const c = chart();
  const review = reduce(active(c, 4), { type: 'FINISH', at: 4000 }).state;
  assert.equal(reduce(review, { type: 'SELF_REPORT', clean: true }).state.selfReport, 'clean');
  assert.equal(reduce(review, { type: 'SELF_REPORT', clean: true }).state.passes[0].selfReport, 'clean');
  assert.equal(reduce(review, { type: 'SELF_REPORT', clean: false }).state.selfReport, 'shaky');
  assert.equal(reduce(active(c, 4), { type: 'SELF_REPORT', clean: true }).state.selfReport, null);

  const completed = { ...createRun(c), phase: 'result', completed: true };
  assert.equal(reduce(completed, { type: 'SELF_REPORT', clean: true }).state.selfReport, 'clean');

  const stopped = reduce(active(c, 6), { type: 'STOP' }).state;
  assert.equal(reduce(stopped, { type: 'SELF_REPORT', clean: true }).state.selfReport, null);
});

test('illegal events are ignored without throwing in every phase', () => {
  const c = chart();
  const review = reduce(active(c, 4), { type: 'FINISH' }).state;
  const states = {
    idle: createRun(c),
    countIn: started(c),
    active: active(c, 6),
    paused: reduce(active(c, 6), { type: 'PAUSE', reason: 'hidden', beat: 6 }).state,
    passReview: review,
    result: reduce(review, { type: 'END_DRILL' }).state,
  };
  const events = [
    { type: 'START' }, { type: 'START_FAILED' }, { type: 'TICK', beat: 1 },
    { type: 'PAUSE', reason: 'ble', beat: 1 }, { type: 'RESUME' }, { type: 'RESTART' },
    { type: 'STOP' }, { type: 'FINISH' }, { type: 'REPEAT' }, { type: 'SELF_REPORT', clean: true },
    { type: 'NEXT_PASS' }, { type: 'END_DRILL' }, { type: 'FLASH', beat: 1 },
    { type: 'ABORT_PASS', beat: 1 }, { type: 'NOPE' },
  ];
  for (const [name, state] of Object.entries(states)) {
    for (const event of events) {
      const result = reduce(state, event);
      assert.ok(result.state, `${name}/${event.type} returned a state`);
      assert.ok(Array.isArray(result.effects), `${name}/${event.type} returned effects`);
      // Only the documented legal edges may change the phase.
      const legal = (
        (name === 'idle' && (event.type === 'START' || event.type === 'START_FAILED')) ||
        (name === 'countIn' && ['TICK', 'PAUSE', 'RESTART', 'STOP'].includes(event.type)) ||
        (name === 'active' && ['TICK', 'PAUSE', 'RESTART', 'STOP', 'FINISH'].includes(event.type)) ||
        (name === 'paused' && ['RESUME', 'RESTART', 'STOP'].includes(event.type)) ||
        (name === 'passReview' && ['SELF_REPORT', 'NEXT_PASS', 'END_DRILL'].includes(event.type)) ||
        (name === 'result' && event.type === 'REPEAT')
      );
      if (!legal) assert.equal(result.state, state, `${name}/${event.type} must not mutate`);
    }
  }
});

test('frameAt marks the count-in target, completed notes, the root and open targets', () => {
  const root = { s: 5, f: 3, midi: 48, iv: 0 };
  const second = { s: 5, f: 5, midi: 50, iv: 2 };
  const third = { s: 4, f: 2, midi: 52, iv: 4 };
  const c = syntheticChart([root, second, third]);
  const state = reduce(createRun(c), { type: 'START' }).state;

  let frame = frameAt(state, { phase: 'countIn', beat: 0, activeStartBeat: 4 });
  assert.equal(frame.stepNumber, 0);
  assert.deepEqual(frame.target, root);
  assert.equal(frame.blink, true);
  assert.equal(frame.notes.find(n => n.s === 5 && n.f === 3).target, true);
  assert.equal(frame.notes.every(n => !n.dim), true);

  frame = frameAt(state, { phase: 'active', beat: 5, activeStartBeat: 4 });
  assert.equal(frame.stepNumber, 2);
  assert.deepEqual(frame.target, second);
  assert.equal(frame.notes.find(n => n.s === 5 && n.f === 3).dim, false, 'the root stays lit');
  assert.equal(frame.notes.find(n => n.s === 5 && n.f === 5).target, true);
  assert.equal(frame.notes.find(n => n.s === 4 && n.f === 2).dim, false);

  frame = frameAt(state, { phase: 'active', beat: 6, activeStartBeat: 4 });
  assert.deepEqual(frame.target, third);
  assert.equal(frame.notes.find(n => n.s === 5 && n.f === 3).dim, false, 'the completed root stays lit');
  assert.equal(frame.notes.find(n => n.s === 5 && n.f === 5).dim, true, 'a completed non-root dims');

  const openChart = syntheticChart([{ s: 6, f: 0, midi: 40, iv: 4 }, second]);
  const openFrame = frameAt(reduce(createRun(openChart), { type: 'START' }).state, { phase: 'countIn', beat: 0, activeStartBeat: 4 });
  assert.equal(openFrame.target.f, 0);
  assert.equal(openFrame.blink, false, 'an open target never blinks and is never substituted');

  const finished = { ...state, phase: 'result', stepIndex: 3, completed: true };
  frame = frameAt(finished, { phase: 'finished', beat: 7 });
  assert.equal(frame.target, null);
  assert.equal(frame.blink, false);
  assert.equal(frame.notes.length, 3);
});

test('the reducer exposes phase and only descriptor effects for the UI and LED layers', () => {
  const c = chart();
  const allowed = new Set(['startTransport', 'pauseTransport', 'stopTransport', 'zeroLeds', 'holdLeds', 'announce']);
  const phases = [createRun(c), started(c), active(c), reduce(active(c), { type: 'PAUSE', reason: 'hidden', beat: 4 }).state,
    reduce(active(c), { type: 'FINISH' }).state];
  assert.deepEqual(phases.map(s => s.phase), ['idle', 'countIn', 'active', 'paused', 'passReview']);
  const events = [
    { type: 'START' }, { type: 'TICK', beat: 4 }, { type: 'PAUSE', reason: 'hidden', beat: 4 },
    { type: 'STOP' }, { type: 'NEXT_PASS' }, { type: 'END_DRILL' }, { type: 'SELF_REPORT', clean: true },
  ];
  for (const state of phases) {
    for (const event of events) {
      const { effects } = reduce(state, event);
      for (const effect of effects) assert.ok(allowed.has(effect.type), `unexpected effect ${effect.type}`);
    }
  }
});

test('frameAt filters notes by hint level, marks anchors and keeps the result shape', () => {
  const root = { s: 5, f: 3, midi: 48, iv: 0 };
  const middle = { s: 5, f: 4, midi: 49, iv: 1 };
  const top = { s: 5, f: 5, midi: 50, iv: 2 };
  const low = { s: 4, f: 2, midi: 52, iv: 0 };
  const c = syntheticChart([root, middle, top, low]);
  c.anchorMode = 'box';
  const startedState = reduce(createRun(c), { type: 'START' }).state;

  // H1 at count-in: anchors (roots / each string's lowest fret) plus no target outside them.
  let frame = frameAt({ ...startedState, hintLevel: 1 }, { phase: 'countIn', beat: 0, activeStartBeat: 4 });
  assert.deepEqual(frame.target, root);
  assert.deepEqual(frame.notes.map(n => n.s + ':' + n.f), ['5:3', '4:2']);
  assert.equal(frame.notes.every(n => n.anchor), true);

  // H1 while the target is a middle note: anchors plus that target only.
  frame = frameAt({ ...startedState, hintLevel: 1 }, { phase: 'active', beat: 5, activeStartBeat: 4 });
  assert.deepEqual(frame.target, middle);
  assert.deepEqual(frame.notes.map(n => n.s + ':' + n.f), ['5:3', '5:4', '4:2']);
  assert.equal(frame.notes.find(n => n.f === 4).anchor, false);

  // H2: every shape note, anchors marked, target kept.
  frame = frameAt({ ...startedState, hintLevel: 2 }, { phase: 'active', beat: 5, activeStartBeat: 4 });
  assert.equal(frame.notes.length, 4);
  assert.equal(frame.target, middle);
  assert.deepEqual(frame.notes.filter(n => n.anchor).map(n => n.s + ':' + n.f), ['5:3', '4:2']);

  // H3: no notes, no target, no blink.
  frame = frameAt({ ...startedState, hintLevel: 3 }, { phase: 'active', beat: 5, activeStartBeat: 4 });
  assert.deepEqual(frame.notes, []);
  assert.equal(frame.target, null);
  assert.equal(frame.blink, false);
  assert.equal(frame.flash, false);

  frame = frameAt({ ...startedState, hintLevel: 3 }, { phase: 'countIn', beat: 0, activeStartBeat: 4 });
  assert.deepEqual(frame.notes, []);
  assert.equal(frame.target, null);
  assert.equal(frame.blink, false);

  // The result board keeps the full shape with no target at any level.
  const finished = { ...startedState, phase: 'result', stepIndex: 4, hintLevel: 3 };
  frame = frameAt(finished, { phase: 'finished', beat: 8 });
  assert.equal(frame.notes.length, 4);
  assert.equal(frame.target, null);
});

test('FADE-11 tracer: minPent A s6f5 at Anchors lights 7 where Full lights 12, and frame, bits and count agree', () => {
  const c = buildScaleRunChart({ scaleId: 'minPent', keyPc: 9, positionId: 's6f5', direction: 'up', bpm: 70 });
  const firstActive = startLevel => {
    const run = createRun({ ...c, startLevel });
    const s = reduce(reduce(run, { type: 'START', at: 1000 }).state, { type: 'TICK', beat: c.countInBeats }).state;
    return frameAt(s, { phase: 'active', beat: c.countInBeats });
  };
  const anchors = firstActive(1);
  const keys = new Set(anchors.led.map(n => n.s + ':' + n.f));
  assert.ok(anchors.target);
  assert.ok(keys.has(anchors.target.s + ':' + anchors.target.f), 'the first target is itself an anchor');
  assert.equal(keys.size, 7);
  assert.equal(anchors.led.length, 7);
  const bits = frame => { let n = 0; for (let i = 1; i <= 18; i++) for (let x = frame[i]; x; x >>= 1) n += x & 1; return n; };
  assert.equal(bits(frameForScene(sceneFromNotes(anchors.led), 0, 70)), 7);
  assert.equal(bits(ledFrame(anchors.led)), 7);
  assert.deepEqual(ledCounts(anchors.led, c.shape), { lit: 7, dark: 5, open: 0 });
  const full = firstActive(0);
  assert.equal(ledCounts(full.led, c.shape).lit, 12);
});

test('whole-neck runs anchor on roots only and open notes keep their open flag', () => {
  const c = buildScaleRunChart({ scaleId: 'minPent', keyPc: 9, positionId: 'all', direction: 'up', bpm: 80 });
  assert.equal(c.anchorMode, 'roots');
  const state = { ...reduce(createRun(c), { type: 'START' }).state, hintLevel: 1 };
  const frame = frameAt(state, { phase: 'countIn', beat: 0, activeStartBeat: 4 });
  const anchors = frame.notes.filter(n => n.anchor);
  assert.ok(anchors.length > 0);
  assert.equal(anchors.every(n => n.iv === 0), true, 'roots only on a whole-neck run');
  assert.equal(frame.notes.every(n => n.anchor || n.target), true);
  for (const n of frame.notes) assert.equal(n.open, n.f === 0);
});

test('CR-01: Anchors keeps open roots on screen as rings while the LEDs stay fretted', () => {
  for (const positionId of ['s6f0', 'all']) {
    const c = buildScaleRunChart({ scaleId: 'minPent', keyPc: 4, positionId, direction: 'up', bpm: 80 });
    const live = { ...reduce(createRun(c), { type: 'START', at: 1000 }).state, hintLevel: 1 };
    const frames = [frameAt(live, { phase: 'countIn', beat: 0, activeStartBeat: c.countInBeats })];
    for (let beat = c.countInBeats; beat < c.countInBeats + c.steps.length; beat++) {
      frames.push(frameAt({ ...live, phase: 'active', beat }, { phase: 'active', beat }));
    }
    for (const frame of frames) {
      const keys = frame.notes.map(n => n.s + ':' + n.f);
      for (const key of ['6:0', '1:0']) assert.ok(keys.includes(key), `${positionId} screen keeps open root ${key}`);
      for (const n of frame.notes.filter(n => n.f === 0 && n.iv === 0)) {
        assert.equal(n.open, true);
        assert.equal(n.anchor, true);
      }
      assert.equal(frame.led.some(n => n.f === 0), false, `${positionId} led never holds fret 0`);
    }
  }
});

test('summarize returns the one RunSummary shape with explicit nulls', () => {
  const c = chart();
  const review = reduce(active(c, 4), { type: 'FINISH', at: 4000 }).state;
  const stopped = reduce(review, { type: 'END_DRILL', at: 4000 }).state;
  const summary = summarize(stopped);
  assert.equal(summary.drillId, c.id);
  assert.equal(summary.kind, 'scaleRun');
  assert.equal(summary.chartId, c.id);
  assert.equal(summary.plannedSteps, c.steps.length);
  assert.equal(summary.completedSteps, c.steps.length);
  assert.equal(summary.bpm, 80);
  assert.equal(summary.beatsPerBar, 4);
  assert.equal(summary.direction, 'up');
  assert.equal(summary.hintLevel, 0);
  assert.equal(summary.micUsed, false);
  assert.equal(summary.correct, null);
  assert.equal(summary.misses, null);
  assert.equal(summary.accuracy, null);
  assert.deepEqual(summary.timing, { medianMs: null, meanAbsMs: null, onTimeRate: null });
  assert.equal(summary.selfReport, null);
  assert.equal(summary.cleanReps, null);
  assert.equal(summary.passes.length, 1);
  assert.deepEqual(summary.recall, { attempted: false, completed: false, selfReport: null, bpm: 80 });
  assert.equal(summary.unguidedMs, 0);
  assert.equal(summary.sessionId, null);
  assert.equal(summary.startedWallAt, null);
  assert.equal(summary.endedWallAt, null);
  assert.equal(summary.completed, false);
  assert.equal(summary.stoppedEarly, true);
  assert.deepEqual(summary.content, c.content);
  assert.equal(summary.durationMs, 3000);

  const cleanState = reduce(review, { type: 'SELF_REPORT', clean: true }).state;
  const clean = summarize(cleanState, { sessionCleanReps: 1 });
  assert.equal(clean.selfReport, 'clean');
  assert.equal(clean.cleanReps, 1);
  assert.equal(clean.passes[0].selfReport, 'clean');
  assert.notEqual(clean.passes[0], cleanState.passes[0], 'the summary copies pass records');

  const shaky = summarize(reduce(review, { type: 'SELF_REPORT', clean: false }).state, { sessionCleanReps: 0 });
  assert.equal(shaky.selfReport, 'shaky');
  assert.equal(shaky.cleanReps, 0);

  const stoppedEarly = summarize(reduce(active(c, 8), { type: 'STOP', at: 2500 }).state);
  assert.equal(stoppedEarly.completed, false);
  assert.equal(stoppedEarly.stoppedEarly, true);
  assert.ok(stoppedEarly.completedSteps < stoppedEarly.plannedSteps);

  const idle = summarize(createRun(c));
  assert.equal(idle.completedSteps, 0);
  assert.equal(idle.durationMs, Math.round(c.totalBeats * 0.75 * 1000));
});

// ---------- 02-02: the mandatory recall pass and the drill aggregate ----------
function finishPass(state, c, { clean = true, beat = 4 } = {}) {
  let next = reduce({ ...state, phase: 'active', beat }, { type: 'FINISH', at: 4000 }).state;
  if (clean !== null) next = reduce(next, { type: 'SELF_REPORT', clean }).state;
  return next;
}

function climbToRecall(c) {
  let state = started(c);
  for (let level = 0; level < 3; level++) {
    for (let pass = 0; pass < 3; pass++) {
      state = finishPass(state, c, { clean: true });
      state = reduce(state, { type: 'NEXT_PASS' }).state;
    }
  }
  return state;
}

test('three clean passes at every level lead into the mandatory recall pass', () => {
  const c = chart();
  const atRecall = climbToRecall(c);
  assert.equal(atRecall.phase, 'countIn');
  assert.equal(atRecall.hintLevel, 3, 'the ladder ends on No lights');
  assert.equal(atRecall.plan.passIndex, 10, 'nine with-hints passes precede the recall');
  assert.deepEqual(atRecall.recall, { attempted: true, completed: false, selfReport: null, bpm: 80 });
  assert.equal(atRecall.passes.length, 9);
  assert.equal(atRecall.passes.every(pass => pass.selfReport === 'clean'), true);
});

// WR-03: the pass counter must show the honest ten-pass plan for the whole happy
// path, not a 4-to-10 ramp that only converges on the final pass.
test('the happy path shows a ten-pass plan on every pass', () => {
  const c = chart();
  let state = started(c);
  const plans = [];
  for (let pass = 0; pass < 10; pass++) {
    plans.push({ passIndex: state.plan.passIndex, totalPasses: state.plan.totalPasses });
    state = finishPass(state, c, { clean: true });
    if (state.phase === 'result') break;
    state = reduce(state, { type: 'NEXT_PASS' }).state;
  }
  assert.deepEqual(plans.map(p => p.passIndex), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(plans.every(p => p.totalPasses === 10), true, 'the estimate never drifts from the plan');
  assert.equal(state.phase, 'result');
  assert.equal(state.completed, true);
});

test('FINISH on the recall pass reaches the result and only a clean report masters it', () => {
  const c = chart();
  const atRecall = climbToRecall(c);
  const finished = reduce({ ...atRecall, phase: 'active', beat: 4 }, { type: 'FINISH', at: 9000 }).state;
  assert.equal(finished.phase, 'result', 'the recall closes the drill, not a pass review');
  assert.equal(finished.completed, true);
  assert.equal(finished.stoppedEarly, false);
  assert.equal(finished.recall.attempted, true);
  assert.equal(finished.recall.completed, true);
  assert.equal(finished.recall.selfReport, null);
  assert.equal(finished.passes.length, 10);
  assert.equal(finished.passes[9].hintLevel, 3);
  assert.equal(finished.passes[9].selfReport, null);
  assert.equal(summarizeDrill(finished).mastered, false, 'a completed recall without a report is not mastery');

  const reported = reduce(finished, { type: 'SELF_REPORT', clean: true }).state;
  assert.equal(reported.recall.selfReport, 'clean');
  assert.equal(reported.selfReport, 'clean');
  assert.equal(reported.passes.length, 10, 'the report never appends a second pass');
  assert.equal(reported.passes[9].selfReport, 'clean');
  assert.equal(reported.passes[9].unguidedMs, Math.round(c.steps.length * 60000 / 80));
  assert.equal(summarizeDrill(reported).mastered, true);

  const shaky = reduce(finished, { type: 'SELF_REPORT', clean: false }).state;
  assert.equal(shaky.passes[9].unguidedMs, 0);
  assert.equal(summarizeDrill(shaky).mastered, false);
});

test('a drill that ends before the recall never reports completed', () => {
  const c = chart();
  const review = finishPass(started(c), c, { clean: true });
  assert.equal(review.phase, 'passReview');
  const ended = reduce(review, { type: 'END_DRILL', at: 5000 }).state;
  const summary = summarizeDrill(ended);
  assert.equal(summary.completed, false);
  assert.equal(summary.stoppedEarly, true);
  assert.equal(summary.recall.completed, false);
  assert.equal(summary.mastered, false);
  assert.equal(summary.withHints.passes.length, 1);
});

test('STOP during the recall is a stopped-early result with a partial pass and no mastery', () => {
  const c = chart();
  const atRecall = climbToRecall(c);
  const stopped = reduce({ ...atRecall, phase: 'active', beat: 6 }, { type: 'STOP', at: 20000 }).state;
  assert.equal(stopped.phase, 'result');
  assert.equal(stopped.completed, false);
  assert.equal(stopped.stoppedEarly, true);
  assert.equal(stopped.recall.attempted, true);
  assert.equal(stopped.recall.completed, false);
  assert.equal(stopped.passes.length, 10, 'the in-flight recall is recorded as a partial');
  const partial = stopped.passes[9];
  assert.equal(partial.hintLevel, 3);
  assert.ok(partial.completedSteps < partial.plannedSteps);
  assert.equal(partial.aborted, false);
  const summary = summarizeDrill(stopped);
  assert.equal(summary.mastered, false);
  assert.equal(summary.unguidedMs, 0);
  assert.equal(summary.withHints.passes.length, 9, 'the partial recall is not a with-hints pass');
  assert.ok(summary.activeMs > 0, 'the partial pass still contributes active time');
});

test('summarizeDrill exposes the with-hints plane and the recall attempt separately', () => {
  const c = chart();
  const atRecall = climbToRecall(c);
  const reported = reduce(
    reduce({ ...atRecall, phase: 'active', beat: 4 }, { type: 'FINISH', at: 9000 }).state,
    { type: 'SELF_REPORT', clean: true },
  ).state;
  const summary = summarizeDrill(reported);
  assert.equal(summary.skillId, c.id);
  assert.equal(summary.chartId, c.id);
  assert.equal(summary.withHints.passes.length, 9);
  assert.equal(summary.withHints.clean, 9);
  assert.equal(summary.withHints.endedAtLevel, 2, 'the with-hints portion ended at Hint on demand');
  assert.equal(summary.recall.attempted, true);
  assert.equal(summary.recall.completed, true);
  assert.equal(summary.recall.selfReport, 'clean');
  assert.equal(summary.unguidedMs, Math.round(c.steps.length * 60000 / 80));
  assert.ok(summary.activeMs > summary.unguidedMs, 'guided passes count as practice time');
  assert.equal(summary.mastered, true);
  assert.equal(summary.selfReport, 'clean');
});

test('withHints.passes excludes aborted, partial and recall records', () => {
  const c = chart();
  const pass = (hintLevel, extra = {}) => ({
    index: 1,
    hintLevel,
    bpm: 80,
    completedSteps: c.steps.length,
    plannedSteps: c.steps.length,
    selfReport: 'clean',
    unguidedMs: 0,
    aborted: false,
    reasonKey: null,
    ...extra,
  });
  const state = {
    ...createRun(c),
    phase: 'result',
    passes: [
      pass(0),
      pass(1, { aborted: true, reasonKey: 'asked' }),
      pass(2, { completedSteps: 3 }),
      pass(2),
      pass(3),
    ],
    recall: { attempted: true, completed: true, selfReport: 'clean', bpm: 80 },
  };
  const summary = summarizeDrill(state);
  assert.deepEqual(summary.withHints.passes.map(p => p.hintLevel), [0, 2]);
  assert.equal(summary.withHints.clean, 2);
  assert.equal(summary.withHints.endedAtLevel, 2);
  assert.equal(summary.unguidedMs, Math.round(c.steps.length * 60000 / 80));
});

test('the canonical pass template carries unguidedMs and reasonKey, not derived names', () => {
  const c = chart();
  const review = finishPass(started(c), c, { clean: true });
  const keys = Object.keys(review.passes[0]).sort();
  assert.deepEqual(keys, [
    'aborted', 'activeMs', 'assessment', 'bpm', 'brightened', 'completedSteps', 'hintLevel', 'index', 'plannedSteps',
    'reasonKey', 'selfReport', 'unguidedMs',
  ]);
  assert.equal(Object.hasOwn(review.passes[0], 'completed'), false);
});

// ---------- 02-02: hint requests never change the lit set mid-phrase ----------
test('FLASH is legal only at Hint on demand during count-in or active', () => {
  const c = chart();
  const h2 = { ...started(c), hintLevel: 2 };
  const flashed = reduce(h2, { type: 'FLASH', beat: 4.2 });
  assert.equal(flashed.state.phase, 'countIn');
  assert.equal(flashed.state.flashUntilBeat, 5.2, 'exactly one beat from the request');
  assert.deepEqual(flashed.effects, [], 'a flash is a scene change, not a transport effect');

  const noBeat = reduce({ ...h2, beat: 4.5 }, { type: 'FLASH' });
  assert.equal(noBeat.state.flashUntilBeat, 5.5, 'falls back to the current beat');

  for (const hintLevel of [0, 1, 3]) {
    const state = { ...h2, hintLevel };
    assert.equal(reduce(state, { type: 'FLASH', beat: 4 }).state, state, `level ${hintLevel} must ignore FLASH`);
  }
  for (const phase of ['paused', 'passReview', 'result']) {
    const state = { ...h2, phase };
    assert.equal(reduce(state, { type: 'FLASH', beat: 4 }).state, state, `${phase} must ignore FLASH`);
  }
});

test('the flash lasts exactly one beat and never changes the notes or the target', () => {
  const c = chart();
  const h2 = { ...started(c), hintLevel: 2, phase: 'active', beat: 4.2 };
  const before = frameAt(h2, { phase: 'active', beat: 4.2, activeStartBeat: 4 });
  const flashed = reduce(h2, { type: 'FLASH', beat: 4.2 }).state;
  const during = frameAt(flashed, { phase: 'active', beat: 4.2, activeStartBeat: 4 });
  assert.equal(during.flash, true);
  assert.deepEqual(during.notes, before.notes, 'the screen set is untouched');
  assert.deepEqual(during.target, before.target);
  assert.equal(during.blink, before.blink);
  assert.equal(frameAt(flashed, { phase: 'active', beat: 5.2, activeStartBeat: 4 }).flash, false);
  assert.equal(frameAt({ ...flashed, hintLevel: 1 }, { phase: 'active', beat: 4.3, activeStartBeat: 4 }).flash, false);
  assert.equal(frameAt({ ...flashed, hintLevel: 3 }, { phase: 'active', beat: 4.3, activeStartBeat: 4 }).flash, false);
});

test('every pass boundary clears the flash so a pause never re-opens it', () => {
  const c = chart();
  const flashed = reduce({ ...started(c), hintLevel: 2 }, { type: 'FLASH', beat: 4.2 }).state;
  assert.equal(flashed.flashUntilBeat, 5.2);
  const paused = reduce({ ...flashed, phase: 'active', beat: 4.2 }, { type: 'PAUSE', reason: 'user', beat: 4.2 }).state;
  const cases = [
    paused,
    reduce(paused, { type: 'RESUME' }).state,
    reduce({ ...flashed, phase: 'active' }, { type: 'RESTART' }).state,
    reduce({ ...flashed, phase: 'active' }, { type: 'STOP' }).state,
    reduce({ ...flashed, phase: 'active' }, { type: 'FINISH' }).state,
    reduce({ ...flashed, phase: 'passReview' }, { type: 'NEXT_PASS' }).state,
    reduce({ ...flashed, phase: 'passReview' }, { type: 'END_DRILL' }).state,
  ];
  for (const state of cases) assert.equal(state.flashUntilBeat, 0);
});

// ---------- Phase 3: wait mode, stepIndexFor and the quiz chart (03-01) ----------
// One step per bar, eight steps: the case where a beat count and a step count differ.
function barChart(steps = 8, overrides = {}) {
  const targets = Array.from({ length: steps }, (_, i) => ({
    s: (i % 6) + 1, f: i + 1, midi: 60 + i, iv: i % 12,
  }));
  return {
    id: 'chordChanges:test:0:all',
    kind: 'chordChanges',
    family: 'chordChanges',
    timed: true,
    bpm: 60,
    beatsPerBar: 4,
    countInBeats: 4,
    direction: 'up',
    content: { scaleId: 'major', keyPc: 0, positionId: 'all' },
    anchorMode: 'box',
    steps: targets.map((target, index) => ({ index, beat: 4 + index * 4, target })),
    shape: targets.map(t => ({ ...t })),
    audioEvents: [],
    totalBeats: 4 + steps * 4,
    ...overrides,
  };
}

// Twelve hand-built questions: the engine only reads the target and the mode, so the
// generator stays out of the engine suite and this file stays tier-0 pure.
function quizQuestions(count = 12) {
  return Array.from({ length: count }, (_, i) => {
    const f = (i % 9) + 1;
    const chips = [f, 10, 11, 12].map(n => ({ value: n, label: `Fret ${n}` }));
    return {
      index: i,
      kind: 'note',
      mode: 'find',
      prompt: `Find A on string ${(i % 6) + 1}`,
      poolLabel: 'A minor pentatonic · Position 1',
      target: { s: (i % 6) + 1, f, midi: 60 + i, iv: i % 12 },
      chips,
      findChips: chips,
      answerChip: `Fret ${f}`,
      noteName: 'A',
      degreeLabel: '1',
      intervalName: 'Root',
      rootName: 'A',
    };
  });
}

const quizChart = (overrides = {}) => buildNoteQuizChart({
  scaleId: 'minPent', keyPc: 9, positionId: 's6f0', questions: quizQuestions(), ...overrides,
});

test('stepIndexFor returns the last step at or before the beat', () => {
  const c = barChart(8);
  const beats = [4, 5, 6, 7, 8, 9, 10, 11];
  assert.deepEqual(beats.map(beat => stepIndexFor(c, beat)), [0, 0, 0, 0, 1, 1, 1, 1]);
  assert.equal(stepIndexFor(c, 12), 2);
  assert.equal(stepIndexFor(c, 36), 7, 'the final step holds to the end of the chart');
  assert.equal(stepIndexFor(c, 0), 0, 'before the first step the answer is 0');
  assert.equal(stepIndexFor(c, 3.9), 0);
  assert.equal(stepIndexFor(c, NaN), 0);
  assert.equal(stepIndexFor({ ...c, timed: false }, 12), 0, 'a wait chart always reads step 0');
  assert.equal(stepIndexFor({ ...c, steps: [] }, 12), 0);
});

test('stepIndexFor matches the historic beat arithmetic on every scale chart', () => {
  const c = chart();
  const last = c.steps.length - 1;
  for (let beat = c.countInBeats; beat < c.countInBeats + c.steps.length; beat += 0.25) {
    const historic = Math.max(0, Math.min(last, Math.floor(beat - c.countInBeats)));
    assert.equal(stepIndexFor(c, beat), historic, `beat ${beat}`);
  }
  assert.deepEqual(c.steps.map(step => stepIndexFor(c, step.beat)), c.steps.map((_, i) => i));
  const all = buildScaleRunChart({ ...instance, positionId: 'all', direction: 'updown' });
  assert.deepEqual(all.steps.map(step => stepIndexFor(all, step.beat)), all.steps.map((_, i) => i));
});

test('TICK, PAUSE and RESUME all land on the stepIndexFor step', () => {
  const c = barChart(8);
  let state = reduce(createRun(c), { type: 'START', at: 1000 }).state;
  state = reduce(state, { type: 'TICK', beat: 4 }).state;
  assert.equal(state.phase, 'active');
  assert.equal(state.stepIndex, 0);
  state = reduce(state, { type: 'TICK', beat: 8 }).state;
  assert.equal(state.stepIndex, 1, 'the second bar, not the fourth beat');
  const paused = reduce(state, { type: 'PAUSE', beat: 8, reason: 'user' }).state;
  assert.equal(paused.stepIndex, 1);
  const resumed = reduce(paused, { type: 'RESUME' }).state;
  assert.equal(resumed.stepIndex, 1);
  assert.equal(resumed.phase, 'countIn');

  // A mid-bar pause resumes at the bar start and keeps the same step.
  let round = reduce(reduce(createRun(c), { type: 'START' }).state, { type: 'TICK', beat: 4 }).state;
  round = reduce(round, { type: 'TICK', beat: 10.5 }).state;
  assert.equal(round.stepIndex, 1);
  round = reduce(round, { type: 'PAUSE', beat: 10.5, reason: 'hidden' }).state;
  assert.equal(round.stepIndex, 1);
  assert.equal(round.resumeFromBeat, 8);
  round = reduce(round, { type: 'RESUME' }).state;
  assert.equal(round.stepIndex, 1);
});

test('frameAt derives the count-in and active target from stepIndexFor', () => {
  const c = barChart(8);
  const state = createRun(c);
  const countInFrame = frameAt({ ...state, phase: 'countIn' }, { phase: 'countIn', beat: 0, activeStartBeat: 12 });
  assert.deepEqual(countInFrame.target, c.steps[2].target);

  const activeFrame = frameAt({ ...state, phase: 'active' }, { phase: 'active', beat: 8 });
  assert.equal(activeFrame.stepNumber, 2);
  assert.deepEqual(activeFrame.target, c.steps[1].target);
  assert.equal(activeFrame.totalSteps, 8);
});

test('STOP records steps, not beats, on a one-step-per-bar chart', () => {
  const c = barChart(8);
  let state = reduce(createRun(c), { type: 'START', at: 1000 }).state;
  state = reduce(state, { type: 'TICK', beat: 12 }).state;
  const stopped = reduce(state, { type: 'STOP', at: 5000 }).state;
  assert.equal(stopped.phase, 'result');
  const partial = stopped.passes[stopped.passes.length - 1];
  assert.equal(partial.completedSteps, 2, 'two bars played is two steps, never eight beats');
  assert.equal(partial.plannedSteps, 8);
  assert.equal(partial.aborted, false);
});

test('every chart carries its family identity and its clock flag', () => {
  const scale = chart();
  assert.equal(scale.family, 'scaleRun');
  assert.equal(scale.timed, true);
  const quiz = quizChart();
  assert.equal(quiz.family, 'findNote');
  assert.equal(quiz.kind, 'findNote');
  assert.equal(quiz.timed, false);
});

test('buildNoteQuizChart has no clock, no count-in and one step per question', () => {
  const c = quizChart();
  assert.equal(c.id, 'findNote:minPent:9:s6f0');
  assert.equal(c.bpm, 0);
  assert.equal(c.countInBeats, 0);
  assert.equal(c.totalBeats, 0);
  assert.equal(c.beatsPerBar, 4);
  assert.equal(c.anchorMode, 'box');
  assert.deepEqual(c.audioEvents, []);
  assert.equal(c.questions.length, 12);
  assert.equal(c.steps.length, 12);
  assert.deepEqual(c.steps.map(s => s.beat), c.steps.map(() => null));
  assert.deepEqual(c.steps.map(s => s.target), c.questions.map(q => q.target));
  assert.deepEqual(c.content, { scaleId: 'minPent', keyPc: 9, positionId: 's6f0', quizQuestion: 'note', quizMode: 'find' });
  // The skill id carries no kind or mode, so switching Ask for never forks the record.
  assert.equal(quizChart({ quizQuestion: 'degree', quizMode: 'name' }).id, c.id);
  assert.equal(quizChart({ startLevel: 9 }).startLevel, 2);
});

test('createRun seeds the question plan from the chart, as an independent copy', () => {
  const c = quizChart();
  const run = createRun(c);
  assert.equal(run.questions.length, 12);
  assert.notEqual(run.questions, c.questions, 'the run owns its own array');
  run.questions.push({ index: 99 });
  assert.equal(c.questions.length, 12);
  assert.equal(run.questionIndex, 0);
  assert.deepEqual(run.questionOutcomes, []);
  assert.equal(run.changes, null);
  assert.equal(run.pair, null);
  assert.equal(run.syncScore, null);
  // Every other family keeps the empty plan rather than a missing field.
  assert.deepEqual(createRun(chart()).questions, []);
});

test('a wait-mode pass starts, pauses, resumes and restarts with no transport', () => {
  const c = quizChart();
  const first = reduce(createRun(c), { type: 'START', at: 1000 });
  assert.equal(first.state.phase, 'active', 'no count-in');
  assert.deepEqual(first.effects.map(e => e.type), ['announce']);
  assert.equal(first.effects[0].key, 'question');
  assert.equal(first.state.beat, 0);
  assert.equal(first.state.stepIndex, 0);
  assert.equal(first.state.questionIndex, 0);
  assert.equal(first.state.resumeFromBeat, 0);
  assert.equal(first.state.activeStartBeat, 0);

  let state = first.state;
  for (let i = 0; i < 3; i++) {
    state = reduce(state, { type: 'ANSWER', index: i, correct: i === 0 }).state;
    state = reduce(state, { type: 'NEXT_QUESTION' }).state;
  }
  assert.equal(state.questionIndex, 3);
  assert.equal(state.stepIndex, 3);

  const paused = reduce(state, { type: 'PAUSE', reason: 'user' });
  assert.equal(paused.state.phase, 'paused');
  assert.equal(paused.state.pausedBeat, 0, 'a wait chart never reads a transport beat');
  assert.equal(paused.state.resumeFromBeat, 0);
  assert.equal(paused.state.stepIndex, 3, 'pausing keeps the question position');
  assert.ok(!paused.effects.some(e => e.type === 'startTransport'));

  const resumed = reduce(paused.state, { type: 'RESUME' });
  assert.equal(resumed.state.phase, 'active');
  assert.equal(resumed.state.questionIndex, 3);
  assert.deepEqual(resumed.effects.map(e => e.type), ['announce']);
  assert.ok(!resumed.effects.some(e => e.type === 'startTransport'));

  const restarted = reduce(resumed.state, { type: 'RESTART', at: 2000 });
  assert.equal(restarted.state.phase, 'active');
  assert.equal(restarted.state.questionIndex, 0, 'Restart returns to question 1 of the same pass');
  assert.equal(restarted.state.stepIndex, 0);
  assert.deepEqual(restarted.state.questionOutcomes, []);
  assert.equal(restarted.state.plan.passIndex, 1);
  assert.deepEqual(restarted.effects.map(e => e.type), ['announce']);
  assert.equal(restarted.effects[0].key, 'question');

  // A timed chart still counts in and still asks the transport to start.
  const timed = reduce(createRun(chart()), { type: 'START', at: 1000 });
  assert.equal(timed.state.phase, 'countIn');
  assert.deepEqual(timed.effects.map(e => e.type), ['startTransport', 'announce']);
});

test('a wait-mode question takes exactly one answer and a reveal stamps revealed', () => {
  const c = quizChart();
  const idle = createRun(c);
  const state = reduce(idle, { type: 'START' }).state;

  const answered = reduce(state, { type: 'ANSWER', index: 0, answer: { s: 1, f: 1 }, source: 'chip', correct: false, at: 1 });
  assert.deepEqual(answered.effects, [], 'an answer never moves the transport');
  assert.equal(answered.state.questionOutcomes[0], 'wrong');
  assert.equal(answered.state.questionIndex, 0, 'the pass waits for Next question');

  // T-03-01: a second source cannot overwrite a recorded outcome.
  const second = reduce(answered.state, { type: 'ANSWER', index: 0, answer: { s: 1, f: 1 }, source: 'board', correct: true, at: 2 });
  assert.equal(second.state.questionOutcomes[0], 'wrong');
  assert.deepEqual(second.effects, []);
  assert.equal(second.state.questionIndex, 0);

  const revealed = reduce(state, { type: 'REVEAL', index: 0 });
  assert.deepEqual(revealed.effects, []);
  assert.equal(revealed.state.questionOutcomes[0], 'revealed');
  const afterReveal = reduce(revealed.state, { type: 'ANSWER', index: 0, correct: true });
  assert.equal(afterReveal.state.questionOutcomes[0], 'revealed', 'a reveal is final for the question');

  // NEXT_QUESTION is illegal until the open question has an outcome.
  const early = reduce(state, { type: 'NEXT_QUESTION' });
  assert.equal(early.state.questionIndex, 0);
  assert.deepEqual(early.effects, []);

  // Out-of-range indices never throw and never move the run.
  assert.equal(reduce(state, { type: 'ANSWER', index: 99, correct: true }).state, state);
  assert.equal(reduce(state, { type: 'REVEAL', index: -1 }).state, state);

  // The same events are inert on a timed chart.
  const timed = started(chart());
  assert.equal(reduce(timed, { type: 'ANSWER', index: 0, correct: true }).state, timed);
  assert.equal(reduce(timed, { type: 'REVEAL', index: 0 }).state, timed);
  assert.equal(reduce(timed, { type: 'NEXT_QUESTION' }).state, timed);
});

test('twelve answers and twelve NEXT_QUESTION events end a wait-mode pass at the review', () => {
  const c = quizChart();
  let state = reduce(createRun(c), { type: 'START', at: 1000 }).state;
  const transport = [];
  for (let i = 0; i < 12; i++) {
    const answered = reduce(state, { type: 'ANSWER', index: i, correct: true, at: 2000 + i });
    assert.deepEqual(answered.effects, []);
    state = answered.state;
    assert.equal(state.questionOutcomes[i], 'correct');

    const next = reduce(state, { type: 'NEXT_QUESTION', at: 3000 + i, wallAt: 1700000000000 + i });
    transport.push(...next.effects.map(e => e.type));
    state = next.state;
    if (i < 11) {
      assert.equal(state.phase, 'active');
      assert.equal(state.questionIndex, i + 1);
      assert.equal(state.stepIndex, i + 1);
      assert.deepEqual(next.effects.map(e => e.type), ['announce']);
      assert.equal(next.effects[0].key, 'question');
    }
  }
  assert.equal(state.phase, 'passReview');
  assert.equal(state.completed, false);
  assert.equal(state.passes.length, 1);
  assert.equal(state.passes[0].completedSteps, 12);
  assert.equal(state.passes[0].plannedSteps, 12);
  assert.deepEqual(transport, [
    ...Array.from({ length: 11 }, () => 'announce'),
    'stopTransport', 'zeroLeds', 'announce',
  ]);
  assert.ok(!transport.includes('startTransport'), 'no transport ever started');

  const summary = summarizeDrill(state);
  assert.equal(summary.questions.planned, 12);
  assert.equal(summary.questions.answered, 12);
  assert.equal(summary.questions.correct, 12);
  assert.equal(summary.questions.revealed, 0);
  assert.equal(summary.questions.skipped, 0);
  assert.equal(summary.bpm, 0);

  // The boundary then offers the next pass, which re-enters the drill with no count-in.
  const nextPass = reduce(state, { type: 'NEXT_PASS' }).state;
  assert.equal(nextPass.phase, 'active');
  assert.equal(nextPass.questionIndex, 0);
  assert.deepEqual(nextPass.questionOutcomes, []);
});

const QUIZ_SCORE = {
  onsets: 12,
  hits: 9,
  planned: 12,
  correct: 9,
  rootsOnPitch: 0,
  rootsChecked: 0,
  accuracy: null,
  timing: { medianMs: null, meanAbsMs: null, onTimeRate: null },
  perStep: [],
};

test('FINISH and STOP stamp the score the composition root computed, and summarizeDrill returns it', () => {
  const finished = reduce(active(chart()), {
    type: 'FINISH', at: 5000, wallAt: 1700000000000, syncScore: QUIZ_SCORE,
  });
  assert.equal(finished.state.phase, 'passReview');
  assert.deepEqual(finished.state.syncScore, QUIZ_SCORE);
  const summary = summarizeDrill(finished.state);
  assert.deepEqual(summary.syncScore, QUIZ_SCORE);
  assert.equal(summary.micUsed, true, 'a scored pass reports mic evidence');

  const stopped = reduce(active(chart(), 6), {
    type: 'STOP', at: 6000, wallAt: 1700000000000, syncScore: QUIZ_SCORE,
  });
  assert.equal(stopped.state.phase, 'result');
  assert.deepEqual(stopped.state.syncScore, QUIZ_SCORE);
  assert.equal(summarize(stopped.state).micUsed, true);

  // An unscored pass stamps null and is never reported as a zero.
  const unscored = reduce(active(chart()), { type: 'FINISH', at: 5000, syncScore: null });
  assert.equal(unscored.state.syncScore, null);
  assert.equal(summarizeDrill(unscored.state).micUsed, false);
  // An event that carries no score keeps what the pass already had, never `undefined`.
  const kept = reduce({ ...unscored.state, syncScore: QUIZ_SCORE }, { type: 'NEXT_PASS' });
  assert.equal(kept.state.syncScore, null, 'a new pass starts unscored');
});

test('the NEXT_QUESTION that closes a quiz pass carries syncScore instead of dropping it', () => {
  const c = quizChart();
  let state = reduce(createRun(c), { type: 'START', at: 1000 }).state;
  for (let i = 0; i < 11; i++) {
    state = reduce(state, { type: 'ANSWER', index: i, correct: true, at: 2000 + i }).state;
    state = reduce(state, { type: 'NEXT_QUESTION', at: 3000 + i, wallAt: 1700000000000 + i }).state;
  }
  assert.equal(state.syncScore, null, 'no earlier question closes the pass');
  state = reduce(state, { type: 'ANSWER', index: 11, correct: true, at: 4000 }).state;
  const closing = reduce(state, {
    type: 'NEXT_QUESTION', at: 5000, wallAt: 1700000001000, syncScore: QUIZ_SCORE,
  });
  assert.equal(closing.state.phase, 'passReview', 'the twelfth answer closes the pass');
  assert.deepEqual(closing.state.syncScore, QUIZ_SCORE, 'the closing event hands its score to the inner FINISH');
  const summary = summarizeDrill(closing.state);
  assert.equal(summary.micUsed, true);
  assert.deepEqual(summary.syncScore, QUIZ_SCORE);

  // Without a score on the closing event the pass stays unscored — no half-filled zero.
  let bare = reduce(createRun(c), { type: 'START' }).state;
  for (let i = 0; i < 12; i++) {
    bare = reduce(bare, { type: 'ANSWER', index: i, correct: false }).state;
    bare = reduce(bare, { type: 'NEXT_QUESTION' }).state;
  }
  assert.equal(bare.phase, 'passReview');
  assert.equal(bare.syncScore, null);
});

test('a mic-sourced answer takes the one commit path and produces the same outcome as a chip answer', () => {
  const c = quizChart();
  const base = reduce(createRun(c), { type: 'START', at: 1000 }).state;
  const chip = reduce(base, {
    type: 'ANSWER', index: 0, answer: { chip: 0 }, source: 'chip', correct: true, at: 2000,
  }).state;
  const mic = reduce(base, {
    type: 'ANSWER', index: 0, answer: { f: 1 }, source: 'mic', correct: true, at: 2000,
  }).state;
  assert.deepEqual(mic.questionOutcomes, chip.questionOutcomes);
  assert.equal(mic.questionOutcomes[0], 'correct');
  assert.equal(mic.questionIndex, chip.questionIndex);
  // One answer per question holds for the mic path too.
  const again = reduce(mic, {
    type: 'ANSWER', index: 0, answer: { f: 2 }, source: 'mic', correct: false, at: 2100,
  }).state;
  assert.deepEqual(again.questionOutcomes, mic.questionOutcomes);
});

test('MARK_HIT credits one step per press in an active scale pass and nothing outside it', () => {
  const c = chart();
  const live = active(c, 4);
  const first = reduce(live, { type: 'MARK_HIT', beat: 4 }).state;
  assert.deepEqual(first.markedHits, [0]);
  const second = reduce(first, { type: 'MARK_HIT', beat: 4 }).state;
  assert.deepEqual(second.markedHits, [0], 'a second press on the same step is ignored');
  const nextStep = reduce(second, { type: 'MARK_HIT', beat: 5 }).state;
  assert.deepEqual(nextStep.markedHits, [0, 1]);

  const idle = reduce(createRun(c), { type: 'MARK_HIT', beat: 4 }).state;
  assert.deepEqual(idle.markedHits, [], 'idle is not a live scale pass');
  const quiz = reduce(reduce(createRun(quizChart()), { type: 'START', at: 1000 }).state, {
    type: 'MARK_HIT', beat: 4,
  }).state;
  assert.deepEqual(quiz.markedHits, [], 'the quiz has no manual hit');
});

test('a reveal counts as answered but never as correct', () => {
  const c = quizChart();
  let state = reduce(createRun(c), { type: 'START' }).state;
  state = reduce(state, { type: 'ANSWER', index: 0, correct: true }).state;
  state = reduce(state, { type: 'NEXT_QUESTION' }).state;
  state = reduce(state, { type: 'REVEAL', index: 1 }).state;
  state = reduce(state, { type: 'NEXT_QUESTION' }).state;
  const summary = summarizeDrill(state).questions;
  assert.equal(summary.answered, 2);
  assert.equal(summary.correct, 1);
  assert.equal(summary.revealed, 1);
  assert.equal(summary.skipped, 10, 'the untouched questions are skipped');
});

test('the by-string plane is six rows in string order with a zero row for an unasked string', () => {
  const c = quizChart();
  let state = reduce(createRun(c), { type: 'START' }).state;
  state = reduce(state, { type: 'ANSWER', index: 0, correct: true }).state;
  state = reduce(state, { type: 'NEXT_QUESTION' }).state;
  state = reduce(state, { type: 'REVEAL', index: 1 }).state;
  const summary = summarizeDrill(state).questions;

  assert.equal(summary.byString.length, 6, 'always six rows');
  assert.deepEqual(summary.byString.map(row => row.s), [1, 2, 3, 4, 5, 6], 'numeric order 1 -> 6');
  const outcomes = state.questionOutcomes;
  const asked = c.questions.map((question, index) => ({ s: question.target.s, outcome: outcomes[index] || null }));
  assert.deepEqual(
    summary.byString,
    [1, 2, 3, 4, 5, 6].map(s => ({
      s,
      asked: asked.filter(row => row.s === s && row.outcome).length,
      correct: asked.filter(row => row.s === s && row.outcome === 'correct').length,
    })),
    'every row is counted from the run own questions and outcomes',
  );
  // Question 1 is correct on string 1; question 2 is revealed on string 2.
  assert.deepEqual(summary.byString[0], { s: 1, asked: 1, correct: 1 });
  assert.deepEqual(summary.byString[1], { s: 2, asked: 1, correct: 0 }, 'a reveal is asked, never correct');
  assert.equal(summary.byString.reduce((sum, row) => sum + row.asked, 0), summary.answered);
  assert.equal(summary.byString.reduce((sum, row) => sum + row.correct, 0), summary.correct);

  // A short pass leaves whole strings untouched, and they still get a zero row.
  const short = summarizeDrill(reduce(createRun(quizChart({ questions: quizQuestions(3) })), { type: 'START' }).state).questions;
  assert.equal(short.byString.length, 6);
  assert.deepEqual(short.byString.map(row => row.s), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(short.byString[3], { s: 4, asked: 0, correct: 0 }, 'an unasked string keeps a zero row');
  assert.deepEqual(short.byString[5], { s: 6, asked: 0, correct: 0 });
  assert.equal(short.byString.reduce((sum, row) => sum + row.asked, 0), 0);
});


test('summarize of a bpm: 0 chart returns a finite zero duration', () => {
  const c = quizChart();
  const startedState = reduce(createRun(c), { type: 'START', at: 1000 }).state;
  const summary = summarize(startedState);
  assert.equal(summary.bpm, 0);
  assert.ok(Number.isFinite(summary.durationMs), 'a missing tempo never yields NaN');
  assert.equal(summary.durationMs, 0);
  assert.equal(summary.plannedSteps, 12);
  assert.equal(summary.questions.planned, 12);
  assert.equal(summary.questions.answered, 0);

  const noBpm = { ...barChart(2), bpm: undefined };
  const noBpmSummary = summarize(createRun(noBpm));
  assert.ok(Number.isFinite(noBpmSummary.durationMs));
  assert.equal(noBpmSummary.durationMs, 0);
  // A timed chart keeps its beat-derived duration.
  const timedSummary = summarize(createRun(chart()));
  assert.equal(timedSummary.durationMs, Math.round(chart().totalBeats * (60 / 80) * 1000));
});

test('the scale family keeps questions: null so it inherits no quiz metric', () => {
  const state = reduce(active(chart(), 6), { type: 'FINISH' }).state;
  const summary = summarizeDrill(state);
  assert.equal(summary.questions, null);
  assert.equal(summary.plannedSteps, chart().steps.length);
});

// ---------- Phase 3 Task 2: one steady question light and the recall flip ----------
// A Name-mode plan. The engine reads only a question's target and mode, so the generator
// stays out of this suite and the frame matrix is driven by hand-built questions.
const nameQuizChart = (overrides = {}) => buildNoteQuizChart({
  scaleId: 'minPent',
  keyPc: 9,
  positionId: 's6f0',
  questions: quizQuestions().map(question => ({ ...question, mode: 'name', prompt: 'Which note is lit?' })),
  ...overrides,
});

const startQuiz = c => reduce(createRun(c), { type: 'START' }).state;

const ledCell = n => ({ s: n.s, f: n.f, midi: n.midi, iv: n.iv });

// LED bits only: byte 0 is the 0xF1 frame header, not a fret.
const litLedCount = frame => Array.from(frame.slice(1)).reduce((sum, byte) => {
  let bits = 0;
  for (let b = byte; b; b &= b - 1) bits += 1;
  return sum + bits;
}, 0);

test('a Name-mode quiz frame lights exactly the open question at levels 1-3', () => {
  const c = nameQuizChart();
  const state = startQuiz(c);
  const target = c.questions[0].target;
  for (const level of [0, 1, 2]) {
    const frame = frameAt({ ...state, hintLevel: level }, { phase: 'active', beat: 0, mode: 'name' });
    assert.equal(frame.led.length, 1, `level ${level} lights one cell, never a hint set`);
    assert.deepEqual(frame.led[0], ledCell(target), `level ${level} lights the open question`);
    assert.ok(!Object.hasOwn(frame.led[0], 'target'), 'a question light carries no target marker');
    assert.equal(frame.blink, false, 'the question light never blinks');
    assert.equal(frame.stepNumber, 1);
    assert.equal(frame.totalSteps, 12);
  }
  // The column follows the open question, not the first one in the plan.
  const second = frameAt({ ...state, questionIndex: 1, hintLevel: 2 }, { phase: 'active', beat: 0, mode: 'name' });
  assert.deepEqual(second.led, [ledCell(c.questions[1].target)]);
});

test('the level-4 recall frame is empty in both quiz directions', () => {
  for (const c of [nameQuizChart(), quizChart()]) {
    const state = startQuiz(c);
    for (const mode of ['name', 'find']) {
      const frame = frameAt({ ...state, hintLevel: 3 }, { phase: 'active', beat: 0, mode });
      assert.deepEqual(frame.led, [], `a ${mode}-framed recall pass lights nothing`);
      assert.deepEqual(frame.notes, [], `a ${mode}-framed recall pass shows no dot`);
    }
  }
});

test('a Find-mode quiz frame lights the pool, the roots, then nothing', () => {
  const c = quizChart();
  const state = startQuiz(c);
  const pool = litOnly(c.shape).map(ledCell);
  const roots = litOnly(c.shape).filter(n => n.iv === 0).map(ledCell);
  assert.ok(roots.length > 0 && roots.length < pool.length, 'the fixture pool has roots and non-roots');
  const frameAtLevel = level => frameAt({ ...state, hintLevel: level }, { phase: 'active', beat: 0, mode: 'find' });
  assert.deepEqual(frameAtLevel(0).led, pool, 'Full pattern lights the whole pool');
  assert.deepEqual(frameAtLevel(1).led, roots, 'Anchors lights the roots only');
  assert.deepEqual(frameAtLevel(2).led, [], 'Hint on demand lights nothing in Find form');
  assert.deepEqual(frameAtLevel(3).led, []);
});

test('the same question frame holds, byte for byte, between answers', () => {
  const c = nameQuizChart();
  const state = startQuiz(c);
  const once = frameAt({ ...state, hintLevel: 1 }, { phase: 'active', beat: 0, mode: 'name' });
  const twice = frameAt({ ...state, hintLevel: 1 }, { phase: 'active', beat: 0, mode: 'name' });
  assert.deepEqual(twice, once, 'the rAF loop repaints the same frame');
  assert.equal(JSON.stringify(twice), JSON.stringify(once));
  // The scene the composition root builds from that frame is one LED cell and it does
  // not flicker: the same hex on the next beat.
  const scene = () => sceneFromNotes(once.led, { target: once.target, blink: once.blink, flash: [] });
  const first = frameForScene(scene(), 0, 70);
  assert.equal(litLedCount(first), 1, 'the guitar lights exactly one cell');
  assert.equal(frameHex(frameForScene(scene(), 1, 70)), frameHex(first), 'the light holds between beats');
});

// ---------- 03-02 Task 1: the chord-change family (CHORD-02, CHORD-03, CHORD-04) ----------
// One step per bar, eight bars: the chart the chord family runs at the player's tempo.
const chordChart = (overrides = {}) => buildChordChangeChart({ pairId: 'C-G', bpm: 80, ...overrides });

// The synthetic chart the chord tests share: eight one-bar steps, no content lookup.
function syntheticChordChart(bars = 8) {
  const targets = Array.from({ length: bars }, (_, i) => ({
    s: (i % 6) + 1, f: i + 1, midi: 48 + i, iv: 0,
  }));
  return {
    id: 'chordChanges:synthetic',
    kind: 'chordChanges',
    family: 'chordChanges',
    timed: true,
    bpm: 80,
    beatsPerBar: 4,
    countInBeats: 4,
    bars,
    steps: targets.map((target, index) => ({
      index, beat: 4 + index * 4, chordId: 'C', voicingId: 'open', target,
    })),
    shape: targets.map(t => ({ ...t })),
    audioEvents: [],
    totalBeats: 4 + bars * 4,
  };
}

// A chord's lit/screen cells as `s:f` keys, in expansion order. Muted strings are
// dropped here because the chart's LED union never lights one.
const cellsOf = id => expandChord(chordById[id].voicings[0])
  .filter(n => !n.muted)
  .map(n => `${n.s}:${n.f}`);
const keysOf = notes => (notes || []).map(n => `${n.s}:${n.f}`);
// FADE-11: a chord's Anchors LED set is its roots plus its bass, open strings dropped.
const chordAnchorKeys = id => {
  const chord = chordById[id];
  const cells = expandChord(chord.voicings[0])
    .filter(n => !n.muted)
    .map(n => ({ s: n.s, f: n.f, midi: n.midi, iv: ((n.pc - chord.rootPc) % 12 + 12) % 12 }));
  return keysOf(anchorNotes(cells, { chord: true }));
};

const freshChangeRecord = planned => ({
  planned, counted: 0, clean: 0, missed: 0, perBar: [], onsetCounted: false,
  rootsOnPitch: 0, rootsChecked: 0,
});

test('stepIndexFor reads one chord per bar on a synthetic chord chart', () => {
  const c = syntheticChordChart();
  assert.deepEqual([4, 5, 6, 7, 8, 9, 10, 11].map(beat => stepIndexFor(c, beat)), [0, 0, 0, 0, 1, 1, 1, 1]);
  assert.equal(stepIndexFor(c, 12), 2, 'the third bar starts at beat 12');
  assert.equal(stepIndexFor(c, 32), 7);
  assert.equal(stepIndexFor(c, 36), 7, 'the last bar holds to the end of the chart');
  assert.equal(stepIndexFor(c, 3.9), 0, 'the count-in never advances the bar');
  // Every scale chart still matches the historic one-step-per-beat arithmetic.
  const scale = chart();
  const last = scale.steps.length - 1;
  for (let beat = scale.countInBeats; beat < scale.countInBeats + scale.steps.length; beat += 0.25) {
    assert.equal(stepIndexFor(scale, beat), Math.max(0, Math.min(last, Math.floor(beat - scale.countInBeats))), `beat ${beat}`);
  }
});

test('every curated chord pair resolves and builds an eight-bar chart', () => {
  assert.equal(CHORD_PAIRS.length, 11, 'eleven curated entries');
  assert.equal(new Set(CHORD_PAIRS.map(p => p.label)).size, 11, 'every label is its own pair');
  for (const pair of CHORD_PAIRS) {
    assert.match(pair.id, /^[A-Za-z0-9:_-]+$/, `${pair.id} satisfies the persisted-id pattern`);
    assert.equal(chordPairById[pair.id], pair, `${pair.id} resolves through the derived map`);
    // The label is the chord list joined by U+2192 with one space either side, never '->'.
    assert.equal(pair.label, pair.chords.join(' → '), `${pair.id} labels its chords`);
    for (const id of pair.chords) {
      assert.ok(Object.hasOwn(chordById, id), `${pair.id} names ${id}, which chordById defines`);
    }
    const built = buildChordChangeChart({ pairId: pair.id, bpm: 80 });
    assert.equal(built.id, `chordChanges:${pair.id}`);
    assert.equal(built.pair.id, pair.id);
    assert.equal(built.steps.length, 8, `${pair.id} is eight bars`);
    assert.deepEqual(
      built.steps.map(step => step.chordId),
      Array.from({ length: 8 }, (_, i) => pair.chords[i % pair.chords.length]),
      `${pair.id} repeats its loop across the eight bars`,
    );
    assert.ok(built.shape.length > 0 && built.audioEvents.length === built.totalBeats);
  }
  // CONT-01 caps content at the eight existing families: no F, no Bm, no ninth chord.
  assert.deepEqual(
    [...new Set(CHORD_PAIRS.flatMap(pair => pair.chords))].sort(),
    ['A', 'Am', 'C', 'D', 'Dm', 'E', 'Em', 'G'],
  );
});

test('buildChordChangeChart places one step per bar with clicks only and a 36-beat total', () => {
  const c = chordChart();
  assert.equal(c.id, 'chordChanges:C-G');
  assert.equal(c.kind, 'chordChanges');
  assert.equal(c.family, 'chordChanges');
  assert.equal(c.timed, true);
  assert.equal(c.bpm, 80);
  assert.equal(c.beatsPerBar, 4);
  assert.equal(c.countInBeats, 4);
  assert.equal(c.bars, 8);
  assert.equal(c.totalBeats, 36);
  assert.equal(c.anchorMode, 'box');
  assert.deepEqual(c.steps.map(step => step.beat), [4, 8, 12, 16, 20, 24, 28, 32]);
  assert.deepEqual(c.steps.map(step => step.index), Array.from({ length: 8 }, (_, i) => i));
  assert.deepEqual(c.steps.map(step => step.chordId), ['C', 'G', 'C', 'G', 'C', 'G', 'C', 'G']);
  assert.deepEqual(c.content, { pairId: 'C-G', chords: ['C', 'G'] });
  for (const step of c.steps) {
    assert.equal(step.voicingId, 'open', 'every chord uses its open voicing');
    // The target is that bar's own root, so the level filter and the ring still work.
    assert.equal(step.target.iv, 0);
    assert.equal(step.target.midi % 12, chordById[step.chordId].rootPc);
  }
  // One click per beat, accented on the bar line, and never a pluck: the chord drill
  // does not play the answer.
  assert.equal(c.audioEvents.length, 36);
  assert.deepEqual(c.audioEvents.map(e => e.beat), Array.from({ length: 36 }, (_, i) => i));
  for (const e of c.audioEvents) {
    assert.equal(e.type, 'click');
    // The accent is the bar line of the chart's own meter, never a hard-coded four.
    assert.equal(e.accent, e.beat % c.beatsPerBar === 0);
  }
  assert.equal(c.audioEvents.filter(e => e.type === 'pluck').length, 0);
  // The shape is the deduplicated union of both voicings, with muted strings dropped.
  const keys = keysOf(c.shape);
  assert.equal(new Set(keys).size, keys.length, 'no cell appears twice in the union');
  for (const key of [...cellsOf('C'), ...cellsOf('G')]) assert.ok(keys.includes(key), `${key} is in the union`);
  assert.ok(!c.shape.some(n => n.s === 6 && n.f === 0), 'the muted low E of the open C is dropped');
  // The skill id carries neither the tempo nor the bar count: a faster rep is the same skill.
  assert.equal(chordChart({ bpm: 140 }).id, c.id);
  assert.equal(chordChart({ bars: 4 }).id, c.id);
  assert.equal(chordChart({ bars: 4 }).totalBeats, 20);
});

test('buildChordChangeChart clamps the start level and falls back to the first pair', () => {
  assert.equal(chordChart().startLevel, 0);
  assert.equal(chordChart({ startLevel: 1 }).startLevel, 1);
  assert.equal(chordChart({ startLevel: 2 }).startLevel, 2);
  assert.equal(chordChart({ startLevel: 9 }).startLevel, 2, 'never starts in the held zero frame');
  assert.equal(chordChart({ startLevel: -3 }).startLevel, 0);
  const fallback = buildChordChangeChart({ pairId: 'not-a-pair', bpm: 80 });
  assert.equal(fallback.id, `chordChanges:${CHORD_PAIRS[0].id}`);
  assert.deepEqual(fallback.content.chords, CHORD_PAIRS[0].chords);
});

test('createRun seeds the change record and Mark change counts one press per bar', () => {
  const c = chordChart();
  assert.deepEqual(createRun(c).changes, freshChangeRecord(8));
  assert.equal(createRun(chart()).changes, null, 'the scale family carries no change record');

  let state = reduce(createRun(c), { type: 'START', at: 1000 }).state;
  state = reduce(state, { type: 'TICK', beat: 4 }).state;
  assert.equal(state.phase, 'active');
  // The count is pure state: the event emits no effect for main to act on.
  assert.deepEqual(reduce(state, { type: 'MARK_CHANGE', bar: 0 }).effects, []);
  for (let bar = 0; bar < 8; bar++) state = reduce(state, { type: 'MARK_CHANGE', bar }).state;
  assert.equal(state.changes.counted, 8);
  assert.deepEqual(state.changes.perBar, Array.from({ length: 8 }, () => 'clean'));

  // A second press in the same bar changes neither the count nor the record.
  const again = reduce(state, { type: 'MARK_CHANGE', bar: 3 }).state;
  assert.equal(again.changes.counted, 8);
  assert.deepEqual(again.changes.perBar, state.changes.perBar);

  const review = reduce(state, { type: 'FINISH', at: 4000 }).state;
  assert.equal(review.phase, 'passReview');
  assert.equal(review.changes.clean, 8);
  assert.equal(review.changes.missed, 0);
  assert.equal(review.changes.changesPerMin, 20, 'a clean change every bar at 80 BPM in 4/4');
});

test('four marked bars in eight report ten changes a minute and four missed', () => {
  const c = chordChart();
  let state = reduce(reduce(createRun(c), { type: 'START', at: 1000 }).state, { type: 'TICK', beat: 4 }).state;
  for (const bar of [0, 2, 4, 6]) state = reduce(state, { type: 'MARK_CHANGE', bar }).state;
  assert.equal(state.changes.counted, 4);
  const review = reduce(state, { type: 'FINISH', at: 4000 }).state;
  assert.equal(review.changes.clean, 4);
  assert.equal(review.changes.missed, 4);
  assert.equal(review.changes.changesPerMin, 10);

  // STOP closes the pass early against the same plan: two bars reached, two clean.
  let stopped = reduce(reduce(createRun(c), { type: 'START', at: 1000 }).state, { type: 'TICK', beat: 12 }).state;
  for (const bar of [0, 1]) stopped = reduce(stopped, { type: 'MARK_CHANGE', bar }).state;
  stopped = reduce(stopped, { type: 'STOP', at: 9000 }).state;
  assert.equal(stopped.phase, 'result');
  assert.equal(stopped.changes.planned, 8);
  assert.equal(stopped.changes.clean, 2);
  assert.equal(stopped.changes.missed, 6);
  assert.equal(stopped.changes.changesPerMin, 20);
});

test('Mark change is legal only in a live chord pass and reads the bar from the clock', () => {
  const c = chordChart();
  // Idle, the review and the result never count a change.
  assert.equal(reduce(createRun(c), { type: 'MARK_CHANGE', bar: 0 }).state.changes.counted, 0);
  const review = reduce(reduce(reduce(createRun(c), { type: 'START', at: 1000 }).state, {
    type: 'TICK', beat: 4,
  }).state, { type: 'FINISH', at: 4000 }).state;
  assert.equal(reduce(review, { type: 'MARK_CHANGE', bar: 0 }).state.changes.counted, 0, 'no count at the pass review');

  // Without an explicit bar the engine reads the bar the transport is in.
  let state = reduce(reduce(createRun(c), { type: 'START', at: 1000 }).state, { type: 'TICK', beat: 10 }).state;
  state = reduce(state, { type: 'MARK_CHANGE' }).state;
  assert.equal(state.changes.counted, 1);
  assert.equal(state.changes.perBar[1], 'clean', 'beat 10 is in the second bar');
  assert.equal(state.changes.perBar[0], undefined);

  // A hand-built bar past the end clamps to the last bar instead of throwing.
  const clamped = reduce(state, { type: 'MARK_CHANGE', bar: 99 }).state;
  assert.equal(clamped.changes.counted, 2);
  assert.equal(clamped.changes.perBar[7], 'clean');

  // The other families have no change record, so the event is inert on them.
  const scale = reduce(active(chart()), { type: 'MARK_CHANGE', bar: 0 }).state;
  assert.equal(scale.changes, null);
});

test('every chord pass starts with a fresh change record', () => {
  const c = chordChart();
  let state = reduce(reduce(createRun(c), { type: 'START', at: 1000 }).state, { type: 'TICK', beat: 4 }).state;
  for (const bar of [0, 1, 2]) state = reduce(state, { type: 'MARK_CHANGE', bar }).state;
  const review = reduce(state, { type: 'FINISH', at: 4000 }).state;
  assert.equal(review.changes.clean, 3, 'the closed pass keeps its own record');
  const next = reduce(reduce(review, { type: 'SELF_REPORT', clean: true }).state, { type: 'NEXT_PASS' }).state;
  assert.equal(next.phase, 'countIn');
  assert.deepEqual(next.changes, freshChangeRecord(8), 'the next pass counts from zero');
});

test('the chord frame carries the LED column and the screen column, never one matrix', () => {
  const c = chordChart();
  const run = reduce(createRun(c), { type: 'START', at: 1000 }).state;
  const at = (level, beat) => frameAt({ ...run, phase: 'active', hintLevel: level }, { phase: 'active', beat });
  const frames = [0, 1, 2, 3].map(level => at(level, 4));

  // The destination of the first bar is the second chord of the pair.
  const destination = c.steps[1].chordId;
  const current = c.steps[0].chordId;
  const destinationCells = cellsOf(destination);
  const currentCells = cellsOf(current);
  const destinationOnly = litKeys(destinationCells.filter(key => !currentCells.includes(key)));
  assert.ok(destinationOnly.length > 0, 'the pair has a fretted cell only the destination chord owns');

  // step/target bookkeeping is the bar the transport is in.
  for (const frame of frames) {
    assert.equal(frame.stepNumber, 1);
    assert.equal(frame.totalSteps, 8);
  }
  assert.deepEqual(frames[0].target, c.steps[0].target);

  // Level 0 (Full pattern): the union of the current and the next chord's shape.
  assert.deepEqual(
    [...new Set(keysOf(frames[0].led))].sort(),
    [...new Set(litKeys([...currentCells, ...destinationCells]))].sort(),
  );
  assert.equal(frames[0].blink, true, 'the change beat blinks the current root');
  assert.equal(at(0, 5).blink, false, 'and holds solid inside the bar');

  // Level 1 (Anchors): the destination chord's roots plus its bass, fretted cells only (FADE-11).
  assert.deepEqual(keysOf(frames[1].led), chordAnchorKeys(destination));
  assert.ok(frames[1].led.length < litKeys(destinationCells).length, 'sparser than the destination shape');
  assert.equal(frames[1].blink, true, 'the destination shape blinks on the change beat');
  assert.equal(at(1, 5).blink, false);

  // Level 2 (Hint on demand): the destination root on beat 1 only, never a shape.
  assert.equal(frames[2].led.length, 1, 'at most one cell');
  assert.ok(destinationCells.includes(keysOf(frames[2].led)[0]), 'and it is the destination shape root');
  assert.equal(frames[2].led[0].midi % 12, chordById[destination].rootPc);
  assert.equal(frames[2].blink, false);
  assert.deepEqual(at(2, 5).led, [], 'the root goes after the first beat');

  // Level 3 (No lights): the held zero frame.
  assert.deepEqual(frames[3].led, []);
  assert.deepEqual(at(3, 5).led, []);
  assert.equal(frames[3].blink, false);

  // The Screen-fade column: the current bar's voicing with finger numbers at Full
  // pattern, the same shape with no numbers at Anchors, and no dot from Hint on.
  assert.deepEqual(frames[0].notes.map(n => n.text), ['×', '3', '2', '0', '1', '0']);
  assert.deepEqual(keysOf(frames[0].notes), ['6:0', ...currentCells]);
  assert.deepEqual(keysOf(frames[1].notes), keysOf(frames[0].notes), 'Anchors shows the same shape');
  assert.deepEqual(frames[1].notes.map(n => n.text), ['', '', '', '', '', ''], 'with the finger numbers gone');
  assert.deepEqual(frames[2].notes, []);
  assert.deepEqual(frames[3].notes, []);

  // The exact failure the two-column split exists to prevent: a screen dot the
  // current bar does not own would print the answer to the drill's question.
  for (const level of [0, 1, 2, 3]) {
    for (const key of destinationOnly) {
      assert.ok(!keysOf(frames[level].notes).includes(key), `level ${level} shows no destination-only cell`);
    }
  }
  assert.ok(keysOf(frames[1].led).includes(destinationOnly[0]), 'the destination lives in led, not notes');

  // The second bar swaps the two columns over.
  const second = at(1, 8);
  assert.equal(second.stepNumber, 2);
  assert.deepEqual(keysOf(second.led), chordAnchorKeys(current), 'bar 2 blinks the anchors of C again');
  assert.deepEqual(keysOf(second.notes), cellsOf('G'), 'and shows the G shape on screen');

  // `Blink chord` flashes exactly the destination shape at every level.
  for (const level of [0, 1, 2, 3]) {
    assert.deepEqual(keysOf(frames[level].flashNotes), litKeys(destinationCells), `level ${level} flash set`);
  }
});

test('the Flash event turns the chord destination shape into the one-beat LED set', () => {
  const c = chordChart();
  let state = reduce(reduce(createRun(c), { type: 'START', at: 1000 }).state, { type: 'TICK', beat: 4 }).state;
  state = { ...state, hintLevel: 2 };
  const flashed = reduce(state, { type: 'FLASH', beat: 4 }).state;
  assert.equal(flashed.flashUntilBeat, 5, 'exactly one beat');
  const frame = frameAt(flashed, { phase: 'active', beat: 4 });
  assert.equal(frame.flash, true);
  assert.deepEqual(keysOf(frame.flashNotes), litKeys(cellsOf(c.steps[1].chordId)));
  assert.equal(frameAt(flashed, { phase: 'active', beat: 5 }).flash, false);
});

// ---------- 03-02 Task 3: between-rep tempo, the onset seam and the frame matrix ----------
// A finished chord pass at 80 BPM, sitting at its boundary decision.
function chordReview() {
  const c = chordChart();
  let state = reduce(reduce(createRun(c), { type: 'START', at: 1000 }).state, { type: 'TICK', beat: 4 }).state;
  for (let bar = 0; bar < 8; bar++) state = reduce(state, { type: 'MARK_CHANGE', bar }).state;
  return reduce(state, { type: 'FINISH', at: 9000 }).state;
}

// The bar line in milliseconds on the click clock: count-in + bar * beats-per-bar.
const barStartMs = (bar, bpm = 80) => ((4 + bar * 4) * 60000) / bpm;

test('NEXT_PASS carries the boundary tempo and rebuilds the pass grid', () => {
  const review = chordReview();
  assert.equal(review.chart.bpm, 80);
  assert.equal(review.changes.clean, 8);

  const faster = reduce(review, { type: 'NEXT_PASS', bpm: 84 }).state;
  assert.equal(faster.chart.bpm, 84, 'the next rep runs at the number the player confirmed');
  assert.notEqual(faster.chart, review.chart, 'the chart is rebuilt, never mutated');
  assert.equal(review.chart.bpm, 80, 'the finished pass keeps its own tempo');
  assert.equal(faster.phase, 'countIn');
  assert.equal(faster.recall.bpm, 84, 'the recall record names the tempo the pass runs at');
  assert.equal(faster.resumeFromBeat, 4);
  assert.equal(faster.activeStartBeat, 4);
  assert.deepEqual(faster.changes, freshChangeRecord(8), 'the new pass counts from zero');

  // A missing tempo keeps the chart, byte for byte.
  const held = reduce(review, { type: 'NEXT_PASS' }).state;
  assert.equal(held.chart.bpm, 80);
  assert.equal(held.chart, review.chart, 'no tempo means no rebuild');

  // The tempo plane's range is the reducer's, not the input's.
  assert.equal(reduce(review, { type: 'NEXT_PASS', bpm: 10 }).state.chart.bpm, 30);
  assert.equal(reduce(review, { type: 'NEXT_PASS', bpm: 900 }).state.chart.bpm, 240);
  assert.equal(reduce(review, { type: 'NEXT_PASS', bpm: 84.4 }).state.chart.bpm, 84, 'a fractional tempo rounds');
  assert.equal(reduce(review, { type: 'NEXT_PASS', bpm: NaN }).state.chart.bpm, 80, 'an unreadable tempo holds');

  // The pass after the boundary records its own tempo and its own rate: eight clean
  // changes at 84 BPM in 4/4 is 21 changes a minute, not 20.
  let next = reduce(faster, { type: 'TICK', beat: 4 }).state;
  assert.equal(next.phase, 'active');
  for (let bar = 0; bar < 8; bar++) next = reduce(next, { type: 'MARK_CHANGE', bar }).state;
  const second = reduce(next, { type: 'FINISH', at: 12000 }).state;
  assert.equal(second.phase, 'passReview');
  assert.equal(second.passes[second.passes.length - 1].bpm, 84);
  assert.equal(second.changes.changesPerMin, 21);

  // And nothing else moves the tempo: only NEXT_PASS ever rebuilds the chart.
  let walk = active(chordChart());
  for (const event of [
    { type: 'START' }, { type: 'TICK', beat: 6 }, { type: 'FLASH', beat: 6 },
    { type: 'MARK_CHANGE', bar: 0 }, { type: 'PAUSE', beat: 6 }, { type: 'RESUME' },
    { type: 'RESTART' }, { type: 'FINISH' }, { type: 'STOP' },
    { type: 'REPEAT' },
  ]) {
    walk = reduce(walk, event).state;
    assert.equal(walk.chart.bpm, 80, `${event.type} never changes the tempo`);
  }
});

test('CHANGE_ONSET counts only a strum inside the bar change window', () => {
  assert.deepEqual(CHANGE_WINDOW, { beforeMs: 60, afterMs: 300 });
  const c = chordChart();
  const live = active(c, 4);
  const fire = (state, event) => reduce(state, { type: 'CHANGE_ONSET', ...event }).state;

  // The bar line is the click the player heard: the count-in plus the bar's beats.
  assert.equal(barStartMs(0), 3000);
  assert.equal(barStartMs(1), 6000);

  // Inside the window the bar's change counts; the record flips to onset-counted.
  const clean = fire(live, { bar: 0, atMs: barStartMs(0) + 100 });
  assert.equal(clean.changes.perBar[0], 'clean');
  assert.equal(clean.changes.counted, 1);
  assert.equal(clean.changes.onsetCounted, true);
  assert.deepEqual(reduce(live, { type: 'CHANGE_ONSET', bar: 0, atMs: barStartMs(0) + 100 }).effects, []);

  // Outside the window nothing is counted and the bar stays open.
  assert.equal(fire(live, { bar: 0, atMs: barStartMs(0) + 400 }).changes.counted, 0);
  assert.equal(fire(live, { bar: 0, atMs: barStartMs(0) - 61 }).changes.counted, 0);
  assert.equal(fire(live, { bar: 0, atMs: barStartMs(0) + 2500 }).changes.counted, 0, 'mid-bar is not a change');
  // Both edges are inclusive.
  assert.equal(fire(live, { bar: 0, atMs: barStartMs(0) - 60 }).changes.counted, 1);
  assert.equal(fire(live, { bar: 0, atMs: barStartMs(0) + 300 }).changes.counted, 1);

  // The calibration offset is subtracted before the window is read.
  assert.equal(
    fire(live, { bar: 0, atMs: barStartMs(0) + 400, calibrationMs: 150 }).changes.counted,
    1,
    'a reading 150 ms late lands 250 ms after the bar line',
  );
  assert.equal(
    fire(live, { bar: 0, atMs: barStartMs(0) + 100, calibrationMs: 200 }).changes.counted,
    0,
    'a positive offset moves the reading before the window',
  );

  // A second onset in the same bar changes neither the count nor the record.
  const twice = fire(clean, { bar: 0, atMs: barStartMs(0) + 120 });
  assert.equal(twice.changes.counted, 1);
  assert.deepEqual(twice.changes.perBar, clean.changes.perBar);

  // The expected root is the only pitch claim (D-46): a match is on pitch, a different
  // pitch is checked but never on pitch, and an unreadable root is never a failure.
  const onPitch = fire(live, { bar: 0, atMs: barStartMs(0) + 100, midi: 60, expectedRootPc: 0 });
  assert.equal(onPitch.changes.rootsChecked, 1);
  assert.equal(onPitch.changes.rootsOnPitch, 1);
  const offPitch = fire(live, { bar: 0, atMs: barStartMs(0) + 100, midi: 62, expectedRootPc: 0 });
  assert.equal(offPitch.changes.rootsChecked, 1);
  assert.equal(offPitch.changes.rootsOnPitch, 0);
  const wrapped = fire(live, { bar: 0, atMs: barStartMs(0) + 100, midi: 72, expectedRootPc: 12 });
  assert.equal(wrapped.changes.rootsOnPitch, 1, 'pitch classes wrap');
  const unreadable = fire(live, { bar: 0, atMs: barStartMs(0) + 100, midi: null, expectedRootPc: 0 });
  assert.equal(unreadable.changes.rootsChecked, 0, 'a root that cannot be read is not checked, never wrong');
  assert.equal(unreadable.changes.rootsOnPitch, 0, 'and never claimed on pitch');
  assert.equal(unreadable.changes.perBar[0], 'clean', 'an unreadable root never fails the bar');
  const noRoot = fire(live, { bar: 0, atMs: barStartMs(0) + 100, midi: 60 });
  assert.equal(noRoot.changes.rootsChecked, 0, 'no expected root means no check at all');

  // Once the mic is the count, the manual button is inert for the whole pass.
  const manual = reduce(clean, { type: 'MARK_CHANGE', bar: 1 }).state;
  assert.equal(manual.changes.counted, 1);
  assert.equal(manual.changes.perBar[1], undefined);

  // The seam is legal only in a live chord pass: the review and the other families ignore it.
  assert.equal(reduce(createRun(c), { type: 'CHANGE_ONSET', bar: 0, atMs: 3000 }).state.changes.counted, 0);
  const review = reduce(clean, { type: 'FINISH', at: 9000 }).state;
  assert.equal(reduce(review, { type: 'CHANGE_ONSET', bar: 1, atMs: 6000 }).state, review, 'no onset at the boundary');
  assert.equal(reduce(active(chart()), { type: 'CHANGE_ONSET', bar: 0, atMs: 3000 }).state.changes, null);
  // A bar past the end clamps to the last bar instead of throwing; a missing clock is inert.
  assert.equal(fire(live, { bar: 99, atMs: barStartMs(7) + 50 }).changes.perBar[7], 'clean');
  assert.equal(fire(live, { bar: 0 }).changes.counted, 0);
});

test('the family × level matrix is one table for scaleRun, findNote and chordChanges', () => {
  const scaleChart = chart();
  const findChart = quizChart();
  const chord = chordChart();
  const scaleState = active(scaleChart);
  const findState = startQuiz(findChart);
  const chordState = active(chord, 4);
  const cellKey = n => `${n.s}:${n.f}`;

  // Scale run: Full pattern lights the shape, Anchors and Hint on demand light the
  // anchors plus the target, No lights is the held zero frame.
  const scaleAnchors = new Set(anchorNotes(scaleChart.shape).map(cellKey));
  const scaleTarget = scaleChart.steps[0].target;
  const scaleHints = litOnly(scaleChart.shape)
    .filter(n => scaleAnchors.has(cellKey(n)) || (n.s === scaleTarget.s && n.f === scaleTarget.f))
    .map(cellKey);
  const scaleBlink = !(scaleTarget && scaleTarget.f === 0);

  // Find the note in Find form: the whole pool, then the roots, then nothing.
  const findPool = litOnly(findChart.shape).map(cellKey);
  const findRoots = litOnly(findChart.shape).filter(n => n.iv === 0).map(cellKey);

  // Chord changes: the union of both shapes, then the destination shape, then the
  // destination root on beat 1 only, then the held zero frame.
  const currentCells = cellsOf(chord.steps[0].chordId);
  const destinationCells = cellsOf(chord.steps[1].chordId);
  const union = litKeys([...new Set([...currentCells, ...destinationCells])]);
  const destinationRoot = ledCell(chord.steps[1].target);

  const frameFor = (family, level, beat = 4) => {
    if (family === 'scaleRun') {
      return frameAt({ ...scaleState, phase: 'active', hintLevel: level }, { phase: 'active', beat });
    }
    if (family === 'chordChanges') {
      return frameAt({ ...chordState, phase: 'active', hintLevel: level }, { phase: 'active', beat });
    }
    return frameAt({ ...findState, phase: 'active', hintLevel: level }, { phase: 'active', beat, mode: 'find' });
  };

  const rows = [
    { family: 'scaleRun', level: 0, led: litOnly(scaleChart.shape).map(cellKey), blink: scaleBlink },
    { family: 'scaleRun', level: 1, led: scaleHints, blink: scaleBlink },
    { family: 'scaleRun', level: 2, led: scaleHints, blink: scaleBlink },
    { family: 'scaleRun', level: 3, led: [], blink: false },
    { family: 'findNote', level: 0, led: findPool, blink: false },
    { family: 'findNote', level: 1, led: findRoots, blink: false },
    { family: 'findNote', level: 2, led: [], blink: false },
    { family: 'findNote', level: 3, led: [], blink: false },
    { family: 'chordChanges', level: 0, led: union, blink: true },
    { family: 'chordChanges', level: 1, led: chordAnchorKeys(chord.steps[1].chordId), blink: true },
    { family: 'chordChanges', level: 2, led: [cellKey(destinationRoot)], blink: false },
    { family: 'chordChanges', level: 3, led: [], blink: false },
  ];
  for (const row of rows) {
    const frame = frameFor(row.family, row.level);
    assert.deepEqual(keysOf(frame.led), row.led, `${row.family} level ${row.level} lights the approved set`);
    assert.equal(frame.blink, row.blink, `${row.family} level ${row.level} blink`);
  }

  // The level-3 chord frame is the held zero frame: no light, no dot, no target.
  const held = frameFor('chordChanges', 3);
  assert.deepEqual(held.led, []);
  assert.deepEqual(held.notes, []);
  assert.equal(held.target, null);

  // Level 2's destination root is the change beat's alone, and it is that chord's root.
  assert.deepEqual(frameFor('chordChanges', 2).led, [destinationRoot]);
  assert.deepEqual(keysOf(frameFor('chordChanges', 2, 5).led), []);

  // `flashNotes` is the chord destination shape and only the chord family has one.
  for (const level of [0, 1, 2, 3]) {
    assert.deepEqual(
      keysOf(frameFor('chordChanges', level).flashNotes),
      litKeys(destinationCells),
      `chord level ${level} flashes the destination shape`,
    );
    assert.deepEqual(frameFor('scaleRun', level).flashNotes, [], `scale level ${level} has no flash set`);
    assert.deepEqual(frameFor('findNote', level).flashNotes, [], `find level ${level} has no flash set`);
  }
});

test('a pass records the practice time it earned: bars for chords, wall time for the quiz (WR-02)', () => {
  // A chord chart runs one step per bar: two bars at 80 BPM is 2 × 4 × 750 = 6000 ms, not
  // the 1500 ms a one-step-per-beat formula would claim.
  const chordStarted = reduce(createRun(chordChart()), { type: 'START', at: 1000 }).state;
  const twoBars = reduce(chordStarted, { type: 'TICK', beat: 12 }).state;
  const stopped = reduce(twoBars, { type: 'STOP', at: 20000, wallAt: 1700000000000 });
  assert.equal(stopped.state.passes[0].completedSteps, 2);
  assert.equal(stopped.state.passes[0].activeMs, 6000);

  // A completed chord pass is all eight bars: 8 × 4 × 750 = 24000 ms.
  const late = reduce(chordStarted, { type: 'TICK', beat: 35 }).state;
  const done = reduce(late, { type: 'FINISH', at: 40000, wallAt: 1700000000000 });
  assert.equal(done.state.passes[0].activeMs, 24000);
  assert.equal(summarizeDrill(done.state).activeMs, 24000);

  // The quiz has no tempo: the pass is the wall time from its first question to its last
  // answer (A5), never a 0 ms that would erase a twelve-question recall from the totals.
  let quiz = reduce(createRun(quizChart()), { type: 'START', at: 1000 }).state;
  for (let i = 0; i < 12; i++) {
    quiz = reduce(quiz, { type: 'ANSWER', index: i, correct: true, at: 2000 + i * 1000 }).state;
    quiz = reduce(quiz, { type: 'NEXT_QUESTION', at: 2000 + i * 1000 }).state;
  }
  assert.equal(quiz.phase, 'passReview');
  assert.equal(quiz.passes[0].activeMs, 12000, 'twelve seconds of wall time, not 0');
  assert.equal(summarizeDrill(quiz).activeMs, 12000);

  // A stopped quiz counts the time up to the stop.
  const stoppedQuiz = reduce(
    reduce(createRun(quizChart()), { type: 'START', at: 1000 }).state,
    { type: 'STOP', at: 6000, wallAt: 1700000000000 },
  );
  assert.equal(stoppedQuiz.state.passes[0].activeMs, 5000);

  // A timed pass with no tempo at all records no invented time.
  const noTempo = { ...active(chart(), 4), chart: { ...chart(), bpm: 0 } };
  const finished = reduce(noTempo, { type: 'FINISH', at: 5000 });
  assert.equal(finished.state.passes[0].activeMs, 0);
});

test('summarize carries the finalised change record and the chord pair id', () => {
  const review = chordReview();
  const summary = summarize(review);
  assert.equal(summary.chordPairId, 'C-G');
  assert.equal(summary.changes.planned, 8);
  assert.equal(summary.changes.clean, 8);
  assert.equal(summary.changes.missed, 0);
  assert.equal(summary.changes.changesPerMin, 20);
  assert.deepEqual(summary.changes.perBar, Array.from({ length: 8 }, () => 'clean'));
  assert.equal(summarizeDrill(review).chordPairId, 'C-G');
  assert.equal(summarizeDrill(review).changes.clean, 8);

  // Every other family keeps both fields null: no pair metric is invented for it.
  const scale = summarize(active(chart()));
  assert.equal(scale.changes, null);
  assert.equal(scale.chordPairId, null);
  assert.equal(summarizeDrill(active(chart())).changes, null);
});

// ---------- 04-02 Task 1: the play-along chart, its change grid and its band ----------
test('every progression in every key builds one step per bar plus one ending step', () => {
  assert.equal(PROGRESSIONS.length, 8, 'the curated table is the fixed eight');
  for (const prog of PROGRESSIONS) {
    for (let keyPc = 0; keyPc < 12; keyPc++) {
      const bars = expandProgression(prog, keyPc);
      const c = buildPlayAlongChart({
        family: 'progression', progressionId: prog.id, keyPc, bpm: 80, bars,
      });
      // The skill id names the item and the key only — never a tempo, a loop or a bar count.
      assert.equal(c.id, `progression:${prog.id}:${keyPc}`);
      assert.equal(c.kind, 'progression');
      assert.equal(c.family, 'progression');
      assert.equal(c.timed, true);
      assert.equal(c.anchorMode, 'roots');
      assert.equal(c.startLevel, 0);
      assert.equal(c.endingBar, true);
      assert.ok(c.shape.length > 0, 'the guidance column is the pass union');
      // The idle/result board reads the union of every bar, deduped by `s:f`, and every
      // cell in it belongs to some bar of this pass.
      const shapeKeys = c.shape.map(n => n.s + ':' + n.f);
      assert.equal(new Set(shapeKeys).size, shapeKeys.length, 'no cell appears twice');
      for (const step of c.steps) {
        for (const cell of step.cells) assert.ok(shapeKeys.includes(cell.s + ':' + cell.f));
      }
      assert.equal(c.beatsPerBar, 4);
      assert.equal(c.countInBeats, 4);
      assert.equal(c.bars, bars.length, 'the change grid is the chart bars');
      assert.equal(c.steps.length, bars.length + 1, `${prog.id} in key ${keyPc}`);
      assert.equal(c.totalBeats, 4 + (bars.length + 1) * 4);
      assert.deepEqual(c.loop, { fromBar: 0, toBar: bars.length });
      assert.equal(c.content.progressionId, prog.id);
      assert.equal(c.content.keyPc, keyPc);
      assert.equal(c.content.loopBars, 0);
      assert.equal(c.content.sectionLoop, false);
      for (const step of c.steps.slice(0, bars.length)) {
        const bar = bars[step.index];
        assert.equal(step.beat, 4 + step.index * 4, 'one step per bar');
        assert.equal(step.ending, false);
        assert.equal(step.chordName, bar.name);
        assert.equal(step.roman, bar.roman);
        assert.equal(step.rootPc, bar.rootPc);
        assert.equal(step.quality, bar.quality);
        // Every bar either resolves a voicing or says it has none — never a wrong shape.
        assert.ok(step.voicingId === null || typeof step.voicingId === 'string');
        // The root anchor is the chord's own root, so a root cell exists iff a target does.
        assert.equal(step.cells.some(cell => cell.iv === 0), !!step.target);
        for (const cell of step.cells) {
          assert.ok(Number.isInteger(cell.iv) && cell.iv >= 0 && cell.iv < 12);
          assert.ok(Number.isInteger(cell.midi));
        }
        if (step.target) assert.equal(step.target.iv, 0);
      }
      // The ending step repeats the last chord one bar later and is never a change.
      const last = c.steps[bars.length - 1];
      const ending = c.steps[bars.length];
      assert.equal(ending.index, bars.length);
      assert.equal(ending.ending, true);
      assert.equal(ending.beat, 4 + bars.length * 4);
      assert.equal(ending.chordName, last.chordName);
      assert.deepEqual(ending.cells, last.cells);
      assert.deepEqual(ending.target, last.target);
      // The band is chart data: sorted beats, a click on every beat, and the five voices.
      assert.ok(c.audioEvents.length > 0);
      assert.deepEqual(c.audioEvents.map(e => e.beat), [...c.audioEvents.map(e => e.beat)].sort((a, b) => a - b));
      assert.equal(c.audioEvents.filter(e => e.type === 'click').length, c.totalBeats);
      for (const voice of ['kick', 'snare', 'hat', 'bass', 'pad']) {
        assert.ok(c.audioEvents.some(e => e.type === voice), `${prog.id}/${keyPc} is missing ${voice}`);
      }
      for (const event of c.audioEvents) {
        assert.ok(Number.isFinite(event.beat) && event.beat >= 0);
        assert.ok(!Object.hasOwn(event, 'time'), 'the chart carries beats, never a clock');
      }
    }
  }
});

test('a play-along with no bars is a zero-step, zero-event chart, never a throw', () => {
  const empty = buildPlayAlongChart({ family: 'progression', progressionId: 'I-IV-V', keyPc: 3, bars: [] });
  assert.equal(empty.id, 'progression:I-IV-V:3');
  assert.equal(empty.bars, 0);
  assert.deepEqual(empty.steps, [], 'no ending step for an item with no bars');
  assert.deepEqual(empty.audioEvents, []);
  assert.deepEqual(empty.loop, { fromBar: 0, toBar: 0 });
  assert.equal(empty.totalBeats, empty.countInBeats);
  // A missing bar list is the same zero-step chart, not a crash.
  assert.deepEqual(buildPlayAlongChart({ progressionId: 'I-IV-V' }).steps, []);
  // And a run over it starts, ticks and renders an empty board without inventing a change.
  const started = reduce(createRun(empty), { type: 'START', at: 1000 }).state;
  assert.equal(started.changes.planned, 0);
  const ticked = reduce(started, { type: 'TICK', beat: 4 }).state;
  assert.deepEqual(frameAt(ticked, { beat: 4 }).notes, []);
  assert.deepEqual(frameAt(ticked, { beat: 4 }).led, []);
});

test('the count-in is one bar of the chart meter, so a 3/4 play-along counts three', () => {
  const c = syntheticPlayChart({ id: 'I-IV-V', bpm: 70, meter: [3, 4] });
  assert.equal(c.beatsPerBar, 3);
  assert.equal(c.countInBeats, 3);
  assert.deepEqual(c.meter, [3, 4]);
  assert.equal(c.steps[0].beat, 3);
  assert.equal(c.steps[1].beat, 6);
  assert.equal(c.steps[c.bars].beat, 3 + c.bars * 3, 'the ending starts one bar later');
  assert.equal(c.totalBeats, 3 + (c.bars + 1) * 3);
  const clicks = c.audioEvents.filter(e => e.type === 'click');
  // One accented click for the count-in, one per chart bar and one for the ending bar.
  assert.equal(clicks.filter(e => e.accent).length, c.bars + 2, 'the first beat of every bar is accented');
});

test('a twelve-bar 80 BPM play-along earns its bars and never a thirteenth change', () => {
  const c = syntheticPlayChart({ id: '12-bar-blues', bpm: 80 });
  assert.equal(c.bars, 12);
  assert.equal(c.steps.length, 13);
  // `freshChanges` seeds the grid from `chart.bars`, not from `steps.length`.
  assert.equal(createRun(c).changes.planned, c.bars);
  const started = reduce(createRun(c), { type: 'START', at: 1000 }).state;
  const active = reduce(started, { type: 'TICK', beat: 4 }).state;
  const finished = reduce(active, { type: 'FINISH', at: 6000, wallAt: 1700000000000 }).state;
  const summary = summarizeDrill(finished);
  assert.equal(summary.changes.planned, 12);
  assert.ok(summary.changes.perBar.length <= 12, 'no row past the change grid');
  assert.equal(summary.changes.perBar.length, 0, 'a silent pass marked no bar');
  assert.equal(summary.changes.clean, 0, 'a silent pass counts nothing');
  assert.equal(summary.changes.missed, 12);
  assert.equal(summary.bars, 12);
  assert.equal(summary.endingBar, true);
  // Twelve bars at 80 BPM in 4/4 is 36 000 ms, plus or minus the ending bar (3 000 ms) —
  // never the ~9 000 ms a one-beat-per-step span would report (Pitfall 1).
  assert.ok(Math.abs(summary.activeMs - 36000) <= 3000, `activeMs ${summary.activeMs}`);
  assert.equal(summary.changes.changesPerMin, 0);
});

test('a strum in the ending bar folds into the last chart bar, never a thirteenth row', () => {
  const c = syntheticPlayChart({ id: '12-bar-blues', bpm: 80 });
  const barMs = (60000 / 80) * 4;
  const barStart = bar => (4 + bar * 4) * (60000 / 80);
  const started = reduce(createRun(c), { type: 'START', at: 1000 }).state;
  const active = reduce(started, { type: 'TICK', beat: 4 }).state;
  // The ending bar's first beat is chart bar 12; the grid's last bar is index 11, so the
  // strum folds there and can never create a thirteenth row.
  const endingOnset = reduce(active, {
    type: 'CHANGE_ONSET', bar: 12, atMs: barStart(11), calibrationMs: 0, midi: 55, expectedRootPc: 0,
  }).state;
  assert.equal(endingOnset.changes.planned, 12, 'the grid stays twelve bars');
  assert.equal(endingOnset.changes.counted, 1, 'the strum folds into the last chart bar');
  assert.equal(endingOnset.changes.perBar[11], 'clean');
  assert.equal(endingOnset.changes.perBar[12], undefined);
  assert.ok(endingOnset.changes.perBar.length <= 12);
  // A pass that played every bar has nothing left to count: the ending bar changes nothing.
  let played = active;
  for (let bar = 0; bar < 12; bar++) {
    played = reduce(played, {
      type: 'CHANGE_ONSET', bar, atMs: barStart(bar), calibrationMs: 0,
    }).state;
  }
  assert.equal(played.changes.counted, 12, 'every chart bar counted once');
  assert.equal(played.changes.perBar.filter(Boolean).length, 12);
  const afterEnding = reduce(played, {
    type: 'CHANGE_ONSET', bar: 12, atMs: barStart(11), calibrationMs: 0,
  }).state;
  assert.equal(afterEnding.changes.counted, 12, 'an ending strum counts nothing');
  assert.deepEqual(afterEnding.changes.perBar, played.changes.perBar);
  assert.equal(afterEnding.changes.rootsChecked, played.changes.rootsChecked);
  // The same event on bar 1 does mark bar 1 clean.
  const bar1 = reduce(active, {
    type: 'CHANGE_ONSET', bar: 0, atMs: barStart(0), calibrationMs: 0,
  }).state;
  assert.equal(bar1.changes.perBar[0], 'clean');
  assert.equal(bar1.changes.counted, 1);
  // And a manual press in the ending bar cannot add a row either.
  const press = reduce(active, { type: 'MARK_CHANGE', bar: 12 }).state;
  assert.equal(press.changes.perBar[12], undefined);
  assert.ok(press.changes.perBar.length <= 12);
  const pressBar1 = reduce(active, { type: 'MARK_CHANGE', bar: 0 }).state;
  assert.equal(pressBar1.changes.perBar[0], 'clean');
  assert.ok(Number.isFinite(barMs));
});

test('CHART_CHANGES is the one predicate behind the change record and its three resets', () => {
  assert.deepEqual([...CHART_CHANGES].sort(), ['chordChanges', 'progression', 'song']);
  const c = syntheticPlayChart({ id: 'I-IV-V', bpm: 80 });
  const started = reduce(createRun(c), { type: 'START', at: 1000 }).state;
  const active = reduce(started, { type: 'TICK', beat: 4 }).state;
  const counted = reduce(active, { type: 'CHANGE_ONSET', bar: 0, atMs: 3000, calibrationMs: 0 }).state;
  assert.equal(counted.changes.counted, 1);
  // RESTART restarts the pass, so its record restarts with it.
  const restarted = reduce(counted, { type: 'RESTART', at: 2000 }).state;
  assert.equal(restarted.changes.counted, 0);
  assert.equal(restarted.changes.planned, c.bars);
  // NEXT_PASS seeds the next pass from the same grid.
  const finished = reduce(active, { type: 'FINISH', at: 5000, wallAt: 1700000000000 }).state;
  assert.equal(finished.phase, 'passReview');
  const next = reduce(finished, { type: 'NEXT_PASS', at: 6000 }).state;
  assert.equal(next.changes.planned, c.bars);
  assert.equal(next.changes.counted, 0);
});

// ---------- 04-02 Task 2: the next chord, the held scene and the chart's meter ----------
test('the play-along frame carries the NEXT chord at every level and never blinks', () => {
  const c = syntheticPlayChart({ id: 'I-IV-V', bpm: 80 });
  const state = active(c, 4);
  const frameFor = (level, beat = 4) => frameAt(
    { ...state, phase: 'active', hintLevel: level },
    { phase: 'active', beat },
  );
  const first = c.steps[0].cells;
  const next = c.steps[1].cells;
  const nextRoots = next.filter(n => n.iv === 0);
  const key = n => n.s + ':' + n.f;
  assert.ok(first.length && next.length);
  assert.notDeepEqual(next.map(key), first.map(key), 'bar 2 is a different chord from bar 1');

  // The shape is held, not animated: a blink would say "now" when the cue means "next".
  for (const level of [0, 1, 2, 3]) assert.equal(frameFor(level).blink, false, `level ${level} never blinks`);

  // L1 Full pattern: the next bar's whole shape on the board and on the guitar.
  const full = frameFor(0);
  assert.deepEqual(full.led, next);
  assert.deepEqual(full.notes, next);
  // The board gets the Chord tab's dot language, so a play-along reads like the chord family.
  for (const note of full.notes) assert.equal(typeof note.text, 'string');
  assert.equal(full.barIndex, 0);
  assert.equal(full.bars, c.bars);
  assert.equal(full.stepNumber, 1);
  assert.equal(full.totalSteps, c.bars, 'the counter counts the change grid');
  assert.deepEqual(full.target, c.steps[1].target);

  // L2 Anchors: that chord's own root cells, never the whole shape and never bar 1's root.
  // The LED set is FADE-11's chord anchors (roots plus bass, fretted only); the screen keeps
  // the roots, open ones included as rings.
  const anchors = frameFor(1);
  assert.deepEqual(anchors.led, anchorNotes(next, { chord: true }));
  assert.deepEqual(anchors.led, litOnly(nextRoots), 'every curated bass is a root');
  assert.deepEqual(anchors.notes, nextRoots);
  assert.ok(nextRoots.length > 0 && nextRoots.length < next.length);

  // L3 Hint on demand and L4 No lights: the held zero frame, with the flash set intact so
  // `Blink chord` still shows the next shape for one beat.
  for (const level of [2, 3]) {
    const held = frameFor(level);
    assert.deepEqual(held.led, [], `level ${level} lights nothing`);
    assert.deepEqual(held.notes, [], `level ${level} draws nothing`);
    assert.deepEqual(held.flashNotes, next, `level ${level} still flashes the next shape`);
  }
  assert.equal(frameFor(3).target, null, 'the recall pass carries no target');
});

test('the idle stage and the count-in preview bar 1, and the ending is never bar 13', () => {
  const c = syntheticPlayChart({ id: '12-bar-blues', bpm: 80 });
  assert.equal(c.bars, 12);
  // Idle: no run has started, and the stage still previews the bar the pass will open on
  // (A-52) instead of the whole pass's union.
  const idle = frameAt(createRun(c), {});
  assert.deepEqual(idle.led, litOnly(c.steps[0].cells));
  assert.equal(idle.stepNumber, 1);
  assert.equal(idle.totalSteps, 12);
  // The count-in previews the same bar, from the resume anchor rather than the raw beat.
  const started = reduce(createRun(c), { type: 'START', at: 1000 }).state;
  const countIn = frameAt(started, { phase: 'countIn', beat: 1, activeStartBeat: 4 });
  assert.deepEqual(countIn.led, litOnly(c.steps[0].cells));
  assert.equal(countIn.ending, false);
  // The last chart bar's next chord is the ending's, which holds that same chord.
  const lastBar = frameAt(
    { ...started, phase: 'active', hintLevel: 0 },
    { phase: 'active', beat: 4 + 11 * 4 },
  );
  assert.deepEqual(lastBar.led, litOnly(c.steps[12].cells));
  assert.equal(lastBar.stepNumber, 12);
  assert.equal(lastBar.ending, false);
  // The ending step is named, never numbered: `stepNumber` is bars + 1 while `totalSteps`
  // stays the change grid, so the counter can read `Ending` and never `Bar 13 of 12`.
  const ending = frameAt(
    { ...started, phase: 'active', hintLevel: 0 },
    { phase: 'active', beat: 4 + 12 * 4 },
  );
  assert.equal(ending.ending, true);
  assert.equal(ending.stepNumber, 13);
  assert.equal(ending.totalSteps, 12);
  assert.deepEqual(ending.led, litOnly(c.steps[12].cells));
});

test('the play-along frame is held, not animated: the same state and beat render twice', () => {
  const c = syntheticPlayChart({ id: 'I-IV-V', bpm: 80 });
  const state = { ...active(c, 4), phase: 'active', hintLevel: 0 };
  const position = { phase: 'active', beat: 6 };
  assert.deepEqual(frameAt(state, position), frameAt(state, position));
  // The chart carries the pass union for the idle/result board, but the active column is
  // the branch's next bar — a union on the board would print the whole progression.
  const nextKeys = new Set(c.steps[1].cells.map(n => n.s + ':' + n.f));
  assert.ok(c.shape.some(n => !nextKeys.has(n.s + ':' + n.f)), 'the union spans more than one bar');
  assert.deepEqual(frameAt(state, position).led, litOnly(c.steps[1].cells));
});

test('a 3/4 play-along frame reports its own meter and its own bar lines', () => {
  const c = syntheticPlayChart({ id: 'I-IV-V', meter: [3, 4], bpm: 80 });
  assert.equal(c.beatsPerBar, 3);
  assert.equal(c.steps[1].beat, 6, 'bar 2 starts on beat 6, not beat 8');
  const state = { ...active(c, 3), phase: 'active', hintLevel: 0 };
  const bar2 = frameAt(state, { phase: 'active', beat: 6 });
  assert.equal(bar2.barIndex, 1);
  assert.equal(bar2.beatInBar, 0);
  assert.deepEqual(bar2.led, litOnly(c.steps[2].cells));
  assert.equal(frameAt(state, { phase: 'active', beat: 8 }).beatInBar, 2, 'three beats to the bar');
});

test('a play-along loop window clamps to the item and NEXT_PASS adopts a rebuilt chart', () => {
  const prog = progressionById['12-bar-blues'];
  const bars = expandProgression(prog, 0);
  const whole = buildPlayAlongChart({ progressionId: prog.id, bars, bpm: 80 });
  assert.deepEqual(whole.loop, { fromBar: 0, toBar: 12 });

  // A four-bar window opened at bar 10 ends on the item's last bar, not past it.
  const four = buildPlayAlongChart({ progressionId: prog.id, bars, bpm: 80, loopBars: 4, fromBar: 10 });
  assert.deepEqual(four.loop, { fromBar: 8, toBar: 12 });
  assert.equal(four.content.loopBars, 4);
  assert.equal(four.bars, 4);
  assert.equal(four.steps.length, 5, 'four bars plus the ending');

  const eight = buildPlayAlongChart({ progressionId: prog.id, bars, bpm: 80, loopBars: 8, fromBar: 3 });
  assert.deepEqual(eight.loop, { fromBar: 3, toBar: 11 });
  assert.equal(eight.steps.length, 9);

  // An unsupported window is ignored, never trusted.
  const bad = buildPlayAlongChart({ progressionId: prog.id, bars, bpm: 80, loopBars: 7, fromBar: 3 });
  assert.deepEqual(bad.loop, { fromBar: 0, toBar: 12 });
  assert.equal(bad.content.loopBars, 0);

  // NEXT_PASS adopts a rebuilt chart wholesale so a loop/item/key change at the boundary
  // reaches the next pass; the Phase 3 tempo-only shape still works.
  const review = chordReview();
  const rebuilt = buildPlayAlongChart({ progressionId: prog.id, bars, bpm: 96 });
  const adopted = reduce(review, { type: 'NEXT_PASS', bpm: 96, chart: rebuilt, at: 10000 }).state;
  assert.equal(adopted.chart, rebuilt);
  assert.equal(adopted.chart.bpm, 96);
  assert.equal(adopted.phase, 'countIn');

  const legacy = reduce(review, { type: 'NEXT_PASS', bpm: 84 }).state;
  assert.equal(legacy.chart.bpm, 84);
  assert.equal(legacy.chart.id, review.chart.id);
});

// ---------- 04-03 Task 1: the song section chart and its identity ----------
test('every song section builds one step per bar plus an ending, in the song meter and key', () => {
  assert.equal(SONGS.length, 4, 'the curated public-domain set is fixed');
  for (const song of SONGS) {
    for (const section of song.sections) {
      for (const keyPc of [0, 7, 9]) {
        const unit = expandSongSection(song, section, keyPc, progressionById);
        const repeats = songSectionBars(section, { unitBars: unit.length });
        const bars = Array.from({ length: repeats / Math.max(1, unit.length) }, () => unit).flat();
        const sections = song.sections.map(entry => ({
          id: entry.id,
          name: entry.name,
          repeats: entry.repeats || 1,
          bars: songSectionBars(entry, {
            unitBars: expandSongSection(song, entry, keyPc, progressionById).length,
          }),
        }));
        const c = buildPlayAlongChart({
          family: 'song',
          songId: song.id,
          sectionId: section.id,
          keyPc,
          bpm: song.defaultBpm,
          bars,
          meter: song.meter,
          sections,
        });
        assert.equal(c.id, `song:${song.id}:${section.id}:${((keyPc % 12) + 12) % 12}`);
        assert.equal(c.kind, 'song');
        assert.equal(c.family, 'song');
        assert.equal(c.timed, true);
        assert.equal(c.beatsPerBar, song.meter[0]);
        assert.equal(c.countInBeats, song.meter[0]);
        assert.equal(c.bars, repeats);
        assert.equal(c.steps.length, repeats + 1);
        assert.equal(c.content.songId, song.id);
        assert.equal(c.content.sectionId, section.id);
        assert.equal(c.sections.length, song.sections.length);
        assert.equal(c.sections.find(entry => entry.id === section.id).bars, repeats);
        assert.equal(c.steps[repeats].ending, true);
      }
    }
  }
});

test('songSectionBars honours repeats, the section loop and a progressionId section', () => {
  assert.equal(songSectionBars({ degrees: [1, 4, 1, 5], repeats: 2 }), 8);
  assert.equal(songSectionBars({ degrees: [1, 4, 1, 5], repeats: 2 }, { sectionLoop: true }), 16);
  assert.equal(songSectionBars({ degrees: [1, 1, 4, 1], repeats: 1 }), 4);
  // A section that references a curated progression has no degrees of its own: the caller
  // passes the resolved unit length so the count is never 0.
  assert.equal(songSectionBars({ progressionId: 'I-IV-V', repeats: 2 }, { unitBars: 3 }), 6);
  assert.equal(songSectionBars({ progressionId: 'I-IV-V', repeats: 2 }, { unitBars: 3, sectionLoop: true }), 12);
  // A crafted repeat count never multiplies a pass.
  assert.equal(songSectionBars({ degrees: [1, 4], repeats: 0 }), 2);
  assert.equal(songSectionBars({ degrees: [1, 4], repeats: -4 }), 2);
  assert.equal(songSectionBars({ degrees: [1, 4], repeats: 2.5 }), 2);
});

// ---------- 04-03 Task 2: the section plane, its loop and its boundary ----------
// The bar list `main` hands the builder: the section's resolved bars, each stamped with its
// own place in the section (`barId`) and its section's id, repeated `songSectionBars` times.
function songPassBars(song, section, keyPc, { sectionLoop = false } = {}) {
  const unit = expandSongSection(song, section, keyPc, progressionById)
    .map((bar, barId) => ({ ...bar, barId, sectionId: section.id }));
  const count = songSectionBars(section, { sectionLoop, unitBars: unit.length }) / Math.max(1, unit.length);
  return Array.from({ length: count }, () => unit).flat();
}
function songSections(song, keyPc, { sectionLoop = false } = {}) {
  return song.sections.map(entry => ({
    id: entry.id,
    name: entry.name,
    repeats: entry.repeats || 1,
    bars: songSectionBars(entry, {
      sectionLoop,
      unitBars: expandSongSection(song, entry, keyPc, progressionById).length,
    }),
  }));
}
function songChart(songId, sectionId, keyPc, { sectionLoop = false } = {}) {
  const song = songById[songId];
  const section = song.sections.find(entry => entry.id === sectionId);
  return buildPlayAlongChart({
    family: 'song',
    songId: song.id,
    sectionId: section.id,
    keyPc,
    bpm: song.defaultBpm,
    bars: songPassBars(song, section, keyPc, { sectionLoop }),
    meter: song.meter,
    sections: songSections(song, keyPc, { sectionLoop }),
    sectionLoop,
  });
}

test('a song section keeps its identity across the section loop and doubles its bars', () => {
  const off = songChart('willTheCircleBeUnbroken', 'verse', 7);
  const on = songChart('willTheCircleBeUnbroken', 'verse', 7, { sectionLoop: true });
  assert.equal(off.bars, 8, 'Verse ×2 is eight bars with the loop off');
  assert.equal(on.bars, 16, 'Section loop On repeats the section once more');
  assert.equal(off.steps.length, 9);
  assert.equal(on.steps.length, 17);
  assert.equal(off.id, 'song:willTheCircleBeUnbroken:verse:7');
  assert.equal(on.id, off.id, 'the loop state never re-keys the skill (D-64, T-04-19)');
  assert.equal(off.content.sectionLoop, false);
  assert.equal(on.content.sectionLoop, true);
  // The change grid is the bars, never the ending card, at either length.
  assert.equal(off.steps[off.bars].ending, true);
  assert.equal(on.steps[on.bars].ending, true);
});

test('a song chart carries every section with its own bar count', () => {
  const chart = songChart('thisLittleLightOfMine', 'verse', 0);
  assert.deepEqual(chart.sections, [
    { id: 'verse', name: 'Verse', repeats: 2, bars: 8 },
    { id: 'chorus', name: 'Chorus', repeats: 1, bars: 5 },
  ]);
  const looped = songChart('thisLittleLightOfMine', 'verse', 0, { sectionLoop: true });
  assert.deepEqual(looped.sections.map(entry => entry.bars), [16, 10]);
  // Amazing Grace is the single-section, single-repeat case A-68 cares about.
  assert.deepEqual(songChart('amazingGrace', 'verse', 7).sections, [
    { id: 'verse', name: 'Verse', repeats: 1, bars: 5 },
  ]);
});

test('each section bar carries its own sectionId and barId, and the boundary names its chord', () => {
  const song = songById.willTheCircleBeUnbroken;
  const verse = songPassBars(song, song.sections[0], 7);
  const chorus = songPassBars(song, song.sections[1], 7);
  const chart = buildPlayAlongChart({
    family: 'song',
    songId: song.id,
    sectionId: 'chorus',
    keyPc: 7,
    bars: [...verse, ...chorus],
    meter: song.meter,
    sections: songSections(song, 7),
  });
  // Every step of a section names that section and that bar's own chord.
  for (let i = 0; i < verse.length; i++) {
    assert.equal(chart.steps[i].sectionId, 'verse');
    assert.equal(chart.steps[i].chordName, verse[i].name);
  }
  for (let i = 0; i < chorus.length; i++) {
    const step = chart.steps[verse.length + i];
    assert.equal(step.sectionId, 'chorus');
    assert.equal(step.chordName, chorus[i].name, 'the first chorus bar is the chorus chord');
  }
  assert.equal(chart.steps[0].barId, 0, 'a section restarts at its own bar 1');
  assert.equal(chart.steps[verse.length].barId, 0, 'the boundary is the bar whose barId resets');
  assert.equal(chart.steps[chart.steps.length - 1].sectionId, 'chorus');
  assert.equal(chart.steps[chart.steps.length - 1].ending, true);

  // A-52: the next chord on the last verse bar is the chorus's first chord…
  const state = { ...active(chart, chart.countInBeats), phase: 'active', hintLevel: 0 };
  const boundaryBeat = chart.countInBeats + (verse.length - 1) * chart.beatsPerBar;
  const frame = frameAt(state, { phase: 'active', beat: boundaryBeat });
  assert.equal(frame.barIndex, verse.length - 1);
  assert.deepEqual(frame.led, litOnly(chart.steps[verse.length].cells));
  assert.deepEqual(frame.target, chart.steps[verse.length].target);
  assert.notEqual(chart.steps[verse.length].chordName, chart.steps[verse.length - 1].chordName);

  // …and on the last bar of the last section it is the ending's own chord, one bar on (D-60).
  const lastBeat = chart.countInBeats + (chart.bars - 1) * chart.beatsPerBar;
  const last = frameAt(state, { phase: 'active', beat: lastBeat });
  assert.equal(last.barIndex, chart.bars - 1);
  assert.deepEqual(last.led, litOnly(chart.steps[chart.bars].cells));
  assert.equal(chart.steps[chart.bars].chordName, chorus[chorus.length - 1].name);
  // The ending belongs to the section that just played.
  assert.equal(last.led.length > 0, true);
  assert.equal(chart.steps[chart.bars].sectionId, 'chorus');
});

// ---------- 04-03 Task 3: the 3/4 proof on real song content ----------
// 04-02 made the chart meter-aware and 04-03 Task 1 proved it against synthetic charts; this
// is the same proof against the one curated song that is not in 4/4. The production modules
// need no change for it — `transport.js` already divides by the chart's own `beatsPerBar`
// and returns a 1-based `beatInBar`, so nothing here "fixes" the clock (PITFALL 3).
test('Amazing Grace is meter-correct: three clicks, three dots and beat % 3 accents', () => {
  const grace = songChart('amazingGrace', 'verse', 7);
  assert.deepEqual(grace.meter, [3, 4]);
  assert.equal(grace.beatsPerBar, 3);
  assert.equal(grace.countInBeats, 3, 'one bar of the song own meter counts three');
  assert.equal(grace.bars, 5);
  assert.equal(grace.steps.length, 6);
  // Three dots is the panel's side of the same number: `renderBeat` hides every dot at or
  // past `beatsPerBar`, and the count-in reads `Count-in · n of 3` (tests/static.test.js).
  assert.equal(grace.totalBeats, 3 + 6 * 3);

  // The count-in is three clicks with only the first accented, and the first bar starts on
  // beat 3 rather than beat 4.
  const countIn = grace.audioEvents.filter(e => e.beat < grace.countInBeats);
  assert.deepEqual(countIn.map(e => [e.type, e.beat, e.accent]), [
    ['click', 0, true], ['click', 1, false], ['click', 2, false],
  ]);
  assert.equal(grace.steps[0].beat, 3);

  // Every accent sits on a bar line of the song's own meter — `beat % 3 === 0` — and every
  // click's accent is exactly that test, never a hard-coded four-beat bar.
  for (const event of grace.audioEvents) {
    if (event.accent) assert.equal(event.beat % 3, 0, `accent at beat ${event.beat}`);
  }
  for (const click of grace.audioEvents.filter(e => e.type === 'click')) {
    assert.equal(click.accent, click.beat % 3 === 0, `click at beat ${click.beat}`);
  }

  // The drummer follows the same bar: kick on 1, snare on 2 and 3, hats on all three.
  const firstBar = grace.audioEvents.filter(e => e.beat >= grace.countInBeats && e.beat < grace.countInBeats + 3);
  assert.deepEqual(firstBar.filter(e => e.type === 'kick').map(e => e.beat), [3]);
  assert.deepEqual(firstBar.filter(e => e.type === 'snare').map(e => e.beat), [4, 5]);
  assert.deepEqual(firstBar.filter(e => e.type === 'hat').map(e => e.beat), [3, 4, 5]);
  assert.ok(firstBar.some(e => e.type === 'bass') && firstBar.some(e => e.type === 'pad'));

  // A 4/4 song beside it keeps its four clicks and its own accents, so the proof is about
  // the chart's meter and not about every song counting three.
  const circle = songChart('willTheCircleBeUnbroken', 'verse', 7);
  assert.equal(circle.countInBeats, 4);
  assert.deepEqual(
    circle.audioEvents.filter(e => e.beat < circle.countInBeats).map(e => e.accent),
    [true, false, false, false],
  );
  for (const event of circle.audioEvents) {
    if (event.accent) assert.equal(event.beat % 4, 0, `accent at beat ${event.beat}`);
  }
});

// ---------- Phase 4 code review fixes (04-REVIEW-FIX) ----------
// CR-03: the browse grid renders each section **once** (a repeat is a badge, not more bars), so
// the seed's walk must measure unit bars. Measuring `repeats`-multiplied bars put the bar in a
// bigger space than the grid it indexes and seeded the wrong section for four of every eight or
// nine selectable bars.
test('CR-03: every selectable browse bar maps to the section the browse grid renders', () => {
  for (const song of SONGS) {
    const sections = Array.isArray(song.sections) ? song.sections : [];
    assert.ok(sections.length >= 1, `${song.id} carries its own sections`);
    // Four keys per song, including the song's own.
    for (const keyPc of [...new Set([song.keyPc, 0, 5, 11])]) {
      const lengths = sections.map(section => expandSongSection(song, section, keyPc, progressionById).length);
      let start = 0;
      for (const [index, length] of lengths.entries()) {
        assert.ok(length > 0, `${song.id}/${sections[index].id} has bars`);
        for (let bar = start; bar < start + length; bar++) {
          assert.equal(
            sectionAtBar(song, bar, keyPc),
            sections[index],
            `${song.id} key ${keyPc}: browse bar ${bar} is bars ${start}-${start + length - 1} of ${sections[index].id}`,
          );
        }
        start += length;
      }
      // The browse grid is exactly that many bars, and a bar past the end falls to the last
      // section rather than to nothing.
      assert.equal(sectionAtBar(song, start - 1, keyPc), sections[sections.length - 1]);
      assert.equal(sectionAtBar(song, start + 4, keyPc), sections[sections.length - 1]);
    }
  }
  // The measured case: `Will the Circle Be Unbroken` is four Verse bars then five Chorus bars,
  // so browse bar 4 — not bar 5 — is the Chorus's first bar, and the repeats-multiplied walk
  // claimed bar 4 was still the Verse.
  const circle = songById.willTheCircleBeUnbroken;
  assert.equal(sectionAtBar(circle, 3, circle.keyPc).id, 'verse');
  assert.equal(sectionAtBar(circle, 4, circle.keyPc).id, 'chorus');
  assert.equal(sectionAtBar(circle, 8, circle.keyPc).id, 'chorus', 'the last browse bar is the last section');
  // A song with nothing to walk is no section at all, and a crafted bar index starts at bar 1.
  assert.equal(sectionAtBar({ sections: [] }, 0, 0), null);
  assert.equal(sectionAtBar(null, 3, 0), null);
  assert.equal(sectionAtBar(circle, -5, circle.keyPc).id, 'verse');
  assert.equal(sectionAtBar(circle, NaN, circle.keyPc).id, 'verse');
});

// WR-02: the idle stage's preview is the frame a live pass paints on its first bar, never the
// whole pass's shape and never the scale the Scales tab is browsing.
test('WR-02: the idle play-along preview paints bar 1 on the board and the guitar', () => {
  const c = syntheticPlayChart({ id: '12-bar-blues', bpm: 80 });
  const idle = playAlongIdleFrame(c, 0);
  assert.deepEqual(idle.notes, c.steps[0].cells, 'the board shows bar 1, not the union of the pass');
  assert.deepEqual(idle.led, litOnly(c.steps[0].cells), 'the guitar shows the same bar, fretted cells only');
  assert.deepEqual(idle.target, c.steps[0].target);
  assert.equal(idle.stepNumber, 1);
  assert.equal(idle.totalSteps, 12);
  assert.ok(idle.notes.length > 0 && idle.notes.length < c.shape.length, 'one bar is fewer cells than twelve');
  // Anchors: bar 1's root cells only. Hint on demand and No lights: nothing at all.
  const anchors = playAlongIdleFrame(c, 1);
  assert.deepEqual(anchors.notes, c.steps[0].cells.filter(n => n.iv === 0));
  for (const level of [2, 3]) {
    const dark = playAlongIdleFrame(c, level);
    assert.deepEqual(dark.notes, [], `level ${level} draws nothing`);
    assert.deepEqual(dark.led, [], `level ${level} lights nothing`);
  }
  // A song section previews its own first bar, in its own meter.
  const verse = songChart('willTheCircleBeUnbroken', 'verse', 7);
  const songIdle = playAlongIdleFrame(verse, 0);
  assert.deepEqual(songIdle.notes, verse.steps[0].cells);
  // Every other family keeps its own idle scene.
  assert.equal(playAlongIdleFrame(chart(), 0), null);
  assert.equal(playAlongIdleFrame(buildChordChangeChart({ pairId: 'C-G', bpm: 80, bars: 8 }), 0), null);
  assert.equal(playAlongIdleFrame(null, 0), null);
});

// IN-04: a real ending-bar strum arrives at the ending bar's own timestamp and is rejected by
// the ±300 ms change window, not by the clamp that the old case exercised.
test('IN-04: an ending-bar strum at its own time counts nothing even when the last bar was missed', () => {
  const c = syntheticPlayChart({ id: '12-bar-blues', bpm: 80 });
  const barStart = bar => (4 + bar * 4) * (60000 / 80);
  const active = reduce(reduce(createRun(c), { type: 'START', at: 1000 }).state, { type: 'TICK', beat: 4 }).state;
  // A pass that played bars 1-11 and stopped before bar 12: bar 11 was never counted.
  let missed = active;
  for (let bar = 0; bar < 11; bar++) {
    missed = reduce(missed, { type: 'CHANGE_ONSET', bar, atMs: barStart(bar), calibrationMs: 0 }).state;
  }
  assert.equal(missed.changes.counted, 11);
  assert.equal(missed.changes.perBar[11], undefined, 'bar 11 was missed');
  // The ending bar's strum, at the ending bar's own time — what `flushChordOnset` really sends.
  const ending = reduce(missed, {
    type: 'CHANGE_ONSET', bar: 12, atMs: barStart(12), calibrationMs: 0, midi: 55, expectedRootPc: 0,
  }).state;
  assert.equal(ending.changes.counted, 11, 'the ending bar cannot add a change');
  assert.equal(ending.changes.perBar[11], undefined, 'and it cannot retro-mark the missed bar 11');
  assert.equal(ending.changes.perBar[12], undefined);
  assert.equal(ending.changes.rootsChecked, missed.changes.rootsChecked);
  assert.equal(ending.changes.onsetCounted, missed.changes.onsetCounted, 'a rejected onset counts nothing at all');
  // The same strum one bar earlier marks bar 11 clean, so the rejection is the bar and the
  // window, not the ending flag alone.
  const onTime = reduce(missed, {
    type: 'CHANGE_ONSET', bar: 11, atMs: barStart(11), calibrationMs: 0,
  }).state;
  assert.equal(onTime.changes.perBar[11], 'clean');
  assert.equal(onTime.changes.counted, 12);
});

// ---------- Phase 7: open strings never lit (07-01 Task 2) ----------
test('FADE-12: no family, level or phase lights fret 0', () => {
  const charts = [
    ['scaleRun open box', buildScaleRunChart({ scaleId: 'minPent', keyPc: 9, positionId: 's6f0', direction: 'up', bpm: 80 })],
    ['findNote', quizChart()],
    ['findNote name', nameQuizChart()],
    ['chordChanges', chordChart()],
    ['progression', syntheticPlayChart({ id: 'I-IV-V', keyPc: 0 })],
  ];
  // IN-02: the sweep checks with leds.js `lightable` itself, so drills.js `fretted` can never
  // drift from the codec's rule.
  const fretted = lightable;
  let sawOpenScreen = false;
  for (const [name, c] of charts) {
    const countIn = Number.isFinite(c.countInBeats) ? c.countInBeats : 4;
    for (let level = 0; level <= 3; level++) {
      const run = createRun({ ...c, startLevel: Math.min(level, 2) });
      const idle = { ...run, hintLevel: level, flashUntilBeat: Infinity };
      const live = { ...reduce(run, { type: 'START', at: 1000 }).state, hintLevel: level, flashUntilBeat: Infinity };
      const frames = [
        ['idle', frameAt(idle, { phase: 'idle', beat: 0 })],
        ['countIn', frameAt(live, { phase: 'countIn', beat: 0, activeStartBeat: countIn })],
        ['finished', frameAt(live, { phase: 'finished', beat: countIn + 8 })],
        ['result', frameAt({ ...live, phase: 'result', stepIndex: 1 }, { phase: 'finished', beat: countIn + 8 })],
      ];
      for (let beat = countIn; beat < countIn + 24; beat += 0.5) {
        const activeState = { ...live, phase: 'active', beat, questionIndex: Math.floor(beat - countIn) % Math.max(1, (c.questions || []).length || 1) };
        frames.push([`active ${beat}`, frameAt(activeState, { phase: 'active', beat, activeStartBeat: countIn })]);
      }
      for (const [phase, frame] of frames) {
        for (const n of frame.led || []) assert.ok(fretted(n), `${name} L${level} ${phase} led ${n.s}:${n.f}`);
        for (const n of frame.flashNotes || []) assert.ok(fretted(n), `${name} L${level} ${phase} flash ${n.s}:${n.f}`);
        if (name === 'scaleRun open box' && level === 0 && phase === 'idle') {
          sawOpenScreen = (frame.notes || []).some(n => n.f === 0 && n.open === true);
        }
      }
    }
  }
  assert.ok(sawOpenScreen, 'the open box at Full keeps its fret-0 notes on screen, flagged open');
  for (let level = 0; level <= 3; level++) {
    const idle = playAlongIdleFrame(syntheticPlayChart({ id: 'I-IV-V', keyPc: 0 }), level);
    assert.equal(idle.led.some(n => n.f === 0), false, `idle preview L${level}`);
  }
});

test('FADE-11: play-along Anchors light the chord anchors while the screen keeps the roots', () => {
  for (const keyPc of [0, 2, 7, 9]) {
    const c = syntheticPlayChart({ id: 'I-IV-V', keyPc });
    const state = active(c, 4);
    for (let bar = 0; bar < c.bars; bar++) {
      const beat = c.countInBeats + bar * c.beatsPerBar;
      const frame = frameAt({ ...state, phase: 'active', hintLevel: 1 }, { phase: 'active', beat });
      const next = c.steps[Math.min(bar + 1, c.bars - 1)].cells;
      assert.deepEqual(frame.led, anchorNotes(next, { chord: true }), `key ${keyPc} bar ${bar} led`);
      assert.deepEqual(frame.notes, next.filter(n => n.iv === 0), `key ${keyPc} bar ${bar} screen roots`);
    }
  }
});

test('WR-01: Hint on demand lights the destination\'s first fretted root, so open chords never go dark', () => {
  for (const pair of CHORD_PAIRS) {
    const c = buildChordChangeChart({ pairId: pair.id, bpm: 80 });
    const state = active(c, c.countInBeats);
    for (let bar = 0; bar < c.chords.length; bar++) {
      const beat = c.countInBeats + bar * c.beatsPerBar;
      const l1 = frameAt({ ...state, phase: 'active', beat, hintLevel: 1 }, { phase: 'active', beat });
      const l2 = frameAt({ ...state, phase: 'active', beat, hintLevel: 2 }, { phase: 'active', beat });
      assert.equal(l2.led.length, 1, `${pair.id} bar ${bar + 1}: level 2 lights one root on the beat`);
      const [root] = l2.led;
      assert.equal(root.iv, 0);
      assert.ok(root.f >= 1, `${pair.id} bar ${bar + 1}: the level-2 root is fretted`);
      const anchors = new Set(l1.led.map(n => n.s + ':' + n.f));
      assert.ok(anchors.has(root.s + ':' + root.f), `${pair.id} bar ${bar + 1}: the level-2 cue is part of Anchors`);
    }
  }
  // D → A: the destination A's root 5:0 is open, so level 2 lights its fretted root 3:2.
  const da = buildChordChangeChart({ pairId: 'D-A', bpm: 80 });
  const beat = da.countInBeats;
  const frame = frameAt({ ...active(da, beat), phase: 'active', beat, hintLevel: 2 }, { phase: 'active', beat });
  assert.deepEqual(frame.led.map(n => n.s + ':' + n.f), ['3:2']);
});

test('IN-01: hasFlashSet follows the family, not a flash set filtered down to nothing', () => {
  const scale = buildScaleRunChart({ scaleId: 'minPent', keyPc: 4, positionId: 's6f0', direction: 'up', bpm: 80 });
  const scaleFrame = frameAt({ ...active(scale, 4), hintLevel: 2, flashUntilBeat: Infinity }, { phase: 'active', beat: 4 });
  assert.equal(scaleFrame.hasFlashSet, false, 'a scale run flashes the whole shape');
  const chordFrame = frameAt({ ...active(chordChart(), 4), hintLevel: 2 }, { phase: 'active', beat: 4 });
  assert.equal(chordFrame.hasFlashSet, true);
  assert.ok(chordFrame.flashNotes.length > 0);
  // A play-along whose next chord is all open strings: the family still names its set, so
  // the composition root must not fall back to some other, whole-shape set.
  const play = syntheticPlayChart({ id: 'I-IV-V', keyPc: 0 });
  const steps = play.steps.map(step => ({ ...step, cells: (step.cells || []).map(n => ({ ...n, f: 0 })) }));
  const openPlay = { ...play, steps };
  const beat = openPlay.countInBeats;
  const frame = frameAt({ ...active(openPlay, beat), phase: 'active', hintLevel: 2, flashUntilBeat: Infinity }, { phase: 'active', beat });
  assert.deepEqual(frame.flashNotes, []);
  assert.equal(frame.hasFlashSet, true);
});

// Muted cells never reach a scale shape (the chord families drop them before building cells),
// so this pins the fret and string halves of the rule; leds.test.js pins the muted half.
test('IN-02: frameAt drops off-neck and bad-string cells, so led.length equals ledCounts lit', () => {
  const good = { s: 5, f: 3, midi: 48, iv: 0 };
  const odd = [
    { s: 3, f: 25, midi: 80, iv: 0 },
    { s: 7, f: 2, midi: 40, iv: 0 },
  ];
  const c = syntheticChart([good, ...odd]);
  const frame = frameAt({ ...createRun(c), hintLevel: 0 }, { phase: 'idle', beat: 0 });
  assert.deepEqual(frame.led.map(n => n.s + ':' + n.f), ['5:3']);
  assert.equal(frame.led.length, ledCounts(frame.led).lit);
  assert.equal(frame.led.every(lightable), true);
});

// The play-along screen shows `roots` at Anchors while the LEDs show roots plus bass; the two
// agree only while every voicing's bass is a root. A slash chord or inversion added later
// must fail here rather than let the screen and the guitar disagree.
test('IN-05: every curated and movable voicing has a root as its bass', () => {
  const bassIsRoot = (voicing, label) => {
    const sounding = expandChord(voicing).filter(n => !n.muted);
    assert.ok(sounding.length > 0, `${label} sounds`);
    const bass = sounding.reduce((low, n) => (n.midi < low.midi ? n : low));
    assert.equal(bass.root, true, `${label}: bass ${bass.s}:${bass.f} is a root`);
  };
  let checked = 0;
  for (const family of CHORD_FAMILIES) {
    for (const voicing of family.voicings) { bassIsRoot(voicing, `${family.id} ${voicing.id}`); checked += 1; }
  }
  for (const quality of ['maj', 'min', '7']) {
    for (let rootPc = 0; rootPc < 12; rootPc++) {
      const voicing = voiceChord(rootPc, quality, null, []);
      assert.ok(voicing, `movable ${quality} on ${rootPc}`);
      bassIsRoot(voicing, `movable ${quality} ${rootPc}`);
      checked += 1;
    }
  }
  assert.equal(checked, 24 + 36);
});

// ---------- 08-01: FADE-09 tracer ----------
test('FADE-09 tracer: Check recall + Brighter ends as a guided recall that mints nothing and survives export/import', () => {
  const c = { ...chart(), startLevel: 3, coldRecall: true };
  let state = reduce(createRun(c), { type: 'START', at: 1000, wallAt: 1700000000000 }).state;
  assert.equal(state.phase, 'countIn');
  const dimmed = reduce(state, { type: 'DIMMER', delta: -1 });
  state = dimmed.state;
  assert.equal(state.hintLevel, 2);
  assert.equal(state.cleanStreak, 0);
  assert.equal(state.failStreak, 0);
  assert.deepEqual(state.passDimmer, { startLevel: 3, brightest: 2, brightened: true });
  assert.equal(state.phase, 'countIn', 'a level change never ends the pass');
  assert.deepEqual(dimmed.effects, [{ type: 'announce', key: 'level-manual' }]);

  state = reduce(state, { type: 'TICK', beat: c.countInBeats }).state;
  assert.equal(state.phase, 'active');
  const finished = reduce(state, { type: 'FINISH', at: 5000, wallAt: 1700000004000 });
  state = finished.state;
  assert.equal(state.phase, 'result', 'a pass that began at No lights closes the drill');
  assert.equal(state.completed, true);
  assert.deepEqual(state.recall, { attempted: true, completed: false, selfReport: null, bpm: 80 });
  assert.equal(state.passes.length, 1);
  assert.equal(state.passes[0].hintLevel, 2, 'credited at the brightest level used');
  assert.equal(state.passes[0].brightened, true);
  assert.deepEqual(finished.effects.map(e => e.type), ['stopTransport', 'zeroLeds', 'announce']);
  assert.equal(finished.effects[2].key, 'result-complete');

  const reported = reduce(state, { type: 'SELF_REPORT', clean: true });
  assert.equal(reported.state, state, 'a guided recall takes no self-report');
  assert.deepEqual(reported.effects, []);
  assert.equal(reported.state.recall.completed, false);

  const summary = summarizeDrill(state);
  assert.equal(summary.unguidedMs, 0);
  assert.equal(summary.mastered, false);
  assert.equal(summary.guided, true);
  assert.equal(summary.recall.guided, true);

  const progress = applyResult(emptyProgress(), { ...summary, sessionId: 's-guided' }, { now: 1700000100000 });
  const skill = progress.skills[summary.skillId];
  assert.equal(progress.totals.unguidedMs, 0);
  assert.equal(skill.masteredAt, null);
  assert.equal(skill.withoutLights.cleanPasses, 0);
  assert.equal(skill.dueAt, null);

  assert.equal(BACKUP_SCHEMA_VERSION, 3);
  const doc = JSON.parse(JSON.stringify(exportDoc({ settings: {}, progress }, { now: 1700000200000 })));
  const restored = validateBackup(doc, { validateSettings: raw => raw || {} });
  assert.equal(restored.ok, true);
  const session = restored.doc.progress.sessions.find(s => s.sessionId === 's-guided');
  assert.equal(session.passes[0].brightened, true, 'brightened survives export and import');
});

// ---------- 08-01: DIMMER (FADE-08/09) ----------
const dimmerRun = (startLevel, c = chart()) => reduce(createRun({ ...c, startLevel }), { type: 'START', at: 1000 }).state;
const dim = (state, delta) => reduce(state, { type: 'DIMMER', delta }).state;
const toActive = (state, beat = 4) => reduce(state, { type: 'TICK', beat }).state;
const finishNow = state => reduce(state, { type: 'FINISH', at: 9000 }).state;

test('DIMMER clamps at Full pattern and No lights without effects', () => {
  const full = dimmerRun(0);
  const brighter = reduce(full, { type: 'DIMMER', delta: -1 });
  assert.equal(brighter.state, full);
  assert.deepEqual(brighter.effects, []);
  const none = dimmerRun(3);
  const darker = reduce(none, { type: 'DIMMER', delta: 1 });
  assert.equal(darker.state, none);
  assert.deepEqual(darker.effects, []);
  const junk = reduce(dimmerRun(1), { type: 'DIMMER', delta: 5 });
  assert.equal(junk.state.hintLevel, 1, 'a delta outside -1/+1 is ignored');
  assert.deepEqual(junk.effects, []);
});

test('DIMMER is a no-op in idle, paused, passReview and result', () => {
  const c = chart();
  const idle = createRun({ ...c, startLevel: 1 });
  const paused = reduce(toActive(dimmerRun(1, c)), { type: 'PAUSE', reason: 'hidden', beat: 5 }).state;
  assert.equal(paused.phase, 'paused');
  const review = finishNow(toActive(dimmerRun(1, c)));
  assert.equal(review.phase, 'passReview');
  const result = reduce(toActive(dimmerRun(1, c), 6), { type: 'STOP', at: 5000 }).state;
  assert.equal(result.phase, 'result');
  for (const state of [idle, paused, review, result]) {
    for (const delta of [-1, 1]) {
      const out = reduce(state, { type: 'DIMMER', delta });
      assert.equal(out.state, state, `${state.phase} ignores DIMMER ${delta}`);
      assert.deepEqual(out.effects, []);
    }
  }
});

test('a pass brightened above its start level is brightened and credited at its brightest level', () => {
  // 10 WR-02: Darker then Brighter back to the start level is not extra help.
  let state = dim(reduce(dimmerRun(1), { type: 'DIMMER', delta: 1 }).state, -1);
  assert.equal(state.hintLevel, 1);
  let pass = finishNow(toActive(state)).passes[0];
  assert.equal(pass.brightened, false);
  assert.equal(pass.hintLevel, 1);
  // Brighter above the start level from Anchors: guided, credited at Full pattern.
  state = dim(dimmerRun(1), -1);
  assert.equal(state.hintLevel, 0);
  pass = finishNow(toActive(state)).passes[0];
  assert.equal(pass.brightened, true);
  assert.equal(pass.hintLevel, 0);
  // Brighter then Darker from Hint on demand: Darker never raises credit.
  state = dim(dim(dimmerRun(2), -1), 1);
  assert.equal(state.hintLevel, 2);
  assert.deepEqual(state.passDimmer, { startLevel: 2, brightest: 1, brightened: true });
  pass = finishNow(toActive(state)).passes[0];
  assert.equal(pass.brightened, true);
  assert.equal(pass.hintLevel, 1);
  // Darker only: not guided, still credited at the brightest level used (the start).
  state = reduce(dimmerRun(1), { type: 'DIMMER', delta: 1 }).state;
  pass = finishNow(toActive(state)).passes[0];
  assert.equal(pass.brightened, false);
  assert.equal(pass.hintLevel, 1);
});

test('Darker to No lights mid-pass goes to review; the next pass is the real recall', () => {
  const c = chart();
  let state = reduce(toActive(dimmerRun(2, c)), { type: 'DIMMER', delta: 1 }).state;
  assert.equal(state.hintLevel, 3);
  state = finishNow(state);
  assert.equal(state.phase, 'passReview', 'a pass that began lit is never the recall');
  assert.equal(state.recall.completed, false);
  assert.equal(state.passes[0].hintLevel, 2);
  state = reduce(state, { type: 'SELF_REPORT', clean: true }).state;
  state = reduce(state, { type: 'NEXT_PASS' }).state;
  assert.equal(state.hintLevel, 3);
  assert.equal(state.passDimmer, null);
  assert.equal(state.recall.attempted, true);
  state = finishNow(toActive(state));
  assert.equal(state.phase, 'result');
  assert.equal(state.recall.completed, true);
  state = reduce(state, { type: 'SELF_REPORT', clean: true }).state;
  const summary = summarizeDrill(state);
  assert.equal(summary.mastered, true, 'an unaided pass reached by hand counts like an auto-reached one');
  assert.ok(summary.unguidedMs > 0);
  assert.equal(summary.guided, false);
});

test('Darker to No lights during the count-in is credited at the previous level', () => {
  let state = reduce(dimmerRun(2), { type: 'DIMMER', delta: 1 }).state;
  assert.equal(state.phase, 'countIn');
  assert.equal(state.hintLevel, 3);
  assert.deepEqual(state.passDimmer, { startLevel: 2, brightest: 2, brightened: false });
  state = finishNow(toActive(state));
  assert.equal(state.phase, 'passReview');
  assert.equal(state.passes[0].hintLevel, 2);
  assert.equal(state.passes[0].brightened, false);
  assert.equal(state.recall.completed, false);
  state = reduce(reduce(state, { type: 'SELF_REPORT', clean: true }).state, { type: 'NEXT_PASS' }).state;
  assert.equal(state.hintLevel, 3);
  assert.equal(state.recall.attempted, true, 'the next pass begins at No lights and is the recall');
  assert.equal(finishNow(toActive(state)).phase, 'result');
});

test('the automatic ladder still applies from the new level after a manual change', () => {
  const c = chart();
  let state = reduce(dimmerRun(0, c), { type: 'DIMMER', delta: 1 }).state;
  assert.equal(state.hintLevel, 1);
  assert.equal(state.cleanStreak, 0);
  for (let pass = 0; pass < 3; pass++) {
    state = finishPass(state, c, { clean: true });
    state = reduce(state, { type: 'NEXT_PASS' }).state;
  }
  assert.equal(state.hintLevel, 2, 'three clean passes go darker');

  state = reduce({ ...dimmerRun(1, c), failStreak: 1, cleanStreak: 2 }, { type: 'DIMMER', delta: 1 }).state;
  assert.equal(state.hintLevel, 2);
  assert.equal(state.failStreak, 0, 'a manual change resets both streaks');
  assert.equal(state.cleanStreak, 0);
  for (let pass = 0; pass < 2; pass++) {
    state = finishPass(state, c, { clean: false });
    state = reduce(state, { type: 'NEXT_PASS' }).state;
  }
  assert.equal(state.hintLevel, 1, 'two shaky passes go brighter');
});

test('STOP after a Brighter press records a brightened partial; a brightened recall stamps a failed attempt', () => {
  let state = reduce(toActive(dimmerRun(2)), { type: 'DIMMER', delta: -1 }).state;
  let stopped = reduce({ ...state, beat: 6 }, { type: 'STOP', at: 5000 }).state;
  assert.equal(stopped.passes[0].brightened, true);
  assert.equal(stopped.passes[0].hintLevel, 1);
  assert.equal(stopped.recall.attempted, false);

  state = reduce(toActive(dimmerRun(3)), { type: 'DIMMER', delta: -1 }).state;
  stopped = reduce({ ...state, beat: 6 }, { type: 'STOP', at: 5000 }).state;
  assert.equal(stopped.passes[0].brightened, true);
  assert.equal(stopped.passes[0].hintLevel, 2);
  assert.deepEqual(stopped.recall, { attempted: true, completed: false, selfReport: null, bpm: 80 });
});

test('IN-01: the retired ABORT_PASS event is ignored in every phase', () => {
  const live = toActive(dimmerRun(2));
  for (const state of [createRun(chart()), dimmerRun(2), live, reduce(live, { type: 'PAUSE', reason: 'user', beat: 6 }).state]) {
    const out = reduce(state, { type: 'ABORT_PASS', beat: 6 });
    assert.equal(out.state, state, `${state.phase} ignores ABORT_PASS`);
    assert.deepEqual(out.effects, []);
  }
});

test('passDimmer is null after START, NEXT_PASS and REPEAT; RESTART keeps it', () => {
  const c = chart();
  const seeded = { startLevel: 1, brightest: 0, brightened: true };
  assert.equal(createRun(c).passDimmer, null);
  assert.equal(reduce({ ...createRun(c), passDimmer: seeded }, { type: 'START', at: 1 }).state.passDimmer, null);
  const dimmed = dim(toActive(dimmerRun(1, c)), -1);
  assert.notEqual(dimmed.passDimmer, null);
  assert.deepEqual(reduce(dimmed, { type: 'RESTART', at: 2 }).state.passDimmer, dimmed.passDimmer, 'a restart replays the same pass');
  const review = reduce(finishNow(dimmed), { type: 'SELF_REPORT', clean: true }).state;
  assert.equal(reduce(review, { type: 'NEXT_PASS' }).state.passDimmer, null);
  const result = reduce({ ...dimmed, beat: 6 }, { type: 'STOP', at: 5000 }).state;
  assert.equal(reduce(result, { type: 'REPEAT', at: 6000 }).state.passDimmer, null);
});

test('CR-01: Check recall + Brighter + Restart stays a guided recall and clean passes earn no credit', () => {
  const c = { ...chart(), startLevel: 3, coldRecall: true };
  let state = reduce(createRun(c), { type: 'START', at: 1000, wallAt: 1700000000000 }).state;
  state = dim(state, -1);
  state = reduce(state, { type: 'RESTART', at: 1500, wallAt: 1700000000500 }).state;
  assert.equal(state.hintLevel, 2);
  assert.deepEqual(state.passDimmer, { startLevel: 3, brightest: 2, brightened: true });
  state = toActive(state, c.countInBeats);
  state = reduce(state, { type: 'FINISH', at: 5000, wallAt: 1700000004000 }).state;
  assert.equal(state.phase, 'result', 'the replayed recall still closes the drill');
  assert.deepEqual(state.recall, { attempted: true, completed: false, selfReport: null, bpm: c.bpm });
  assert.equal(state.passes.length, 1);
  assert.equal(state.passes[0].brightened, true);
  // The review's laundering path: clean reports and more passes are impossible from here.
  assert.equal(reduce(state, { type: 'SELF_REPORT', clean: true }).state, state);
  assert.equal(reduce(state, { type: 'NEXT_PASS' }).state, state);
  const summary = summarizeDrill(state);
  const skill = applyResult(emptyProgress(), { ...summary, sessionId: 's-cr01' }, { now: 1700000100000 }).skills[summary.skillId];
  assert.equal(skill.withLights.cleanPasses, 0);
  assert.equal(skill.withoutLights.cleanPasses, 0);
  assert.equal(skill.bestLevel, 0);
  assert.equal(skill.retainedAt, null);
  assert.equal(skill.masteredAt, null);
  assert.equal(skill.intervalIndex, 0);
});

test('CR-01: NEXT_PASS clears coldRecall so only the opening attempt is a cold recall', () => {
  const c = { ...chart(), startLevel: 2, coldRecall: true };
  let state = toActive(reduce(createRun(c), { type: 'START', at: 1000 }).state, c.countInBeats);
  state = finishNow(state);
  assert.equal(state.passes[0].assessment.coldRecall, true, 'the opening pass keeps the chart flag');
  state = reduce(state, { type: 'SELF_REPORT', clean: true }).state;
  state = reduce(state, { type: 'NEXT_PASS', at: 10000 }).state;
  assert.equal(state.chart.coldRecall, false);
  state = finishNow(toActive(state, state.chart.countInBeats));
  assert.equal(state.passes[1].assessment.coldRecall, false);
});

test('DIMMER changes the frame at once (measured counts)', () => {
  const c = buildScaleRunChart({ scaleId: 'minPent', keyPc: 9, positionId: 's6f5', direction: 'up', bpm: 80, startLevel: 1 });
  const state = toActive(reduce(createRun(c), { type: 'START', at: 1000 }).state, c.countInBeats);
  const at = { phase: 'active', beat: c.countInBeats };
  assert.deepEqual(ledCounts(frameAt(state, at).led, c.shape), { lit: 7, dark: 5, open: 0 });
  const brighter = dim(state, -1);
  assert.equal(brighter.hintLevel, 0);
  assert.deepEqual(ledCounts(frameAt(brighter, at).led, c.shape), { lit: 12, dark: 0, open: 0 });
  assert.equal(brighter.levelChange.reasonKey, 'manual');
  assert.equal(brighter.levelChange.direction, 'down');
  assert.equal(dim(state, 1).levelChange.direction, 'up');
});

// ---------- 08-02: thumb row dimmer (FADE-07/08/10) ----------
// The readout counts the step's own frame, never the live beat. Measured at 08-02: the first
// active step of minPent A s6f5 at Anchors is 7/5 (its target is an anchor), the second 8/4;
// the plan's 8/4 literal for the first step was re-measured and recorded here.
const readoutChart = (level, positionId = 's6f5', keyPc = 9) => {
  const c = buildScaleRunChart({ scaleId: 'minPent', keyPc, positionId, direction: 'up', bpm: 80 });
  return { ...c, startLevel: level };
};
const readoutCount = (state, position) => ledCounts(readoutFrame(state, position).led, state.chart.shape);

test('FADE-10: readoutFrame is the count-in frame at idle and in count-in, stable through each step', () => {
  const c = readoutChart(1);
  const idle = createRun(c);
  assert.deepEqual(readoutCount(idle), { lit: 7, dark: 5, open: 0 });
  const live = started(c);
  assert.equal(live.phase, 'countIn');
  for (const beat of [0, 1, 2.5, 3.9]) assert.deepEqual(readoutCount(live, { phase: 'countIn', beat }), { lit: 7, dark: 5, open: 0 });
  const active = { ...live, phase: 'active' };
  const [first, second] = c.steps;
  for (const offset of [0, 0.25, 0.5, 0.99]) {
    assert.deepEqual(readoutCount(active, { phase: 'active', beat: first.beat + offset }), { lit: 7, dark: 5, open: 0 });
    assert.deepEqual(readoutCount(active, { phase: 'active', beat: second.beat + offset }), { lit: 8, dark: 4, open: 0 });
  }
});

test('FADE-10: readoutFrame follows the level and excludes open strings', () => {
  assert.deepEqual(readoutCount(createRun(readoutChart(0))), { lit: 12, dark: 0, open: 0 });
  assert.deepEqual(readoutCount(createRun(readoutChart(3))), { lit: 0, dark: 12, open: 0 });
  assert.deepEqual(readoutCount(createRun(readoutChart(0, 's6f0', 4))), { lit: 6, dark: 0, open: 6 });
});

test('WR-01: the readout says 0 lit at the pass review and the result, matching the zeroed guitar', () => {
  const c = readoutChart(0);
  const active = toActive(started(c), c.countInBeats);
  assert.deepEqual(readoutCount(active), { lit: 12, dark: 0, open: 0 });
  const review = finishNow(active);
  assert.equal(review.phase, 'passReview');
  assert.deepEqual(readoutCount(review), { lit: 0, dark: 12, open: 0 });
  const stopped = reduce({ ...active, beat: c.steps[3].beat }, { type: 'STOP', at: 5000 }).state;
  assert.equal(stopped.phase, 'result');
  assert.deepEqual(readoutCount(stopped), { lit: 0, dark: 12, open: 0 });
  const ended = reduce(review, { type: 'END_DRILL', at: 9500 }).state;
  assert.equal(ended.phase, 'result');
  assert.deepEqual(readoutCount(ended), { lit: 0, dark: 12, open: 0 });
});

test('WR-02: the count-in readout after Resume counts the bar the guitar previews', () => {
  const c = { ...buildScaleRunChart({ scaleId: 'major', keyPc: 0, positionId: 's6f0', direction: 'up', bpm: 80 }), startLevel: 1 };
  let state = toActive(started(c), c.countInBeats);
  state = reduce(state, { type: 'TICK', beat: 13 }).state;
  state = reduce(state, { type: 'PAUSE', reason: 'user', beat: 13 }).state;
  state = reduce(state, { type: 'RESUME' }).state;
  assert.equal(state.phase, 'countIn');
  assert.ok(state.activeStartBeat > c.countInBeats, 'the resumed count-in leads into a later bar');
  const position = { phase: 'countIn', beat: state.beat, activeStartBeat: state.activeStartBeat };
  const guitar = frameAt(state, { ...position, beat: state.activeStartBeat - c.countInBeats });
  assert.deepEqual(readoutFrame(state, position).led, guitar.led);
  assert.deepEqual(readoutFrame(state, { phase: 'countIn', beat: state.beat }).led, guitar.led, 'the run anchor serves without a transport anchor');
  assert.deepEqual(readoutCount(state, position), ledCounts(guitar.led, c.shape));
  assert.notDeepEqual(readoutCount(state, position), readoutCount(createRun(c)), 'not the first step\'s count');
});

test('FADE-10: readoutFrame ignores a live Hint-on-demand flash', () => {
  const c = readoutChart(2);
  const live = { ...started(c), phase: 'active', beat: c.steps[0].beat };
  const flashing = { ...live, flashUntilBeat: live.beat + 4 };
  const at = { phase: 'active', beat: live.beat };
  assert.equal(frameAt(flashing, at).flash, true, 'the live frame is flashing');
  assert.deepEqual(readoutFrame(flashing, at).led, readoutFrame(live, at).led);
  assert.equal(readoutFrame(flashing, at).flash, false);
});

test('FADE-10: a chord-changes readout is the same on and off the beat within one bar', () => {
  const c = { ...buildChordChangeChart({ pairId: 'C-G', bpm: 80 }), startLevel: 2 };
  const live = { ...started(c), phase: 'active' };
  const bar = c.countInBeats;
  const counts = [0, 1, 2.5, 3.5].map(offset => readoutCount(live, { phase: 'active', beat: bar + offset }));
  for (const entry of counts) assert.deepEqual(entry, counts[0]);
  assert.deepEqual(counts[0], { lit: 1, dark: 5, open: 4 });
  // The raw frame does go dark off the beat at Hint on demand; the readout must not.
  assert.equal(frameAt(live, { phase: 'active', beat: bar + 1 }).led.length, 0);
});

test('FADE-08: after DIMMER the readout follows the new level on the next frame', () => {
  const live = started(readoutChart(1));
  const brighter = reduce(live, { type: 'DIMMER', delta: -1 }).state;
  assert.deepEqual(readoutCount(brighter, { phase: 'countIn', beat: 1 }), { lit: 12, dark: 0, open: 0 });
  const darker = reduce(reduce(live, { type: 'DIMMER', delta: 1 }).state, { type: 'DIMMER', delta: 1 }).state;
  assert.deepEqual(readoutCount(darker, { phase: 'countIn', beat: 1 }), { lit: 0, dark: 12, open: 0 });
});

// ---------- 09-02: chartIdFor (TODAY-01) ----------
// The coach names a block's start level before the block runs, so the chart id it looks up must be
// the id the real builder gives the chart main.chartFor would build from the same target.
test('09-02 chartIdFor matches every real builder for a block target', () => {
  const scale = { drillFamily: 'scaleRun', scaleId: 'minPent', keyPc: 9, positionId: 's6f5' };
  assert.equal(chartIdFor(scale), buildScaleRunChart({ scaleId: 'minPent', keyPc: 9, positionId: 's6f5', direction: 'up', bpm: 70 }).id);
  const whole = { drillFamily: 'scaleRun', scaleId: 'major', keyPc: 0, positionId: 'all' };
  assert.equal(chartIdFor(whole), buildScaleRunChart({ scaleId: 'major', keyPc: 0, positionId: 'all' }).id);
  const quiz = { drillFamily: 'findNote', scaleId: 'major', keyPc: 14, positionId: 'all', quizQuestion: 'note', quizMode: 'find' };
  assert.equal(chartIdFor(quiz), buildNoteQuizChart({ scaleId: 'major', keyPc: 14, positionId: 'all', quizQuestion: 'note', quizMode: 'find', questions: [] }).id);
  const pair = CHORD_PAIRS[1];
  assert.equal(chartIdFor({ drillFamily: 'chordChanges', chordPairId: pair.id }), buildChordChangeChart({ pairId: pair.id, bpm: 70, bars: 8 }).id);
  const prog = PROGRESSIONS[0];
  assert.equal(
    chartIdFor({ drillFamily: 'progression', progressionId: prog.id, keyPc: 7 }),
    buildPlayAlongChart({ family: 'progression', progressionId: prog.id, keyPc: 7, bpm: 80, bars: expandProgression(prog, 7) }).id,
  );
  // A song with no section named plays its first section (main.chartFor), and a named one plays it.
  const song = SONGS[0];
  const songChart = section => buildPlayAlongChart({
    family: 'song', songId: song.id, sectionId: section.id, keyPc: 2, bpm: 80,
    bars: expandSongSection(song, section, 2, progressionById), meter: song.meter,
  }).id;
  assert.equal(chartIdFor({ drillFamily: 'song', songId: song.id, songSectionId: '', keyPc: 2 }), songChart(song.sections[0]));
  assert.equal(chartIdFor({ drillFamily: 'song', songId: song.id, songSectionId: 'nope', keyPc: 2 }), songChart(song.sections[0]));
  const last = song.sections[song.sections.length - 1];
  assert.equal(chartIdFor({ drillFamily: 'song', songId: song.id, songSectionId: last.id, keyPc: 2 }), songChart(last));
  assert.equal(songById[song.id], song);
});

test('09-02 chartIdFor answers an empty id for unknown or hostile targets and never throws', () => {
  for (const target of [null, undefined, 7, 'scaleRun', [], {}, { drillFamily: 'nope' }, { drillFamily: 'constructor' }]) {
    assert.equal(chartIdFor(target), '');
  }
  assert.equal(chartIdFor({ drillFamily: 'song', songId: 'nope' }), '');
  assert.equal(chartIdFor({ drillFamily: 'song', songId: 'constructor' }), '');
  assert.equal(chartIdFor({ drillFamily: 'scaleRun', scaleId: 'constructor', keyPc: 0, positionId: 'all' }), '');
  assert.equal(chartIdFor({ drillFamily: 'chordChanges', chordPairId: '__proto__' }), '');
  assert.equal(chartIdFor({ drillFamily: 'progression', progressionId: 'toString', keyPc: 0 }), '');
});

// ---------- 10-01: LIB-02 repeat fade ----------
// Repeat k (0-based) of a song section is shown at clampLevel(startLevel + k), derived from
// the beat inside frameAt, and the pass is still credited at its start level.
test('LIB-02: song steps carry their section repeat; a progression is one repeat', () => {
  const chart = songChart('willTheCircleBeUnbroken', 'verse', 7);
  assert.deepEqual(chart.steps.map(step => step.repeat), [0, 0, 0, 0, 1, 1, 1, 1, 1],
    'bars 1-4 are repeat 0, bars 5-8 repeat 1, the ending keeps the last bar\'s repeat');
  const prog = syntheticPlayChart({ id: '12-bar-blues' });
  assert.ok(prog.steps.every(step => step.repeat === 0));
});

test('LIB-02: each repeat of a song section is one level darker, credited at the start level', () => {
  const chart = { ...songChart('willTheCircleBeUnbroken', 'verse', 7), startLevel: 0 };
  let s = reduce(createRun(chart), { type: 'START', at: 0, wallAt: 1 }).state;
  s = reduce(s, { type: 'TICK', beat: chart.countInBeats }).state;
  const first = frameAt(s, { phase: 'active', beat: chart.countInBeats });
  assert.equal(first.level, 0, 'repeat 0 previews bar 2 at Full pattern');
  const lastOfRepeat0 = chart.countInBeats + 3 * chart.beatsPerBar;
  const darker = frameAt(s, { phase: 'active', beat: lastOfRepeat0 });
  assert.equal(darker.level, 1, 'bar 4 previews bar 5, repeat 1, at Anchors');
  // The LED set at the shown level is the chord's FADE-11 anchors, the set ledCounts counts.
  assert.deepEqual(darker.led, litOnly(anchorNotes(chart.steps[4].cells, { chord: true })));
  const fullSameChord = frameAt(s, { phase: 'countIn', beat: 0, activeStartBeat: chart.countInBeats });
  assert.equal(chart.steps[4].chordName, chart.steps[0].chordName, 'repeat 1 opens on the same chord');
  assert.equal(fullSameChord.level, 0);
  assert.ok(ledCounts(darker.led, chart.shape).lit < ledCounts(fullSameChord.led, chart.shape).lit,
    'the guitar lights fewer notes on the darker repeat');
  // The readout counts the same frame at the same level.
  assert.equal(readoutFrame(s, { phase: 'active', beat: lastOfRepeat0 }).level, 1);
  s = reduce({ ...s, phase: 'active' }, { type: 'FINISH', at: 1, wallAt: 2 }).state;
  assert.equal(s.passes[0].hintLevel, 0, 'credited at the start level, never the darker repeat');
  assert.equal(s.chart.id, 'song:willTheCircleBeUnbroken:verse:7', 'identity unchanged');
  // Pass review names the level the pass was played at: no repeat offset leaks into it.
  assert.equal(readoutFrame(s).level, s.hintLevel);
});

test('LIB-02: Section loop on shows levels 0, 1, 2, 3 across four repeats', () => {
  const chart = songChart('willTheCircleBeUnbroken', 'verse', 7, { sectionLoop: true });
  const s = { ...reduce(createRun(chart), { type: 'START', at: 0, wallAt: 1 }).state, phase: 'active' };
  const levels = [0, 1, 2, 3].map(k => {
    const beat = k === 0 ? chart.countInBeats : chart.countInBeats + (4 * k - 1) * chart.beatsPerBar;
    return frameAt(s, { phase: 'active', beat }).level;
  });
  assert.deepEqual(levels, [0, 1, 2, 3]);
  // Started at Hint on demand, the clamp holds No lights.
  const hint = { ...s, hintLevel: 2 };
  const late = frameAt(hint, { phase: 'active', beat: chart.countInBeats + 11 * chart.beatsPerBar });
  assert.equal(late.level, 3);
  assert.deepEqual(late.led, []);
});

test('LIB-02: a progression play-along never fades within a pass', () => {
  const chart = syntheticPlayChart({ id: '12-bar-blues', startLevel: 1 });
  const s = { ...reduce(createRun(chart), { type: 'START', at: 0, wallAt: 1 }).state, phase: 'active' };
  for (let bar = 0; bar < chart.bars; bar++) {
    assert.equal(frameAt(s, { phase: 'active', beat: chart.countInBeats + bar * chart.beatsPerBar }).level, 1);
  }
});

test('LIB-02: the idle frame previews bar 1 at the start level', () => {
  const chart = songChart('willTheCircleBeUnbroken', 'verse', 7);
  assert.equal(frameAt(createRun({ ...chart, startLevel: 1 }), { phase: 'idle', beat: 0 }).level, 1);
  assert.equal(playAlongIdleFrame(chart, 2).level, 2);
});

// ---------- 10-01: dimmer and Blink on the shown level ----------
// Brighter and Darker step from the level the player sees, the pass stays credited at its
// start level, a press stops the song fade for the pass, and Blink chord is legal only where
// Hint on demand is shown.
function songRepeat1(startLevel = 0, { sectionLoop = false } = {}) {
  const chart = { ...songChart('willTheCircleBeUnbroken', 'verse', 7, { sectionLoop }), startLevel };
  let s = reduce(createRun(chart), { type: 'START', at: 0, wallAt: 1 }).state;
  // Bar 4 is active: the board previews bar 5, the first bar of repeat 1.
  s = reduce(s, { type: 'TICK', beat: chart.countInBeats }).state;
  s = reduce(s, { type: 'TICK', beat: chart.countInBeats + 3 * chart.beatsPerBar }).state;
  return { chart, s };
}

test('10-01: Darker in repeat 1 steps from the shown level and credits the start level', () => {
  const { s } = songRepeat1(0);
  assert.equal(s.phase, 'active');
  assert.equal(shownLevel(s, { beat: s.beat, phase: s.phase }), 1);
  const darker = reduce(s, { type: 'DIMMER', delta: 1 }).state;
  assert.equal(darker.hintLevel, 2, 'shown Anchors + Darker = Hint on demand, never a skipped level');
  assert.equal(darker.passDimmer.startLevel, 0);
  assert.equal(darker.passDimmer.brightest, 0);
  assert.equal(darker.levelChange.fromLevel, 1);
  const review = reduce(darker, { type: 'FINISH', at: 1, wallAt: 2 }).state;
  assert.equal(review.passes[0].hintLevel, 0, 'never over-credited');
});

// 10 WR-02: undoing the song's automatic fade back to the pass's start level is not extra help,
// so the pass stays unguided and the streaks stand; brightening above the start level is guided.
test('10-01: Brighter in repeat 1 restores Full pattern without marking the pass guided', () => {
  const { s } = songRepeat1(0);
  const streaked = { ...s, cleanStreak: 2, failStreak: 1 };
  const brighter = reduce(streaked, { type: 'DIMMER', delta: -1 }).state;
  assert.equal(brighter.hintLevel, 0);
  assert.equal(brighter.passDimmer.brightened, false);
  assert.equal(brighter.cleanStreak, 2, 'the base level never moved, so the clean streak stands');
  assert.equal(brighter.failStreak, 1);
  const review = reduce(brighter, { type: 'FINISH', at: 1, wallAt: 2 }).state;
  assert.equal(review.passes[0].brightened, false);
  assert.equal(review.passes[0].hintLevel, 0);
});

test('10 WR-02: Brighter above the start level in a song repeat still marks the pass guided', () => {
  // Started at Anchors, repeat 1 is shown at Hint on demand.
  const { s } = songRepeat1(1);
  assert.equal(shownLevel(s, { beat: s.beat, phase: s.phase }), 2);
  const streaked = { ...s, cleanStreak: 2, failStreak: 1 };
  const back = reduce(streaked, { type: 'DIMMER', delta: -1 }).state;
  assert.equal(back.hintLevel, 1);
  assert.equal(back.passDimmer.brightened, false, 'back to the start level is not extra help');
  assert.equal(back.cleanStreak, 2);
  const above = reduce(back, { type: 'DIMMER', delta: -1 }).state;
  assert.equal(above.hintLevel, 0);
  assert.equal(above.passDimmer.brightened, true, 'brighter than the level the pass was given');
  assert.equal(above.cleanStreak, 0, 'the base level moved, so the streaks reset');
  assert.equal(above.failStreak, 0);
  const review = reduce(above, { type: 'FINISH', at: 1, wallAt: 2 }).state;
  assert.equal(review.passes[0].brightened, true);
  assert.equal(review.passes[0].hintLevel, 0);
});

test('10-01: after a manual press the song fade stops for the pass', () => {
  const { chart, s } = songRepeat1(0, { sectionLoop: true });
  const pressed = reduce(s, { type: 'DIMMER', delta: 1 }).state;
  assert.equal(pressed.hintLevel, 2);
  for (const bar of [4, 7, 11, 14]) {
    const frame = frameAt(pressed, { phase: 'active', beat: chart.countInBeats + bar * chart.beatsPerBar });
    assert.equal(frame.level, pressed.hintLevel, `bar ${bar + 1} stays at the pressed level`);
  }
  assert.equal(songFadeOffset(pressed, chart.steps[12]), 0);
});

test('10-01: Darker at a shown No lights is clamped and leaves the state unchanged', () => {
  const { s } = songRepeat1(2);
  assert.equal(shownLevel(s, { beat: s.beat, phase: s.phase }), 3);
  const result = reduce(s, { type: 'DIMMER', delta: 1 });
  assert.equal(result.state, s);
  assert.deepEqual(result.effects, []);
});

test('10-01: FLASH is refused where the shown level is not Hint on demand and accepted where it is', () => {
  // Started at Hint on demand, repeat 1 is shown at No lights: Blink chord is refused.
  const { chart, s } = songRepeat1(2);
  const refused = reduce(s, { type: 'FLASH', beat: s.beat });
  assert.equal(refused.state, s);
  // In repeat 0 of the same pass Hint on demand is shown: accepted.
  const early = reduce({ ...s, beat: chart.countInBeats }, { type: 'FLASH', beat: chart.countInBeats }).state;
  assert.equal(early.flashUntilBeat > chart.countInBeats, true);
  // Started at Anchors, repeat 1 is shown at Hint on demand: accepted there.
  const anchors = songRepeat1(1).s;
  const accepted = reduce(anchors, { type: 'FLASH', beat: anchors.beat }).state;
  assert.equal(accepted.flashUntilBeat > anchors.beat, true);
  assert.equal(shownLevel(anchors, { beat: anchors.beat, phase: anchors.phase }), 2);
});

test('10-01: shownLevel is the run level for every non-play-along family', () => {
  const run = { ...active(chart(), 4), hintLevel: 2 };
  assert.equal(shownLevel(run, { beat: 6, phase: 'active' }), 2);
  const prog = syntheticPlayChart({ startLevel: 1 });
  const progRun = { ...reduce(createRun(prog), { type: 'START', at: 0, wallAt: 1 }).state, phase: 'active' };
  assert.equal(shownLevel(progRun, { beat: prog.countInBeats + 2 * prog.beatsPerBar, phase: 'active' }), 1);
});

// v2.0 WARN-1: a Brighter press that only partly undoes a song repeat's auto fade (it lands
// between the pass's start level and the shown level) is not extra help and does not move the
// base level: the streaks stand and the next pass starts from the old base.
function songRepeat2(startLevel = 0) {
  const chart = { ...songChart('willTheCircleBeUnbroken', 'verse', 7, { sectionLoop: true }), startLevel };
  let s = reduce(createRun(chart), { type: 'START', at: 0, wallAt: 1 }).state;
  // Bar 8 is active: the board previews bar 9, the first bar of repeat 2.
  s = reduce(s, { type: 'TICK', beat: chart.countInBeats }).state;
  s = reduce(s, { type: 'TICK', beat: chart.countInBeats + 7 * chart.beatsPerBar }).state;
  return { chart, s };
}

test('v2.0 WARN-1: partial Brighter in repeat 2 keeps the base level and both streaks', () => {
  const { chart, s } = songRepeat2(0);
  assert.equal(s.phase, 'active');
  assert.equal(shownLevel(s, { beat: s.beat, phase: s.phase }), 2, 'repeat 2 from Full pattern is Hint on demand');
  const streaked = { ...s, cleanStreak: 1, failStreak: 1 };
  const partial = reduce(streaked, { type: 'DIMMER', delta: -1 }).state;
  assert.equal(partial.hintLevel, 0, 'the base level stays where the pass began');
  assert.equal(partial.cleanStreak, 1, 'the clean streak stands');
  assert.equal(partial.failStreak, 1, 'the fail streak stands');
  assert.equal(partial.passDimmer.brightened, false, 'no help beyond the start level');
  assert.equal(shownLevel(partial, { beat: partial.beat, phase: partial.phase }), 1, 'the pressed level is shown');
  for (const bar of [8, 11, 14]) {
    const frame = frameAt(partial, { phase: 'active', beat: chart.countInBeats + bar * chart.beatsPerBar });
    assert.equal(frame.level, 1, `bar ${bar + 1} stays at the pressed level, the auto fade stopped`);
  }
  const review = reduce(partial, { type: 'FINISH', at: 1, wallAt: 2 }).state;
  assert.equal(review.phase, 'passReview');
  assert.equal(review.passes[0].brightened, false);
  assert.equal(review.passes[0].hintLevel, 0, 'credited at the start level');
  assert.equal(review.pendingDecision.fromLevel, 0, 'the review names the old base');
  assert.equal(review.levelChange.fromLevel, 0);
  const nextPass = reduce({ ...review, cleanStreak: 0, failStreak: 0 }, { type: 'NEXT_PASS' }).state;
  assert.equal(nextPass.hintLevel, review.pendingDecision.level);
  assert.equal(nextPass.hintLevel, 0, 'the next pass starts at the old base, never darker');
});

test('v2.0 WARN-1: Brighter from repeat 2 back to exactly the start level stays unguided', () => {
  const { s } = songRepeat2(1);
  assert.equal(shownLevel(s, { beat: s.beat, phase: s.phase }), 3);
  const streaked = { ...s, cleanStreak: 1, failStreak: 1 };
  const one = reduce(streaked, { type: 'DIMMER', delta: -1 }).state;
  assert.equal(one.hintLevel, 1);
  assert.equal(shownLevel(one, { beat: one.beat, phase: one.phase }), 2);
  const two = reduce(one, { type: 'DIMMER', delta: -1 }).state;
  assert.equal(two.hintLevel, 1);
  assert.equal(shownLevel(two, { beat: two.beat, phase: two.phase }), 1);
  assert.equal(two.passDimmer.brightened, false);
  assert.equal(two.cleanStreak, 1);
  assert.equal(two.failStreak, 1);
  const review = reduce(two, { type: 'FINISH', at: 1, wallAt: 2 }).state;
  assert.equal(review.passes[0].brightened, false);
  assert.equal(review.passes[0].hintLevel, 1);
});

test('v2.0 WARN-1: Brighter above the start level from repeat 2 is still guided', () => {
  const { s } = songRepeat2(1);
  let state = { ...s, cleanStreak: 1, failStreak: 1 };
  state = reduce(state, { type: 'DIMMER', delta: -1 }).state; // No lights -> Hint on demand
  state = reduce(state, { type: 'DIMMER', delta: -1 }).state; // Hint on demand -> Anchors
  const above = reduce(state, { type: 'DIMMER', delta: -1 }).state; // Anchors -> Full pattern
  assert.equal(above.hintLevel, 0);
  assert.equal(shownLevel(above, { beat: above.beat, phase: above.phase }), 0);
  assert.equal(above.passDimmer.brightened, true);
  assert.equal(above.cleanStreak, 0);
  assert.equal(above.failStreak, 0);
  const review = reduce(above, { type: 'FINISH', at: 1, wallAt: 2 }).state;
  assert.equal(review.passes[0].brightened, true);
  assert.equal(review.passes[0].hintLevel, 0);
});

test('v2.0 WARN-1: Darker from repeat 2, and Darker after a partial Brighter, keep the old rule', () => {
  const { s } = songRepeat2(0);
  const streaked = { ...s, cleanStreak: 1, failStreak: 1 };
  const darker = reduce(streaked, { type: 'DIMMER', delta: 1 }).state;
  assert.equal(darker.hintLevel, 3, 'shown Hint on demand + Darker = No lights');
  assert.equal(darker.cleanStreak, 0);
  assert.equal(darker.failStreak, 0);
  assert.equal(darker.passDimmer.brightest, 0);
  assert.equal(reduce(darker, { type: 'FINISH', at: 1, wallAt: 2 }).state.passes[0].hintLevel, 0);
  const partial = reduce(streaked, { type: 'DIMMER', delta: -1 }).state;
  const back = reduce(partial, { type: 'DIMMER', delta: 1 }).state;
  assert.equal(back.levelChange.fromLevel, 1, 'Darker steps from the pressed level');
  assert.equal(back.hintLevel, 2);
  assert.equal(shownLevel(back, { beat: back.beat, phase: back.phase }), 2);
  assert.equal(back.cleanStreak, 0, 'a Darker press moves the base level and resets the streaks');
  assert.equal(back.passDimmer.brightened, false);
});
