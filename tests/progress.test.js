// Pure progress/mastery model: skill upsert, the with/without-lights planes, the
// mastery gate, beat-derived minutes and the same-session re-report delta.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BACKUP_SCHEMA_VERSION, CLEAN_THRESHOLDS, DECAY_DAYS, MAX_BACKUP_LENGTH, MAX_PAIRS, MAX_SESSIONS, MAX_SKILLS,
  FAMILY_OF_KIND, LIGHT_FAMILIES, REVIEW_INTERVALS, addDays, applyResult, chordPairRows, createSkill, dayKey, daysBetween, dueRows,
  emptyProgress, exportDoc, familyLevelCounts, fitProgress, lightLevelOf, skillFamily, passActiveMs, skillIdFor, skillRows, skillState, startLevelFor,
  validateBackup, validateProgress, validateSession, weakestPair, liveStreak,
} from '../app/src/progress.js';
import { validateSettings } from '../app/src/settings.js';
import {
  CHORD_CLEAN_RESULT, CHORD_HALF_RESULT, CLEAN_RESULT, FIXED_DAY, FIXED_NOW, SHAKY_RESULT,
  STOPPED_EARLY_RESULT, SYNTHETIC_CHART, V2_PROGRESS, V2_RECORD,
} from './fixtures/progress.js';

const apply = (progress, result, now = FIXED_NOW) => applyResult(progress, result, { now });

function withRecallReport(result, report) {
  const passes = result.passes.map(pass => (
    pass.hintLevel === 3
      ? { ...pass, selfReport: report, unguidedMs: report === 'clean' ? passActiveMs(pass.completedSteps, pass.bpm) : 0 }
      : { ...pass }
  ));
  return { ...result, passes, recall: { ...result.recall, selfReport: report } };
}

test('the review intervals and clean thresholds are stored constants', () => {
  assert.deepEqual(REVIEW_INTERVALS, [1, 3, 7, 14, 30]);
  assert.equal(DECAY_DAYS, 14);
  assert.deepEqual(CLEAN_THRESHOLDS, { minAccuracy: 0.9, maxMedianTimingMs: 120 });
  assert.equal(MAX_SESSIONS, 20);
});

test('emptyProgress returns a fresh version 1 store with zero totals and an empty streak', () => {
  const progress = emptyProgress();
  assert.deepEqual(progress, {
    version: 1,
    skills: {},
    chordPairs: {},
    sessions: [],
    totals: { totalMs: 0, unguidedMs: 0, sessionCount: 0 },
    streak: { current: 0, longest: 0, lastDay: '' },
  });
  assert.notEqual(emptyProgress(), progress, 'every call returns a fresh object');
  assert.notEqual(emptyProgress().chordPairs, progress.chordPairs, 'every call returns a fresh pair plane');
});

test('skillIdFor is the chart id and passActiveMs is beat-derived', () => {
  assert.equal(skillIdFor(SYNTHETIC_CHART), 'scaleRun:minPent:9:s6f0');
  assert.equal(passActiveMs(16, 80), 12000);
  assert.equal(passActiveMs(8, 60), 8000);
  assert.equal(passActiveMs(0, 80), 0);
  assert.equal(passActiveMs(4, 0), 0, 'a missing tempo cannot divide by zero');
});

test('startLevelFor ramps one level easier and never opens on the recall pass', () => {
  const cases = [[undefined, 0], [0, 0], [1, 0], [2, 1], [3, 2]];
  for (const [bestLevel, expected] of cases) {
    const progress = { skills: { skill: { bestLevel } }, sessions: [], totals: {} };
    assert.equal(startLevelFor(progress, 'skill'), expected, `bestLevel ${bestLevel}`);
  }
  assert.equal(startLevelFor(emptyProgress(), 'missing'), 0);
  assert.equal(startLevelFor(null, 'missing'), 0);
});

test('createSkill makes the full D-27 record with unscored fields null', () => {
  const skill = createSkill(SYNTHETIC_CHART, FIXED_NOW);
  assert.equal(skill.skillId, SYNTHETIC_CHART.id);
  assert.equal(skill.kind, 'scaleRun');
  assert.deepEqual(skill.content, SYNTHETIC_CHART.content);
  assert.deepEqual(skill.withLights, { cleanPasses: 0, bestBpm: 0, bestLevel: 0, lastCleanAt: null, lastFailAt: null });
  assert.deepEqual(skill.withoutLights, { cleanPasses: 0, bestBpm: 0, bestLevel: 0, lastCleanAt: null, lastFailAt: null });
  assert.equal(skill.bestBpm, 0);
  assert.equal(skill.bestLevel, 0);
  assert.equal(skill.cleanPasses, 0);
  assert.equal(skill.accuracy, null);
  assert.equal(skill.medianTimingMs, null);
  assert.equal(skill.micUsed, false);
  assert.equal(skill.masteredAt, null);
  assert.equal(skill.lastCleanRecallAt, null);
  assert.equal(skill.dueAt, null);
  assert.equal(skill.intervalIndex, 0);
  assert.equal(skill.lapses, 0);
  assert.equal(skill.createdAt, FIXED_NOW);
  assert.equal(skill.updatedAt, FIXED_NOW);
});

test('a clean with-hints pass never masters the skill', () => {
  const progress = apply(emptyProgress(), STOPPED_EARLY_RESULT);
  const skill = progress.skills[SYNTHETIC_CHART.id];
  assert.equal(skill.masteredAt, null);
  assert.equal(skill.withLights.cleanPasses, 1);
  assert.equal(skill.withLights.bestLevel, 0);
  assert.equal(skill.withoutLights.cleanPasses, 0);
  assert.equal(skill.cleanPasses, 1);
  assert.equal(skill.bestLevel, 0);
});

test('a clean completed H3 pass sets mastery and the no-lights plane', () => {
  const progress = apply(emptyProgress(), CLEAN_RESULT);
  const skill = progress.skills[SYNTHETIC_CHART.id];
  assert.equal(skill.skillId, SYNTHETIC_CHART.id, 'the record carries its own semantic id');
  assert.equal(skill.masteredAt, FIXED_NOW);
  assert.equal(skill.lastCleanRecallAt, FIXED_NOW);
  assert.equal(skill.withoutLights.cleanPasses, 1);
  assert.equal(skill.withoutLights.bestLevel, 3);
  assert.equal(skill.withoutLights.bestBpm, 80);
  assert.equal(skill.withLights.cleanPasses, 1);
  assert.equal(skill.withLights.bestLevel, 0);
  assert.equal(skill.bestLevel, 3);
  assert.equal(skill.bestBpm, 80);
  assert.equal(skill.cleanPasses, 2);
});

test('a shaky or skipped H3 does not master the skill', () => {
  const shaky = apply(emptyProgress(), SHAKY_RESULT).skills[SYNTHETIC_CHART.id];
  assert.equal(shaky.masteredAt, null);
  assert.equal(shaky.lapses, 1);
  assert.equal(shaky.withoutLights.lastFailAt, FIXED_NOW);
  assert.equal(shaky.withoutLights.cleanPasses, 0);
  assert.equal(shaky.bestLevel, 0, 'a shaky pass never raises the best level');

  const skipped = apply(emptyProgress(), withRecallReport(CLEAN_RESULT, null)).skills[SYNTHETIC_CHART.id];
  assert.equal(skipped.masteredAt, null);
  assert.equal(skipped.lapses, 0);
  assert.equal(skipped.withoutLights.cleanPasses, 0);
});

test('with-lights and without-lights counters stay separate and are never averaged', () => {
  const skill = apply(emptyProgress(), CLEAN_RESULT).skills[SYNTHETIC_CHART.id];
  assert.notDeepEqual(skill.withLights, skill.withoutLights);
  assert.equal(skill.cleanPasses, skill.withLights.cleanPasses + skill.withoutLights.cleanPasses);
  assert.equal(skill.withLights.bestLevel, 0);
  assert.equal(skill.withoutLights.bestLevel, 3);
});

test('a scored result writes accuracy, median timing and micUsed on the same skill record', () => {
  const scored = {
    ...CLEAN_RESULT,
    syncScore: { accuracy: 0.82, timing: { medianMs: 20 } },
  };
  const progress = apply(emptyProgress(), scored);
  const skill = progress.skills[CLEAN_RESULT.skillId];
  assert.equal(skill.accuracy, 0.82);
  assert.equal(skill.medianTimingMs, 20);
  assert.equal(skill.micUsed, true);

  // A later unscored rep leaves the earlier evidence intact (never averaged, never cleared).
  const unscored = { ...CLEAN_RESULT, sessionId: 'later-unscored', syncScore: null };
  const after = apply(progress, unscored, FIXED_NOW + 1000);
  assert.equal(after.skills[CLEAN_RESULT.skillId].accuracy, 0.82);
  assert.equal(after.skills[CLEAN_RESULT.skillId].medianTimingMs, 20);
  assert.equal(after.skills[CLEAN_RESULT.skillId].micUsed, true);

  // A re-report of the same session does not double-apply or clear the evidence.
  const again = apply(progress, scored, FIXED_NOW + 2000);
  assert.equal(again.skills[CLEAN_RESULT.skillId].accuracy, 0.82);
  assert.equal(again.skills[CLEAN_RESULT.skillId].medianTimingMs, 20);
});

test('a stopped chord pass folds only the bars it reached into its pair row', () => {
  const twoBars = {
    ...CHORD_CLEAN_RESULT,
    stoppedEarly: true,
    changes: {
      ...CHORD_CLEAN_RESULT.changes,
      reached: 2,
      clean: 2,
      changesPerMin: 20,
    },
  };
  const progress = apply(emptyProgress(), twoBars);
  const row = progress.chordPairs['C-G'];
  assert.equal(row.attempts, 2, 'two bars reached, not eight planned');
  assert.equal(row.clean, 2);

  const zeroBars = {
    ...twoBars,
    sessionId: 'stopped-zero',
    changes: { ...twoBars.changes, reached: 0, clean: 0 },
  };
  const none = apply(emptyProgress(), zeroBars);
  assert.equal(Object.hasOwn(none.chordPairs, 'C-G'), false, 'an abandoned attempt records nothing');
});

