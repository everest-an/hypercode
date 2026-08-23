<!--
  Built-in skill. Name and description are registered in code at
  packages/core/src/plugin/skill.ts and packages/opencode/src/skill/index.ts
  (CUSTOMIZE_HYPERCODE_SKILL_NAME / CUSTOMIZE_HYPERCODE_SKILL_DESCRIPTION).
  The body below becomes the skill's content.
-->

# Customizing HyperCode

HyperCode validates its own config strictly and refuses to start when a field
is wrong. The shapes below cover the common surface area, but they are a
**summary, not the source of truth**.

## Schema reference

HyperCode does **not** publish a hosted JSON Schema for its config. There is no
URL to fetch. This skill is the reference.

When a field is not covered here:

- Read the user's existing config first. A working config in the same repo, or
  in `~/.config/hypercode/`, is the most reliable example available.
- Say the field is undocumented and ask, rather than inventing a shape.
- Do **not** point `$schema` at another tool's domain, and do not add a
  `$schema` key that was not already there. HyperCode never writes one itself.
  If the user's file already has a `$schema`, leave it exactly as-is.

HyperCode hard-fails on invalid config, so the cost of a guessed shape is a
broken startup. Prefer asking over guessing.

## Applying changes

Config is loaded once when HyperCode starts and is not hot-reloaded. After
saving changes to `hypercode.json`, an agent file, a skill, a plugin, or any
other config-time file, **tell the user to quit and restart HyperCode** for
the changes to take effect. The running session will keep using the
already-loaded config until then.

## Where files live

| Scope                         | Path                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Project config                | `./hypercode.json`, `./hypercode.jsonc`, or `.hypercode/hypercode.json` (HyperCode walks up from the cwd to the worktree root) |
| Global config                 | `~/.config/hypercode/hypercode.json` or `~/.config/hypercode/hypercode.jsonc` (NOT `~/.hypercode/`)                            |
| Project agents                | `.hypercode/agent/<name>.md` or `.hypercode/agents/<name>.md`                                                                 |
| Global agents                 | `~/.config/hypercode/agent(s)/<name>.md`                                                                                      |
| Project commands              | `.hypercode/command/<name>.md` or `.hypercode/commands/<name>.md`                                                             |
| Global commands               | `~/.config/hypercode/command(s)/<name>.md`                                                                                    |
| Project skills                | `.hypercode/skill(s)/<name>/SKILL.md`                                                                                        |
| Global skills                 | `~/.config/hypercode/skill(s)/<name>/SKILL.md`                                                                                |
| External skills (auto-loaded) | `~/.claude/skills/<name>/SKILL.md`, `~/.agents/skills/<name>/SKILL.md`                                                       |

`~/.config/hypercode/` is the global config directory on every platform,
including Windows (it resolves to `%USERPROFILE%\.config\hypercode`).

For backward compatibility HyperCode also reads the legacy file names
`opencode.json` / `opencode.jsonc` and `~/.config/hypercode/config.json`, and it
still scans `.opencode/` project directories alongside `.hypercode/`. Write new
files with the `hypercode` names; when both are present the HyperCode-named file
wins.

Configs from each scope are deep-merged. Project overrides global. Unknown
top-level keys are rejected with `ConfigInvalidError`.

## hypercode.json

Every field is optional.

