// 05-01 Task 1: the daily session's pure core. The planner takes plain progress rows, a
// passed-in `now` and a curated bundle, so every case here is a literal input and a deep-equal
// plan — no store, no clock, no DOM, no randomness. The reducer is the same shape as
// `drills.reduce`: one event in, `{ state, effects }` out, and the caller applies the effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FAMILY_ORDER, SESSION_BLOCKS, TOTAL_MINUTES, buildSessionPlan, emptySession, familyDefaults,
  nextSuggestionOf, sessionReduce, sessionSummaryOf, suggestionFor,
} from '../app/src/session.js';
import {
  CHORD_PAIRS, PROGRESSIONS, SCALES, SONGS,
} from '../app/src/content.js';
import { sessionAnnouncementText, sessionNextText } from '../app/src/panels.js';

// The curated bundle is `main.curatedBundle()`'s shape, built here from the same four content
// tables. The planner imports nothing, so this fixture is the contract between the two sides:
// five ready-made settings patches, each family's curated order and one own-key predicate.
function curated() {
  const scale = SCALES[0];
  const pair = CHORD_PAIRS[0];
  const progression = PROGRESSIONS[0];
  const song = SONGS[0];
  const owns = {
    scaleId: id => SCALES.some(entry => entry.id === id),
    pairId: id => CHORD_PAIRS.some(entry => entry.id === id),
    progressionId: id => PROGRESSIONS.some(entry => entry.id === id),
    songId: id => SONGS.some(entry => entry.id === id),
  };
  return {
    targets: {
      scaleRun: {
        drillFamily: 'scaleRun', scaleId: scale.id, keyPc: 0, positionId: 'all',
        direction: 'updown', tab: 'scales',
      },
      findNote: {
        drillFamily: 'findNote', scaleId: scale.id, keyPc: 0, positionId: 'all',
        quizQuestion: 'note', quizMode: 'find', tab: 'scales',
      },
      chordChanges: { drillFamily: 'chordChanges', chordPairId: pair.id, tab: 'scales' },
      progression: {
        drillFamily: 'progression', progressionId: progression.id, keyPc: 0,
        loopBars: 0, sectionLoop: false, tab: 'scales',
      },
      song: {
        drillFamily: 'song', songId: song.id, songSectionId: song.sections[0].id,
        keyPc: song.keyPc, bpm: song.defaultBpm, loopBars: 0, sectionLoop: false, tab: 'scales',
      },
    },
    order: {
      scaleRun: SCALES.map(entry => entry.id),
      findNote: SCALES.map(entry => entry.id),
      chordChanges: CHORD_PAIRS.map(entry => entry.id),
      progression: PROGRESSIONS.map(entry => entry.id),
      song: SONGS.map(entry => entry.id),
    },
    owns: {
      scaleRun: patch => owns.scaleId(patch.scaleId) && Number.isInteger(patch.keyPc),
      findNote: patch => owns.scaleId(patch.scaleId) && Number.isInteger(patch.keyPc),
      chordChanges: patch => owns.pairId(patch.chordPairId),
      progression: patch => owns.progressionId(patch.progressionId) && Number.isInteger(patch.keyPc),
      song: patch => owns.songId(patch.songId)
        && SONGS.find(entry => entry.id === patch.songId).sections.some(section => section.id === patch.songSectionId),
    },
  };
}

// A skill row is exactly what `progress.skillRows` hands out; only the fields the planner reads
// are spelled out, so a test case reads as the fact it asserts.
const skillRow = (skillId, kind, content, extra = {}) => ({
  skillId, kind, content, bestBpm: 0, bestLevel: 0, cleanPasses: 0, accuracy: null,
  medianTimingMs: null, micUsed: false, lastPlayedAt: null, lastCleanRecallAt: null,
  masteredAt: null, dueAt: null, state: 'learning', ...extra,
});

const NOW = 1767225600000;
const zeroHistory = () => buildSessionPlan({ curated: curated(), now: NOW });

test('the five-block template is the fixed order, minutes and total', () => {
  assert.deepEqual(SESSION_BLOCKS, [
    { kind: 'warmup', family: 'scaleRun', minutes: 2 },
    { kind: 'focus', family: null, minutes: 3 },
    { kind: 'new', family: null, minutes: 3 },
    { kind: 'play', family: null, minutes: 3 },
    { kind: 'recall', family: null, minutes: 2 },
  ]);
  assert.deepEqual(SESSION_BLOCKS.map(block => block.kind), ['warmup', 'focus', 'new', 'play', 'recall']);
  assert.deepEqual(SESSION_BLOCKS.map(block => block.minutes), [2, 3, 3, 3, 2]);
  assert.equal(TOTAL_MINUTES, 13, 'inside SESS-01s 10-15 minute band');
  assert.deepEqual(FAMILY_ORDER, ['scaleRun', 'findNote', 'chordChanges', 'progression', 'song']);
});

test('buildSessionPlan({}) still plans five pending blocks with no history', () => {
  const plan = buildSessionPlan();
  assert.equal(plan.blocks.length, 5);
  assert.equal(plan.totalMinutes, TOTAL_MINUTES);
  assert.equal(plan.noHistory, true);
  assert.equal(plan.builtAt, 0);
  assert.deepEqual(plan.blocks.map(block => block.index), [0, 1, 2, 3, 4]);
  assert.deepEqual(plan.blocks.map(block => block.state), ['pending', 'pending', 'pending', 'pending', 'pending']);
  assert.deepEqual(plan.blocks.map(block => block.kind), ['warmup', 'focus', 'new', 'play', 'recall']);
  // Without a bundle the planner still names a family per block; the store's own defaults fill
  // the rest, which is why an empty bundle is not an empty plan.
  assert.deepEqual(plan.blocks.map(block => block.family), ['scaleRun', 'scaleRun', 'findNote', 'progression', 'scaleRun']);
});

