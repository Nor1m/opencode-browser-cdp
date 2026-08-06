import assert from "node:assert/strict"
import test from "node:test"

import * as visual from "../dist/visual.js"

test("task HUD preserves every active task when more than eight are queued", () => {
  const port = 61234
  visual.clearTasks(port)
  const first = visual.queueTask(port, "first")
  visual.startTask(first)
  for (let index = 2; index <= 10; index += 1) {
    visual.queueTask(port, `task ${index}`)
  }

  const tasks = visual.tasksForPort(port)
  assert.equal(tasks.length, 10)
  assert.equal(tasks[0].id, first.id)
  assert.equal(tasks[0].status, "running")
  visual.clearTasks(port)
})

test("completed tasks are pruned when eight or more tasks remain active", () => {
  const port = 61235
  visual.clearTasks(port)
  const active = visual.queueTask(port, "active 1")
  visual.startTask(active)
  const completed = visual.queueTask(port, "completed")
  visual.finishTask(completed, true)
  for (let index = 2; index <= 9; index += 1) visual.queueTask(port, `active ${index}`)
  visual.queueTask(port, "active 10")

  const tasks = visual.tasksForPort(port)
  assert.equal(tasks.length, 10)
  assert.equal(tasks.some((task) => task.id === completed.id), false)
  visual.clearTasks(port)
})
