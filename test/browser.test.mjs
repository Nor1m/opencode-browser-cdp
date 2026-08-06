import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer as createHttpServer } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { createServer as createNetServer } from "node:net"
import { spawnSync } from "node:child_process"
import test from "node:test"

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
}

const testRoot = mkdtempSync(path.join(tmpdir(), "browser-cdp-live-test-"))
const port = await freePort()
process.env.TEMP = testRoot
process.env.TMP = testRoot
process.env.TMPDIR = testRoot
process.env.OPENCODE_CDP_PORT = String(port)
process.env.OPENCODE_CHROME_PROFILE = path.join(testRoot, "profile")
process.env.OPENCODE_BROWSER_SHOT_DIR = path.join(testRoot, "screenshots")
process.env.OPENCODE_BROWSER_VISUAL_DELAY = "0"
process.env.OPENCODE_BROWSER_ACTION_DELAY = "0"

const api = await import("../dist/cdp.js")
const { browserTool } = await import("../dist/tool.js")
const disposePlugin = api.activate()

let testPage
let browserProcessStarted = false
let browserPid

function tool(args) {
  return browserTool.execute({ port, ...args })
}

async function closeTestBrowser() {
  if (process.platform === "win32" && browserPid) {
    spawnSync("taskkill", ["/PID", String(browserPid), "/T", "/F"], { stdio: "ignore" })
    const escaped = testRoot.replaceAll("'", "''")
    spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$needle='${escaped}'; Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(chrome|msedge|brave|opera|chromium)\\.exe$' -and $_.CommandLine -and $_.CommandLine.Contains($needle) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ],
      { stdio: "ignore" },
    )
    const deadline = Date.now() + 5000
    while ((await api.isCdpUp(port)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (await api.isCdpUp(port)) throw new Error(`Could not stop test browser on port ${port}`)
    return
  }
  if (!(await api.isCdpUp(port))) return
  const browser = await api.connect(port)
  await browser.close()
}

function removeTestRoot() {
  if (process.platform === "win32") {
    const escaped = testRoot.replaceAll("'", "''")
    spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$limit=(Get-Date).AddSeconds(5); do { Remove-Item -LiteralPath '${escaped}' -Recurse -Force -ErrorAction SilentlyContinue; if (!(Test-Path -LiteralPath '${escaped}')) { exit 0 }; Start-Sleep -Milliseconds 100 } while ((Get-Date) -lt $limit); exit 1`,
      ],
      { stdio: "ignore" },
    )
    if (existsSync(testRoot)) throw new Error(`Could not remove test profile: ${testRoot}`)
    return
  }
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}

test("live Chromium integration", async (t) => {
  t.after(async () => {
    await api.disconnectAll().catch(() => {})
    if (browserProcessStarted) await closeTestBrowser()
    removeTestRoot()
  })

  const started = await api.ensureChrome({ port, headed: process.env.CI !== "true" })
  browserPid = started.pid
  browserProcessStarted = started.ok ? started.started : Boolean(started.pid)
  assert.equal(started.ok, true, started.error)

  const navigationServer = createHttpServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "require-trusted-types-for 'script'; style-src 'none'",
    })
    response.end("<!doctype html><html><body><main>Preload navigation target</main></body></html>")
  })
  await new Promise((resolve, reject) => {
    navigationServer.once("error", reject)
    navigationServer.listen(0, "127.0.0.1", resolve)
  })
  const navigationAddress = navigationServer.address()
  const navigationOrigin = `http://127.0.0.1:${navigationAddress.port}`
  t.after(() => new Promise((resolve) => navigationServer.close(resolve)))

  let firstBrowser
  await api.withPage(
    async (page, browser) => {
      testPage = page
      firstBrowser = browser
      await page.setContent(`
        <input id="input">
        <input id="delayed" value="old">
        <input id="wrong">
        <div id="editable" contenteditable="true">old</div>
        <div id="hidden" contenteditable="true" style="display:none">old</div>
        <input id="offscreen" style="display:block;margin-top:2400px" value="old">
        <div style="height:1000px"></div>
        <button id="fixed" style="position:fixed;left:12px;bottom:12px">Fixed action</button>
        <script>
          window.events = []
          window.fixedClicked = false
          document.querySelector('#input').addEventListener('input', () => window.events.push('input'))
          document.querySelector('#input').addEventListener('change', () => window.events.push('change'))
          document.querySelector('#fixed').addEventListener('click', () => { window.fixedClicked = true })
        </script>
      `)
    },
    { port, newTab: true },
  )

  await t.test("reuses one connection per port", async () => {
    let secondBrowser
    await api.withPage(async (_page, browser) => {
      secondBrowser = browser
    }, { port })
    assert.strictEqual(secondBrowser, firstBrowser)
  })

  await t.test("serializes concurrent page actions on one port", async () => {
    const order = []
    await Promise.all([
      api.withPage(async () => {
        order.push("first:start")
        await new Promise((resolve) => setTimeout(resolve, 50))
        order.push("first:end")
      }, { port }),
      api.withPage(async () => {
        order.push("second:start")
        order.push("second:end")
      }, { port }),
    ])
    assert.deepEqual(order, ["first:start", "first:end", "second:start", "second:end"])
  })

  await t.test("ordinary actions do not overwrite the last explicit port", async () => {
    const remembered = port === 65535 ? 65534 : port + 1
    api.rememberPort(remembered)
    await api.withPage(async () => {}, { port })

    const state = JSON.parse(readFileSync(api.STATE_PATH, "utf8"))
    assert.equal(state.port, remembered)
    api.rememberPort(port)
  })

  await t.test("instant fill updates frameworks through input and change events", async () => {
    const result = JSON.parse(await tool({ action: "fill", selector: "#input", value: "fast" }))
    assert.equal(result.ok, true)

    const state = await api.withPage(
      (page) =>
        page.evaluate(() => ({
          value: document.querySelector("#input").value,
          events: window.events,
        })),
      { port },
    )
    assert.deepEqual(state, { value: "fast", events: ["input", "change"] })
  })

  await t.test("positive delay replaces text through keyboard events", async () => {
    const result = JSON.parse(
      await tool({ action: "fill", selector: "#delayed", value: "typed", delay: 1 }),
    )
    assert.equal(result.ok, true)
    const value = await api.withPage(
      (page) => page.$eval("#delayed", (element) => element.value),
      { port },
    )
    assert.equal(value, "typed")
  })

  await t.test("fill fallback focuses and replaces contenteditable text", async () => {
    await api.withPage((page) => page.focus("#wrong"), { port })
    const result = JSON.parse(
      await tool({ action: "fill", selector: "#editable", value: "target" }),
    )
    assert.equal(result.ok, true)

    const state = await api.withPage(
      (page) =>
        page.evaluate(() => ({
          wrong: document.querySelector("#wrong").value,
          editable: document.querySelector("#editable").textContent,
          active: document.activeElement.id,
        })),
      { port },
    )
    assert.deepEqual(state, { wrong: "", editable: "target", active: "editable" })
  })

  await t.test("fill never types into the old focus when target cannot focus", async () => {
    await api.withPage((page) => page.focus("#wrong"), { port })
    const result = JSON.parse(
      await tool({ action: "fill", selector: "#hidden", value: "misdirected" }),
    )
    assert.equal(result.ok, false)
    assert.match(result.error, /focused/)

    const state = await api.withPage(
      (page) =>
        page.evaluate(() => ({
          wrong: document.querySelector("#wrong").value,
          hidden: document.querySelector("#hidden").textContent,
        })),
      { port },
    )
    assert.deepEqual(state, { wrong: "", hidden: "old" })

    const taskStatus = await api.withPage(
      (page) =>
        page.evaluate(() => {
          const root = document.querySelector("#__opencode_browser_visuals").shadowRoot
          return root.querySelector("#tasks > div").dataset.status
        }),
      { port },
    )
    assert.equal(taskStatus, "failed")
  })

  await t.test("click by text supports fixed-position controls and cleans markers", async () => {
    const result = JSON.parse(await tool({ action: "click", text: "Fixed action" }))
    assert.equal(result.ok, true)
    const state = await api.withPage(
      (page) =>
        page.evaluate(() => ({
          clicked: window.fixedClicked,
          marker: document.querySelector("[data-opencode-browser-target]"),
        })),
      { port },
    )
    assert.deepEqual(state, { clicked: true, marker: null })
  })

  await t.test("visual guide scrolls, highlights, and shows task progress", async () => {
    const result = JSON.parse(
      await tool({
        action: "fill",
        selector: "#offscreen",
        value: "visible",
        task: "Fill offscreen account field",
      }),
    )
    assert.equal(result.ok, true)

    const state = await api.withPage(
      (page) =>
        page.evaluate(() => {
          const host = document.querySelector("#__opencode_browser_visuals")
          const root = host.shadowRoot
          const targetRect = document.querySelector("#offscreen").getBoundingClientRect()
          return {
            scrollY: window.scrollY,
            targetCenter: targetRect.top + targetRect.height / 2,
            viewportCenter: window.innerHeight / 2,
            pointerEvents: host.style.pointerEvents,
            hud: root.querySelector("#hud").textContent,
            count: root.querySelector("#hud-count").textContent,
            focusOpacity: root.querySelector("#focus").style.opacity,
            focusLabel: root.querySelector("#focus-label").textContent,
            cursorOpacity: root.querySelector("#cursor").style.opacity,
            cursorTransform: root.querySelector("#cursor").style.transform,
            pacePointerEvents: root.querySelector("#pace").style.pointerEvents,
            paceValue: root.querySelector("#pace-slider").value,
          }
        }),
      { port },
    )
    assert.ok(state.scrollY > 1000)
    assert.ok(
      Math.abs(state.targetCenter - state.viewportCenter) < 10,
      `target was not centered: ${state.targetCenter} vs ${state.viewportCenter}`,
    )
    assert.equal(state.pointerEvents, "none")
    assert.match(state.hud, /Fill offscreen account field/)
    assert.equal(state.count, "1/1")
    assert.equal(state.focusOpacity, "1")
    assert.equal(state.focusLabel, "Fill offscreen account field")
    assert.equal(state.cursorOpacity, "1")
    assert.match(state.cursorTransform, /translate3d/)
    assert.equal(state.pacePointerEvents, "auto")
    assert.equal(state.paceValue, "0")
  })

  await t.test("HUD pace slider changes the delay used by the next action", async () => {
    await api.withPage(
      async (page) => {
        await page.focus("#wrong")
        await page.evaluate(() => {
          const root = document.querySelector("[data-opencode-browser-owner]").shadowRoot
          const slider = root.querySelector("#pace-slider")
          slider.value = "150"
          slider.dispatchEvent(new Event("input", { bubbles: true }))
          slider.focus()
        })
      },
      { port },
    )
    const startedAt = performance.now()
    const result = JSON.parse(await tool({ action: "type", value: "X" }))
    const elapsed = performance.now() - startedAt
    assert.equal(result.ok, true)
    assert.ok(elapsed >= 100, `configured action delay was not applied: ${elapsed}ms`)
    const values = await api.withPage(
      (page) =>
        page.evaluate(() => ({
          wrong: document.querySelector("#wrong").value,
          offscreen: document.querySelector("#offscreen").value,
        })),
      { port },
    )
    assert.deepEqual(values, { wrong: "X", offscreen: "visible" })

    await api.withPage(
      (page) =>
        page.evaluate(() => {
          const root = document.querySelector("[data-opencode-browser-owner]").shadowRoot
          const slider = root.querySelector("#pace-slider")
          slider.value = "0"
          slider.dispatchEvent(new Event("input", { bubbles: true }))
        }),
      { port },
    )
    await tool({ action: "text" })
  })

  await t.test("visual overlay is hidden during screenshots and restored", async () => {
    const result = JSON.parse(await tool({ action: "screenshot", name: "visual-hidden" }))
    assert.equal(result.ok, true)
    const captured = readFileSync(result.path)
    const state = await api.withPage(async (page) => {
      const visible = Buffer.from(await page.screenshot())
      const sample = (png) =>
        page.evaluate(async (base64) => {
          const image = new Image()
          image.src = `data:image/png;base64,${base64}`
          await image.decode()
          const canvas = document.createElement("canvas")
          canvas.width = image.width
          canvas.height = image.height
          const context = canvas.getContext("2d")
          context.drawImage(image, 0, 0)
          return [...context.getImageData(image.width - 60, 50, 1, 1).data]
        }, png.toString("base64"))
      return {
        visible,
        hiddenPixel: await sample(captured),
        visiblePixel: await sample(visible),
        visibility: await page.$eval(
          "[data-opencode-browser-owner]",
          (host) => host.style.visibility,
        ),
      }
    }, { port })
    assert.notDeepEqual(captured, state.visible)
    assert.ok(state.hiddenPixel.slice(0, 3).every((channel) => channel > 235))
    assert.ok(state.visiblePixel.slice(0, 3).some((channel) => channel < 150))
    assert.equal(state.visibility, "visible")
  })

  await t.test("selector wait honors a short timeout", async () => {
    const startedAt = performance.now()
    const result = JSON.parse(
      await tool({ action: "wait", selector: "#missing", timeoutMs: 100 }),
    )
    const elapsed = performance.now() - startedAt

    assert.equal(result.ok, false)
    assert.match(result.error, /Waiting for selector/)
    assert.ok(elapsed >= 75, `wait returned too early: ${elapsed}ms`)
    assert.ok(elapsed < 750, `wait returned too late: ${elapsed}ms`)
  })

  await t.test("strict Trusted Types CSP never blocks the browser action", async () => {
    await api.withPage(
      (page) =>
        page.setContent(`
          <meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'; style-src 'none'">
          <div id="__opencode_browser_visuals" data-opencode-browser-visuals="true">Page-owned element</div>
          <main>Strict CSP content</main>
        `),
      { port },
    )
    const result = JSON.parse(await tool({ action: "text" }))
    assert.equal(result.ok, true)
    assert.match(result.text, /Strict CSP content/)
    const state = await api.withPage(
      (page) =>
        page.evaluate(() => ({
          pageElement: document.querySelector("#__opencode_browser_visuals").textContent,
          pluginHosts: document.querySelectorAll("[data-opencode-browser-owner]").length,
          pluginHostId: document.querySelector("[data-opencode-browser-owner]").id,
        })),
      { port },
    )
    assert.deepEqual(state, {
      pageElement: "Page-owned element",
      pluginHosts: 1,
      pluginHostId: "__opencode_browser_visuals_overlay",
    })

    const html = JSON.parse(await tool({ action: "html" }))
    assert.equal(html.ok, true)
    assert.doesNotMatch(html.html, /data-opencode-browser-owner/)
  })

  await t.test("preload restores the HUD across same-origin navigation without another update", async () => {
    await api.withPage(
      (page) => page.goto(`${navigationOrigin}/first`, { waitUntil: "domcontentloaded" }),
      { port },
    )
    const result = JSON.parse(await tool({ action: "text", task: "Persisted navigation task" }))
    assert.equal(result.ok, true)

    const state = await api.withPage(
      async (page) => {
        await page.goto(`${navigationOrigin}/second`, { waitUntil: "domcontentloaded" })
        await page.waitForSelector("[data-opencode-browser-owner]")
        return page.evaluate(() => {
          const host = document.querySelector("[data-opencode-browser-owner]")
          return {
            runtime: Boolean(window.__opencodeBrowserGhost),
            hud: host.shadowRoot.querySelector("#hud").textContent,
            count: host.shadowRoot.querySelector("#hud-count").textContent,
          }
        })
      },
      { port },
    )
    assert.equal(state.runtime, true)
    assert.match(state.hud, /Persisted navigation task/)
    assert.equal(state.count, "1/1")
  })

  await t.test("dispose drains active work and rejects queued reconnects", async () => {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    let queuedRan = false
    const active = api.withPage(async () => {
      await gate
    }, { port })
    const queued = api.withPage(async () => {
      queuedRan = true
    }, { port })

    await new Promise((resolve) => setTimeout(resolve, 25))
    const disposing = disposePlugin()
    release()

    await active
    await assert.rejects(queued, /disposed/)
    await disposing
    assert.equal(queuedRan, false)
    assert.equal(firstBrowser.connected, false)

    const detachedBrowser = await api.connect(port)
    const detachedPages = await detachedBrowser.pages()
    const detachedPage =
      detachedPages.find((page) => page.url().startsWith(navigationOrigin)) ?? detachedPages[0]
    await detachedPage.goto(`${navigationOrigin}/after-dispose`, { waitUntil: "domcontentloaded" })
    const removed = await detachedPage.evaluate(() => ({
      overlay: Boolean(document.querySelector("[data-opencode-browser-owner]")),
      runtime: Boolean(window.__opencodeBrowserGhost),
    }))
    assert.deepEqual(removed, { overlay: false, runtime: false })
    detachedBrowser.disconnect()

    const disposeSecondInstance = api.activate()
    let secondBrowser
    await api.withPage(async (page, browser) => {
      secondBrowser = browser
      const overlay = await page.$("[data-opencode-browser-owner]")
      assert.notEqual(overlay, null)
      if (!page.isClosed()) await page.close()
    }, { port })
    assert.equal(secondBrowser.connected, true)
    await disposeSecondInstance()
  })
})
