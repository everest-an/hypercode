#!/usr/bin/env bun
// Asserts that what the installer is supposed to carry actually made it into the packaged output.
//
// This exists because extraResources fails quietly. A wrong `from:`, a filter that matches nothing, or an
// asar pattern that swallows a directory all produce a successful build and a smaller installer -- and
// "smaller installer" is not something anyone notices in CI. The skill library and the plugin payload are
// the entire reason a desktop user has any capability at all, so their absence has to be a build failure.
//
// Run after electron-builder, pointed at the unpacked output:
//   bun ./scripts/verify-package.ts dist/win-unpacked/resources
//   bun ./scripts/verify-package.ts "dist/mac-arm64/HyperCode.app/Contents/Resources"

import { existsSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

function dirSize(dir: string) {
  let total = 0
  let files = 0
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      total += statSync(full).size
      files++
    }
  }
  walk(dir)
  return { total, files }
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

const root = process.argv[2]
if (!root) throw new Error("usage: verify-package.ts <unpacked resources dir>")
if (!existsSync(root)) throw new Error(`resources directory not found: ${root}`)

console.log(`[verify-package] ${root}`)
for (const entry of readdirSync(root, { withFileTypes: true })) {
  const full = path.join(root, entry.name)
  const size = entry.isDirectory() ? dirSize(full).total : statSync(full).size
  console.log(`  ${entry.isDirectory() ? "d" : "-"} ${entry.name.padEnd(28)} ${mb(size)}`)
}

const failures: string[] = []

// Skills: 229 SKILL.md across 16 groups. Checking the file count rather than just the directory catches a
// partial copy, which is the shape a filter mistake actually takes.
const skills = path.join(root, "skills")
if (!existsSync(skills)) failures.push("skills/ is missing entirely")
else {
  let count = 0
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name))
      else if (entry.name === "SKILL.md") count++
    }
  }
  walk(skills)
  console.log(`[verify-package] skills: ${count} SKILL.md`)
  if (count < 200) failures.push(`skills/ has only ${count} SKILL.md, expected ~229`)
}

// Plugin: the seeded tree must contain the package itself, not just an empty scaffold. Without it the first
// launch falls back to a multi-minute silent npm install, which is the failure this payload exists to avoid.
const plugin = path.join(root, "plugin")
if (!existsSync(plugin)) failures.push("plugin/ is missing entirely")
else {
  const target = path.join(plugin, "node_modules", "oh-my-openagent")
  const { total, files } = dirSize(plugin)
  console.log(`[verify-package] plugin: ${mb(total)} across ${files} files`)
  if (!existsSync(target)) failures.push("plugin/node_modules/oh-my-openagent is missing")
  if (total < 50 * 1024 * 1024) failures.push(`plugin/ is only ${mb(total)}, expected >50 MB`)
}

const notices = path.join(root, "THIRD-PARTY-NOTICES.txt")
if (!existsSync(notices)) failures.push("THIRD-PARTY-NOTICES.txt is missing (license terms require it)")

if (failures.length > 0) {
  for (const failure of failures) console.error(`::error::[verify-package] ${failure}`)
  process.exit(1)
}
console.log("[verify-package] OK")
