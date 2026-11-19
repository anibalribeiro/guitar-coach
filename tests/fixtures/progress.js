// Frozen progress fixtures for the pure mastery model. One chart plus three result
// shapes: a clean two-pass drill, the same drill with a shaky recall, and a stopped
// early drill with one completed pass. Times are fixed so no test reads the clock.
export const FIXED_NOW = 1700000100000;
export const STARTED_WALL = 1700000000000;
export const ENDED_WALL = 1700000041000;

export const SYNTHETIC_CHART = Object.freeze({
  id: 'scaleRun:minPent:9:s6f0',
  kind: 'scaleRun',
  bpm: 80,
  content: Object.freeze({ scaleId: 'minPent', keyPc: 9, positionId: 's6f0' }),
});

const CLEAN_WITH_HINTS_PASS = Object.freeze({
  index: 1,
  hintLevel: 0,
  bpm: 80,
  completedSteps: 16,
  plannedSteps: 16,
  selfReport: 'clean',
  unguidedMs: 0,
  aborted: false,
  reasonKey: null,
});

const CLEAN_RECALL_PASS = Object.freeze({
  index: 2,
  hintLevel: 3,
  bpm: 80,
  completedSteps: 16,
  plannedSteps: 16,
  selfReport: 'clean',
  unguidedMs: 12000,
  aborted: false,
  reasonKey: null,
});

const CLEAN_PASSES = Object.freeze([CLEAN_WITH_HINTS_PASS, CLEAN_RECALL_PASS]);

export const CLEAN_RESULT = Object.freeze({
  sessionId: 'scaleRun:minPent:9:s6f0:1700000000000',
  skillId: 'scaleRun:minPent:9:s6f0',
  chartId: 'scaleRun:minPent:9:s6f0',
  kind: 'scaleRun',
  content: Object.freeze({ scaleId: 'minPent', keyPc: 9, positionId: 's6f0' }),
  startedAt: 0,
  endedAt: 41000,
  startedWallAt: STARTED_WALL,
  endedWallAt: ENDED_WALL,
  bpm: 80,
  startLevel: 0,
  finalLevel: 3,
  passes: CLEAN_PASSES,
  recall: Object.freeze({ attempted: true, completed: true, selfReport: 'clean', bpm: 80 }),
  completed: true,
  stoppedEarly: false,
});

export const SHAKY_RESULT = Object.freeze({
  ...CLEAN_RESULT,
  passes: Object.freeze([
    CLEAN_WITH_HINTS_PASS,
    Object.freeze({ ...CLEAN_RECALL_PASS, selfReport: 'shaky', unguidedMs: 0 }),
  ]),
  recall: Object.freeze({ attempted: true, completed: true, selfReport: 'shaky', bpm: 80 }),
});

export const STOPPED_EARLY_RESULT = Object.freeze({
  sessionId: 'scaleRun:minPent:9:s6f0:1700000099000',
  skillId: 'scaleRun:minPent:9:s6f0',
  chartId: 'scaleRun:minPent:9:s6f0',
  kind: 'scaleRun',
  content: Object.freeze({ scaleId: 'minPent', keyPc: 9, positionId: 's6f0' }),
  startedAt: 0,
  endedAt: 16000,
  startedWallAt: 1700000099000,
  endedWallAt: 1700000101000,
  bpm: 80,
  startLevel: 0,
  finalLevel: 0,
  passes: Object.freeze([CLEAN_WITH_HINTS_PASS]),
  recall: Object.freeze({ attempted: false, completed: false, selfReport: null, bpm: 80 }),
  completed: false,
  stoppedEarly: true,
});

// Fixed local calendar date for the schedule, streak and chip tests. Built from local
// components so no assertion depends on the machine's time zone offset.
export const FIXED_DAY = new Date(2026, 10, 9, 12, 0, 0).getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------- Chord-pair results (03-02 Task 2) ----------
// Eight bars of 4/4, one chord per bar, at 80 BPM: a clean change every bar is 8 * 80 / 32
// = 20 changes per minute. `changes` and `chordPairId` are the fields summarizeDrill
// supplies for the chord family; the pair plane reads nothing else.
const CHORD_CLEAN_PASS = Object.freeze({
  index: 1,
  hintLevel: 0,
  bpm: 80,
  completedSteps: 8,
  plannedSteps: 8,
  selfReport: 'clean',
  unguidedMs: 0,
  aborted: false,
  reasonKey: null,
});

