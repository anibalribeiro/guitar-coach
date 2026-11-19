// ---------- Guitar (Web Bluetooth) ----------
// See PROTOCOL.md: service 0xFFA0, write characteristic 0xDC86, notify 0xFFA3.
// Never request or write the Telink OTA service; this adapter has no DOM.
export const CHARACTERISTICS = { SERVICE: 0xffa0, WRITE: 0xdc86, NOTIFY: 0xffa3 };

// The capability preflight's Bluetooth item, beside the only module allowed to read the API.
// A property read with `createGuitar`'s own default parameter, never a call: boot must be able
// to answer "is Bluetooth here?" without ever opening the device chooser (D-76, T-05-12).
export const bluetoothSupported = (bluetooth = globalThis.navigator?.bluetooth) => !!bluetooth;

const BLE_UNAVAILABLE = "This browser can't use Bluetooth. Open Guitar Coach in Chrome or Edge on desktop, or Chrome on Android.";
const BLE_PERMISSION = "Chrome can't use Bluetooth. Allow Bluetooth access for Chrome in your system settings, then try again.";

export function createGuitar({ bluetooth = globalThis.navigator?.bluetooth, onConnection = () => {}, onBattery = () => {}, onError = () => {} } = {}) {
  const guitar = {
    device: null, writeChar: null, notifyChar: null, pending: null, busy: false, lastHex: '', connected: false,
    async connect() {
      if (!bluetooth) throw new Error(BLE_UNAVAILABLE);
      if (bluetooth.getAvailability && !(await bluetooth.getAvailability())) throw new Error(BLE_PERMISSION);
      const device = await bluetooth.requestDevice({
        filters: [{ namePrefix: 'poputar' }, { namePrefix: 'Poputar' }],
        optionalServices: [CHARACTERISTICS.SERVICE],
      });
      await guitar.attach(device);
    },
    async reconnect() {
      if (bluetooth?.getDevices) {
        let devices = [];
        try { devices = await bluetooth.getDevices(); } catch (e) { devices = []; }
        const known = devices.find(d => /^poputar/i.test(d.name || ''));
        if (known) { await guitar.attach(known); return; }
      }
      await guitar.connect();
    },
    async attach(device) {
      guitar.device = device;
      device.addEventListener('gattserverdisconnected', () => guitar.onDisconnect());
      try {
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(CHARACTERISTICS.SERVICE);
        guitar.writeChar = await service.getCharacteristic(CHARACTERISTICS.WRITE);
        guitar.notifyChar = await service.getCharacteristic(CHARACTERISTICS.NOTIFY);
        guitar.notifyChar.addEventListener('characteristicvaluechanged', e => guitar.onNotify(new Uint8Array(e.target.value.buffer, e.target.value.byteOffset, e.target.value.byteLength)));
        await guitar.notifyChar.startNotifications();
        guitar.lastHex = '';
        guitar.connected = true;
        onConnection(true);
      } catch (e) {
        // A partial attach must not leave the single-central link open with a stale
        // writeChar, or the retry cannot reconnect to the guitar (WR-07).
        guitar.onDisconnect();
        if (device.gatt.connected) device.gatt.disconnect();
        throw e;
      }
    },
    disconnect() {
      if (guitar.device?.gatt.connected) guitar.device.gatt.disconnect();
      else if (guitar.writeChar) guitar.onDisconnect();
    },
    onDisconnect() {
      guitar.writeChar = null;
      guitar.notifyChar = null;
      guitar.lastHex = '';
      // Notify once: a catch-path reset followed by gattserverdisconnected must not
      // overwrite the actionable connect error with a second "disconnected".
      if (guitar.connected) onConnection(false);
      guitar.connected = false;
    },
    onNotify(d) {
      // Observed: 6f a3 01 00 <battery %> ... (byte 4 looks like battery level)
      if (d[0] === 0x6f && d[1] === 0xa3 && d.length > 4) onBattery(d[4]);
    },
    send(frame) { guitar.pending = frame; guitar.pump(); },
    async pump() {
      if (guitar.busy || !guitar.writeChar || !guitar.pending) return;
      const frame = guitar.pending;
      guitar.pending = null;
      const hex = Array.from(frame, x => x.toString(16).padStart(2, '0')).join('');
      if (hex === guitar.lastHex) return;
      guitar.busy = true;
      try {
        await guitar.writeChar.writeValueWithoutResponse(frame);
        guitar.lastHex = hex;
      } catch (e) {
        // Chrome usually fires gattserverdisconnected before the pending write
        // rejects; once writeChar is null the disconnect status is the useful one.
        if (guitar.writeChar) onError(e?.message || String(e));
      }
      guitar.busy = false;
      if (guitar.pending) guitar.pump();
    },
  };
  return guitar;
}
