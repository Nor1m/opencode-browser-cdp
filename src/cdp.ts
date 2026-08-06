import puppeteer, { type Browser, type Page } from "puppeteer-core"
import { spawn } from "node:child_process"
import { createHmac, timingSafeEqual } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { clearTasks } from "./visual.js"
import {
  GHOST_ACTION_DELAY,
  GHOST_ENABLED,
  GHOST_GUIDANCE_SECRET,
  GHOST_OWNER,
  GHOST_SOURCE,
  type GhostGuidance,
  type GhostRuntime,
  type SignedGhostGuidance,
} from "./ghost.js"

const DATA_DIR = path.join(os.tmpdir(), "opencode-browser-cdp")
const STATE_PATH = path.join(DATA_DIR, "state.json")
const ENV_PORT = parsePort(process.env.OPENCODE_CDP_PORT)
export const DEFAULT_PORT = ENV_PORT ?? 9223
export const PROFILE_DIR =
  process.env.OPENCODE_CHROME_PROFILE || path.join(DATA_DIR, "chrome-profile")
export const SHOT_DIR =
  process.env.OPENCODE_BROWSER_SHOT_DIR || path.join(DATA_DIR, "screenshots")

function chromeCandidates(): string[] {
  const home = os.homedir()
  const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local")
  const programFiles = process.env.ProgramFiles || "C:/Program Files"
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)"
  const platformCandidates =
    process.platform === "win32"
      ? [
          path.join(localAppData, "Google/Chrome/Application/chrome.exe"),
          path.join(localAppData, "Chromium/Application/chrome.exe"),
          path.join(localAppData, "Microsoft/Edge/Application/msedge.exe"),
          path.join(localAppData, "BraveSoftware/Brave-Browser/Application/brave.exe"),
          path.join(localAppData, "Programs/Opera/opera.exe"),
          path.join(programFiles, "Google/Chrome/Application/chrome.exe"),
          path.join(programFiles, "Microsoft/Edge/Application/msedge.exe"),
          path.join(programFiles, "BraveSoftware/Brave-Browser/Application/brave.exe"),
          path.join(programFilesX86, "Google/Chrome/Application/chrome.exe"),
          path.join(programFilesX86, "Microsoft/Edge/Application/msedge.exe"),
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            "/Applications/Opera.app/Contents/MacOS/Opera",
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/microsoft-edge",
            "/usr/bin/brave-browser",
            "/snap/bin/chromium",
            "/opt/google/chrome/google-chrome",
            "/opt/brave.com/brave/brave",
          ]
  return [
    process.env.OPENCODE_CHROME_PATH,
    ...platformCandidates,
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "chrome",
    "msedge",
    "brave",
    "brave-browser",
    "opera",
  ].filter(Boolean) as string[]
}

function findOnPath(command: string): string | null {
  if (command.includes(path.sep) || command.includes("/")) {
    return fs.existsSync(command) ? command : null
  }

  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";")
      : [""]
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    if (!directory) continue
    for (const extension of extensions) {
      const executable = path.join(directory, `${command}${extension}`)
      if (fs.existsSync(executable)) return executable
    }
  }
  return null
}

export function findChrome(): string | null {
  for (const candidate of chromeCandidates()) {
    try {
      const executable = findOnPath(candidate)
      if (executable) return executable
    } catch {
      /* ignore */
    }
  }
  return null
}

export function cdpBase(port = DEFAULT_PORT): string {
  return `http://127.0.0.1:${port}`
}

export async function isCdpUp(port = DEFAULT_PORT): Promise<Record<string, string> | null> {
  try {
    const res = await fetch(`${cdpBase(port)}/json/version`, {
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) return null
    return (await res.json()) as Record<string, string>
  } catch {
    return null
  }
}

function parsePort(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
}

function loadState(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as Record<string, unknown>
  } catch {
    return {}
  }
}

function saveState(patch: Record<string, unknown>) {
  const next = { ...loadState(), ...patch, updatedAt: new Date().toISOString() }
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2))
  return next
}

export function resolvePort(explicit?: number): number {
  if (explicit !== undefined) {
    const port = parsePort(explicit)
    if (port === null) throw new Error(`Invalid CDP port: ${explicit}`)
    return port
  }
  if (ENV_PORT !== null) return ENV_PORT
  return parsePort(loadState().port) ?? 9223
}