```json
{
  "username": "string",
  "model": "provider/model-id",
  "small_model": "provider/model-id",
  "default_agent": "agent-name",
  "shell": "/bin/zsh",
  "logLevel": "DEBUG" | "INFO" | "WARN" | "ERROR",
  "share": "manual" | "auto" | "disabled",
  "autoupdate": true | false | "notify",
  "snapshot": true,
  "instructions": ["AGENTS.md", "docs/style.md"],

  "skills": {
    "paths": [".hypercode/skills", "/abs/path/to/skills"],
    "urls": ["https://example.com/.well-known/skills/"]
  },

  "references": {
    "docs": {
      "path": "../docs",
      "description": "Use for product behavior and documentation conventions"
    },
    "sdk": {
      "repository": "owner/sdk",
      "branch": "main",
      "description": "Use for SDK implementation details",
      "hidden": true
    }
  },

  "agent": {
    "my-agent": {
      "model": "anthropic/claude-sonnet-4-6",
      "mode": "subagent",
      "description": "...",
      "permission": { "edit": "deny" }
    }
  },

  "command": {
    "deploy": { "description": "...", "template": "..." }
  },

  "provider": {
    "anthropic": { "options": { "apiKey": "..." } }
  },
  "disabled_providers": ["openai"],
  "enabled_providers": ["anthropic"],

  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp"],
      "enabled": true,
      "environment": {}
    },
    "remote-thing": {
      "type": "remote",
      "url": "https://...",
      "headers": { "Authorization": "Bearer ..." }
    }
  },

  "plugin": [
    "my-plugin",
    "my-other-plugin@1.2.3",
    "./local-plugin.ts",
    ["my-configurable-plugin", { "option": "value" }]
  ],

  "permission": {
    "edit": "deny",
    "bash": { "git *": "allow", "*": "ask" }
  },

  "formatter": false,
  "lsp": false,

  "experimental": {
    "primary_tools": ["edit"],
    "mcp_timeout": 30000
  },

  "tool_output": { "max_lines": 200, "max_bytes": 8192 },

  "compaction": { "auto": true, "tail_turns": 15 }
}
```

Shape notes worth being explicit about:

- `model` always carries a provider prefix: `"anthropic/claude-sonnet-4-6"`.
- `skills` is an object with `paths` and/or `urls`, not an array.
- `references` is an object keyed by alias. Each value is a local path, Git repository, or string shorthand.
- `agent` is an object keyed by agent name, not an array.
- `command` is an object keyed by command name, not an array.
- `plugin` is an array of strings or `[name, options]` tuples, not an object.
- `mcp[name].command` is an array of strings, never a single string. `type` is required.
- `permission` is either a string action or an object keyed by tool name.

## Skills

HyperCode's skill loader scans for `**/SKILL.md` inside skill directories. The
file is named `SKILL.md` exactly, and lives in its own folder named after the
skill:

```
.hypercode/skills/my-skill/SKILL.md
```

Frontmatter:

```markdown
---
name: my-skill
description: One sentence covering what this skill does AND when to trigger it. Front-load the literal keywords or filenames the user is likely to say.
---

# My Skill

(skill body in markdown: instructions, examples, references)
```

- `name` is required, lowercase hyphen-separated, up to 64 chars, and matches the folder name.
- `description` is effectively required: skills without one are filtered out and never surfaced to the model. Cover both _what_ the skill does and _when_ to use it. Write in third person ("Use when...", not "I help with..."). Front-load concrete trigger keywords and filenames; gate with "Use ONLY when..." if the skill should stay quiet on adjacent topics.
- Optional: `license`, `compatibility`, `metadata` (string-string map).

Register skills from non-default locations via `skills.paths` (scanned
recursively for `**/SKILL.md`) and `skills.urls` (each URL serves a list of
skills).

## References

References make local directories and Git repositories outside the active
project available as supporting context. Configure them under `references`,
keyed by the alias used in `@` autocomplete:

```json
{
  "references": {
    "docs": {
      "path": "../product-docs",
      "description": "Use for product behavior and terminology"
    },
    "effect": {
      "repository": "Effect-TS/effect",
      "branch": "main",
      "description": "Use for Effect implementation details"
    }
  }
}
```

Local `path` values may be relative to the declaring config, absolute, or use
`~/`. Git `repository` values accept Git URLs, host/path references, and GitHub
`owner/repo` shorthand; `branch` is optional. Both forms support optional
`description` and `hidden` fields.

- Only references with a `description` are advertised to agents in system context.
- `hidden: true` removes a reference from TUI `@` autocomplete only. It remains available to agents and by direct path.
- Reference directories are automatically allowed through the external-directory boundary; normal read/edit/tool permissions still apply.
- String shorthand is supported: use `"docs": "../docs"` for local paths or `"effect": "Effect-TS/effect"` for Git repositories.

