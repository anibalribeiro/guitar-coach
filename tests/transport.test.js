// Transport contract: one audio clock, lookahead scheduling, count-in segments and
// tap tempo. The five-minute simulation is the DRILL-04 proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOOKAHEAD_SEC, TICK_MS, secondsPerBeat, beatToTime, timeToBeat, dueEvents,
  buildSegment, tapTempo, createTransport,
} from '../app/src/transport.js';
import { backingEvents } from '../app/src/backing.js';
import { createFakeAudioContext, createFakeTimer } from './helpers/fakes.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

function clickChart({ beats = 401, bpm = 80 } = {}) {
  return {
    bpm,
    beatsPerBar: 4,
    countInBeats: 4,
    totalBeats: beats,
    audioEvents: Array.from({ length: beats }, (_, beat) => ({
      beat, type: 'click', accent: beat % 4 === 0,
    })),
  };
}

test('lookahead constants are the documented 25 ms tick and 100 ms horizon', () => {
  assert.equal(LOOKAHEAD_SEC, 0.10);
  assert.equal(TICK_MS, 25);
});

test('beat and time round-trip at 80 and 120 BPM', () => {
  assert.equal(secondsPerBeat(80), 0.75);
  assert.equal(secondsPerBeat(120), 0.5);
  close(beatToTime(4, 1.25, 80), 4.25);
  close(timeToBeat(4.25, 1.25, 80), 4);
  close(timeToBeat(beatToTime(13.5, 2, 120), 2, 120), 13.5);
});

test('count-in grid accents the first beat and active starts at fromBeat', () => {
  const chart = {
    bpm: 80, beatsPerBar: 4, countInBeats: 4, totalBeats: 8,
    audioEvents: [
      { beat: 4, type: 'click', accent: true },
      { beat: 4, type: 'pluck', midi: 40 },
      { beat: 5, type: 'click', accent: false },
    ],
  };
  const segment = buildSegment(chart, { fromBeat: 4 });
  assert.equal(segment.segmentStartBeat, 0);
  assert.equal(segment.activeStartBeat, 4);
  assert.equal(segment.totalBeats, 8);
  assert.deepEqual(segment.events.slice(0, 4).map(e => e.beat), [0, 1, 2, 3]);
  assert.deepEqual(segment.events.slice(0, 4).map(e => e.accent), [true, false, false, false]);
  assert.deepEqual(segment.events.slice(4).map(e => [e.beat, e.type]), [[4, 'click'], [4, 'pluck'], [5, 'click']]);
});

test('a resume segment counts in one bar before fromBeat and drops earlier chart events', () => {
  const segment = buildSegment(clickChart({ beats: 20 }), { fromBeat: 12 });
  assert.equal(segment.segmentStartBeat, 8);
  assert.equal(segment.activeStartBeat, 12);
  assert.deepEqual(segment.events.slice(0, 4).map(e => e.beat), [8, 9, 10, 11]);
  assert.deepEqual(segment.events.slice(0, 4).map(e => e.accent), [true, false, false, false]);
  assert.ok(segment.events.every(e => e.beat >= 8));
  assert.deepEqual(segment.events.slice(4, 10).map(e => e.beat), [12, 13, 14, 15, 16, 17]);
});

test('dueEvents returns ordered events inside the horizon and advances the cursor', () => {
  const events = [{ beat: 0 }, { beat: 1 }, { beat: 2 }, { beat: 3 }];
  const result = dueEvents(events, 0, 0, 60, 0.5, 1.5);
  assert.deepEqual(result.due.map(d => d.event.beat), [0, 1]);
  assert.deepEqual(result.due.map(d => d.time), [0, 1]);
  assert.equal(result.cursor, 2);
  const empty = dueEvents(events, 2, 0, 60, 0, 0.1);
  assert.deepEqual(empty.due, []);
  assert.equal(empty.cursor, 2);
});

