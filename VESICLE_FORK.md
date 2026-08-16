# Vesicle OpenTUI Fork — Baseline And Maintenance Policy

This repository is the Prism Vesicle patch-queue fork of `anomalyco/opentui`.
It exists to carry confirmed upstream OpenTUI defects until upstream merges
equivalent fixes. It is not a general OpenTUI product fork.

Governing document (prism-vesicle repo):
`dev/docs/working/OPENTUI_EDITOR_FORK_FEASIBILITY.md`

## Tracked defects

| Vesicle issue | Upstream issue | Defect |
|---|---|---|
| 3aKHP/prism-vesicle#99 | anomalyco/opentui#1289 | Vertical cursor movement can commit a visual column inside a width-2 CJK grapheme (`packages/core/src/zig/editor-view.zig`, `visualToLogicalCursor`). |
| 3aKHP/prism-vesicle#89 | anomalyco/opentui#1288 | Soft-wrap incremental reflow anchors the first wrap boundary at the edit offset (chunk-local wrap-offset caches in `text-buffer-segment.zig` + `rope.zig` split behavior). |
| 3aKHP/prism-vesicle (2026-08-15 report) | anomalyco/opentui#1369 (PR #1370) | Markdown backslash escapes render literally with the backslash visible and escape-styled — the query layer cannot fix it (`backslash_escape` is an atomic two-character token and conceal replaces whole ranges), so the worker splits the capture (`packages/core/src/lib/tree-sitter/parser.worker.ts`). JavaScript layer only; no native rebuild. |

Maintenance posture (maintainer, 2026-08-15): upstream review/merge of any
fork PR is not expected or planned around. The fork is the self-maintained
Vesicle baseline (Option B distribution, feasibility §6). Upstream PRs remain
open as courtesy contributions; if upstream ever merges an equivalent fix, the
corresponding patch branch is removed per the normal trigger (§10) — nothing
waits on it.

## Upstream baseline

- Upstream repo: `https://github.com/anomalyco/opentui.git` (remote `upstream`)
- Fork remote: `https://github.com/3aKHP/opentui.git` (remote `origin`)
- Current frozen base: tag `v0.5.3`, commit
  `1500698a` ("Release v0.5.3", 2026-08-13). Verified latest upstream release
  as of 2026-08-16. `vesicle/base-v0.5.3` created at the tag on 2026-08-16.
- Historical base: `v0.5.1` (`ad9a818d`, 2026-08-04; `vesicle/base-v0.5.1`).
- Both native defects reproduce unfixed at v0.5.3; the escape defect is fixed
  by `vesicle/fix-markdown-escape` (from pristine v0.5.3).

## Branch policy

- `main` tracks `upstream/main`, fast-forward only. Never commit to `main`.
- `vesicle/base-v<upstream-version>` branches are frozen upstream bases.
  Only fork-infrastructure commits that never go upstream (this file,
  fork CI/release infrastructure) may land on a base branch, after the
  upstream tag, clearly separated from patch commits.
- **Patch branches must be forked from the pristine upstream tag
  (`v<upstream-version>`), never from a `vesicle/base-*` branch.** Base
  branches carry fork-only commits that must never leak into upstream PRs
  (this leaked once into anomalyco/opentui#1329 and required a rebase +
  force-push to repair). `VESICLE_FORK.md` is also listed in
  `.git/info/exclude` so an untracked copy on a patch branch cannot be
  re-added by accident.
