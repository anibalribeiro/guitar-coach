// ---------- Drill engine (family-agnostic) ----------
// A chart is data: steps at absolute beats plus the audio events the transport plays.
// The reducer is pure and returns effect descriptors; only main performs I/O.
import {
  scaleById, chordById, chordPairById, CHORD_PAIRS, CHORD_FAMILIES, progressionById,
} from './content.js';
import { expandChord, expandSongSection, notesForPosition, sequenceFor, voiceChord } from './theory.js';
import { backingEvents } from './backing.js';
import { FADE, anchorNotes, clampLevel, nextLevel, totalPassesFor } from './fade.js';
import { passActiveMs, passIsClean, CLEAN_THRESHOLDS } from './progress.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const announce = key => ({ type: 'announce', key });
const wallAt = event => (Number.isFinite(event.wallAt) ? event.wallAt : null);
const sessionFor = (chart, wall) => (wall === null ? null : chart.id + ':' + wall);
// A drill keeps the identity it was first given. START_FAILED, RESUME and RESTART
// may establish it lazily, but a later transition can never overwrite it (CR-01).
const identityFor = (state, chart, event) => {
  const wall = wallAt(event);
  const startedWall = Number.isFinite(state.drillWallStartedAt) ? state.drillWallStartedAt : wall;
  return {
    drillWallStartedAt: startedWall,
    sessionId: state.sessionId || sessionFor(chart, startedWall),
  };
};
const levelChangeFor = (fromLevel, decision) => ({
  direction: decision.direction,
  fromLevel,
  toLevel: decision.level,
  reasonKey: decision.reasonKey,
});
const passComplete = pass => !!pass && pass.completedSteps >= pass.plannedSteps && !pass.aborted;
// The optional microphone score the composition root computed for the pass that is
// closing. An event without one keeps what the pass already carried, and an explicit
// null (an unscored pass) stamps null, so `0` is never a stand-in for "not measured".
const syncScoreAt = (state, event) => (
  event.syncScore === undefined ? state.syncScore : (event.syncScore || null)
);
function assessmentFor(state, event) {
  const coldRecall = state.chart.coldRecall === true;
  if (state.chart.family === 'findNote') {
    const outcomes = state.questionOutcomes || [];
    const accuracy = state.questions.length ? outcomes.filter(value => value === 'correct').length / state.questions.length : 0;
    return { source: 'quiz', coldRecall, accuracy, medianTimingMs: null, meanAbsMs: null, passed: accuracy === 1 && !outcomes.includes('revealed'), corrected: false };
  }
  const score = syncScoreAt(state, event);
  const accuracy = score && Number.isFinite(score.accuracy) ? score.accuracy : score && Number.isFinite(score.counted) && score.planned > 0 ? score.counted / score.planned : null;
  if (!score || accuracy === null) return { source: 'selfReport', coldRecall, accuracy: null, medianTimingMs: null, meanAbsMs: null, passed: null, corrected: false };
  const timing = score.timing || {};
  const error = Number.isFinite(timing.meanAbsMs) ? timing.meanAbsMs : Number.isFinite(timing.medianMs) ? Math.abs(timing.medianMs) : null;
  return { source: 'microphone', coldRecall, accuracy, medianTimingMs: timing.medianMs, meanAbsMs: error, passed: accuracy >= CLEAN_THRESHOLDS.minAccuracy && (error === null || error <= CLEAN_THRESHOLDS.maxMedianTimingMs), corrected: false, manualHits: Number.isInteger(score.manualHits) && score.manualHits > 0 ? score.manualHits : 0 };
}

function reportPass(pass, event) {
  const assessment = pass.assessment ? { ...pass.assessment } : null;
  if (assessment && assessment.source === 'microphone' && event.corrected === true) assessment.corrected = true;
  const candidate = { ...pass, assessment, selfReport: event.clean === true ? 'clean' : 'shaky' };
  return { ...candidate, selfReport: candidate.selfReport === 'clean' && !passIsClean(candidate) ? 'shaky' : candidate.selfReport };
}

const passMs = pass => (Number.isFinite(pass && pass.activeMs)
  ? Math.max(0, pass.activeMs)
  : passActiveMs(pass.completedSteps, pass.bpm));
const passUnguidedMs = pass => (
  pass.hintLevel === FADE.recallLevel && passComplete(pass) && passIsClean(pass) ? passMs(pass) : 0
);

// A pass keeps the practice time it actually earned (WR-02). A wait-mode pass has no clock,
// so its time is the wall time from its first question to its last answer (A5). A timed
// pass is completed steps × their real beat span: a chord chart's step is a bar, not a
// beat, so the shared one-step-per-beat formula would report a quarter of the minutes.
function activeMsFor(chart, state, completedSteps, event) {
  if (chart.timed === false) {
    const started = Number.isFinite(state.startedAt) ? state.startedAt : null;
    const ended = at(event);
    return started === null || ended === null ? 0 : Math.max(0, Math.round(ended - started));
  }
  const bpm = Number.isFinite(chart.bpm) && chart.bpm > 0 ? chart.bpm : 0;
  if (!bpm) return 0;
  // The step's beat span is the chart's own: exactly 1 for a scale run (one step per beat)
  // and exactly one bar for a chord or play-along chart (one step per bar), so a new family
  // never has to edit this line (Pitfall 1).
  const span = Math.max(0, (Number.isFinite(chart.totalBeats) ? chart.totalBeats : 0)
    - (Number.isFinite(chart.countInBeats) ? chart.countInBeats : 0));
  const beatsPerStep = chart.steps.length && span > 0 ? span / chart.steps.length : 1;
  const steps = Number.isFinite(completedSteps) ? Math.max(0, completedSteps) : 0;
  return Math.round(steps * beatsPerStep * (60000 / bpm));
}

// A chart step carries its own absolute beat, so one family may place a step per beat
// (scale run) and another one per bar (chord changes). Every beat-to-step derivation in
// the engine reads this, never `Math.floor(beat - countInBeats)`.
export function stepIndexFor(chart, beat) {
  const steps = (chart && chart.steps) || [];
  if (chart && chart.timed === false) return 0;
  if (!steps.length || !Number.isFinite(beat)) return 0;
  let lo = 0;
  let hi = steps.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (steps[mid].beat <= beat) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return found;
}

export function buildScaleRunChart(instance = {}) {
  const {
    scaleId = 'major', keyPc = 0, positionId = 'all', direction = 'updown', bpm = 70,
  } = instance;
  const startLevel = clamp(Number.isInteger(instance.startLevel) ? instance.startLevel : 0, 0, 2);
  const scaleDef = scaleById[scaleId] || scaleById.major;
  const key = ((keyPc % 12) + 12) % 12;
  const notes = notesForPosition(key, scaleDef, positionId);
  const sequence = sequenceFor(notes, direction);
  const countInBeats = 4;
  const steps = sequence.map((n, index) => ({
    index,
    beat: countInBeats + index,
    target: { s: n.s, f: n.f, midi: n.midi, iv: n.iv },
  }));
  const totalBeats = countInBeats + steps.length;
  const audioEvents = [];
  for (let beat = 0; beat < totalBeats; beat++) {
    audioEvents.push({ beat, type: 'click', accent: beat % 4 === 0 });
  }
  for (const step of steps) {
    audioEvents.push({ beat: step.beat, type: 'pluck', midi: step.target.midi });
  }
  audioEvents.sort((a, b) => a.beat - b.beat);
  return {
    id: `scaleRun:${scaleDef.id}:${key}:${positionId}`,
    kind: 'scaleRun',
    family: 'scaleRun',
    timed: true,
    bpm,
    beatsPerBar: 4,
    countInBeats,
    direction,
    content: { scaleId: scaleDef.id, keyPc: key, positionId },
    anchorMode: positionId === 'all' ? 'roots' : 'box',
    startLevel,
    steps,
    shape: notes.map(n => ({ s: n.s, f: n.f, midi: n.midi, iv: n.iv })),
    audioEvents,
    totalBeats,
  };
}

export function buildNoteQuizChart(instance = {}) {
  const {
    scaleId = 'major', keyPc = 0, positionId = 'all',
    quizQuestion = 'note', quizMode = 'find', questions = [],
  } = instance;
  const startLevel = clamp(Number.isInteger(instance.startLevel) ? instance.startLevel : 0, 0, 2);
  const scaleDef = scaleById[scaleId] || scaleById.major;
  const key = ((keyPc % 12) + 12) % 12;
  const notes = notesForPosition(key, scaleDef, positionId);
  const list = Array.isArray(questions) ? questions.slice() : [];
  return {
    id: `findNote:${scaleDef.id}:${key}:${positionId}`,
    kind: 'findNote',
    family: 'findNote',
    timed: false,
    bpm: 0,
    beatsPerBar: 4,
    countInBeats: 0,
    totalBeats: 0,
    direction: 'updown',
    content: { scaleId: scaleDef.id, keyPc: key, positionId, quizQuestion, quizMode },
    anchorMode: 'box',
    startLevel,
    questions: list,
    steps: list.map((q, i) => ({ index: i, beat: null, target: q.target })),
    shape: notes.map(n => ({ s: n.s, f: n.f, midi: n.midi, iv: n.iv })),
    audioEvents: [],
  };
}