test('accuracy, median timing and micUsed stay unscored in Phase 2', () => {
  const skill = apply(emptyProgress(), CLEAN_RESULT).skills[SYNTHETIC_CHART.id];
  assert.equal(skill.accuracy, null);
  assert.equal(skill.medianTimingMs, null);
  assert.equal(skill.micUsed, false);
});

// WR-07: Phase 2 does not own accuracy/mic evidence, so a later drill must preserve
// values that arrived from a Phase 3 record or an import.
test('a later drill preserves imported microphone evidence', () => {
  const seeded = validateProgress({
    skills: {
      [SYNTHETIC_CHART.id]: {
        skillId: SYNTHETIC_CHART.id,
        accuracy: 0.95,
        medianTimingMs: 80,
        micUsed: true,
        bestLevel: 2,
      },
    },
  });
  const progress = apply(seeded, STOPPED_EARLY_RESULT, FIXED_NOW + 1000);
  const skill = progress.skills[SYNTHETIC_CHART.id];
  assert.equal(skill.accuracy, 0.95);
  assert.equal(skill.medianTimingMs, 80);
  assert.equal(skill.micUsed, true);

  const junk = apply(validateProgress({
    skills: { [SYNTHETIC_CHART.id]: { accuracy: 5, medianTimingMs: -10001, micUsed: 'yes' } },
  }), STOPPED_EARLY_RESULT, FIXED_NOW + 1000).skills[SYNTHETIC_CHART.id];
  assert.equal(junk.accuracy, null, 'out-of-range evidence is never invented');
  assert.equal(junk.medianTimingMs, null);
  assert.equal(junk.micUsed, false);
});

test('unguidedMs counts only the clean completed H3 pass', () => {
  const clean = apply(emptyProgress(), CLEAN_RESULT);
  assert.equal(clean.totals.totalMs, 24000, 'both passes contribute active time');
  assert.equal(clean.totals.unguidedMs, 12000, 'only the recall is unguided');
  assert.equal(clean.totals.sessionCount, 1);
  assert.equal(clean.sessions[0].durationMs, 24000);
  assert.equal(clean.sessions[0].unguidedMs, 12000);
  assert.equal(clean.sessions[0].completedPasses, 2);

  const shaky = apply(emptyProgress(), SHAKY_RESULT);
  assert.equal(shaky.totals.totalMs, 24000);
  assert.equal(shaky.totals.unguidedMs, 0);
});

test('a repeated applyResult with the same sessionId leaves totals and counts unchanged', () => {
  const first = apply(emptyProgress(), CLEAN_RESULT);
  const again = apply(first, CLEAN_RESULT, FIXED_NOW + 999);
  assert.deepEqual(again.totals, first.totals);
  assert.equal(again.sessions.length, 1);
  assert.equal(again.skills[SYNTHETIC_CHART.id].cleanPasses, first.skills[SYNTHETIC_CHART.id].cleanPasses);
  assert.equal(again.skills[SYNTHETIC_CHART.id].withLights.cleanPasses, 1);
  assert.equal(again.skills[SYNTHETIC_CHART.id].withoutLights.cleanPasses, 1);
});

// CR-01: no session id means the result is never applied. Applying the same
// session-less result twice must not multiply the mastery counters.
test('a result without a session id never applies its passes', () => {
  const anonymous = { ...CLEAN_RESULT, sessionId: null };
  const first = apply(emptyProgress(), anonymous);
  const second = apply(first, anonymous, FIXED_NOW + 1000);
  assert.equal(first.skills[SYNTHETIC_CHART.id].cleanPasses, 0);
  assert.equal(first.skills[SYNTHETIC_CHART.id].withoutLights.cleanPasses, 0);
  assert.deepEqual(first.totals, { totalMs: 0, unguidedMs: 0, sessionCount: 0 });
  assert.equal(first.sessions.length, 0);
  assert.equal(second.skills[SYNTHETIC_CHART.id].cleanPasses, 0);
  assert.deepEqual(second.totals, first.totals);
});

test('a clean-to-shaky re-report removes exactly the recall minutes and keeps one session', () => {
  const clean = apply(emptyProgress(), CLEAN_RESULT);
  const shaky = apply(clean, SHAKY_RESULT);
  assert.equal(shaky.totals.unguidedMs, 0);
  assert.equal(shaky.totals.totalMs, 24000);
  assert.equal(shaky.totals.sessionCount, 1);
  assert.equal(shaky.sessions.length, 1);
  assert.equal(shaky.sessions[0].unguidedMs, 0);
  const skill = shaky.skills[SYNTHETIC_CHART.id];
  assert.equal(skill.withLights.cleanPasses, 1, 'with-hints counts are untouched');
  assert.equal(skill.withoutLights.cleanPasses, 0);
  assert.equal(skill.cleanPasses, 1);
  assert.equal(skill.lapses, 1);
  assert.equal(skill.masteredAt, FIXED_NOW, 'a shaky report never clears historical mastery');
});

test('a shaky-to-clean re-report adds mastery and unguided minutes exactly once', () => {
  const shaky = apply(emptyProgress(), SHAKY_RESULT);
  const clean = apply(shaky, CLEAN_RESULT, FIXED_NOW + 5000);
  assert.equal(clean.totals.unguidedMs, 12000);
  assert.equal(clean.totals.sessionCount, 1);
  assert.equal(clean.sessions.length, 1);
  assert.equal(clean.sessions[0].unguidedMs, 12000);
  const skill = clean.skills[SYNTHETIC_CHART.id];
  assert.equal(skill.masteredAt, FIXED_NOW + 5000);
  assert.equal(skill.lapses, 0);
  assert.equal(skill.withoutLights.cleanPasses, 1);
  assert.equal(skill.cleanPasses, 2);

  const again = apply(clean, CLEAN_RESULT, FIXED_NOW + 9000);
  assert.equal(again.totals.unguidedMs, 12000, 'a second clean apply does not add again');
  assert.equal(again.skills[SYNTHETIC_CHART.id].masteredAt, FIXED_NOW + 5000, 'mastery is set once');
});

test('a stopped-early drill keeps its completed pass and adds no mastery', () => {
  const progress = apply(emptyProgress(), STOPPED_EARLY_RESULT);
  const session = progress.sessions[0];
  assert.equal(session.completedPasses, 1);
  assert.equal(session.completed, false);
  assert.equal(session.stoppedEarly, true);
  assert.equal(progress.totals.totalMs, 12000);
  assert.equal(progress.totals.unguidedMs, 0);
  assert.equal(progress.skills[SYNTHETIC_CHART.id].masteredAt, null);
});

test('best tempo and best level are historical and are not lowered by a correction', () => {
  const clean = apply(emptyProgress(), CLEAN_RESULT);
  const shaky = apply(clean, SHAKY_RESULT);
  assert.equal(shaky.skills[SYNTHETIC_CHART.id].bestBpm, 80);
  assert.equal(shaky.skills[SYNTHETIC_CHART.id].bestLevel, 3);
  assert.equal(shaky.skills[SYNTHETIC_CHART.id].withoutLights.bestBpm, 80);
});

test('totals are clamped at zero when a correction would subtract below it', () => {
  const clean = apply(emptyProgress(), CLEAN_RESULT);
  const broken = { ...clean, totals: { totalMs: 1000, unguidedMs: 500, sessionCount: 1 } };
  const next = apply(broken, SHAKY_RESULT);
  assert.equal(next.totals.unguidedMs, 0, 'the unguided delta cannot go below zero');
  assert.equal(next.totals.totalMs, 1000, 'an unchanged duration leaves the total alone');

  const shrunk = apply(broken, { ...SHAKY_RESULT, passes: [SHAKY_RESULT.passes[1]] });
  assert.equal(shrunk.totals.totalMs, 0, 'a duration drop is clamped at zero');
  assert.equal(shrunk.totals.unguidedMs, 0);
});

test('applyResult never mutates its input progress', () => {
  const clean = apply(emptyProgress(), CLEAN_RESULT);
  const snapshot = JSON.stringify(clean);
  apply(clean, SHAKY_RESULT);
  assert.equal(JSON.stringify(clean), snapshot);
});

test('the real two-step flow applies with-hints once and only the recall delta on report', () => {
  const unreported = {
    ...CLEAN_RESULT,
    passes: CLEAN_RESULT.passes.map(pass => (
      pass.hintLevel === 3 ? { ...pass, selfReport: null, unguidedMs: 0 } : { ...pass }
    )),
    recall: { ...CLEAN_RESULT.recall, selfReport: null },
  };
  const beforeReport = apply(emptyProgress(), unreported);
  assert.equal(beforeReport.skills[SYNTHETIC_CHART.id].withLights.cleanPasses, 1);
  assert.equal(beforeReport.skills[SYNTHETIC_CHART.id].withoutLights.cleanPasses, 0);
  assert.equal(beforeReport.skills[SYNTHETIC_CHART.id].masteredAt, null);
  assert.equal(beforeReport.totals.totalMs, 24000);
  assert.equal(beforeReport.totals.unguidedMs, 0);
  assert.equal(beforeReport.totals.sessionCount, 1);

  const afterReport = apply(beforeReport, CLEAN_RESULT);
  const skill = afterReport.skills[SYNTHETIC_CHART.id];
  assert.equal(skill.withLights.cleanPasses, 1, 'with-hints counts are not re-applied');
  assert.equal(skill.withoutLights.cleanPasses, 1);
  assert.equal(skill.cleanPasses, 2);
  assert.equal(skill.masteredAt, FIXED_NOW);
  assert.equal(afterReport.totals.totalMs, 24000);
  assert.equal(afterReport.totals.unguidedMs, 12000);
  assert.equal(afterReport.totals.sessionCount, 1);
  assert.equal(afterReport.sessions.length, 1);
});