## Agents

Two ways to define an agent. Use the file form for anything non-trivial.

### Inline (in `hypercode.json`)

```json
{
  "agent": {
    "my-reviewer": {
      "description": "Reviews PRs for style violations.",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-6",
      "permission": { "edit": "deny", "bash": "ask" },
      "prompt": "You are a strict PR reviewer..."
    }
  }
}
```

### File

```
.hypercode/agent/my-reviewer.md      OR     .hypercode/agents/my-reviewer.md
```

```markdown
---
description: Reviews PRs for style violations.
mode: subagent
model: anthropic/claude-sonnet-4-6
permission:
  edit: deny
  bash: ask
---

You are a strict PR reviewer. Focus on...
```

The file body becomes the agent's `prompt`. Do not also put `prompt:` in the
frontmatter.

`mode` is one of `"primary"`, `"subagent"`, `"all"`.

Allowed top-level frontmatter fields: `name, model, variant, description, mode,
hidden, color, steps, options, permission, disable, temperature, top_p`. Any
unknown field is silently routed into `options`.

To disable a built-in agent: `agent: { build: { disable: true } }`, or in a
file, `disable: true` in frontmatter.

`default_agent` must point to a non-hidden, primary-mode agent.

### Built-in agents

HyperCode ships with `build`, `plan`, `general`, `explore`. Hidden internal agents:
`compaction`, `title`, `summary`. To override a built-in's fields, define the
same key in `agent: { <name>: { ... } }`.

## Commands

HyperCode's command loader scans for `**/*.md` inside command directories. The
file is named after the command, and lives directly inside the `command` folder:

```
.hypercode/command/deploy.md
```

Frontmatter:

```markdown
---
description: One sentence describing what the command does.
agent: build
model: anthropic/claude-sonnet-4-6
---

(command body in markdown: the prompt HyperCode runs, with $ARGUMENTS for the user's input)
```

- `template` is the command body -- everything below the frontmatter -- and is required: it is the prompt HyperCode runs when the command is invoked. Do not also put a `template:` key in the frontmatter.
- `$ARGUMENTS` is replaced with everything the user typed after the command; `$1`, `$2`, ... pull individual positional arguments.
- Optional: `description`, `agent`, `model`, `variant`, `subtask`.

## Plugins

`plugin:` is an array. Each entry is one of:

```json
"plugin": [
  "my-plugin",                          // npm spec, latest
  "my-plugin@1.2.3",                    // npm spec, pinned
  "./local-plugin.ts",                  // file path, relative to the declaring config
  "file:///abs/path/plugin.js",         // file URL
  ["my-plugin", { "key": "val" }]       // tuple form with options
]
```

Auto-discovered plugins (no config entry needed): any `*.ts` or `*.js` file in
`.hypercode/plugin/` or `.hypercode/plugins/`.

A plugin module exports `default` (or any named export) of type
`Plugin = (input: PluginInput, options?) => Promise<Hooks>`. The export is a
function, not a plain object literal, and the function returns an object
(return `{}` if there is nothing to register).

The plugin types are published on npm as `@opencode-ai/plugin`. That package
name is a literal identifier, not a branding choice: HyperCode installs exactly
that package into config directories, so the import specifier below must be
copied verbatim.

```ts
import type { Plugin } from "@opencode-ai/plugin"

export default (async ({ client, project, directory, $ }) => {
  return {
    config: (cfg) => {
      // cfg is the live merged config; mutate fields here.
    },
    "tool.execute.before": async (input, output) => {
      // mutate output.args before the tool runs
    },
  }
}) satisfies Plugin
```

Hook surface (mutate `output` in place; return `void`):

