// ---------- Panels ----------
// Owns the four-tab tablist, per-tab control projection, option lists, scale chips,
// the chord detail strip, the chart grid and the drill stage/result/pause surfaces.
// All values are written with textContent; templates are fixed copy only.
import {
  KEYS, KEY_NAMES, SCALES, CHORD_FAMILIES, CHORD_PAIRS, PROGRESSIONS, SONGS, DEGREES, scaleById,
  chordById, chordPairById, progressionById, songById, searchLibrary,
} from './content.js';
import { positionsForScale, OPEN, FRETS } from './theory.js';
import { daysBetween, familyLevelCounts, lightLevelOf, skillFamily, LIGHT_FAMILIES } from './progress.js';

const $ = id => document.getElementById(id);
// 10-02: the Library leads with Songs (LIB-03). The order is the tablist's arrow-key order.
const TABS = ['songs', 'scales', 'chords', 'progressions'];
const TAB_IDS = { scales: 'tab-scales', chords: 'tab-chords', progressions: 'tab-progressions', songs: 'tab-songs' };
// Each Library tab's card list, prebuilt once at creation (10-02).
const CARD_LISTS = { songs: 'songCards', scales: 'scaleCards', chords: 'chordCards', progressions: 'progressionCards' };
// The search result group each family's rows sit in (10-03); chord pairs and shapes share Chords.
const SEARCH_GROUP_OF = {
  song: 'searchGroupSongs', scale: 'searchGroupScales', pair: 'searchGroupChords', chord: 'searchGroupChords',
  progression: 'searchGroupProgressions',
};
// The four main views (Phase 6). This tier may not import settings.js, so the list is repeated
// here and a shell test pins it equal to the settings allow-list `VIEWS`.
export const NAV_VIEWS = ['today', 'practice', 'progress', 'library'];
// Both tablists carry the same four tabs: `pill-*` on desktop and `bar-*` on the phone.
const NAV_PREFIXES = ['pill', 'bar'];
// The Library's primary action names the family tab it will open in Practice (06-02). Songs,
// progressions and chords open their browse subject, not a drill, so their label says Open
// (10-02, 10 IN-06).
export const CTA_LABEL = {
  scales: 'Practise this scale', chords: 'Open this chord',
  progressions: 'Open this progression', songs: 'Open this song',
};
// A completed recall whose self-report has not been given yet (10 IN-07). Guided recalls never
// complete, so they never wait for a report.
export const reportPendingOf = summary => !!(summary && summary.recall
  && summary.recall.completed === true && !summary.recall.selfReport);
// Imported skill content is data, never trusted to be a real content id (CR-02).
const ownEntry = (map, key) => (typeof key === 'string' && Object.hasOwn(map, key) ? map[key] : null);
const keyPcOf = content => (Number.isInteger(content.keyPc) && content.keyPc >= 0 && content.keyPc <= 11
  ? content.keyPc : 0);
// A section is named the way the content names it: `Verse ×2` when it repeats, `Chorus` when
// it plays once. One formatter, so the `Section` select, the stage header, the pass line and
// the skill label can never disagree about a repeat count (A-53).
const sectionToken = (name = '', repeats = 1) => {
  const title = typeof name === 'string' ? name : '';
  if (!title) return '';
  return Number.isInteger(repeats) && repeats > 1 ? `${title} ×${repeats}` : title;
};
// The song and section behind a chart's or a record's own content block. Both ids resolve
// own-key only, so a stale or crafted record renders as a bare `Song` instead of throwing or
// naming another song's section (T-02-10, T-04-21).
function songSectionOf(content = {}) {
  const song = ownEntry(songById, content.songId);
  const sections = song && Array.isArray(song.sections) ? song.sections : [];
  const section = sections.find(entry => entry && entry.id === content.sectionId) || null;
  return { song, section };
}
const MICROCOPY = {
  scales: 'Press Start drill to practise this position with a count-in and metronome.',
  chords: 'Browse only — chord-change drills start from a chord-pair card in Library.',
  progressions: 'Browse only — pick a bar, then press Play progression in Library to play along.',
  songs: 'Browse only — pick a bar, then press Play song in Library to play along from that section.',
};
// The stage lives under the Scales-tab microcopy, so that one line follows the family.
const FAMILY_MICROCOPY = {
  scaleRun: 'Press Start drill to practise this position with a count-in and metronome.',
  findNote: 'Press Start drill to answer questions at your own pace.',
  chordChanges: 'Press Start drill to loop two chords with the metronome.',
  progression: 'Press Start drill to play this progression with the backing band.',
  song: 'Press Start drill to play this section with the backing band.',
};
export const microcopyFor = family => FAMILY_MICROCOPY[family] || MICROCOPY.scales;
const FAMILY_DESC = {
  scaleRun: 'Count-in, metronome, and a fade to no lights.',
  findNote: 'One question at a time. Tap the board or choose an answer.',
  chordChanges: 'Two or four chords, one per bar. Keep the loop alive.',
  progression: 'A chart, a backing band, and a fade to no chart.',
  song: 'One section at a time, with the band. Loop it or play on.',
};
const FAMILY_STAGE_LABEL = {
  scaleRun: 'Scale drill',
  findNote: 'Note finding drill',
  chordChanges: 'Chord-change drill',
  progression: 'Progression play-along',
  song: 'Song play-along',
};
export const EMPTY_QUESTION = 'No question available for this position. Choose another position or scale.';
// The stage lock helper is per family: a chord pass changes tempo between reps only
// (A-38), while the other families keep Phase 2's next-run sentence.
export const LOCKED_HELPER = {
  scaleRun: 'Tempo and selection apply on the next run.',
  chordChanges: 'Tempo applies on the next rep.',
  progression: 'Tempo and selection apply on the next pass.',
  song: 'Tempo and selection apply on the next pass.',
};
// The mic window (03-03) hides `Mark change` and shows `Mark hit`: both rules read the
// state `main` renders, never a flag of their own (T-03-13).
const MIC_ON_STATES = ['on', 'listening'];
export const QUIZ_QUESTION_LABELS = { note: 'Note', degree: 'Scale degree', interval: 'Interval' };
// The by-string section label and the three Phase 3 mic-off helper lines are copy, fixed
// once here. The scale-run tiles render them whenever the pass produced no mic evidence,
// so the wording can never drift between the three subs.
export const BY_STRING_LABEL = 'By string';
export const MIC_OFF_COPY = {
  notes: 'Turn the mic on to score hits.',
  accuracy: 'Turn the mic on to score pitch.',
  timing: 'Turn the mic on to measure timing.',
};
// The chord family's only pitch claim. The mic line renders it
// (`Mic: 28 of 32 onsets · 24 roots on pitch.`); the phrase lives here so no module
// coins a second one and no copy can imply chord-quality detection (D-46, D-53).
export const CHORD_MIC_COPY = {
  onsets: 'onsets',
  rootsOnPitch: 'roots on pitch',
};
// D-52's three approved spot lines: one short sentence while listening, at most once per
// pass, never a per-note verdict and never a running score. `main` decides *when* one
// shows; this table is the only place the words live. A play-along opens with its own
// sentence — one chord per bar, not one note at a time (Open Question 2) — and keeps the
// same two follow-ups.
export const SPOT_LINES = {
  listening: 'Listening — play each note once.',
  listeningChords: 'Listening — play each chord on the change.',
  silent: 'Heard nothing for 3 s. Play louder or move closer.',
  noisy: 'Too much room noise. Turn the app volume down or use headphones.',
};
// ---------- Microphone cluster and calibration copy (03-03, D-45/D-48/D-51) ----------
// One word per state, never icon-only, and the word is never `aria-hidden`. `requesting`
// has no word of its own: the browser's prompt holds the previous one. `unavailable` has
// no word either — a device the browser cannot open stays `Off`.
export const MIC_WORDS = {
  off: 'Off',
  on: 'On',
  listening: 'Listening',
  calibrating: 'Calibrating',
  denied: 'Denied',
};
export const MIC_ACTIONS = { calibrate: 'Calibrate timing', retry: 'Try again' };
// The four feedback sentences of the permission and boundary states. Denial is normal:
// every one of them is neutral copy and none of them is a danger message (D-51).
export const MIC_FEEDBACK = {
  waiting: 'Waiting for microphone permission…',
  midPass: 'Mic change applies at the next pass.',
  unavailable: 'Microphone is not available in this browser. Every drill runs unscored.',
  blocked: "The microphone is blocked. Allow it in your browser's site settings, then press Try again.",
};
export const MIC_ANNOUNCE = {
  on: 'Microphone on.',
  off: 'Microphone off.',
  granted: 'Microphone permission granted.',
  denied: 'Microphone permission denied.',
};
export const HEADPHONES_LINE = 'Headphones recommended — speaker output leaks into the mic.';
export const CALIBRATION = {
  title: 'Calibrate timing',
  intro: 'Wired headphones recommended. You will hear eight clicks; tap in time with each one.',
  tap: 'Tap',
  again: 'Calibrate again',
  done: 'Done',
  close: 'Close calibration',
  skip: 'Skip for now',
  helper: 'Timing uses a tolerant default until you calibrate.',
  saved: 'Saved for this device.',
  large: 'That offset is unusually large. Check that your headphones are wired, then calibrate again.',
  savedAnnouncement: offsetMs => `Calibration saved. Offset ${Math.round(offsetMs)} milliseconds.`,
  skippedAnnouncement: 'Calibration skipped.',
};
// Problem first, exact next action second — the four error lines of the panel.
export const CALIBRATION_ERRORS = {
  denied: "The microphone is blocked. Allow it in your browser's site settings, then press Try again.",
  none: 'No taps heard. Tap along with the clicks, then try again.',
  tooFew: 'Too few taps. Tap at least three clicks, then try again.',
  unavailable: 'Microphone is not available in this browser. Calibration needs it; every drill still runs unscored.',
};
export const calibrationCountText = (clickIndex = 1, clickCount = 0) => `Click ${clickIndex} of ${clickCount}`;
export const calibrationTapsText = taps => `${countText(taps, 'tap', 'taps')} heard`;
export const calibrationResultText = offsetMs => `Offset ${Math.round(Number(offsetMs) || 0)} ms · ${CALIBRATION.saved}`;

// The one place that decides what the cluster reads and does. Pure, so the mapping is
// tested without a DOM and `setMic` only has to write it out.
export function micView({
  state = 'off', previous = MIC_WORDS.off, supported = true, passLive = false,
} = {}) {
  const pressed = state === 'on' || state === 'listening';
  const requesting = state === 'requesting';
  const denied = state === 'denied';
  const word = requesting ? (previous || MIC_WORDS.off)
    : state === 'unavailable' ? MIC_WORDS.off
      : MIC_WORDS[state] || MIC_WORDS.off;
  return {
    word,
    pressed,
    // Accent rule 16: the glyph is the accent only while the mic is armed or listening.
    glyph: pressed ? 'accent' : 'muted',
    action: denied ? MIC_ACTIONS.retry : MIC_ACTIONS.calibrate,
    // Calibration cannot be opened while a pass owns the stage or while the test itself
    // is running, and an absent device has nothing to calibrate.
    actionDisabled: state === 'calibrating' || !!passLive || !supported,
    busy: requesting,
    toggleDisabled: requesting,
  };
}

const PAUSE_REASON = {
  ble: 'Paused — guitar disconnected.',
  hidden: 'Paused — you switched away.',
  audio: 'Paused — audio stopped.',
  user: 'Paused.',
};
const DIRECTION = { up: 'Up', down: 'Down', updown: 'Up & down' };
// Selection is locked while a pass is live or awaiting its boundary decision. The tempo
// plane is its own list because the chord family edits it *at* the boundary (A-38). The Songs,
// Progressions and Chords pickers lock too: a Library tab stays browsable mid-pass, so a live
// picker could swap the item the run is credited to (10 CR-01).
const LOCKED_IDS = ['key', 'scale', 'position', 'direction',
  'song', 'songKey', 'playSong', 'progression', 'progressionKey', 'playProgression', 'chord', 'voicing'];
const TEMPO_IDS = ['bpm', 'bpmDown5', 'bpmDown1', 'bpmUp1', 'bpmUp5', 'bpmTap'];
const KEY_PLANE_IDS = ['progressionKey', 'songKey', 'playKey'];

// ---------- Hint ladder copy (fixed, never data-derived) ----------
export const HINT_LEVEL_NAMES = ['Full pattern', 'Anchors', 'Hint on demand', 'No lights'];
// Progress family bars (PROG-09): display names, and the five buckets in bar order —
// not started first, then the four light levels.
const FAMILY_NAMES = { scales: 'Scales', chords: 'Chords', progressions: 'Progressions', songs: 'Songs' };
const FAMILY_BUCKETS = ['not-started', 'full', 'anchors', 'hint', 'none'];
const FAMILY_BUCKET_NAMES = ['not started', ...HINT_LEVEL_NAMES];
// The Progress neck spans frets 0-FRETS (0-19), drawn nut-up with low E on the left.
const OWNED_FRETS = FRETS;
const ownedLevelName = level => (level >= 0 && level < HINT_LEVEL_NAMES.length ? HINT_LEVEL_NAMES[level] : 'Not started');
const HINT_CRITERIA = {
  levels: '3 clean passes to remove a hint · 2 failed passes to bring one back.',
  recall: 'Recall pass — finish at working tempo to mark this skill mastered.',
  quizName: '3 clean passes to remove a hint · 2 failed passes to bring one back. The marked note is the question, not a hint.',
  quizRecall: 'Recall pass — find every note with no lights.',
  chordRecall: 'Recall pass — keep the loop with no lights.',
  // The play-along's own ladder: the recall pass plays the whole progression with no chart
  // at all, so its criteria sentence names the chart rather than the notes (PROG-04).
  progressionLevels: '3 clean passes to remove a hint · 2 failed passes to bring one back.',
  progressionRecall: 'Recall pass — play the whole progression with no chart.',
  // The song's pair differs only in what the recall pass is asked for: one section, from
  // memory. Two constants no branch selects would be worse than none, so `setHint` picks
  // them beside the progression's (D-65).
  songLevels: '3 clean passes to remove a hint · 2 failed passes to bring one back.',
  songRecall: 'Recall pass — play the section with no chart.',
};
const HINT_REASONS = {
  start: 'No change yet this drill.',
  startSession: 'Starting level from your last session.',
  advance: 'One hint off — {needed} clean passes at {fromName}.',
  holdClean: 'Level holds — {k} of {needed} clean passes at {name}.',
  holdFail: 'Level holds — {k} of {allowed} failed passes in a row.',
  holdSkip: 'Level holds — this pass was not reported.',
  demote: 'One hint back — {allowed} failed passes in a row.',
  asked: 'One hint back — you asked for it.',
};
const PASS_DECISIONS = {
  advance: 'Next: {nextName} — one hint off after {needed} clean passes at {fromName}.',
  holdClean: 'Next: {name} — level holds, {k} of {needed} clean passes at {name}.',
  holdFail: 'Next: {name} — level holds, {k} of {allowed} failed passes in a row.',
  holdSkip: 'Next: {name} — level holds, this pass was not reported.',
  demote: 'Next: {toName} — one hint back after {allowed} failed passes in a row.',
  asked: 'Next: {toName} — one hint back, you asked for it.',
};

function fillTemplate(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key]));
}

// ---------- Thumb-row dimmer copy (FADE-07/10, fixed, never data-derived) ----------
export const DIMMER_COPY = {
  atFull: 'Already at Full pattern.',
  atNone: 'Already at No lights.',
  paused: 'Resume to change the light.',
  review: 'Finish the review to change the light.',
  noLights: 'No lights — playing from memory',
  passesMany: '{n} more clean passes to dim',
  passesOne: '1 more clean pass to dim',
  // Idle, the lamps mark the level Start will use while the numbers count what the guitar
  // shows right now (the browse scene before a press), so the two measures are named apart.
  lampsIdle: 'Start level',
  lampsLive: 'Light level',
  readoutIdle: 'on the guitar now',
  readoutLive: 'on the guitar',
  // No guitar connected, or Lights off: the numbers are what the guitar would show (WR-04).
  readoutOff: 'would light on the guitar',
  announce: '{name} — {lit} lit, {dark} dark.',
};

// The thumb row's one view model. Enabled while idle and while a pass plays (count-in
// included); paused, the pass review and the result disable both buttons with a reason
// (CONTEXT "When the dimmer is enabled"). The clamps add their own reason. `lightsLive` is
// false when no guitar is connected or Lights is off: the counts stay, the label says "would".
export function dimmerView({ level = 0, lit = 0, dark = 0, cleanCount = 0, needed = 3, phase = 'idle', lightsLive = true } = {}) {
  const safeLevel = Number.isInteger(level) ? Math.max(0, Math.min(3, level)) : 0;
  const levelName = HINT_LEVEL_NAMES[safeLevel];
  const litN = Number.isFinite(lit) ? lit : 0;
  const darkN = Number.isFinite(dark) ? dark : 0;
  const left = Math.max(0, (Number.isFinite(needed) ? needed : 0) - (Number.isFinite(cleanCount) ? cleanCount : 0));
  const passesText = safeLevel === 3
    ? DIMMER_COPY.noLights
    : left === 1 ? DIMMER_COPY.passesOne : fillTemplate(DIMMER_COPY.passesMany, { n: left });
  const live = phase === 'idle' || phase === 'countIn' || phase === 'active';
  const phaseReason = phase === 'paused' ? DIMMER_COPY.paused : DIMMER_COPY.review;
  const canBrighter = live && safeLevel > 0;
  const canDarker = live && safeLevel < 3;
  const idle = phase === 'idle';
  return {
    level: safeLevel,
    levelName,
    lit: litN,
    dark: darkN,
    readout: `${litN} lit / ${darkN} dark`,
    passesText,
    canBrighter,
    canDarker,
    brighterReason: canBrighter ? '' : live ? DIMMER_COPY.atFull : phaseReason,
    darkerReason: canDarker ? '' : live ? DIMMER_COPY.atNone : phaseReason,
    lampsLabel: idle ? DIMMER_COPY.lampsIdle : DIMMER_COPY.lampsLive,
    readoutLabel: !lightsLive ? DIMMER_COPY.readoutOff : idle ? DIMMER_COPY.readoutIdle : DIMMER_COPY.readoutLive,
    announcement: fillTemplate(DIMMER_COPY.announce, { name: levelName, lit: litN, dark: darkN }),
  };
}

export function hintSummaryText({ completedSteps = 0, plannedSteps = 0, bpm = 0, levelName = HINT_LEVEL_NAMES[0] } = {}) {
  return `${completedSteps} of ${plannedSteps} notes · ${bpm} BPM · Hints: ${levelName}`;
}

export const questionCounterText = (index = 1, count = 0) => `Question ${index} of ${count}`;

// The three fixed outcome lines. A revealed question is reported separately from a
// correct one and never counts as correct (T-03-05).
export function quizOutcomeText({ correct = false, revealed = false, noteName = '', fret = 0, string = 0 } = {}) {
  if (revealed) return `Revealed — ${noteName} is fret ${fret} on string ${string}.`;
  if (correct) return 'Correct.';
  return `Not quite — ${noteName} is fret ${fret} on string ${string}.`;
}

// One pass-review line per family. The scale-run branch is the Phase 2 line, unchanged;
// a wait-mode pass reports questions and never a tempo; the chord family and the play-along
// count bars, changes and changes per minute, and every number arrives from the finalised
// record. A play-along with no scored plane says `Not scored` in words, never a zero.
export function passSummaryText({
  family = 'scaleRun', completedSteps = 0, plannedSteps = 0, bpm = 0,
  levelName = HINT_LEVEL_NAMES[0], correct = 0, revealed = 0,
  bars = 0, clean = 0, planned = 0, changesPerMin = 0, changes = undefined,
  sectionName = '', repeats = 1,
} = {}) {
  if (family === 'findNote') return `${correct} of ${plannedSteps} correct · ${revealed} revealed · Hints: ${levelName}`;
  if (family === 'chordChanges') {
    return `${bars} bars · ${clean} of ${planned} changes · ${changesPerMin} changes/min · Hints: ${levelName}`;
  }
  if (family === 'progression' || family === 'song') {
    // Each family's own branch: the chord branch's word order is a Phase 3 pin, and a
    // play-along's unscored form is a sentence rather than four numbers nobody measured
    // (PROG-05, A-61). A song names the section it played and its repeats first, so the
    // line reads `Verse ×2 · 8 bars · Not scored · Hints: Full pattern`.
    const token = family === 'song' ? sectionToken(sectionName, repeats) : '';
    const where = token ? `${token} · ${bars} bars` : `${bars} bars`;
    const scored = changes === null ? false : (changes === undefined ? planned > 0 : true);
    return scored
      ? `${where} · ${clean} of ${planned} changes · ${changesPerMin} changes/min · Hints: ${levelName}`
      : `${where} · Not scored · Hints: ${levelName}`;
  }
  return hintSummaryText({ completedSteps, plannedSteps, bpm, levelName });
}

// The four approved tempo-line forms (UI-SPEC, Pass review). `{bpm}` is the only number
// the line carries; the reason is the engine's, so the player never has to guess why.
export const TEMPO_LINE = {
  clean: 'Next rep: {bpm} BPM — up 4 after a clean pass.',
  failed: 'Next rep: {bpm} BPM — down 4 after two failed passes.',
  skipped: 'Next rep: {bpm} BPM — held, this pass was not reported.',
  edited: 'Next rep: {bpm} BPM — set by you.',
};

export function tempoLineText({ bpm = 0, reasonKey = 'skipped' } = {}) {
  const value = Number.isFinite(bpm) ? Math.round(bpm) : 0;
  return fillTemplate(TEMPO_LINE[reasonKey] || TEMPO_LINE.skipped, { bpm: value });
}

// The chord pass review's one announcement. The word `Eight` is the approved copy and the
// pass is always eight bars (A-36); the counts come from the finalised change record.
export function chordPassAnnouncement({ clean = 0, planned = 0 } = {}) {
  return `Eight bars. ${clean} of ${planned} changes.`;
}

// The chord family counts bars, not notes. The counter names the bar at every level and
// the chord only while the screen still carries note cues (levels 1 and 2, indices 0-1).
export const BAR_COUNTER = {
  bar: 'Bar {n} of {bars}',
  chord: 'Bar {n} of {bars} · {chordName}',
};

export function barCounterText({ bar = 1, bars = 0, chordName = '', level = 0 } = {}) {
  const values = { n: bar, bars };
  if (level > 1 || !chordName) return fillTemplate(BAR_COUNTER.bar, values);
  return fillTemplate(BAR_COUNTER.chord, { ...values, chordName });
}

// The stage chart's two tokens, per level. L1 names the chord, L2 names its degree, L3 and
// L4 carry no primary token at all — each level shows strictly less than the one above, which
// is D-61's ladder expressed as one function. The ending card's secondary token is `Ending`
// at every level: a bar named 13 of 12 would be a lie (A-66).
export function chartCardTokens({ level = 0, chordName = '', roman = '', bar = 1, ending = false } = {}) {
  const secondary = ending ? 'Ending' : `Bar ${bar}`;
  if (level >= 2) return { primary: '', secondary };
  return { primary: level === 0 ? chordName : roman, secondary };
}

// The now-playing counter, one pure formatter over both play-along families and every level:
// `Bar 3 of 12 · G` → `Bar 3 of 12 · V` → `Bar 3 of 12`, and `Ending · G` → `Ending`. One
// ladder, so no family ever carries its own copy of the fade (PROG-04).
export function playCounterText({
  family = 'progression', level = 0, bar = 1, bars = 0,
  chordName = '', roman = '', sectionName = '', ending = false,
} = {}) {
  const where = ending
    ? 'Ending'
    : sectionName ? `${sectionName} · Bar ${bar} of ${bars}` : `Bar ${bar} of ${bars}`;
  if (level >= 2) return where;
  const token = level === 0 ? chordName : roman;
  return token ? `${where} · ${token}` : where;
}

// The worded counts the play-along announcements read (A10): `Twelve bars. Starting on G.`
// Index 0 is `Zero` so `NUMBER_WORDS[n]` is the word for n; 1-24 covers the longest chart
// and the longest section repeat.
export const NUMBER_WORDS = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen',
  'Nineteen', 'Twenty', 'Twenty-one', 'Twenty-two', 'Twenty-three', 'Twenty-four',
];

// The bar count is always a word, never a numeral: the one live region reads
// `Twelve bars. Starting on G.` at the count-in and `Twelve bars. 10 of 12 changes.` (or
// `Twelve bars. Not scored.`) at the boundary. The changes themselves stay digits — they
// are a count, `eight of twelve` is the only sentence the app words on purpose (A-36, A-61).
const barWords = bars => NUMBER_WORDS[bars] || String(bars);
// A song prefixes both sentences with the section it plays, so the live region names the
// pass before it names its length: `Verse. Four bars. Starting on G.` The prefix is the
// section's own name from `content.js`, never a stored string (T-04-18, A-61).
const withSection = (sectionName, sentence) => (
  typeof sectionName === 'string' && sectionName ? `${sectionName}. ${sentence}` : sentence
);
export const playAlongStartAnnouncement = ({ bars = 0, chordName = '', sectionName = '' } = {}) => withSection(
  sectionName,
  chordName ? `${barWords(bars)} bars. Starting on ${chordName}.` : `${barWords(bars)} bars.`,
);
export const playAlongPassAnnouncement = ({ bars = 0, clean = 0, planned = 0, scored = true, sectionName = '' } = {}) => withSection(
  sectionName,
  scored ? `${barWords(bars)} bars. ${clean} of ${planned} changes.` : `${barWords(bars)} bars. Not scored.`,
);

// The song's strum pattern and its one-line tip, the phase's only new song metadata surface
// (D-65). Two lines rather than one run-on, and both straight from `content.js`: the panel
// renders these strings with `textContent`, never markup, and never from a stored record
// (T-04-18). An empty song yields no lines, so the caption is absent rather than blank.
export function strumHintLines(song = null) {
  const strum = song && typeof song.strum === 'string' ? song.strum.trim() : '';
  const tip = song && typeof song.tip === 'string' ? song.tip.trim() : '';
  const lines = [];
  if (strum) lines.push(`Strum ${strum}`);
  if (tip) lines.push(tip);
  return lines;
}

// The backing cluster's three vocabularies (D-66). The Intensity options are the stored
// preset's own names; the four stem rows are the four booleans the record carries; and the
// loop windows are the three values `settings.LOOP_BARS` validates. This module may not
// import settings.js (tier 1 stays above tier 0), so the labels live with the controls.
export const INTENSITY_OPTIONS = [
  { value: 'click', label: 'Click only' },
  { value: 'drumsBass', label: 'Drums + bass' },
  { value: 'full', label: 'Full band' },
];
export const STEM_OPTIONS = [
  { id: 'stemClick', label: 'Click' },
  { id: 'stemDrums', label: 'Drums' },
  { id: 'stemBass', label: 'Bass' },
  { id: 'stemPad', label: 'Pad' },
];
export const LOOP_OPTIONS = [
  { value: 0, label: 'Whole' },
  { value: 4, label: '4 bars' },
  { value: 8, label: '8 bars' },
];
// A-68: `Whole` is always offered; `4 bars` only for a chart longer than four; `8 bars`
// only for one longer than eight. A control that cannot act is absent, never present and
// inert — so a four-bar progression shows one option and a twelve-bar blues shows three.
export function loopOptionValues(bars = 0) {
  const count = Number.isFinite(bars) ? Math.max(0, Math.trunc(bars)) : 0;
  return LOOP_OPTIONS.map(option => option.value).filter(value => value === 0 || count > value);
}

// The Phase 1 open-string sentence is a **single-note** cue: it belongs to the families whose
// frame target is the note being practised, and it never outranks a D-52 spot line. A
// play-along's cue is the whole next shape, and a chord's open strings are simply never lit,
// so there is nothing to warn about — painting the sentence there replaced the required
// `Listening — play each chord on the change.` line within one beat (CR-01).
export function openStringCue({
  target = null, level = 0, stageMode = false, play = false, spotLive = false,
} = {}) {
  if (play || spotLive || stageMode) return false;
  if (!(Number.isFinite(level) && level < 3)) return false;
  return !!(target && target.f === 0);
}

// `Blink pattern` flashes a scale pattern; a play-along flashes the next chord, and the
// copywriting contract lists the two labels separately (WR-04, A-44/D-61).
export const blinkActionLabel = family => (
  family === 'progression' || family === 'song' ? 'Blink chord' : 'Blink pattern'
);

// Always six rows, strings 1 -> 6, so the list never reflows by count. An unasked
// string says so instead of printing "0 of 0".
export function byStringRows(byString = []) {
  const rows = Array.isArray(byString) ? byString : [];
  return [1, 2, 3, 4, 5, 6].map(s => {
    const row = rows.find(entry => entry && entry.s === s) || { s, asked: 0, correct: 0 };
    const asked = Math.max(0, Math.trunc(Number(row.asked) || 0));
    const correct = Math.max(0, Math.trunc(Number(row.correct) || 0));
    return {
      s,
      asked,
      correct,
      text: asked === 0 ? `String ${s} · not asked.` : `String ${s}`,
      meta: asked === 0 ? '' : `${correct} of ${asked} correct.`,
    };
  });
}

// Lowest correct/asked ratio among the asked strings, tie-broken by the lowest string
// number. A pass that asked nothing has no weakest string.
export function weakestString(byString = []) {
  const asked = byStringRows(byString).filter(row => row.asked > 0);
  if (!asked.length) return null;
  return asked.reduce((worst, row) => {
    const ratio = row.correct / row.asked;
    const worstRatio = worst.correct / worst.asked;
    if (ratio < worstRatio) return row;
    if (ratio === worstRatio && row.s < worst.s) return row;
    return worst;
  });
}

function byStringOf(questions) {
  if (!questions || !Array.isArray(questions.byString)) return [];
  return questions.byString;
}

// The one place that decides whether a pass carries microphone evidence: the score the
// engine stamped on FINISH/STOP. A null score is the unscored pass — never a zeroed one.
export function syncScoreOf(summary) {
  const score = summary && summary.syncScore;
  return score && typeof score === 'object' ? score : null;
}