test('the session history caps at 20 while the session count stays cumulative', () => {
  let progress = emptyProgress();
  for (let i = 0; i < 21; i++) {
    progress = apply(progress, {
      ...CLEAN_RESULT,
      sessionId: `scaleRun:minPent:9:s6f0:${1700000000000 + i}`,
    });
  }
  assert.equal(progress.sessions.length, MAX_SESSIONS);
  assert.equal(progress.totals.sessionCount, 21);
});

test('the with-hints pass contributes active time but never unguided time', () => {
  const progress = apply(emptyProgress(), CLEAN_RESULT);
  const session = progress.sessions[0];
  assert.equal(passActiveMs(session.passes[0].completedSteps, session.passes[0].bpm), 12000);
  assert.equal(progress.totals.totalMs, 24000);
  assert.equal(progress.totals.unguidedMs, 12000);
  assert.equal(progress.totals.totalMs - progress.totals.unguidedMs, 12000, 'guided time is reported, never dropped');
});

test('progress recomputes unguided time from the pass report, not the stored field', () => {
  const inflated = {
    ...SHAKY_RESULT,
    passes: SHAKY_RESULT.passes.map(pass => (
      pass.hintLevel === 3 ? { ...pass, unguidedMs: 999999 } : { ...pass }
    )),
  };
  const progress = apply(emptyProgress(), inflated);
  assert.equal(progress.totals.unguidedMs, 0, 'a shaky pass cannot smuggle unguided time');
  assert.equal(progress.sessions[0].unguidedMs, 0);
});

test('a stopped-early drill with a completed pass is a practice day but not mastery', () => {
  const progress = apply(emptyProgress(), STOPPED_EARLY_RESULT);
  const session = progress.sessions[0];
  assert.ok(session.completedPasses > 0, 'the practice day can count the session');
  assert.equal(session.stoppedEarly, true);
  assert.equal(progress.skills[SYNTHETIC_CHART.id].masteredAt, null);
});

test('validateProgress rejects arrays, null and junk and returns a complete plane', () => {
  for (const junk of [null, undefined, [], 'nope', 42, true]) {
    assert.deepEqual(validateProgress(junk), emptyProgress(), `validateProgress(${JSON.stringify(junk)})`);
  }
  const plane = validateProgress({
    version: 99,
    extra: 'dropped',
    skills: [],
    sessions: 'nope',
    totals: { totalMs: -5, unguidedMs: 4000, sessionCount: 3, extra: 1 },
  });
  assert.deepEqual(plane, {
    version: 1,
    skills: {},
    chordPairs: {},
    sessions: [],
    totals: { totalMs: 0, unguidedMs: 4000, sessionCount: 3 },
    streak: { current: 0, longest: 0, lastDay: '' },
  });
});

test('validateProgress rebuilds each skill field by field and clamps its numbers', () => {
  const plane = validateProgress({
    skills: {
      'scaleRun:minPent:9:s6f0': {
        skillId: 'spoofed', kind: 'scaleRun',
        content: { scaleId: 'minPent', keyPc: 9, positionId: 's6f0', nested: { a: 1 } },
        withLights: { cleanPasses: 2.8, bestBpm: -1, bestLevel: 9, lastCleanAt: 100 },
        withoutLights: null,
        bestBpm: 96, bestLevel: 3, cleanPasses: 4,
        accuracy: 5, medianTimingMs: 120, micUsed: 'yes',
        lastPlayedAt: 1700000000000, masteredAt: 1700000000000, lastCleanRecallAt: 1700000000000,
        dueAt: 1700000600000, intervalIndex: 9, lapses: 1.9, extra: 'dropped',
      },
    },
  });
  const skill = plane.skills['scaleRun:minPent:9:s6f0'];
  assert.equal(skill.skillId, 'scaleRun:minPent:9:s6f0', 'the map key is the semantic id');
  assert.deepEqual(skill.content, { scaleId: 'minPent', keyPc: 9, positionId: 's6f0' }, 'nested content is dropped');
  assert.equal(skill.withLights.cleanPasses, 2);
  assert.equal(skill.withLights.bestBpm, 0);
  assert.equal(skill.withLights.bestLevel, 3);
  assert.equal(skill.withLights.lastCleanAt, 100);
  assert.deepEqual(skill.withoutLights, { cleanPasses: 0, bestBpm: 0, bestLevel: 0, lastCleanAt: null, lastFailAt: null });
  assert.equal(skill.bestLevel, 3);
  assert.equal(skill.cleanPasses, 4);
  assert.equal(skill.accuracy, null, 'out-of-range accuracy is not a score');
  assert.equal(skill.medianTimingMs, 120, 'a valid Phase 3 timing survives an import');
  assert.equal(skill.micUsed, false, 'only a real boolean turns the mic flag on');
  assert.equal(skill.intervalIndex, 4);
  assert.equal(skill.lapses, 1);
  assert.equal(skill.extra, undefined, 'unknown top-level keys are dropped');
});

test('validateProgress keeps unknown skill ids and rejects prototype keys', () => {
  // JSON.parse creates a real own "__proto__" property, unlike an object literal.
  const skills = JSON.parse('{"legacy:skill_1":{"bestLevel":2},"__proto__":{"polluted":true},"constructor":{"polluted":true},"bad id!":{"bestLevel":1}}');
  const plane = validateProgress({ skills });
  assert.deepEqual(Object.keys(plane.skills), ['legacy:skill_1']);
  assert.equal(plane.skills['legacy:skill_1'].bestLevel, 2);
  assert.equal({}.polluted, undefined, 'no prototype pollution');
});

// CR-03: 288 skill ids are reachable, and a write must never drop its own new record.
test('validateProgress retains every reachable skill and evicts the oldest over the ceiling', () => {
  const scales = ['minPent', 'majPent', 'major', 'blues'];
  const positions = ['all', 's6f0', 's6f1', 's6f2', 's6f3', 's6f4'];
  const skills = {};
  for (const scale of scales) {
    for (let keyPc = 0; keyPc < 12; keyPc++) {
      for (const position of positions) {
        skills[`scaleRun:${scale}:${keyPc}:${position}`] = { bestLevel: 2, updatedAt: 1000 };
      }
    }
  }
  assert.equal(Object.keys(skills).length, 288);
  const plane = validateProgress({ skills });
  assert.equal(Object.keys(plane.skills).length, 288, 'the whole-neck ids are reachable too');

  const applied = applyResult(plane, {
    ...STOPPED_EARLY_RESULT,
    sessionId: 'new-skill-session',
    skillId: 'custom:skill',
    chartId: 'custom:skill',
  }, { now: FIXED_NOW });
  const validated = validateProgress(applied);
  assert.ok(Object.hasOwn(validated.skills, 'custom:skill'), 'the record just written survives validation');
  assert.equal(Object.keys(validated.skills).length, 289);

  const many = {};
  for (let i = 0; i < MAX_SKILLS + 1; i++) many[`skill:${i}`] = { bestLevel: 1, updatedAt: i };
  const trimmed = validateProgress({ skills: many });
  assert.equal(Object.keys(trimmed.skills).length, MAX_SKILLS);
  assert.ok(Object.hasOwn(trimmed.skills, `skill:${MAX_SKILLS}`), 'the newest record is retained');
  assert.ok(!Object.hasOwn(trimmed.skills, 'skill:0'), 'the oldest record is evicted');
});

test('fitProgress drops sessions before skills and keeps the newest record', () => {
  const plane = emptyProgress();
  for (let i = 0; i < 12; i++) {
    plane.skills[`skill:${i}`] = { skillId: `skill:${i}`, updatedAt: i, content: {} };
  }
  assert.equal(fitProgress(plane, 1_000_000), plane, 'a plane that fits is returned untouched');

  // History goes before mastery: a limit that fits the skills without their sessions
  // must empty the session list and keep every skill.
  const withSessions = {
    ...plane,
    sessions: Array.from({ length: 20 }, (_, i) => ({ sessionId: `s${i}`, durationMs: 1000 })),
  };
  const limit = JSON.stringify({ ...withSessions, sessions: [] }).length + 5;
  const fitted = fitProgress(withSessions, limit);
  assert.equal(fitted.sessions.length, 0);
  assert.equal(Object.keys(fitted.skills).length, 12);

  // A tight limit drops the least recently updated skill first and always keeps the newest.
  const tight = fitProgress(plane, 500);
  assert.ok(JSON.stringify(tight).length <= 500);
  assert.ok(Object.hasOwn(tight.skills, 'skill:11'), 'the newest record survives its own write');
  assert.ok(!Object.hasOwn(tight.skills, 'skill:0'), 'the oldest record leaves first');
});

test('a pass carries the practice time it earned and the session sums it (WR-02)', () => {
  // A quiz pass has no tempo, so its time is the wall time the engine stamped on the pass;
  // a chord pass is bars × beatsPerBar, not bars × one beat. The session never re-derives
  // either number from completedSteps × 60000 / bpm.
  const quizPass = {
    index: 1, hintLevel: 0, bpm: 0, completedSteps: 12, plannedSteps: 12,
    selfReport: 'clean', unguidedMs: 0, aborted: false, reasonKey: null, activeMs: 61000,
  };
  const recallPass = {
    index: 2, hintLevel: 3, bpm: 0, completedSteps: 12, plannedSteps: 12,
    selfReport: 'clean', unguidedMs: 0, aborted: false, reasonKey: null, activeMs: 30000,
  };
  const result = {
    ...CLEAN_RESULT,
    sessionId: 'findNote:minPent:9:s6f0:1700000000000',
    skillId: 'findNote:minPent:9:s6f0',
    chartId: 'findNote:minPent:9:s6f0',
    kind: 'findNote',
    bpm: 0,
    passes: [quizPass, recallPass],
    recall: { attempted: true, completed: true, selfReport: 'clean', bpm: 0 },
  };
  const progress = apply(emptyProgress(), result);
  assert.equal(progress.sessions[0].durationMs, 91000, 'both passes carry their own time');
  assert.equal(progress.totals.totalMs, 91000);
  assert.equal(progress.sessions[0].unguidedMs, 30000, 'the clean recall keeps its wall time');
  assert.equal(progress.totals.unguidedMs, 30000);
  assert.equal(progress.sessions[0].passes[1].activeMs, 30000, 'the pass record keeps its measure');

  // An imported pass keeps the field; a record from before the field existed still reads
  // through the beat-derived fallback rather than dropping to zero.
  const validated = validateSession(progress.sessions[0]);
  assert.equal(validated.passes[0].activeMs, 61000);
  assert.equal(validated.passes[1].activeMs, 30000);
  assert.equal(validateSession({ passes: [{ completedSteps: 8, bpm: 80 }] }).passes[0].activeMs, null);
  const legacy = apply(emptyProgress(), CLEAN_RESULT);
  assert.equal(legacy.sessions[0].durationMs, 24000, 'the old two-pass fixture still counts 24 s');
});

