# Upstream-follow release SOP — vesicle fork line

Status: living document. This is fork-infra documentation: it lives on the
vesicle line only and is never part of any upstream PR.

Distilled 2026-09-02 from the v0.5.9-zv1 → v0.5.10-zv4 release cycles
(including the three burned tags of the 0.5.10 integration). Update it every
time a release teaches a new lesson — an SOP that lags reality is worse than
none.

## 0. Mechanics quick reference (constants of the pipeline)

- Upstream remote: `anomalyco/opentui` (`upstream`); fork: `3aKHP/opentui`
  (`origin`). Never push to `upstream`.
- Integration branches: `vesicle/integration-v<upstream>` — the fork's living
  line. Release branches `vesicle/release/v<base>-zv<N>` mark release tips;
  they carry no extra commits.
- Publish trigger: pushing a tag matching `v*.*.*-zv*` starts
  `.github/workflows/fork-npm-release.yml`. The version is derived from the
  tag name; `scripts/fork/*` transform dist at publish time (no version
  commits needed on the release branch).
- **No tag moves, ever.** A failed release run burns its tag; the tag
  documents the iteration and the next attempt takes `zv<N+1>`. Version
  numbering simply skips burned numbers.
- Publishing uses npm Trusted Publishing (OIDC, `environment: npm-release`).
  Every release must record shasums + lineage in the GitHub Release notes
  (D2/D3b). Rollback = deprecate + next version, never overwrite (D3c).
- Darwin optionalDependencies stay upstream-named (`@opentui/core-darwin-*@<base>`);
  the fork builds/stages only linux + win32 variants
  (`scripts/fork/stage-platform-packages.ts`, `FORK_VARIANTS`).
