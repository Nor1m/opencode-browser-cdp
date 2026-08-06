# Contributing

## Setup

Requirements:

- Node.js 20 or newer for development.
- A Chromium-based browser for live integration tests.

```bash
git clone https://github.com/Nor1m/opencode-browser-cdp.git
cd opencode-browser-cdp
npm install
npm run check
```

## Commands

| Command | Purpose |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting files |
| `npm test` | Run export and port regression tests |
| `npm run test:browser` | Run live Chromium integration tests |
| `npm run check` | Run every required check |
| `npm pack --dry-run` | Inspect the npm package contents |

The live test starts a browser on an isolated random port with a temporary profile.
Set `OPENCODE_CHROME_PATH` to test a non-default browser executable.

## Pull requests

- Make source changes in `src/`; do not edit generated `dist/` files directly.
- Add a regression test for behavior changes.
- Keep the package root export limited to the default OpenCode plugin factory.
- Run `npm run check` and `npm pack --dry-run` before opening a pull request.
- Update `README.md` and `CHANGELOG.md` for user-visible changes.

## Releases

1. Update the version in `package.json` and `package-lock.json`.
2. Move release notes from `Unreleased` into a versioned changelog section.
3. Run `npm run check` and `npm pack --dry-run`.
4. Publish with `npm publish`.
5. Create and push the matching Git tag and GitHub release.
