// Fork-infra (never upstreamed): publishes the prepared scoped fork package
// with the Option B atomicity discipline (decision D3c,
// dev/docs/working/OPENTUI_FORK_OPTION_B_RELEASE_DECISIONS.md in
// prism-vesicle):
//
//   1. fork platform packages first (when they exist), main last;
//   2. every pinned optionalDependency must already exist on the registry at
//      the exact version before the main package publishes;
//   3. never overwrite an existing version — rollback is deprecate + next
//      version (npm's 72h unpublish window is never relied upon).
//
// Upstream's own packages/core publish script is main-first and carries the
// broken-install window this order exists to avoid.
//
// Usage (after prepare-scoped-release.ts, on a clean vesicle/release/* tree):
//   bun scripts/fork/publish-scoped.ts --dry-run   # full rehearsal, no side effects
//   NPM_AUTH_TOKEN=... bun scripts/fork/publish-scoped.ts
//
// First publish uses a short-lived granular token (D3b); later releases move
// to npm Trusted Publishing, which replaces only the auth source — this
// script's order and checks stay identical. Token-published versions carry no
// npm provenance attestation; record the printed SHA-256 in the release notes.

import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

interface PackageJson {
  name: string
  version: string
  optionalDependencies?: Record<string, string>
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, "..", "..")
const defaultDistDir = join(rootDir, "packages", "core", "dist")
const distDirArg = process.argv.find((arg) => arg.startsWith("--dir="))
const distDir = distDirArg ? resolve(rootDir, distDirArg.slice("--dir=".length)) : defaultDistDir
const FORK_SCOPE = "@3akhp/"

const dryRun = process.argv.includes("--dry-run")

function fail(message: string): never {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

function run(
  command: string,
  runArgs: string[],
  options: { cwd: string; allowFailure?: boolean },
): SpawnSyncReturns<string> {
  const result = spawnSync(command, runArgs, { cwd: options.cwd, encoding: "utf8" })
  if (result.status !== 0 && !options.allowFailure) {
    fail(`${command} ${runArgs.join(" ")} failed:\n${result.stderr.trim() || result.stdout.trim()}`)
  }
  return result
}

function gitOutput(...gitArgs: string[]): string {
  return run("git", gitArgs, { cwd: rootDir }).stdout.trim()
}

function versionExistsOnRegistry(name: string, version: string): boolean {
  const result = run("npm", ["view", `${name}@${version}`, "version"], {
    cwd: rootDir,
    allowFailure: true,
  })
  return result.status === 0 && result.stdout.trim() === version
}

// --- guards -----------------------------------------------------------------

function onReleaseContext(): boolean {
  const branch = gitOutput("branch", "--show-current")
  if (branch.startsWith("vesicle/release/")) return true
  // actions/checkout of a release tag leaves HEAD detached; the dist version
  // pin below still locks the release identity.
  if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REF_TYPE === "tag") {
    const tag = spawnSync("git", ["describe", "--tags", "--exact-match", "HEAD"], { cwd: rootDir, encoding: "utf8" })
    return tag.status === 0 && /^v\d+\.\d+\.\d+-zv\d+$/.test(tag.stdout.trim())
  }
  return false
}

if (!onReleaseContext()) {
  fail("must run on a vesicle/release/* branch (or its release tag in CI)")
}

const dirtyFiles = gitOutput("status", "--porcelain")
if (dirtyFiles) {
  fail(`working tree is not clean — the charter forbids publishing from an unclean tree:\n${dirtyFiles}`)
}

const distPackagePath = join(distDir, "package.json")
if (!existsSync(distPackagePath)) {
  fail("packages/core/dist/package.json not found; run build:lib and prepare-scoped-release.ts first")
}
const distPackage = JSON.parse(readFileSync(distPackagePath, "utf8")) as PackageJson
if (!distPackage.name.startsWith(FORK_SCOPE)) {
  fail(`dist/package.json name ${JSON.stringify(distPackage.name)} is not fork-scoped; run prepare-scoped-release.ts`)
}
if (!/^\d+\.\d+\.\d+-zv\d+$/.test(distPackage.version)) {
  fail(`dist version ${JSON.stringify(distPackage.version)} does not follow <base>-zv<N> (D3a)`)
}