export function rememberPort(port: number): number {
  const valid = parsePort(port)
  if (valid === null) throw new Error(`Invalid CDP port: ${port}`)
  saveState({ port: valid })
  return valid
}

export async function ensureChrome({
  port = DEFAULT_PORT,
  headed = true,
}: {
  port?: number
  headed?: boolean
} = {}) {
  const existing = await isCdpUp(port)
  if (existing) {
    saveState({ browser: existing.Browser, ws: existing.webSocketDebuggerUrl })
    return { ok: true as const, started: false, port, version: existing }
  }

  const chrome = findChrome()
  if (!chrome) {
    return {
      ok: false as const,
      error: "Chrome/Chromium not found. Set OPENCODE_CHROME_PATH to chrome.exe",
    }
  }

  fs.mkdirSync(PROFILE_DIR, { recursive: true })
  const args = [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--window-size=1400,900",
    "about:blank",
  ]
  if (!headed) {
    args.push("--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage")
  }

  const captureDiagnostics = process.env.CI === "true"
  const child = spawn(chrome, args, {
    detached: true,
    stdio: captureDiagnostics ? ["ignore", "ignore", "pipe"] : "ignore",
    windowsHide: false,
  })
  let exitCode: number | null = null
  let exitSignal: NodeJS.Signals | null = null
  let spawnError = ""
  let stderr = ""
  child.once("error", (error) => {
    spawnError = error.message
  })
  child.once("exit", (code, signal) => {
    exitCode = code
    exitSignal = signal
  })
  child.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-4000)
  })
  child.unref()

  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 300))
    const v = await isCdpUp(port)
    if (v) {
      saveState({ browser: v.Browser, pid: child.pid, profile: PROFILE_DIR })
      return {
        ok: true as const,
        started: true,
        port,
        version: v,
        pid: child.pid,
        chrome,
      }
    }
    if (spawnError || exitCode !== null || exitSignal !== null) break
  }
  if (exitCode === null && exitSignal === null && !spawnError) child.kill()
  const diagnostic = [
    spawnError ? `spawn: ${spawnError}` : "",
    exitCode === null ? "" : `exit=${exitCode}`,
    exitSignal ? `signal=${exitSignal}` : "",
    stderr.trim() ? `stderr: ${stderr.trim()}` : "",
  ].filter(Boolean).join("; ")
  return {
    ok: false as const,
    error: `Browser launched but CDP :${port} not ready${diagnostic ? ` (${diagnostic})` : ""}`,
    chrome,
    pid: child.pid,
  }
}

export async function connect(port = DEFAULT_PORT): Promise<Browser> {
  const up = await isCdpUp(port)
  if (!up) {
    const ensured = await ensureChrome({ port, headed: true })
    if (!ensured.ok) throw new Error(ensured.error || "CDP not available")
  }
  return puppeteer.connect({
    browserURL: cdpBase(port),
    defaultViewport: null,
    protocolTimeout: 60000,
  })
}

type BrowserEntry = {
  browser: Browser
}

type GhostRegistration = {
  identifier: string
  page: Page
}

const browsers = new Map<number, BrowserEntry>()
const ghostRegistrations = new Map<string, GhostRegistration>()
const portQueues = new Map<number, Promise<void>>()
let activeInstances = 0
let acceptingConnections = false
let lifecycleVersion = 0

async function persistentBrowser(port: number): Promise<Browser> {
  if (!acceptingConnections) throw new Error("Browser plugin has been disposed")
  const cached = browsers.get(port)
  if (cached?.browser.connected) return cached.browser
  if (cached) browsers.delete(port)

  const browser = await connect(port)
  const entry = { browser }
  browser.on("disconnected", () => {
    if (browsers.get(port) === entry) browsers.delete(port)
    for (const [id, registration] of ghostRegistrations) {
      if (registration.page.browser() === browser) ghostRegistrations.delete(id)
    }
  })
  browsers.set(port, entry)
  return browser
}

function serialize<T>(port: number, fn: () => Promise<T>): Promise<T> {
  if (!acceptingConnections) return Promise.reject(new Error("Browser plugin has been disposed"))
  const previous = portQueues.get(port) ?? Promise.resolve()
  const result = previous.then(fn, fn)
  const tail = result.then(
    () => undefined,
    () => undefined,
  )
  portQueues.set(port, tail)
  void tail.then(() => {
    if (portQueues.get(port) === tail) portQueues.delete(port)
  })
  return result
}

