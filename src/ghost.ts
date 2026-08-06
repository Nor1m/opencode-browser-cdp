export type GhostTaskStatus = "queued" | "running" | "done" | "failed"

export type GhostTask = {
  id: number
  label: string
  status: GhostTaskStatus
}

export type GhostTarget = {
  selector?: string
  active?: boolean
  label: string
}

export type GhostUpdate = {
  tasks: GhostTask[]
  target?: GhostTarget
}

export type GhostGuidanceTarget = {
  selector: string
  tag: string
  role: string
  ariaLabel: string
  text: string
  html: string
}

export type GhostGuidance = {
  instruction: string
  target?: GhostGuidanceTarget
  url: string
  title: string
  updatedAt: number
}

export type SignedGhostGuidance = {
  guidance: GhostGuidance
  signature: string
}

export const GHOST_THEME_NAMES = [
  "carbon",
  "graphite",
  "obsidian",
  "slate",
  "ink",
  "paper",
  "porcelain",
  "fog",
  "stone",
  "pearl",
] as const
export type GhostTheme = (typeof GHOST_THEME_NAMES)[number]
export type GhostThemePreference = { name: GhostTheme; updatedAt: number }
export const isGhostTheme = (value: unknown): value is GhostTheme =>
  GHOST_THEME_NAMES.includes(value as GhostTheme)

export type GhostRuntime = {
  owner: string
  mount: () => boolean
  update: (next: GhostUpdate) => Promise<boolean>
  actionDelay: () => number
  guidance: (consume?: boolean) => SignedGhostGuidance | null
  theme: () => GhostThemePreference
  setTheme: (preference: GhostThemePreference) => boolean
  restoreFocus: () => boolean
  hide: () => string | null
  show: (visibility: string) => void
  remove: () => void
  destroy: () => void
}

export const GHOST_OWNER = `opencode-${process.pid}-${Math.random().toString(36).slice(2)}`
export const GHOST_GUIDANCE_SECRET = randomBytes(32).toString("base64url")
export const GHOST_ENABLED = process.env.OPENCODE_BROWSER_VISUALS !== "0"

const configuredActionDelay = Number(process.env.OPENCODE_BROWSER_ACTION_DELAY ?? 350)
export const GHOST_ACTION_DELAY = Number.isFinite(configuredActionDelay)
  ? Math.min(Math.max(configuredActionDelay, 0), 2000)
  : 350