// CR-02/D-43: a wait-mode pass is answered by tapping the board, so the quiz board stays
// live for the whole open question; a timed pass keeps it locked for the phrase so a stray
// tap cannot audition over a scheduled step. A pause or a boundary is never live, and an
// idle or finished stage is browsable again.
export function boardInteractiveFor(chart, phase) {
  const timed = !(chart && chart.timed === false);
  if (phase === 'countIn' || phase === 'active') return !timed;
  if (phase === 'paused' || phase === 'passReview') return false;
  return true;
}

// A-46: mic evidence is one line below the grid, never a fifth tile. Each family names
// only what it measured, and a metric the mic did not produce is omitted rather than
// printed as a dash (D-50). `null` means "no line at all".
export function micLineText(summary) {
  const score = syncScoreOf(summary);
  if (!score) return null;
  if (summary.kind === 'findNote') {
    const planned = Number.isFinite(score.planned) ? score.planned : null;
    const correct = Number.isFinite(score.correct) ? score.correct : null;
    if (planned === null || correct === null) return null;
    return `Mic: ${correct} of ${planned} answered on pitch.`;
  }
  const parts = [];
  // A play-along measures exactly what the chord family measures — one strum per change and
  // the expected root — so the two read the same sentence and neither ever claims chord
  // quality. `Mic: 10 of 12 onsets · 9 roots on pitch.` (PROG-05, D-53).
  if (summary.kind === 'chordChanges' || summary.kind === 'progression' || summary.kind === 'song') {
    if (Number.isFinite(score.onsets) && Number.isFinite(score.planned)) {
      parts.push(`${score.onsets} of ${score.planned} ${CHORD_MIC_COPY.onsets}`);
    }
    if (Number.isFinite(score.rootsOnPitch)) parts.push(`${score.rootsOnPitch} ${CHORD_MIC_COPY.rootsOnPitch}`);
    return parts.length ? `Mic: ${parts.join(' · ')}.` : null;
  }
  const hits = Number.isFinite(score.hits) ? Math.max(0, score.hits) : null;
  const planned = Number.isFinite(score.planned) ? score.planned : null;
  const medianMs = score.timing && Number.isFinite(score.timing.medianMs) ? score.timing.medianMs : null;
  if (Number.isFinite(score.accuracy)) parts.push(`${percentText(score.accuracy)} pitch`);
  if (medianMs !== null) parts.push(`${msText(medianMs)} median`);
  if (hits !== null && planned !== null) parts.push(`${hits} of ${planned} onsets`);
  return parts.length ? `Mic: ${parts.join(' · ')}.` : null;
}

// A-46: four tiles per family, so a metric that belongs to one family never appears as
// a dash in another.
export function familyTiles(summary = {}) {
  const unguided = { label: 'Unguided', value: unguidedText(summary.unguidedMs), sub: 'Added to your unguided total.' };
  if (summary.kind === 'findNote' && summary.questions) {
    const questions = summary.questions;
    const planned = questions.planned || 0;
    const weakest = weakestString(byStringOf(questions));
    return [
      {
        label: 'Questions',
        value: `${planned} planned`,
        sub: `${questions.answered || 0} answered · ${questions.revealed || 0} revealed.`,
      },
      {
        label: 'Correct',
        value: String(questions.correct || 0),
        sub: `${percentText(questions.correct || 0, planned)} of ${planned} questions.`,
      },
      {
        label: 'Weakest string',
        value: weakest ? `String ${weakest.s}` : '—',
        sub: weakest ? `${weakest.correct} of ${weakest.asked} correct.` : 'No question asked.',
      },
      unguided,
    ];
  }
  if (summary.kind === 'progression' || summary.kind === 'song') {
    // The play-along's four tiles: the bar grid the chart planned, the changes the pass's
    // own record counted, the rate, and the unguided total. With no microphone evidence the
    // two measured tiles say so in words — never a `0` and never a danger colour (A-61).
    // Both families read the same four; a song names its section in the result metadata
    // line rather than in a fifth tile (A-46 keeps the grid at four).
    const record = summary.changes && typeof summary.changes === 'object' ? summary.changes : {};
    const planned = Number.isFinite(record.planned) ? record.planned : (Number.isFinite(summary.bars) ? summary.bars : 0);
    const played = Number.isFinite(record.reached) ? record.reached : planned;
    // The ending is a bar the pass actually reached, never a property of the chart: a pass
    // stopped in bar 3 of 12 never played the ending bar, so the tile says `0 ending` instead
    // of counting a bar nobody heard (WR-05).
    const endingPlayed = Number.isFinite(record.reached) && Number.isFinite(record.planned)
      ? record.reached >= record.planned
      : summary.endingBar !== false;
    const clean = Number.isFinite(record.clean) ? record.clean : 0;
    const missed = Number.isFinite(record.missed) ? record.missed : Math.max(0, planned - clean);
    const perMinute = Number.isFinite(record.changesPerMin) ? record.changesPerMin : 0;
    const bpm = Number.isFinite(summary.bpm) ? summary.bpm : 0;
    const scored = !!syncScoreOf(summary);
    return [
      {
        label: 'Bars',
        value: `${planned} planned`,
        sub: `${played} played · ${endingPlayed ? 1 : 0} ending.`,
      },
      {
        label: 'Changes',
        value: scored ? String(clean) : 'Not scored',
        sub: scored ? `${clean} clean · ${missed} missed.` : 'Turn the mic on to score changes.',
      },
      {
        label: 'Changes/min',
        value: scored ? String(perMinute) : 'Not measured',
        sub: scored ? `At ${bpm} BPM · one per bar.` : 'Turn the mic on to measure the rate.',
      },
      unguided,
    ];
  }
  if (summary.kind === 'chordChanges') {
    // The four chord tiles report the movement the drill actually measured: clean and
    // missed changes, the rate, and the weakest ordered pair from the stored plane. No
    // tile, value or sub ever claims chord quality, fingering or string choice (D-46).
    const changes = summary.changes && typeof summary.changes === 'object' ? summary.changes : {};
    const clean = Number.isFinite(changes.clean) ? changes.clean : 0;
    const planned = Number.isFinite(changes.planned) ? changes.planned : 0;
    const missed = Number.isFinite(changes.missed) ? changes.missed : Math.max(0, planned - clean);
    const perMinute = Number.isFinite(changes.changesPerMin) ? changes.changesPerMin : 0;
    const bpm = Number.isFinite(summary.bpm) ? summary.bpm : 0;
    const weakest = summary.weakestPair && typeof summary.weakestPair === 'object' ? summary.weakestPair : null;
    const label = weakest ? chordPairLabelText(weakest) : '';
    const attempts = weakest && Number.isFinite(weakest.attempts) ? Math.max(0, weakest.attempts) : 0;
    const pairClean = weakest && Number.isFinite(weakest.clean) ? Math.max(0, weakest.clean) : 0;
    const pairBpm = weakest && Number.isFinite(weakest.bestBpm) && weakest.bestBpm > 0 ? weakest.bestBpm : bpm;
    return [
      {
        label: 'Changes',
        value: String(clean),
        sub: `${clean} clean · ${missed} missed.`,
      },
      {
        label: 'Changes/min',
        value: String(perMinute),
        sub: `At ${bpm} BPM · one per bar.`,
      },
      {
        label: 'Weakest pair',
        value: label || '—',
        sub: label
          ? `${attempts > 0 ? Math.round((pairClean / attempts) * 100) : 0}% clean at ${pairBpm} BPM.`
          : 'Play a pair to record it.',
      },
      unguided,
    ];
  }
  // Scale run. The pass is scored only when the engine stamped a microphone score on it;
  // with one, the tiles read what the mic produced, and without one every score surface
  // says `Not scored` / `Not measured` and names the way to change that (D-50, A-46).
  const score = syncScoreOf(summary);
  const planned = Number.isFinite(summary.plannedSteps) ? summary.plannedSteps : 0;
  if (!score) {
    return [
      {
        label: 'Notes',
        value: `${planned} planned`,
        sub: summary.completed
          ? `${summary.completedSteps} completed · ${MIC_OFF_COPY.notes}`
          : `${summary.completedSteps} of ${planned} completed · ${MIC_OFF_COPY.notes}`,
      },
      { label: 'Accuracy', value: 'Not scored', sub: MIC_OFF_COPY.accuracy },
      { label: 'Timing', value: 'Not measured', sub: MIC_OFF_COPY.timing },
      unguided,
    ];
  }
  const hits = Number.isFinite(score.hits) ? Math.max(0, score.hits) : 0;
  const scored = Number.isFinite(score.planned) && score.planned > 0 ? score.planned : planned;
  const medianMs = score.timing && Number.isFinite(score.timing.medianMs) ? score.timing.medianMs : null;
  return [
    {
      label: 'Notes',
      value: `${scored} planned`,
      sub: `${hits} on pitch · ${Math.max(0, scored - hits)} missed.`,
    },
    {
      label: 'Accuracy',
      value: percentText(score.accuracy),
      sub: `${hits} of ${scored} notes on pitch.`,
    },
    {
      label: 'Timing',
      value: msText(medianMs),
      sub: 'Median offset.',
    },
    unguided,
  ];
}

// Interpolates the counts it is given and never compares them: every threshold and
// streak arrives from the engine, so the panel cannot drift from the fade policy.
export function hintDecisionText({ levelChange = {}, streaks = {}, levelNames = HINT_LEVEL_NAMES } = {}) {
  const change = levelChange || {};
  const fromLevel = change.fromLevel === undefined ? 0 : change.fromLevel;
  const toLevel = change.toLevel === undefined ? fromLevel : change.toLevel;
  const fromName = levelNames[fromLevel] || levelNames[0];
  const toName = levelNames[toLevel] || fromName;
  const clean = streaks.clean || { count: 0, needed: 0 };
  const fail = streaks.fail || { count: 0, allowed: 0 };
  const reasonKey = change.reasonKey;
  const key = reasonKey === 'advance' ? 'advance'
    : reasonKey === 'holdFail' ? 'holdFail'
      : reasonKey === 'holdSkip' ? 'holdSkip'
        : reasonKey === 'demote' ? 'demote'
          : reasonKey === 'asked' ? 'asked'
            : 'holdClean';
  const values = {
    nextName: toName,
    toName,
    fromName,
    name: toName,
    k: key === 'holdFail' ? fail.count : clean.count,
    needed: clean.needed,
    allowed: fail.allowed,
  };
  return fillTemplate(PASS_DECISIONS[key], values);
}

// FADE-09: a pass with a Brighter press is guided. The label is locked copy (CONTEXT
// "Honest credit") and is defined once here.
export const GUIDED_LINE = 'Guided — you asked for more light';

// The result's guided copy is keyed on the recall attempt alone: an earlier brightened
// with-lights pass must never hide a real recall that followed it. Null keeps the
// recall-based copy.
export function guidedResultView(summary) {
  if (!summary || !summary.recall || summary.recall.guided !== true) return null;
  return {
    verdict: 'Not yet',
    heroSub: `${GUIDED_LINE}. A recall counts only with no lights all the way through.`,
    noLightsValue: '0 passes',
    noLightsSub: GUIDED_LINE,
  };
}

export function withHintsSubText({ clean = 0, endedAtLevel = 0, guided = 0 } = {}, { levelNames = HINT_LEVEL_NAMES } = {}) {
  const base = `${clean} clean · ended at ${levelNames[endedAtLevel] || levelNames[0]}`;
  return Number.isInteger(guided) && guided > 0 ? `${base} · ${guided} guided` : base;
}

// The review names the pass by its credited level (the brightest level used, as the
// engine recorded it), not the level the pass ended on after a mid-pass Darker.
export function passReviewView({ last = null, levelChange = null, hintLevel = 0 } = {}) {
  const fromLevel = last && Number.isInteger(last.hintLevel) ? last.hintLevel
    : levelChange && Number.isInteger(levelChange.fromLevel) ? levelChange.fromLevel
      : hintLevel;
  return {
    fromLevel,
    levelName: HINT_LEVEL_NAMES[fromLevel] || HINT_LEVEL_NAMES[0],
    guided: !!(last && last.brightened === true),
  };
}

// One announcement per pass boundary, never per frame. The sentence names the level
// the next pass starts at and the clean count needed to remove the next hint.
export function hintAnnouncementText({ levelChange = {}, streaks = {}, levelNames = HINT_LEVEL_NAMES } = {}) {
  const change = levelChange || {};
  const toLevel = change.toLevel === undefined ? (change.fromLevel || 0) : change.toLevel;
  const name = levelNames[toLevel] || levelNames[0];
  const clean = streaks.clean || { count: 0, needed: 0 };
  return `Hint level ${toLevel + 1} of 4, ${name}. ${clean.count} of ${clean.needed} clean passes.`;
}

export function resultMetaText(summary, { levelNames = HINT_LEVEL_NAMES } = {}) {
  const content = summary.content || {};
  const scale = ownEntry(scaleById, content.scaleId);
  const keyPc = keyPcOf(content);
  const positions = scale ? positionsForScale(keyPc, scale) : [];
  const position = positions.find(p => p.id === content.positionId);
  const positionLabel = content.positionId === 'all' || !position ? 'Whole neck' : position.label;
  const scaleName = scale ? scale.name.toLowerCase() : '';
  const keyName = KEY_NAMES[keyPc] || '';
  const direction = DIRECTION[summary.direction] || 'Up & down';
  const startName = levelNames[summary.startLevel] || levelNames[0];
  const finalName = levelNames[summary.finalLevel] || levelNames[0];
  // A wait-mode drill has no tempo, so its metadata line carries the question kind
  // instead of a BPM the family never ran at.
  if (summary.kind === 'findNote') {
    const kind = QUIZ_QUESTION_LABELS[content.quizQuestion] || QUIZ_QUESTION_LABELS.note;
    return `${keyName} ${scaleName} · ${positionLabel} · ${kind} · Hints: ${startName} → ${finalName}`.replace(/^\s+/, '');
  }
  // A play-along names the item and its key where the scale families name a scale: the
  // progression's own curated name, the key it was played in and the bar grid it planned.
  if (summary.kind === 'progression') {
    const prog = ownEntry(progressionById, content.progressionId);
    const name = prog ? prog.name : 'Progression';
    const bars = Number.isFinite(summary.bars) ? summary.bars : 0;
    return `${summary.bpm} BPM · ${name} in ${keyName} · ${bars} bars · Hints: ${startName} → ${finalName}`;
  }
  // A song names its title, the section it played with its repeats and the key, so the
  // longest line in the product reads `84 BPM · Will the Circle Be Unbroken · Verse ×2 ·
  // Hints: Full pattern → No lights` (UI-SPEC long-text row).
  if (summary.kind === 'song') {
    const { song, section } = songSectionOf(content);
    const title = song ? song.title : 'Song';
    const token = section ? sectionToken(section.name, section.repeats) : '';
    const where = token ? `${title} · ${token}` : title;
    return `${summary.bpm} BPM · ${where} · Hints: ${startName} → ${finalName}`;
  }
  return `${summary.bpm} BPM · ${direction} · ${keyName} ${scaleName} · ${positionLabel} · Hints: ${startName} → ${finalName}`;
}

// Exactly one hint action: Blink pattern at Hint on demand (index 2) flashes the full
// pattern once. Brighter covers every other request for more light (08-04 retired the
// v1 Show hint and its restart-lower confirm).
export function hintActionFor(level = 0) {
  return level === 2 ? 'blink' : null;
}

// Under 60 s reads in seconds; otherwise whole minutes, never below 1 min. One rule
// for the result tile, the history list and the two minute totals.
export function durationText(ms) {
  const value = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (value < 60000) return `${Math.floor(value / 1000)} s`;
  return `${Math.max(1, Math.round(value / 60000))} min`;
}

export const unguidedText = durationText;

// ---------- Progress panel copy and pure formatters ----------
export const SKILL_STATE_LABELS = { mastered: 'Recalled', due: 'Due', learning: 'Learning', lapsed: 'Lapsed' };
export const EMPTY_PROGRESS_HEADING = 'Nothing recorded yet';
export const EMPTY_PROGRESS_BODY = 'Finish a drill and your minutes, streak and mastery appear here. Everything stays in this browser.';
export const EMPTY_DUE = 'Nothing due. Play a new skill or repeat your weakest.';
// The Chord pairs section shows this line inside a populated panel and is hidden only in
// the whole-panel empty state, where every list is empty anyway.
export const CHORD_PAIR_LABEL = 'Chord pairs';
export const EMPTY_CHORD_PAIRS = 'No chord pairs yet. Run a chord-change drill to record a pair.';
export const ALL_PAIRS_PREFIX = 'All pairs';
export const IMPORT_MESSAGE = {
  foreign: 'That file is not a Guitar Coach backup. Choose the JSON file you exported from Guitar Coach.',
  newer: 'This backup was made by a newer version of Guitar Coach. Update the app, then import again.',
  corrupt: 'The file could not be read. Choose the file again.',
  oversized: 'The file could not be read. Choose the file again.',
  running: 'Stop the drill or finish this pass, then import.',
};
export const EXPORT_FAILED = `Export failed. Try again, or copy your data from the browser's storage.`;
export const STORAGE_MESSAGE = {
  writeFailed: 'Progress could not be saved. Storage may be full or blocked. Export a backup.',
  readFailed: 'Your saved progress could not be read. New practice is saved from now on.',
};

export const countText = (n, one, many) => {
  const value = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  return `${value} ${value === 1 ? one : many}`;
};

// The two number formats every mic surface shares. A percentage is the only way a 0–1
// ratio is ever printed, and a millisecond offset uses the real minus sign with one space
// before the unit. Both answer `—` for "not measured": the app never prints `0%` or `0 ms`
// where the pass produced nothing (D-50).
export function percentText(value, whole) {
  const ratio = Number.isFinite(whole) && whole > 0 ? value / whole : value;
  if (!Number.isFinite(ratio)) return '—';
  return `${Math.round(ratio * 100)}%`;
}

export function msText(value) {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  if (rounded === 0) return '0 ms';
  return `${rounded < 0 ? '−' : ''}${Math.abs(rounded)} ms`;
}

// D-52's gate: one spot line per key per pass. `shown` is the pass's own list, so the
// caller owns when the three moments happened and this function owns whether the line
// has already been said — never both.
export function spotLineText(key) {
  return typeof key === 'string' && Object.hasOwn(SPOT_LINES, key) ? SPOT_LINES[key] : null;
}

export function spotGate({ shown = [], key } = {}) {
  const list = Array.isArray(shown) ? shown.slice() : [];
  const line = spotLineText(key);
  if (line === null || list.includes(key)) return { line: null, shown: list };
  list.push(key);
  return { line, shown: list };
}

// WR-06: the hero's review promise comes from the record's dueAt, not a fixed day.
export function nextReviewText(dueAt, now = Date.now()) {
  const days = Number.isFinite(dueAt) ? Math.max(1, daysBetween(now, dueAt)) : 1;
  return `Mastered today · next review in ${countText(days, 'day', 'days')}.`;
}

// A skill label is derived from the stored content ids, never stored as text (T-02-10).
// The family decides the wording: a note skill must not read as a scale, and a chord
// skill names its ordered pair rather than a key and a position it never ran in.
export function skillLabelText(content = {}, kind = '') {
  const source = content && typeof content === 'object' ? content : {};
  // A record written before the family field existed still names its own family: only the
  // chord family stores a pair id, only the quiz stores a question kind, only a play-along
  // stores a progression id and only a song stores a song id. `''` is "no id" for both
  // play-along families, so an empty string never claims the other family's wording.
  const family = kind || (typeof source.pairId === 'string' ? 'chordChanges'
    : (typeof source.quizQuestion === 'string' ? 'findNote'
      : (typeof source.songId === 'string' && source.songId !== '' ? 'song'
        : (typeof source.progressionId === 'string' && source.progressionId !== '' ? 'progression' : ''))));
  if (family === 'chordChanges') {
    const pair = ownEntry(chordPairById, source.pairId);
    const label = pair
      ? pair.label
      : (Array.isArray(source.chords) ? source.chords.filter(chord => typeof chord === 'string').join(' → ') : '');
    return label ? `Chord changes · ${label}` : 'Chord changes';
  }
  // A progression skill names its curated item and the key it was played in. An id that no
  // longer resolves still reads as one word rather than as a scale in the wrong key (T-02-10).
  if (family === 'progression') {
    const prog = ownEntry(progressionById, source.progressionId);
    const keyName = KEY_NAMES[keyPcOf(source)] || '';
    return prog ? `Progression · ${prog.name} in ${keyName}` : 'Progression';
  }
  // A song skill names its title, the section it played and the key: `Song · Amazing Grace ·
  // Verse in G`. A record whose song or section no longer resolves keeps the one word, so no
  // stale id is ever rendered as a different song's section (T-02-10, T-04-21).
  if (family === 'song') {
    const { song, section } = songSectionOf(source);
    const keyName = KEY_NAMES[keyPcOf(source)] || '';
    return song && section ? `Song · ${song.title} · ${section.name} in ${keyName}` : 'Song';
  }
  const scale = ownEntry(scaleById, source.scaleId);
  const keyPc = keyPcOf(source);
  const positions = scale ? positionsForScale(keyPc, scale) : [];
  const position = positions.find(p => p.id === source.positionId);
  const positionLabel = source.positionId === 'all' || !position ? 'Whole neck' : position.label;
  const keyName = KEY_NAMES[keyPc] || '';
  const scaleName = scale ? scale.name.toLowerCase() : '';
  const scaleLabel = `${keyName} ${scaleName} · ${positionLabel}`.replace(/^\s+/, '');
  return family === 'findNote' ? `Note finding · ${scaleLabel}` : scaleLabel;
}

// ---------- The neck you own (PROG-08) ----------
// Pure view of the Progress neck: every cell of every drilled scale box, shaded by the best
// light level reached in that box (max where boxes overlap). The rows are the ones the
// Scales bar counts (`skillFamily`, which also places legacy kind:null rows), and the boxes
// are the drills' own `positionsForScale` boxes. Whole-neck skills are not boxes and stay
// off the map; unknown scales and stale position ids are skipped, own-key only.
export function ownedNeckView(rows = []) {
  const cells = new Map();
  const boxes = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object' || skillFamily(row) !== 'scales') continue;
    const content = row.content && typeof row.content === 'object' ? row.content : {};
    const scale = ownEntry(scaleById, content.scaleId);
    if (!scale || content.positionId === 'all') continue;
    const box = positionsForScale(keyPcOf(content), scale).find(p => p.id === content.positionId);
    if (!box) continue;
    const level = lightLevelOf(row);
    for (let s = 1; s <= 6; s++) {
      const [lo, hi] = box.ranges[s];
      for (let f = Math.max(0, lo); f <= Math.min(OWNED_FRETS, hi); f++) {
        const key = `${s}:${f}`;
        if (!cells.has(key) || cells.get(key) < level) cells.set(key, level);
      }
    }
    boxes.push({ label: skillLabelText(content, row.kind || ''), level });
  }
  boxes.sort((a, b) => a.label.localeCompare(b.label));
  return { cells, boxes };
}
// ---------- end ownedNeckView ----------

// A chord pair is named by its curated label (`C → G`); a pair that is no longer in the
// table still reads from its stored ordered chord ids.
export function chordPairLabelText(row = {}) {
  const pair = ownEntry(chordPairById, row.pairId);
  if (pair) return pair.label;
  const chords = Array.isArray(row.chords) ? row.chords.filter(chord => typeof chord === 'string') : [];
  return chords.join(' → ');
}

export function playedText(lastPlayedAt, now = Date.now()) {
  if (!Number.isFinite(lastPlayedAt)) return 'not played yet';
  const days = Math.max(0, daysBetween(lastPlayedAt, now));
  if (days === 0) return 'played today';
  return `played ${countText(days, 'day', 'days')} ago`;
}

// The pair row's second line: clean rate, changes per minute, best tempo and when it was
// last played. Percentages are whole numbers so the column never jitters.
export function chordPairRowText(row = {}, now = Date.now()) {
  const attempts = Number.isFinite(row.attempts) ? Math.max(0, row.attempts) : 0;
  const clean = Number.isFinite(row.clean) ? Math.max(0, Math.min(attempts, row.clean)) : 0;
  const pct = attempts > 0 ? Math.round((clean / attempts) * 100) : 0;
  const perMinute = Number.isFinite(row.changesPerMin) ? Math.max(0, row.changesPerMin) : 0;
  const best = Number.isFinite(row.bestBpm) ? Math.max(0, row.bestBpm) : 0;
  return `${pct}% clean · ${perMinute} changes/min · best ${best} BPM · ${playedText(row.lastPlayedAt, now)}`;
}

// The skill row's optional third line: microphone evidence only, never a placeholder.
// 03-03 owns the scoring that fills it; a record without evidence draws no line at all.
export function micEvidenceText(row = {}) {
  if (!row || row.micUsed !== true) return '';
  const parts = [];
  if (Number.isFinite(row.accuracy)) {
    parts.push(`${Math.round(Math.max(0, Math.min(1, row.accuracy)) * 100)}% accuracy`);
  }
  if (Number.isFinite(row.medianTimingMs)) parts.push(`${Math.round(row.medianTimingMs)} ms median`);
  return parts.join(' · ');
}

// WR-05: `lastPlayedAt` is updated by every drill, including a with-hints-only or
// stopped session. Only a clean recall may be called "recalled".
export function recalledText(lastCleanRecallAt, now = Date.now()) {
  if (!Number.isFinite(lastCleanRecallAt)) return 'not recalled yet';
  const days = Math.max(0, daysBetween(lastCleanRecallAt, now));
  if (days === 0) return 'recalled today';
  return `recalled ${countText(days, 'day', 'days')} ago`;
}

export function skillRowText(row = {}, now = Date.now()) {
  const levelName = HINT_LEVEL_NAMES[row.bestLevel] || HINT_LEVEL_NAMES[0];
  return `${row.bestBpm || 0} BPM · ${levelName} · ${recalledText(row.lastCleanRecallAt, now)} · ${countText(row.cleanPasses || 0, 'clean pass', 'clean passes')}${Number.isFinite(row.retainedAt) ? ' · retained on a later independent check' : ''}`;
}

export function dueText(dueAt, now = Date.now()) {
  if (!Number.isFinite(dueAt)) return 'due now';
  const days = daysBetween(now, dueAt);
  if (days === 0) return 'due today';
  if (days > 0) return `due in ${countText(days, 'day', 'days')}`;
  return `overdue by ${countText(-days, 'day', 'days')}`;
}



function option(value, label) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
}

// ---------- The daily session's copy (05-01) ----------
// One table of block names, one table of state chips and one table of reasons, so the five plan
// rows, the boundary token and the Practise view can never describe the same block two ways.
// Every sentence is built here from the raw content ids the planner carried; no display string
// is ever stored, and nothing in this block is data-derived markup (T-05-06).
export const SESSION_BLOCK_NAMES = {
  warmup: 'Warm-up', focus: 'Focus', new: 'New material', play: 'Play-along', recall: 'Recall',
};
export const SESSION_STATE_LABELS = { now: 'Now', pending: 'Next', done: 'Done', skipped: 'Skipped' };

const keyNameOf = keyPc => KEY_NAMES[Number.isInteger(keyPc) && keyPc >= 0 && keyPc <= 11 ? keyPc : 0] || 'C';
const progressionNameOf = id => {
  const prog = ownEntry(progressionById, id);
  return prog ? prog.name : 'Progression';
};

// The eleven approved sentences (05-UI-SPEC "the five reasons"). Each is a function over raw
// values so the ids decide the wording and the planner never hands over a finished sentence.
export const SESSION_REASONS = {
  alwaysFirst: () => 'Always first — a scale run to set your hands.',
  due: ({ kind = '', content = {} } = {}) => `Due today — ${skillLabelText(content, kind)}.`,
  weakestPair: ({ pairId = '', chords = [], changesPerMin = 0 } = {}) => {
    const perMinute = Number.isFinite(changesPerMin) ? Math.max(0, Math.round(changesPerMin)) : 0;
    return `Weakest pair — ${chordPairLabelText({ pairId, chords })}, ${perMinute} changes/min.`;
  },
  noHistory: () => 'No history yet — the first curated skill.',
  leastPlayed: ({ kind = '', content = {} } = {}) => `Least practised — ${skillLabelText(content, kind)}.`,
  newToYou: ({ kind = '', content = {} } = {}) => `New to you — ${skillLabelText(content, kind)}.`,
  weakestProgression: ({ progressionId = '', keyPc = 0 } = {}) =>
    `Weakest progression — ${progressionNameOf(progressionId)} in ${keyNameOf(keyPc)}.`,
  dueSong: ({ songId = '', sectionId = '', keyPc = 0 } = {}) => {
    const { song, section } = songSectionOf({ songId, sectionId });
    const title = song ? song.title : 'Song';
    const token = section ? sectionToken(section.name, section.repeats) : '';
    return `Due — ${token ? `${title} · ${token}` : title} in ${keyNameOf(keyPc)}.`;
  },
  noPlayAlong: () => 'No play-along yet — I–IV–V in C.',
  recallFocus: () => 'No lights — the focus skill, played unaided.',
  unavailable: () => 'Unavailable — skipped.',
};

// One sentence per block, and `Unavailable — skipped.` is the answer for a reason this build
// does not know, so a stale plan row can never render an empty line.
export function sessionReasonText({ reasonKey = '', values = {} } = {}) {
  const key = typeof reasonKey === 'string' ? reasonKey : '';
  const formatter = Object.hasOwn(SESSION_REASONS, key) ? SESSION_REASONS[key] : SESSION_REASONS.unavailable;
  return formatter(values && typeof values === 'object' ? values : {});
}

