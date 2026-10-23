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

/** Offset of the `}` closing the object that starts at `start`, or undefined when it never closes. */
function objectEnd(text: string, start: number): number | undefined {
  let depth = 0
  let i = start
  while (i < text.length) {
    const char = text[i]
    if (char === '"') {
      i = skipString(text, i)
      continue
    }
    if (char === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
      i = skipTrivia(text, i)
      continue
    }
    if (char === "{") depth++
    if (char === "}") {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return undefined
}

/**
 * Direct members of the object spanning `[start, end)`. Depth is tracked so a key nested inside a member's
 * value — `provider.deepseek.options` when asked about `provider` — is not reported as a member of it.
 */
function scanObjectMembers(text: string, start: number, end: number): RootMember[] {
  const members: RootMember[] = []
  let depth = 0
  let i = skipTrivia(text, start)
  while (i < end) {
    const char = text[i]
    if (char === '"') {
      const after = skipString(text, i)
      if (depth === 0) {
        const afterKey = skipTrivia(text, after)
        if (text[afterKey] === ":") {
          const valueStart = skipTrivia(text, afterKey + 1)
          members.push({ name: text.slice(i + 1, after - 1), valueStart })
          i = valueStart
          continue
        }
      }
      i = after
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
      continue
    }
    i = skipTrivia(text, i + 1)
  }
  return members
}

/** Index of the last character in `[start, end)` that is neither whitespace nor comment. */
function lastSignificant(text: string, start: number, end: number): number | undefined {
  let last: number | undefined
  let i = start
  while (i < end) {
    const next = skipTrivia(text, i)
    if (next > i) {
      i = next
      continue
    }
    if (text[i] === '"') {
      const after = skipString(text, i)
      last = after - 1
      i = after
      continue
    }
    last = i
    i++
  }
  return last
}

/** Member names of the root-level object at `rootKey`, or undefined when it is not an object. */
function rootObjectMembers(text: string, rootKey: string): RootMember[] | undefined {
  const parsed = scan(text)
  const root = parsed.members.find((candidate) => candidate.name === rootKey)
  if (!root || text[root.valueStart] !== "{") return undefined
  const end = objectEnd(text, root.valueStart)
  if (end === undefined) return undefined
  return scanObjectMembers(text, root.valueStart + 1, end)
}

/** True when the root-level object at `rootKey` already declares `member`. */
export function hasRootObjectMember(text: string, rootKey: string, member: string): boolean {
  const members = rootObjectMembers(text, rootKey)
  return members?.some((candidate) => candidate.name === member) ?? false
}

/**
 * Put `value` (already-serialised JSONC text) inside the root-level object at `rootKey` as `member`,
 * creating either level when it is missing.
 *
 * Returns undefined when the edit cannot be made safely — no root object, `rootKey` holds something that
 * is not an object, or the object never closes. Callers treat that as "leave the user's file alone".
 * An already-present `member` also returns undefined: the user's file wins over us.
 */
export function addRootObjectMember(
  text: string,
  rootKey: string,
  member: string,
  value: string,
): string | undefined {
  const parsed = scan(text)
  if (parsed.bodyStart === undefined) return undefined
  const newline = text.includes("\r\n") ? "\r\n" : "\n"
  const root = parsed.members.find((candidate) => candidate.name === rootKey)

  if (!root) {
    const body = `${newline}  ${JSON.stringify(rootKey)}: {${newline}    ${JSON.stringify(member)}: ${value}${newline}  }`
    const insertion = parsed.empty ? `${body}${newline}` : `${body},`
    return `${text.slice(0, parsed.bodyStart)}${insertion}${text.slice(parsed.bodyStart)}`
  }

  if (text[root.valueStart] !== "{") return undefined
  const end = objectEnd(text, root.valueStart)
  if (end === undefined) return undefined

  const existing = scanObjectMembers(text, root.valueStart + 1, end)
  if (existing.some((candidate) => candidate.name === member)) return undefined

  if (existing.length === 0) {
    return `${text.slice(0, end)}${newline}    ${JSON.stringify(member)}: ${value}${newline}  ${text.slice(end)}`
  }

  // The previous member has to end in a comma; a file written by hand may or may not have one there.
  const last = lastSignificant(text, root.valueStart + 1, end)
  const comma = last !== undefined && text[last] === "," ? "" : ","
  return `${text.slice(0, end)}${comma}${newline}    ${JSON.stringify(member)}: ${value}${newline}  ${text.slice(end)}`
}


/**
 * Replace the root-level string member `key` with `value`, or add it when missing.
 *
 * Only a scalar string is touched, so comments and every other byte stay intact. Returns undefined when
 * the document has no root object or `key` holds something other than a string.
 */
export function setRootString(text: string, key: string, value: string): string | undefined {
  const parsed = scan(text)
  if (parsed.bodyStart === undefined) return undefined
  const newline = text.includes("\r\n") ? "\r\n" : "\n"
  const member = parsed.members.find((candidate) => candidate.name === key)
  if (!member) {
    const inserted = `${newline}  ${JSON.stringify(key)}: ${JSON.stringify(value)}${parsed.empty ? "" : ","}`
    return `${text.slice(0, parsed.bodyStart)}${inserted}${text.slice(parsed.bodyStart)}`
  }
  if (text[member.valueStart] !== '"') return undefined
  const end = skipString(text, member.valueStart)
  return `${text.slice(0, member.valueStart)}${JSON.stringify(value)}${text.slice(end)}`
}