// One chord per bar: a two-chord pair repeats four times across eight bars, a
// four-chord loop twice. The chord drill never plays the answer, so the chart carries
// clicks only — no pluck events. Every chord resolves through `chordById` (all eleven
// curated pairs are drawn from the eight families) and uses its first voicing.
export function buildChordChangeChart(instance = {}) {
  const { pairId = 'C-G', bpm = 70, bars = 8 } = instance;
  const pair = chordPairById[pairId] || CHORD_PAIRS[0];
  const chords = pair.chords.map(id => chordById[id] || chordById[CHORD_FAMILIES[0].id]);
  const startLevel = clamp(Number.isInteger(instance.startLevel) ? instance.startLevel : 0, 0, 2);
  const countInBeats = 4;
  const barCount = Number.isInteger(bars) && bars > 0 ? bars : 8;
  const steps = [];
  const shape = [];
  const seen = new Set();
  for (let bar = 0; bar < barCount; bar++) {
    const chord = chords[bar % chords.length];
    const voicing = chord.voicings[0];
    const notes = expandChord(voicing);
    for (const note of notes) {
      if (note.muted) continue;
      const key = note.s + ':' + note.f;
      if (seen.has(key)) continue;
      seen.add(key);
      // `iv` is the note's interval above its own chord root, so a root always reads 0
      // and the existing anchor and root filters keep working on the union shape.
      shape.push({ s: note.s, f: note.f, midi: note.midi, iv: ((note.pc - chord.rootPc) % 12 + 12) % 12 });
    }
    const root = notes.find(n => n.root);
    steps.push({
      index: bar,
      beat: countInBeats + bar * 4,
      chordId: chord.id,
      voicingId: voicing.id,
      target: root ? { s: root.s, f: root.f, midi: root.midi, iv: 0 } : null,
    });
  }
  const totalBeats = countInBeats + barCount * 4;
  const audioEvents = [];
  for (let beat = 0; beat < totalBeats; beat++) {
    audioEvents.push({ beat, type: 'click', accent: beat % 4 === 0 });
  }
  // The skill id carries no tempo and no bar count, so a faster rep updates the record.
  return {
    id: `chordChanges:${pair.id}`,
    kind: 'chordChanges',
    family: 'chordChanges',
    timed: true,
    bpm,
    beatsPerBar: 4,
    countInBeats,
    totalBeats,
    bars: barCount,
    pair,
    chords,
    content: { pairId: pair.id, chords: pair.chords },
    anchorMode: 'box',
    startLevel,
    steps,
    shape,
    audioEvents,
  };
}

// A play-along: one step per chart bar plus one ending step, and a `bars` grid that counts
// only the chart's own bars. The invariant is stated once here and relied on everywhere:
// `chart.bars` is the change grid, `steps.length` is `bars + 1`, and the ending bar is a
// step and never a change (Pitfall 2, T-04-09). Every bar resolves its own voicing against
// the chosen key, so a bar that cannot be voiced carries `voicingId: null` and a null
// target instead of a wrong shape. The id names the item and the key only — a tempo or a
// loop window never forks the skill (D-64). A song names its section too, so
// `song:{songId}:{sectionId}:{keyPc}` is the second family's identity and a repeat count or
// a section loop never re-keys it either (T-04-19).
export function buildPlayAlongChart(instance = {}) {
  const {
    family = 'progression', progressionId = '', songId = '', sectionId = '',
    sections: songSections = [], sectionLoop = false,
    keyPc = 0, bpm = 80,
    bars: chartBars = [], meter = [4, 4], startLevel = 0, loopBars = 0, fromBar = 0,
  } = instance;
  const key = ((keyPc % 12) + 12) % 12;
  // One chart, two identities: a song keeps its section and its loop toggle, a progression
  // keeps its loop window. Everything below the identity is shared verbatim.
  const song = family === 'song';
  const beatsPerBar = Array.isArray(meter) && Number.isFinite(meter[0]) && meter[0] > 0 ? meter[0] : 4;
  // A-62: the count-in is one bar of the chart's own meter, so a 3/4 pass counts three.
  const countInBeats = beatsPerBar;
  const level = clamp(Number.isInteger(startLevel) ? startLevel : 0, 0, 2);
  const bars = Array.isArray(chartBars) ? chartBars : [];
  // The loop window is `settings`' own allow-list mirrored here, because drills.js may not
  // import settings.js: `0` is the whole item, `4` and `8` are the two windows a chart can
  // honour, and anything else is ignored rather than trusted (T-04-08).
  const requestedWindow = loopBars === 4 || loopBars === 8 ? loopBars : 0;
  const windowBars = requestedWindow > 0 ? Math.min(requestedWindow, bars.length) : bars.length;
  // `barIndex` is unconstrained by the window length, so this clamp is the only thing
  // between a `4 bars` window opened at bar 10 of the blues and an off-the-end chart
  // (Pitfall 10): the window always ends on the item's last bar.
  const from = requestedWindow > 0
    ? Math.max(0, Math.min(bars.length - windowBars, Number.isInteger(fromBar) ? fromBar : 0))
    : 0;
  const windowed = requestedWindow > 0 ? bars.slice(from, from + windowBars) : bars;
  const chart = {
    id: song
      ? 'song:' + songId + ':' + sectionId + ':' + key
      : 'progression:' + progressionId + ':' + key,
    kind: family,
    family,
    timed: true,
    bpm,
    meter,
    beatsPerBar,
    countInBeats,
    totalBeats: countInBeats,
    // The change grid: the chart's own bars, never the ending step.
    bars: 0,
    // The item's own length, before any loop window: `bars` above is the window this pass
    // plays, so the `Loop` select's A-68 gate needs both numbers to keep an active window
    // visible (CR-02). A window is a choice about a chart, never a smaller chart.
    itemBars: bars.length,
    endingBar: true,
    loop: { fromBar: 0, toBar: 0 },
    content: song
      ? { progressionId: '', songId, sectionId, keyPc: key, loopBars: 0, sectionLoop: !!sectionLoop, meter }
      : { progressionId, songId: '', sectionId: '', keyPc: key, loopBars: requestedWindow, sectionLoop: false, meter },
    // A song carries every one of its sections with the bars each one plays, so the header,
    // the `Section` select and the `Section loop` toggle all read one list (04-03 Task 2).
    // A progression has no sections and carries none.
    sections: song
      ? (Array.isArray(songSections) ? songSections : []).map(entry => ({
        id: typeof entry.id === 'string' ? entry.id : '',
        name: typeof entry.name === 'string' ? entry.name : '',
        repeats: Number.isInteger(entry.repeats) && entry.repeats > 0 ? entry.repeats : 1,
        bars: Number.isInteger(entry.bars) && entry.bars > 0 ? entry.bars : 0,
      }))
      : [],
    anchorMode: 'roots',
    startLevel: level,
    steps: [],
    // An item with no bars has no shape to draw: an empty shape renders an honest empty
    // board rather than the union of chords the pass never plays.
    shape: [],
    audioEvents: [],
  };
  // An item with no bars is a zero-step, zero-event chart, never a throw and never an
  // ending bar with no pass behind it (T-04-08).
  if (!windowed.length) return chart;

  const steps = windowed.map((bar, index) => {
    const voicing = voiceChord(bar.rootPc, bar.quality, instance.voicingId, CHORD_FAMILIES);
    const notes = voicing ? expandChord(voicing).filter(n => !n.muted) : [];
    // `iv` is the note's interval above *this bar's* root, so the L2 anchor is the chord's
    // root and not the key's tonic.
    const cells = notes.map(n => ({
      s: n.s,
      f: n.f,
      midi: n.midi,
      iv: ((n.pc - bar.rootPc) % 12 + 12) % 12,
      // The board's Chord-tab dot language, so a play-along board reads like the chord
      // family's: the finger number, `0` for an open string (04-02 Task 2).
      text: n.open ? '0' : (Number.isInteger(n.finger) ? String(n.finger) : ''),
    }));
    const rootCell = cells.find(n => n.iv === 0) || null;
    return {
      index,
      beat: countInBeats + index * beatsPerBar,
      chordName: bar.name,
      roman: bar.roman,
      rootPc: bar.rootPc,
      quality: bar.quality,
      voicingId: voicing ? voicing.id : null,
      // The bar's own place in its section. `main` resolves the section's bars and stamps
      // each one, and the builder only copies them, so a section boundary is the bar whose
      // `barId` resets — the next-chord column then reads the next section's first chord
      // with no branch of its own (A-52). A progression's bars carry neither.
      sectionId: typeof bar.sectionId === 'string' ? bar.sectionId : '',
      barId: Number.isInteger(bar.barId) ? bar.barId : index,
      ending: false,
      cells,
      target: rootCell ? { s: rootCell.s, f: rootCell.f, midi: rootCell.midi, iv: 0 } : null,
    };
  });
  // The ending bar holds the last chord: same cells and same target, one extra step.
  const last = steps[steps.length - 1];
  steps.push({
    index: steps.length,
    beat: countInBeats + windowed.length * beatsPerBar,
    chordName: last.chordName,
    roman: last.roman,
    rootPc: last.rootPc,
    quality: last.quality,
    voicingId: last.voicingId,
    // The ending belongs to the section that just played: it is the same chord, one bar on.
    sectionId: last.sectionId,
    barId: Number.isInteger(last.barId) ? last.barId + 1 : steps.length,
    ending: true,
    cells: last.cells,
    target: last.target,
  });
  const chords = steps.slice(0, windowed.length).map(step => {
    const root = step.target ? step.target.midi : null;
    return { rootMidi: root, padMidis: step.cells.slice(0, 3).map(n => n.midi) };
  });
  // The idle and result board read the pass as one shape: the union of every cell in the
  // pass, deduped by `s:f`. The active branch overrides the column with the next bar's
  // own chord, so this is the "which strings does this progression touch" answer.
  const shape = [];
  const seenCells = new Set();
  for (const step of steps) {
    for (const entry of step.cells) {
      const key = entry.s + ':' + entry.f;
      if (seenCells.has(key)) continue;
      seenCells.add(key);
      shape.push({ ...entry });
    }
  }
  return {
    ...chart,
    totalBeats: countInBeats + steps.length * beatsPerBar,
    bars: windowed.length,
    // The window the pass actually plays: `fromBar` is where it opens on the item and
    // `toBar` is one past the last bar, so a twelve-bar item reads `{ fromBar: 8, toBar: 12 }`.
    loop: { fromBar: from, toBar: from + windowed.length },
    steps,
    shape,
    audioEvents: backingEvents({
      beatsPerBar, countInBeats, bars: windowed.length, chords,
    }),
  };
}

