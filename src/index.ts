import type { Plugin } from "@opencode-ai/plugin"
import { activate } from "./cdp.js"
import { browserTool } from "./tool.js"

/**
 * OpenCode plugin: headed Chrome via CDP + Puppeteer.
 * Registers tool `browser`.
 */
const OpenCodeBrowserPlugin: Plugin = async () => {
  const dispose = activate()
  return {
    tool: {
      browser: browserTool,
    },
    dispose,
  }
}

export default OpenCodeBrowserPlugin
