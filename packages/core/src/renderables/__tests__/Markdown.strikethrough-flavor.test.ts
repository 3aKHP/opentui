import { test, expect, beforeEach, afterEach } from "bun:test"
import { MarkdownRenderable, type MarkdownOptions } from "../Markdown.js"
import { TextTableRenderable } from "../TextTable.js"
import { SyntaxStyle } from "../../syntax-style.js"
import { RGBA } from "../../lib/RGBA.js"
import { createTestRenderer, type TestRenderer } from "../../testing.js"

let renderer: TestRenderer

const syntaxStyle = SyntaxStyle.fromStyles({
  default: { fg: RGBA.fromValues(1, 1, 1, 1) },
  "markup.strikethrough": { fg: RGBA.fromValues(1, 0, 0, 1) },
})

const TABLE_CONTENT = "| ~single~ | ~~double~~ |\n| --- | --- |\n| ~one~ | ~~two~~ |"

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

interface TestTableCell {
  textBuffer: { getPlainText(): string }
}

function cellPlainText(md: MarkdownRenderable, rowIdx: number, colIdx: number): string {
  const table = md._blockStates[0]?.renderable
  expect(table).toBeInstanceOf(TextTableRenderable)
  const cells = (table as unknown as { _cells: TestTableCell[][] })._cells
  return cells[rowIdx][colIdx].textBuffer.getPlainText().trim()
}

test("gfm flavor (default) strikes both single- and double-tilde spans in table cells", async () => {
  const md = createMarkdownRenderable({ id: "markdown-strikethrough-gfm", content: TABLE_CONTENT, syntaxStyle })

  renderer.root.add(md)
  await renderer.idle()

  expect(cellPlainText(md, 0, 0)).toBe("single")
  expect(cellPlainText(md, 0, 1)).toBe("double")
  expect(cellPlainText(md, 1, 0)).toBe("one")
  expect(cellPlainText(md, 1, 1)).toBe("two")
})

test("double-tilde flavor renders lone single-tilde spans as literal text", async () => {
  const md = createMarkdownRenderable({
    id: "markdown-strikethrough-strict",
    content: TABLE_CONTENT,
    syntaxStyle,
    strikethrough: "double-tilde",
  })

  renderer.root.add(md)
  await renderer.idle()

  expect(cellPlainText(md, 0, 0)).toBe("~single~")
  expect(cellPlainText(md, 0, 1)).toBe("double")
  expect(cellPlainText(md, 1, 0)).toBe("~one~")
  expect(cellPlainText(md, 1, 1)).toBe("two")
})

test("switching strikethrough flavor re-renders existing tables in place", async () => {
  const md = createMarkdownRenderable({ id: "markdown-strikethrough-switch", content: TABLE_CONTENT, syntaxStyle })

  renderer.root.add(md)
  await renderer.idle()

  const tableBefore = md._blockStates[0]?.renderable
  expect(cellPlainText(md, 1, 0)).toBe("one")

  md.strikethrough = "double-tilde"
  renderer.requestRender()
  await renderer.idle()

  expect(md._blockStates[0]?.renderable).toBe(tableBefore)
  expect(cellPlainText(md, 1, 0)).toBe("~one~")

  md.strikethrough = "gfm"
  renderer.requestRender()
  await renderer.idle()

  expect(md._blockStates[0]?.renderable).toBe(tableBefore)
  expect(cellPlainText(md, 1, 0)).toBe("one")
})
