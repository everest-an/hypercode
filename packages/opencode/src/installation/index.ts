import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { Effect, Layer, Schema, Context } from "effect"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { withTransientReadRetry } from "@/util/effect-http-client"
import path from "path"
import { makeRuntime } from "@opencode-ai/core/effect/runtime"
import semver from "semver"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"
import { InstallationEvent } from "@opencode-ai/schema/installation-event"

// HyperCode ships as a downloadable release only — there is no npm/brew/scoop/choco channel. Keeping those
// values in the union made the CLI advertise upgrade paths that could never resolve (and, before this fork's
// installer was rewritten, made it operate on the *upstream* packages).
export type Method = "curl" | "unknown"

export type ReleaseType = "patch" | "minor" | "major"

export const Event = InstallationEvent

/**
 * HyperCode is distributed exclusively through GitHub releases. There is no
 * homebrew tap, scoop bucket, chocolatey package or npm package for it, so any
 * package-manager probe would only ever detect an unrelated third-party tool.
 */
export const GITHUB_REPO = "AwareLiquid/HyperCode"
export const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`

/**
 * Automatic update checks are opt-in. Left on by default they would reach out
 * to a release feed we do not publish yet and surface bogus "update available"
 * prompts. Set HYPERCODE_ENABLE_AUTOUPDATE=1 to turn the check back on.
 */
function autoupdateEnabled() {
  const value = process.env["HYPERCODE_ENABLE_AUTOUPDATE"]?.toLowerCase()
  return value === "1" || value === "true"
}

export function getReleaseType(current: string, latest: string): ReleaseType {
  const currMajor = semver.major(current)
  const currMinor = semver.minor(current)
  const newMajor = semver.major(latest)
  const newMinor = semver.minor(latest)

  if (newMajor > currMajor) return "major"
  if (newMinor > currMinor) return "minor"
  return "patch"
}

export const Info = Schema.Struct({
  version: Schema.String,
  latest: Schema.String,
}).annotate({ identifier: "InstallationInfo" })
export type Info = Schema.Schema.Type<typeof Info>

export function userAgent(client = "cli") {
  return `hypercode/${InstallationChannel}/${InstallationVersion}/${client}`
}

export const USER_AGENT = userAgent()

export function isPreview() {
  return InstallationChannel !== "latest"
}

export function isLocal() {
  return InstallationChannel === "local"
}

export class UpgradeFailedError extends Schema.TaggedErrorClass<UpgradeFailedError>()("UpgradeFailedError", {
  stderr: Schema.String,
}) {
  override get message() {
    return this.stderr
  }
}

// Response schemas for external version APIs
const GitHubRelease = Schema.Struct({ tag_name: Schema.String })

export interface Interface {
  readonly info: () => Effect.Effect<Info>
  readonly method: () => Effect.Effect<Method>
  readonly latest: (method?: Method) => Effect.Effect<string>
  readonly upgrade: (method: Method, target: string) => Effect.Effect<void, UpgradeFailedError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Installation") {}

export const use = serviceUse(Service)

const layer: Layer.Layer<Service, never, HttpClient.HttpClient> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const httpOk = HttpClient.filterStatusOk(withTransientReadRetry(http))

    const result: Interface = {
      info: Effect.fn("Installation.info")(function* () {
        return {
          version: InstallationVersion,
          latest: yield* result.latest(),
        }
      }),
      method: Effect.fn("Installation.method")(function* () {
        // Only our own managed install locations are upgradeable. Probing npm /
        // brew / scoop / chocolatey is deliberately not done: HyperCode is not
        // published there, so a hit would mean some other tool is installed and
        // upgrading it would touch software we do not own.
        if (process.execPath.includes(path.join(".hypercode", "bin"))) return "curl" as Method
        if (process.execPath.includes(path.join(".local", "bin"))) return "curl" as Method
        return "unknown" as Method
      }),
      latest: Effect.fn("Installation.latest")(function* () {
        if (!autoupdateEnabled()) return InstallationVersion

        const response = yield* httpOk.execute(
          HttpClientRequest.get(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`).pipe(
            HttpClientRequest.acceptJson,
          ),
        )
        const data = yield* HttpClientResponse.schemaBodyJson(GitHubRelease)(response)
        return data.tag_name.replace(/^v/, "")
      }, Effect.orDie),
      upgrade: Effect.fn("Installation.upgrade")(function* (_m: Method, _target: string) {
        // Releases are validated internally before they are published, so there is deliberately no unattended
        // upgrade channel. Never shell out to a package manager or pipe a remote install script into a shell —
        // both would install a different product onto the user's machine.
        return yield* new UpgradeFailedError({
          stderr: `Automatic upgrade is not available. Download the latest HyperCode release from ${RELEASES_URL}`,
        })
      }),
    }

    return Service.of(result)
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [httpClient] })

const { runPromise } = makeRuntime(Service, AppNodeBuilder.build(node))

export const latest = (...args: Parameters<Interface["latest"]>) => runPromise((s) => s.latest(...args))
export const method = () => runPromise((s) => s.method())
export const upgrade = (...args: Parameters<Interface["upgrade"]>) => runPromise((s) => s.upgrade(...args))

export * as Installation from "."
