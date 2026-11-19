// ---------- Composition root ----------
// Browse plus the first complete drill: one AudioContext, one transport, one rAF
// loop, one LED sink and the pure reducer fan-out. Only this module wires adapters.
import {
  SCALES, SCALE_BY_ID, scaleById, CHORD_FAMILIES, chordById, CHORD_PAIRS, chordPairById,
  PROGRESSIONS, progressionById, SONGS, songById, KEY_NAMES, DEGREES, INTERVALS, INTERVAL_NAMES,
  LESSONS, lessonFor as contentLessonFor,
} from './content.js';
import {
  OPEN, spellPitch, spellScale, positionsForScale, remapPosition, notesForScale, notesForPosition,
  expandChord, expandProgression, expandSongSection, voiceChord,
} from './theory.js';
import {
  buildScaleRunChart, buildNoteQuizChart, buildChordChangeChart, buildPlayAlongChart, createRun,
  reduce, frameAt, stepIndexFor, summarizeDrill, PLAY_FAMILIES, CHART_CHANGES, songSectionBars,
  sectionAtBar, playAlongIdleFrame,
} from './drills.js';
import { buildQuestions, chipsFor, judge, poolLabel, promptText, questionMode, quizKindsFor } from './quiz.js';
import { FADE, HINT_LEVELS } from './fade.js';
import {
  applyResult, chordPairRows, dayKey, dueRows, emptyProgress, exportDoc, skillRows, startLevelFor,
  validateBackup, weakestPair,
} from './progress.js';
import { buildSegment, tapTempo, createTransport, LEAD_SEC } from './transport.js';
import { createLedSink, sceneFromNotes } from './leds.js';
import { createGuitar, bluetoothSupported } from './guitar.js';
import { createAudio } from './audio.js';
import { createMic, micWindowStep, tunerReading } from './mic.js';
import { createWakeLock, wakelockSupported, wakeLockStep } from './wakelock.js';
import {
  SCORE, barForOnset, calibrationOffset, nextPitchStreak, outputTimeMs, pitchClassOf, scoreBars, scoreSteps, scoreSummary, tapOffsetMs,
} from './score.js';
import { createSettingsStore, validateSettings, DRILL_FAMILIES, INTENSITY_STEMS, STEM_KEYS, LOOP_BARS, THEMES } from './settings.js';
import { createFretboard, labelFor } from './fretboard.js';
import {
  createPanels, boardInteractiveFor, hintAnnouncementText, hintAskedText, barCounterText, countText,
  playCounterText, playAlongPassAnnouncement, playAlongStartAnnouncement, quizOutcomeText,
  chordPassAnnouncement, spotGate, openStringCue, EXPORT_FAILED, IMPORT_MESSAGE,
  STORAGE_MESSAGE, MIC_FEEDBACK, MIC_ANNOUNCE, CALIBRATION, skillLabelText, practiseItemText,
} from './panels.js';
import {
  FAMILY_ORDER, SESSION_BLOCKS, buildSessionPlan, emptySession, sessionReduce, sessionSummaryOf, suggestionFor,
} from './session.js';

const $ = id => document.getElementById(id);
// A content map is a plain object, so an inherited key ("constructor", "toString",
// "__proto__") must never resolve as a real progression or song (CR-02, T-04-15).
const ownEntry = (map, key) => (typeof key === 'string' && Object.hasOwn(map, key) ? map[key] : null);
const TABS = ['scales', 'chords', 'progressions', 'songs'];
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const nowMs = () => (globalThis.performance && globalThis.performance.now ? globalThis.performance.now() : Date.now());
// One timer pair for the transport and the mic adapter: the only intervals this app owns.
const browserTimer = { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: handle => clearInterval(handle) };
const AUDIO_START_FAILED = 'Audio could not start. Tap Resume to try again.';
const OPEN_STRING_FEEDBACK = 'Open string — screen only (no LED on the T2).';
// One predicate for "this chart is a play-along", so every reader — the composer, the spot
// line, the counter, the progress bar, the two boundary announcements and the rebuilt next
// pass — asks `drills`' own family set rather than inventing a second list (T-04-02).
function isPlayAlong(chart) {
  return !!(chart && PLAY_FAMILIES.has(chart.family));
}
// The meter the beat row paints: the chart's own `beatsPerBar`, or the shell's four-beat
// default when no chart owns the stage. The four static dots are the ceiling and the panel
// hides the rest, so a 3/4 song idles on three dots and `Beat 1 of 3` (A-62, WR-03).
function meterOf(source) {
  return source && Number.isFinite(source.beatsPerBar) && source.beatsPerBar > 0 ? source.beatsPerBar : 4;
}
// The section a song chart plays, read from the chart's own section list — the same list the
// header, the counter and the `Section` select read, so the live region can never name a
// section the pass is not playing. A progression carries none, and an absent entry is no
// prefix rather than a guess (T-04-18).
function chartSectionName(chart) {
  const content = (chart && chart.content) || {};
  const sections = chart && Array.isArray(chart.sections) ? chart.sections : [];
  const section = sections.find(entry => entry.id === content.sectionId) || null;
  return section && typeof section.name === 'string' ? section.name : '';
}
const ANNOUNCE = {
  'paused-ble': 'Paused — guitar disconnected.',
  'paused-hidden': 'Paused — you switched away.',
  'paused-audio': 'Paused — audio stopped.',
  'paused-user': 'Paused.',
  'result-complete': 'Drill complete.',
  'result-stopped': 'Stopped early.',
  // The chord boundary counts changes; the play-along beside it counts its own bars and
  // says `Not scored` in words when the mic heard nothing; every other family keeps the
  // Phase 2 word (A-10, A-61). A song names its section first, so the sentence reads
  // `Verse. Four bars. Not scored.` — the prefix comes from the chart's own section list.
  'pass-review': () => {
    if (!run || !run.chart) return 'Pass review.';
    if (isPlayAlong(run.chart)) {
      const changes = run.changes && typeof run.changes === 'object' ? run.changes : {};
      return playAlongPassAnnouncement({
        bars: Number.isFinite(run.chart.bars) ? run.chart.bars : 0,
        clean: Number.isFinite(changes.clean) ? changes.clean : 0,
        planned: Number.isFinite(changes.planned) ? changes.planned : (run.chart.bars || 0),
        scored: !!run.syncScore,
        sectionName: chartSectionName(run.chart),
      });
    }
    return run.chart.family === 'chordChanges'
      ? chordPassAnnouncement({
        clean: run.changes && Number.isFinite(run.changes.clean) ? run.changes.clean : 0,
        planned: run.changes && Number.isFinite(run.changes.planned) ? run.changes.planned : 0,
      })
      : 'Pass review.';
  },
  // A play-along's count-in names the pass before it starts: `Twelve bars. Starting on G.`
  // or, for a song, `Verse. Four bars. Starting on G.`
  'pass-start': () => {
    if (!isPlayAlong(run && run.chart)) return 'Count-in.';
    const first = Array.isArray(run.chart.steps) ? run.chart.steps[0] : null;
    return playAlongStartAnnouncement({
      bars: Number.isFinite(run.chart.bars) ? run.chart.bars : 0,
      chordName: first ? first.chordName : '',
      sectionName: chartSectionName(run.chart),
    });
  },
  'pass-asked': () => hintAskedText({
    level: run ? run.hintLevel : 0,
    levelNames: HINT_LEVELS.map(level => level.name),
  }),
  // The one question announcement. It reads the post-dispatch run, so the prompt is
  // always the effective-mode sentence the card is showing.
  question: () => {
    const question = openQuestion();
    if (!question) return '';
    const mode = questionMode(question, run ? run.hintLevel : 0);
    return `Question ${run.questionIndex + 1} of ${run.questions.length}. ${promptText(question, mode)}`;
  },
  idle: 'Ready.',
};

let store = null;
let settings = null;
let panels = null;
let board = null;
let audio = null;
let ctx = null;
let guitar = null;
let sink = null;
let transport = null;
let view = { notes: [] };
let connected = false;
let battery = null;
let chart = null;
let run = null;
// The daily session lives here and is never persisted: a reload abandons it and the plan is
// rebuilt from the progress plane (05-UI-SPEC "Session lifecycle").
let session = emptySession();
// The five rows the panel shows while nothing runs. It is recomputed only while the session is
// idle, so a row and its reason can never move under the player once a session has started.
let previewPlan = null;
// The only thing that distinguishes a session block's run from any other run: set by `seedBlock`,
// cleared by every other seed, every run-clearing path and every credit (T-05-02).
let pendingBlock = null;
let progress = emptyProgress();
let resultSkill = null;
let pendingImport = null;
let backupMessage = { text: '', tone: '' };
let tapTimes = [];
let tapPreviewTimer = null;
let flashFeedbackUntilBeat = 0;
let mic = null;
let tunerActive = false;
let tunerRequest = 0;
let startingDrill = false;
// The one screen-wake-lock adapter and the note latch. The adapter's state is the only truth
// about the lock; `wakeNoteShown` only remembers that the quiet sentence has been shown once,
// so a later pause cannot hide it again for the page's lifetime (D-77, A-82).
let wakeLock = null;
let wakeNoteShown = false;
// Score events live beside the run, never in it: the reducer has no microphone input, and
// a reset of the pass buffer is not a state transition (T-03-13). Times are chart
// milliseconds, so a paused-and-resumed pass keeps one comparable timeline.
let scoreEvents = [];
let scoreOriginMs = 0;
// The questions this pass answered by playing them (NOTE-04). Pitch only: a quiz question
// is never timed, and a chip or board answer never lands here.
let micAnswers = [];
// A mic answer needs an onset then two identical readings on one note (WR-04).
let micStreak = { midi: null, count: 0, armedAt: null };
// D-52's per-pass spot list and the two clocks that drive it. `spotText` is what the
// single feedback line currently carries, so a transient frame paint cannot erase it.
let spotShown = [];
let spotText = '';
let spotWindowOpenedMs = 0;
let spotLastOnsetMs = 0;
let spotPendingOnsetMs = null;
// The strum waiting for its own note: the poll emits the onset before the pitch.
let pendingChordOnsetMs = null;
// True while this app has a listening window open, so opening and closing stay one
// transition each and the adapter's state remains the only truth about the stream.
let micWindowOpen = false;
const SPOT_SILENT_MS = 3000;

function isRunning() {
  return !!run && (run.phase === 'countIn' || run.phase === 'active' || run.phase === 'paused');
}

function ensureAudio() {
  if (audio) return audio;
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctx) return null;
  try {
    ctx = new Ctx({ latencyHint: 'interactive' });
    audio = createAudio(ctx, { sound: settings.sound });
    ctx.onstatechange = () => {
      if (!run || (run.phase !== 'countIn' && run.phase !== 'active')) return;
      if (ctx.state !== 'running') pauseDrill('audio');
    };
    return audio;
  } catch (e) {
    ctx = null;
    audio = null;
    return null;
  }
}

// Create/resume the one context inside the user gesture, before any awaited work.
async function startAudio() {
  const a = ensureAudio();
  if (!a) return false;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx.state === 'running';
  } catch (e) {
    return false;
  }
}

// ---------- Microphone (D-46) ----------
// The mic is created lazily at the first drill, never at boot: a page that never drills
// never asks for a device. Its state is the only truth about the stream.
function ensureMic() {
  if (mic) return mic;
  if (!ctx) return null;
  try {
    mic = createMic({
      ctx,
      onEvent: onMicEvent,
      // The header cluster is written from the adapter's own transitions, so the word can
      // never disagree with the open or closed stream (T-03-13).
      onState: () => syncMicChip(),
      timer: browserTimer,
      now: () => (ctx ? ctx.currentTime * 1000 : 0),
    });
  } catch (e) {
    mic = null;
  }
  return mic;
}

// `listening` means one window is open right now: the transport schedule and the monitor
// read the adapter's state, never a copy of it.
function micListening() {
  return !!mic && mic.state === 'listening';
}

// A scored pass owns the stream from its count-in to its boundary: re-arming during the
// count-in means the first active beat of a later pass is already listening. A wait-mode
// pass has no count-in, so its active phase is the whole stream window.
function micStreamWanted() {
  return !!(passMicArmed && settings.micOn && run && run.chart
    && (run.phase === 'countIn' || run.phase === 'active'));
}

// The scored window itself: open only while the pass is playing, never across a pause or a
// boundary. `mic.state` stays the only truth about the stream.
function micWindowWanted() {
  return micStreamWanted() && run.phase === 'active';
}

// ---------- The one audio-level composer (04-01, T-04-02/T-04-03) ----------
// `master` keeps its Phase 1-3 meaning for the non-backing families, and a play-along with
// the mic listening runs the verify mix on the stem plane instead, so bass and pad really
// are silent (A-60, MIC-03). Every audio path — the mic window, the three transport
// effects, a tab switch, a pair change, leaving the drill and a family change — re-derives
// the mix here, so no second writer can leave the guitar's master gain or a stem stuck at a
// value some earlier pass wrote. The adapter keeps `muteForPause` and `restore` as named
// delegates: they are the gauge of `setMonitor`, never a second composer.
function applyAudioMix() {
  if (!audio) return;
  const paused = !!(run && run.phase === 'paused');
  const play = !!(run && run.chart && PLAY_FAMILIES.has(run.chart.family));
  const listening = micListening();
  // The drone connects straight to `master`, outside the stem bus, and a play-along stage
  // hides its control: a drone left on from a scale run would play through the verify
  // window and corrupt the root check (MIC-03, T-04-07).
  if (play) audio.setDrone(false);
  audio.setMonitor({ paused, listening: listening && !play });
  audio.setMix({
    stems: {
      click: settings.stemClick,
      drums: settings.stemDrums,
      bass: settings.stemBass,
      pad: settings.stemPad,
    },
    verify: play && listening && !paused,
  });
}

// Called once per frame and at every pass transition: the window opens on the first active
// frame of a scored pass and closes when the pass leaves `active`. Every boundary tears the
// stream down (the one teardown), so a later pass re-arms here instead of running silently
// unscored while the header still says On (CR-01).
async function syncMicWindow() {
  if (!mic) return;
  const step = micWindowStep({
    streamWanted: micStreamWanted(),
    windowWanted: micWindowWanted(),
    open: micWindowOpen,
    state: mic.state,
  });
  if (step === 'close') { closeMicWindow(); return; }
  if (step === 'idle') return;
  // 'arm' re-opens the stream a boundary closed. Failure is a state, never a throw: a
  // denied or absent device leaves the pass running unscored and the chip says so.
  if (step === 'arm' && !(await armMic({ announce: false }))) return;
  if (!micWindowWanted() || mic.state !== 'on') return;
  mic.startListening();
  if (!micListening()) return;
  micWindowOpen = true;
  applyAudioMix();
  openSpotWindow();
}

function closeMicWindow() {
  micWindowOpen = false;
  closeSpotWindow();
  // The close re-derives the mix even when the adapter is already idle, so a window that
  // shuts late can never leave `master` ducked to the listening target.
  if (micListening()) mic.stopListening();
  applyAudioMix();
}

// ---------- Spot feedback (D-52) ----------
// At most three short lines per pass, each once, through the one feedback line. The gate
// decides whether a line has already been said; this module decides when.
function showSpot(key) {
  const gate = spotGate({ shown: spotShown, key });
  spotShown = gate.shown;
  if (gate.line === null) return null;
  spotText = gate.line;
  panels.setFeedback(spotText);
  return spotText;
}

function openSpotWindow() {
  spotWindowOpenedMs = nowMs();
  spotLastOnsetMs = spotWindowOpenedMs;
  spotPendingOnsetMs = null;
  // A play-along asks for a chord on the change, a scale family for one note at a time:
  // the same three-line bank, one family-specific opening sentence (D-52, Open Question 2).
  const play = !!(run && run.chart && PLAY_FAMILIES.has(run.chart.family));
  showSpot(play ? 'listeningChords' : 'listening');
}

function closeSpotWindow() {
  spotPendingOnsetMs = null;
  if (!spotText) return;
  spotText = '';
  if (panels) panels.setFeedback('');
}

// The two remaining moments, read once per frame: three seconds of a window with no onset
// is silence, and an onset the detector could not name is the room above the gate. Neither
// is a verdict and neither is a score.
function spotTick() {
  if (!micListening()) return;
  if (spotPendingOnsetMs !== null) {
    spotPendingOnsetMs = null;
    showSpot('noisy');
  }
  if (nowMs() - Math.max(spotWindowOpenedMs, spotLastOnsetMs) >= SPOT_SILENT_MS) showSpot('silent');
}

// ---------- The mic cluster, permission states and calibration (D-45, D-48, D-51) ----------
// Eight clicks at 90 BPM on the audio clock; each tap resolves to the nearest click and the
// median of the samples is the offset this device stores.
const CLICK_BPM = 90;
const CALIBRATION_CLICKS = 8;
const CALIBRATION_LEAD_S = 0.3;
let calibration = null;
let calibrationTimers = [];
// The mic the *running pass* is scored with. A mid-pass toggle persists as a preference
// and takes effect at the next boundary, so the window never follows the header control
// mid-phrase — and the chip's state still comes from the adapter alone (T-03-13).
let passMicArmed = false;

// The chip reads the adapter's state while one exists. A closed stream keeps the stored
// preference: between passes the word is `On`, and a scored pass re-arms at its count-in
// (CR-01). It is only ever `Listening` while the adapter says a window is open (T-03-13).
function micViewState() {
  const state = mic ? mic.state : 'off';
  if (state !== 'off') return state;
  return settings && settings.micOn ? 'on' : 'off';
}

// A property read, never a call: pitch.js stays the only caller of the permission API.
function micSupported() {
  const media = globalThis.navigator && globalThis.navigator.mediaDevices;
  return !!(media && typeof media.getUserMedia === 'function');
}

function micPassLive() {
  return isRunning() || !!(run && run.phase === 'passReview');
}

// The one writer of the header cluster. It is called from the adapter's own state
// callback, so the word can never disagree with the stream.
function syncMicChip() {
  if (!panels || !settings) return;
  panels.setMic({ state: micViewState(), supported: micSupported(), passLive: micPassLive() });
}

// ---------- The capability preflight (D-76, T-05-12) ----------
// Baseline API presence plus the one fact that decides whether the other four can exist at all.
// Nothing here calls or prompts: the app has already booted on these APIs, and a secure context
// is the precondition every one of the four below shares.
function browserReady() {
  return typeof Object.hasOwn === 'function'
    && typeof Array.prototype.flat === 'function'
    && typeof requestAnimationFrame === 'function'
    && globalThis.isSecureContext === true;
}

// The five items in the locked order, each only `ready` or `unsupported`. Presence only: no
// permission call, no Bluetooth device request, no timer and no re-run — this object is read
// exactly once, in `boot`. A missing capability is information; every drill still starts.
function readCapabilities() {
  return {
    browser: browserReady() ? 'ready' : 'unsupported',
    // Three owners answer, never this module: guitar.js owns the Bluetooth namespace,
    // wakelock.js owns the screen-wake-lock entry point, and the microphone item is the existing
    // presence predicate (T-05-16).
    bluetooth: bluetoothSupported() ? 'ready' : 'unsupported',
    microphone: micSupported() ? 'ready' : 'unsupported',
    wakeLock: wakelockSupported() ? 'ready' : 'unsupported',
    // The build makes no runtime request, so the offline fact is a literal the static audit
    // proves rather than a navigator.onLine guess that would lie in both directions.
    offline: 'ready',
  };
}

