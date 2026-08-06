import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import test from "node:test"

const moduleUrl = pathToFileURL(path.resolve("dist/cdp.js")).href

function runPortCheck(script, envPatch = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "browser-cdp-port-test-"))
  const env = {
    ...process.env,
    TEMP: directory,
    TMP: directory,
    TMPDIR: directory,
    ...envPatch,
  }
  if (envPatch.OPENCODE_CDP_PORT === null) delete env.OPENCODE_CDP_PORT

  try {
    return spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test("port precedence is explicit, environment, state, then 9223", () => {
  const script = `
    import * as api from ${JSON.stringify(moduleUrl)}
    api.rememberPort(9223)
    console.log(JSON.stringify({ implicit: api.resolvePort(), explicit: api.resolvePort(9444) }))
  `
  const result = runPortCheck(script, { OPENCODE_CDP_PORT: "9333" })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { implicit: 9333, explicit: 9444 })
})

test("last explicit port is remembered when no environment override exists", () => {
  const script = `
    import * as api from ${JSON.stringify(moduleUrl)}
    api.rememberPort(9555)
    console.log(api.resolvePort())
  `
  const result = runPortCheck(script, { OPENCODE_CDP_PORT: null })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), "9555")
})

test("invalid explicit ports are rejected", () => {
  const script = `
    import * as api from ${JSON.stringify(moduleUrl)}
    try { api.resolvePort(70000) } catch (error) { console.log(error.message) }
  `
  const result = runPortCheck(script, { OPENCODE_CDP_PORT: null })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Invalid CDP port/)
})
