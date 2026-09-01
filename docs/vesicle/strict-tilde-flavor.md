# Opt-in strict double-tilde strikethrough flavor — implementation plan

Status: implemented on this branch. This document lives on the vesicle line
only and is excluded from any upstream PR (see "Release & upstream flow").

- Topic branch: `vesicle/feat-markdown-strict-tilde` (from `vesicle/integration-v0.5.9`)
- Consumer request: prism-vesicle #268 item 5 (rc.2 group-test memo)

## 1. Context

Strikethrough currently renders for BOTH `~x~` and `~~x~~` through two
independent layers:

- Tree-sitter path: the vendored `src/lib/tree-sitter/assets/markdown_inline/highlights.scm`
  (stock, byte-identical to upstream, sourced from nvim-treesitter) captures
  `(strikethrough) @markup.strikethrough` unconditionally. The
  tree-sitter-grammars/tree-sitter-markdown inline scanner emits one delimiter
  per `~` character (`parse_tilde` in `scanner.c` drives
  `num_emphasis_delimiters_left` one tilde at a time), so a single tilde parses
  as a flat `(strikethrough)` node and doubled tildes nest one strikethrough
  inside another.
- marked path: upstream marked's GFM `del` rule `/^(~~?)(...)\1(?=[^~]|$)/`
  (markedjs/marked `src/rules.ts`) accepts one-or-two tildes. It is reachable
  through `MarkdownRenderable.renderInlineToken` — table cells today
  (`renderInlineContent(cell.tokens)`), and streaming placeholders once a host
  enables `streaming`.

The consumer (Vesicle) decided single tilde must render as literal text.
That is deliberately stricter than GFM (spec Example 491 strikes single
tilde; GitHub matches). This is a host product policy, not a bug fix — so it
must ship here as an opt-in mechanism, never as a default-behavior change.

## 2. Goals / non-goals

Goals:

- Provide an opt-in "double-tilde" strikethrough flavor; default behavior
  stays byte-identical to today.
- Keep the stock query asset untouched so upstream sync stays conflict-free.
- Keep every commit additive and upstreamable as a feature.

Non-goals:

- No default behavior change; no grammar/scanner/wasm rebuild; no conceal
  semantics change outside strikethrough delimiters; no claim about what GFM
  should say.

## 3. Design

### 3.1 Strict query variant asset (data only)

New file `src/lib/tree-sitter/assets/markdown_inline/highlights.strict.scm`:
a full copy of the stock file with ONLY two things replaced — the
strikethrough capture rule and the blanket `emphasis_delimiter` conceal rule:

```scheme
; Strikethrough requires doubled tildes (strict flavor). The grammar folds
; each `~` into its own emphasis_delimiter, so runs of >= 2 tildes nest a
; strikethrough inside a strikethrough; lone single-tilde spans match none of
; these patterns and render as literal text.
((strikethrough
  (strikethrough)) @markup.strikethrough)

; Conceal code span markers as before.
((code_span_delimiter) @conceal
  (#set! conceal ""))

; Conceal emphasis markers anchored on their parent node. The blanket
; emphasis_delimiter rule is gone because lone-tilde delimiters must stay
; visible.
((emphasis
  (emphasis_delimiter) @conceal)
  (#set! conceal ""))
((strong_emphasis
  (emphasis_delimiter) @conceal)
  (#set! conceal ""))

; Conceal tilde delimiters only inside doubled-tilde strikethroughs: the
; outer pair before AND after the nested child (query children match in
; document order), plus the nested inner pair.
((strikethrough
  (emphasis_delimiter) @conceal
  (strikethrough))
  (#set! conceal ""))
((strikethrough
  (strikethrough)
  (emphasis_delimiter) @conceal)
  (#set! conceal ""))
((strikethrough
  (strikethrough
    (emphasis_delimiter) @conceal))
  (#set! conceal ""))
```

Everything else in the stock file (links, escapes, images, tables, …) is
copied verbatim.

Pattern rationale (validated against the packaged
tree-sitter-markdown_inline v0.5.1 wasm with web-tree-sitter):

- `a ~text~ b`, `~中文内容~`, `~x~` → zero captures: literal plain text.
- `a ~~text~~ b` → exactly one `markup.strikethrough` over the full span and
  4/4 tilde conceals. Dropping either of the outer-pair patterns (before /
  after the nested child) loses one delimiter — query children must match in
  document order.
- `~~~x~~~` → 6/6 conceals, styled.
- `*em*`, `_em_`, `**strong**`, `__strong__`, `` `code` `` → delimiter
  conceals preserved via the parent-anchored rules.