test('tap tempo previews after two taps, commits the median of four, resets and clamps', () => {
  let taps = [];
  let result = tapTempo(taps, 0);
  assert.equal(result.preview, null);
  assert.equal(result.commit, null);
  taps = result.taps;

  result = tapTempo(taps, 500);
  assert.equal(result.preview, 120);
  assert.equal(result.commit, null);
  taps = result.taps;

  result = tapTempo(taps, 1000);
  assert.equal(result.commit, null);
  taps = result.taps;

  result = tapTempo(taps, 1500);
  assert.equal(result.commit, 120);

  // Irregular intervals use the median, not the mean.
  result = tapTempo([0, 500, 1000], 1600);
  assert.equal(result.commit, 120);

  // A gap longer than three seconds starts a new sequence.
  result = tapTempo([0, 500, 1000, 1500], 5000);
  assert.equal(result.preview, null);
  assert.equal(result.commit, null);
  assert.deepEqual(result.taps, [5000]);

  // 3000 ms interval clamps to 30 BPM; 200 ms clamps to 240 BPM.
  assert.equal(tapTempo([0], 3000).preview, 30);
  assert.equal(tapTempo([0, 200, 400], 600).commit, 240);
});

test('five-minute simulation schedules all 401 clicks exactly once with no gaps', () => {
  const chart = clickChart();
  const ctx = createFakeAudioContext();
  const timer = createFakeTimer();
  const scheduled = [];
  const transport = createTransport(ctx, {
    schedule: (event, time) => scheduled.push({ event, time }),
    timer,
    now: () => ctx.currentTime,
  });
  transport.start(buildSegment(chart, { fromBeat: 4 }));

  for (let i = 1; i <= 12000; i++) {
    ctx.currentTime = i * 0.025;
    transport.pumpAt(ctx.currentTime);
  }

  const clicks = scheduled.filter(x => x.event.type === 'click');
  assert.equal(clicks.length, 401, 'every beat 0..400 is scheduled exactly once');
  const beats = clicks.map(x => Math.round(timeToBeat(x.time, 0.05, 80)));
  assert.deepEqual(beats, [...Array(401).keys()]);
  for (let i = 1; i < beats.length; i++) assert.equal(beats[i] - beats[i - 1], 1, 'no gaps or duplicates');
  assert.equal(beats.at(-1), 400);
  close(timeToBeat(clicks.at(-1).time, 0.05, 80), 400);
  ctx.currentTime = 301;
  transport.pumpAt(301);
  assert.equal(timer.intervals.size, 0, 'the scheduler stops after the chart finishes');
});

test('a resume segment never re-schedules pre-pause events', () => {
  const chart = clickChart({ beats: 20 });
  const ctx = createFakeAudioContext();
  const scheduled = [];
  const transport = createTransport(ctx, {
    schedule: (event, time) => scheduled.push({ event, time }),
    timer: createFakeTimer(),
    now: () => ctx.currentTime,
  });
  transport.start(buildSegment(chart, { fromBeat: 12 }));
  for (let i = 1; i <= 600; i++) {
    ctx.currentTime = i * 0.025;
    transport.pumpAt(ctx.currentTime);
  }
  assert.ok(scheduled.length > 0);
  assert.ok(scheduled.every(x => x.event.beat >= 8));
  assert.equal(scheduled[0].event.beat, 8);
  close(scheduled[0].time, 0.05);
  assert.equal(scheduled.filter(x => x.event.beat < 12).length, 4, 'exactly one count-in bar');
});

test('createTransport schedules count-in clicks and first plucks at audio times', () => {
  const chart = clickChart({ beats: 8 });
  chart.audioEvents.push({ beat: 4, type: 'pluck', midi: 40 });
  chart.audioEvents.sort((a, b) => a.beat - b.beat);
  const ctx = createFakeAudioContext();
  const timer = createFakeTimer();
  const scheduled = [];
  const transport = createTransport(ctx, {
    schedule: (event, time) => scheduled.push({ event, time }),
    timer,
    now: () => ctx.currentTime,
  });

  transport.start(buildSegment(chart, { fromBeat: 4 }));
  assert.equal(timer.intervals.size, 1);
  assert.deepEqual(scheduled.map(x => [x.event.beat, x.event.type]), [[0, 'click']]);
  close(scheduled[0].time, 0.05);

  ctx.currentTime = 3.0;
  transport.pumpAt(3.0);
  const atFour = scheduled.filter(x => x.event.beat === 4);
  assert.deepEqual(atFour.map(x => x.event.type), ['click', 'pluck']);
  for (const item of atFour) close(item.time, 3.05);
});

