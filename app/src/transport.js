// ---------- Transport (one audio clock) ----------
// The 25 ms timer only wakes the scheduler; every musical time is an audio time
// computed from the injected AudioContext clock. `schedule` is the only audio seam.
export const LOOKAHEAD_SEC = 0.10;
export const LEAD_SEC = 0.05;
export const TICK_MS = 25;

export function secondsPerBeat(bpm) { return 60 / bpm; }

export function beatToTime(beat, startTime, bpm) {
  return startTime + beat * secondsPerBeat(bpm);
}

export function timeToBeat(time, startTime, bpm) {
  return (time - startTime) / secondsPerBeat(bpm);
}

// Events due before now + horizon, in chart order. The caller advances the cursor.
export function dueEvents(events, cursor, startTime, bpm, now, horizonSec) {
  const horizon = now + horizonSec;
  const due = [];
  let i = cursor;
  while (i < events.length && beatToTime(events[i].beat, startTime, bpm) < horizon) {
    due.push({ event: events[i], time: beatToTime(events[i].beat, startTime, bpm) });
    i++;
  }
  return { due, cursor: i };
}

// One bar of 4/4 count-in before `fromBeat`, then every chart event at or after it.
// A resume at bar 3 (fromBeat 12) schedules count-in beats 8-11 and active at 12.
export function buildSegment(chart, { fromBeat, countInBeats = 4 } = {}) {
  const active = fromBeat === undefined || fromBeat === null ? chart.countInBeats : fromBeat;
  const start = active - countInBeats;
  const events = [];
  for (let b = start; b < active; b++) {
    events.push({ beat: b, type: 'click', accent: b === start });
  }
  for (const e of chart.audioEvents || []) {
    if (e.beat >= active) events.push(e);
  }
  return {
    events,
    activeStartBeat: active,
    segmentStartBeat: start,
    totalBeats: chart.totalBeats,
    bpm: chart.bpm,
    beatsPerBar: chart.beatsPerBar || 4,
    countInBeats,
  };
}

// taps: performance.now() values. Preview after two taps, commit the median of
// four or more, reset after a gap, clamp to 30-240 BPM as an integer.
export function tapTempo(taps, now, { resetMs = 3000, min = 30, max = 240 } = {}) {
  const recent = taps.length && now - taps[taps.length - 1] > resetMs ? [] : taps.slice(-8);
  const next = [...recent, now];
  const intervals = next.slice(1).map((t, i) => t - next[i]);
  let median = null;
  if (intervals.length) {
    const sorted = [...intervals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  const mean = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null;
  const preview = mean ? Math.round(60000 / mean) : null;
  const commit = next.length >= 4 && median ? Math.round(60000 / median) : null;
  const clamp = value => (value === null ? null : Math.min(max, Math.max(min, value)));
  return {
    taps: next,
    preview: clamp(preview),
    commit: clamp(commit),
  };
}

// ---------- Adapter ----------
// `ctx` owns the clock; `schedule(event, time)` plays the sound, `timer` is a
// { setInterval, clearInterval } pair and `now` returns audio time. `startTime` is
// the audio time of chart beat 0, so a segment may start in a later bar.
export function createTransport(ctx, { schedule = () => {}, timer = globalThis, now = null } = {}) {
  const clock = now || (() => (ctx ? ctx.currentTime : 0));
  let segment = null;
  let startTime = 0;
  let cursor = 0;
  let running = false;
  let paused = false;
  let frozenBeat = 0;
  let handle = null;
  let bpm = 70;
  let countInBeats = 4;
  let beatsPerBar = 4;

  function clearTimer() {
    if (handle === null) return;
    timer.clearInterval(handle);
    handle = null;
  }

  function beatAt(time) {
    if (!segment) return 0;
    return Math.max(segment.segmentStartBeat, timeToBeat(time, startTime, bpm));
  }

  function positionAt(time) {
    const beat = paused ? frozenBeat : beatAt(time);
    const activeStartBeat = segment ? segment.activeStartBeat : 0;
    const segmentStartBeat = segment ? segment.segmentStartBeat : 0;
    const totalBeats = segment ? segment.totalBeats : 0;
    const phase = !segment ? 'countIn'
      : beat >= totalBeats ? 'finished'
      : beat < activeStartBeat ? 'countIn'
      : 'active';
    const bar = Math.max(1, Math.floor((beat - countInBeats) / beatsPerBar) + 1);
    const beatInBar = ((Math.floor(beat - segmentStartBeat) % beatsPerBar) + beatsPerBar) % beatsPerBar + 1;
    return { beat, phase, bar, beatInBar, activeStartBeat, paused };
  }

  function scheduleDue(time) {
    if (!segment || !running) return;
    const result = dueEvents(segment.events, cursor, startTime, bpm, time, LOOKAHEAD_SEC);
    cursor = result.cursor;
    for (const item of result.due) schedule(item.event, item.time);
    if (positionAt(time).phase === 'finished') {
      running = false;
      clearTimer();
    }
  }

  function start(nextSegment) {
    clearTimer();
    segment = nextSegment;
    bpm = segment.bpm;
    beatsPerBar = segment.beatsPerBar || 4;
    countInBeats = segment.countInBeats === undefined
      ? segment.activeStartBeat - segment.segmentStartBeat
      : segment.countInBeats;
    startTime = clock() + LEAD_SEC - segment.segmentStartBeat * secondsPerBeat(bpm);
    cursor = 0;
    paused = false;
    running = true;
    scheduleDue(clock());
    if (running) handle = timer.setInterval(() => scheduleDue(clock()), TICK_MS);
  }

  return {
    start,
    resume: start,
    pause() {
      if (!running || !segment) return;
      frozenBeat = beatAt(clock());
      paused = true;
      running = false;
      clearTimer();
    },
    stop() {
      clearTimer();
      segment = null;
      startTime = 0;
      cursor = 0;
      frozenBeat = 0;
      running = false;
      paused = false;
    },
    pumpAt(time) {
      scheduleDue(time);
    },
    position() {
      return positionAt(clock());
    },
    get running() { return running; },
    get paused() { return paused; },
  };
}
