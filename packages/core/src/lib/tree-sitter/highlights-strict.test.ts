import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Language, Parser, Query } from "web-tree-sitter"

import { resolveAssetPath } from "../../platform/assets.js"
import { strictMarkdownInlineParserOptions } from "./client.js"

const assetsDir = fileURLToPath(new URL("./assets/markdown_inline", import.meta.url))
const wasmPath = join(assetsDir, "tree-sitter-markdown_inline.wasm")
const strictQuerySource = readFileSync(join(assetsDir, "highlights.strict.scm"), "utf8")
const stockQuerySource = readFileSync(join(assetsDir, "highlights.scm"), "utf8")

let language: Language

beforeAll(async () => {
  const treeSitterWasm = resolveAssetPath(
    "web-tree-sitter/tree-sitter.wasm",
    () => new URL(import.meta.resolve("web-tree-sitter/tree-sitter.wasm")),
  )
  await Parser.init({ locateFile: () => treeSitterWasm })
  language = await Language.load(wasmPath)
})

interface CapturedMatch {
  name: string
  text: string
  startIndex: number
}

function runQuery(source: string, querySource: string): CapturedMatch[] {
  const parser = new Parser()
  parser.setLanguage(language)
  const tree = parser.parse(source)
  expect(tree?.rootNode.hasError).toBe(false)
  const query = new Query(language, querySource)
  try {
    // Snapshot node data before deleting the tree: wasm-owned node data does
    // not outlive the tree/parser it belongs to.
    return query.captures(tree!.rootNode).map((capture) => ({
      name: capture.name,
      text: capture.node.text,
      startIndex: capture.node.startIndex,
    }))
  } finally {
    query.delete()
    tree?.delete()
    parser.delete()
  }
}

function captureTexts(captures: CapturedMatch[], name: string): string[] {
  return captures.filter((capture) => capture.name === name).map((capture) => capture.text)
}

function captureCount(captures: CapturedMatch[], name: string): number {
  return captures.filter((capture) => capture.name === name).length
}

function distinctCaptureTexts(captures: CapturedMatch[], name: string): string[] {
  const seen = new Set<number>()
  const texts: string[] = []
  for (const capture of captures) {
    if (capture.name !== name || seen.has(capture.startIndex)) continue
    seen.add(capture.startIndex)
    texts.push(capture.text)
  }
  return texts
}

describe("markdown_inline strict highlights query", () => {
  test("lone single-tilde spans capture nothing and stay visible", () => {
    for (const source of ["a ~text~ b", "~中文内容~", "~x~"]) {
      const captures = runQuery(source, strictQuerySource)
      expect(captureCount(captures, "markup.strikethrough")).toBe(0)
      expect(captureCount(captures, "conceal")).toBe(0)
    }
  })

  test("doubled tildes strike once over the full span and conceal all four delimiters", () => {
    const captures = runQuery("a ~~text~~ b", strictQuerySource)
    expect(captureTexts(captures, "markup.strikethrough")).toEqual(["~~text~~"])
    expect(captureTexts(captures, "conceal")).toEqual(["~", "~", "~", "~"])
  })

  test("triple tildes conceal all six delimiters and stay styled", () => {
    const captures = runQuery("~~~x~~~", strictQuerySource)
    expect(captureCount(captures, "markup.strikethrough")).toBeGreaterThan(0)
    // Three-level nesting makes some patterns re-capture the same delimiter;
    // the contract is that every one of the six tildes is concealed.
    expect(distinctCaptureTexts(captures, "conceal")).toEqual(["~", "~", "~", "~", "~", "~"])
  })

  test("emphasis, strong, and code span delimiter conceals are preserved", () => {
    expect(captureTexts(runQuery("*em*", strictQuerySource), "conceal")).toEqual(["*", "*"])
    expect(captureTexts(runQuery("_em_", strictQuerySource), "conceal")).toEqual(["_", "_"])
    // Each `*` / `_` is its own emphasis_delimiter node: strong parses as
    // nested emphasis, so all four single-char markers conceal individually.
    expect(captureTexts(runQuery("**strong**", strictQuerySource), "conceal")).toEqual(["*", "*", "*", "*"])
    expect(captureTexts(runQuery("__strong__", strictQuerySource), "conceal")).toEqual(["_", "_", "_", "_"])
    expect(captureTexts(runQuery("`code`", strictQuerySource), "conceal")).toEqual(["`", "`"])
  })

  test("whitespace-adjacent tilde delimiters capture nothing, matching stock", () => {
    for (const source of ["~ spaced ~", "~~ spaced ~~"]) {
      const captures = runQuery(source, strictQuerySource)
      expect(captureCount(captures, "markup.strikethrough")).toBe(0)
      expect(captureCount(captures, "conceal")).toBe(0)
    }
  })

  test("single-tilde span containing a nested doubled-tilde span still strikes (documented residual)", () => {
    const captures = runQuery("~a ~~b~~ c~", strictQuerySource)
    expect(captureTexts(captures, "markup.strikethrough")).toContain("~a ~~b~~ c~")
  })
})

