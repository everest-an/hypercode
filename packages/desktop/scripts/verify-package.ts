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
  const broken: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      // A symlink whose target is missing used to be skipped silently by the `isFile` check below, since a
      // dangling link is neither a file nor a directory. That is exactly the shape a payload gets when it is
      // staged with a plain fs.cp: every node_modules/.bin entry becomes an absolute link into a build
      // directory that no longer exists. The size check stayed green because the bytes were all still there.
      if (entry.isSymbolicLink()) {
        if (!existsSync(full)) broken.push(path.relative(dir, full))
        continue
      }
      if (!entry.isFile()) continue
      total += statSync(full).size
      files++
    }
  }
  walk(dir)
  return { total, files, broken }
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
  // The payload stages its tree under a neutral name; see PAYLOAD_MODULES_DIR in src/main/bundled-plugin.ts.
  const target = path.join(plugin, "modules", "oh-my-openagent")
  const { total, files, broken } = dirSize(plugin)
  console.log(`[verify-package] plugin: ${mb(total)} across ${files} files`)
  if (!existsSync(target)) failures.push("plugin/modules/oh-my-openagent is missing")
  if (total < 50 * 1024 * 1024) failures.push(`plugin/ is only ${mb(total)}, expected >50 MB`)
  // Dangling links carry no bytes, so the size check above cannot see them. They appear on macOS and Linux
  // when the payload is staged without verbatimSymlinks: node_modules/.bin ends up pointing at the build's
  // temp directory. Windows npm writes .cmd shims instead and has none of these, so this stays quiet there.
  if (broken.length > 0) {
    console.log(`[verify-package] broken symlinks:\n  ${broken.slice(0, 10).join("\n  ")}`)
    failures.push(`plugin/ has ${broken.length} dangling symlink(s), first: ${broken[0]}`)
  }
}

const notices = path.join(root, "THIRD-PARTY-NOTICES.txt")
if (!existsSync(notices)) failures.push("THIRD-PARTY-NOTICES.txt is missing (license terms require it)")

if (failures.length > 0) {
  for (const failure of failures) console.error(`::error::[verify-package] ${failure}`)
  process.exit(1)
}
console.log("[verify-package] OK")