// ---------- The wake lock (D-77, T-05-13) ----------
// The twin of the mic-window composer: every world fact in one place, and the decision itself
// belongs to the adapter's pure step function. No caller keeps a `wanted` flag of its own.
// A live pass means count-in or active — a paused pass, a boundary, a hidden page and a dropped
// guitar all fall the same way, so the release side needs no extra listener.
function wakePassLive() {
  return !!run && (run.phase === 'countIn' || run.phase === 'active');
}

// A denial or an absent entry point latches the quiet note for the page's lifetime; a held lock
// changes nothing on screen (A-82).
function syncWakeNote() {
  if (!panels || !wakeLock) return;
  if (wakeLock.state === 'denied' || wakeLock.state === 'unsupported') wakeNoteShown = true;
  panels.setWakeNote(wakeNoteShown);
}

// Called once per frame, once after every dispatch and once from the guitar connection handler —
// and nowhere else. The request is never awaited before a drill start: the composer runs after
// the pass is live, which keeps the click's transient activation intact (Pitfall 3).
function syncWakeLock() {
  if (!wakeLock) return;
  const step = wakeLockStep({
    wanted: wakePassLive() && connected,
    state: wakeLock.state,
    visible: !document.hidden,
  });
  if (step === 'request') wakeLock.request();
  else if (step === 'release') wakeLock.release();
  syncWakeNote();
}

// One permission path for the toggle, the Calibrate action and the drill start. While the
// browser's prompt is open the chip holds its previous word with aria-busy; every outcome
// is a state and a line, never a throw and never a danger colour (D-51).
async function armMic({ announce = true } = {}) {
  const adapter = ensureMic();
  if (!adapter) return null;
  // A grant is news only when the mic was not already open: re-arming an armed mic is not
  // a second permission event.
  const armed = micViewState() === 'on' || micViewState() === 'listening';
  panels.setMic({ state: 'requesting', supported: micSupported(), passLive: micPassLive() });
  panels.setFeedback(MIC_FEEDBACK.waiting);
  await adapter.arm();
  panels.setFeedback('');
  if (adapter.state === 'on') {
    if (announce && !armed) panels.announce(MIC_ANNOUNCE.granted);
  } else if (adapter.state === 'denied') {
    if (announce) panels.announce(MIC_ANNOUNCE.denied);
  }
  syncMicChip();
  if (adapter.state === 'on') return adapter;
  if (adapter.state === 'denied') panels.setFeedback(MIC_FEEDBACK.blocked);
  else if (adapter.state === 'unavailable') panels.setFeedback(MIC_FEEDBACK.unavailable);
  return null;
}

// A denied, blocked or absent microphone is a normal state: the drill still runs, unscored.
async function armMicIfWanted() {
  if (!settings.micOn) return null;
  return armMic({ announce: false });
}

// The toggle is live in every phase (MIC-01). Mid-pass it only records the preference and
// says so; the running pass keeps the mic it started with.
async function onMicToggle() {
  if (!settings) return;
  if (tunerActive || !$('tunerCard').hidden) stopTuner();
  if (!micSupported()) {
    panels.setFeedback(MIC_FEEDBACK.unavailable);
    panels.announce(MIC_FEEDBACK.unavailable);
    syncMicChip();
    return;
  }
  const live = micPassLive();
  const next = !settings.micOn;
  save({ micOn: next });
  if (!next) {
    // save() already tore the stream down; the adapter's own disarm is the same one path,
    // named here so the toggle reads as the stop path it is (T-03-12).
    if (mic) mic.disarm();
    panels.announce(MIC_ANNOUNCE.off);
    panels.setFeedback(live ? MIC_FEEDBACK.midPass : '');
    syncMicChip();
    return;
  }
  const adapter = await armMic({ announce: false });
  panels.announce(adapter ? MIC_ANNOUNCE.on : (mic && mic.state === 'denied' ? MIC_ANNOUNCE.denied : MIC_FEEDBACK.unavailable));
  if (live) panels.setFeedback(MIC_FEEDBACK.midPass);
  syncMicChip();
}

// ---------- Calibration (D-48) ----------
// `performance.now()` taps land on the audio clock through the context's output timestamp,
// never by comparing the two clocks directly; a context that cannot report one falls back
// to its own current time (T-03-15).
function audioTimeOf(perfNow) {
  if (!ctx) return 0;
  let timestamp = null;
  try {
    timestamp = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
  } catch (e) {
    timestamp = null;
  }
  return outputTimeMs(timestamp, perfNow, ctx.currentTime);
}

function clearCalibrationTimers() {
  for (const handle of calibrationTimers) clearTimeout(handle);
  calibrationTimers = [];
}

// Eight clicks from `t0`, then the test closes itself one beat after the last one. The
// counter follows the same audio clock the clicks are scheduled on.
function startCalibration() {
  if (!ctx || !audio) return null;
  clearCalibrationTimers();
  const spb = 60 / CLICK_BPM;
  const t0 = ctx.currentTime + CALIBRATION_LEAD_S;
  for (let i = 0; i < CALIBRATION_CLICKS; i++) audio.click(t0 + i * spb, i === 0);
  calibration = { t0, spb, samples: [], saved: false, clickIndex: 1 };
  panels.setCalibrationRunning({ clickIndex: 1, clickCount: CALIBRATION_CLICKS, taps: 0 });
  panels.focusCalibrationTap();
  for (let i = 1; i < CALIBRATION_CLICKS; i++) {
    calibrationTimers.push(setTimeout(() => {
      if (!calibration) return;
      calibration.clickIndex = i + 1;
      panels.setCalibrationRunning({
        clickIndex: calibration.clickIndex, clickCount: CALIBRATION_CLICKS, taps: calibration.samples.length,
      });
    }, Math.max(0, (t0 + i * spb - ctx.currentTime) * 1000)));
  }
  calibrationTimers.push(setTimeout(() => {
    finishCalibration();
  }, Math.max(0, (t0 + CALIBRATION_CLICKS * spb - ctx.currentTime) * 1000)));
  return calibration;
}

// One tap on the audio clock, resolved to the nearest click. A tap outside the grid is
// dropped, not clamped, so one stray press cannot move the median.
function addTap() {
  if (!calibration) return null;
  const offsetMs = tapOffsetMs(audioTimeOf(nowMs()), calibration.t0, calibration.spb, {});
  if (offsetMs === null) return null;
  calibration.samples.push(offsetMs);
  panels.setCalibrationRunning({
    clickIndex: calibration.clickIndex, clickCount: CALIBRATION_CLICKS, taps: calibration.samples.length,
  });
  return offsetMs;
}

function finishCalibration() {
  // A drill start or a panel switch cancels the test; a late timer must never persist a
  // bogus offset or steal focus inside a live pass (WR-05).
  if (!calibration || !panels.isCalibrationOpen()) {
    clearCalibrationTimers();
    calibration = null;
    return null;
  }
  clearCalibrationTimers();
  const result = calibrationOffset(calibration.samples);
  if (result.ok) {
    save({ calibrationMs: result.offsetMs });
    calibration.saved = true;
    panels.setCalibrationResult({ offsetMs: result.offsetMs, large: result.reason === 'large' });
    panels.announce(CALIBRATION.savedAnnouncement(result.offsetMs));
  } else {
    panels.setCalibrationError(result.reason === 'tooFew' ? 'tooFew' : 'none');
  }
  if (mic && mic.state === 'calibrating') mic.endCalibration();
  syncMicChip();
  return result;
}

// Done keeps whatever was saved; Skip and Escape leave the stored value untouched and say
// so only when this session saved nothing.
function closeCalibration({ announceSkip = false, focus = true } = {}) {
  const saved = !!(calibration && calibration.saved);
  clearCalibrationTimers();
  calibration = null;
  if (mic && mic.state === 'calibrating') mic.endCalibration();
  panels.setCalibrationOpen(false);
  if (focus) panels.focusMicCluster();
  if (announceSkip && !saved) panels.announce(CALIBRATION.skippedAnnouncement);
  syncMicChip();
}

// The press is the gesture: permission, the eight-click test and the panel all start here.
async function openCalibration() {
  if (!store || micPassLive()) return;
  if (tunerActive || !$('tunerCard').hidden) stopTuner();
  panels.setCalibrationOpen(true);
  panels.focusCalibrationHead();
  if (!micSupported()) {
    panels.setCalibrationError('unavailable');
    return;
  }
  const ready = await startAudio();
  if (!ready) {
    panels.setFeedback(AUDIO_START_FAILED);
    panels.announce(AUDIO_START_FAILED);
    return;
  }
  if (!settings.micOn) save({ micOn: true });
  const adapter = await armMic({ announce: true });
  if (!adapter) {
    panels.setCalibrationError(mic && mic.state === 'unavailable' ? 'unavailable' : 'denied');
    return;
  }
  adapter.calibrate();
  syncMicChip();
  startCalibration();
}

function onCalibrate() {
  openCalibration();
}

// The transport places chart beat 0 at `clock() + 0.05 - segmentStartBeat * spb`
// (transport.js:136). The scorer compares mic times with chart time, so the origin is
// mirrored here rather than reaching into the transport's private clock.
const TRANSPORT_LEAD_MS = LEAD_SEC * 1000;
function chartOriginMs(currentTime, segment) {
  const bpm = segment && segment.bpm > 0 ? segment.bpm : 70;
  const startBeat = segment && Number.isFinite(segment.segmentStartBeat) ? segment.segmentStartBeat : 0;
  return currentTime * 1000 + TRANSPORT_LEAD_MS - startBeat * (60000 / bpm);
}

// One buffer for the pass, fed by the adapter. An event's chart time is its audio time
// minus the origin captured when this segment started.
// One poll emits an onset and, when the detector could name the note, a pitch for the
// same frame: an onset with no pitch behind it is the room tripping the gate.
function onMicEvent(event) {
  if (tunerActive) {
    if (event && event.type === 'pitch') panels.setTunerReading(tunerReading(event.freq));
    return;
  }
  if (!event || !run || run.phase !== 'active') return;
  const atMs = Number.isFinite(event.atMs) ? event.atMs - scoreOriginMs : 0;
  scoreEvents.push({ type: event.type, atMs, rms: event.rms, midi: event.midi });
  if (event.type === 'onset') {
    // A strum with no note behind it still counts its bar; flush it before this frame's.
    flushChordOnset();
    micStreak = { midi: null, count: 0, armedAt: atMs };
    spotPendingOnsetMs = atMs;
    spotLastOnsetMs = nowMs();
    // The arm and `flushChordOnset`'s guard below are the same predicate: re-key one
    // without the other and a change family counts nothing at all (PROG-05).
    if (CHART_CHANGES.has(run.chart.family)) pendingChordOnsetMs = atMs;
  } else if (event.type === 'pitch') {
    spotPendingOnsetMs = null;
    // The poll emits the onset first and its note second, so the bar waits one event:
    // the root can only be checked once the pitch is known (CHORD-03, D-46).
    if (pendingChordOnsetMs !== null) flushChordOnset(event.midi);
    // NOTE-04: a named pitch answers the open question through the one commit path.
    else answerFromPitch(event.midi);
  }
}

// A strum, placed on the bar the transport is in. The bar and its expected root are read
// from the same index so the root check can never disagree with the bar it counted. A
// strum the detector could not name is checked and never "on pitch", never wrong.
function flushChordOnset(midi = null) {
  if (pendingChordOnsetMs === null) return;
  const atMs = pendingChordOnsetMs;
  pendingChordOnsetMs = null;
  if (!run || !CHART_CHANGES.has(run.chart.family) || run.phase !== 'active') return;
  // The bar is read from the onset's own chart time, not from the transport position a
  // frame later: a strum just before a bar line must count the bar it was played in (IN-03).
  const bpm = Number.isFinite(run.chart.bpm) && run.chart.bpm > 0 ? run.chart.bpm : 0;
  const countInMs = run.chart.countInBeats * 60000 / bpm;
  const bar = barForOnset(atMs - countInMs, {
    barSpanMs: run.chart.beatsPerBar * 60000 / bpm,
    bars: run.chart.bars,
    calibrationMs: settings.calibrationMs,
  });
  if (bar === null) return;
  const step = run.chart.steps[bar];
  const rootMidi = step && step.target && Number.isFinite(step.target.midi) ? step.target.midi : null;
  dispatch({
    type: 'CHANGE_ONSET',
    bar,
    atMs,
    calibrationMs: settings.calibrationMs,
    midi,
    expectedRootPc: rootMidi,
  });
}

// A detected pitch answers the open note question when its pitch class matches the target,
// after an onset and two consecutive identical readings: pitch only, no timing, and the
// chips stay the manual path (NOTE-04, D-46). A ringing note cannot answer the next
// question because every answer/advance resets the streak and its onset arm (WR-04).
// The mic pre-filters by pitch class because a detected note has no string or fret; it then
// passes the question's own cell so `judge` remains the single arbiter of the answer (IN-04).
function answerFromPitch(midi) {
  if (!run || run.chart.family !== 'findNote' || run.phase !== 'active') return;
  const question = openQuestion();
  const target = question && question.target ? question.target : null;
  if (!target || !Number.isFinite(midi) || !Number.isFinite(target.midi)) return;
  if ((run.questionOutcomes || [])[run.questionIndex]) return;
  if (micStreak.armedAt === null) return;
  if (pitchClassOf(midi) !== pitchClassOf(target.midi)) return;
  micStreak = nextPitchStreak(micStreak, Math.round(midi));
  if (!micStreak.hit) return;
  commitAnswer('mic', { s: target.s, f: target.f });
}

// One score per pass, computed once when the pass reaches its result and handed to the
// reducer on the FINISH/STOP event. The family decides what the mic may claim: pitch and
// timing for a scale run, pitch only for note finding, strum onset and the expected root
// for chord changes. A pass with no microphone evidence returns `null`, never a zero.
function syncScoreForPass() {
  if (!run || !run.chart) return null;
  const chart = run.chart;
  if (chart.family === 'scaleRun') {
    if (!scoreEvents.length) return null;
    const score = scoreSteps(scoreEvents, Array.isArray(chart.steps) ? chart.steps : [], {
      bpm: chart.bpm,
      calibrationMs: settings.calibrationMs,
    });
    return withMarkedHits(score, run.markedHits);
  }
  if (chart.family === 'findNote') {
    const questions = Array.isArray(run.questions) ? run.questions : [];
    const outcomes = Array.isArray(run.questionOutcomes) ? run.questionOutcomes : [];
    if (!questions.length || !micAnswers.length) return null;
    const onPitch = micAnswers.filter(index => outcomes[index] === 'correct').length;
    return {
      ...scoreSummary(scoreEvents, { steps: questions }, { planned: questions.length, hits: onPitch }),
      // `correct` is the figure the mic line quotes: only a played answer can be on pitch.
      correct: onPitch,
    };
  }
  if (CHART_CHANGES.has(chart.family)) {
    const bpm = Number.isFinite(chart.bpm) && chart.bpm > 0 ? chart.bpm : 0;
    const beatsPerBar = Number.isFinite(chart.beatsPerBar) && chart.beatsPerBar > 0 ? chart.beatsPerBar : 4;
    const bars = Number.isInteger(chart.bars) && chart.bars > 0 ? chart.bars : (chart.steps || []).length;
    if (!bpm || !bars || !scoreEvents.length) return null;
    // `scoreBars` measures its bar grid from the first bar, while chart time starts at the
    // count-in click, so the events are re-based by the count-in before the read — the
    // same subtraction the reducer's own CHANGE_ONSET does with `countInBeats`.
    const countInMs = ((Number.isFinite(chart.countInBeats) ? chart.countInBeats : 0) * 60000) / bpm;
    const events = scoreEvents.map(event => ({ ...event, atMs: event.atMs - countInMs }));
    // The score grid is the change grid: the ending bar is never a scored row.
    const expectedRoots = (chart.steps || [])
      .slice(0, bars)
      .map(step => (step && step.target && Number.isFinite(step.target.midi) ? step.target.midi : null));
    return scoreBars(events, {
      barSpanMs: (beatsPerBar * 60000) / bpm,
      bars,
      calibrationMs: settings.calibrationMs,
      expectedRoots,
    });
  }
  return null;
}

// The quiz's last answer closes the pass from inside the reducer (the twelfth
// NEXT_QUESTION builds its own FINISH), so that closing event is the one that must carry
// the per-pass score the result persists (CR-04).
function closesQuizPass() {
  if (!run || !run.chart || run.chart.timed !== false) return false;
  const questions = Array.isArray(run.questions) ? run.questions : [];
  if (!questions.length) return false;
  if (run.questionIndex + 1 < questions.length) return false;
  return !!(run.questionOutcomes || [])[run.questionIndex];
}

// PITFALL 7 / A-43: a step the player marked with `Mark hit` is a hit the microphone
// missed, and it raises the count the result reports. It never invents a timing sample:
// the median stays the set of offsets the mic actually heard.
function withMarkedHits(score, markedHits) {
  const marked = (Array.isArray(markedHits) ? markedHits : [])
    .filter(index => Number.isInteger(index) && index >= 0 && index < score.perStep.length);
  if (!marked.length) return score;
  const set = new Set(marked);
  const perStep = score.perStep.map(step => (
    set.has(step.index) && !step.hit ? { ...step, hit: true } : step
  ));
  const hits = perStep.filter(step => step.hit).length;
  return { ...score, hits, manualHits: perStep.filter((step, index) => step.hit && !score.perStep[index].hit).length, accuracy: score.planned ? hits / score.planned : null, perStep };
}

// The one teardown path: result, Stop, mic off, tab hidden and pagehide all call it, so
// no timer survives and no track is left open (T-03-12).
function stopMic() {
  tunerRequest++;
  if (tunerActive) {
    tunerActive = false;
    if (panels) panels.setTunerOpen(false);
  }
  scoreEvents = [];
  micAnswers = [];
  micWindowOpen = false;
  pendingChordOnsetMs = null;
  closeSpotWindow();
  if (!mic) return;
  mic.stop();
}

function audition(s, f) {
  // A board tap in a quiz commits the answer and does not audition; auditioning
  // returns once the question has an outcome.
  if (run && run.chart.timed === false && run.phase === 'active' && !(run.questionOutcomes || [])[run.questionIndex]) {
    commitAnswer('board', { s, f });
    return;
  }
  const a = ensureAudio();
  if (!a) return;
  a.setSound(settings.sound);
  a.pluck(OPEN[s] + f);
  updateDrone();
  const note = view.notes.find(n => n.s === s && n.f === f);
  if (note) board.flashHit(note);
}

function updateDrone() {
  if (!audio) return;
  // A play-along owns no drone: `applyAudioMix` silences it for the whole pass, so building a
  // three-oscillator stack at Start only to cut it 0.1 s later is two wasted graph builds and
  // an invariant that depends on ordering (IN-03, T-04-07). The live run's chart is the truth;
  // between passes it is the family the next chart will be built for, and `isPlayAlong` is the
  // one predicate that answers both.
  const target = run && run.chart ? run.chart : { family: settings.drillFamily };
  if (isPlayAlong(target)) {
    audio.setDrone(false);
    return;
  }
  audio.setDrone(!!settings.drone, settings.keyPc);
}