const mainName = distPackage.name
const mainVersion = distPackage.version
const optionalDependencies = distPackage.optionalDependencies ?? {}
const forkPlatformDeps = Object.entries(optionalDependencies).filter(([name]) => name.startsWith(FORK_SCOPE))
const externalDeps = Object.entries(optionalDependencies).filter(([name]) => !name.startsWith(FORK_SCOPE))

console.log(`Publishing ${mainName}@${mainVersion}${dryRun ? " (dry run)" : ""}`)

// --- D3c step 1: fork platform packages first (none in zv1) ------------------

for (const [name, version] of forkPlatformDeps) {
  if (version !== mainVersion) {
    fail(`${name} pinned at ${version} but main is ${mainVersion}; fork platform packages release in lockstep`)
  }
  if (versionExistsOnRegistry(name, version)) {
    console.log(`SKIP ${name}@${version} (already published — idempotent resume)`)
    continue
  }
  const stagedDir = join(rootDir, "packages", "core", "node_modules", name)
  if (!existsSync(join(stagedDir, "package.json"))) {
    fail(
      `${name}@${version} is not on the registry and no staged build exists at ${stagedDir}; ` +
        "build the fork native packages first",
    )
  }
  console.log(`PUBLISH ${name}@${version} (platform package before main — D3c order)`)
  const publishResult = spawnSync(
    "npm",
    ["publish", "--access", "public", "--tag", "latest", ...(dryRun ? ["--dry-run"] : [])],
    { cwd: stagedDir, encoding: "utf8" },
  )
  if (publishResult.status !== 0) {
    // A prior interrupted run may have published this version while registry
    // reads still lag; the registry's overwrite refusal is authoritative.
    const stderr = publishResult.stderr ?? ""
    if (stderr.includes("cannot publish over the previously published versions")) {
      console.log(`SKIP ${name}@${version} (registry reports it already published — resume)`)
    } else {
      fail(`npm publish for ${name}@${version} failed:\n${stderr.trim() || publishResult.stdout.trim()}`)
    }
  }
}

// --- D3c step 2: every pin must resolve on the registry before main ----------

// Just-published packages can take ~90s before registry reads reflect the
// write (observed on both fork releases so far), so re-collect with patience
// before declaring a pin missing.
const VERIFY_ATTEMPTS = 12
let missing: string[] = []
for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
  missing = []
  for (const [name, version] of [...forkPlatformDeps, ...externalDeps]) {
    if (!versionExistsOnRegistry(name, version)) {
      missing.push(`${name}@${version}`)
    }
  }
  if (missing.length === 0) break
  if (attempt === VERIFY_ATTEMPTS) {
    fail(
      `pinned optional dependencies missing from the registry (main package must never publish into this state):\n` +
        missing.map((entry) => `  - ${entry}`).join("\n"),
    )
  }
  console.log(`WAIT ${missing.length} pins not visible yet (attempt ${attempt}/${VERIFY_ATTEMPTS}); retrying in 15s`)
  spawnSync("sleep", ["15"])
}
console.log(
  `VERIFIED ${forkPlatformDeps.length + externalDeps.length} pinned optional dependencies exist on the registry`,
)

// --- D3c step 3: no overwrite ------------------------------------------------

if (versionExistsOnRegistry(mainName, mainVersion)) {
  fail(
    `${mainName}@${mainVersion} already exists on the registry. Never overwrite a published version: ` +
      "deprecate it (npm deprecate) and publish the next -zvN version instead (D3c rollback rule).",
  )
}

// --- auth (real publishes only) ----------------------------------------------

