// The engine parses its config with jsonc-parser, and the config the CLI installer writes
// (bake/templates/hypercode.json) is full of `//` comments telling the user not to hand-edit it. Rewriting
// such a file through JSON.parse/JSON.stringify would silently delete those comments and reorder the user's
// keys, so edits here are surgical: locate one offset, splice one string, leave every other byte alone.
//
// This is deliberately not a dependency on jsonc-parser. Adding one to packages/desktop means running
// `bun install`, and this repo's bunfig pins a mirror registry that rewrites every URL in bun.lock — a
// 3000-line lockfile diff to gain two functions is a bad trade.

const WHITESPACE = new Set([" ", "\t", "\r", "\n"])

/** Advance past whitespace, `//` line comments and block comments. Returns the next significant offset. */
function skipTrivia(text: string, index: number): number {
  let i = index
  while (i < text.length) {
    const char = text[i]
    if (WHITESPACE.has(char)) {
      i++
      continue
    }
    if (char === "/" && text[i + 1] === "/") {
      i += 2
      while (i < text.length && text[i] !== "\n") i++
      continue
    }
    if (char === "/" && text[i + 1] === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++
      i += 2
      continue
    }
    return i
  }
  return i
}

/** Offset just past the closing quote of the string starting at `index`. */
function skipString(text: string, index: number): number {
  let i = index + 1
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2
      continue
    }
    if (text[i] === '"') return i + 1
    i++
  }
  return i
}

type RootMember = { name: string; valueStart: number }

type Scan = {
  /** Offset immediately after the root object's `{`. Undefined when the document has no root object. */
  bodyStart?: number
  /** True when the root object has no members at all (`{}`). */
  empty: boolean
  members: RootMember[]
}

/**
 * Walk the document tracking brace depth so that only *root-level* members are reported. A `"plugin"` key
 * nested inside `provider.deepseek` must never be mistaken for the top-level plugin list.
 */
function scan(text: string): Scan {
  const members: RootMember[] = []
  let depth = 0
  let bodyStart: number | undefined
  let empty = false
  let i = skipTrivia(text, 0)

  if (text[i] !== "{") return { empty: false, members }
  depth = 1
  bodyStart = i + 1
  i = skipTrivia(text, bodyStart)
  empty = text[i] === "}"

  while (i < text.length) {
    const char = text[i]
    if (char === '"') {
      const end = skipString(text, i)
      // A string is a key only when it sits directly in the root object and a `:` follows it. Values and
      // array elements fail one of those two tests.
      if (depth === 1) {
        const afterKey = skipTrivia(text, end)
        if (text[afterKey] === ":") {
          const valueStart = skipTrivia(text, afterKey + 1)
          members.push({ name: text.slice(i + 1, end - 1), valueStart })
          i = valueStart
          continue
        }
      }
      i = end
      continue
    }
    if (char === "{" || char === "[") {
      depth++
      i++
      continue
    }
    if (char === "}" || char === "]") {
      depth--
      i++
      if (depth === 0) break
      continue
    }
    i = skipTrivia(text, i + 1)
  }

  return { bodyStart, empty, members }
}

/** Tolerant read: strips comments and trailing commas, then parses. Returns undefined on malformed input. */
export function parseJsonc(text: string): unknown {
  let out = ""
  let i = 0
  while (i < text.length) {
    const next = skipTrivia(text, i)
    // Preserve newlines that trivia swallowed so error offsets and formatting stay roughly aligned.
    if (next > i) out += text.slice(i, next).replace(/[^\n]/g, " ")
    i = next
    if (i >= text.length) break
    const char = text[i]
    if (char === '"') {
      const end = skipString(text, i)
      out += text.slice(i, end)
      i = end
      continue
    }
    if (char === ",") {
      const after = skipTrivia(text, i + 1)
      // A comma directly before a closer is legal JSONC and illegal JSON.
      if (text[after] === "}" || text[after] === "]") {
        out += " "
        i++
        continue
      }
    }
    out += char
    i++
  }
  try {
    return JSON.parse(out)
  } catch {
    return undefined
  }
}

/**
 * Append `entry` to the root-level array at `key`, creating the member when it is missing.
 *
 * Returns undefined when the edit cannot be made safely — no root object, or `key` exists but holds
 * something other than an array. Callers treat that as "leave the user's file alone".
 */
export function addRootArrayEntry(text: string, key: string, entry: string): string | undefined {
  const parsed = scan(text)
  if (parsed.bodyStart === undefined) return undefined
  const newline = text.includes("\r\n") ? "\r\n" : "\n"
  const value = JSON.stringify(entry)

  const existing = parsed.members.find((member) => member.name === key)
  if (existing) {
    if (text[existing.valueStart] !== "[") return undefined
    const first = skipTrivia(text, existing.valueStart + 1)
    const insertion = text[first] === "]" ? value : `${value}, `
    return `${text.slice(0, existing.valueStart + 1)}${insertion}${text.slice(existing.valueStart + 1)}`
  }

  // A trailing comma would be fine for the engine's parser but not for anything else that reads the file,
  // so an empty root object gets the member without one.
  const member = parsed.empty
    ? `${newline}  ${JSON.stringify(key)}: [${value}]${newline}`
    : `${newline}  ${JSON.stringify(key)}: [${value}],`
  return `${text.slice(0, parsed.bodyStart)}${member}${text.slice(parsed.bodyStart)}`
}

/** Root-level member names, in document order. Exposed so callers can pick which key already exists. */
export function rootKeys(text: string): string[] {
  return scan(text).members.map((member) => member.name)
}
