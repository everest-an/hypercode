#!/usr/bin/env bun
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// Stages the orchestration plugin into packages/desktop/resources/plugin so electron-builder can ship it as
// extraResources and the app can seed it into the engine's npm cache on first launch
// (src/main/bundled-plugin.ts).
//
// A plain install of this package is ~450 MB, which is more installer than product. Almost all of the excess
// is redistributable-for-every-platform payload that a single-platform installer has no use for, so this
// prunes down to what the running app on *this* build platform actually needs.

export const DEFAULT_PACKAGE = "oh-my-openagent"

// Directories that are package documentation or test fixtures rather than shipped code.
const DROPPABLE_DIRS = new Set(["test", "tests", "__tests__", "docs", "doc", "example", "examples", ".github"])

// Native payloads are published one directory per platform target. Only the build platform's copy can ever
// execute here; the rest is dead weight measured in hundreds of megabytes.
const PLATFORM_DIR = /^(darwin|linux|win32)-(arm64|x64)$/

// Licence text must survive pruning. Apache-2.0 and MIT both require the licence to travel with the
// distribution, and a file called LICENSE.md would otherwise be swept up by the `*.md` rule below.
const LICENSE_FILE = /^(licen[cs]e|copying|notice|authors|patents)/i

export type PruneOptions = {
  platformDir: string
  dropTypescript?: boolean
  /**
   * Absolute path to the plugin's own package root, left untouched by the documentation rules.
   *
   * An agent orchestration plugin is exactly the kind of package that reads markdown at runtime — prompts,
   * skill definitions, agent descriptions. Stripping `*.md` and `docs/` from a dependency is safe; doing it
   * to the plugin itself risks deleting content it loads. The savings live in the dependency tree anyway.
   */
  preserveRoot?: string
}

export type PruneResult = {
  removedDirs: string[]
  removedFiles: string[]
}

function droppableFile(name: string, preserved: boolean) {
  // Source maps are debugger input and are never read by the running package, so they go even from the
  // plugin's own tree.
  if (name.endsWith(".map")) return true
  if (preserved) return false
  if (LICENSE_FILE.test(name)) return false
  return name.endsWith(".md") || name.endsWith(".markdown")
}

/**
 * Walk a staged node_modules tree and delete what the app will never read.
 *
 * `insideNodeModules` tracks whether the current directory's children are package roots. Without it a
 * dependency legitimately named `test` or `docs` would be deleted along with the fixture directories.
 */
export async function pruneTree(root: string, options: PruneOptions): Promise<PruneResult> {
  const result: PruneResult = { removedDirs: [], removedFiles: [] }

  const root_ = options.preserveRoot ? path.resolve(options.preserveRoot) : undefined
  const preserved = (target: string) =>
    root_ !== undefined && (target === root_ || target.startsWith(root_ + path.sep))

  async function walk(dir: string, insideNodeModules: boolean) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const target = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const isPackageRoot = insideNodeModules
        if (!isPackageRoot && !preserved(target) && DROPPABLE_DIRS.has(entry.name.toLowerCase())) {
          await fs.rm(target, { recursive: true, force: true })
          result.removedDirs.push(target)
          continue
        }
        if (
          !isPackageRoot &&
          path.basename(dir) === "vendor" &&
          PLATFORM_DIR.test(entry.name) &&
          entry.name !== options.platformDir
        ) {
          await fs.rm(target, { recursive: true, force: true })
          result.removedDirs.push(target)
          continue
        }
        // A scoped directory (@scope) holds package roots too, so the flag has to survive one more level.
        const childInsideNodeModules = entry.name === "node_modules" || (isPackageRoot && entry.name.startsWith("@"))
        await walk(target, childInsideNodeModules)
        continue
      }
      if (entry.isFile() && droppableFile(entry.name, preserved(target))) {
        await fs.rm(target, { force: true })
        result.removedFiles.push(target)
      }
    }
  }

  await walk(root, path.basename(root) === "node_modules")

  if (options.dropTypescript) {
    const typescript = path.join(root, "typescript")
    if (existsSync(typescript)) {
      await fs.rm(typescript, { recursive: true, force: true })
      result.removedDirs.push(typescript)
    }
  }

  return result
}

export async function directorySize(dir: string): Promise<number> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  let total = 0
  for (const entry of entries) {
    const target = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      total += await directorySize(target)
      continue
    }
    const stat = await fs.stat(target).catch(() => undefined)
    total += stat?.size ?? 0
  }
  return total
}

function mb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function main() {
  const args = process.argv.slice(2)
  const flag = (name: string) => {
    const index = args.indexOf(`--${name}`)
    return index === -1 ? undefined : args[index + 1]
  }

  const pkg = flag("package") ?? DEFAULT_PACKAGE
  const out = path.resolve(packageDir, flag("out") ?? path.join("resources", "plugin"))
  // Off by default. `typescript` is 23 MB and nothing in the tree declares it as a runtime dependency, but
  // "nothing declares it" is not the same as "nothing requires it" — a lazy require() would only fail at
  // runtime, in a shipped installer. Opt in once a build has been exercised end to end.
  const dropTypescript = args.includes("--drop-typescript")
  const platformDir = `${process.platform}-${process.arch}`

  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "hypercode-plugin-"))
  console.log(`[bundle-plugin] staging ${pkg} in ${staging}`)
  await fs.writeFile(
    path.join(staging, "package.json"),
    `${JSON.stringify({ name: "hypercode-plugin-payload", version: "0.0.0", private: true }, null, 2)}\n`,
    "utf8",
  )

  // --ignore-scripts matches how the engine installs plugins (arborist runs with ignoreScripts: true,
  // packages/core/src/npm.ts:86-93). Producing a tree that lifecycle scripts touched would ship something the
  // engine could never have produced itself.
  await execFileAsync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["install", pkg, "--omit=dev", "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: staging, maxBuffer: 64 * 1024 * 1024 },
  )

  const modules = path.join(staging, "node_modules")
  const before = await directorySize(modules)
  const pruned = await pruneTree(modules, {
    platformDir,
    dropTypescript,
    preserveRoot: path.join(modules, ...pkg.split("/")),
  })
  const after = await directorySize(modules)
  console.log(
    `[bundle-plugin] pruned ${pruned.removedDirs.length} dirs / ${pruned.removedFiles.length} files: ${mb(before)} -> ${mb(after)} (keeping ${platformDir})`,
  )

  await fs.rm(out, { recursive: true, force: true })
  await fs.mkdir(path.dirname(out), { recursive: true })
  await fs.cp(staging, out, { recursive: true })
  await fs.rm(staging, { recursive: true, force: true })
  console.log(`[bundle-plugin] wrote ${out} (${mb(await directorySize(out))})`)
}

if (import.meta.main) await main()