function fingerNumber(fret, start = 0) {
  if (!Number.isFinite(fret) || fret <= 0) return 0;
  const anchor = Number.isFinite(start) && start > 0 ? start : 0;
  return Math.min(4, Math.max(1, fret - anchor + (anchor > 0 ? 1 : 0)));
}

function boardPosition(scaleDef, positionId, keyPc = settings.keyPc) {
  const positions = positionsForScale(keyPc, scaleDef);
  return positionId === 'all'
    ? positions[0] || null
    : positions.find(position => position.id === positionId) || positions[0] || null;
}

function fingerAt(note, position) {
  if (!position || !Number.isFinite(note.f)) return 0;
  if (note.f < position.start || note.f > position.start + 4) return 0;
  return fingerNumber(note.f, position.start);
}

function scaleBoardNotes(scaleDef) {
  const display = settings.positionId === 'all'
    ? notesForScale(settings.keyPc, scaleDef, null)
    : notesForPosition(settings.keyPc, scaleDef, settings.positionId);
  const names = spellScale(settings.keyPc, scaleDef);
  const position = boardPosition(scaleDef, settings.positionId);
  return display.map(n => {
    const finger = fingerAt(n, position);
    return {
      ...n,
      finger,
      open: n.f === 0,
      text: settings.labels === 'none' && n.iv === 0 ? 'R' : labelFor({ ...n, finger }, settings.labels, names, DEGREES, INTERVALS),
      root: n.iv === 0,
    };
  });
}

function chordBoardNotes(expansion) {
  return expansion.map(n => {
    if (n.muted) return { s: n.s, f: 0, text: '×', muted: true, root: false };
    if (n.open) return { ...n, f: 0, text: '0', open: true };
    return { ...n, text: n.finger === null ? '' : String(n.finger) };
  });
}

function buildScaleView() {
  const scaleDef = SCALE_BY_ID[settings.scaleId] || SCALE_BY_ID.major;
  settings.scaleId = scaleDef.id;
  const positions = positionsForScale(settings.keyPc, scaleDef);
  if (settings.positionId !== 'all' && !positions.some(p => p.id === settings.positionId)) settings.positionId = 'all';
  return {
    positions,
    names: spellScale(settings.keyPc, scaleDef),
    scaleDef,
    notes: scaleBoardNotes(scaleDef),
    detail: '',
    chart: null,
    voicings: [],
  };
}

function buildChordView() {
  const family = chordById[settings.chordId] || CHORD_FAMILIES[0];
  settings.chordId = family.id;
  const voicing = family.voicings.find(v => v.id === settings.voicingId) || family.voicings[0];
  settings.voicingId = voicing.id;
  const rootName = spellPitch(family.rootPc, family.rootPc);
  const descriptor = voicing.tags.includes('open') ? 'open position' : voicing.label.toLowerCase();
  return {
    positions: [],
    names: null,
    scaleDef: null,
    notes: chordBoardNotes(expandChord(voicing)),
    voicings: family.voicings,
    detail: `${family.name} · root ${rootName} · ${descriptor}`,
    chart: null,
  };
}

function barBoardNotes(bar) {
  const voicing = bar ? voiceChord(bar.rootPc, bar.quality, settings.voicingId, CHORD_FAMILIES) : null;
  return voicing ? chordBoardNotes(expandChord(voicing)) : [];
}

function buildProgressionView() {
  const prog = progressionById[settings.progressionId] || PROGRESSIONS[0];
  settings.progressionId = prog.id;
  const bars = expandProgression(prog, settings.keyPc);
  settings.barIndex = clamp(settings.barIndex || 0, 0, Math.max(0, bars.length - 1));
  const bar = bars[settings.barIndex] || null;
  return {
    positions: [],
    names: null,
    scaleDef: null,
    notes: barBoardNotes(bar),
    chart: { sections: [{ name: '', repeats: 1, bars }] },
    barIndex: settings.barIndex,
    detail: '',
    voicings: [],
  };
}

function buildSongView() {
  const song = songById[settings.songId] || SONGS[0];
  settings.songId = song.id;
  // The sections expand in the **one** `keyPc` plane, not the song's own key: the Songs
  // tab's Key select writes the same plane the Progressions and Scales tabs write (A-56),
  // so the browse chart transposes with it. The song's own key arrives as a seed when the
  // song is picked and when `Play` is pressed; it is never a second key source.
  const sections = song.sections.map(section => ({
    name: section.name,
    repeats: section.repeats,
    bars: expandSongSection(song, section, settings.keyPc, progressionById),
  }));
  const flat = sections.flatMap(section => section.bars);
  settings.barIndex = clamp(settings.barIndex || 0, 0, Math.max(0, flat.length - 1));
  const bar = flat[settings.barIndex] || null;
  return {
    positions: [],
    names: null,
    scaleDef: null,
    notes: barBoardNotes(bar),
    chart: { sections },
    barIndex: settings.barIndex,
    detail: '',
    voicings: [],
  };
}

function buildView() {
  if (settings.tab === 'chords') return buildChordView();
  if (settings.tab === 'progressions') return buildProgressionView();
  if (settings.tab === 'songs') return buildSongView();
  return buildScaleView();
}

function renderAll({ forceScene = false } = {}) {
  view = buildView();
  panels.render(settings, view);
  board.render(view.notes);
  pushScene(forceScene);
}

function pushScene(force = false) {
  if (!sink) return;
  if (force) sink.reset();
  sink.tick(sceneFromNotes(view.notes), 0, settings.bpm);
}

function save(patch) {
  settings = store.set(patch);
  // Turning the mic off is a stop path: the stream never outlives the setting, and the
  // toggle that writes it arrives with the header cluster (03-03 Task 2).
  if (patch && Object.hasOwn(patch, 'micOn') && !settings.micOn) stopMic();
}

// ---------- Drill wiring ----------
// The idle preview and the chart share one semantic id. It is the chart's own id, never a
// hand-built scale shape, so the idle stage can never show a different item from the one
// `Start drill` will run (Pitfall 8).
function previewSkillId() {
  return chartFor().id;
}

function buildChart(options) {
  chart = chartFor(options);
  return chart;
}

function openQuestion() {
  if (!run || !Array.isArray(run.questions) || !run.questions.length) return null;
  const index = clamp(Number.isInteger(run.questionIndex) ? run.questionIndex : 0, 0, run.questions.length - 1);
  return run.questions[index] || null;
}

// The family router: one place builds the chart, so the settings plane stays the only
// source of what the stage runs. Every family gets the persisted start level last.
function chartFor({ recall = false } = {}) {
  let built = null;
  if (settings.drillFamily === 'chordChanges') {
    built = buildChordChangeChart({ pairId: settings.chordPairId, bpm: settings.bpm, bars: 8 });
  } else if (settings.drillFamily === 'findNote') {
    const scaleDef = SCALE_BY_ID[settings.scaleId] || SCALE_BY_ID.major;
    const kinds = quizKindsFor(settings.quizMode);
    // A-34 makes one kind × mode pair impossible; clamp here so a hand-edited record
    // can never reach an empty pool.
    const kind = kinds.includes(settings.quizQuestion) ? settings.quizQuestion : kinds[0];
    const positions = positionsForScale(settings.keyPc, scaleDef);
    const position = positions.find(p => p.id === settings.positionId);
    const positionLabel = settings.positionId === 'all' || !position ? 'all' : position.label;
    built = buildNoteQuizChart({
      scaleId: settings.scaleId,
      keyPc: settings.keyPc,
      positionId: settings.positionId,
      quizQuestion: kind,
      quizMode: settings.quizMode,
      questions: buildQuestions({
        pool: notesForPosition(settings.keyPc, scaleDef, settings.positionId),
        names: spellScale(settings.keyPc, scaleDef),
        degrees: DEGREES,
        intervals: INTERVALS,
        intervalNames: INTERVAL_NAMES,
        kind,
        mode: settings.quizMode,
        label: poolLabel({
          keyName: KEY_NAMES[settings.keyPc],
          scaleName: scaleDef.name.toLowerCase(),
          positionName: positionLabel,
        }),
      }),
    });
  } else if (settings.drillFamily === 'progression') {
    // D-62: any of the twelve keys through the existing spelling and voicing families, the
    // validated tempo, and one step per bar plus the ending. The item's own default tempo
    // arrives through the `Play` seed, never through a new content field.
    const prog = progressionById[settings.progressionId] || PROGRESSIONS[0];
    const bars = expandProgression(prog, settings.keyPc);
    built = buildPlayAlongChart({
      family: 'progression',
      progressionId: prog.id,
      keyPc: settings.keyPc,
      bpm: settings.bpm,
      bars,
      meter: [4, 4],
      // The stored window and the browse bar: `buildPlayAlongChart` clamps the window to
      // the item's own length, so a `4 bars` window opened at bar 10 still ends on bar 12.
      loopBars: settings.loopBars,
      fromBar: settings.barIndex,
    });
  } else if (settings.drillFamily === 'song') {
    // PROG-06/D-64: one section per pass, in the song's own meter, key and tempo. The
    // section's bars are expanded here and the pass repeats that exact list as many times as
    // `songSectionBars` says, so the chart's bar list is what the pass plays and never a
    // second calculation of it. Every `songSectionBars` call passes `unitBars`, because a
    // section that references a curated progression has no `degrees` of its own and would
    // otherwise count zero bars.
    const song = ownEntry(songById, settings.songId) || SONGS[0];
    const section = (song.sections || []).find(s => s.id === settings.songSectionId) || song.sections[0];
    const unit = expandSongSection(song, section, settings.keyPc, progressionById);
    // Each bar carries its own place in its section, so a boundary is the bar whose `barId`
    // resets and the builder can name the next section's first chord without a branch (A-52).
    const unitBars = unit.map((bar, barId) => ({ ...bar, barId, sectionId: section.id }));
    const bars = Array.from(
      { length: songSectionBars(section, { sectionLoop: settings.sectionLoop, unitBars: unit.length }) / Math.max(1, unit.length) },
      () => unitBars,
    ).flat();
    const sections = (song.sections || []).map(s => ({
      id: s.id,
      name: s.name,
      repeats: s.repeats || 1,
      bars: songSectionBars(s, {
        sectionLoop: settings.sectionLoop,
        unitBars: expandSongSection(song, s, settings.keyPc, progressionById).length,
      }),
    }));
    built = buildPlayAlongChart({
      family: 'song',
      songId: song.id,
      sectionId: section.id,
      keyPc: settings.keyPc,
      bpm: settings.bpm,
      bars,
      meter: song.meter,
      sections,
      sectionLoop: settings.sectionLoop,
    });
  } else {
    built = buildScaleRunChart({
      scaleId: settings.scaleId,
      keyPc: settings.keyPc,
      positionId: settings.positionId,
      direction: settings.direction,
      bpm: settings.bpm,
    });
  }
  // D-36: start one level easier than the best clean level, never on the recall.
  // The persisted plane is the single source, so a reload preserves the ramp.
  built.startLevel = recall ? FADE.recallLevel : startLevelFor(store.getProgress(), built.id);
  built.coldRecall = recall;
  return built;
}

// The idle prompt card needs a sample question without claiming a run. The cache is
// keyed on every setting the plan depends on, so a settings change rebuilds it.
let preview = { key: '', chart: null };
function previewChart() {
  // Every setting the plan depends on, including the play-along's own item and bar, so a
  // cached preview can never describe a chart Start drill would not build (Pitfall 8).
  const key = [
    settings.drillFamily, settings.scaleId, settings.keyPc, settings.positionId,
    settings.quizQuestion, settings.quizMode, settings.chordPairId,
    settings.progressionId, settings.songId, settings.songSectionId,
    settings.loopBars, settings.sectionLoop, settings.barIndex,
  ].join('|');
  if (preview.key !== key) preview = { key, chart: chartFor() };
  return preview.chart;
}

function drillNames() {
  const content = run && run.chart && run.chart.content
    ? run.chart.content
    : { scaleId: settings.scaleId, keyPc: settings.keyPc };
  const scaleDef = SCALE_BY_ID[content.scaleId] || SCALE_BY_ID.major;
  return spellScale(content.keyPc, scaleDef);
}

function boardNotesFromFrame(frame, mode = null, lightsAvailable = true) {
  // The chord family's frame carries the Chord tab's own dot language (finger numbers,
  // `0`, `×`), so its text is passed through untouched; every other family labels from
  // the Labels select and the hint level.
  const chordFamily = !!(run && run.chart && CHART_CHANGES.has(run.chart.family));
  const names = chordFamily ? null : drillNames();
  const content = run && run.chart && run.chart.content
    ? run.chart.content
    : { scaleId: settings.scaleId, keyPc: settings.keyPc, positionId: settings.positionId };
  const scaleDef = SCALE_BY_ID[content.scaleId] || SCALE_BY_ID.major;
  const position = chordFamily ? null : boardPosition(scaleDef, content.positionId, content.keyPc);
  const level = run ? run.hintLevel : 0;
  // The Name-mode question is a question, not a hint: with the guitar dark the screen
  // stands in for the lit LED with an accent ring on the target cell and no label.
  const question = mode === 'name' && !lightsAvailable ? openQuestion() : null;
  const answered = !!(run && (run.questionOutcomes || [])[run.questionIndex]);
  const ring = question && !answered ? question.target.s + ':' + question.target.f : null;
  return frame.notes.map(n => ({
    ...n,
    question: ring !== null && n.s + ':' + n.f === ring,
    finger: chordFamily ? undefined : fingerAt(n, position),
    // The Labels select is the ceiling; the hint level may lower it further. H2 has
    // dots but no text and H3 returns no notes at all.
    text: chordFamily
      ? (n.text || '')
      : level <= 1
        ? (settings.labels === 'none' && n.iv === 0 ? 'R' : labelFor({ ...n, finger: fingerAt(n, position) }, settings.labels, names, DEGREES, INTERVALS))
        : '',
  }));
}

function nowPlayingText(target, names, level = 0) {
  if (level >= 3) return '';
  const where = target.f === 0 ? 'open' : 'fret ' + target.f;
  if (level >= 2) return `String ${target.s} · ${where}`;
  return `String ${target.s} · ${where} · ${names[((target.midi % 12) + 12) % 12]}`;
}

// A backing voice's length is stored in beats (backing.js owns the pattern, never a clock).
// The chart's own tempo — not the browse field — turns it into the seconds the audio layer
// needs, so a pass seeded at 80 BPM holds 80 even when the field still reads the old number.
function backingSeconds(durBeats) {
  const bpm = (run && run.chart && run.chart.bpm) || settings.bpm || 70;
  return (Number.isFinite(durBeats) ? durBeats : 0) * (60 / bpm);
}

function progressFor(position) {
  if (!run) return 0;
  // A wait-mode pass counts answered questions; the beat means nothing there.
  if (run.chart.timed === false) {
    const total = run.questions.length;
    return total ? (run.questionOutcomes.filter(Boolean).length / total) * 100 : 100;
  }
  if (position.phase === 'countIn') return 0;
  if (run.chart.family === 'chordChanges') {
    // Bars, not beats: the progress bar advances across eight bars, smoothly inside one.
    const bars = run.chart.bars || run.chart.steps.length;
    if (!bars) return 100;
    const beatsPerBar = run.chart.beatsPerBar || 4;
    const beat = Number.isFinite(position.beat) ? position.beat : 0;
    const barIndex = clamp(stepIndexFor(run.chart, beat), 0, Math.max(0, run.chart.steps.length - 1));
    const beatInBar = ((beat - run.chart.countInBeats) % beatsPerBar + beatsPerBar) % beatsPerBar;
    return clamp(((barIndex + beatInBar / beatsPerBar) / bars) * 100, 0, 100);
  }
  if (PLAY_FAMILIES.has(run.chart.family)) {
    // The progress bar counts the ending bar: a twelve-bar pass is thirteen bars of travel,
    // so the bar never sits at 100% while the ending still has to be played.
    const bars = Number.isFinite(run.chart.bars) ? run.chart.bars : run.chart.steps.length - 1;
    const total = Math.max(1, bars + 1);
    const beatsPerBar = run.chart.beatsPerBar || 4;
    const beat = Number.isFinite(position.beat) ? position.beat : 0;
    const barIndex = clamp(stepIndexFor(run.chart, beat), 0, Math.max(0, run.chart.steps.length - 1));
    const beatInBar = ((beat - run.chart.countInBeats) % beatsPerBar + beatsPerBar) % beatsPerBar;
    return clamp(((barIndex + beatInBar / beatsPerBar) / total) * 100, 0, 100);
  }
  const total = run.chart.steps.length;
  if (!total) return 100;
  return clamp(((position.beat - run.chart.countInBeats) / total) * 100, 0, 100);
}

function streaksFor(state) {
  // At the pass review the just-completed pass is already decided: render the
  // post-decision counts, never the pre-boundary streak (WR-01).
  const decision = state && state.phase === 'passReview' ? state.pendingDecision : null;
  return {
    clean: {
      count: decision ? decision.cleanStreak : (state.cleanStreak || 0),
      needed: FADE.cleanPassesToAdvance,
    },
    fail: {
      count: decision ? decision.failStreak : (state.failStreak || 0),
      allowed: FADE.failedPassesToDemote,
    },
  };
}

// The quiz asks in Find form on the recall pass, so the frame and the prompt card read
// the same effective mode (A-45).
function drillQuestionMode() {
  if (!run || !run.chart || run.chart.family !== 'findNote') return null;
  const question = openQuestion();
  return question ? questionMode(question, run.hintLevel) : null;
}

// The one LED composition: frameAt already chose the set for this family and level, so
// the composition root only hands it to the sink.
function drillSceneAt(position) {
  const mode = drillQuestionMode();
  const frame = frameAt(run, mode ? { ...position, mode } : position);
  return {
    frame,
    // The sink already prefers a flash set over the lit set, so the one-beat Hint
    // on demand window sends exactly one full-pattern frame and then returns. A family
    // that names its own flash set (the chord destination shape) wins over the shape.
    scene: sceneFromNotes(frame.led, {
      target: frame.target,
      blink: frame.blink,
      flash: frame.flash ? (frame.flashNotes && frame.flashNotes.length ? frame.flashNotes : run.chart.shape) : [],
    }),
  };
}

// The chord counter counts bars, not notes: the chord name rides the same screen column
// as the pair strip and drops out once the screen fades past Anchors.
function chordNameAt(chart, barIndex) {
  const chords = Array.isArray(chart.chords) ? chart.chords : [];
  if (!chords.length) return '';
  return chords[Math.max(0, barIndex) % chords.length].name;
}

// The play-along counter's view: the bar the pass is on (the board and the LEDs already
// carry where it is going) and that bar's own chord name and degree, read from the chart.
function playCounterView(frame, level) {
  const steps = run && run.chart && Array.isArray(run.chart.steps) ? run.chart.steps : [];
  const index = Number.isInteger(frame.barIndex)
    ? Math.max(0, Math.min(steps.length - 1, frame.barIndex))
    : 0;
  const step = steps[index] || null;
  return {
    family: run.chart.family,
    level,
    bar: frame.stepNumber,
    bars: frame.totalSteps,
    chordName: step ? step.chordName : '',
    roman: step ? step.roman : '',
    // A song section names itself (`Verse · Bar 3 of 4`); a progression has no section. The
    // name resolves from the chart's own section list, so a stored record can never put a
    // string of its own in front of the counter (T-04-18).
    sectionName: chartSectionName(run.chart),
    ending: !!frame.ending,
  };
}