describe("markdown_inline stock highlights query regression", () => {
  test("stock query still strikes single tildes and conceals both delimiters", () => {
    const captures = runQuery("a ~text~ b", stockQuerySource)
    expect(captureTexts(captures, "markup.strikethrough")).toEqual(["~text~"])
    expect(captureTexts(captures, "conceal")).toEqual(["~", "~"])
  })

  test("escape captures stay verbatim with the stock query", () => {
    const source = "a\\*b and \\_c"
    expect(captureTexts(runQuery(source, strictQuerySource), "string.escape")).toEqual(
      captureTexts(runQuery(source, stockQuerySource), "string.escape"),
    )
  })
})

describe("strictMarkdownInlineParserOptions", () => {
  const temporaryDirectories: string[] = []

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("resolves the packaged wasm and strict query to existing files", async () => {
    const previousAssetRoot = process.env.OTUI_ASSET_ROOT
    delete process.env.OTUI_ASSET_ROOT
    try {
      const options = await strictMarkdownInlineParserOptions()
      expect(options.filetype).toBe("markdown_inline")
      expect(existsSync(options.wasm)).toBe(true)
      expect(basename(options.wasm)).toBe("tree-sitter-markdown_inline.wasm")
      expect(options.queries.highlights).toHaveLength(1)
      expect(basename(options.queries.highlights[0])).toBe("highlights.strict.scm")
      expect(existsSync(options.queries.highlights[0])).toBe(true)
    } finally {
      if (previousAssetRoot !== undefined) {
        process.env.OTUI_ASSET_ROOT = previousAssetRoot
      }
    }
  })

  test("resolves through OTUI_ASSET_ROOT when configured", async () => {
    const root = mkdtempSync(join(tmpdir(), "opentui-strict-asset-"))
    temporaryDirectories.push(root)
    for (const name of ["highlights.strict.scm", "tree-sitter-markdown_inline.wasm"]) {
      const source = join(root, "@opentui/core/assets/markdown_inline", name)
      mkdirSync(dirname(source), { recursive: true })
      writeFileSync(source, "stub")
    }

    const previousAssetRoot = process.env.OTUI_ASSET_ROOT
    process.env.OTUI_ASSET_ROOT = root
    try {
      const options = await strictMarkdownInlineParserOptions()
      expect(options.queries.highlights[0]).toBe(
        join(root, "@opentui/core/assets/markdown_inline/highlights.strict.scm"),
      )
    } finally {
      if (previousAssetRoot === undefined) {
        delete process.env.OTUI_ASSET_ROOT
      } else {
        process.env.OTUI_ASSET_ROOT = previousAssetRoot
      }
    }
  })

  test("throws when OTUI_ASSET_ROOT omits the strict query", async () => {
    const root = mkdtempSync(join(tmpdir(), "opentui-strict-asset-"))
    temporaryDirectories.push(root)
    mkdirSync(join(root, "@opentui/core/assets/markdown_inline"), { recursive: true })

    const previousAssetRoot = process.env.OTUI_ASSET_ROOT
    process.env.OTUI_ASSET_ROOT = root
    try {
      await expect(strictMarkdownInlineParserOptions()).rejects.toThrow(/Missing OpenTUI asset/)
    } finally {
      if (previousAssetRoot === undefined) {
        delete process.env.OTUI_ASSET_ROOT
      } else {
        process.env.OTUI_ASSET_ROOT = previousAssetRoot
      }
    }
  })

  test("registers the strict query as a bundlable core asset", async () => {
    // The generated loader map is what lets re-bundled and compiled consumers
    // embed and re-resolve the strict query; regenerating assets must keep
    // the entry or the helper breaks outside the package layout.
    const previousAssetRoot = process.env.OTUI_ASSET_ROOT
    delete process.env.OTUI_ASSET_ROOT
    try {
      const { resolveBundledDefaultParserAsset } = await import("./default-parser-assets.bun.js")
      const resolved = await resolveBundledDefaultParserAsset(
        "assets/markdown_inline/highlights.strict.scm",
        new URL("./assets/markdown_inline/highlights.strict.scm", import.meta.url),
      )
      expect(existsSync(resolved)).toBe(true)

      // The generator appends extra bundled assets after every parser asset;
      // the committed map must match that order so regeneration is a no-op
      // diff rather than reorder churn.
      const loaderMapSource = readFileSync(new URL("./default-parser-assets.bun.ts", import.meta.url), "utf8")
      const loaderKeys = [...loaderMapSource.matchAll(/^  "([^"]+)":/gm)].map((match) => match[1])
      expect(loaderKeys.at(-1)).toBe("assets/markdown_inline/highlights.strict.scm")
    } finally {
      if (previousAssetRoot === undefined) {
        delete process.env.OTUI_ASSET_ROOT
      } else {
        process.env.OTUI_ASSET_ROOT = previousAssetRoot
      }
    }
  })
})
