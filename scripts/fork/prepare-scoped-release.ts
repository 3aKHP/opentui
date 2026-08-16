// Fork-infra (never upstreamed): packages the built @opentui/core dist as the
// scoped Vesicle fork package @3akhp/opentui-core. Policy authority:
// VESICLE_FORK.md (release branches) and prism-vesicle
// dev/docs/working/OPENTUI_FORK_OPTION_B_RELEASE_DECISIONS.md (D3a/D4/D3c).
//
// Usage (from the repository root, on a vesicle/release/<version> branch):
//   cd packages/core && bun run build:lib
//   bun scripts/fork/prepare-scoped-release.ts 0.5.3-zv1
//
// The transform is packaging-level only: upstream source keeps the
// @opentui/core name so the workspace stays intact. It rewrites
// dist/package.json (name/version/repository/bugs), rewrites the single
// Bun-runtime self-reference literal (@opentui/core/parser.worker → the
// scoped name; Node runtimes resolve the worker via relative URL and are
// name-agnostic), asserts the escape-fix marker in the bundled worker, and
// appends fork-provenance wording to dist/README.md (feasibility §4).
// Re-running with the same target is an idempotent verify-only pass.

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

interface PackageJson {
  name: string
  version: string
  description?: string
  license?: string
  homepage?: string
  repository?: { type?: string; url?: string; directory?: string } | string
  bugs?: { url?: string } | string
  exports?: Record<string, unknown>
  optionalDependencies?: Record<string, string>
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, "..", "..")
const coreDir = join(rootDir, "packages", "core")
const distDir = join(coreDir, "dist")

const FORK_NAME = "@3akhp/opentui-core"
const FORK_REPO = "https://github.com/3aKHP/opentui.git"
const FORK_ISSUES = "https://github.com/3aKHP/opentui/issues"
const UPSTREAM_WORKER_SPECIFIER = '"@opentui/core/parser.worker"'
const FORK_WORKER_SPECIFIER = `"${FORK_NAME}/parser.worker"`
const ESCAPE_FIX_MARKER = "backslash_escape"
const README_NOTE_MARKER = "<!-- vesicle-fork-provenance -->"

const args = process.argv.slice(2)
const targetVersion = args.find((arg) => !arg.startsWith("--"))

function fail(message: string): never {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

if (!targetVersion) {
  fail("usage: bun scripts/fork/prepare-scoped-release.ts <base-version>-zv<N>")
}

const versionMatch = targetVersion.match(/^(\d+\.\d+\.\d+)-zv(\d+)$/)
if (!versionMatch) {
  fail(`target version must be <upstream-base>-zv<N>, got ${JSON.stringify(targetVersion)}`)
}
const baseVersion = versionMatch[1]

function readJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, "utf8")) as PackageJson
}

