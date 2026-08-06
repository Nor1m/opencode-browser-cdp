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

export type GhostRuntime = {
  owner: string
  mount: () => boolean
  update: (next: GhostUpdate) => Promise<boolean>
  actionDelay: () => number
  restoreFocus: () => boolean
  hide: () => string | null
  show: (visibility: string) => void
  remove: () => void
  destroy: () => void
}

export const GHOST_OWNER = `opencode-${process.pid}-${Math.random().toString(36).slice(2)}`
export const GHOST_ENABLED = process.env.OPENCODE_BROWSER_VISUALS !== "0"

const configuredActionDelay = Number(process.env.OPENCODE_BROWSER_ACTION_DELAY ?? 350)
export const GHOST_ACTION_DELAY = Number.isFinite(configuredActionDelay)
  ? Math.min(Math.max(configuredActionDelay, 0), 2000)
  : 350

/** Serialized by Puppeteer and installed before every document in a managed target. */
export const GHOST_SOURCE = (config: { owner: string; actionDelay: number }) => {
  type GhostHost = HTMLElement & {
    __opencodeCleanup?: () => void
    __opencodeFocusCleanup?: () => void
    __opencodePreviousFocus?: HTMLElement
  }
  type GhostWindow = Window & {
    __ghostDisabled?: boolean
    __opencodeBrowserGhost?: GhostRuntime
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
  let mountObserver: MutationObserver | null = null

  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) || "null") as {
      tasks?: GhostTask[]
      actionDelay?: number
    } | null
    if (Array.isArray(stored?.tasks)) tasks = stored.tasks
    if (Number.isFinite(stored?.actionDelay)) {
      actionDelay = Math.min(Math.max(Number(stored?.actionDelay), 0), 2000)
    }
  } catch {
    /* storage is unavailable on some internal and opaque origins */
  }

  const save = () => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ tasks, actionDelay }))
    } catch {
      /* keep the runtime in memory when storage is unavailable */
    }
  }

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
      "position:fixed;left:0;top:0;width:0;height:0;opacity:0;border:3px solid #6ee7ff;border-radius:9px;box-shadow:0 0 0 2px rgba(5,13,24,.75),0 0 22px rgba(42,210,255,.65);transform:translate3d(0,0,0);transition:transform 180ms cubic-bezier(.2,.8,.2,1),width 180ms ease,height 180ms ease,opacity 100ms ease;box-sizing:border-box",
    )
    add(
      root,
      "span",
      "focus-label",
      "position:absolute;left:-2px;bottom:calc(100% + 7px);max-width:280px;padding:5px 8px;overflow:hidden;color:#dffaff;background:#07111f;border:1px solid rgba(110,231,255,.7);border-radius:6px;font:600 11px/1.25 ui-monospace,SFMono-Regular,Consolas,monospace;text-overflow:ellipsis;white-space:nowrap;box-sizing:border-box",
      focus,
    )

    const cursor = add(
      root,
      "div",
      "cursor",
      "position:fixed;left:0;top:0;width:24px;height:30px;opacity:0;transform:translate3d(0,0,0);transition:transform 180ms cubic-bezier(.2,.8,.2,1),opacity 100ms ease;filter:drop-shadow(0 3px 5px rgba(0,0,0,.35))",
    )
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("viewBox", "0 0 24 30")
    svg.style.cssText = "display:block;width:100%;height:100%"
    const cursorPath = document.createElementNS("http://www.w3.org/2000/svg", "path")
    cursorPath.setAttribute("d", "M2 1.5 21 17l-8.1 1.2 4.6 8.2-4.2 2.1-4.5-8.2L3 26Z")
    cursorPath.setAttribute("fill", "#6ee7ff")
    cursorPath.setAttribute("stroke", "#07111f")
    cursorPath.setAttribute("stroke-width", "2")
    cursorPath.setAttribute("stroke-linejoin", "round")
    svg.appendChild(cursorPath)
    cursor.appendChild(svg)

    const hud = add(
      root,
      "aside",
      "hud",
      "position:fixed;top:16px;right:16px;width:min(330px,calc(100vw - 32px));overflow:hidden;color:#e8f5ff;background:rgba(5,13,24,.92);border:1px solid rgba(110,231,255,.42);border-radius:12px;box-shadow:0 14px 35px rgba(0,0,0,.32);backdrop-filter:blur(12px);font:12px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;box-sizing:border-box",
    )
    const head = add(
      root,
      "div",
      "hud-head",
      "display:flex;align-items:center;justify-content:space-between;padding:10px 12px 8px;box-sizing:border-box",
      hud,
    )
    const title = add(
      root,
      "span",
      "hud-title",
      "color:#6ee7ff;font-weight:800;letter-spacing:.04em;text-transform:uppercase",
      head,
    )
    title.textContent = "OpenCode browser"
    add(root, "span", "hud-count", "color:#9fb6c8;font-size:11px", head)
    const progress = add(root, "div", "progress", "height:3px;background:rgba(255,255,255,.1)", hud)
    add(
      root,
      "i",
      "progress-bar",
      "display:block;height:100%;width:0;background:linear-gradient(90deg,#22d3ee,#a3e635);transition:width 180ms ease",
      progress,
    )
    add(
      root,
      "div",
      "tasks",
      "display:grid;gap:1px;padding:5px 6px 7px;max-height:280px;overflow:hidden;box-sizing:border-box",
      hud,
    )
    const settings = add(
      root,
      "label",
      "pace",
      "display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;padding:8px 12px 10px;color:#9fb6c8;border-top:1px solid rgba(255,255,255,.08);pointer-events:auto;box-sizing:border-box",
      hud,
    )
    const paceLabel = document.createElement("span")
    paceLabel.textContent = "Pace"
    const slider = document.createElement("input")
    slider.id = "pace-slider"
    slider.type = "range"
    slider.min = "0"
    slider.max = "2000"
    slider.step = "50"
    slider.value = String(actionDelay)
    slider.style.cssText = "width:100%;accent-color:#22d3ee;cursor:pointer"
    const paceValue = document.createElement("output")
    paceValue.id = "pace-value"
    paceValue.textContent = `${slider.value} ms`
    paceValue.style.cssText = "min-width:58px;text-align:right;color:#dffaff"
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

    const trackPageFocus = (event: FocusEvent) => {
      const focused = event.composedPath()[0]
      if (focused instanceof HTMLElement && focused !== host && !root.contains(focused)) {
        host.__opencodePreviousFocus = focused
      }
    }
    document.addEventListener("focusin", trackPageFocus, true)
    host.__opencodeFocusCleanup = () => document.removeEventListener("focusin", trackPageFocus, true)
  }

  const renderTasks = (root: ShadowRoot) => {
    const tasksElement = root.getElementById("tasks") as HTMLElement
    tasksElement.replaceChildren()
    const colors: Record<GhostTaskStatus, string> = {
      queued: "#64748b",
      running: "#67e8f9",
      done: "#a3e635",
      failed: "#fb7185",
    }
    for (const task of tasks) {
      const row = document.createElement("div")
      row.dataset.status = task.status
      row.style.cssText =
        "display:grid;grid-template-columns:14px 1fr;gap:7px;align-items:start;padding:6px;border-radius:7px;box-sizing:border-box"
      if (task.status === "running") row.style.background = "rgba(34,211,238,.11)"
      row.style.color = task.status === "done" ? "#9fb6c8" : colors[task.status]
      const dot = document.createElement("span")
      dot.style.cssText = `width:8px;height:8px;margin-top:4px;border:1px solid ${colors[task.status]};border-radius:50%;box-sizing:border-box`
      if (task.status !== "queued") dot.style.background = colors[task.status]
      if (task.status === "running") dot.style.boxShadow = "0 0 9px #22d3ee"
      const label = document.createElement("span")
      label.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
      label.textContent = task.label
      row.append(dot, label)
      tasksElement.appendChild(row)
    }
    const complete = tasks.filter((task) => task.status === "done" || task.status === "failed").length
    const count = root.getElementById("hud-count") as HTMLElement
    count.textContent = tasks.length > 0 ? `${complete}/${tasks.length}` : "idle"
    const bar = root.getElementById("progress-bar") as HTMLElement
    bar.style.width = tasks.length > 0 ? `${Math.round((complete / tasks.length) * 100)}%` : "0%"
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
    const slider = root.getElementById("pace-slider") as HTMLInputElement
    const paceValue = root.getElementById("pace-value") as HTMLOutputElement
    slider.value = String(actionDelay)
    paceValue.textContent = `${slider.value} ms`
    renderTasks(root)
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
    const focus = root.getElementById("focus") as HTMLElement
    const cursor = root.getElementById("cursor") as HTMLElement
    const position = () => {
      const rect = element!.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        focus.style.opacity = "0"
        cursor.style.opacity = "0"
        return false
      }
      const padding = 5
      focus.style.width = `${rect.width + padding * 2}px`
      focus.style.height = `${rect.height + padding * 2}px`
      focus.style.transform = `translate3d(${rect.left - padding}px, ${rect.top - padding}px, 0)`
      focus.style.opacity = "1"
      cursor.style.transform = `translate3d(${rect.left + rect.width / 2}px, ${rect.top + rect.height / 2}px, 0)`
      cursor.style.opacity = "1"
      return true
    }
    if (!position()) return false
    ;(root.getElementById("focus-label") as HTMLElement).textContent = target.label

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
    const host = findHost()
    host?.__opencodeCleanup?.()
    host?.__opencodeFocusCleanup?.()
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
  ghostWindow.__opencodeBrowserGhost = runtime
  runtime.mount()
}