// How many bars one song section contributes to a pass: its own resolved bars, times its
// repeats, times two when the section loop is on. Repeats are honoured by default, so
// `Verse ×2` is eight bars with the loop off and sixteen with it on (A5's reading of D-60).
// The UI-SPEC's other parenthetical — `a single-section song shows Verse ×2` — reads the
// same number, so if the product ever wants the loop to replace the repeats rather than add
// to them, this function is the one multiplication to change.
//
// `unitBars` is the section's bar count **after** `expandSongSection`, and every caller
// passes it: `content.js` documents a second section shape that carries `progressionId`
// instead of inline `degrees` (`theory.js` expands it to the progression's bars), and such a
// section has no `degrees` of its own. Without `unitBars` it would count zero bars, hand
// `chartFor` an empty bar list and divide by `Math.max(1, 0)` there — a silent empty pass.
export function songSectionBars(section, { sectionLoop = false, unitBars = null } = {}) {
  const source = section && typeof section === 'object' ? section : {};
  const resolved = Number.isInteger(unitBars) && unitBars > 0
    ? unitBars
    : (Array.isArray(source.degrees) ? source.degrees.length : 0);
  // A missing, fractional or zero repeat count is one repeat: the curated content never
  // stores anything else, and a crafted record must not multiply a pass (T-04-16, T-04-20).
  const repeats = Number.isInteger(source.repeats) && source.repeats > 0 ? source.repeats : 1;
  return resolved * repeats * (sectionLoop ? 2 : 1);
}

// The browse bar lands in one of the song's own sections. The browse grid renders each
// section **once** — a repeat is a badge (`Verse ×2`), not more bars — so the walk measures
// every section by its **unit** length. Walking it with `songSectionBars` multiplied by
// `repeats` put the bar in a bigger space than the grid it indexes, so the Songs tab's `Play`
// seeded a different section from the one the player was looking at (CR-03, D-59/A-55). This
// is the one place the seed turns `settings.barIndex` into a section id, so the browse chart
// and `Play` cannot disagree about which section a bar belongs to.
export function sectionAtBar(song, barIndex, keyPc, progressions = progressionById) {
  const sections = song && Array.isArray(song.sections) ? song.sections : [];
  if (!sections.length) return null;
  const index = Number.isInteger(barIndex) ? Math.max(0, barIndex) : 0;
  let start = 0;
  for (const section of sections) {
    const bars = Math.max(0, expandSongSection(song, section, keyPc, progressions).length);
    if (index < start + bars) return section;
    start += bars;
  }
  return sections[sections.length - 1];
}

// A fresh change record per pass: the bar count is fixed here, never derived later.
// `onsetCounted` flips the first time the mic seam accepts an onset, which makes the
// manual count inert for the rest of the pass (one bar, one outcome, one counter).
const freshChanges = chart => ({
  planned: chart.bars,
  counted: 0,
  clean: 0,
  missed: 0,
  perBar: [],
  onsetCounted: false,
  rootsOnPitch: 0,
  rootsChecked: 0,
});

// The chord-change window, in milliseconds either side of the bar line. A strum is
// human: the early edge is small (the hand arrives just before the click) and the late
// edge generous, but a strum in the middle of the bar is not a change onto the next chord.
export const CHANGE_WINDOW = { beforeMs: 60, afterMs: 300 };

// The play-along families: the two 04-02 and 04-03 build, named in the wave that consumes
// the predicate. `main.applyAudioMix` is its first reader, so a later wave adds the charts
// that make it match instead of inventing a second family list of its own.
export const PLAY_FAMILIES = new Set(['progression', 'song']);

// The change families: every chart with a bar grid and a per-bar change record. One
// predicate is what keeps the Phase 3 chord machinery — the record, the two onset paths,
// the screen column, the idle preview and the score — from being copied per family. A
// family joins the chord drill's behaviour by joining this set, nowhere else.
export const CHART_CHANGES = new Set(['chordChanges', 'progression', 'song']);

// The pass record, closed at the boundary: an unmarked bar is missed and the rate is
// clean changes per minute of bars. Eight clean bars at 80 BPM in 4/4 is 20 changes/min.
function finalizeChanges(chart, changes, reached = null) {
  if (!changes) return null;
  const planned = Number.isFinite(changes.planned) && changes.planned > 0
    ? changes.planned
    : chart.steps.length;
  const reachedBars = Number.isFinite(reached)
    ? Math.max(0, Math.min(planned, Math.round(reached)))
    : planned;
  const perBar = Array.from({ length: planned }, (_, bar) => (changes.perBar[bar] === 'clean' ? 'clean' : 'missed'));
  const clean = perBar.filter(outcome => outcome === 'clean').length;
  const beatsPerBar = Number.isFinite(chart.beatsPerBar) && chart.beatsPerBar > 0 ? chart.beatsPerBar : 4;
  const bpm = Number.isFinite(chart.bpm) ? chart.bpm : 0;
  return {
    ...changes,
    planned,
    // The bars the pass actually reached. A stopped drill folds only this movement into its
    // pair row, so an abandoned two-bar attempt cannot depress the pair's rate (WR-07).
    reached: reachedBars,
    clean,
    missed: planned - clean,
    counted: Number.isFinite(changes.counted) ? changes.counted : clean,
    changesPerMin: bpm > 0 && reachedBars > 0
      ? Math.round((clean * bpm) / (reachedBars * beatsPerBar))
      : 0,
  };
}

export function createRun(chart) {
  const hintLevel = clampLevel(chart.startLevel === undefined ? 0 : chart.startLevel);
  return {
    chart,
    phase: 'idle',
    beat: 0,
    stepIndex: 0,
    pausedBeat: null,
    pauseReason: null,
    resumeFromBeat: chart.countInBeats,
    activeStartBeat: chart.countInBeats,
    selfReport: null,
    startedAt: null,
    endedAt: null,
    completed: false,
    stoppedEarly: false,
    hintLevel,
    startLevel: hintLevel,
    plan: { passIndex: 1, totalPasses: totalPassesFor(1, hintLevel) },
    passes: [],
    levelChange: { direction: 'start', fromLevel: hintLevel, toLevel: hintLevel, reasonKey: 'start' },
    // The boundary decision is computed once, when the pass closes, and consumed by
    // NEXT_PASS; recomputing it from already-advanced streaks decided a pass twice
    // whenever a later count-in returned to the same review (CR-04).
    pendingDecision: null,
    cleanStreak: 0,
    failStreak: 0,
    // The quiz plan lives on the run as a copy of the chart's questions. It is never an
    // empty literal: NEXT_QUESTION ends the pass at questions.length and the summary
    // derives its counts from this array.
    questions: (chart.questions || []).slice(),
    questionIndex: 0,
    questionOutcomes: [],
    // The chord-change pass record. One outcome per bar, seeded with the bar count the
    // chart planned; every other family carries null so no metric is invented for it.
    changes: CHART_CHANGES.has(chart.family) ? freshChanges(chart) : null,
    pair: null,
    syncScore: null,
    // The scale-run override (A-43): the step indices the player marked by hand during
    // this pass. Every other family carries an empty list, never a second counter.
    markedHits: [],
    recall: { attempted: false, completed: false, selfReport: null, bpm: chart.bpm },
    flashUntilBeat: 0,
    drillStartedAt: null,
    drillWallStartedAt: null,
    drillWallEndedAt: null,
    sessionId: null,
  };
}

const at = event => (Number.isFinite(event.at) ? event.at : null);

// The last bar that still contains a step. A pause recorded at or past the final
// beat would build a resume segment that is already finished, and FINISH is illegal
// from count-in, so the run would stick there forever (WR-02).
function lastBarStart(chart) {
  const bar = Math.floor((chart.totalBeats - 1) / chart.beatsPerBar) * chart.beatsPerBar;
  return Math.max(chart.countInBeats, bar);
}

function resumeBeatFor(chart, beat) {
  if (!Number.isFinite(beat) || beat < chart.countInBeats) return chart.countInBeats;
  return Math.min(Math.floor(beat / chart.beatsPerBar) * chart.beatsPerBar, lastBarStart(chart));
}