test('validateProgress caps the session history at 20 and rebuilds each pass', () => {
  const sessions = Array.from({ length: 25 }, (_, i) => ({
    sessionId: `s${i}`,
    durationMs: 1000 + i,
    passes: [{ index: 1, hintLevel: 9, bpm: 80, completedSteps: 16.7, plannedSteps: 16, selfReport: 'clean', aborted: false, reasonKey: null, extra: 'dropped' }],
    extra: 'dropped',
  }));
  const plane = validateProgress({ sessions });
  assert.equal(plane.sessions.length, MAX_SESSIONS);
  assert.equal(plane.sessions[0].sessionId, 's5', 'the newest last: the oldest five are dropped');
  assert.equal(plane.sessions[MAX_SESSIONS - 1].sessionId, 's24');
  const pass = plane.sessions[0].passes[0];
  assert.deepEqual(Object.keys(pass).sort(), [
    'aborted', 'activeMs', 'assessment', 'bpm', 'brightened', 'completedSteps', 'hintLevel', 'index', 'plannedSteps', 'reasonKey', 'selfReport', 'unguidedMs',
  ]);
  assert.equal(pass.completedSteps, 16, 'counts are truncated to whole steps');
  assert.equal(pass.hintLevel, 3, 'the level clamps to the four-level ladder');
  assert.equal(plane.sessions[0].extra, undefined);
});

test('validateSession rejects null and arrays and keeps a complete canonical shape', () => {
  assert.equal(validateSession(null), null);
  assert.equal(validateSession([]), null);
  assert.equal(validateSession('nope'), null);
  const session = validateSession({ sessionId: 's1', completedPasses: 1, passes: [null, []] });
  assert.equal(session.sessionId, 's1');
  assert.deepEqual(session.passes, [], 'non-object passes are dropped');
  assert.equal(session.completed, false);
  assert.equal(session.stoppedEarly, false);
});

// CR-05: a long drill must retain the newest passes (including the recall) and the
// explicit recall report, so a repeated report cannot double-count mastery.
test('validateSession keeps the newest passes and the recall report', () => {
  const pass = (index, hintLevel) => ({
    index, hintLevel, bpm: 80, completedSteps: 16, plannedSteps: 16,
    selfReport: 'clean', unguidedMs: 0, aborted: false, reasonKey: null,
  });
  const passes = Array.from({ length: 64 }, (_, i) => pass(i + 1, i % 3));
  passes.push(pass(65, 3));
  passes.push(null);
  const session = validateSession({ sessionId: 'long', passes, recallReport: 'clean' });
  assert.equal(session.passes.length, 64);
  assert.equal(session.passes[63].hintLevel, 3, 'the recall pass is retained');
  assert.equal(session.passes[63].index, 65);
  assert.equal(session.recallReport, 'clean');
  assert.equal(validateSession({ sessionId: 'old', passes }).recallReport, null);
});

test('a repeated report on a truncated long session applies the recall delta once', () => {
  const pass = (index, hintLevel, selfReport) => ({
    index, hintLevel, bpm: 80, completedSteps: 16, plannedSteps: 16,
    selfReport, unguidedMs: 0, aborted: false, reasonKey: null,
  });
  const withHints = Array.from({ length: 64 }, (_, i) => pass(i + 1, i % 3, 'clean'));
  const recallClean = pass(65, 3, 'clean');
  const unreported = {
    ...CLEAN_RESULT,
    sessionId: 'long-session',
    passes: [...withHints, { ...recallClean, selfReport: null }],
    recall: { attempted: true, completed: true, selfReport: null, bpm: 80 },
  };
  const reported = {
    ...unreported,
    passes: [...withHints, recallClean],
    recall: { attempted: true, completed: true, selfReport: 'clean', bpm: 80 },
  };

  let progress = validateProgress(apply(emptyProgress(), unreported, { now: FIXED_NOW }));
  const beforeReport = progress.skills[SYNTHETIC_CHART.id];
  assert.equal(beforeReport.withoutLights.cleanPasses, 0);

  progress = validateProgress(apply(progress, reported, { now: FIXED_NOW + 1000 }));
  const first = progress.skills[SYNTHETIC_CHART.id];
  assert.equal(first.cleanPasses, beforeReport.cleanPasses + 1);
  assert.equal(first.withoutLights.cleanPasses, 1);
  assert.equal(first.intervalIndex, 1);
  assert.equal(progress.sessions[0].passes.length, 64);
  assert.equal(progress.sessions[0].passes[63].hintLevel, 3);
  assert.equal(progress.sessions[0].recallReport, 'clean');

  progress = validateProgress(apply(progress, reported, { now: FIXED_NOW + 2000 }));
  const second = progress.skills[SYNTHETIC_CHART.id];
  assert.equal(second.cleanPasses, first.cleanPasses, 'a repeated report never adds a pass');
  assert.equal(second.withoutLights.cleanPasses, 1);
  assert.equal(second.intervalIndex, first.intervalIndex, 'the review bucket is not advanced twice');
  assert.equal(second.dueAt, first.dueAt, 'the due date is not rewritten');
});

// ---------- Local calendar, review schedule and streak (02-03 Task 2) ----------
test('dayKey, addDays and daysBetween use local calendar components', () => {
  const base = new Date(2026, 2, 7, 23, 30, 0).getTime();
  assert.equal(dayKey(base), '2026-03-07');
  const next = addDays(base, 1);
  assert.equal(dayKey(next), '2026-03-08', 'late evening plus one day lands on the next date');
  assert.equal(daysBetween(base, next), 1);
  assert.equal(daysBetween(next, base), -1);
  const week = addDays(base, 7);
  assert.equal(daysBetween(base, week), 7);
  assert.equal(daysBetween(base, base), 0);
  assert.equal(daysBetween(NaN, base), 0);
});

test('successive clean recalls walk the 1/3/7/14/30-day ladder', () => {
  let progress = emptyProgress();
  let now = FIXED_DAY;
  let recalledAt = now;
  for (const expected of [1, 3, 7, 14, 30, 30]) {
    recalledAt = now;
    progress = applyResult(progress, {
      ...CLEAN_RESULT,
      sessionId: `scaleRun:minPent:9:s6f0:${now}`,
      startedWallAt: now - 41000,
      endedWallAt: now,
    }, { now });
    const skill = progress.skills[SYNTHETIC_CHART.id];
    assert.equal(daysBetween(now, skill.dueAt), expected, `bucket after clean recall ${expected}`);
    now = addDays(now, expected);
  }
  const skill = progress.skills[SYNTHETIC_CHART.id];
  assert.equal(skill.intervalIndex, REVIEW_INTERVALS.length - 1, 'the ladder stops at the last bucket');
  assert.equal(skill.dueAt, addDays(recalledAt, 30));
});

test('a shaky recall returns the skill to the one-day bucket and counts one lapse', () => {
  let progress = applyResult(emptyProgress(), CLEAN_RESULT, { now: FIXED_DAY });
  assert.equal(progress.skills[SYNTHETIC_CHART.id].intervalIndex, 1);
  const later = addDays(FIXED_DAY, 2);
  progress = applyResult(progress, {
    ...SHAKY_RESULT,
    sessionId: 'scaleRun:minPent:9:s6f0:shaky',
    endedWallAt: later,
  }, { now: later });
  const skill = progress.skills[SYNTHETIC_CHART.id];
  assert.equal(skill.intervalIndex, 0);
  assert.equal(skill.dueAt, addDays(later, 1));
  assert.equal(skill.lapses, 1);
  assert.equal(skill.masteredAt, FIXED_DAY, 'a failed recall never clears historical mastery');
});

test('a re-applied unchanged recall state does not move the bucket or count twice', () => {
  const first = applyResult(emptyProgress(), CLEAN_RESULT, { now: FIXED_DAY });
  const again = applyResult(first, CLEAN_RESULT, { now: addDays(FIXED_DAY, 5) });
  assert.equal(again.skills[SYNTHETIC_CHART.id].intervalIndex, 1);
  assert.equal(again.skills[SYNTHETIC_CHART.id].dueAt, first.skills[SYNTHETIC_CHART.id].dueAt);
  const shaky = applyResult(first, SHAKY_RESULT, { now: FIXED_DAY });
  const shakyAgain = applyResult(shaky, SHAKY_RESULT, { now: FIXED_DAY });
  assert.equal(shakyAgain.skills[SYNTHETIC_CHART.id].lapses, 1);
});

test('lapse uses fourteen overdue days rather than time since recall', () => {
  const skill = {
    masteredAt: FIXED_DAY,
    lastCleanRecallAt: FIXED_DAY,
    dueAt: addDays(FIXED_DAY, 30),
  };
  assert.equal(skillState(skill, addDays(FIXED_DAY, 14)), 'mastered');
  assert.equal(skillState(skill, addDays(FIXED_DAY, 15)), 'mastered');
  assert.equal(skillState(skill, addDays(FIXED_DAY, 44)), 'due');
  assert.equal(skillState(skill, addDays(FIXED_DAY, 45)), 'lapsed');
  assert.equal(
    skillState({ masteredAt: FIXED_DAY, lastCleanRecallAt: null, dueAt: null }, addDays(FIXED_DAY, 400)),
    'mastered',
    'no clean-recall timestamp cannot decay',
  );
});

