// ---------- Progress and mastery model ----------
// Pure domain: no DOM, no storage, no clock. Every writer passes `now`, so the store
// (02-03) owns persistence and the tests can use fixed dates. With-lights and
// without-lights results live in separate planes and are never averaged (D-27).
export const REVIEW_INTERVALS = [1, 3, 7, 14, 30];
export const DECAY_DAYS = 14;
// The imported document and the stored record share one size ceiling (T-02-12).
export const MAX_BACKUP_LENGTH = 512 * 1024;
export const PROGRESS_VERSION = 1;
// Stored now and enforced only when Phase 3 wires microphone scoring (D-31).
export const CLEAN_THRESHOLDS = { minAccuracy: 0.9, maxMedianTimingMs: 120 };
export const MAX_SESSIONS = 20;
// The ordered chord-pair plane is bounded like every other plane (T-03-08): 32 pairs is
// nearly three times the curated table, so a hand-edited backup can never inflate the
// record past the 512 KB ceiling one pair at a time.
export const MAX_PAIRS = 32;
// A chord drill runs at most 240 BPM, so even one change per beat is 240 changes/min;
// anything above 400 is corrupt data, not a fast player.
const MAX_RATE = 400;
// progress.js imports nothing, so it cannot read fade.js; the recall level is D-28's
// fourth level and is pinned here.
export const RECALL_LEVEL = 3;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

// ---------- Local calendar helpers ----------
// Streaks, due dates and "recalled N days ago" are local-calendar facts. Comparing the
// UTC epoch built from local y/m/d components keeps them stable across DST changes.
export function dayKey(ts) {
  const date = new Date(Number.isFinite(ts) ? ts : Date.now());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function addDays(ts, days) {
  const base = new Date(Number.isFinite(ts) ? ts : Date.now());
  const offset = Number.isFinite(days) ? Math.trunc(days) : 0;
  // Local components, not epoch arithmetic: an hour lost or gained never moves the day.
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset).getTime();
}

export function daysBetween(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  const a = new Date(from);
  const b = new Date(to);
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / 86400000);
}

function dayStartOfKey(key) {
  const match = DAY_KEY.exec(typeof key === 'string' ? key : '');
  if (!match) return null;
  return new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))).getTime();
}

const zeroPlane = () => ({ cleanPasses: 0, bestBpm: 0, bestLevel: 0, lastCleanAt: null, lastFailAt: null });

export function emptyProgress() {
  return {
    version: PROGRESS_VERSION,
    skills: {},
    // D-49: one row per ordered pair id; the plane is rebuilt from defaults on every
    // validation pass like skills, sessions and streak.
    chordPairs: {},
    sessions: [],
    totals: { totalMs: 0, unguidedMs: 0, sessionCount: 0 },
    streak: { current: 0, longest: 0, lastDay: '' },
  };
}

// D-40: lapsed > due > mastered > learning. Due is a mastered record's review date;
// a never-mastered skill cannot be "due for review", or the Due chip and the Due tile
// would disagree (WR-04). A mastered record without a clean-recall timestamp can never
// be lapsed; it falls through to due/mastered.
export function skillState(skill, now = Date.now()) {
  const record = skill && typeof skill === 'object' ? skill : {};
  const mastered = Number.isFinite(record.masteredAt);
  const lastClean = Number.isFinite(record.lastCleanRecallAt) ? record.lastCleanRecallAt : null;
  if (mastered && lastClean !== null && Number.isFinite(record.dueAt) && daysBetween(record.dueAt, now) > DECAY_DAYS) return 'lapsed';
  if (mastered && Number.isFinite(record.dueAt) && record.dueAt <= now) return 'due';
  if (mastered) return 'mastered';
  return 'learning';
}

// D-27: drill x key x position already lives in the chart id (scaleRun:{scale}:{pc}:{pos}).
export function skillIdFor(chart) {
  return chart && chart.id ? chart.id : '';
}

// Active time is derived from completed beats and the chart tempo, never wall time.
export function passActiveMs(completedSteps, bpm) {
  const steps = Number.isFinite(completedSteps) ? Math.max(0, completedSteps) : 0;
  const tempo = Number.isFinite(bpm) && bpm > 0 ? bpm : 0;
  return tempo ? Math.round(steps * 60000 / tempo) : 0;
}

// D-36: the next drill starts one level easier than the best clean level, never
// straight back to no lights and never above Hint on demand.
export function startLevelFor(progress, skillId) {
  const skills = progress && progress.skills && typeof progress.skills === 'object' ? progress.skills : null;
  const record = skills && Object.hasOwn(skills, skillId) ? skills[skillId] : null;
  const bestLevel = record && Number.isFinite(record.bestLevel) ? record.bestLevel : 0;
  return Math.max(0, Math.min(2, bestLevel - 1));
}

function plane(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    cleanPasses: Number.isFinite(source.cleanPasses) ? source.cleanPasses : 0,
    bestBpm: Number.isFinite(source.bestBpm) ? source.bestBpm : 0,
    bestLevel: Number.isFinite(source.bestLevel) ? source.bestLevel : 0,
    lastCleanAt: Number.isFinite(source.lastCleanAt) ? source.lastCleanAt : null,
    lastFailAt: Number.isFinite(source.lastFailAt) ? source.lastFailAt : null,
  };
}

