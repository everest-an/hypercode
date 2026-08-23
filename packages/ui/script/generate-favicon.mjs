#!/usr/bin/env node
// Regenerates the HyperCode web favicon / PWA / social-share asset set.
//
// Source of truth: <repo>/brand/hypercode-favicon.svg (pure <rect> geometry on a
// 250x250 viewBox, so it rasterises exactly without a browser).
//
// Usage:  node script/generate-favicon.mjs
//         node script/generate-favicon.mjs --verify
//
// Design: full-bleed brand-dark background + white mark, per brand/README.md
// ("深色背景 → 徽记用白色"). The desktop rasteriser is reused verbatim so both
// icon families come out of the same code path.

import { readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import {
  loadMarkRects,
  renderIcon,
  encodePng,
  encodeIco,
  decodePng,
  opaqueRatio,
} from "../../desktop/scripts/generate-brand-icons.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const packageDir = join(here, "..")
const repoRoot = join(packageDir, "..", "..")
const faviconDir = join(packageDir, "src", "assets", "favicon")
const imagesDir = join(packageDir, "src", "assets", "images")

const BG = "#0e0e10"
const BG_RGB = [0x0e, 0x0e, 0x10]
const FG_RGB = [0xff, 0xff, 0xff]

// Full-bleed square: no inset, no corner rounding. Browsers/OSes apply their own
// masking, so shipping a squircle here would double-round the tab icon.
const FLAT = { inset: 0, cornerRatio: 0 }
// Browser tabs / apple-touch: use most of the canvas so the 16px ICO frame keeps
// as much of the chevron detail as possible.
const MARK_TAB = 0.82
// `purpose: "maskable"` icons get cropped to a circle inscribed in the safe zone
// (80% of the canvas), so the mark has to sit well inside it.
const MARK_MASKABLE = 0.58

/* ------------------------------------------------------------------ SVG ---- */

function buildSvg(mark) {
  const { rects, bounds } = mark
  const markW = bounds.maxX - bounds.minX
  const scale = (250 * MARK_TAB) / markW
  // Uniform scale about the origin, then re-centre on the 250x250 canvas.
  const offset = 125 - 125 * scale
  const body = rects
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`)
    .join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 250" width="250" height="250" shape-rendering="crispEdges">
  <title>HyperCode</title>
  <rect width="250" height="250" fill="${BG}"/>
  <g fill="#ffffff" transform="translate(${offset.toFixed(4)} ${offset.toFixed(4)}) scale(${scale.toFixed(6)})">${body}</g>
</svg>
`
}

/* --------------------------------------------------------------- banner ---- */

// Non-square canvas for og:image. Same 4x supersampling idea as renderIcon, but
// the background is a plain opaque rectangle so no rounded-rect test is needed.
function renderBanner(width, height, mark, markWidthFrac) {
  const { rects, bounds } = mark
  const markW = bounds.maxX - bounds.minX
  const markH = bounds.maxY - bounds.minY
  const scale = (width * markWidthFrac) / markW
  const offX = (width - markW * scale) / 2 - bounds.minX * scale
  const offY = (height - markH * scale) / 2 - bounds.minY * scale
  const scaled = rects.map((r) => ({
    x0: r.x * scale + offX,
    y0: r.y * scale + offY,
    x1: (r.x + r.w) * scale + offX,
    y1: (r.y + r.h) * scale + offY,
  }))

  const SS = 4
  const step = 1 / SS
  const samples = SS * SS
  const px = Buffer.alloc(width * height * 4)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let fgHits = 0
      for (let sy = 0; sy < SS; sy++) {
        const py = y + (sy + 0.5) * step
        for (let sx = 0; sx < SS; sx++) {
          const pxx = x + (sx + 0.5) * step
          for (const r of scaled) {
            if (pxx >= r.x0 && pxx < r.x1 && py >= r.y0 && py < r.y1) {
              fgHits++
              break
            }
          }
        }
      }
      const fg = fgHits / samples
      const i = (y * width + x) * 4
      px[i] = Math.round(BG_RGB[0] * (1 - fg) + FG_RGB[0] * fg)
      px[i + 1] = Math.round(BG_RGB[1] * (1 - fg) + FG_RGB[1] * fg)
      px[i + 2] = Math.round(BG_RGB[2] * (1 - fg) + FG_RGB[2] * fg)
      px[i + 3] = 255
    }
  }
  return { width, height, data: px }
}

