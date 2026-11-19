// ---------- Pure scoring maths (tier 0) ----------
// This module imports nothing: no DOM, no Web Audio, no clock, no randomness, no console.
// Every time value arrives as an argument in audio milliseconds, so the whole scorer is
// deterministic and runs under `node --test` with no browser. `mic.js` owns the device;
// this file only decides what the frames and events mean (D-46).

export const SCORE = {
  pollMs: 25,
  rmsWindow: 1024,
  windowMs: 250,
  earlyMs: 120,
  pitchStreak: 2,
  barEarlyMs: 60,
  barLateMs: 300,
  refractoryMs: 90,
  minCalibrationTaps: 3,
  maxCalibrationMs: 250,
  strayTapMs: 500,
};

const finite = value => typeof value === 'number' && Number.isFinite(value);

// RMS of the last `size` samples of the analyser frame. An empty or non-array buffer
// reads 0 rather than NaN, so the onset gate always sees a number.
export function frameRms(buf, size = SCORE.rmsWindow) {
  if (!buf || typeof buf !== 'object' || typeof buf.length !== 'number') return 0;
  const length = buf.length;
  if (!length) return 0;
  const width = finite(size) && size > 0 ? Math.min(Math.floor(size), length) : length;
  let sum = 0;
  for (let i = length - width; i < length; i++) {
    const value = Number(buf[i]);
    if (Number.isFinite(value)) sum += value * value;
  }
  return Math.sqrt(sum / width);
}

// The onset state is a plain object so a caller can snapshot or reset it without a class.
// `floor` is the adaptive room-noise estimate; the gate never sinks below `threshold`.
export function createOnsetState({
  floor = 0.004, threshold = 0.012, ratio = 1.8, refractoryMs = SCORE.refractoryMs,
} = {}) {
  return {
    floor: finite(floor) && floor >= 0 ? floor : 0.004,
    threshold: finite(threshold) ? threshold : 0.012,
    ratio: finite(ratio) && ratio > 1 ? ratio : 1.8,
    refractoryMs: finite(refractoryMs) ? refractoryMs : SCORE.refractoryMs,
    prevRms: 0,
    lastOnsetMs: null,
  };
}

// One analyser poll, one verdict. An onset is a rising edge above `prevRms * ratio`
// that also clears the gate and the refractory window. The input state is never
// mutated: the caller adopts `state` from the result.
export function pushFrame(state, rms, atMs) {
  const previous = state && typeof state === 'object' ? state : createOnsetState();
  const level = finite(rms) && rms > 0 ? rms : 0;
  const at = finite(atMs) ? atMs : 0;
  const gate = Math.max(previous.threshold, previous.floor * 6);
  const rising = level > previous.prevRms * previous.ratio && level > gate;
  const cooled = previous.lastOnsetMs === null || at - previous.lastOnsetMs >= previous.refractoryMs;
  const onset = rising && cooled ? { atMs: at, rms: level } : null;
  // The floor drifts toward the observed signal but never sits above the current frame,
  // so a loud passage cannot leave the gate stranded above a quieter one.
  const floor = Math.min(level, previous.floor + (level - previous.floor) * 0.05);
  return {
    onset,
    state: {
      ...previous,
      floor,
      prevRms: level,
      lastOnsetMs: onset ? at : previous.lastOnsetMs,
    },
  };
}

