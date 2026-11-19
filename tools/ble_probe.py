"""Probe the Poputar T2's Bluetooth LE interface.

Usage (from the project root):
  uv run --with bleak tools/ble_probe.py scan             # list nearby BLE devices
  uv run --with bleak tools/ble_probe.py dump [ADDRESS]   # list GATT services/characteristics
  uv run --with bleak tools/ble_probe.py listen [ADDRESS] # print notifications (pluck strings!)
  uv run --with bleak tools/ble_probe.py write ADDRESS CHAR_UUID HEXBYTES [--response]

If ADDRESS is omitted, the first device whose name looks like a Poputar is used.
Results of `dump` are also saved to tools/gatt_dump.txt.

Safety: writes are allowlisted to the T2 command characteristic
0000dc86-0000-1000-8000-00805f9b34fb. The Telink OTA service/characteristic
(00010203-0405-0607-0809-0a0b0c0d1912 / ...2b12) is refused before any I/O and is
never subscribed for notifications either; firmware writes can brick the guitar.
"""

import asyncio
import sys
import uuid
from pathlib import Path

NAME_HINTS = ("poputar", "popu", "t2", "guitar", "pop")
HOLD_SECONDS = 20

COMMAND_CHARACTERISTIC = uuid.UUID("0000dc86-0000-1000-8000-00805f9b34fb")
OTA_SERVICE = uuid.UUID("00010203-0405-0607-0809-0a0b0c0d1912")
OTA_CHARACTERISTIC = uuid.UUID("00010203-0405-0607-0809-0a0b0c0d2b12")


def normalize_uuid(value):
    """Parse a UUID in any case and with optional braces into a uuid.UUID."""
    text = str(value).strip()
    if text.startswith("{") and text.endswith("}"):
        text = text[1:-1]
    return uuid.UUID(text)


def check_write_target(char_uuid):
    """Refuse the OTA family and every non-command target before any I/O.

    Returns the parsed UUID for the one allowed command characteristic. Any
    mixed-case, brace-wrapped or alternative spelling is normalized first, so a
    case or brace trick cannot bypass the guard.
    """
    try:
        target = normalize_uuid(char_uuid)
    except ValueError:
        sys.exit(f"Not a UUID: {char_uuid!r}. Pass the full characteristic UUID, for example {COMMAND_CHARACTERISTIC}.")
    # Every characteristic in the Telink OTA service shares this first 96 bits.
    if target.int >> 32 == OTA_SERVICE.int >> 32:
        sys.exit(
            f"Refusing to write to the Telink OTA target {target} - firmware writes could brick the guitar."
        )
    if target != COMMAND_CHARACTERISTIC:
        sys.exit(
            f"Refusing to write to {target}: only the T2 command characteristic "
            f"{COMMAND_CHARACTERISTIC} may be written."
        )
    return target


def is_ota_service(service_uuid):
    """True when a service UUID belongs to the Telink OTA family.

    start_notify writes the CCCD (0x2902) descriptor, so the family is skipped
    before subscribing, not only when a write target is checked.
    """
    try:
        return normalize_uuid(service_uuid).int >> 32 == OTA_SERVICE.int >> 32
    except (TypeError, ValueError):
        return False


def subscribable_characteristics(services):
    """Yield notifiable/indicatable characteristics outside the OTA family.

    The OTA service is skipped as a whole before any subscription, so no CCCD
    descriptor in that family is ever written.
    """
    for service in services:
        if is_ota_service(service.uuid):
            print(f"skipping OTA service {service.uuid}")
            continue
        for ch in service.characteristics:
            if {"notify", "indicate"} & set(ch.properties):
                yield ch


def format_rssi(rssi):
    """Render an advertisement RSSI that scanners may report as None."""
    return f"{(rssi if rssi is not None else '?'):>4}"