- `~ spaced ~` / `~~ spaced ~~` → no captures (grammar already rejects
  whitespace-adjacent delimiters; parity with stock).

Known accepted residual: `~a ~~b~~ c~` — the outer single-tilde span contains
a nested strikethrough and is still captured (parity with current behavior,
not a regression). Closing it needs a worker-side source-text filter; deferred
unless a consumer reports it.

### 3.2 Host wiring helper (small public API)

Export `strictMarkdownInlineParserOptions(): FiletypeParserOptions` from the
package root: `filetype: "markdown_inline"` with the packaged wasm path and
the strict scm path. Hosts apply it with the existing public API
`addDefaultParsers()` / `addFiletypeParser()` (`src/lib/tree-sitter/client.ts`).

Implementation note (deviation from the original sketch): the helper resolves
both asset paths via `resolveAssetPath` with `@opentui/core/assets/...` keys
plus a source-relative fallback URL, NOT via `resolveDefaultParserAsset`. On
Bun the latter dispatches through the generated
`default-parser-assets.bun.ts` loader map and throws
`Unknown OpenTUI default parser asset` for any path not registered as a
default parser — registering there would make the strict query a default,
breaking the opt-in requirement. The chosen seam covers source and dist
layouts on both runtimes and honors `OTUI_ASSET_ROOT`; `bun build --compile`
consumers must relocate the file with the other tree-sitter assets (noted in
the helper's JSDoc).

The worker already invalidates parser caches when a filetype parser is
replaced (`parser.worker.ts` `addFiletypeParser` → `invalidateParserCaches`),
so registering before the first markdown highlight is the clean path and late
registration remains safe.

Packaging check: satisfied — `scripts/build.ts` copies every `*.scm` under
`src/lib/tree-sitter/assets` into the dist tarball by glob, so
`assets/markdown_inline/highlights.strict.scm` ships without packaging
changes.

### 3.3 marked del guard (option)

Add to `MarkdownOptions` (`src/renderables/Markdown.ts`):

```ts
/** Strikethrough delimiter flavor. "gfm" (default) strikes one-or-two
 * tildes; "double-tilde" strikes doubled tildes only. */
strikethrough?: "gfm" | "double-tilde"
```

Stored as `_strikethrough` with a plain setter for parity with `conceal`. In
`renderInlineToken` `case "del"` (currently around lines 533-544):

```ts
case "del":
  if (this._strikethrough === "double-tilde" && !token.raw?.startsWith("~~")) {
    chunks.push(this.createDefaultChunk(token.raw ?? token.text ?? ""))
    break
  }
  // ...existing rendering unchanged...
```

This covers table cells and future streaming placeholders.

Solid bindings: verify the new prop flows through @3akhp/opentui-solid's
element prop mapping; extend its typed surface / regenerate if it enumerates
props explicitly.

## 4. Tests

- Markdown renderable unit test
  (`src/renderables/__tests__/Markdown.strikethrough-flavor.test.ts`,
  conventions follow `Markdown.selection-colors.test.ts`): default flavor
  renders `~x~` struck via the marked path; `"double-tilde"` renders it as
  literal text; `~~x~~` struck in both flavors.
- Query contract test (bun + web-tree-sitter, loading the packaged
  markdown_inline wasm + the strict scm): assert the matrix from 3.1
  (zero captures for single tilde; one capture + 4 conceals for doubled;
  triple 6/6; emphasis/code conceals preserved).
- Stock asset regression: `git diff` on stock `highlights.scm` stays empty —
  this is what keeps upstream sync conflict-free.

## 5. Release & upstream flow

- Merge this branch → `vesicle/integration-v0.5.9` → cut
  `vesicle/release/0.5.9-zv2`; publish `@3akhp/opentui-core` / `-solid`
  `0.5.9-zv2`.
- Upstream PR candidate (sst/opentui): the asset + helper + option commits
  only (exclude this document). Framing: "opt-in strict double-tilde
  strikethrough flavor for markdown"; default behavior unchanged. If merged
  upstream later, drop these commits from the zv patch series.

## 6. Open decisions — resolved 2026-09-02

- Option naming: `strikethrough` with values `"gfm" | "double-tilde"`.
  Matches `internalBlockMode` precedent (descriptive values), and "gfm" pins
  the default to a stable spec term instead of the relative "default".
- Helper export surface: defined in `client.ts` next to `addDefaultParsers`,
  so it reaches the package root through the existing barrel; no new
  `exports` subpath.
- General host-supplied custom-query documentation: deferred. The flavor doc
  mentions `addFiletypeParser` with custom paths only in passing; write the
  full extension story when a second consumer asks for it.
