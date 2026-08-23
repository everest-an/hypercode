import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(packageDir, "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")
const metainfoFpm = (appId: string) =>
  `${path.join(packageDir, "resources", `${appId}.metainfo.xml`)}=/usr/share/metainfo/${appId}.metainfo.xml`

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const APP_IDS = {
  dev: "ai.awareliquid.hypercode.dev",
  beta: "ai.awareliquid.hypercode.beta",
  prod: "ai.awareliquid.hypercode",
} as const

const getBase = (appId: string): Configuration => ({
  artifactName: "hypercode-desktop-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id. For prod, app id "ai.awareliquid.hypercode" becomes
  // "ai.awareliquid.hypercode.desktop".
  // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
  // https://www.electron.build/docs/linux/
  extraMetadata: {
    // Override package.json's "@opencode-ai/desktop" so the Windows NSIS
    // install dir and updater cache dir don't collide with upstream OpenCode
    // (both would otherwise resolve to %LOCALAPPDATA%\Programs\@opencode-aidesktop).
    name: "hypercode-desktop",
    desktopName: `${appId}.desktop`,
    // Let the release workflow stamp the version it is actually publishing. Without this the installer
    // carries whatever package.json happens to say, which is how shipped builds came to report a version
    // that did not match their release tag — and electron-updater compares exactly these numbers.
    ...(process.env["HYPERCODE_VERSION"] ? { version: process.env["HYPERCODE_VERSION"] } : {}),
  },
  // The plugin payload deliberately lives in plugin-payload/, not under resources/. Keeping it under
  // resources/ meant this list had to exclude it from the asar (or the `resources/**/*` pattern would pack
  // ~200 MB twice), and those same exclusions stopped extraResources from reading the source: the copy
  // silently produced a package.json and nothing else.
  files: ["out/**/*", "resources/**/*", "!resources/opencode-cli*"],
  extraResources: [
    ...(channel === "dev"
      ? [
          {
            from: "resources/",
            to: "",
            filter: ["opencode-cli*"],
          },
        ]
      : []),
    // `native/` is an optional local build output and is not tracked in the repo. electron-builder treats a
    // missing `from:` as a hard error, so a clean checkout could not be packaged at all.
    ...(existsSync(path.join(packageDir, "native"))
      ? [
          {
            from: "native/",
            to: "native/",
            filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
          },
        ]
      : []),
    // Ship the baked skill library with the desktop app. The bake scripts are part of the CLI install flow,
    // which desktop users never run, so without this the 229 finance/legal/academic skills that the product
    // is sold on would simply not exist for them.
    {
      from: path.join(rootDir, "bake", "skills"),
      to: "skills/",
    },
    // The orchestration plugin, pre-installed and platform-pruned by scripts/bundle-plugin.ts. Shipping it
    // is what lets the first launch skip a multi-minute silent npm install; src/main/bundled-plugin.ts seeds
    // it into the engine's npm cache. Guarded by existsSync for the same reason as `native/`: the payload is
    // a build output, not tracked in the repo, and electron-builder fails hard on a missing `from:`.
    ...(existsSync(path.join(packageDir, "plugin-payload"))
      ? [
          {
            from: "plugin-payload/",
            to: "plugin/",
            // Required. Without an explicit filter electron-builder skips node_modules under an
            // extraResources entry, and node_modules *is* the payload -- the copy silently produced just the
            // package.json and shipped a 0.1 MB stub where 184 MB was expected. It fails without an error;
            // only counting the packaged files catches it.
            filter: ["**/*"],
          },
        ]
      : []),
    {
      from: path.join(rootDir, "THIRD-PARTY-NOTICES.txt"),
      to: "THIRD-PARTY-NOTICES.txt",
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.png`,
    // Signing/notarization gated by HC_NOTARIZE (CI sets it to 1 when Apple credentials exist)
    hardenedRuntime: process.env.HC_NOTARIZE === "1",
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: process.env.HC_NOTARIZE === "1",
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: "HyperCode",
    schemes: ["hypercode"],
  },
  win: {
    icon: `resources/icons/icon.png`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    executableName: appId,
    desktop: {
      entry: {
        // Match the installed .desktop file and hicolor icon basename so
        // Linux shells can associate the running Electron window with its launcher.
        StartupWMClass: appId,
      },
    },
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const appId = APP_IDS[channel]
  const base = getBase(appId)

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId,
        productName: "HyperCode Dev",
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "hypercode-dev", fpm: [metainfoFpm(appId)] },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        productName: "HyperCode Beta",
        publish: { provider: "github", owner: "AwareLiquid", repo: "HyperCode", channel: "beta" },
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "hypercode-beta", fpm: [metainfoFpm(appId)] },
      }
    }
    case "prod": {
      return {
        ...base,
        appId,
        productName: "HyperCode",
        publish: { provider: "github", owner: "AwareLiquid", repo: "HyperCode", channel: "latest" },
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "hypercode", fpm: [metainfoFpm(appId)] },
      }
    }
  }
}

export default getConfig()