function renderDrillFrame(position) {
  if (!run) return;
  const { frame, scene } = drillSceneAt(position);
  board.render(boardNotesFromFrame(frame, drillQuestionMode(), !!connected && settings.lightsOn));
  const target = frame.target;
  const level = run.hintLevel;
  const chord = run.chart.family === 'chordChanges';
  const play = PLAY_FAMILIES.has(run.chart.family);
  const counter = chord
    ? barCounterText({
      bar: frame.stepNumber,
      bars: frame.totalSteps,
      chordName: chordNameAt(run.chart, frame.stepNumber - 1),
      level,
    })
    : play
      ? playCounterText(playCounterView(frame, level))
      : (target ? nowPlayingText(target, drillNames(), level) : '');
  panels.setNowPlaying(counter, frame.stepNumber, frame.totalSteps);
  panels.setPairStrip({
    pair: run.chart.pair || null,
    chords: run.chart.chords || [],
    barIndex: Math.max(0, frame.stepNumber - 1),
    level,
  });
  // The chart's own tempo, never the browse field: a pass seeded at 80 BPM keeps its
  // blink rate even while the tempo box still reads the previous number (04-02, Pattern 5).
  sink.tick(scene, position.beat || 0, run.chart.bpm);
  panels.setProgress(progressFor(position));
  if (run.chart.timed !== false) {
    panels.renderBeat(position.beat, position.phase || run.phase, run.chart.bpm, {
      beatsPerBar: run.chart.beatsPerBar,
      beatInBar: position.beatInBar,
    });
  }
  // The stage chart advances on the bar line and rebuilds only when the bar, the level or
  // the chart itself changes — one comparison per frame, never a twelve-card rebuild (A12).
  if (play) panels.renderStageChart({ chart: run.chart, level, barIndex: frame.barIndex });
  // Keep the one-flash message until the beat window closes; then the feedback line
  // clears on its own (or a later open-string sentence takes over).
  const flashWindow = run.hintLevel === 2 && Number.isFinite(run.flashUntilBeat) && position.beat < run.flashUntilBeat;
  // The Phase 1 open-string sentence is a single-note cue: it belongs to the families whose
  // target *is* the note being practised, and it never outranks a D-52 spot line. A play-along
  // cue is the whole next shape, so the sentence would both lie and mask the required
  // `Listening — play each chord on the change.` line (CR-01).
  const spotLive = !!spotText;
  if (openStringCue({ target, level, stageMode: settings.stageMode, play, spotLive })) {
    panels.setFeedback(OPEN_STRING_FEEDBACK);
  }
  // A spot line outranks the empty line: it is the only thing D-52 allows the pass to say.
  else if (!run.pauseReason && !flashWindow && !spotLive) panels.setFeedback('');
}

function renderDrillState() {
  const phase = run ? run.phase : 'idle';
  const available = settings.tab === 'scales';
  const family = run && run.chart ? run.chart.family : settings.drillFamily;
  // The one recommendation for this boundary, computed before the drill view is painted so the
  // boundary's single fill and the strip's sentence can never disagree (D-74).
  const recommendation = currentRecommendation();
  let summary = null;
  let pauseBar = 1;
  if (run && phase === 'paused') pauseBar = Math.floor((run.resumeFromBeat - run.chart.countInBeats) / run.chart.beatsPerBar) + 1;
  if (run && phase === 'result') {
    summary = summarizeDrill(run);
    // CHORD-04: the result can seed the weakest stored pair, so the view carries the
    // plane's first row beside the drill's own summary. It is read after the record was
    // written, which is why a chord drill already counts towards its own pair.
    summary.weakestPair = weakestPair(store.getProgress(), { limit: 1 })[0] || null;
  }
  const idleId = previewSkillId();
  const persisted = store.getProgress();
  const idleLevel = startLevelFor(persisted, idleId);
  const outcomes = run && Array.isArray(run.questionOutcomes) ? run.questionOutcomes : [];
  // The change families' stage view: the pair strip and the bar counter for a chord drill,
  // the stage chart and the bar counter for a play-along. An idle stage previews the chart
  // Start drill will build — keyed on the family set, never on the chord family alone, or
  // an idle progression would hand the stage a `bars: 0` and render an empty chart (Pitfall 8).
  const chordSource = run && run.chart
    ? run.chart
    : (CHART_CHANGES.has(family) ? previewChart() : null);
  const latestPass = run && run.passes.length ? run.passes[run.passes.length - 1] : null;
  const evidence = latestPass && latestPass.assessment;
  const conflict = evidence && evidence.passed === false && !evidence.corrected;
  for (const id of ['reportCorrection', 'recallCorrection']) {
    const button = $(id);
    if (button) button.hidden = !(conflict && evidence.source === 'microphone');
  }
  const evidenceText = conflict
    ? evidence.source === 'quiz' ? 'Some answers were wrong or revealed. Try a fresh set before marking it clean.' : 'The microphone measured a shaky pass. If it missed your playing, correct the reading explicitly.'
    : evidence ? evidence.corrected ? 'Assessment: player-corrected microphone reading.' : `Assessment: ${evidence.source === 'selfReport' ? 'self-reported; not microphone verified' : evidence.source}${evidence.manualHits ? ' with per-note corrections' : ''}.` : '';
  for (const id of ['passEvidence', 'recallEvidence']) { if ($(id)) $(id).textContent = evidenceText; }
  panels.setDrill({
    available,
    phase,
    summary,
    pauseReason: run ? run.pauseReason : null,
    pauseBar,
    audioStartFailed: !!(run && phase === 'paused' && run.pauseReason === 'audio' && run.pausedBeat === 0),
    disconnected: !connected,
    hintLevel: run ? run.hintLevel : idleLevel,
    plan: run ? run.plan : null,
    levelChange: run ? run.levelChange : null,
    passes: run ? run.passes : [],
    streaks: run ? streaksFor(run) : null,
    hasHistory: run ? false : !!persisted.skills[idleId],
    skill: phase === 'result' ? resultSkill : null,
    family,
    question: questionView(family, idleLevel),
    kinds: quizKindsFor(settings.quizMode),
    questionKind: settings.quizQuestion,
    quizMode: settings.quizMode,
    correct: outcomes.filter(outcome => outcome === 'correct').length,
    revealed: outcomes.filter(outcome => outcome === 'revealed').length,
    pair: chordSource ? chordSource.pair || null : null,
    chords: chordSource && Array.isArray(chordSource.chords) ? chordSource.chords : [],
    changes: run ? run.changes : null,
    // A play-along's change numbers are microphone evidence: the review says `Not scored`
    // in words when the pass produced none, never a zero it never measured (D-50, A-61).
    micScored: !!(run && run.syncScore),
    barIndex: run ? run.stepIndex : 0,
    bars: chordSource && Number.isFinite(chordSource.bars) ? chordSource.bars : 0,
    // The stage chart reads the very chart the counter and the bar grid read, so the idle
    // preview and the live pass can never disagree about which bars are coming.
    chart: chordSource,
    // The chord boundary pre-fills the tempo box from the engine's own suggestion.
    tempo: run && phase === 'passReview' ? tempoSuggestion(run) : null,
    // The cluster's word and its one action, read from the adapter (never from a flag).
    micState: micViewState(),
    // The `Backing` cluster's own three controls: the stored preset, the four stored stem
    // booleans and the stored window. The panel paints them; it never derives one from
    // another (A-58).
    intensity: settings.intensity,
    stems: {
      stemClick: settings.stemClick,
      stemDrums: settings.stemDrums,
      stemBass: settings.stemBass,
      stemPad: settings.stemPad,
    },
    loopBars: settings.loopBars,
    // The item's whole length, so the `Loop` gate never measures itself against the window
    // the pass is currently playing (CR-02, A-68).
    itemBars: chordSource && Number.isFinite(chordSource.itemBars) ? chordSource.itemBars : 0,
    // The block boundary belongs to a session block's result and to nothing else: the plan is
    // frozen at START, so the token and the recommendation can never describe another block.
    // The one fill it carries is the recommendation's (`Next block`, `Repeat`, or none for `stop`).
    sessionBoundary: session.state === 'running' && phase === 'result' && session.plan
      ? {
        visible: true,
        index: session.blockIndex,
        total: session.plan.blocks.length,
        kind: session.plan.blocks[session.blockIndex] ? session.plan.blocks[session.blockIndex].kind : 'focus',
        accentKey: recommendationAccentKey(recommendation),
      }
      : { visible: false },
    // A-73: the boundary and the panel never show at once, so the panel's own flag travels with
    // the drill view and the boundary hides itself while it is open.
    sessionOpen: panels.isSessionOpen(),
  });
  if (run && phase === 'passReview') panels.setSelfReport(run.selfReport);
  // The header's Session chip and its accessible name follow the due count, not the panel: the
  // count is the store's own queue, so a recorded pass moves it without opening anything. The
  // block index is only ever true while a *session* runs, never while an arbitrary drill does: a
  // free-choice pass has no plan and no five-block counter to advance (WR-02). This is the one
  // `setSessionButton` call in the whole module.
  panels.setSessionButton({
    dueCount: progressView().dueCount,
    running: session.state === 'running',
    index: session.blockIndex,
    total: SESSION_BLOCKS.length,
    disabled: isRunning() || !!(run && run.phase === 'passReview'),
  });
  // The one recommendation strip: its sentence, its one optional button and the single fill that
  // belongs to this boundary. Every other paint is the panel's, so nothing here moves an accent.
  applyRecommendation(recommendation);

  if (!available) { board.setInteractive(true); return; }
  if (phase === 'countIn' || phase === 'active') {
    // A wait-mode quiz is answered by a board tap (D-43/NOTE-03); a timed pass is not, so
    // the board is live exactly while the question is open (CR-02).
    board.setInteractive(boardInteractiveFor(run.chart, phase));
    // A wait-mode chart has no transport segment, so it always paints beat 0.
    renderDrillFrame(run && run.chart.timed === false ? { beat: 0, phase: 'active' } : transport.position());
  } else if (phase === 'paused') {
    board.setInteractive(boardInteractiveFor(run.chart, phase));
  } else if (phase === 'passReview') {
    // The boundary shows the full shape with no target; the decision line carries
    // the level facts while the stage is hidden.
    const frame = frameAt(run, { phase: 'finished', beat: run.chart.totalBeats });
    board.render(boardNotesFromFrame(frame));
    board.setInteractive(false);
    panels.resetBeat(meterOf(run.chart));
    panels.setProgress(100);
  } else if (phase === 'result') {
    const frame = frameAt(run, { phase: 'result', beat: run.chart.totalBeats });
    board.render(boardNotesFromFrame(frame));
    board.setInteractive(true);
    panels.resetBeat(meterOf(run.chart));
    panels.setProgress(100);
  } else {
    board.setInteractive(true);
    // The idle stage of a play-along shows bar 1's next chord on the board and the guitar, not
    // the scale the Scales tab happens to be browsing: `previewChart` is already the chart
    // `Start drill` will build, so the preview frame is its own first-bar frame (WR-02, A-52).
    // `playAlongIdleFrame` answers `null` for every other family, which keeps the scale scene.
    const preview = playAlongIdleFrame(chordSource, idleLevel);
    if (preview) {
      board.render(preview.notes.map(n => ({ ...n, question: false })));
      // `renderAll` has just written the browse scene, so the sink's 15 Hz gate would drop this
      // one and the guitar would keep the scale. `reset` clears the gate and the dedupe exactly
      // as a forced scene does, so the guitar shows bar 1 in the same paint (WR-02).
      if (sink) {
        sink.reset();
        sink.tick(sceneFromNotes(preview.led, { target: preview.target }), 0, chordSource.bpm);
      }
    }
    // The idle beat row reads the same meter the pass will: a 3/4 song never idles on four
    // dots and `Beat 1 of 4` (WR-03, A-62).
    panels.resetBeat(meterOf(chordSource));
    panels.setProgress(0);
  }
}

// The prompt-card view model. Both the mode token and the prompt are computed from the
// effective mode, so a Name-mode question asked in Find form at level 4 renders in Find
// form in the card and in the announcement.
function questionView(family, idleLevel = 0) {
  if (family !== 'findNote') return null;
  const source = run && run.chart && run.chart.family === 'findNote' ? run.chart : previewChart();
  const questions = Array.isArray(source.questions) ? source.questions : [];
  const count = questions.length;
  const level = run ? run.hintLevel : idleLevel;
  const index = run
    ? clamp(Number.isInteger(run.questionIndex) ? run.questionIndex : 0, 0, Math.max(0, count - 1))
    : 0;
  const question = questions[index] || null;
  const effectiveMode = question
    ? questionMode(question, level)
    : (source.content && source.content.quizMode === 'name' ? 'name' : 'find');
  const outcome = run && question ? (run.questionOutcomes || [])[index] || null : null;
  return {
    index: count ? index + 1 : 0,
    count,
    effectiveMode,
    prompt: question ? promptText(question, effectiveMode) : '',
    poolText: question ? question.poolLabel : '',
    chips: question ? chipsFor(question, effectiveMode) : [],
    answer: question ? (effectiveMode === 'find' ? question.target.f : question.answerChip) : null,
    answered: outcome !== null,
    outcome: outcome && question
      ? quizOutcomeText({
        correct: outcome === 'correct',
        revealed: outcome === 'revealed',
        noteName: question.noteName,
        fret: question.target.f,
        string: question.target.s,
      })
      : '',
  };
}

function applyEffects(effects) {
  for (const effect of effects) {
    if (effect.type === 'startTransport') {
      const segment = buildSegment(run.chart, { fromBeat: run.resumeFromBeat, countInBeats: run.chart.countInBeats });
      sink.reset();
      // The score timestamps are chart milliseconds, so the pass origin is re-read at
      // every start: a resumed pass keeps counting against the same chart timeline.
      if (ctx && Number.isFinite(ctx.currentTime)) scoreOriginMs = chartOriginMs(ctx.currentTime, segment);
      applyAudioMix();
      transport.start(segment);
    } else if (effect.type === 'pauseTransport') {
      // Close the window before the gain is muted, so a paused pass is silent and a
      // resumed one re-opens at the next active frame.
      closeMicWindow();
      transport.pause();
      applyAudioMix();
    } else if (effect.type === 'stopTransport') {
      transport.stop();
      // Pause muting is lifted on stop as well as on start: Stop from paused must not
      // leave the shared master gain at 0 for the result panel and later browse. The
      // stream is released first so the composer reads the post-stop listening state.
      stopMic();
      applyAudioMix();
    } else if (effect.type === 'zeroLeds') {
      sink.reset();
      sink.tick(sceneFromNotes([]), 0, settings.bpm);
    } else if (effect.type === 'announce') {
      const entry = ANNOUNCE[effect.key];
      const text = typeof entry === 'function' ? entry() : entry;
      // At a session block's result the boundary message is that same sentence once, prefixed.
      if (text) panels.announce(`${sessionBoundaryPrefix(effect.key)}${text}`);
    }
  }
}

function dispatch(event) {
  // A start that never reached the count-in is not the block's run, so its marker goes with the
  // failure. It is cleared here rather than inside `startDrill`, whose body stays untouched.
  if (event.type === 'START_FAILED') pendingBlock = null;
  if (!run) {
    if (event.type !== 'START' && event.type !== 'START_FAILED') return;
    if (!chart) buildChart();
    run = createRun(chart);
  }
  // A new pass starts a new buffer; RESUME keeps the one it paused, because the times in
  // it are already chart milliseconds and the resumed segment shares the timeline. The mic
  // a pass is scored with is fixed at its start, so a mid-pass toggle only ever reaches the
  // next boundary (MIC-01).
  if (event.type === 'START' || event.type === 'RESTART' || event.type === 'NEXT_PASS') {
    scoreEvents = [];
    micAnswers = [];
    micStreak = { midi: null, count: 0, armedAt: null };
    spotShown = [];
    passMicArmed = !!settings.micOn;
  }
  // Every answer and every advance ends the current question's microphone window; the
  // next answer needs its own onset and its own two-read streak (WR-04).
  if (event.type === 'ANSWER' || event.type === 'REVEAL' || event.type === 'NEXT_QUESTION') {
    micStreak = { midi: null, count: 0, armedAt: null };
  }
  // A resumed pass continues its score but starts a new listening window, so D-52's three
  // lines get their three chances again.
  if (event.type === 'RESUME') spotShown = [];
  // The score is read before the effects run: `stopTransport` is what tears the stream
  // (and the buffer) down, and the pass record must still see what was played. A quiz
  // closes its pass from inside NEXT_QUESTION, so that closing event carries the same
  // stamp instead of leaving the result unscored (CR-04).
  if (event.type === 'FINISH' || event.type === 'STOP') event = { ...event, syncScore: syncScoreForPass() };
  else if (event.type === 'NEXT_QUESTION' && closesQuizPass()) event = { ...event, syncScore: syncScoreForPass() };
  const before = run.phase;
  const { state, effects } = reduce(run, event);
  run = state;
  if (run.phase !== 'countIn' && run.phase !== 'active') flashFeedbackUntilBeat = 0;
  applyEffects(effects);
  // A pass boundary, a restart, a resume and a next pass re-arm the stream here rather than
  // waiting for the next animation frame, so the new pass is never silently unscored (CR-01).
  if (mic) syncMicWindow();
  // The lock is released in the same task as the pause or the result that stopped the pass,
  // so waiting for the next frame is never what keeps a screen awake (D-77).
  syncWakeLock();
  // The result is written exactly once, when the drill first reaches it. A
  // self-report re-upserts the same session below; never per frame or per tick.
  if (run.phase === 'result' && before !== 'result') {
    stopMic();
    const summary = recordResult();
    // The one credit site: a block is credited only when a session block's own run reaches its
    // result. The marker is cleared before the fold, so nothing can credit the same block twice,
    // and the reducer's per-block gate rejects a second summary until a Repeat (T-05-02).
    if (pendingBlock !== null) {
      const index = pendingBlock;
      pendingBlock = null;
      const credit = sessionReduce(session, { type: 'BLOCK_DONE', index, summary });
      session = credit.state;
      applySessionEffects(credit.effects);
    }
  }
  if (run.phase === 'idle') {
    run = null;
    chart = null;
    resultSkill = null;
    renderDrillState();
    renderAll({ forceScene: true });
    return;
  }
  renderDrillState();
}

function recordResult() {
  const summary = summarizeDrill(run);
  // One write per mutation: apply against the persisted plane, then persist once and
  // re-read the validated record so the UI and the store cannot drift.
  progress = applyResult(store.getProgress(), summary, { now: Date.now() });
  progress = store.setProgress(progress);
  // A dropped write must be visible at the point of record, not only when the player
  // later opens Progress: the session disappears on reload otherwise (WR-09).
  if (store.status === 'writeFailed') {
    panels.setFeedback(STORAGE_MESSAGE.writeFailed);
    panels.announce(STORAGE_MESSAGE.writeFailed);
  }
  resultSkill = Object.hasOwn(progress.skills, summary.skillId) ? progress.skills[summary.skillId] : null;
  return summary;
}

