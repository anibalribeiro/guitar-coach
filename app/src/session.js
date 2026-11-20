// ---------- Daily session planner (tier 0, imports nothing) ----------
// This module refuses to know four things: the screen (no node is read or written), the store
// (no storage, no settings record), the clock (no date read, no timer) and the curated content
// tables. The caller passes `now`, the plain progress rows and a `curated` bundle, so the same
// inputs always produce a deep-equal plan and a reducer that is pure in, pure out.
export const SESSION_BLOCKS = [
  { kind: 'warmup', family: 'scaleRun', minutes: 2 },
  { kind: 'focus', family: null, minutes: 3 },
  { kind: 'new', family: null, minutes: 3 },
  { kind: 'play', family: null, minutes: 3 },
  { kind: 'recall', family: null, minutes: 2 },
];

// The fixed family order D-68's template assumes: the warm-up is always a scale run and the
// curated fallbacks walk this list, so a plan can never invent a sixth family.
export const FAMILY_ORDER = ['scaleRun', 'findNote', 'chordChanges', 'progression', 'song'];

// 13 minutes, inside SESS-01's 10-15 band (D-68). The header total, the panel's intro sentence
// and the announcement all print this one number, so the table can never be edited alone.
export const TOTAL_MINUTES = SESSION_BLOCKS.reduce((sum, block) => sum + block.minutes, 0);

const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
const asList = value => (Array.isArray(value) ? value : []);
const pickText = (value, fallback = '') => (typeof value === 'string' && value !== '' ? value : fallback);
const pickKey = (value, fallback = 0) => (Number.isInteger(value) && value >= 0 && value <= 11 ? value : fallback);
const pickMs = value => (Number.isFinite(value) && value > 0 ? value : 0);
const pickInt = value => (Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0);

// The four closed vocabularies `DEFAULT_SETTINGS` already validates. A value outside one of
// them is not a caller choice to honour, it is a value that would be dropped on the way into
// the record, so the curated patch keeps its own.
const DIRECTIONS = ['up', 'down', 'updown'];
const QUIZ_QUESTIONS = ['note', 'degree', 'interval'];
const QUIZ_MODES = ['find', 'name'];
const asText = value => (typeof value === 'string' && value !== '' ? value : undefined);
const asKey = value => (Number.isInteger(value) && value >= 0 && value <= 11 ? value : undefined);
const asClosed = (list, value) => (list.includes(value) ? value : undefined);

// One settings patch per family, assembled from the caller's own bundle. Every key written here
// is one `validateSettings` already owns, so a block's target can only ever be a settings patch
// — never a chart, a runner or a second start path (D-69). An absent or out-of-range caller
// value leaves the curated patch untouched, so a partial `defaults` object still yields five
// complete targets.
export function familyDefaults(defaults = {}, curated = {}) {
  const settings = isRecord(defaults) ? defaults : {};
  const targets = isRecord(curated) && isRecord(curated.targets) ? curated.targets : {};
  const base = family => ({ ...(isRecord(targets[family]) ? targets[family] : {}), drillFamily: family });
  const apply = (patch, fields) => {
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) patch[key] = value;
    }
    return patch;
  };
  const scaleRun = apply(base('scaleRun'), {
    scaleId: asText(settings.scaleId),
    keyPc: asKey(settings.keyPc),
    positionId: asText(settings.positionId),
    direction: asClosed(DIRECTIONS, settings.direction),
  });
  const findNote = apply(base('findNote'), {
    scaleId: asText(settings.scaleId),
    keyPc: asKey(settings.keyPc),
    positionId: asText(settings.positionId),
    quizQuestion: asClosed(QUIZ_QUESTIONS, settings.quizQuestion),
    quizMode: asClosed(QUIZ_MODES, settings.quizMode),
  });
  // The play-along fallback keeps its own key: the approved sentence is `No play-along yet —
  // I–IV–V in C.`, so a fallback that transposed itself would make that sentence a lie.
  return {
    scaleRun,
    findNote,
    chordChanges: base('chordChanges'),
    progression: base('progression'),
    song: base('song'),
  };
}

// D-70's comparator, once. Due or lapsed first (soonest `dueAt` first), then the lower rate — a
// pair's `cleanRate`, a skill's `cleanPasses`, because the stored skill record carries no
// attempt counter (assumption A3) — then the older `lastPlayedAt` with a null first, then the
// content order ascending, so a sort-stability change can never reorder two equal rows.
function rank(a, b) {
  const due = row => (row.state === 'due' || row.state === 'lapsed' ? 0 : 1);
  if (due(a) !== due(b)) return due(a) - due(b);
  const dueAt = row => (Number.isFinite(row.dueAt) ? row.dueAt : Infinity);
  if (dueAt(a) !== dueAt(b)) return dueAt(a) - dueAt(b);
  if (rateOf(a) !== rateOf(b)) return rateOf(a) - rateOf(b);
  if (playedOf(a) !== playedOf(b)) return playedOf(a) - playedOf(b);
  return orderOf(a) - orderOf(b);
}