test('chip precedence is lapsed > due > mastered > learning', () => {
  const learning = createSkill(SYNTHETIC_CHART, FIXED_DAY);
  assert.equal(skillState(learning, FIXED_DAY), 'learning');
  const mastered = {
    ...learning,
    masteredAt: FIXED_DAY,
    lastCleanRecallAt: FIXED_DAY,
    dueAt: addDays(FIXED_DAY, 3),
  };
  assert.equal(skillState(mastered, FIXED_DAY), 'mastered');
  const due = { ...mastered, dueAt: addDays(FIXED_DAY, -1) };
  assert.equal(skillState(due, FIXED_DAY), 'due', 'a mastered-but-due skill reads Due');
  const lapsed = { ...mastered, lastCleanRecallAt: addDays(FIXED_DAY, -30), dueAt: addDays(FIXED_DAY, -15) };
  assert.equal(skillState(lapsed, FIXED_DAY), 'lapsed', 'decay outranks due');
});

// WR-04: a shaky recall on a never-mastered skill writes a dueAt, but "due for
// review" only exists after mastery. The chip, the tile and the due list agree.
test('a never-mastered skill is never due for review', () => {
  const progress = apply(emptyProgress(), SHAKY_RESULT);
  const skill = progress.skills[SYNTHETIC_CHART.id];
  assert.equal(skill.masteredAt, null);
  assert.ok(Number.isFinite(skill.dueAt), 'the failed recall still schedules a retry');
  assert.equal(skillState(skill, addDays(FIXED_NOW, 2)), 'learning');
  assert.equal(skillRows(progress, { now: addDays(FIXED_NOW, 2) })[0].state, 'learning');
  assert.deepEqual(dueRows(progress, { now: addDays(FIXED_NOW, 2) }), [], 'the Due tile and list stay empty');
});

test('the streak holds on the same day, increments the next day and resets after a gap', () => {
  const day1 = new Date(2026, 10, 9, 9, 0, 0).getTime();
  const day2 = addDays(day1, 1);
  const day4 = addDays(day1, 3);
  const session = (id, stamp) => ({
    ...CLEAN_RESULT,
    sessionId: id,
    startedWallAt: stamp,
    endedWallAt: stamp + 41000,
  });
  let progress = applyResult(emptyProgress(), session('streak-1', day1), { now: day1 });
  assert.deepEqual(progress.streak, { current: 1, longest: 1, lastDay: dayKey(day1) });
  progress = applyResult(progress, session('streak-1b', day1 + 3600000), { now: day1 });
  assert.equal(progress.streak.current, 1, 'a second session the same day holds');
  progress = applyResult(progress, session('streak-2', day2), { now: day2 });
  assert.equal(progress.streak.current, 2);
  assert.equal(progress.streak.longest, 2);
  progress = applyResult(progress, session('streak-4', day4), { now: day4 });
  assert.equal(progress.streak.current, 1, 'a gap resets the streak to one');
  assert.equal(progress.streak.longest, 2, 'longest is the maximum ever seen');
  assert.equal(progress.streak.lastDay, dayKey(day4));

  const before = applyResult(emptyProgress(), session('streak-early', day1), { now: day1 });
  const outOfOrder = applyResult(before, session('streak-older', addDays(day1, -3)), { now: day1 });
  assert.equal(outOfOrder.streak.current, 1, 'an older session never rewinds the streak');
  assert.equal(outOfOrder.streak.lastDay, dayKey(day1));
});

test('a stopped-early drill counts for the streak only when a pass completed', () => {
  const day = new Date(2026, 10, 9, 15, 0, 0).getTime();
  const withOnePass = applyResult(emptyProgress(), { ...STOPPED_EARLY_RESULT, endedWallAt: day }, { now: day });
  assert.equal(withOnePass.streak.current, 1);

  const partialPass = {
    index: 1, hintLevel: 0, bpm: 80, completedSteps: 8, plannedSteps: 16,
    selfReport: null, unguidedMs: 0, aborted: false, reasonKey: null,
  };
  const withoutCompleted = applyResult(emptyProgress(), {
    ...STOPPED_EARLY_RESULT,
    sessionId: 'stop-zero',
    passes: [partialPass],
    endedWallAt: day,
  }, { now: day });
  assert.equal(withoutCompleted.streak.current, 0, 'no completed pass, no practice day');
  assert.equal(withoutCompleted.totals.totalMs, 6000, 'the partial minutes still count');
});

test('upserting the same session never advances the streak again', () => {
  const day1 = new Date(2026, 10, 9, 9, 0, 0).getTime();
  const day2 = addDays(day1, 1);
  const first = applyResult(emptyProgress(), { ...CLEAN_RESULT, endedWallAt: day1 }, { now: day1 });
  const second = applyResult(first, {
    ...CLEAN_RESULT,
    sessionId: 'scaleRun:minPent:9:s6f0:second',
    endedWallAt: day2,
  }, { now: day2 });
  assert.equal(second.streak.current, 2);
  const again = applyResult(second, {
    ...CLEAN_RESULT,
    sessionId: 'scaleRun:minPent:9:s6f0:second',
    endedWallAt: day2,
  }, { now: day2 });
  assert.equal(again.streak.current, 2, 'the upsert holds the day');
  assert.equal(again.sessions.length, 2);
});

test('skillRows sorts by last played and dueRows returns due or lapsed mastered skills', () => {
  const progress = validateProgress(V2_PROGRESS);
  const rows = skillRows(progress, { now: FIXED_DAY });
  assert.deepEqual(rows.map(row => row.skillId), [
    'scaleRun:minPent:9:s6f0',
    'scaleRun:blues:2:all',
    'scaleRun:major:0:s6f3',
  ]);
  assert.equal(rows[0].state, 'due');
  assert.equal(rows[1].state, 'learning');
  assert.equal(rows[2].state, 'lapsed');
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    'accuracy', 'bestBpm', 'bestLevel', 'cleanPasses', 'content', 'dueAt', 'kind',
    'lastCleanRecallAt', 'lastPlayedAt', 'masteredAt', 'medianTimingMs', 'micUsed', 'retainedAt', 'skillId', 'state',
  ]);
  assert.equal(rows[0].kind, 'scaleRun', 'the row carries its family for the label');
  assert.equal(rows[0].micUsed, false, 'a Phase 2 row carries no microphone evidence');
  assert.equal(rows[0].accuracy, null);
  assert.equal(rows[0].medianTimingMs, null);
  assert.equal(skillRows(progress, { now: FIXED_DAY, limit: 2 }).length, 2);

  const due = dueRows(progress, { now: FIXED_DAY });
  assert.deepEqual(due.map(row => row.skillId), ['scaleRun:major:0:s6f3', 'scaleRun:minPent:9:s6f0']);
  assert.equal(due[0].state, 'lapsed');
  assert.equal(due[1].state, 'due');
  assert.equal(dueRows(progress, { now: FIXED_DAY, limit: 1 }).length, 1);
});

test('the validated v2 fixture keeps every skill plane, the streak and 20 sessions', () => {
  const progress = validateProgress(V2_RECORD.progress);
  assert.deepEqual(Object.keys(progress.skills).sort(), [
    'scaleRun:blues:2:all', 'scaleRun:major:0:s6f3', 'scaleRun:minPent:9:s6f0',
  ]);
  assert.equal(progress.skills['scaleRun:minPent:9:s6f0'].withLights.cleanPasses, 4);
  assert.equal(progress.skills['scaleRun:minPent:9:s6f0'].withoutLights.bestLevel, 3);
  assert.equal(progress.streak.current, 4);
  assert.equal(progress.sessions.length, 20);
  assert.equal(progress.totals.sessionCount, 20);
  assert.equal(startLevelFor(progress, 'scaleRun:minPent:9:s6f0'), 2);
});

// ---------- Export and import envelope (02-03 Task 3) ----------
test('the export envelope keeps settings, progress, sessions and streak at the top level', () => {
  const doc = exportDoc(V2_RECORD, { now: FIXED_DAY });
  assert.deepEqual(Object.keys(doc).sort(), [
    'app', 'exportedAt', 'progress', 'schemaVersion', 'sessions', 'settings', 'streak',
  ]);
  assert.equal(doc.app, 't2coach');
  assert.equal(doc.schemaVersion, 3);
  assert.equal(doc.exportedAt, FIXED_DAY);
  assert.deepEqual(Object.keys(doc.progress).sort(), ['chordPairs', 'skills', 'totals', 'version']);
  assert.ok(!('sessions' in doc.progress), 'sessions are never duplicated inside progress');
  assert.ok(!('streak' in doc.progress), 'streak is top level only');
  assert.equal(doc.sessions.length, 20);
  assert.equal(doc.streak.current, 4);
  assert.deepEqual(doc.settings, V2_RECORD.settings);
});

test('an exported document imports back with skills, sessions, streak and the start level intact', () => {
  const doc = exportDoc(V2_RECORD, { now: FIXED_DAY });
  const result = validateBackup(doc, { validateSettings });
  assert.equal(result.ok, true);
  // A v2 record predates the chord pair (03-02), the microphone (03-03), the backing mix
  // (04-01), the song plane (04-03), the Session panel's two preferences (05-01) and the main view (06-01): the validator
  // fills the defaults in, and every other stored setting survives untouched.
  assert.deepEqual(result.doc.settings, {
    ...V2_RECORD.settings, chordPairId: 'C-G', micOn: false, calibrationMs: 0,
    intensity: 'full', stemClick: true, stemDrums: true, stemBass: true, stemPad: true,
    loopBars: 0, songSectionId: '', sectionLoop: false, sessionView: 'plan', practiseFilter: 'due',
    view: 'today',
  });
  assert.equal(Object.keys(result.doc.progress.skills).length, 3);
  assert.equal(result.doc.progress.sessions.length, 20);
  assert.deepEqual(result.doc.progress.streak, { current: 4, longest: 6, lastDay: '2026-11-09' });
  assert.equal(startLevelFor(result.doc.progress, 'scaleRun:minPent:9:s6f0'), 2);
  assert.equal(result.doc.progress.skills['scaleRun:minPent:9:s6f0'].withoutLights.bestLevel, 3);
});

