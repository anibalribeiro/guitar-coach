// Golden LED codec characterization (L1-L14) plus the 01-02 scene language and sink.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ledFrame, frameHex, blinkOnForBeat, sceneFromNotes, frameForScene, createLedSink,
} from '../app/src/leds.js';
import { LED_FRAME_CASES, PROTOCOL_MARKER, PROTOCOL_MARKER_NOTES, ZERO_FRAME } from './fixtures/frames.js';
import { createFakeLedSink } from './helpers/fakes.js';

for (const c of LED_FRAME_CASES) {
  test(`${c.id}: ${c.name}`, () => {
    assert.equal(frameHex(ledFrame(c.notes)), c.hex);
  });
}

test('frame is always a 19-byte F1 command', () => {
  const frame = ledFrame(PROTOCOL_MARKER_NOTES);
  assert.ok(frame instanceof Uint8Array);
  assert.equal(frame.length, 19);
  assert.equal(frame[0], 0xF1);
});

test('duplicate and order-shuffled notes OR to the same frame', () => {
  assert.equal(frameHex(ledFrame(PROTOCOL_MARKER_NOTES)), PROTOCOL_MARKER);
  assert.equal(frameHex(ledFrame(PROTOCOL_MARKER_NOTES.slice().reverse())), PROTOCOL_MARKER);
  assert.equal(frameHex(ledFrame([...PROTOCOL_MARKER_NOTES, ...PROTOCOL_MARKER_NOTES])), PROTOCOL_MARKER);
});

test('open and out-of-range frets never light and never throw', () => {
  assert.equal(frameHex(ledFrame([{ s: 6, f: 0 }, { s: 1, f: 0 }])), ZERO_FRAME);
  assert.equal(frameHex(ledFrame([{ s: 6, f: 25 }, { s: 6, f: -1 }])), ZERO_FRAME);
});

// ---------- Blink phase boundaries ----------
test('blink toggles once per beat at 120 and 150 BPM', () => {
  for (const bpm of [120, 150]) {
    assert.equal(blinkOnForBeat(0, bpm), true);
    assert.equal(blinkOnForBeat(0.99, bpm), true);
    assert.equal(blinkOnForBeat(1, bpm), false);
    assert.equal(blinkOnForBeat(1.99, bpm), false);
    assert.equal(blinkOnForBeat(2, bpm), true);
  }
});

test('blink toggles once per two beats above 150 BPM', () => {
  assert.equal(blinkOnForBeat(0, 151), true);
  assert.equal(blinkOnForBeat(1.99, 151), true);
  assert.equal(blinkOnForBeat(2, 151), false);
  assert.equal(blinkOnForBeat(3.99, 151), false);
  assert.equal(blinkOnForBeat(4, 151), true);
});

// ---------- Scene rules ----------
test('sceneFromNotes keeps fret 0 in the screen set and forces an open target not to blink', () => {
  const notes = [{ s: 6, f: 0, midi: 40, iv: 7 }, { s: 5, f: 3, midi: 48, iv: 3 }];
  const scene = sceneFromNotes(notes, { target: { s: 6, f: 0 }, blink: true });
  assert.equal(scene.lit, notes);
  assert.equal(scene.target.f, 0);
  assert.equal(scene.blink, false);
  assert.deepEqual(scene.flash, []);
  assert.equal(frameHex(frameForScene(scene, 1, 120)), frameHex(ledFrame([{ s: 5, f: 3 }])));
});

test('a blinking target wins; the off phase removes it while the root stays', () => {
  const root = { s: 6, f: 0, midi: 40, iv: 0 };
  const target = { s: 5, f: 3, midi: 48, iv: 3 };
  const scene = sceneFromNotes([root, target], { target, blink: true });
  assert.equal(frameHex(frameForScene(scene, 0, 120)), frameHex(ledFrame([root, target])));
  assert.equal(frameHex(frameForScene(scene, 1, 120)), frameHex(ledFrame([root])));
});

test('when the root is the target it goes off during the blink off phase', () => {
  const root = { s: 6, f: 3, midi: 43, iv: 0 };
  const scene = sceneFromNotes([root], { target: root, blink: true });
  assert.equal(frameHex(frameForScene(scene, 0, 120)), frameHex(ledFrame([root])));
  assert.equal(frameHex(frameForScene(scene, 1, 120)), ZERO_FRAME);
});