export function createSkill(chart, now = 0) {
  return {
    skillId: skillIdFor(chart),
    kind: chart && chart.kind ? chart.kind : null,
    content: chart && chart.content ? { ...chart.content } : {},
    withLights: zeroPlane(),
    withoutLights: zeroPlane(),
    bestBpm: 0,
    bestLevel: 0,
    cleanPasses: 0,
    accuracy: null,
    medianTimingMs: null,
    micUsed: false,
    lastPlayedAt: null,
    masteredAt: null,
    retainedAt: null,
    lastCleanRecallAt: null,
    lastReviewAt: null,
    dueAt: null,
    intervalIndex: 0,
    lapses: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function cloneSkill(record) {
  const source = record && typeof record === 'object' ? record : {};
  return {
    ...source,
    skillId: source.skillId,
    kind: source.kind || null,
    content: source.content ? { ...source.content } : {},
    withLights: plane(source.withLights),
    withoutLights: plane(source.withoutLights),
    bestBpm: Number.isFinite(source.bestBpm) ? source.bestBpm : 0,
    bestLevel: Number.isFinite(source.bestLevel) ? source.bestLevel : 0,
    cleanPasses: Number.isFinite(source.cleanPasses) ? source.cleanPasses : 0,
    // Phase 2 never writes microphone evidence, but it must not delete evidence a
    // Phase 3 record (or an import) already carries (WR-07).
    accuracy: Number.isFinite(source.accuracy) && source.accuracy >= 0 && source.accuracy <= 1
      ? source.accuracy : null,
    medianTimingMs: Number.isFinite(source.medianTimingMs)
      && source.medianTimingMs >= -10000 && source.medianTimingMs <= 10000
      ? source.medianTimingMs : null,
    micUsed: source.micUsed === true,
    lastPlayedAt: source.lastPlayedAt === undefined ? null : source.lastPlayedAt,
    masteredAt: source.masteredAt === undefined ? null : source.masteredAt,
    retainedAt: Number.isFinite(source.retainedAt) ? source.retainedAt : null,
    lastCleanRecallAt: source.lastCleanRecallAt === undefined ? null : source.lastCleanRecallAt,
    lastReviewAt: Number.isFinite(source.lastReviewAt) ? source.lastReviewAt : Number.isFinite(source.lastCleanRecallAt) ? source.lastCleanRecallAt : null,
    dueAt: source.dueAt === undefined ? null : source.dueAt,
    intervalIndex: Number.isFinite(source.intervalIndex) ? source.intervalIndex : 0,
    lapses: Number.isFinite(source.lapses) ? source.lapses : 0,
    createdAt: Number.isFinite(source.createdAt) ? source.createdAt : 0,
    updatedAt: Number.isFinite(source.updatedAt) ? source.updatedAt : 0,
  };
}

const passComplete = pass => !!pass
  && Number.isFinite(pass.completedSteps)
  && Number.isFinite(pass.plannedSteps)
  && pass.completedSteps >= pass.plannedSteps
  && !pass.aborted;

// A pass carries the practice time it earned when it closed (WR-02): wall time for a
// wait-mode pass and steps × their real beat span for a timed one. A record from before the
// field existed still reads through the beat-derived formula, so an import never loses time.
const passMs = pass => (Number.isFinite(pass && pass.activeMs)
  ? Math.max(0, pass.activeMs)
  : passActiveMs(pass.completedSteps, pass.bpm));

const passUnguidedMs = pass => (
  pass.hintLevel === RECALL_LEVEL && passComplete(pass) && passIsClean(pass)
    ? passMs(pass)
    : 0
);

// Every session field is derived from the pass records: a pause, count-in or wall
// clock never adds practice time.
function sessionOf(result, skillId) {
  const passes = (result.passes || []).map(pass => ({ ...pass }));
  return {
    sessionId: result.sessionId || null,
    skillId,
    chartId: result.chartId || skillId,
    kind: result.kind || null,
    content: result.content ? { ...result.content } : {},
    startedAt: result.startedAt === undefined ? null : result.startedAt,
    endedAt: result.endedAt === undefined ? null : result.endedAt,
    startedWallAt: result.startedWallAt === undefined ? null : result.startedWallAt,
    endedWallAt: result.endedWallAt === undefined ? null : result.endedWallAt,
    durationMs: passes.reduce((sum, pass) => sum + passMs(pass), 0),
    unguidedMs: passes.reduce((sum, pass) => sum + passUnguidedMs(pass), 0),
    completedPasses: passes.filter(passComplete).length,
    bpm: result.bpm,
    startLevel: result.startLevel,
    finalLevel: result.finalLevel,
    passes,
    completed: !!result.completed,
    stoppedEarly: !!result.stoppedEarly,
    // Persist the recall report explicitly: a long drill truncates the pass list, and
    // inferring the report from a missing recall pass re-applied mastery (CR-05).
    recallReport: result.recall && (result.recall.selfReport === 'clean' || result.recall.selfReport === 'shaky')
      ? result.recall.selfReport
      : null,
  };
}

function lastRecallPass(session) {
  const passes = (session && session.passes) || [];
  for (let i = passes.length - 1; i >= 0; i--) {
    if (passes[i].hintLevel === RECALL_LEVEL && passComplete(passes[i])) return passes[i];
  }
  return null;
}

function recallReportOf(session) {
  // Prefer the explicit report; old records fall back to the retained recall pass.
  if (session && (session.recallReport === 'clean' || session.recallReport === 'shaky')) {
    return session.recallReport;
  }
  const pass = lastRecallPass(session);
  return pass ? (pass.selfReport || null) : null;
}

// Unknown microphone evidence stays self-reported; a known failure needs an explicit correction.
export function passIsClean(pass) {
  return !!pass && pass.selfReport === 'clean'
    && (!pass.assessment || pass.assessment.passed !== false
      || (pass.assessment.source === 'microphone' && pass.assessment.corrected === true));
}

function scheduleRecall(skill, pass, now) {
  const previous = Number.isFinite(skill.lastReviewAt) ? skill.lastReviewAt : skill.lastCleanRecallAt;
  if (Number.isFinite(previous)) skill.lastReviewAt = previous;
  skill.masteredAt = skill.masteredAt === null ? now : skill.masteredAt;
  skill.lastCleanRecallAt = now;
  // Legacy records had no assessment. New guided repeats cannot grow retention intervals.
  if (Number.isFinite(previous)) {
    if (dayKey(previous) === dayKey(now)) return;
    if (pass.assessment && !pass.assessment.coldRecall) return;
    if (pass.assessment && pass.assessment.coldRecall) skill.retainedAt = now;
  }
  skill.lastReviewAt = now;
  skill.dueAt = addDays(now, REVIEW_INTERVALS[skill.intervalIndex]);
  skill.intervalIndex = Math.min(skill.intervalIndex + 1, REVIEW_INTERVALS.length - 1);
}

function applyPass(skill, pass, now) {
  if (!passComplete(pass)) return;
  if (passIsClean(pass)) {
    skill.cleanPasses += 1;
    skill.bestBpm = Math.max(skill.bestBpm, pass.bpm || 0);
    skill.bestLevel = Math.max(skill.bestLevel, pass.hintLevel || 0);
    const target = pass.hintLevel === RECALL_LEVEL ? skill.withoutLights : skill.withLights;
    target.cleanPasses += 1;
    target.bestBpm = Math.max(target.bestBpm, pass.bpm || 0);
    target.bestLevel = Math.max(target.bestLevel, pass.hintLevel || 0);
    target.lastCleanAt = now;
    if (pass.hintLevel === RECALL_LEVEL) {
      // D-28: the current bucket schedules the review, then the ladder advances.
      scheduleRecall(skill, pass, now);
    }
  } else if (pass.selfReport === 'shaky' && pass.hintLevel === RECALL_LEVEL) {
    // A failed recall returns the skill to the one-day bucket; the historical
    // mastery timestamp is kept because decay is read, not rewritten (D-28).
    skill.lapses += 1;
    skill.withoutLights.lastFailAt = now;
    skill.intervalIndex = 0;
    skill.dueAt = addDays(now, REVIEW_INTERVALS[0]);
  }
}

// An existing session applies only the level-4 recall delta, so with-hints clean
// counts, bests and session totals are never added twice (D-30, T-02-07).
function applyRecallDelta(skill, oldSession, newSession, now) {
  const oldReport = recallReportOf(oldSession);
  const newPass = lastRecallPass(newSession);
  const newReport = newPass ? (passIsClean(newPass) ? 'clean' : (newPass.selfReport === 'clean' ? 'shaky' : newPass.selfReport || null)) : null;
  if (oldReport === newReport) return;
  if (oldReport === 'clean') {
    skill.cleanPasses = Math.max(0, skill.cleanPasses - 1);
    skill.withoutLights.cleanPasses = Math.max(0, skill.withoutLights.cleanPasses - 1);
  } else if (oldReport === 'shaky') {
    skill.lapses = Math.max(0, skill.lapses - 1);
  }
  if (newReport === 'clean') {
    skill.cleanPasses += 1;
    skill.bestBpm = Math.max(skill.bestBpm, newPass.bpm || 0);
    skill.bestLevel = Math.max(skill.bestLevel, newPass.hintLevel || 0);
    skill.withoutLights.cleanPasses += 1;
    skill.withoutLights.bestBpm = Math.max(skill.withoutLights.bestBpm, newPass.bpm || 0);
    skill.withoutLights.bestLevel = Math.max(skill.withoutLights.bestLevel, newPass.hintLevel || 0);
    skill.withoutLights.lastCleanAt = now;
    scheduleRecall(skill, newPass, now);
  } else if (newReport === 'shaky') {
    skill.lapses += 1;
    skill.withoutLights.lastFailAt = now;
    skill.intervalIndex = 0;
    skill.dueAt = addDays(now, REVIEW_INTERVALS[0]);
  }
}

// D-50/A8: the microphone evidence of one scored pass, read from the score the engine
// stamped on FINISH/STOP. A metric the pass did not produce stays null so the caller
// writes nothing — an unscored rep can never clear an earlier one, and `micUsed` alone
// says the pass was scored. Out-of-range values are dropped rather than stored.
function micEvidenceOf(result) {
  const score = result && typeof result.syncScore === 'object' && result.syncScore !== null
    ? result.syncScore : null;
  if (!score) return null;
  const timing = score.timing && typeof score.timing === 'object' ? score.timing : {};
  return {
    accuracy: Number.isFinite(score.accuracy) && score.accuracy >= 0 && score.accuracy <= 1
      ? score.accuracy : null,
    medianTimingMs: Number.isFinite(timing.medianMs) && timing.medianMs >= -10000 && timing.medianMs <= 10000
      ? timing.medianMs : null,
  };
}

// One result -> one skill record and one upserted session. A re-report with the same
// sessionId adjusts the totals by delta and can never append a second session.
export function applyResult(progress, result, { now = Date.now() } = {}) {
  const base = progress && typeof progress === 'object' ? progress : emptyProgress();
  const skillId = result.skillId || skillIdFor(result);
  const sessions = Array.isArray(base.sessions) ? base.sessions.slice() : [];
  let chordPairs = isObject(base.chordPairs) ? base.chordPairs : {};
  const totals = {
    totalMs: Number.isFinite(base.totals && base.totals.totalMs) ? base.totals.totalMs : 0,
    unguidedMs: Number.isFinite(base.totals && base.totals.unguidedMs) ? base.totals.unguidedMs : 0,
    sessionCount: Number.isFinite(base.totals && base.totals.sessionCount) ? base.totals.sessionCount : 0,
  };
  let streak = validStreak(base.streak);
  const existing = base.skills && Object.hasOwn(base.skills, skillId) ? base.skills[skillId] : null;
  const skill = existing
    ? cloneSkill(existing)
    : createSkill({ id: skillId, kind: result.kind, content: result.content }, now);
  skill.skillId = skillId;
  const session = sessionOf(result, skillId);
  const index = session.sessionId ? sessions.findIndex(item => item.sessionId === session.sessionId) : -1;

  if (session.sessionId && index === -1) {
    sessions.push(session);
    totals.totalMs += session.durationMs;
    totals.unguidedMs += session.unguidedMs;
    totals.sessionCount += 1;
    for (const pass of session.passes) applyPass(skill, pass, now);
    // D-49: the pair delta rides the same new-session branch as the passes, so a
    // self-report upsert can never add the same eight bars twice (T-03-07).
    chordPairs = foldPair(chordPairs, result, now);
    // D-38: a practice day needs at least one completed pass; a stopped-early drill
    // with zero completed passes adds its minutes but never advances the streak.
    streak = streakAfter(streak, session, now);
  } else if (session.sessionId) {
    const old = sessions[index];
    sessions[index] = session;
    totals.totalMs = Math.max(0, totals.totalMs + session.durationMs - old.durationMs);
    totals.unguidedMs = Math.max(0, totals.unguidedMs + session.unguidedMs - old.unguidedMs);
    applyRecallDelta(skill, old, session, now);
  } else {
    // A result without a session id (a defensive or legacy call) must never apply its
    // passes: every report would re-run them and multiply mastery counters (CR-01).
    // Session identity is established at START/START_FAILED/RESUME/RESTART instead.
  }

  // The history keeps the last 20 sessions; totals stay cumulative.
  while (sessions.length > MAX_SESSIONS) sessions.shift();

  // D-50: the mic evidence rides the same skill record, never a second plane. It is
  // written outside the new-session branch, so a re-report of the same session re-writes
  // the same values (idempotent) and an unscored rep writes nothing at all.
  const evidence = micEvidenceOf(result);
  if (evidence) {
    if (evidence.accuracy !== null) skill.accuracy = evidence.accuracy;
    if (evidence.medianTimingMs !== null) skill.medianTimingMs = evidence.medianTimingMs;
    skill.micUsed = true;
  }

  skill.lastPlayedAt = result.endedWallAt === undefined || result.endedWallAt === null
    ? now
    : result.endedWallAt;
  skill.updatedAt = now;

  return {
    ...base,
    version: base.version || PROGRESS_VERSION,
    skills: { ...(base.skills || {}), [skillId]: skill },
    chordPairs,
    sessions,
    totals,
    streak,
  };
}

// D-49: the pair is identified by the ordered chord list, never by tempo or bar count, so
// a faster rep updates the same row. Counters accumulate; the rate and the tempo keep
// their maxima, because a stored best is historical and a sloppier rep cannot lower it.
function foldPair(chordPairs, result, now) {
  const pairId = result.chordPairId;
  if (!safeId(pairId)) return chordPairs;
  const changes = isObject(result.changes) ? result.changes : null;
  if (!changes) return chordPairs;
  // Only the bars the pass actually reached count as attempts: a stopped two-bar attempt
  // is two attempts, never eight, and an abandoned zero-bar attempt records nothing (WR-07).
  const reached = Number.isFinite(changes.reached) ? pickInt(changes.reached) : pickInt(changes.planned);
  if (result.stoppedEarly && reached <= 0) return chordPairs;
  const previous = Object.hasOwn(chordPairs, pairId) && isObject(chordPairs[pairId])
    ? chordPairs[pairId]
    : null;
  const endedAt = result.endedWallAt === undefined || result.endedWallAt === null ? now : result.endedWallAt;
  const row = {
    pairId,
    chords: pairChords(result.content ? result.content.chords : null),
    clean: (previous ? pickInt(previous.clean) : 0) + pickInt(changes.clean),
    attempts: (previous ? pickInt(previous.attempts) : 0) + reached,
    changesPerMin: Math.max(previous ? clampRate(previous.changesPerMin) : 0, clampRate(changes.changesPerMin)),
    bestBpm: Math.max(previous ? clampRate(previous.bestBpm) : 0, clampRate(result.bpm)),
    lastPlayedAt: Number.isFinite(endedAt) ? endedAt : now,
    updatedAt: now,
  };
  return { ...chordPairs, [pairId]: row };
}

function validStreak(raw) {
  const source = isObject(raw) ? raw : {};
  const lastDay = own(source, 'lastDay');
  return {
    current: pickInt(own(source, 'current')),
    longest: pickInt(own(source, 'longest')),
    lastDay: typeof lastDay === 'string' && DAY_KEY.test(lastDay) ? lastDay : '',
  };
}

// A practice day is a local calendar day with at least one session that completed a
// pass. The same day holds, the next day increments, any gap restarts at one.
function streakAfter(streak, session, now) {
  const next = validStreak(streak);
  if (!(Number.isFinite(session.completedPasses) && session.completedPasses >= 1)) return next;
  const stamp = Number.isFinite(session.endedWallAt) ? session.endedWallAt
    : (Number.isFinite(session.startedWallAt) ? session.startedWallAt : now);
  const day = dayKey(stamp);
  const dayStart = dayStartOfKey(day);
  const lastStart = next.lastDay ? dayStartOfKey(next.lastDay) : null;
  if (lastStart === null) {
    next.current = 1;
    next.lastDay = day;
  } else if (dayStart > lastStart) {
    next.current = daysBetween(lastStart, dayStart) === 1 ? next.current + 1 : 1;
    next.lastDay = day;
  }
  next.longest = Math.max(next.longest, next.current);
  return next;
}

// View rows: the panel derives the label from `content`; no display string is stored.
// `kind` rides along so the panel can name the family (`Chord changes · C → G`), and the
// three Phase 3 microphone fields ride along for the skill row's optional third line.
export function skillRows(progress, { now = Date.now(), limit = 5 } = {}) {
  const skills = progress && isObject(progress.skills) ? progress.skills : {};
  const rows = Object.keys(skills).map(skillId => {
    const skill = skills[skillId] || {};
    return {
      skillId,
      kind: typeof skill.kind === 'string' ? skill.kind : null,
      content: skill.content || {},
      bestBpm: skill.bestBpm || 0,
      bestLevel: skill.bestLevel || 0,
      cleanPasses: skill.cleanPasses || 0,
      accuracy: Number.isFinite(skill.accuracy) ? skill.accuracy : null,
      medianTimingMs: Number.isFinite(skill.medianTimingMs) ? skill.medianTimingMs : null,
      micUsed: skill.micUsed === true,
      lastPlayedAt: Number.isFinite(skill.lastPlayedAt) ? skill.lastPlayedAt : null,
      lastCleanRecallAt: Number.isFinite(skill.lastCleanRecallAt) ? skill.lastCleanRecallAt : null,
      masteredAt: Number.isFinite(skill.masteredAt) ? skill.masteredAt : null,
      retainedAt: Number.isFinite(skill.retainedAt) ? skill.retainedAt : null,
      dueAt: Number.isFinite(skill.dueAt) ? skill.dueAt : null,
      state: skillState(skill, now),
    };
  });
  rows.sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0));
  return rows.slice(0, Math.max(0, limit));
}

