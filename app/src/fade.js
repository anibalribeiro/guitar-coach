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

// FADE-11: Anchors are every root plus, on each string, the lowest-fret note of the
// shape; a whole-neck run has no box, so it passes rootsOnly (roots only). Fret 0 is
// never an anchor because the T2 has no LED at the nut: the lowest fret is measured
// with open notes included, so an open lowest note drops that string's anchor and is
// never replaced by the next fret. Muted and non-integer frets are ignored. Shape
// order is preserved and duplicates collapse by "string:fret".
// A chord shape (chord: true) anchors on its roots plus the bass note: the lowest midi,
// a tie going to the thicker string; an open bass or root drops, never substituted.
export function anchorNotes(shape = [], { rootsOnly = false, chord = false } = {}) {
  const notes = (Array.isArray(shape) ? shape : [])
    .filter(n => n && typeof n === 'object' && Number.isInteger(n.f) && !n.muted);
  const seen = new Set();
  const keep = n => {
    const key = n.s + ':' + n.f;
    if (n.f === 0 || seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  if (rootsOnly) return notes.filter(n => n.iv === 0 && keep(n));
  if (chord) {
    let bass = null;
    for (const n of notes) {
      if (!Number.isFinite(n.midi)) continue;
      if (!bass || n.midi < bass.midi || (n.midi === bass.midi && n.s > bass.s)) bass = n;
    }
    return notes.filter(n => (n.iv === 0 || n === bass) && keep(n));
  }
  const lowest = new Map();
  for (const n of notes) if (!lowest.has(n.s) || n.f < lowest.get(n.s)) lowest.set(n.s, n.f);
  return notes.filter(n => (n.iv === 0 || n.f === lowest.get(n.s)) && keep(n));
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
