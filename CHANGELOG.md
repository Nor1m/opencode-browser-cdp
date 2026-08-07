# Changelog

## 0.3.0 - 2026-08-07

- Queue HUD guidance as a per-target FIFO so each instruction keeps its own page
  element and is consumed independently, oldest first.
- Add a `wait_guidance` browser action that long-polls until a new HUD instruction
  lands, waking the model without a separate chat message.
- Autonomously inject idle HUD instructions into the session via `promptAsync`, driven
  by `session.idle` and a 300ms poll, so the model can react right after its reply
  without the user typing in chat.
- Interrupt a stale browser action with pending guidance, return the guidance in the
  tool result, and resume the interrupted plan unless the instruction cancels it.
- Clear the injected right-click focus ring on a left pointer-down.
- Rework the HUD task stack: newest tasks first, finished tasks faded with a checkmark
  (`✓`/`✕`), a per-task remove button, a scrollable list, and a live progress bar.
- Soften HUD internal borders and remove the header task counter.
- Register the visual runtime once per managed target with CDP
  `Page.addScriptToEvaluateOnNewDocument` instead of reinjecting the full UI per action.
- Restore HUD tasks and pace across same-origin navigations through `sessionStorage`.
- Remove registered preload scripts and page overlays when the plugin is disposed.
- Install from GitHub instead of the npm registry and track built `dist` artifacts for
  script-free Git installs.
- Make the browser HUD draggable, add a submitted guidance prompt, and inject a
  **Look Here** action into the page's right-click context menu.
- Inject explicitly selected browser context into the next model request while marking
  webpage text and HTML as untrusted synthetic user context. Guidance is consumed once.
- Keep the visual cursor visible at its last position between actions and navigations.
- Localize HUD and context-menu controls in English, Russian, and Simplified Chinese.
- Simplify the HUD into an OpenCode-style panel with a `RU / EN / 中文` language
  switcher and a visible pending/sent wish history without empty-state copy.
- Add five dark and five light HUD themes with a persistent in-HUD theme selector.
- Pin Chrome for Testing in CI, run live Chromium only on Node 22, and report browser
  process diagnostics when CDP startup fails.
- Submit the HUD prompt with **Enter**, insert a newline with **Shift+Enter**, and drop
  the send button.
- Inject submitted HUD guidance as the first (highest-priority) part of the next user
  message, labeled as a high-priority user instruction rather than a low-trust hint.
- Replace the right-click Look Here button with an inline comment composer: Enter submits
  the comment and selected element, while Shift+Enter inserts a newline.
- Interrupt stale browser actions when guidance is pending, surface guidance directly in
  tool results, and retain the focus ring on the last operated form field.
- Suppress Chrome first-run, default-browser, crash-restore, notification, translation,
  password-onboarding, and other startup prompts; close extra startup-only tabs after CDP
  becomes ready.

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
