// Fake-GATT parity for the BLE adapter: connect, battery, coalesced pump, reset, reconnect.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuitar, CHARACTERISTICS, bluetoothSupported } from '../app/src/guitar.js';
import { createLedSink, sceneFromNotes, ledFrame, frameHex } from '../app/src/leds.js';
import { createFakeGattDevice, createFakeBluetooth, createFakeLedSink } from './helpers/fakes.js';

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const frame = byte => Uint8Array.from([0xf1, byte, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

function fixture({ device = createFakeGattDevice(), known = [] } = {}) {
  const bluetooth = createFakeBluetooth({ device, known });
  const events = { connections: [], batteries: [], errors: [] };
  const guitar = createGuitar({
    bluetooth,
    onConnection: on => events.connections.push(on),
    onBattery: pct => events.batteries.push(pct),
    onError: message => events.errors.push(message),
  });
  return { device, bluetooth, guitar, events };
}

test('connect requests only the LED service and wires both characteristics', async () => {
  const { device, bluetooth, guitar, events } = fixture();
  await guitar.connect();
  assert.deepEqual(bluetooth.requests, [{
    filters: [{ namePrefix: 'poputar' }, { namePrefix: 'Poputar' }],
    optionalServices: [CHARACTERISTICS.SERVICE],
  }]);
  assert.equal(device.gatt.connected, true);
  assert.deepEqual(device.requestedServices, [CHARACTERISTICS.SERVICE]);
  assert.equal(guitar.writeChar, device.write);
  assert.equal(device.notify.notificationsStarted, true);
  assert.equal(guitar.lastHex, '');
  assert.deepEqual(events.connections, [true]);
  assert.deepEqual(CHARACTERISTICS, { SERVICE: 0xffa0, WRITE: 0xdc86, NOTIFY: 0xffa3 });
});

test('battery frames update the callback; other frames are ignored', async () => {
  const { device, guitar, events } = fixture();
  await guitar.connect();
  device.notify.emit([0x6f, 0xa3, 0x01, 0x00, 82]);
  device.notify.emit([0x6f, 0xa3, 0x01]);
  device.notify.emit([0x10, 0x20, 0x30, 0x40, 0x50]);
  assert.deepEqual(events.batteries, [82]);
});

test('battery frames read the DataView window, not the whole backing buffer (IN-01)', async () => {
  const { device, guitar, events } = fixture();
  await guitar.connect();
  // A reused buffer with leading bytes would look like a non-battery frame if the
  // byteOffset/byteLength were ignored.
  const backing = Uint8Array.from([0x00, 0x6f, 0xa3, 0x01, 0x00, 82, 0xff, 0xff]);
  device.notify.emitView(new DataView(backing.buffer, 1, 5));
  assert.deepEqual(events.batteries, [82]);
});

test('pump writes once, dedupes identical frames and keeps the latest pending frame', async () => {
  const { device, guitar } = fixture();
  const gates = [];
  device.write.writeValueWithoutResponse = function (bytes) {
    this.writes.push(Uint8Array.from(bytes));
    return new Promise(resolve => gates.push(resolve));
  };
  await guitar.connect();

  const A = frame(0x01), B = frame(0x02), C = frame(0x03);
  guitar.send(A);
  await settle();
  assert.equal(device.write.writes.length, 1);

  guitar.send(B);
  guitar.send(C);
  gates[0]();
  await settle();
  assert.equal(device.write.writes.length, 2);
  assert.deepEqual([...device.write.writes[1]], [...C]);

  gates[1]();
  await settle();
  guitar.send(Uint8Array.from(C));
  await settle();
  assert.equal(device.write.writes.length, 2, 'identical frame must be deduped');
  assert.equal(guitar.busy, false);
});

test('write failure reports the message and leaves the pump usable', async () => {
  const { device, guitar, events } = fixture();
  await guitar.connect();
  device.write.writeValueWithoutResponse = async () => { throw new Error('LED write failed'); };
  guitar.send(frame(0x01));
  await settle();
  assert.deepEqual(events.errors, ['LED write failed']);
  assert.equal(guitar.busy, false);

  device.write.writeValueWithoutResponse = async function (bytes) { this.writes.push(Uint8Array.from(bytes)); };
  guitar.send(frame(0x01));
  await settle();
  assert.equal(device.write.writes.length, 1);
});

test('a write that rejects after a disconnect does not overwrite the status (IN-13)', async () => {
  const { device, guitar, events } = fixture();
  let rejectWrite;
  device.write.writeValueWithoutResponse = () => new Promise((resolve, reject) => { rejectWrite = reject; });
  await guitar.connect();
  guitar.send(frame(0x01));
  await settle();
  assert.equal(typeof rejectWrite, 'function');

  device.gatt.disconnect();
  assert.equal(guitar.writeChar, null);
  rejectWrite(new Error('GATT Server is disconnected. Cannot perform GATT operations.'));
  await settle();

  assert.deepEqual(events.errors, [], 'the disconnect status must survive the late write rejection');
  assert.equal(guitar.busy, false);
});

test('disconnect resets the write state and reports the connection change', async () => {
  const { device, guitar, events } = fixture();
  await guitar.connect();
  guitar.send(frame(0x01));
  await settle();
  assert.equal(device.write.writes.length, 1);

  guitar.disconnect();
  assert.equal(device.gatt.connected, false);
  assert.equal(guitar.writeChar, null);
  assert.equal(guitar.lastHex, '');
  assert.deepEqual(events.connections, [true, false]);

  guitar.send(frame(0x02));
  await settle();
  assert.equal(device.write.writes.length, 1, 'no writes while disconnected');
});

test('reconnect prefers a previously granted poputar device', async () => {
  const device = createFakeGattDevice();
  const other = createFakeGattDevice({ name: 'other device' });
  const { bluetooth, guitar, events } = fixture({ device: null, known: [other, device] });
  await guitar.reconnect();
  assert.equal(bluetooth.requests.length, 0);
  assert.equal(device.notify.notificationsStarted, true);
  assert.deepEqual(events.connections, [true]);
});

test('reconnect falls back to the device chooser when nothing is granted', async () => {
  const { bluetooth, guitar, events } = fixture({ known: [] });
  await guitar.reconnect();
  assert.equal(bluetooth.requests.length, 1);
  assert.deepEqual(events.connections, [true]);
});

test('missing or unavailable Bluetooth throws the actionable UI-SPEC messages', async () => {
  const missing = createGuitar({ bluetooth: null });
  await assert.rejects(() => missing.connect(), /This browser can't use Bluetooth/);

  const unavailable = createFakeBluetooth({ availability: false });
  const guitar = createGuitar({ bluetooth: unavailable });
  await assert.rejects(() => guitar.connect(), /Allow Bluetooth access/);
  assert.equal(unavailable.requests.length, 0);
});

// ---------- The capability preflight's Bluetooth item (05-02 Task 2, D-76) ----------
test('bluetoothSupported is a presence read that never requests a device', () => {
  const present = createFakeBluetooth();
  assert.equal(bluetoothSupported(present), true);
  assert.equal(present.requests.length, 0, 'asking cannot open the chooser');
  assert.equal(bluetoothSupported(null), false);
  assert.equal(bluetoothSupported(0), false);
  // The default parameter reads this runtime's own navigator, which has no Bluetooth.
  assert.equal(bluetoothSupported(), false);
  // The export takes `createGuitar`'s own default, so the predicate and the adapter read one
  // thing: a fake handed to one is the object the other would have used.
  assert.equal(typeof bluetoothSupported, 'function');
  assert.match(bluetoothSupported.toString(), /bluetooth = globalThis\.navigator\?\.bluetooth/);
});

test('a failed service or characteristic lookup releases GATT and resets the adapter (WR-07)', async () => {
  const device = createFakeGattDevice();
  device.gatt.connect = async () => {
    device.gatt.connected = true;
    return {
      async getPrimaryService(uuid) {
        device.requestedServices.push(uuid);
        return {
          async getCharacteristic(uuid) {
            if (uuid === CHARACTERISTICS.WRITE) return device.write;
            throw new Error('0xFFA3 missing on this firmware');
          },
        };
      },
    };
  };
  const { guitar, events } = fixture({ device });

  await assert.rejects(() => guitar.connect(), /0xFFA3 missing on this firmware/);
  assert.equal(device.gatt.connected, false, 'the single-central link must be released');
  assert.equal(guitar.writeChar, null);
  assert.equal(guitar.notifyChar, null);
  assert.equal(guitar.lastHex, '');
  assert.equal(guitar.connected, false);
  assert.deepEqual(events.connections, [], 'a link that never came up reports no connection');

  // A second call is not short-circuited by stale write state.
  await assert.rejects(() => guitar.connect(), /0xFFA3 missing on this firmware/);
});

test('onConnection(true) reasserts the held sink scene after a simulated reconnect', async () => {
  const device = createFakeGattDevice();
  const bluetooth = createFakeBluetooth({ device, known: [device] });
  const output = createFakeLedSink();
  const batteries = [];
  let connected = false;
  const sink = createLedSink({
    send: frame => output.send(frame),
    isConnected: () => connected,
    now: () => 0,
  });
  const scene = sceneFromNotes([{ s: 6, f: 3 }]);
  const guitar = createGuitar({
    bluetooth,
    onConnection: on => {
      connected = on;
      if (on) {
        sink.reset();
        sink.reassert(0, 120);
      }
    },
    onBattery: pct => batteries.push(pct),
    onError: () => {},
  });

  await guitar.connect();
  sink.tick(scene, 0, 120);
  assert.equal(output.frames.length, 1);
  device.notify.emit([0x6f, 0xa3, 0x01, 0x00, 77]);
  assert.deepEqual(batteries, [77]);

  device.gatt.disconnect();
  assert.equal(connected, false);
  assert.equal(output.frames.length, 1, 'a disconnect does not write');

  await guitar.reconnect();
  assert.equal(connected, true);
  assert.equal(output.frames.length, 2, 'reconnect reasserts the held browse scene');
  assert.equal(frameHex(output.frames[1]), frameHex(ledFrame([{ s: 6, f: 3 }])));
});
