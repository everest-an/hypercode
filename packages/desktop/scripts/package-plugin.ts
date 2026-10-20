#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js"

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function flag(args: string[], name: string) {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? undefined : args[index + 1]
}

async function walk(dir: string, base: string, out: { name: string; path: string }[]) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, base, out)
      continue
    }
    if (!entry.isFile()) continue
    out.push({ name: path.relative(base, full).split(path.sep).join("/"), path: full })
  }
}

async function main() {
  const args = process.argv.slice(2)
  const platform = flag(args, "platform") ?? process.platform
  const arch = flag(args, "arch") ?? process.arch
  const version = flag(args, "version")
  if (!version) throw new Error("--version is required")

  const input = path.resolve(packageDir, flag(args, "input") ?? "plugin-payload")
  const out = path.resolve(packageDir, flag(args, "out") ?? "plugin-assets")
  const files: { name: string; path: string }[] = []
  await walk(input, input, files)
  if (files.length === 0) throw new Error(`no files under ${input}`)

  const writer = new ZipWriter(new BlobWriter("application/zip"))
  for (const file of files) {
    await writer.add(file.name, new BlobReader(new Blob([new Uint8Array(await readFile(file.path))])))
  }
  const zip = await writer.close()
  const bytes = new Uint8Array(await zip.arrayBuffer())
  const digest = createHash("sha256").update(bytes).digest("hex")
  const file = `plugin-payload-${platform}-${arch}-${version}.zip`

  await mkdir(out, { recursive: true })
  await writeFile(path.join(out, file), bytes)
  await writeFile(
    path.join(out, `plugin-fragment-${platform}-${arch}.json`),
    `${JSON.stringify({ platform: `${platform}-${arch}`, file, sha256: digest, version }, null, 2)}\n`,
  )
  console.log(`[package-plugin] ${file} (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB) sha256=${digest}`)
}

if (import.meta.main) await main()
