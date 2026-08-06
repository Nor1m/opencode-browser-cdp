import type { Page } from "puppeteer-core";
import { type GhostTarget, type GhostTask } from "./ghost.js";
export type VisualTask = GhostTask;
export declare function queueTask(port: number, label: string): VisualTask;
export declare function startTask(task: VisualTask): void;
export declare function finishTask(task: VisualTask, success: boolean): void;
export declare function tasksForPort(port: number): VisualTask[];
export declare function clearTasks(port?: number): void;
export declare function updateVisuals(page: Page, tasks: VisualTask[], target?: GhostTarget): Promise<boolean>;
export declare function waitForActionDelay(page: Page): Promise<number>;
export declare function restorePageFocus(page: Page): Promise<boolean>;
export declare function removeVisuals(page: Page): Promise<void>;
export declare function withVisualsHidden<T>(page: Page, fn: () => Promise<T>): Promise<T>;
//# sourceMappingURL=visual.d.ts.map