/** Serialized by Puppeteer and installed before every document in a managed target. */
export const GHOST_SOURCE = (config: {
  owner: string
  actionDelay: number
  guidanceSecret: string
  theme: GhostTheme
  themeUpdatedAt: number
}) => {
  if (window !== window.top) return

  type GhostHost = HTMLElement & {
    __opencodeCleanup?: () => void
    __opencodeFocusCleanup?: () => void
    __opencodeContextCleanup?: () => void
    __opencodePreviousFocus?: HTMLElement
  }
  type GhostWindow = Window & {
    __ghostDisabled?: boolean
    __opencodeBrowserGhost?: GhostRuntime
  }
  type UiLocale = "ru" | "en" | "zh"
  type GhostWish = {
    id: number
    kind: "instruction" | "target"
    text: string
    status: "pending" | "sent"
  }

  const ghostWindow = window as GhostWindow
  if (ghostWindow.__ghostDisabled) return

  const previous = ghostWindow.__opencodeBrowserGhost
  if (previous?.owner === config.owner) {
    previous.mount()
    return
  }
  previous?.remove()

  const storageKey = `__opencode_browser_ghost:${config.owner}`
  const hostId = "__opencode_browser_visuals"
  let tasks: GhostTask[] = []
  let target: GhostTarget | undefined
  let actionDelay = config.actionDelay
  let guidance: GhostGuidance = {
    instruction: "",
    url: "",
    title: "",
    updatedAt: 0,
  }
  let promptDraft = ""
  let wishes: GhostWish[] = []
  let storedGuidance: SignedGhostGuidance | null = null
  let cursorPosition: { x: number; y: number } | null = null
  let hudPosition: { x: number; y: number } | null = null
  let mountObserver: MutationObserver | null = null
  let contextCandidate: Element | null = null

  const labelSets = {
    ru: {
        prompt: "Доп. пожелание для ИИ…",
        send: "Отправить пожелание",
        lookHere: "Смотри сюда",
        pace: "Скорость",
        theme: "Тема",
      },
    en: {
      prompt: "Additional instruction for AI…",
      send: "Send instruction",
      lookHere: "Look here",
      pace: "Pace",
      theme: "Theme",
    },
    zh: {
      prompt: "给 AI 的附加指令…",
      send: "发送指令",
      lookHere: "看这里",
      pace: "速度",
      theme: "主题",
    },
  }
  const detectLocale = (): UiLocale => {
    const language = (document.documentElement?.lang || navigator.language || "en").toLowerCase()
    return language.startsWith("ru") ? "ru" : language.startsWith("zh") ? "zh" : "en"
  }
  let uiLocale = detectLocale()
  let localeExplicit = false
  let labels = labelSets[uiLocale]
  const themeSets: Record<GhostTheme, {
    bg: string
    fg: string
    muted: string
    line: string
    surface: string
    button: string
    buttonFg: string
    shadow: string
  }> = {
    carbon: { bg: "#0f1010", fg: "#f2f2f0", muted: "#8b8f8e", line: "#2b2e2e", surface: "#181a1a", button: "#f2f2f0", buttonFg: "#0f1010", shadow: "0 12px 28px rgba(0,0,0,.26)" },
    graphite: { bg: "#161616", fg: "#f5f5f5", muted: "#999", line: "#383838", surface: "#202020", button: "#f5f5f5", buttonFg: "#161616", shadow: "0 12px 28px rgba(0,0,0,.24)" },
    obsidian: { bg: "#090a0c", fg: "#e7e8ec", muted: "#838793", line: "#24262d", surface: "#121318", button: "#e7e8ec", buttonFg: "#090a0c", shadow: "0 12px 28px rgba(0,0,0,.3)" },
    slate: { bg: "#151719", fg: "#eceff1", muted: "#969da3", line: "#34383d", surface: "#202326", button: "#eceff1", buttonFg: "#151719", shadow: "0 12px 28px rgba(0,0,0,.24)" },
    ink: { bg: "#121113", fg: "#f1eef2", muted: "#968f99", line: "#302d31", surface: "#1b191c", button: "#f1eef2", buttonFg: "#121113", shadow: "0 12px 28px rgba(0,0,0,.26)" },
    paper: { bg: "#fbfaf7", fg: "#252421", muted: "#77736d", line: "#d9d6cf", surface: "#f2f0eb", button: "#252421", buttonFg: "#fbfaf7", shadow: "0 10px 26px rgba(0,0,0,.1)" },
    porcelain: { bg: "#ffffff", fg: "#171717", muted: "#737373", line: "#e2e2e2", surface: "#f7f7f7", button: "#171717", buttonFg: "#ffffff", shadow: "0 10px 26px rgba(0,0,0,.1)" },
    fog: { bg: "#eef0ef", fg: "#202422", muted: "#68706c", line: "#cbd0cd", surface: "#e4e7e5", button: "#202422", buttonFg: "#eef0ef", shadow: "0 10px 26px rgba(0,0,0,.1)" },
    stone: { bg: "#f2f1ef", fg: "#242321", muted: "#736f69", line: "#cfccc7", surface: "#e7e5e2", button: "#242321", buttonFg: "#f2f1ef", shadow: "0 10px 26px rgba(0,0,0,.1)" },
    pearl: { bg: "#f8f8fa", fg: "#1e1e24", muted: "#70707b", line: "#d9d9df", surface: "#eeeef2", button: "#1e1e24", buttonFg: "#f8f8fa", shadow: "0 10px 26px rgba(0,0,0,.1)" },
  }
  let uiTheme: GhostTheme = config.theme
  let themeUpdatedAt = config.themeUpdatedAt

  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) || "null") as {
      tasks?: GhostTask[]
      actionDelay?: number
      cursorPosition?: { x: number; y: number }
      hudPosition?: { x: number; y: number }
      promptDraft?: string
      wishes?: GhostWish[]
      uiLocale?: UiLocale
      localeExplicit?: boolean
      uiTheme?: GhostTheme
      themeUpdatedAt?: number
      pendingGuidance?: SignedGhostGuidance
    } | null
    if (Array.isArray(stored?.tasks)) tasks = stored.tasks
    if (Number.isFinite(stored?.actionDelay)) {
      actionDelay = Math.min(Math.max(Number(stored?.actionDelay), 0), 2000)
    }
    if (Number.isFinite(stored?.cursorPosition?.x) && Number.isFinite(stored?.cursorPosition?.y)) {
      cursorPosition = stored?.cursorPosition ?? null
    }
    if (Number.isFinite(stored?.hudPosition?.x) && Number.isFinite(stored?.hudPosition?.y)) {
      hudPosition = stored?.hudPosition ?? null
    }
    if (typeof stored?.promptDraft === "string") promptDraft = stored.promptDraft.slice(0, 2000)
    if (Array.isArray(stored?.wishes)) {
      wishes = stored.wishes
        .filter((wish) => wish && typeof wish.text === "string")
        .map((wish, index) => ({
          id: Number.isFinite(wish.id) ? wish.id : Date.now() + index,
          kind: wish.kind === "target" ? "target" as const : "instruction" as const,
          text: wish.text.slice(0, 240),
          status: wish.status === "pending" ? "pending" as const : "sent" as const,
        }))
        .slice(-8)
    }
    if (stored?.uiLocale === "ru" || stored?.uiLocale === "en" || stored?.uiLocale === "zh") {
      uiLocale = stored.uiLocale
      labels = labelSets[uiLocale]
      localeExplicit = stored.localeExplicit === true
    }
    if (
      stored?.uiTheme &&
      Object.prototype.hasOwnProperty.call(themeSets, stored.uiTheme) &&
      Number.isFinite(stored.themeUpdatedAt) &&
      Number(stored.themeUpdatedAt) >= themeUpdatedAt
    ) {
      uiTheme = stored.uiTheme
      themeUpdatedAt = Number(stored.themeUpdatedAt)
    }
    if (
      stored?.pendingGuidance?.guidance &&
      typeof stored.pendingGuidance.signature === "string" &&
      typeof stored.pendingGuidance.guidance.instruction === "string" &&
      JSON.stringify(stored.pendingGuidance.guidance).length <= 8192
    ) {
      storedGuidance = stored.pendingGuidance
    }
  } catch {
    /* storage is unavailable on some internal and opaque origins */
  }

  const save = () => {
    try {
      const current = guidance.instruction.trim() || guidance.target
        ? {
            ...guidance,
            instruction: guidance.instruction.trim(),
            target: guidance.target ? { ...guidance.target } : undefined,
          }
        : null
      const pendingGuidance = current
        ? { guidance: current, signature: signGuidance(current) }
        : undefined
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          tasks,
          actionDelay,
          cursorPosition,
          hudPosition,
          promptDraft,
          wishes,
          uiLocale: localeExplicit ? uiLocale : undefined,
          localeExplicit,
          uiTheme,
          themeUpdatedAt,
          pendingGuidance,
        }),
      )
    } catch {
      /* keep the runtime in memory when storage is unavailable */
    }
  }

  const sha256 = (input: Uint8Array) => {
    const constants = new Uint32Array([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
      0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
      0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
      0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
      0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
      0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
      0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
      0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
      0xc67178f2,
    ])
    const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits))
    const bitLength = input.length * 8
    const size = Math.ceil((input.length + 9) / 64) * 64
    const data = new Uint8Array(size)
    data.set(input)
    data[input.length] = 0x80
    const view = new DataView(data.buffer)
    view.setUint32(size - 8, Math.floor(bitLength / 0x100000000))
    view.setUint32(size - 4, bitLength >>> 0)
    const hash = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ])
    const words = new Uint32Array(64)
    for (let offset = 0; offset < size; offset += 64) {
      for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4)
      for (let index = 16; index < 64; index += 1) {
        const a = words[index - 15]!
        const b = words[index - 2]!
        const s0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)
        const s1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10)
        words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0
      }
      let [a, b, c, d, e, f, g, h] = hash
      for (let index = 0; index < 64; index += 1) {
        const sigma1 = rotate(e!, 6) ^ rotate(e!, 11) ^ rotate(e!, 25)
        const choice = (e! & f!) ^ (~e! & g!)
        const first = (h! + sigma1 + choice + constants[index]! + words[index]!) >>> 0
        const sigma0 = rotate(a!, 2) ^ rotate(a!, 13) ^ rotate(a!, 22)
        const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!)
        const second = (sigma0 + majority) >>> 0
        h = g
        g = f
        f = e
        e = (d! + first) >>> 0
        d = c
        c = b
        b = a
        a = (first + second) >>> 0
      }
      hash[0] = (hash[0]! + a!) >>> 0
      hash[1] = (hash[1]! + b!) >>> 0
      hash[2] = (hash[2]! + c!) >>> 0
      hash[3] = (hash[3]! + d!) >>> 0
      hash[4] = (hash[4]! + e!) >>> 0
      hash[5] = (hash[5]! + f!) >>> 0
      hash[6] = (hash[6]! + g!) >>> 0
      hash[7] = (hash[7]! + h!) >>> 0
    }
    const output = new Uint8Array(32)
    const outputView = new DataView(output.buffer)
    hash.forEach((value, index) => outputView.setUint32(index * 4, value))
    return output
  }

  const signGuidance = (value: GhostGuidance) => {
    const encode = (text: string) => {
      const bytes: number[] = []
      for (let index = 0; index < text.length; index += 1) {
        let point = text.charCodeAt(index)
        if (point >= 0xd800 && point <= 0xdbff && index + 1 < text.length) {
          const low = text.charCodeAt(index + 1)
          if (low >= 0xdc00 && low <= 0xdfff) {
            point = 0x10000 + ((point - 0xd800) << 10) + (low - 0xdc00)
            index += 1
          }
        }
        if (point <= 0x7f) bytes.push(point)
        else if (point <= 0x7ff) bytes.push(0xc0 | (point >>> 6), 0x80 | (point & 0x3f))
        else if (point <= 0xffff) {
          bytes.push(0xe0 | (point >>> 12), 0x80 | ((point >>> 6) & 0x3f), 0x80 | (point & 0x3f))
        } else {
          bytes.push(
            0xf0 | (point >>> 18),
            0x80 | ((point >>> 12) & 0x3f),
            0x80 | ((point >>> 6) & 0x3f),
            0x80 | (point & 0x3f),
          )
        }
      }
      return new Uint8Array(bytes)
    }
    let key = encode(config.guidanceSecret)
    if (key.length > 64) key = sha256(key)
    const innerPad = new Uint8Array(64)
    const outerPad = new Uint8Array(64)
    for (let index = 0; index < 64; index += 1) {
      innerPad[index] = (key[index] ?? 0) ^ 0x36
      outerPad[index] = (key[index] ?? 0) ^ 0x5c
    }
    const message = encode(JSON.stringify(value))
    const inner = new Uint8Array(innerPad.length + message.length)
    inner.set(innerPad)
    inner.set(message, innerPad.length)
    const innerHash = sha256(inner)
    const outer = new Uint8Array(outerPad.length + innerHash.length)
    outer.set(outerPad)
    outer.set(innerHash, outerPad.length)
    return btoa(String.fromCharCode(...sha256(outer)))
  }

  if (
    storedGuidance &&
    storedGuidance.signature === signGuidance(storedGuidance.guidance)
  ) {
    guidance = storedGuidance.guidance
  }
  storedGuidance = null

  const findHost = () =>
    document.querySelector(
      `[data-opencode-browser-owner="${config.owner}"]`,
    ) as GhostHost | null

  const add = <K extends keyof HTMLElementTagNameMap>(
    root: ShadowRoot,
    tag: K,
    id: string,
    css: string,
    parent: Node = root,
  ): HTMLElementTagNameMap[K] => {
    const element = document.createElement(tag)
    element.id = id
    element.style.cssText = css
    parent.appendChild(element)
    return element
  }

  const build = (host: GhostHost, root: ShadowRoot) => {
    root.replaceChildren()
    const focus = add(
      root,
      "div",
      "focus",
      "position:fixed;left:0;top:0;z-index:2;width:0;height:0;opacity:0;border:2px solid #a3e635;border-radius:6px;box-shadow:0 0 0 2px rgba(0,0,0,.7);transform:translate3d(0,0,0);transition:transform 140ms ease,width 140ms ease,height 140ms ease,opacity 80ms ease;box-sizing:border-box",
    )
    add(
      root,
      "span",
      "focus-label",
      "position:absolute;left:-2px;bottom:calc(100% + 6px);max-width:280px;padding:4px 7px;overflow:hidden;color:#f4f4f5;background:#111;border:1px solid #3f3f46;border-radius:5px;font:600 11px/1.25 ui-monospace,SFMono-Regular,Consolas,monospace;text-overflow:ellipsis;white-space:nowrap;box-sizing:border-box",
      focus,
    )

    const cursor = add(
      root,
      "div",
      "cursor",
      "position:fixed;left:0;top:0;z-index:2;width:24px;height:30px;opacity:0;transform:translate3d(0,0,0);transition:transform 180ms cubic-bezier(.2,.8,.2,1),opacity 100ms ease;filter:drop-shadow(0 3px 5px rgba(0,0,0,.35))",
    )
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("viewBox", "0 0 24 30")
    svg.style.cssText = "display:block;width:100%;height:100%"
    const cursorPath = document.createElementNS("http://www.w3.org/2000/svg", "path")
    cursorPath.setAttribute("d", "M2 1.5 21 17l-8.1 1.2 4.6 8.2-4.2 2.1-4.5-8.2L3 26Z")
    cursorPath.setAttribute("fill", "#f4f4f5")
    cursorPath.setAttribute("stroke", "#111")
    cursorPath.setAttribute("stroke-width", "2")
    cursorPath.setAttribute("stroke-linejoin", "round")
    svg.appendChild(cursorPath)
    cursor.appendChild(svg)

    const hud = add(
      root,
      "aside",
      "hud",
      "position:fixed;top:16px;right:16px;z-index:3;width:min(320px,calc(100vw - 32px));overflow:hidden;color:#e4e4e7;background:#0d0d0d;border:1px solid #27272a;border-radius:5px;box-shadow:0 12px 28px rgba(0,0,0,.35);font:12px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;pointer-events:auto;box-sizing:border-box",
    )
    const head = add(
      root,
      "div",
      "hud-head",
      "display:flex;align-items:center;gap:8px;padding:8px 9px;cursor:move;touch-action:none;user-select:none;box-sizing:border-box",
      hud,
    )
    const title = add(
      root,
      "span",
      "hud-title",
      "margin-right:auto;color:#fafafa;font-weight:700;letter-spacing:-.02em",
      head,
    )
    title.textContent = "opencode / browser"
    const localeSwitch = add(
      root,
      "div",
      "locale-switch",
      "display:flex;gap:2px;padding:2px;background:#18181b;border:1px solid #27272a;border-radius:5px;cursor:default",
      head,
    )
    for (const [locale, text] of [["ru", "RU"], ["en", "EN"], ["zh", "中文"]] as const) {
      const button = document.createElement("button")
      button.type = "button"
      button.dataset.locale = locale
      button.textContent = text
      button.style.cssText =
        "padding:2px 5px;color:#71717a;background:transparent;border:0;border-radius:3px;cursor:pointer;font:600 9px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace"
      button.addEventListener("pointerdown", (event) => event.stopPropagation())
      button.addEventListener("click", (event) => {
        if (!event.isTrusted) return
        uiLocale = locale
        localeExplicit = true
        labels = labelSets[uiLocale]
        save()
        syncStaticLabels(root)
        renderWishes(root)
      })
      localeSwitch.appendChild(button)
    }
    add(root, "span", "hud-count", "display:none;color:#71717a;font-size:10px", head)
    head.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return
      const rect = hud.getBoundingClientRect()
      const offsetX = event.clientX - rect.left
      const offsetY = event.clientY - rect.top
      head.setPointerCapture(event.pointerId)
      const move = (next: PointerEvent) => {
        const x = Math.min(Math.max(next.clientX - offsetX, 0), Math.max(0, innerWidth - rect.width))
        const y = Math.min(Math.max(next.clientY - offsetY, 0), Math.max(0, innerHeight - 44))
        hud.style.left = `${x}px`
        hud.style.top = `${y}px`
        hud.style.right = "auto"
        hudPosition = { x, y }
      }
      const stop = () => {
        head.removeEventListener("pointermove", move)
        head.removeEventListener("pointerup", stop)
        head.removeEventListener("pointercancel", stop)
        save()
      }
      head.addEventListener("pointermove", move)
      head.addEventListener("pointerup", stop)
      head.addEventListener("pointercancel", stop)
    })
    const progress = add(root, "div", "progress", "height:2px;background:#18181b", hud)
    add(
      root,
      "i",
      "progress-bar",
      "display:block;height:100%;width:0;background:#a3e635;transition:width 140ms ease",
      progress,
    )
    add(
      root,
      "div",
      "tasks",
      "display:grid;gap:1px;padding:4px 6px;max-height:220px;overflow:hidden;box-sizing:border-box",
      hud,
    )
    const guidancePanel = add(
      root,
      "div",
      "guidance",
      "display:grid;gap:6px;padding:8px;border-top:1px solid #27272a;box-sizing:border-box",
      hud,
    )
    const prompt = document.createElement("textarea")
    prompt.id = "guidance-prompt"
    prompt.rows = 2
    prompt.maxLength = 2000
    prompt.placeholder = labels.prompt
    prompt.style.cssText =
      "width:100%;min-height:44px;max-height:100px;resize:vertical;padding:7px 8px;color:#e4e4e7;background:#18181b;border:1px solid #27272a;border-radius:5px;outline:none;font:12px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;box-sizing:border-box"
    prompt.addEventListener("input", () => {
      promptDraft = prompt.value.slice(0, 2000)
      save()
    })
    const guidanceActions = document.createElement("div")
    guidanceActions.style.cssText = "display:flex;gap:6px;align-items:center"
    const send = document.createElement("button")
    send.id = "send-guidance"
    send.type = "button"
    send.textContent = labels.send
    send.style.cssText =
      "margin-left:auto;padding:6px 9px;color:#0d0d0d;background:#f4f4f5;border:0;border-radius:5px;cursor:pointer;font:700 11px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace"
    send.addEventListener("click", (event) => {
      if (!event.isTrusted) return
      const instruction = prompt.value.trim()
      if (!instruction) return
      wishes = [
        ...wishes,
        {
          id: Date.now(),
          kind: "instruction",
          text: instruction.slice(0, 240),
          status: "pending",
        } as GhostWish,
      ].slice(-8)
      const pendingInstructions = wishes
        .filter((wish) => wish.kind === "instruction" && wish.status === "pending")
        .map((wish) => wish.text)
      guidance = {
        ...guidance,
        instruction: pendingInstructions.join("\n"),
        url: location.href,
        title: document.title,
        updatedAt: Date.now(),
      }
      promptDraft = ""
      prompt.value = ""
      save()
      syncGuidance(root)
    })
    guidanceActions.append(send)
    const wishesElement = document.createElement("div")
    wishesElement.id = "wishes"
    wishesElement.style.cssText = "display:none;gap:3px"
    guidancePanel.append(prompt, guidanceActions, wishesElement)
    const themeSettings = add(
      root,
      "label",
      "theme-row",
      "display:grid;grid-template-columns:auto 1fr;gap:8px;align-items:center;padding:7px 9px;border-top:1px solid #27272a;box-sizing:border-box",
      hud,
    )
    const themeLabel = document.createElement("span")
    themeLabel.id = "theme-label"
    const themeSelect = document.createElement("select")
    themeSelect.id = "theme-select"
    themeSelect.style.cssText =
      "min-width:0;width:100%;padding:4px 6px;border:1px solid;border-radius:4px;outline:none;font:10px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace"
    const themeNames: Array<[GhostTheme, string]> = [
      ["carbon", "Carbon · dark"],
      ["graphite", "Graphite · dark"],
      ["obsidian", "Obsidian · dark"],
      ["slate", "Slate · dark"],
      ["ink", "Ink · dark"],
      ["paper", "Paper · light"],
      ["porcelain", "Porcelain · light"],
      ["fog", "Fog · light"],
      ["stone", "Stone · light"],
      ["pearl", "Pearl · light"],
    ]
    for (const [value, text] of themeNames) {
      const option = document.createElement("option")
      option.value = value
      option.textContent = text
      themeSelect.appendChild(option)
    }
    themeSelect.value = uiTheme
    themeSelect.addEventListener("change", () => {
      if (!Object.prototype.hasOwnProperty.call(themeSets, themeSelect.value)) return
      uiTheme = themeSelect.value as GhostTheme
      themeUpdatedAt = Date.now()
      save()
      applyTheme(root)
      renderTasks(root)
      renderWishes(root)
    })
    themeSettings.append(themeLabel, themeSelect)
    const settings = add(
      root,
      "label",
      "pace",
      "display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;padding:7px 9px;color:#71717a;border-top:1px solid #27272a;pointer-events:auto;box-sizing:border-box",
      hud,
    )
    const paceLabel = document.createElement("span")
    paceLabel.textContent = labels.pace
    const slider = document.createElement("input")
    slider.id = "pace-slider"
    slider.type = "range"
    slider.min = "0"
    slider.max = "2000"
    slider.step = "50"
    slider.value = String(actionDelay)
    slider.style.cssText = "width:100%;accent-color:#a3e635;cursor:pointer"
    const paceValue = document.createElement("output")
    paceValue.id = "pace-value"
    paceValue.textContent = `${slider.value} ms`
    paceValue.style.cssText = "min-width:58px;text-align:right;color:#a1a1aa"
    slider.addEventListener("input", () => {
      actionDelay = Number(slider.value)
      paceValue.textContent = `${slider.value} ms`
      save()
    })
    slider.addEventListener("pointerdown", () => {
      const active = document.activeElement
      if (active instanceof HTMLElement && active !== host) host.__opencodePreviousFocus = active
    })
    settings.append(paceLabel, slider, paceValue)

    const contextMenu = add(
      root,
      "div",
      "context-menu",
      "display:none;position:fixed;left:0;top:0;z-index:4;padding:4px;color:#e4e4e7;background:#0d0d0d;border:1px solid #3f3f46;border-radius:6px;box-shadow:0 10px 24px rgba(0,0,0,.4);pointer-events:auto;box-sizing:border-box",
    )
    const lookHere = document.createElement("button")
    lookHere.id = "context-look-here"
    lookHere.type = "button"
    lookHere.textContent = labels.lookHere
    lookHere.style.cssText =
      "display:block;width:100%;padding:6px 9px;color:#e4e4e7;background:transparent;border:0;border-radius:4px;cursor:pointer;text-align:left;font:600 12px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap"
    lookHere.addEventListener("pointerenter", () => {
      lookHere.style.background = themeSets[uiTheme].surface
    })
    lookHere.addEventListener("pointerleave", () => {
      lookHere.style.background = "transparent"
    })
    lookHere.addEventListener("click", (event) => {
      if (!event.isTrusted || !contextCandidate) return
      event.preventDefault()
      event.stopPropagation()
      selectContextTarget(root, contextCandidate)
      contextCandidate = null
      contextMenu.style.display = "none"
    })
    contextMenu.appendChild(lookHere)

    const closeContextMenu = (event?: Event) => {
      if (event && event.composedPath().includes(contextMenu)) return
      contextCandidate = null
      contextMenu.style.display = "none"
    }
    const openContextMenu = (event: MouseEvent) => {
      if (!event.isTrusted || event.composedPath().includes(host)) return
      const element = event.composedPath().find((item) => item instanceof Element) as Element | undefined
      if (!element) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      contextCandidate = element
      contextMenu.style.visibility = "hidden"
      contextMenu.style.display = "block"
      const rect = contextMenu.getBoundingClientRect()
      const x = Math.min(event.clientX, Math.max(0, innerWidth - rect.width - 4))
      const y = Math.min(event.clientY, Math.max(0, innerHeight - rect.height - 4))
      contextMenu.style.left = `${Math.max(0, x)}px`
      contextMenu.style.top = `${Math.max(0, y)}px`
      contextMenu.style.visibility = "visible"
      previewElement(root, element, labels.lookHere)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeContextMenu()
    }
    const blockRightButton = (event: MouseEvent | PointerEvent) => {
      if (event.button !== 2 || event.composedPath().includes(host)) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    window.addEventListener("pointerdown", blockRightButton, true)
    window.addEventListener("mousedown", blockRightButton, true)
    window.addEventListener("pointerup", blockRightButton, true)
    window.addEventListener("mouseup", blockRightButton, true)
    window.addEventListener("auxclick", blockRightButton, true)
    window.addEventListener("contextmenu", openContextMenu, true)
    window.addEventListener("pointerdown", closeContextMenu, true)
    window.addEventListener("keydown", closeOnEscape, true)
    host.__opencodeContextCleanup = () => {
      window.removeEventListener("pointerdown", blockRightButton, true)
      window.removeEventListener("mousedown", blockRightButton, true)
      window.removeEventListener("pointerup", blockRightButton, true)
      window.removeEventListener("mouseup", blockRightButton, true)
      window.removeEventListener("auxclick", blockRightButton, true)
      window.removeEventListener("contextmenu", openContextMenu, true)
      window.removeEventListener("pointerdown", closeContextMenu, true)
      window.removeEventListener("keydown", closeOnEscape, true)
    }

    const trackPageFocus = (event: FocusEvent) => {
      const focused = event.composedPath()[0]
      if (focused instanceof HTMLElement && focused !== host && !root.contains(focused)) {
        host.__opencodePreviousFocus = focused
      }
    }
    document.addEventListener("focusin", trackPageFocus, true)
    host.__opencodeFocusCleanup = () => document.removeEventListener("focusin", trackPageFocus, true)
  }

  const applyTheme = (root: ShadowRoot) => {
    const palette = themeSets[uiTheme]
    const hud = root.getElementById("hud") as HTMLElement
    hud.style.color = palette.fg
    hud.style.background = palette.bg
    hud.style.borderColor = palette.line
    hud.style.boxShadow = palette.shadow
    ;(root.getElementById("hud-title") as HTMLElement).style.color = palette.fg
    ;(root.getElementById("hud-count") as HTMLElement).style.color = palette.muted
    const localeSwitch = root.getElementById("locale-switch") as HTMLElement
    localeSwitch.style.background = palette.surface
    localeSwitch.style.borderColor = palette.line
    const progress = root.getElementById("progress") as HTMLElement
    progress.style.background = palette.surface
    ;(root.getElementById("progress-bar") as HTMLElement).style.background = palette.fg
    for (const id of ["tasks", "guidance", "theme-row", "pace"]) {
      const element = root.getElementById(id) as HTMLElement | null
      if (element) element.style.borderColor = palette.line
    }
    const prompt = root.getElementById("guidance-prompt") as HTMLTextAreaElement
    prompt.style.color = palette.fg
    prompt.style.background = palette.surface
    prompt.style.borderColor = palette.line
    const send = root.getElementById("send-guidance") as HTMLButtonElement
    send.style.color = palette.buttonFg
    send.style.background = palette.button
    send.style.borderColor = palette.button
    const themeLabel = root.getElementById("theme-label") as HTMLElement
    themeLabel.style.color = palette.muted
    const themeSelect = root.getElementById("theme-select") as HTMLSelectElement
    themeSelect.value = uiTheme
    themeSelect.style.color = palette.fg
    themeSelect.style.background = palette.surface
    themeSelect.style.borderColor = palette.line
    const pace = root.getElementById("pace") as HTMLElement
    pace.style.color = palette.muted
    ;(root.getElementById("pace-value") as HTMLElement).style.color = palette.muted
    ;(root.getElementById("pace-slider") as HTMLInputElement).style.accentColor = palette.fg
    const menu = root.getElementById("context-menu") as HTMLElement
    menu.style.color = palette.fg
    menu.style.background = palette.bg
    menu.style.borderColor = palette.line
    ;(root.getElementById("context-look-here") as HTMLButtonElement).style.color = palette.fg
    const focus = root.getElementById("focus") as HTMLElement
    focus.style.borderColor = palette.fg
    focus.style.boxShadow = `0 0 0 2px ${palette.bg}`
    const focusLabel = root.getElementById("focus-label") as HTMLElement
    focusLabel.style.color = palette.fg
    focusLabel.style.background = palette.bg
    focusLabel.style.borderColor = palette.line
    const cursorPath = root.querySelector("#cursor path") as SVGPathElement | null
    cursorPath?.setAttribute("fill", palette.fg)
    cursorPath?.setAttribute("stroke", palette.bg)
    syncStaticLabels(root)
  }

  const renderTasks = (root: ShadowRoot) => {
    const tasksElement = root.getElementById("tasks") as HTMLElement
    tasksElement.replaceChildren()
    const palette = themeSets[uiTheme]
    const colors: Record<GhostTaskStatus, string> = {
      queued: palette.muted,
      running: palette.fg,
      done: palette.muted,
      failed: palette.fg,
    }
    for (const task of tasks) {
      const row = document.createElement("div")
      row.dataset.status = task.status
      row.style.cssText =
        "display:grid;grid-template-columns:14px 1fr;gap:7px;align-items:start;padding:6px;border-radius:5px;box-sizing:border-box"
      if (task.status === "running") row.style.background = palette.surface
      row.style.color = colors[task.status]
      const dot = document.createElement("span")
      dot.style.cssText = `width:8px;height:8px;margin-top:4px;border:1px solid ${colors[task.status]};border-radius:50%;box-sizing:border-box`
      if (task.status !== "queued") dot.style.background = colors[task.status]
      const label = document.createElement("span")
      label.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
      label.textContent = task.label
      row.append(dot, label)
      tasksElement.appendChild(row)
    }
    const complete = tasks.filter((task) => task.status === "done" || task.status === "failed").length
    const count = root.getElementById("hud-count") as HTMLElement
    count.textContent = tasks.length > 0 ? `${complete}/${tasks.length}` : ""
    count.style.display = tasks.length > 0 ? "inline" : "none"
    const bar = root.getElementById("progress-bar") as HTMLElement
    bar.style.width = tasks.length > 0 ? `${Math.round((complete / tasks.length) * 100)}%` : "0%"
  }

  const renderWishes = (root: ShadowRoot) => {
    const element = root.getElementById("wishes") as HTMLElement | null
    if (!element) return
    element.replaceChildren()
    element.style.display = wishes.length > 0 ? "grid" : "none"
    const palette = themeSets[uiTheme]
    for (const wish of wishes) {
      const row = document.createElement("div")
      row.dataset.status = wish.status
      row.style.cssText =
        `display:grid;grid-template-columns:7px 1fr;gap:6px;align-items:start;padding:5px 6px;color:${palette.muted};background:${palette.surface};border:1px solid ${palette.line};border-radius:5px;box-sizing:border-box`
      const dot = document.createElement("span")
      dot.style.cssText = `width:6px;height:6px;margin-top:4px;border-radius:50%;background:${wish.status === "pending" ? palette.fg : palette.muted}`
      const text = document.createElement("span")
      text.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
      text.textContent = wish.text
      row.append(dot, text)
      element.appendChild(row)
    }
  }

  const syncStaticLabels = (root: ShadowRoot) => {
    const prompt = root.getElementById("guidance-prompt") as HTMLTextAreaElement | null
    const send = root.getElementById("send-guidance") as HTMLButtonElement | null
    const pace = root.querySelector("#pace > span") as HTMLElement | null
    const themeLabel = root.getElementById("theme-label") as HTMLElement | null
    const lookHere = root.getElementById("context-look-here") as HTMLButtonElement | null
    if (prompt) prompt.placeholder = labels.prompt
    if (send) send.textContent = labels.send
    if (pace) pace.textContent = labels.pace
    if (themeLabel) themeLabel.textContent = labels.theme
    if (lookHere) lookHere.textContent = labels.lookHere
    for (const button of root.querySelectorAll<HTMLButtonElement>("#locale-switch [data-locale]")) {
      const active = button.dataset.locale === uiLocale
      const palette = themeSets[uiTheme]
      button.setAttribute("aria-pressed", String(active))
      button.style.color = active ? palette.buttonFg : palette.muted
      button.style.background = active ? palette.button : "transparent"
    }
  }

  const syncGuidance = (root: ShadowRoot) => {
    const prompt = root.getElementById("guidance-prompt") as HTMLTextAreaElement | null
    if (prompt && root.activeElement !== prompt) prompt.value = promptDraft
    renderWishes(root)
  }

  const showCursorAt = (root: ShadowRoot, x: number, y: number, persist = false) => {
    const cursor = root.getElementById("cursor") as HTMLElement
    cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`
    cursor.style.opacity = "1"
    cursorPosition = { x, y }
    if (persist) save()
  }

  const previewElement = (root: ShadowRoot, element: Element, label: string) => {
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    const focus = root.getElementById("focus") as HTMLElement
    const padding = 5
    focus.style.width = `${rect.width + padding * 2}px`
    focus.style.height = `${rect.height + padding * 2}px`
    focus.style.transform = `translate3d(${rect.left - padding}px, ${rect.top - padding}px, 0)`
    focus.style.opacity = "1"
    ;(root.getElementById("focus-label") as HTMLElement).textContent = label
    showCursorAt(root, rect.left + rect.width / 2, rect.top + rect.height / 2)
    return true
  }

  const selectorFor = (element: Element): string => {
    const escape = (value: string) =>
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(value)
        : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&")
    if (element.id) return `#${escape(element.id)}`
    const testId = element.getAttribute("data-testid")
    if (testId) return `[data-testid="${escape(testId)}"]`

    const parts: string[] = []
    let current: Element | null = element
    while (current && current !== document.documentElement && parts.length < 5) {
      let part = current.tagName.toLowerCase()
      const classes = [...current.classList].filter(Boolean).slice(0, 2)
      if (classes.length) part += classes.map((name) => `.${escape(name)}`).join("")
      const siblings = current.parentElement
        ? [...current.parentElement.children].filter((child) => child.tagName === current!.tagName)
        : []
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`
      parts.unshift(part)
      const candidate = parts.join(" > ")
      try {
        if (document.querySelectorAll(candidate).length === 1) return candidate
      } catch {
        /* keep building a simpler structural selector */
      }
      current = current.parentElement
    }
    return parts.join(" > ")
  }

  const selectContextTarget = (root: ShadowRoot, element: Element) => {
    const selector = selectorFor(element)
    const text = ((element as HTMLElement).innerText || element.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1000)
    wishes = [
      ...wishes,
      {
        id: Date.now(),
        kind: "target",
        text: `${labels.lookHere}: ${text || selector}`.slice(0, 240),
        status: "pending",
      } as GhostWish,
    ].slice(-8)
    guidance = {
      instruction: guidance.instruction,
      target: {
        selector,
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role") || "",
        ariaLabel: element.getAttribute("aria-label") || "",
        text,
        html: element.outerHTML.slice(0, 2000),
      },
      url: location.href,
      title: document.title,
      updatedAt: Date.now(),
    }
    target = { selector, label: labels.lookHere }
    previewElement(root, element, labels.lookHere)
    const rect = element.getBoundingClientRect()
    showCursorAt(root, rect.left + rect.width / 2, rect.top + rect.height / 2, true)
    save()
    syncGuidance(root)
  }

  const mount = (): boolean => {
    if (ghostWindow.__ghostDisabled) return false
    if (!document.documentElement) {
      if (!mountObserver) {
        mountObserver = new MutationObserver(() => {
          if (!document.documentElement) return
          mountObserver?.disconnect()
          mountObserver = null
          mount()
        })
        mountObserver.observe(document, { childList: true, subtree: true })
      }
      return false
    }

    if (!localeExplicit) {
      uiLocale = detectLocale()
      labels = labelSets[uiLocale]
    }
    let host = findHost()
    if (!host) {
      host = document.createElement("div") as GhostHost
      host.id = document.getElementById(hostId) ? `${hostId}_overlay` : hostId
      host.dataset.opencodeBrowserVisuals = "true"
      host.dataset.opencodeBrowserOwner = config.owner
      host.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block;visibility:visible"
      document.documentElement.appendChild(host)
    }
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" })
    if (!root.getElementById("tasks") || !root.getElementById("pace-slider")) build(host, root)
    const hud = root.getElementById("hud") as HTMLElement
    if (hudPosition) {
      const rect = hud.getBoundingClientRect()
      hudPosition = {
        x: Math.min(Math.max(hudPosition.x, 0), Math.max(0, innerWidth - rect.width)),
        y: Math.min(Math.max(hudPosition.y, 0), Math.max(0, innerHeight - 44)),
      }
      hud.style.left = `${hudPosition.x}px`
      hud.style.top = `${hudPosition.y}px`
      hud.style.right = "auto"
    }
    const slider = root.getElementById("pace-slider") as HTMLInputElement
    const paceValue = root.getElementById("pace-value") as HTMLOutputElement
    slider.value = String(actionDelay)
    paceValue.textContent = `${slider.value} ms`
    applyTheme(root)
    renderTasks(root)
    syncGuidance(root)
    showCursorAt(
      root,
      cursorPosition?.x ?? Math.round(innerWidth / 2),
      cursorPosition?.y ?? Math.round(innerHeight / 2),
    )
    return true
  }

  const highlight = async (): Promise<boolean> => {
    if (!mount()) return false
    if (!target) return true
    const host = findHost()
    const root = host?.shadowRoot
    if (!host || !root) return false

    let element: Element | null = null
    try {
      element = target.active ? document.activeElement : document.querySelector(target.selector || "")
    } catch {
      return false
    }
    if (!element || element === document.documentElement || element === document.body) return false
    if (element instanceof HTMLElement) host.__opencodePreviousFocus = element

    element.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "center", inline: "center" })
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    host.__opencodeCleanup?.()
    const position = () => previewElement(root, element!, target!.label)
    if (!position()) return false
    save()

    let scheduled = false
    const schedulePosition = () => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        position()
      })
    }
    const observer = new ResizeObserver(schedulePosition)
    observer.observe(element)
    const mutations = new MutationObserver(schedulePosition)
    mutations.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden"],
    })
    window.addEventListener("scroll", schedulePosition, true)
    window.addEventListener("resize", schedulePosition)
    const followUntil = performance.now() + 2000
    let followFrame = 0
    const followPosition = () => {
      position()
      if (performance.now() < followUntil) followFrame = requestAnimationFrame(followPosition)
    }
    followFrame = requestAnimationFrame(followPosition)
    host.__opencodeCleanup = () => {
      observer.disconnect()
      mutations.disconnect()
      cancelAnimationFrame(followFrame)
      window.removeEventListener("scroll", schedulePosition, true)
      window.removeEventListener("resize", schedulePosition)
    }
    return true
  }

  const remove = () => {
    mountObserver?.disconnect()
    mountObserver = null
    contextCandidate = null
    const host = findHost()
    host?.__opencodeCleanup?.()
    host?.__opencodeFocusCleanup?.()
    host?.__opencodeContextCleanup?.()
    host?.remove()
  }

  const runtime: GhostRuntime = {
    owner: config.owner,
    mount,
    update: async (next) => {
      tasks = next.tasks.map((task) => ({ ...task }))
      target = next.target
      save()
      return highlight()
    },
    actionDelay: () => actionDelay,
    guidance: (consume = false) => {
      if (!guidance.instruction.trim() && !guidance.target) return null
      const value = {
        ...guidance,
        instruction: guidance.instruction.trim(),
        target: guidance.target ? { ...guidance.target } : undefined,
      }
      const result = { guidance: value, signature: signGuidance(value) }
      if (consume) {
        wishes = wishes.map((wish) =>
          wish.status === "pending" ? { ...wish, status: "sent" as const } : wish,
        )
        guidance = {
          instruction: "",
          url: location.href,
          title: document.title,
          updatedAt: Date.now(),
        }
        target = undefined
        const root = findHost()?.shadowRoot
        if (root) syncGuidance(root)
        save()
      }
      return result
    },
    theme: () => ({ name: uiTheme, updatedAt: themeUpdatedAt }),
    setTheme: (preference) => {
      if (
        !Object.prototype.hasOwnProperty.call(themeSets, preference.name) ||
        !Number.isFinite(preference.updatedAt) ||
        preference.updatedAt < themeUpdatedAt
      ) return false
      uiTheme = preference.name
      themeUpdatedAt = preference.updatedAt
      save()
      const root = findHost()?.shadowRoot
      if (root) {
        applyTheme(root)
        renderTasks(root)
        renderWishes(root)
      }
      return true
    },
    restoreFocus: () => {
      const host = findHost()
      if (!host?.shadowRoot?.activeElement) return true
      const prior = host.__opencodePreviousFocus
      if (!prior?.isConnected) return false
      prior.focus()
      return document.activeElement === prior
    },
    hide: () => {
      const host = findHost()
      if (!host) return null
      const visibility = host.style.visibility
      host.style.visibility = "hidden"
      return visibility
    },
    show: (visibility) => {
      const host = findHost()
      if (host) host.style.visibility = visibility
    },
    remove,
    destroy: () => {
      ghostWindow.__ghostDisabled = true
      remove()
      try {
        sessionStorage.removeItem(storageKey)
      } catch {
        /* ignore */
      }
      delete ghostWindow.__opencodeBrowserGhost
    },
  }
  ghostWindow.__opencodeBrowserGhost = Object.freeze(runtime)
  runtime.mount()
}
import { randomBytes } from "node:crypto"
