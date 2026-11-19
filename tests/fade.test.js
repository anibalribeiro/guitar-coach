// Hint ladder policy contract: fixed level table, stored thresholds, the per-pass
// decision and the direction vocabulary. Pure; imports only fade.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HINT_LEVELS, FADE, REASON, clampLevel, createFadeState, nextLevel, totalPassesFor, anchorNotes,
} from '../app/src/fade.js';

test('the four hint levels are fixed and ordered Full pattern to No lights', () => {
  assert.deepEqual(HINT_LEVELS.map(level => level.id), ['full', 'anchors', 'hint', 'none']);
  assert.deepEqual(HINT_LEVELS.map(level => level.level), [0, 1, 2, 3]);
  assert.deepEqual(
    HINT_LEVELS.map(level => level.name),
    ['Full pattern', 'Anchors', 'Hint on demand', 'No lights'],
  );
});

test('the fade thresholds are stored constants and the recall is level 3', () => {
  assert.equal(FADE.cleanPassesToAdvance, 3);
  assert.equal(FADE.failedPassesToDemote, 2);
  assert.equal(FADE.recallLevel, 3);
  assert.equal(FADE.flashBeats, 1);
});

test('createFadeState clamps the start level and starts with empty streaks', () => {
  assert.deepEqual(createFadeState(0), { level: 0, cleanStreak: 0, failStreak: 0, reasonKey: REASON.start });
  assert.equal(createFadeState(2).level, 2);
  assert.equal(createFadeState(9).level, 3);
  assert.equal(createFadeState(-4).level, 0);
  assert.equal(createFadeState('nope').level, 0);
  assert.equal(clampLevel(2.9), 2);
  assert.equal(clampLevel(NaN), 0);
});

test('three clean passes advance one hint and reset both streaks', () => {
  const base = { level: 0, cleanStreak: 0, failStreak: 1 };
  const pass = { hintLevel: 0, completed: true, aborted: false, selfReport: 'clean' };

  const first = nextLevel(base, pass);
  assert.equal(first.level, 0);
  assert.equal(first.cleanStreak, 1);
  assert.equal(first.reasonKey, REASON.holdClean);
  assert.equal(first.direction, 'none');

  const second = nextLevel({ ...base, cleanStreak: 1 }, pass);
  assert.equal(second.level, 0);
  assert.equal(second.cleanStreak, 2);
  assert.equal(second.reasonKey, REASON.holdClean);

  const third = nextLevel({ ...base, cleanStreak: 2 }, pass);
  assert.equal(third.level, 1, 'the third clean pass removes one hint');
  assert.equal(third.cleanStreak, 0);
  assert.equal(third.failStreak, 0);
  assert.equal(third.reasonKey, REASON.advance);
  assert.equal(third.direction, 'up', 'up means one hint removed (level index + 1)');
});

test('a shaky pass holds once and demotes after two consecutive fails', () => {
  const pass = { hintLevel: 2, completed: true, aborted: false, selfReport: 'shaky' };
  const first = nextLevel({ level: 2, cleanStreak: 2, failStreak: 0 }, pass);
  assert.equal(first.level, 2);
  assert.equal(first.cleanStreak, 0, 'a shaky pass clears the clean streak');
  assert.equal(first.failStreak, 1);
  assert.equal(first.reasonKey, REASON.holdFail);
  assert.equal(first.direction, 'none');

  const second = nextLevel({ level: 2, cleanStreak: 0, failStreak: 1 }, pass);
  assert.equal(second.level, 1, 'the second failed pass brings one hint back');
  assert.equal(second.cleanStreak, 0);
  assert.equal(second.failStreak, 0);
  assert.equal(second.reasonKey, REASON.demote);
  assert.equal(second.direction, 'down', 'down means one hint back (level index - 1)');
});

test('a shaky pass at Full pattern holds instead of demoting below zero', () => {
  const decision = nextLevel(
    { level: 0, cleanStreak: 0, failStreak: 1 },
    { hintLevel: 0, completed: true, aborted: false, selfReport: 'shaky' },
  );
  assert.equal(decision.level, 0);
  assert.equal(decision.failStreak, 2, 'a holding fail keeps counting at the floor');
  assert.equal(decision.reasonKey, REASON.holdFail);
  assert.equal(decision.direction, 'none');
});

