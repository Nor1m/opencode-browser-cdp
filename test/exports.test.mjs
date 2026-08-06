import assert from "node:assert/strict"
import test from "node:test"

test("package exports only the default OpenCode plugin factory", async () => {
  const pluginModule = await import("../dist/index.js")

  assert.deepEqual(Object.keys(pluginModule), ["default"])
  assert.equal(typeof pluginModule.default, "function")

  const hooks = await pluginModule.default({})
  assert.equal(typeof hooks.tool.browser.execute, "function")
  assert.equal(typeof hooks.dispose, "function")
})