- Each defect fix lives on its own branch forked from the upstream tag:
  - `vesicle/fix-1289-cursor-boundary` (from v0.5.1, rebased onto main for
    PR #1329; needs replay onto the current base for fork releases)
  - `vesicle/fix-1288-wrap-reflow` (from v0.5.1, rebased onto main for
    PR #1330; needs replay onto the current base for fork releases)
  - `vesicle/fix-markdown-escape` (from v0.5.3; JavaScript-only fix, no Zig
    toolchain needed)
- Each fix is exactly one upstreamable commit (plus its Zig/TS tests) so it can
  be reviewed, bisected, upstreamed, and removed independently. Do not combine
  unrelated fixes in one commit.
- **Release branches** `vesicle/release/<version>` are the Option B build
  inputs: pristine upstream tag + the exact upstreamable patch commit(s) +
  fork-infra commits (scoped-package packaging, publish scripts). First:
  `vesicle/release/0.5.3-zv1` from `0a218e1f` (v0.5.3 + one escape commit).
  Fork-infra commits must be clearly separated from patch commits so the patch
  tail stays cherry-pickable upstream.
- Patch branches must stay `oxfmt`-clean (`semi: false`, `printWidth: 120`) and
  pass `oxlint --deny-warnings` before any upstream PR.

## Upstream sync policy

1. `git fetch upstream --tags`
2. Fast-forward `main` to `upstream/main`.
3. Create `vesicle/base-v<new-version>` at the new upstream tag.
4. Rebase each still-needed patch branch onto the new base through a reviewed
   change; rerun the full native + TS test matrix.
5. Record conflicts and semantic decisions; never mechanically accept one side.

Security/dependency updates in upstream core must be evaluated promptly; the
fork must not freeze an old baseline indefinitely.

## Toolchain (pinned)

- Zig `0.16.0` (repo `.zig-version` and `packages/core/src/zig/build.zig.zon`
  `minimum_zig_version` at the v0.5.3 base; superseded the 0.15.2 pin recorded
  against the v0.5.1 base on 2026-08-04). Local toolchain:
  `.zig-toolchain/zig-x86_64-linux-0.16.0/zig` (untracked, excluded via
  `.git/info/exclude`; SHA-256 verified against
  `https://ziglang.org/download/index.json`).
- Bun `1.3.14` (matches upstream CI; `engines: bun >=1.3.0`).

## Distribution (Option B) — decisions of 2026-08-16

Full record: prism-vesicle
`dev/docs/working/OPENTUI_FORK_OPTION_B_RELEASE_DECISIONS.md` (D1–D4).

- Scoped packages under `@3akhp` (`@3akhp/opentui-core`, later
  `@3akhp/opentui-core-<platform>`); version = upstream base + `-zvN`
  (first: `0.5.3-zv1`); `latest` dist-tag always set explicitly.
- First release is JS-only: `optionalDependencies` point at upstream
  `@opentui/core-*@0.5.3` (native byte-identical at this base — no mixture
  risk); switches to fork platform packages when fork-native ships.
- Publish auth: short-lived granular npm token for the first publish, then
  npm Trusted Publishing from the tag-protected workflow.
- Release discipline: fork platform packages first → verify every pinned
  optional dependency exists on the registry → main last; idempotent resume;
  rollback = deprecate + next version, never overwrite. Upstream's own
  main-first publish order is a known window defect and is not replicated.
- darwin variants via macOS-hosted CI on this public repo; Windows DLLs
  disclosed-unsigned (SHA-256 + source lineage per artifact); no silent
  platform-set narrowing, ever.

## Build and test

```bash
# Native tests (pure Zig; fetches uucode/yoga/ghostty from network on first run)
cd packages/core/src/zig
../../../../.zig-toolchain/zig-x86_64-linux-0.16.0/zig build test

# Full native build (current platform)
cd packages/core && bun run build:native

# TS-side tests
cd packages/core && bun install && bun test
```

## Hard rules

- **No force-push, ever.** A branch that has been pushed — above all one
  backing an open upstream PR — is corrected with follow-up commits only
  (or by closing and re-opening a clean PR). Rewriting a branch under
  review orphans review anchors and breaks CI/notification references;
  the #1329 VESICLE_FORK.md leak should have been repaired this way too.
- Distribution changes (scoped names, publish scripts) live only on base or
  release branches as fork-infra, never on patch branches, and are never
  upstreamed.
- No unrelated visual or framework changes; patch queue only.
- One upstream PR per defect, with minimal reproduction and native regression
  tests (precedent: anomalyco/opentui#1078).
- No Vesicle-specific paths, branding, or assumptions in upstreamable commits.
- Publish nothing from an unclean source tree.
- Removal trigger: upstream releases equivalent fixes; Vesicle verifies the
  full acceptance matrix against that release; then the corresponding patch
  branch and any fork selectors are removed (see the governing document §10).
