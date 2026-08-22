import { describe, expect, test } from "bun:test"
import { buildVaultGraph, extractWikiLinks } from "./vault-graph-data"

describe("extractWikiLinks", () => {
  test("plain, aliased, and heading links", () => {
    const md = "See [[Alpha]] and [[Beta|the beta note]] plus [[Gamma#section]]."
    expect(extractWikiLinks(md)).toEqual(["Alpha", "Beta", "Gamma"])
  })

  test("skips fenced code blocks", () => {
    const md = ["[[Real]]", "```", "[[NotALink]]", "```", "[[AlsoReal]]"].join("\n")
    expect(extractWikiLinks(md)).toEqual(["Real", "AlsoReal"])
  })

  test("ignores empty targets", () => {
    expect(extractWikiLinks("[[ ]] [[]]")).toEqual([])
  })
})

describe("buildVaultGraph", () => {
  const classify = (path: string) =>
    path.startsWith("melting-asphalt") ? ("writable" as const) : ("normal" as const)

  test("resolves links by basename case-insensitively", () => {
    const graph = buildVaultGraph(
      [
        { path: "melting-asphalt/Alpha.md", content: "links to [[beta]]" },
        { path: "notes/Beta.md", content: "" },
      ],
      classify,
    )
    expect(graph.links).toEqual([{ source: "melting-asphalt/Alpha.md", target: "notes/Beta.md" }])
    const alpha = graph.nodes.find((n) => n.id === "melting-asphalt/Alpha.md")!
    expect(alpha.kind).toBe("writable")
    expect(alpha.degree).toBe(1)
  })

  test("unresolved targets become ghost nodes", () => {
    const graph = buildVaultGraph([{ path: "a.md", content: "[[Missing Note]]" }], classify)
    const ghost = graph.nodes.find((n) => n.ghost)!
    expect(ghost.id).toBe("ghost:missing note")
    expect(ghost.name).toBe("Missing Note")
    expect(graph.links[0].target).toBe("ghost:missing note")
  })

  test("dedupes repeated links and skips self-links", () => {
    const graph = buildVaultGraph(
      [
        { path: "a.md", content: "[[b]] [[b]] [[a]]" },
        { path: "b.md", content: "" },
      ],
      classify,
    )
    expect(graph.links).toHaveLength(1)
  })
})