test('an open target never blinks and never substitutes another fret', () => {
  const notes = [{ s: 6, f: 0, midi: 40, iv: 7 }, { s: 5, f: 3, midi: 48, iv: 3 }];
  const target = { s: 6, f: 0, midi: 40, iv: 7 };
  const scene = sceneFromNotes(notes, { target, blink: true });
  const on = frameHex(frameForScene(scene, 0, 120));
  const off = frameHex(frameForScene(scene, 1, 120));
  assert.equal(on, off);
  assert.equal(on, frameHex(ledFrame([{ s: 5, f: 3 }])));
  assert.doesNotMatch(on, /f1 80/);
});

test('completed non-root notes are absent from the scene lit set', () => {
  const root = { s: 6, f: 0, midi: 40, iv: 0 };
  const remaining = { s: 5, f: 3, midi: 48, iv: 3 };
  const scene = sceneFromNotes([root, remaining], { target: remaining, blink: true });
  assert.equal(frameHex(frameForScene(scene, 1, 120)), frameHex(ledFrame([root])));
});

// ---------- Sink: 15 Hz cap, dedupe, lights-off, reassert ----------
function sinkFixture({ connected = true } = {}) {
  const output = createFakeLedSink();
  let now = 0;
  let isConnected = connected;
  const sink = createLedSink({
    send: frame => output.send(frame),
    isConnected: () => isConnected,
    now: () => now,
  });
  return {
    output, sink,
    setNow(value) { now = value; },
    connect(value) { isConnected = value; },
  };
}

const sceneA = () => sceneFromNotes([{ s: 6, f: 1 }]);
const sceneB = () => sceneFromNotes([{ s: 6, f: 2 }]);
const sceneC = () => sceneFromNotes([{ s: 6, f: 3 }]);

test('sink caps writes at 15 Hz with an injected clock', () => {
  const f = sinkFixture();
  f.sink.tick(sceneA(), 0, 120);
  assert.equal(f.output.frames.length, 1);
  f.setNow(50);
  f.sink.tick(sceneB(), 0, 120);
  assert.equal(f.output.frames.length, 1, 'second write inside 66.7 ms must be suppressed');
  f.setNow(67);
  f.sink.tick(sceneC(), 0, 120);
  assert.equal(f.output.frames.length, 2);
});

test('sink dedupes identical frames and reset allows a resend', () => {
  const f = sinkFixture();
  f.sink.tick(sceneA(), 0, 120);
  f.setNow(100);
  f.sink.tick(sceneA(), 0, 120);
  assert.equal(f.output.frames.length, 1);
  f.sink.reset();
  f.sink.tick(sceneA(), 0, 120);
  assert.equal(f.output.frames.length, 2);
});

test('lights-off sends exactly one zero frame then suppresses every write', () => {
  const f = sinkFixture();
  f.sink.tick(sceneA(), 0, 120);
  assert.equal(f.output.frames.length, 1);
  f.sink.setEnabled(false);
  assert.equal(f.output.frames.length, 2);
  assert.equal(frameHex(f.output.frames[1]), ZERO_FRAME);
  for (let i = 1; i <= 5; i++) {
    f.setNow(i * 100);
    f.sink.tick(sceneB(), i, 120);
  }
  assert.equal(f.output.frames.length, 2, 'no write while the lights are off');
  f.sink.setEnabled(true);
  assert.equal(f.output.frames.length, 3);
  assert.equal(frameHex(f.output.frames[2]), frameHex(ledFrame([{ s: 6, f: 2 }])));
});

test('setEnabled(false) is idempotent and does not send a second zero', () => {
  const f = sinkFixture();
  f.sink.setEnabled(false);
  assert.equal(f.output.frames.length, 1);
  f.sink.setEnabled(false);
  assert.equal(f.output.frames.length, 1);
});

test('reassert after a fake reconnect resends the held scene; off stays off', () => {
  const on = sinkFixture();
  on.sink.tick(sceneA(), 0, 120);
  assert.equal(on.output.frames.length, 1);
  on.connect(false);
  on.sink.reset();
  on.sink.reassert(0, 120);
  assert.equal(on.output.frames.length, 1, 'nothing is written while disconnected');
  on.connect(true);
  on.sink.reset();
  on.sink.reassert(0, 120);
  assert.equal(on.output.frames.length, 2);
  assert.equal(frameHex(on.output.frames[1]), frameHex(ledFrame([{ s: 6, f: 1 }])));

  const off = sinkFixture();
  off.sink.tick(sceneA(), 0, 120);
  off.sink.setEnabled(false);
  const afterZero = off.output.frames.length;
  off.connect(false);
  off.sink.reset();
  off.connect(true);
  off.sink.reassert(0, 120);
  assert.equal(off.output.frames.length, afterZero, 'reconnecting while off must not write');
});

