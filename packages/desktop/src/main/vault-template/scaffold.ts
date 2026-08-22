import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"

import opencodeJsonc from "./opencode.jsonc.txt?raw"
import vaultJson from "./vault.json.txt?raw"
import obsidianWriteNote from "./obsidian_write_note.ts.txt?raw"
import vaultGuard from "./vault-guard.ts.txt?raw"
import todoColonization from "./todo-colonization.md.txt?raw"
import welcome from "./welcome.md.txt?raw"
import plansReadme from "./plans-readme.md.txt?raw"

export const VAULT_TEMPLATE_FILES: ReadonlyArray<{ path: string; content: string }> = [
  { path: ".opencode/opencode.jsonc", content: opencodeJsonc },
  { path: ".opencode/vault.json", content: vaultJson },
  { path: ".opencode/tool/obsidian_write_note.ts", content: obsidianWriteNote },
  { path: ".opencode/plugin/vault-guard.ts", content: vaultGuard },
  { path: "TODO-Colonization.md", content: todoColonization },
  { path: "melting-asphalt/Welcome.md", content: welcome },
  { path: "sisyphus/plans/README.md", content: plansReadme },
]

export function scaffoldVault(root: string): { created: string[]; skipped: string[] } {
  if (!isAbsolute(root)) throw new Error(`Vault root must be an absolute path: ${root}`)
  const rootStat = existsSync(root) ? statSync(root) : undefined
  if (!rootStat?.isDirectory()) throw new Error(`Vault root is not an existing directory: ${root}`)

  const created: string[] = []
  const skipped: string[] = []
  for (const file of VAULT_TEMPLATE_FILES) {
    const target = join(root, file.path)
    if (existsSync(target)) {
      skipped.push(file.path)
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.content, "utf8")
    created.push(file.path)
  }

  // Best-effort git init: the engine's file watcher (which powers live refresh
  // of the vault GUI's tree/preview/graph) only subscribes to VCS directories,
  // and git also unlocks session snapshots/revert. Not fatal if git is absent.
  if (!existsSync(join(root, ".git"))) {
    try {
      execFileSync("git", ["init"], { cwd: root, stdio: "ignore", timeout: 15_000 })
      created.push(".git (git init)")
    } catch {
      // git not installed — vault still works, without live file watching
    }
  }

  return { created, skipped }
}