test('the zero-history plan is the pinned curated fallback, block by block', () => {
  const plan = zeroHistory();
  assert.equal(plan.noHistory, true);
  assert.equal(plan.dueCount, 0);
  assert.equal(plan.builtAt, NOW);
  assert.deepEqual(plan.blocks.map(block => block.kind), ['warmup', 'focus', 'new', 'play', 'recall']);
  assert.deepEqual(plan.blocks.map(block => block.reasonKey), [
    'alwaysFirst', 'noHistory', 'newToYou', 'noPlayAlong', 'recallFocus',
  ]);
  assert.deepEqual(plan.blocks.map(block => block.minutes), [2, 3, 3, 3, 2]);
  // The warm-up is the first curated scale in the current key.
  assert.equal(plan.blocks[0].target.scaleId, SCALES[0].id);
  assert.equal(plan.blocks[0].target.scaleId, 'minPent');
  assert.equal(plan.blocks[0].target.keyPc, 0);
  assert.equal(plan.blocks[0].target.drillFamily, 'scaleRun');
  // Focus falls back to the same first curated skill, with the `noHistory` reason.
  assert.equal(plan.blocks[1].target.scaleId, SCALES[0].id);
  assert.equal(plan.blocks[1].reasonValues && typeof plan.blocks[1].reasonValues, 'object');
  // New material takes the first curated family the earlier blocks did not use.
  assert.equal(plan.blocks[2].target.drillFamily, 'findNote');
  assert.equal(plan.blocks[2].target.quizQuestion, 'note');
  // The play-along is `I-IV-V` in C, the approved `No play-along yet` sentence.
  assert.equal(plan.blocks[3].target.progressionId, 'I-IV-V');
  assert.equal(plan.blocks[3].target.keyPc, 0);
  // The recall copies the focus target verbatim — deep-equal, never the same object.
  assert.deepEqual(plan.blocks[4].target, plan.blocks[1].target);
  assert.notEqual(plan.blocks[4].target, plan.blocks[1].target);
  assert.equal(plan.blocks[4].family, plan.blocks[1].family);
  // Every target is a settings patch: only keys the validator already owns.
  const allowed = ['drillFamily', 'scaleId', 'keyPc', 'positionId', 'direction', 'quizQuestion',
    'quizMode', 'chordPairId', 'progressionId', 'songId', 'songSectionId', 'loopBars', 'sectionLoop', 'bpm', 'tab'];
  for (const block of plan.blocks) {
    for (const key of Object.keys(block.target || {})) {
      assert.ok(allowed.includes(key), `block ${block.index} carries an unknown settings key ${key}`);
    }
  }
});

test('a mastered skill due in two days is the Focus block, with the due reason', () => {
  const dueAt = NOW + 2 * 24 * 60 * 60 * 1000;
  const row = skillRow(
    `scaleRun:${SCALES[2].id}:5:s6f0`, 'scaleRun',
    { scaleId: SCALES[2].id, keyPc: 5, positionId: 's6f0' },
    { state: 'due', dueAt, masteredAt: NOW - 7 * 24 * 60 * 60 * 1000, lastPlayedAt: NOW - 7 * 24 * 60 * 60 * 1000 },
  );
  const plan = buildSessionPlan({
    due: [row], skills: [row], curated: curated(), hasHistory: true, now: NOW,
  });
  assert.equal(plan.noHistory, false);
  assert.equal(plan.dueCount, 1);
  assert.equal(plan.blocks[1].reasonKey, 'due');
  assert.equal(plan.blocks[1].family, 'scaleRun');
  assert.equal(plan.blocks[1].target.scaleId, SCALES[2].id);
  assert.equal(plan.blocks[1].target.keyPc, 5);
  assert.equal(plan.blocks[1].target.positionId, 's6f0');
  // The reason carries raw ids only, never a finished sentence.
  assert.deepEqual(plan.blocks[1].reasonValues, {
    skillId: `scaleRun:${SCALES[2].id}:5:s6f0`, kind: 'scaleRun',
    content: { scaleId: SCALES[2].id, keyPc: 5, positionId: 's6f0' },
  });
  // The warm-up is the same recorded scale run, because it is the only scale row there is, and
  // New material has nothing left, so it falls through to the next curated family.
  assert.equal(plan.blocks[0].reasonKey, 'alwaysFirst');
  assert.equal(plan.blocks[2].reasonKey, 'newToYou');
  assert.equal(plan.blocks[2].target.drillFamily, 'findNote');
});

