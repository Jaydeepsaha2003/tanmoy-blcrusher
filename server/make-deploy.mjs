// Assembles a self-contained ./deploy folder for Node hosting that runs
// `npm install` on the server (e.g. Hostinger + Phusion Passenger).
//
// The repo's root package.json has an Electron-oriented "postinstall"
// (electron-builder install-app-deps) that would wrongly rebuild better-sqlite3
// for Electron on the host. The generated package.json below has NO postinstall
// and only the three runtime dependencies, so `npm install` on the server fetches
// the correct Node prebuilt of better-sqlite3.
//
// Run AFTER `npm run build:web` (needs dist-server/ and out/renderer/).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const deploy = path.join(root, 'deploy')
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

const distServer = path.join(root, 'dist-server')
const renderer = path.join(root, 'out', 'renderer')
for (const [label, dir] of [
  ['dist-server/index.cjs', distServer],
  ['out/renderer', renderer]
]) {
  if (!fs.existsSync(dir)) {
    console.error(`Missing ${label}. Run "npm run build:web" first.`)
    process.exit(1)
  }
}

// Fresh deploy/ (keep any existing deploy/data so a local test DB survives).
if (fs.existsSync(deploy)) {
  for (const entry of fs.readdirSync(deploy)) {
    if (entry === 'data' || entry === 'node_modules') continue
    fs.rmSync(path.join(deploy, entry), { recursive: true, force: true })
  }
} else {
  fs.mkdirSync(deploy)
}

fs.cpSync(distServer, path.join(deploy, 'dist-server'), { recursive: true })
fs.cpSync(renderer, path.join(deploy, 'out', 'renderer'), { recursive: true })

const pick = (name) => rootPkg.dependencies[name]
const deployPkg = {
  name: 'bl-crusher-manager-web',
  version: rootPkg.version,
  private: true,
  // Passenger imports this startup file (set it in hPanel's Node app config).
  main: 'app.js',
  scripts: { start: 'node app.js' },
  engines: { node: '>=18 <23' },
  dependencies: {
    'better-sqlite3': pick('better-sqlite3'),
    cookie: pick('cookie'),
    express: pick('express')
  }
}
fs.writeFileSync(path.join(deploy, 'package.json'), JSON.stringify(deployPkg, null, 2) + '\n')

fs.writeFileSync(
  path.join(deploy, 'app.js'),
  `// Startup file for Phusion Passenger (Hostinger Node.js hosting).
// Loads the pre-bundled Express server. Listens on process.env.PORT.
require('./dist-server/index.cjs')
`
)

fs.writeFileSync(path.join(deploy, '.gitignore'), 'node_modules/\ndata/\n')

console.log('Deploy bundle ready -> deploy/')
console.log('  contents: app.js, package.json, dist-server/, out/renderer/')
console.log('  next: upload the folder to Hostinger, set startup file = app.js, run NPM install, start.')