async def scan(timeout=8.0):
    from bleak import BleakScanner

    print(f"Scanning for {timeout:.0f}s... (make sure the guitar's Bluetooth is on and the Poputar app is closed)")
    found = await BleakScanner.discover(timeout=timeout, return_adv=True)
    rows = sorted(found.values(), key=lambda da: -(da[1].rssi or -999))
    for dev, adv in rows:
        name = dev.name or adv.local_name or "?"
        mark = "  <== likely guitar" if any(h in name.lower() for h in NAME_HINTS) else ""
        print(f"{format_rssi(adv.rssi)} dBm  {dev.address}  {name}{mark}")
        if adv.service_uuids:
            print(f"           services: {', '.join(adv.service_uuids)}")
        if adv.manufacturer_data:
            for cid, data in adv.manufacturer_data.items():
                print(f"           mfr 0x{cid:04x}: {data.hex(' ')}")
    return rows


async def find_guitar(address):
    if address:
        return address
    for dev, adv in await scan():
        name = (dev.name or adv.local_name or "").lower()
        if any(h in name for h in NAME_HINTS):
            print(f"\nUsing {dev.address} ({dev.name or adv.local_name})\n")
            return dev.address
    sys.exit("No Poputar-looking device found. Run `scan` and pass the ADDRESS explicitly.")


async def dump(address):
    from bleak import BleakClient

    address = await find_guitar(address)
    lines = []
    async with BleakClient(address) as client:
        for service in client.services:
            lines.append(f"[Service] {service.uuid}  {service.description}")
            for ch in service.characteristics:
                props = ",".join(ch.properties)
                line = f"   [Char] {ch.uuid}  handle={ch.handle}  ({props})  {ch.description}"
                if "read" in ch.properties:
                    try:
                        val = await client.read_gatt_char(ch)
                        line += f"\n          value: {val.hex(' ')}  {val!r}"
                    except Exception as e:
                        line += f"\n          read failed: {e}"
                lines.append(line)
                for d in ch.descriptors:
                    lines.append(f"      [Desc] {d.uuid}  handle={d.handle}")
    text = "\n".join(lines)
    print(text)
    out = Path(__file__).with_name("gatt_dump.txt")
    out.write_text(text + "\n")
    print(f"\nSaved to {out}")


async def listen(address, seconds=60):
    from bleak import BleakClient

    address = await find_guitar(address)
    async with BleakClient(address) as client:
        def handler(ch, data: bytearray):
            print(f"{ch.uuid}  {data.hex(' ')}")

        count = 0
        for ch in subscribable_characteristics(client.services):
            try:
                await client.start_notify(ch, handler)
                print(f"subscribed: {ch.uuid}")
                count += 1
            except Exception as e:
                print(f"could not subscribe {ch.uuid}: {e}")
        if not count:
            print("No notifiable characteristics.")
            return
        print(f"\nListening {seconds}s - try plucking strings, pressing frets, pressing buttons...\n")
        await asyncio.sleep(seconds)


async def write(address, char_uuid, hexbytes, response):
    from bleak import BleakClient

    # Hard refusal before any connection or write I/O.
    check_write_target(char_uuid)
    try:
        data = bytes.fromhex(hexbytes.replace(" ", "").replace(":", ""))
    except ValueError:
        sys.exit("HEXBYTES must be hex bytes such as 'f1 00 00'. Nothing was written.")
    address = await find_guitar(address)
    async with BleakClient(address) as client:
        # Subscribe like the official app does (battery level etc. arrives here),
        # but never touch the OTA service family, not even its CCCD descriptors.
        for ch in subscribable_characteristics(client.services):
            await client.start_notify(ch, lambda c, d: print(f"notify {c.uuid}: {d.hex(' ')}"))
        await asyncio.sleep(0.5)
        await client.write_gatt_char(char_uuid, data, response=response)
        print(f"wrote {data.hex(' ')} -> {char_uuid}; staying connected {HOLD_SECONDS}s")
        await asyncio.sleep(HOLD_SECONDS)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    cmd, rest = args[0], args[1:]
    if cmd == "scan":
        asyncio.run(scan())
    elif cmd == "dump":
        asyncio.run(dump(rest[0] if rest else None))
    elif cmd == "listen":
        asyncio.run(listen(rest[0] if rest else None))
    elif cmd == "write" and len(rest) >= 3:
        # Refuse before importing bleak or touching the adapter.
        check_write_target(rest[1])
        asyncio.run(write(rest[0], rest[1], " ".join(rest[2:]), "--response" in sys.argv))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
