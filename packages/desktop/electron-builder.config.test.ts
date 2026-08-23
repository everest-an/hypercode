import { expect, test } from "bun:test"
import type { Configuration } from "electron-builder"

const channels = [
  { channel: "dev", appId: "ai.awareliquid.hypercode.dev" },
  { channel: "beta", appId: "ai.awareliquid.hypercode.beta" },
  { channel: "prod", appId: "ai.awareliquid.hypercode" },
] as const

async function loadConfig(channel: string, cacheBuster: string) {
  const previous = process.env.OPENCODE_CHANNEL
  process.env.OPENCODE_CHANNEL = channel
  try {
    const module = await import(`./electron-builder.config.ts?${cacheBuster}`)
    return module.default as Configuration
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_CHANNEL
    else process.env.OPENCODE_CHANNEL = previous
  }
}

for (const channel of channels) {
  test(`uses one Linux desktop identity for ${channel.channel}`, async () => {
    const config = await loadConfig(channel.channel, `channel=${channel.channel}`)

    expect(config.appId).toBe(channel.appId)
    expect(config.extraMetadata?.desktopName).toBe(`${channel.appId}.desktop`)
    expect(config.linux?.executableName).toBe(channel.appId)
    expect(config.linux?.desktop?.entry?.StartupWMClass).toBe(channel.appId)
    expect(config.deb?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
    expect(config.rpm?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
  })
}

for (const channel of channels) {
  // Regression guard for the packaging bug where copy-metainfo.ts emitted
  // ai.opencode.desktop*.metainfo.xml while electron-builder looked for
  // ai.awareliquid.hypercode*.metainfo.xml, aborting `package:linux`.
  test(`fpm metainfo source matches what copy-metainfo writes for ${channel.channel}`, async () => {
    const config = await loadConfig(channel.channel, `metainfo=${channel.channel}`)
    const generated = `${channel.appId}.metainfo.xml`

    for (const entries of [config.deb?.fpm, config.rpm?.fpm]) {
      const metainfo = entries?.find((entry) => entry.includes("/usr/share/metainfo/"))
      expect(metainfo).toBeDefined()
      const [source] = metainfo!.split("=")
      expect(source.endsWith(generated)).toBe(true)
      expect(source).not.toContain("opencode")
    }
  })
}

test("keeps every user-visible identity on the HyperCode brand", async () => {
  const config = await loadConfig("prod", "branding=prod")

  expect(config.productName).toBe("HyperCode")
  expect(config.protocols).toEqual({ name: "HyperCode", schemes: ["hypercode"] })
  expect(config.appId).not.toContain("opencode")

  // Regression guard for v0.1.5: the Windows NSIS install dir is derived from
  // the raw package.json name, and extraMetadata.name alone did NOT stop the
  // installer from landing in upstream's %LOCALAPPDATA%\Programs\@opencode-aidesktop.
  // Lock the raw name so the two can never drift apart again.
  const pkg = (await Bun.file(new URL("./package.json", import.meta.url)).json()) as { name?: string }
  expect(pkg.name).toBe("hypercode-desktop")
  expect(config.extraMetadata?.name).toBe(pkg.name)
})

test("bundles the CLI outside the dev app archive", async () => {
  const config = await loadConfig("dev", "cli-resource")

  expect(config.files).toContain("!resources/opencode-cli*")
  expect(config.extraResources).toContainEqual({
    from: "resources/",
    to: "",
    filter: ["opencode-cli*"],
  })
})

// The ~200 MB payload stays out of the asar by living outside resources/, not by being excluded from it.
// Excluding it was the earlier approach and it backfired: the same patterns also stopped extraResources from
// reading the source, so the installer shipped a lone package.json where 184 MB was expected — with no error.
test("never packs the plugin payload into the app archive", async () => {
  const config = await loadConfig("prod", "plugin-payload")

  for (const pattern of config.files ?? []) {
    expect(String(pattern)).not.toContain("plugin-payload")
  }
})

for (const channel of ["beta", "prod"] as const) {
  test(`does not bundle the CLI in ${channel} builds`, async () => {
    const config = await loadConfig(channel, `no-cli-resource=${channel}`)

    expect(config.extraResources).not.toContainEqual({
      from: "resources/",
      to: "",
      filter: ["opencode-cli*"],
    })
  })
}