// ---------- The one answer path (D-43, T-03-01) ----------
// A board tap, an answer chip and (from 03-03) a detected pitch all pass through this
// single function: one judge call, one ANSWER event. A question that already has an
// outcome ignores every further answer, so a double tap cannot change a result.
function commitAnswer(source, answer) {
  if (!run || run.chart.timed !== false || run.phase !== 'active') return;
  const question = openQuestion();
  if (!question) return;
  if ((run.questionOutcomes || [])[run.questionIndex]) return;
  const effectiveMode = questionMode(question, run.hintLevel);
  const correct = judge(question, answer, effectiveMode);
  const index = run.questionIndex;
  dispatch({ type: 'ANSWER', index, answer, source, correct, at: nowMs() });
  // The quiz's mic line counts only the answers the microphone committed: a chip or a
  // board tap is never claimed as "answered on pitch" (NOTE-04, D-50).
  if (source === 'mic' && correct) micAnswers.push(index);
  if (!run || run.chart.family !== 'findNote') return;
  const cell = { s: question.target.s, f: question.target.f };
  board.flashHit(cell);
  if (source !== 'board') panels.focusNextQuestion();
}

function onReveal() {
  if (!run || run.chart.timed !== false || run.phase !== 'active') return;
  const question = openQuestion();
  if (!question) return;
  if ((run.questionOutcomes || [])[run.questionIndex]) return;
  dispatch({ type: 'REVEAL', index: run.questionIndex });
  if (!run) return;
  board.flashHit({ s: question.target.s, f: question.target.f });
  panels.focusNextQuestion();
}

function onNextQuestion() {
  if (!run || run.chart.timed !== false || run.phase !== 'active') return;
  if (!(run.questionOutcomes || [])[run.questionIndex]) return;
  dispatch({ type: 'NEXT_QUESTION', at: nowMs(), wallAt: Date.now() });
}

// ---------- The chord-change stage (CHORD-02, CHORD-03) ----------
// The manual count: one press marks the bar the transport is in, read from the audio
// clock so the press lands on the bar the player heard. The reducer ignores a second
// press in the same bar, so the button stays live for the whole pass.
function onMarkChange() {
  if (!run || run.chart.family !== 'chordChanges' || run.phase !== 'active') return;
  const position = transport.position();
  const beat = Number.isFinite(position.beat) ? position.beat : run.beat;
  const bar = clamp(stepIndexFor(run.chart, beat), 0, Math.max(0, run.chart.steps.length - 1));
  dispatch({ type: 'MARK_CHANGE', bar });
}

// A-43: the manual override during a mic-scored scale pass. It credits the step the clock
// is on; the reducer owns "once per step" and the family/phase guard, so a stray press can
// never inflate a pass and the result never distinguishes it from a heard hit.
function onMarkHit() {
  if (!run || run.chart.family !== 'scaleRun' || run.phase !== 'active') return;
  const position = transport.position();
  const beat = Number.isFinite(position.beat) ? position.beat : run.beat;
  dispatch({ type: 'MARK_HIT', beat });
}

// The pair is a stage control: it can never move behind a live chart or a boundary, and
// switching it discards an idle or finished run the same way a family switch does.
function onPairChange(id) {
  if (isRunning() || (run && run.phase === 'passReview')) return;
  if (!Object.hasOwn(chordPairById, id)) return;
  transport.stop();
  run = null;
  chart = null;
  resultSkill = null;
  pendingBlock = null;
  // The composer reads the run, so the run is cleared first: a pair change re-derives both
  // planes as the idle mix rather than as the pass that just left (F3).
  applyAudioMix();
  save({ chordPairId: id });
  renderAll({ forceScene: true });
  renderDrillState();
}

function onFamily(family) {
  applyChange('drillFamily', family);
}

// ---------- Progress panel, export and import ----------
function setBackup(text, tone = '') {
  backupMessage = { text: text || '', tone: text ? tone : '' };
  panels.setBackupStatus(backupMessage.text, backupMessage.tone);
}

// The panel is rebuilt from the store on every open, so no cached copy can go stale.
function progressView() {
  const now = Date.now();
  const persisted = store.getProgress();
  progress = persisted;
  const status = store.status;
  const message = status === 'writeFailed'
    ? { text: STORAGE_MESSAGE.writeFailed, tone: 'danger' }
    : status === 'readFailed'
      ? { text: STORAGE_MESSAGE.readFailed, tone: 'danger' }
      : backupMessage;
  return {
    status,
    now,
    totals: persisted.totals,
    streak: persisted.streak,
    sessions: persisted.sessions,
    skills: skillRows(persisted, { now, limit: 5 }),
    due: dueRows(persisted, { now, limit: 5 }),
    all: skillRows(persisted, { now, limit: Number.MAX_SAFE_INTEGER }),
    // The plan and the header chip read the whole review queue, never the panel's five: a sixth
    // due skill is still due, and a session that ignored it would be lying about the day.
    allDue: dueRows(persisted, { now, limit: Number.MAX_SAFE_INTEGER }),
    // The five weakest pairs are the fixed list; the whole table feeds the disclosure.
    chordPairs: weakestPair(persisted, { limit: 5 }),
    allChordPairs: chordPairRows(persisted, { limit: Number.MAX_SAFE_INTEGER }),
    dueCount: dueRows(persisted, { now, limit: Number.MAX_SAFE_INTEGER }).length,
    message,
  };
}

function openProgress() {
  if (!store || isRunning() || (run && run.phase === 'passReview')) return;
  if (calibration) closeCalibration({ focus: false });
  panels.setProgressPanel(progressView());
  panels.setProgressOpen(true);
  panels.focusProgressHead();
}

function closeProgress() {
  panels.setProgressOpen(false);
  panels.focusProgressToggle();
}

// ---------- The micro-lesson (05-02 Task 1, D-75) ----------
// A lesson is content, not state: the panel is handed the family's own entry and reads nothing
// else, so there is no second copy to keep in step with `content.js`. The lookup is own-key only,
// exactly like every other content map in this module (CR-02).
function lessonFor(family) {
  if (typeof family !== 'string' || !Object.hasOwn(LESSONS, family)) return null;
  return contentLessonFor(family);
}

// The guided lesson reads the current selection, not a second copy of it. The shape diagram and
// the steps are built from the same scale/chord data the stage is about to play, so the lesson can
// never teach a different position or voicing than the one the player is looking at.
function lessonChordsFor(bars = []) {
  const chords = [];
  const seen = new Set();
  for (const bar of bars) {
    if (!bar || typeof bar.name !== 'string' || seen.has(bar.name)) continue;
    seen.add(bar.name);
    const voicing = voiceChord(bar.rootPc, bar.quality, settings.voicingId, CHORD_FAMILIES);
    if (voicing) chords.push({ ...voicing, name: bar.name });
    if (chords.length >= 4) break;
  }
  return chords;
}

function guidedLessonContext(family) {
  const tempo = 50;
  const keyName = KEY_NAMES[settings.keyPc] || 'C';
  if (family === 'findNote') {
    const question = settings.quizQuestion === 'degree' ? 'degrees'
      : settings.quizQuestion === 'interval' ? 'intervals' : 'note names';
    const mode = settings.quizMode === 'name' ? 'Name it' : 'Find it';
    return {
      family, tempo,
      title: 'Find the note',
      detail: `${question} · ${mode}`,
      strings: ['E', 'A', 'D', 'G', 'B', 'E'],
    };
  }
  if (family === 'chordChanges') {
    const pair = chordPairById[settings.chordPairId] || CHORD_PAIRS[0];
    const chords = pair.chords.map(id => {
      const chord = chordById[id];
      const voicing = chord && chord.voicings ? chord.voicings[0] : null;
      return voicing ? { ...voicing, name: chord.name } : null;
    }).filter(Boolean);
    return {
      family, tempo,
      title: pair.label,
      detail: '8 bars · change on beat 1',
      chords,
    };
  }
  if (family === 'progression') {
    const prog = progressionById[settings.progressionId] || PROGRESSIONS[0];
    const bars = expandProgression(prog, settings.keyPc);
    return {
      family, tempo,
      title: `${keyName} ${prog.mode === 'minor' ? 'minor' : 'major'} · ${prog.name}`,
      detail: `${bars.length} bars · one chord per bar`,
      bars: bars.map(bar => ({ name: bar.name, roman: bar.roman })),
      chords: lessonChordsFor(bars),
    };
  }
  if (family === 'song') {
    const song = songById[settings.songId] || SONGS[0];
    const sections = song && Array.isArray(song.sections) ? song.sections : [];
    const section = sections.find(entry => entry && entry.id === settings.songSectionId) || sections[0];
    if (!section) return null;
    const bars = expandSongSection(song, section, settings.keyPc, progressionById);
    return {
      family, tempo,
      title: song.title,
      detail: `${section.name} · ${song.meter[0]}/${song.meter[1]}${song.strum ? ` · ${song.strum}` : ''}`,
      bars: bars.map(bar => ({ name: bar.name, roman: bar.roman })),
      chords: lessonChordsFor(bars),
      strum: song.strum || '',
    };
  }
  const scale = SCALE_BY_ID[settings.scaleId] || SCALES[0];
  const positions = positionsForScale(settings.keyPc, scale);
  const position = settings.positionId === 'all'
    ? positions[0] || null
    : positions.find(entry => entry.id === settings.positionId) || positions[0] || null;
  const notes = notesForPosition(settings.keyPc, scale, position ? position.id : 'all');
  const names = spellScale(settings.keyPc, scale);
  const start = position ? Math.max(0, position.start) : 1;
  const visible = notes.filter(note => note.f >= start && note.f <= start + 4);
  const root = visible.slice().sort((a, b) => a.f - b.f || b.s - a.s).find(note => note.iv === 0) || visible[0] || null;
  const noteName = note => names[((note.midi % 12) + 12) % 12];
  return {
    family, tempo,
    title: `${keyName} ${scale.name}`,
    detail: settings.positionId === 'all'
      ? `Whole neck · first shape · key ${keyName}`
      : position
        ? `${position.label} · key ${keyName}`
        : `First shape · key ${keyName}`,
    strings: ['E', 'B', 'G', 'D', 'A', 'E'],
    scale: {
      id: scale.id,
      start,
      frets: 5,
      notes: visible.map(note => ({
        s: note.s, f: note.f, note: noteName(note), midi: note.midi,
        root: note.iv === 0, blue: note.iv === 6,
      })),
      root: root ? { s: root.s, f: root.f, note: noteName(root) } : null,
    },
  };
}

// Reachable at idle only: `#drillStage` is hidden at the pass review and at the result, `Learn` is
// disabled during a pass, and this guard is the second gate rather than the first — the one that
// keeps a lesson from opening over a live chart (D-75). The family comes from the run's own chart
// when one exists and from the settings otherwise, so the panel names the drill the stage shows.
function openLesson() {
  if (!store || isRunning() || (run && run.phase === 'passReview')) return;
  if (tunerActive || !$('tunerCard').hidden) stopTuner();
  const family = run && run.chart ? run.chart.family : settings.drillFamily;
  const base = lessonFor(family) || {};
  // The Blues scale has its own copy, links and clip. The variant is merged over the family
  // lesson, so no second lookup table can drift from the scale picker.
  const variant = family === 'scaleRun' && settings.scaleId === 'blues' ? base.blues : null;
  const lesson = variant ? { ...base, ...variant } : base;
  panels.setLesson({ ...lesson, guide: guidedLessonContext(family) }, { family });
  panels.setLessonOpen(true);
  panels.focusLessonHead();
}

// `Close` is the panel's only exit, and the setter hands focus back to the button that opened it,
// so a keyboard user never lands on a hidden node.
function closeLesson() {
  panels.setLessonOpen(false);
}

// The power-chord lesson's one practice action: four bars of click with G5 for two bars and
// A5 for two. It is a play-along, not a scored chart, so it never touches the run, progress or
// session planes. The diagrams stay on screen while the loop sounds.
async function practicePowerChords() {
  if (!settings.sound) {
    panels.setFeedback('Sound is off — turn Sound on to practise the power chords.');
    panels.announce('Sound is off. Turn Sound on to practise the power chords.');
    return;
  }
  const ready = await startAudio();
  if (!ready || !audio) {
    panels.setFeedback(AUDIO_START_FAILED);
    panels.announce(AUDIO_START_FAILED);
    return;
  }
  const bpm = 70;
  const beat = 60 / bpm;
  const start = ctx.currentTime + 0.15;
  const shapes = [
    [43, 50, 55], // G5: G2, D3, G3
    [45, 52, 57], // A5: A2, E3, A3
  ];
  for (let bar = 0; bar < 4; bar++) {
    const barStart = start + bar * 4 * beat;
    const shape = shapes[bar < 2 ? 0 : 1];
    shape.forEach((midi, index) => audio.pluck(midi, barStart + index * 0.035));
    for (let b = 0; b < 4; b++) audio.click(barStart + b * beat, b === 0);
  }
  panels.setFeedback('Power-chord practice — G5 for two bars, then A5. Play along.');
}

// The lesson's "Hear it" action. It uses the same plucked-string synth as a drill, but the
// sequence is a lesson view model, not a chart: no transport, no scoring, no session record.
async function listenLesson(sequence) {
  if (!Array.isArray(sequence) || !sequence.length) return;
  if (!settings.sound) {
    panels.setFeedback('Sound is off — turn Sound on to hear the lesson.');
    panels.announce('Sound is off. Turn Sound on to hear the lesson.');
    return;
  }
  const ready = await startAudio();
  if (!ready || !audio) {
    panels.setFeedback(AUDIO_START_FAILED);
    panels.announce(AUDIO_START_FAILED);
    return;
  }
  const start = ctx.currentTime + 0.08;
  for (const step of sequence) {
    if (!Number.isFinite(step.at) || !Number.isFinite(step.midi)) continue;
    audio.pluck(step.midi, start + step.at / 1000);
  }
  panels.setFeedback('Playing the lesson — listen first, then try it.');
}

// The tuner shares the one mic adapter but not a drill window: it listens continuously until
// Stop, the tab hides, or a pass starts. A denied or absent device is a message inside the
// tuner card, never a thrown error.
async function startTuner() {
  if (!store || isRunning() || (run && run.phase === 'passReview')) return;
  const request = ++tunerRequest;
  panels.setTunerOpen(true);
  panels.setTunerMessage('Starting the tuner…');
  const ready = await startAudio();
  if (request !== tunerRequest || document.hidden) return;
  if (!ready) {
    panels.setTunerMessage('Audio could not start. Try again.');
    return;
  }
  const engine = ensureMic();
  if (!engine) {
    panels.setTunerMessage(MIC_FEEDBACK.unavailable);
    return;
  }
  const state = await engine.arm();
  if (request !== tunerRequest || document.hidden) return;
  if (state !== 'on' && state !== 'listening') {
    panels.setTunerMessage(state === 'denied' ? MIC_FEEDBACK.blocked : MIC_FEEDBACK.unavailable);
    return;
  }
  tunerActive = true;
  engine.startListening();
  panels.setTunerMessage('Play one string and let it ring.');
}

function stopTuner() {
  tunerRequest++;
  tunerActive = false;
  if (mic) mic.stop();
  if (panels) panels.setTunerOpen(false);
}

// The beginner path: switch to the note-finding family and open its guided lesson, which now
// starts with tuning and then teaches the open strings and semitone counting. The lesson's own
// action starts the question set, so the first click and the first drill use the same family.
function startHere() {
  if (!store || isRunning() || (run && run.phase === 'passReview')) return;
  applyChange('drillFamily', 'findNote');
  // The beginner path is about naming notes, so it cannot inherit a finger-number display
  // from whatever the player was browsing. Reset the labels with the family switch.
  applyChange('labels', 'notes');
  openLesson();
}

// Power chords are a concept lesson, not a drill family: the Chords tab carries the entry and
// the shared lesson panel renders it with the same shape/steps/videos surface. There is no
// Start action because the app has no power-chord drill to seed.
// The path rail is a curriculum shortcut, not a second state machine: each step applies the
// same settings and opens the same lesson the browse controls would. The stage's existing
// idle guard is the only lock, so a path press during a pass does nothing (D-75).
function openPathStep(step) {
  if (!store || isRunning() || (run && run.phase === 'passReview')) return;
  if (step === 'tune') {
    if ($('tunerCard').hidden) startTuner();
    else stopTuner();
    return;
  }
  if (step === 'power') {
    applyTab('chords');
    openPowerChordLesson();
    return;
  }
  applyTab('scales');
  if (step === 'find') {
    applyChange('drillFamily', 'findNote');
    applyChange('labels', 'notes');
  } else if (step === 'shape') {
    applyChange('drillFamily', 'scaleRun');
    applyChange('scaleId', 'minPent');
    applyChange('labels', 'fingers');
  } else if (step === 'blues') {
    applyChange('drillFamily', 'scaleRun');
    applyChange('scaleId', 'blues');
  } else if (step === 'changes') {
    applyChange('drillFamily', 'chordChanges');
  }
  openLesson();
}

// The visible real-reference card sits above the board and the path rail's Watch & read card
// opens the lesson's materials. Both use the one lesson drawer and scroll it to the exact
// section, so the photo/clip and the YouTube cards are never a separate copy (D-75).
function openLessonSection(section) {
  if (!store || isRunning() || (run && run.phase === 'passReview')) return;
  openLesson();
  requestAnimationFrame(() => panels.revealLessonSection(section));
}

function openPowerChordLesson() {
  if (!store || isRunning() || (run && run.phase === 'passReview')) return;
  if (tunerActive || !$('tunerCard').hidden) stopTuner();
  const power = lessonFor('chordChanges')?.power;
  if (!power) return;
  panels.setLesson({ ...power, guide: { family: 'powerChord' } }, { family: 'chordChanges' });
  panels.setLessonOpen(true);
  panels.focusLessonHead();
}

// The guided lesson's one action: seed the current family at 50 BPM and start it from the same
// click, so the transient activation that opens the lesson is also the one that resumes audio.
// A free-choice lesson is never credited to a session block.
async function startGuidedLesson() {
  if (!store || isRunning()) return;
  const family = run && run.chart ? run.chart.family : settings.drillFamily;
  closeLesson();
  pendingBlock = null;
  const patch = { tab: 'scales', drillFamily: family };
  if (family !== 'findNote') patch.bpm = 50;
  save(patch);
  renderAll({ forceScene: true });
  renderDrillState();
  await startDrill();
}

// The one panel-close tail every seed shares. Progress, Calibration, the Session panel and the
// micro-lesson are four siblings in one slot under the header (A-73), so "close every panel" is
// four lines and never three: a stale lesson left open above a freshly seeded stage is a panel the
// player did not ask for, with `Learn` still reporting `aria-expanded="true"` (WR-07).
function closeAllPanels() {
  panels.setProgressOpen(false);
  panels.setCalibrationOpen(false);
  panels.setSessionOpen(false);
  panels.setLessonOpen(false);
}

