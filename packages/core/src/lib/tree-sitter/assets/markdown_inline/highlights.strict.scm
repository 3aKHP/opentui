; Strict double-tilde strikethrough variant of highlights.scm (fork asset).
; Base query from: https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/99ddf573531c4dbe53f743ecbc1595af5eb1d32f/queries/markdown_inline/highlights.scm
; From MDeiml/tree-sitter-markdown
;
; Everything below matches the stock query verbatim except the strikethrough
; capture and the delimiter conceal rules. When the stock file changes, redo
; the copy and reapply only those two sections.
(code_span) @markup.raw @nospell

(emphasis) @markup.italic

(strong_emphasis) @markup.strong

; Strikethrough requires doubled tildes (strict flavor). The grammar folds
; each `~` into its own emphasis_delimiter, so runs of >= 2 tildes nest a
; strikethrough inside a strikethrough; lone single-tilde spans match none of
; these patterns and render as literal text.
((strikethrough
  (strikethrough)) @markup.strikethrough)

(shortcut_link
  (link_text) @nospell)

[
  (backslash_escape)
  (hard_line_break)
] @string.escape

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

; Inline links - style all parts
(inline_link
  ["[" "(" ")"] @markup.link)

(inline_link
  "]" @markup.link.bracket.close)

; Conceal opening bracket
((inline_link
  "[" @conceal)
  (#set! conceal ""))

; Conceal closing bracket with space replacement
((inline_link
  "]" @conceal)
  (#set! conceal " "))

; Conceal image links
(image
  [
    "!"
    "["
    "]"
    "("
    (link_destination)
    ")"
  ] @markup.link
  (#set! conceal ""))

; Conceal full reference links
(full_reference_link
  [
    "["
    "]"
    (link_label)
  ] @markup.link
  (#set! conceal ""))

; Conceal collapsed reference links
(collapsed_reference_link
  [
    "["
    "]"
  ] @markup.link
  (#set! conceal ""))

; Conceal shortcut links
(shortcut_link
  [
    "["
    "]"
  ] @markup.link
  (#set! conceal ""))

[
  (link_destination)
  (uri_autolink)
] @markup.link.url @nospell

[
  (link_label)
  (link_text)
  (link_title)
  (image_description)
] @markup.link.label

; Replace common HTML entities.
((entity_reference) @character.special
  (#eq? @character.special "&nbsp;")
  (#set! conceal ""))

((entity_reference) @character.special
  (#eq? @character.special "&lt;")
  (#set! conceal "<"))

((entity_reference) @character.special
  (#eq? @character.special "&gt;")
  (#set! conceal ">"))

((entity_reference) @character.special
  (#eq? @character.special "&amp;")
  (#set! conceal "&"))

((entity_reference) @character.special
  (#eq? @character.special "&quot;")
  (#set! conceal "\""))

((entity_reference) @character.special
  (#any-of? @character.special "&ensp;" "&emsp;")
  (#set! conceal " "))
