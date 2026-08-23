import { describe, expect } from "bun:test"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Installation } from "../../src/installation"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"

// NOTE ON DELETED TESTS
// ---------------------
// The following tests used to live here and were removed on purpose because the
// code they covered no longer exists in `src/installation/index.ts`:
//
//   - "reads npm versions via registry"
//   - "reads bun versions via registry"
//   - "reads pnpm versions via registry"
//   - "reads scoop manifest versions"
//   - "reads chocolatey feed versions"
//   - "reads brew formulae API versions"
//   - "reads brew tap info JSON via CLI"
//       `latest()` no longer probes npm / bun / pnpm / scoop / chocolatey /
//       homebrew. HyperCode is not published on any of those channels; the old
//       probes queried the UPSTREAM package names (`opencode`, `opencode-ai`,
//       `anomalyco/tap/opencode`) so a "hit" only ever meant some unrelated
//       third-party tool was installed. GitHub releases on `AwareLiquid/HyperCode`
//       is now the only version source.
//
//   - "returns sanitized typed errors when the curl install script fails"
//   - "falls back to sh when bash is unavailable during curl upgrade"
//       `upgradeCurl` was deleted outright. It fetched a remote install script
//       and piped it into bash/sh, which installed upstream OpenCode onto the
//       user's machine. `upgrade()` never shells out any more, so there is no
//       bash-vs-sh fallback and no install-script failure path left to cover.
//
// See `src/installation/index.ts` for the current behaviour.

const encoder = new TextEncoder()

const AUTOUPDATE_ENV = "HYPERCODE_ENABLE_AUTOUPDATE"

/**
 * Auto-update checks are opt-in. Tests that want the network path have to turn
 * the flag on explicitly, and must put the environment back the way they found
 * it so the opt-out guard below stays meaningful.
 */
function withAutoupdate<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return Effect.suspend(() => {
    const previous = process.env[AUTOUPDATE_ENV]
    process.env[AUTOUPDATE_ENV] = "1"
    return effect.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (previous === undefined) delete process.env[AUTOUPDATE_ENV]
          else process.env[AUTOUPDATE_ENV] = previous
        }),
      ),
    )
  })
}

function mockHttpClient(handler: (request: HttpClientRequest.HttpClientRequest) => Response) {
  const client = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handler(request))))
  return Layer.succeed(HttpClient.HttpClient, client)
}

function mockSpawner(
  handler: (cmd: string, args: readonly string[]) => string | { code: number; stdout?: string; stderr?: string } = () =>
    "",
) {
  const spawner = ChildProcessSpawner.make((command) => {
    const std = ChildProcess.isStandardCommand(command) ? command : undefined
    const result = handler(std?.command ?? "", std?.args ?? [])
    const output = typeof result === "string" ? { code: 0, stdout: result, stderr: "" } : result
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(output.code)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
        stdout: output.stdout ? Stream.make(encoder.encode(output.stdout)) : Stream.empty,
        stderr: output.stderr ? Stream.make(encoder.encode(output.stderr)) : Stream.empty,
        all: Stream.empty,
        getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      }),
    )
  })
  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function testLayer(
  httpHandler: (request: HttpClientRequest.HttpClientRequest) => Response,
  spawnHandler?: (cmd: string, args: readonly string[]) => string | { code: number; stdout?: string; stderr?: string },
) {
  const spawnerNode = makeGlobalNode({
    service: ChildProcessSpawner.ChildProcessSpawner,
    layer: mockSpawner(spawnHandler),
    deps: [],
  })
  return LayerNode.compile(Installation.node, [
    [httpClient, mockHttpClient(httpHandler)],
    [CrossSpawnSpawner.node, spawnerNode],
  ])
}