test('a mixed week gives the weakest pair the Focus and the oldest unplayed skill New material', () => {
  const played = (days, extra = {}) => skillRow(
    `scaleRun:${SCALES[1].id}:3:s6f0`, 'scaleRun',
    { scaleId: SCALES[1].id, keyPc: 3, positionId: 's6f0' },
    { lastPlayedAt: NOW - days * 24 * 60 * 60 * 1000, cleanPasses: 4, state: 'learning', ...extra },
  );
  const recent = played(1);
  const oldest = played(30);
  const pairs = [
    { pairId: 'G-D', chords: ['G', 'D'], clean: 6, attempts: 8, cleanRate: 0.75, changesPerMin: 40, lastPlayedAt: NOW - 2 * 86400000 },
    { pairId: 'C-G', chords: ['C', 'G'], clean: 2, attempts: 8, cleanRate: 0.25, changesPerMin: 22, lastPlayedAt: NOW - 5 * 86400000 },
    { pairId: 'D-A', chords: ['D', 'A'], clean: 4, attempts: 8, cleanRate: 0.5, changesPerMin: 18, lastPlayedAt: NOW - 9 * 86400000 },
  ];
  const plan = buildSessionPlan({
    skills: [recent, oldest], pairs, curated: curated(), hasHistory: true, now: NOW,
  });
  // The weakest pair is the lowest clean rate, and it outranks the older pair's lastPlayedAt.
  assert.equal(plan.blocks[1].reasonKey, 'weakestPair');
  assert.equal(plan.blocks[1].family, 'chordChanges');
  assert.equal(plan.blocks[1].target.chordPairId, 'C-G');
  assert.deepEqual(plan.blocks[1].reasonValues, { pairId: 'C-G', chords: ['C', 'G'], changesPerMin: 22 });
  // New material is the skill that has waited longest, not the most recent one.
  assert.equal(plan.blocks[2].reasonKey, 'leastPlayed');
  assert.equal(plan.blocks[2].reasonValues.skillId, `scaleRun:${SCALES[1].id}:3:s6f0`);
  assert.equal(plan.blocks[2].target.keyPc, 3);
  // The warm-up still takes the recorded scale run rather than the pair.
  assert.equal(plan.blocks[0].family, 'scaleRun');
  assert.equal(plan.blocks[0].target.keyPc, 3);
});

test('a due song wins the play-along, a recorded progression is the fallback', () => {
  const song = skillRow(
    'song:amazingGrace:verse:7', 'song',
    { progressionId: '', songId: 'amazingGrace', sectionId: 'verse', keyPc: 7 },
    { state: 'due', dueAt: NOW, lastPlayedAt: NOW - 20 * 86400000 },
  );
  const withSong = buildSessionPlan({
    due: [song], skills: [song], curated: curated(), hasHistory: true, now: NOW,
  });
  assert.equal(withSong.blocks[3].reasonKey, 'dueSong');
  assert.equal(withSong.blocks[3].family, 'song');
  assert.equal(withSong.blocks[3].target.songId, 'amazingGrace');
  assert.equal(withSong.blocks[3].target.songSectionId, 'verse');
  assert.equal(withSong.blocks[3].target.keyPc, 7);
  assert.deepEqual(withSong.blocks[3].reasonValues, {
    progressionId: '', songId: 'amazingGrace', sectionId: 'verse', keyPc: 7,
  });

  const prog = skillRow(
    'progression:I-V-vi-IV:2', 'progression',
    { progressionId: 'I-V-vi-IV', songId: '', sectionId: '', keyPc: 2 },
    { lastPlayedAt: NOW - 3 * 86400000 },
  );
  const withProgression = buildSessionPlan({
    skills: [prog], curated: curated(), hasHistory: true, now: NOW,
  });
  assert.equal(withProgression.blocks[3].reasonKey, 'weakestProgression');
  assert.equal(withProgression.blocks[3].target.progressionId, 'I-V-vi-IV');
  assert.equal(withProgression.blocks[3].target.keyPc, 2);
});

test('an id this build no longer ships becomes a skipped block, never a throw', () => {
  const stale = skillRow(
    'scaleRun:nope:3:all', 'scaleRun', { scaleId: 'nope', keyPc: 3, positionId: 'all' },
    { state: 'due', dueAt: NOW, lastPlayedAt: NOW - 86400000 },
  );
  const plan = buildSessionPlan({
    due: [stale], skills: [stale], curated: curated(), hasHistory: true, now: NOW,
  });
  assert.equal(plan.blocks[1].state, 'skipped');
  assert.equal(plan.blocks[1].reasonKey, 'unavailable');
  assert.equal(plan.blocks[1].target, null);
  // The rest of the session continues: the warm-up's only recorded scale is the same stale row,
  // so it is skipped too, and New material falls through to the curated family.
  assert.equal(plan.blocks.length, 5);
  assert.equal(plan.blocks[0].state, 'skipped');
  assert.equal(plan.blocks[0].reasonKey, 'unavailable');
  assert.equal(plan.blocks[2].state, 'pending');
  assert.equal(plan.blocks[2].reasonKey, 'newToYou');
  assert.equal(plan.blocks[3].state, 'pending');
  assert.equal(plan.blocks[4].target, null, 'the recall copies a skipped focus target');
});

test('the same inputs always produce a deep-equal plan', () => {
  const rows = [skillRow('scaleRun:major:0:all', 'scaleRun', { scaleId: 'major', keyPc: 0, positionId: 'all' }, { lastPlayedAt: NOW - 86400000 })];
  const input = { due: [], skills: rows, pairs: [], curated: curated(), hasHistory: true, now: NOW };
  const first = buildSessionPlan(input);
  const second = buildSessionPlan(input);
  assert.deepEqual(first, second);
  assert.equal(first.builtAt, NOW);
  // Only the caller's own `now` moves the stamp.
  assert.equal(buildSessionPlan({ ...input, now: NOW + 1 }).builtAt, NOW + 1);
  assert.deepEqual(buildSessionPlan({ ...input, now: NOW + 1 }).blocks, first.blocks);
  // A junk input degrades to an empty-but-valid plan rather than throwing.
  const junk = buildSessionPlan({
    due: 'x', skills: null, pairs: 5, defaults: 'y', curated: 'z', hasHistory: 'yes', now: 'now',
  });
  assert.equal(junk.blocks.length, 5);
  assert.equal(junk.builtAt, 0);
  assert.equal(junk.noHistory, true);
  assert.equal(junk.dueCount, 0);
});

