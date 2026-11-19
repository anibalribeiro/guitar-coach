# Poputar T2 BLE protocol

Decoded from `libcocos2djs.so` (`BLEProcess::Get*Data`) in the official Android app v1.10.0.

## GATT
- Device name: `poputar`
- Service `0000ffa0-0000-1000-8000-00805f9b34fb`
  - `0000dc86-...` write-without-response: commands (app -> guitar)
  - `0000ffa3-...` notify: guitar -> app
- Service `00010203-0405-0607-0809-0a0b0c0d1912`: Telink OTA firmware update. **Never write.**

## Fretboard LEDs: `F1` + 18 bytes (19 total)
Strings numbered 1 (high E) .. 6 (low E); frets 1..24. Open strings (fret 0) have no LED.

```
byte index = (6 - string) * 3 + ceil(fret / 8)      // 1..18
bit        = 0x80 >> ((fret - 1) % 8)               // MSB = lowest fret of the group
```
All-zero payload (`F1` + 18x`00`) clears the board.

Example (fret-marker dots, shown by the app on connect):
`f1 00 00 00 00 10 00 2a 82 80 2a 82 80 00 10 00 00 00 00`

## Other frames (not yet tested)
- `F2`/`F3` + 7 bytes (`GetRightData`): strum/rhythm data. byte1 = string bitmask (string n -> `1 << (n+1)`), byte2 = arg, byte3 = `0x14`, byte7 = arg/20. `F3` when the 4th arg is 0.
- `F4 00 ...` (8 bytes): "breathing" animation.
- `F4 02|03 ...` (8 bytes): "merry-go-round" animation.
- `F5` + 18 bytes: "striking" data, same layout as `F1` (likely a different colour/mode).
