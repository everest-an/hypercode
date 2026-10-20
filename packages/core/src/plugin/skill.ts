/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeHypercodeContent from "./skill/customize-hypercode.md" with { type: "text" }
import egoBrowserContent from "./skill/ego-browser.md" with { type: "text" }

export const CustomizeHypercodeContent = customizeHypercodeContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-hypercode",
            description:
              "Use ONLY when the user is editing or creating HyperCode's own configuration: hypercode.json, hypercode.jsonc, files under .hypercode/, or files under ~/.config/hypercode/. Also use when creating or fixing HyperCode agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring HyperCode itself.",
            location: AbsolutePath.make("/builtin/customize-hypercode.md"),
            content: CustomizeHypercodeContent,
          }),
        }),
      )
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "ego-browser",
            description:
              "Use when the user asks to browse the web, open a site, fill a form, click through a flow, scrape page data, sign in somewhere, test a web app, or otherwise automate a browser. Drives ego lite, which reuses the user's logins and runs in its own Space so it never takes over the user's tabs, mouse, or focus.",
            location: AbsolutePath.make("/builtin/ego-browser.md"),
            content: egoBrowserContent,
          }),
        }),
      )
    })
  }),
})
