import type { useFile } from "@/context/file"

export type VaultConfig = {
  writable: string[]
  protected: string[]
  hook: string
  defaultAgent: string
}

export const DEFAULT_VAULT_CONFIG: VaultConfig = {
  writable: ["melting-asphalt"],
  protected: ["TODO-Colonization.md", "sisyphus/plans"],
  hook: "prometheus-md-only",
  defaultAgent: "prometheus",
}

export const VAULT_CONFIG_PATH = ".opencode/vault.json"

/**
 * Loads `.opencode/vault.json` from the vault root through the file context.
 * Returns a reactive accessor that yields the parsed config, falling back to
 * {@link DEFAULT_VAULT_CONFIG} when the file is missing or malformed.
 * (A missing file resolves to empty text content on the server, so no error
 * toast is triggered.)
 */
export function createVaultConfig(file: ReturnType<typeof useFile>): () => VaultConfig {
  void file.load(VAULT_CONFIG_PATH)
  return () => {
    const state = file.get(VAULT_CONFIG_PATH)
    const content = state?.content
    if (!state?.loaded || !content || content.type !== "text") return DEFAULT_VAULT_CONFIG
    try {
      const parsed = JSON.parse(content.content) as Partial<VaultConfig> | null
      if (!parsed || typeof parsed !== "object") return DEFAULT_VAULT_CONFIG
      return {
        writable: Array.isArray(parsed.writable) ? parsed.writable.map(String) : DEFAULT_VAULT_CONFIG.writable,
        protected: Array.isArray(parsed.protected) ? parsed.protected.map(String) : DEFAULT_VAULT_CONFIG.protected,
        hook: typeof parsed.hook === "string" ? parsed.hook : DEFAULT_VAULT_CONFIG.hook,
        defaultAgent:
          typeof parsed.defaultAgent === "string" ? parsed.defaultAgent : DEFAULT_VAULT_CONFIG.defaultAgent,
      }
    } catch {
      return DEFAULT_VAULT_CONFIG
    }
  }
}

function normalizeRel(input: string) {
  return input
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase()
}

function underAny(entries: string[], rel: string) {
  const target = normalizeRel(rel)
  if (!target) return false
  return entries.some((entry) => {
    const base = normalizeRel(entry)
    if (!base) return false
    return target === base || target.startsWith(base + "/")
  })
}

/** Classifies a vault-relative path against the vault config lists. */
export function classifyPath(config: VaultConfig, relPath: string): "protected" | "writable" | "normal" {
  if (underAny(config.protected, relPath)) return "protected"
  if (underAny(config.writable, relPath)) return "writable"
  return "normal"
}