test('familyDefaults fills every family and honours only the caller values it validates', () => {
  const patches = familyDefaults({ keyPc: 5, scaleId: 'blues', positionId: 'all', direction: 'up' }, curated());
  assert.equal(patches.scaleRun.keyPc, 5);
  assert.equal(patches.scaleRun.scaleId, 'blues');
  assert.equal(patches.scaleRun.direction, 'up');
  assert.equal(patches.findNote.keyPc, 5);
  assert.equal(patches.findNote.quizMode, 'find');
  // The play-along fallback keeps its own key: `No play-along yet — I-IV-V in C.` must stay true.
  assert.equal(patches.progression.keyPc, 0);
  assert.equal(patches.progression.progressionId, 'I-IV-V');
  assert.equal(patches.song.keyPc, SONGS[0].keyPc);
  // An out-of-range value is not a choice to honour: the curated patch survives.
  const junk = familyDefaults({ keyPc: 12, scaleId: '', positionId: 7, direction: 'sideways' }, curated());
  assert.equal(junk.scaleRun.keyPc, 0);
  assert.equal(junk.scaleRun.scaleId, SCALES[0].id);
  assert.equal(junk.scaleRun.positionId, 'all');
  assert.equal(junk.scaleRun.direction, 'updown');
  assert.deepEqual(familyDefaults(), {
    scaleRun: { drillFamily: 'scaleRun' },
    findNote: { drillFamily: 'findNote' },
    chordChanges: { drillFamily: 'chordChanges' },
    progression: { drillFamily: 'progression' },
    song: { drillFamily: 'song' },
  });
});

test('START seeds block 0 once and leaves the other four pending', () => {
  const plan = zeroHistory();
  const before = JSON.parse(JSON.stringify(plan));
  const started = sessionReduce({ ...emptySession(), plan }, { type: 'START', now: NOW });
  assert.equal(started.state.state, 'running');
  assert.equal(started.state.blockIndex, 0);
  assert.equal(started.state.startedAt, NOW);
  assert.equal(started.state.plan.blocks[0].state, 'now');
  assert.deepEqual(
    started.state.plan.blocks.slice(1).map(block => block.state),
    ['pending', 'pending', 'pending', 'pending'],
  );
  const seeds = started.effects.filter(effect => effect.type === 'seedAndStart');
  assert.equal(seeds.length, 1, 'exactly one block is launched');
  assert.equal(seeds[0].block.index, 0);
  assert.deepEqual(seeds[0].block.target, plan.blocks[0].target);
  const announces = started.effects.filter(effect => effect.type === 'announce');
  assert.equal(announces.length, 1);
  assert.equal(announces[0].key, 'session-ready');
  assert.deepEqual(announces[0].values, { blocks: 5, minutes: TOTAL_MINUTES });
  // Purity: the caller's plan and state are untouched.
  assert.deepEqual(plan, before);
  // A second START is not a second seed.
  const again = sessionReduce(started.state, { type: 'START', now: NOW + 1 });
  assert.deepEqual(again.effects, []);
  assert.equal(again.state.startedAt, NOW);
});

test('BLOCK_DONE credits one block once and a free-choice run credits nothing', () => {
  const plan = zeroHistory();
  const running = sessionReduce({ ...emptySession(), plan }, { type: 'START', now: NOW }).state;
  const summary = { skillId: 'scaleRun:minPent:0:all', activeMs: 96000, unguidedMs: 31000 };
  const done = sessionReduce(running, { type: 'BLOCK_DONE', index: 0, summary });
  assert.equal(done.state.completed, 1);
  assert.equal(done.state.minutesMs, 96000);
  assert.equal(done.state.unguidedMs, 31000);
  assert.deepEqual(done.state.skillsTouched, ['scaleRun:minPent:0:all']);
  assert.equal(done.state.plan.blocks[0].state, 'done');
  assert.deepEqual(done.effects, []);
  // The per-block gate: a second summary for the same block changes nothing at all.
  const twice = sessionReduce(done.state, {
    type: 'BLOCK_DONE', index: 0, summary: { ...summary, activeMs: 60000, unguidedMs: 60000, skillId: 'song:amazingGrace:verse:7' },
  });
  assert.equal(twice.state.completed, 1);
  assert.equal(twice.state.minutesMs, 96000);
  assert.equal(twice.state.unguidedMs, 31000);
  assert.deepEqual(twice.state.skillsTouched, ['scaleRun:minPent:0:all']);
  // A free-choice run never dispatches BLOCK_DONE, so the session stays at zero.
  const free = sessionReduce(running, { type: 'BLOCK_DONE', index: 9, summary });
  assert.equal(free.state.completed, 0);
  assert.equal(free.state.minutesMs, 0);
  // A summary the drill could not measure adds zero, never a NaN.
  const empty = sessionReduce(running, { type: 'BLOCK_DONE', index: 1, summary: {} });
  assert.equal(empty.state.completed, 1);
  assert.equal(empty.state.minutesMs, 0);
  assert.equal(empty.state.unguidedMs, 0);
  assert.deepEqual(empty.state.skillsTouched, []);
  // A second done block with a skill already touched does not duplicate it.
  const repeat = sessionReduce(done.state, { type: 'BLOCK_DONE', index: 1, summary });
  assert.deepEqual(repeat.state.skillsTouched, ['scaleRun:minPent:0:all']);
});