export async function disconnectAll(): Promise<void> {
  await Promise.allSettled([...new Set(portQueues.values())])
  const entries = [...browsers.entries()]
  browsers.clear()
  portQueues.clear()
  for (const [port, { browser }] of entries) {
    try {
      const pages = await browser.pages()
      await Promise.allSettled(pages.map((page) => destroyGhost(page)))
      clearTasks(port)
    } catch {
      /* disconnect even if a target disappears during visual cleanup */
    }
    try {
      browser.disconnect()
    } catch {
      /* ignore */
    }
  }
  ghostRegistrations.clear()
  clearTasks()
}

export function activate(): () => Promise<void> {
  activeInstances += 1
  acceptingConnections = true
  lifecycleVersion += 1
  let released = false

  return async () => {
    if (released) return
    released = true
    activeInstances -= 1
    if (activeInstances > 0) return

    acceptingConnections = false
    const shutdownVersion = ++lifecycleVersion
    await Promise.allSettled([...new Set(portQueues.values())])
    if (activeInstances > 0 || lifecycleVersion !== shutdownVersion) return
    await disconnectAll()
  }
}

function isToolPage(p: Page): boolean {
  try {
    const u = p.url() || ""
    return (
      !!u &&
      !u.startsWith("chrome-extension://") &&
      !u.startsWith("devtools://") &&
      !u.startsWith("chrome://")
    )
  } catch {
    return false
  }
}

function targetId(page: Page): string | null {
  try {
    return ((page.target() as unknown as { _targetId?: string })._targetId) || null
  } catch {
    return null
  }
}

export async function ensureGhost(page: Page): Promise<boolean> {
  if (!GHOST_ENABLED || page.isClosed()) return false
  const id = targetId(page)
  if (!id) return false

  const existing = ghostRegistrations.get(id)
  if (existing) {
    existing.page = page
    return true
  }

  await page
    .evaluate(() => {
      delete (window as Window & { __ghostDisabled?: boolean }).__ghostDisabled
    })
    .catch(() => {})
  const registration = await page.evaluateOnNewDocument(GHOST_SOURCE, {
    owner: GHOST_OWNER,
    actionDelay: GHOST_ACTION_DELAY,
    guidanceSecret: GHOST_GUIDANCE_SECRET,
  })
  const entry = { identifier: registration.identifier, page }
  ghostRegistrations.set(id, entry)
  page.once("close", () => {
    if (ghostRegistrations.get(id) === entry) ghostRegistrations.delete(id)
  })
  await page
    .evaluate(GHOST_SOURCE, {
      owner: GHOST_OWNER,
      actionDelay: GHOST_ACTION_DELAY,
      guidanceSecret: GHOST_GUIDANCE_SECRET,
    })
    .catch(() => {})
  return true
}

export async function destroyGhost(page: Page): Promise<void> {
  const id = targetId(page)
  const registration = id ? ghostRegistrations.get(id) : undefined
  await page
    .evaluate((owner) => {
      const ghostWindow = window as Window & {
        __ghostDisabled?: boolean
        __opencodeBrowserGhost?: GhostRuntime
      }
      ghostWindow.__ghostDisabled = true
      if (ghostWindow.__opencodeBrowserGhost?.owner === owner) {
        ghostWindow.__opencodeBrowserGhost.destroy()
      }
    }, GHOST_OWNER)
    .catch(() => {})
  if (registration) {
    await page
      .removeScriptToEvaluateOnNewDocument(registration.identifier)
      .catch(() => {})
  }
  if (id && ghostRegistrations.get(id) === registration) ghostRegistrations.delete(id)
}

const consumedGuidanceSignatures = new Set<string>()

function verifiedGuidance(
  value: SignedGhostGuidance | null,
  consume: boolean,
): GhostGuidance | null {
  if (!value) return null
  if (consumedGuidanceSignatures.has(value.signature)) return null
  const expected = createHmac("sha256", GHOST_GUIDANCE_SECRET)
    .update(JSON.stringify(value.guidance))
    .digest()
  const actual = Buffer.from(value.signature, "base64")
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  if (consume) {
    consumedGuidanceSignatures.add(value.signature)
    if (consumedGuidanceSignatures.size > 1000) {
      consumedGuidanceSignatures.delete(consumedGuidanceSignatures.values().next().value!)
    }
  }
  return value.guidance
}

