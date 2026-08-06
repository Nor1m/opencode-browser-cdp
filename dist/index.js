import { activate } from "./cdp.js";
import { browserTool } from "./tool.js";
/**
 * OpenCode plugin: headed Chrome via CDP + Puppeteer.
 * Registers tool `browser`.
 */
const OpenCodeBrowserPlugin = async () => {
    const dispose = activate();
    return {
        tool: {
            browser: browserTool,
        },
        dispose,
    };
};
export default OpenCodeBrowserPlugin;
//# sourceMappingURL=index.js.map