// The review queue: due or lapsed mastered skills, soonest first. skillState already
// gates due on mastery, so the two views cannot disagree (WR-04).
export function dueRows(progress, { now = Date.now(), limit = 5 } = {}) {
  const rows = skillRows(progress, { now, limit: Number.MAX_SAFE_INTEGER })
    .filter(row => row.state === 'lapsed' || row.state === 'due');
  rows.sort((a, b) => (a.dueAt === null ? Infinity : a.dueAt) - (b.dueAt === null ? Infinity : b.dueAt));
  return rows.slice(0, Math.max(0, limit));
}

// D-49: the weakest ordered pair is the one with the lowest clean rate. When two pairs
// share a rate the faster one is the harder one, so the higher changes per minute wins the
// tie; the pair id keeps the order stable for pairs that agree on both. Rows carry the
// derived clean rate so no caller recomputes it. A pair with no attempts is not a pair yet.
export function weakestPair(progress, { limit = 5 } = {}) {
  const pairs = progress && isObject(progress.chordPairs) ? progress.chordPairs : {};
  const rows = Object.keys(pairs).map(pairId => {
    const record = isObject(pairs[pairId]) ? pairs[pairId] : {};
    const attempts = pickInt(record.attempts);
    // A clean count above its own attempt count is not a rate above 100%.
    const clean = Math.min(attempts, pickInt(record.clean));
    return {
      pairId,
      chords: pairChords(record.chords),
      clean,
      attempts,
      cleanRate: attempts > 0 ? clean / attempts : 0,
      changesPerMin: clampRate(record.changesPerMin),
      bestBpm: clampRate(record.bestBpm),
      lastPlayedAt: pickTime(record.lastPlayedAt),
    };
  }).filter(row => row.attempts > 0);
  rows.sort((a, b) => (a.cleanRate - b.cleanRate)
    || (b.changesPerMin - a.changesPerMin)
    || (a.pairId < b.pairId ? -1 : a.pairId > b.pairId ? 1 : 0));
  return rows.slice(0, Math.max(0, Number.isFinite(limit) ? limit : 5));
}

