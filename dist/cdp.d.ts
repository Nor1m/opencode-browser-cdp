import { type Browser, type Page } from "puppeteer-core";
import { type GhostGuidance } from "./ghost.js";
declare const DATA_DIR: string;
declare const STATE_PATH: string;
export declare const DEFAULT_PORT: number;
export declare const PROFILE_DIR: string;
export declare const SHOT_DIR: string;
export declare function findChrome(): string | null;
export declare function cdpBase(port?: number): string;
export declare function isCdpUp(port?: number): Promise<Record<string, string> | null>;
export declare function resolvePort(explicit?: number): number;
export declare function rememberPort(port: number): number;
export declare function ensureChrome({ port, headed, }?: {
    port?: number;
    headed?: boolean;
}): Promise<{
    ok: true;
    started: boolean;
    port: number;
    version: Record<string, string>;
    error?: undefined;
    pid?: undefined;
    chrome?: undefined;
} | {
    ok: false;
    error: string;
    started?: undefined;
    port?: undefined;
    version?: undefined;
    pid?: undefined;
    chrome?: undefined;
} | {
    ok: true;
    started: boolean;
    port: number;
    version: Record<string, string>;
    pid: number | undefined;
    chrome: string;
    error?: undefined;
} | {
    ok: false;
    error: string;
    chrome: string;
    pid: number | undefined;
    started?: undefined;
    port?: undefined;
    version?: undefined;
}>;
export declare function connect(port?: number): Promise<Browser>;
export declare function disconnectAll(): Promise<void>;
export declare function activate(): () => Promise<void>;
export declare function ensureGhost(page: Page): Promise<boolean>;
export declare function destroyGhost(page: Page): Promise<void>;
export declare function collectGhostGuidance(consume?: boolean): Promise<GhostGuidance | null>;
export declare function withPage<T>(fn: (page: Page, browser: Browser) => Promise<T>, { port, tabId, newTab, }?: {
    port?: number;
    tabId?: string | null;
    newTab?: boolean;
}): Promise<T>;
export declare function fastFill(page: Page, selector: string, value: string): Promise<boolean>;
export declare function dismissCookies(page: Page): Promise<string[]>;
export declare function shotPath(name?: string): string;
export { STATE_PATH, DATA_DIR };
//# sourceMappingURL=cdp.d.ts.map