// Practise loads the skill's stored content without starting the drill. UI-SPEC:543-545:
// every skill kind seeds its own family, so Practise on a note skill returns to the Find
// the note stage with the same pool instead of re-running a scale drill in that key.
function practiseSkill(skillId) {
  // A pass review still owns an unrecorded drill; a result has already been recorded,
  // so close it before replacing the settings it describes (WR-10).
  if (run) {
    if (run.phase !== 'result') return;
    backToBrowse();
  }
  const skills = store.getProgress().skills;
  const record = skills && Object.hasOwn(skills, skillId) ? skills[skillId] : null;
  if (!record) return;
  const id = typeof skillId === 'string' ? skillId : '';
  const content = record.content || {};
  // A-64: a play-along row is a skill like any other, so its `Practise` is the browse `Play`
  // seed — family, item, the key the pass was played in and, for a song, the section the
  // record names (never the browse bar). No new Progress section and no second table: the
  // two families ride the existing Skills and Due lists, and the seed never starts a pass.
  const family = playAlongSkillFamily(content);
  if (family) {
    seedPlayAlong(family, family === 'song' ? content.songId : content.progressionId, {
      keyPc: content.keyPc,
      sectionId: content.sectionId,
    });
    return;
  }
  const patch = { tab: 'scales' };
  if (id.startsWith('chordChanges:')) {
    const pairId = id.slice('chordChanges:'.length);
    if (Object.hasOwn(chordPairById, pairId)) {
      patch.drillFamily = 'chordChanges';
      patch.chordPairId = pairId;
    }
  } else if (id.startsWith('findNote:')) {
    patch.drillFamily = 'findNote';
  } else {
    patch.drillFamily = 'scaleRun';
  }
  if (Number.isInteger(content.keyPc) && content.keyPc >= 0 && content.keyPc <= 11) patch.keyPc = content.keyPc;
  if (typeof content.scaleId === 'string' && Object.hasOwn(SCALE_BY_ID, content.scaleId)) patch.scaleId = content.scaleId;
  if (typeof content.positionId === 'string') patch.positionId = content.positionId;
  save(patch);
  // A free-choice seed abandons any running block's marker: this run belongs to nobody's plan,
  // so it can never be credited to the block that is `now` (D-73, T-05-02).
  pendingBlock = null;
  closeAllPanels();
  renderAll({ forceScene: true });
  renderDrillState();
  const stage = $('transportBar');
  if (stage && typeof stage.scrollIntoView === 'function') stage.scrollIntoView({ block: 'nearest' });
  $('startDrill').focus();
}

// CHORD-04: the seed both pair entry points share — the Chord pairs row and the result's
// `Practise weakest pair`. It selects the family and the pair, closes the panel, brings the
// stage into view and focuses Start drill. It never starts the drill.
function seedPair(pairId) {
  if (!Object.hasOwn(chordPairById, pairId)) return;
  if (run) {
    if (run.phase !== 'result') return;
    backToBrowse();
  }
  save({ drillFamily: 'chordChanges', chordPairId: pairId, tab: 'scales' });
  // A free-choice seed clears the block marker, exactly like `practiseSkill` above.
  pendingBlock = null;
  closeAllPanels();
  renderAll({ forceScene: true });
  renderDrillState();
  const stage = $('transportBar');
  if (stage && typeof stage.scrollIntoView === 'function') stage.scrollIntoView({ block: 'nearest' });
  $('startDrill').focus();
}

function practisePair(pairId) {
  seedPair(pairId);
}

// The family a stored skill's own content block names, own-key only: a record whose item no
// longer resolves in this build is not a play-along the panel can seed, so it falls through
// to the Phase 2/3 kinds instead of seeding a broken stage (T-04-21). A song wins over a
// progression because `buildPlayAlongChart` writes exactly one of the two ids and an empty
// string is "no id" for both.
function playAlongSkillFamily(content = {}) {
  const source = content && typeof content === 'object' ? content : {};
  if (typeof source.songId === 'string' && source.songId !== '' && Object.hasOwn(songById, source.songId)) return 'song';
  if (typeof source.progressionId === 'string' && source.progressionId !== ''
    && Object.hasOwn(progressionById, source.progressionId)) return 'progression';
  return '';
}

// PROG-01/D-59: both browse `Play` buttons' one seed. It selects the family, the item, the
// key and the item's own tempo, closes both panels, brings the stage into view and focuses
// `Start drill` — and it never starts the pass. The 80 BPM default lives here because
// `PROGRESSIONS` carries no `defaultBpm` and `CONTENT_VERSION` must not move (A11, M4); the
// four songs carry their own 70–100. A song also seeds the section the browse bar sits in
// and clears the section loop, so the pass that lands is the one the player was looking at.
//
// The two optional overrides are the Progress panel's own seed (A-64): a stored skill was
// played in its own key and, for a song, in its own section, so both win over the browse
// state. A crafted or stale id in the record falls back to the browse defaults rather than
// seeding a key or a section the song does not have (T-04-15).
function seedPlayAlong(family, id, { keyPc = null, sectionId = '' } = {}) {
  if (family !== 'progression' && family !== 'song') return;
  if (family === 'progression' && !Object.hasOwn(progressionById, id)) return;
  if (family === 'song' && !Object.hasOwn(songById, id)) return;
  if (run) {
    if (run.phase !== 'result') return;
    backToBrowse();
  }
  // A free-choice play-along is never the session's block, whatever ran before it.
  pendingBlock = null;
  const storedKey = Number.isInteger(keyPc) && keyPc >= 0 && keyPc <= 11 ? keyPc : null;
  if (family === 'song') {
    const song = songById[id];
    const sections = Array.isArray(song.sections) ? song.sections : [];
    const stored = sections.find(entry => entry && entry.id === sectionId) || null;
    // The browse bar's section comes from `drills.sectionAtBar`: the browse grid renders each
    // section once, so it walks unit bars and can never seed a different section from the one
    // the player was looking at (CR-03, D-59/A-55).
    const section = stored || sectionAtBar(song, settings.barIndex, song.keyPc);
    save({
      drillFamily: family,
      songId: id,
      songSectionId: section ? section.id : '',
      keyPc: storedKey === null ? (Number.isInteger(song.keyPc) ? song.keyPc : settings.keyPc) : storedKey,
      bpm: song.defaultBpm,
      loopBars: 0,
      sectionLoop: false,
      tab: 'scales',
    });
    focusDrillStage();
    return;
  }
  const prog = progressionById[id];
  const patch = {
    drillFamily: family,
    progressionId: id,
    keyPc: settings.keyPc,
    bpm: prog.defaultBpm || 80,
    loopBars: 0,
    sectionLoop: false,
    tab: 'scales',
  };
  // The browse seed keeps the player's current key; a stored skill restores the key the pass
  // was played in, so `Progression · I–IV–V in C` practises in C (A-64).
  if (storedKey !== null) patch.keyPc = storedKey;
  save(patch);
  focusDrillStage();
}

// The seed's shared tail: close every panel, switch to the stage's tab, bring the stage into
// view, hand focus to `Start drill` and say what to do next. It never dispatches a START, so
// every browse `Play` is a seed and never a run (D-59), and it clears the block marker first so
// a free-choice pass is never credited to the session block that is `now` (D-73).
function focusDrillStage() {
  pendingBlock = null;
  closeAllPanels();
  renderAll({ forceScene: true });
  renderDrillState();
  const stage = $('transportBar');
  const still = !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (stage && typeof stage.scrollIntoView === 'function') {
    stage.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
  }
  $('startDrill').focus();
  panels.setFeedback('Ready — press Start drill.');
}

// The weakest stored pair is the first row of the plane's own ordering (D-49); no pair
// recorded means no seed, and the result never offers the button in that case.
function practiseWeakestPair() {
  const row = weakestPair(store.getProgress(), { limit: 1 })[0];
  if (!row) return;
  seedPair(row.pairId);
}