export const CHORD_CLEAN_RESULT = Object.freeze({
  sessionId: 'chordChanges:C-G:1700000000000',
  skillId: 'chordChanges:C-G',
  chartId: 'chordChanges:C-G',
  kind: 'chordChanges',
  content: Object.freeze({ pairId: 'C-G', chords: Object.freeze(['C', 'G']) }),
  chordPairId: 'C-G',
  startedAt: 0,
  endedAt: 24000,
  startedWallAt: STARTED_WALL,
  endedWallAt: ENDED_WALL,
  bpm: 80,
  startLevel: 0,
  finalLevel: 0,
  passes: Object.freeze([CHORD_CLEAN_PASS]),
  changes: Object.freeze({
    planned: 8,
    counted: 8,
    clean: 8,
    missed: 0,
    perBar: Object.freeze(['clean', 'clean', 'clean', 'clean', 'clean', 'clean', 'clean', 'clean']),
    changesPerMin: 20,
  }),
  recall: Object.freeze({ attempted: false, completed: false, selfReport: null, bpm: 80 }),
  completed: true,
  stoppedEarly: false,
});

// The same eight bars on G → D with four of eight changes: 4 * 80 / 32 = 10 changes/min.
export const CHORD_HALF_RESULT = Object.freeze({
  ...CHORD_CLEAN_RESULT,
  sessionId: 'chordChanges:G-D:1700000001000',
  skillId: 'chordChanges:G-D',
  chartId: 'chordChanges:G-D',
  content: Object.freeze({ pairId: 'G-D', chords: Object.freeze(['G', 'D']) }),
  chordPairId: 'G-D',
  changes: Object.freeze({
    planned: 8,
    counted: 4,
    clean: 4,
    missed: 4,
    perBar: Object.freeze(['clean', 'missed', 'clean', 'missed', 'clean', 'missed', 'clean', 'missed']),
    changesPerMin: 10,
  }),
});

const MASTERED_DUE_SKILL = Object.freeze({
  skillId: 'scaleRun:minPent:9:s6f0',
  kind: 'scaleRun',
  content: Object.freeze({ scaleId: 'minPent', keyPc: 9, positionId: 's6f0' }),
  withLights: Object.freeze({ cleanPasses: 4, bestBpm: 80, bestLevel: 2, lastCleanAt: FIXED_DAY - 4 * DAY_MS, lastFailAt: null }),
  withoutLights: Object.freeze({ cleanPasses: 2, bestBpm: 80, bestLevel: 3, lastCleanAt: FIXED_DAY - 2 * DAY_MS, lastFailAt: null }),
  bestBpm: 80, bestLevel: 3, cleanPasses: 6,
  accuracy: null, medianTimingMs: null, micUsed: false,
  lastPlayedAt: FIXED_DAY - 60 * 60 * 1000,
  masteredAt: FIXED_DAY - 4 * DAY_MS,
  lastCleanRecallAt: FIXED_DAY - 2 * DAY_MS,
  dueAt: FIXED_DAY - DAY_MS,
  intervalIndex: 2, lapses: 0,
  createdAt: FIXED_DAY - 10 * DAY_MS, updatedAt: FIXED_DAY - 60 * 60 * 1000,
});

const LAPSED_SKILL = Object.freeze({
  skillId: 'scaleRun:major:0:s6f3',
  kind: 'scaleRun',
  content: Object.freeze({ scaleId: 'major', keyPc: 0, positionId: 's6f3' }),
  withLights: Object.freeze({ cleanPasses: 2, bestBpm: 70, bestLevel: 1, lastCleanAt: FIXED_DAY - 40 * DAY_MS, lastFailAt: null }),
  withoutLights: Object.freeze({ cleanPasses: 1, bestBpm: 70, bestLevel: 3, lastCleanAt: FIXED_DAY - 30 * DAY_MS, lastFailAt: null }),
  bestBpm: 70, bestLevel: 3, cleanPasses: 3,
  accuracy: null, medianTimingMs: null, micUsed: false,
  lastPlayedAt: FIXED_DAY - 30 * DAY_MS,
  masteredAt: FIXED_DAY - 40 * DAY_MS,
  lastCleanRecallAt: FIXED_DAY - 30 * DAY_MS,
  dueAt: FIXED_DAY - 20 * DAY_MS,
  intervalIndex: 4, lapses: 0,
  createdAt: FIXED_DAY - 50 * DAY_MS, updatedAt: FIXED_DAY - 30 * DAY_MS,
});

