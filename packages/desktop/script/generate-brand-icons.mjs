#!/usr/bin/env node
// Regenerates the HyperCode desktop icon set from the canonical brand mark.
//
// Source of truth: <repo>/brand/hypercode-mark.svg (pure <rect> geometry on a
// 250x250 viewBox, so it can be rasterised exactly without a browser).
//
// Usage:  node scripts/generate-brand-icons.mjs [channel]   (default: prod)
//         node scripts/generate-brand-icons.mjs --verify [channel]
//
// Design: full-colour rounded tile (brand dark) + white mark, per brand/README.md
// ("深色背景 → 徽记用白色"). Every raster is produced by 4x supersampling.

import { deflateSync, inflateSync } from "node:zlib"
import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const packageDir = join(here, "..")
const repoRoot = join(packageDir, "..", "..")

const BG = [0x0e, 0x0e, 0x10]
const FG = [0xff, 0xff, 0xff]
const TILE_INSET = 0.04 // fraction of canvas left empty around the rounded tile
const CORNER_RATIO = 0.2237 // Apple "squircle" corner radius ratio
const MARK_WIDTH = 0.72 // mark width as a fraction of the canvas
const SS = 4 // supersampling factor

/* ------------------------------------------------------------------ SVG ---- */

export function loadMarkRects(svgPath) {
  const svg = readFileSync(svgPath, "utf8")
  const viewBox = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg)
  if (!viewBox) throw new Error(`no viewBox in ${svgPath}`)
  const rects = []
  const re = /<rect\s+x="([-\d.]+)"\s+y="([-\d.]+)"\s+width="([-\d.]+)"\s+height="([-\d.]+)"\s*\/>/g
  let m
  while ((m = re.exec(svg))) {
    rects.push({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] })
  }
  if (rects.length === 0) throw new Error(`no <rect> found in ${svgPath}; refusing to invent artwork`)
  // Guard: the mark must be rect-only geometry, otherwise this rasteriser would
  // silently drop shapes and produce a wrong icon.
  const other = svg.replace(re, "").match(/<(path|circle|ellipse|polygon|polyline|line)\b/)
  if (other) throw new Error(`${svgPath} contains <${other[1]}>, which this rasteriser cannot render`)
  const minX = Math.min(...rects.map((r) => r.x))
  const maxX = Math.max(...rects.map((r) => r.x + r.w))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxY = Math.max(...rects.map((r) => r.y + r.h))
  return { rects, bounds: { minX, maxX, minY, maxY } }
}

/* ------------------------------------------------------------ rasterise ---- */

function insideRoundedRect(px, py, x0, y0, x1, y1, r) {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false
  const cx = px < x0 + r ? x0 + r : px > x1 - r ? x1 - r : px
  const cy = py < y0 + r ? y0 + r : py > y1 - r ? y1 - r : py
  if (cx === px && cy === py) return true
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy <= r * r
}

// opts lets other generators (e.g. the web favicon set) reuse this rasteriser
// with different tile geometry. Defaults reproduce the desktop icon exactly.
export function renderIcon(size, mark, opts = {}) {
  const { markWidth = MARK_WIDTH, inset: insetRatio = TILE_INSET, cornerRatio = CORNER_RATIO } = opts
  const { rects, bounds } = mark
  const markW = bounds.maxX - bounds.minX
  const markH = bounds.maxY - bounds.minY
  const scale = (size * markWidth) / markW
  const offX = (size - markW * scale) / 2 - bounds.minX * scale
  const offY = (size - markH * scale) / 2 - bounds.minY * scale

  // Pre-scale the mark rects into canvas space once.
  const scaled = rects.map((r) => ({
    x0: r.x * scale + offX,
    y0: r.y * scale + offY,
    x1: (r.x + r.w) * scale + offX,
    y1: (r.y + r.h) * scale + offY,
  }))

  const inset = size * insetRatio
  const tx0 = inset
  const ty0 = inset
  const tx1 = size - inset
  const ty1 = size - inset
  const radius = (tx1 - tx0) * cornerRatio

  const px = Buffer.alloc(size * size * 4)
  const step = 1 / SS
  const samples = SS * SS

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0
      let fgHits = 0
      for (let sy = 0; sy < SS; sy++) {
        const py = y + (sy + 0.5) * step
        for (let sx = 0; sx < SS; sx++) {
          const pxx = x + (sx + 0.5) * step
          if (!insideRoundedRect(pxx, py, tx0, ty0, tx1, ty1, radius)) continue
          bgHits++
          for (const r of scaled) {
            if (pxx >= r.x0 && pxx < r.x1 && py >= r.y0 && py < r.y1) {
              fgHits++
              break
            }
          }
        }
      }
      const i = (y * size + x) * 4
      if (bgHits === 0) continue
      const alpha = bgHits / samples
      const fg = fgHits / bgHits // coverage of mark within the opaque area
      px[i] = Math.round(BG[0] * (1 - fg) + FG[0] * fg)
      px[i + 1] = Math.round(BG[1] * (1 - fg) + FG[1] * fg)
      px[i + 2] = Math.round(BG[2] * (1 - fg) + FG[2] * fg)
      px[i + 3] = Math.round(alpha * 255)
    }
  }
  return { width: size, height: size, data: px }
}

