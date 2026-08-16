import { test, expect, beforeEach, afterEach } from "bun:test"
import { MarkdownRenderable, type MarkdownOptions } from "../Markdown.js"
import { CodeRenderable } from "../Code.js"
import { TextRenderable } from "../Text.js"
import { TextTableRenderable } from "../TextTable.js"
import { Renderable } from "../Renderable.js"
import { SyntaxStyle } from "../../syntax-style.js"
import { RGBA } from "../../lib/RGBA.js"
import { createTestRenderer, type TestRenderer } from "../../testing.js"

let renderer: TestRenderer

const syntaxStyle = SyntaxStyle.fromStyles({
  default: { fg: RGBA.fromValues(1, 1, 1, 1) },
})

const TABLE_CONTENT = "| a | b |\n| --- | --- |\n| 1 | 2 |"
const PROSE_CONTENT = "prose alpha"
const LIST_CONTENT = "- item one"
const CODE_CONTENT = "```js\nfoo()\n```"

beforeEach(async () => {
  const testRenderer = await createTestRenderer({ width: 60, height: 20 })
  renderer = testRenderer.renderer
})

afterEach(async () => {
  if (renderer) {
    renderer.destroy()
  }
})

function createMarkdownRenderable(options: MarkdownOptions): MarkdownRenderable {
  return new MarkdownRenderable(renderer, options)
}

function firstTableBlock(md: MarkdownRenderable): TextTableRenderable {
  const table = md._blockStates[0]?.renderable
  expect(table).toBeInstanceOf(TextTableRenderable)
  return table as TextTableRenderable
}

function firstBlockOfType<T extends Renderable>(md: MarkdownRenderable, type: abstract new (...args: never[]) => T): T {
  const block = md._blockStates[0]?.renderable
  expect(block).toBeInstanceOf(type)
  return block as T
}

function findRenderableOfType<T extends Renderable>(
  root: Renderable,
  type: abstract new (...args: never[]) => T,
  predicate?: (renderable: T) => boolean,
): T | undefined {
  if (root instanceof type && (!predicate || predicate(root))) return root
  for (const child of root.getChildren()) {
    const found = findRenderableOfType(child, type, predicate)
    if (found) return found
  }
  return undefined
}

test("markdown tables inherit selection colors from options", async () => {
  const selectionBg = RGBA.fromValues(0.2, 0.3, 0.4, 1)
  const selectionFg = RGBA.fromValues(0.9, 0.9, 0.9, 1)

  const md = createMarkdownRenderable({
    id: "markdown-table-selection-defaults",
    content: TABLE_CONTENT,
    syntaxStyle,
    selectionBg,
    selectionFg,
  })

  renderer.root.add(md)
  await renderer.idle()

  const table = firstTableBlock(md)
  expect(table.selectionBg?.equals(selectionBg)).toBe(true)
  expect(table.selectionFg?.equals(selectionFg)).toBe(true)
})

test("updating markdown selection colors updates existing tables in place", async () => {
  const initialBg = RGBA.fromValues(0.1, 0.2, 0.3, 1)
  const initialFg = RGBA.fromValues(0.8, 0.8, 0.8, 1)
  const nextBg = RGBA.fromValues(0.3, 0.2, 0.1, 1)
  const nextFg = RGBA.fromValues(0.6, 0.7, 0.8, 1)

  const md = createMarkdownRenderable({
    id: "markdown-table-selection-update",
    content: TABLE_CONTENT,
    syntaxStyle,
    selectionBg: initialBg,
    selectionFg: initialFg,
  })

  renderer.root.add(md)
  await renderer.idle()

  const table = firstTableBlock(md)
  expect(table.selectionBg?.equals(initialBg)).toBe(true)

  md.selectionBg = nextBg
  md.selectionFg = nextFg
  renderer.requestRender()
  await renderer.idle()

  expect(md._blockStates[0]?.renderable).toBe(table)
  expect(table.selectionBg?.equals(nextBg)).toBe(true)
  expect(table.selectionFg?.equals(nextFg)).toBe(true)
})