// LOOK-02 / KEEP-03: a backup written by the v1 shell carries `theme`. It still imports at backup
// version 3; the injected validator drops the theme and fills the main view.
test('a v1 backup carrying theme dark imports without the theme and with view today', () => {
  const doc = exportDoc({ ...V2_RECORD, settings: { ...V2_RECORD.settings, theme: 'dark' } }, { now: FIXED_DAY });
  assert.equal(doc.schemaVersion, BACKUP_SCHEMA_VERSION);
  assert.equal(doc.settings.theme, 'dark', 'the fixture really carries a theme');
  const result = validateBackup(doc, { validateSettings });
  assert.equal(result.ok, true);
  assert.ok(!Object.hasOwn(result.doc.settings, 'theme'), 'the theme is dropped');
  assert.equal(result.doc.settings.view, 'today');
  assert.equal(result.doc.settings.keyPc, V2_RECORD.settings.keyPc);
  assert.equal(result.doc.progress.sessions.length, 20);
});

// 05-01 Task 3 (binding correction 5): the two Session-panel preferences are additive defaulted
// fields on the one settings record, so they survive the export envelope unchanged and a document
// that carries them imports back with them — no schema bump, and the envelope is still version 3.
test('the export envelope carries the two session preferences at backup version 3', () => {
  assert.equal(BACKUP_SCHEMA_VERSION, 3, 'the envelope version is unchanged');
  const record = {
    ...V2_RECORD,
    settings: { ...V2_RECORD.settings, sessionView: 'practise', practiseFilter: 'pairs' },
  };
  const doc = exportDoc(record, { now: FIXED_DAY });
  assert.equal(doc.schemaVersion, BACKUP_SCHEMA_VERSION);
  assert.equal(doc.settings.sessionView, 'practise');
  assert.equal(doc.settings.practiseFilter, 'pairs');
  const result = validateBackup(doc, { validateSettings });
  assert.equal(result.ok, true);
  assert.equal(result.doc.settings.sessionView, 'practise', 'the stored view survives the round trip');
  assert.equal(result.doc.settings.practiseFilter, 'pairs', 'the stored filter survives the round trip');
  // Every other stored setting and the whole progress plane are untouched by the two new fields.
  assert.equal(result.doc.progress.sessions.length, doc.sessions.length);
  assert.equal(result.doc.settings.scaleId, record.settings.scaleId);
  assert.equal(result.doc.settings.bpm, record.settings.bpm);
  // A hand-edited document can only ever import one of the two approved values per field.
  const crafted = exportDoc({ ...record, settings: { ...record.settings, sessionView: 'x', practiseFilter: 2 } }, { now: FIXED_DAY });
  const repaired = validateBackup(crafted, { validateSettings });
  assert.equal(repaired.ok, true);
  assert.equal(repaired.doc.settings.sessionView, 'plan');
  assert.equal(repaired.doc.settings.practiseFilter, 'due');
});

test('validateBackup rejects foreign, newer, corrupt and oversized documents', () => {
  const valid = exportDoc(V2_RECORD, { now: FIXED_DAY });
  assert.deepEqual(validateBackup(null, { validateSettings }), { ok: false, reason: 'foreign' });
  assert.deepEqual(validateBackup([], { validateSettings }), { ok: false, reason: 'foreign' });
  assert.equal(validateBackup({ ...valid, app: 'other' }, { validateSettings }).reason, 'foreign');
  // A6: the envelope is now 3, so a Phase 3 file is accepted and only a 4 is "newer".
  assert.equal(validateBackup({ ...valid, schemaVersion: 3 }, { validateSettings }).ok, true);
  assert.equal(validateBackup({ ...valid, schemaVersion: 4 }, { validateSettings }).reason, 'newer');
  assert.equal(validateBackup({ ...valid, schemaVersion: '2' }, { validateSettings }).reason, 'corrupt');
  assert.equal(validateBackup({ ...valid, schemaVersion: 0 }, { validateSettings }).reason, 'corrupt');
  assert.equal(validateBackup({ ...valid, progress: null }, { validateSettings }).reason, 'corrupt');
  assert.equal(validateBackup({ ...valid, sessions: 'nope' }, { validateSettings }).reason, 'corrupt');
  assert.equal(validateBackup({ ...valid, streak: null }, { validateSettings }).reason, 'corrupt');
  assert.equal(validateBackup(valid, {}).reason, 'corrupt', 'a missing settings validator is refused');

  const tooMany = { ...valid, sessions: Array.from({ length: 21 }, (_, i) => ({ sessionId: `s${i}` })) };
  assert.equal(validateBackup(tooMany, { validateSettings }).reason, 'oversized');

  const huge = { ...valid, settings: { ...valid.settings, big: 'x'.repeat(MAX_BACKUP_LENGTH) } };
  assert.equal(validateBackup(huge, { validateSettings }).reason, 'oversized');
});

test('validateBackup rejects prototype keys anywhere in the envelope', () => {
  const valid = exportDoc(V2_RECORD, { now: FIXED_DAY });
  const withKey = (doc, key, value) => JSON.parse(
    JSON.stringify(doc).replace(/^\{/, `{${JSON.stringify(key)}:${JSON.stringify(value)},`),
  );
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    assert.equal(validateBackup(withKey(valid, key, { polluted: true }), { validateSettings }).reason, 'corrupt', key);
  }
  const nested = JSON.parse(JSON.stringify(valid));
  nested.progress.skills = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.equal(validateBackup(nested, { validateSettings }).reason, 'corrupt');
  assert.equal({}.polluted, undefined);
});

test('validateBackup tolerates a v1 envelope and validates its planes independently', () => {
  const valid = exportDoc(V2_RECORD, { now: FIXED_DAY });
  const result = validateBackup({ ...valid, schemaVersion: 1 }, { validateSettings });
  assert.equal(result.ok, true);
  assert.equal(Object.keys(result.doc.progress.skills).length, 3);
});

// CR-02: imported content ids are sanitized, and a throwing validator is a corrupt
// file rather than an unhandled rejection.
test('validateBackup sanitizes crafted settings ids and catches a throwing validator', () => {
  const valid = exportDoc(V2_RECORD, { now: FIXED_DAY });
  const crafted = {
    ...valid,
    settings: {
      ...valid.settings,
      scaleId: 'constructor',
      chordId: 'constructor',
      voicingId: 'constructor',
      progressionId: 'constructor',
      songId: 'constructor',
    },
  };
  const result = validateBackup(crafted, { validateSettings });
  assert.equal(result.ok, true);
  assert.equal(result.doc.settings.scaleId, 'major');
  assert.equal(result.doc.settings.chordId, 'C');
  assert.equal(result.doc.settings.voicingId, 'open');
  assert.equal(result.doc.settings.progressionId, 'I-IV-V');
  assert.equal(result.doc.settings.songId, 'willTheCircleBeUnbroken');

  const throwing = validateBackup(valid, {
    validateSettings: () => { throw new Error('crafted content'); },
  });
  assert.deepEqual(throwing, { ok: false, reason: 'corrupt' });
});

// ---------- 03-02 Task 2: the ordered chord-pair plane (CHORD-04, D-49) ----------
test('a chord result folds one pair row keyed by the pair and counts bars, not notes', () => {
  const progress = apply(emptyProgress(), CHORD_CLEAN_RESULT);
  assert.equal(MAX_PAIRS, 32);
  assert.deepEqual(Object.keys(progress.chordPairs), ['C-G'], 'the pair id is the record key');
  const row = progress.chordPairs['C-G'];
  assert.equal(row.pairId, 'C-G');
  assert.deepEqual(row.chords, ['C', 'G'], 'the ordered chord ids are stored, never the label');
  assert.equal(row.attempts, 8, 'the planned bar count is the attempt count, not the note count');
  assert.equal(row.clean, 8);
  assert.equal(row.changesPerMin, 20, 'a clean change every bar at 80 BPM is 20 changes/min');
  assert.equal(row.bestBpm, 80);
  assert.equal(row.lastPlayedAt, CHORD_CLEAN_RESULT.endedWallAt);
  assert.equal(row.updatedAt, FIXED_NOW);
  assert.deepEqual(Object.keys(row).sort(), [
    'attempts', 'bestBpm', 'changesPerMin', 'chords', 'clean', 'lastPlayedAt', 'pairId', 'updatedAt',
  ]);
  // The chord drill is a skill plane record too, named by the same semantic id.
  assert.equal(progress.skills['chordChanges:C-G'].kind, 'chordChanges');
});

test('a second pair accumulates its own row and a re-report of one session adds nothing', () => {
  const first = apply(emptyProgress(), CHORD_CLEAN_RESULT);
  const second = apply(first, CHORD_HALF_RESULT, FIXED_NOW + 1000);
  assert.deepEqual(Object.keys(second.chordPairs).sort(), ['C-G', 'G-D']);
  assert.equal(second.chordPairs['G-D'].attempts, 8);
  assert.equal(second.chordPairs['G-D'].clean, 4);
  assert.equal(second.chordPairs['G-D'].changesPerMin, 10);
  assert.equal(second.chordPairs['C-G'].clean, 8, 'the other pair is untouched');

  // T-03-07: the pair delta rides the new-session branch only.
  const again = apply(second, CHORD_CLEAN_RESULT, FIXED_NOW + 2000);
  assert.equal(again.chordPairs['C-G'].attempts, 8, 'an upsert never doubles the attempts');
  assert.equal(again.chordPairs['C-G'].clean, 8, 'an upsert never doubles the clean count');
  assert.equal(again.chordPairs['C-G'].updatedAt, second.chordPairs['C-G'].updatedAt);
});