// idle -> countIn -> active -> paused <-> countIn ... -> result. Illegal events
// are ignored without throwing so a late visibility or GATT event cannot stick.
export function reduce(state, event = {}) {
  const effects = [];
  const chart = state.chart;
  let next = state;

  switch (event.type) {
    case 'START':
      if (state.phase !== 'idle') break;
      next = {
        ...state,
        // A wait-mode chart has no clock: START enters the drill and asks question 1.
        phase: chart.timed === false ? 'active' : 'countIn',
        beat: 0,
        stepIndex: 0,
        questionIndex: 0,
        questionOutcomes: [],
        pausedBeat: null,
        pauseReason: null,
        resumeFromBeat: chart.countInBeats,
        activeStartBeat: chart.countInBeats,
        selfReport: null,
        startedAt: at(event),
        endedAt: null,
        completed: false,
        stoppedEarly: false,
        drillStartedAt: at(event),
        drillWallStartedAt: wallAt(event),
        drillWallEndedAt: null,
        sessionId: sessionFor(chart, wallAt(event)),
      };
      if (chart.timed === false) effects.push(announce('question'));
      else effects.push({ type: 'startTransport' }, announce('count-in'));
      break;

    case 'START_FAILED':
      // Legal from idle only: the run never starts, but the transport is not asked
      // to start and Resume stays the visible next action. Identity is seeded here
      // too, or the whole drill would reach the result without a session (CR-01).
      if (state.phase !== 'idle') break;
      next = {
        ...state,
        phase: 'paused',
        pausedBeat: 0,
        pauseReason: 'audio',
        resumeFromBeat: chart.countInBeats,
        activeStartBeat: chart.countInBeats,
        drillStartedAt: at(event),
        drillWallEndedAt: null,
        ...identityFor(state, chart, event),
      };
      effects.push({ type: 'holdLeds' }, announce('paused-audio'));
      break;

    case 'TICK': {
      if (state.phase !== 'countIn' && state.phase !== 'active') break;
      const beat = Number.isFinite(event.beat) ? event.beat : state.beat;
      const stepIndex = clamp(stepIndexFor(chart, beat), 0, Math.max(0, chart.steps.length - 1));
      next = {
        ...state,
        beat,
        stepIndex: state.phase === 'countIn' ? 0 : stepIndex,
        phase: state.phase === 'countIn' && beat >= state.activeStartBeat ? 'active' : state.phase,
      };
      break;
    }

    case 'ANSWER': {
      // One answer per question: an answered or revealed question can never be
      // overwritten by a second tap, a stray chip or a late detection (T-03-01).
      if (state.phase !== 'active' || chart.timed !== false) break;
      const index = Number.isInteger(event.index) ? event.index : state.questionIndex;
      const questions = state.questions || [];
      if (index < 0 || index >= questions.length) break;
      const outcomes = state.questionOutcomes || [];
      if (outcomes[index]) break;
      const stamped = outcomes.slice();
      stamped[index] = event.correct === true ? 'correct' : 'wrong';
      next = { ...state, questionOutcomes: stamped };
      break;
    }

    case 'REVEAL': {
      if (state.phase !== 'active' || chart.timed !== false) break;
      const index = Number.isInteger(event.index) ? event.index : state.questionIndex;
      const questions = state.questions || [];
      if (index < 0 || index >= questions.length) break;
      const outcomes = state.questionOutcomes || [];
      if (outcomes[index]) break;
      const stamped = outcomes.slice();
      stamped[index] = 'revealed';
      next = { ...state, questionOutcomes: stamped };
      break;
    }

    case 'NEXT_QUESTION': {
      if (state.phase !== 'active' || chart.timed !== false) break;
      const questions = state.questions || [];
      const index = state.questionIndex;
      if (!(state.questionOutcomes || [])[index]) break;
      const nextIndex = index + 1;
      if (nextIndex >= questions.length) {
        // The twelfth answer closes the pass through exactly the FINISH path. The score the
        // composition root computed for this closing pass rides the closing event, or the
        // quiz would drop its microphone evidence on its only normal exit (CR-04).
        const finished = reduce(state, {
          type: 'FINISH', at: event.at, wallAt: event.wallAt, syncScore: event.syncScore,
        });
        next = finished.state;
        effects.push(...finished.effects);
        break;
      }
      next = { ...state, questionIndex: nextIndex, stepIndex: nextIndex };
      effects.push(announce('question'));
      break;
    }

    case 'MARK_HIT': {
      // A-43: the manual override for a false negative. The guard is phase plus family —
      // never "a listening window is open": the stream state lives in the mic adapter and
      // a reducer that took it would be a second source of truth (T-03-13). One press
      // credits the step the clock is on, a second press on the same step is ignored, and
      // no effect is emitted.
      if (state.phase !== 'active' || chart.family !== 'scaleRun') break;
      const lastStep = Math.max(0, chart.steps.length - 1);
      const currentBeat = Number.isFinite(event.beat) ? event.beat : state.beat;
      const step = clamp(stepIndexFor(chart, currentBeat), 0, lastStep);
      const markedHits = Array.isArray(state.markedHits) ? state.markedHits.slice() : [];
      if (markedHits.includes(step)) break;
      markedHits.push(step);
      next = { ...state, markedHits };
      break;
    }

    case 'MARK_CHANGE': {
      // The manual count: one press in a bar marks that bar clean; zero presses leave it
      // to be missed; a second press in the same bar is ignored, so a double tap can
      // never inflate the score (T-03-09). No effect is emitted.
      if (state.phase !== 'active' || !CHART_CHANGES.has(chart.family) || !state.changes) break;
      // The mic is the count once it has heard a change: two counters would double-count.
      if (state.changes.onsetCounted) break;
      // The change grid is `chart.bars`: the ending bar is a step and never a change.
      const lastBar = Math.max(0, (Number.isInteger(chart.bars) ? chart.bars : chart.steps.length) - 1);
      const currentBeat = Number.isFinite(state.beat) ? state.beat : 0;
      const bar = Number.isInteger(event.bar)
        ? clamp(event.bar, 0, lastBar)
        : clamp(stepIndexFor(chart, currentBeat), 0, lastBar);
      const perBar = Array.isArray(state.changes.perBar) ? state.changes.perBar.slice() : [];
      if (perBar[bar]) break;
      perBar[bar] = 'clean';
      next = { ...state, changes: { ...state.changes, perBar, counted: state.changes.counted + 1 } };
      break;
    }

    case 'CHANGE_ONSET': {
      // The onset counting seam, not the microphone: 03-03 is the only caller. A strum
      // inside the bar's change window marks that bar clean; the same bar can never count
      // twice, so a re-triggered onset is ignored exactly like a double press. The bar
      // start is the click the player heard, `calibrationMs` subtracted from the reading,
      // and the window is `CHANGE_WINDOW` either side of it.
      if (state.phase !== 'active' || !CHART_CHANGES.has(chart.family) || !state.changes) break;
      if (!Number.isFinite(event.atMs)) break;
      const bpm = Number.isFinite(chart.bpm) && chart.bpm > 0 ? chart.bpm : 0;
      if (bpm <= 0) break;
      // The change grid is `chart.bars`: a strum in the ending bar never marks a change.
      const lastBar = Math.max(0, (Number.isInteger(chart.bars) ? chart.bars : chart.steps.length) - 1);
      const currentBeat = Number.isFinite(state.beat) ? state.beat : 0;
      const bar = Number.isInteger(event.bar)
        ? clamp(event.bar, 0, lastBar)
        : clamp(stepIndexFor(chart, currentBeat), 0, lastBar);
      const perBar = Array.isArray(state.changes.perBar) ? state.changes.perBar.slice() : [];
      if (perBar[bar]) break;
      const beatsPerBar = Number.isFinite(chart.beatsPerBar) && chart.beatsPerBar > 0 ? chart.beatsPerBar : 4;
      const countIn = Number.isFinite(chart.countInBeats) ? chart.countInBeats : 0;
      const barStartMs = ((countIn + bar * beatsPerBar) * 60000) / bpm;
      const calibration = Number.isFinite(event.calibrationMs) ? event.calibrationMs : 0;
      const correctedMs = event.atMs - calibration;
      if (correctedMs < barStartMs - CHANGE_WINDOW.beforeMs) break;
      if (correctedMs > barStartMs + CHANGE_WINDOW.afterMs) break;
      perBar[bar] = 'clean';
      // The expected root is the only pitch claim the chord family makes. A root that
      // cannot be read is checked but never on pitch, and never a failure (D-46).
      const expectedRootPc = Number.isFinite(event.expectedRootPc)
        ? ((event.expectedRootPc % 12) + 12) % 12
        : null;
      let rootsChecked = Number.isFinite(state.changes.rootsChecked) ? state.changes.rootsChecked : 0;
      let rootsOnPitch = Number.isFinite(state.changes.rootsOnPitch) ? state.changes.rootsOnPitch : 0;
      if (expectedRootPc !== null && Number.isFinite(event.midi)) {
        rootsChecked += 1;
        if (((Math.round(event.midi) % 12) + 12) % 12 === expectedRootPc) {
          rootsOnPitch += 1;
        }
      }
      next = {
        ...state,
        changes: {
          ...state.changes,
          perBar,
          counted: state.changes.counted + 1,
          onsetCounted: true,
          rootsChecked,
          rootsOnPitch,
        },
      };
      break;
    }

    case 'PAUSE': {
      if (state.phase !== 'countIn' && state.phase !== 'active') break;
      const reason = event.reason || 'hidden';
      const timed = chart.timed !== false;
      const pausedBeat = timed && Number.isFinite(event.beat) ? event.beat : (timed ? state.beat : 0);
      next = {
        ...state,
        phase: 'paused',
        pausedBeat,
        pauseReason: reason,
        resumeFromBeat: timed ? resumeBeatFor(chart, pausedBeat) : 0,
        stepIndex: timed
          ? clamp(stepIndexFor(chart, pausedBeat), 0, Math.max(0, chart.steps.length - 1))
          : state.stepIndex,
        flashUntilBeat: 0,
      };
      effects.push({ type: 'pauseTransport' }, { type: 'holdLeds' }, announce('paused-' + reason));
      break;
    }

    case 'RESUME': {
      if (state.phase !== 'paused') break;
      const timed = chart.timed !== false;
      next = {
        ...state,
        phase: timed ? 'countIn' : 'active',
        beat: timed ? Math.max(0, state.resumeFromBeat - chart.countInBeats) : 0,
        stepIndex: timed
          ? clamp(stepIndexFor(chart, state.resumeFromBeat), 0, Math.max(0, chart.steps.length - 1))
          : state.stepIndex,
        pausedBeat: null,
        pauseReason: null,
        activeStartBeat: state.resumeFromBeat,
        flashUntilBeat: 0,
        ...identityFor(state, chart, event),
      };
      if (timed) effects.push({ type: 'startTransport' }, announce('count-in'));
      else effects.push(announce('question'));
      break;
    }

    case 'RESTART': {
      if (state.phase !== 'countIn' && state.phase !== 'active' && state.phase !== 'paused') break;
      // Restart the current pass only: the ladder, the pass records and the drill
      // clock survive, so a restart can never rewind the fade. On a wait chart it
      // returns to question 1 of the same pass.
      const timed = chart.timed !== false;
      next = {
        ...state,
        phase: timed ? 'countIn' : 'active',
        beat: 0,
        stepIndex: 0,
        questionIndex: 0,
        questionOutcomes: [],
        selfReport: null,
        pausedBeat: null,
        pauseReason: null,
        resumeFromBeat: chart.countInBeats,
        activeStartBeat: chart.countInBeats,
        // Restart restarts the current pass, so its change record restarts with it.
        changes: CHART_CHANGES.has(chart.family) ? freshChanges(chart) : state.changes,
        // A replayed pass carries no score and no manual marks from the abandoned one.
        syncScore: null,
        markedHits: [],
        startedAt: at(event),
        endedAt: null,
        completed: false,
        stoppedEarly: false,
        drillWallEndedAt: null,
        flashUntilBeat: 0,
        ...identityFor(state, chart, event),
      };
      if (timed) effects.push({ type: 'startTransport' }, announce('count-in'));
      else effects.push(announce('question'));
      break;
    }

    case 'STOP':
      if (state.phase === 'countIn') {
        if (state.plan && state.plan.passIndex > 1) {
          // A later count-in follows an already-decided boundary. Re-opening that
          // review would advertise the cancelled pass as complete (WR-02) and let the
          // same decision be applied twice (CR-04); Stop ends the drill with the
          // completed passes intact instead.
          next = {
            ...state,
            phase: 'result',
            pauseReason: null,
            pausedBeat: null,
            completed: false,
            stoppedEarly: true,
            endedAt: at(event),
            drillWallEndedAt: wallAt(event),
            changes: finalizeChanges(chart, state.changes, 0),
            syncScore: syncScoreAt(state, event),
            flashUntilBeat: 0,
          };
          effects.push({ type: 'stopTransport' }, { type: 'zeroLeds' }, announce('result-stopped'));
        } else {
          next = createRun(chart);
          effects.push({ type: 'stopTransport' }, { type: 'zeroLeds' }, announce('idle'));
        }
      } else if (state.phase === 'active' || state.phase === 'paused') {
        // The in-flight pass is recorded as a partial so its active time reaches the
        // session; it is never a completed pass or mastery evidence (D-38).
        const currentBeat = state.phase === 'paused' && Number.isFinite(state.pausedBeat)
          ? state.pausedBeat
          : state.beat;
        const completedSteps = chart.timed === false
          ? Math.max(0, Math.min(chart.steps.length, state.stepIndex))
          : Math.max(0, Math.min(chart.steps.length, stepIndexFor(chart, currentBeat)));
        const pass = {
          index: state.plan.passIndex,
          hintLevel: state.hintLevel,
          bpm: chart.bpm,
          completedSteps,
          plannedSteps: chart.steps.length,
          selfReport: null,
          unguidedMs: 0,
          aborted: false,
          reasonKey: null,
          // The practice time this pass actually earned (WR-02).
          activeMs: activeMsFor(chart, state, completedSteps, event),
        };
        const wasRecall = state.hintLevel === FADE.recallLevel;
        next = {
          ...state,
          phase: 'result',
          pauseReason: null,
          pausedBeat: null,
          completed: false,
          stoppedEarly: true,
          endedAt: at(event),
          drillWallEndedAt: wallAt(event),
          passes: [...state.passes, pass],
          recall: wasRecall
            ? { attempted: true, completed: false, selfReport: null, bpm: chart.bpm }
            : state.recall,
          changes: finalizeChanges(chart, state.changes, completedSteps),
          syncScore: syncScoreAt(state, event),
          flashUntilBeat: 0,
        };
        effects.push({ type: 'stopTransport' }, { type: 'zeroLeds' }, announce('result-stopped'));
      }
      break;

    case 'FINISH': {
      if (state.phase !== 'active') break;
      // A pass is complete iff every planned step ran and it was not aborted; there
      // is no separate completed flag on the record.
      const plannedSteps = chart.steps.length;
      const pass = {
        index: state.plan.passIndex,
        hintLevel: state.hintLevel,
        bpm: chart.bpm,
        completedSteps: plannedSteps,
        plannedSteps,
        selfReport: null,
        assessment: assessmentFor(state, event),
        unguidedMs: 0,
        aborted: false,
        reasonKey: null,
        // A completed pass earned the whole chart's time, in the chart's own step span.
        activeMs: activeMsFor(chart, state, plannedSteps, event),
      };
      if (state.hintLevel === FADE.recallLevel) {
        // The mandatory no-light recall pass closes the drill; there is no review
        // after it, only the result and its self-report (FADE-03/D-25).
        next = {
          ...state,
          phase: 'result',
          stepIndex: plannedSteps,
          pauseReason: null,
          pausedBeat: null,
          completed: true,
          stoppedEarly: false,
          selfReport: null,
          endedAt: at(event),
          drillWallEndedAt: wallAt(event),
          passes: [...state.passes, pass],
          recall: { attempted: true, completed: true, selfReport: null, bpm: chart.bpm },
          changes: finalizeChanges(chart, state.changes, plannedSteps),
          syncScore: syncScoreAt(state, event),
          flashUntilBeat: 0,
        };
        effects.push({ type: 'stopTransport' }, { type: 'zeroLeds' }, announce('result-complete'));
        break;
      }
      const pending = nextLevel(
        { level: state.hintLevel, cleanStreak: state.cleanStreak, failStreak: state.failStreak },
        { hintLevel: state.hintLevel, completed: true, aborted: false, selfReport: null },
      );
      next = {
        ...state,
        phase: 'passReview',
        stepIndex: plannedSteps,
        pauseReason: null,
        pausedBeat: null,
        completed: false,
        stoppedEarly: false,
        selfReport: null,
        drillWallEndedAt: wallAt(event),
        passes: [...state.passes, pass],
        levelChange: levelChangeFor(state.hintLevel, pending),
        pendingDecision: { ...pending, fromLevel: state.hintLevel },
        changes: finalizeChanges(chart, state.changes, plannedSteps),
        syncScore: syncScoreAt(state, event),
        flashUntilBeat: 0,
      };
      effects.push({ type: 'stopTransport' }, { type: 'zeroLeds' }, announce('pass-review'));
      break;
    }

    case 'NEXT_PASS': {
      if (state.phase !== 'passReview') break;
      // The tempo is a between-reps property (CHORD-05, A-38): the event may carry the
      // number the player confirmed at the boundary, clamped to the tempo plane's range.
      // `nextChart` is the only chart every reference below reads, so a tempo change
      // rebuilds the pass here and `main` never swaps a chart behind the reducer.
      // The event may also carry a whole rebuilt chart: a play-along's window, item or key
      // is chosen at the boundary and rebuilt by the same `chartFor()` the drill start uses,
      // so the next pass adopts it wholesale and only the tempo is clamped (Open Question 4).
      const adopted = event.chart && typeof event.chart === 'object' && !Array.isArray(event.chart)
        ? event.chart
        : chart;
      const nextBpm = Number.isFinite(event.bpm)
        ? clamp(Math.round(event.bpm), 30, 240)
        : (Number.isFinite(adopted.bpm) ? adopted.bpm : chart.bpm);
      const nextChart = nextBpm === adopted.bpm ? adopted : { ...adopted, bpm: nextBpm };
      const last = state.passes.length ? state.passes[state.passes.length - 1] : null;
      // A stored decision is only valid for the level that produced it; a hand-built
      // review state with a different level falls back to a fresh computation.
      const stored = state.pendingDecision && state.pendingDecision.fromLevel === state.hintLevel
        ? state.pendingDecision
        : null;
      const decision = stored || nextLevel(
        { level: state.hintLevel, cleanStreak: state.cleanStreak, failStreak: state.failStreak },
        { hintLevel: state.hintLevel, completed: true, aborted: false, selfReport: last ? last.selfReport : null },
      );
      // Consume the decision computed at the boundary. Hand-built legacy states
      // without one keep the old levelChange preference; a real drill never does.
      const hintLevel = clampLevel(stored
        ? decision.level
        : (state.levelChange && Number.isInteger(state.levelChange.toLevel)
          ? state.levelChange.toLevel
          : decision.level));
      const passIndex = (state.plan ? state.plan.passIndex : 1) + 1;
      const timed = chart.timed !== false;
      next = {
        ...state,
        chart: nextChart,
        phase: timed ? 'countIn' : 'active',
        hintLevel,
        plan: { passIndex, totalPasses: totalPassesFor(passIndex, hintLevel, decision.cleanStreak) },
        cleanStreak: decision.cleanStreak,
        failStreak: decision.failStreak,
        pendingDecision: { ...decision, fromLevel: state.hintLevel },
        recall: {
          attempted: hintLevel === FADE.recallLevel,
          completed: false,
          selfReport: null,
          bpm: nextChart.bpm,
        },
        selfReport: null,
        beat: 0,
        stepIndex: 0,
        questionIndex: 0,
        questionOutcomes: [],
        questions: (nextChart.questions || []).slice(),
        // Every new pass starts a fresh change record, including the one after NEXT_PASS,
        // and it is seeded from the rebuilt chart so its bar grid matches the new tempo.
        changes: CHART_CHANGES.has(nextChart.family) ? freshChanges(nextChart) : state.changes,
        // And a fresh score: the last pass's evidence never rides into the next one.
        syncScore: null,
        markedHits: [],
        pausedBeat: null,
        pauseReason: null,
        resumeFromBeat: nextChart.countInBeats,
        activeStartBeat: nextChart.countInBeats,
        flashUntilBeat: 0,
        drillWallEndedAt: null,
      };
      if (timed) effects.push({ type: 'startTransport' }, announce('pass-start'));
      else effects.push(announce('question'));
      break;
    }

    case 'END_DRILL':
      if (state.phase !== 'passReview') break;
      next = {
        ...state,
        phase: 'result',
        pauseReason: null,
        pausedBeat: null,
        completed: false,
        stoppedEarly: true,
        endedAt: at(event),
        drillWallEndedAt: wallAt(event),
        flashUntilBeat: 0,
      };
      effects.push({ type: 'stopTransport' }, { type: 'zeroLeds' }, announce('result-stopped'));
      break;

    case 'ABORT_PASS': {
      // Asking for a hint never changes the lit set mid-phrase: the pass ends, is
      // recorded as aborted and a fresh count-in starts one level lower (D-24).
      if (state.phase !== 'countIn' && state.phase !== 'active' && state.phase !== 'paused') break;
      if (state.hintLevel <= 0) break;
      const currentBeat = Number.isFinite(event.beat)
        ? event.beat
        : (state.phase === 'paused' && Number.isFinite(state.pausedBeat) ? state.pausedBeat : state.beat);
      const completedSteps = chart.timed === false
        ? Math.max(0, Math.min(chart.steps.length, state.stepIndex))
        : Math.max(0, Math.min(chart.steps.length, stepIndexFor(chart, currentBeat)));
      const fromLevel = state.hintLevel;
      const toLevel = clampLevel(fromLevel - 1);
      const pass = {
        index: state.plan.passIndex,
        hintLevel: fromLevel,
        bpm: chart.bpm,
        completedSteps,
        plannedSteps: chart.steps.length,
        selfReport: null,
        unguidedMs: 0,
        aborted: true,
        reasonKey: 'asked',
        // The minutes the abandoned pass did play still count as practice (WR-02).
        activeMs: activeMsFor(chart, state, completedSteps, event),
      };
      const passIndex = state.plan.passIndex + 1;
      const wasRecall = fromLevel === FADE.recallLevel;
      // A wait chart has no count-in and no transport: the new pass asks question one
      // immediately, and the abandoned pass's questions are dropped with its outcomes
      // (WR-01). A timed chart keeps the count-in and the transport restart.
      const timed = chart.timed !== false;
      next = {
        ...state,
        phase: timed ? 'countIn' : 'active',
        hintLevel: toLevel,
        plan: { passIndex, totalPasses: totalPassesFor(passIndex, toLevel) },
        passes: [...state.passes, pass],
        levelChange: { direction: 'asked', fromLevel, toLevel, reasonKey: 'asked' },
        cleanStreak: 0,
        failStreak: 0,
        recall: wasRecall
          ? { attempted: true, completed: false, selfReport: null, bpm: chart.bpm }
          : state.recall,
        selfReport: null,
        beat: 0,
        stepIndex: 0,
        questionIndex: 0,
        questionOutcomes: [],
        pausedBeat: null,
        pauseReason: null,
        resumeFromBeat: chart.countInBeats,
        activeStartBeat: chart.countInBeats,
        changes: CHART_CHANGES.has(chart.family) ? freshChanges(chart) : state.changes,
        // Asking for a hint abandons this pass's score and its manual marks with the pass.
        syncScore: null,
        markedHits: [],
        flashUntilBeat: 0,
      };
      if (timed) effects.push({ type: 'stopTransport' }, { type: 'startTransport' }, announce('pass-asked'));
      else effects.push(announce('question'));
      break;
    }

    case 'FLASH': {
      // One full-pattern LED flash at Hint on demand, exactly one beat long. The
      // screen does not change and this event never changes the phase.
      if (state.phase !== 'countIn' && state.phase !== 'active') break;
      if (state.hintLevel !== 2) break;
      const currentBeat = Number.isFinite(event.beat) ? event.beat : state.beat;
      next = { ...state, flashUntilBeat: currentBeat + FADE.flashBeats };
      break;
    }

    case 'REPEAT': {
      // The UI routes Repeat through startDrill, but keep the branch complete: a
      // fresh drill must carry a session id or its passes could be applied twice.
      if (state.phase !== 'result') break;
      const wall = wallAt(event);
      const timed = chart.timed !== false;
      next = {
        ...createRun(chart),
        phase: timed ? 'countIn' : 'active',
        startedAt: at(event),
        drillStartedAt: at(event),
        drillWallStartedAt: wall,
        sessionId: sessionFor(chart, wall),
      };
      if (timed) effects.push({ type: 'startTransport' }, announce('count-in'));
      else effects.push(announce('question'));
      break;
    }

    case 'SELF_REPORT': {
      if (state.phase === 'result' && state.completed) {
        // The recall report arrives on the result panel: stamp the pass record and
        // recompute its unguided time; never append a second pass (D-30/Pitfall 6).
        const report = event.clean === true ? 'clean' : event.clean === false ? 'shaky' : null;
        if (report === null) break;
        const passes = state.passes.slice();
        let recallIndex = -1;
        for (let i = passes.length - 1; i >= 0; i--) {
          if (passes[i].hintLevel === FADE.recallLevel) { recallIndex = i; break; }
        }
        let unguidedMs = 0;
        if (recallIndex >= 0) {
          const pass = passes[recallIndex];
          unguidedMs = report === 'clean' && passComplete(pass) ? passMs(pass) : 0;
          passes[recallIndex] = reportPass({ ...pass, unguidedMs }, event);
          unguidedMs = passIsClean(passes[recallIndex]) ? passMs(pass) : 0;
          passes[recallIndex].unguidedMs = unguidedMs;
        }
        const effective = recallIndex >= 0 ? passes[recallIndex].selfReport : report;
        next = {
          ...state,
          selfReport: effective,
          passes,
          recall: { ...state.recall, attempted: true, completed: true, selfReport: effective, bpm: chart.bpm },
        };
        break;
      }
      if (state.phase !== 'passReview') break;
      const report = event.clean === true ? 'clean' : event.clean === false ? 'shaky' : null;
      if (report === null || !state.passes.length) break;
      const passes = state.passes.slice();
      passes[passes.length - 1] = reportPass(passes[passes.length - 1], event);
      const effective = passes[passes.length - 1].selfReport;
      const pending = nextLevel(
        { level: state.hintLevel, cleanStreak: state.cleanStreak, failStreak: state.failStreak },
        { hintLevel: state.hintLevel, completed: true, aborted: false, selfReport: effective },
      );
      next = {
        ...state,
        selfReport: effective,
        passes,
        levelChange: levelChangeFor(state.hintLevel, pending),
        pendingDecision: { ...pending, fromLevel: state.hintLevel },
        flashUntilBeat: 0,
      };
      break;
    }

    default:
      break;
  }

  return { state: next, effects };
}

