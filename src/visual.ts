import type { Page } from "puppeteer-core"
import {
  GHOST_ACTION_DELAY,
  GHOST_ENABLED,
  GHOST_OWNER,
  type GhostRuntime,
  type GhostTarget,
  type GhostTask,
} from "./ghost.js"

export type VisualTask = GhostTask

const taskLists = new Map<number, VisualTask[]>()
let nextTaskId = 1

const configuredDelay = Number(process.env.OPENCODE_BROWSER_VISUAL_DELAY ?? 80)
const visualDelay = Number.isFinite(configuredDelay)
  ? Math.min(Math.max(configuredDelay, 0), 1000)
  : 80
let currentActionDelay = GHOST_ACTION_DELAY

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
  target?: GhostTarget,
): Promise<boolean> {
  if (!GHOST_ENABLED) return true
  let found = false
  try {
    found = await page.evaluate(
      async ({ owner, nextTasks, nextTarget }) => {
        const runtime = (window as Window & { __opencodeBrowserGhost?: GhostRuntime })
          .__opencodeBrowserGhost
        if (!runtime || runtime.owner !== owner) return false
        return runtime.update({ tasks: nextTasks, target: nextTarget })
      },
      { owner: GHOST_OWNER, nextTasks: tasks, nextTarget: target },
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
    selected = await page.evaluate(
      ({ fallback, owner }) => {
        const runtime = (window as Window & { __opencodeBrowserGhost?: GhostRuntime })
          .__opencodeBrowserGhost
        return runtime?.owner === owner ? runtime.actionDelay() : fallback
      },
      { fallback: currentActionDelay, owner: GHOST_OWNER },
    )
  } catch {
    /* use the process-level setting when the page is navigating */
  }
  currentActionDelay = Math.min(Math.max(selected, 0), 2000)
  const actualDelay =
    currentActionDelay === 0 ? 0 : Math.round(currentActionDelay * (0.8 + Math.random() * 0.4))
  if (actualDelay > 0) await new Promise((resolve) => setTimeout(resolve, actualDelay))
  return actualDelay
}

export async function restorePageFocus(page: Page): Promise<boolean> {
  if (!GHOST_ENABLED) return true
  try {
    return await page.evaluate((owner) => {
      const runtime = (window as Window & { __opencodeBrowserGhost?: GhostRuntime })
        .__opencodeBrowserGhost
      return runtime?.owner === owner ? runtime.restoreFocus() : true
    }, GHOST_OWNER)
  } catch {
    return false
  }
}

export async function removeVisuals(page: Page): Promise<void> {
  await page
    .evaluate((owner) => {
      const runtime = (window as Window & { __opencodeBrowserGhost?: GhostRuntime })
        .__opencodeBrowserGhost
      if (runtime?.owner === owner) runtime.remove()
    }, GHOST_OWNER)
    .catch(() => {})
}

export async function withVisualsHidden<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  if (!GHOST_ENABLED) return fn()
  const previousVisibility = await page.evaluate((owner) => {
    const runtime = (window as Window & { __opencodeBrowserGhost?: GhostRuntime })
      .__opencodeBrowserGhost
    return runtime?.owner === owner ? runtime.hide() : null
  }, GHOST_OWNER)
  try {
    return await fn()
  } finally {
    if (previousVisibility !== null) {
      await page
        .evaluate(
          ({ owner, visibility }) => {
            const runtime = (window as Window & { __opencodeBrowserGhost?: GhostRuntime })
              .__opencodeBrowserGhost
            if (runtime?.owner === owner) runtime.show(visibility)
          },
          { owner: GHOST_OWNER, visibility: previousVisibility },
        )
        .catch(() => {})
    }
  }
}
