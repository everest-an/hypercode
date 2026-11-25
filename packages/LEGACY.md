# Legacy: the desktop Electron IDE

`packages/` is the original opencode-based **desktop IDE** (Electron + Vue). It is kept for local and
power-user use and for the opencode engine itself, but it is **no longer the cloud product**.

The single product line is **`workbench/`**: one Expo codebase that ships iOS, Android and web, with the
cloud workspace (server + worker + computer) behind it.

| Use | Where |
| --- | --- |
| Cloud product, phone + web (the shipped version) | `workbench/` |
| Desktop IDE, local/advanced | `packages/` |

Do not add new user-facing features here. If a capability is needed in the product, add it to
`workbench/apps/server` (as a tool/route) and surface it through `workbench/apps/mobile`.