// A cell the T2 can light: unmuted, strings 1-6, frets 1-24 (there is no LED at the nut).
// drills.js cannot import leds.js, so this copies leds.js `lightable` verbatim; the
// FADE-12 sweep in tests/drills.test.js asserts every led and flash cell passes lightable.
const fretted = n => !!n && !n.muted
  && Number.isInteger(n.s) && n.s >= 1 && n.s <= 6
  && Number.isInteger(n.f) && n.f >= 1 && n.f <= 24;

// Screen frame for the current position, plus the LED set the same frame owns. One
// matrix per family decides both, so the composition root never filters notes itself.
// Completed non-root targets are dimmed on screen; a root stays lit; an open target
// never blinks and is never substituted.
// FADE-12: fret 0 leaves the lit set here and only here (led and flashNotes); `notes`
// keeps open cells so the screen still draws them as rings. drills.js cannot import
// leds.js, so tests/leds.test.js and this filter state the same rule at both tier-1
// boundaries.
// `hasFlashSet` says whether the family names its own flash set (chord destination, next
// play-along chord), so the composition root's whole-shape fallback depends on the family,
// never on a filtered set that happened to hold only open cells.
export function frameAt(state, position = {}) {
  const frame = frameCore(state, position);
  return {
    ...frame,
    led: (frame.led || []).filter(fretted),
    flashNotes: (frame.flashNotes || []).filter(fretted),
    hasFlashSet: (frame.flashNotes || []).length > 0,
  };
}

