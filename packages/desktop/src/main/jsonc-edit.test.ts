import { describe, expect, test } from "bun:test"
import { addRootArrayEntry, parseJsonc, rootKeys } from "./jsonc-edit"

describe("parseJsonc", () => {
  test("reads a document with line comments, block comments and a trailing comma", () => {
    const text = `{
  // HyperCode engine config
  "plugin": ["oh-my-openagent"], /* inline */
  "model": "deepseek/deepseek-v4-pro",
}`
    expect(parseJsonc(text)).toEqual({ plugin: ["oh-my-openagent"], model: "deepseek/deepseek-v4-pro" })
  })

  test("does not treat comment or brace characters inside strings as syntax", () => {
    const text = `{"baseURL": "https://api.deepseek.com/v1", "note": "a // b /* c */ {"}`
    expect(parseJsonc(text)).toEqual({ baseURL: "https://api.deepseek.com/v1", note: "a // b /* c */ {" })
  })

  test("returns undefined for malformed input instead of throwing", () => {
    expect(parseJsonc("{ not json")).toBeUndefined()
  })
})

describe("rootKeys", () => {
  test("reports only root-level members", () => {
    const text = `{
  "provider": { "deepseek": { "plugin": ["nested"] } },
  "model": "x"
}`
    expect(rootKeys(text)).toEqual(["provider", "model"])
  })
})

describe("addRootArrayEntry", () => {
  test("creates the member and keeps every comment", () => {
    const text = `{
  // 由安装向导自动生成
  "model": "deepseek/deepseek-v4-pro"
}`
    const next = addRootArrayEntry(text, "plugin", "oh-my-openagent")!
    expect(next).toContain("// 由安装向导自动生成")
    expect(next).toContain('"model": "deepseek/deepseek-v4-pro"')
    expect(parseJsonc(next)).toEqual({ plugin: ["oh-my-openagent"], model: "deepseek/deepseek-v4-pro" })
  })

  test("appends to an existing array without disturbing its other entries", () => {
    const text = `{ "plugin": ["some-other-plugin"] }`
    const next = addRootArrayEntry(text, "plugin", "oh-my-openagent")!
    expect(parseJsonc(next)).toEqual({ plugin: ["oh-my-openagent", "some-other-plugin"] })
  })

  test("fills an empty array", () => {
    const next = addRootArrayEntry(`{ "plugin": [] }`, "plugin", "oh-my-openagent")!
    expect(parseJsonc(next)).toEqual({ plugin: ["oh-my-openagent"] })
  })

  test("emits valid JSON for an empty root object", () => {
    const next = addRootArrayEntry("{}", "plugin", "oh-my-openagent")!
    expect(JSON.parse(next)).toEqual({ plugin: ["oh-my-openagent"] })
  })

  // Regression guard: a "plugin" key inside provider options must not be mistaken for the top-level list.
  test("ignores a same-named key nested inside another object", () => {
    const text = `{
  "provider": { "deepseek": { "plugin": ["nested"] } }
}`
    const next = addRootArrayEntry(text, "plugin", "oh-my-openagent")!
    expect(parseJsonc(next)).toEqual({
      plugin: ["oh-my-openagent"],
      provider: { deepseek: { plugin: ["nested"] } },
    })
  })

  test("refuses to edit when the key holds something other than an array", () => {
    expect(addRootArrayEntry(`{ "plugin": "oops" }`, "plugin", "oh-my-openagent")).toBeUndefined()
  })

  test("refuses to edit a document with no root object", () => {
    expect(addRootArrayEntry("[]", "plugin", "oh-my-openagent")).toBeUndefined()
    expect(addRootArrayEntry("", "plugin", "oh-my-openagent")).toBeUndefined()
  })

  test("matches the document's existing newline style", () => {
    const next = addRootArrayEntry('{\r\n  "model": "x"\r\n}', "plugin", "oh-my-openagent")!
    expect(next).toContain('\r\n  "plugin": ["oh-my-openagent"],')
    expect(next).not.toContain('\n  "plugin"\r')
  })
})
