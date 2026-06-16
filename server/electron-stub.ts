// Minimal stand-in for the 'electron' module. The shared main-process code only
// touches app.getPath() (to locate the SQLite file); on the server we always set
// BL_DB_DIR, so getPath is effectively never the source of truth. esbuild aliases
// 'electron' to this file when bundling the web server.
export const app = {
  getPath: (_name: string): string => process.env.BL_DB_DIR || process.cwd()
}

export const ipcMain = {
  handle: (): void => {}
}

export default { app, ipcMain }