const rateOf = row => (Number.isFinite(row.cleanRate) ? row.cleanRate
  : (Number.isFinite(row.cleanPasses) ? row.cleanPasses : 0));
const playedOf = row => (Number.isFinite(row.lastPlayedAt) ? row.lastPlayedAt : -Infinity);
const orderOf = row => (Number.isFinite(row.order) ? row.order : 0);

// New material asks a different question — "which recorded skill has waited longest?" — so it
// reads D-70's third key first and the rest of the comparator as its tiebreak. One comment, one
// deliberate reordering, and still a total order.
function oldestFirst(a, b) {
  if (playedOf(a) !== playedOf(b)) return playedOf(a) - playedOf(b);
  if (rateOf(a) !== rateOf(b)) return rateOf(a) - rateOf(b);
  return orderOf(a) - orderOf(b);
}

const bestBy = (rows, compare) => asList(rows).slice().sort(compare)[0] || null;

// A patch with every key it could not fill removed, so a target never carries `undefined` into
// `validateSettings` and two deep-equal targets really are deep-equal.
function cleanPatch(patch) {
  if (!isRecord(patch)) return null;
  const out = { ...patch };
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

// The plan itself: plain rows and a passed-in `now` in, five blocks out. Every candidate set is
// scoped so one due skill cannot fill four slots, and every target is checked through the
// caller's own-key predicate: an id this build no longer ships becomes a `Skipped` row with the
// approved `Unavailable — skipped.` sentence and the session continues (T-05-01).
export function buildSessionPlan({
  due = [], skills = [], pairs = [], defaults = {}, curated = {}, hasHistory = false, now = 0,
} = {}) {
  const dueList = asList(due);
  const skillList = asList(skills);
  const pairList = asList(pairs);
  const bundle = isRecord(curated) ? curated : {};
  const patchFor = familyDefaults(defaults, bundle);
  const owns = isRecord(bundle.owns) ? bundle.owns : {};
  const order = isRecord(bundle.order) ? bundle.order : {};
  const builtAt = Number.isFinite(now) && now > 0 ? now : 0;

  const familyOf = row => (isRecord(row) && FAMILY_ORDER.includes(row.kind) ? row.kind : '');
  const curatedIndex = (family, id) => {
    const list = asList(order[family]);
    const at = list.indexOf(id);
    return at > 0 ? at : 0;
  };
  const idOf = row => {
    const content = isRecord(row.content) ? row.content : {};
    if (row.kind === 'chordChanges') return pickText(content.pairId, pickText(row.pairId));
    if (row.kind === 'progression') return pickText(content.progressionId, pickText(row.progressionId));
    if (row.kind === 'song') return pickText(content.songId, pickText(row.songId));
    return pickText(content.scaleId, pickText(row.scaleId));
  };
  // A row's `order` is its family's place in the fixed list times a thousand plus its own index
  // inside that family's curated order, so the final tiebreak is content order and never the
  // engine's sort stability.
  const decorate = row => ({
    ...row,
    order: FAMILY_ORDER.indexOf(familyOf(row)) * 1000 + curatedIndex(familyOf(row), idOf(row)),
  });
  const decoratePair = row => ({
    ...row,
    order: FAMILY_ORDER.indexOf('chordChanges') * 1000 + curatedIndex('chordChanges', pickText(row.pairId)),
  });

  // One settings patch per skill row, built from the curated patch for that family so an absent
  // field falls back to the curated value rather than to nothing.
  const targetForRow = row => {
    const family = familyOf(row);
    const content = isRecord(row.content) ? row.content : {};
    const patch = { ...patchFor[family], drillFamily: family, tab: 'scales' };
    if (family === 'scaleRun' || family === 'findNote') {
      patch.scaleId = pickText(content.scaleId, patch.scaleId);
      patch.keyPc = pickKey(content.keyPc, patch.keyPc);
      patch.positionId = pickText(content.positionId, patch.positionId);
      if (family === 'findNote') {
        patch.quizQuestion = asClosed(QUIZ_QUESTIONS, content.quizQuestion) || patch.quizQuestion;
        patch.quizMode = asClosed(QUIZ_MODES, content.quizMode) || patch.quizMode;
      }
    } else if (family === 'chordChanges') {
      patch.chordPairId = pickText(content.pairId, patch.chordPairId);
    } else if (family === 'progression') {
      patch.progressionId = pickText(content.progressionId, patch.progressionId);
      patch.keyPc = pickKey(content.keyPc, patch.keyPc);
    } else if (family === 'song') {
      patch.songId = pickText(content.songId, patch.songId);
      patch.songSectionId = typeof content.sectionId === 'string' ? content.sectionId : patch.songSectionId;
      patch.keyPc = pickKey(content.keyPc, patch.keyPc);
    }
    return patch;
  };
  const targetForPair = row => {
    const patch = { ...patchFor.chordChanges, drillFamily: 'chordChanges', tab: 'scales' };
    patch.chordPairId = pickText(row.pairId, patch.chordPairId);
    return patch;
  };
  const buildBlock = (index, family, reasonKey, reasonValues, target) => {
    const template = SESSION_BLOCKS[index];
    const block = {
      index,
      kind: template.kind,
      family,
      minutes: template.minutes,
      reasonKey,
      reasonValues,
      target: cleanPatch(target),
      state: 'pending',
    };
    const guard = owns[family];
    if (typeof guard === 'function' && !guard(block.target)) {
      return { ...block, reasonKey: 'unavailable', reasonValues: {}, target: null, state: 'skipped' };
    }
    return block;
  };
  const skillValues = row => ({
    skillId: pickText(row.skillId),
    kind: familyOf(row),
    content: isRecord(row.content) ? { ...row.content } : {},
  });
  const pairValues = row => ({
    pairId: pickText(row.pairId),
    chords: asList(row.chords).filter(chord => typeof chord === 'string'),
    changesPerMin: Number.isFinite(row.changesPerMin) ? row.changesPerMin : 0,
  });
  const playValues = (family, row, content) => ({
    progressionId: family === 'progression' ? pickText(row.progressionId, pickText(content.progressionId)) : '',
    songId: family === 'song' ? pickText(row.songId, pickText(content.songId)) : '',
    sectionId: family === 'song' ? pickText(content.sectionId) : '',
    keyPc: pickKey(content.keyPc, 0),
  });

  // Block 1, the warm-up: a scale run and nothing else, and its candidate set is the recorded
  // scale runs only, so a due chord pair can never become the warm-up.
  const warmRow = bestBy(skillList.filter(row => familyOf(row) === 'scaleRun').map(decorate), rank);
  const warmTarget = warmRow ? targetForRow(warmRow) : patchFor.scaleRun;
  const blocks = [buildBlock(0, 'scaleRun', 'alwaysFirst', {}, warmTarget)];

  // Block 2, the focus: the first due skill, else the weakest pair, else the curated fallback.
  const focusRow = bestBy(dueList.filter(row => familyOf(row)).map(decorate), rank);
  const focusPairRow = focusRow ? null : bestBy(pairList.filter(row => isRecord(row)).map(decoratePair), rank);
  let focusFamily = 'scaleRun';
  let focusTarget = patchFor.scaleRun;
  let focusReason = 'noHistory';
  let focusValues = {};
  if (focusRow) {
    focusFamily = familyOf(focusRow);
    focusTarget = targetForRow(focusRow);
    focusReason = 'due';
    focusValues = skillValues(focusRow);
  } else if (focusPairRow) {
    focusFamily = 'chordChanges';
    focusTarget = targetForPair(focusPairRow);
    focusReason = 'weakestPair';
    focusValues = pairValues(focusPairRow);
  }
  blocks.push(buildBlock(1, focusFamily, focusReason, focusValues, focusTarget));

  // Block 3, new material: a recorded skill the focus did not already claim, oldest first, else
  // the first curated family neither earlier block used, with the `newToYou` reason.
  const chosenIds = new Set();
  if (focusRow) chosenIds.add(`${familyOf(focusRow)}:${idOf(focusRow)}`);
  const restRows = skillList
    .filter(row => familyOf(row) && !chosenIds.has(`${familyOf(row)}:${idOf(row)}`))
    .map(decorate);
  const newRow = bestBy(restRows, oldestFirst);
  const usedFamilies = new Set(['scaleRun', focusFamily]);
  if (newRow) {
    blocks.push(buildBlock(2, familyOf(newRow), 'leastPlayed', skillValues(newRow), targetForRow(newRow)));
  } else {
    const family = FAMILY_ORDER.find(name => !usedFamilies.has(name)) || FAMILY_ORDER[0];
    const patch = patchFor[family];
    blocks.push(buildBlock(2, family, 'newToYou', { kind: family, content: { ...patch } }, patch));
  }

  // Block 4, the play-along: a due song, else the weakest recorded progression, else the curated
  // `I–IV–V` in C. A due skill of any other family never fills this slot.
  const dueSongRow = bestBy(dueList.filter(row => familyOf(row) === 'song').map(decorate), rank);
  const progRow = bestBy(skillList.filter(row => familyOf(row) === 'progression').map(decorate), rank);
  if (dueSongRow) {
    const content = isRecord(dueSongRow.content) ? dueSongRow.content : {};
    blocks.push(buildBlock(3, 'song', 'dueSong', playValues('song', dueSongRow, content), targetForRow(dueSongRow)));
  } else if (progRow) {
    const content = isRecord(progRow.content) ? progRow.content : {};
    blocks.push(buildBlock(3, 'progression', 'weakestProgression', playValues('progression', progRow, content), targetForRow(progRow)));
  } else {
    blocks.push(buildBlock(3, 'progression', 'noPlayAlong', {}, patchFor.progression));
  }

  // Block 5 reuses the focus task. The composition root recognizes this block's kind
  // and starts a single independent No-lights attempt rather than another guided ramp.
  blocks.push(buildBlock(4, focusFamily, 'recallFocus', {}, { ...focusTarget }));

  return {
    builtAt,
    totalMinutes: TOTAL_MINUTES,
    dueCount: dueList.length,
    noHistory: hasHistory !== true,
    blocks,
  };
}

// A session is never persisted: a reload abandons it and the plan rebuilds from the store. The
// five counters here are the whole state the summary needs besides the plan.
export function emptySession() {
  return {
    state: 'idle',
    plan: null,
    blockIndex: 0,
    completed: 0,
    skipped: 0,
    skillsTouched: [],
    minutesMs: 0,
    unguidedMs: 0,
    startedAt: null,
    endedAt: null,
    nextSuggestionKey: 'nothingDue',
    nextSuggestionValues: {},
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// The session's one next suggestion, in the approved order: the focus skill's own due date while
// one exists (the caller hands over the soonest due row's `dueAt`), else the weakest stored pair,
// else the honest `nothing due`. The three approved sentences are `panels`' business; this module
// answers one key and the raw number behind it, and never invents a score.
export function nextSuggestionOf({ focusDueAt = null, pairs = [], now = 0 } = {}) {
  const at = Number.isFinite(focusDueAt) ? focusDueAt : null;
  const stamp = Number.isFinite(now) ? now : 0;
  if (at !== null && stamp > 0) {
    return { key: 'dueAgain', values: { days: Math.max(0, Math.ceil((at - stamp) / DAY_MS)) } };
  }
  if (asList(pairs).length > 0) return { key: 'weakestPair', values: {} };
  return { key: 'nothingDue', values: {} };
}

// The one after-rep recommendation (D-74, SESS-03): a pure function of the pass that just closed
// and the frozen plan, always exactly one key out of `repeat` / `bpm` / `next` / `stop` — never
// null, never two. `nextBpm` arrives from the caller's own tempo suggestion, so the engine's ±4
// BPM step is never re-derived here, and `nextItem` is the caller's next pending block, else the
// first due row, else the weakest pair.
//
// The `+BPM` mechanism is stated once and lives entirely in `main` (T-05-08): the tempo is carried
// by the two writers that already exist. At a pass review `panels.setPassReview` writes `#bpm`
// through the existing `setTempoSuggestion`, which is the input `nextPass()` reads; at a result
// `main.onTransport('repeat')` saves the recommended tempo before `startDrill()`, so `chartFor()`
// builds the same number a typed tempo would. No second tempo control exists anywhere.
export function suggestionFor({
  pass = null, phase = 'passReview', timed = true, bpm = 0, nextBpm = 0,
  stoppedEarly = false, block = null, elapsedMs = 0, nextItem = null,
} = {}) {
  const record = isRecord(pass) ? pass : {};
  const item = isRecord(nextItem) ? nextItem : null;
  const at = Number.isFinite(bpm) && bpm > 0 ? bpm : 0;
  const suggested = Number.isFinite(nextBpm) && nextBpm > 0 ? nextBpm : at;
  const running = isRecord(block);
  const answer = key => ({ key, bpm: at, nextItem: item });
  // A pass stopped short, and a block that has already spent more than half again its own
  // estimate, both end the rep: the honest answer is `stop here.` and nothing is filled.
  if (stoppedEarly === true || record.stoppedEarly === true) return answer('stop');
  const minutes = running && Number.isFinite(block.minutes) ? block.minutes : 0;
  if (minutes > 0 && Number.isFinite(elapsedMs) && elapsedMs > minutes * 60000 * 1.5) return answer('stop');
  // A block boundary with nothing left to run is the end of the session, so it stops too. A
  // free-choice result always has `Repeat drill` to offer, so it never claims "nothing left".
  if (running && phase === 'result' && item === null) return answer('stop');
  // `+BPM` needs a clean self-report on a timed family and a tempo that can still move: the
  // find-the-note pass is untimed and 240 BPM is the ceiling, and both fall through to `repeat`.
  if (record.selfReport === 'clean' && timed !== false && at > 0 && at < 240 && suggested > at) {
    return { key: 'bpm', bpm: suggested, nextItem: item };
  }
  // `Next drill` needs a next item and a boundary at which leaving this drill makes sense: a
  // block boundary, or a result with no session (the strip then renders its own button, A-75).
  if (item && (running || phase === 'result')) return answer('next');
  return answer('repeat');
}

// The five tiles' values, in the approved order: the recorded minutes, the recorded unguided
// minutes, the store's own streak (the caller reads it, so this module never guesses one), the
// `{done} of 5` token with the skipped count, and the number of distinct skills touched. Every
// slot answers a literal number when nothing ran — never a blank, a `NaN` or a missing key.
export function sessionSummaryOf(state, { streak = 0 } = {}) {
  const base = isRecord(state) ? state : emptySession();
  const total = SESSION_BLOCKS.length;
  const completed = pickInt(base.completed);
  const skipped = pickInt(base.skipped);
  const touched = new Set(asList(base.skillsTouched).filter(id => typeof id === 'string' && id !== ''));
  return {
    minutesMs: pickMs(base.minutesMs),
    unguidedMs: pickMs(base.unguidedMs),
    streak: pickInt(streak),
    completed,
    skipped,
    total,
    skills: touched.size,
    blocks: `${completed} of ${total}`,
  };
}

// The reducer's own copy of the plan. Every block carries an explicit `credited` boolean, which
// is the one gate that stops a block's minutes being counted twice (C1, C2): a second
// `BLOCK_DONE` for a block that already paid is ignored. `doneOnce` is the durable record of "this
// block has completed at least once": `REPEAT` clears the credit gate so the second run's minutes
// accumulate, but it never un-completes the block (CR-01, WR-04).
function copyPlan(plan) {
  if (!isRecord(plan)) return null;
  return {
    ...plan,
    blocks: asList(plan.blocks).map(block => ({
      ...(isRecord(block) ? block : {}),
      credited: isRecord(block) && block.credited === true,
      doneOnce: isRecord(block) && block.doneOnce === true,
    })),
  };
}

// The end of a session: the panel opens itself with the five tiles and one announcement, and the
// last block's result panel stays in the document below — nothing here removes or hides it. The
// clock is only stamped for ordering and never reaches a tile (T-05-04).
function finish(next, effects, event) {
  if (next.state === 'summary') return;
  next.state = 'summary';
  next.endedAt = Number.isFinite(event.now) && event.now > 0 ? event.now : null;
  const suggestion = nextSuggestionOf(isRecord(event.suggestion) ? event.suggestion : {});
  next.nextSuggestionKey = suggestion.key;
  next.nextSuggestionValues = suggestion.values;
  effects.push({ type: 'openPanelAndAnnounce' });
  effects.push({
    type: 'announce',
    key: 'session-complete',
    values: {
      minutes: Math.round(pickMs(next.minutesMs) / 60000),
      unguided: Math.round(pickMs(next.unguidedMs) / 60000),
    },
  });
}

// A `now` block that never reached its result goes back to pending, or to done when an earlier
// run already completed it — never skipped. Shared by START_AT, advance and BLOCK_ABORTED.
function demoteNow(blocks, keep = null) {
  for (const other of blocks) {
    if (other === keep || other.state !== 'now') continue;
    other.state = other.doneOnce === true ? 'done' : 'pending';
    other.credited = other.doneOnce === true;
  }
}

// The one block-advance path, shared by `CONTINUE` and `SKIP`: the first block still `pending`
// becomes `now` and is launched, with the session's one block-start announcement. With nothing
// pending left the session is over, so the same helper finishes it.
function advance(next, effects, event) {
  const blocks = next.plan ? next.plan.blocks : [];
  const index = blocks.findIndex(block => block.state === 'pending');
  if (index < 0) {
    finish(next, effects, event);
    return;
  }
  const block = blocks[index];
  // An unfinished `now` block (a failed or abandoned start) is demoted exactly as START_AT does,
  // so the plan never holds two `now` blocks and the coach never names a stale one (WR-04).
  demoteNow(blocks, block);
  next.completed = blocks.filter(entry => entry.state === 'done').length;
  block.state = 'now';
  block.credited = false;
  next.blockIndex = index;
  effects.push({ type: 'seedAndStart', block: { ...block } });
  effects.push({
    type: 'announce',
    key: 'session-block',
    values: { index: index + 1, total: blocks.length, kind: block.kind },
  });
}

// ---------- Block result + coach script (09-01, TODAY-01/02) ----------
// A local copy of `fade.clampLevel`: this module imports nothing, so the four light levels are
// clamped here rather than borrowed.
const clampLevel = n => Math.max(0, Math.min(3, Number.isFinite(n) ? Math.trunc(n) : 0));
// A credited pass is the only evidence that raises the light level: it played to the end, it was
// not aborted, nobody brightened it and it was reported clean (the drill already forces `shaky`
// when microphone evidence fails). A guided pass is honest practice, never a level change.
const creditedPass = pass => isRecord(pass) && Number.isFinite(pass.completedSteps)
  && Number.isFinite(pass.plannedSteps) && pass.completedSteps >= pass.plannedSteps
  && pass.aborted !== true && pass.brightened !== true && pass.selfReport === 'clean';

// One block's result, classified from the `summarizeDrill` summary `BLOCK_DONE` already carries:
// from-level is where the block started, to-level the darkest level played cleanly (or the start
// level when nothing was), and the outcome is clean, else guided, else stopped, else shaky.
export function blockResultOf(summary) {
  const source = isRecord(summary) ? summary : {};
  const fromLevel = clampLevel(source.startLevel);
  const credited = asList(source.passes).filter(creditedPass);
  const recall = isRecord(source.recall) ? source.recall : {};
  const guided = source.guided === true || recall.guided === true;
  const toLevel = credited.length ? Math.max(...credited.map(pass => clampLevel(pass.hintLevel))) : fromLevel;
  // A block stopped before any pass reached its end was never played through, so it is
  // "stopped early" — not a shaky verdict on playing that never happened (WR-06).
  const passes = asList(source.passes).filter(isRecord);
  const stopped = passes.length > 0 && passes.every(pass => !(Number.isFinite(pass.completedSteps)
    && Number.isFinite(pass.plannedSteps) && pass.completedSteps >= pass.plannedSteps));
  const outcome = credited.length ? 'clean' : guided ? 'guided' : stopped ? 'stopped' : 'shaky';
  return { outcome, fromLevel, toLevel, guided, activeMs: pickMs(source.activeMs), unguidedMs: pickMs(source.unguidedMs) };
}

// Results are ordered by a pure counter, never a clock: the newest result is the highest seq.
const resultSeq = block => (isRecord(block) && isRecord(block.result) && Number.isInteger(block.result.seq) ? block.result.seq : 0);
const nextSeq = blocks => 1 + asList(blocks).reduce((max, block) => Math.max(max, resultSeq(block)), 0);

// The Today coach's lines as message keys only — the sentences are `panels`' business. Idle: the
// day's intro, then the first block with its start level. Running: the newest result, then what
// is under way, what is next or the finish. Summary: one closing line that points at the
// summary (rendered, never announced). `startLevels` and `facts` come from main and are coerced
// here, so a stray value can only drop a detail and never change a line's key.
const countOf = n => (Number.isInteger(n) && n > 0 ? n : 0);
export function coachScript({ session, plan, startLevels = [], facts = {} } = {}) {
  const base = isRecord(session) ? session : emptySession();
  const source = isRecord(plan) ? plan : isRecord(base.plan) ? base.plan : null;
  const blocks = source ? asList(source.blocks) : [];
  if (!blocks.length) return [];
  if (base.state === 'summary') {
    return [{ key: 'allDone', values: { completed: countOf(base.completed), skipped: countOf(base.skipped) } }];
  }
  const levels = asList(startLevels);
  const known = isRecord(facts) ? facts : {};
  const nextLine = index => {
    const block = blocks[index];
    const values = {
      index,
      kind: block.kind,
      reasonKey: block.reasonKey,
      reasonValues: isRecord(block.reasonValues) ? block.reasonValues : {},
    };
    // The level the block will really start at, from main; a missing or odd value is left out.
    const level = levels[index];
    if (Number.isInteger(level) && level >= 0 && level <= 3) values.level = level;
    return { key: 'next', values };
  };
  const pending = blocks.findIndex(block => isRecord(block) && block.state === 'pending');
  if (base.state !== 'running') {
    const intro = {
      key: 'intro',
      values: {
        blocks: blocks.filter(block => isRecord(block) && block.state !== 'skipped').length,
        minutes: countOf(source.totalMinutes),
        due: countOf(known.dueCount),
        streak: countOf(known.streak),
        noHistory: source.noHistory === true,
      },
    };
    return pending < 0 ? [intro] : [intro, nextLine(pending)];
  }
  const lines = [];
  let newest = -1;
  blocks.forEach((block, index) => {
    if (resultSeq(block) > (newest < 0 ? 0 : resultSeq(blocks[newest]))) newest = index;
  });
  if (newest >= 0) {
    const result = blocks[newest].result;
    lines.push({
      key: 'result',
      values: {
        index: newest,
        kind: blocks[newest].kind,
        outcome: typeof result.outcome === 'string' ? result.outcome : 'shaky',
        fromLevel: clampLevel(result.fromLevel),
        toLevel: clampLevel(result.toLevel),
        guided: result.guided === true,
        seq: resultSeq(blocks[newest]),
      },
    });
  }
  const now = blocks.findIndex(block => isRecord(block) && block.state === 'now');
  if (now >= 0) lines.push({ key: 'now', values: { index: now, kind: blocks[now].kind } });
  else if (pending >= 0) lines.push(nextLine(pending));
  else lines.push({ key: 'finish' });
  return lines;
}

// The newest coach line's identity, so main announces it once per change (09-CONTEXT "Announce
// once"): the whole newest line — its key, its block and every value — plus the newest result
// line, whose seq moves on every finished block. So a new result, a repeated block or an idle
// preview whose kind, level or reason moved is heard again, while a re-entry with the same thread
// stays quiet (WR-02). The summary speaks for itself through its own announcement, so it never
// has a signature.
const lineIdentity = line => JSON.stringify([line.key, isRecord(line.values) ? line.values : {}]);
export function coachSignatureOf(lines, state) {
  const list = asList(lines);
  if (state === 'summary' || !list.length) return '';
  const newest = isRecord(list[list.length - 1]) ? list[list.length - 1] : {};
  if (typeof newest.key !== 'string' || !newest.key) return '';
  const result = list.find(line => isRecord(line) && line.key === 'result' && line !== newest);
  return result ? `${lineIdentity(newest)}|${lineIdentity(result)}` : lineIdentity(newest);
}

// `drills.reduce`'s contract exactly: pure, one event in, `{ state, effects }` out, and the
// caller applies the effects. `START` opens the session, `BLOCK_DONE` is the one credit site and
// the four boundary events are the player's four verbs at a block's result.
export function sessionReduce(state, event = {}) {
  const base = isRecord(state) ? state : emptySession();
  const type = isRecord(event) ? event.type : '';
  if (type === 'CLOSE') return { state: emptySession(), effects: [] };

  const effects = [];
  const next = {
    ...base,
    skillsTouched: asList(base.skillsTouched).slice(),
    plan: copyPlan(base.plan),
  };
  const blocks = next.plan ? next.plan.blocks : [];

  if (type === 'START') {
    // One idle session starts one block: a second START is not a second seed.
    if (next.state !== 'idle' || !blocks.length) return { state: next, effects };
    next.state = 'running';
    next.blockIndex = 0;
    next.startedAt = Number.isFinite(event.now) && event.now > 0 ? event.now : null;
    blocks[0].state = 'now';
    effects.push({ type: 'seedAndStart', block: { ...blocks[0] } });
    effects.push({
      type: 'announce',
      key: 'session-ready',
      values: { blocks: blocks.length, minutes: next.plan.totalMinutes },
    });
    return { state: next, effects };
  }

  // `Start` on a plan row (09-01, TODAY-03): any pending block with a target, out of order. From
  // idle it opens the session exactly as START does; between blocks an unfinished `now` block goes
  // back to pending (or to done when it already completed once) — never skipped. Everything else
  // is refused with the state untouched. The block is seeded as itself, so a recall block is still
  // a recall whatever the order, and CONTINUE keeps walking the plan in order afterwards.
  if (type === 'START_AT') {
    const index = isRecord(event) && Number.isInteger(event.index) ? event.index : -1;
    const block = index >= 0 ? blocks[index] : null;
    const open = next.state === 'idle' || next.state === 'running';
    if (!open || !block || block.state !== 'pending' || !isRecord(block.target)) return { state: base, effects: [] };
    const fromIdle = next.state === 'idle';
    if (fromIdle) {
      next.state = 'running';
      next.startedAt = Number.isFinite(event.now) && event.now > 0 ? event.now : null;
    } else {
      demoteNow(blocks);
      next.completed = blocks.filter(entry => entry.state === 'done').length;
    }
    block.state = 'now';
    block.credited = false;
    next.blockIndex = index;
    effects.push({ type: 'seedAndStart', block: { ...block } });
    effects.push(fromIdle
      ? { type: 'announce', key: 'session-ready', values: { blocks: blocks.length, minutes: next.plan.totalMinutes } }
      : { type: 'announce', key: 'session-block', values: { index: index + 1, total: blocks.length, kind: block.kind } });
    return { state: next, effects };
  }

  if (type === 'BLOCK_DONE') {
    const index = Number.isInteger(event.index) ? event.index : next.blockIndex;
    const block = blocks[index];
    if (next.state !== 'running' || !block || block.credited === true) return { state: next, effects };
    const summary = isRecord(event.summary) ? event.summary : {};
    // One credit per block per run: the minutes are the recorded pass time, never wall-clock,
    // and the skill is counted once even when the same skill is repeated inside the block.
    block.credited = true;
    block.doneOnce = true;
    block.state = 'done';
    // The block's result card (09-01): additive, and a Repeat's second run replaces the first.
    block.result = { ...blockResultOf(summary), seq: nextSeq(blocks) };
    next.blockIndex = index;
    // `completed` counts the blocks that are done, so a `Repeat` of the same block re-credits its
    // minutes without ever inflating `{done} of 5` past five.
    next.completed = blocks.filter(entry => entry.state === 'done').length;
    next.minutesMs = pickMs(next.minutesMs) + pickMs(summary.activeMs);
    next.unguidedMs = pickMs(next.unguidedMs) + pickMs(summary.unguidedMs);
    const skillId = pickText(summary.skillId);
    if (skillId && !next.skillsTouched.includes(skillId)) next.skillsTouched.push(skillId);
  }

  // The block's run was abandoned before it could reach a result — a Stop in the first count-in,
  // or a failed start that was then discarded (WR-04). The block is no longer under way, so it
  // goes back to pending (or done, for a Repeat in flight); a credited block is never touched.
  if (type === 'BLOCK_ABORTED') {
    const index = Number.isInteger(event.index) ? event.index : next.blockIndex;
    const block = blocks[index];
    if (next.state !== 'running' || !block || block.state !== 'now' || block.credited === true) {
      return { state: base, effects: [] };
    }
    demoteNow([block]);
    next.completed = blocks.filter(entry => entry.state === 'done').length;
    return { state: next, effects };
  }

  // A No-lights pass reaches its result before the player's self-report, so `BLOCK_DONE` sees it
  // unreported (CR-02). The report is folded in here: the same block's result is re-classified
  // from the reported summary, keeping its seq, and only the unguided minutes the report added
  // are credited — the block's minutes and its credit gate are never paid twice.
  if (type === 'BLOCK_REPORT') {
    const index = Number.isInteger(event.index) ? event.index : next.blockIndex;
    const block = blocks[index];
    if (next.state !== 'running' || !block || !isRecord(block.result) || block.result.outcome === 'skipped') {
      return { state: next, effects };
    }
    const summary = isRecord(event.summary) ? event.summary : {};
    const before = pickMs(block.result.unguidedMs);
    block.result = { ...blockResultOf(summary), seq: block.result.seq };
    next.unguidedMs = Math.max(0, pickMs(next.unguidedMs) + pickMs(block.result.unguidedMs) - before);
  }

  // `Next block`: the first block still pending starts, and a fifth `Next block` with nothing
  // left ends the session rather than leaving it running.
  if (type === 'CONTINUE') {
    if (next.state !== 'running') return { state: next, effects };
    advance(next, effects, event);
  }

  // `Skip` means "do not run this block", never "un-run that" (CR-01). A block that already paid
  // its minutes is `done` and stays done — the Blocks tile can never deny a block the Minutes tile
  // counts — so only a block that has not been credited is reclassified. Both counters are
  // recomputed from the plan either way, so `{done} of 5` and `{skipped} skipped.` always describe
  // five blocks and never the same block twice.
  if (type === 'SKIP') {
    if (next.state !== 'running') return { state: next, effects };
    const block = blocks[next.blockIndex];
    if (!block) return { state: next, effects };
    if (block.state !== 'skipped' && block.state !== 'done') {
      block.state = block.doneOnce === true ? 'done' : 'skipped';
      block.credited = true;
      if (block.state === 'skipped') block.result = { outcome: 'skipped', seq: nextSeq(blocks) };
    }
    next.completed = blocks.filter(entry => entry.state === 'done').length;
    next.skipped = blocks.filter(entry => entry.state === 'skipped').length;
    advance(next, effects, event);
  }

  // `Repeat`: the same block is re-seeded and re-run, and its credit gate is cleared so the
  // minutes of the second run accumulate instead of being dropped by the per-block gate.
  if (type === 'REPEAT') {
    if (next.state !== 'running') return { state: next, effects };
    const block = blocks[next.blockIndex];
    if (!block) return { state: next, effects };
    block.state = 'now';
    block.credited = false;
    effects.push({ type: 'seedAndStart', block: { ...block } });
  }

  // `End session`: every block that never finished is closed out and the session finishes. A block
  // that already paid its minutes completed — a `Repeat` still in flight leaves the block `now`
  // with its first run credited — so it goes back to `done` rather than being called skipped
  // (CR-01, WR-04). Both counters are then recomputed from the plan, once, exactly as `Skip` does,
  // so no block can ever land in both tiles. The run itself is never touched: a pass that ran is
  // already recorded, and the result panel stays in the document below the summary.
  if (type === 'END') {
    for (const block of blocks) {
      if (block.state === 'done' || block.state === 'skipped') continue;
      block.state = block.doneOnce === true ? 'done' : 'skipped';
      block.credited = true;
      if (block.state === 'skipped') block.result = { outcome: 'skipped', seq: nextSeq(blocks) };
    }
    next.completed = blocks.filter(entry => entry.state === 'done').length;
    next.skipped = blocks.filter(entry => entry.state === 'skipped').length;
    finish(next, effects, event);
  }

  return { state: next, effects };
}