- Local toolchain: zig at `.zig-toolchain/zig-x86_64-linux-<ver>` (match the
  version pinned in `.github/workflows/*`); Node ≥ 26.4 for node suites
  (volta default may be older — use a standalone build, don't change volta).

## 1. Research phase — trial merge (cheap, always do it)

Do this in a throwaway worktree; discard afterwards.

```bash
git worktree add /tmp/otui-trial -b trial/merge-vX <current integration tip>
cd /tmp/otui-trial && git merge --no-commit --no-ff vX
```

Checklist over the trial result:

1. **Conflict scan** — expect zero conflicts on this fork so far; any conflict
   means fork customizations collided with upstream and need manual review.
2. **`bun.lock` semantics** — the auto-merged lockfile is *always* suspect:
   run `bun install` (regen) then `bun install --frozen-lockfile` (must pass).
   This mirrors commit 79e943d8 (0.5.9) and 8d737a2a (0.5.10).
3. **Version surfaces** — `packages/core/package.json` now pins
   `@opentui/core-*@<base>` upstream-named. `prepare-scoped-release.ts`
   derives the base from its CLI arg and verifies consistency — no action
   needed unless upstream renamed the platform packages.
4. **Toolchain deltas upstream made** — diff `.github/` between base tags and
   read new `actions/` and scripts. Upstream's runner layout is NOT the
   fork's: upstream builds per-OS on native runners; the fork cross-builds
   all six variants on one ubuntu runner. Any new build-time step must be
   checked against cross-build reality (see §Appendix A.4 for the canonical
   example).
5. **`build.zig.zon` delta** — if changed, the vendored-zig-deps set and the
   `prepare-zig-deps.sh` unpack may need updating (fork(release) 432abf91).
6. **Native rebuild requirement** — after merge, JS references new native
   symbols (0.5.10: `imageCreateFromPixels`). Rebuild native in the trial
   worktree and run the targeted suites there (strict-tilde + Markdown are
   the fork's canaries).

## 2. Integration phase

1. Branch `vesicle/integration-v<base>` from the current integration tip;
   merge the upstream tag `v<base>` with a merge commit that names the
   upstream highlights.
2. Commit the regenerated `bun.lock` separately as
   `fork(ci): resolve <base> platform packages in the frozen lockfile`.
3. Adapt fork infra for whatever the research phase found; separate
   `fork(ci)` commits, one intent each.
4. Workflow edits: run actionlint before pushing (binary is not vendored —
   download from rhysd/actionlint releases, asset
   `actionlint_X.Y.Z_linux_amd64.tar.gz`, underscores).

## 3. Verification phase

On the integration branch, with the fresh native build:

- Root `bun run build` (with zig on PATH) — rebuilds native and stages it
  under `packages/core/node_modules/@opentui/core-linux-x64`.
- Refresh the local fork-variant package the tests resolve through:
  copy the *whole* `@opentui/core-linux-x64` package dir over
  `@3akhp/opentui-core-linux-x64` in `packages/core/node_modules` — see
  Appendix A.3 for why, and never overwrite the `.so` while a suite is
  running.
- Core `bun run test:js` (expect: previous pass count + upstream's new tests).
- Node suite `bun run test:js:node` on Node ≥ 26.4.
- `bun run fmt:check` (changed files) + `oxlint`.
- `test:dist` is known-broken locally (platform-package naming mismatch,
  pre-existing; the release pipeline rewrites names at publish). Don't burn
  time on it; record it in the PR notes instead.

## 4. Review and merge

- Integration PRs are **Standard PR** grade (release-bound work): independent
  CR SubAgent (fresh session, no implementation context) + local gates as the
  bot-review substitute (no CI runs on fork PR branches). Consolidate into
  Blocking / Should-fix / Nits / Verified; fix Blocking before merge,
  Should-fix unless documented deferral.
- Small follow-up fixes during the release loop (CI-infra only) may take
  **Quick PR** grade — see PRs #9/#10 for the pattern.
- Have the CR verify reproducibility claims about generated files (PR #13):
  a "hand-synced byte-for-byte" entry position that the generator would emit
  differently turns into reorder churn on the next regeneration. Pin
  generator emission order (e.g. extras append last) in a test, and let the
  reviewer actually run generators/builders offline in a scratch copy — the
  PR #13 review caught a false byte-for-byte claim, a custom-output asset
  leak, and reproduced the fix with a real `bun build` consumer this way.
- Merge with `--merge` (preserve commit identity; the strict-tilde-style
  feature commits stay cherry-pickable for upstream PRs).

## 5. Pre-tag checklist — run BEFORE pushing any release tag

This list exists because v0.5.10-zv1/zv2/zv3 each failed on something a
checklist item would have caught. Items are ordered cheapest first.

1. `actionlint` clean on every workflow touched since the last release.
2. **Upstream base tag exists on the fork remote**:
   `git ls-remote --tags origin | grep "refs/tags/v<base>$"` — if missing,
   `git push origin v<base>` first (`prepare-scoped-release.ts` verifies it
   in the release checkout). This burned zv3.
3. Workflow steps added since the last green release have had at least one
   live-green run; a *novel* step that has never executed on a runner should
   be expected to burn one tag. Minimize novel steps by reusing proven ones;
   when unavoidable, keep them fail-fast (early `test -x`/`test -s` guards)
   so the burn costs minutes, not a full native build.
4. `bun install --frozen-lockfile` passes on the exact commit being tagged.
5. Merged integration branch is pushed and the PR (if any) is merged; the
   tag commit is the merge commit or a descendant.

## 6. Release execution

```bash
git branch vesicle/release/v<base>-zv<N> <tip> && git push origin vesicle/release/v<base>-zv<N>
git tag v<base>-zv<N> <tip> -m "..." && git push origin v<base>-zv<N>
```

Monitor with `gh run watch` / `gh run view --log-failed`. Expected duration:
~20 min (native cross-build dominates). On failure:

- Read `--log-failed` fully; fix root cause via Quick PR to the integration
  line; retag `zv<N+1>`. Do not move or delete the burned tag.
- Keep each fix one-intent-per-PR with the root-cause story in the commit
  message — these commits are the audit trail of pipeline evolution.

## 7. Post-release verification

1. Registry: `npm view @3akhp/opentui-core@<ver> version` (+ `-solid` + one
   win32 platform package); `optionalDependencies` rewritten correctly
   (darwin upstream-named, rest fork-named); `dist.attestations` present
   (proves OIDC trusted publishing, not token).
2. Tarball spot-check: `npm pack` and confirm fork assets ship (e.g.
   `highlights.strict.scm`).
3. GitHub Release on the tag with: lineage (base tag + PRs merged), the
   change summary, package/shasum table (from the run log `PUBLISHED` lines
   and `STAGED` sha256 lines), burned-tag story if any, provenance/rollback
   notes.
4. Update agent memory (gotchas + released version) — this SOP and memory
   cross-reference each other.

## Appendix A. Known gotchas catalog

1. **Auto-merged `bun.lock` is semantically wrong** (v0.5.9, v0.5.10):
   always regen + refrozen after an upstream merge.
2. **Stale local fork-variant native package**: tests resolve
   `@3akhp/opentui-core-linux-x64` from `packages/core/node_modules`, which
   is untracked local state. After any native rebuild, copy the whole staged
   `@opentui/core-linux-x64` package over it (a bare `.so` copy breaks module
   resolution; a mid-run `.so` overwrite SIGBUSes the running suite).
3. **LLVM ≥ 20 for win32 symbol separation** (burned zv1): llvm-18 readobj
   prints the DLL PDBGUID via `printBinary`; lld's synthetic cross-build GUID
   bytes spell printable ASCII (`LLD PDB.`), so `native-symbols.ts`'s
   dashed-GUID regex never matches. llvm-20 prints the dashed GUID. Upstream
   avoids this by building win32 on Windows runners with Chocolatey LLVM.
   The fork installs llvm-20 from apt.llvm.org (ubuntu-24.04 ships only 18).
4. **apt keyring fetch must fail loudly** (burned zv2): `wget -qO- | tee`
   writes an empty keyring with exit 0 when the fetch silently fails. Use
   `curl -fsSL` + `test -s` + `gpg --dearmor` + `signed-by`.
5. **Upstream base tag must exist on the fork remote** (burned zv3): see
   §5.2.
6. **Upstream toolchain deltas don't transfer** — always map upstream's
   per-OS runner layout onto the fork's single-runner cross-build
   (`.github/actions/setup-native-symbol-tools` installs LLVM on macOS/Windows
   runners only; the fork needed its own Linux step with a version floor).
7. **Fork platform packages ship stripped libs** since 0.5.10 (#1437):
   symbols are detached into `packages/native/symbols/` on the runner and
   discarded. If crash-reporting ever needs them, upstream's
   `package-native-symbols.ts` produces per-target zips ready to attach.
8. **Zero-job workflow runs** (issue #4, 0.5.3 era): never reference the
   `runner` context in job-level `env` — GitHub invalidates the whole
   workflow. Keep such vars at step level.

## Appendix B. Decision log

- Burned tags stay forever and version numbers skip them (D3c lineage
  hygiene).
- Darwin stays upstream-named in optionalDependencies: the fork cannot
  cross-build darwin on this runner and Vesicle doesn't consume darwin.
- Release symbols are not archived for fork releases (2026-09-02): revisit
  on the first real crash-reporting need.
- `test:dist` local runs are not a release gate (naming mismatch is
  pre-existing; publish-time rewriting covers it).