test("clearing markdown selection colors clears them on existing tables", async () => {
  const selectionBg = RGBA.fromValues(0.2, 0.3, 0.4, 1)

  const md = createMarkdownRenderable({
    id: "markdown-table-selection-clear",
    content: TABLE_CONTENT,
    syntaxStyle,
    selectionBg,
  })

  renderer.root.add(md)
  await renderer.idle()

  const table = firstTableBlock(md)
  expect(table.selectionBg?.equals(selectionBg)).toBe(true)

  md.selectionBg = undefined
  renderer.requestRender()
  await renderer.idle()

  expect(table.selectionBg).toBeUndefined()
})

test("markdown prose inherits selection colors from options", async () => {
  const selectionBg = RGBA.fromValues(0.2, 0.3, 0.4, 1)
  const selectionFg = RGBA.fromValues(0.9, 0.9, 0.9, 1)

  const md = createMarkdownRenderable({
    id: "markdown-prose-selection-defaults",
    content: PROSE_CONTENT,
    syntaxStyle,
    selectionBg,
    selectionFg,
  })

  renderer.root.add(md)
  await renderer.idle()

  const prose = firstBlockOfType(md, CodeRenderable)
  expect(prose.filetype).toBe("markdown")
  expect(prose.selectionBg?.equals(selectionBg)).toBe(true)
  expect(prose.selectionFg?.equals(selectionFg)).toBe(true)
})

test("updating markdown selection colors updates existing prose in place", async () => {
  const initialBg = RGBA.fromValues(0.1, 0.2, 0.3, 1)
  const nextBg = RGBA.fromValues(0.3, 0.2, 0.1, 1)

  const md = createMarkdownRenderable({
    id: "markdown-prose-selection-update",
    content: PROSE_CONTENT,
    syntaxStyle,
    selectionBg: initialBg,
  })

  renderer.root.add(md)
  await renderer.idle()

  const prose = firstBlockOfType(md, CodeRenderable)
  expect(prose.selectionBg?.equals(initialBg)).toBe(true)

  md.selectionBg = nextBg
  renderer.requestRender()
  await renderer.idle()

  expect(md._blockStates[0]?.renderable).toBe(prose)
  expect(prose.selectionBg?.equals(nextBg)).toBe(true)
})

test("list markers inherit selection colors from options", async () => {
  const selectionBg = RGBA.fromValues(0.2, 0.3, 0.4, 1)

  // Structured list rows (with discrete marker renderables) only exist in
  // top-level block mode; coalesced mode folds lists into the markdown code
  // renderable, which carries the colors through its own options.
  const md = createMarkdownRenderable({
    id: "markdown-marker-selection-defaults",
    content: "intro text\n\n- item one\n- item two\n",
    syntaxStyle,
    selectionBg,
    internalBlockMode: "top-level",
  })

  renderer.root.add(md)
  await renderer.idle()

  const marker = findRenderableOfType(md, TextRenderable, (r) => r.id.endsWith("-marker"))
  expect(marker).toBeDefined()
  expect(marker!.selectionBg?.equals(selectionBg)).toBe(true)
})

test("fenced code blocks inherit selection colors and update in place", async () => {
  const initialBg = RGBA.fromValues(0.1, 0.2, 0.3, 1)
  const nextBg = RGBA.fromValues(0.4, 0.5, 0.6, 1)

  const md = createMarkdownRenderable({
    id: "markdown-code-selection",
    content: CODE_CONTENT,
    syntaxStyle,
    selectionBg: initialBg,
  })

  renderer.root.add(md)
  await renderer.idle()

  const code = firstBlockOfType(md, CodeRenderable)
  expect(code.filetype).toBe("javascript")
  expect(code.selectionBg?.equals(initialBg)).toBe(true)

  md.selectionBg = nextBg
  renderer.requestRender()
  await renderer.idle()

  expect(md._blockStates[0]?.renderable).toBe(code)
  expect(code.selectionBg?.equals(nextBg)).toBe(true)
})