test('the reducer never mutates its input state or plan', () => {
  const plan = zeroHistory();
  const state = { ...emptySession(), plan };
  const frozenPlan = JSON.parse(JSON.stringify(plan));
  const { plan: _plan, ...rest } = state;
  const frozenState = JSON.parse(JSON.stringify(rest));
  for (const event of [
    { type: 'START', now: NOW },
    { type: 'BLOCK_DONE', index: 0, summary: { skillId: 'a', activeMs: 10, unguidedMs: 5 } },
    { type: 'CONTINUE', now: NOW },
    { type: 'SKIP', now: NOW },
    { type: 'REPEAT', now: NOW },
    { type: 'END', now: NOW, suggestion: { pairs: [{ pairId: 'C-G' }], now: NOW } },
    { type: 'CLOSE' },
    { type: 'unknown' },
  ]) {
    const result = sessionReduce(state, event);
    assert.ok(result && typeof result === 'object');
    assert.ok(Array.isArray(result.effects));
    assert.deepEqual(plan, frozenPlan, `${event.type} left the plan untouched`);
    const { plan: _untouched, ...after } = state;
    assert.deepEqual(after, frozenState, `${event.type} left the state untouched`);
  }
});

test('CLOSE returns an empty session', () => {
  const plan = zeroHistory();
  const running = sessionReduce({ ...emptySession(), plan }, { type: 'START', now: NOW }).state;
  const credited = sessionReduce(running, { type: 'BLOCK_DONE', index: 0, summary: { skillId: 'a', activeMs: 1000, unguidedMs: 500 } }).state;
  const closed = sessionReduce(credited, { type: 'CLOSE' });
  assert.deepEqual(closed, { state: emptySession(), effects: [] });
  assert.equal(closed.state.state, 'idle');
  assert.equal(closed.state.plan, null);
  assert.equal(closed.state.completed, 0);
  assert.deepEqual(closed.state.skillsTouched, []);
  // An empty session's own defaults are the literal zeros and the honest suggestion.
  assert.deepEqual(emptySession(), {
    state: 'idle', plan: null, blockIndex: 0, completed: 0, skipped: 0, skillsTouched: [],
    minutesMs: 0, unguidedMs: 0, startedAt: null, endedAt: null,
    nextSuggestionKey: 'nothingDue', nextSuggestionValues: {},
  });
});

// ---------- 05-01 Task 2: the block boundary, the summary and the announcements ----------
// One running session with block 0 already credited, so every boundary case starts from the same
// literal state a block's result leaves behind.
function startedSession() {
  return sessionReduce({ ...emptySession(), plan: zeroHistory() }, { type: 'START', now: NOW }).state;
}

function creditedFirstBlock() {
  return sessionReduce(startedSession(), {
    type: 'BLOCK_DONE',
    index: 0,
    summary: { skillId: 'scaleRun:minPent:0:all', activeMs: 120000, unguidedMs: 60000 },
  }).state;
}

test('CONTINUE advances one block at a time and the fifth ends the session exactly once', () => {
  let state = creditedFirstBlock();
  for (let index = 1; index < 5; index += 1) {
    const step = sessionReduce(state, { type: 'CONTINUE', now: NOW + index * 1000, suggestion: { now: NOW + index * 1000 } });
    state = step.state;
    assert.equal(state.state, 'running', `continue ${index} keeps the session under way`);
    assert.equal(state.blockIndex, index);
    assert.equal(state.plan.blocks[index].state, 'now');
    const seeds = step.effects.filter(effect => effect.type === 'seedAndStart');
    assert.equal(seeds.length, 1, 'one press starts one block');
    assert.equal(seeds[0].block.index, index);
    assert.deepEqual(seeds[0].block.target, state.plan.blocks[index].target);
    const said = step.effects.filter(effect => effect.type === 'announce');
    assert.equal(said.length, 1, 'one block-start announcement');
    assert.equal(said[0].key, 'session-block');
    assert.deepEqual(said[0].values, { index: index + 1, total: 5, kind: SESSION_BLOCKS[index].kind });
    state = sessionReduce(state, {
      type: 'BLOCK_DONE', index, summary: { skillId: `skill-${index}`, activeMs: 60000, unguidedMs: 0 },
    }).state;
  }
  assert.equal(state.completed, 5);
  const last = sessionReduce(state, { type: 'CONTINUE', now: NOW + 9000, suggestion: { now: NOW + 9000 } });
  assert.equal(last.state.state, 'summary');
  assert.equal(last.state.completed, 5);
  assert.equal(last.state.skipped, 0);
  assert.equal(last.state.endedAt, NOW + 9000);
  assert.equal(last.effects.filter(effect => effect.type === 'openPanelAndAnnounce').length, 1,
    'the panel opens itself once');
  const complete = last.effects.filter(effect => effect.type === 'announce');
  assert.equal(complete.length, 1);
  assert.equal(complete[0].key, 'session-complete');
  assert.deepEqual(complete[0].values, { minutes: 6, unguided: 1 }, 'two minutes then four more');
  assert.deepEqual(last.effects.filter(effect => effect.type === 'seedAndStart'), [], 'nothing is launched at the end');
  // A sixth CONTINUE is not a second summary and not a second announcement.
  const again = sessionReduce(last.state, { type: 'CONTINUE', now: NOW + 10000 });
  assert.deepEqual(again.effects, []);
  assert.equal(again.state.state, 'summary');
});