- `event(input)`: every bus event
- `config(cfg)`: once on init with the merged config
- `chat.message`, `chat.params`, `chat.headers`
- `tool.execute.before`, `tool.execute.after`
- `tool.definition`
- `command.execute.before`
- `shell.env`
- `permission.ask`
- `experimental.chat.messages.transform`, `experimental.chat.system.transform`,
  `experimental.session.compacting`, `experimental.compaction.autocontinue`,
  `experimental.text.complete`

Special object-shaped (not callbacks): `tool: { my_tool: { ... } }`,
`auth: { ... }`, `provider: { ... }`.

## MCP servers

`mcp:` is an object keyed by server name. Each server is discriminated by
`type`:

```json
{
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp"],
      "enabled": true,
      "environment": { "BROWSER": "chromium" }
    },
    "github": {
      "type": "remote",
      "url": "https://...",
      "enabled": true,
      "headers": { "Authorization": "Bearer {env:GITHUB_TOKEN}" }
    },
    "old-server": { "enabled": false }
  }
}
```

`command` is an array of strings. `environment` sets environment variables for
a local MCP server. `type` is required. Use `enabled: false` to
disable a server inherited from a parent config. String values such as header
tokens support `{env:VAR}` interpolation (and `{file:path}`); the shell-style
`${VAR}` is not substituted.

## Permissions

```json
"permission": {
  "edit": "deny",
  "bash": { "git *": "allow", "rm *": "deny", "*": "ask" },
  "external_directory": { "~/secrets/**": "deny", "*": "allow" }
}
```

Actions: `"allow"`, `"ask"`, `"deny"`.

Per-tool value forms: `"allow"` shorthand (treated as `{"*": "allow"}`), or an
object `{ pattern: action }`. Within an object, **insertion order matters**.
HyperCode evaluates the LAST matching rule, so put broad rules first and narrow
rules last.

`permission: "allow"` (a string at the top level) is shorthand for "allow
everything" and is rarely what the user wants.

Known permission keys: `read, edit, glob, grep, list, bash, task,
external_directory, todowrite, question, webfetch, websearch, lsp, doom_loop,
skill`. Some of these (`todowrite,
question, webfetch, websearch, doom_loop`) only accept a flat
action, not a per-pattern object.

`external_directory` patterns are filesystem paths (use `~/`, absolute paths,
or globs like `~/projects/**`).

Per-agent `permission:` overrides top-level `permission:`. Plan Mode lives on
the `plan` agent's permission ruleset (`edit: deny *`).

## Escape hatches

When a user's config is broken and HyperCode won't start, these env vars help.
Their names keep the legacy `OPENCODE_` prefix: the runtime reads those exact
strings, so do not rename them to `HYPERCODE_`.

- `OPENCODE_DISABLE_PROJECT_CONFIG=1`: skip the project's local
  `hypercode.json` and start from globals only. Run from the project directory,
  HyperCode loads, the user edits the broken file, then they restart without
  the flag.
- `OPENCODE_CONFIG=/path/to/file.json`: load an additional explicit config.
- `OPENCODE_CONFIG_CONTENT='{"model":"anthropic/claude-sonnet-4-6"}'`:
  inject inline JSON as a final local-scope merge.
- `OPENCODE_DISABLE_DEFAULT_PLUGINS=1`: skip default plugins.
- `OPENCODE_PURE=1`: skip external plugins entirely.
- `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`,
  `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1`: skip the external skill scans under
  `~/.claude/` and `~/.agents/`.

## When proposing edits

- Check the shape against this skill before writing. If a field is not covered
  here, read the user's existing config for a working example; if that does not
  settle it, tell the user the field is undocumented and ask rather than
  guessing. There is no hosted schema to fetch.
- Preserve any existing fields the user did not ask to change, including a
  `$schema` key if one is already present.
- For agent, command, skill, and plugin definitions, prefer creating new files
  in the correct location over inlining everything in `hypercode.json`.
- If the user's existing config is malformed, point them at the env-var escape
  hatches above so they can edit from inside HyperCode without breaking their
  session.
- After saving any config change, remind the user to quit and restart HyperCode
  -- running sessions keep using the already-loaded config.