// The panel-facing name for the same table: five rows, weakest first.
export const chordPairRows = (progress, options = {}) => weakestPair(progress, options);

// ---------- Schema-2 validators ----------
// Every field is rebuilt from the source's own keys, never merged, so an imported
// object can only contribute plain primitives (T-02-11). Every validator returns a
// complete object; a corrupt plane can never null the caller out.
// The skill cap is chosen against the curated content, not guessed: a full crawl of the
// phase's own material reaches 767 ids — 288 scale runs (4 scales x 12 keys x 6 boxes),
// 288 note-finding ids on the same grid, 11 chord pairs, 96 progressions (8 x 12 keys) and
// 84 song sections (7 sections x 12 keys). 768 is the smallest cap that never trims a
// reachable skill; the 512 KB `MAX_RECORD_LENGTH` stays the real bound, which is why
// `fitProgress` below trims history instead of letting a write cross the ceiling (T-04-22).
export const MAX_SKILLS = 768;
const MAX_PASSES = 64;
const MAX_ID_LENGTH = 96;
const MAX_CONTENT_KEYS = 12;
// The curated table holds two- and four-chord entries; eight is the ceiling with room for
// a longer loop without letting an import store an unbounded chord list.
const MAX_PAIR_CHORDS = 8;
const MAX_TEXT = 64;
const SAFE_ID = /^[A-Za-z0-9:_-]+$/;
const SAFE_TEXT = /^[A-Za-z0-9 :.#/_+-]+$/;
const PROTECTED = ['__proto__', 'constructor', 'prototype'];

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => (isObject(object) && Object.hasOwn(object, key) ? object[key] : undefined);
const safeText = value => typeof value === 'string' && value.length <= MAX_TEXT && SAFE_TEXT.test(value);
const safeId = value => typeof value === 'string' && value.length > 0
  && value.length <= MAX_ID_LENGTH && SAFE_ID.test(value) && !PROTECTED.includes(value);
const pickId = value => (safeId(value) ? value : null);
const pickText = value => (safeText(value) ? value : null);
const pickNumber = value => (Number.isFinite(value) && value >= 0 ? value : 0);
const pickInt = value => (Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0);
const pickTime = value => (Number.isFinite(value) && value >= 0 ? value : null);
const pickLevel = value => (Number.isInteger(value) ? Math.max(0, Math.min(3, value)) : 0);
const pickIndex = value => (Number.isInteger(value)
  ? Math.max(0, Math.min(REVIEW_INTERVALS.length - 1, value))
  : 0);
const pickReport = value => (value === 'clean' || value === 'shaky' ? value : null);
// A duration that may legitimately be absent: `null` means the record predates the field,
// and the reader falls back instead of treating the pass as zero minutes (WR-02).
const pickDuration = value => (Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null);
// Rate and tempo share one band: a chord drill runs 30-240 BPM, and a rate or tempo that
// falls outside 0-400 is not a measurement.
const clampRate = value => (Number.isFinite(value) ? Math.max(0, Math.min(MAX_RATE, value)) : 0);
// The pair stores the ordered chord ids, never the rendered label: the label is derived
// from the curated table at render time, so a relabelled pair needs no migration.
const pairChords = value => (Array.isArray(value)
  ? value.filter(chord => safeId(chord)).slice(0, MAX_PAIR_CHORDS)
  : []);

// Content is a flat record of primitives. Unknown IDs survive a content change
// (D-27) but nested objects are dropped instead of merged.
function plainContent(raw) {
  const out = {};
  if (!isObject(raw)) return out;
  let count = 0;
  for (const key of Object.keys(raw)) {
    if (count >= MAX_CONTENT_KEYS) break;
    if (PROTECTED.includes(key) || !safeText(key)) continue;
    const value = own(raw, key);
    if (typeof value === 'string') {
      if (!safeText(value)) continue;
    } else if (!Number.isFinite(value) && typeof value !== 'boolean') {
      continue;
    }
    out[key] = value;
    count += 1;
  }
  return out;
}

function validPlane(raw) {
  const source = isObject(raw) ? raw : {};
  return {
    cleanPasses: pickInt(own(source, 'cleanPasses')),
    bestBpm: pickNumber(own(source, 'bestBpm')),
    bestLevel: pickLevel(own(source, 'bestLevel')),
    lastCleanAt: pickTime(own(source, 'lastCleanAt')),
    lastFailAt: pickTime(own(source, 'lastFailAt')),
  };
}

function validSkill(raw, skillId) {
  const micUsed = own(raw, 'micUsed') === true;
  const accuracy = own(raw, 'accuracy');
  const medianTimingMs = own(raw, 'medianTimingMs');
  return {
    skillId,
    kind: pickText(own(raw, 'kind')),
    content: plainContent(own(raw, 'content')),
    withLights: validPlane(own(raw, 'withLights')),
    withoutLights: validPlane(own(raw, 'withoutLights')),
    bestBpm: pickNumber(own(raw, 'bestBpm')),
    bestLevel: pickLevel(own(raw, 'bestLevel')),
    cleanPasses: pickInt(own(raw, 'cleanPasses')),
    // Phase 3 microphone evidence survives an import only inside its valid range.
    accuracy: Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 1 ? accuracy : null,
    medianTimingMs: Number.isFinite(medianTimingMs) && medianTimingMs >= -10000 && medianTimingMs <= 10000
      ? medianTimingMs : null,
    micUsed,
    lastPlayedAt: pickTime(own(raw, 'lastPlayedAt')),
    masteredAt: pickTime(own(raw, 'masteredAt')),
    retainedAt: pickTime(own(raw, 'retainedAt')),
    lastCleanRecallAt: pickTime(own(raw, 'lastCleanRecallAt')),
    lastReviewAt: pickTime(own(raw, 'lastReviewAt')) === null ? pickTime(own(raw, 'lastCleanRecallAt')) : pickTime(own(raw, 'lastReviewAt')),
    dueAt: pickTime(own(raw, 'dueAt')),
    intervalIndex: pickIndex(own(raw, 'intervalIndex')),
    lapses: pickInt(own(raw, 'lapses')),
    createdAt: pickTime(own(raw, 'createdAt')) || 0,
    updatedAt: pickTime(own(raw, 'updatedAt')) || 0,
  };
}

function validateAssessment(raw) {
  if (!isObject(raw) || !['microphone', 'quiz', 'selfReport'].includes(raw.source)) return null;
  return {
    source: raw.source,
    accuracy: Number.isFinite(raw.accuracy) && raw.accuracy >= 0 && raw.accuracy <= 1 ? raw.accuracy : null,
    medianTimingMs: Number.isFinite(raw.medianTimingMs) && Math.abs(raw.medianTimingMs) <= 10000 ? raw.medianTimingMs : null,
    meanAbsMs: Number.isFinite(raw.meanAbsMs) && raw.meanAbsMs >= 0 && raw.meanAbsMs <= 10000 ? raw.meanAbsMs : null,
    passed: raw.passed === false ? false : raw.passed === true ? true : null,
    corrected: raw.source === 'microphone' && raw.corrected === true,
    coldRecall: raw.coldRecall === true,
    manualHits: Number.isInteger(raw.manualHits) && raw.manualHits >= 0 && raw.manualHits <= 512 ? raw.manualHits : 0,
  };
}

export function validateSession(raw) {
  if (!isObject(raw)) return null;
  const passes = Array.isArray(own(raw, 'passes')) ? own(raw, 'passes') : [];
  return {
    sessionId: pickId(own(raw, 'sessionId')),
    skillId: pickId(own(raw, 'skillId')),
    chartId: pickId(own(raw, 'chartId')),
    kind: pickText(own(raw, 'kind')),
    content: plainContent(own(raw, 'content')),
    startedAt: pickTime(own(raw, 'startedAt')),
    endedAt: pickTime(own(raw, 'endedAt')),
    startedWallAt: pickTime(own(raw, 'startedWallAt')),
    endedWallAt: pickTime(own(raw, 'endedWallAt')),
    durationMs: pickInt(own(raw, 'durationMs')),
    unguidedMs: pickInt(own(raw, 'unguidedMs')),
    completedPasses: pickInt(own(raw, 'completedPasses')),
    bpm: pickNumber(own(raw, 'bpm')),
    startLevel: pickLevel(own(raw, 'startLevel')),
    finalLevel: pickLevel(own(raw, 'finalLevel')),
    passes: passes.filter(isObject).slice(-MAX_PASSES).map(pass => ({
      index: pickInt(own(pass, 'index')),
      hintLevel: pickLevel(own(pass, 'hintLevel')),
      bpm: pickNumber(own(pass, 'bpm')),
      completedSteps: pickInt(own(pass, 'completedSteps')),
      plannedSteps: pickInt(own(pass, 'plannedSteps')),
      selfReport: pickReport(own(pass, 'selfReport')),
      assessment: validateAssessment(own(pass, 'assessment')),
      unguidedMs: pickInt(own(pass, 'unguidedMs')),
      // A pass keeps the practice time it earned at close; an older record stays null and
      // reads through the beat-derived fallback (WR-02).
      activeMs: pickDuration(own(pass, 'activeMs')),
      aborted: own(pass, 'aborted') === true,
      reasonKey: pickText(own(pass, 'reasonKey')),
    })),
    completed: own(raw, 'completed') === true,
    stoppedEarly: own(raw, 'stoppedEarly') === true,
    recallReport: pickReport(own(raw, 'recallReport')),
  };
}

// One pair row, rebuilt field by field from the source's own keys. The pair id comes from
// the map key, never from the record, so a crafted record cannot rename itself.
function validPair(raw, pairId) {
  const attempts = pickInt(own(raw, 'attempts'));
  return {
    pairId,
    chords: pairChords(own(raw, 'chords')),
    clean: Math.min(attempts, pickInt(own(raw, 'clean'))),
    attempts,
    changesPerMin: clampRate(own(raw, 'changesPerMin')),
    bestBpm: clampRate(own(raw, 'bestBpm')),
    lastPlayedAt: pickTime(own(raw, 'lastPlayedAt')),
    updatedAt: pickTime(own(raw, 'updatedAt')) || 0,
  };
}

export function validateProgress(raw) {
  const out = emptyProgress();
  if (!isObject(raw)) return out;
  const skills = own(raw, 'skills');
  if (isObject(skills)) {
    let ids = Object.keys(skills).filter(id => safeId(id));
    if (ids.length > MAX_SKILLS) {
      // Keep the newest records, not the first-inserted ones: the drill that was just
      // written must survive its own validation pass.
      ids = ids.map((id, index) => ({
        id,
        index,
        updatedAt: pickTime(own(own(skills, id), 'updatedAt')) || 0,
      }))
        .sort((a, b) => (b.updatedAt - a.updatedAt) || (b.index - a.index))
        .slice(0, MAX_SKILLS)
        .map(entry => entry.id);
    }
    for (const id of ids) {
      const record = own(skills, id);
      if (isObject(record)) out.skills[id] = validSkill(record, id);
    }
  }
  const pairs = own(raw, 'chordPairs');
  if (isObject(pairs)) {
    // T-03-06: own keys only, `safeId` for every pair id (which rejects the three
    // prototype names), and the newest MAX_PAIRS survive a hand-edited backup.
    let pairIds = Object.keys(pairs).filter(id => safeId(id));
    if (pairIds.length > MAX_PAIRS) {
      pairIds = pairIds.map((id, index) => ({
        id,
        index,
        updatedAt: pickTime(own(own(pairs, id), 'updatedAt')) || 0,
      }))
        .sort((a, b) => (b.updatedAt - a.updatedAt) || (b.index - a.index))
        .slice(0, MAX_PAIRS)
        .map(entry => entry.id);
    }
    for (const pairId of pairIds) {
      const record = own(pairs, pairId);
      if (isObject(record)) out.chordPairs[pairId] = validPair(record, pairId);
    }
  }
  const sessions = own(raw, 'sessions');
  if (Array.isArray(sessions)) {
    out.sessions = sessions.slice(-MAX_SESSIONS).map(validateSession).filter(Boolean);
  }
  const totals = own(raw, 'totals');
  if (isObject(totals)) {
    out.totals = {
      totalMs: pickInt(own(totals, 'totalMs')),
      unguidedMs: pickInt(own(totals, 'unguidedMs')),
      sessionCount: pickInt(own(totals, 'sessionCount')),
    };
  }
  out.streak = validStreak(own(raw, 'streak'));
  return out;
}

// ---------- The write-time byte budget (T-04-22) ----------
// A plane that already fits is returned untouched (identity, not a copy), so the common
// write costs one `JSON.stringify` and changes nothing. When it does not fit, history goes
// before mastery: sessions are dropped oldest first, then the least recently updated skills,
// and the newest skill is never dropped — the drill just recorded must survive its own write.
// The caller owns the wrapper overhead and passes the budget this plane's own serialization
// has to fit inside, so the document that is written is the document that can be read back.
export function fitProgress(progress, maxBytes) {
  const source = isObject(progress) ? progress : emptyProgress();
  const limit = Number.isFinite(maxBytes) ? Math.max(0, maxBytes) : MAX_BACKUP_LENGTH;
  const bytes = plane => JSON.stringify(plane).length;
  if (bytes(source) <= limit) return source;

  const plane = {
    ...source,
    skills: isObject(source.skills) ? { ...source.skills } : {},
    chordPairs: isObject(source.chordPairs) ? { ...source.chordPairs } : {},
    sessions: Array.isArray(source.sessions) ? source.sessions.slice() : [],
  };
  // 1. Sessions are history, not mastery: the oldest goes first.
  while (plane.sessions.length && bytes(plane) > limit) plane.sessions.shift();
  if (bytes(plane) <= limit) return plane;

  // 2. Skills, least recently updated first. The newest record is held back so a plane that
  //    has to lose everything still keeps the skill the player just practised.
  const ordered = Object.keys(plane.skills)
    .map((id, index) => {
      const record = own(plane.skills, id);
      return { id, index, updatedAt: isObject(record) ? pickTime(own(record, 'updatedAt')) || 0 : 0 };
    })
    .sort((a, b) => (a.updatedAt - b.updatedAt) || (a.index - b.index));
  const newest = ordered.length ? ordered[ordered.length - 1].id : null;
  const droppable = ordered.slice(0, Math.max(0, ordered.length - 1)).map(entry => entry.id);
  // `bytes` falls as the prefix grows, so the smallest surviving set is a binary search
  // rather than one stringify per dropped id (a 767-record plane costs ten, not seven hundred).
  const keepCount = dropped => {
    const keep = new Set(droppable.slice(dropped));
    if (newest !== null) keep.add(newest);
    const next = { ...plane, skills: {} };
    for (const id of Object.keys(plane.skills)) if (keep.has(id)) next.skills[id] = plane.skills[id];
    return next;
  };
  let low = 0;
  let high = droppable.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (bytes(keepCount(mid)) <= limit) high = mid;
    else low = mid + 1;
  }
  return keepCount(low);
}