// ---------- Today coach: result cards and coach lines (09-01, TODAY-01/02) ----------
// `session.coachScript` answers keys; every sentence the coach says is written here, and the
// result card words the light change with the app-wide level names.
export const RESULT_OUTCOME_WORDS = { clean: 'Clean', shaky: 'Shaky', guided: 'Guided', skipped: 'Skipped', stopped: 'Stopped early' };
const levelNameOf = n => HINT_LEVEL_NAMES[Math.max(0, Math.min(3, Number.isFinite(n) ? Math.trunc(n) : 0))];
const blockNameOf = kind => (Object.hasOwn(SESSION_BLOCK_NAMES, kind) ? SESSION_BLOCK_NAMES[kind] : SESSION_BLOCK_NAMES.focus);

export function lightChangeText(from, to) {
  const start = levelNameOf(from);
  const end = levelNameOf(to);
  return start === end ? `Stayed at ${start}` : `${start} → ${end}`;
}

// A to-level brighter than the from-level is a light that came back, and the card says so.
const brighterText = (from, to) => (levelIndexOf(to) < levelIndexOf(from)
  ? `A light came back · ${lightChangeText(from, to)}`
  : lightChangeText(from, to));

// One card per finished block: name, outcome word, light change, the guided line only when a
// pass was brightened, and the recorded minutes. A skipped block has no change and no minutes.
export function resultCardView(block = {}) {
  const source = block && typeof block === 'object' ? block : {};
  const result = source.result && typeof source.result === 'object' ? source.result : {};
  const key = typeof result.outcome === 'string' && Object.hasOwn(RESULT_OUTCOME_WORDS, result.outcome) ? result.outcome : 'shaky';
  const skipped = key === 'skipped';
  return {
    title: blockNameOf(source.kind),
    outcome: RESULT_OUTCOME_WORDS[key],
    change: skipped ? '' : brighterText(result.fromLevel, result.toLevel),
    guided: !skipped && result.guided === true ? GUIDED_LINE : '',
    minutes: skipped ? '' : durationText(result.activeMs),
  };
}

// The coach's lines. Each formatter reads the line's values and the plan's blocks, so a result
// line words the block's own stored result and never a sentence the reducer handed over.
const blockAt = (blocks, index) => {
  const list = Array.isArray(blocks) ? blocks : [];
  const block = Number.isInteger(index) ? list[index] : null;
  return block && typeof block === 'object' ? block : {};
};
const wholeOf = n => (Number.isInteger(n) && n > 0 ? n : 0);
const levelIndexOf = n => Math.max(0, Math.min(3, Number.isFinite(n) ? Math.trunc(n) : 0));
// The coach's tone (09-CONTEXT): second person, plain, encouraging but honest. A guided pass is
// never called clean — it opens with `GUIDED_LINE` and keeps its level — and every next line
// names the block, the light level it starts at and the plan's own reason sentence.
// The line's own values win; a line without them reads the block's stored result.
const resultLine = (values = {}, blocks = []) => {
  const block = blockAt(blocks, values.index);
  const stored = block.result && typeof block.result === 'object' ? block.result : {};
  const own = typeof values.outcome === 'string';
  const outcome = own ? values.outcome : stored.outcome;
  const fromLevel = levelIndexOf(own ? values.fromLevel : stored.fromLevel);
  const toLevel = levelIndexOf(own ? values.toLevel : stored.toLevel);
  const name = blockNameOf(typeof values.kind === 'string' && values.kind ? values.kind : block.kind);
  const from = HINT_LEVEL_NAMES[fromLevel];
  const to = HINT_LEVEL_NAMES[toLevel];
  if (outcome === 'skipped') return `You skipped ${name}. It stays on the list for another day.`;
  if (outcome === 'stopped') return `${name}: stopped early — it stays at ${from}.`;
  if (outcome === 'guided') return `${GUIDED_LINE}. ${name} stays at ${to} until you play it unaided.`;
  if (outcome === 'clean') {
    if (toLevel > fromLevel) {
      return `${name}: clean at ${to}. You earned fewer lights — ${lightChangeText(fromLevel, toLevel)}.`;
    }
    // Two shaky passes can bring a light back mid-block, so a clean pass may land brighter than
    // the block started: that is a light gained, never a level held (WR-01).
    if (toLevel < fromLevel) {
      return `${name}: clean once a light came back — ${lightChangeText(fromLevel, toLevel)}. Next time we try ${from} again.`;
    }
    return `${name}: clean — you held ${to}.`;
  }
  return `${name}: not clean yet, so it stays at ${from}. Another pass will get there.`;
};
export const COACH_LINES = {
  intro: ({ blocks = 0, minutes = 0, due = 0, streak = 0, noHistory = false } = {}) => {
    const size = `${countText(wholeOf(blocks), 'block', 'blocks')}, about ${wholeOf(minutes)} minutes`;
    const parts = [noHistory === true ? `Your first session: ${size}.` : `Today: ${size}.`];
    if (wholeOf(due) > 0) parts.push(`${countText(wholeOf(due), 'review', 'reviews')} due.`);
    if (wholeOf(streak) > 0) parts.push(`You are on a ${wholeOf(streak)}-day streak.`);
    return parts.join(' ');
  },
  result: resultLine,
  // Every next line names the block, the level it will start at and the plan's own reason.
  next: ({ kind = '', level, reasonKey = '', reasonValues = {} } = {}) => {
    const at = Number.isInteger(level) && level >= 0 && level <= 3 ? ` at ${HINT_LEVEL_NAMES[level]}` : '';
    return `Next: ${blockNameOf(kind)}${at}. ${sessionReasonText({ reasonKey, values: reasonValues })}`;
  },
  now: ({ kind = '' } = {}) => `${blockNameOf(kind)} is under way in Practice.`,
  finish: () => 'That was the last block. Press Finish session to see your day.',
  allDone: ({ completed = 0, skipped = 0 } = {}) => {
    const done = `${countText(wholeOf(completed), 'block', 'blocks')} played`;
    const missed = wholeOf(skipped) > 0 ? `, ${wholeOf(skipped)} skipped` : '';
    return `Session done — ${done}${missed}. Your summary is below.`;
  },
};

export function coachLineText(line = {}, blocks = []) {
  const source = line && typeof line === 'object' ? line : {};
  const key = typeof source.key === 'string' ? source.key : '';
  if (!Object.hasOwn(COACH_LINES, key)) return '';
  return COACH_LINES[key](source.values && typeof source.values === 'object' ? source.values : {}, blocks);
}

// The one Continue's label: the next pending block by name, or the finish when nothing is left.
export function coachContinueText(blocks = []) {
  const list = Array.isArray(blocks) ? blocks : [];
  const next = list.find(block => block && typeof block === 'object' && block.state === 'pending');
  return next ? `Continue: ${blockNameOf(next.kind)}` : 'Finish session';
}

// The Today tab's accessible name (Phase 6): the count at idle, the block index while a session
// runs, and the bare tab name when nothing is due. `index` is the session's own zero-based block
// index, so the spoken form is `block 2 of 5` and never `block 1 of 5` for the second block (A-69).
export function todayTabLabel({ dueCount = 0, running = false, index = 0, total = 5 } = {}) {
  const at = (Number.isInteger(index) ? Math.max(0, index) : 0) + 1;
  const size = Number.isFinite(total) && total > 0 ? Math.trunc(total) : 5;
  if (running) return `Today, block ${Math.min(at, size)} of ${size}`;
  const count = Number.isFinite(dueCount) ? Math.max(0, Math.trunc(dueCount)) : 0;
  return count > 0 ? `Today, ${count} due` : 'Today';
}

// The session's four announcements, in one table so the one live region can never read a second
// wording for the same event: the plan opening, a block starting, a block's result boundary and
// the summary. The boundary sentence is the prefix `main` puts in front of the drill's own result
// sentence, so a block's result is still one announcement (05-UI-SPEC "Screen-reader contract").
export function sessionAnnouncementText({ key = '', values = {} } = {}) {
  const source = values && typeof values === 'object' ? values : {};
  const positionText = () => {
    const index = Number.isFinite(source.index) ? Math.max(1, Math.trunc(source.index)) : 1;
    const total = Number.isFinite(source.total) && source.total > 0 ? Math.trunc(source.total) : 5;
    return `Block ${Math.min(index, total)} of ${total}`;
  };
  if (key === 'session-ready') {
    const blocks = Number.isFinite(source.blocks) ? Math.max(0, Math.trunc(source.blocks)) : 5;
    const minutes = Number.isFinite(source.minutes) ? Math.max(0, Math.trunc(source.minutes)) : 13;
    const word = NUMBER_WORDS[blocks] ? NUMBER_WORDS[blocks].toLowerCase() : String(blocks);
    return `Session ready — ${word} blocks, ${minutes} minutes.`;
  }
  if (key === 'session-block') {
    const name = Object.hasOwn(SESSION_BLOCK_NAMES, source.kind)
      ? SESSION_BLOCK_NAMES[source.kind]
      : SESSION_BLOCK_NAMES.focus;
    return `${positionText()}. ${name}.`;
  }
  if (key === 'session-boundary') return `${positionText()} done.`;
  if (key === 'session-complete') {
    const minutes = Number.isFinite(source.minutes) ? Math.max(0, Math.trunc(source.minutes)) : 0;
    const unguided = Number.isFinite(source.unguided) ? Math.max(0, Math.trunc(source.unguided)) : 0;
    return `Session complete. ${minutes} minutes, ${unguided} minutes unguided.`;
  }
  // An unknown key answers the empty string, so `announce` is never called with nothing to say.
  return '';
}

// The summary's one next suggestion. Three approved sentences and nothing else: the focus skill's
// whole days, the weakest pair, or the honest `nothing due`, which is also the fallback for a key
// this build does not know. A due date that has already passed is due *now* — `in 0 days` is not a
// sentence the product says (WR-06).
export function sessionNextText({ key = '', values = {} } = {}) {
  const source = values && typeof values === 'object' ? values : {};
  if (key === 'dueAgain') {
    const days = Number.isFinite(source.days) ? Math.max(0, Math.trunc(source.days)) : 0;
    return days > 0
      ? `Next: the focus skill is due again in ${countText(days, 'day', 'days')}.`
      : 'Next: the focus skill is due again now.';
  }
  if (key === 'weakestPair') return 'Next: practise the weakest pair tomorrow.';
  return 'Next: nothing due — pick a new family.';
}

// ---------- The Practise view and the recommendation strip (05-01 Task 3) ----------
// The five one-line items a family row carries (05-UI-SPEC "Practise view"). Each is derived from
// the same stored ids the seed writes, so the line a player reads is the drill they get; no line
// is ever stored, and none is parsed as markup (T-05-06).
const PRACTISE_QUESTION_WORDS = { note: 'Notes', degree: 'Degrees', interval: 'Intervals' };

export function practiseItemText({ family = 'scaleRun', target = {}, bpm = 0 } = {}) {
  const source = target && typeof target === 'object' ? target : {};
  const keyName = KEY_NAMES[keyPcOf(source)] || '';
  const scale = ownEntry(scaleById, source.scaleId);
  const positions = scale ? positionsForScale(keyPcOf(source), scale) : [];
  const position = positions.find(entry => entry.id === source.positionId);
  const positionLabel = source.positionId === 'all' || !position ? 'Whole neck' : position.label;
  const tempo = Number.isFinite(bpm) && bpm > 0 ? Math.round(bpm) : (Number.isFinite(source.bpm) ? Math.round(source.bpm) : 0);
  if (family === 'findNote') {
    const word = PRACTISE_QUESTION_WORDS[source.quizQuestion] || PRACTISE_QUESTION_WORDS.note;
    return `${word} · ${positionLabel} · ${keyName}`.replace(/^\s+/, '');
  }
  if (family === 'chordChanges') {
    const label = chordPairLabelText({ pairId: source.chordPairId, chords: source.chords });
    return `${label || 'Chord pair'} · ${tempo} BPM`;
  }
  if (family === 'progression') {
    const prog = ownEntry(progressionById, source.progressionId);
    return `${prog ? prog.name : 'Progression'} · ${keyName}`;
  }
  if (family === 'song') {
    // The section is the target's own `songSectionId` and, when it is empty or stale, the song's
    // first section — the same resolution `validateSettings` performs on the way into the record,
    // so the line names the section the seed would actually load (A-57).
    const song = ownEntry(songById, source.songId);
    const sections = song && Array.isArray(song.sections) ? song.sections : [];
    const section = sections.find(entry => entry && entry.id === source.songSectionId) || sections[0] || null;
    const title = song ? song.title : 'Song';
    const token = section ? sectionToken(section.name, section.repeats) : '';
    const where = token ? `${title} · ${token}` : title;
    return `${where} · ${keyName}`;
  }
  const scaleName = scale ? scale.name : 'Scale';
  return `${scaleName} · ${positionLabel} · ${keyName}`.replace(/^\s+/, '');
}

// The four recommendations, as one approved sentence each (05-UI-SPEC "Recommendation strip").
// `Next drill` names the caller's next item; every other key names only itself.
export function recommendationText({ key = 'repeat', phase = 'passReview', nextLabel = '', bpm = 0 } = {}) {
  if (key === 'stop') return 'Suggested next: stop here.';
  if (key === 'next') {
    const label = typeof nextLabel === 'string' && nextLabel.trim() !== '' ? nextLabel.trim() : 'the next drill';
    return `Suggested next: ${label}.`;
  }
  if (key === 'bpm') {
    const tempo = Number.isFinite(bpm) && bpm > 0 ? Math.round(bpm) : 0;
    return `Suggested next: repeat at ${tempo} BPM.`;
  }
  return phase === 'result' ? 'Suggested next: repeat this drill.' : 'Suggested next: repeat this pass.';
}

// A-75: the strip renders its own button only when the recommended action has none in the visible
// action rows. `Repeat`, `+BPM` and `Stop` always already have one; `Next drill` does not — except
// at a session block's result, where the boundary's `Next block` is on screen. The flag is the
// boundary's visibility, not the session's, because a pass review inside a block draws no boundary
// at all and must still offer a way to take the suggestion (WR-05).
export function recommendationNeedsButton({ key = 'repeat', boundary = false } = {}) {
  return key === 'next' && !boundary;
}

// The five family names the Practise view's rows carry, in the fixed order — the same words the
// stage's own family picker shows, so one family is never named two ways in one product.
export const PRACTISE_FAMILY_NAMES = {
  scaleRun: 'Scale run', findNote: 'Find the note', chordChanges: 'Chord changes',
  progression: 'Progression', song: 'Song',
};

// ---------- The micro-lesson (05-02 Task 1, D-75) ----------
// The four approved labels in the approved order, and the sentence a family with an unwritten
// field renders instead of an empty block. One table, so the panel and its pin cannot disagree.
export const LESSON_LABELS = ['Why it matters', 'Common mistake', 'Try this without the app', 'Lesson'];
export const NOT_WRITTEN = 'Not written yet.';
// The content field behind each label. The fourth block's body is the link's own label, because a
// written destination is the only thing that block can say.
const LESSON_FIELDS = ['why', 'mistake', 'practice', 'linkLabel'];
// Four label-and-body pairs, always four: a missing or non-string field reads `Not written yet.`
// rather than an empty body, so a partly written lesson is a legitimate shipped state (TEACH-01).
export function lessonBlocksText(lesson = {}) {
  const source = lesson && typeof lesson === 'object' ? lesson : {};
  return LESSON_LABELS.map((label, i) => {
    const value = source[LESSON_FIELDS[i]];
    return { label, body: typeof value === 'string' && value.trim() !== '' ? value : NOT_WRITTEN };
  });
}

// The one external destination. A written `link` and `linkLabel` together make an anchor; a
// half-written pair, an empty pair or an address that is not https makes none, so a downgraded
// lesson renders `Not written yet.` in the fourth block instead of a dead link (T-05-11).
export function lessonLinkView(lesson = {}) {
  const source = lesson && typeof lesson === 'object' ? lesson : {};
  const href = typeof source.link === 'string' ? source.link.trim() : '';
  const label = typeof source.linkLabel === 'string' ? source.linkLabel.trim() : '';
  const written = href !== '' && label !== '' && /^https:\/\/\S+$/.test(href);
  return { label: written ? label : '', href: written ? href : null, helper: 'Opens in a new tab.' };
}

// The watch-and-read list. Same rule as the one anchor: a half-written pair is not a link,
// and an address that is not https never reaches an href. These open outside the app; no
// player, iframe or stream is ever created (TEACH-02).
export function lessonVideosView(lesson = {}) {
  const source = lesson && typeof lesson === 'object' ? lesson : {};
  const list = Array.isArray(source.videos) ? source.videos : [];
  const clean = value => (typeof value === 'string' ? value.trim() : '');
  return list
    .filter(item => item && clean(item.label) !== '' && /^https:\/\/\S+$/.test(clean(item.href)))
    .map(item => ({
      label: clean(item.label),
      href: clean(item.href),
      embed: /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]+$/.test(clean(item.embed))
        ? clean(item.embed) : '',
      source: clean(item.source),
      note: clean(item.note),
    }));
}

// The one self-hosted clip. Paths are literals in the content table and this guard only lets a
// local app/assets/videos MP4 through, so a hand-edited record can never turn the player into
// a remote embed. The poster is optional and follows the same local-only rule.
export function lessonDemoView(lesson = {}) {
  const source = lesson && typeof lesson === 'object' ? lesson : {};
  const demo = source.demo;
  if (!demo || typeof demo !== 'object') return null;
  const clean = value => (typeof value === 'string' ? value.trim() : '');
  const src = clean(demo.src);
  const poster = clean(demo.poster);
  if (!/^\.\/assets\/videos\/[a-z0-9-]+\.mp4$/.test(src)) return null;
  if (poster !== '' && !/^\.\/assets\/videos\/[a-z0-9-]+\.png$/.test(poster)) return null;
  return { src, poster, label: clean(demo.label) || 'Visual demo' };
}

// The guided half of the lesson. This is content, not state: `main` hands in the current
// selection (shape notes, chord voicings, chart bars), and this function turns it into the
// four steps and the one diagram the panel renders. It never reads settings or the DOM.
const LESSON_STRINGS = ['E', 'B', 'G', 'D', 'A', 'E'];
const CHORD_STRING_NAMES = ['low E', 'A', 'D', 'G', 'B', 'high E'];

// "Finger 2 on the A string, fret 3; ..." — the one place a voicing becomes a sentence.
export function chordPlacementText(chord = {}) {
  const frets = Array.isArray(chord.frets) ? chord.frets : [];
  const fingers = Array.isArray(chord.fingers) ? chord.fingers : [];
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const fret = frets[i];
    if (fret === null || fret === undefined) {
      parts.push(`mute the ${CHORD_STRING_NAMES[i]} string`);
      continue;
    }
    if (fret === 0) {
      parts.push(`leave the ${CHORD_STRING_NAMES[i]} string open`);
      continue;
    }
    const finger = fingers[i];
    parts.push(`${finger ? `finger ${finger}` : 'a finger'} on the ${CHORD_STRING_NAMES[i]} string, fret ${fret}`);
  }
  return parts.join('; ') + '.';
}

const lessonAction = tempo => ({
  label: `Start at ${tempo} BPM`,
  note: 'Full fade drill · count-in · several passes. Stop after any phrase.',
});

const chordListen = (chords = []) => {
  const out = [];
  (Array.isArray(chords) ? chords : []).forEach((chord, index) => {
    const base = index * 1200;
    (Array.isArray(chord.frets) ? chord.frets : []).forEach((fret, i) => {
      if (fret === null || fret === undefined) return;
      out.push({ at: base + i * 40, midi: OPEN[6 - i] + fret });
    });
  });
  return out;
};

// One finger per fret, with the open position handled honestly: at fret 0, fret 1 is finger 1,
// not finger 2. A box anchored at fret 5 starts on finger 1 at fret 5.
export function lessonFinger(fret, start = 0) {
  if (!Number.isFinite(fret) || fret <= 0) return 0;
  const anchor = Number.isFinite(start) && start > 0 ? start : 0;
  return Math.min(4, Math.max(1, fret - anchor + (anchor > 0 ? 1 : 0)));
}

export function lessonGuideView(context = {}) {
  const source = context && typeof context === 'object' ? context : {};
  const family = source.family;
  const tempo = Number.isFinite(source.tempo) && source.tempo > 0 ? Math.round(source.tempo) : 50;
  const strings = Array.isArray(source.strings) && source.strings.length === 6 ? source.strings : LESSON_STRINGS;
  const focus = [source.title, source.detail].filter(value => typeof value === 'string' && value.trim() !== '').join(' · ');

  if (family === 'scaleRun') {
    const scale = source.scale;
    if (!scale || !Array.isArray(scale.notes) || !scale.notes.length) return null;
    const root = scale.root || scale.notes.find(n => n.root) || null;
    const start = Number.isFinite(scale.start) ? scale.start : 1;
    const rootFinger = root ? lessonFinger(root.f, start) : 0;
    const blues = scale.id === 'blues';
    const blue = blues ? (scale.notes.find(n => n.blue) || null) : null;
    const steps = blues ? [
      {
        title: 'Start with the pentatonic',
        body: root
          ? `Anchor finger ${rootFinger || 1} on ${root.note} at string ${root.s}, fret ${root.f}. The rest of the shape is the minor pentatonic you already know.`
          : 'The rest of this shape is the minor pentatonic. Find the raspberry root first.',
      },
      {
        title: 'Add the blue note',
        body: blue
          ? `The dashed note is the ♭5: ${blue.note} at string ${blue.s}, fret ${blue.f}. It is the one note that makes this shape the blues scale.`
          : 'The dashed note is the ♭5, the one note that makes this shape the blues scale.',
      },
      {
        title: 'Pass through it',
        body: 'Use the ♭5 as a passing tone between the 4 and the 5. For this first exercise, touch it and move on; expressive bends and held blue notes come later.',
      },
      {
        title: 'Take the lights away',
        body: 'Repeat until you can play the shape with only the target pulsing, then once with no lights. Keep the blue note as a gesture, not a destination.',
      },
    ] : [
      {
        title: 'Anchor the root',
        body: root
          ? rootFinger > 0
            ? `Finger ${rootFinger} starts on ${root.note} at string ${root.s}, fret ${root.f}. That raspberry root is the home note for the whole shape.`
            : `The open ${root.note} string (string ${root.s}) is the root. That raspberry note is home for the whole shape.`
          : 'Find the raspberry root first. Every other note is measured from it.',
      },
      {
        title: 'Set the shape',
        body: `The dots are this shape; numbers suggest fingers 1–4. The window runs from fret ${start} to fret ${start + 4}; shift your hand when needed rather than forcing a stretch.`,
      },
      {
        title: 'Play it slowly',
        body: `Play up and back down at ${tempo} BPM. Say each note name out loud as it lands, even when the lights are on.`,
      },
      {
        title: 'Take the lights away',
        body: 'Repeat until you can play it with only the target pulsing, then once with no lights. That last pass is the one that counts.',
      },
    ];
    return {
      focus,
      shape: {
        kind: 'scale',
        title: blues ? 'The blues shape · dashed = ♭5' : 'The shape · finger numbers',
        start, frets: Number.isFinite(scale.frets) ? scale.frets : 5,
        strings, notes: scale.notes,
      },
      steps,
      listen: (() => {
        const ordered = scale.notes.slice().sort((a, b) => b.s - a.s || a.f - b.f);
        const shape = ordered.concat(ordered.slice(1, -1).reverse());
        return shape
          .filter(note => Number.isFinite(note.midi))
          .map((note, index) => ({ at: index * 320, midi: note.midi }));
      })(),
      action: lessonAction(tempo),
    };
  }

  if (family === 'chordChanges') {
    const chords = Array.isArray(source.chords) ? source.chords.filter(Boolean).slice(0, 4) : [];
    if (!chords.length) return null;
    const first = chords[0];
    const second = chords[1] || null;
    const steps = [
      {
        title: `Place ${first.name}`,
        body: chordPlacementText(first),
      },
      {
        title: second ? `Place ${second.name}` : 'Find the next shape',
        body: second
          ? chordPlacementText(second)
          : 'Keep the next shape in mind before you move; do not hunt for it after the bar turns.',
      },
      {
        title: 'Move as one block',
        body: 'Strum once on beat 1. Move every finger together on the click; a change that lands after the click is already a bar behind.',
      },
      {
        title: 'Drop the diagrams',
        body: 'At No lights the diagrams are gone. Use the root note of each shape and the bar count to stay on form.',
      },
    ];
    return {
      focus,
      shape: { kind: 'chords', title: 'The shapes · finger numbers', chords },
      steps,
      listen: chordListen(chords),
      action: lessonAction(tempo),
    };
  }

  if (family === 'findNote') {
    return {
      focus,
      shape: { kind: 'strings', title: 'Open strings · low to high', strings },
      steps: [
        {
          title: 'Tune first',
          body: 'Tune the open strings low to high: E A D G B E. The app assumes the guitar is in tune, and a wrong open string makes every fret count wrong.',
        },
        {
          title: 'Learn the open strings',
          body: 'Low to high: E A D G B E. Every fret is one half step above the open string, so the fifth fret of the A string is D.',
        },
        {
          title: 'Count from the open string',
          body: 'Name the target, then count up the frets in half steps. When the count gets long, use the octave shapes instead of counting every fret.',
        },
        {
          title: 'Say it before you play it',
          body: 'Name the note out loud, then play it. Revealing the answer is recorded as revealed, never as a correct answer.',
        },
        {
          title: 'Stop counting',
          body: 'Repeat until you can find the note without counting from the open string. That is the point where the neck becomes a map.',
        },
      ],
      action: { label: 'Start the question set', note: 'Uses your current pool · no mic needed.' },
      listen: [6, 5, 4, 3, 2, 1].map((string, index) => ({ at: index * 350, midi: OPEN[string] })),
    };
  }

  if (family === 'powerChord') {
    const chords = [
      { name: 'G5', frets: [3, 5, 5, null, null, null], fingers: [1, 3, 4, null, null, null], rootString: 6, baseFret: 3 },
      { name: 'A5', frets: [5, 7, 7, null, null, null], fingers: [1, 3, 4, null, null, null], rootString: 6, baseFret: 5 },
    ];
    return {
      focus: 'Root + fifth + octave · no third',
      shape: { kind: 'chords', title: 'The movable shape · root, fifth, octave', chords },
      steps: [
        {
          title: 'Build the shape',
          body: 'Fret the root with finger 1 on the low E string. Put finger 3 on the A string two frets higher and finger 4 on the D string two frets higher: root, fifth, octave.',
        },
        {
          title: 'Mute the thin strings',
          body: 'The G, B and high E strings are not part of the chord. Rest the side of your fretting hand on them so they stay silent.',
        },
        {
          title: 'Slide it',
          body: 'Keep the same shape and slide it: fret 3 is G5, fret 5 is A5, fret 7 is B5. The root note names the chord. The same shape with the root on the A string is the root-5 version.',
        },
        {
          title: 'Understand the name',
          body: 'A power chord has no third, so it is neither major nor minor. Distortion adds harmonics and the fifth and octave hold the chord together.',
        },
      ],
      listen: chordListen(chords),
      action: { kind: 'powerPractice', label: 'Practise G5 → A5', note: 'Click + strum · 4 bars at 70 BPM.' },
    };
  }

  if (family === 'progression' || family === 'song') {
    const bars = Array.isArray(source.bars) ? source.bars : [];
    const chords = Array.isArray(source.chords) ? source.chords.filter(Boolean).slice(0, 4) : [];
    if (!bars.length) return null;
    const first = chords[0] || null;
    const names = [...new Set(bars.map(bar => bar.name).filter(Boolean))];
    const song = family === 'song';
    const steps = [
      {
        title: song ? 'Count the section' : 'Read the form',
        body: song
          ? `${source.title || 'This song'} · ${source.detail || ''}. The section is ${bars.length} bars; count them from the first bar to the last.`
          : `${source.title || 'This progression'} is ${bars.length} bars: ${names.join(', ')}. Each chord gets one bar.`,
      },
      {
        title: first ? `Place ${first.name}` : 'Place the first chord',
        body: first
          ? chordPlacementText(first)
          : 'Find the first chord shape before the count-in ends.',
      },
      {
        title: song ? 'Keep the strum' : 'Change on the bar line',
        body: song
          ? `Keep the strum pattern steady${source.strum ? ` — ${source.strum}` : ''}. Changing chords late is the mistake to listen for.`
          : 'Strum once per bar and change on the bar line. Do not wait for your fingers to land before you count the next bar.',
      },
      {
        title: 'Drop the chart',
        body: 'At No lights the chart disappears. Keep the form by counting bars and hearing where the next chord wants to go.',
      },
    ];
    return {
      focus,
      shape: { kind: 'bars', title: song ? 'The section' : 'The form', bars, chords },
      steps,
      listen: chordListen(chords),
      action: lessonAction(tempo),
    };
  }

  return null;
}


// ---------- The capability preflight line (05-02 Task 2, D-76) ----------
// The five items in the locked order and the only two words the line may ever say. A missing
// capability is information, never an error: nothing is disabled, nothing turns red and the
// line is never announced (A-80, A-81).
// The connection pill (06-03, UI-SPEC "Connection pill"): the visible label and the accessible name
// for each of the four states, five rows in all because `connected` splits on a known or unknown
// battery. Battery is a number from a BLE notification, so it is coerced and shown only when
// finite; anything else reads as unknown.
export const CONNECTION_STATES = ['disconnected', 'connecting', 'connected', 'unsupported'];
export function connectionView({ state = 'disconnected', battery = null } = {}) {
  const key = CONNECTION_STATES.includes(state) ? state : 'disconnected';
  if (key === 'connecting') return { state: key, label: 'Connecting…', name: 'Connecting to guitar' };
  if (key === 'unsupported') return { state: key, label: 'No Bluetooth', name: 'Bluetooth unavailable. Open guitar menu' };
  if (key === 'disconnected') return { state: key, label: 'Connect guitar', name: 'Connect guitar' };
  const n = battery === null || battery === undefined || battery === '' ? NaN : Number(battery);
  if (!Number.isFinite(n)) return { state: key, label: 'T2 · —%', name: 'Guitar connected, battery unknown. Open guitar menu' };
  const pct = Math.round(n);
  return { state: key, label: `T2 · ${pct}%`, name: `Guitar connected, battery ${pct}%. Open guitar menu` };
}

