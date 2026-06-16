declare const api: {
    call: <T = unknown>(method: string, payload?: unknown) => Promise<T>;
};
export type Api = typeof api;

declare global {
    interface Window {
        // Present in the Electron desktop build (injected by the preload).
        // Absent in the web build, where lib/api.ts falls back to fetch.
        api?: Api;
    }
}

export {};
