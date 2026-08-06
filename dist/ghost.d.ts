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
export type GhostGuidanceTarget = {
    selector: string;
    tag: string;
    role: string;
    ariaLabel: string;
    text: string;
    html: string;
};
export type GhostGuidance = {
    instruction: string;
    target?: GhostGuidanceTarget;
    url: string;
    title: string;
    updatedAt: number;
};
export type SignedGhostGuidance = {
    guidance: GhostGuidance;
    signature: string;
};
export declare const GHOST_THEME_NAMES: readonly ["carbon", "graphite", "obsidian", "slate", "ink", "paper", "porcelain", "fog", "stone", "pearl"];
export type GhostTheme = (typeof GHOST_THEME_NAMES)[number];
export type GhostThemePreference = {
    name: GhostTheme;
    updatedAt: number;
};
export declare const isGhostTheme: (value: unknown) => value is GhostTheme;
export type GhostRuntime = {
    owner: string;
    mount: () => boolean;
    update: (next: GhostUpdate) => Promise<boolean>;
    actionDelay: () => number;
    guidance: (consume?: boolean) => SignedGhostGuidance | null;
    theme: () => GhostThemePreference;
    setTheme: (preference: GhostThemePreference) => boolean;
    restoreFocus: () => boolean;
    hide: () => string | null;
    show: (visibility: string) => void;
    remove: () => void;
    destroy: () => void;
};
export declare const GHOST_OWNER: string;
export declare const GHOST_GUIDANCE_SECRET: string;
export declare const GHOST_ENABLED: boolean;
export declare const GHOST_ACTION_DELAY: number;
/** Serialized by Puppeteer and installed before every document in a managed target. */
export declare const GHOST_SOURCE: (config: {
    owner: string;
    actionDelay: number;
    guidanceSecret: string;
    theme: GhostTheme;
    themeUpdatedAt: number;
}) => void;
//# sourceMappingURL=ghost.d.ts.map