test('SKIP counts a block as skipped and never touches completed or the recorded minutes', () => {
  const plan = zeroHistory();
  const skipped = sessionReduce(startedSession(), { type: 'SKIP', now: NOW + 1000 });
  assert.equal(skipped.state.skipped, 1);
  assert.equal(skipped.state.completed, 0, 'a skipped block is never a completed one');
  assert.equal(skipped.state.minutesMs, 0);
  assert.equal(skipped.state.plan.blocks[0].state, 'skipped');
  assert.equal(skipped.state.blockIndex, 1);
  assert.equal(skipped.state.plan.blocks[1].state, 'now');
  const seeds = skipped.effects.filter(effect => effect.type === 'seedAndStart');
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].block.index, 1);
  // The skipped block keeps its target and its reason: nothing is destroyed, it just did not run.
  assert.deepEqual(skipped.state.plan.blocks[0].target, plan.blocks[0].target);
  assert.equal(skipped.state.plan.blocks[0].reasonKey, 'alwaysFirst');
  // CR-01: `Skip` at a block boundary means "do not run the next block", never "un-run the block
  // whose result is on screen". The block already paid its minutes, so it stays `done` and the
  // Blocks tile keeps agreeing with the Minutes tile.
  const after = sessionReduce(creditedFirstBlock(), { type: 'SKIP', now: NOW + 2000 });
  assert.equal(after.state.completed, 1, 'a completed block stays completed');
  assert.equal(after.state.skipped, 0, 'nothing was skipped: the block ran');
  assert.equal(after.state.minutesMs, 120000, 'a recorded minute is never subtracted');
  assert.equal(after.state.unguidedMs, 60000);
  assert.equal(after.state.blockIndex, 1, 'the press still moves the session on');
  assert.equal(after.state.plan.blocks[0].state, 'done');
  // The Blocks tile and the Minutes tile now describe the same run: one block done, no skip.
  const tiles = sessionSummaryOf(after.state);
  assert.equal(tiles.blocks, '1 of 5');
  assert.equal(tiles.skipped, 0);
});

test('CR-01: every boundary verb keeps one outcome per block and the tiles agree with the plan', () => {
  // The normal four-verb boundary: the same literal state a block's own result leaves behind, one
  // verb per fresh copy, so nothing a verb does can leak into the next case.
  const boundary = () => creditedFirstBlock();
  const tilesOf = state => sessionSummaryOf(state);
  const settled = state => state.plan.blocks.filter(block => block.state === 'done' || block.state === 'skipped').length;

  // `Next block`: the credit stays and nothing is skipped.
  const next = sessionReduce(boundary(), { type: 'CONTINUE', now: NOW + 1000 });
  assert.equal(next.state.completed, 1);
  assert.equal(next.state.skipped, 0);
  assert.equal(tilesOf(next.state).blocks, '1 of 5');

  // `Skip` at the same boundary is "do not run the *next* block": the block whose result is on
  // screen already paid its minutes and stays done, so the two tiles describe one run.
  const skip = sessionReduce(boundary(), { type: 'SKIP', now: NOW + 1000 });
  assert.equal(skip.state.completed, 1);
  assert.equal(skip.state.skipped, 0);
  assert.equal(tilesOf(skip.state).blocks, '1 of 5');
  assert.equal(skip.state.minutesMs, 120000, 'the press never subtracts a minute');

  // `Repeat` re-seeds this block and keeps its credit in the totals.
  const repeat = sessionReduce(boundary(), { type: 'REPEAT', now: NOW + 1000 });
  assert.equal(repeat.state.completed, 1);
  assert.equal(repeat.state.skipped, 0);
  assert.deepEqual(repeat.effects.filter(effect => effect.type === 'seedAndStart').map(effect => effect.block.index), [0]);

  // `End session`: one block ran and four never did — five outcomes for five blocks, never six.
  const end = sessionReduce(boundary(), { type: 'END', now: NOW + 1000, suggestion: { now: NOW + 1000 } });
  assert.equal(end.state.state, 'summary');
  assert.equal(end.state.completed, 1);
  assert.equal(end.state.skipped, 4);
  assert.equal(settled(end.state), 5, 'five blocks, five outcomes');
  assert.equal(tilesOf(end.state).blocks, '1 of 5');
  assert.equal(tilesOf(end.state).skipped, 4);

  // And a block that genuinely never ran is still reclassified: the rule is about credit, not
  // about which button was pressed.
  const notRun = sessionReduce(startedSession(), { type: 'SKIP', now: NOW + 1000 });
  assert.equal(notRun.state.completed, 0);
  assert.equal(notRun.state.skipped, 1);
  assert.equal(settled(notRun.state), 1);
});

test('REPEAT clears the credit gate so a second BLOCK_DONE adds to the totals', () => {
  const done = creditedFirstBlock();
  const repeat = sessionReduce(done, { type: 'REPEAT', now: NOW + 1000 });
  assert.equal(repeat.state.plan.blocks[0].state, 'now');
  assert.equal(repeat.state.plan.blocks[0].credited, false);
  assert.equal(repeat.state.completed, 1);
  assert.equal(repeat.state.minutesMs, 120000, 'a repeat never subtracts what already ran');
  const seeds = repeat.effects.filter(effect => effect.type === 'seedAndStart');
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].block.index, 0);
  assert.deepEqual(seeds[0].block.target, done.plan.blocks[0].target);
  const again = sessionReduce(repeat.state, {
    type: 'BLOCK_DONE',
    index: 0,
    summary: { skillId: 'scaleRun:minPent:0:all', activeMs: 60000, unguidedMs: 5000 },
  });
  assert.equal(again.state.minutesMs, 180000, 'the second run accumulates');
  assert.equal(again.state.unguidedMs, 65000);
  assert.equal(again.state.completed, 1, 'the block is still one of five');
  assert.deepEqual(again.state.skillsTouched, ['scaleRun:minPent:0:all']);
});

