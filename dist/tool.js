import { tool } from "@opencode-ai/plugin";
import * as api from "./cdp.js";
import * as visual from "./visual.js";
function ok(data) {
    return JSON.stringify(data, null, 2);
}
function err(e) {
    const msg = e instanceof Error ? e.message : String(e);
    return ok({ ok: false, error: msg });
}
function actionLabel(args) {
    if (typeof args.task === "string" && args.task.trim())
        return args.task.trim();
    const selector = typeof args.selector === "string" ? ` ${args.selector}` : "";
    switch (args.action) {
        case "open":
            return `Open ${String(args.url || "page")}`;
        case "click":
            return `Click ${String(args.text || args.selector || "target")}`;
        case "fill":
            return `Fill${selector}`;
        case "type":
            return `Type${selector}`;
        case "select":
            return `Select${selector}`;
        case "check":
            return `Check${selector}`;
        case "press":
            return `Press ${String(args.key || "key")}${selector}`;
        case "wait":
            return `Wait for ${String(args.text || args.selector || "page")}`;
        default:
            return `${String(args.action)}${selector}`;
    }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const browserTool = tool({
    description: "Control a visible Chromium browser over a persistent CDP connection. Actions: start, status, tabs, open, back, reload, text, html, eval, click, fill, type, select, check, press, wait, screenshot, cookies, close_tab. Prefer this over webfetch for JS sites and forms.",
    args: {
        action: tool.schema
            .enum([
            "start",
            "status",
            "tabs",
            "open",
            "back",
            "reload",
            "text",
            "html",
            "eval",
            "click",
            "fill",
            "type",
            "select",
            "check",
            "press",
            "wait",
            "screenshot",
            "cookies",
            "close_tab",
        ])
            .describe("What to do"),
        url: tool.schema.string().optional().describe("URL for open"),
        selector: tool.schema.string().optional().describe("CSS selector"),
        text: tool.schema.string().optional().describe("Visible text to click, or value to fill/type"),
        value: tool.schema.string().optional().describe("Value for fill/select/check"),
        expression: tool.schema.string().optional().describe("JS expression for eval (return value)"),
        key: tool.schema.string().optional().describe("Key for press, e.g. Enter, Escape, Tab"),
        timeoutMs: tool.schema.number().optional().describe("Timeout ms (default 15000)"),
        delay: tool.schema
            .number()
            .optional()
            .describe("For fill/type: per-character delay in ms; fill is instant by default"),
        port: tool.schema
            .number()
            .optional()
            .describe("CDP port (explicit, OPENCODE_CDP_PORT, last used, then 9223)"),
        newTab: tool.schema.boolean().optional().describe("Open in a new tab"),
        fullPage: tool.schema.boolean().optional().describe("Full-page screenshot"),
        name: tool.schema.string().optional().describe("Screenshot filename prefix"),
        headed: tool.schema.boolean().optional().describe("For start: visible window (default true)"),
        maxChars: tool.schema.number().optional().describe("Max chars for text/html (default 12000)"),
        task: tool.schema.string().optional().describe("Human-readable task label shown in the page HUD"),
    },
    async execute(args) {
        try {
            const port = api.resolvePort(args.port);
            if (args.port !== undefined)
                api.rememberPort(port);
            const timeout = args.timeoutMs ?? 15000;
            const maxChars = args.maxChars ?? 12000;
            if (args.action === "start") {
                return ok(await api.ensureChrome({ port, headed: args.headed !== false }));
            }
            if (args.action === "status") {
                const version = await api.isCdpUp(port);
                return ok({
                    ok: !!version,
                    port,
                    version,
                    chrome: api.findChrome(),
                    profile: api.PROFILE_DIR,
                    shots: api.SHOT_DIR,
                });
            }
            if (args.action === "tabs") {
                const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
                    signal: AbortSignal.timeout(5000),
                });
                const list = (await res.json());
                const pages = list
                    .filter((t) => t.type === "page")
                    .map((t) => ({ id: t.id, title: t.title, url: t.url }));
                return ok({ ok: true, port, tabs: pages });
            }
            const visualTask = visual.queueTask(port, actionLabel(args));
            try {
                return await api.withPage(async (page) => {
                    visual.startTask(visualTask);
                    let taskFailed = false;
                    const showTarget = (selector) => visual.updateVisuals(page, visual.tasksForPort(port), {
                        selector,
                        label: visualTask.label,
                    });
                    const focusTarget = async (selector) => {
                        await page.focus(selector);
                        return page.$eval(selector, (element) => element === document.activeElement || element.contains(document.activeElement));
                    };
                    try {
                        await visual.updateVisuals(page, visual.tasksForPort(port));
                        await visual.waitForActionDelay(page);
                        page.setDefaultTimeout(timeout);
                        const result = await (async () => {
                            switch (args.action) {
                                case "open": {
                                    if (!args.url)
                                        return ok({ ok: false, error: "url required" });
                                    await page.goto(args.url, { waitUntil: "domcontentloaded", timeout });
                                    await api.dismissCookies(page);
                                    return ok({ ok: true, url: page.url(), title: await page.title() });
                                }
                                case "back": {
                                    await page.goBack({ waitUntil: "domcontentloaded", timeout }).catch(() => { });
                                    return ok({ ok: true, url: page.url(), title: await page.title() });
                                }
                                case "reload": {
                                    await page.reload({ waitUntil: "domcontentloaded", timeout });
                                    return ok({ ok: true, url: page.url(), title: await page.title() });
                                }
                                case "cookies": {
                                    const hit = await api.dismissCookies(page);
                                    return ok({ ok: true, dismissed: hit, url: page.url() });
                                }
                                case "text": {
                                    let content;
                                    if (args.selector) {
                                        await page.waitForSelector(args.selector, { timeout });
                                        await showTarget(args.selector);
                                        content = await page
                                            .$eval(args.selector, (el) => (el.textContent || "").trim())
                                            .catch(() => "");
                                    }
                                    else {
                                        await page.waitForFunction(() => !!document.body, { timeout: 5000 }).catch(() => { });
                                        content = await page.evaluate(() => (document.body?.innerText || document.documentElement?.innerText || "").trim());
                                    }
                                    const clipped = content.length > maxChars;
                                    return ok({
                                        ok: true,
                                        url: page.url(),
                                        title: await page.title(),
                                        text: clipped ? content.slice(0, maxChars) : content,
                                        clipped,
                                        length: content.length,
                                    });
                                }
                                case "html": {
                                    let html;
                                    if (args.selector) {
                                        await page.waitForSelector(args.selector, { timeout });
                                        await showTarget(args.selector);
                                        await visual.removeVisuals(page);
                                        html = await page.$eval(args.selector, (el) => el.outerHTML);
                                    }
                                    else {
                                        await visual.removeVisuals(page);
                                        html = await page.content();
                                    }
                                    const clipped = html.length > maxChars;
                                    return ok({
                                        ok: true,
                                        url: page.url(),
                                        html: clipped ? html.slice(0, maxChars) : html,
                                        clipped,
                                        length: html.length,
                                    });
                                }
                                case "eval": {
                                    if (!args.expression)
                                        return ok({ ok: false, error: "expression required" });
                                    const result = await page.evaluate((expr) => {
                                        // eslint-disable-next-line no-eval
                                        return (0, eval)(expr);
                                    }, args.expression);
                                    return ok({ ok: true, url: page.url(), result });
                                }
                                case "click": {
                                    let selector;
                                    let temporaryTarget = null;
                                    if (args.selector) {
                                        await page.waitForSelector(args.selector, { timeout });
                                        selector = args.selector;
                                    }
                                    else if (args.text) {
                                        temporaryTarget = `target-${visualTask.id}`;
                                        const found = await page.evaluate((t, token) => {
                                            const want = t.trim().toLowerCase();
                                            const nodes = [
                                                ...document.querySelectorAll("a,button,[role=button],input[type=submit],label"),
                                            ];
                                            const el = nodes.find((n) => (n.textContent || "").trim().toLowerCase() === want &&
                                                (() => {
                                                    const rect = n.getBoundingClientRect();
                                                    const style = getComputedStyle(n);
                                                    return (rect.width > 0 &&
                                                        rect.height > 0 &&
                                                        style.display !== "none" &&
                                                        style.visibility !== "hidden");
                                                })()) ||
                                                nodes.find((n) => {
                                                    const rect = n.getBoundingClientRect();
                                                    const style = getComputedStyle(n);
                                                    return ((n.textContent || "").trim().toLowerCase().includes(want) &&
                                                        rect.width > 0 &&
                                                        rect.height > 0 &&
                                                        style.display !== "none" &&
                                                        style.visibility !== "hidden");
                                                });
                                            if (!el)
                                                return false;
                                            el.setAttribute("data-opencode-browser-target", token);
                                            return true;
                                        }, args.text, temporaryTarget);
                                        if (!found) {
                                            return ok({ ok: false, error: `text not found: ${args.text}` });
                                        }
                                        selector = `[data-opencode-browser-target="${temporaryTarget}"]`;
                                    }
                                    else {
                                        return ok({ ok: false, error: "selector or text required" });
                                    }
                                    await showTarget(selector);
                                    const navWait = page
                                        .waitForNavigation({
                                        waitUntil: "domcontentloaded",
                                        timeout: Math.min(timeout, 10000),
                                    })
                                        .catch(() => null);
                                    try {
                                        await page.click(selector);
                                        await Promise.race([navWait, new Promise((r) => setTimeout(r, 800))]);
                                        await new Promise((r) => setTimeout(r, 200));
                                    }
                                    finally {
                                        if (temporaryTarget) {
                                            await page
                                                .evaluate((token) => {
                                                document
                                                    .querySelector(`[data-opencode-browser-target="${token}"]`)
                                                    ?.removeAttribute("data-opencode-browser-target");
                                            }, temporaryTarget)
                                                .catch(() => { });
                                        }
                                    }
                                    return ok({ ok: true, url: page.url(), title: await page.title() });
                                }
                                case "fill": {
                                    if (!args.selector)
                                        return ok({ ok: false, error: "selector required" });
                                    const value = args.value ?? args.text ?? "";
                                    const delay = args.delay ?? 0;
                                    if (!Number.isFinite(delay) || delay < 0) {
                                        return ok({ ok: false, error: "delay must be a non-negative number" });
                                    }
                                    await page.waitForSelector(args.selector, { timeout });
                                    await showTarget(args.selector);
                                    if (delay === 0 && (await api.fastFill(page, args.selector, value))) {
                                        return ok({ ok: true, selector: args.selector, value, url: page.url() });
                                    }
                                    const editable = await page.$eval(args.selector, (element) => {
                                        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
                                            return !element.disabled && !element.readOnly && element.type !== "file";
                                        }
                                        return element instanceof HTMLElement && element.isContentEditable;
                                    });
                                    if (!editable)
                                        return ok({ ok: false, error: "element is not editable" });
                                    const focused = await focusTarget(args.selector);
                                    if (!focused)
                                        return ok({ ok: false, error: "element could not be focused" });
                                    await page.keyboard.down(process.platform === "darwin" ? "Meta" : "Control");
                                    await page.keyboard.press("A");
                                    await page.keyboard.up(process.platform === "darwin" ? "Meta" : "Control");
                                    await page.keyboard.press("Backspace");
                                    await page.keyboard.type(value, { delay });
                                    return ok({ ok: true, selector: args.selector, value, url: page.url() });
                                }
                                case "type": {
                                    const value = args.value ?? args.text ?? "";
                                    const delay = args.delay ?? 0;
                                    if (!Number.isFinite(delay) || delay < 0) {
                                        return ok({ ok: false, error: "delay must be a non-negative number" });
                                    }
                                    if (args.selector) {
                                        await page.waitForSelector(args.selector, { timeout });
                                        await showTarget(args.selector);
                                        if (!(await focusTarget(args.selector))) {
                                            return ok({ ok: false, error: "element could not be focused" });
                                        }
                                    }
                                    else {
                                        if (!(await visual.restorePageFocus(page))) {
                                            return ok({ ok: false, error: "page focus could not be restored" });
                                        }
                                        await visual.updateVisuals(page, visual.tasksForPort(port), {
                                            active: true,
                                            label: visualTask.label,
                                        });
                                    }
                                    await page.keyboard.type(value, { delay });
                                    return ok({ ok: true, typed: value, url: page.url() });
                                }
                                case "select": {
                                    if (!args.selector)
                                        return ok({ ok: false, error: "selector required" });
                                    const value = args.value ?? args.text;
                                    if (value == null)
                                        return ok({ ok: false, error: "value required" });
                                    await page.waitForSelector(args.selector, { timeout });
                                    await showTarget(args.selector);
                                    const selected = await page.select(args.selector, value);
                                    return ok({ ok: true, selected, url: page.url() });
                                }
                                case "check": {
                                    if (!args.selector)
                                        return ok({ ok: false, error: "selector required" });
                                    await page.waitForSelector(args.selector, { timeout });
                                    await showTarget(args.selector);
                                    const want = args.value === undefined
                                        ? true
                                        : args.value === "false" || args.value === "0"
                                            ? false
                                            : Boolean(args.value);
                                    const el = await page.$(args.selector);
                                    if (!el)
                                        return ok({ ok: false, error: "element not found" });
                                    const checked = await page.evaluate((node) => !!node.checked, el);
                                    if (checked !== want)
                                        await el.click();
                                    const after = await page.evaluate((node) => !!node.checked, el);
                                    return ok({ ok: true, checked: after, url: page.url() });
                                }
                                case "press": {
                                    if (!args.key)
                                        return ok({ ok: false, error: "key required" });
                                    if (args.selector) {
                                        await page.waitForSelector(args.selector, { timeout });
                                        await showTarget(args.selector);
                                        if (!(await focusTarget(args.selector))) {
                                            return ok({ ok: false, error: "element could not be focused" });
                                        }
                                    }
                                    else {
                                        if (!(await visual.restorePageFocus(page))) {
                                            return ok({ ok: false, error: "page focus could not be restored" });
                                        }
                                        await visual.updateVisuals(page, visual.tasksForPort(port), {
                                            active: true,
                                            label: visualTask.label,
                                        });
                                    }
                                    await page.keyboard.press(args.key);
                                    await new Promise((r) => setTimeout(r, 200));
                                    return ok({ ok: true, key: args.key, url: page.url() });
                                }
                                case "wait": {
                                    if (args.selector) {
                                        await page.waitForSelector(args.selector, { timeout });
                                        await showTarget(args.selector);
                                        return ok({
                                            ok: true,
                                            waited: "selector",
                                            selector: args.selector,
                                            url: page.url(),
                                        });
                                    }
                                    if (args.text) {
                                        await page.waitForFunction((t) => (document.body?.innerText || "").includes(t), { timeout }, args.text);
                                        return ok({ ok: true, waited: "text", text: args.text, url: page.url() });
                                    }
                                    await new Promise((r) => setTimeout(r, Math.max(0, timeout)));
                                    return ok({ ok: true, waited: "timeout", url: page.url() });
                                }
                                case "screenshot": {
                                    const file = api.shotPath(args.name || "page");
                                    await visual.withVisualsHidden(page, () => page.screenshot({ path: file, fullPage: !!args.fullPage }));
                                    return ok({ ok: true, path: file, url: page.url(), title: await page.title() });
                                }
                                case "close_tab": {
                                    await page.close();
                                    return ok({ ok: true, closed: true });
                                }
                                default:
                                    return ok({ ok: false, error: `unknown action: ${args.action}` });
                            }
                        })();
                        try {
                            taskFailed = JSON.parse(result).ok === false;
                        }
                        catch {
                            /* tool results are JSON, but a non-JSON result is still a completed action */
                        }
                        return result;
                    }
                    catch (error) {
                        taskFailed = true;
                        throw error;
                    }
                    finally {
                        visual.finishTask(visualTask, !taskFailed);
                        await visual.updateVisuals(page, visual.tasksForPort(port)).catch(() => { });
                    }
                }, { port, newTab: !!args.newTab });
            }
            catch (error) {
                visual.finishTask(visualTask, false);
                throw error;
            }
        }
        catch (e) {
            return err(e);
        }
    },
});
//# sourceMappingURL=tool.js.map