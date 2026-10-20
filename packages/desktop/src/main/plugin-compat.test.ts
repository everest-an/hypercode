import { describe, expect, test } from "bun:test"

import { compareVersions, isAppCompatible, isCompatible, parseVersion, resolveCandidate } from "./plugin-compat"

describe("plugin compatibility", () => {
  test("parses stable and prerelease versions", () => {
    expect(parseVersion("5.1.34")).toEqual({ major: 5, minor: 1, patch: 34, prerelease: [] })
    expect(parseVersion("v5.1.34-beta.1")).toEqual({ major: 5, minor: 1, patch: 34, prerelease: ["beta", "1"] })
    expect(parseVersion("nope")).toBeUndefined()
  })

  test("orders stable versions after prereleases", () => {
    expect(compareVersions("5.1.34", "5.1.35")).toBe(-1)
    expect(compareVersions("5.1.35", "5.1.34")).toBe(1)
    expect(compareVersions("5.1.34", "5.1.34")).toBe(0)
    expect(compareVersions("5.1.34", "5.1.34-beta.1")).toBe(1)
    expect(compareVersions("5.1.34-beta.2", "5.1.34-beta.1")).toBe(1)
  })

  test("accepts only tested versions inside the range", () => {
    expect(isCompatible("5.1.34")).toBe(true)
    expect(isCompatible("4.19.4")).toBe(true)
    expect(isCompatible("5.2.0")).toBe(false)
    expect(isCompatible("6.0.0")).toBe(false)
    expect(isCompatible("3.9.0")).toBe(false)
  })

  test("resolves a candidate only when it is compatible", () => {
    expect(resolveCandidate("5.1.34")).toBe("5.1.34")
    expect(resolveCandidate("5.2.0")).toBeUndefined()
    expect(resolveCandidate(undefined)).toBeUndefined()
  })

  test("checks the app compatibility range", () => {
    expect(isAppCompatible("0.1.21", "0.1.21", "0.2.0")).toBe(true)
    expect(isAppCompatible("0.1.20", "0.1.21", "0.2.0")).toBe(false)
    expect(isAppCompatible("0.2.0", "0.1.21", "0.2.0")).toBe(false)
  })
})