test('END marks every pending or now block skipped and leaves the recorded totals untouched', () => {
  const plan = zeroHistory();
  const atSecondBlock = sessionReduce(creditedFirstBlock(), { type: 'CONTINUE', now: NOW + 1000 }).state;
  const ended = sessionReduce(atSecondBlock, {
    type: 'END', now: NOW + 2000, suggestion: { pairs: [{ pairId: 'C-G' }], now: NOW + 2000 },
  });
  assert.equal(ended.state.state, 'summary');
  assert.equal(ended.state.completed, 1);
  assert.equal(ended.state.minutesMs, 120000, 'ending a session never subtracts a recorded minute');
  assert.equal(ended.state.unguidedMs, 60000);
  assert.equal(ended.state.skipped, 4, 'the four blocks that never finished');
  assert.deepEqual(ended.state.plan.blocks.map(block => block.state), ['done', 'skipped', 'skipped', 'skipped', 'skipped']);
  assert.equal(ended.state.nextSuggestionKey, 'weakestPair');
  assert.deepEqual(ended.state.nextSuggestionValues, {});
  assert.equal(ended.effects.filter(effect => effect.type === 'openPanelAndAnnounce').length, 1);
  assert.deepEqual(
    ended.state.plan.blocks[0].target,
    plan.blocks[0].target,
    'the block that ran keeps its own target',
  );
  // END never launches anything: the run is the drill's and the panel is the session's.
  assert.deepEqual(ended.effects.filter(effect => effect.type === 'seedAndStart'), []);
});

test('WR-04: END recomputes both counters, so no block lands in the Blocks tile twice', () => {
  // `REPEAT` leaves the block `now` with its first run still credited. `END` must not turn that
  // run into a sixth outcome: the block completed, so it stays done and only the four blocks that
  // never started are skipped.
  const repeated = sessionReduce(creditedFirstBlock(), { type: 'REPEAT', now: NOW + 1000 }).state;
  const ended = sessionReduce(repeated, { type: 'END', now: NOW + 2000, suggestion: { now: NOW + 2000 } });
  assert.equal(ended.state.state, 'summary');
  assert.equal(ended.state.completed, 1, 'the run that paid its minutes stays completed');
  assert.equal(ended.state.skipped, 4, 'the four blocks that never ran');
  assert.deepEqual(ended.state.plan.blocks.map(block => block.state), ['done', 'skipped', 'skipped', 'skipped', 'skipped']);
  const tiles = sessionSummaryOf(ended.state);
  assert.equal(tiles.blocks, '1 of 5');
  assert.equal(tiles.skipped, 4);
  assert.equal(tiles.completed + tiles.skipped, tiles.total, 'five blocks, five outcomes — never six');
  assert.equal(tiles.minutesMs, 120000, 'and the Minutes tile still counts the one run');
  // The defect this pins: `1 of 5` beside `5 skipped.` claimed six outcomes from five blocks.
  assert.notEqual(`${tiles.blocks}/${tiles.skipped}`, '1 of 5/5');
});

test('END on a session that never started answers the 0 of 5 summary', () => {
  const ended = sessionReduce(emptySession(), { type: 'END', now: NOW, suggestion: { now: NOW } });
  assert.equal(ended.state.state, 'summary');
  assert.equal(ended.state.endedAt, NOW);
  assert.equal(ended.state.plan, null);
  const tiles = sessionSummaryOf(ended.state);
  assert.equal(tiles.blocks, '0 of 5');
  assert.equal(tiles.minutesMs, 0, 'that is the `0 min` tile');
  assert.equal(tiles.unguidedMs, 0);
  assert.equal(tiles.completed, 0);
  assert.equal(tiles.skipped, 0);
  assert.equal(tiles.total, 5);
  assert.equal(tiles.skills, 0);
  assert.equal(tiles.streak, 0);
  // No NaN, no undefined and no empty string in a numeric slot.
  for (const value of [tiles.minutesMs, tiles.unguidedMs, tiles.streak, tiles.completed,
    tiles.skipped, tiles.total, tiles.skills]) {
    assert.equal(typeof value, 'number');
    assert.ok(Number.isFinite(value), 'every numeric slot is a real number');
  }
  // The summary opens once and never opens again from a finished session.
  assert.equal(ended.effects.filter(effect => effect.type === 'openPanelAndAnnounce').length, 1);
  assert.equal(sessionReduce(ended.state, { type: 'END', now: NOW }).effects.length, 0);
});

test('sessionSummaryOf answers the five tile values from a literal state', () => {
  const state = {
    ...emptySession(),
    state: 'summary',
    completed: 4,
    skipped: 1,
    minutesMs: 13 * 60000,
    unguidedMs: 4 * 60000,
    skillsTouched: ['a', 'b', 'a', 'c'],
    endedAt: NOW,
  };
  const tiles = sessionSummaryOf(state, { streak: 3 });
  assert.equal(tiles.minutesMs, 780000);
  assert.equal(tiles.unguidedMs, 240000);
  assert.equal(tiles.streak, 3);
  assert.equal(tiles.completed, 4);
  assert.equal(tiles.skipped, 1);
  assert.equal(tiles.total, 5);
  assert.equal(tiles.blocks, '4 of 5');
  assert.equal(tiles.skills, 3, 'distinct ids only');
  // Junk in every slot still answers zeros, never a NaN or a blank.
  const junk = sessionSummaryOf({ minutesMs: 'x', unguidedMs: NaN, completed: -2, skillsTouched: 'a' }, { streak: 'three' });
  assert.equal(junk.minutesMs, 0);
  assert.equal(junk.unguidedMs, 0);
  assert.equal(junk.streak, 0);
  assert.equal(junk.completed, 0);
  assert.equal(junk.blocks, '0 of 5');
  assert.equal(junk.skills, 0);
  assert.equal(sessionSummaryOf().blocks, '0 of 5');
  assert.equal(sessionSummaryOf(null).total, 5);
});

