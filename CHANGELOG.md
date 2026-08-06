# Changelog

## 0.2.0 - 2026-08-06

- Reuse persistent Puppeteer connections per CDP port.
- Serialize page actions per port to prevent keyboard and form races.
- Disconnect cached clients through the OpenCode plugin lifecycle.
- Remember explicit ports with `explicit > environment > state > 9223` precedence.
- Add instant event-aware `fill` with a safe keyboard fallback and configurable delay.
- Add automatic target scrolling, an animated DOM cursor, focus highlighting, and a task HUD.
- Add human-like action pacing with jitter and a live HUD speed control.
- Hide all injected visual guidance while capturing screenshots.
- Add English, Russian, and Simplified Chinese documentation.
- Make selector reads and waits honor their requested timeout.
- Add unit, regression, live Chromium, and CI coverage.
- Document npm, local development, and contribution workflows.

## 0.1.1 - 2026-08-06

- Export only the default plugin factory required by the OpenCode loader.
- Discover Chromium browsers in standard Windows, macOS, and Linux locations and on
  `PATH`.

## 0.1.0 - 2026-08-06

- Initial npm release.