/* ------------------------------------------------------------- PNG write --- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

export function encodePng(img) {
  const { width, height, data } = img
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none (keeps output deterministic)
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

/* -------------------------------------------------------------- PNG read --- */

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG")
  let off = 8
  let width = 0
  let height = 0
  let depth = 0
  let ctype = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString("ascii", off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === "IHDR") {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      depth = data[8]
      ctype = data[9]
    } else if (type === "IDAT") idat.push(data)
    else if (type === "IEND") break
    off += 12 + len
  }
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`)
  const chans = ctype === 6 ? 4 : ctype === 2 ? 3 : ctype === 4 ? 2 : 1
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * chans
  const out = Buffer.alloc(height * stride)
  let p = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[p++]
    const line = raw.subarray(p, p + stride)
    p += stride
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= chans ? cur[x - chans] : 0
      const b = prev[x]
      const c = x >= chans ? prev[x - chans] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a)
        const pb = Math.abs(pp - b)
        const pc = Math.abs(pp - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[x] = v & 0xff
    }
  }
  return { width, height, ctype, chans, data: out }
}

export function opaqueRatio(img) {
  const total = img.width * img.height
  let opaque = 0
  for (let i = 0; i < total; i++) {
    let a = 255
    if (img.ctype === 6) a = img.data[i * 4 + 3]
    else if (img.ctype === 4) a = img.data[i * 2 + 1]
    if (a > 16) opaque++
  }
  return opaque / total
}

/* -------------------------------------------------------------- ICO/ICNS -- */

export function encodeIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(pngs.length, 4)
  const dir = Buffer.alloc(16 * pngs.length)
  let offset = header.length + dir.length
  pngs.forEach(({ size, png }, i) => {
    const o = i * 16
    dir[o] = size >= 256 ? 0 : size
    dir[o + 1] = size >= 256 ? 0 : size
    dir[o + 2] = 0 // palette
    dir[o + 3] = 0
    dir.writeUInt16LE(1, o + 4) // colour planes
    dir.writeUInt16LE(32, o + 6) // bpp
    dir.writeUInt32LE(png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += png.length
  })
  return Buffer.concat([header, dir, ...pngs.map((p) => p.png)])
}

// PNG-backed ICNS. macOS reads these natively, so no iconutil / macOS host is
// required. Types below are the modern PNG-capable OSTypes only.
const ICNS_TYPES = [
  ["icp4", 16],
  ["icp5", 32],
  ["ic11", 32], // 16pt @2x
  ["ic12", 64], // 32pt @2x
  ["ic07", 128],
  ["ic13", 256], // 128pt @2x
  ["ic08", 256],
  ["ic14", 512], // 256pt @2x
  ["ic09", 512],
  ["ic10", 1024], // 512pt @2x
]

function encodeIcns(pngBySize) {
  const entries = ICNS_TYPES.map(([type, size]) => {
    const png = pngBySize.get(size)
    if (!png) throw new Error(`missing ${size}px raster for icns type ${type}`)
    const head = Buffer.alloc(8)
    head.write(type, 0, "ascii")
    head.writeUInt32BE(8 + png.length, 4)
    return Buffer.concat([head, png])
  })
  const body = Buffer.concat(entries)
  const head = Buffer.alloc(8)
  head.write("icns", 0, "ascii")
  head.writeUInt32BE(8 + body.length, 4)
  return Buffer.concat([head, body])
}

/* ------------------------------------------------------------------ main -- */

const PNG_TARGETS = [
  ["32x32.png", 32],
  ["64x64.png", 64],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["dock.png", 256],
  ["icon.png", 1024],
  ["Square30x30Logo.png", 30],
  ["Square44x44Logo.png", 44],
  ["Square71x71Logo.png", 71],
  ["Square89x89Logo.png", 89],
  ["Square107x107Logo.png", 107],
  ["Square142x142Logo.png", 142],
  ["Square150x150Logo.png", 150],
  ["Square284x284Logo.png", 284],
  ["Square310x310Logo.png", 310],
  ["StoreLogo.png", 50],
]

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const ICNS_SIZES = [...new Set(ICNS_TYPES.map(([, s]) => s))]

export function generate(channel = "prod") {
  const mark = loadMarkRects(join(repoRoot, "brand", "hypercode-mark.svg"))
  const dest = join(packageDir, "icons", channel)
  const cache = new Map()
  const png = (size) => {
    if (!cache.has(size)) cache.set(size, encodePng(renderIcon(size, mark)))
    return cache.get(size)
  }

  const written = []
  for (const [name, size] of PNG_TARGETS) {
    writeFileSync(join(dest, name), png(size))
    written.push(name)
  }
  writeFileSync(join(dest, "icon.ico"), encodeIco(ICO_SIZES.map((size) => ({ size, png: png(size) }))))
  written.push("icon.ico")
  writeFileSync(join(dest, "icon.icns"), encodeIcns(new Map(ICNS_SIZES.map((s) => [s, png(s)]))))
  written.push("icon.icns")

  // Renderer-bundled asset used for desktop notifications (no network fetch).
  writeFileSync(join(packageDir, "src", "renderer", "notification-icon.png"), png(96))
  written.push("src/renderer/notification-icon.png")

  return written
}

export function verify(channel = "prod") {
  const dest = join(packageDir, "icons", channel)
  const problems = []
  const rows = []

  for (const name of readdirSync(dest)) {
    if (!name.endsWith(".png")) continue
    const img = decodePng(readFileSync(join(dest, name)))
    const ratio = opaqueRatio(img)
    const expected = /^(\d+)x\1(@2x)?\.png$/.exec(name)
    let expectedSize = null
    if (expected) expectedSize = +expected[1] * (expected[2] ? 2 : 1)
    else {
      const sq = /^Square(\d+)x\1Logo\.png$/.exec(name)
      if (sq) expectedSize = +sq[1]
    }
    const square = img.width === img.height
    let ok = square && ratio > 0.2
    if (expectedSize !== null && img.width !== expectedSize) ok = false
    rows.push({ file: name, size: `${img.width}x${img.height}`, opaque: `${(ratio * 100).toFixed(1)}%`, ok })
    if (!ok) problems.push(`${name}: ${img.width}x${img.height} opaque=${(ratio * 100).toFixed(1)}%`)
  }

  const ico = readFileSync(join(dest, "icon.ico"))
  const count = ico.readUInt16LE(4)
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16
    const len = ico.readUInt32LE(o + 8)
    const off = ico.readUInt32LE(o + 12)
    const img = decodePng(ico.subarray(off, off + len))
    const ratio = opaqueRatio(img)
    const ok = ratio > 0.2 && img.width === img.height
    rows.push({ file: `icon.ico[${img.width}]`, size: `${img.width}x${img.height}`, opaque: `${(ratio * 100).toFixed(1)}%`, ok })
    if (!ok) problems.push(`icon.ico frame ${img.width}: opaque=${(ratio * 100).toFixed(1)}%`)
  }

  const icns = readFileSync(join(dest, "icon.icns"))
  if (icns.toString("ascii", 0, 4) !== "icns") problems.push("icon.icns: bad magic")
  if (icns.readUInt32BE(4) !== icns.length) problems.push("icon.icns: length header mismatch")
  let off = 8
  while (off < icns.length) {
    const type = icns.toString("ascii", off, off + 4)
    const len = icns.readUInt32BE(off + 4)
    if (len < 8) {
      problems.push(`icon.icns: bad entry length for ${type}`)
      break
    }
    const img = decodePng(icns.subarray(off + 8, off + len))
    const ratio = opaqueRatio(img)
    const ok = ratio > 0.2 && img.width === img.height
    rows.push({ file: `icon.icns/${type}`, size: `${img.width}x${img.height}`, opaque: `${(ratio * 100).toFixed(1)}%`, ok })
    if (!ok) problems.push(`icon.icns ${type}: opaque=${(ratio * 100).toFixed(1)}%`)
    off += len
  }

  return { rows, problems }
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("generate-brand-icons.mjs")
if (invokedDirectly) {
  const args = process.argv.slice(2)
  const verifyOnly = args.includes("--verify")
  const channel = args.find((a) => !a.startsWith("--")) ?? "prod"
  if (!verifyOnly) {
    const written = generate(channel)
    console.log(`generated ${written.length} assets for channel "${channel}"`)
  }
  const { rows, problems } = verify(channel)
  console.table(rows)
  if (problems.length) {
    console.error("FAILED:\n" + problems.map((p) => `  - ${p}`).join("\n"))
    process.exit(1)
  }
  console.log(`OK: ${rows.length} rasters verified (square + >20% opaque + size matches filename)`)
}