export async function collectGhostGuidance(consume = false): Promise<GhostGuidance | null> {
  const guidance: GhostGuidance[] = []
  for (const { browser } of browsers.values()) {
    if (!browser.connected) continue
    const pages = await browser.pages().catch(() => [])
    const values = await Promise.all(
      pages.filter(isToolPage).map((page) =>
        page
          .evaluate(({ owner, consume }) => {
            const runtime = (window as Window & { __opencodeBrowserGhost?: GhostRuntime })
              .__opencodeBrowserGhost
            return runtime?.owner === owner ? runtime.guidance(consume) : null
          }, { owner: GHOST_OWNER, consume })
          .catch(() => null),
      ),
    )
    for (const value of values) {
      const verified = verifiedGuidance(value, consume)
      if (verified) guidance.push(verified)
    }
  }
  return guidance.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
}

export async function withPage<T>(
  fn: (page: Page, browser: Browser) => Promise<T>,
  {
    port,
    tabId = null,
    newTab = false,
  }: { port?: number; tabId?: string | null; newTab?: boolean } = {},
): Promise<T> {
  const resolvedPort = resolvePort(port)
  return serialize(resolvedPort, async () => {
    const browser = await persistentBrowser(resolvedPort)
    const pages = await browser.pages()
    const state = loadState()
    const wantId = tabId || (state.lastTargetId as string | undefined) || null

    let page: Page | undefined
    if (wantId) {
      page = pages.find((p) => {
        try {
          const id = targetId(p)
          return id === wantId || (p.url() || "").includes(String(wantId))
        } catch {
          return false
        }
      })
    }
    if (!page && newTab) page = await browser.newPage()
    if (!page) {
      page =
        [...pages].reverse().find(isToolPage) || pages[0] || (await browser.newPage())
    }

    await ensureGhost(page)

    try {
      await page.bringToFront()
    } catch {
      /* ignore */
    }

    const result = await fn(page, browser)

    try {
      saveState({
        lastTargetId: targetId(page),
        lastUrl: page.url(),
        lastTitle: await page.title().catch(() => ""),
      })
    } catch {
      /* ignore */
    }

    return result
  })
}

export async function fastFill(page: Page, selector: string, value: string): Promise<boolean> {
  try {
    return await page.$eval(
      selector,
      (element, nextValue) => {
        const input =
          element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? element
            : null
        if (!input || input.disabled || input.readOnly) return false

        input.focus()
        const prototype =
          input instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
        if (!setter) return false
        setter.call(input, nextValue)
        input.dispatchEvent(new Event("input", { bubbles: true }))
        input.dispatchEvent(new Event("change", { bubbles: true }))
        return input.value === nextValue
      },
      value,
    )
  } catch {
    return false
  }
}

export async function dismissCookies(page: Page): Promise<string[]> {
  const hit: string[] = []
  const selectors = [
    "#onetrust-accept-btn-handler",
    "#onetrust-reject-all-handler",
    'button[aria-label*="Accept"]',
    "button#accept-cookies",
  ]
  for (const sel of selectors) {
    try {
      const el = await page.$(sel)
      if (el) {
        await el.click().catch(() => {})
        hit.push(sel)
        await new Promise((r) => setTimeout(r, 200))
      }
    } catch {
      /* ignore */
    }
  }
  try {
    await page.evaluate(() => {
      const re = /^(Принять|Accept all|Accept|I agree|Agree|OK|Got it)$/i
      for (const b of document.querySelectorAll("button")) {
        const t = (b.textContent || "").trim()
        if (re.test(t) && (b as HTMLElement).offsetParent !== null) {
          ;(b as HTMLElement).click()
          break
        }
      }
      document.getElementById("onetrust-banner-sdk")?.remove()
      document.getElementById("onetrust-consent-sdk")?.remove()
    })
  } catch {
    /* ignore */
  }
  return hit
}

export function shotPath(name = "shot"): string {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const safe = String(name)
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 60)
  return path.join(SHOT_DIR, `${safe}-${Date.now()}.png`)
}

export { STATE_PATH, DATA_DIR }