function frameCore(state, position) {
  const chart = state.chart;
  const totalSteps = chart.steps.length;
  const shape = chart.shape || [];
  const phase = position.phase || state.phase;
  const level = clampLevel(state.hintLevel === undefined ? 0 : state.hintLevel);
  const anchors = anchorNotes(shape, { rootsOnly: chart.anchorMode === 'roots' });
  const isAnchor = new Set(anchors.map(n => n.s + ':' + n.f));
  // The screen keeps open roots as rings at Anchors (the one cue the guitar cannot give);
  // anchorNotes drops fret 0 for the LEDs, and frameAt strips fret 0 from led, so this
  // flag never reaches the guitar.
  for (const n of shape) if (n && n.iv === 0 && n.f === 0 && !n.muted) isAnchor.add(n.s + ':' + n.f);
  const base = { stepNumber: 0, totalSteps, target: null, blink: false, flash: false, led: [], flashNotes: [] };
  // The Hint-on-demand flash is a one-beat window: it is true only while a finite
  // position beat is still below flashUntilBeat and false in every other branch.
  const flashAt = value => Number.isFinite(value)
    && Number.isFinite(state.flashUntilBeat)
    && value < state.flashUntilBeat;
  const cell = n => ({ s: n.s, f: n.f, midi: n.midi, iv: n.iv });
  const note = (n, target) => ({
    s: n.s,
    f: n.f,
    midi: n.midi,
    iv: n.iv,
    root: n.iv === 0,
    target: !!target && n.s === target.s && n.f === target.f,
    dim: false,
    anchor: isAnchor.has(n.s + ':' + n.f),
    open: n.f === 0,
  });
  // Scale run: Full pattern lights every live dot, Anchors and Hint on demand light
  // anchors + target (the one-beat flash rides the sink's flash set), No lights none.
  const scaleLed = notes => {
    if (level === 3) return [];
    if (level === 1 || level === 2) return notes.filter(n => n.anchor || n.target).map(cell);
    return notes.filter(n => !n.dim).map(cell);
  };

  if (chart.family === 'findNote') {
    const questions = chart.questions || [];
    const index = clamp(Number.isInteger(state.questionIndex) ? state.questionIndex : 0, 0, Math.max(0, questions.length - 1));
    const question = questions[index] || null;
    const target = question ? question.target : null;
    const outcome = (state.questionOutcomes || [])[index] || null;
    const mode = position.mode === 'name' || position.mode === 'find'
      ? position.mode
      : (question ? question.mode : 'find');
    if (state.phase === 'idle' || state.phase === 'result' || phase === 'finished') {
      const notes = shape.map(n => note(n, null));
      return { ...base, stepNumber: state.phase === 'result' ? index : 0, notes, led: notes.map(cell) };
    }
    // The answer is only marked after the response; before it the board must not
    // tell the player where the target is.
    const markTarget = !!outcome && level < 3;
    let notes = [];
    if (level === 0) notes = shape.map(n => note(n, markTarget ? target : null));
    else if (level === 1) {
      notes = shape
        .filter(n => n.iv === 0 || (mode === 'name' && target && n.s === target.s && n.f === target.f))
        .map(n => note(n, markTarget ? target : null));
    } else if (level === 2 && mode === 'name' && target) {
      // The Name-mode question cell is the screen stand-in for the lit LED, so it
      // survives the fade even when every other dot is gone.
      notes = shape.filter(n => n.s === target.s && n.f === target.f).map(n => note(n, target));
    }
    let led = [];
    if (level < 3 && target) {
      if (markTarget || mode === 'name') led = [cell(target)];
      else if (level === 0) led = shape.map(cell);
      else if (level === 1) led = shape.filter(n => n.iv === 0).map(cell);
    }
    return { ...base, stepNumber: index + 1, totalSteps: questions.length, target, blink: false, notes, led };
  }

  // Chord changes: the guitar column and the screen column are two different matrices.
  // `led` is the LED Scene Language set (UI-SPEC, Chord changes); `notes` is the
  // Screen-fade column and is never the LED one — showing the destination chord on
  // screen would print the answer to the question the drill asks.
  if (chart.family === 'chordChanges') {
    const chords = Array.isArray(chart.chords) ? chart.chords : [];
    const beatsPerBar = Number.isFinite(chart.beatsPerBar) && chart.beatsPerBar > 0 ? chart.beatsPerBar : 4;
    const countIn = Number.isFinite(chart.countInBeats) ? chart.countInBeats : 0;
    const beat = Number.isFinite(position.beat) ? position.beat : state.beat;
    // Count-in previews the bar the pass will start on, exactly as the scale family does.
    const atCountIn = phase === 'countIn';
    const anchorBeat = atCountIn && Number.isFinite(position.activeStartBeat) ? position.activeStartBeat : beat;
    const barIndex = clamp(stepIndexFor(chart, anchorBeat), 0, Math.max(0, totalSteps - 1));
    const beatInBar = ((beat - countIn) % beatsPerBar + beatsPerBar) % beatsPerBar;
    const onBeat = beatInBar < 1;
    const current = chords.length ? chords[barIndex % chords.length] : null;
    const destination = chords.length ? chords[(barIndex + 1) % chords.length] : null;
    const voiceNotes = chord => (chord ? expandChord(chord.voicings[0]) : []);
    const chordCells = chord => voiceNotes(chord)
      .filter(n => !n.muted)
      .map(n => ({ s: n.s, f: n.f, midi: n.midi, iv: ((n.pc - chord.rootPc) % 12 + 12) % 12 }));
    const union = [];
    const seenCells = new Set();
    for (const entry of [...chordCells(current), ...chordCells(destination)]) {
      const key = entry.s + ':' + entry.f;
      if (seenCells.has(key)) continue;
      seenCells.add(key);
      union.push(entry);
    }
    const destinationCells = chordCells(destination);
    // Hint on demand lights the destination's first FRETTED root: an open root has no LED,
    // so taking it would leave open chords (D, A, E) dark at level 2. The fretted root is
    // the same cell the Anchors set already lights, never a substitute note.
    const destinationRoot = destinationCells.find(entry => entry.iv === 0 && Number.isInteger(entry.f) && entry.f >= 1) || null;
    // The Screen-fade column: the current bar's shape in the Chord tab's dot language
    // (finger numbers for fretted notes, `0` open, `×` muted), the same shape with no
    // finger numbers at Anchors, and no dot at all from Hint on demand on.
    const screenNotes = voiceNotes(current).map(n => ({
      s: n.s,
      f: n.muted ? 0 : n.f,
      midi: n.midi,
      iv: n.muted ? 0 : ((n.pc - current.rootPc) % 12 + 12) % 12,
      root: !!n.root,
      target: false,
      dim: false,
      anchor: !!n.root,
      open: !!n.open,
      muted: !!n.muted,
      text: n.muted ? '×' : n.open ? '0' : (n.finger === null ? '' : String(n.finger)),
    }));
    let led = [];
    if (level === 0) led = union;
    // FADE-11: Anchors lights the destination's roots plus its bass, not the whole shape.
    else if (level === 1) led = anchorNotes(destinationCells, { chord: true });
    else if (level === 2 && onBeat && destinationRoot) led = [destinationRoot];
    const notes = level === 0
      ? screenNotes
      : level === 1
        ? screenNotes.map(entry => ({ ...entry, text: '' }))
        : [];
    return {
      ...base,
      stepNumber: barIndex + 1,
      totalSteps,
      target: level === 3 ? null : (chart.steps[barIndex] ? chart.steps[barIndex].target : null),
      blink: level < 2 && onBeat,
      notes,
      led,
      // `Blink chord` flashes the destination shape, never the current one.
      flashNotes: destinationCells,
      flash: flashAt(beat),
    };
  }

  // Play-alongs (progressions, and 04-03's songs): the chart says where you are, the board
  // and the guitar say where you are going. This branch sits **before** the generic
  // idle/result path on purpose — placed after it, an idle play-along would hand back the
  // whole pass's shape instead of bar 1's next chord (M9).
  if (PLAY_FAMILIES.has(chart.family)) {
    const beatsPerBar = Number.isFinite(chart.beatsPerBar) && chart.beatsPerBar > 0 ? chart.beatsPerBar : 4;
    const countIn = Number.isFinite(chart.countInBeats) ? chart.countInBeats : 0;
    const bars = Number.isFinite(chart.bars) ? chart.bars : Math.max(0, totalSteps - 1);
    const beat = Number.isFinite(position.beat) ? position.beat : state.beat;
    const atCountIn = phase === 'countIn';
    const anchorBeat = atCountIn && Number.isFinite(position.activeStartBeat) ? position.activeStartBeat : beat;
    const barIndex = clamp(stepIndexFor(chart, anchorBeat), 0, Math.max(0, totalSteps - 1));
    const beatInBar = ((beat - countIn) % beatsPerBar + beatsPerBar) % beatsPerBar;
    // A-52: the idle stage and the count-in preview bar 1, and on the last chart bar the
    // next chord is the ending's — the same chord, held one bar longer (D-60). A song's
    // **section** boundary needs no branch here: every bar carries its own section's id and
    // its own chord (the builder copies both from the resolved bar list), so the step this
    // reads at a boundary is already the next section's first chord.
    const nextIndex = phase === 'idle' || atCountIn ? 0 : Math.min(barIndex + 1, Math.max(0, bars - 1));
    const step = chart.steps[nextIndex] || null;
    const cells = step && Array.isArray(step.cells) ? step.cells.map(n => ({ ...n })) : [];
    const roots = cells.filter(n => n.iv === 0);
    // FADE-11: the LED set at Anchors is the chord's roots plus its bass (fretted only); the
    // screen keeps the roots, and for every curated chord the bass is a root, so the screen
    // already shows roots plus bass with open roots as rings.
    const chordAnchors = anchorNotes(cells, { chord: true });
    const ending = !!(chart.steps[barIndex] && chart.steps[barIndex].ending);
    return {
      ...base,
      stepNumber: ending ? bars + 1 : barIndex + 1,
      totalSteps: bars,
      target: level === 3 ? null : (step ? step.target : null),
      // One held scene per bar, never a blink: the shape on the board is the *next* chord,
      // so a blink would say "now" when it means "next". `blink: false` at every level is
      // deliberate — the sink dedupes identical scenes, so a held scene costs one write.
      blink: false,
      notes: level === 0 ? cells : level === 1 ? roots : [],
      led: level === 0 ? cells : level === 1 ? chordAnchors : [],
      // `Blink chord` flashes the next chord's full shape, one beat, exactly as the chord
      // family flashes its destination.
      flashNotes: cells,
      flash: flashAt(beat),
      barIndex,
      bars,
      beatInBar,
      ending,
    };
  }

  if (state.phase === 'idle' || state.phase === 'result' || phase === 'finished') {
    const notes = shape.map(n => note(n, null));
    return {
      ...base,
      stepNumber: state.phase === 'result' ? state.stepIndex : 0,
      notes,
      led: notes.map(cell),
    };
  }

  if (phase === 'countIn') {
    const activeStartBeat = position.activeStartBeat === undefined ? state.activeStartBeat : position.activeStartBeat;
    const index = clamp(stepIndexFor(chart, activeStartBeat), 0, Math.max(0, totalSteps - 1));
    const target = chart.steps[index] ? chart.steps[index].target : null;
    if (level === 3) return { ...base, target: null, blink: false, notes: [], led: [] };
    const notes = level === 1
      ? shape.map(n => note(n, target)).filter(n => n.anchor || n.target)
      : shape.map(n => note(n, target));
    return {
      ...base,
      target,
      blink: !(target && target.f === 0),
      notes,
      led: scaleLed(notes),
      flash: flashAt(Number.isFinite(position.beat) ? position.beat : state.beat),
    };
  }

  const beat = Number.isFinite(position.beat) ? position.beat : state.beat;
  const stepIndex = clamp(stepIndexFor(chart, beat), 0, Math.max(0, totalSteps - 1));
  const target = chart.steps[stepIndex] ? chart.steps[stepIndex].target : null;
  if (level === 3) return { ...base, stepNumber: stepIndex + 1, target: null, blink: false, notes: [], led: [] };
  if (level === 1) {
    const notes = shape.map(n => note(n, target)).filter(n => n.anchor || n.target);
    return {
      ...base,
      stepNumber: stepIndex + 1,
      target,
      blink: !(target && target.f === 0),
      notes,
      led: scaleLed(notes),
    };
  }
  const completed = new Set();
  for (let i = 0; i < stepIndex; i++) {
    const t = chart.steps[i].target;
    // A bar that could not be voiced carries a null target; it is a step, never a crash.
    if (!t) continue;
    completed.add(t.s + ':' + t.f);
  }
  const notes = shape.map(n => {
    const view = note(n, target);
    if (!view.target && n.iv !== 0 && completed.has(n.s + ':' + n.f)) view.dim = true;
    return view;
  });
  return {
    ...base,
    stepNumber: stepIndex + 1,
    target,
    blink: !(target && target.f === 0),
    notes,
    led: scaleLed(notes),
    flash: flashAt(beat),
  };
}

