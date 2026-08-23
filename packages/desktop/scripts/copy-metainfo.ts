import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

// Must match APP_IDS in electron-builder.config.ts — that config feeds the same
// id to metainfoFpm(), which reads resources/<appId>.metainfo.xml. Any drift
// here makes `package:linux` abort with fpm unable to find --extra-files.
const appId = channel === "prod" ? "ai.awareliquid.hypercode" : `ai.awareliquid.hypercode.${channel}`
const productName = channel === "prod" ? "HyperCode" : `HyperCode ${channel.charAt(0).toUpperCase() + channel.slice(1)}`
const summary = `AI coding agent for your desktop${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="ai.awareliquid">
    <name>AwareLiquid</name>
  </developer>

  <description>
    <p>
      HyperCode is an AI coding agent for your desktop. Run any model, work across
      your projects, and keep your sessions in one place.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="bugtracker">https://github.com/everest-an/hypercode/issues</url>
  <url type="homepage">https://awareliquid.ai</url>
  <url type="vcs-browser">https://github.com/everest-an/hypercode</url>
</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)
console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