test('position reports countIn, active and finished with bar and beatInBar', () => {
  const ctx = createFakeAudioContext();
  const transport = createTransport(ctx, { timer: createFakeTimer(), now: () => ctx.currentTime });
  transport.start(buildSegment(clickChart({ beats: 8 }), { fromBeat: 4 }));

  ctx.currentTime = 0.5;
  let pos = transport.position();
  assert.equal(pos.phase, 'countIn');
  assert.equal(pos.bar, 1);
  assert.equal(pos.beatInBar, 1);
  close(pos.beat, 0.6);

  ctx.currentTime = 3.3;
  pos = transport.position();
  assert.equal(pos.phase, 'active');
  assert.equal(pos.bar, 1);
  assert.equal(pos.beatInBar, 1);
  close(pos.beat, 4.333333333333333);

  ctx.currentTime = 6.05;
  pos = transport.position();
  assert.equal(pos.phase, 'finished');
  close(pos.beat, 8);
  assert.equal(pos.activeStartBeat, 4);
});

test('pause freezes the clock and stops scheduling; resume re-enters count-in', () => {
  const chart = clickChart({ beats: 20 });
  const ctx = createFakeAudioContext();
  const timer = createFakeTimer();
  const scheduled = [];
  const transport = createTransport(ctx, {
    schedule: (event, time) => scheduled.push({ event, time }),
    timer,
    now: () => ctx.currentTime,
  });

  transport.start(buildSegment(chart, { fromBeat: 4 }));
  ctx.currentTime = 3.3;
  const before = transport.position();
  transport.pause();
  assert.equal(timer.intervals.size, 0);
  const count = scheduled.length;
  ctx.currentTime = 10;
  transport.pumpAt(10);
  assert.equal(scheduled.length, count, 'pause schedules nothing');
  close(transport.position().beat, before.beat);

  transport.resume(buildSegment(chart, { fromBeat: 12 }));
  assert.equal(timer.intervals.size, 1);
  const first = scheduled[count];
  assert.equal(first.event.beat, 8);
  close(first.time, 10.05);
  assert.ok(scheduled.slice(count).every(x => x.event.beat >= 8));
});

// ---------- 04-01 Task 1: the generated band rides the one transport (PROG-02) ----------
// A twelve-bar chart at 80 BPM: 4 count-in beats, 12 pattern bars of 15 events and a 7-event
// ending bar. Nothing here is a second clock — the events are plain data the transport pumps.
function backingChart({ bars = 12, bpm = 80 } = {}) {
  const chords = Array.from({ length: bars }, (_, bar) => ({
    rootMidi: 40 + (bar % 4),
    padMidis: [52 + (bar % 4), 55 + (bar % 4), 59 + (bar % 4)],
  }));
  return {
    bpm,
    beatsPerBar: 4,
    countInBeats: 4,
    totalBeats: 4 + (bars + 1) * 4,
    audioEvents: backingEvents({ beatsPerBar: 4, countInBeats: 4, bars, chords }),
  };
}

