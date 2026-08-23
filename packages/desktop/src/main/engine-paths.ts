import os from "node:os"
import path from "node:path"

// Everything the desktop app stages for the engine has to land where the engine looks, and the engine
// resolves its directories through `xdg-basedir` (packages/core/src/global.ts:1-29). That package has no
// platform branch, so these are ~/.config/hypercode and ~/.cache/hypercode on Windows and macOS too — not
// %APPDATA%, not ~/Library/Caches. Getting this wrong is silent: the files land somewhere plausible and the
// engine just never reads them.
const APP = "hypercode"

export function configDir() {
  // Global.make() layers Flag.OPENCODE_CONFIG_DIR on top of the xdg path, but only for config.
  const override = process.env["OPENCODE_CONFIG_DIR"]
  if (override) return override
  const xdg = process.env["XDG_CONFIG_HOME"]
  if (xdg) return path.join(xdg, APP)
  return path.join(os.homedir(), ".config", APP)
}

export function cacheDir() {
  // Deliberately not affected by OPENCODE_CONFIG_DIR: Global.make() only overrides `config`.
  const xdg = process.env["XDG_CACHE_HOME"]
  if (xdg) return path.join(xdg, APP)
  return path.join(os.homedir(), ".cache", APP)
}

// A copy of Npm.sanitize (packages/core/src/npm.ts:43-48) rather than an import, because the desktop main
// process does not bundle the engine. If the two ever disagree the cache directory moves and every seeded
// package silently turns into a cold network install, so keep them character-for-character identical.
const illegal = process.platform === "win32" ? new Set(["<", ">", ":", '"', "|", "?", "*"]) : undefined

export function sanitizeNpmSpec(spec: string) {
  if (!illegal) return spec
  return Array.from(spec, (char) => (illegal.has(char) || char.charCodeAt(0) < 32 ? "_" : char)).join("")
}

// Mirrors `directory(pkg)` in packages/core/src/npm.ts:79. Note the key is the *spec* ("pkg@latest"), not
// the package name — two specs for one package are two separate cache directories.
export function npmPackageDir(cache: string, spec: string) {
  return path.join(cache, "packages", sanitizeNpmSpec(spec))
}