// The idle stage's preview for a play-along family: the very frame a live pass would paint on
// its first bar. The stage only exists on the Scales tab, whose browse view carries the scale,
// so the composition root paints this frame over it — the UI-SPEC's idle row asks for bar 1's
// next chord at L1, its root at L2 and nothing at L3/L4, never the scale the tab holds (WR-02,
// A-52, D-61). `null` for every other family: they have their own idle scene.
export function playAlongIdleFrame(chart, level = 0) {
  if (!chart || !PLAY_FAMILIES.has(chart.family)) return null;
  const run = createRun({ ...chart, startLevel: clampLevel(level) });
  return frameAt(run, { phase: 'idle', beat: 0 });
}

// The quiz plane the result panel and the pass review read: every count comes from the
// run's own question plan and outcome stamps, never from a rendered view. A revealed
// question is answered but never correct (T-03-05); an unasked string keeps a zero row.
function questionsSummary(state, chart) {
  if (chart.family !== 'findNote') return null;
  const questions = Array.isArray(state.questions) ? state.questions : [];
  const outcomes = Array.isArray(state.questionOutcomes) ? state.questionOutcomes : [];
  const byString = [1, 2, 3, 4, 5, 6].map(s => ({ s, asked: 0, correct: 0 }));
  let answered = 0;
  let correct = 0;
  let revealed = 0;
  questions.forEach((question, index) => {
    const outcome = outcomes[index] || null;
    if (!outcome) return;
    answered += 1;
    if (outcome === 'correct') correct += 1;
    if (outcome === 'revealed') revealed += 1;
    const target = question && question.target ? question.target : null;
    const row = target ? byString.find(r => r.s === target.s) : null;
    if (!row) return;
    row.asked += 1;
    if (outcome === 'correct') row.correct += 1;
  });
  return {
    planned: questions.length,
    answered,
    correct,
    revealed,
    skipped: Math.max(0, questions.length - answered),
    byString,
  };
}