test('a clean pass at No lights holds and cannot advance past the recall', () => {
  const decision = nextLevel(
    { level: 3, cleanStreak: 2, failStreak: 0 },
    { hintLevel: 3, completed: true, aborted: false, selfReport: 'clean' },
  );
  assert.equal(decision.level, 3);
  assert.equal(decision.cleanStreak, 3);
  assert.equal(decision.reasonKey, REASON.holdClean);
  assert.equal(decision.direction, 'none');
});

test('a skipped report holds the level and leaves both streaks untouched', () => {
  const fade = { level: 1, cleanStreak: 2, failStreak: 1 };
  for (const selfReport of [null, undefined]) {
    const decision = nextLevel(fade, { hintLevel: 1, completed: true, aborted: false, selfReport });
    assert.equal(decision.level, 1);
    assert.equal(decision.cleanStreak, 2);
    assert.equal(decision.failStreak, 1);
    assert.equal(decision.reasonKey, REASON.holdSkip);
    assert.equal(decision.direction, 'none');
  }
});

test('an aborted pass drops one level and renews both streaks', () => {
  const decision = nextLevel(
    { level: 2, cleanStreak: 2, failStreak: 1 },
    { hintLevel: 2, completed: false, aborted: true, selfReport: null },
  );
  assert.equal(decision.level, 1);
  assert.equal(decision.cleanStreak, 0);
  assert.equal(decision.failStreak, 0);
  assert.equal(decision.reasonKey, REASON.asked);
  assert.equal(decision.direction, 'asked');

  const floor = nextLevel(
    { level: 0, cleanStreak: 0, failStreak: 0 },
    { hintLevel: 0, completed: false, aborted: true, selfReport: null },
  );
  assert.equal(floor.level, 0);
});

test('every decision is a fresh object and the inputs are not mutated', () => {
  const fade = { level: 0, cleanStreak: 2, failStreak: 0 };
  const pass = { hintLevel: 0, completed: true, aborted: false, selfReport: 'clean' };
  const snapshot = JSON.stringify({ fade, pass });
  const first = nextLevel(fade, pass);
  const second = nextLevel(fade, pass);
  assert.notEqual(first, second);
  assert.notEqual(first, fade);
  assert.notEqual(first, pass);
  assert.equal(JSON.stringify({ fade, pass }), snapshot);
});

test('anchorNotes returns roots plus the per-string box edges, deduped in shape order', () => {
  const shape = [
    { s: 6, f: 0, midi: 40, iv: 4 },
    { s: 6, f: 3, midi: 43, iv: 0 },
    { s: 6, f: 5, midi: 45, iv: 2 },
    { s: 5, f: 2, midi: 47, iv: 1 },
    { s: 5, f: 4, midi: 49, iv: 3 },
    { s: 5, f: 7, midi: 52, iv: 0 },
    { s: 6, f: 3, midi: 43, iv: 0 },
  ];
  assert.deepEqual(
    anchorNotes(shape).map(n => n.s + ':' + n.f),
    ['6:0', '6:3', '6:5', '5:2', '5:7'],
    'fret 0 stays, a middle non-root drops, a duplicate collapses',
  );
});

test('anchorNotes roots-only keeps roots and an empty shape returns empty', () => {
  const shape = [
    { s: 6, f: 0, midi: 40, iv: 4 },
    { s: 6, f: 3, midi: 43, iv: 0 },
    { s: 5, f: 7, midi: 52, iv: 0 },
  ];
  assert.deepEqual(anchorNotes(shape, { rootsOnly: true }).map(n => n.s + ':' + n.f), ['6:3', '5:7']);
  assert.deepEqual(anchorNotes([], { rootsOnly: true }), []);
  assert.deepEqual(anchorNotes(), []);
  assert.deepEqual(anchorNotes(null), []);
});

test('totalPassesFor counts the clean reps left at every remaining level and grows on a hold', () => {
  assert.equal(totalPassesFor(1, 0), 10, 'three clean passes at three with-hints levels plus the recall');
  assert.equal(totalPassesFor(2, 0), 11, 'an unreported pass inserts a repeat');
  assert.equal(totalPassesFor(2, 0, 1), 10, 'the first clean rep is already budgeted');
  assert.equal(totalPassesFor(3, 0, 2), 10, 'the third clean rep finishes the level, not a new pass');
  assert.equal(totalPassesFor(2, 1), 8);
  assert.equal(totalPassesFor(3, 1), 9);
  assert.equal(totalPassesFor(4, 3), 4, 'the recall pass closes the plan');
  assert.equal(totalPassesFor(4, 9), 4, 'an out-of-range level never shrinks the plan');
  assert.equal(totalPassesFor(4, -3), 13, 'a negative level clamps to the fullest ramp');
});