/* ------------------------------------------------------------- manifest ---- */

function buildManifest() {
  return (
    JSON.stringify(
      {
        name: "HyperCode",
        short_name: "HyperCode",
        id: "/",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/web-app-manifest-192x192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/web-app-manifest-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        theme_color: BG,
        background_color: BG,
        display: "standalone",
      },
      null,
      2,
    ) + "\n"
  )
}

/* ------------------------------------------------------------- targets ----- */

// [filename, pixel size, mark width fraction]
const PNG_TARGETS = [
  ["favicon-96x96.png", 96, MARK_TAB],
  ["favicon-96x96-v3.png", 96, MARK_TAB],
  ["apple-touch-icon.png", 180, MARK_TAB],
  ["apple-touch-icon-v3.png", 180, MARK_TAB],
  ["web-app-manifest-192x192.png", 192, MARK_MASKABLE],
  ["web-app-manifest-512x512.png", 512, MARK_MASKABLE],
]
const ICO_SIZES = [16, 32, 48]
const ICO_TARGETS = ["favicon.ico", "favicon-v3.ico"]
const SVG_TARGETS = ["favicon.svg", "favicon-v3.svg"]
const OG_WIDTH = 1200
const OG_HEIGHT = 630

export function generate() {
  const mark = loadMarkRects(join(repoRoot, "brand", "hypercode-favicon.svg"))
  const written = []

  const svg = buildSvg(mark)
  for (const name of SVG_TARGETS) {
    writeFileSync(join(faviconDir, name), svg)
    written.push(name)
  }

  const cache = new Map()
  const png = (size, markWidth) => {
    const key = `${size}:${markWidth}`
    if (!cache.has(key)) cache.set(key, encodePng(renderIcon(size, mark, { ...FLAT, markWidth })))
    return cache.get(key)
  }

  for (const [name, size, markWidth] of PNG_TARGETS) {
    writeFileSync(join(faviconDir, name), png(size, markWidth))
    written.push(name)
  }

  const ico = encodeIco(ICO_SIZES.map((size) => ({ size, png: png(size, MARK_TAB) })))
  for (const name of ICO_TARGETS) {
    writeFileSync(join(faviconDir, name), ico)
    written.push(name)
  }

  const manifest = buildManifest()
  JSON.parse(manifest) // fail loudly rather than shipping a broken manifest
  writeFileSync(join(faviconDir, "site.webmanifest"), manifest)
  written.push("site.webmanifest")

  writeFileSync(join(imagesDir, "social-share.png"), encodePng(renderBanner(OG_WIDTH, OG_HEIGHT, mark, 0.42)))
  written.push("../images/social-share.png")

  return written
}

// Fraction of pixels visibly lighter than the brand background, i.e. pixels the
// mark actually painted. `opaqueRatio` is useless on a full-bleed icon (it is
// 100% even for a blank dark square), so this is the check that catches an
// empty render — the failure mode ICO frames shipped last round.
const BG_LUMA = 0.2126 * BG_RGB[0] + 0.7152 * BG_RGB[1] + 0.0722 * BG_RGB[2]
function inkRatio(img) {
  if (img.ctype !== 6 && img.ctype !== 2) throw new Error(`unexpected colour type ${img.ctype}`)
  const total = img.width * img.height
  let ink = 0
  for (let i = 0; i < total; i++) {
    const o = i * img.chans
    const luma = 0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2]
    if (luma > BG_LUMA + 40) ink++
  }
  return ink / total
}

const INK_MIN = 0.03
const INK_MAX = 0.6