function gitOutput(...gitArgs: string[]): string {
  const result = spawnSync("git", gitArgs, { cwd: rootDir, encoding: "utf8" })
  if (result.status !== 0) {
    fail(`git ${gitArgs.join(" ")} failed: ${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function listJsFiles(dir: string): string[] {
  const entries: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (isDir(path)) {
      entries.push(...listJsFiles(path))
    } else if (name.endsWith(".js")) {
      entries.push(path)
    }
  }
  return entries
}

// --- source-side guards -----------------------------------------------------

const sourcePackage = readJson(join(coreDir, "package.json"))
if (sourcePackage.name !== "@opentui/core") {
  fail(`packages/core/package.json must stay ${JSON.stringify("@opentui/core")} on release branches`)
}
if (sourcePackage.version !== baseVersion) {
  fail(
    `target base ${baseVersion} does not match packages/core version ${sourcePackage.version}; ` +
      "the release branch must carry the upstream base version in source",
  )
}

const currentBranch = gitOutput("branch", "--show-current")
if (!currentBranch.startsWith("vesicle/release/")) {
  fail(`must run on a vesicle/release/* branch, currently on ${JSON.stringify(currentBranch)}`)
}

const dirtyFiles = gitOutput("status", "--porcelain")
if (dirtyFiles && !args.includes("--allow-dirty")) {
  fail(`working tree is not clean:\n${dirtyFiles}`)
}

const baseTag = `v${baseVersion}`
const tagExists = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${baseTag}^{commit}`], { cwd: rootDir })
if (tagExists.status !== 0) {
  fail(`upstream base tag ${baseTag} not found locally; run git fetch upstream --tags`)
}
const patchCommits = gitOutput("log", "--oneline", `${baseTag}..HEAD`).split("\n").filter(Boolean)
if (patchCommits.length === 0) {
  fail(`release branch has no patch commits on top of ${baseTag}; nothing to publish`)
}

// --- dist-side guards -------------------------------------------------------

const distPackagePath = join(distDir, "package.json")
if (!existsSync(distPackagePath)) {
  fail("packages/core/dist/package.json not found; run `cd packages/core && bun run build:lib` first")
}
const distPackage = readJson(distPackagePath)

const alreadyTransformed = distPackage.name === FORK_NAME && distPackage.version === targetVersion
if (alreadyTransformed) {
  console.log(`NOTE: dist already transformed as ${FORK_NAME}@${targetVersion}; re-verifying`)
} else {
  if (distPackage.name !== "@opentui/core") {
    fail(`unexpected dist/package.json name ${JSON.stringify(distPackage.name)}; rebuild dist from clean source`)
  }
  if (distPackage.version !== baseVersion) {
    fail(
      `dist version ${distPackage.version} does not match base ${baseVersion}; ` +
        "dist is stale, run `cd packages/core && bun run build:lib`",
    )
  }
}

const exportsKeys = Object.keys(distPackage.exports ?? {})
if (!exportsKeys.includes("./parser.worker")) {
  fail("dist package.json exports map lost ./parser.worker; the scoped self-reference would not resolve")
}
if (distPackage.optionalDependencies) {
  for (const [name, version] of Object.entries(distPackage.optionalDependencies)) {
    if (name.startsWith("@3akhp/")) {
      fail(
        `${name} in optionalDependencies: fork-native packaging is not implemented yet; ` +
          "D4 zv1 releases pin upstream native packages",
      )
    }
    if (!name.startsWith("@opentui/core-") || version !== baseVersion) {
      fail(`unexpected optional dependency ${name}@${version}; zv1 pins upstream natives at ${baseVersion}`)
    }
  }
}
if (!existsSync(join(distDir, "LICENSE"))) {
  fail("dist/LICENSE missing; MIT notice must ship in every distribution shape (feasibility §4)")
}

// The escape fix is worker-side: the bundled worker must contain the
// backslash_escape type dispatch that pristine v0.5.3 lacks. This proves the
// dist under transformation was built from the patched release branch.
const workerSource = readFileSync(join(distDir, "parser.worker.js"), "utf8")
if (!workerSource.includes(ESCAPE_FIX_MARKER)) {
  fail("dist/parser.worker.js lacks the backslash_escape fix marker; dist was not built from the patched source")
}

for (const entry of ["index.node.js", "index.bun.js"]) {
  if (!existsSync(join(distDir, entry))) {
    fail(`dist/${entry} missing; rebuild dist`)
  }
}

// --- transform: self-reference literal --------------------------------------

let rewritten = 0
for (const jsPath of listJsFiles(distDir)) {
  const source = readFileSync(jsPath, "utf8")
  if (!source.includes(UPSTREAM_WORKER_SPECIFIER)) continue
  const occurrences = source.split(UPSTREAM_WORKER_SPECIFIER).length - 1
  writeFileSync(jsPath, source.split(UPSTREAM_WORKER_SPECIFIER).join(FORK_WORKER_SPECIFIER))
  rewritten += occurrences
  console.log(`REWROTE ${occurrences}x self-reference in ${relative(rootDir, jsPath)}`)
}
if (alreadyTransformed) {
  if (rewritten > 0) {
    fail("already-transformed dist still contains upstream self-reference literals; rebuild dist and re-prepare")
  }
  let forkLiteralFiles = 0
  for (const jsPath of listJsFiles(distDir)) {
    if (readFileSync(jsPath, "utf8").includes(FORK_WORKER_SPECIFIER)) forkLiteralFiles++
  }
  if (forkLiteralFiles === 0) {
    fail("already-transformed dist lost the scoped self-reference literal; rebuild dist and re-prepare")
  }
} else if (rewritten === 0) {
  fail(
    `no ${UPSTREAM_WORKER_SPECIFIER} literal found in dist JS; ` +
      "the Bun chunk shape changed — inspect before publishing",
  )
}

// --- transform: dist/package.json -------------------------------------------

const forkPackage: PackageJson = { ...distPackage }
forkPackage.name = FORK_NAME
forkPackage.version = targetVersion
forkPackage.repository = { type: "git", url: FORK_REPO, directory: "packages/core" }
forkPackage.bugs = { url: FORK_ISSUES }
writeFileSync(distPackagePath, `${JSON.stringify(forkPackage, null, 2)}\n`)

// --- transform: provenance note in dist/README.md ---------------------------

const readmePath = join(distDir, "README.md")
if (existsSync(readmePath)) {
  const readme = readFileSync(readmePath, "utf8")
  if (!readme.includes(README_NOTE_MARKER)) {
    const patchLines = patchCommits.map((line) => `- ${line}`).join("\n")
    const note = [
      "",
      README_NOTE_MARKER,
      "",
      "## Vesicle fork provenance",
      "",
      `This package is the Prism Vesicle patch-queue fork of [anomalyco/opentui](https://github.com/anomalyco/opentui),`,
      `published under the \`${FORK_NAME}\` scope. Lineage for \`${targetVersion}\`:`,
      "",
      `- upstream base: tag \`${baseTag}\``,
      "- fork patch commits on top of the base:",
      patchLines,
      "",
      "Fork policy: [`VESICLE_FORK.md`](https://github.com/3aKHP/opentui/blob/vesicle/base-v0.5.3/VESICLE_FORK.md).",
      "The upstream MIT license and attribution are preserved unchanged.",
      "",
    ].join("\n")
    writeFileSync(readmePath, readme + note)
    console.log("APPENDED fork provenance note to dist/README.md")
  }
}

console.log(
  [
    "",
    `SUCCESS: dist prepared as ${FORK_NAME}@${targetVersion}`,
    `  base ${baseTag} + ${patchCommits.length} patch commit(s)`,
    `  optionalDependencies: upstream natives pinned at ${baseVersion} (decision D4)`,
    "Next: bun scripts/fork/publish-scoped.ts --dry-run",
  ].join("\n"),
)
