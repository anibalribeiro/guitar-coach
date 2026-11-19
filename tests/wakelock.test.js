// The Screen Wake Lock adapter: the five-state table, one sentinel per pass and a denial that
// is a state, never a retry. A fake navigator stands in for the browser, exactly as the BLE
// suite swaps a fake GATT peripheral for the real one (D-77, T-05-13).
import test from 'node:test';
import assert from 'node:assert/strict';
import { WAKE_STATES, wakelockSupported, wakeLockStep, createWakeLock } from '../app/src/wakelock.js';
import { createFakeWakeLock } from './helpers/fakes.js';

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };

function fixture({ rejectWith = null } = {}) {
  const nav = createFakeWakeLock({ rejectWith });
  const states = [];
  const lock = createWakeLock({ nav, onState: state => states.push(state) });
  return { nav, lock, states };
}

test('the adapter names its five states and imports nothing', () => {
  assert.deepEqual(WAKE_STATES, ['off', 'requesting', 'held', 'denied', 'unsupported']);
});

// ---------- The step table, one assertion per row ----------
test('the step table: request on the rising edge, idle while requesting, release when unwanted', () => {
  // Nothing is held and the lock is wanted now: the one request of a pass.
  assert.equal(wakeLockStep({ wanted: true, state: 'off', visible: true }), 'request');
  // One in-flight request is not a second one: the state stays `requesting` until it settles.
  assert.equal(wakeLockStep({ wanted: true, state: 'requesting', visible: true }), 'idle');
  // A held lock nobody wants any more (a pause, a result, a dropped guitar) is released.
  assert.equal(wakeLockStep({ wanted: false, state: 'held', visible: true }), 'release');
  // A hidden page releases too — only active documents can hold the lock.
  assert.equal(wakeLockStep({ wanted: true, state: 'held', visible: false }), 'release');
  // A denial is terminal: it stays idle for the page's lifetime, wanted or not.
  assert.equal(wakeLockStep({ wanted: true, state: 'denied', visible: true }), 'idle');
  assert.equal(wakeLockStep({ wanted: false, state: 'denied', visible: true }), 'idle');
  assert.equal(wakeLockStep({ wanted: true, state: 'denied', visible: false }), 'idle');
  // An absent entry point is the same quiet end state as a denial.
  assert.equal(wakeLockStep({ wanted: true, state: 'unsupported', visible: true }), 'idle');
  assert.equal(wakeLockStep({ wanted: false, state: 'unsupported', visible: false }), 'idle');
  // Nothing wanted and nothing held is no decision at all; the defaults decide nothing either.
  assert.equal(wakeLockStep({ wanted: false, state: 'off', visible: true }), 'idle');
  assert.equal(wakeLockStep({ wanted: false, state: 'requesting', visible: true }), 'idle');
  assert.equal(wakeLockStep({}), 'idle');
});

// ---------- Presence, never a call ----------
test('wakelockSupported is a property read of the entry point and never a request', () => {
  const nav = createFakeWakeLock();
  assert.equal(wakelockSupported(nav), true);
  assert.equal(nav.calls.length, 0, 'asking cannot request');
  assert.equal(wakelockSupported({}), false);
  assert.equal(wakelockSupported({ wakeLock: {} }), false, 'request must be a function');
  assert.equal(wakelockSupported({ wakeLock: { request: () => {} } }), true);
  assert.equal(wakelockSupported(null), false);
  // The default parameter reads this runtime's own navigator, which has no wake lock.
  assert.equal(wakelockSupported(), false);
});

// ---------- The adapter's three invariants ----------
test('two in-flight requests share one promise and produce exactly one sentinel', async () => {
  const { nav, lock, states } = fixture();
  const first = lock.request();
  const second = lock.request();
  assert.equal(first, second, 'the second frame gets the same promise');
  assert.equal(lock.state, 'requesting');
  await Promise.all([first, second]);
  assert.equal(lock.state, 'held');
  assert.equal(nav.calls.length, 1, 'one request, not two');
  assert.equal(nav.sentinelCount, 1, 'one sentinel, not two');
  assert.deepEqual(nav.calls, ['screen']);
  assert.deepEqual(states, ['requesting', 'held']);
  // A request while a lock is held is not a second lock either.
  await lock.request();
  assert.equal(nav.calls.length, 1);
  assert.equal(nav.sentinelCount, 1);
});