function exportBackup() {
  try {
    const now = Date.now();
    const doc = exportDoc(store.record(), { now });
    const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `t2coach-backup-${dayKey(now)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setBackup('', '');
  } catch (e) {
    setBackup(EXPORT_FAILED, 'danger');
  }
}

async function importFile(file) {
  // A new selection always starts clean: cancelling the picker or choosing another
  // file must never leave an older parsed document armed (WR-11).
  pendingImport = null;
  panels.showImportConfirm(false);
  if (!file) return;
  panels.setImportBusy(true);
  try {
    if (Number.isFinite(file.size) && file.size > 1024 * 1024) {
      pendingImport = null;
      panels.showImportConfirm(false);
      setBackup(IMPORT_MESSAGE.oversized, 'danger');
      return;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(await file.text());
    } catch (e) {
      parsed = null;
    }
    const result = parsed === null
      ? { ok: false, reason: 'corrupt' }
      : validateBackup(parsed, { validateSettings });
    if (!result.ok) {
      pendingImport = null;
      panels.showImportConfirm(false);
      setBackup(IMPORT_MESSAGE[result.reason] || IMPORT_MESSAGE.corrupt, 'danger');
      return;
    }
    pendingImport = result.doc;
    setBackup('', '');
    panels.showImportConfirm(true);
  } finally {
    panels.setImportBusy(false);
  }
}

function confirmImport() {
  if (!pendingImport) return;
  const previousSettings = settings;
  const previousProgress = progress;
  settings = store.replaceAll(pendingImport);
  pendingImport = null;
  panels.showImportConfirm(false);
  progress = store.getProgress();
  if (store.status === 'writeFailed') {
    settings = previousSettings;
    progress = previousProgress;
    setBackup(STORAGE_MESSAGE.writeFailed, 'danger');
    return;
  }
  const skills = Object.keys(progress.skills).length;
  const sessions = progress.sessions.length;
  // The previous result hero described the replaced progress; never keep it stale.
  resultSkill = null;
  renderAll({ forceScene: true });
  renderDrillState();
  panels.setProgressPanel(progressView());
  setBackup(`Imported. ${countText(skills, 'skill', 'skills')} and ${countText(sessions, 'session', 'sessions')}.`, 'ok');
  panels.announce(`Import complete. ${countText(skills, 'skill', 'skills')} and ${countText(sessions, 'session', 'sessions')}.`);
  panels.focusProgressHead();
}

function cancelImport() {
  pendingImport = null;
  panels.showImportConfirm(false);
  setBackup('', '');
}

// ---------- The daily session (05-01, D-68/D-69/D-70) ----------
// The planner imports nothing, so this is the one place the curated tables become the bundle it
// reads: five ready-made settings patches, each family's curated id order for D-70's final
// tiebreak, and one own-key predicate per family. A record naming an id this build no longer
// ships fails its predicate, and that block is skipped instead of seeding a stage that cannot
// resolve it (T-05-01).
function curatedBundle() {
  const scale = SCALES[0];
  const pair = CHORD_PAIRS[0];
  const progression = PROGRESSIONS[0];
  const song = SONGS[0];
  const ownsKey = value => Number.isInteger(value) && value >= 0 && value <= 11;
  const ownsScale = patch => {
    const entry = ownEntry(scaleById, patch.scaleId);
    if (!entry || !ownsKey(patch.keyPc)) return false;
    if (patch.positionId === 'all') return true;
    return positionsForScale(patch.keyPc, entry).some(position => position.id === patch.positionId);
  };
  const ownsSong = patch => {
    const entry = ownEntry(songById, patch.songId);
    if (!entry || !ownsKey(patch.keyPc)) return false;
    const sections = Array.isArray(entry.sections) ? entry.sections : [];
    return patch.songSectionId === '' || sections.some(section => section.id === patch.songSectionId);
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
      scaleRun: patch => ownsScale(patch),
      findNote: patch => ownsScale(patch),
      chordChanges: patch => Object.hasOwn(chordPairById, patch.chordPairId),
      progression: patch => Object.hasOwn(progressionById, patch.progressionId) && ownsKey(patch.keyPc),
      song: patch => ownsSong(patch),
    },
  };
}

// The planner's exact input shape, derived from the same view the panel reads, so the plan and
// the panel can never disagree about what is due.
function sessionInputs() {
  const view = progressView();
  return {
    due: view.allDue,
    skills: view.all,
    pairs: view.allChordPairs,
    defaults: settings,
    curated: curatedBundle(),
    hasHistory: view.all.length > 0,
    now: view.now,
  };
}

function sessionView() {
  return {
    state: session.state,
    plan: session.plan || previewPlan,
    blockIndex: session.blockIndex,
    completed: session.completed,
    skipped: session.skipped,
    skillsTouched: session.skillsTouched,
    minutesMs: session.minutesMs,
    unguidedMs: session.unguidedMs,
    dueCount: progressView().dueCount,
  };
}

function openSession() {
  if (!store || isRunning() || (run && run.phase === 'passReview')) return;
  if (calibration) closeCalibration({ focus: false });
  // The plan is rebuilt from the store on every open, but only while the session is idle: once a
  // session has started, `session.plan` is frozen and the five reasons cannot move under the
  // player (A-84, Pitfall 4).
  if (session.state === 'idle') previewPlan = buildSessionPlan(sessionInputs());
  panels.setSessionPanel(sessionView());
  // The panel opens on the view and the filter the player stored, so a free-choice player never
  // lands on `Plan` again and the Practise lists are painted before they are looked at (D-73).
  panels.setPractiseView(practiseView());
  panels.setSessionView({ view: settings.sessionView, filter: settings.practiseFilter });
  panels.setSessionOpen(true);
  panels.focusSessionHead();
}

// Hiding the panel is not ending the session: the plan stays frozen and the block keeps running.
// Closing a finished session is a `CLOSE` through the reducer, so the summary's tiles and its
// suggestion are thrown away with it and the next open rebuilds the plan from the store.
function closeSession() {
  if (session.state === 'summary') {
    const { state, effects } = sessionReduce(session, { type: 'CLOSE' });
    session = state;
    panels.setSessionSummary({ visible: false });
    applySessionEffects(effects);
    // The finished session is gone, so the boundary goes with it and the header chip returns to
    // the due count: the result panel is the drill's again, exactly as it was before the session.
    renderDrillState();
  }
  panels.setSessionOpen(false);
  panels.focusSessionToggle();
}

// One press: the plan is written into the session first so the reducer's START has something to
// mark, then the reducer and its effects do the rest through the one start path.
function startSession() {
  if (session.state !== 'idle') return;
  if (!previewPlan) previewPlan = buildSessionPlan(sessionInputs());
  session = { ...session, plan: previewPlan };
  const { state, effects } = sessionReduce(session, { type: 'START', now: Date.now() });
  session = state;
  applySessionEffects(effects);
}

// ---------- The Practise view (05-01 Task 3, D-73) ----------
// One row per family, carrying the item the seed would actually load: the stored ids where they
// resolve and the same curated fallbacks the seeds use where they do not, so the line a player
// reads is the drill they get.
function practiseFamilyRows() {
  const scale = ownEntry(scaleById, settings.scaleId) ? settings.scaleId : SCALES[0].id;
  const pair = ownEntry(chordPairById, settings.chordPairId) ? settings.chordPairId : CHORD_PAIRS[0].id;
  const progression = ownEntry(progressionById, settings.progressionId) ? settings.progressionId : PROGRESSIONS[0].id;
  const song = ownEntry(songById, settings.songId) ? settings.songId : SONGS[0].id;
  return FAMILY_ORDER.map(family => ({
    family,
    bpm: settings.bpm,
    target: {
      scaleId: scale,
      keyPc: settings.keyPc,
      positionId: settings.positionId,
      quizQuestion: settings.quizQuestion,
      quizMode: settings.quizMode,
      chordPairId: pair,
      progressionId: progression,
      songId: song,
      songSectionId: settings.songSectionId,
    },
  }));
}

// The Practise view's one view model: five family rows, every due row and the five weakest pairs.
// The two lists are the Progress panel's own rows, never a second table of what is due (F7).
function practiseView() {
  const view = progressView();
  return {
    families: practiseFamilyRows(),
    due: view.allDue,
    pairs: view.chordPairs,
    view: settings.sessionView,
    filter: settings.practiseFilter,
    now: view.now,
  };
}

// The panel's two remembered preferences, written once each and repainted from the store, so the
// view and the filter a player leaves are the ones they return to (D-73).
function onSessionView(view) {
  if (view !== 'plan' && view !== 'practise') return;
  save({ sessionView: view });
  panels.setPractiseView(practiseView());
}

function onPractiseFilter(filter) {
  if (filter !== 'due' && filter !== 'pairs') return;
  save({ practiseFilter: filter });
  panels.setPractiseView(practiseView());
}

// The Practise view's one seed for the two note families: the family is the choice and the current
// settings are the item, so it saves the family and hands the stage its usual tail. The three item
// families route to the seeds that already exist, and none of them starts a pass (D-73).
function seedFamily(family) {
  if (!DRILL_FAMILIES.includes(family)) return;
  if (family === 'chordChanges') {
    seedPair(settings.chordPairId);
    return;
  }
  if (family === 'progression') {
    seedPlayAlong('progression', ownEntry(progressionById, settings.progressionId) ? settings.progressionId : PROGRESSIONS[0].id);
    return;
  }
  if (family === 'song') {
    const songId = ownEntry(songById, settings.songId) ? settings.songId : SONGS[0].id;
    seedPlayAlong('song', songId, { keyPc: settings.keyPc, sectionId: settings.songSectionId });
    return;
  }
  if (run) {
    if (run.phase !== 'result') return;
    backToBrowse();
  }
  save({ drillFamily: family, tab: 'scales' });
  focusDrillStage();
}

// The strip's own `Next drill`: the item the recommendation named, seeded through the same three
// paths the Practise view uses. It never starts a pass and never touches the plan.
function seedNextItem() {
  const item = nextItemFor();
  if (!item) return;
  if (item.skillId) {
    practiseSkill(item.skillId);
    return;
  }
  const target = item.target && typeof item.target === 'object' ? item.target : {};
  if (item.kind === 'chordChanges') {
    seedPair(typeof target.pairId === 'string' ? target.pairId : settings.chordPairId);
    return;
  }
  if (item.kind === 'progression') {
    seedPlayAlong('progression', ownEntry(progressionById, target.progressionId) ? target.progressionId : settings.progressionId);
    return;
  }
  if (item.kind === 'song') {
    seedPlayAlong('song', ownEntry(songById, target.songId) ? target.songId : SONGS[0].id, {
      keyPc: Number.isInteger(target.keyPc) ? target.keyPc : null,
      sectionId: typeof target.songSectionId === 'string' ? target.songSectionId : '',
    });
    return;
  }
  seedFamily(item.kind);
}

// The four boundary verbs, one event each: the reducer owns what the boundary does and every
// effect it returns is applied here. `now` is passed in because the reducer never reads a clock,
// and `suggestion` is the same progress view the panel reads — never a score this module invents.
function dispatchSession(event) {
  const { state, effects } = sessionReduce(session, {
    ...event,
    now: Date.now(),
    suggestion: sessionSuggestionInput(),
  });
  session = state;
  applySessionEffects(effects);
}

function sessionNextBlock() { dispatchSession({ type: 'CONTINUE' }); }
function sessionSkip() { dispatchSession({ type: 'SKIP' }); }
function sessionEnd() { dispatchSession({ type: 'END' }); }

// `Repeat` at a block result is the recommendation's own owner (accent rule 9), so it has to
// deliver the tempo the strip named and then re-arm the block through the reducer — a repeat that
// only restarted the drill would run at the old tempo and credit nothing (WR-01). Both repeat
// controls call this one function.
function sessionRepeat() {
  applyRecommendedTempo();
  dispatchSession({ type: 'REPEAT' });
}

// The one `+BPM` write (A-77, T-05-08): the tempo the strip named goes into the one settings
// record before the chart is built, so `chartFor()` reads exactly the number a typed tempo would
// and no second tempo control exists. A `repeat` recommendation names no tempo, so it writes
// nothing; so does a tempo the record already holds.
function applyRecommendedTempo() {
  const recommendation = currentRecommendation();
  if (!recommendation || recommendation.key !== 'bpm') return;
  const tempo = recommendation.bpm;
  if (!(tempo > 0) || tempo === settings.bpm) return;
  save({ bpm: tempo });
  panels.setTempoValue(tempo);
}

// The summary's one next suggestion reads the plane, never a plan — but it names the skill the
// session actually ran. The focus block's own row is the one the planner picked and the one whose
// date the sentence is about; `allDue[0]` is only that row by construction at plan time and is
// usually a different skill by the end of the pass, which is how the old form ended up naming
// whichever row was most overdue (WR-06). A focus that came from a pair or a fallback carries no
// skill id, and then the weakest-pair sentence is the honest one.
function sessionSuggestionInput() {
  const view = progressView();
  const block = session.plan && Array.isArray(session.plan.blocks) ? session.plan.blocks[1] : null;
  const values = block && block.reasonKey === 'due' && block.reasonValues && typeof block.reasonValues === 'object'
    ? block.reasonValues
    : null;
  const skillId = values && typeof values.skillId === 'string' ? values.skillId : '';
  const all = Array.isArray(view.all) ? view.all : [];
  const focus = skillId ? all.find(row => row && row.skillId === skillId) || null : null;
  return {
    focusDueAt: focus && Number.isFinite(focus.dueAt) ? focus.dueAt : null,
    pairs: view.allChordPairs,
    now: view.now,
  };
}

// ---------- The after-rep recommendation (05-01 Task 3, D-74) ----------
// The session's next item, in the approved order: its next pending block while a session runs,
// else the first due row, else the weakest pair, else nothing. The recommendation reads it; it
// never invents one, and a free-choice drill is never a block.
function nextItemFor() {
  if (session.state === 'running' && session.plan) {
    const next = session.plan.blocks.find(block => block.state === 'pending');
    if (next) return { kind: next.family || 'scaleRun', skillId: '', target: next.target || {} };
  }
  const view = progressView();
  const due = view.allDue.length ? view.allDue[0] : null;
  if (due) return { kind: due.kind, skillId: due.skillId, target: due.content || {} };
  const pair = view.allChordPairs.length ? view.allChordPairs[0] : null;
  if (pair) return { kind: 'chordChanges', skillId: '', target: { pairId: pair.pairId } };
  return null;
}

// The strip's `Suggested next: {item}.` label. A due row names itself through the one skill label
// formatter; a block or a pair names the item its own patch would load, through the same
// Practise-view formatter, so the sentence and the row can never describe one item two ways.
function nextItemLabel(item) {
  if (!item) return '';
  if (item.skillId) return skillLabelText(item.target, item.kind);
  return practiseItemText({ family: item.kind, target: item.target, bpm: settings.bpm });
}

// The block's own recorded time so far: the passes of *this* run, which is the same number
// `BLOCK_DONE` credits — never wall-clock (T-05-04). A repeated block starts a new run, so this
// deliberately under-counts and `stop` needs a genuinely long block.
function blockElapsedMs(state = run) {
  const passes = state && Array.isArray(state.passes) ? state.passes : [];
  return passes.reduce((sum, pass) => sum + (Number.isFinite(pass && pass.activeMs) ? Math.max(0, pass.activeMs) : 0), 0);
}

// The one recommendation input, derived from the live run and the frozen plan: the pass that just
// closed, the boundary's phase, the chart's own timed flag and tempo, the engine's next tempo, the
// now-block and its recorded time, and the session's next item.
function currentRecommendation() {
  if (!run || (run.phase !== 'passReview' && run.phase !== 'result')) return null;
  const passes = Array.isArray(run.passes) ? run.passes : [];
  const block = session.state === 'running' && session.plan && session.plan.blocks[session.blockIndex]
    ? session.plan.blocks[session.blockIndex]
    : null;
  return suggestionFor({
    pass: passes.length ? passes[passes.length - 1] : null,
    phase: run.phase,
    timed: !(run.chart && run.chart.timed === false),
    bpm: run.chart && Number.isFinite(run.chart.bpm) ? run.chart.bpm : settings.bpm,
    nextBpm: tempoSuggestion(run).bpm,
    stoppedEarly: !!run.stoppedEarly,
    block,
    elapsedMs: blockElapsedMs(run),
    nextItem: nextItemFor(),
  });
}

// The boundary's single fill, named by the recommendation: `Next block` when the session says
// continue, `Repeat` when it says repeat at this tempo, and no owner at all for `stop`.
function recommendationAccentKey(recommendation) {
  if (!recommendation) return 'next';
  if (recommendation.key === 'repeat' || recommendation.key === 'bpm') return 'repeat';
  if (recommendation.key === 'next') return 'next';
  return 'stop';
}

// One place hands the recommendation to the panel: the sentence, the one optional button, the
// relabelled continue button and the single fill all come from `panels.setRecommendation`, so no
// other function moves the accent.
function applyRecommendation(recommendation = currentRecommendation()) {
  if (!recommendation || !run) {
    panels.setRecommendation({ phase: 'idle', running: session.state === 'running' });
    return null;
  }
  panels.setRecommendation({
    phase: run.phase,
    key: recommendation.key,
    nextLabel: nextItemLabel(recommendation.nextItem),
    bpm: recommendation.bpm,
    running: session.state === 'running',
    // The boundary is drawn for a session block's result and for nothing else (WR-05): it is what
    // suppresses the strip's own `Next drill`, and a pass review inside a block draws none.
    boundary: run.phase === 'result' && session.state === 'running',
  });
  return recommendation;
}

// The session's end: five tiles from the recorded passes, one honest next suggestion and the
// panel opening itself. The announcement is the reducer's own `announce` effect — this function
// never speaks, so a finished session is heard exactly once (05-UI-SPEC "Screen-reader contract").
function openSessionSummary() {
  const view = progressView();
  panels.setSessionSummary({
    visible: true,
    summary: sessionSummaryOf(session, { streak: view.streak && Number.isFinite(view.streak.current) ? view.streak.current : 0 }),
    nextText: panels.sessionNextText({
      key: session.nextSuggestionKey,
      values: session.nextSuggestionValues,
    }),
  });
  panels.setSessionOpen(true);
  // Scrolling is the browser's own and never animated when motion is reduced; focus lands on the
  // summary's heading so a screen reader reads the panel from its own title.
  const panel = $('sessionPanel');
  const still = !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (panel && typeof panel.scrollIntoView === 'function') {
    panel.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
  }
  panels.focusSessionHead();
}

// One arm per effect type. `seedAndStart` is the block launch, `announce` is the single live
// region and `openPanelAndAnnounce` is the summary opening itself. The caller always reassigns
// `session` from the reducer's own state before this runs.
function applySessionEffects(effects) {
  for (const effect of effects) {
    if (!effect || typeof effect !== 'object') continue;
    if (effect.type === 'seedAndStart') seedBlock(effect.block);
    else if (effect.type === 'announce') {
      const text = panels.sessionAnnouncementText({ key: effect.key, values: effect.values });
      if (text) panels.announce(text);
    } else if (effect.type === 'openPanelAndAnnounce') openSessionSummary();
  }
}

// The block boundary is the drill's own result sentence with `Block n of 5 done.` in front of it,
// in the one live region — never a second announcement and never a second region (D-72).
function sessionBoundaryPrefix(key) {
  if (pendingBlock === null || session.state !== 'running') return '';
  if (key !== 'result-complete' && key !== 'result-stopped') return '';
  const text = panels.sessionAnnouncementText({
    key: 'session-boundary',
    values: { index: pendingBlock + 1, total: SESSION_BLOCKS.length },
  });
  return text ? `${text} ` : '';
}

// The only place a session block starts. One validated settings patch, then the one start path —
// and nothing awaited before `startDrill()`, because the transient activation from this click is
// what lets `startAudio()` resume the context (Pitfall 3). It never reuses `focusDrillStage()`,
// which clears the block marker this function has just set, and it never dispatches a START of
// its own.
async function seedBlock(block) {
  const target = block && typeof block === 'object' ? block.target : null;
  if (!target || typeof target !== 'object') {
    pendingBlock = null;
    return false;
  }
  pendingBlock = Number.isInteger(block.index) ? block.index : 0;
  save(target);
  renderAll({ forceScene: true });
  renderDrillState();
  panels.setSessionOpen(false);
  await startDrill({ recall: block.kind === 'recall' || block.reasonKey === 'due' });
  return true;
}

async function startDrill({ recall = false } = {}) {
  if (tunerActive || !$('tunerCard').hidden) stopTuner();
  if (isRunning() || startingDrill) return;
  startingDrill = true;
  try {
    if (calibration) closeCalibration({ focus: false });
    const ready = await startAudio();
    if (!ready) {
      buildChart({ recall });
      run = createRun(chart);
      dispatch({ type: 'START_FAILED', reason: 'audio', at: nowMs(), wallAt: Date.now() });
      panels.setFeedback(AUDIO_START_FAILED);
      panels.announce(AUDIO_START_FAILED);
      return;
    }
    audio.setSound(settings.sound);
    updateDrone();
    // The mic never gates a drill: a denied or unavailable device leaves the pass unscored
    // and `armMicIfWanted` never throws (MIC-03, D-51).
    armMicIfWanted();
    buildChart({ recall });
    run = createRun(chart);
    resultSkill = null;
    flashFeedbackUntilBeat = 0;
    // The seed's `Ready — press Start drill.` has done its job the moment the pass starts.
    panels.setFeedback('');
    dispatch({ type: 'START', at: nowMs(), wallAt: Date.now() });
  } finally { startingDrill = false; }
}

async function resumeDrill() {
  if (!run || run.phase !== 'paused') return;
  const ready = await startAudio();
  if (!ready) {
    panels.setFeedback(AUDIO_START_FAILED);
    panels.announce(AUDIO_START_FAILED);
    return;
  }
  audio.setSound(settings.sound);
  updateDrone();
  dispatch({ type: 'RESUME', at: nowMs(), wallAt: Date.now() });
}

// Restart is visible from the audio-failure pause, so it must retry the context in
// the same gesture rather than schedule into a still-suspended one (WR-06).
async function restartDrill() {
  if (!run) return;
  const ready = await startAudio();
  if (!ready) {
    panels.setFeedback(AUDIO_START_FAILED);
    panels.announce(AUDIO_START_FAILED);
    return;
  }
  dispatch({ type: 'RESTART', at: nowMs(), wallAt: Date.now() });
}

function pauseDrill(reason) {
  if (!run || (run.phase !== 'countIn' && run.phase !== 'active')) return;
  // A wait-mode pass has no transport beat to read; the question simply freezes.
  if (run.chart.timed === false) {
    dispatch({ type: 'PAUSE', reason, beat: 0 });
    panels.setFeedback('');
    return;
  }
  const position = transport.position();
  // The transport keeps counting after it self-stops, so a visibility or audio
  // event can land past the last step. Finish rather than pause outside the chart,
  // and never record a beat past the final step (WR-02).
  if (position.phase === 'finished' && run.phase === 'active') {
    dispatch({ type: 'FINISH', at: nowMs(), wallAt: Date.now() });
    panels.setFeedback('');
    return;
  }
  const lastBeat = Math.max(0, run.chart.totalBeats - 1);
  dispatch({ type: 'PAUSE', reason, beat: Math.max(0, Math.min(position.beat, lastBeat)) });
  panels.setFeedback('');
}

function backToBrowse() {
  transport.stop();
  // Leaving the drill is a stop path: the stream is torn down with the transport.
  closeMicWindow();
  stopMic();
  run = null;
  chart = null;
  resultSkill = null;
  // A run that ended outside the reducer leaves no block to credit.
  pendingBlock = null;
  applyAudioMix();
  // The browse view is painted first and the stage second: an idle play-along's stage paints
  // bar 1's chord over the scale the browse view just drew, so the reverse order would leave
  // the scale on the board (WR-02).
  renderAll({ forceScene: true });
  renderDrillState();
}

function onTransport(action) {
  if (action === 'start') return startDrill();
  if (action === 'recall') return startDrill({ recall: true });
  if (action === 'repeat') {
    // A-77/T-05-08: at a result the continue button is where `+BPM` is delivered. The tempo the
    // strip named is written to the one settings record before the chart is built, so `chartFor()`
    // reads exactly the number a typed tempo would and no second tempo control exists.
    // At a session block's result the same button is the boundary's own `Repeat`, so it goes
    // through the reducer and the repeated pass is credited to the block it belongs to (WR-01).
    if (run && run.phase === 'result' && session.state === 'running') return sessionRepeat();
    applyRecommendedTempo();
    return startDrill();
  }
  if (action === 'resume') return resumeDrill();
  if (action === 'pause') return pauseDrill('user');
  if (action === 'restart') return restartDrill();
  if (action === 'stop') return dispatch({ type: 'STOP', at: nowMs(), wallAt: Date.now() });
  if (action === 'next') return nextPass();
  if (action === 'end') return endDrill();
  if (action === 'back') return backToBrowse();
}

// A-38/CHORD-05: the boundary pre-fill and the reason it states, derived from the pass
// that just ended and the engine's own decision — never from a UI guess. A clean pass
// earns +4, two consecutive failed passes cost 4, and everything else holds. The four
// approved forms name exactly those cases; a single shaky report holds and uses the hold
// form, because a fifth sentence would break the approved copy.
const TEMPO_STEP = 4;
function tempoSuggestion(state = run) {
  const current = state && state.chart && Number.isFinite(state.chart.bpm) ? state.chart.bpm : settings.bpm;
  const passes = state && Array.isArray(state.passes) ? state.passes : [];
  const last = passes.length ? passes[passes.length - 1] : null;
  if (last && last.selfReport === 'clean') {
    return { bpm: clamp(current + TEMPO_STEP, 30, 240), reasonKey: 'clean' };
  }
  const decision = state ? state.pendingDecision : null;
  const failed = !!decision && (decision.reasonKey === 'demote'
    || (decision.reasonKey === 'holdFail'
      && Number.isFinite(decision.failStreak)
      && decision.failStreak >= FADE.failedPassesToDemote));
  if (failed) return { bpm: clamp(current - TEMPO_STEP, 30, 240), reasonKey: 'failed' };
  return { bpm: current, reasonKey: 'skipped' };
}

function nextPass() {
  if (!run || run.phase !== 'passReview') return;
  // A-38: the number the player sees in the tempo box is the number the next rep runs
  // at. The reducer clamps it and rebuilds the pass; settings follows the chart so the
  // beat pulse, the sink and every later rep share one tempo.
  const requested = Number($('bpm').value);
  // A play-along's window, item and key are chosen at the boundary, so its next pass is
  // rebuilt through the same `chartFor()` Start drill uses and handed to the reducer
  // wholesale: a `Loop` change made at the pass review reaches the next pass (Open
  // Question 4). Every Phase 1-3 family keeps the tempo-only event.
  const rebuilt = run.chart && (PLAY_FAMILIES.has(run.chart.family) || run.chart.family === 'findNote') ? chartFor() : null;
  dispatch({ type: 'NEXT_PASS', bpm: requested, chart: rebuilt, at: nowMs(), wallAt: Date.now() });
  if (!run) return;
  if (Number.isFinite(run.chart.bpm) && run.chart.bpm !== settings.bpm) {
    save({ bpm: run.chart.bpm });
    panels.setTempoValue(run.chart.bpm);
  }
  if (run.phase !== 'countIn' && run.phase !== 'active') return;
  if (run.hintLevel === FADE.recallLevel) {
    // The recall is the emotional peak: one sentence, no score, no praise. A wait-mode
    // pass has no tempo to name.
    panels.announce(run.chart.timed === false
      ? 'Recall pass. No lights.'
      : `Recall pass. No lights, ${run.chart.bpm} BPM.`);
    return;
  }
  if (run.levelChange) {
    // One announcement per boundary, after the reducer applied the decision.
    panels.announce(hintAnnouncementText({
      levelChange: run.levelChange,
      streaks: streaksFor(run),
      levelNames: HINT_LEVELS.map(level => level.name),
    }));
  }
}

function onHint() {
  if (!run || (run.phase !== 'countIn' && run.phase !== 'active')) return;
  if (run.hintLevel === 2) {
    dispatch({ type: 'FLASH', beat: transport.position().beat });
    flashFeedbackUntilBeat = run.flashUntilBeat;
    panels.setFeedback('Full pattern shown once — back to anchors.');
    return;
  }
  if (run.hintLevel === 1 || run.hintLevel === 3) {
    // Nothing about the pass changes until the player confirms; no transport effect.
    panels.openHintConfirm({ fromLevel: run.hintLevel, toLevel: Math.max(0, run.hintLevel - 1) });
  }
}

function confirmHint() {
  if (!run || (run.phase !== 'countIn' && run.phase !== 'active')) return;
  const level = run.hintLevel;
  panels.setHintBusy(true);
  panels.closeHintConfirm();
  panels.setFeedback('');
  dispatch({ type: 'ABORT_PASS', at: nowMs(), beat: transport.position().beat });
  panels.setHintBusy(false);
  // The new pass starts in count-in: Pause is the next sensible action.
  if (run && run.hintLevel < level) panels.focusPause();
}

function cancelHint() {
  panels.closeHintConfirm();
  panels.focusHint(run ? run.hintLevel : 0);
}

function endDrill() {
  if (!run || run.phase !== 'passReview') return;
  dispatch({ type: 'END_DRILL', at: nowMs(), wallAt: Date.now() });
}

function onTempo(value) {
  if (isRunning()) return;
  const bpm = clamp(Math.round(Number(value) || settings.bpm), 30, 240);
  save({ bpm });
  panels.setTempoValue(bpm);
}

function onTap(now) {
  if (isRunning()) return;
  const result = tapTempo(tapTimes, now);
  tapTimes = result.taps;
  if (result.preview !== null) panels.setTapPreview(`Tap · ${result.preview} BPM`);
  if (result.commit !== null) {
    onTempo(result.commit);
    panels.setTapPreview(`Tap · ${result.commit} BPM`);
    tapTimes = [];
  }
  if (tapPreviewTimer) clearTimeout(tapPreviewTimer);
  tapPreviewTimer = setTimeout(() => panels.setTapPreview(''), 3000);
}

function onSelfReport(value) {
  if (!run) return;
  if (run.phase === 'result') {
    dispatch({ type: 'SELF_REPORT', clean: value === 'clean' || value === 'corrected', corrected: value === 'corrected' });
    // Re-upsert the same sessionId and re-render so the hero and the No-lights card
    // flip in the same pass; the session count and with-hints counts stay put.
    const summary = recordResult();
    renderDrillState();
    panels.announce(summary.mastered ? (resultSkill && resultSkill.retainedAt && summary.assessment && summary.assessment.coldRecall ? 'Retained on a later independent check.' : 'Recalled today.') : 'Not recalled cleanly yet.');
    return;
  }
  if (run.phase !== 'passReview') return;
  dispatch({ type: 'SELF_REPORT', clean: value === 'clean' || value === 'corrected', corrected: value === 'corrected' });
}

// One requestAnimationFrame loop: TICK on the integer beat, FINISH once, progress and
// beat pulse from the audio clock, LED scene at the sink's own 15 Hz cap.
function loop() {
  requestAnimationFrame(loop);
  // The lock follows the world, not the transport, so it is derived here — before the early
  // return — and a tab switch or a result with no run left can never leave the screen awake.
  syncWakeLock();
  if (!run || !transport) return;
  // The listening window follows the pass frame by frame; `mic.state` is the only truth,
  // so no flag in this module, `panels` or `run` can disagree with the open stream.
  syncMicWindow();
  spotTick();
  if (run.phase === 'active') flushChordOnset();
  if (run.phase !== 'countIn' && run.phase !== 'active') return;
  // A wait-mode chart holds no transport segment, so the transport's stale position is
  // never read: the scene comes from the open question and progress from answered ones.
  if (run.chart.timed === false) {
    const still = { beat: 0, phase: 'active' };
    sink.tick(drillSceneAt(still).scene, 0, settings.bpm);
    panels.setProgress(progressFor(still));
    return;
  }
  const position = transport.position();
  if (position.phase === 'finished') {
    dispatch({ type: 'FINISH', at: nowMs(), wallAt: Date.now() });
    return;
  }
  if (Math.floor(position.beat) !== Math.floor(run.beat) || position.phase !== run.phase) {
    dispatch({ type: 'TICK', beat: position.beat });
    return;
  }
  const { scene } = drillSceneAt(position);
  sink.tick(scene, position.beat, run.chart.bpm);
  panels.setProgress(progressFor(position));
  // The meter is the chart's, not the shell's: the dots, `Beat n of N` and the count-in all
  // read the transport's own 1-based beat-in-bar and the chart's beats per bar (Pattern 5).
  panels.renderBeat(position.beat, position.phase, run.chart.bpm, {
    beatsPerBar: run.chart.beatsPerBar,
    beatInBar: position.beatInBar,
  });
  // Clear the one-flash sentence exactly once, when its beat window closes.
  if (flashFeedbackUntilBeat && position.beat >= flashFeedbackUntilBeat) {
    flashFeedbackUntilBeat = 0;
    panels.setFeedback('');
  }
}

// ---------- Browse wiring ----------
// `system` leaves the attribute in place for the CSS media query; the other two values win
// over the OS. Applying before the shell is revealed avoids a light flash for a dark choice.
function applyTheme(theme) {
  const value = THEMES.includes(theme) ? theme : 'system';
  document.documentElement.dataset.theme = value;
}

function applyTab(tab) {
  if (!TABS.includes(tab)) return;
  if (calibration) closeCalibration({ focus: false });
  const hadRun = !!run;
  // A tab switch replaces the stage's subject, so no earlier block marker may survive it.
  pendingBlock = null;
  if (hadRun) {
    transport.stop();
    closeMicWindow();
    stopMic();
    run = null;
    chart = null;
    // A tab switch re-derives both planes after the run is gone, so it can never leave the
    // band ducked behind a chart nobody is playing (F3).
    applyAudioMix();
  }
  const patch = { tab };
  if (tab === 'songs' && !songById[settings.songId]) {
    patch.songId = SONGS[0].id;
    patch.barIndex = 0;
  }
  save(patch);
  renderAll({ forceScene: hadRun });
  renderDrillState();
}

function applyStageMode(on, feedback = false) {
  if (board) board.setLabelsVisible(!on);
  $('appShell').classList.toggle('stage-mode', !!on);
  panels.setStageMode(!!on);
  if (feedback) {
    panels.setFeedback(on
      ? 'Stage mode on — all note cues hidden.'
      : 'Stage mode off — note cues are back.');
  }
}

function applyChange(field, value) {
  // A display preference is never a drill control: it works in every phase and must
  // not touch run.hintLevel or the LED scene.
  if (field === 'theme') {
    if (!THEMES.includes(value)) return;
    save({ theme: value });
    applyTheme(settings.theme);
    return;
  }
  if (field === 'stageMode') {
    save({ stageMode: !!value });
    applyStageMode(settings.stageMode, true);
    return;
  }
  // D-42 and A-34: the family picker and the two quiz selects are stage controls. They
  // are inert while a pass is live or awaiting its boundary decision.
  if (field === 'drillFamily' || field === 'quizQuestion' || field === 'quizMode') {
    if (isRunning() || (run && run.phase === 'passReview')) return;
    if (field === 'drillFamily') {
      // One list: the validator's own export, so the picker, `validateSettings` and this
      // guard can never disagree about which families may switch the stage.
      if (!DRILL_FAMILIES.includes(value)) return;
      // Switching family discards the run and the chart, never settings or progress.
      transport.stop();
      run = null;
      chart = null;
      resultSkill = null;
      pendingBlock = null;
      applyAudioMix();
      save({ drillFamily: value });
      renderAll({ forceScene: true });
      renderDrillState();
      return;
    }
    const patch = { [field]: value };
    if (field === 'quizMode' && value === 'name' && settings.quizQuestion === 'interval') patch.quizQuestion = 'note';
    save(patch);
    if (!run || run.phase === 'result') renderAll();
    renderDrillState();
    return;
  }
  if (isRunning() && ['keyPc', 'scaleId', 'positionId', 'direction', 'bpm', 'tab'].includes(field)) return;
  const patch = { [field]: value };
  if (field === 'keyPc') patch.keyPc = ((value % 12) + 12) % 12;
  // Finger numbers need a position box to be meaningful. Choosing the mode from Whole neck
  // selects the first box in the same write, so the labels and the Position select agree.
  if (field === 'labels' && value === 'fingers' && !isRunning() && settings.positionId === 'all') {
    const scaleDef = SCALE_BY_ID[settings.scaleId] || SCALE_BY_ID.major;
    const first = positionsForScale(settings.keyPc, scaleDef)[0];
    if (first) patch.positionId = first.id;
  }
  // Keep the chosen practice box across a key change by box index: the id is
  // key-absolute, so re-validating the old id alone would silently drop it (WR-01).
  if (field === 'keyPc' && settings.positionId !== 'all') {
    const scaleDef = SCALE_BY_ID[settings.scaleId] || SCALE_BY_ID.major;
    patch.positionId = remapPosition(settings.positionId, settings.keyPc, patch.keyPc, scaleDef);
  }
  if (field === 'scaleId') patch.positionId = 'all';
  if (field === 'chordId') {
    const family = chordById[value];
    if (family) patch.voicingId = family.voicings[0].id;
  }
  if (field === 'progressionId' || field === 'songId') patch.barIndex = 0;
  // A-56: picking a song seeds the one `keyPc` plane with that song's own key once — a
  // visible, reversible default rather than a lock, because the Key select writes the same
  // plane and a later key change is the player's. The bar index is reset above, so the
  // section the browse chart shows is the section `Play` will seed.
  if (field === 'songId') {
    const song = ownEntry(songById, value);
    if (song && Number.isInteger(song.keyPc) && song.keyPc >= 0 && song.keyPc <= 11) patch.keyPc = song.keyPc;
  }
  save(patch);
  if (field === 'sound') {
    if (audio) audio.setSound(settings.sound);
    return;
  }
  if (field === 'drone') {
    updateDrone();
    return;
  }
  if (field === 'keyPc' && settings.drone) updateDrone();
  if (run && run.phase !== 'idle' && run.phase !== 'result') {
    if (field === 'labels' && (run.phase === 'countIn' || run.phase === 'active')) renderDrillFrame(transport.position());
    return;
  }
  if (run && run.phase === 'result') {
    renderDrillState();
    return;
  }
  renderAll();
  renderDrillState();
}

function applyBar(index) {
  save({ barIndex: index });
  renderAll();
}

// ---------- The Backing cluster (04-02 Task 3, D-55/D-66) ----------
// Three controls, one truth. `Intensity` is the preset and the only bulk writer of the four
// stems: one write, one render. A hand toggle writes exactly one boolean and leaves the
// select's stored value alone, so the player's own trim is never re-derived (A-58). Both
// paths re-derive the mix, so a toggle is audible within the one 20 ms ramp.
function onIntensity(value) {
  const stems = INTENSITY_STEMS[value];
  if (!stems) return;
  save({ intensity: value, ...stems });
  applyAudioMix();
  renderDrillState();
}

function onStem(key, checked) {
  if (!STEM_KEYS.includes(key)) return;
  save({ [key]: !!checked });
  applyAudioMix();
  renderDrillState();
}

// A-68/Open Question 4: `Loop` is live at idle, the pass review and the result and locked
// while the pass is running, so a window change always lands on the next pass. The new
// window reaches the chart through `chartFor()` (and `NEXT_PASS`'s rebuilt chart), and the
// skill id never moves with it (D-64).
function onLoop(value) {
  if (!LOOP_BARS.includes(value)) return;
  save({ loopBars: value });
  if (run && (run.phase === 'countIn' || run.phase === 'active' || run.phase === 'paused')) return;
  renderAll();
  renderDrillState();
}

// ---------- The song's section plane (04-03 Task 2, A-57) ----------
// `Section loop` repeats the chosen section once more inside the pass and never re-keys it
// (D-64), so it is live wherever `Loop` is: idle, the pass review and the result. A change
// mid-pass is impossible (the control is disabled) and would be ignored here anyway.
function onSectionLoop(checked) {
  if (isRunning()) return;
  save({ sectionLoop: !!checked });
  renderAll();
  renderDrillState();
}

// `Section` is the chart's identity — `song:{id}:{section}:{keyPc}` — so it is writable at
// idle only and a value that is not one of the chosen song's own sections is dropped by
// `validateSettings` on the way into the record (A-57, T-04-15).
function onSection(id) {
  if (run && run.phase !== 'idle') return;
  if (typeof id !== 'string' || !id) return;
  save({ songSectionId: id });
  renderAll();
  renderDrillState();
}

function wireGuitar() {
  sink = createLedSink({
    send: frame => guitar.send(frame),
    isConnected: () => !!(guitar && guitar.writeChar),
    now: () => (globalThis.performance ? globalThis.performance.now() : Date.now()),
  });
  sink.setEnabled(settings.lightsOn);

  guitar = createGuitar({
    onConnection: on => {
      connected = on;
      if (!on) battery = null;
      // The lock follows the guitar as well as the pass, and this runs before the disconnect
      // branch returns: a dropped guitar can never leave the screen awake (D-77, T-05-13).
      syncWakeLock();
      $('conn').classList.toggle('on', on);
      $('connectBtn').classList.toggle('on', on);
      $('connectBtn').textContent = on ? 'Disconnect' : 'Connect guitar';
      panels.setStatus(on ? 'Connected · battery —' : 'Guitar not connected');
      panels.announce(on ? 'Guitar connected.' : 'Guitar disconnected.');
      if (!on) {
        if (run && (run.phase === 'countIn' || run.phase === 'active')) pauseDrill('ble');
        // A drop while already paused must still refresh pauseReconnect/pauseBanner
        // with disconnected:true, or the reconnect hint never appears (WR-03).
        else renderDrillState();
        return;
      }
      sink.reset();
      if (!run || run.phase === 'idle') {
        pushScene();
      } else if (run.phase === 'countIn' || run.phase === 'active') {
        const position = transport.position();
        sink.tick(drillSceneAt(position).scene, position.beat, settings.bpm);
      } else if (run.phase === 'paused') {
        const phase = run.pausedBeat < run.chart.countInBeats ? 'countIn' : 'active';
        const position = { phase, beat: run.pausedBeat, activeStartBeat: run.activeStartBeat };
        sink.tick(drillSceneAt(position).scene, run.pausedBeat, settings.bpm);
      } else if (run.phase === 'passReview' || run.phase === 'result') {
        // A reconnect after a boundary must reassert zero, never the previous pass.
        sink.reset();
        sink.tick(sceneFromNotes([]), 0, settings.bpm);
      }
      // A result keeps the LEDs off; the zero frame was already sent.
      renderDrillState();
    },
    onBattery: pct => {
      battery = pct;
      if (connected) panels.setStatus(`Connected · battery ${battery}%`);
    },
    onError: message => { panels.setStatus(message); panels.announce(message); },
  });

  $('connectBtn').addEventListener('click', async () => {
    if (guitar.writeChar) return guitar.disconnect();
    panels.setStatus('Connecting…');
    $('connectBtn').disabled = true;
    $('connectBtn').setAttribute('aria-busy', 'true');
    try {
      await guitar.connect();
    } catch (e) {
      const message = e.name === 'NotFoundError'
        ? 'No guitar selected. Press Connect guitar and choose your T2 — close the official Poputar app first.'
        : `Could not connect: ${e.message}. Close the official Poputar app, keep the guitar awake, then try again.`;
      panels.setStatus(message);
      panels.announce(message);
    } finally {
      $('connectBtn').disabled = false;
      $('connectBtn').removeAttribute('aria-busy');
    }
  });
}

export function boot() {
  try {
    store = createSettingsStore(globalThis.localStorage, {
      scaleById, chordById, progressionById, songById, positionsForScale,
    });
  } catch (e) { return; }
  settings = { ...store.load() };
  if (!TABS.includes(settings.tab)) settings.tab = 'scales';
  applyTheme(settings.theme);
  progress = store.getProgress();

  panels = createPanels({
    onChange: applyChange,
    onTab: applyTab,
    onBar: applyBar,
    onTransport,
    onTempo,
    onTap,
    onSelfReport,
    onBack: backToBrowse,
    onStageMode: value => applyChange('stageMode', value),
    onHint,
    onHintConfirm: confirmHint,
    onHintCancel: cancelHint,
    onFamily,
    onAnswer: answer => commitAnswer('chip', answer),
    onReveal,
    onNextQuestion,
    onRecallReport: onSelfReport,
    onProgressOpen: openProgress,
    onProgressClose: closeProgress,
    onSession: openSession,
    onSessionClose: closeSession,
    onSessionStart: startSession,
    onSessionNext: sessionNextBlock,
    onSessionSkip: sessionSkip,
    onSessionRepeat: sessionRepeat,
    onSessionEnd: sessionEnd,
    onSessionView,
    onPractiseFilter,
    onPractiseFamily: seedFamily,
    onPractiseDueRow: practiseSkill,
    onPractisePairRow: practisePair,
    onNextDrill: seedNextItem,
    onPractiseSkill: practiseSkill,
    onPractisePair: practisePair,
    onPractiseWeakestPair: practiseWeakestPair,
    onPlay: seedPlayAlong,
    onIntensity,
    onStem,
    onLoop,
    onSection,
    onSectionLoop,
    onExport: exportBackup,
    onImportFile: importFile,
    onImportConfirm: confirmImport,
    onImportCancel: cancelImport,
    onImportReset: () => { pendingImport = null; },
    onMarkChange,
    onMarkHit,
    onPairChange,
    onMicToggle,
    onCalibrate,
    onCalibrationTap: () => { if (addTap() !== null) panels.flashCalibrationTap(); },
    onCalibrationSkip: () => closeCalibration({ announceSkip: true }),
    onCalibrationDone: () => closeCalibration(),
    onCalibrationAgain: () => startCalibration(),
    onLearn: openLesson,
    onLessonClose: closeLesson,
    onLessonStart: startGuidedLesson,
    onPowerChord: openPowerChordLesson,
    onStartHere: startHere,
    onLessonListen: listenLesson,
    onTunerStart: startTuner,
    onTunerStop: stopTuner,
    onPowerPractice: practicePowerChords,
    onPath: openPathStep,
    onLessonSection: openLessonSection,
  });
  board = createFretboard({ board: $('board'), onAudition: audition });
  panels.setLights(settings.lightsOn);
  applyStageMode(settings.stageMode);
  // The cluster reads the stored preference before any gesture has opened a stream.
  syncMicChip();
  // The preflight runs exactly once, here, from API presence alone: no prompt, no timer and no
  // re-run. A missing capability is the word `unsupported`, never an error or a disabled control.
  panels.setCapabilities(readCapabilities());
  wakeLock = createWakeLock({ onState: () => syncWakeNote() });
  syncWakeNote();
  // Boot derives both planes once, so the stems start at their stored levels and no path
  // can inherit the graph's construction default with a stale preset (04-01 Task 3).
  applyAudioMix();
  transport = createTransport(null, {
    schedule: (event, time) => {
      if (!audio) return;
      // Every voice lands on the scheduler's own `time`, never `0` and never
      // `ctx.currentTime`: a lookahead event must sound on the frame the transport asked
      // for, or the band drifts behind the click (04-01's one lookahead).
      if (event.type === 'click') audio.click(time, event.accent);
      else if (event.type === 'kick') audio.kick(time);
      else if (event.type === 'snare') audio.snare(time);
      else if (event.type === 'hat') audio.hat(time);
      else if (event.type === 'bass') audio.bass(event.midi, time, backingSeconds(event.durBeats));
      else if (event.type === 'pad') audio.pad(event.midis, time, backingSeconds(event.durBeats));
      // The reference pluck is the answer: while a window is listening the app stays
      // silent on the note, so the score cannot come from its own output (T-03-14).
      // A pass that is being scored never plays the answer, including the step the
      // lookahead scheduled before the window opened (D-47, T-03-14, WR-06).
      else if (event.type === 'pluck' && !passMicArmed && run.hintLevel < FADE.recallLevel) audio.pluck(event.midi, time);
    },
    timer: browserTimer,
    now: () => (ctx ? ctx.currentTime : 0),
  });
  wireGuitar();
  const headerMore = $('headerMore');
  if (headerMore) {
    headerMore.addEventListener('click', event => {
      if (event.target.closest('.more-menu button')) headerMore.open = false;
    });
    document.addEventListener('click', event => {
      if (headerMore.open && !headerMore.contains(event.target)) headerMore.open = false;
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') headerMore.open = false;
    });
  }

  $('lightsBtn').addEventListener('click', () => {
    save({ lightsOn: !settings.lightsOn });
    sink.setEnabled(settings.lightsOn);
    panels.setLights(settings.lightsOn);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    pauseDrill('hidden');
    // The stream does not outlive the visible tab: the browser's own mic indicator must
    // disappear with the pause (T-03-12).
    stopMic();
  });
  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('pagehide', () => { stopMic(); });
  }
  // The shell and the four lesson clips are same-origin assets. The worker caches them on
  // install so the app that has loaded once keeps working offline, videos included. Registration
  // is best-effort: a browser without service workers still runs the whole app.
  if (typeof navigator !== 'undefined' && navigator.serviceWorker
    && typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  renderAll();
  panels.setFeedback('');
  renderDrillState();
  // A repaired or unreadable record must be visible where the player first looks,
  // not only behind the Progress panel (WR-08).
  if (store.status === 'readFailed') {
    panels.setFeedback(STORAGE_MESSAGE.readFailed);
    panels.announce(STORAGE_MESSAGE.readFailed);
  }
  $('appShell').hidden = false;
  const bootError = $('bootError');
  if (bootError) bootError.remove();
  requestAnimationFrame(loop);
  return { store, get settings() { return settings; }, render: renderAll };
}

function reportBootError(error) {
  if (globalThis.console && typeof console.error === 'function') {
    console.error('Guitar Coach failed to start', error);
  }
  const detail = document.getElementById('bootErrorDetail');
  if (!detail) return;
  detail.hidden = false;
  detail.textContent = error && error.message
    ? `Startup error: ${error.message}`
    : 'The app failed to start. Clear the cache and reload.';
}

if (typeof document !== 'undefined') {
  try { boot(); } catch (error) { reportBootError(error); }
}