// The lower-middle average for even counts, so the median is always one of the observed
// values for an odd count and never an invented one for an even count. `null` when empty.
export function median(values) {
  if (!Array.isArray(values) || !values.length) return null;
  const sorted = values.filter(finite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function pitchClassOf(midi) {
  if (!finite(midi)) return null;
  return ((midi % 12) + 12) % 12;
}

// A microphone answer needs two consecutive identical readings, on one note, after an
// onset armed the question (A2, WR-04). A ringing note from the previous answer cannot
// satisfy it because arming is reset on every answer/advance.
export function nextPitchStreak(state, midi, required = SCORE.pitchStreak) {
  const prev = state && typeof state === 'object' ? state : {};
  if (!finite(midi)) return { midi: null, count: 0, hit: false };
  const count = midi === prev.midi && Number.isInteger(prev.count) ? prev.count + 1 : 1;
  return { midi, count, hit: count >= required };
}

const expectedMsOf = (step, bpm) => (
  step && finite(step.beat) && finite(bpm) && bpm > 0 ? (step.beat * 60000) / bpm : null
);

const targetMidiOf = step => (step && step.target && finite(step.target.midi) ? step.target.midi : null);

// Pitch and timing for a timed pass. Every step is planned; an event credits at most one
// step, and the single cursor walks events and steps together so a two-second sustain can
// credit one note only and a note is never counted twice (D-46).
// `null` is the only "no reading" value: `accuracy` is null when nothing was planned, and
// `timing.medianMs` is null when nothing was hit — never 0 as an unmeasured sentinel.
export function scoreSteps(events, steps, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const bpm = finite(opts.bpm) && opts.bpm > 0 ? opts.bpm : 0;
  const calibrationMs = finite(opts.calibrationMs) ? opts.calibrationMs : 0;
  const windowMs = finite(opts.windowMs) ? opts.windowMs : SCORE.windowMs;
  const earlyMs = finite(opts.earlyMs) ? opts.earlyMs : SCORE.earlyMs;
  const stepList = Array.isArray(steps) ? steps : [];
  const allEvents = Array.isArray(events) ? events : [];
  const onsets = allEvents.filter(event => event && event.type === 'onset').length;
  const ordered = allEvents
    .filter(event => event && finite(event.atMs))
    .sort((a, b) => a.atMs - b.atMs);

  const perStep = stepList.map((step, index) => ({
    index,
    beat: step && finite(step.beat) ? step.beat : null,
    expectedMs: expectedMsOf(step, bpm),
    hit: false,
    offsetMs: null,
  }));

  const offsets = [];
  let hits = 0;
  let cursor = 0;
  let attackMs = null;
  let lastMidi = null;
  let consumed = false;

  for (const event of ordered) {
    if (cursor >= perStep.length) break;
    if (event.type === 'onset') { attackMs = event.atMs; consumed = false; continue; }
    if (event.type !== 'pitch' || !finite(event.midi)) continue;
    // A new pitch can be a legato transition; identical polls are the same sustain.
    if (event.midi !== lastMidi) {
      consumed = false;
      if (lastMidi !== null && (attackMs === null || event.atMs - attackMs > 150)) attackMs = null;
      lastMidi = event.midi;
    }
    if (consumed) continue;
    const observedMs = (attackMs !== null && event.atMs - attackMs <= 150 ? attackMs : event.atMs) - calibrationMs;
    // Skip the steps this event has already passed: events are time-ordered, so the
    // walk only ever moves forward and a step is credited at most once.
    while (cursor < perStep.length) {
      const slot = perStep[cursor];
      if (slot.expectedMs === null) { cursor++; continue; }
      if (observedMs > slot.expectedMs + windowMs) { cursor++; continue; }
      break;
    }
    if (cursor >= perStep.length) break;
    const slot = perStep[cursor];
    if (observedMs < slot.expectedMs - earlyMs) continue;
    if (event.type !== 'pitch') continue;
    const target = targetMidiOf(stepList[cursor]);
    const heard = Math.round(event.midi);
    if (target === null || heard === null || heard !== target) continue;
    // Timing alone cannot distinguish a click from a player on the beat. Exact MIDI
    // catches octave errors; the metronome is unpitched and reference plucks are muted.
    consumed = true;
    slot.hit = true;
    slot.offsetMs = observedMs - slot.expectedMs;
    offsets.push(slot.offsetMs);
    hits++;
    cursor++;
  }

  return {
    onsets,
    hits,
    planned: perStep.length,
    accuracy: perStep.length ? hits / perStep.length : null,
    timing: {
      medianMs: offsets.length ? median(offsets) : null,
      meanAbsMs: offsets.length ? offsets.reduce((sum, ms) => sum + Math.abs(ms), 0) / offsets.length : null,
      onTimeRate: offsets.length ? offsets.filter(ms => Math.abs(ms) <= 120).length / offsets.length : null,
    },
    perStep,
  };
}

// One calibrated window assignment for both live changes and the final score.
export function barForOnset(atMs, { barSpanMs, bars, calibrationMs = 0 } = {}) {
  if (!finite(atMs) || !finite(barSpanMs) || barSpanMs <= 0 || !Number.isInteger(bars) || bars <= 0) return null;
  const corrected = atMs - calibrationMs;
  const bar = Math.round(corrected / barSpanMs);
  if (bar < 0 || bar >= bars) return null;
  const offset = corrected - bar * barSpanMs;
  return offset >= -SCORE.barEarlyMs && offset <= SCORE.barLateMs ? bar : null;
}

// Chord changes: one onset per bar inside the change window counts that bar, and the
// expected root is compared against the first named pitch at or after that onset inside the
// same window. The onset itself carries no pitch (the adapter emits the onset first and its
// pitch for the same frame at the same timestamp), so reading `event.midi` off the onset
// would leave every root unread; and a chord left ringing must not claim the next bar, so
// only an onset may count one (CR-03, Pitfall 4). Chord quality is never judged.
export function scoreBars(events, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const barSpanMs = finite(opts.barSpanMs) && opts.barSpanMs > 0 ? opts.barSpanMs : 0;
  const barCount = Number.isInteger(opts.bars) && opts.bars > 0 ? opts.bars : 0;
  const calibrationMs = finite(opts.calibrationMs) ? opts.calibrationMs : 0;
  const expectedRoots = Array.isArray(opts.expectedRoots) ? opts.expectedRoots : [];
  const allEvents = Array.isArray(events) ? events : [];
  const onsets = allEvents.filter(event => event && event.type === 'onset').length;
  const perBar = Array.from({ length: barCount }, (_, bar) => ({
    bar, atMs: null, counted: false, root: null, onPitch: null,
  }));
  let counted = 0;
  let rootsOnPitch = 0;
  let rootsChecked = 0;

  if (barCount && barSpanMs) {
    const taken = new Set();
    const ordered = allEvents
      .filter(event => event && event.type === 'onset' && finite(event.atMs))
      .sort((a, b) => a.atMs - b.atMs);
    const pitches = allEvents
      .filter(event => event && event.type === 'pitch' && finite(event.atMs))
      .sort((a, b) => a.atMs - b.atMs);
    for (const event of ordered) {
      const observedMs = event.atMs - calibrationMs;
      const bar = barForOnset(event.atMs, { barSpanMs, bars: barCount, calibrationMs });
      if (bar !== null && !taken.has(bar)) {
        const barStartMs = bar * barSpanMs;
        taken.add(bar);
        const expected = expectedRoots[bar];
        // A root the chart cannot supply is not a check. The root is the first named pitch
        // at or after this onset inside the window — never the onset's own, absent, midi.
        const root = finite(expected) ? pitchClassOf(expected) : null;
        const pitch = root === null ? null : pitches.find(candidate => (
          candidate.atMs - calibrationMs >= observedMs
          && candidate.atMs - calibrationMs <= barStartMs + SCORE.barLateMs
        ));
        const heard = pitchClassOf(pitch ? pitch.midi : null);
        const onPitch = root !== null && heard !== null && heard === root;
        perBar[bar] = { bar, atMs: observedMs, counted: true, root, onPitch };
        counted++;
        // A root the mic cannot read confidently is not checked — never wrong.
        if (root !== null && heard !== null) {
          rootsChecked++;
          if (onPitch) rootsOnPitch++;
        }
      }
    }
  }

  return { onsets, counted, planned: barCount, rootsOnPitch, rootsChecked, perBar };
}

// Eight taps against eight clicks: drop the strays, demand three taps, take the median,
// warn above the working range and clamp the stored value to 0…maxCalibrationMs.
// `ok` means "a usable offset exists"; a large-but-usable median is saved with a warning.
export function calibrationOffset(samples) {
  const list = (Array.isArray(samples) ? samples : [])
    .filter(value => finite(value) && Math.abs(value) <= SCORE.strayTapMs);
  if (!list.length) return { ok: false, offsetMs: null, reason: 'none' };
  if (list.length < SCORE.minCalibrationTaps) return { ok: false, offsetMs: null, reason: 'tooFew' };
  const middle = median(list);
  const large = middle > SCORE.maxCalibrationMs;
  const offsetMs = Math.min(SCORE.maxCalibrationMs, Math.max(0, middle));
  return { ok: true, offsetMs, reason: large ? 'large' : null };
}

// The bridge between the two clocks: a `performance.now()` tap is placed on the audio
// clock through the context's output timestamp, never by comparing the two clocks
// directly (T-03-15). A missing or all-zero timestamp — the pair browsers return when
// they cannot report one — falls back to the context's own current time, so calibration
// still works in every browser the drills already support.
export function outputTimeMs(timestamp, perfNow, currentTime) {
  const at = finite(perfNow) ? perfNow : 0;
  const ts = timestamp && typeof timestamp === 'object' ? timestamp : null;
  const contextTime = ts && finite(ts.contextTime) ? ts.contextTime : 0;
  const performanceTime = ts && finite(ts.performanceTime) ? ts.performanceTime : 0;
  if (contextTime > 0 && performanceTime > 0) return contextTime * 1000 + (at - performanceTime);
  return finite(currentTime) && currentTime > 0 ? currentTime * 1000 : 0;
}

// One tap resolved against the click grid: the nearest click wins, so a tap 20 ms from a
// click is a sample and a tap 900 ms from one is not. `tapMs` is audio-clock milliseconds;
// `t0` (click zero) and `spb` (seconds per beat) are audio-clock seconds, because that is
// the unit `AudioContext.currentTime` uses. `null` means "not one of the eight clicks",
// never a zero offset.
export function tapOffsetMs(tapMs, t0, spb, { strayTapMs = SCORE.strayTapMs, clicks = 8 } = {}) {
  if (!finite(tapMs) || !finite(t0) || !finite(spb) || spb <= 0) return null;
  const count = Number.isInteger(clicks) && clicks > 0 ? clicks : 8;
  const index = Math.round((tapMs / 1000 - t0) / spb);
  if (index < 0 || index >= count) return null;
  const offsetMs = tapMs - (t0 + index * spb) * 1000;
  const stray = finite(strayTapMs) && strayTapMs > 0 ? strayTapMs : SCORE.strayTapMs;
  return Math.abs(offsetMs) > stray ? null : offsetMs;
}

// The unscored aggregator used by the families that produce onsets but no timing: same
// shape as `scoreSteps` so the result panel has one input, and `accuracy`/`timing` stay
// null so an unscored pass can never read as a zero.
export function scoreSummary(events, plan = {}, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const allEvents = Array.isArray(events) ? events : [];
  const onsets = allEvents.filter(event => event && event.type === 'onset').length;
  const steps = plan && Array.isArray(plan.steps) ? plan.steps.length : 0;
  const planned = finite(opts.planned) ? opts.planned
    : (steps || (plan && Number.isInteger(plan.bars) && plan.bars > 0 ? plan.bars : 0));
  return {
    onsets,
    hits: finite(opts.hits) ? opts.hits : onsets,
    planned,
    rootsOnPitch: finite(opts.rootsOnPitch) ? opts.rootsOnPitch : 0,
    rootsChecked: finite(opts.rootsChecked) ? opts.rootsChecked : 0,
    accuracy: null,
    timing: { medianMs: null, meanAbsMs: null, onTimeRate: null },
  };
}
