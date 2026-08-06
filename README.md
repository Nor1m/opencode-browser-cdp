# opencode-browser-cdp

[English](README.md) | [Русский](README.ru.md) | [中文](README.zh-CN.md)

[GitHub repository](https://github.com/Nor1m/opencode-browser-cdp)

[![license](https://img.shields.io/github/license/Nor1m/opencode-browser-cdp)](LICENSE)

Fast browser automation for OpenCode through a persistent Puppeteer CDP connection.
It controls a real Chromium window and adds one tool: **`browser`**.

<img width="384" height="368" alt="image" src="https://github.com/user-attachments/assets/a3c5dd4a-df27-45f4-b2db-438fe2eda4de" />


## Quick start

Add the GitHub plugin to `~/.config/opencode/opencode.json` or
`~/.config/opencode/opencode.jsonc`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["github:Nor1m/opencode-browser-cdp#main"]
}
```

Restart OpenCode, then ask the agent to open a page or call the tool directly:

```text
browser action=status
browser action=open url=https://example.com
browser action=text
```

OpenCode installs this Git revision and its dependencies directly from GitHub. No global
install, wrapper, MCP server, or separate browser driver is required. OpenCode caches a
Git spec after the first install; use a commit SHA or a new Git tag when upgrading.

## Why use it

- Controls visible Chrome, Chromium, Edge, Brave, or Opera windows.
- Reuses one CDP connection per port instead of reconnecting for every action.
- Serializes actions per port so keyboard and form operations do not race.
- Remembers the last explicit CDP port across calls.
- Uses fast native form filling, with a focused keyboard fallback for complex controls.
- Scrolls targets into view and shows a non-interactive animated cursor and focus ring.
- Displays queued browser tasks and progress in a compact top-right HUD.
- Keeps browser sessions, cookies, logins, tabs, and profiles between OpenCode calls.
- Runs on Windows, macOS, and Linux with automatic browser discovery and `PATH` lookup.

## Actions

| Action | Purpose | Main arguments |
|---|---|---|
| `start` | Launch or connect to Chromium CDP | `headed`, `port` |
| `status` | Report CDP and browser status | `port` |
| `tabs` | List open page tabs | `port` |
| `open` | Navigate to a URL | `url`, `newTab` |
| `back`, `reload` | Browser navigation | `timeoutMs` |
| `text`, `html` | Read page content | `selector`, `maxChars` |
| `eval` | Evaluate JavaScript in the page | `expression` |
| `click` | Click by CSS selector or visible text | `selector`, `text` |
| `fill` | Replace an editable value | `selector`, `value`, `delay` |
| `type` | Type into the focused or selected element | `selector`, `value`, `delay` |
| `select`, `check` | Set form controls | `selector`, `value` |
| `press` | Send a keyboard key | `selector`, `key` |
| `wait` | Wait for a selector, text, or duration | `selector`, `text`, `timeoutMs` |
| `screenshot` | Save a PNG screenshot | `name`, `fullPage` |
| `cookies` | Dismiss common cookie banners | none |
| `close_tab` | Close the active tab | none |

`fill` is instant by default and dispatches `input` and `change` events. Set a
positive `delay` to use keyboard input for sites that require key events or input
masks.

## Browser and port selection

Set `OPENCODE_CHROME_PATH` to force a browser executable. Otherwise the plugin
checks standard installation paths and then `PATH` for Google Chrome, Chromium,
Microsoft Edge, Brave, and Opera.

The CDP port is selected in this order:

1. The current tool call's `port` argument.
2. `OPENCODE_CDP_PORT`.
3. The last explicit port stored in the plugin state.
4. `9223`.

| Environment variable | Default | Purpose |
|---|---|---|
| `OPENCODE_CDP_PORT` | `9223` | Remote debugging port |
| `OPENCODE_CHROME_PATH` | auto-detected | Chromium executable |
| `OPENCODE_CHROME_PROFILE` | OS temp directory | Browser profile directory |
| `OPENCODE_BROWSER_SHOT_DIR` | OS temp directory | Screenshot output directory |
| `OPENCODE_BROWSER_VISUALS` | `1` | Set to `0` to disable cursor, focus ring, and HUD |
| `OPENCODE_BROWSER_VISUAL_DELAY` | `80` | Cursor movement delay in milliseconds (`0`-`1000`) |
| `OPENCODE_BROWSER_ACTION_DELAY` | `350` | Base human-like delay between actions (`0`-`2000`) |

The plugin launches a dedicated persistent profile by default. To connect to an
already running browser, launch it with a remote debugging port and pass that port
to `browser` or set `OPENCODE_CDP_PORT`.

## Visual guidance

Page actions automatically scroll their target into the center of the viewport. A
DOM-based cursor moves to the target while a focus ring identifies the exact element.
This overlay never moves or captures the operating system cursor. The cursor and
focus ring use `pointer-events: none`; only the compact HUD accepts user input.

The top-right HUD lists running and queued browser actions with progress. Pass the
optional `task` argument to replace an inferred action label with a user-facing name.
All visual elements are hidden while `screenshot` captures the page and restored
afterward.

Drag the compact OpenCode-style HUD by its header. Enter an additional instruction and
press the send button to queue it for the next model request. Recent wishes remain
visible in the HUD; a lime dot is pending and a gray dot is already sent. No empty-state
message is shown. To point at a page element,
right-click it and choose **Look here** from the injected context menu. This custom menu
replaces Chrome's native menu for that right-click. The element selector, text, and
clipped HTML are sent once, then consumed. Selected webpage content is explicitly marked
as untrusted, webpage-adjacent data and added as a synthetic user-context part rather
than a system instruction.

Use the `RU / EN / 中文` switcher in the HUD to choose English, Russian, or Simplified
Chinese. Before a manual selection, the page's `<html lang>` takes priority, followed by
the browser language.

The HUD theme selector offers five dark themes (`Carbon`, `Graphite`, `Obsidian`,
`Slate`, `Ink`) and five light themes (`Paper`, `Porcelain`, `Fog`, `Stone`, `Pearl`).
The selected theme is stored in plugin state and restored across sites and OpenCode
restarts.

The DOM cursor remains visible at its last known position between actions. On a new
document it is restored from tab state or starts in the center of the viewport.

Each managed tab registers the visual runtime once through CDP before page scripts
run, so navigation and strict CSP do not require full reinjection. HUD state is
restored automatically across same-origin navigations through `sessionStorage`;
cross-origin pages receive the current state on the next browser action.

Actions use a human-like delay of `350 ms` with small random variation by default.
Change it at runtime with the **Pace** slider in the HUD, or set
`OPENCODE_BROWSER_ACTION_DELAY`. Set it to `0` for maximum speed.

## Development

```bash
git clone https://github.com/Nor1m/opencode-browser-cdp.git
cd opencode-browser-cdp
npm install
npm run check
```

For local OpenCode testing, build the plugin and use an absolute file URL:

```bash
npm run build
```

```json
{
  "plugin": ["file:///absolute/path/opencode-browser-cdp/dist/index.js"]
}
```

Restart OpenCode after changing plugin code or configuration. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the test and release workflow.

## License

[MIT](LICENSE)
