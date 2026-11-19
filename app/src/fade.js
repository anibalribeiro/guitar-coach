// ---------- Hint ladder policy ----------
// Pure policy for the four-level hint ladder: the ordered level table, the stored
// thresholds, the per-pass decision and the reason vocabulary. No DOM, no storage,
// no clock. Thresholds live here only (D-22); the UI copies counts, never limits.
export const HINT_LEVELS = [
  { level: 0, id: 'full', name: 'Full pattern' },
  { level: 1, id: 'anchors', name: 'Anchors' },
  { level: 2, id: 'hint', name: 'Hint on demand' },
  { level: 3, id: 'none', name: 'No lights' },
];

// D-22: three clean passes remove a hint; two consecutive failed passes bring it back.
export const FADE = {
  cleanPassesToAdvance: 3,
  failedPassesToDemote: 2,
  recallLevel: 3,
  flashBeats: 1,
};

export const REASON = {
  start: 'start',
  advance: 'advance',
  holdClean: 'holdClean',
  holdFail: 'holdFail',
  holdSkip: 'holdSkip',
  demote: 'demote',
  asked: 'asked',
};

export const clampLevel = n => Math.max(0, Math.min(3, Number.isFinite(n) ? Math.trunc(n) : 0));

// D-23: H1 anchors are every root plus, on each string, the first and last note of
// the position box. Whole-neck runs have no box, so they pass rootsOnly. Fret 0 is
// kept for the screen (the LED codec filters it; D-05). Insertion order is preserved
// and duplicates collapse by "string:fret".
export function anchorNotes(shape = [], { rootsOnly = false } = {}) {
  const notes = Array.isArray(shape) ? shape : [];
  const seen = new Set();
  if (rootsOnly) {
    return notes.filter(n => {
      if (n.iv !== 0) return false;
      const key = n.s + ':' + n.f;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  const bounds = new Map();
  for (const n of notes) {
    const b = bounds.get(n.s) || { lo: n.f, hi: n.f };
    if (n.f < b.lo) b.lo = n.f;
    if (n.f > b.hi) b.hi = n.f;
    bounds.set(n.s, b);
  }
  return notes.filter(n => {
    const b = bounds.get(n.s);
    if (n.iv !== 0 && n.f !== b.lo && n.f !== b.hi) return false;
    const key = n.s + ':' + n.f;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// The pass plan is a live estimate, never a fixed four (D-35). Each remaining hint
// level costs its full clean-rep requirement, then the level-3 recall pass closes the
// drill. `cleanStreak` is the count already earned at `level`, so a hold that is one
// of the three reps does not inflate the estimate; a skipped or failed pass does
// (WR-03).
export function totalPassesFor(passIndex = 1, level = 0, cleanStreak = 0) {
  const index = Math.max(1, Number.isFinite(passIndex) ? Math.trunc(passIndex) : 1);
  const hints = clampLevel(level);
  if (hints === FADE.recallLevel) return index;
  const streak = Math.max(0, Math.min(
    FADE.cleanPassesToAdvance - 1,
    Number.isFinite(cleanStreak) ? Math.trunc(cleanStreak) : 0,
  ));
  const remainingHere = FADE.cleanPassesToAdvance - streak;
  const levelsAfter = Math.max(0, FADE.recallLevel - 1 - hints);
  const future = remainingHere + levelsAfter * FADE.cleanPassesToAdvance + 1;
  return Math.max(index, index + future - 1);
}

export function createFadeState(startLevel = 0) {
  const level = clampLevel(startLevel);
  return { level, cleanStreak: 0, failStreak: 0, reasonKey: REASON.start };
}

// One decision per pass boundary. `direction` maps to the UI contract: up = one hint
// removed (level index + 1), down = one hint back, none = hold, start = drill start,
// asked = the player requested a restart. Every branch returns a fresh object.
export function nextLevel(fade = {}, pass = {}) {
  const level = clampLevel(pass.hintLevel);
  const cleanStreak = Number.isFinite(fade.cleanStreak) ? fade.cleanStreak : 0;
  const failStreak = Number.isFinite(fade.failStreak) ? fade.failStreak : 0;

  if (pass.aborted) {
    return {
      level: Math.max(0, level - 1),
      cleanStreak: 0,
      failStreak: 0,
      reasonKey: REASON.asked,
      direction: 'asked',
    };
  }
  if (pass.selfReport === 'clean') {
    const nextClean = cleanStreak + 1;
    if (level < FADE.recallLevel && nextClean >= FADE.cleanPassesToAdvance) {
      return { level: level + 1, cleanStreak: 0, failStreak: 0, reasonKey: REASON.advance, direction: 'up' };
    }
    return { level, cleanStreak: nextClean, failStreak: 0, reasonKey: REASON.holdClean, direction: 'none' };
  }
  if (pass.selfReport === 'shaky') {
    const nextFail = failStreak + 1;
    if (level > 0 && nextFail >= FADE.failedPassesToDemote) {
      return { level: level - 1, cleanStreak: 0, failStreak: 0, reasonKey: REASON.demote, direction: 'down' };
    }
    return { level, cleanStreak: 0, failStreak: nextFail, reasonKey: REASON.holdFail, direction: 'none' };
  }
  // A skipped report holds the level and both streaks: it inserts a repeat pass and
  // never advances or demotes (D-37).
  return { level, cleanStreak, failStreak, reasonKey: REASON.holdSkip, direction: 'none' };
}