test('a twelve-bar backing chart plays every event once at its own audio time', () => {
  const chart = backingChart();
  const ctx = createFakeAudioContext();
  const timer = createFakeTimer();
  const scheduled = [];
  const transport = createTransport(ctx, {
    schedule: (event, time) => scheduled.push({ event, time }),
    timer,
    now: () => ctx.currentTime,
  });
  transport.start(buildSegment(chart, { fromBeat: 4 }));

  for (let i = 1; i <= 12000; i++) {
    ctx.currentTime = i * 0.025;
    transport.pumpAt(ctx.currentTime);
  }

  // The transport's own count-in replaces the chart's four count-in clicks, so every chart
  // event from beat 4 on is played once and nothing is doubled.
  const chartEvents = chart.audioEvents.filter(e => e.beat >= 4);
  const counts = new Map();
  for (const item of scheduled) counts.set(item.event, (counts.get(item.event) || 0) + 1);
  assert.equal(scheduled.length, chartEvents.length + 4, 'one count-in bar plus every chart event');
  assert.ok([...counts.values()].every(count => count === 1), 'no event is scheduled twice');
  for (const event of chartEvents) {
    assert.equal(counts.get(event), 1, `${event.type} at beat ${event.beat} is scheduled exactly once`);
  }

  // Every item lands at its own beat on the audio clock, and time never runs backwards.
  for (const item of scheduled) close(item.time, beatToTime(item.event.beat, 0.05, 80));
  for (let i = 1; i < scheduled.length; i++) {
    assert.ok(scheduled[i].time >= scheduled[i - 1].time, `time went backwards at item ${i}`);
  }

  // The whole band reaches the scheduler, not just the click.
  assert.deepEqual([...new Set(scheduled.map(x => x.event.type))].sort(), ['bass', 'click', 'hat', 'kick', 'pad', 'snare']);
  const kicks = scheduled.filter(x => x.event.type === 'kick').map(x => Math.round(timeToBeat(x.time, 0.05, 80)));
  assert.deepEqual(kicks.slice(0, 4), [4, 6, 8, 10], 'kick on beats 1 and 3 of the first bar');
  assert.equal(kicks.at(-1), 4 + 12 * 4, 'the ending bar gets the last kick');
  close(scheduled.at(-1).time, beatToTime(4 + 13 * 4 - 1, 0.05, 80));
  assert.equal(timer.intervals.size, 0, 'the scheduler stops after the ending bar');
});

test('a paused and resumed backing pass re-schedules no chart event', () => {
  const chart = backingChart();
  const ctx = createFakeAudioContext();
  const scheduled = [];
  const transport = createTransport(ctx, {
    schedule: (event, time) => scheduled.push({ event, time }),
    timer: createFakeTimer(),
    now: () => ctx.currentTime,
  });

  transport.start(buildSegment(chart, { fromBeat: 4 }));
  for (let i = 1; i <= 400; i++) {
    ctx.currentTime = i * 0.025;
    transport.pumpAt(ctx.currentTime);
  }
  transport.pause();
  const beforePause = scheduled.length;
  assert.ok(beforePause > 0, 'the first segment played something');

  // Resume at bar 6 (beat 24): one count-in bar, then everything from the bar line on.
  transport.resume(buildSegment(chart, { fromBeat: 24 }));
  for (let i = 401; i <= 12000; i++) {
    ctx.currentTime = i * 0.025;
    transport.pumpAt(ctx.currentTime);
  }

  const resumed = scheduled.slice(beforePause);
  assert.equal(resumed[0].event.beat, 20, 'the resume counts in one bar before the bar-6 downbeat');
  close(resumed[0].time, 10.05);
  assert.equal(resumed.filter(x => x.event.beat < 24).length, 4, 'exactly one count-in bar');
  assert.deepEqual([...new Set(resumed.filter(x => x.event.beat < 24).map(x => x.event.beat))], [20, 21, 22, 23]);
  assert.deepEqual(resumed.filter(x => x.event.beat < 20), [], 'nothing from before the count-in bar');

  const times = resumed.map(x => x.time);
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'the resumed segment never runs backwards');

  // Each chart event object reaches the scheduler exactly once across the pause cycle, and
  // every event from the resume point on is played.
  const counts = new Map();
  for (const item of scheduled) counts.set(item.event, (counts.get(item.event) || 0) + 1);
  assert.ok([...counts.values()].every(count => count === 1), 'no chart event is scheduled twice');
  for (const event of chart.audioEvents.filter(e => e.beat >= 24)) {
    assert.equal(counts.get(event), 1, `${event.type} at beat ${event.beat} survives the resume`);
  }
});