test('release clears the sentinel and returns the state to off', async () => {
  const { nav, lock } = fixture();
  await lock.request();
  const sentinel = nav.sentinel;
  assert.equal(lock.held, true);
  assert.equal(lock.release(), 'off');
  assert.equal(lock.state, 'off');
  assert.equal(sentinel.released, true, 'the sentinel own release is what ran');
  assert.equal(lock.held, false);
  // Releasing twice is not a second release on the same sentinel.
  lock.release();
  assert.equal(nav.sentinelReleases, 1);
  // Released, the next rising edge requests a fresh lock.
  await lock.request();
  assert.equal(nav.calls.length, 2);
  assert.equal(nav.sentinelCount, 2);
});

test('a rejection latches denied and no further request is ever issued', async () => {
  const denied = new Error('Screen Wake Lock permission denied');
  const { nav, lock, states } = fixture({ rejectWith: denied });
  await lock.request();
  assert.equal(lock.state, 'denied');
  assert.equal(lock.held, false);
  assert.equal(nav.calls.length, 1);
  // Every later frame and every later pass: still denied, still nothing asked.
  await lock.request();
  await lock.request();
  assert.equal(nav.calls.length, 1, 'a denial is never retried');
  assert.equal(lock.state, 'denied');
  assert.equal(wakeLockStep({ wanted: true, state: lock.state, visible: true }), 'idle');
  assert.deepEqual(states, ['requesting', 'denied']);
});

test('an absent entry point latches unsupported without asking anything', async () => {
  // A caller-built navigator with no wake lock at all — the Node default behaves the same way.
  const nav = { wakeLock: undefined };
  const states = [];
  const lock = createWakeLock({ nav, onState: state => states.push(state) });
  const answer = await lock.request();
  assert.equal(answer, 'unsupported');
  assert.equal(lock.state, 'unsupported');
  assert.equal(lock.release(), 'unsupported', 'there is nothing to release');
  assert.deepEqual(states, ['unsupported']);

  const bare = createWakeLock({});
  assert.equal(wakelockSupported({}), false);
  await bare.request();
  assert.equal(bare.state, 'unsupported');
});

test('a throwing onState callback can never break the lock', async () => {
  const nav = createFakeWakeLock();
  const lock = createWakeLock({ nav, onState: () => { throw new Error('consumer'); } });
  await assert.doesNotReject(() => lock.request());
  assert.equal(lock.state, 'held');
  assert.doesNotThrow(() => lock.release());
  assert.equal(lock.state, 'off');
});

// ---------- The lifecycle the composer drives ----------
test('one pass holds one lock and a pause gives it back', async () => {
  const { nav, lock } = fixture();
  // Frames of a live pass on a connected guitar: one request, then nothing.
  const frames = [
    { wanted: true, visible: true }, { wanted: true, visible: true }, { wanted: true, visible: true },
  ];
  for (const frame of frames) {
    const step = wakeLockStep({ ...frame, state: lock.state });
    if (step === 'request') lock.request();
    else if (step === 'release') lock.release();
    await settle();
  }
  assert.equal(nav.calls.length, 1);
  assert.equal(lock.state, 'held');
  // The pause: wanted falls, the next frame releases the one sentinel.
  assert.equal(wakeLockStep({ wanted: false, state: lock.state, visible: true }), 'release');
  lock.release();
  assert.equal(nav.sentinelReleases, 1);
  assert.equal(lock.state, 'off');
  // A resumed pass asks again — a new pass, a new lock.
  assert.equal(wakeLockStep({ wanted: true, state: lock.state, visible: true }), 'request');
  await lock.request();
  assert.equal(nav.sentinelCount, 2);
});

test('a hidden page releases the lock it holds', async () => {
  const { nav, lock } = fixture();
  await lock.request();
  assert.equal(wakeLockStep({ wanted: true, state: lock.state, visible: false }), 'release');
  lock.release();
  assert.equal(nav.sentinelReleases, 1);
  assert.equal(lock.state, 'off');
  // Still hidden: nothing is requested while the page is away.
  assert.equal(wakeLockStep({ wanted: true, state: lock.state, visible: false }), 'idle');
  assert.equal(nav.calls.length, 1);
});