// ---------- Backup envelope (D-39) ----------
export const BACKUP_APP = 't2coach';
// A6: schema 3 adds the chord-pair plane to the exported progress object. A Phase 2 build
// pinned at 2 must refuse this file as `newer` rather than silently drop the pair table,
// so the envelope version moves with the plane; 1, 2 and 3 are all still readable.
export const BACKUP_SCHEMA_VERSION = 3;

function hasProtectedKeys(value, depth = 0) {
  if (depth > 8 || !value || typeof value !== 'object') return false;
  for (const key of Object.keys(value)) {
    if (PROTECTED.includes(key)) return true;
    if (hasProtectedKeys(value[key], depth + 1)) return true;
  }
  return false;
}

// One JSON document: settings, progress and the two history planes at the top level.
// Sessions and streak are never duplicated inside progress; the chord-pair table travels
// inside `progress` beside the skills, because it is mastery data, not history.
export function exportDoc(record, { now = Date.now() } = {}) {
  const source = isObject(record) ? record : {};
  const progress = validateProgress(source.progress);
  return {
    app: BACKUP_APP,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: Number.isFinite(now) ? now : Date.now(),
    settings: isObject(source.settings) ? { ...source.settings } : {},
    progress: { version: progress.version, skills: progress.skills, chordPairs: progress.chordPairs, totals: progress.totals },
    sessions: progress.sessions,
    streak: progress.streak,
  };
}