describe("installation", () => {
  describe("latest", () => {
    const releaseCalls: string[] = []
    testEffect(
      testLayer((request) => {
        releaseCalls.push(request.url)
        return jsonResponse({ tag_name: "v1.2.3" })
      }),
    ).effect("reads release version from GitHub releases", () =>
      withAutoupdate(
        Effect.gen(function* () {
          const result = yield* Installation.use.latest("unknown")
          expect(result).toBe("1.2.3")
          // Releases come from our own repo, never from the upstream project.
          expect(releaseCalls).toContain("https://api.github.com/repos/AwareLiquid/HyperCode/releases/latest")
          expect(releaseCalls.join("\n")).not.toContain("anomalyco")
        }),
      ),
    )

    testEffect(testLayer(() => jsonResponse({ tag_name: "v4.0.0-beta.1" }))).effect(
      "strips v prefix from GitHub release tag",
      () =>
        withAutoupdate(
          Effect.gen(function* () {
            const result = yield* Installation.use.latest("curl")
            expect(result).toBe("4.0.0-beta.1")
          }),
        ),
    )

    // REGRESSION GUARD: auto-update must stay opt-in.
    // Before this was gated, every TUI start queried the upstream release feed
    // and offered an "update" that piped `https://opencode.ai/install` into a
    // shell — installing upstream OpenCode onto the user's machine. With the
    // flag unset `latest()` must resolve locally and issue zero HTTP requests.
    const guardCalls: string[] = []
    testEffect(
      testLayer((request) => {
        guardCalls.push(request.url)
        return jsonResponse({ tag_name: "v99.0.0" })
      }),
    ).effect("does not hit the network when autoupdate is not opted in", () =>
      Effect.gen(function* () {
        const previous = process.env[AUTOUPDATE_ENV]
        delete process.env[AUTOUPDATE_ENV]
        try {
          const result = yield* Installation.use.latest()
          expect(result).toBe(InstallationVersion)
          expect(result).not.toBe("99.0.0")
          expect(guardCalls).toEqual([])
        } finally {
          if (previous !== undefined) process.env[AUTOUPDATE_ENV] = previous
        }
      }),
    )
  })

  describe("method", () => {
    // Package-manager probing was removed; anything that is not one of our own
    // managed install directories reports "unknown" instead of claiming a brew /
    // npm / scoop install that belongs to a different product.
    testEffect(testLayer(() => jsonResponse({}))).effect("reports unknown outside managed install directories", () =>
      Effect.gen(function* () {
        const result = yield* Installation.use.method()
        expect(["curl", "unknown"]).toContain(result)
      }),
    )
  })

  describe("upgrade", () => {
    // Kept from the old suite ("returns sanitized typed errors for failed
    // package upgrades"): the value being protected is that failures surface as
    // a typed UpgradeFailedError and never leak raw subprocess output. The
    // package-manager code path is gone, so the assertions now describe the
    // single "download it yourself" error and additionally pin down that no
    // subprocess is spawned at all.
    const spawned: string[] = []
    testEffect(
      testLayer(
        () => jsonResponse({}),
        (cmd) => {
          spawned.push(cmd)
          return { code: 1, stderr: "token=secret command output" }
        },
      ),
    ).effect("returns a typed error pointing at GitHub releases instead of upgrading", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(Installation.use.upgrade("curl", "9.9.9"))
        expect(error).toBeInstanceOf(Installation.UpgradeFailedError)
        expect(error.stderr).toBe(
          `Automatic upgrade is not available. Download the latest HyperCode release from ${Installation.RELEASES_URL}`,
        )
        expect(error.message).toBe(error.stderr)
        expect(error.stderr).not.toContain("secret")
        expect(error.stderr).not.toContain("command output")
        // Never shell out: no package manager, no piped install script.
        expect(spawned).toEqual([])
      }),
    )

    // Both methods land on the same message: releases are validated internally before publication, so there is
    // no unattended upgrade path regardless of how the binary was installed.
    testEffect(testLayer(() => jsonResponse({}))).effect("gives the same guidance for an unknown install", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(Installation.use.upgrade("unknown", "9.9.9"))
        expect(error).toBeInstanceOf(Installation.UpgradeFailedError)
        expect(error.stderr).toContain(Installation.RELEASES_URL)
        expect(error.stderr).not.toContain("opencode")
      }),
    )
  })
})