test('the pair keeps its maxima for changes per minute and best tempo', () => {
  const first = apply(emptyProgress(), CHORD_CLEAN_RESULT);
  const slower = apply(first, {
    ...CHORD_CLEAN_RESULT,
    sessionId: 'chordChanges:C-G:1700000005000',
    bpm: 60,
    endedWallAt: CHORD_CLEAN_RESULT.endedWallAt + 1000,
    changes: { ...CHORD_CLEAN_RESULT.changes, clean: 3, changesPerMin: 6 },
  }, FIXED_NOW + 1000);
  const row = slower.chordPairs['C-G'];
  assert.equal(row.changesPerMin, 20, 'a slower rep never lowers the stored rate');
  assert.equal(row.bestBpm, 80, 'a slower rep never lowers the stored tempo');
  assert.equal(row.clean, 11, 'the clean count accumulates across reps');
  assert.equal(row.attempts, 16);
  assert.equal(row.lastPlayedAt, CHORD_CLEAN_RESULT.endedWallAt + 1000, 'last played moves forward');
});

test('a result with no pair id or no change record leaves the plane untouched', () => {
  const scaled = apply(emptyProgress(), CLEAN_RESULT);
  assert.deepEqual(scaled.chordPairs, {}, 'a scale pass records no pair');
  const crafted = apply(emptyProgress(), {
    ...CHORD_CLEAN_RESULT,
    chordPairId: 'constructor',
  });
  assert.deepEqual(crafted.chordPairs, {}, 'a prototype key never becomes a pair');
  const noChanges = apply(emptyProgress(), { ...CHORD_CLEAN_RESULT, changes: null });
  assert.deepEqual(noChanges.chordPairs, {}, 'no change record, no pair row');
});

test('weakestPair orders by clean rate and breaks the tie on the higher changes per minute', () => {
  assert.deepEqual(weakestPair(emptyProgress()), []);
  assert.deepEqual(weakestPair(null), []);

  let progress = apply(emptyProgress(), CHORD_CLEAN_RESULT);
  progress = apply(progress, CHORD_HALF_RESULT, FIXED_NOW + 1000);
  const rows = weakestPair(progress);
  assert.deepEqual(rows.map(row => row.pairId), ['G-D', 'C-G'], 'the lower clean rate is the weaker pair');
  assert.equal(rows[0].cleanRate, 0.5);
  assert.equal(rows[1].cleanRate, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    'attempts', 'bestBpm', 'changesPerMin', 'chords', 'clean', 'cleanRate', 'lastPlayedAt', 'pairId',
  ]);
  assert.equal(weakestPair(progress, { limit: 1 }).length, 1);
  assert.deepEqual(chordPairRows(progress, { limit: 1 }).map(row => row.pairId), ['G-D'], 'the panel alias agrees');
  assert.deepEqual(chordPairRows(progress).map(row => row.pairId), rows.map(row => row.pairId));

  // Equal clean rates: the pair that changes faster is the harder one and comes first.
  const tie = validateProgress({
    chordPairs: {
      'C-G': { pairId: 'C-G', chords: ['C', 'G'], clean: 4, attempts: 8, changesPerMin: 10 },
      'G-D': { pairId: 'G-D', chords: ['G', 'D'], clean: 4, attempts: 8, changesPerMin: 16 },
      'D-A': { pairId: 'D-A', chords: ['D', 'A'], clean: 0, attempts: 0 },
    },
  });
  assert.deepEqual(weakestPair(tie).map(row => row.pairId), ['G-D', 'C-G'], 'a pair that was never played is not a row');
});

test('validateProgress rebuilds the pair plane, rejects prototype keys and trims to MAX_PAIRS', () => {
  const crafted = JSON.parse(
    '{"__proto__":{"clean":8},"constructor":{"clean":8},"prototype":{"clean":8},'
    + '"C-G":{"pairId":"spoofed","clean":8,"attempts":8,"changesPerMin":9999,"bestBpm":-4,'
    + '"chords":["C","G","bad id!"],"lastPlayedAt":1700000041000,"updatedAt":1700000100000},'
    + '"G-D":"nope"}',
  );
  const plane = validateProgress({ chordPairs: crafted });
  assert.deepEqual(Object.keys(plane.chordPairs), ['C-G'], 'only the real pair and the real record survive');
  const row = plane.chordPairs['C-G'];
  assert.equal(row.pairId, 'C-G', 'the map key is the pair id, never the stored one');
  assert.equal(row.changesPerMin, 400, 'changes/min clamps to the 0-400 band');
  assert.equal(row.bestBpm, 0, 'a negative tempo is not a best');
  assert.deepEqual(row.chords, ['C', 'G'], 'a chord id that is not safe is dropped');
  assert.equal(row.clean, 8);
  assert.equal(row.attempts, 8);
  assert.equal(row.updatedAt, 1700000100000);

  assert.deepEqual(validateProgress({ chordPairs: { '__proto__': {} } }).chordPairs, {});
  assert.deepEqual(validateProgress({ chordPairs: [] }).chordPairs, {}, 'an array is not a plane');

  const many = {};
  for (let i = 0; i < 40; i++) many[`pair-${i}`] = { pairId: `pair-${i}`, attempts: 8, clean: 4, updatedAt: i };
  const trimmed = validateProgress({ chordPairs: many });
  assert.equal(Object.keys(trimmed.chordPairs).length, MAX_PAIRS);
  assert.ok(Object.hasOwn(trimmed.chordPairs, 'pair-39'), 'the newest pair is retained');
  assert.ok(!Object.hasOwn(trimmed.chordPairs, 'pair-0'), 'the oldest pair is evicted');
});

test('the export envelope carries the pair table and a v3 file round-trips it', () => {
  const progressed = apply(apply(emptyProgress(), CHORD_CLEAN_RESULT), CHORD_HALF_RESULT, FIXED_NOW + 1000);
  const doc = exportDoc({ settings: V2_RECORD.settings, progress: progressed }, { now: FIXED_DAY });
  assert.equal(BACKUP_SCHEMA_VERSION, 3);
  assert.equal(doc.schemaVersion, 3);
  assert.deepEqual(doc.progress.chordPairs, progressed.chordPairs);

  const result = validateBackup(doc, { validateSettings });
  assert.equal(result.ok, true);
  assert.deepEqual(result.doc.progress.chordPairs, doc.progress.chordPairs, 'the pair table survives the round-trip');
  assert.deepEqual(weakestPair(result.doc.progress).map(row => row.pairId), ['G-D', 'C-G']);
});

test('a v2 backup carries no pair table and a v4 file is refused as newer', () => {
  const v2 = {
    ...exportDoc(V2_RECORD, { now: FIXED_DAY }),
    schemaVersion: 2,
    progress: V2_PROGRESS,
  };
  const accepted = validateBackup(v2, { validateSettings });
  assert.equal(accepted.ok, true, 'a Phase 2 file still imports');
  assert.deepEqual(accepted.doc.progress.chordPairs, {}, 'a pre-pair file leaves the plane empty');
  assert.equal(Object.keys(accepted.doc.progress.skills).length, 3, 'its skills plane is intact');

  const v3 = { ...v2, schemaVersion: 3 };
  assert.equal(validateBackup(v3, { validateSettings }).ok, true, 'a v3 file is accepted');
  assert.equal(validateBackup({ ...v2, schemaVersion: 4 }, { validateSettings }).reason, 'newer');
});

test('validateSession keeps brightened as a strict boolean (FADE-09)', () => {
  const pass = value => validateSession({ passes: [{ hintLevel: 2, brightened: value }] }).passes[0].brightened;
  assert.equal(pass(true), true);
  assert.equal(validateSession({ passes: [{ hintLevel: 2 }] }).passes[0].brightened, false, 'absent reads as false');
  assert.equal(pass('true'), false);
});

// ---------- 08-01: guided passes never credit (FADE-09) ----------
const BRIGHTENED_RECALL = Object.freeze({ ...CLEAN_RESULT.passes[1], brightened: true });
const guidedResult = (passes, report = null) => ({
  ...CLEAN_RESULT,
  sessionId: 'scaleRun:minPent:9:s6f0:guided',
  passes,
  recall: { attempted: true, completed: false, selfReport: report, bpm: 80 },
});

test('a brightened clean recall pass adds no minutes, counts, best level, mastery or schedule', () => {
  const progress = apply(emptyProgress(), guidedResult([BRIGHTENED_RECALL]));
  const skill = progress.skills[CLEAN_RESULT.skillId];
  const session = progress.sessions[0];
  assert.equal(progress.totals.unguidedMs, 0);
  assert.equal(session.unguidedMs, 0);
  assert.equal(session.passes[0].brightened, true);
  assert.equal(skill.cleanPasses, 0);
  assert.equal(skill.withoutLights.cleanPasses, 0);
  assert.equal(skill.withLights.cleanPasses, 0);
  assert.equal(skill.bestLevel, 0);
  assert.equal(skill.masteredAt, null);
  assert.equal(skill.dueAt, null);
  assert.equal(skill.lapses, 0, 'a guided pass is never a lapse either');
});

test('a brightened clean pass with lights counts nothing; the same pass unbrightened does', () => {
  const lit = { ...CLEAN_RESULT.passes[0], hintLevel: 1 };
  const guided = apply(emptyProgress(), guidedResult([{ ...lit, brightened: true }])).skills[CLEAN_RESULT.skillId];
  assert.equal(guided.cleanPasses, 0);
  assert.equal(guided.withLights.cleanPasses, 0);
  assert.equal(guided.bestLevel, 0);
  const control = apply(emptyProgress(), guidedResult([{ ...lit, brightened: false }])).skills[CLEAN_RESULT.skillId];
  assert.equal(control.cleanPasses, 1);
  assert.equal(control.withLights.cleanPasses, 1);
  assert.equal(control.bestLevel, 1);
});

