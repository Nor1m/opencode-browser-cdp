import type { Page } from "puppeteer-core"

type TaskStatus = "queued" | "running" | "done" | "failed"

export type VisualTask = {
  id: number
  label: string
  status: TaskStatus
}

const taskLists = new Map<number, VisualTask[]>()
let nextTaskId = 1
const visualOwner = `opencode-${process.pid}-${Math.random().toString(36).slice(2)}`

const visualsEnabled = process.env.OPENCODE_BROWSER_VISUALS !== "0"
const configuredDelay = Number(process.env.OPENCODE_BROWSER_VISUAL_DELAY ?? 80)
const visualDelay = Number.isFinite(configuredDelay)
  ? Math.min(Math.max(configuredDelay, 0), 1000)
  : 80
const configuredActionDelay = Number(process.env.OPENCODE_BROWSER_ACTION_DELAY ?? 350)
let currentActionDelay = Number.isFinite(configuredActionDelay)
  ? Math.min(Math.max(configuredActionDelay, 0), 2000)
  : 350

export function queueTask(port: number, label: string): VisualTask {
  let tasks = taskLists.get(port) ?? []
  if (tasks.length > 0 && tasks.every((task) => task.status === "done" || task.status === "failed")) {
    tasks = []
  }

  const pending = tasks.filter((task) => task.status === "queued" || task.status === "running")
  const finished = tasks.filter((task) => task.status === "done" || task.status === "failed")
  const finishedLimit = Math.max(0, 8 - pending.length)
  tasks = [...(finishedLimit > 0 ? finished.slice(-finishedLimit) : []), ...pending]

  const task = { id: nextTaskId++, label, status: "queued" as const }
  tasks.push(task)
  taskLists.set(port, tasks)
  return task
}

export function startTask(task: VisualTask): void {
  task.status = "running"
}

export function finishTask(task: VisualTask, success: boolean): void {
  if (task.status === "done" || task.status === "failed") return
  task.status = success ? "done" : "failed"
}

export function tasksForPort(port: number): VisualTask[] {
  return (taskLists.get(port) ?? []).map((task) => ({ ...task }))
}

export function clearTasks(port?: number): void {
  if (port === undefined) taskLists.clear()
  else taskLists.delete(port)
}

