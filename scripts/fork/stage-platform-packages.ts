// Fork-infra (never upstreamed): builds the fork native variants through the
// upstream build script (which also packages entries + third-party license
// files) and re-stages them as @3akhp/opentui-core-<variant> packages.
//
// Usage (from the repository root, on a vesicle/release/* branch):
//   bun scripts/fork/stage-platform-packages.ts 0.5.3-zv2 [--skip-build]
//
// The staged packages land in packages/core/node_modules/@3akhp/… (gitignored)
// and are published by publish-scoped.ts (fork platform packages first).
// Requires the Zig toolchain on PATH (run with the fork toolchain dir first).

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

interface PackageJson {
  name: string
  version: string
  description?: string
  repository?: { type?: string; url?: string; directory?: string } | string
  bugs?: { url?: string } | string
  [key: string]: unknown
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, "..", "..")
const coreDir = join(rootDir, "packages", "core")

const FORK_REPO = "https://github.com/3aKHP/opentui.git"
const FORK_ISSUES = "https://github.com/3aKHP/opentui/issues"

// Must stay in sync with FORK_NATIVE_VARIANTS in
// packages/core/src/node-asset-target.ts and the selector mapping the release
// carries. Map: variant -> zig target (build.zig spellings).
const FORK_VARIANTS: ReadonlyArray<{ variant: string; zigTarget: string }> = [
  { variant: "linux-x64", zigTarget: "x86_64-linux-gnu.2.17" },
  { variant: "linux-x64-musl", zigTarget: "x86_64-linux-musl" },
  { variant: "linux-arm64", zigTarget: "aarch64-linux-gnu.2.17" },
  { variant: "linux-arm64-musl", zigTarget: "aarch64-linux-musl" },
  { variant: "win32-x64", zigTarget: "x86_64-windows-gnu" },
  { variant: "win32-arm64", zigTarget: "aarch64-windows-gnu" },
]

const args = process.argv.slice(2)
const targetVersion = args.find((arg) => !arg.startsWith("--"))
const skipBuild = args.includes("--skip-build")

function fail(message: string): never {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

if (!targetVersion || !/^\d+\.\d+\.\d+-zv\d+$/.test(targetVersion)) {
  fail("usage: bun scripts/fork/stage-platform-packages.ts <base-version>-zv<N> [--skip-build]")
}

if (!skipBuild) {
  const targets = FORK_VARIANTS.map((entry) => entry.zigTarget).join(",")
  console.log(`Building native variants: ${targets}`)
  const build = spawnSync("bun", ["scripts/build.ts", "--native", `--targets=${targets}`], {
    cwd: coreDir,
    stdio: "inherit",
  })
  if (build.status !== 0) {
    fail("native build failed; see output above")
  }
}

for (const { variant } of FORK_VARIANTS) {
  const upstreamDir = join(coreDir, "node_modules", "@opentui", `core-${variant}`)
  const forkDir = join(coreDir, "node_modules", "@3akhp", `opentui-core-${variant}`)
  if (!existsSync(join(upstreamDir, "package.json"))) {
    fail(`upstream staging dir missing after build: ${upstreamDir}`)
  }

  rmSync(forkDir, { recursive: true, force: true })
  cpSync(upstreamDir, forkDir, { recursive: true })

  const forkPackagePath = join(forkDir, "package.json")
  const forkPackage = JSON.parse(readFileSync(forkPackagePath, "utf8")) as PackageJson
  if (forkPackage.name !== `@opentui/core-${variant}`) {
    fail(`unexpected staged package name ${forkPackage.name} in ${forkDir}`)
  }
  forkPackage.name = `@3akhp/opentui-core-${variant}`
  forkPackage.version = targetVersion
  forkPackage.repository = { type: "git", url: FORK_REPO, directory: "packages/core" }
  forkPackage.bugs = { url: FORK_ISSUES }
  writeFileSync(forkPackagePath, `${JSON.stringify(forkPackage, null, 2)}\n`)

  // Provenance note (feasibility §4) — append once.
  const readmePath = join(forkDir, "README.md")
  const marker = "<!-- vesicle-fork-provenance -->"
  const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : ""
  if (readme && !readme.includes(marker)) {
    writeFileSync(
      readmePath,
      `${readme}\n${marker}\n\nVesicle fork build of anomalyco/opentui \`${targetVersion}\`: carries the fork's\nnative editor fixes on top of the upstream base. Upstream MIT and third-party\nnotices are preserved unchanged.\n`,
    )
  }

  const nativeFiles = readdirSync(forkDir).filter((name) => /\.(so|dll|dylib)$/.test(name))
  if (nativeFiles.length !== 1) {
    fail(`expected exactly one native library in ${forkDir}, found: ${nativeFiles.join(", ") || "none"}`)
  }
  const sha256 = createHash("sha256")
    .update(readFileSync(join(forkDir, nativeFiles[0])))
    .digest("hex")
  console.log(`STAGED @3akhp/opentui-core-${variant}@${targetVersion} (${nativeFiles[0]} sha256=${sha256})`)
}

console.log(`\nSUCCESS: staged ${FORK_VARIANTS.length} fork platform packages at ${targetVersion}`)
console.log("Next: bun scripts/fork/prepare-scoped-release.ts " + targetVersion)