const LEARNING_SKILL = Object.freeze({
  skillId: 'scaleRun:blues:2:all',
  kind: 'scaleRun',
  content: Object.freeze({ scaleId: 'blues', keyPc: 2, positionId: 'all' }),
  withLights: Object.freeze({ cleanPasses: 1, bestBpm: 60, bestLevel: 0, lastCleanAt: FIXED_DAY - 3 * DAY_MS, lastFailAt: null }),
  withoutLights: Object.freeze({ cleanPasses: 0, bestBpm: 0, bestLevel: 0, lastCleanAt: null, lastFailAt: null }),
  bestBpm: 60, bestLevel: 0, cleanPasses: 1,
  accuracy: null, medianTimingMs: null, micUsed: false,
  lastPlayedAt: FIXED_DAY - 3 * DAY_MS,
  masteredAt: null, lastCleanRecallAt: null, dueAt: null,
  intervalIndex: 0, lapses: 0,
  createdAt: FIXED_DAY - 3 * DAY_MS, updatedAt: FIXED_DAY - 3 * DAY_MS,
});

const HISTORY = Object.freeze(Array.from({ length: 20 }, (_, i) => Object.freeze({
  sessionId: `scaleRun:minPent:9:s6f0:${1000 + i}`,
  skillId: 'scaleRun:minPent:9:s6f0',
  chartId: 'scaleRun:minPent:9:s6f0',
  kind: 'scaleRun',
  content: Object.freeze({ scaleId: 'minPent', keyPc: 9, positionId: 's6f0' }),
  startedAt: i * 20000,
  endedAt: i * 20000 + 16000,
  startedWallAt: FIXED_DAY - (20 - i) * DAY_MS,
  endedWallAt: FIXED_DAY - (20 - i) * DAY_MS + 41000,
  durationMs: 24000,
  unguidedMs: i % 2 === 0 ? 12000 : 0,
  completedPasses: 2,
  bpm: 80,
  startLevel: 0,
  finalLevel: 3,
  passes: Object.freeze([]),
  completed: true,
  stoppedEarly: false,
})));

// One schema-2 record with a due skill, a lapsed skill, a learning skill and a full
// 20-session history. Used for the panel view rows and the import round-trip. It predates
// the chord-pair plane (03-02), so it carries no `chordPairs` key at all — importing it
// must leave the pair table empty rather than invent one.
export const V2_PROGRESS = Object.freeze({
  version: 1,
  skills: Object.freeze({
    'scaleRun:minPent:9:s6f0': MASTERED_DUE_SKILL,
    'scaleRun:major:0:s6f3': LAPSED_SKILL,
    'scaleRun:blues:2:all': LEARNING_SKILL,
  }),
  sessions: HISTORY,
  totals: Object.freeze({ totalMs: 20 * 24000, unguidedMs: 10 * 12000, sessionCount: 20 }),
  streak: Object.freeze({ current: 4, longest: 6, lastDay: '2026-11-09' }),
});

export const V2_RECORD = Object.freeze({
  schemaVersion: 2,
  settings: Object.freeze({
    tab: 'scales', keyPc: 9, scaleId: 'minPent', positionId: 's6f0', labels: 'notes',
    direction: 'updown', bpm: 80, sound: true, drone: false, lightsOn: true, stageMode: false,
    drillFamily: 'scaleRun', quizQuestion: 'note', quizMode: 'find',
    chordId: 'C', voicingId: 'open', progressionId: 'I-IV-V', songId: '', barIndex: 0,
  }),
  progress: V2_PROGRESS,
});