test('a crafted brightened recall survives import but a later clean re-report mints nothing', () => {
  const first = apply(emptyProgress(), guidedResult([BRIGHTENED_RECALL], 'clean'));
  assert.equal(first.sessions[0].recallReport, null, 'a brightened recall never stores a clean report');
  const doc = JSON.parse(JSON.stringify(exportDoc({ settings: {}, progress: first }, { now: FIXED_NOW })));
  doc.sessions[0].passes = [{ index: 2, hintLevel: 3, bpm: 80, completedSteps: 16, plannedSteps: 16, selfReport: 'clean', brightened: true }];
  const restored = validateBackup(doc, { validateSettings });
  assert.equal(restored.ok, true);
  assert.equal(restored.doc.progress.sessions[0].passes[0].brightened, true);
  const again = apply(restored.doc.progress, guidedResult([BRIGHTENED_RECALL], 'clean'));
  const skill = again.skills[CLEAN_RESULT.skillId];
  assert.equal(skill.masteredAt, null);
  assert.equal(skill.dueAt, null);
  assert.equal(skill.withoutLights.cleanPasses, 0);
  assert.equal(again.totals.unguidedMs, 0);
});

test('validateSession turns every non-true brightened value into false', () => {
  for (const value of [1, 'true', {}, null]) {
    assert.equal(validateSession({ passes: [{ hintLevel: 3, brightened: value }] }).passes[0].brightened, false, String(value));
  }
  assert.equal(validateSession({ passes: [{ hintLevel: 3, brightened: true }] }).passes[0].brightened, true);
});

test('WR-05: validateSession re-derives unguidedMs, so a crafted brightened pass keeps no guided minutes', () => {
  const recall = { index: 2, hintLevel: 3, bpm: 80, completedSteps: 16, plannedSteps: 16, selfReport: 'clean', activeMs: 12000 };
  const crafted = validateSession({ unguidedMs: 600000, passes: [{ ...recall, brightened: true, unguidedMs: 600000 }] });
  assert.equal(crafted.unguidedMs, 0, 'the stored session minutes are not trusted');
  assert.equal(crafted.passes[0].unguidedMs, 0, 'a brightened pass carries no unguided time');
  const honest = validateSession({ unguidedMs: 600000, passes: [{ ...recall, unguidedMs: 12000 }] });
  assert.equal(honest.unguidedMs, 12000, 'an unbrightened clean recall keeps exactly its own time');
  assert.equal(validateSession({ unguidedMs: 600000, passes: [{ ...recall, hintLevel: 2 }] }).unguidedMs, 0, 'a lit pass earns none');

  // A real session round-trips unchanged through export and import.
  const progress = apply(emptyProgress(), withRecallReport(CLEAN_RESULT, 'clean'));
  assert.ok(progress.sessions[0].unguidedMs > 0);
  const doc = JSON.parse(JSON.stringify(exportDoc({ settings: {}, progress }, { now: FIXED_NOW })));
  const restored = validateBackup(doc, { validateSettings });
  assert.equal(restored.ok, true);
  assert.equal(restored.doc.progress.sessions[0].unguidedMs, progress.sessions[0].unguidedMs);
  // The same file with every pass marked brightened keeps no session minutes.
  doc.sessions[0].passes = doc.sessions[0].passes.map(pass => ({ ...pass, brightened: true }));
  assert.equal(validateBackup(doc, { validateSettings }).doc.progress.sessions[0].unguidedMs, 0);
});

// ---------- 09-03: family bars (PROG-09) ----------
test('lightLevelOf: not started until a clean pass, then bestLevel clamped to 0..3', () => {
  assert.equal(lightLevelOf(null), -1);
  assert.equal(lightLevelOf(undefined), -1);
  assert.equal(lightLevelOf({}), -1, 'missing cleanPasses is not started');
  assert.equal(lightLevelOf({ bestLevel: 0, cleanPasses: 0 }), -1, 'a fresh record is not started');
  assert.equal(lightLevelOf({ bestLevel: 2, cleanPasses: 0 }), -1);
  assert.equal(lightLevelOf({ bestLevel: 0, cleanPasses: 1 }), 0);
  assert.equal(lightLevelOf({ bestLevel: 1, cleanPasses: 3 }), 1);
  assert.equal(lightLevelOf({ bestLevel: 2.7, cleanPasses: 3 }), 2, 'truncated');
  assert.equal(lightLevelOf({ bestLevel: 3, cleanPasses: 3 }), 3);
  assert.equal(lightLevelOf({ bestLevel: 99, cleanPasses: 1 }), 3);
  assert.equal(lightLevelOf({ bestLevel: -4, cleanPasses: 1 }), 0);
  assert.equal(lightLevelOf({ bestLevel: 'x', cleanPasses: 1 }), 0);
});

test('skillFamily maps the five kinds and infers legacy rows from content', () => {
  assert.deepEqual(LIGHT_FAMILIES, ['scales', 'chords', 'progressions', 'songs']);
  assert.deepEqual(FAMILY_OF_KIND, {
    scaleRun: 'scales', findNote: 'scales', chordChanges: 'chords', progression: 'progressions', song: 'songs',
  });
  assert.equal(skillFamily({ kind: 'scaleRun' }), 'scales');
  assert.equal(skillFamily({ kind: 'findNote' }), 'scales');
  assert.equal(skillFamily({ kind: 'chordChanges' }), 'chords');
  assert.equal(skillFamily({ kind: 'progression' }), 'progressions');
  assert.equal(skillFamily({ kind: 'song' }), 'songs');
  assert.equal(skillFamily({ kind: null, content: { pairId: 'C-G' } }), 'chords');
  assert.equal(skillFamily({ kind: null, content: { songId: 'amazing-grace' } }), 'songs');
  assert.equal(skillFamily({ kind: null, content: { progressionId: 'I-IV-V' } }), 'progressions');
  assert.equal(skillFamily({ kind: null, content: { scaleId: 'minPent', keyPc: 9, positionId: 's6f5' } }), 'scales');
  assert.equal(skillFamily({ kind: null, content: { songId: '', progressionId: '' } }), 'scales');
  assert.equal(skillFamily({ kind: 'mystery', content: { pairId: 'C-G' } }), 'chords', 'unknown kinds infer too');
  for (const kind of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.equal(skillFamily({ kind, content: {} }), 'scales', `prototype kind ${kind}`);
  }
  assert.equal(skillFamily(null), 'scales');
});

test('familyLevelCounts buckets every row into its family and light level', () => {
  const zero = { scales: [0, 0, 0, 0, 0], chords: [0, 0, 0, 0, 0], progressions: [0, 0, 0, 0, 0], songs: [0, 0, 0, 0, 0] };
  assert.deepEqual(familyLevelCounts(), zero);
  assert.deepEqual(familyLevelCounts(null), zero);
  assert.deepEqual(familyLevelCounts('rows'), zero);
  const rows = [
    { kind: 'scaleRun', bestLevel: 0, cleanPasses: 0 },
    { kind: 'scaleRun', bestLevel: 3, cleanPasses: 4 },
    { kind: 'findNote', bestLevel: 1, cleanPasses: 1 },
    { kind: null, content: { scaleId: 'minPent', keyPc: 9, positionId: 's6f0' }, bestLevel: 3, cleanPasses: 2 },
    { kind: 'chordChanges', bestLevel: 0, cleanPasses: 1 },
    { kind: null, content: { pairId: 'C-G' }, bestLevel: 2, cleanPasses: 1 },
    { kind: 'song', bestLevel: 99, cleanPasses: 1 },
    null,
  ];
  const counts = familyLevelCounts(rows);
  assert.deepEqual(counts.scales, [1, 0, 1, 0, 2]);
  assert.deepEqual(counts.chords, [0, 1, 0, 1, 0]);
  assert.deepEqual(counts.progressions, [0, 0, 0, 0, 0]);
  assert.deepEqual(counts.songs, [0, 0, 0, 0, 1]);
  const total = Object.values(counts).flat().reduce((a, b) => a + b, 0);
  assert.equal(total, 7, 'every non-null row is counted exactly once');
});

// WR-03: the stored streak is only rewritten when a session lands, so it is read against today.
test('WR-03 liveStreak reads a broken streak as 0 and keeps today or yesterday', () => {
  const today = new Date(2026, 10, 20, 15, 0).getTime();
  const stored = { current: 5, longest: 7, lastDay: '2026-11-20' };
  assert.deepEqual(liveStreak(stored, today), { current: 5, longest: 7, lastDay: '2026-11-20' });
  assert.equal(liveStreak({ ...stored, lastDay: '2026-11-19' }, today).current, 5, 'yesterday still counts');
  const broken = liveStreak({ ...stored, lastDay: '2026-11-13' }, today);
  assert.equal(broken.current, 0, 'a week later the streak is broken');
  assert.equal(broken.longest, 7, 'the longest streak is a stored fact');
  assert.equal(liveStreak({ ...stored, lastDay: '2026-11-18' }, today).current, 0, 'a two-day gap breaks it');
  assert.equal(liveStreak({ current: 3, longest: 3, lastDay: '' }, today).current, 0);
  for (const raw of [null, undefined, 'x', {}]) assert.equal(liveStreak(raw, today).current, 0);
  // Applying a session today restores a live count from the stored record.
  assert.equal(liveStreak(stored, addDays(today, 1)).current, 5);
  assert.equal(liveStreak(stored, addDays(today, 2)).current, 0);
});

test('WR-03 progressView in main reads the streak live', () => {
  const main = fs.readFileSync(new URL('../app/src/main.js', import.meta.url), 'utf8');
  assert.match(main, /streak: liveStreak\(persisted\.streak, now\)/);
});