// The whole document is checked before any destructive replace. The settings validator
// is injected because settings.js already imports this module (a reverse import would
// be a cycle); main passes the real one and tests may pass a stub.
export function validateBackup(raw, { validateSettings } = {}) {
  let serialized = '';
  try {
    serialized = JSON.stringify(raw);
  } catch (e) {
    return { ok: false, reason: 'corrupt' };
  }
  if (typeof serialized !== 'string') return { ok: false, reason: 'corrupt' };
  if (serialized.length > MAX_BACKUP_LENGTH) return { ok: false, reason: 'oversized' };
  if (!isObject(raw)) return { ok: false, reason: 'foreign' };
  if (hasProtectedKeys(raw)) return { ok: false, reason: 'corrupt' };
  if (own(raw, 'app') !== BACKUP_APP) return { ok: false, reason: 'foreign' };
  const version = own(raw, 'schemaVersion');
  if (!Number.isInteger(version) || version < 1) return { ok: false, reason: 'corrupt' };
  if (version > BACKUP_SCHEMA_VERSION) return { ok: false, reason: 'newer' };
  const progressRaw = own(raw, 'progress');
  if (!isObject(progressRaw)) return { ok: false, reason: 'corrupt' };
  const sessions = own(raw, 'sessions');
  if (!Array.isArray(sessions)) return { ok: false, reason: 'corrupt' };
  if (sessions.length > MAX_SESSIONS) return { ok: false, reason: 'oversized' };
  const streakRaw = own(raw, 'streak');
  if (!isObject(streakRaw)) return { ok: false, reason: 'corrupt' };
  if (typeof validateSettings !== 'function') return { ok: false, reason: 'corrupt' };
  let settings = null;
  try {
    settings = validateSettings(own(raw, 'settings'));
  } catch (e) {
    // A throwing validator (crafted content id, missing family, ...) is a corrupt
    // file, never an unhandled rejection with no user message (CR-02).
    return { ok: false, reason: 'corrupt' };
  }
  const progress = validateProgress({ ...progressRaw, sessions, streak: streakRaw });
  return { ok: true, doc: { settings, progress } };
}
