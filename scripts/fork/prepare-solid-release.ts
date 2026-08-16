// Fork-infra (never upstreamed): builds @opentui/solid from the release tree
// and repackages the dist as @3akhp/opentui-solid — the dependency is
// rewritten to the fork core package and every bundled import of
// "@opentui/core" is rewritten to the scoped name, so a fork consumer never
// resolves a second, upstream core.
//
// Usage (from the repository root, on a vesicle/release/* branch):
//   bun scripts/fork/prepare-solid-release.ts 0.5.3-zv2
//
// Publish with: bun scripts/fork/publish-scoped.ts --dir=packages/solid/dist

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

interface PackageJson {
  name: string
  version: string
  dependencies?: Record<string, string>
  repository?: { type?: string; url?: string; directory?: string } | string
  bugs?: { url?: string } | string
  [key: string]: unknown
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, "..", "..")
const solidDir = join(rootDir, "packages", "solid")
const distDir = join(solidDir, "dist")

const FORK_CORE = "@3akhp/opentui-core"
const UPSTREAM_CORE = "@opentui/core"
const FORK_REPO = "https://github.com/3aKHP/opentui.git"
const FORK_ISSUES = "https://github.com/3aKHP/opentui/issues"

const args = process.argv.slice(2)
const targetVersion = args.find((arg) => !arg.startsWith("--"))
const coreVersionArg = args.find((arg) => arg.startsWith("--core-version="))
const coreVersion = coreVersionArg ? coreVersionArg.slice("--core-version=".length) : targetVersion

function fail(message: string): never {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

if (!targetVersion || !/^\d+\.\d+\.\d+-zv\d+$/.test(targetVersion)) {
  fail("usage: bun scripts/fork/prepare-solid-release.ts <base-version>-zv<N>")
}

function gitOutput(...gitArgs: string[]): string {
  const result = spawnSync("git", gitArgs, { cwd: rootDir, encoding: "utf8" })
  if (result.status !== 0) fail(`git ${gitArgs.join(" ")} failed: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

function onReleaseContext(version: string): boolean {
  const branch = gitOutput("branch", "--show-current")
  if (branch.startsWith("vesicle/release/")) return true
  // actions/checkout of a release tag leaves HEAD detached with no branch
  // name; accept an exact-match tag in that context.
  if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REF_TYPE === "tag") {
    const tag = spawnSync("git", ["describe", "--tags", "--exact-match", "HEAD"], { cwd: rootDir, encoding: "utf8" })
    return tag.status === 0 && tag.stdout.trim() === `v${version}`
  }
  return false
}

if (!onReleaseContext(targetVersion)) {
  fail(`must run on a vesicle/release/* branch (or its exact release tag in CI) for ${targetVersion}`)
}
const dirtyFiles = gitOutput("status", "--porcelain")
if (dirtyFiles && !args.includes("--allow-dirty")) {
  fail(`working tree is not clean:\n${dirtyFiles}`)
}

console.log(`Building @opentui/solid from the release tree...`)
const build = spawnSync("bun", ["run", "build"], { cwd: solidDir, stdio: "inherit" })
if (build.status !== 0) fail("solid build failed; see output above")

const distPackagePath = join(distDir, "package.json")
if (!existsSync(distPackagePath)) fail(`solid dist manifest missing: ${distPackagePath}`)
const distPackage = JSON.parse(readFileSync(distPackagePath, "utf8")) as PackageJson
if (distPackage.name !== "@opentui/solid") {
  fail(`unexpected solid dist name ${JSON.stringify(distPackage.name)}; rebuild dist`)
}

// Rewrite the core dependency to the fork package at the release version.
const coreDep = distPackage.dependencies?.[UPSTREAM_CORE]
if (coreDep === undefined) {
  fail("solid dist does not depend on @opentui/core; inspect the build")
}
const forkPackage: PackageJson = { ...distPackage }
forkPackage.name = "@3akhp/opentui-solid"
forkPackage.version = targetVersion
forkPackage.dependencies = { ...distPackage.dependencies, [FORK_CORE]: coreVersion }
delete forkPackage.dependencies[UPSTREAM_CORE]
forkPackage.repository = { type: "git", url: "git+" + FORK_REPO, directory: "packages/solid" }
forkPackage.bugs = { url: FORK_ISSUES }
writeFileSync(distPackagePath, `${JSON.stringify(forkPackage, null, 2)}\n`)

// Rewrite scoped names across EVERY shipped runtime and declaration file.
// Scope: the core dependency (@opentui/core…) and the package's own
// self-references (@opentui/solid…, including jsx-runtime / components /
// bun-plugin entrypoints and their mention in error strings). Cross-package
// integrations that legitimately stay upstream (@opentui/qrcode,
// @opentui/keymap, …) are untouched by construction — only core|solid match.
// 0.5.3-zv2 shipped with unrewritten core subpath imports; zv3 repeated the
// class of bug for the package's own name and .d.ts files (issue #1) — the
// final sweep now asserts absence across every .js and .d.ts file.
const scopedSpecifier = /(["'`])@opentui\/(core|solid)(\/[^"'`]*)?\1/g
let rewritten = 0
let leftover = 0
function rewriteDir(dir: string): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = spawnSync("stat", ["-c", "%F", path])
    if (stat.stdout.toString().trim() === "directory") {
      rewriteDir(path)
      continue
    }
    if (!name.endsWith(".js") && !name.endsWith(".d.ts")) continue
    const source = readFileSync(path, "utf8")
    const next = source.replace(
      scopedSpecifier,
      (_match, quote: string, pkg: string, subpath?: string) => `${quote}@3akhp/opentui-${pkg}${subpath ?? ""}${quote}`,
    )
    if (next !== source) {
      writeFileSync(path, next)
      const count = source.match(scopedSpecifier)?.length ?? 0
      rewritten += count
      console.log(`REWROTE ${count}x scoped specifier in ${relative(rootDir, path)}`)
    }
    const remaining = next.match(scopedSpecifier)
    if (remaining) {
      leftover += remaining.length
      console.error(`LEFTOVER ${remaining.length}x @opentui/{core,solid} reference in ${relative(rootDir, path)}`)
    }
  }
}
rewriteDir(distDir)
if (leftover > 0) {
  fail(`${leftover} @opentui/{core,solid} references remain in solid dist; fix the rewriter before publishing`)
}
if (rewritten === 0) {
  fail(
    "no bundled @opentui/{core,solid} imports found in solid dist; the bundle shape changed — inspect before publishing",
  )
}

if (!existsSync(join(distDir, "LICENSE"))) {
  fail("solid dist/LICENSE missing; MIT notice must ship (feasibility §4)")
}

const readmePath = join(distDir, "README.md")
if (existsSync(readmePath)) {
  const marker = "<!-- vesicle-fork-provenance -->"
  const readme = readFileSync(readmePath, "utf8")
  if (!readme.includes(marker)) {
    writeFileSync(
      readmePath,
      `${readme}\n${marker}\n\nVesicle fork repack of anomalyco/opentui \`@opentui/solid\` ${targetVersion},\npublished as \`@3akhp/opentui-solid\` with its \`@opentui/core\` dependency\nrewritten to \`${FORK_CORE}\`. Upstream MIT license and attribution preserved.\n`,
    )
  }
}

console.log(`\nSUCCESS: solid dist prepared as @3akhp/opentui-solid@${targetVersion}`)
console.log(`  dependency: ${FORK_CORE}@${coreVersion} (rewritten from ${UPSTREAM_CORE}@${coreDep})`)
console.log("Next: bun scripts/fork/publish-scoped.ts --dir=packages/solid/dist --dry-run")
