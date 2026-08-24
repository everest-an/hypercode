// The username half of the sidecar's HTTP Basic credentials.
//
// This is a wire value, not a brand string. Do not rename it when rebranding.
//
// The engine compares it with strict equality (packages/opencode/src/server/auth.ts:31 —
// `credentials.username === config.username`) against OPENCODE_SERVER_USERNAME, which defaults to
// "opencode". Every process that talks to a server it did not itself configure — the CLI, the TUI, an
// `attach` session — resolves the same default. Changing the value here without also exporting
// OPENCODE_SERVER_USERNAME into every one of those environments makes them all fail authentication.
//
// v0.1.8 shipped with this set to "hypercode" on the two paths that tell the renderer, while the server
// kept starting as "opencode". Every request the renderer made came back 401, the UI sat on "Could not
// reach Local Server", and the main log still said `server ready` — because the health check hardcoded
// "opencode" and so was the one caller that agreed with the server. Deriving both ends from this
// constant is what stops that from reoccurring; see server-credentials.test.ts.
//
// Kept free of imports on purpose: sidecar.ts runs as a utility process and pulls in node builtins only,
// so it cannot reach constants.ts (which imports electron).
export const SERVER_USERNAME = "opencode"
