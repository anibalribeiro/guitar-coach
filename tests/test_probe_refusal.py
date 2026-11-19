"""Stdlib-only refusal checks for the BLE probe's write allowlist.

Run with `python3 tests/test_probe_refusal.py` from the repository root. Loading
tools/ble_probe.py must not require bleak or a guitar: the OTA guard is a pure
UUID check that runs before any Bluetooth I/O.
"""

import contextlib
import importlib.util
import io
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("ble_probe", ROOT / "tools" / "ble_probe.py")
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)


class WriteTargetRefusalTest(unittest.TestCase):
    def test_ota_service_is_rejected_in_mixed_case_and_braces(self):
        for value in (
            "00010203-0405-0607-0809-0a0b0c0d1912",
            "00010203-0405-0607-0809-0A0B0C0D1912",
            "{00010203-0405-0607-0809-0a0b0c0d1912}",
            "{00010203-0405-0607-0809-0A0B0C0D1912}",
        ):
            with self.assertRaises(SystemExit) as ctx:
                PROBE.check_write_target(value)
            self.assertIn("OTA", str(ctx.exception))

    def test_ota_characteristic_is_rejected_in_mixed_case_and_braces(self):
        for value in (
            "00010203-0405-0607-0809-0a0b0c0d2b12",
            "00010203-0405-0607-0809-0A0B0C0D2B12",
            "{00010203-0405-0607-0809-0a0b0c0d2b12}",
        ):
            with self.assertRaises(SystemExit) as ctx:
                PROBE.check_write_target(value)
            self.assertIn("OTA", str(ctx.exception))

    def test_any_other_ota_family_characteristic_is_rejected(self):
        with self.assertRaises(SystemExit):
            PROBE.check_write_target("00010203-0405-0607-0809-0a0b0c0dffff")

    def test_the_command_characteristic_passes_in_every_spelling(self):
        for value in (
            "0000dc86-0000-1000-8000-00805f9b34fb",
            "0000DC86-0000-1000-8000-00805F9B34FB",
            "{0000dc86-0000-1000-8000-00805f9b34fb}",
        ):
            self.assertEqual(PROBE.check_write_target(value), PROBE.COMMAND_CHARACTERISTIC)

    def test_any_other_uuid_is_rejected(self):
        with self.assertRaises(SystemExit) as ctx:
            PROBE.check_write_target("0000fff1-0000-1000-8000-00805f9b34fb")
        self.assertIn("only the T2 command characteristic", str(ctx.exception))

    def test_a_malformed_uuid_is_rejected_before_io(self):
        with self.assertRaises(SystemExit) as ctx:
            PROBE.check_write_target("not-a-uuid")
        self.assertIn("Not a UUID", str(ctx.exception))

    def test_the_module_loads_without_bleak(self):
        self.assertEqual(PROBE.COMMAND_CHARACTERISTIC.int, int("0000dc86-0000-1000-8000-00805f9b34fb".replace("-", ""), 16))
        self.assertTrue(callable(PROBE.check_write_target))


class SubscriptionRefusalTest(unittest.TestCase):
    class Char:
        def __init__(self, char_uuid, *properties):
            self.uuid = char_uuid
            self.properties = properties

    class Service:
        def __init__(self, service_uuid, characteristics):
            self.uuid = service_uuid
            self.characteristics = characteristics

    LED_NOTIFY = "0000ffa3-0000-1000-8000-00805f9b34fb"

    def test_ota_service_is_recognised_in_every_spelling(self):
        for value in (
            "00010203-0405-0607-0809-0a0b0c0d1912",
            "00010203-0405-0607-0809-0A0B0C0D1912",
            "{00010203-0405-0607-0809-0a0b0c0d1912}",
        ):
            self.assertTrue(PROBE.is_ota_service(value), value)
        self.assertFalse(PROBE.is_ota_service("0000ffa0-0000-1000-8000-00805f9b34fb"))
        self.assertFalse(PROBE.is_ota_service("not-a-uuid"))

    def test_a_notify_capable_ota_characteristic_is_never_subscribed(self):
        ota = self.Service(
            PROBE.OTA_SERVICE,
            [
                self.Char(PROBE.OTA_CHARACTERISTIC, "notify"),
                self.Char("00010203-0405-0607-0809-0a0b0c0dffff", "notify", "indicate"),
            ],
        )
        led = self.Service(
            "0000ffa0-0000-1000-8000-00805f9b34fb",
            [
                self.Char(PROBE.COMMAND_CHARACTERISTIC, "write", "write-without-response"),
                self.Char(self.LED_NOTIFY, "notify", "indicate"),
            ],
        )
        with contextlib.redirect_stdout(io.StringIO()) as out:
            subscribed = list(PROBE.subscribable_characteristics([ota, led]))
        self.assertEqual([ch.uuid for ch in subscribed], [self.LED_NOTIFY])
        self.assertIn("skipping OTA service", out.getvalue())


class ScanFormattingTest(unittest.TestCase):
    def test_a_missing_rssi_prints_as_a_question_mark_without_crashing(self):
        self.assertEqual(PROBE.format_rssi(None), "   ?")
        self.assertEqual(PROBE.format_rssi(-42), " -42")
        self.assertEqual(PROBE.format_rssi(-7), "  -7")


if __name__ == "__main__":
    unittest.main()
