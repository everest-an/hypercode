import { app } from "electron"
import { existsSync } from "node:fs"
import path from "node:path"

import { configDir } from "./engine-paths"
import { installSkillsFrom } from "./bundled-skills-install"

// The bake scripts install the skill library during the CLI setup flow. Desktop users never run those, so
// without this the finance/legal/academic skills the product is sold on would not exist for them.
//
// Layout and namespacing intentionally mirror bake.sh: each source group lands at
// <config>/skills/hypercode-<group>/. The copying itself lives in ./bundled-skills-install so it can be
// tested without electron; this file only resolves where things are.

function sourceDir() {
  // Packaged: extraResources puts the library at <resources>/skills. Unpackaged: fall back to the repo copy
  // so `bun dev` behaves like a real install.
  const packaged = path.join(process.resourcesPath, "skills")
  if (existsSync(packaged)) return packaged
  const repo = path.resolve(app.getAppPath(), "..", "..", "bake", "skills")
  return existsSync(repo) ? repo : undefined
}

export async function installBundledSkills(
  log: {
    log: (message: string, extra?: unknown) => void
    warn: (message: string, extra?: unknown) => void
  },
  onProgress?: (done: number, total: number) => void,
) {
  const source = sourceDir()
  if (!source) return
  return installSkillsFrom({
    source,
    dest: path.join(configDir(), "skills"),
    version: app.getVersion(),
    log,
    onProgress,
  })
}
