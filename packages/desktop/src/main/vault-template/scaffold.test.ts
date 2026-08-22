import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scaffoldVault, VAULT_TEMPLATE_FILES } from "./scaffold"

const expectedPaths = VAULT_TEMPLATE_FILES.map((file) => file.path)

test("scaffolds all template files into a fresh directory", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-scaffold-"))
  try {
    const result = scaffoldVault(root)
    expect(result.created.filter((path) => !path.startsWith(".git"))).toEqual(expectedPaths)
    expect(result.skipped).toEqual([])
    for (const path of expectedPaths) {
      expect(existsSync(join(root, path))).toBe(true)
    }
    const vaultJson = JSON.parse(readFileSync(join(root, ".opencode/vault.json"), "utf8"))
    expect(vaultJson.writable).toEqual(["melting-asphalt"])
    // UTF-8 without BOM
    const bytes = readFileSync(join(root, "TODO-Colonization.md"))
    expect([bytes[0], bytes[1], bytes[2]]).not.toEqual([0xef, 0xbb, 0xbf])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("never overwrites existing files on a second run", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-scaffold-"))
  try {
    scaffoldVault(root)
    const result = scaffoldVault(root)
    expect(result.created).toEqual([])
    expect(result.skipped).toEqual(expectedPaths)
    // second run must not re-report git init (idempotent)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("throws on a non-existent root", () => {
  const root = join(tmpdir(), "vault-scaffold-does-not-exist")
  expect(() => scaffoldVault(root)).toThrow("not an existing directory")
})

test("throws on a relative root", () => {
  expect(() => scaffoldVault("relative/path")).toThrow("absolute")
})
