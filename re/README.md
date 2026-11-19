# Reverse-engineering artifacts

`Poputar_1.10.0_APKPure.apk` (repository root) and the extracted files under
`re/apk/` are read-only research inputs. They document the official Poputar
app's BLE protocol and are not part of the delivered application.

- The APK and `re/apk/` are gitignored: roughly 49 MB stays on disk and out of
  git history.
- Nothing under `re/`, the APK, `tools/` or `.planning/` is published by the
  GitHub Pages workflow; only `app/` is uploaded.
- `PROTOCOL.md` is the human-readable contract derived from these artifacts.
  Do not edit the extracted bytecode or native library; treat them as evidence.