test('a disconnected sink holds the scene and sends it after reconnect', () => {
  const f = sinkFixture({ connected: false });
  f.sink.tick(sceneA(), 0, 120);
  assert.equal(f.output.frames.length, 0);
  f.connect(true);
  f.sink.reset();
  f.sink.reassert(0, 120);
  assert.equal(f.output.frames.length, 1);
  assert.equal(frameHex(f.output.frames[0]), frameHex(ledFrame([{ s: 6, f: 1 }])));
});

// ---------- Phase 2 fade scenes (02-01 Task 3) ----------
test('an anchor scene lights the anchor union plus the target and never an open string', () => {
  const anchors = [{ s: 6, f: 0 }, { s: 6, f: 3 }, { s: 6, f: 5 }];
  const target = { s: 5, f: 2 };
  const scene = sceneFromNotes([...anchors, target], { target, blink: true });
  assert.equal(
    frameHex(frameForScene(scene, 0, 120)),
    frameHex(ledFrame([{ s: 6, f: 3 }, { s: 6, f: 5 }, target])),
    'the open anchor stays on the screen set but is filtered from the frame',
  );
  assert.equal(
    frameHex(frameForScene(scene, 1, 120)),
    frameHex(ledFrame([{ s: 6, f: 3 }, { s: 6, f: 5 }])),
    'the blinking target drops out while the anchors stay',
  );
});

test('a flash set wins for its beat and the anchors return afterwards', () => {
  const anchors = [{ s: 6, f: 3 }, { s: 6, f: 5 }];
  const target = { s: 5, f: 2 };
  const shape = [{ s: 6, f: 1 }, { s: 5, f: 3 }];
  const flashScene = sceneFromNotes(anchors, { target, blink: false, flash: shape });
  assert.equal(frameHex(frameForScene(flashScene, 0, 120)), frameHex(ledFrame(shape)));
  const anchorScene = sceneFromNotes([...anchors, target], { target, blink: false, flash: [] });
  assert.equal(frameHex(frameForScene(anchorScene, 0, 120)), frameHex(ledFrame([...anchors, target])));
});

test('the no-lights scene sends one zero frame and then holds it', () => {
  const f = sinkFixture();
  f.sink.tick(sceneFromNotes([]), 0, 120);
  assert.equal(f.output.frames.length, 1);
  assert.equal(frameHex(f.output.frames[0]), ZERO_FRAME);
  f.setNow(100);
  f.sink.tick(sceneFromNotes([]), 1, 120);
  assert.equal(f.output.frames.length, 1, 'the held zero is deduped');
  f.setNow(200);
  f.sink.tick(sceneFromNotes([]), 2, 120);
  assert.equal(f.output.frames.length, 1);
});

test('reset and reassert after a reconnect at No lights sends zero, not the old pattern', () => {
  const f = sinkFixture();
  f.sink.tick(sceneA(), 0, 120);
  f.setNow(100);
  f.sink.tick(sceneFromNotes([]), 1, 120);
  const before = f.output.frames.length;
  assert.equal(frameHex(f.output.frames[before - 1]), ZERO_FRAME);

  f.connect(false);
  f.sink.reset();
  f.sink.reassert(1, 120);
  assert.equal(f.output.frames.length, before, 'nothing is written while disconnected');

  f.connect(true);
  f.sink.reset();
  f.sink.reassert(1, 120);
  assert.equal(f.output.frames.length, before + 1);
  assert.equal(frameHex(f.output.frames[before]), ZERO_FRAME);
});

test('an anchor scene, one full-pattern flash and the anchors again are three frames', () => {
  const f = sinkFixture();
  const anchors = [{ s: 6, f: 3 }, { s: 6, f: 5 }];
  const target = { s: 5, f: 2 };
  const shape = [{ s: 6, f: 1 }, { s: 5, f: 3 }];
  f.sink.tick(sceneFromNotes([...anchors, target], { target, blink: false }), 0, 120);
  f.setNow(100);
  f.sink.tick(sceneFromNotes([...anchors, target], { target, blink: false, flash: shape }), 1, 120);
  f.setNow(200);
  f.sink.tick(sceneFromNotes([...anchors, target], { target, blink: false, flash: [] }), 2, 120);
  assert.equal(f.output.frames.length, 3);
  assert.equal(frameHex(f.output.frames[0]), frameHex(ledFrame([...anchors, target])));
  assert.equal(frameHex(f.output.frames[1]), frameHex(ledFrame(shape)), 'the flash frame is the full pattern');
  assert.equal(frameHex(f.output.frames[2]), frameHex(ledFrame([...anchors, target])), 'anchors return');
});