// Two modes: local token publishing (NPM_AUTH_TOKEN / NPM_CONFIG_USERCONFIG
// .npmrc) and GitHub Actions Trusted Publishing, where npm exchanges an OIDC
// id-token per command (id-token: write) — there is no durable registry token
// for `npm whoami` to verify, so that check is local-mode only.
const oidcMode = process.env.GITHUB_ACTIONS === "true" && !process.env.NPM_AUTH_TOKEN

if (!dryRun) {
  if (process.env.NPM_AUTH_TOKEN) {
    const npmrcPath = join(process.env.HOME as string, ".npmrc")
    const authLine = `//registry.npmjs.org/:_authToken=${process.env.NPM_AUTH_TOKEN}`
    const existing = existsSync(npmrcPath) ? readFileSync(npmrcPath, "utf8") : ""
    if (!existing.includes("//registry.npmjs.org/:_authToken")) {
      writeFileSync(npmrcPath, existing ? `${existing}\n${authLine}\n` : `${authLine}\n`)
      console.log("SET UP npm auth from NPM_AUTH_TOKEN")
    }
  }
  if (oidcMode) {
    console.log("AUTH: GitHub Actions OIDC (Trusted Publishing) — npm exchanges the id-token per command")
  } else {
    run("npm", ["whoami"], { cwd: rootDir })
  }
}

// --- pack for the record, then publish main last -----------------------------

const packCwd = mkdtempSync(join(tmpdir(), "opentui-fork-publish-"))
try {
  cpSync(distDir, packCwd, { recursive: true })
  const packResult = run("npm", ["pack", "--json"], { cwd: packCwd })
  interface PackEntry {
    filename: string
  }
  const packEntries = JSON.parse(packResult.stdout) as PackEntry[]
  for (const entry of packEntries) {
    const tarballBytes = readFileSync(join(packCwd, entry.filename))
    const sha256 = createHash("sha256").update(tarballBytes).digest("hex")
    console.log(`PACKED ${entry.filename} sha256=${sha256} (record in the release notes — D2)`)
  }

  console.log(`PUBLISH ${mainName}@${mainVersion} (main last — D3c order)`)
  run("npm", ["publish", "--access", "public", "--tag", "latest", ...(dryRun ? ["--dry-run"] : [])], {
    cwd: distDir,
  })
  console.log("  npm publish exited 0")
} finally {
  rmSync(packCwd, { recursive: true, force: true })
}

// A just-published package can take a minute+ before registry reads reflect
// the write (observed 2026-08-16: PUT 200 at +0s, GET still 404 at +80s).
// The publish itself has succeeded by this point — never report it as failed.
function viewWithRetry(field: string): string {
  const maxAttempts = 12
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = run("npm", ["view", `${mainName}@${mainVersion}`, field], {
      cwd: rootDir,
      allowFailure: true,
    })
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim()
    }
    if (attempt === maxAttempts) {
      fail(
        `npm view ${field} did not resolve after ${maxAttempts} attempts. ` +
          "The publish itself succeeded; verify the registry manually and record the hashes.",
      )
    }
    console.log(`WAIT registry metadata not visible yet (attempt ${attempt}/${maxAttempts}); retrying in 15s`)
    spawnSync("sleep", ["15"])
  }
  return ""
}

if (!dryRun) {
  const shasum = viewWithRetry("dist.shasum")
  const tarball = viewWithRetry("dist.tarball")
  console.log(
    [
      "",
      `PUBLISHED ${mainName}@${mainVersion}`,
      `  registry shasum: ${shasum}`,
      `  tarball: ${tarball}`,
      "  token-published versions carry no npm provenance — record sha256 + lineage in the release notes (D2/D3b)",
      "  rollback rule: deprecate + next version, never overwrite (D3c)",
    ].join("\n"),
  )
} else {
  console.log("\nDRY RUN complete — no registry changes were made")
}
