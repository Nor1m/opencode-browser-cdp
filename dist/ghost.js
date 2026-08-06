export const GHOST_OWNER = `opencode-${process.pid}-${Math.random().toString(36).slice(2)}`;
export const GHOST_GUIDANCE_SECRET = randomBytes(32).toString("base64url");
export const GHOST_ENABLED = process.env.OPENCODE_BROWSER_VISUALS !== "0";
const configuredActionDelay = Number(process.env.OPENCODE_BROWSER_ACTION_DELAY ?? 350);
export const GHOST_ACTION_DELAY = Number.isFinite(configuredActionDelay)
    ? Math.min(Math.max(configuredActionDelay, 0), 2000)
    : 350;
/** Serialized by Puppeteer and installed before every document in a managed target. */
export const GHOST_SOURCE = (config) => {
    if (window !== window.top)
        return;
    const ghostWindow = window;
    if (ghostWindow.__ghostDisabled)
        return;
    const previous = ghostWindow.__opencodeBrowserGhost;
    if (previous?.owner === config.owner) {
        previous.mount();
        return;
    }
    previous?.remove();
    const storageKey = `__opencode_browser_ghost:${config.owner}`;
    const hostId = "__opencode_browser_visuals";
    let tasks = [];
    let target;
    let actionDelay = config.actionDelay;
    let guidance = {
        instruction: "",
        url: "",
        title: "",
        updatedAt: 0,
    };
    let promptDraft = "";
    let storedGuidance = null;
    let cursorPosition = null;
    let hudPosition = null;
    let mountObserver = null;
    let contextCandidate = null;
    const localizedLabels = () => {
        const language = (document.documentElement?.lang || navigator.language || "en").toLowerCase();
        return language.startsWith("ru")
            ? {
                prompt: "Доп. пожелание для ИИ…",
                send: "Отправить пожелание",
                sent: "Готово для следующего запроса",
                idle: "Нет пожеланий",
                lookHere: "Смотри сюда",
                pace: "Скорость",
                taskIdle: "ожидание",
            }
            : language.startsWith("zh")
                ? {
                    prompt: "给 AI 的附加指令…",
                    send: "发送指令",
                    sent: "将在下一次请求中发送",
                    idle: "暂无指令",
                    lookHere: "看这里",
                    pace: "速度",
                    taskIdle: "空闲",
                }
                : {
                    prompt: "Additional instruction for AI…",
                    send: "Send instruction",
                    sent: "Ready for the next request",
                    idle: "No guidance",
                    lookHere: "Look here",
                    pace: "Pace",
                    taskIdle: "idle",
                };
    };
    let labels = localizedLabels();
    try {
        const stored = JSON.parse(sessionStorage.getItem(storageKey) || "null");
        if (Array.isArray(stored?.tasks))
            tasks = stored.tasks;
        if (Number.isFinite(stored?.actionDelay)) {
            actionDelay = Math.min(Math.max(Number(stored?.actionDelay), 0), 2000);
        }
        if (Number.isFinite(stored?.cursorPosition?.x) && Number.isFinite(stored?.cursorPosition?.y)) {
            cursorPosition = stored?.cursorPosition ?? null;
        }
        if (Number.isFinite(stored?.hudPosition?.x) && Number.isFinite(stored?.hudPosition?.y)) {
            hudPosition = stored?.hudPosition ?? null;
        }
        if (typeof stored?.promptDraft === "string")
            promptDraft = stored.promptDraft.slice(0, 2000);
        if (stored?.pendingGuidance?.guidance &&
            typeof stored.pendingGuidance.signature === "string" &&
            typeof stored.pendingGuidance.guidance.instruction === "string" &&
            JSON.stringify(stored.pendingGuidance.guidance).length <= 8192) {
            storedGuidance = stored.pendingGuidance;
        }
    }
    catch {
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
                : null;
            const pendingGuidance = current
                ? { guidance: current, signature: signGuidance(current) }
                : undefined;
            sessionStorage.setItem(storageKey, JSON.stringify({
                tasks,
                actionDelay,
                cursorPosition,
                hudPosition,
                promptDraft,
                pendingGuidance,
            }));
        }
        catch {
            /* keep the runtime in memory when storage is unavailable */
        }
    };
    const sha256 = (input) => {
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
        ]);
        const rotate = (value, bits) => (value >>> bits) | (value << (32 - bits));
        const bitLength = input.length * 8;
        const size = Math.ceil((input.length + 9) / 64) * 64;
        const data = new Uint8Array(size);
        data.set(input);
        data[input.length] = 0x80;
        const view = new DataView(data.buffer);
        view.setUint32(size - 8, Math.floor(bitLength / 0x100000000));
        view.setUint32(size - 4, bitLength >>> 0);
        const hash = new Uint32Array([
            0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
            0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
        ]);
        const words = new Uint32Array(64);
        for (let offset = 0; offset < size; offset += 64) {
            for (let index = 0; index < 16; index += 1)
                words[index] = view.getUint32(offset + index * 4);
            for (let index = 16; index < 64; index += 1) {
                const a = words[index - 15];
                const b = words[index - 2];
                const s0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3);
                const s1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10);
                words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
            }
            let [a, b, c, d, e, f, g, h] = hash;
            for (let index = 0; index < 64; index += 1) {
                const sigma1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
                const choice = (e & f) ^ (~e & g);
                const first = (h + sigma1 + choice + constants[index] + words[index]) >>> 0;
                const sigma0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
                const majority = (a & b) ^ (a & c) ^ (b & c);
                const second = (sigma0 + majority) >>> 0;
                h = g;
                g = f;
                f = e;
                e = (d + first) >>> 0;
                d = c;
                c = b;
                b = a;
                a = (first + second) >>> 0;
            }
            hash[0] = (hash[0] + a) >>> 0;
            hash[1] = (hash[1] + b) >>> 0;
            hash[2] = (hash[2] + c) >>> 0;
            hash[3] = (hash[3] + d) >>> 0;
            hash[4] = (hash[4] + e) >>> 0;
            hash[5] = (hash[5] + f) >>> 0;
            hash[6] = (hash[6] + g) >>> 0;
            hash[7] = (hash[7] + h) >>> 0;
        }
        const output = new Uint8Array(32);
        const outputView = new DataView(output.buffer);
        hash.forEach((value, index) => outputView.setUint32(index * 4, value));
        return output;
    };
    const signGuidance = (value) => {
        const encode = (text) => {
            const bytes = [];
            for (let index = 0; index < text.length; index += 1) {
                let point = text.charCodeAt(index);
                if (point >= 0xd800 && point <= 0xdbff && index + 1 < text.length) {
                    const low = text.charCodeAt(index + 1);
                    if (low >= 0xdc00 && low <= 0xdfff) {
                        point = 0x10000 + ((point - 0xd800) << 10) + (low - 0xdc00);
                        index += 1;
                    }
                }
                if (point <= 0x7f)
                    bytes.push(point);
                else if (point <= 0x7ff)
                    bytes.push(0xc0 | (point >>> 6), 0x80 | (point & 0x3f));
                else if (point <= 0xffff) {
                    bytes.push(0xe0 | (point >>> 12), 0x80 | ((point >>> 6) & 0x3f), 0x80 | (point & 0x3f));
                }
                else {
                    bytes.push(0xf0 | (point >>> 18), 0x80 | ((point >>> 12) & 0x3f), 0x80 | ((point >>> 6) & 0x3f), 0x80 | (point & 0x3f));
                }
            }
            return new Uint8Array(bytes);
        };
        let key = encode(config.guidanceSecret);
        if (key.length > 64)
            key = sha256(key);
        const innerPad = new Uint8Array(64);
        const outerPad = new Uint8Array(64);
        for (let index = 0; index < 64; index += 1) {
            innerPad[index] = (key[index] ?? 0) ^ 0x36;
            outerPad[index] = (key[index] ?? 0) ^ 0x5c;
        }
        const message = encode(JSON.stringify(value));
        const inner = new Uint8Array(innerPad.length + message.length);
        inner.set(innerPad);
        inner.set(message, innerPad.length);
        const innerHash = sha256(inner);
        const outer = new Uint8Array(outerPad.length + innerHash.length);
        outer.set(outerPad);
        outer.set(innerHash, outerPad.length);
        return btoa(String.fromCharCode(...sha256(outer)));
    };
    if (storedGuidance &&
        storedGuidance.signature === signGuidance(storedGuidance.guidance)) {
        guidance = storedGuidance.guidance;
    }
    storedGuidance = null;
    const findHost = () => document.querySelector(`[data-opencode-browser-owner="${config.owner}"]`);
    const add = (root, tag, id, css, parent = root) => {
        const element = document.createElement(tag);
        element.id = id;
        element.style.cssText = css;
        parent.appendChild(element);
        return element;
    };
    const build = (host, root) => {
        root.replaceChildren();
        const focus = add(root, "div", "focus", "position:fixed;left:0;top:0;z-index:2;width:0;height:0;opacity:0;border:3px solid #6ee7ff;border-radius:9px;box-shadow:0 0 0 2px rgba(5,13,24,.75),0 0 22px rgba(42,210,255,.65);transform:translate3d(0,0,0);transition:transform 180ms cubic-bezier(.2,.8,.2,1),width 180ms ease,height 180ms ease,opacity 100ms ease;box-sizing:border-box");
        add(root, "span", "focus-label", "position:absolute;left:-2px;bottom:calc(100% + 7px);max-width:280px;padding:5px 8px;overflow:hidden;color:#dffaff;background:#07111f;border:1px solid rgba(110,231,255,.7);border-radius:6px;font:600 11px/1.25 ui-monospace,SFMono-Regular,Consolas,monospace;text-overflow:ellipsis;white-space:nowrap;box-sizing:border-box", focus);
        const cursor = add(root, "div", "cursor", "position:fixed;left:0;top:0;z-index:2;width:24px;height:30px;opacity:0;transform:translate3d(0,0,0);transition:transform 180ms cubic-bezier(.2,.8,.2,1),opacity 100ms ease;filter:drop-shadow(0 3px 5px rgba(0,0,0,.35))");
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 30");
        svg.style.cssText = "display:block;width:100%;height:100%";
        const cursorPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        cursorPath.setAttribute("d", "M2 1.5 21 17l-8.1 1.2 4.6 8.2-4.2 2.1-4.5-8.2L3 26Z");
        cursorPath.setAttribute("fill", "#6ee7ff");
        cursorPath.setAttribute("stroke", "#07111f");
        cursorPath.setAttribute("stroke-width", "2");
        cursorPath.setAttribute("stroke-linejoin", "round");
        svg.appendChild(cursorPath);
        cursor.appendChild(svg);
        const hud = add(root, "aside", "hud", "position:fixed;top:16px;right:16px;z-index:3;width:min(350px,calc(100vw - 32px));overflow:hidden;color:#e8f5ff;background:rgba(5,13,24,.92);border:1px solid rgba(110,231,255,.42);border-radius:12px;box-shadow:0 14px 35px rgba(0,0,0,.32);backdrop-filter:blur(12px);font:12px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;pointer-events:auto;box-sizing:border-box");
        const head = add(root, "div", "hud-head", "display:flex;align-items:center;justify-content:space-between;padding:10px 12px 8px;cursor:move;touch-action:none;user-select:none;box-sizing:border-box", hud);
        const title = add(root, "span", "hud-title", "color:#6ee7ff;font-weight:800;letter-spacing:.04em;text-transform:uppercase", head);
        title.textContent = "OpenCode browser";
        add(root, "span", "hud-count", "color:#9fb6c8;font-size:11px", head);
        head.addEventListener("pointerdown", (event) => {
            if (event.button !== 0)
                return;
            const rect = hud.getBoundingClientRect();
            const offsetX = event.clientX - rect.left;
            const offsetY = event.clientY - rect.top;
            head.setPointerCapture(event.pointerId);
            const move = (next) => {
                const x = Math.min(Math.max(next.clientX - offsetX, 0), Math.max(0, innerWidth - rect.width));
                const y = Math.min(Math.max(next.clientY - offsetY, 0), Math.max(0, innerHeight - 44));
                hud.style.left = `${x}px`;
                hud.style.top = `${y}px`;
                hud.style.right = "auto";
                hudPosition = { x, y };
            };
            const stop = () => {
                head.removeEventListener("pointermove", move);
                head.removeEventListener("pointerup", stop);
                head.removeEventListener("pointercancel", stop);
                save();
            };
            head.addEventListener("pointermove", move);
            head.addEventListener("pointerup", stop);
            head.addEventListener("pointercancel", stop);
        });
        const progress = add(root, "div", "progress", "height:3px;background:rgba(255,255,255,.1)", hud);
        add(root, "i", "progress-bar", "display:block;height:100%;width:0;background:linear-gradient(90deg,#22d3ee,#a3e635);transition:width 180ms ease", progress);
        add(root, "div", "tasks", "display:grid;gap:1px;padding:5px 6px 7px;max-height:280px;overflow:hidden;box-sizing:border-box", hud);
        const guidancePanel = add(root, "div", "guidance", "display:grid;gap:7px;padding:9px 10px;border-top:1px solid rgba(255,255,255,.08);box-sizing:border-box", hud);
        const prompt = document.createElement("textarea");
        prompt.id = "guidance-prompt";
        prompt.rows = 2;
        prompt.maxLength = 2000;
        prompt.placeholder = labels.prompt;
        prompt.style.cssText =
            "width:100%;min-height:48px;max-height:120px;resize:vertical;padding:7px 8px;color:#e8f5ff;background:rgba(255,255,255,.06);border:1px solid rgba(110,231,255,.28);border-radius:7px;outline:none;font:12px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;box-sizing:border-box";
        prompt.addEventListener("input", () => {
            promptDraft = prompt.value.slice(0, 2000);
            save();
        });
        const guidanceActions = document.createElement("div");
        guidanceActions.style.cssText = "display:flex;gap:6px;align-items:center";
        const send = document.createElement("button");
        send.id = "send-guidance";
        send.type = "button";
        send.textContent = labels.send;
        send.style.cssText =
            "padding:6px 9px;color:#07111f;background:#67e8f9;border:0;border-radius:7px;cursor:pointer;font:700 11px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace";
        send.addEventListener("click", (event) => {
            if (!event.isTrusted)
                return;
            const instruction = prompt.value.trim();
            if (!instruction)
                return;
            guidance = {
                ...guidance,
                instruction,
                url: location.href,
                title: document.title,
                updatedAt: Date.now(),
            };
            promptDraft = "";
            prompt.value = "";
            save();
            syncGuidance(root);
        });
        const guidanceStatus = document.createElement("span");
        guidanceStatus.id = "guidance-status";
        guidanceStatus.style.cssText =
            "min-width:0;overflow:hidden;color:#9fb6c8;font-size:10px;text-overflow:ellipsis;white-space:nowrap";
        guidanceActions.append(send, guidanceStatus);
        guidancePanel.append(prompt, guidanceActions);
        const settings = add(root, "label", "pace", "display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;padding:8px 12px 10px;color:#9fb6c8;border-top:1px solid rgba(255,255,255,.08);pointer-events:auto;box-sizing:border-box", hud);
        const paceLabel = document.createElement("span");
        paceLabel.textContent = labels.pace;
        const slider = document.createElement("input");
        slider.id = "pace-slider";
        slider.type = "range";
        slider.min = "0";
        slider.max = "2000";
        slider.step = "50";
        slider.value = String(actionDelay);
        slider.style.cssText = "width:100%;accent-color:#22d3ee;cursor:pointer";
        const paceValue = document.createElement("output");
        paceValue.id = "pace-value";
        paceValue.textContent = `${slider.value} ms`;
        paceValue.style.cssText = "min-width:58px;text-align:right;color:#dffaff";
        slider.addEventListener("input", () => {
            actionDelay = Number(slider.value);
            paceValue.textContent = `${slider.value} ms`;
            save();
        });
        slider.addEventListener("pointerdown", () => {
            const active = document.activeElement;
            if (active instanceof HTMLElement && active !== host)
                host.__opencodePreviousFocus = active;
        });
        settings.append(paceLabel, slider, paceValue);
        const contextMenu = add(root, "div", "context-menu", "display:none;position:fixed;left:0;top:0;z-index:4;padding:5px;color:#e8f5ff;background:rgba(5,13,24,.97);border:1px solid rgba(110,231,255,.48);border-radius:9px;box-shadow:0 12px 30px rgba(0,0,0,.38);pointer-events:auto;box-sizing:border-box");
        const lookHere = document.createElement("button");
        lookHere.id = "context-look-here";
        lookHere.type = "button";
        lookHere.textContent = labels.lookHere;
        lookHere.style.cssText =
            "display:block;width:100%;padding:7px 11px;color:#dffaff;background:transparent;border:0;border-radius:6px;cursor:pointer;text-align:left;font:700 12px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap";
        lookHere.addEventListener("pointerenter", () => {
            lookHere.style.background = "rgba(103,232,249,.14)";
        });
        lookHere.addEventListener("pointerleave", () => {
            lookHere.style.background = "transparent";
        });
        lookHere.addEventListener("click", (event) => {
            if (!event.isTrusted || !contextCandidate)
                return;
            event.preventDefault();
            event.stopPropagation();
            selectContextTarget(root, contextCandidate);
            contextCandidate = null;
            contextMenu.style.display = "none";
        });
        contextMenu.appendChild(lookHere);
        const closeContextMenu = (event) => {
            if (event && event.composedPath().includes(contextMenu))
                return;
            contextCandidate = null;
            contextMenu.style.display = "none";
        };
        const openContextMenu = (event) => {
            if (!event.isTrusted || event.composedPath().includes(host))
                return;
            const element = event.composedPath().find((item) => item instanceof Element);
            if (!element)
                return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            contextCandidate = element;
            contextMenu.style.visibility = "hidden";
            contextMenu.style.display = "block";
            const rect = contextMenu.getBoundingClientRect();
            const x = Math.min(event.clientX, Math.max(0, innerWidth - rect.width - 4));
            const y = Math.min(event.clientY, Math.max(0, innerHeight - rect.height - 4));
            contextMenu.style.left = `${Math.max(0, x)}px`;
            contextMenu.style.top = `${Math.max(0, y)}px`;
            contextMenu.style.visibility = "visible";
            previewElement(root, element, labels.lookHere);
        };
        const closeOnEscape = (event) => {
            if (event.key === "Escape")
                closeContextMenu();
        };
        const blockRightButton = (event) => {
            if (event.button !== 2 || event.composedPath().includes(host))
                return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        };
        window.addEventListener("pointerdown", blockRightButton, true);
        window.addEventListener("mousedown", blockRightButton, true);
        window.addEventListener("pointerup", blockRightButton, true);
        window.addEventListener("mouseup", blockRightButton, true);
        window.addEventListener("auxclick", blockRightButton, true);
        window.addEventListener("contextmenu", openContextMenu, true);
        window.addEventListener("pointerdown", closeContextMenu, true);
        window.addEventListener("keydown", closeOnEscape, true);
        host.__opencodeContextCleanup = () => {
            window.removeEventListener("pointerdown", blockRightButton, true);
            window.removeEventListener("mousedown", blockRightButton, true);
            window.removeEventListener("pointerup", blockRightButton, true);
            window.removeEventListener("mouseup", blockRightButton, true);
            window.removeEventListener("auxclick", blockRightButton, true);
            window.removeEventListener("contextmenu", openContextMenu, true);
            window.removeEventListener("pointerdown", closeContextMenu, true);
            window.removeEventListener("keydown", closeOnEscape, true);
        };
        const trackPageFocus = (event) => {
            const focused = event.composedPath()[0];
            if (focused instanceof HTMLElement && focused !== host && !root.contains(focused)) {
                host.__opencodePreviousFocus = focused;
            }
        };
        document.addEventListener("focusin", trackPageFocus, true);
        host.__opencodeFocusCleanup = () => document.removeEventListener("focusin", trackPageFocus, true);
    };
    const renderTasks = (root) => {
        const tasksElement = root.getElementById("tasks");
        tasksElement.replaceChildren();
        const colors = {
            queued: "#64748b",
            running: "#67e8f9",
            done: "#a3e635",
            failed: "#fb7185",
        };
        for (const task of tasks) {
            const row = document.createElement("div");
            row.dataset.status = task.status;
            row.style.cssText =
                "display:grid;grid-template-columns:14px 1fr;gap:7px;align-items:start;padding:6px;border-radius:7px;box-sizing:border-box";
            if (task.status === "running")
                row.style.background = "rgba(34,211,238,.11)";
            row.style.color = task.status === "done" ? "#9fb6c8" : colors[task.status];
            const dot = document.createElement("span");
            dot.style.cssText = `width:8px;height:8px;margin-top:4px;border:1px solid ${colors[task.status]};border-radius:50%;box-sizing:border-box`;
            if (task.status !== "queued")
                dot.style.background = colors[task.status];
            if (task.status === "running")
                dot.style.boxShadow = "0 0 9px #22d3ee";
            const label = document.createElement("span");
            label.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
            label.textContent = task.label;
            row.append(dot, label);
            tasksElement.appendChild(row);
        }
        const complete = tasks.filter((task) => task.status === "done" || task.status === "failed").length;
        const count = root.getElementById("hud-count");
        count.textContent = tasks.length > 0 ? `${complete}/${tasks.length}` : labels.taskIdle;
        const bar = root.getElementById("progress-bar");
        bar.style.width = tasks.length > 0 ? `${Math.round((complete / tasks.length) * 100)}%` : "0%";
    };
    const syncGuidance = (root) => {
        const prompt = root.getElementById("guidance-prompt");
        const status = root.getElementById("guidance-status");
        if (prompt && root.activeElement !== prompt)
            prompt.value = promptDraft;
        if (status) {
            status.textContent = guidance.target?.selector || (guidance.instruction ? labels.sent : labels.idle);
        }
    };
    const showCursorAt = (root, x, y, persist = false) => {
        const cursor = root.getElementById("cursor");
        cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        cursor.style.opacity = "1";
        cursorPosition = { x, y };
        if (persist)
            save();
    };
    const previewElement = (root, element, label) => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0)
            return false;
        const focus = root.getElementById("focus");
        const padding = 5;
        focus.style.width = `${rect.width + padding * 2}px`;
        focus.style.height = `${rect.height + padding * 2}px`;
        focus.style.transform = `translate3d(${rect.left - padding}px, ${rect.top - padding}px, 0)`;
        focus.style.opacity = "1";
        root.getElementById("focus-label").textContent = label;
        showCursorAt(root, rect.left + rect.width / 2, rect.top + rect.height / 2);
        return true;
    };
    const selectorFor = (element) => {
        const escape = (value) => typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(value)
            : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
        if (element.id)
            return `#${escape(element.id)}`;
        const testId = element.getAttribute("data-testid");
        if (testId)
            return `[data-testid="${escape(testId)}"]`;
        const parts = [];
        let current = element;
        while (current && current !== document.documentElement && parts.length < 5) {
            let part = current.tagName.toLowerCase();
            const classes = [...current.classList].filter(Boolean).slice(0, 2);
            if (classes.length)
                part += classes.map((name) => `.${escape(name)}`).join("");
            const siblings = current.parentElement
                ? [...current.parentElement.children].filter((child) => child.tagName === current.tagName)
                : [];
            if (siblings.length > 1)
                part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
            parts.unshift(part);
            const candidate = parts.join(" > ");
            try {
                if (document.querySelectorAll(candidate).length === 1)
                    return candidate;
            }
            catch {
                /* keep building a simpler structural selector */
            }
            current = current.parentElement;
        }
        return parts.join(" > ");
    };
    const selectContextTarget = (root, element) => {
        const selector = selectorFor(element);
        const text = (element.innerText || element.textContent || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 1000);
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
        };
        target = { selector, label: labels.lookHere };
        previewElement(root, element, labels.lookHere);
        const rect = element.getBoundingClientRect();
        showCursorAt(root, rect.left + rect.width / 2, rect.top + rect.height / 2, true);
        save();
        syncGuidance(root);
    };
    const mount = () => {
        if (ghostWindow.__ghostDisabled)
            return false;
        if (!document.documentElement) {
            if (!mountObserver) {
                mountObserver = new MutationObserver(() => {
                    if (!document.documentElement)
                        return;
                    mountObserver?.disconnect();
                    mountObserver = null;
                    mount();
                });
                mountObserver.observe(document, { childList: true, subtree: true });
            }
            return false;
        }
        labels = localizedLabels();
        let host = findHost();
        if (!host) {
            host = document.createElement("div");
            host.id = document.getElementById(hostId) ? `${hostId}_overlay` : hostId;
            host.dataset.opencodeBrowserVisuals = "true";
            host.dataset.opencodeBrowserOwner = config.owner;
            host.style.cssText =
                "position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block;visibility:visible";
            document.documentElement.appendChild(host);
        }
        const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
        if (!root.getElementById("tasks") || !root.getElementById("pace-slider"))
            build(host, root);
        const hud = root.getElementById("hud");
        if (hudPosition) {
            const rect = hud.getBoundingClientRect();
            hudPosition = {
                x: Math.min(Math.max(hudPosition.x, 0), Math.max(0, innerWidth - rect.width)),
                y: Math.min(Math.max(hudPosition.y, 0), Math.max(0, innerHeight - 44)),
            };
            hud.style.left = `${hudPosition.x}px`;
            hud.style.top = `${hudPosition.y}px`;
            hud.style.right = "auto";
        }
        const slider = root.getElementById("pace-slider");
        const paceValue = root.getElementById("pace-value");
        slider.value = String(actionDelay);
        paceValue.textContent = `${slider.value} ms`;
        renderTasks(root);
        syncGuidance(root);
        showCursorAt(root, cursorPosition?.x ?? Math.round(innerWidth / 2), cursorPosition?.y ?? Math.round(innerHeight / 2));
        return true;
    };
    const highlight = async () => {
        if (!mount())
            return false;
        if (!target)
            return true;
        const host = findHost();
        const root = host?.shadowRoot;
        if (!host || !root)
            return false;
        let element = null;
        try {
            element = target.active ? document.activeElement : document.querySelector(target.selector || "");
        }
        catch {
            return false;
        }
        if (!element || element === document.documentElement || element === document.body)
            return false;
        if (element instanceof HTMLElement)
            host.__opencodePreviousFocus = element;
        element.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        host.__opencodeCleanup?.();
        const position = () => previewElement(root, element, target.label);
        if (!position())
            return false;
        save();
        let scheduled = false;
        const schedulePosition = () => {
            if (scheduled)
                return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                position();
            });
        };
        const observer = new ResizeObserver(schedulePosition);
        observer.observe(element);
        const mutations = new MutationObserver(schedulePosition);
        mutations.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["class", "style", "hidden"],
        });
        window.addEventListener("scroll", schedulePosition, true);
        window.addEventListener("resize", schedulePosition);
        const followUntil = performance.now() + 2000;
        let followFrame = 0;
        const followPosition = () => {
            position();
            if (performance.now() < followUntil)
                followFrame = requestAnimationFrame(followPosition);
        };
        followFrame = requestAnimationFrame(followPosition);
        host.__opencodeCleanup = () => {
            observer.disconnect();
            mutations.disconnect();
            cancelAnimationFrame(followFrame);
            window.removeEventListener("scroll", schedulePosition, true);
            window.removeEventListener("resize", schedulePosition);
        };
        return true;
    };
    const remove = () => {
        mountObserver?.disconnect();
        mountObserver = null;
        contextCandidate = null;
        const host = findHost();
        host?.__opencodeCleanup?.();
        host?.__opencodeFocusCleanup?.();
        host?.__opencodeContextCleanup?.();
        host?.remove();
    };
    const runtime = {
        owner: config.owner,
        mount,
        update: async (next) => {
            tasks = next.tasks.map((task) => ({ ...task }));
            target = next.target;
            save();
            return highlight();
        },
        actionDelay: () => actionDelay,
        guidance: (consume = false) => {
            if (!guidance.instruction.trim() && !guidance.target)
                return null;
            const value = {
                ...guidance,
                instruction: guidance.instruction.trim(),
                target: guidance.target ? { ...guidance.target } : undefined,
            };
            const result = { guidance: value, signature: signGuidance(value) };
            if (consume) {
                guidance = {
                    instruction: "",
                    url: location.href,
                    title: document.title,
                    updatedAt: Date.now(),
                };
                target = undefined;
                const root = findHost()?.shadowRoot;
                if (root)
                    syncGuidance(root);
                save();
            }
            return result;
        },
        restoreFocus: () => {
            const host = findHost();
            if (!host?.shadowRoot?.activeElement)
                return true;
            const prior = host.__opencodePreviousFocus;
            if (!prior?.isConnected)
                return false;
            prior.focus();
            return document.activeElement === prior;
        },
        hide: () => {
            const host = findHost();
            if (!host)
                return null;
            const visibility = host.style.visibility;
            host.style.visibility = "hidden";
            return visibility;
        },
        show: (visibility) => {
            const host = findHost();
            if (host)
                host.style.visibility = visibility;
        },
        remove,
        destroy: () => {
            ghostWindow.__ghostDisabled = true;
            remove();
            try {
                sessionStorage.removeItem(storageKey);
            }
            catch {
                /* ignore */
            }
            delete ghostWindow.__opencodeBrowserGhost;
        },
    };
    ghostWindow.__opencodeBrowserGhost = Object.freeze(runtime);
    runtime.mount();
};
import { randomBytes } from "node:crypto";
//# sourceMappingURL=ghost.js.map