// The one result shape every drill family returns. Unscored fields stay null so the
// UI can say "Not scored"/"Not measured" instead of a fake zero.
export function summarize(state, { sessionCleanReps = null } = {}) {
  const chart = state.chart;
  const chartMs = Number.isFinite(chart.bpm) && chart.bpm > 0
    ? Math.round(chart.totalBeats * (60 / chart.bpm) * 1000)
    : 0;
  const durationMs = state.startedAt !== null && state.endedAt !== null
    ? Math.max(0, state.endedAt - state.startedAt)
    : chartMs;
  const completedSteps = state.completed ? chart.steps.length : clamp(state.stepIndex, 0, chart.steps.length);
  return {
    drillId: chart.id,
    kind: chart.kind,
    chartId: chart.id,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    durationMs,
    bpm: chart.bpm,
    beatsPerBar: chart.beatsPerBar,
    direction: chart.direction || 'updown',
    hintLevel: state.hintLevel === undefined ? 0 : state.hintLevel,
    startLevel: state.startLevel === undefined ? (state.hintLevel || 0) : state.startLevel,
    finalLevel: state.hintLevel === undefined ? 0 : state.hintLevel,
    // The microphone plane of the pass that just ran: the score the composition root
    // stamped on FINISH/STOP, or null on an unscored pass. `micUsed` is derived from it
    // so the result never reports evidence the pass did not produce (A8, D-50).
    syncScore: state.syncScore && typeof state.syncScore === 'object' ? { ...state.syncScore } : null,
    micUsed: !!(state.syncScore && typeof state.syncScore === 'object'),
    plannedSteps: chart.steps.length,
    completedSteps,
    correct: null,
    misses: null,
    accuracy: null,
    timing: { medianMs: null, meanAbsMs: null, onTimeRate: null },
    selfReport: state.selfReport,
    cleanReps: state.selfReport ? (sessionCleanReps === null || sessionCleanReps === undefined ? 0 : sessionCleanReps) : null,
    passes: (state.passes || []).map(pass => ({ ...pass })),
    recall: state.recall
      ? { ...state.recall }
      : { attempted: false, completed: false, selfReport: null, bpm: chart.bpm },
    unguidedMs: (state.passes || []).reduce((sum, pass) => sum + passUnguidedMs(pass), 0),
    // The practice time the drill actually earned (WR-02): each closed pass carries its
    // own activeMs, and a wait-mode pass contributes wall time rather than a tempo-derived 0.
    activeMs: (state.passes || []).reduce((sum, pass) => sum + passMs(pass), 0),
    sessionId: state.sessionId || null,
    startedWallAt: state.drillWallStartedAt || null,
    endedWallAt: state.drillWallEndedAt || null,
    completed: state.completed,
    stoppedEarly: state.stoppedEarly,
    questions: questionsSummary(state, chart),
    // The chord family's pass record, finalised from the run's own per-bar outcomes, plus
    // the ordered-pair identity the progress plane keys on. Other families carry null so
    // no pair or change metric is invented for them.
    changes: finalizeChanges(chart, state.changes, completedSteps),
    // The change grid the Bars tile and the pass summary read: `bars` is the chart's own bars
    // (never the ending step), and `endingBar` says the last step is the ending (Pitfall 2).
    bars: Number.isInteger(chart.bars) ? chart.bars : null,
    endingBar: !!chart.endingBar,
    chordPairId: chart.family === 'chordChanges' && chart.content && typeof chart.content.pairId === 'string'
      ? chart.content.pairId
      : null,
    content: { ...chart.content },
  };
}

// The D-25 drill aggregate the result panel and progress store consume. The pass
// summary above stays the per-pass shape; this one adds the with-hints plane, the
// recall attempt and the beat-derived active/unguided time. Never averaged.
export function summarizeDrill(state) {
  const chart = state.chart;
  const summary = summarize(state);
  const passes = summary.passes;
  const recall = { ...summary.recall };
  let recallPass = null;
  for (let i = passes.length - 1; i >= 0; i--) {
    if (passes[i].hintLevel === FADE.recallLevel) { recallPass = passes[i]; break; }
  }
  if (recallPass && recallPass.selfReport) recall.selfReport = recallPass.selfReport;
  const withHintsPasses = passes.filter(pass => passComplete(pass) && pass.hintLevel !== FADE.recallLevel);
  return {
    ...summary,
    skillId: chart.id,
    activeMs: passes.reduce((sum, pass) => sum + passMs(pass), 0),
    unguidedMs: passes.reduce((sum, pass) => sum + passUnguidedMs(pass), 0),
    passes,
    withHints: {
      passes: withHintsPasses,
      clean: withHintsPasses.filter(pass => pass.selfReport === 'clean').length,
      endedAtLevel: withHintsPasses.length
        ? withHintsPasses[withHintsPasses.length - 1].hintLevel
        : summary.startLevel,
    },
    recall,
    mastered: !!(recall.completed && passIsClean(recallPass)),
    assessment: recallPass ? recallPass.assessment || null : null,
    selfReport: recall.selfReport,
  };
}

// Resume re-enters a one-bar count-in; the active bar is the paused bar's first beat,
// clamped to the final bar so a late pause can still advance and finish.
export function resumeFromBeat(state) {
  const chart = state.chart;
  if (state.phase === 'idle') return chart.countInBeats;
  return resumeBeatFor(chart, state.pausedBeat);
}