export function verify() {
  const problems = []
  const rows = []

  const check = (label, path, expectW, expectH) => {
    const img = decodePng(readFileSync(path))
    const ratio = opaqueRatio(img)
    const ink = inkRatio(img)
    const sizeOk = img.width === expectW && img.height === expectH
    const ok = sizeOk && ratio > 0.2 && ink > INK_MIN && ink < INK_MAX
    rows.push({
      file: label,
      ihdr: `${img.width}x${img.height}`,
      expected: `${expectW}x${expectH}`,
      opaque: `${(ratio * 100).toFixed(1)}%`,
      ink: `${(ink * 100).toFixed(2)}%`,
      ok,
    })
    if (!ok)
      problems.push(
        `${label}: ihdr=${img.width}x${img.height} opaque=${(ratio * 100).toFixed(1)}% ink=${(ink * 100).toFixed(2)}%`,
      )
  }

  for (const [name, size] of PNG_TARGETS) check(name, join(faviconDir, name), size, size)
  check("images/social-share.png", join(imagesDir, "social-share.png"), OG_WIDTH, OG_HEIGHT)

  for (const name of ICO_TARGETS) {
    const buf = readFileSync(join(faviconDir, name))
    if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) problems.push(`${name}: not an ICO`)
    const count = buf.readUInt16LE(4)
    if (count !== ICO_SIZES.length) problems.push(`${name}: ${count} frames, expected ${ICO_SIZES.length}`)
    for (let i = 0; i < count; i++) {
      const o = 6 + i * 16
      const declared = buf[o] === 0 ? 256 : buf[o]
      const len = buf.readUInt32LE(o + 8)
      const off = buf.readUInt32LE(o + 12)
      // Decode the frame's actual pixels: a structurally valid ICO can still
      // hold fully transparent frames, which `file`/`identify` report as fine.
      const img = decodePng(buf.subarray(off, off + len))
      const ratio = opaqueRatio(img)
      const ink = inkRatio(img)
      const ok = img.width === declared && img.height === declared && ratio > 0.2 && ink > INK_MIN && ink < INK_MAX
      rows.push({
        file: `${name}[${i}]`,
        ihdr: `${img.width}x${img.height}`,
        expected: `${declared}x${declared}`,
        opaque: `${(ratio * 100).toFixed(1)}%`,
        ink: `${(ink * 100).toFixed(2)}%`,
        ok,
      })
      if (!ok)
        problems.push(
          `${name} frame ${i}: ihdr=${img.width}x${img.height} declared=${declared} opaque=${(ratio * 100).toFixed(1)}% ink=${(ink * 100).toFixed(2)}%`,
        )
    }
  }

  const manifestRaw = readFileSync(join(faviconDir, "site.webmanifest"), "utf8")
  let manifest
  try {
    manifest = JSON.parse(manifestRaw)
  } catch (err) {
    problems.push(`site.webmanifest: invalid JSON (${err.message})`)
  }
  if (manifest) {
    const nameOk = manifest.name === "HyperCode" && manifest.short_name === "HyperCode"
    rows.push({
      file: "site.webmanifest",
      ihdr: manifest.name,
      expected: "HyperCode",
      opaque: manifest.theme_color,
      ink: manifest.background_color,
      ok: nameOk,
    })
    if (!nameOk) problems.push(`site.webmanifest: name=${manifest.name} short_name=${manifest.short_name}`)
  }

  for (const name of [...SVG_TARGETS, "site.webmanifest"]) {
    const text = readFileSync(join(faviconDir, name), "utf8")
    if (/opencode/i.test(text)) problems.push(`${name}: still contains "opencode"`)
  }

  return { rows, problems }
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("generate-favicon.mjs")
if (invokedDirectly) {
  if (!process.argv.includes("--verify")) {
    const written = generate()
    console.log(`generated ${written.length} assets`)
  }
  const { rows, problems } = verify()
  console.table(rows)
  if (problems.length) {
    console.error("FAILED:\n" + problems.map((p) => `  - ${p}`).join("\n"))
    process.exit(1)
  }
  console.log(`OK: ${rows.length} checks passed (IHDR size + >20% opaque + per-ICO-frame pixels + manifest JSON)`)
}
