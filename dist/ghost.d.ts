export type GhostTaskStatus = "queued" | "running" | "done" | "failed";
export type GhostTask = {
    id: number;
    label: string;
    status: GhostTaskStatus;
};
export type GhostTarget = {
    selector?: string;
    active?: boolean;
    label: string;
};
export type GhostUpdate = {
    tasks: GhostTask[];
    target?: GhostTarget;
};
export type GhostRuntime = {
    owner: string;
    mount: () => boolean;
    update: (next: GhostUpdate) => Promise<boolean>;
    actionDelay: () => number;
    restoreFocus: () => boolean;
    hide: () => string | null;
    show: (visibility: string) => void;
    remove: () => void;
    destroy: () => void;
};
export declare const GHOST_OWNER: string;
export declare const GHOST_ENABLED: boolean;
export declare const GHOST_ACTION_DELAY: number;
/** Serialized by Puppeteer and installed before every document in a managed target. */
export declare const GHOST_SOURCE: (config: {
    owner: string;
    actionDelay: number;
}) => void;
//# sourceMappingURL=ghost.d.ts.map