// 04-02 Task 2: the transport is already meter-aware, so a 3/4 chart must count three and
// cycle its beat in bar 1-3 with no production change to this module.
test('a 3/4 chart counts in three beats and beatInBar cycles 1-3, never 4', () => {
  const chart = {
    bpm: 80,
    beatsPerBar: 3,
    countInBeats: 3,
    totalBeats: 12,
    audioEvents: Array.from({ length: 12 }, (_, beat) => ({ beat, type: 'click', accent: beat % 3 === 0 })),
  };
  // `main` hands `buildSegment` the chart's own count-in, so a 3/4 pass counts three.
  const segment = buildSegment(chart, { fromBeat: 3, countInBeats: chart.countInBeats });
  assert.equal(segment.countInBeats, 3);
  assert.equal(segment.beatsPerBar, 3);
  // One bar of three clicks, the first accented, then the first active beat.
  assert.deepEqual(segment.events.slice(0, 4).map(e => [e.beat, e.accent]), [
    [0, true], [1, false], [2, false], [3, true],
  ]);

  const ctx = createFakeAudioContext();
  const transport = createTransport(ctx, { timer: createFakeTimer(), now: () => ctx.currentTime });
  transport.start(segment);
  // `start` places beat 0 at now + LEAD_SEC, so every beat is one 0.75 s step from there.
  const atBeat = beat => {
    ctx.currentTime = 0.05 + beat * 0.75;
    return transport.position();
  };
  assert.equal(atBeat(0).phase, 'countIn');
  assert.equal(atBeat(2).phase, 'countIn');
  assert.equal(atBeat(3).phase, 'active');
  const cycle = [0, 1, 2, 3, 4, 5, 6].map(beat => atBeat(beat).beatInBar);
  assert.deepEqual(cycle, [1, 2, 3, 1, 2, 3, 1]);
  assert.ok(cycle.every(n => n >= 1 && n <= 3), 'a 3/4 bar never reaches beat 4');
});

// 04-03 Task 3: the resume path is the second reader of the chart's meter, so a resumed 3/4
// song must count in three and keep its 1-3 beat cycle too. Still no production change here:
// `buildSegment` takes `countInBeats` from its caller and `positionAt` divides by the chart.
test('a resumed 3/4 pass counts in three beats and keeps its 1-3 cycle', () => {
  const chart = {
    bpm: 80,
    beatsPerBar: 3,
    countInBeats: 3,
    totalBeats: 18,
    audioEvents: Array.from({ length: 18 }, (_, beat) => ({ beat, type: 'click', accent: beat % 3 === 0 })),
  };
  // Resuming at bar 4 (beat 9) opens one count-in bar of three clicks, first accented.
  const segment = buildSegment(chart, { fromBeat: 9, countInBeats: chart.countInBeats });
  assert.equal(segment.countInBeats, 3);
  assert.equal(segment.beatsPerBar, 3);
  assert.equal(segment.activeStartBeat, 9);
  assert.equal(segment.segmentStartBeat, 6);
  const countIn = segment.events.filter(event => event.beat < 9);
  assert.equal(countIn.length, 3, 'exactly one count-in bar of three');
  assert.deepEqual(countIn.map(event => [event.beat, event.accent]), [[6, true], [7, false], [8, false]]);

  const ctx = createFakeAudioContext();
  const transport = createTransport(ctx, { timer: createFakeTimer(), now: () => ctx.currentTime });
  transport.start(segment);
  const atBeat = beat => {
    // `start` places the segment's own first beat at now + LEAD_SEC, so a resumed pass counts
    // in one bar before the resume point rather than before chart beat 0.
    ctx.currentTime = 0.05 + (beat - segment.segmentStartBeat) * 0.75;
    return transport.position();
  };
  assert.equal(atBeat(6).phase, 'countIn');
  assert.equal(atBeat(6).beatInBar, 1);
  assert.equal(atBeat(7).beatInBar, 2);
  assert.equal(atBeat(8).beatInBar, 3);
  assert.equal(atBeat(8).phase, 'countIn', 'the count-in ends on its third beat');
  assert.equal(atBeat(9).phase, 'active');
  const cycle = [9, 10, 11, 12, 13, 14].map(beat => atBeat(beat).beatInBar);
  assert.deepEqual(cycle, [1, 2, 3, 1, 2, 3]);
  assert.ok(cycle.every(n => n >= 1 && n <= 3), 'a resumed 3/4 bar never reaches beat 4');
});
