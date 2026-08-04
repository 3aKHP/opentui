# Vesicle OpenTUI Fork — Baseline And Maintenance Policy

This repository is the Prism Vesicle patch-queue fork of `anomalyco/opentui`.
It exists to carry two confirmed native editor defects until upstream merges
equivalent fixes. It is not a general OpenTUI product fork.

Governing document (prism-vesicle repo):
`dev/docs/working/OPENTUI_EDITOR_FORK_FEASIBILITY.md`

## Tracked defects

| Vesicle issue | Upstream issue | Defect |
|---|---|---|
| 3aKHP/prism-vesicle#99 | anomalyco/opentui#1289 | Vertical cursor movement can commit a visual column inside a width-2 CJK grapheme (`packages/core/src/zig/editor-view.zig`, `visualToLogicalCursor`). |
| 3aKHP/prism-vesicle#89 | anomalyco/opentui#1288 | Soft-wrap incremental reflow anchors the first wrap boundary at the edit offset (chunk-local wrap-offset caches in `text-buffer-segment.zig` + `rope.zig` split behavior). |

## Upstream baseline

- Upstream repo: `https://github.com/anomalyco/opentui.git` (remote `upstream`)
- Fork remote: `https://github.com/3aKHP/opentui.git` (remote `origin`)
- Frozen base: tag `v0.5.1`, commit `ad9a818d7a9d73f3386e92a445d0feb4b395c69e`
  ("prepare release v0.5.1", 2026-08-04)
- Base recorded on: 2026-08-04
- Both defects reproduce unfixed at this base; the editor/wrap Zig sources are
  byte-identical from v0.4.3 through v0.5.1/main.

## Branch policy

- `main` tracks `upstream/main`, fast-forward only. Never commit to `main`.
- `vesicle/base-v<upstream-version>` branches are frozen upstream bases.
  Only fork-infrastructure commits that never go upstream (this file,
  fork CI notes) may land on a base branch, after the upstream tag, clearly
  separated from patch commits.
- **Patch branches must be forked from the pristine upstream tag
  (`v<upstream-version>`), never from a `vesicle/base-*` branch.** Base
  branches carry fork-only commits that must never leak into upstream PRs
  (this leaked once into anomalyco/opentui#1329 and required a rebase +
  force-push to repair). `VESICLE_FORK.md` is also listed in
  `.git/info/exclude` so an untracked copy on a patch branch cannot be
  re-added by accident.
- Each defect fix lives on its own branch forked from the upstream tag:
  - `vesicle/fix-1289-cursor-boundary`
  - `vesicle/fix-1288-wrap-reflow`
- Each fix is exactly one upstreamable commit (plus its Zig/TS tests) so it can
  be reviewed, bisected, upstreamed, and removed independently. Do not combine
  the two fixes in one commit.
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

- Zig `0.15.2` (repo `.zig-version`, `packages/core/src/zig/build.zig.zon`).
  Local toolchain: `.zig-toolchain/zig-x86_64-linux-0.15.2/zig` (untracked,
  excluded via `.git/info/exclude`; SHA-256 verified against
  `https://ziglang.org/download/index.json`).
- Bun `1.3.14` (matches upstream CI; `engines: bun >=1.3.0`).

## Build and test

```bash
# Native tests (pure Zig; fetches uucode/yoga from network on first run)
cd packages/core/src/zig
../../../../.zig-toolchain/zig-x86_64-linux-0.15.2/zig build test

# Full native build (current platform)
cd packages/core && bun run build:native

# TS-side tests
cd packages/core && bun install && bun test
```

## Hard rules

- No package renaming or distribution changes during the native correctness
  spike.
- No unrelated visual or framework changes; patch queue only.
- One upstream PR per defect, with minimal reproduction and native regression
  tests (precedent: anomalyco/opentui#1078).
- No Vesicle-specific paths, branding, or assumptions in upstreamable commits.
- Publish nothing from an unclean source tree.
- Removal trigger: upstream releases equivalent fixes; Vesicle verifies the
  full acceptance matrix against that release; then the corresponding patch
  branch and any fork selectors are removed (see the governing document §10).
