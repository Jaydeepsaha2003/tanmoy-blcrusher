// Generates PWA PNG icons (no external image deps) into src/renderer/public/icons.
// Brand-blue background (#1451e1, the app's --primary) with a white mountain,
// matching the in-app logo. Run once: `node server/make-icons.mjs`.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'src', 'renderer', 'public', 'icons')
fs.mkdirSync(outDir, { recursive: true })

const BG = [20, 81, 225] // #1451e1
const WHITE = [255, 255, 255]

// CRC32 (PNG chunk checksums)
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function sign(ax, ay, bx, by, cx, cy) {
  return (ax - cx) * (by - cy) - (bx - cx) * (ay - cy)
}
function inTri(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = sign(px, py, ax, ay, bx, by)
  const d2 = sign(px, py, bx, by, cx, cy)
  const d3 = sign(px, py, cx, cy, ax, ay)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

// Mountain (two peaks) in normalized content-area coords [0,1].
function isMountain(u, v) {
  const big = inTri(u, v, 0.5, 0.2, 0.12, 0.82, 0.88, 0.82)
  const small = inTri(u, v, 0.31, 0.42, 0.06, 0.82, 0.56, 0.82)
  return big || small
}

function makePng(size, pad) {
  const span = 1 - 2 * pad
  const raw = Buffer.alloc(size * (1 + size * 4))
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const u = (x / size - pad) / span
      const v = (y / size - pad) / span
      const isContent = u >= 0 && u <= 1 && v >= 0 && v <= 1
      const c = isContent && isMountain(u, v) ? WHITE : BG
      raw[o++] = c[0]
      raw[o++] = c[1]
      raw[o++] = c[2]
      raw[o++] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const targets = [
  ['icon-192.png', 192, 0.08],
  ['icon-512.png', 512, 0.08],
  ['icon-maskable-512.png', 512, 0.2], // safe-zone padding for maskable
  ['icon-180.png', 180, 0.08] // apple-touch-icon
]
for (const [name, size, pad] of targets) {
  fs.writeFileSync(path.join(outDir, name), makePng(size, pad))
  // eslint-disable-next-line no-console
  console.log(`wrote icons/${name} (${size}px)`)
}
