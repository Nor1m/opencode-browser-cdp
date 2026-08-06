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
const createPlugin = (await import("../dist/index.js")).default
const pluginHooks = await createPlugin()
const disposePlugin = pluginHooks.dispose

let testPage
let browserProcessStarted = false
let browserPid

function tool(args) {
  return browserTool.execute({ port, ...args })
}

function chatMessages(sessionID) {
  return {
    messages: [
      {
        info: { id: `message-${sessionID}`, sessionID, role: "user" },
        parts: [],
      },
    ],
  }
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

  const navigationServer = createHttpServer((request, response) => {
    const requestedLanguage = new URL(request.url, "http://127.0.0.1").searchParams.get("lang")
    const language = ["en", "ru", "zh-CN"].includes(requestedLanguage) ? requestedLanguage : ""
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "require-trusted-types-for 'script'; style-src 'none'",
    })
    response.end(
      `<!doctype html><html${language ? ` lang="${language}"` : ""}><body><main>Preload navigation target</main></body></html>`,
    )
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
          window.fixedPointerDown = false
          window.fixedPointerUp = false
          window.fixedAuxClick = false
          document.querySelector('#input').addEventListener('input', () => window.events.push('input'))
          document.querySelector('#input').addEventListener('change', () => window.events.push('change'))
          document.querySelector('#fixed').addEventListener('click', () => { window.fixedClicked = true })
          document.querySelector('#fixed').addEventListener('pointerdown', () => { window.fixedPointerDown = true })
          document.querySelector('#fixed').addEventListener('pointerup', () => { window.fixedPointerUp = true })
          document.querySelector('#fixed').addEventListener('auxclick', () => { window.fixedAuxClick = true })
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
    assert.equal(state.focusOpacity, "1")
    assert.equal(state.focusLabel, "Fill offscreen account field")
    assert.equal(state.cursorOpacity, "1")
    assert.match(state.cursorTransform, /translate3d/)
    assert.equal(state.pacePointerEvents, "auto")
    assert.equal(state.paceValue, "0")
  })

  await t.test("HUD can be dragged without moving the operating system cursor", async () => {
    const movement = await api.withPage(
      async (page) => {
        const before = await page.evaluate(() => {
          const head = document
            .querySelector("[data-opencode-browser-owner]")
            .shadowRoot.querySelector("#hud-head")
          const rect = head.getBoundingClientRect()
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        })
        await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
        await page.mouse.down()
        await page.mouse.move(before.x + before.width / 2 - 100, before.y + before.height / 2 + 70)
        await page.mouse.up()
        const after = await page.evaluate(() => {
          const hud = document
            .querySelector("[data-opencode-browser-owner]")
            .shadowRoot.querySelector("#hud")
          const rect = hud.getBoundingClientRect()
          return { x: rect.x, y: rect.y }
        })
        return { before, after }
      },
      { port },
    )
    assert.ok(movement.after.x < movement.before.x - 80)
    assert.ok(movement.after.y > movement.before.y + 50)
  })

  await t.test("empty HUD does not render an empty-guidance message", async () => {
    const empty = await api.withPage(
      (page) =>
        page.evaluate(() => {
          const root = document.querySelector("[data-opencode-browser-owner]").shadowRoot
          return {
            legacyStatus: Boolean(root.querySelector("#guidance-status")),
            wishesDisplay: root.querySelector("#wishes").style.display,
            text: root.querySelector("#hud").textContent,
          }
        }),
      { port },
    )
    assert.equal(empty.legacyStatus, false)
    assert.equal(empty.wishesDisplay, "none")
    assert.doesNotMatch(empty.text, /No guidance|Нет пожеланий|暂无指令/)
  })

  await t.test("right-click Look Here and submitted prompt reach the next model request", async () => {
    await api.withPage(
      async (page) => {
        await page.evaluate(() => {
          window.fixedClicked = false
          window.fixedPointerDown = false
          window.fixedPointerUp = false
          window.fixedAuxClick = false
        })
const controls = await page.evaluate(() => {
          const root = document.querySelector("[data-opencode-browser-owner]").shadowRoot
          const prompt = root.querySelector("#guidance-prompt").getBoundingClientRect()
          return {
            prompt: { x: prompt.x + prompt.width / 2, y: prompt.y + prompt.height / 2 },
          }
        })
        await page.mouse.click(controls.prompt.x, controls.prompt.y)
        await page.keyboard.type("Проверь именно эту кнопку")
        await page.keyboard.press("Enter")
      },
      { port },
    )
    assert.notEqual(await api.collectGhostGuidance(), null)

    const picked = await api.withPage(
      async (page) => {
        const forged = await page.evaluate(() => {
          const prompt = document
            .querySelector("[data-opencode-browser-owner]")
            .shadowRoot.querySelector("#guidance-prompt")
          prompt.value = "FORGED"
          prompt.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
          )
          const wishes = [
            ...document
              .querySelector("[data-opencode-browser-owner]")
              .shadowRoot.querySelectorAll("#wishes [data-status]"),
          ].map((element) => element.textContent)
          prompt.value = ""
          return wishes
        })
        assert.equal(forged.some((text) => text.includes("FORGED")), false)
        const controls = await page.evaluate(() => {
          const root = document.querySelector("[data-opencode-browser-owner]").shadowRoot
          const target = document.querySelector("#fixed").getBoundingClientRect()
          return {
            target: { x: target.x + target.width / 2, y: target.y + target.height / 2 },
          }
        })
        await page.mouse.click(controls.target.x, controls.target.y, { button: "right" })
        const menu = await page.evaluate(() => {
          const root = document.querySelector("[data-opencode-browser-owner]").shadowRoot
          const comment = root.querySelector("#context-comment")
          const rect = comment.getBoundingClientRect()
          return {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            title: root.querySelector("#context-title").textContent,
          }
        })
        await page.mouse.click(menu.x, menu.y)
        await page.keyboard.type("Focus on this button")
        await page.keyboard.press("Enter")
        return page.evaluate(() => {
          const root = document.querySelector("[data-opencode-browser-owner]").shadowRoot
          const signed = window.__opencodeBrowserGhost.guidance()
          return {
            clicked: window.fixedClicked,
            pointerDown: window.fixedPointerDown,
            pointerUp: window.fixedPointerUp,
            auxClick: window.fixedAuxClick,
            menuText: root.querySelector("#context-title").textContent,
            menuDisplay: root.querySelector("#context-menu").style.display,
            wishes: [...root.querySelectorAll("#wishes [data-status]")].map((element) => ({
              text: element.textContent,
              status: element.dataset.status,
            })),
            prompt: root.querySelector("#guidance-prompt").value,
            cursorOpacity: root.querySelector("#cursor").style.opacity,
            guidance: signed.guidance,
            signed,
          }
        })
      },
      { port },
    )
    assert.equal(picked.clicked, false)
    assert.equal(picked.pointerDown, false)
    assert.equal(picked.pointerUp, false)
    assert.equal(picked.auxClick, false)
    assert.ok(["Смотри сюда", "Look here", "看这里"].includes(picked.menuText))
    assert.equal(picked.menuDisplay, "none")
    assert.equal(picked.wishes.length, 2)
    assert.deepEqual(picked.wishes.map((wish) => wish.status), ["pending", "pending"])
    assert.match(picked.wishes[0].text, /Проверь именно эту кнопку/)
    assert.match(picked.wishes[1].text, /Focus on this button/)
assert.equal(picked.prompt, "")
    assert.equal(picked.cursorOpacity, "1")
    assert.equal(picked.guidance.instruction, "Проверь именно эту кнопку")
    assert.equal(picked.guidance.target, undefined)

    const collected = await api.collectGhostGuidance()
    assert.equal(collected.instruction, "Проверь именно эту кнопку")
    await pluginHooks["tool.execute.before"](
      { tool: "browser", sessionID: "browser-session", callID: "call-1" },
      { args: {} },
    )
    const unrelated = chatMessages("other-session")
    await pluginHooks["experimental.chat.messages.transform"]({}, unrelated)
    assert.equal(unrelated.messages[0].parts.length, 0)
    assert.notEqual(await api.collectGhostGuidance(), null)
    const missingSession = { messages: [] }
    await pluginHooks["experimental.chat.messages.transform"]({}, missingSession)
    assert.equal(missingSession.messages.length, 0)
    assert.notEqual(await api.collectGhostGuidance(), null)
    const output = chatMessages("browser-session")
    await pluginHooks["experimental.chat.messages.transform"]({}, output)
    assert.equal(output.messages[0].parts.length, 1)
    assert.equal(output.messages[0].parts[0].synthetic, true)
assert.match(output.messages[0].parts[0].text, /Проверь именно эту кнопку/)
    assert.match(output.messages[0].parts[0].text, /USER HUD INSTRUCTION/)
    const nextCollected = await api.collectGhostGuidance()
    assert.equal(nextCollected.instruction, "Focus on this button")
    assert.equal(nextCollected.target.selector, "#fixed")
    assert.match(nextCollected.target.text, /Fixed action/)
    const consumed = await api.collectGhostGuidance(true)
    assert.equal(consumed.instruction, "Focus on this button")
    assert.equal(await api.collectGhostGuidance(), null)
    const sentWishes = await api.withPage(
      (page) =>
        page.evaluate(() =>
          [...document
            .querySelector("[data-opencode-browser-owner]")
            .shadowRoot.querySelectorAll("#wishes [data-status]")]
            .map((element) => element.dataset.status),
        ),
      { port },
    )
    assert.deepEqual(sentWishes, ["sent", "sent"])
    await api.withPage(
      (page) =>
        page.evaluate((replay) => {
          window.__originalGhost = window.__opencodeBrowserGhost
          window.__opencodeBrowserGhost = {
            ...window.__opencodeBrowserGhost,
            guidance: () => replay,
          }
        }, picked.signed),
      { port },
    )
    assert.equal(await api.collectGhostGuidance(), null)
    await api.withPage(
      (page) =>
        page.evaluate(() => {
          window.__opencodeBrowserGhost = window.__originalGhost
          delete window.__originalGhost
        }),
      { port },
    )

    await tool({ action: "text" })
    const cursorOpacity = await api.withPage(
      (page) =>
        page.evaluate(
          () =>
            document
              .querySelector("[data-opencode-browser-owner]")
              .shadowRoot.querySelector("#cursor").style.opacity,
        ),
      { port },
    )
    assert.equal(cursorOpacity, "1")
  })

  await t.test("pending HUD guidance interrupts the next action and form focus persists", async () => {
    await api.withPage(
      async (page) => {
        await page.$eval("#input", (element) => {
          element.value = "before-guidance"
        })
        const prompt = await page.evaluate(() => {
          const rect = document
            .querySelector("[data-opencode-browser-owner]")
            .shadowRoot.querySelector("#guidance-prompt")
            .getBoundingClientRect()
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
        })
        await page.mouse.click(prompt.x, prompt.y)
        await page.keyboard.type("Change the current browser task now")
        await page.keyboard.press("Enter")
      },
      { port },
    )

    const interrupted = JSON.parse(
      await tool({ action: "fill", selector: "#input", value: "stale-value" }),
    )
    assert.equal(interrupted.interrupted, true)
    assert.equal(interrupted.skipped_action, "fill")
    assert.equal(interrupted.user_guidance.priority, "high")
    assert.match(interrupted.user_guidance.instruction, /Change the current browser task now/)
    const skippedValue = await api.withPage(
      (page) => page.$eval("#input", (element) => element.value),
      { port },
    )
    assert.equal(skippedValue, "before-guidance")

    const filled = JSON.parse(
      await tool({ action: "fill", selector: "#input", value: "focused-value" }),
    )
    assert.equal(filled.ok, true)
    const focus = await api.withPage(
      (page) =>
        page.evaluate(() => {
          const root = document.querySelector("[data-opencode-browser-owner]").shadowRoot
          return {
            active: document.activeElement?.id,
            opacity: root.querySelector("#focus").style.opacity,
            label: root.querySelector("#focus-label").textContent,
            cursor: root.querySelector("#cursor").style.opacity,
          }
        }),
      { port },
    )
    assert.equal(focus.active, "input")
    assert.equal(focus.opacity, "1")
    assert.match(focus.label, /Fill #input/)
    assert.equal(focus.cursor, "1")
  })

  await t.test("targeted HUD guidance is consumed in FIFO order with its own target", async () => {
    const queueTarget = async (selector, instruction) => {
      const point = await testPage.$eval(selector, (element) => {
        const rect = element.getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      })
      await testPage.mouse.click(point.x, point.y, { button: "right" })
      const prompt = await testPage.evaluate(() => {
        const rect = document
          .querySelector("[data-opencode-browser-owner]")
          .shadowRoot.querySelector("#context-comment")
          .getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      })
      await testPage.mouse.click(prompt.x, prompt.y)
      await testPage.keyboard.type(instruction)
      await testPage.keyboard.press("Enter")
    }

    await queueTarget("#input", "Change this field")
    await queueTarget("#wrong", "Remove this field")

    const first = await api.collectGhostGuidance(true)
    const second = await api.collectGhostGuidance(true)
    assert.equal(first.instruction, "Change this field")
    assert.equal(first.target.selector, "#input")
    assert.equal(second.instruction, "Remove this field")
    assert.equal(second.target.selector, "#wrong")
    assert.equal(await api.collectGhostGuidance(true), null)
  })

  await t.test("wait_guidance returns as soon as a HUD instruction is submitted", async () => {
    const waiting = tool({ action: "wait_guidance", timeoutMs: 3000 })
    await new Promise((resolve) => setTimeout(resolve, 100))
    const prompt = await testPage.evaluate(() => {
      const rect = document
        .querySelector("[data-opencode-browser-owner]")
        .shadowRoot.querySelector("#guidance-prompt")
        .getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    })
    await testPage.mouse.click(prompt.x, prompt.y)
    await testPage.keyboard.type("Handle this, then continue")
    await testPage.keyboard.press("Enter")

    const result = JSON.parse(await waiting)
    assert.equal(result.interrupted, true)
    assert.match(result.user_guidance.instruction, /Handle this, then continue/)
    assert.equal(result.user_guidance.resume_previous_plan, true)
    assert.match(result.user_guidance.agent_action, /resume the interrupted plan/)
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
      const point = await page.evaluate(() => {
        const hud = document
          .querySelector("[data-opencode-browser-owner]")
          .shadowRoot.querySelector("#hud")
          .getBoundingClientRect()
        return { x: Math.round(hud.left + 20), y: Math.round(hud.top + 20) }
      })
      const sample = (png) =>
        page.evaluate(async ({ base64, x, y }) => {
          const image = new Image()
          image.src = `data:image/png;base64,${base64}`
          await image.decode()
          const canvas = document.createElement("canvas")
          canvas.width = image.width
          canvas.height = image.height
          const context = canvas.getContext("2d")
          context.drawImage(image, 0, 0)
          return [...context.getImageData(x, y, 1, 1).data]
        }, { base64: png.toString("base64"), ...point })
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
    await api.withPage(
      async (page) => {
const controls = await page.evaluate(() => {
          const root = document.querySelector("[data-opencode-browser-owner]").shadowRoot
          const prompt = root.querySelector("#guidance-prompt").getBoundingClientRect()
          return {
            prompt: { x: prompt.x + prompt.width / 2, y: prompt.y + prompt.height / 2 },
          }
        })
        await page.mouse.click(controls.prompt.x, controls.prompt.y)
        await page.keyboard.type("Persist across navigation")
        await page.keyboard.press("Enter")
      },
      { port },
    )

    const state = await api.withPage(
      async (page) => {
        await page.goto(`${navigationOrigin}/second`, { waitUntil: "domcontentloaded" })
        await page.waitForSelector("[data-opencode-browser-owner]")
        return page.evaluate(() => {
          const host = document.querySelector("[data-opencode-browser-owner]")
          return {
runtime: Boolean(window.__opencodeBrowserGhost),
            hud: host.shadowRoot.querySelector("#hud").textContent,
            cursorOpacity: host.shadowRoot.querySelector("#cursor").style.opacity,
            cursorTransform: host.shadowRoot.querySelector("#cursor").style.transform,
          }
        })
      },
      { port },
    )
    assert.equal(state.runtime, true)
    assert.match(state.hud, /Persisted navigation task/)
    assert.equal(state.cursorOpacity, "1")
    assert.match(state.cursorTransform, /translate3d/)
    const persistedGuidance = await api.collectGhostGuidance(true)
    assert.equal(persistedGuidance.instruction, "Persist across navigation")
  })

  await t.test("preload does not mount duplicate HUDs inside child frames", async () => {
    const frameState = await api.withPage(
      async (page) => {
        await page.evaluate((frameUrl) => {
          const frame = document.createElement("iframe")
          frame.src = frameUrl
          document.body.appendChild(frame)
        }, `${navigationOrigin}/frame`)
        const frame = await page.waitForFrame((candidate) => candidate.url().endsWith("/frame"))
        return {
          main: await page.$$("[data-opencode-browser-owner]").then((items) => items.length),
          child: await frame.$$("[data-opencode-browser-owner]").then((items) => items.length),
        }
      },
      { port },
    )
    assert.deepEqual(frameState, { main: 1, child: 0 })
  })

  await t.test("HUD and context-menu controls support English, Russian, and Chinese", async () => {
    const localized = await api.withPage(
      async (page) => {
        await page.goto(`${navigationOrigin}/localized?lang=en`, { waitUntil: "domcontentloaded" })
        await page.waitForSelector("[data-opencode-browser-owner]")
        const cases = ["en", "ru", "zh"]
        const values = []
        for (const locale of cases) {
          const switcher = await page.evaluate((nextLocale) => {
            const button = document
              .querySelector("[data-opencode-browser-owner]")
              .shadowRoot.querySelector(`[data-locale="${nextLocale}"]`)
            const rect = button.getBoundingClientRect()
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
          }, locale)
          await page.mouse.click(switcher.x, switcher.y)
          const target = await page.$eval("main", (element) => {
            const rect = element.getBoundingClientRect()
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
          })
          await page.mouse.click(target.x, target.y, { button: "right" })
          values.push(
            await page.evaluate(() => {
              const root = document.querySelector("[data-opencode-browser-owner]").shadowRoot
              return {
                placeholder: root.querySelector("#guidance-prompt").placeholder,
                lookHere: root.querySelector("#context-title").textContent,
                contextPlaceholder: root.querySelector("#context-comment").placeholder,
                contextHint: root.querySelector("#context-hint").textContent,
                pace: root.querySelector("#pace > span").textContent,
                active: root.querySelector("#locale-switch [aria-pressed=true]").dataset.locale,
              }
            }),
          )
          await page.keyboard.press("Escape")
        }
        return values
      },
      { port },
    )
    assert.deepEqual(localized, [
      {
        placeholder: "Additional instruction for AI…",
        lookHere: "Look here",
        contextPlaceholder: "What should I look at?",
        contextHint: "Enter to send · Shift+Enter for a new line",
        pace: "Pace",
        active: "en",
      },
      {
        placeholder: "Доп. пожелание для ИИ…",
        lookHere: "Смотри сюда",
        contextPlaceholder: "Что здесь важно?",
        contextHint: "Enter — отправить · Shift+Enter — новая строка",
        pace: "Скорость",
        active: "ru",
      },
      {
        placeholder: "给 AI 的附加指令…",
        lookHere: "看这里",
        contextPlaceholder: "这里需要关注什么？",
        contextHint: "Enter 发送 · Shift+Enter 换行",
        pace: "速度",
        active: "zh",
      },
    ])
  })

  await t.test("HUD theme selector persists one of ten themes across origins", async () => {
    const selected = await api.withPage(
      (page) =>
        page.evaluate(() => {
          const root = document.querySelector("[data-opencode-browser-owner]").shadowRoot
          const select = root.querySelector("#theme-select")
          const options = [...select.options].map((option) => option.value)
          select.value = "paper"
          select.dispatchEvent(new Event("change", { bubbles: true }))
          return {
            options,
            preference: window.__opencodeBrowserGhost.theme(),
            background: root.querySelector("#hud").style.background,
          }
        }),
      { port },
    )
    assert.equal(selected.options.length, 10)
    assert.deepEqual(selected.options.slice(0, 5), [
      "carbon", "graphite", "obsidian", "slate", "ink",
    ])
    assert.deepEqual(selected.options.slice(5), [
      "paper", "porcelain", "fog", "stone", "pearl",
    ])
    assert.equal(selected.preference.name, "paper")
    assert.ok(selected.preference.updatedAt > 0)
    assert.match(selected.background, /#fbfaf7|rgb\(251, 250, 247\)/)

    const restored = await api.withPage(
      async (page) => {
        await page.goto("data:text/html,<main>cross-origin theme</main>")
        await page.waitForSelector("[data-opencode-browser-owner]")
        return page.evaluate(() => {
          const root = document.querySelector("[data-opencode-browser-owner]").shadowRoot
          return {
            preference: window.__opencodeBrowserGhost.theme(),
            selected: root.querySelector("#theme-select").value,
            background: root.querySelector("#hud").style.background,
          }
        })
      },
      { port },
    )
    assert.equal(restored.preference.name, "paper")
    assert.equal(restored.selected, "paper")
    assert.match(restored.background, /#fbfaf7|rgb\(251, 250, 247\)/)
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