export async function updateVisuals(
  page: Page,
  tasks: VisualTask[],
  target?: { selector?: string; active?: boolean; label: string },
): Promise<boolean> {
  if (!visualsEnabled) return true

  let found = false
  try {
    found = await page.evaluate(
      async ({ visualTasks, visualTarget, currentActionDelay, owner }) => {
        type VisualHost = HTMLElement & {
          __opencodeCleanup?: () => void
          __opencodeFocusCleanup?: () => void
          __opencodePreviousFocus?: HTMLElement
        }

        const hostId = "__opencode_browser_visuals"
        let host = document.querySelector(
          `[data-opencode-browser-owner="${owner}"]`,
        ) as VisualHost | null
        if (!host) {
          host = document.createElement("div") as VisualHost
          host.id = document.getElementById(hostId) ? `${hostId}_overlay` : hostId
          host.dataset.opencodeBrowserVisuals = "true"
          host.dataset.opencodeBrowserOwner = owner
          host.dataset.actionDelay = String(currentActionDelay)
          host.style.cssText =
            "position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block;visibility:visible"
          document.documentElement.appendChild(host)
        }

        const root = host.shadowRoot ?? host.attachShadow({ mode: "open" })
        if (!root.getElementById("tasks") || !root.getElementById("pace-slider")) {
          root.replaceChildren()
          const add = <K extends keyof HTMLElementTagNameMap>(
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

          const focus = add(
            "div",
            "focus",
            "position:fixed;left:0;top:0;width:0;height:0;opacity:0;border:3px solid #6ee7ff;border-radius:9px;box-shadow:0 0 0 2px rgba(5,13,24,.75),0 0 22px rgba(42,210,255,.65);transform:translate3d(0,0,0);transition:transform 180ms cubic-bezier(.2,.8,.2,1),width 180ms ease,height 180ms ease,opacity 100ms ease;box-sizing:border-box",
          )
          add(
            "span",
            "focus-label",
            "position:absolute;left:-2px;bottom:calc(100% + 7px);max-width:280px;padding:5px 8px;overflow:hidden;color:#dffaff;background:#07111f;border:1px solid rgba(110,231,255,.7);border-radius:6px;font:600 11px/1.25 ui-monospace,SFMono-Regular,Consolas,monospace;text-overflow:ellipsis;white-space:nowrap;box-sizing:border-box",
            focus,
          )

          const cursor = add(
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
            "aside",
            "hud",
            "position:fixed;top:16px;right:16px;width:min(330px,calc(100vw - 32px));overflow:hidden;color:#e8f5ff;background:rgba(5,13,24,.92);border:1px solid rgba(110,231,255,.42);border-radius:12px;box-shadow:0 14px 35px rgba(0,0,0,.32);backdrop-filter:blur(12px);font:12px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;box-sizing:border-box",
          )
          const head = add(
            "div",
            "hud-head",
            "display:flex;align-items:center;justify-content:space-between;padding:10px 12px 8px;box-sizing:border-box",
            hud,
          )
          const title = add(
            "span",
            "hud-title",
            "color:#6ee7ff;font-weight:800;letter-spacing:.04em;text-transform:uppercase",
            head,
          )
          title.textContent = "OpenCode browser"
          add("span", "hud-count", "color:#9fb6c8;font-size:11px", head)
          const progress = add(
            "div",
            "progress",
            "height:3px;background:rgba(255,255,255,.1)",
            hud,
          )
          add(
            "i",
            "progress-bar",
            "display:block;height:100%;width:0;background:linear-gradient(90deg,#22d3ee,#a3e635);transition:width 180ms ease",
            progress,
          )
          add(
            "div",
            "tasks",
            "display:grid;gap:1px;padding:5px 6px 7px;max-height:280px;overflow:hidden;box-sizing:border-box",
            hud,
          )
          const settings = add(
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
          slider.value = host.dataset.actionDelay || String(currentActionDelay)
          slider.style.cssText = "width:100%;accent-color:#22d3ee;cursor:pointer"
          const paceValue = document.createElement("output")
          paceValue.id = "pace-value"
          paceValue.textContent = `${slider.value} ms`
          paceValue.style.cssText = "min-width:58px;text-align:right;color:#dffaff"
          slider.addEventListener("input", () => {
            host!.dataset.actionDelay = slider.value
            paceValue.textContent = `${slider.value} ms`
          })
          slider.addEventListener("pointerdown", () => {
            const active = document.activeElement
            if (active instanceof HTMLElement && active !== host) {
              host!.__opencodePreviousFocus = active
            }
          })
          settings.append(paceLabel, slider, paceValue)
        }

        if (!host.__opencodeFocusCleanup) {
          const trackPageFocus = (event: FocusEvent) => {
            const target = event.composedPath()[0]
            if (target instanceof HTMLElement && target !== host && !root.contains(target)) {
              host!.__opencodePreviousFocus = target
            }
          }
          document.addEventListener("focusin", trackPageFocus, true)
          host.__opencodeFocusCleanup = () =>
            document.removeEventListener("focusin", trackPageFocus, true)
        }

        const tasksElement = root.getElementById("tasks") as HTMLElement
        tasksElement.replaceChildren()
        const colors: Record<TaskStatus, string> = {
          queued: "#64748b",
          running: "#67e8f9",
          done: "#a3e635",
          failed: "#fb7185",
        }
        for (const task of visualTasks) {
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

        const complete = visualTasks.filter(
          (task) => task.status === "done" || task.status === "failed",
        ).length
        const total = visualTasks.length
        const count = root.getElementById("hud-count") as HTMLElement
        count.textContent = total > 0 ? `${complete}/${total}` : "idle"
        const bar = root.getElementById("progress-bar") as HTMLElement
        bar.style.width = total > 0 ? `${Math.round((complete / total) * 100)}%` : "0%"

        if (!visualTarget) return true
        let element: Element | null = null
        try {
          element = visualTarget.active
            ? document.activeElement
            : document.querySelector(visualTarget.selector || "")
        } catch {
          return false
        }
        if (!element || element === document.documentElement || element === document.body) return false
        if (element instanceof HTMLElement) host.__opencodePreviousFocus = element

        element.scrollIntoView({
          behavior: "instant" as ScrollBehavior,
          block: "center",
          inline: "center",
        })
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

        const focusLabel = root.getElementById("focus-label") as HTMLElement
        focusLabel.textContent = visualTarget.label
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
      },
      { visualTasks: tasks, visualTarget: target, currentActionDelay, owner: visualOwner },
    )
  } catch {
    return false
  }

  if (target && found && visualDelay > 0) {
    await new Promise((resolve) => setTimeout(resolve, visualDelay))
  }
  return found
}

export async function waitForActionDelay(page: Page): Promise<number> {
  let selected = currentActionDelay
  try {
    selected = await page.evaluate((fallback, owner) => {
      const host = document.querySelector(
        `[data-opencode-browser-owner="${owner}"]`,
      ) as HTMLElement | null
      const value = Number(host?.dataset.actionDelay)
      return Number.isFinite(value) ? Math.min(Math.max(value, 0), 2000) : fallback
    }, currentActionDelay, visualOwner)
  } catch {
    /* use the process-level setting when the page is navigating */
  }
  currentActionDelay = selected
  const actualDelay = selected === 0 ? 0 : Math.round(selected * (0.8 + Math.random() * 0.4))
  if (actualDelay > 0) await new Promise((resolve) => setTimeout(resolve, actualDelay))
  return actualDelay
}

export async function restorePageFocus(page: Page): Promise<boolean> {
  if (!visualsEnabled) return true
  try {
    return await page.evaluate((owner) => {
      type VisualHost = HTMLElement & { __opencodePreviousFocus?: HTMLElement }
      const host = document.querySelector(
        `[data-opencode-browser-owner="${owner}"]`,
      ) as VisualHost | null
      if (!host?.shadowRoot?.activeElement) return true
      const previous = host.__opencodePreviousFocus
      if (!previous?.isConnected) return false
      previous.focus()
      return document.activeElement === previous
    }, visualOwner)
  } catch {
    return false
  }
}

export async function removeVisuals(page: Page): Promise<void> {
  await page
    .evaluate((owner) => {
      type VisualHost = HTMLElement & {
        __opencodeCleanup?: () => void
        __opencodeFocusCleanup?: () => void
      }
      const host = document.querySelector(
        `[data-opencode-browser-owner="${owner}"]`,
      ) as VisualHost | null
      host?.__opencodeCleanup?.()
      host?.__opencodeFocusCleanup?.()
      host?.remove()
    }, visualOwner)
    .catch(() => {})
}

export async function withVisualsHidden<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  if (!visualsEnabled) return fn()
  const previousVisibility = await page.evaluate((owner) => {
    const host = document.querySelector(
      `[data-opencode-browser-owner="${owner}"]`,
    ) as HTMLElement | null
    if (!host) return null
    const previous = host.style.visibility
    host.style.visibility = "hidden"
    return previous
  }, visualOwner)
  try {
    return await fn()
  } finally {
    if (previousVisibility !== null) {
      await page
        .evaluate((visibility, owner) => {
          const host = document.querySelector(
            `[data-opencode-browser-owner="${owner}"]`,
          ) as HTMLElement | null
          if (host) host.style.visibility = visibility
        }, previousVisibility, visualOwner)
        .catch(() => {})
    }
  }
}