export const CAPABILITY_ITEMS = [
  { key: 'browser', label: 'Browser' },
  { key: 'bluetooth', label: 'Bluetooth' },
  { key: 'microphone', label: 'Microphone' },
  { key: 'wakeLock', label: 'Wake lock' },
  { key: 'offline', label: 'Offline' },
];
export const CAPABILITIES_READY = 'All capabilities ready.';
// The all-ready sentence, or the five-item form in the fixed order — each item exactly
// `<label> ready` or `<label> unsupported`, so an unknown or absent value reads `unsupported`
// rather than inventing a third word.
export function capabilityLineText(caps = {}) {
  const source = caps && typeof caps === 'object' ? caps : {};
  const words = CAPABILITY_ITEMS.map(item => (source[item.key] === 'ready' ? 'ready' : 'unsupported'));
  if (words.every(word => word === 'ready')) return CAPABILITIES_READY;
  return CAPABILITY_ITEMS.map((item, i) => `${item.label} ${words[i]}`).join(' · ');
}

export function createPanels({
  onChange = () => {}, onTab = () => {}, onBar = () => {}, onTransport = () => {},
  onTempo = () => {}, onTap = () => {}, onSelfReport = () => {}, onBack = () => {},
  onStageMode = () => {}, onHint = () => {}, onDimmer = () => {},
  onRecallReport = () => {},
  onSession = () => {}, onSessionClose = () => {}, onSessionStart = () => {},
  onSessionNext = () => {}, onSessionSkip = () => {}, onSessionRepeat = () => {}, onSessionEnd = () => {},
  onSessionPick = () => {},
  onSessionView = () => {}, onPractiseFilter = () => {}, onPractiseFamily = () => {},
  onPractiseDueRow = () => {}, onPractisePairRow = () => {}, onNextDrill = () => {},
  onPractiseSkill = () => {}, onExport = () => {}, onImportFile = () => {},
  onImportConfirm = () => {}, onImportCancel = () => {}, onImportReset = () => {},
  onFamily = () => {}, onAnswer = () => {}, onReveal = () => {}, onNextQuestion = () => {},
  onMarkChange = () => {}, onMarkHit = () => {}, onPairChange = () => {},
  onPractisePair = () => {}, onPractiseWeakestPair = () => {}, onPlay = () => {},
  onIntensity = () => {}, onStem = () => {}, onLoop = () => {},
  onSection = () => {}, onSectionLoop = () => {},
  onMicToggle = () => {}, onCalibrate = () => {}, onCalibrationTap = () => {},
  onCalibrationSkip = () => {}, onCalibrationDone = () => {}, onCalibrationAgain = () => {},
  onLearn = () => {}, onLessonClose = () => {}, onLessonStart = () => {}, onPowerChord = () => {}, onStartHere = () => {}, onLessonListen = () => {},
  onTunerStart = () => {}, onTunerStop = () => {}, onPowerPractice = () => {},
  onPath = () => {}, onLessonSection = () => {}, onView = () => {}, onPractiseSelection = () => {},
  onMoreClose = () => {}, onOpenItem = () => {}, onChangeInLibrary = () => {},
} = {}) {
  const tabs = TABS.map(t => $(TAB_IDS[t]));
  const tabpanel = $('tabpanel');
  // The Library tab on screen (10-02): view state only, never settings.tab and never saved.
  let shownLibraryTab = 'songs';

  // ---------- Library cards (10-02, LIB-01/LIB-03) ----------
  // Every card is built once here with createElement/textContent; renderLibrary only rewrites
  // a card's meta, chord chips and lamps when that card's own key string changes.
  const libraryCards = [];
  const cardParts = new Map();
  function libNode(tag, className = '', text = null) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== null) node.textContent = text;
    return node;
  }
  function buildCard(listId, family, id, title, { meta = '', lyric = '', chords = false, lamps = true } = {}) {
    const list = $(listId);
    if (!list) return;
    const card = libNode('button', 'lib-card');
    card.type = 'button';
    card.dataset.family = family;
    card.dataset.id = id;
    card.setAttribute('aria-label', `Open ${title} in Practice`);
    // The label names the action, so everything else the card shows (meta, chord line, lyric and
    // lamps) stays reachable as the description, in reading order (10 IN-04).
    const described = [];
    const metaNode = libNode('span', 'meta', meta);
    metaNode.id = `meta-${family}-${id}`;
    described.push(metaNode.id);
    const head = libNode('span', 't');
    head.append(libNode('b', '', title), metaNode);
    card.append(head);
    const parts = { meta: metaNode, chords: null, verses: null, key: '' };
    if (chords) {
      parts.chords = libNode('span', 'chordline');
      parts.chords.id = `chords-${family}-${id}`;
      described.push(parts.chords.id);
      card.append(parts.chords);
    }
    // A span, not a <p>: a button may hold phrasing content only.
    if (lyric) {
      const lyricNode = libNode('span', 'lyric', lyric);
      lyricNode.id = `lyric-${family}-${id}`;
      described.push(lyricNode.id);
      card.append(lyricNode);
    }
    if (lamps) {
      parts.verses = libNode('span', 'verses');
      parts.verses.id = `lamps-${family}-${id}`;
      described.push(parts.verses.id);
      card.append(parts.verses);
    }
    card.setAttribute('aria-describedby', described.join(' '));
    const item = libNode('li');
    item.append(card);
    list.append(item);
    libraryCards.push(card);
    cardParts.set(`${family}:${id}`, parts);
  }
  function buildLibraryCards() {
    for (const song of SONGS) {
      buildCard('songCards', 'song', song.id, song.title, {
        lyric: typeof song.lyric === 'string' ? song.lyric : '', chords: true,
      });
    }
    for (const scale of SCALES) buildCard('scaleCards', 'scale', scale.id, scale.name);
    // Chord pairs carry lamps (a skill exists); single chord shapes do not, since nothing records them.
    for (const pair of CHORD_PAIRS) buildCard('chordCards', 'pair', pair.id, pair.label, { meta: 'Chord change' });
    for (const chord of CHORD_FAMILIES) {
      const count = Array.isArray(chord.voicings) ? chord.voicings.length : 0;
      buildCard('chordCards', 'chord', chord.id, chord.name, {
        meta: `Chord shape · ${count} ${count === 1 ? 'voicing' : 'voicings'}`, lamps: false,
      });
    }
    for (const prog of PROGRESSIONS) buildCard('progressionCards', 'progression', prog.id, prog.name);
  }

  // ---------- Library search (10-03, LIB-04) ----------
  // One result row per item, built once into four groups; a keystroke only toggles `hidden` on
  // rows and groups. The query lives in this closure and is never saved.
  const searchRows = [];
  const SEARCH_EMPTY_TEXT = 'No songs, scales, chords or progressions match.';
  let searchQuery = '';
  let searchWasEmpty = false;
  function buildSearchRow(listId, family, id, name, meta) {
    const list = $(listId);
    if (!list) return;
    const row = libNode('button', 'search-row');
    row.type = 'button';
    row.dataset.family = family;
    row.dataset.id = id;
    row.append(libNode('b', '', name), libNode('span', 'meta', meta));
    const item = libNode('li');
    item.append(row);
    list.append(item);
    searchRows.push({ row, item, group: SEARCH_GROUP_OF[family], family, id });
  }
  function buildSearchRows() {
    for (const song of SONGS) buildSearchRow('searchSongs', 'song', song.id, song.title, 'Song');
    for (const scale of SCALES) buildSearchRow('searchScales', 'scale', scale.id, scale.name, 'Scale');
    for (const pair of CHORD_PAIRS) buildSearchRow('searchChords', 'pair', pair.id, pair.label, 'Chord change');
    for (const chord of CHORD_FAMILIES) buildSearchRow('searchChords', 'chord', chord.id, chord.name, 'Chord shape');
    for (const prog of PROGRESSIONS) buildSearchRow('searchProgressions', 'progression', prog.id, prog.name, 'Progression');
  }
  function applySearch(value) {
    searchQuery = String(value || '');
    const hits = searchLibrary(searchQuery);
    const searching = hits !== null;
    $('searchResults').hidden = !searching;
    $('tabs').hidden = searching;
    if (tabpanel) tabpanel.hidden = searching;
    // The tab CTA names the hidden tab's item, so it hides with the tabs while results show.
    if ($('libraryCta')) $('libraryCta').hidden = searching;
    // No query, no count: #librarySearch is described by #searchCount, so a stale "0 results"
    // must never be read on focus while the tabs show (10 IN-05).
    if (!searching) { searchWasEmpty = false; $('searchCount').textContent = ''; return; }
    const keep = {
      song: new Set(hits.songs), scale: new Set(hits.scales), pair: new Set(hits.pairs),
      chord: new Set(hits.chords), progression: new Set(hits.progressions),
    };
    const shownIn = {};
    let count = 0;
    for (const entry of searchRows) {
      const shown = keep[entry.family].has(entry.id);
      entry.item.hidden = !shown;
      if (shown) { count++; shownIn[entry.group] = true; }
    }
    for (const group of Object.values(SEARCH_GROUP_OF)) {
      if ($(group)) $(group).hidden = !shownIn[group];
    }
    $('searchCount').textContent = `${count} ${count === 1 ? 'result' : 'results'}`;
    // The empty state is visible text inside the Library (#feedback is hidden here) plus one
    // announcement per transition into empty, through the single live region (Pitfall 5).
    const empty = count === 0;
    $('searchEmpty').hidden = !empty;
    $('searchEmpty').textContent = empty ? SEARCH_EMPTY_TEXT : '';
    if (empty && !searchWasEmpty) announce(SEARCH_EMPTY_TEXT);
    searchWasEmpty = empty;
  }
  // One lamp: a dot-count swatch (data-level only for an owned level 0..3) and the level in words,
  // `owned: Anchors` or `Not started`, so the lamp never rests on colour alone (Phase 9 convention).
  function lampNode({ name = '', repeats = 1, level = -1 } = {}) {
    const group = libNode('span', 'vz');
    const swatch = libNode('span', 'own-swatch');
    swatch.setAttribute('aria-hidden', 'true');
    const owned = Number.isInteger(level) && level >= 0 && level < HINT_LEVEL_NAMES.length;
    if (owned) swatch.setAttribute('data-level', String(level));
    const status = owned ? 'owned: ' + ownedLevelName(level) : ownedLevelName(-1);
    const token = sectionToken(name, repeats);
    group.append(swatch, libNode('span', '', token ? `${token} · ${status}` : status));
    return group;
  }
  function renderLibrary(model = {}) {
    const source = model && typeof model === 'object' ? model : {};
    const families = [['song', source.songs], ['scale', source.scales], ['pair', source.pairs], ['progression', source.progressions]];
    for (const [family, items] of families) {
      for (const item of Array.isArray(items) ? items : []) {
        const parts = item && typeof item.id === 'string' ? cardParts.get(`${family}:${item.id}`) : null;
        if (!parts) continue;
        const lamps = Array.isArray(item.sections) ? item.sections : [{ name: '', repeats: 1, level: item.level }];
        const chords = Array.isArray(item.chords) ? item.chords.map(String) : [];
        const meta = typeof item.meta === 'string' ? item.meta : parts.meta.textContent;
        const key = JSON.stringify([meta, chords, lamps.map(l => [l.name, l.repeats, l.level])]);
        if (key === parts.key) continue;
        parts.key = key;
        parts.meta.textContent = meta;
        if (parts.chords) parts.chords.replaceChildren(...chords.map(name => libNode('span', '', name)));
        if (parts.verses) parts.verses.replaceChildren(...lamps.map(lampNode));
      }
    }
  }
  // The view on screen (Phase 6). Declared first so the boundary rule can read it from any setter.
  let currentView = 'today';
  const dots = [...$('beatDots').children];
  let lastCount = 0;
  let lastBeatText = '';
  let currentFamily = 'scaleRun';
  let currentPath = 'explore';
  let lessonReturnFocus = null;
  const PATH_STEPS = {
    tune: { num: '01', label: 'Tune' },
    find: { num: '02', label: 'Find notes' },
    shape: { num: '03', label: 'First shape' },
    blues: { num: '04', label: 'Blues note' },
    power: { num: '05', label: 'Power chords' },
    changes: { num: '06', label: 'Changes' },
  };

  function setPathActive(name, remember = true) {
    const key = Object.hasOwn(PATH_STEPS, name) ? name : 'explore';
    if (remember) currentPath = key;
    document.querySelectorAll('[data-path]').forEach(button => {
      if (button.dataset.path === key) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    const step = PATH_STEPS[key] || { num: '', label: 'Explore · choose a path when ready' };
    if ($('workspaceStep')) $('workspaceStep').textContent = key === 'explore' ? step.label : `Path ${step.num} · ${step.label}`;
  }

  // The six labels and numbers live only in PATH_STEPS; the shell ships an empty list and
  // wire() fills it before the app shell is revealed. This removes the old HTML/JS copy pair.
  function fillPath() {
    const holder = $('learningPath');
    if (!holder) return;
    holder.replaceChildren(...Object.entries(PATH_STEPS).map(([key, step]) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.path = key;
      if (key !== 'tune') {
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-controls', 'lessonPanel');
      }
      const number = document.createElement('span');
      number.className = 'path-num';
      number.textContent = step.num;
      const label = document.createElement('b');
      label.textContent = step.label;
      button.append(number, label);
      item.append(button);
      return item;
    }));
  }

  function pathFor(settings) {
    if (settings.tab === 'chords') return 'power';
    if (settings.tab === 'progressions' || settings.tab === 'songs') return 'changes';
    if (settings.drillFamily === 'findNote') return 'find';
    if (settings.drillFamily === 'chordChanges') return 'changes';
    if (settings.scaleId === 'blues') return 'blues';
    return settings.scaleId === 'minPent' && settings.positionId !== 'all' ? 'shape' : 'explore';
  }

  function updateWorkspace(settings, view = {}) {
    const tab = settings.tab;
    const keyName = KEY_NAMES[settings.keyPc] || KEY_NAMES[0];
    let title = 'A minor pentatonic';
    let sub = 'Position 1 · 50 BPM · scale run';
    if (tab === 'scales') {
      const scale = ownEntry(scaleById, settings.scaleId) || SCALES[0];
      const position = (view.positions || []).find(entry => entry.id === settings.positionId);
      const family = Object.hasOwn(PRACTISE_FAMILY_NAMES, settings.drillFamily)
        ? PRACTISE_FAMILY_NAMES[settings.drillFamily] : PRACTISE_FAMILY_NAMES.scaleRun;
      title = `${keyName} ${scale.name}`;
      sub = `${position ? position.label + ' · fret ' + position.anchor : 'Whole neck'} · ${settings.bpm} BPM · ${family}`;
      // 10-04 (LIB-03/KEEP-02): the stage names the loaded item, not the scale behind it. Every id
      // resolves own-key; a missing one keeps the key-and-scale title above.
      const song = settings.drillFamily === 'song' ? ownEntry(songById, settings.songId) : null;
      const progression = settings.drillFamily === 'progression' ? ownEntry(progressionById, settings.progressionId) : null;
      const pair = settings.drillFamily === 'chordChanges' ? ownEntry(chordPairById, settings.chordPairId) : null;
      if (song) {
        const sections = Array.isArray(song.sections) ? song.sections : [];
        const section = sections.find(entry => entry && entry.id === settings.songSectionId) || sections[0] || null;
        title = song.title;
        sub = `${section ? sectionToken(section.name, section.repeats) : 'Song'} · ${settings.bpm} BPM · ${family}`;
      } else if (progression) {
        title = `${progression.name} in ${keyName}`;
        sub = `${settings.bpm} BPM · ${family}`;
      } else if (pair) {
        title = pair.label;
        sub = `${settings.bpm} BPM · ${family}`;
      }
    } else if (tab === 'chords') {
      const chord = ownEntry(chordById, settings.chordId) || CHORD_FAMILIES[0];
      const voicing = (view.voicings || []).find(entry => entry.id === settings.voicingId);
      title = chord.name;
      sub = `${voicing ? voicing.label : 'Voicing'} · ${settings.bpm} BPM`;
    } else if (tab === 'progressions') {
      const progression = ownEntry(progressionById, settings.progressionId) || PROGRESSIONS[0];
      title = progression.name;
      sub = `${keyName} · ${settings.bpm} BPM · progression`;
    } else {
      const song = ownEntry(songById, settings.songId) || SONGS[0];
      const sections = Array.isArray(song.sections) ? song.sections : [];
      const section = sections.find(entry => entry.id === settings.songSectionId) || sections[0] || null;
      title = song.title;
      sub = `${section ? sectionToken(section.name, section.repeats) : 'Song'} · ${settings.bpm} BPM`;
    }
    if ($('workspaceTitle')) $('workspaceTitle').textContent = title;
    if ($('workspaceSub')) $('workspaceSub').textContent = sub;
    setPathActive(pathFor(settings));
  }
  // The stage chart's last render: `id|level|bar|loop`. A frame that matches it writes nothing.
  let stageChartKey = '';
  let lessonListenData = null;
  let lessonActionKind = 'start';
  // The tempo the chord review's line currently names, so an empty input keeps the last
  // number instead of printing a zero.
  let tempoValue = 0;

  function fillStaticOptions() {
    const keys = KEYS.map(k => option(String(k), KEY_NAMES[k]));
    $('key').replaceChildren(...keys.map(o => o.cloneNode(true)));
    $('playKey').replaceChildren(...keys.map(o => o.cloneNode(true)));
    // The Songs tab's `Key` select is the third reader of the same 12 key names (A-56).
    $('songKey').replaceChildren(...keys.map(o => o.cloneNode(true)));
    $('progressionKey').replaceChildren(...keys);
    $('scale').replaceChildren(...SCALES.map(s => option(s.id, s.name)));
    $('chord').replaceChildren(...CHORD_FAMILIES.map(c => option(c.id, c.name)));
    $('progression').replaceChildren(...PROGRESSIONS.map(p => option(p.id, p.name)));
    $('song').replaceChildren(...SONGS.map(s => option(s.id, s.title)));
  }

  function fillPositions(positions = [], selectedId = 'all') {
    const options = [option('all', 'Whole neck'), ...positions.map(p => option(p.id, p.label + ' · fret ' + p.anchor))];
    $('position').replaceChildren(...options);
    $('position').value = options.some(o => o.value === selectedId) ? selectedId : 'all';
  }

  function fillVoicings(voicings = [], selectedId = '') {
    const options = voicings.map((v, i) => option(v.id, v.label || 'Voicing ' + (i + 1)));
    $('voicing').replaceChildren(...options);
    $('voicing').value = options.some(o => o.value === selectedId) ? selectedId : (options[0] ? options[0].value : '');
  }

  // 10-02 splits the old tab painter in two. The Library tab shown (in-memory) owns the tablist,
  // the CTA, the picker rows and the card lists; the Practice subject (settings.tab) owns the
  // scale chips, the chord detail, the bar chart and the microcopy.
  function setLibraryTabVisual(tab) {
    if (!TABS.includes(tab)) return;
    shownLibraryTab = tab;
    TABS.forEach((name, i) => {
      const active = name === tab;
      tabs[i].setAttribute('aria-selected', active ? 'true' : 'false');
      tabs[i].tabIndex = active ? 0 : -1;
    });
    if (tabpanel) tabpanel.setAttribute('aria-labelledby', TAB_IDS[tab]);
    if ($('libraryCta')) $('libraryCta').textContent = CTA_LABEL[tab] || CTA_LABEL.songs;
    for (const name of TABS) {
      $(`controls-${name}`).hidden = name !== tab;
      const list = $(CARD_LISTS[name]);
      if (list) list.hidden = name !== tab;
    }
  }

  function setSubjectVisual(tab) {
    $('scaleChips').hidden = tab !== 'scales';
    $('chordDetail').hidden = tab !== 'chords';
    $('chart').hidden = !(tab === 'progressions' || tab === 'songs');
    $('microcopy').textContent = tab === 'scales'
      ? microcopyFor(currentFamily)
      : MICROCOPY[tab];
  }

  function renderScaleChips(names, keyPc, scaleDef) {
    const holder = $('scaleChips');
    if (!holder || !names || !scaleDef) return;
    holder.replaceChildren(...scaleDef.intervals.map(iv => {
      const chip = document.createElement('div');
      chip.className = 'chip' + (iv === 0 ? ' root' : '');
      const name = document.createElement('b');
      name.textContent = names[(keyPc + iv) % 12];
      const degree = document.createElement('span');
      degree.textContent = DEGREES[iv];
      chip.append(name, degree);
      return chip;
    }));
  }

  function renderChart(chart, selectedIndex = 0) {
    const holder = $('chart');
    // A rebuild replaces the focused bar button, which would drop a keyboard user
    // back to <body> on every selection; re-focus the same bar afterwards (WR-09).
    const focused = document.activeElement && document.activeElement.dataset
      ? document.activeElement.dataset.bar
      : undefined;
    holder.replaceChildren();
    if (!chart) {
      holder.hidden = true;
      return;
    }
    let index = 0;
    for (const section of chart.sections) {
      const sectionEl = document.createElement('section');
      if (section.name) {
        const h = document.createElement('h3');
        h.textContent = section.name;
        if (section.repeats > 1) {
          const badge = document.createElement('span');
          badge.className = 'repeat-badge';
          badge.textContent = '×' + section.repeats;
          h.appendChild(badge);
        }
        sectionEl.appendChild(h);
      }
      const bars = document.createElement('div');
      bars.className = 'bars';
      for (const bar of section.bars) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'bar';
        button.dataset.bar = String(index);
        button.setAttribute('aria-pressed', index === selectedIndex ? 'true' : 'false');
        const name = document.createElement('span');
        name.className = 'bar-name';
        name.textContent = bar.name;
        const roman = document.createElement('span');
        roman.className = 'bar-roman';
        roman.textContent = bar.roman;
        const number = document.createElement('span');
        number.className = 'bar-number';
        number.textContent = 'Bar ' + (index + 1);
        button.append(name, roman, number);
        bars.appendChild(button);
        index++;
      }
      sectionEl.appendChild(bars);
      holder.appendChild(sectionEl);
    }
    holder.hidden = false;
    if (focused !== undefined) {
      const again = holder.querySelector(`button[data-bar="${focused}"]`);
      if (again) again.focus();
    }
  }

  // The play-along stage chart: the pass's bars plus the ending card, fading on the same
  // level index as the LEDs and the counter. It rebuilds only when the chart identity, the
  // level or the current bar changes — never on a frame (A12, T-04-13) — and every node is
  // createElement plus textContent, so content never reaches the DOM as markup (T-04-10).
  // The cards are not buttons: there is nothing to click during a pass (A-50).
  function renderStageChart({ chart = null, level = 0, barIndex = 0, visible = true } = {}) {
    const holder = $('stageChart');
    if (!holder) return;
    const steps = chart && Array.isArray(chart.steps) ? chart.steps : [];
    // No lights means no chart: the recall pass plays the whole progression from memory, so
    // hiding it here is the same rule that empties the board and the LEDs (T-04-11).
    const shown = !!visible && steps.length > 0 && level < 3;
    holder.hidden = !shown;
    if (!shown) {
      // Forget the key, so a level that comes back down rebuilds under the right tokens.
      stageChartKey = '';
      return;
    }
    const index = Number.isInteger(barIndex) ? Math.max(0, Math.min(steps.length - 1, barIndex)) : 0;
    const content = chart.content || {};
    const song = ownEntry(songById, content.songId);
    // The window the chart is playing, or the section loop's own word: a song has no bar
    // window to name and no `Whole progression` to promise (D-66).
    const loopBars = Number.isInteger(content.loopBars) ? content.loopBars : 0;
    // The rebuild key carries everything this block's copy and grid read: the chart identity,
    // the level, the current bar, the section loop, the loop window and the card count. D-64
    // keeps `progression:<id>:<key>` identical across loop windows and `song:<id>:<section>:<key>`
    // identical across the toggle, so an id-only key left the header reading `Whole progression`
    // and the grid showing all thirteen cards after a `Loop 4 bars` change at idle (WR-01).
    const key = [chart.id, level, index, content.sectionLoop ? 'on' : 'off', loopBars, steps.length].join('|');
    if (key === stageChartKey) return;
    stageChartKey = key;
    const prog = ownEntry(progressionById, content.progressionId);
    // The heading is the item's own name — never a new naming system (D-66). A song plays one
    // of its sections, so the header names that section and its repeats (`Verse ×2`, `Chorus`)
    // through the same formatter the `Section` select and the pass line use (A-53).
    const { section } = song ? songSectionOf(content) : { section: null };
    $('stageChartTitle').textContent = song
      ? (section ? sectionToken(section.name, section.repeats) : '')
      : (prog ? prog.name : '');
    $('stageChartMode').textContent = song
      ? (content.sectionLoop ? 'Section loop On' : 'Section loop Off')
      : loopBars === 4
        ? 'Loop 4 bars'
        : loopBars === 8 ? 'Loop 8 bars' : 'Whole progression';
    const grid = $('stageChartBars');
    grid.replaceChildren(...steps.map((step, i) => {
      const card = document.createElement('li');
      card.className = 'play-chart-bar';
      // The current bar takes the browse chart's selected-bar outline (accent rule 7,
      // widened to the stage) and says so to assistive tech.
      if (i === index) card.setAttribute('aria-current', 'step');
      const tokens = chartCardTokens({
        level,
        chordName: step.chordName || '',
        roman: step.roman || '',
        bar: i + 1,
        ending: !!step.ending,
      });
      const primary = document.createElement('span');
      primary.className = 'play-chart-primary';
      primary.textContent = tokens.primary;
      card.appendChild(primary);
      if (step.ending) {
        // The ending card's secondary slot *is* its tag: one `Ending`, never the word twice.
        const tag = document.createElement('span');
        tag.className = 'play-chart-tag';
        tag.textContent = 'Ending';
        card.appendChild(tag);
      } else {
        const secondary = document.createElement('span');
        secondary.className = 'play-chart-secondary';
        secondary.textContent = tokens.secondary;
        card.appendChild(secondary);
      }
      return card;
    }));
    // The strum pattern and the song's one-line tip. The UI-SPEC places the header and the
    // grid but not the strum hint, so it rides the chart the fade already owns: a caption
    // outside `#stageChart` would survive the level-4 hide and become a hint replacement.
    // Level 0 only, so the ladder still shows strictly less at every step (D-65, D-67,
    // T-04-17). Two `span`s inside one muted block, never a run-on sentence.
    const strum = $('strumHint');
    const lines = song && level === 0 ? strumHintLines(song) : [];
    strum.hidden = lines.length === 0;
    strum.replaceChildren(...lines.map(line => {
      const row = document.createElement('span');
      row.textContent = line;
      return row;
    }));
    // A bar the chosen key cannot voice is named here, and `main` keeps Start drill
    // disabled: the player is told the problem and the exact fix, never handed a wrong shape.
    const missing = steps.some(step => step.voicingId === null);
    $('stageChartError').hidden = !missing;
    $('stageChartError').textContent = missing
      ? 'No shape for this chord in this key. Choose another key.'
      : '';
  }

  function render(settings, view = {}) {
    setFamilyPicker(settings.drillFamily || 'scaleRun', false);
    // The Library tab never follows settings.tab: main passes its in-memory libraryTab (10-02).
    setLibraryTabVisual(TABS.includes(view.libraryTab) ? view.libraryTab : shownLibraryTab);
    setSubjectVisual(settings.tab);
    if (view.library) renderLibrary(view.library);
    // The Library picker rows follow the library model, so #position and #voicing stay right
    // whatever the Practice subject is (10-02); a view without one keeps the subject's lists.
    const lib = view.library && typeof view.library === 'object' ? view.library : {};
    fillPositions(Array.isArray(lib.positions) ? lib.positions : (view.positions || []), settings.positionId);
    fillVoicings(Array.isArray(lib.voicings) ? lib.voicings : (view.voicings || []), settings.voicingId);

    $('key').value = String(settings.keyPc);
    $('progressionKey').value = String(settings.keyPc);
    $('scale').value = settings.scaleId;
    $('position').value = settings.positionId;
    $('labels').value = settings.labels;
    $('chord').value = settings.chordId;
    $('voicing').value = settings.voicingId;
    $('progression').value = settings.progressionId;
    $('playKey').value = String(settings.keyPc);
    // The Play button names the item it will seed, so its accessible name is never the
    // bare word on the label (PROG-01, D-59).
    const playProg = ownEntry(progressionById, settings.progressionId) || PROGRESSIONS[0];
    $('playProgression').setAttribute('aria-label', 'Play progression ' + playProg.name + ' in the drill stage');
    $('song').value = settings.songId || SONGS[0].id;
    // The Songs tab's `Key` is a real select on the **one** `keyPc` plane the Progressions
    // tab writes (A-56), so a song transposes with the same control the other tabs use.
    $('songKey').value = String(settings.keyPc);
    // `Section` lists the chosen song's own sections with their repeats (`Verse ×2`,
    // `Chorus`), and a stale id falls back to the first one rather than to no selection.
    const chosenSong = ownEntry(songById, settings.songId) || SONGS[0];
    const songSections = Array.isArray(chosenSong.sections) ? chosenSong.sections : [];
    $('section').replaceChildren(...songSections.map(entry => option(entry.id, sectionToken(entry.name, entry.repeats))));
    $('section').value = songSections.some(entry => entry.id === settings.songSectionId)
      ? settings.songSectionId
      : (songSections[0] ? songSections[0].id : '');
    $('playSong').setAttribute('aria-label', 'Play song ' + chosenSong.title + ' in the drill stage');
    $('direction').value = settings.direction;
    $('bpm').value = String(settings.bpm);
    $('sound').checked = !!settings.sound;
    $('drone').checked = !!settings.drone;
    $('quizMode').value = settings.quizMode === 'name' ? 'name' : 'find';
    setChangesSelect(CHORD_PAIRS, settings.chordPairId);

    renderScaleChips(view.names, settings.keyPc, view.scaleDef);
    $('chordDetail').textContent = view.detail || '';
    updateWorkspace(settings, view);
    renderChart(view.chart, view.barIndex || 0);
  }

  function setStatus(text) { $('status').textContent = text; }

  // ---------- The connection pill and the guitar menu (06-03) ----------
  // The pill's one writer: label, accessible name, state class (plus the v1 `on` class), disabled
  // only while connecting, and Disconnect guitar shown only when connected. textContent and
  // setAttribute only (T-06-07).
  function setConnection({ state = 'disconnected', battery = null } = {}) {
    const view = connectionView({ state, battery });
    const pill = $('connectBtn');
    $('connLabel').textContent = view.label;
    pill.setAttribute('aria-label', view.name);
    for (const key of CONNECTION_STATES) pill.classList.toggle(`conn-${key}`, key === view.state);
    pill.classList.toggle('on', view.state === 'connected');
    pill.disabled = view.state === 'connecting';
    if (view.state === 'connecting') pill.setAttribute('aria-busy', 'true');
    else pill.removeAttribute('aria-busy');
    $('disconnectBtn').hidden = view.state !== 'connected';
    return view;
  }

  // `popover="auto"` gives light dismiss and Esc but never moves focus, so focus is placed here:
  // on Disconnect guitar when it is shown, otherwise on the menu itself (it carries tabindex=-1).
  function isConnMenuOpen() {
    const menu = $('connMenu');
    return !!(menu && typeof menu.matches === 'function' && menu.matches(':popover-open'));
  }
  function openConnMenu() {
    const menu = $('connMenu');
    if (!menu || typeof menu.showPopover !== 'function') return false;
    if (!isConnMenuOpen()) menu.showPopover();
    const disconnect = $('disconnectBtn');
    if (disconnect && !disconnect.hidden) disconnect.focus();
    else menu.focus();
    return true;
  }
  function closeConnMenu() {
    const menu = $('connMenu');
    if (menu && typeof menu.hidePopover === 'function' && isConnMenuOpen()) menu.hidePopover();
  }
  function setFeedback(text) { $('feedback').textContent = text; }
  // The one live region. While the More sheet is modal the rest of the page is inert, so the node
  // moves into the open sheet and back (06-03, Pitfall 2). A write that follows a move lands on the
  // next frame, so the screen reader sees the node in its new home before its text changes.
  let announcerMoved = false;
  function announce(text) {
    const node = $('announcer');
    if (announcerMoved && typeof globalThis.requestAnimationFrame === 'function') {
      globalThis.requestAnimationFrame(() => { node.textContent = text; });
      return;
    }
    node.textContent = text;
  }
  function markAnnouncerMoved() {
    announcerMoved = true;
    if (typeof globalThis.requestAnimationFrame === 'function') {
      globalThis.requestAnimationFrame(() => { announcerMoved = false; });
    } else {
      announcerMoved = false;
    }
  }
  function setLights(on) {
    $('lightsBtn').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('lightsState').textContent = on ? 'On' : 'Off';
  }

  function setStageMode(on) {
    $('stageBtn').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('stageState').textContent = on ? 'On' : 'Off';
  }

  function select(tab, focus = false, notify = true) {
    if (!TABS.includes(tab)) return;
    setLibraryTabVisual(tab);
    if (focus) $(TAB_IDS[tab]).focus();
    if (notify) onTab(tab);
  }

  // ---------- Drill surfaces ----------
  function setLocked(locked) {
    for (const id of LOCKED_IDS) $(id).disabled = locked;
    setOpensLocked(locked);
    $('lockedHelper').hidden = !locked;
  }
  // 10-02: the cards lock with the pickers; the tabs stay usable, since a tab click only
  // changes which list the Library shows (RESEARCH Pattern 2). 10-03: result rows lock with the
  // cards; the search field stays usable. 10 IN-07: a recall result still waiting for its
  // self-report locks these opens (and the two Play buttons) on its own, since opening an item
  // would close that result.
  function setOpensLocked(locked) {
    for (const card of libraryCards) card.disabled = locked;
    for (const { row } of searchRows) row.disabled = locked;
  }
  const OPEN_PLAY_IDS = ['playSong', 'playProgression'];

  // The tempo is locked during count-in, active and paused, and live at idle, the pass
  // review and the result. It never changes inside a phrase (CHORD-05, T-03-10).
  function setTempoLocked(locked) {
    for (const id of TEMPO_IDS) $(id).disabled = locked;
  }

  function show(id, visible) { $(id).hidden = !visible; }

  // The `Backing` cluster: one preset over four independent stems, plus the loop window.
  // `Intensity` is painted from the stored preset and the four checkboxes from the stored
  // booleans — the preset never re-derives them on a render, so a hand toggle stays put
  // until the player presses the preset again (A-58). `Loop` offers only the windows the
  // chart can honour and is locked while a pass is running, so a window change always
  // lands on the next pass (A-68, Open Question 4). The duck line is the cluster's own
  // promise and appears only while the mic is actually on or listening.
  function setBacking({
    intensity = 'full', stems = null, loopBars = 0, itemBars = 0, micState = null,
    visible = false, locked = false,
  } = {}) {
    show('backingCluster', visible);
    if (!visible) return;
    const preset = INTENSITY_OPTIONS.some(option => option.value === intensity) ? intensity : 'full';
    if ($('intensity').value !== preset) $('intensity').value = preset;
    const source = stems && typeof stems === 'object' ? stems : {};
    for (const { id } of STEM_OPTIONS) $(id).checked = source[id] !== false;
    // A-68 gates the options on the **item's** length, never on the window this pass plays:
    // gating on the window hid `4 bars` the moment it was chosen, snapped the select back to
    // `Whole` and made the stored window unreachable and unclearable (CR-02). The active
    // window is always kept visible, so the control can never lie about what it is doing.
    const allowed = loopOptionValues(itemBars);
    const keep = allowed.includes(loopBars) ? loopBars : 0;
    for (const node of [...$('loop').options]) {
      const value = Number(node.value);
      const ok = allowed.includes(value) || value === keep;
      node.hidden = !ok;
      node.disabled = !ok;
    }
    $('loop').value = String(keep);
    $('loop').disabled = !!locked;
    $('backingDuckLine').hidden = !MIC_ON_STATES.includes(micState || micCurrent);
  }

  // The family picker is one radiogroup of three segments. All three families are live
  // once the chord family lands; the whole group is inert while a pass is live or at the
  // pass review, so a running chart can never be swapped behind the reducer (D-42).
  function setFamilyPicker(family, locked = false) {
    const chosen = FAMILY_DESC[family] ? family : 'scaleRun';
    currentFamily = chosen;
    for (const segment of $('familyPicker').querySelectorAll('[role=radio]')) {
      const on = segment.dataset.family === chosen;
      segment.setAttribute('aria-checked', on ? 'true' : 'false');
      segment.tabIndex = on ? 0 : -1;
      segment.disabled = locked;
    }
    $('familyDesc').textContent = FAMILY_DESC[chosen];
    $('drillStage').setAttribute('aria-label', FAMILY_STAGE_LABEL[chosen] || FAMILY_STAGE_LABEL.scaleRun);
    return chosen;
  }

  // The pair strip is the chord family's screen column (UI-SPEC, Screen fade): full
  // metadata at Full pattern, name and root at Anchors, the destination card only at
  // Hint on demand, nothing at No lights. It never reflows by count and never truncates
  // a chord name — the card wraps to the next row instead.
  function pairCardNode(chord, current, level) {
    const voicing = chord.voicings && chord.voicings[0] ? chord.voicings[0] : null;
    const item = document.createElement('li');
    item.className = 'pair-card' + (current ? ' current' : '');
    item.dataset.chord = chord.id;
    if (current) item.setAttribute('aria-current', 'step');
    const name = document.createElement('span');
    name.className = 'pair-name';
    name.textContent = chord.name;
    const root = document.createElement('span');
    root.className = 'pair-meta';
    root.textContent = `root ${KEY_NAMES[chord.rootPc] || ''}`;
    item.append(name, root);
    if (level === 0 && voicing) {
      const frets = document.createElement('span');
      frets.className = 'pair-meta pair-frets';
      frets.textContent = voicing.frets.map(f => (f === null || f === undefined ? '×' : String(f))).join(' ');
      const word = document.createElement('span');
      word.className = 'pair-meta';
      word.textContent = voicing.label;
      item.append(frets, word);
    }
    return item;
  }

  function setPairStrip({ pair = null, chords = [], barIndex = 0, level = 0 } = {}) {
    const holder = $('pairStrip');
    // `chords` are the resolved families the chart carries; a caller that only has the
    // pair's ids still gets cards, resolved through the same content table.
    const list = Array.isArray(chords) && chords.length
      ? chords.filter(Boolean)
      : (pair && Array.isArray(pair.chords) ? pair.chords.map(id => chordById[id]).filter(Boolean) : []);
    if (!pair || !list.length) { holder.replaceChildren(); return []; }
    const index = Math.max(0, Number.isInteger(barIndex) ? barIndex : 0) % list.length;
    const destination = (index + 1) % list.length;
    const shown = level === 0 || level === 1
      ? list.map((chord, i) => ({ chord, i }))
      : level === 2
        ? [{ chord: list[destination], i: destination }]
        : [];
    holder.replaceChildren(...shown.map(({ chord, i }) => pairCardNode(chord, i === index, level)));
    return shown.map(entry => entry.chord.id);
  }

  // The `Changes` select: two-chord pairs first, four-chord loops second, each option
  // labelled with its own pair's label (`C → G`, `C → Am → Dm → G`).
  function setChangesSelect(pairs = CHORD_PAIRS, currentId = '') {
    const list = Array.isArray(pairs) && pairs.length ? pairs : CHORD_PAIRS;
    const groups = [document.createElement('optgroup'), document.createElement('optgroup')];
    groups[0].label = 'Pairs';
    groups[1].label = 'Loops';
    for (const pair of list) {
      const target = Array.isArray(pair.chords) && pair.chords.length > 2 ? groups[1] : groups[0];
      target.appendChild(option(pair.id, pair.label));
    }
    $('changes').replaceChildren(...groups.filter(group => group.children.length));
    $('changes').value = list.some(pair => pair.id === currentId) ? currentId : list[0].id;
  }

  // The `Ask for` options are data: main computes the kind list from the current Mode
  // and passes it in, so this module never imports the quiz table (A-34).
  function setAskForOptions(kinds = [], selected = 'note') {
    const values = Array.isArray(kinds) && kinds.length ? kinds : ['note'];
    const options = values.map(kind => option(kind, QUIZ_QUESTION_LABELS[kind] || kind));
    $('askFor').replaceChildren(...options);
    $('askFor').value = values.includes(selected) ? selected : values[0];
  }

  function chipNode(chip, state) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'answer-chip' + (state === 'correct' ? ' correct' : '');
    button.dataset.chip = String(chip.value);
    button.textContent = chip.label;
    return button;
  }

  // The prompt card is the whole question: counter, one-sentence prompt, pool line, four
  // chips, the reveal before an answer and the outcome plus Next question after it.
  // Both the mode token and the prompt come from the effective mode the frame is using,
  // never from the stored question, so the recall pass reads in Find form.
  function setQuestion({
    index = 1, count = 0, effectiveMode = 'find', prompt = '', poolText = '',
    chips = [], answer = null, outcome = null, answered = false,
  } = {}) {
    const empty = count === 0;
    $('quizCounter').textContent = empty ? 'Question 0 of 0' : questionCounterText(index, count);
    $('quizModeToken').textContent = effectiveMode === 'name' ? 'Name it' : 'Find it';
    $('quizPromptText').textContent = empty ? EMPTY_QUESTION : prompt;
    $('quizPool').textContent = poolText;
    const correctChip = answered && answer !== null ? String(answer) : null;
    $('answerChips').replaceChildren(
      ...chips.map(chip => chipNode(chip, String(chip.value) === correctChip ? 'correct' : '')),
    );
    $('answerChips').hidden = empty;
    $('revealAnswer').hidden = answered || empty;
    $('revealHelper').hidden = answered || empty;
    $('quizOutcome').hidden = !answered;
    $('quizOutcome').textContent = answered ? (outcome || '') : '';
    $('nextQuestion').hidden = !answered;
  }

  function focusNextQuestion() { $('nextQuestion').focus(); }

  // ---------- Thumb-row dimmer (FADE-07/10) ----------
  // Painted from main's dimmer view on every drill paint and every frame; one comparison
  // keeps DOM writes to real changes, so the readout never flickers per beat. Text is
  // textContent from numbers and fixed copy only (T-08-07). The buttons use aria-disabled,
  // never `disabled`, so they stay focusable and their reason stays reachable.
  let dimmerLast = null;
  const DIMMER_KEYS = ['level', 'lit', 'dark', 'passesText', 'canBrighter', 'canDarker', 'brighterReason', 'darkerReason', 'lampsLabel', 'readoutLabel'];
  function setDimmer(view) {
    if (!view || !$('thumbRow')) return;
    if (dimmerLast && DIMMER_KEYS.every(key => dimmerLast[key] === view[key])) return;
    dimmerLast = { ...view };
    $('litCount').textContent = String(view.lit);
    $('darkCount').textContent = String(view.dark);
    $('passesLeft').textContent = view.passesText;
    $('readoutLabel').textContent = view.readoutLabel || '';
    $('lampsCaption').textContent = view.lampsLabel || '';
    $('dimmerLamps').setAttribute('aria-label', view.lampsLabel || 'Light level');
    // The mock's bank: the first 4 - level lamps are lit, so Full pattern lights all four
    // and No lights none; the current level is marked by weight and name, not colour alone.
    $('dimmerLamps').querySelectorAll('.dimmer-lamp').forEach(item => {
      const index = Number(item.dataset.level);
      const current = index === view.level;
      item.classList.toggle('lit', index < 4 - view.level);
      item.classList.toggle('current', current);
      if (current) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
      const name = item.querySelector('.dimmer-lamp-name');
      if (name) name.classList.toggle('sr-only', !current);
    });
    $('brighterBtn').setAttribute('aria-disabled', view.canBrighter ? 'false' : 'true');
    $('darkerBtn').setAttribute('aria-disabled', view.canDarker ? 'false' : 'true');
    $('brighterReason').textContent = view.brighterReason || '';
    $('darkerReason').textContent = view.darkerReason || '';
  }

  function setDrill({
    available = true, phase = 'idle', summary = null, pauseReason = null,
    pauseBar = 1, audioStartFailed = false, disconnected = false,
    hintLevel = 0, plan = null, levelChange = null, passes = [], streaks = null,
    hasHistory = false, skill = null,
    family = 'scaleRun', question = null, kinds = null,
    questionKind = 'note', quizMode = 'find',
    correct = 0, revealed = 0,
    pair = null, chords = [], changes = null, barIndex = 0, bars = 0,
    tempo = null, micState = null, micScored = false, chart = null,
    intensity = 'full', stems = null, loopBars = 0, itemBars = 0,
    sessionBoundary = null, sessionOpen = false,
  } = {}) {
    const result = phase === 'result';
    const passReview = phase === 'passReview';
    const playing = phase === 'countIn' || phase === 'active' || phase === 'paused';
    const quiz = family === 'findNote';
    // The manual controls are painted from the same two view inputs as the cluster, so a
    // window that opens or closes mid-pass moves them without a second rule.
    micPhase = phase;
    micFamily = family;
    // Progress cannot be opened while a pass is live or awaiting its boundary
    // decision; practising another skill there would mutate settings behind the
    // running chart (WR-10).
    // Phase 6: Today follows the same guard (its five rows describe a stage the live pass already
    // owns), so both tabs in both bars go `aria-disabled` and stay focusable; the run lives on
    // Practice, so nothing needs closing.
    const lockedForProgress = playing || passReview;
    setNavLocked(lockedForProgress);
    // A drill start still disarms a parsed-but-unconfirmed import, so an old file can never be
    // applied later (WR-11), now that no Progress panel close carries it. Only the idle -> locked
    // transition does this: a live pass repaints on every beat, and closing the sheet on each paint
    // would make More (Stage mode, Lights, the mic) unreachable during a drill (CR-01).
    if (lockedForProgress && !wasLocked) {
      showImportConfirm(false);
      onImportReset();
      // A drill start never leaves the More sheet open over the stage it owns.
      closeMore();
    }
    wasLocked = lockedForProgress;
    // The lesson is reading material for the drill that is about to run, so its one control is
    // locked while a pass owns the stage and the panel closes with it: a lesson can never cover a
    // live pass (D-75).
    $('familyLearn').disabled = playing;
    $('startHere').disabled = playing;
    $('tunerBtn').disabled = playing;
    // The other Key selects write the same run-guarded `keyPc` plane, so they lock with Key while a
    // pass plays: a change `applyChange` drops must never sit in a reachable Library picker (WR-04).
    for (const id of KEY_PLANE_IDS) $(id).disabled = playing;
    if ($('workspaceWatch')) $('workspaceWatch').disabled = playing || passReview;
    if ($('pathMaterials')) $('pathMaterials').disabled = playing || passReview;
    document.querySelectorAll('[data-path]').forEach(button => { button.disabled = playing || passReview; });
    if (lockedForProgress) setLessonOpen(false);
    // The session boundary is the result panel's own next step: present only at a session
    // block's result, and never beside the Session panel or a pass that owns the stage (A-73).
    setSessionBoundary({
      ...(sessionBoundary && typeof sessionBoundary === 'object' ? sessionBoundary : {}),
      visible: !!(sessionBoundary && sessionBoundary.visible) && !lockedForProgress && !sessionOpen,
    });
    // Calibration cannot be open while a pass owns the stage either: the slot belongs to
    // the drill and the panel's action is disabled for the same reason.
    if (lockedForProgress) setCalibrationOpen(false);
    // Calibration is inert while a pass owns the stage, but the mic toggle stays live in
    // every phase (MIC-01): a change then applies at the next pass boundary.
    setMic({ state: micState || micCurrent, supported: micSupported, passLive: lockedForProgress });
    $('drillStage').hidden = !available || result || passReview;
    // The coach area's lesson openers left the drill stage (06-02) but keep its visibility.
    if ($('coachTools')) $('coachTools').hidden = !available || result || passReview;
    $('transportBar').hidden = !available || result || passReview;
    $('passReview').hidden = !available || !passReview;
    $('resultPanel').hidden = !available || !result;
    $('pauseBanner').hidden = !available || phase !== 'paused';
    $('countInOverlay').hidden = phase !== 'countIn' || quiz;
    $('progressWrap').hidden = !available || !playing;
    $('resultPanel').setAttribute('aria-label', 'Drill result');

    setFamilyPicker(family, playing || passReview);
    // The per-family visibility contract: a control that cannot act is absent, never
    // present and inert. A wait-mode pass has no clock, so its whole tempo plane goes.
    const chord = family === 'chordChanges';
    // The play-along's own control set: the item, the key, the tempo and Sound. The step
    // count, the direction select and the root drone cannot act on one chord per bar, and
    // the bar counter carries the position instead (04-02 Task 1).
    const play = family === 'progression' || family === 'song';
    show('beatDots', !quiz);
    show('beatText', !quiz);
    show('nowPlaying', !quiz);
    show('stepCount', !quiz && !chord);
    show('directionField', !quiz && !chord);
    show('tempoField', !quiz);
    show('droneField', !quiz && !chord);
    show('askForField', quiz);
    show('quizModeField', quiz);
    show('quizPrompt', quiz && available && !result && !passReview);
    // The pair strip and the Changes select belong to the chord stage only, and both go
    // at the boundary where the stage itself is hidden.
    show('pairStrip', chord && available && !result && !passReview);
    show('changesField', chord && !passReview);
    show('playKeyField', play);
    // A song is the only family that plays a named section, so the `Section` select is the
    // song's own control: present for it and absent for every other family, next to the Key
    // select that both play-along families share (04-03 Task 1). A single-section song has
    // nothing to choose, so the select is absent rather than present with one option (A-68).
    const songChart = family === 'song' ? chart : null;
    const songSections = songChart && Array.isArray(songChart.sections) ? songChart.sections : [];
    const songSection = songChart && songChart.content
      ? songSections.find(entry => entry.id === songChart.content.sectionId) || null
      : null;
    show('sectionField', family === 'song' && songSections.length > 1);
    // A-57: `Section` is the chart's identity, so it is live at idle only — locked from Start
    // through the result. `main.onSection` refuses every other phase as the second gate.
    $('section').disabled = phase !== 'idle';
    // A song loops a section, not a bar window: `Section loop` takes `Loop`'s place, and it is
    // absent for a song with nothing to loop — one section that plays once (A-68, D-66).
    const sectionLoopable = !!songChart
      && (songSections.length > 1 || (!!songSection && songSection.repeats > 1));
    show('loopField', !songChart);
    show('sectionLoopField', !!songChart && sectionLoopable);
    // The toggle's own paint: the chart's stored boolean, the visible state word and the ARIA
    // state always agree, and it is locked while a pass runs exactly like `Loop` (A-57).
    const sectionLoopOn = !!(songChart && songChart.content && songChart.content.sectionLoop);
    $('sectionLoop').checked = sectionLoopOn;
    $('sectionLoop').setAttribute('aria-pressed', sectionLoopOn ? 'true' : 'false');
    $('sectionLoopState').textContent = sectionLoopOn ? 'On' : 'Off';
    $('sectionLoop').disabled = playing;
    // The stage chart is the play-along's own family block, so it follows the same rule as
    // the pair strip: visible while the pass can be played, gone at the boundary and the
    // result. `renderStageChart` hides it again at recall and when there is no chart.
    show('stageChart', play && available && !result && !passReview);
    // The `Backing` cluster is the play-along's other family block: visible while the pass
    // can be played, gone at the boundary and the result like the pair strip. `Loop` is the
    // one control inside it that is locked while a pass is running (A-68).
    setBacking({
      intensity,
      stems,
      loopBars,
      // The item's own length, never the window: the chart carries both, and only the item's
      // length may decide which windows exist (CR-02, A-68).
      itemBars: chart && Number.isFinite(chart.itemBars)
        ? chart.itemBars
        : (Number.isFinite(itemBars) ? itemBars : (Number.isFinite(bars) ? bars : 0)),
      micState,
      visible: play && available && !result && !passReview,
      locked: playing,
    });
    if (play) {
      show('stepCount', false);
      show('directionField', false);
      show('droneField', false);
      renderStageChart({
        chart,
        level: hintLevel,
        barIndex: phase === 'idle' ? 0 : barIndex,
        visible: available && !result && !passReview,
      });
    }
    // `Mark change` is the mic-off count and `Mark hit` the mic-scored scale override:
    // both are painted here, and a control that cannot act is absent rather than
    // disabled-and-unexplained (CHORD-03, E34).
    applyMicControls();
    $('changes').disabled = playing || passReview;
    $('lockedHelper').textContent = chord ? LOCKED_HELPER.chordChanges : LOCKED_HELPER.scaleRun;
    if (LOCKED_HELPER[family]) $('lockedHelper').textContent = LOCKED_HELPER[family];
    // The strip fades on the same level as the board. A live pass repaints it from the
    // audio clock in main; every other phase paints it here.
    if (chord && !(phase === 'countIn' || phase === 'active')) {
      setPairStrip({ pair, chords, barIndex: phase === 'idle' ? 0 : barIndex, level: hintLevel });
    }
    if (kinds) setAskForOptions(kinds, questionKind);
    $('quizMode').value = quizMode === 'name' ? 'name' : 'find';
    $('startDrill').disabled = quiz && !!question && question.count === 0;
    // An unvoiceable bar is the chart's one error state: the stage chart names the problem
    // and the fix, and Start drill stays disabled until another key can voice every bar.
    if (chart && Array.isArray(chart.steps) && chart.steps.some(step => step.voicingId === null)) {
      $('startDrill').disabled = true;
    }

    show('startDrill', phase === 'idle');
    if ($('checkRecall')) { show('checkRecall', phase === 'idle'); $('checkRecall').disabled = $('startDrill').disabled; }
    show('pauseDrill', phase === 'countIn' || phase === 'active');
    show('resumeDrill', phase === 'paused');
    show('restartDrill', playing);
    show('stopDrill', playing);
    setLocked(playing || passReview);
    // A-38: the tempo plane is live at the boundary, so it has its own lock and is
    // disabled only while a pass is actually running.
    setTempoLocked(playing);
    // 10 IN-07: a completed recall with no self-report yet keeps its result: no card, row or
    // Play button may replace it (the pickers stay live; they only pick, never open).
    if (phase === 'result' && reportPendingOf(summary)) {
      setOpensLocked(true);
      for (const id of OPEN_PLAY_IDS) $(id).disabled = true;
    }
    // The guidance channel fades with the same level as the LEDs: chips disappear
    // from Anchors, and the browser chart/detail disappear at No lights.
    $('appShell').classList.toggle('cue-fade', available && playing && hintLevel >= 1);
    $('appShell').classList.toggle('cue-dark', available && playing && hintLevel >= 3);
    // Idle must not keep the last run's target or step count; the stage is visible
    // in browse and otherwise reads as a still-active drill (WR-04).
    if (phase === 'idle') { $('nowPlaying').textContent = ''; $('stepCount').textContent = '0 / 0'; }

    if (question) {
      setQuestion({
        index: question.index,
        count: question.count,
        effectiveMode: question.effectiveMode,
        prompt: question.prompt,
        poolText: question.poolText,
        chips: question.chips,
        answer: question.answer,
        outcome: question.outcome,
        answered: question.answered,
      });
    }

    if (phase === 'idle' || playing) {
      // The hint slot only exists inside a live pass; idle and paused offer no hint
      // action, and the quiz family never has one (its reveal is not a hint, A-44).
      setHintAction((phase === 'countIn' || phase === 'active') && !quiz ? hintLevel : -1);
      setHint({
        level: hintLevel,
        passIndex: plan ? plan.passIndex : 1,
        totalPasses: plan ? plan.totalPasses : null,
        levelChange,
        streaks,
        idle: phase === 'idle',
        hasHistory,
        family,
        mode: question ? question.effectiveMode : quizMode,
      });
    }

    if (passReview) {
      const last = passes.length ? passes[passes.length - 1] : null;
      const review = passReviewView({ last, levelChange, hintLevel });
      setPassReview({
        passIndex: plan ? plan.passIndex : 1,
        totalPasses: plan ? plan.totalPasses : null,
        completedSteps: last ? last.completedSteps : 0,
        plannedSteps: last ? last.plannedSteps : 0,
        bpm: last ? last.bpm : 0,
        levelChange,
        streaks,
        levelName: review.levelName,
        guided: review.guided,
        family,
        // The chord family's finalised pass record and the engine's tempo suggestion.
        // Both are the run's own numbers; nothing here hard-codes a bar count.
        changes,
        tempo,
        micScored,
        correct,
        revealed,
        // A song's pass line names its own section, resolved from the chart's content block.
        content: chart && chart.content ? chart.content : null,
      });
    }

    if (phase === 'paused') {
      $('pauseReason').textContent = PAUSE_REASON[pauseReason] || PAUSE_REASON.user;
      $('pauseBanner').classList.toggle('danger', pauseReason === 'ble' || pauseReason === 'audio');
      $('pauseHelper').textContent = quiz
        ? 'Resume returns to the same question.'
        : `Resumes from bar ${pauseBar} after a one-bar count-in.`;
      $('pauseReconnect').hidden = pauseReason !== 'ble' || !disconnected;
      $('pauseAudio').hidden = !audioStartFailed;
    }

    if (result && summary) renderResult(summary, skill);
  }

  // The strip explains the level, the pass plan and the fixed criteria. It never
  // animates and never reads the fade thresholds: counts and limits arrive in view.
  function setHint({
    level = 0, passIndex = 1, totalPasses = null, levelChange = null,
    streaks = null, idle = false, hasHistory = false, family = 'scaleRun', mode = 'find',
  } = {}) {
    const index = Number.isInteger(level) ? level : 0;
    const n = index + 1;
    const name = HINT_LEVEL_NAMES[index] || HINT_LEVEL_NAMES[0];
    [...$('hintPips').children].forEach((pip, i) => pip.classList.toggle('current', i === index));
    $('hintLevelText').textContent = idle ? `Starts at Level ${n} of 4` : `Level ${n} of 4`;
    $('hintLevelName').textContent = name;

    const counter = $('passCounter');
    counter.hidden = idle;
    if (!idle) {
      counter.textContent = totalPasses === null || totalPasses === undefined
        ? `Pass ${passIndex}`
        : `Pass ${passIndex} of ${totalPasses}`;
    }

    const reasonKey = levelChange ? levelChange.reasonKey : 'start';
    if (idle) {
      $('hintCriteria').textContent = hasHistory && reasonKey === 'start'
        ? HINT_REASONS.startSession
        : HINT_REASONS.start;
    } else if (family === 'findNote') {
      // The quiz never produces an `asked` reason: its reveal is not a hint (A-44).
      $('hintCriteria').textContent = index >= 3
        ? HINT_CRITERIA.quizRecall
        : (mode === 'name' ? HINT_CRITERIA.quizName : HINT_CRITERIA.levels);
    } else if (family === 'chordChanges') {
      // The loop, not the notes: the recall pass keeps the changes with no lights.
      $('hintCriteria').textContent = index >= 3 ? HINT_CRITERIA.chordRecall : HINT_CRITERIA.levels;
    } else if (family === 'progression' || family === 'song') {
      // The play-along's own two sentences, selected here or the table above is dead copy:
      // a progression's recall pass plays the whole chart from memory and a song's plays one
      // section, so each family reads its own pair (PROG-04, D-65).
      $('hintCriteria').textContent = index >= 3
        ? (family === 'song' ? HINT_CRITERIA.songRecall : HINT_CRITERIA.progressionRecall)
        : (family === 'song' ? HINT_CRITERIA.songLevels : HINT_CRITERIA.progressionLevels);
    } else {
      $('hintCriteria').textContent = index >= 3 ? HINT_CRITERIA.recall : HINT_CRITERIA.levels;
    }

    const asked = !idle && reasonKey === 'asked';
    $('hintReason').hidden = !asked;
    $('hintReason').textContent = asked ? HINT_REASONS.asked : '';
  }

  // Exactly one hint action is ever rendered: Blink pattern at Hint on demand, nothing at
  // any other level (Brighter asks for more light there). The play-alongs blink a
  // **chord**, so the label follows the family the picker last painted (WR-04).
  function setHintAction(hintLevel) {
    const action = hintActionFor(hintLevel);
    $('blinkPattern').hidden = action !== 'blink';
    $('blinkPattern').textContent = blinkActionLabel(currentFamily);
  }

  // Owns the pass-review radios. The result panel never touches them.
  function setPassReview({
    passIndex = 1, totalPasses = null, completedSteps = 0, plannedSteps = 0,
    bpm = 0, levelChange = null, streaks = null, levelName = '',
    family = 'scaleRun', correct = 0, revealed = 0, changes = null, tempo = null,
    micScored = false, content = null, guided = false,
  } = {}) {
    $('passReviewHeading').textContent = totalPasses === null || totalPasses === undefined
      ? `Pass ${passIndex} complete`
      : `Pass ${passIndex} of ${totalPasses} complete`;
    // The row reads its bar count from the finalised change record, never from a literal
    // eight: `planned` is the grid the pass actually ran. The record is read for every
    // family that supplies one, so a play-along boundary reports its own bars and changes
    // instead of `0 bars · 0 of 0 changes` (PROG-05).
    const chord = family === 'chordChanges';
    // A wait-mode quiz pass has no tempo at all, so it is the one family `+BPM` never touches.
    const timed = family !== 'findNote';
    const record = changes && typeof changes === 'object' ? changes : {};
    const planned = Number.isFinite(record.planned) ? record.planned : 0;
    // A play-along's change counts are microphone evidence. Without it the review says
    // `Not scored` in words rather than printing a zero the pass never measured (D-50, A-61).
    const play = family === 'progression' || family === 'song';
    const scoredChanges = play && !micScored ? null : changes;
    // A song names the section it just played; the section resolves from the chart's own
    // content block and never from a stored string (T-04-18).
    const songSection = family === 'song' ? songSectionOf(content || {}).section : null;
    $('passReviewSummary').textContent = passSummaryText({
      family,
      completedSteps,
      plannedSteps,
      bpm,
      levelName: levelName || HINT_LEVEL_NAMES[0],
      correct,
      revealed,
      bars: planned,
      clean: Number.isFinite(record.clean) ? record.clean : 0,
      planned,
      changesPerMin: Number.isFinite(record.changesPerMin) ? record.changesPerMin : 0,
      changes: scoredChanges,
      sectionName: songSection ? songSection.name : '',
      repeats: songSection ? (songSection.repeats || 1) : 1,
    });
    $('passReviewDecision').textContent = hintDecisionText({ levelChange, streaks });
    // FADE-09: a brightened pass says so, in fixed copy.
    $('passGuided').hidden = !guided;
    $('passGuided').textContent = guided ? GUIDED_LINE : '';
    // The tempo line belongs to the chord family alone: the input is pre-filled with the
    // engine's suggestion and the line says why, until the player edits it (A-38).
    $('tempoLine').hidden = !chord;
    if (chord) setTempoSuggestion(tempo || { bpm, reasonKey: 'skipped' });
    // A-77/T-05-08: every other timed family gets the same write with the line still hidden. `#bpm`
    // is the one input `nextPass()` reads, so `+BPM` is delivered by the continue button that already
    // exists; the untimed find-the-note pass has no tempo to move and is deliberately left alone.
    else if (timed) setTempoSuggestion(tempo || { bpm, reasonKey: 'skipped' });
    $('selfReport').setAttribute('aria-label', 'How did that pass go?');
    $('reportClean').setAttribute('aria-checked', 'false');
    $('reportShaky').setAttribute('aria-checked', 'false');
  }

  // The review pre-fill and its reason. `reasonKey` is one of the four approved forms;
  // `edited` is only ever produced by the player typing in `#bpm` at the boundary.
  function setTempoSuggestion({ bpm = 0, reasonKey = 'skipped' } = {}) {
    const value = Number.isFinite(bpm) ? Math.round(bpm) : 0;
    if (value > 0) $('bpm').value = String(value);
    tempoValue = value;
    $('tempoLine').textContent = tempoLineText({ bpm: value, reasonKey });
  }

  // The tempo line only exists inside an open chord pass review; every other phase
  // leaves it hidden with the review itself.
  function tempoLineVisible() {
    return !$('passReview').hidden && !$('tempoLine').hidden;
  }

  function byStringRowNode(row) {
    const item = document.createElement('li');
    item.className = 'by-string-row';
    const name = document.createElement('span');
    name.className = 'by-string-name';
    name.textContent = row.text;
    item.appendChild(name);
    if (row.meta) {
      const meta = document.createElement('span');
      meta.className = 'by-string-meta';
      meta.textContent = row.meta;
      item.appendChild(meta);
    }
    return item;
  }

  function renderResult(summary, skill = null) {
    const recall = summary.recall || { attempted: false, completed: false, selfReport: null, bpm: summary.bpm };
    const withHints = summary.withHints || { passes: [], clean: 0, endedAtLevel: summary.startLevel || 0 };
    // The hero is the mastery gate, never attendance: only a clean completed recall
    // pass makes it Mastered; a completed but unreported/shaky recall is Not yet; a
    // drill stopped before the recall is —.
    const mastered = !!(summary.mastered && (skill === null || skill.masteredAt !== null));
    $('resultHeading').textContent = summary.completed ? 'Drill complete' : 'Stopped early';
    $('resultVerdict').textContent = mastered ? (skill && Number.isFinite(skill.retainedAt) && summary.assessment && summary.assessment.coldRecall ? 'Retained later' : 'Recalled today') : recall.completed ? 'Not yet' : '—';
    $('resultHeroSub').textContent = mastered
      ? `${nextReviewText(skill ? skill.dueAt : null)} · ${summary.assessment && summary.assessment.source === 'selfReport' ? 'Self-reported' : 'Measured or player-corrected'}`
      : recall.completed
        ? `A clean no-light pass at ${summary.bpm} BPM records a recall. Use Check recall on another day to test retention.`
        : 'No recall pass was played.';

    const withHintCount = withHints.passes.length;
    $('withHintsValue').textContent = withHintCount === 1 ? '1 pass' : `${withHintCount} passes`;
    $('withHintsSub').textContent = withHintsSubText(withHints);
    $('noLightsValue').textContent = recall.completed ? '1 pass' : '0 passes';
    $('noLightsSub').textContent = !recall.completed
      ? 'Not reached'
      : recall.selfReport === 'clean'
        ? `Clean · ${summary.bpm} BPM`
        : recall.selfReport === 'shaky'
          ? `Shaky · ${summary.bpm} BPM`
          : 'Not reached';

    // FADE-09: a recall attempt that asked for more light is guided, never Recalled and
    // never Not reached. recallSelfReport stays hidden below (recall.completed is false).
    const guided = guidedResultView(summary);
    if (guided) {
      $('resultVerdict').textContent = guided.verdict;
      $('resultHeroSub').textContent = guided.heroSub;
      $('noLightsValue').textContent = guided.noLightsValue;
      $('noLightsSub').textContent = guided.noLightsSub;
    }

    // A-46: four family-specific tiles. The labels, values and subs all come from the
    // one pure table so the geometry stays fixed and no family inherits a metric it
    // never produced.
    const tiles = familyTiles(summary);
    $('resultNotesLabel').textContent = tiles[0].label;
    $('resultNotes').textContent = tiles[0].value;
    $('resultNotesSub').textContent = tiles[0].sub;
    $('resultAccuracyLabel').textContent = tiles[1].label;
    $('resultAccuracy').textContent = tiles[1].value;
    $('resultAccuracySub').textContent = tiles[1].sub;
    $('resultTimingLabel').textContent = tiles[2].label;
    $('resultTiming').textContent = tiles[2].value;
    $('resultTimingSub').textContent = tiles[2].sub;
    $('resultUnguidedLabel').textContent = tiles[3].label;
    $('resultUnguided').textContent = tiles[3].value;
    $('resultUnguidedSub').textContent = tiles[3].sub;

    // Exactly one mic line, below the grid, only when the pass produced mic evidence.
    const micLine = micLineText(summary);
    $('resultMicLine').hidden = micLine === null;
    $('resultMicLine').textContent = micLine === null ? '' : micLine;

    // A-48: the by-string list is six fixed rows and never reflows by count.
    const perString = summary.kind === 'findNote' && summary.questions
      ? byStringRows(byStringOf(summary.questions))
      : [];
    $('byString').hidden = perString.length === 0;
    $('byStringLabel').textContent = BY_STRING_LABEL;
    $('byStringList').replaceChildren(...perString.map(byStringRowNode));

    $('recallSelfReport').hidden = !recall.completed;
    $('recallClean').setAttribute('aria-checked', recall.selfReport === 'clean' ? 'true' : 'false');
    $('recallShaky').setAttribute('aria-checked', recall.selfReport === 'shaky' ? 'true' : 'false');

    $('resultMeta').textContent = resultMetaText(summary);

    // CHORD-04: the result offers the stored weakest pair as the next drill, and only when
    // it is a different pair from the one just played — the same pair is Repeat drill.
    const weakest = summary.weakestPair && typeof summary.weakestPair === 'object' ? summary.weakestPair : null;
    const playedPairId = typeof summary.chordPairId === 'string' ? summary.chordPairId : null;
    const offerWeakest = !!weakest && typeof weakest.pairId === 'string' && weakest.pairId !== playedPairId;
    $('practiseWeakestPair').hidden = !offerWeakest;
    if (offerWeakest) $('practiseWeakestPair').dataset.pair = weakest.pairId;
    else delete $('practiseWeakestPair').dataset.pair;
  }

  function setSelfReport(value) {
    $('reportClean').setAttribute('aria-checked', value === 'clean' ? 'true' : 'false');
    $('reportShaky').setAttribute('aria-checked', value === 'shaky' ? 'true' : 'false');
  }

  // ---------- The micro-lesson panel (05-02 Task 1, D-75) ----------
  // The fourth sibling of the three panel setters below: all four share one slot under the header,
  // so opening any one closes the other three with three explicit lines rather than a shared
  // helper — the exclusivity pin greps each setter's own body (05-01 kept the same shape for three).
  function setLessonOpen(open) {
    const on = !!open;
    const wasOpen = !$('lessonPanel').hidden;
    $('lessonPanel').hidden = !on;
    document.querySelectorAll('[aria-controls="lessonPanel"]').forEach(button => {
      button.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
    if (on) {
      setSessionOpen(false);
      setProgressOpen(false);
      setCalibrationOpen(false);
    }
    // Closing hands focus back to the button that opened the panel, never to a hidden node: an
    // opener on Today or Library sits in a view `switchView` has hidden, so it falls back to
    // Learn, or the workspace title when Learn is locked (WR-01).
    if (!on && wasOpen) {
      const returnTo = canFocus(lessonReturnFocus) ? lessonReturnFocus
        : canFocus($('familyLearn')) ? $('familyLearn') : $('workspaceTitle');
      returnTo.focus();
    }
    if (!on) {
      const demoVideo = $('lessonDemoVideo');
      if (demoVideo && typeof demoVideo.pause === 'function') demoVideo.pause();
    }
  }

  const isLessonOpen = () => !$('lessonPanel').hidden;
  // Rendered and enabled; a stub without layout counts as rendered.
  const canFocus = el => !!el && typeof el.focus === 'function' && !el.disabled
    && (typeof el.getClientRects !== 'function' || el.getClientRects().length > 0);

  function focusLessonHead() { $('lessonTitle').focus(); }

  function revealLessonSection(section) {
    const target = section === 'materials' ? $('lessonMaterials') : $('lessonReal');
    if (!target) return;
    if (target.tagName === 'DETAILS') target.open = true;
    target.scrollIntoView({ block: 'center' });
  }

  function setTunerOpen(open) {
    const on = !!open;
    $('tunerCard').hidden = !on;
    $('tunerBtn').setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) setPathActive('tune', false);
    else setPathActive(currentPath);
    if (!on) setTunerReading(null);
  }

  function setTunerReading(reading) {
    if (!reading || typeof reading !== 'object') {
      $('tunerNote').textContent = '—';
      $('tunerCents').textContent = 'Play one string and let it ring.';
      $('tunerCents').classList.remove('in-tune');
      return;
    }
    const octave = Number.isInteger(reading.octave) ? reading.octave : '';
    $('tunerNote').textContent = `${reading.note || '—'}${octave}`;
    const cents = Number.isFinite(reading.cents) ? Math.round(reading.cents) : 0;
    const inTune = Math.abs(cents) <= 3;
    $('tunerCents').textContent = inTune ? 'In tune' : `${Math.abs(cents)} cents ${cents < 0 ? 'flat' : 'sharp'}`;
    $('tunerCents').classList.toggle('in-tune', inTune);
  }

  function setTunerMessage(message = '') {
    $('tunerNote').textContent = '—';
    $('tunerCents').textContent = message;
    $('tunerCents').classList.remove('in-tune');
  }

  const lessonNode = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== '') node.textContent = text;
    return node;
  };

  function renderLessonChord(chord = {}) {
    const wrap = lessonNode('div', 'lesson-chord');
    wrap.append(lessonNode('div', 'lesson-chord-name', chord.name || ''));
    const frets = Array.isArray(chord.frets) ? chord.frets : [];
    const fingers = Array.isArray(chord.fingers) ? chord.fingers : [];
    const base = Number.isFinite(chord.baseFret) ? chord.baseFret : 0;
    const openRow = lessonNode('div', 'lesson-chord-open');
    for (let i = 0; i < 6; i++) {
      const fret = frets[i];
      openRow.append(lessonNode('span', '', fret === null || fret === undefined ? '×' : fret === 0 ? '○' : ''));
    }
    wrap.append(openRow);
    const grid = lessonNode('div', 'lesson-chord-grid');
    for (let row = 0; row < 5; row++) {
      for (let i = 0; i < 6; i++) {
        const cell = lessonNode('span', 'lesson-chord-cell');
        const fret = frets[i];
        const offset = Number.isFinite(fret) ? (base > 0 ? fret - base : fret - 1) : -1;
        if (offset === row) {
          const rootIndex = Number.isInteger(chord.rootString) ? 6 - chord.rootString : -1;
          const dot = lessonNode('span', 'lesson-chord-dot' + (i === rootIndex ? ' root' : ''),
            fingers[i] === null || fingers[i] === undefined ? '' : String(fingers[i]));
          cell.append(dot);
        }
        grid.append(cell);
      }
    }
    wrap.append(grid);
    wrap.append(lessonNode('div', 'lesson-chord-fret', base > 0 ? `${base}fr` : 'open'));
    return wrap;
  }

  function renderLessonShape(shape) {
    const host = $('lessonShape');
    host.replaceChildren();
    if (!shape || typeof shape !== 'object') return;
    host.append(lessonNode('div', 'lesson-shape-title', shape.title || ''));
    if (shape.kind === 'scale') {
      const start = Number.isFinite(shape.start) ? shape.start : 1;
      const frets = Number.isFinite(shape.frets) ? shape.frets : 5;
      const strings = Array.isArray(shape.strings) && shape.strings.length === 6 ? shape.strings : LESSON_STRINGS;
      const notes = Array.isArray(shape.notes) ? shape.notes : [];
      const board = lessonNode('div', 'lesson-scale');
      board.style.setProperty('--cols', String(frets));
      for (let s = 1; s <= 6; s++) {
        const row = lessonNode('div', 'lesson-scale-row');
        row.append(lessonNode('span', 'lesson-scale-string', strings[s - 1]));
        for (let i = 0; i < frets; i++) {
          const f = start + i;
          const cell = lessonNode('span', 'lesson-scale-cell');
          const note = notes.find(entry => entry.s === s && entry.f === f);
          if (note) {
            const dot = lessonNode('span', 'lesson-scale-note' + (note.root ? ' root' : '') + (note.blue ? ' blue' : ''), note.note || '');
            const finger = lessonFinger(note.f, start);
            if (finger > 0) dot.append(lessonNode('i', '', String(finger)));
            cell.append(dot);
          }
          row.append(cell);
        }
        board.append(row);
      }
      const fretRow = lessonNode('div', 'lesson-scale-frets');
      fretRow.append(lessonNode('span', 'lesson-scale-string', ''));
      for (let i = 0; i < frets; i++) fretRow.append(lessonNode('span', 'lesson-scale-fret', String(start + i)));
      board.append(fretRow);
      host.append(board);
      return;
    }
    if (shape.kind === 'chords') {
      const row = lessonNode('div', 'lesson-chords');
      (Array.isArray(shape.chords) ? shape.chords : []).forEach(chord => row.append(renderLessonChord(chord)));
      host.append(row);
      return;
    }
    if (shape.kind === 'strings') {
      const row = lessonNode('div', 'lesson-strings');
      (Array.isArray(shape.strings) ? shape.strings : []).forEach((label, i) => {
        const card = lessonNode('div', 'lesson-string-card');
        card.append(lessonNode('b', '', label));
        card.append(lessonNode('span', '', String(6 - i)));
        row.append(card);
      });
      host.append(row);
      return;
    }
    if (shape.kind === 'bars') {
      const row = lessonNode('div', 'lesson-bars');
      (Array.isArray(shape.bars) ? shape.bars : []).forEach((bar, i) => {
        const chip = lessonNode('span', 'lesson-bar');
        chip.append(lessonNode('span', '', String(i + 1)));
        chip.append(lessonNode('b', '', bar.name || ''));
        row.append(chip);
      });
      host.append(row);
      if (Array.isArray(shape.chords) && shape.chords.length) {
        const chords = lessonNode('div', 'lesson-chords');
        shape.chords.forEach(chord => chords.append(renderLessonChord(chord)));
        host.append(chords);
      }
    }
  }

  function renderLessonSteps(steps) {
    const list = Array.isArray(steps) ? steps : [];
    $('lessonSteps').replaceChildren(...list.map(step => {
      const item = document.createElement('li');
      item.append(lessonNode('b', '', step.title || ''));
      item.append(document.createTextNode(` ${step.body || ''}`));
      return item;
    }));
  }

  // One family's lesson. The heading is the family's own picker label so it can never contradict
  // the stage, the first three blocks carry their paragraph verbatim, and the fourth holds the one
  // real anchor. Every value is written with textContent and the anchor's glyph is built with
  // createElement — no stored or imported string is ever parsed as markup (T-05-15).
  function setLesson(lesson, { family = 'scaleRun' } = {}) {
    const source = lesson && typeof lesson === 'object' ? lesson : {};
    const name = Object.hasOwn(PRACTISE_FAMILY_NAMES, family)
      ? PRACTISE_FAMILY_NAMES[family] : PRACTISE_FAMILY_NAMES.scaleRun;
    $('lessonTitle').textContent = typeof source.title === 'string' && source.title.trim() !== ''
      ? source.title : name;
    const demo = lessonDemoView(source);
    const demoWrap = $('lessonDemoWrap');
    const demoVideo = $('lessonDemoVideo');
    if (demoWrap) demoWrap.hidden = !demo;
    if (demoVideo) {
      if (demo) {
        $('lessonDemoLabel').textContent = demo.label;
        $('lessonDemoCaption').textContent = 'Silent, 8 seconds. Fixed example; use the diagram above for your selected key and position. The drill adds the click.';
        demoVideo.setAttribute('aria-label', demo.label);
        if (demoVideo.getAttribute('src') !== demo.src) {
          demoVideo.pause();
          demoVideo.setAttribute('src', demo.src);
          if (demo.poster) demoVideo.setAttribute('poster', demo.poster);
          else demoVideo.removeAttribute('poster');
          demoVideo.load();
        } else {
          demoVideo.pause();
          try { demoVideo.currentTime = 0; } catch { /* metadata may still be loading */ }
        }
      } else {
        demoVideo.pause();
        demoVideo.removeAttribute('src');
        demoVideo.removeAttribute('poster');
        demoVideo.load();
      }
    }
    const guide = lessonGuideView(source.guide);
    $('lessonFocus').textContent = guide && guide.focus ? guide.focus : '';
    $('lessonFocus').hidden = !guide || !guide.focus;
    $('lessonGuided').hidden = !guide;
    if (guide) {
      renderLessonShape(guide.shape);
      renderLessonSteps(guide.steps);
      const action = guide.action || null;
      $('lessonActionRow').hidden = !action;
      lessonActionKind = action && typeof action.kind === 'string' ? action.kind : 'start';
      if (action) {
        $('lessonStart').textContent = action.label;
        $('lessonActionNote').textContent = action.note;
      }
    } else {
      $('lessonShape').replaceChildren();
      $('lessonSteps').replaceChildren();
      $('lessonActionRow').hidden = true;
      lessonActionKind = 'start';
    }
    const listen = guide && Array.isArray(guide.listen)
      ? guide.listen.filter(step => step && Number.isFinite(step.at) && Number.isFinite(step.midi))
      : [];
    lessonListenData = listen.length ? listen : null;
    $('lessonListenRow').hidden = !lessonListenData;
    const blocks = lessonBlocksText(source);
    $('lessonWhy').textContent = blocks[0].body;
    $('lessonMistake').textContent = blocks[1].body;
    $('lessonPractice').textContent = blocks[2].body;
    // The fourth block is the anchor or the `Not written yet.` body, never both and never neither.
    const view = lessonLinkView(source);
    const written = view.href !== null;
    $('lessonLinkRow').hidden = !written;
    $('lessonLinkEmpty').textContent = blocks[3].body;
    $('lessonLinkEmpty').hidden = written;
    $('lessonLinkNote').textContent = view.helper;
    $('lessonLinkNote').hidden = !written;
    const link = $('lessonLink');
    link.replaceChildren();
    if (written) {
      // The href is the content constant and nothing else: no record, no parameter, no join.
      link.setAttribute('href', view.href);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      link.textContent = view.label;
      const glyph = document.createElement('span');
      glyph.className = 'lesson-link-glyph';
      // The arrow is decoration inside the anchor: the accessible name is the label, and the
      // visible `Opens in a new tab.` helper is what tells a reader where the link goes (A-79).
      glyph.setAttribute('aria-hidden', 'true');
      glyph.textContent = '↗';
      link.append(' ', glyph);
    } else {
      link.removeAttribute('href');
    }
    const videos = lessonVideosView(source);
    $('lessonMaterials').hidden = videos.length === 0;
    $('lessonVideos').replaceChildren(...videos.map(video => {
      const item = document.createElement('li');
      item.className = 'lesson-video';
      const anchor = document.createElement('a');
      anchor.setAttribute('href', video.href);
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
      anchor.append(lessonNode('span', 'lesson-video-label', video.label));
      if (video.source) anchor.append(lessonNode('span', 'lesson-video-source', video.source));
      item.append(anchor);
      if (video.note) item.append(lessonNode('p', 'lesson-video-note', video.note));
      if (video.embed) {
        const play = lessonNode('button', 'lesson-video-play', 'Play here');
        play.type = 'button';
        play.addEventListener('click', () => {
          const frame = document.createElement('iframe');
          frame.className = 'lesson-video-frame';
          frame.src = video.embed;
          frame.title = video.label;
          frame.loading = 'lazy';
          frame.referrerPolicy = 'strict-origin-when-cross-origin';
          frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
          frame.allowFullscreen = true;
          item.replaceChildren(frame);
        });
        item.append(play);
      }
      return item;
    }));
  }

  // ---------- The Session panel (05-01) ----------
  // The third sibling of the panel setters: Progress, Calibration, Session and the micro-lesson
  // share one slot under the header, so opening any one closes the other three and the shell can
  // never show two of them in the same place.
  // Phase 6: the panel lives in the Today view and is always shown there, so this setter no longer
  // toggles visibility; `setView` owns which view is on screen. Opening still closes the two
  // overlay panels that can sit above any view.
  function setSessionOpen(open) {
    const on = !!open;
    if (on) {
      setCalibrationOpen(false);
      setLessonOpen(false);
    }
    // A-73: the boundary and the panel never show at once; the view decides, so repaint.
    paintBoundary();
  }

  // The Session panel is "open" exactly when the Today view is the one on screen (A-73).
  const isSessionOpen = () => currentView === 'today';

  function focusSessionHead() { $('sessionTitle').focus(); }

  // The Today tab's badge, in both bars (Phase 6, replaces the header Session chip). The visible
  // word never changes; the badge carries the due count at idle (hidden at 0, `99+` above 99) and
  // the block index while a session runs, and the tab's accessible name carries the meaning the
  // badge cannot, because the badge is hidden from assistive technology (A-69). The run lock is
  // `setNavLocked`, so the caller's `disabled` flag is no longer read here.
  function setSessionButton({ dueCount = 0, running = false, index = 0, total = 5 } = {}) {
    const count = Number.isFinite(dueCount) ? Math.max(0, Math.trunc(dueCount)) : 0;
    const size = Number.isFinite(total) && total > 0 ? Math.trunc(total) : 5;
    const position = Number.isInteger(index) ? Math.max(0, Math.min(size - 1, index)) : 0;
    const text = running ? `${position + 1} / ${size}` : (count > 99 ? '99+' : String(count));
    const label = todayTabLabel({ dueCount: count, running: !!running, index: position, total: size });
    for (const prefix of NAV_PREFIXES) {
      const badge = $(`${prefix}TodayBadge`);
      badge.textContent = text;
      badge.hidden = !running && count === 0;
      $(`${prefix}-today`).setAttribute('aria-label', label);
    }
  }

  // One plan row, in the approved slot order: name, minutes, the state chip and the reason last,
  // so a screen reader meets the item before the argument for it. Built with createElement and
  // textContent only — no stored or imported string is ever parsed as markup (T-05-06).
  function sessionBlockNode(block = {}, showPending = false, index = 0) {
    const source = block && typeof block === 'object' ? block : {};
    const item = document.createElement('li');
    item.className = 'session-block';
    const name = document.createElement('span');
    name.className = 'session-block-name';
    name.textContent = SESSION_BLOCK_NAMES[source.kind] || SESSION_BLOCK_NAMES.focus;
    const minutes = document.createElement('span');
    minutes.className = 'session-block-min';
    minutes.textContent = `${Number.isFinite(source.minutes) ? Math.max(0, Math.trunc(source.minutes)) : 0} min`;
    const state = document.createElement('span');
    state.className = 'session-block-state';
    const label = Object.hasOwn(SESSION_STATE_LABELS, source.state) ? SESSION_STATE_LABELS[source.state] : '';
    // The chip is absent from the plan view before the first session starts, and a pending block
    // only reads `Next` once a session is under way (UI-SPEC "Plan view").
    state.textContent = source.state === 'pending' && !showPending ? '' : label;
    state.hidden = state.textContent === '';
    // The chip's fill follows its state (sky, cobalt `now`, mint-soft `done`); only known states.
    if (label) state.dataset.state = source.state;
    const reason = document.createElement('span');
    reason.className = 'session-block-reason';
    reason.textContent = sessionReasonText({ reasonKey: source.reasonKey, values: source.reasonValues });
    // The row's own Start (09-01, TODAY-03): only a pending block with a target can be picked,
    // so any other row keeps the slot but hides and disables it.
    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'session-block-start';
    start.textContent = 'Start';
    const at = Number.isInteger(index) && index >= 0 ? index : 0;
    start.dataset.index = String(at);
    start.setAttribute('aria-label', `Start block ${at + 1}: ${name.textContent}`);
    const pickable = source.state === 'pending' && !!source.target && typeof source.target === 'object';
    start.hidden = !pickable;
    start.disabled = !pickable;
    item.append(name, minutes, reason, state, start);
    return item;
  }

  // The plan view: the note tells the truth about an empty history, the total is the fixed 13
  // minutes formatted by the one duration formatter, and only the five rows are rebuilt — the
  // note, the always-present intro and the footer are shell markup and survive every repaint.
  // Opening the panel again after a summary restores the plan view, its title, its total and its
  // own Start session, and the Plan/Practise control comes back with them.
  function setSessionPanel(view = {}) {
    const source = view && typeof view === 'object' ? view : {};
    const plan = source.plan && typeof source.plan === 'object' ? source.plan : null;
    const blocks = plan && Array.isArray(plan.blocks) ? plan.blocks : [];
    const minutes = plan && Number.isFinite(plan.totalMinutes) ? plan.totalMinutes : 13;
    setSessionSummary({ visible: false });
    $('sessionPlanNote').hidden = !(plan && plan.noHistory);
    $('sessionTotal').textContent = durationText(minutes * 60000);
    $('sessionBlocks').replaceChildren(...blocks.map((block, index) => sessionBlockNode(block, source.state !== 'idle', index)));
    // `Start session` exists in exactly one state — an idle plan — because it starts one. A session
    // that is already under way belongs to the panel's four verbs, so `Start session` leaves the
    // document instead of staying a filled, enabled control whose handler returns immediately
    // (WR-03, accent rule 19).
    const idle = source.state === 'idle';
    $('startSession').hidden = !idle;
    $('startSession').disabled = blocks.length === 0 || source.state !== 'idle';
    $('startSession').classList.toggle('cta', source.state === 'idle');
    // The panel's own four verbs belong to a session that is under way: at idle there is nothing
    // to skip, repeat or end, so the row is absent rather than present and inert.
    $('sessionPanelActions').hidden = source.state !== 'running';
    // Today has one Continue, the coach's own (09-01): the panel's mirror stays wired but hidden.
    $('panelNextBlock').hidden = true;
  }

  function resultCardNode(block) {
    const card = resultCardView(block);
    const item = document.createElement('li');
    item.className = 'result-card';
    const parts = [
      ['result-card-title', card.title], ['result-card-outcome', card.outcome],
      ['result-card-change', card.change], ['result-card-guided', card.guided], ['result-card-min', card.minutes],
    ];
    for (const [className, text] of parts) {
      if (!text) continue;
      const span = document.createElement('span');
      span.className = className;
      span.textContent = text;
      item.append(span);
    }
    return item;
  }

  // The Today coach thread: one result card per finished block in plan order, then the coach's
  // lines. Built with createElement and textContent only. Continue is shown only while a session
  // runs with no block under way, so it is never a second start beside a playing block.
  function setCoach(view = {}) {
    const source = view && typeof view === 'object' ? view : {};
    const blocks = Array.isArray(source.blocks) ? source.blocks : [];
    const lines = Array.isArray(source.lines) ? source.lines : [];
    const nodes = blocks
      .filter(block => block && typeof block === 'object' && block.result && typeof block.result === 'object')
      .map(resultCardNode);
    for (const line of lines) {
      const text = coachLineText(line, blocks);
      if (!text) continue;
      const item = document.createElement('li');
      item.className = 'coach-line';
      item.textContent = text;
      nodes.push(item);
    }
    $('coachThread').replaceChildren(...nodes);
    const button = $('coachContinue');
    button.hidden = !(source.state === 'running' && !blocks.some(block => block && block.state === 'now'));
    button.textContent = coachContinueText(blocks);
  }

  // The result panel's boundary, in the approved order, and the panel's mirror of the same row.
  // One table, so the accent can never move on one copy and stay on the other. Only `Next block`
  // can ever own the fill: accent rule 9 puts a recommended repeat on the strip's own continue
  // button (`Repeat drill` / `Repeat at 76 BPM`) because that is the control which delivers the
  // tempo and re-arms the block, and `Skip` and `End session` are never recommended at all
  // (WR-01, IN-07).
  const BOUNDARY_ACTIONS = [
    { id: 'nextBlock', mirror: 'panelNextBlock', accent: 'next' },
    { id: 'skipBlock', mirror: 'panelSkip', accent: null },
    { id: 'repeatBlock', mirror: 'panelRepeat', accent: null },
    { id: 'endSession', mirror: 'panelEnd', accent: null },
  ];
  // A-73: the boundary is present only at a session block's result and never beside the panel.
  // One flag plus the panel's own state decide the paint, so either close brings the boundary back.
  let boundaryVisible = false;
  function paintBoundary() {
    $('sessionBoundary').hidden = !boundaryVisible || isSessionOpen();
  }

  // The block boundary: one token naming the block and four neutral verbs, exactly one of which
  // carries the fill. The accent moves here and nowhere else — `next`, `skip`, `repeat` or `end`
  // names the owner, and a `stop` recommendation matches none, so all four stay neutral.
  // Once the block has a result the token also names its light change (TODAY-02), so a player
  // who never opens Today mid-session still sees it.
  function setSessionBoundary({
    visible = false, index = 0, total = 5, kind = 'focus', accentKey = 'next', fromLevel, toLevel,
  } = {}) {
    const at = Number.isInteger(index) ? Math.max(0, index) : 0;
    const size = Number.isFinite(total) && total > 0 ? Math.trunc(total) : 5;
    const name = Object.hasOwn(SESSION_BLOCK_NAMES, kind) ? SESSION_BLOCK_NAMES[kind] : SESSION_BLOCK_NAMES.focus;
    const change = Number.isInteger(fromLevel) && Number.isInteger(toLevel) ? ` · ${lightChangeText(fromLevel, toLevel)}` : '';
    $('sessionBoundaryToken').textContent = `Block ${Math.min(at + 1, size)} of ${size} · ${name}${change}`;
    boundaryVisible = !!visible;
    for (const action of BOUNDARY_ACTIONS) {
      const owner = boundaryVisible && action.accent !== null && action.accent === accentKey;
      $(action.id).classList.toggle('cta', owner);
      $(action.mirror).classList.toggle('cta', owner);
    }
    paintBoundary();
  }

  // A tile's minutes are the recorded pass time, never wall-clock, and never a `0 s` for a
  // session tile: the five tiles all read in minutes (05-UI-SPEC "Session summary").
  const sessionMinutesText = ms => `${Math.round((Number.isFinite(ms) ? Math.max(0, ms) : 0) / 60000)} min`;

  // The five sub-labels the summary tiles carry, written here so the panel never depends on the
  // shell keeping its default copy and the Blocks sub follows the session it describes.
  const SESSION_TILE_SUBS = {
    sessMinutesSub: 'This session.',
    sessUnguidedSub: 'No lights only.',
    sessStreakSub: 'Consecutive practice days.',
    sessSkillsSub: 'Touched this session.',
  };

  // The summary replaces the panel content: the plan list, the footer verbs and the total go, the
  // title becomes `Session complete` and `Done` takes the summary's only fill. `visible: false`
  // puts the plan view back, which is what closing the summary and reopening the panel both do.
  function setSessionSummary({ visible = false, summary = {}, nextText = '' } = {}) {
    const on = !!visible;
    const source = summary && typeof summary === 'object' ? summary : {};
    $('sessionSummary').hidden = !on;
    $('sessionPlan').hidden = on;
    // The summary replaces the whole panel content: the Plan/Practise control and the Practise
    // menu go with the plan list, so a finished session never shows a menu behind its tiles.
    $('sessionView').hidden = on;
    $('sessionPractise').hidden = true;
    $('sessionPanelActions').hidden = on;
    $('sessionTitle').textContent = on ? 'Session complete' : 'Session';
    $('sessionTotal').hidden = on;
    $('sessionDone').classList.toggle('cta', on);
    if (!on) return;
    const completed = Number.isFinite(source.completed) ? Math.max(0, Math.trunc(source.completed)) : 0;
    const skipped = Number.isFinite(source.skipped) ? Math.max(0, Math.trunc(source.skipped)) : 0;
    const total = Number.isFinite(source.total) && source.total > 0 ? Math.trunc(source.total) : 5;
    $('sessMinutes').textContent = sessionMinutesText(source.minutesMs);
    $('sessUnguided').textContent = sessionMinutesText(source.unguidedMs);
    $('sessStreak').textContent = countText(source.streak, 'day', 'days');
    $('sessBlocks').textContent = typeof source.blocks === 'string' ? source.blocks : `${completed} of ${total}`;
    $('sessSkills').textContent = String(Number.isFinite(source.skills) ? Math.max(0, Math.trunc(source.skills)) : 0);
    for (const [id, text] of Object.entries(SESSION_TILE_SUBS)) $(id).textContent = text;
    // `All five done.` is the only sub that speaks for the Blocks tile when nothing was skipped,
    // which is why the summary is the one place that knows both counts.
    $('sessBlocksSub').textContent = skipped === 0 && completed >= total
      ? 'All five done.'
      : `${skipped} skipped.`;
    $('sessionNext').textContent = typeof nextText === 'string' ? nextText : '';
  }

  // ---------- The Practise view and the recommendation strip (05-01 Task 3) ----------
  // The Plan/Practise control is a two-segment radiogroup with the drill-family picker's own
  // keyboard contract, and it writes nothing but the two containers' visibility: a plan view and a
  // free-choice menu are the same panel, so exactly one of them is ever open. The filter select and
  // its two lists follow the stored `practiseFilter`, so the view a player left is the view they
  // return to (D-73).
  function setSessionView({ view = 'plan', filter = 'due' } = {}) {
    const practise = view === 'practise';
    for (const [id, on] of [['viewPlan', !practise], ['viewPractise', practise]]) {
      $(id).setAttribute('aria-checked', on ? 'true' : 'false');
      $(id).setAttribute('tabindex', on ? '0' : '-1');
    }
    // The summary owns the panel while it is open: neither view is shown behind its five tiles.
    const summarised = !$('sessionSummary').hidden;
    $('sessionPlan').hidden = practise || summarised;
    $('sessionPractise').hidden = !practise || summarised;
    const pairs = filter === 'pairs';
    $('practiseFilter').value = pairs ? 'pairs' : 'due';
    $('practiseDueList').hidden = pairs;
    $('practisePairsList').hidden = !pairs;
  }

  // One family row: the family name, the item the seed would load and one `Start`. The accessible
  // name carries the item; the visible word stays `Start`, so the row never grows a sentence.
  function practiseFamilyNode(row = {}) {
    const source = row && typeof row === 'object' ? row : {};
    const family = Object.hasOwn(PRACTISE_FAMILY_NAMES, source.family) ? source.family : 'scaleRun';
    const name = PRACTISE_FAMILY_NAMES[family];
    const item = practiseItemText({ family, target: source.target, bpm: source.bpm });
    const node = document.createElement('li');
    node.className = 'practise-row';
    const label = document.createElement('span');
    label.className = 'practise-name';
    label.textContent = name;
    const copy = document.createElement('span');
    copy.className = 'practise-item';
    copy.textContent = item;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'practise-start';
    button.dataset.family = family;
    button.textContent = 'Start';
    button.setAttribute('aria-label', `Start ${name} — ${item}`);
    node.append(label, copy, button);
    return node;
  }

  // The due list's rows are the Progress panel's own row shape with the one stable verb `Start`,
  // and an empty list reuses `EMPTY_DUE` verbatim rather than inventing a second sentence for the
  // same fact (F7). Nothing here carries the accent outline: the Practise view is a menu, not an
  // alarm, and recommending is the Plan view's job.
  function practiseDueNode(row = {}, now = Date.now()) {
    const item = document.createElement('li');
    item.className = 'due-row';
    const copy = document.createElement('div');
    copy.className = 'due-copy';
    const name = document.createElement('span');
    name.className = 'due-name';
    name.textContent = skillLabelText(row.content, row.kind);
    const when = document.createElement('span');
    when.className = 'due-when';
    when.textContent = row.state === 'lapsed' ? 'due now' : dueText(row.dueAt, now);
    copy.append(name, when);
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.skill = typeof row.skillId === 'string' ? row.skillId : '';
    button.textContent = 'Start';
    button.setAttribute('aria-label', `Start ${name.textContent} — ${when.textContent}`);
    item.append(copy, button);
    return item;
  }

  function practisePairNode(row = {}, now = Date.now()) {
    const item = document.createElement('li');
    item.className = 'skill-row';
    const copy = document.createElement('div');
    copy.className = 'skill-copy';
    const name = document.createElement('span');
    name.className = 'pair-name';
    name.textContent = chordPairLabelText(row);
    const meta = document.createElement('span');
    meta.className = 'skill-meta';
    meta.textContent = chordPairRowText(row, now);
    copy.append(name, meta);
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.pair = typeof row.pairId === 'string' ? row.pairId : '';
    button.textContent = 'Start';
    button.setAttribute('aria-label', `Start ${name.textContent} — ${meta.textContent}`);
    item.append(copy, button);
    return item;
  }

  // The Practise view's three blocks: five family rows in the fixed order Scale run · Find the note ·
  // Chord changes · Progression · Song, then the due list or the weakest pairs behind the `Show`
  // filter. Every row seeds and none starts a pass (D-73); no action in this view is filled.
  function setPractiseView({ families = [], due = [], pairs = [], view = 'plan', filter = 'due', now = Date.now() } = {}) {
    const rows = Array.isArray(families) ? families : [];
    const dueRows = Array.isArray(due) ? due : [];
    const pairRows = Array.isArray(pairs) ? pairs : [];
    const stamp = Number.isFinite(now) ? now : Date.now();
    $('practiseFamilies').replaceChildren(...rows.map(practiseFamilyNode));
    const emptyDue = document.createElement('li');
    emptyDue.className = 'microcopy';
    emptyDue.textContent = EMPTY_DUE;
    $('practiseDueList').replaceChildren(...(dueRows.length ? dueRows.map(row => practiseDueNode(row, stamp)) : [emptyDue]));
    const emptyPairs = document.createElement('li');
    emptyPairs.className = 'microcopy';
    emptyPairs.textContent = EMPTY_CHORD_PAIRS;
    $('practisePairsList').replaceChildren(...(pairRows.length ? pairRows.map(row => practisePairNode(row, stamp)) : [emptyPairs]));
    // The filter and the two lists are one paint, exactly like the view control beside them.
    setSessionView({ view, filter });
  }

  // The recommendation strip (D-74, A-75, A-77): one sentence, at most one button, one owner of the
  // fill. `+BPM` is delivered by relabelling the continue button that already exists — never by a new
  // control — and `Stop` leaves nothing filled at all. The shell markup is never edited: the two
  // buttons keep their classes and their words, and only their textContent moves.
  function setRecommendation({ phase = 'passReview', key = 'repeat', nextLabel = '', bpm = 0, running = false, boundary = false } = {}) {
    const atResult = phase === 'result';
    const live = atResult || phase === 'passReview';
    $('passSuggestion').hidden = !live || atResult;
    $('resultSuggestion').hidden = !atResult;
    // `Next drill` needs a button exactly when no visible action row already carries one (A-75):
    // `Next block` is on screen only at a session block's result, so a pass review inside a block —
    // where no boundary is drawn at all — gets the strip's own button (WR-05).
    const needsButton = recommendationNeedsButton({ key, boundary });
    $('passNextDrill').hidden = !needsButton || atResult;
    $('resultNextDrill').hidden = !needsButton || !atResult;
    if (!live) {
      // No boundary: both strips go and the two continue buttons return to their shell words.
      $('nextPass').textContent = 'Next pass';
      $('nextPass').classList.toggle('cta', true);
      $('repeatRun').textContent = 'Repeat drill';
      $('repeatRun').classList.toggle('cta', !running);
      return;
    }
    const slot = atResult ? $('resultSuggestionText') : $('passSuggestionText');
    slot.textContent = recommendationText({ key, phase: atResult ? 'result' : 'passReview', nextLabel, bpm });
    const tempo = Number.isFinite(bpm) && bpm > 0 ? Math.round(bpm) : 0;
    const relabel = key === 'bpm' && tempo > 0;
    // The continue button is the one control `+BPM` uses: one press runs the tempo the strip named.
    const continueButton = atResult ? $('repeatRun') : $('nextPass');
    continueButton.textContent = relabel
      ? `${atResult ? 'Repeat at' : 'Next pass at'} ${tempo} BPM`
      : (atResult ? 'Repeat drill' : 'Next pass');
    if (!atResult) {
      // `Stop` is the one answer that leaves the pass review unfilled; every other keeps one owner.
      $('nextPass').classList.toggle('cta', !needsButton && key !== 'stop');
      $('passNextDrill').classList.toggle('cta', needsButton);
      return;
    }
    // At a result the boundary owns the fill only when it *is* the recommended action, i.e. a
    // `Next block`. A recommended repeat is the strip's own continue button, relabelled `Repeat
    // drill` / `Repeat at 76 BPM`, because that is the control that delivers the tempo; a `stop`
    // leaves nothing filled (accent rules 9 and 20, WR-01).
    const boundaryOwns = !!boundary && key === 'next';
    $('repeatRun').classList.toggle('cta', !boundaryOwns && !needsButton && key !== 'stop');
    $('resultNextDrill').classList.toggle('cta', needsButton);
  }

  // ---------- The four views (Phase 6) ----------
  // One painter over both tablists: exactly one `#view-*` is visible, the matching tab in *both*
  // bars is selected (so a resize never shows a stale bar), and roving tabindex follows it. A name
  // outside the closed list changes nothing, so a stored or forged value can never build an id.
  function setView(name) {
    if (!NAV_VIEWS.includes(name)) return;
    for (const v of NAV_VIEWS) {
      $('view-' + v).hidden = v !== name;
      for (const prefix of NAV_PREFIXES) {
        const tab = $(`${prefix}-${v}`);
        tab.setAttribute('aria-selected', v === name ? 'true' : 'false');
        tab.tabIndex = v === name ? 0 : -1;
      }
    }
    $('skipLink').setAttribute('href', '#view-' + name);
    currentView = name;
    // While Today is on screen its `Start session` owns the only filled action (accent rule 3).
    $('appShell').classList.toggle('session-open', name === 'today');
    // A-73: the boundary rule reads the view, so it is re-evaluated on every switch.
    paintBoundary();
  }

  // ---------- Progress panel ----------
  // Built with createElement/textContent only; no stored or imported string is ever
  // parsed as HTML. Every value arrives in the view model (T-02-10).
  // Phase 6: the panel lives in the Progress view and is always shown there; `setView` owns the
  // visibility. Opening still closes the two overlay panels that can sit above any view.
  function setProgressOpen(open) {
    const on = !!open;
    if (on) setCalibrationOpen(false);
    if (on) setLessonOpen(false);
    // Closing the panel (including the forced close when a drill starts) disarms a
    // parsed-but-unconfirmed import, so an old file can never be applied later (WR-11).
    if (!on) {
      showImportConfirm(false);
      onImportReset();
    }
  }

  // The Progress panel is "open" exactly when the Progress view is the one on screen.
  const isProgressOpen = () => currentView === 'progress';

  function focusProgressHead() { $('progressTitle').focus(); }

  // The run lock on the tabs (Phase 6): `aria-disabled`, never `disabled`, so a locked tab stays in
  // the tab order and still explains itself through `onView` when it is activated.
  const NAV_LOCKED_VIEWS = ['today', 'progress'];
  function setNavLocked(locked) {
    for (const v of NAV_LOCKED_VIEWS) {
      for (const prefix of NAV_PREFIXES) {
        const tab = $(`${prefix}-${v}`);
        if (locked) tab.setAttribute('aria-disabled', 'true');
        else tab.removeAttribute('aria-disabled');
      }
    }
  }

  // ---------- The mic cluster (D-45, D-51) ----------
  // The state is handed in on every change; this module keeps only the last word so the
  // permission prompt can hold it. `micCurrent` is a *view* input, never a second copy of
  // the stream state: main reads `mic.state` and passes it down (T-03-13).
  let micCurrent = 'off';
  let micWord = MIC_WORDS.off;
  let micSupported = true;
  let micPassLive = false;
  // The last stage the cluster was painted for, so a state change inside a pass can move
  // the two manual controls without `main` re-rendering the whole drill (E34).
  let micPhase = 'idle';
  let micFamily = 'scaleRun';
  // Whether the last drill paint locked the stage, so the sheet closes on the transition only.
  let wasLocked = false;

  // `Mark hit` lives in a mic-scored scale-run pass only, and `Mark change` only while a
  // chord pass has no listening window: two mutually exclusive manual paths, one rule.
  function micListeningView() {
    return micCurrent === 'listening';
  }

  function applyMicControls() {
    const live = micPhase === 'active';
    show('markHit', micFamily === 'scaleRun' && live && MIC_ON_STATES.includes(micCurrent));
    show('markChange', micFamily === 'chordChanges' && live && !micListeningView());
  }

  // The headphones hint is a fact about this device, not decoration: the speakers leak
  // into the mic exactly while the mic is on and Sound is on.
  function headphonesWanted() {
    const on = micCurrent === 'on' || micCurrent === 'listening';
    return on && !!$('sound').checked;
  }

  function applyMic() {
    const view = micView({
      state: micCurrent, previous: micWord, supported: micSupported, passLive: micPassLive,
    });
    micWord = view.word;
    const toggle = $('micToggle');
    toggle.setAttribute('aria-pressed', view.pressed ? 'true' : 'false');
    toggle.setAttribute('data-mic', view.glyph);
    toggle.disabled = view.toggleDisabled;
    if (view.busy) toggle.setAttribute('aria-busy', 'true');
    else toggle.removeAttribute('aria-busy');
    $('micState').textContent = view.word;
    // One action at a time: `Calibrate timing` while the mic is off, on or listening, `Try again`
    // after a denial. Denial is a normal state and never a danger colour (D-51).
    $('micCalibrate').textContent = view.action;
    $('micCalibrate').disabled = view.actionDisabled;
    $('headphonesLine').hidden = !headphonesWanted();
    applyMicControls();
    return view;
  }

  function setMic({ state = 'off', supported = true, passLive = false } = {}) {
    micCurrent = typeof state === 'string' && state ? state : 'off';
    micSupported = supported !== false;
    micPassLive = !!passLive;
    return applyMic();
  }

  // The one writer of the boot-time preflight line. A plain paragraph: not focusable, no
  // `role="status"`, never live, no colour — a capability is a fact, not an event (A-80).
  function setCapabilities(caps = {}) {
    const text = capabilityLineText(caps);
    $('capabilities').textContent = text;
    return text;
  }

  // The one writer of the wake note. Denial and absence are the same quiet sentence, shown
  // once and left for the page's lifetime: no retry, no dismiss, no colour, no announcement
  // (A-82). A held lock changes nothing on screen.
  function setWakeNote(visible = false) {
    const on = !!visible;
    $('wakeNote').hidden = !on;
    return on;
  }

  // Calibration's way back lands on the action that opened it; a locked action hands focus to the
  // toggle beside it, never to a disabled button (06-03).
  function focusMicCluster() { ($('micCalibrate').disabled ? $('micToggle') : $('micCalibrate')).focus(); }
  function focusCalibrationHead() { $('calibrationTitle').focus(); }
  function focusCalibrationTap() { $('calibTap').focus(); }

  // ---------- Calibration panel (D-48) ----------
  // Phase 6 (06-03): the panel lives in the More sheet and swaps in for its list. Opening it with the
  // sheet closed opens the sheet first. It still closes Progress, the Session panel and the lesson,
  // so no two panels ever both take focus.
  function setCalibrationOpen(open) {
    const on = !!open;
    if (on && !isMoreOpen()) openMore();
    $('calibrationPanel').hidden = !on;
    if ($('moreList')) $('moreList').hidden = on;
    if (on) setProgressOpen(false);
    if (on) setSessionOpen(false);
    if (on) setLessonOpen(false);
    if (!on) {
      showCalibrationError(null);
      $('calibrationRun').hidden = false;
      $('calibrationDoneBlock').hidden = true;
    }
    return on;
  }

  const isCalibrationOpen = () => !$('calibrationPanel').hidden;
  const CALIBRATION_ERROR_IDS = {
    denied: 'calibErrorDenied',
    none: 'calibErrorNone',
    tooFew: 'calibErrorTooFew',
    unavailable: 'calibErrorUnavailable',
  };

  function showCalibrationError(reason) {
    for (const [key, id] of Object.entries(CALIBRATION_ERROR_IDS)) $(id).hidden = key !== reason;
  }

  // The running block: the tap button, the click counter and the tap count. Every tap
  // flashes the button `--ok` for 120 ms; under reduced motion only the transition goes.
  function setCalibrationRunning({ clickIndex = 1, clickCount = 8, taps = 0 } = {}) {
    $('calibrationRun').hidden = false;
    $('calibrationDoneBlock').hidden = true;
    showCalibrationError(null);
    $('calibCount').textContent = calibrationCountText(clickIndex, clickCount);
    $('calibTaps').textContent = calibrationTapsText(taps);
  }

  function flashCalibrationTap() {
    const button = $('calibTap');
    button.classList.add('tap-tick');
    setTimeout(() => button.classList.remove('tap-tick'), 120);
  }

  // The done block: the measured offset, the warning above 250 ms, and the two actions.
  // The accent owner while the panel is open is `Done` (UI-SPEC accent rule 8).
  function setCalibrationResult({ offsetMs = 0, large = false } = {}) {
    $('calibrationRun').hidden = true;
    $('calibrationDoneBlock').hidden = false;
    showCalibrationError(null);
    $('calibResult').textContent = calibrationResultText(offsetMs);
    $('calibWarning').hidden = !large;
    $('calibDone').focus();
  }

  // One error line at a time, each with its own next step. The done block stays visible so
  // `Calibrate again` and `Done` remain reachable from an error; only the result goes.
  function setCalibrationError(reason = null) {
    const key = reason && CALIBRATION_ERROR_IDS[reason] ? reason : null;
    showCalibrationError(key);
    if (!key) return null;
    $('calibrationRun').hidden = true;
    $('calibrationDoneBlock').hidden = false;
    $('calibResult').textContent = '';
    $('calibWarning').hidden = true;
    return key;
  }

  function setBackupStatus(text, tone = '') {
    const el = $('backupStatus');
    el.textContent = text || '';
    el.classList.toggle('ok', tone === 'ok');
    el.classList.toggle('danger', tone === 'danger');
  }

  function focusBackupStatus() { $('backupStatus').focus(); }

  function setImportBusy(on) {
    const busy = !!on;
    $('exportBtn').disabled = busy;
    $('importBtn').disabled = busy;
    $('importReplace').disabled = busy;
    $('importKeep').disabled = busy;
    if (busy) $('importBtn').setAttribute('aria-busy', 'true');
    else $('importBtn').removeAttribute('aria-busy');
  }

  function showImportConfirm(on) {
    const visible = !!on;
    $('importConfirm').hidden = !visible;
    if (visible) $('importReplace').focus();
  }

  function renderHistory(sessions) {
    const bars = $('historyBars');
    const list = $('historyList');
    const rows = Array.isArray(sessions) ? sessions : [];
    bars.replaceChildren();
    list.replaceChildren();
    const totals = rows.map(session => Math.max(0, session.durationMs || 0));
    const max = totals.reduce((peak, value) => Math.max(peak, value), 0);
    rows.forEach((session, index) => {
      const total = Math.max(0, session.durationMs || 0);
      const unguided = Math.min(total, Math.max(0, session.unguidedMs || 0));
      const guided = Math.max(0, total - unguided);
      const bar = document.createElement('div');
      bar.className = 'history-bar';
      const guidedEl = document.createElement('div');
      guidedEl.className = 'history-guided';
      guidedEl.style.height = `${max ? (guided / max) * 100 : 0}%`;
      const unguidedEl = document.createElement('div');
      unguidedEl.className = 'history-unguided';
      unguidedEl.style.height = `${max ? (unguided / max) * 100 : 0}%`;
      bar.append(guidedEl, unguidedEl);
      bars.appendChild(bar);

      const item = document.createElement('li');
      item.textContent = `Session ${index + 1}: ${durationText(total)}, ${durationText(unguided)} unguided.`;
      list.appendChild(item);
    });
  }

  function renderDue(rows, now) {
    const holder = $('dueList');
    holder.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('li');
      empty.className = 'microcopy';
      empty.textContent = EMPTY_DUE;
      holder.appendChild(empty);
      return;
    }
    rows.forEach((row, index) => {
      const item = document.createElement('li');
      item.className = 'due-row';
      const copy = document.createElement('div');
      copy.className = 'due-copy';
      const name = document.createElement('span');
      name.className = 'due-name';
      name.textContent = skillLabelText(row.content, row.kind);
      const when = document.createElement('span');
      when.className = 'due-when';
      // A lapsed row is due now even when its scheduled bucket is still in the
      // future; never print "due in 15 days" beside a Lapsed chip (WR-04).
      when.textContent = row.state === 'lapsed' ? 'due now' : dueText(row.dueAt, now);
      copy.append(name, when);
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.skill = row.skillId;
      button.textContent = 'Practise';
      // Only the first due row carries the accent outline (UI-SPEC accent rule 12).
      if (index === 0) button.className = 'accent-outline';
      item.append(copy, button);
      holder.appendChild(item);
    });
  }

  function skillRowNode(row, now) {
    const item = document.createElement('li');
    item.className = 'skill-row';
    const copy = document.createElement('div');
    copy.className = 'skill-copy';
    const name = document.createElement('span');
    name.className = 'skill-name';
    name.textContent = skillLabelText(row.content, row.kind);
    const meta = document.createElement('span');
    meta.className = 'skill-meta';
    meta.textContent = skillRowText(row, now);
    copy.append(name, meta);
    // The optional third line carries microphone evidence only; a Phase 2 record has
    // none, so the row keeps its two lines and the geometry never reserves an empty slot.
    const evidence = micEvidenceText(row);
    if (evidence) {
      const line = document.createElement('span');
      line.className = 'skill-meta skill-evidence';
      line.textContent = evidence;
      copy.appendChild(line);
    }
    const state = SKILL_STATE_LABELS[row.state] ? row.state : 'learning';
    const chip = document.createElement('span');
    chip.className = 'state-chip ' + state;
    chip.textContent = SKILL_STATE_LABELS[state];
    item.append(copy, chip);
    return item;
  }

  // One Chord pairs row and one All pairs row share this builder: the pair name, the four
  // statistics and a neutral Practise button. The accent outline belongs to the first due
  // skill row only, so a pair row never carries it.
  function chordPairRowNode(row, now) {
    const item = document.createElement('li');
    item.className = 'skill-row';
    const copy = document.createElement('div');
    copy.className = 'skill-copy';
    const name = document.createElement('span');
    name.className = 'pair-name';
    name.textContent = chordPairLabelText(row);
    const meta = document.createElement('span');
    meta.className = 'skill-meta';
    meta.textContent = chordPairRowText(row, now);
    copy.append(name, meta);
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.pair = row.pairId;
    button.textContent = 'Practise';
    item.append(copy, button);
    return item;
  }

  // The section is a fixed five-row list plus the one scroller, like Skills; the empty
  // line replaces the rows only, because the section itself hides with the whole panel.
  function renderChordPairs(rows, all, now) {
    const holder = $('chordPairList');
    holder.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('li');
      empty.className = 'microcopy';
      empty.textContent = EMPTY_CHORD_PAIRS;
      holder.appendChild(empty);
    } else {
      holder.replaceChildren(...rows.map(row => chordPairRowNode(row, now)));
    }
    $('allPairsSummary').textContent = `${ALL_PAIRS_PREFIX} (${all.length})`;
    $('allPairs').hidden = all.length === 0;
    $('allPairsList').replaceChildren(...all.map(row => chordPairRowNode(row, now)));
  }

  function renderSkills(rows, now) {
    const holder = $('skillList');
    holder.replaceChildren(...rows.map(row => skillRowNode(row, now)));
  }

  function renderAllSkills(rows, now) {
    $('allSkillsSummary').textContent = `All skills (${rows.length})`;
    $('allSkills').hidden = rows.length === 0;
    $('allSkillsList').replaceChildren(...rows.map(row => skillRowNode(row, now)));
  }

  // ---------- Light levels by family (PROG-09) ----------
  // One row per family: name + total, an aria-hidden stacked bar and a visible count line
  // naming all five buckets, so the colour never carries the number alone.
  function renderFamilyBars(rows) {
    const counts = familyLevelCounts(rows);
    $('familyBars').replaceChildren(...LIGHT_FAMILIES.map(family => {
      const buckets = counts[family];
      const total = buckets.reduce((sum, n) => sum + n, 0);
      const row = document.createElement('div');
      row.className = 'family-row';
      row.dataset.family = family;
      const name = document.createElement('div');
      name.className = 'family-name';
      name.textContent = `${FAMILY_NAMES[family]} · ${countText(total, 'skill', 'skills')}`;
      const bar = document.createElement('div');
      bar.className = 'family-bar';
      bar.setAttribute('aria-hidden', 'true');
      bar.append(...buckets.map((n, i) => {
        const seg = document.createElement('span');
        seg.className = 'family-seg';
        seg.dataset.bucket = FAMILY_BUCKETS[i];
        const pct = total > 0 ? Math.max(0, Math.min(100, (n / total) * 100)) : 0;
        seg.style.width = `${Math.round(pct * 100) / 100}%`;
        seg.hidden = n === 0;
        return seg;
      }));
      const count = document.createElement('p');
      count.className = 'family-count';
      count.textContent = total === 0
        ? 'Nothing yet'
        : buckets.map((n, i) => `${n} ${FAMILY_BUCKET_NAMES[i]}`).join(' · ');
      row.append(name, bar, count);
      return row;
    }));
  }

  // ---------- The neck you own (PROG-08) ----------
  // 120 own-cell nodes built on first render, then only data-level changes. The grid is
  // aria-hidden and has no listeners: the visible box list is its text alternative, and it
  // is a different class from the live board so nothing here can reach audition or LEDs.
  let ownedCells = null;
  function renderOwnedNeck(rows) {
    const view = ownedNeckView(rows);
    if (!ownedCells) {
      ownedCells = new Map();
      const nodes = [];
      for (let f = 0; f <= OWNED_FRETS; f++) {
        for (let s = 6; s >= 1; s--) {
          const node = document.createElement('div');
          node.className = 'own-cell';
          node.dataset.fret = String(f);
          ownedCells.set(`${s}:${f}`, node);
          nodes.push(node);
        }
      }
      $('ownedNeck').replaceChildren(...nodes);
    }
    ownedCells.forEach((node, key) => {
      // A box recorded but never played clean (-1) is listed as Not started, never shaded.
      if (!view.cells.has(key) || view.cells.get(key) < 0) { delete node.dataset.level; return; }
      const level = String(view.cells.get(key));
      if (node.dataset.level !== level) node.dataset.level = level;
    });
    const hasBoxes = view.boxes.length > 0;
    $('ownedList').hidden = !hasBoxes;
    $('ownedEmpty').hidden = hasBoxes;
    $('ownedList').replaceChildren(...view.boxes.map(box => {
      const item = document.createElement('li');
      item.className = 'own-item';
      item.textContent = `${box.label} — ${ownedLevelName(box.level)}`;
      return item;
    }));
  }

  function setProgressPanel(view = {}) {
    const now = Number.isFinite(view.now) ? view.now : Date.now();
    const totals = view.totals || {};
    const streak = view.streak || {};
    const sessions = Array.isArray(view.sessions) ? view.sessions : [];
    const skills = Array.isArray(view.skills) ? view.skills : [];
    const due = Array.isArray(view.due) ? view.due : [];
    const all = Array.isArray(view.all) ? view.all : [];
    // The panel gets the five weakest pairs for the fixed list and the whole table for the
    // disclosure; a caller that only passes one list still renders both from it.
    const pairs = Array.isArray(view.chordPairs) ? view.chordPairs : [];
    const allPairs = Array.isArray(view.allChordPairs) ? view.allChordPairs : pairs;
    const dueCount = Number.isFinite(view.dueCount) ? view.dueCount : due.length;

    $('progStreak').textContent = countText(streak.current, 'day', 'days');
    $('progPractised').textContent = durationText(totals.totalMs);
    $('progPractisedSub').textContent = `Across ${countText(totals.sessionCount, 'session', 'sessions')}.`;
    $('progUnguided').textContent = durationText(totals.unguidedMs);
    $('progDue').textContent = countText(dueCount, 'skill', 'skills');

    // Zero recorded skills (or an unreadable plane) renders the empty state instead of
    // empty lists; the Backup section always stays available.
    const empty = all.length === 0;
    $('ownedSection').hidden = empty;
    $('familySection').hidden = empty;
    $('historySection').hidden = empty;
    $('dueSection').hidden = empty;
    $('skillsSection').hidden = empty;
    // The pair section follows the same whole-panel rule: hidden only when nothing at all
    // is recorded, present with its own empty line in a populated panel.
    $('chordPairSection').hidden = empty;
    $('progressEmpty').hidden = !empty;
    renderOwnedNeck(empty ? [] : all);
    renderFamilyBars(empty ? [] : all);
    if (!empty) {
      renderHistory(sessions);
      renderDue(due, now);
      renderSkills(skills, now);
      renderAllSkills(all, now);
      renderChordPairs(pairs, allPairs, now);
    } else {
      renderHistory([]);
      renderDue([], now);
      renderSkills([], now);
      renderAllSkills([], now);
      renderChordPairs([], [], now);
    }

    const message = view.message || { text: '', tone: '' };
    setBackupStatus(message.text, message.tone);
  }

  // Every frame during count-in/active: beat dots, target pulse and overlay all read
  // the same audio-clock beat passed by main; no animation timer. The meter arrives as a
  // trailing options object so the existing call shape survives — the shell keeps its four
  // static dots as the ceiling and a 3/4 chart hides the fourth rather than lighting a beat
  // that never arrives (PITFALL 34).
  function renderBeat(beat, phase, bpm = 70, { beatsPerBar = 4, beatInBar = null } = {}) {
    const b = Number.isFinite(beat) ? beat : 0;
    const perBar = Number.isFinite(beatsPerBar) && beatsPerBar > 0 ? Math.trunc(beatsPerBar) : 4;
    // The transport's own 1-based `beatInBar` when it is there, the beat's phase in the bar
    // otherwise; either way the result is a 0-based dot index inside this chart's meter.
    const inBar = Number.isFinite(beatInBar) && beatInBar >= 1
      ? Math.min(perBar - 1, Math.trunc(beatInBar) - 1)
      : ((Math.floor(b) % perBar) + perBar) % perBar;
    dots.forEach((dot, i) => {
      dot.hidden = i >= perBar;
      dot.classList.toggle('active', i === inBar);
      dot.classList.toggle('beat-1', i === 0);
    });
    const beatText = `Beat ${inBar + 1} of ${perBar}`;
    if (beatText !== lastBeatText) { $('beatText').textContent = beatText; lastBeatText = beatText; }
    const pulse = (bpm > 150 ? Math.floor(b / 2) : Math.floor(b)) % 2 === 0;
    $('board').classList.toggle('pulse-on', pulse);

    if (phase === 'countIn') {
      const n = inBar + 1;
      $('countInOverlay').hidden = false;
      $('countNumeral').textContent = String(n);
      $('countLabel').textContent = `Count-in · ${n} of ${perBar}`;
      $('countGo').hidden = n !== perBar;
      if (n !== lastCount) {
        announce(`Count-in ${n} of ${perBar}`);
        lastCount = n;
      }
    } else {
      $('countInOverlay').hidden = true;
      lastCount = 0;
    }
  }

  function resetBeat(beatsPerBar = 4) {
    const perBar = Number.isFinite(beatsPerBar) && beatsPerBar > 0 ? Math.trunc(beatsPerBar) : 4;
    // The meter is the ceiling at idle exactly as it is on the beat: a 3/4 chart hides the
    // fourth dot here too, so the idle surface cannot promise a beat the chart never plays
    // (A-62, PITFALL 34; WR-03).
    dots.forEach((dot, i) => {
      dot.classList.remove('active', 'beat-1');
      dot.hidden = i >= perBar;
    });
    $('board').classList.remove('pulse-on');
    $('countInOverlay').hidden = true;
    lastCount = 0;
    // The shell's static default stays four, so a fresh page with no run is honest.
    const beatText = `Beat 1 of ${perBar}`;
    if (lastBeatText !== beatText) {
      $('beatText').textContent = beatText;
      lastBeatText = beatText;
    }
  }

  function setNowPlaying(text, step = 0, total = 0) {
    $('nowPlaying').textContent = text;
    $('stepCount').textContent = `${step} / ${total}`;
  }

  function setProgress(percent) {
    const pct = Math.min(100, Math.max(0, Number(percent) || 0));
    $('progressFill').style.width = pct + '%';
    $('progressWrap').setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  function setTempoValue(bpm) {
    const parsed = Number(bpm);
    const value = Number.isFinite(parsed) ? Math.round(parsed) : tempoValue;
    $('bpm').value = String(value);
    // At the chord boundary the line follows the number in the box: any change made
    // through the field or the steppers is the player's, never the engine's suggestion.
    if (tempoLineVisible()) {
      tempoValue = value;
      $('tempoLine').textContent = tempoLineText({ bpm: value, reasonKey: 'edited' });
    }
  }
  function setTapPreview(text) { $('tapPreview').textContent = text; }

  // ---------- The More sheet (06-03) ----------
  // One native modal dialog holds the tuner, the mic cluster, the backup and the settings toggles.
  // `showModal` gives the focus trap and Esc; every close path (Close, Esc, the backdrop, a drill
  // start) ends in the dialog's own `close` event, which owns the side effects and the focus return.
  // Stub documents have no dialog API, so every call is guarded.
  let announcerHome = null;
  function isMoreOpen() {
    const sheet = $('moreSheet');
    return !!(sheet && sheet.open);
  }
  function openMore() {
    const sheet = $('moreSheet');
    if (!sheet || typeof sheet.showModal !== 'function' || sheet.open) return false;
    const node = $('announcer');
    node.textContent = '';
    sheet.appendChild(node);
    markAnnouncerMoved();
    sheet.showModal();
    $('moreBtn').setAttribute('aria-expanded', 'true');
    return true;
  }
  function closeMore() {
    const sheet = $('moreSheet');
    if (sheet && sheet.open && typeof sheet.close === 'function') sheet.close();
  }
  function onMoreClosed() {
    const node = $('announcer');
    if (announcerHome && announcerHome.parent && typeof announcerHome.parent.insertBefore === 'function') {
      announcerHome.parent.insertBefore(node, announcerHome.next);
      markAnnouncerMoved();
    }
    $('moreBtn').setAttribute('aria-expanded', 'false');
    onMoreClose();
    // Never rely on the UA's focus restore: the sheet may have been opened from the learning path.
    $('moreBtn').focus();
  }

  function wire() {
    fillPath();
    const announcerNode = $('announcer');
    announcerHome = { parent: announcerNode.parentNode || null, next: announcerNode.nextSibling || null };
    const sheet = $('moreSheet');
    if ($('moreBtn')) $('moreBtn').addEventListener('click', () => openMore());
    // Closing the guitar menu hands focus back to the pill unless the player already moved it on.
    const connMenu = $('connMenu');
    if (connMenu) connMenu.addEventListener('toggle', e => {
      if (e.newState !== 'closed') return;
      const active = document.activeElement;
      const inside = active && typeof connMenu.contains === 'function' && connMenu.contains(active);
      if (!active || active === document.body || inside) $('connectBtn').focus();
    });
    if ($('closeMore')) $('closeMore').addEventListener('click', () => closeMore());
    if (sheet) {
      // The body fills the dialog box, so a click whose target is the dialog is the backdrop. A press
      // that starts inside the body and is released on the backdrop also targets the dialog, so
      // the press must have started there too (IN-02).
      let pressedBackdrop = false;
      sheet.addEventListener('pointerdown', e => { pressedBackdrop = e.target === sheet; });
      sheet.addEventListener('click', e => { if (e.target === sheet && pressedBackdrop) closeMore(); pressedBackdrop = false; });
      sheet.addEventListener('close', () => onMoreClosed());
    }
    $('key').addEventListener('change', e => onChange('keyPc', +e.target.value));
    $('scale').addEventListener('change', e => onChange('scaleId', e.target.value));
    $('position').addEventListener('change', e => onChange('positionId', e.target.value));
    $('labels').addEventListener('change', e => onChange('labels', e.target.value));
    $('chord').addEventListener('change', e => onChange('chordId', e.target.value));
    $('voicing').addEventListener('change', e => onChange('voicingId', e.target.value));
    $('progression').addEventListener('change', e => onChange('progressionId', e.target.value));
    $('progressionKey').addEventListener('change', e => onChange('keyPc', +e.target.value));
    $('playKey').addEventListener('change', e => onChange('keyPc', +e.target.value));
    // `Play` seeds the drill stage and never starts it: the seed closes the panels, sets
    // family, item, key and tempo and focuses Start drill (PROG-01, D-59).
    $('playProgression').addEventListener('click', () => onPlay('progression', $('progression').value));
    $('song').addEventListener('change', e => onChange('songId', e.target.value));
    // A-56: the Songs tab's `Key` select writes the same `keyPc` plane as every other tab,
    // and its `Play` seeds the song stage without starting it (D-59).
    $('songKey').addEventListener('change', e => onChange('keyPc', +e.target.value));
    $('playSong').addEventListener('click', () => onPlay('song', $('song').value));
    $('direction').addEventListener('change', e => onChange('direction', e.target.value));
    // The headphones hint follows the two controls it describes, so the same listener
    // that commits Sound re-applies the mic cluster.
    $('sound').addEventListener('change', e => { onChange('sound', e.target.checked); applyMic(); });
    $('drone').addEventListener('change', e => onChange('drone', e.target.checked));
    // The `Backing` cluster: the preset writes all four stems in one save, a hand toggle
    // writes exactly one, and `Loop` is the window the next chart build reads (A-58, A-68).
    $('intensity').addEventListener('change', e => onIntensity(e.target.value));
    for (const { id } of STEM_OPTIONS) {
      $(id).addEventListener('change', e => onStem(id, e.target.checked));
    }
    $('loop').addEventListener('change', e => onLoop(Number(e.target.value)));
    // The song's own two controls. `Section` is the chart's identity and is legal at idle
    // only; `Section loop` repeats the section inside the pass and never re-keys it, so it is
    // live at idle, the pass review and the result like `Loop` beside it (A-57, D-64).
    $('section').addEventListener('change', e => onSection(e.target.value));
    $('sectionLoop').addEventListener('change', e => onSectionLoop(e.target.checked));

    const commitTempo = () => onTempo(+$('bpm').value);
    $('bpm').addEventListener('change', commitTempo);
    $('bpm').addEventListener('blur', commitTempo);
    $('bpm').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commitTempo(); } });
    // A-38: typing at the boundary is the only thing that turns the line into `set by
    // you`; an emptied field keeps the last number rather than naming a zero.
    $('bpm').addEventListener('input', () => {
      if (!tempoLineVisible()) return;
      const typed = Number($('bpm').value);
      const value = Number.isFinite(typed) && typed > 0 ? Math.round(typed) : tempoValue;
      tempoValue = value;
      $('tempoLine').textContent = tempoLineText({ bpm: value, reasonKey: 'edited' });
    });
    const nudge = delta => onTempo(Math.round((Number($('bpm').value) || 70) + delta));
    $('bpmDown5').addEventListener('click', () => nudge(-5));
    $('bpmDown1').addEventListener('click', () => nudge(-1));
    $('bpmUp1').addEventListener('click', () => nudge(1));
    $('bpmUp5').addEventListener('click', () => nudge(5));
    $('bpmTap').addEventListener('click', () => {
      const now = globalThis.performance && globalThis.performance.now ? globalThis.performance.now() : Date.now();
      const btn = $('bpmTap');
      btn.classList.add('tap-tick');
      setTimeout(() => btn.classList.remove('tap-tick'), 120);
      onTap(now);
    });

    const transport = [
      ['startDrill', 'start'], ['pauseDrill', 'pause'], ['resumeDrill', 'resume'],
      ['restartDrill', 'restart'], ['stopDrill', 'stop'], ['pauseResume', 'resume'],
      ['pauseStop', 'stop'], ['repeatRun', 'repeat'], ['nextPass', 'next'], ['endDrill', 'end'],
    ];
    for (const [id, action] of transport) $(id).addEventListener('click', () => onTransport(action));
    if ($('checkRecall')) $('checkRecall').addEventListener('click', () => onTransport('recall'));
    if ($('reportCorrection')) $('reportCorrection').addEventListener('click', () => onSelfReport('corrected'));
    if ($('recallCorrection')) $('recallCorrection').addEventListener('click', () => onRecallReport('corrected'));
    // FADE-08: Brighter is -1, Darker +1. An aria-disabled button stays focusable but inert.
    $('brighterBtn').addEventListener('click', () => {
      if ($('brighterBtn').getAttribute('aria-disabled') === 'true') return;
      onDimmer(-1);
    });
    $('darkerBtn').addEventListener('click', () => {
      if ($('darkerBtn').getAttribute('aria-disabled') === 'true') return;
      onDimmer(1);
    });
    $('blinkPattern').addEventListener('click', () => onHint());
    $('stageBtn').addEventListener('click', () => onStageMode($('stageBtn').getAttribute('aria-pressed') !== 'true'));
    $('backToBrowse').addEventListener('click', () => onBack());

    const segments = [...$('familyPicker').querySelectorAll('[role=radio]')];
    const chooseFamily = segment => {
      if (!segment || segment.disabled) return;
      onFamily(segment.dataset.family);
    };
    $('familyPicker').addEventListener('click', e => chooseFamily(e.target.closest('[role=radio]')));
    $('familyPicker').addEventListener('keydown', e => {
      const at = segments.indexOf(document.activeElement);
      let next = null;
      if (e.key === 'ArrowRight') next = (at + 1) % segments.length;
      else if (e.key === 'ArrowLeft') next = (at - 1 + segments.length) % segments.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = segments.length - 1;
      if (next === null) return;
      e.preventDefault();
      const target = segments[next];
      if (target && !target.disabled) {
        target.focus();
        chooseFamily(target);
      }
    });
    $('askFor').addEventListener('change', e => onChange('quizQuestion', e.target.value));
    $('quizMode').addEventListener('change', e => onChange('quizMode', e.target.value));
    $('changes').addEventListener('change', e => onPairChange(e.target.value));
    $('markChange').addEventListener('click', () => onMarkChange());
    $('markHit').addEventListener('click', () => onMarkHit());
    $('answerChips').addEventListener('click', e => {
      const chip = e.target.closest('button[data-chip]');
      if (chip) onAnswer({ chip: chip.dataset.chip });
    });
    $('revealAnswer').addEventListener('click', () => onReveal());
    $('nextQuestion').addEventListener('click', () => onNextQuestion());

    $('startSession').addEventListener('click', () => onSessionStart());
    // The coach's Continue is the same CONTINUE handler as `Next block`: one dispatcher (09-01).
    $('coachContinue').addEventListener('click', () => onSessionNext());
    // One delegated listener for every row's Start; the index is parsed and checked here and
    // again by the reducer, which refuses anything but a pending block with a target.
    $('sessionBlocks').addEventListener('click', e => {
      const button = e && e.target && typeof e.target.closest === 'function' ? e.target.closest('button.session-block-start') : null;
      if (!button || !button.dataset) return;
      const index = Number.parseInt(button.dataset.index, 10);
      if (Number.isInteger(index)) onSessionPick(index);
    });
    // The boundary's four verbs and their panel mirror call the same four handlers, so the two
    // containers can never disagree about what `Next block`, `Skip`, `Repeat` or `End session`
    // does. `Done` is the summary's own way out and does exactly what `Hide session` does.
    for (const [id, handler] of [
      ['nextBlock', onSessionNext], ['skipBlock', onSessionSkip],
      ['repeatBlock', onSessionRepeat], ['endSession', onSessionEnd],
    ]) {
      $(id).addEventListener('click', () => handler());
    }
    for (const [id, handler] of [
      ['panelNextBlock', onSessionNext], ['panelSkip', onSessionSkip],
      ['panelRepeat', onSessionRepeat], ['panelEnd', onSessionEnd],
    ]) {
      $(id).addEventListener('click', () => handler());
    }
    $('sessionDone').addEventListener('click', () => onSessionClose());
    // The lesson's two controls: one press of `Learn` in the family row, one `Close` in the panel's
    // head. There is no second entry point — the lesson is reachable at idle only (D-75).
    $('familyLearn').addEventListener('click', () => { lessonReturnFocus = $('familyLearn'); onLearn(); });
    $('lessonClose').addEventListener('click', () => onLessonClose());
    $('lessonStart').addEventListener('click', () => {
      if (lessonActionKind === 'powerPractice') onPowerPractice();
      else onLessonStart();
    });
    $('powerChordLearn').addEventListener('click', () => { lessonReturnFocus = $('powerChordLearn'); onPowerChord(); });
    $('startHere').addEventListener('click', () => { lessonReturnFocus = $('startHere'); onStartHere(); });
    $('lessonListen').addEventListener('click', () => onLessonListen(lessonListenData));
    $('tunerBtn').addEventListener('click', () => {
      if ($('tunerCard').hidden) onTunerStart();
      else onTunerStop();
    });
    $('tunerClose').addEventListener('click', () => onTunerStop());
    if ($('changeInLibrary')) $('changeInLibrary').addEventListener('click', () => onChangeInLibrary());
    // The empty Progress view's one action goes through the same switcher (the run lock applies).
    if ($('openToday')) $('openToday').addEventListener('click', () => onView('today'));
    if ($('libraryCta')) $('libraryCta').addEventListener('click', () => onPractiseSelection());
    if ($('workspaceWatch')) $('workspaceWatch').addEventListener('click', () => {
      lessonReturnFocus = $('workspaceWatch');
      onLessonSection('real');
    });
    if ($('pathMaterials')) $('pathMaterials').addEventListener('click', () => {
      lessonReturnFocus = $('pathMaterials');
      onLessonSection('materials');
    });
    document.querySelectorAll('[data-path]').forEach(button => {
      button.addEventListener('click', () => {
        lessonReturnFocus = button;
        onPath(button.dataset.path);
      });
    });

    // The Session panel's own two views and the Practise menu's seeds. The `Plan`/`Practise` control
    // is the drill-family picker's contract again — Arrow Left/Right, Home and End move between two
    // segments and keep focus on the chosen one — and every `Start` in the menu seeds through a
    // delegated listener, so a rebuilt list never leaks a handler.
    const viewSegments = [$('viewPlan'), $('viewPractise')];
    const chooseView = segment => {
      if (!segment) return;
      onSessionView(segment.id === 'viewPractise' ? 'practise' : 'plan');
    };
    $('sessionView').addEventListener('click', e => chooseView(e.target.closest('[role=radio]')));
    $('sessionView').addEventListener('keydown', e => {
      const at = viewSegments.indexOf(document.activeElement);
      let next = null;
      if (e.key === 'ArrowRight') next = (at + 1) % viewSegments.length;
      else if (e.key === 'ArrowLeft') next = (at - 1 + viewSegments.length) % viewSegments.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = viewSegments.length - 1;
      if (next === null) return;
      e.preventDefault();
      chooseView(viewSegments[next]);
      if (viewSegments[next]) viewSegments[next].focus();
    });
    $('practiseFilter').addEventListener('change', e => onPractiseFilter(e.target.value));
    $('practiseFamilies').addEventListener('click', e => {
      const button = e.target.closest('button[data-family]');
      if (!button) return;
      onPractiseFamily(button.dataset.family);
    });
    $('practiseDueList').addEventListener('click', e => {
      const button = e.target.closest('button[data-skill]');
      if (!button) return;
      onPractiseDueRow(button.dataset.skill);
    });
    $('practisePairsList').addEventListener('click', e => {
      const button = e.target.closest('button[data-pair]');
      if (!button) return;
      onPractisePairRow(button.dataset.pair);
    });
    for (const id of ['passNextDrill', 'resultNextDrill']) {
      $(id).addEventListener('click', () => onNextDrill());
    }

    // The mic cluster: one toggle, one action. `Calibrate` and `Try again` are the same
    // control — the label says which press it is — so a denial is retried from here.
    $('micToggle').addEventListener('click', () => onMicToggle());
    $('micCalibrate').addEventListener('click', () => onCalibrate());
    // The tap button is a native button, so Space and Enter both fire a tap.
    $('calibTap').addEventListener('click', () => onCalibrationTap());
    $('calibSkip').addEventListener('click', () => onCalibrationSkip());
    $('closeCalibration').addEventListener('click', () => onCalibrationSkip());
    $('calibDone').addEventListener('click', () => onCalibrationDone());
    $('calibAgain').addEventListener('click', () => onCalibrationAgain());
    $('exportBtn').addEventListener('click', () => onExport());
    $('importBtn').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', e => {
      const input = e.target;
      const file = input.files && input.files.length ? input.files[0] : null;
      onImportFile(file);
      // Clear the picker so choosing the same file again after an error fires change
      // again; the File object itself stays readable (IN-05).
      input.value = '';
    });
    $('importReplace').addEventListener('click', () => onImportConfirm());
    $('importKeep').addEventListener('click', () => onImportCancel());
    $('dueList').addEventListener('click', e => {
      const button = e.target.closest('button[data-skill]');
      if (!button) return;
      onPractiseSkill(button.dataset.skill);
    });
    // One delegated listener per pair list, so a rebuilt section never leaks a handler.
    for (const id of ['chordPairList', 'allPairsList']) {
      $(id).addEventListener('click', e => {
        const button = e.target.closest('button[data-pair]');
        if (!button) return;
        onPractisePair(button.dataset.pair);
      });
    }
    $('practiseWeakestPair').addEventListener('click', () => onPractiseWeakestPair());
    // Escape closes the lesson, a non-modal Practice panel. While the More sheet is open the key
    // belongs to the dialog: a preventDefault here would cancel its close and shut the lesson behind
    // the modal instead (06-03, Pitfall 5). Calibration has no listener of its own: it lives in the
    // sheet, whose Esc close already runs calibration's close path once. The same holds for an open
    // guitar menu (its own Esc closes it), and a lesson left open in a hidden Practice view is not
    // the player's to close from Today or Library (IN-01).
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !isLessonOpen()) return;
      if (isMoreOpen()) return;
      if (isConnMenuOpen() || !$('view-practice') || $('view-practice').hidden) return;
      e.preventDefault();
      onLessonClose();
    });
    for (const id of ['reportClean', 'reportShaky']) {
      $(id).addEventListener('click', () => onSelfReport($(id).dataset.report));
    }
    for (const id of ['recallClean', 'recallShaky']) {
      $(id).addEventListener('click', () => onRecallReport($(id).dataset.report));
    }

    $('chart').addEventListener('click', e => {
      const btn = e.target.closest('button[data-bar]');
      if (!btn) return;
      onBar(+btn.dataset.bar);
    });

    // One delegated listener per Library card list (10-02). main re-checks the family and the id
    // against its own tables, so the dataset is never trusted (T-10-05).
    for (const listId of Object.values(CARD_LISTS)) {
      const list = $(listId);
      if (!list) continue;
      list.addEventListener('click', e => {
        const target = e && e.target;
        const card = target && typeof target.closest === 'function' ? target.closest('.lib-card') : null;
        if (!card || card.disabled) return;
        onOpenItem(card.dataset.family, card.dataset.id);
      });
    }

    // The Library search (10-03): every keystroke filters the prebuilt rows; clearing restores the tab.
    const search = $('librarySearch');
    if (search) search.addEventListener('input', () => applySearch(search.value));
    // A result opens exactly as its card does: main re-checks family and id (T-10-10).
    const results = $('searchResults');
    if (results) {
      results.addEventListener('click', e => {
        const target = e && e.target;
        const row = target && typeof target.closest === 'function' ? target.closest('.search-row') : null;
        if (!row || row.disabled) return;
        onOpenItem(row.dataset.family, row.dataset.id);
      });
    }

    // The main navigation: eight tabs, two bars, one handler. Click, Enter and Space all arrive as
    // a click and go to `onView`, which owns the run lock. Arrow keys move focus with roving
    // tabindex and activate the target, except a locked tab: moving focus onto it is silent.
    for (const prefix of NAV_PREFIXES) {
      const navTabs = NAV_VIEWS.map(v => $(`${prefix}-${v}`));
      navTabs.forEach((tab, i) => {
        tab.addEventListener('click', () => onView(NAV_VIEWS[i]));
      });
      $(`${prefix}List`).addEventListener('keydown', e => {
        const i = navTabs.indexOf(e.target);
        if (i < 0) return;
        let next = null;
        if (e.key === 'ArrowRight') next = (i + 1) % navTabs.length;
        else if (e.key === 'ArrowLeft') next = (i - 1 + navTabs.length) % navTabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = navTabs.length - 1;
        if (next === null) return;
        e.preventDefault();
        const target = navTabs[next];
        target.focus();
        if (target.getAttribute('aria-disabled') !== 'true') onView(NAV_VIEWS[next]);
      });
    }

    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(TABS[i], false, true));
      tab.addEventListener('keydown', e => {
        let next = null;
        if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
        else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = TABS.length - 1;
        if (next === null) return;
        e.preventDefault();
        select(TABS[next], true, true);
      });
    });
  }

  fillStaticOptions();
  buildLibraryCards();
  buildSearchRows();
  wire();
  return {
    render, setStatus, setConnection, openConnMenu, closeConnMenu, isConnMenuOpen, setFeedback, announce, setLights, select, revealLessonSection,
    renderLibrary,
    setDrill, renderBeat, resetBeat, setNowPlaying, setProgress, setTempoValue,
    renderStageChart, setDimmer,
    setTapPreview, setSelfReport, setHint, setPassReview, setStageMode,
    setHintAction,
    setView,
    setNavLocked,
    openMore, closeMore, isMoreOpen,
    setProgressPanel, setProgressOpen, isProgressOpen, focusProgressHead,
    setSessionPanel, setCoach, setSessionOpen, isSessionOpen, setSessionButton, focusSessionHead,
    setLesson, setLessonOpen, isLessonOpen, focusLessonHead,
    setTunerOpen, setTunerReading, setTunerMessage,
    setSessionBoundary, setSessionSummary, setSessionView, setPractiseView, setRecommendation,
    setBackupStatus, focusBackupStatus, setImportBusy, showImportConfirm,
    setFamilyPicker, setQuestion, setAskForOptions, focusNextQuestion,
    setPairStrip, setChangesSelect, setTempoSuggestion,
    setMic, focusMicCluster, focusCalibrationHead, focusCalibrationTap,
    setCapabilities, setWakeNote,
    setCalibrationOpen, isCalibrationOpen, setCalibrationRunning, setCalibrationResult,
    setCalibrationError, flashCalibrationTap,
  };
}
