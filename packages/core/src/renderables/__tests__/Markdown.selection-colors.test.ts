import { test, expect, beforeEach, afterEach } from "bun:test"
import { MarkdownRenderable, type MarkdownOptions } from "../Markdown.js"
import { TextTableRenderable } from "../TextTable.js"
import { SyntaxStyle } from "../../syntax-style.js"
import { RGBA } from "../../lib/RGBA.js"
import { createTestRenderer, type TestRenderer } from "../../testing.js"

let renderer: TestRenderer

const syntaxStyle = SyntaxStyle.fromStyles({
  default: { fg: RGBA.fromValues(1, 1, 1, 1) },
})

const TABLE_CONTENT = "| a | b |\n| --- | --- |\n| 1 | 2 |"

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