test('nextSuggestionOf answers the three approved branches in order', () => {
  const day = 24 * 60 * 60 * 1000;
  assert.deepEqual(
    nextSuggestionOf({ focusDueAt: NOW + 3 * day, pairs: [{ pairId: 'C-G' }], now: NOW }),
    { key: 'dueAgain', values: { days: 3 } },
    'a due focus outranks the weakest pair',
  );
  // A part day counts as a whole one, and a due date in the past is due today, never negative.
  assert.deepEqual(nextSuggestionOf({ focusDueAt: NOW + 30 * 60 * 60 * 1000, now: NOW }), { key: 'dueAgain', values: { days: 2 } });
  assert.deepEqual(nextSuggestionOf({ focusDueAt: NOW - 5 * day, now: NOW }), { key: 'dueAgain', values: { days: 0 } });
  assert.deepEqual(
    nextSuggestionOf({ focusDueAt: null, pairs: [{ pairId: 'C-G' }], now: NOW }),
    { key: 'weakestPair', values: {} },
  );
  assert.deepEqual(nextSuggestionOf({ focusDueAt: null, pairs: [], now: NOW }), { key: 'nothingDue', values: {} });
  assert.deepEqual(nextSuggestionOf(), { key: 'nothingDue', values: {} });
  assert.deepEqual(nextSuggestionOf({ focusDueAt: 'x', pairs: 'y', now: 'z' }), { key: 'nothingDue', values: {} });
});

test('the session speaks four sentences and nothing else', () => {
  assert.equal(
    sessionAnnouncementText({ key: 'session-ready', values: { blocks: 5, minutes: 13 } }),
    'Session ready — five blocks, 13 minutes.',
  );
  assert.equal(
    sessionAnnouncementText({ key: 'session-block', values: { index: 2, total: 5, kind: 'focus' } }),
    'Block 2 of 5. Focus.',
  );
  assert.equal(
    sessionAnnouncementText({ key: 'session-boundary', values: { index: 2, total: 5 } }),
    'Block 2 of 5 done.',
  );
  assert.equal(
    sessionAnnouncementText({ key: 'session-complete', values: { minutes: 13, unguided: 4 } }),
    'Session complete. 13 minutes, 4 minutes unguided.',
  );
  // Every block kind the template schedules has its own sentence, and an unknown one is the focus.
  assert.equal(sessionAnnouncementText({ key: 'session-block', values: { index: 1, total: 5, kind: 'warmup' } }), 'Block 1 of 5. Warm-up.');
  assert.equal(sessionAnnouncementText({ key: 'session-block', values: { index: 3, total: 5, kind: 'new' } }), 'Block 3 of 5. New material.');
  assert.equal(sessionAnnouncementText({ key: 'session-block', values: { index: 4, total: 5, kind: 'play' } }), 'Block 4 of 5. Play-along.');
  assert.equal(sessionAnnouncementText({ key: 'session-block', values: { index: 5, total: 5, kind: 'recall' } }), 'Block 5 of 5. Recall.');
  assert.equal(sessionAnnouncementText({ key: 'session-block', values: { index: 2, total: 5, kind: 'constructor' } }), 'Block 2 of 5. Focus.');
  // An unknown key answers nothing at all, so `announce` is never called with an empty message.
  assert.equal(sessionAnnouncementText({ key: 'nope' }), '');
  assert.equal(sessionAnnouncementText(), '');
  // The summary's one next suggestion: three approved sentences, and the honest fallback.
  assert.equal(sessionNextText({ key: 'dueAgain', values: { days: 3 } }), 'Next: the focus skill is due again in 3 days.');
  assert.equal(sessionNextText({ key: 'dueAgain', values: { days: 1 } }), 'Next: the focus skill is due again in 1 day.');
  assert.equal(sessionNextText({ key: 'weakestPair' }), 'Next: practise the weakest pair tomorrow.');
  assert.equal(sessionNextText({ key: 'nothingDue' }), 'Next: nothing due — pick a new family.');
  assert.equal(sessionNextText({ key: 'nope' }), 'Next: nothing due — pick a new family.');
});

test('suggestionFor returns exactly one action for every row of the decision table', () => {
  // A stopped pass or an overrun block ends the rep and fills nothing.
  assert.equal(suggestionFor({ stoppedEarly: true }).key, 'stop');
  assert.equal(suggestionFor({ pass: { stoppedEarly: true } }).key, 'stop');
  assert.equal(suggestionFor({ block: { minutes: 3 }, elapsedMs: 3 * 60000 * 1.6 }).key, 'stop');
  // A running block with nothing after it is the end of the session.
  assert.equal(suggestionFor({ phase: 'result', block: { minutes: 3 }, nextItem: null }).key, 'stop');
  // A clean timed pass with room above the tempo gets +BPM.
  const bpm = suggestionFor({
    pass: { selfReport: 'clean', stoppedEarly: false }, timed: true, bpm: 80, nextBpm: 84,
  });
  assert.deepEqual(bpm, { key: 'bpm', bpm: 84, nextItem: null });
  // 240 is the ceiling, and an untimed family never gets +BPM.
  assert.equal(suggestionFor({ pass: { selfReport: 'clean' }, timed: true, bpm: 240, nextBpm: 244 }).key, 'repeat');
  assert.equal(suggestionFor({ pass: { selfReport: 'clean' }, timed: false, bpm: 80, nextBpm: 84 }).key, 'repeat');
  // A next item at a boundary (or a free-choice result) gets Next drill.
  assert.equal(suggestionFor({ phase: 'result', nextItem: { skillId: 's' } }).key, 'next');
  assert.equal(suggestionFor({ block: { minutes: 3 }, nextItem: { skillId: 's' } }).key, 'next');
  // Everything else repeats.
  assert.equal(suggestionFor({ pass: { selfReport: 'shaky' }, bpm: 80, nextBpm: 84 }).key, 'repeat');
  assert.equal(suggestionFor().key, 'repeat');
});
