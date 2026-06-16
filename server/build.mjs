// Bundles the web server (server/index.ts) and the shared main-process code it
// imports into a single CommonJS file at dist-server/index.cjs.
//
//  - '@shared/*'      -> src/shared (path alias used throughout the services)
//  - 'electron'       -> server/electron-stub.ts (we run under plain Node)
//  - better-sqlite3 / express / cookie stay external (resolved from node_modules
//    at runtime; better-sqlite3 is a native addon and MUST NOT be bundled).
import esbuild from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await esbuild.build({
  entryPoints: [path.join(root, 'server', 'index.ts')],
  outfile: path.join(root, 'dist-server', 'index.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: true,
  external: ['better-sqlite3', 'mysql2', 'mysql2/promise', 'express', 'cookie'],
  alias: {
    electron: path.join(root, 'server', 'electron-stub.ts'),
    '@shared': path.join(root, 'src', 'shared')
  },
  logLevel: 'info'
})

// eslint-disable-next-line no-console
console.log('Server bundled -> dist-server/index.cjs')
