import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

// Regression test for the 0.5.9-zv2 failure shape: a consumer that re-bundles
// the core JS (npm bundles, `bun build --compile`) inlines the helper, and any
// source-relative fallback URL inside it points into the consumer's own
// artifact. Only the bundled-asset loader map resolves live paths there. The
// in-repo suites run from the source layout where the fallback also works, so
// this test builds and runs a real bundle to observe the actual shape.
describe("strictMarkdownInlineParserOptions in a re-bundled consumer", () => {
  function runBun(args: string[], cwd: string, env: Record<string, string | undefined>) {
    const result = Bun.spawnSync([process.execPath, ...args], { cwd, env, stdout: "pipe", stderr: "pipe" })
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    }
  }

  test("resolves live asset paths from the bundle output", async () => {
    const root = mkdtempSync(join(tmpdir(), "opentui-strict-bundled-"))
    const outDir = join(root, "out")
    const entryPath = join(root, "entry.ts")
    const clientPath = fileURLToPath(new URL("./client.ts", import.meta.url))

    try {
      writeFileSync(
        entryPath,
        [
          `import { strictMarkdownInlineParserOptions } from ${JSON.stringify(clientPath)}`,
          "const options = await strictMarkdownInlineParserOptions()",
          "console.log(JSON.stringify({ wasm: options.wasm, highlights: options.queries.highlights[0] }))",
          "",
        ].join("\n"),
      )

      // A leaked OTUI_ASSET_ROOT from other suites in the same process would
      // route resolution away from the bundled-asset branch under test.
      const env = { ...process.env }
      delete env.OTUI_ASSET_ROOT

      // Native platform packages stay external exactly like a real
      // re-bundling consumer marks them: they are optionalDependencies that
      // never resolve outside an install tree, and the helper never loads
      // native code anyway.
      const nativeExternals = [
        "@opentui/core-darwin-x64",
        "@opentui/core-darwin-arm64",
        "@opentui/core-linux-x64",
        "@opentui/core-linux-arm64",
        "@opentui/core-win32-x64",
      ].flatMap((packageName) => ["--external", packageName])

      const build = runBun(["build", "--target=bun", entryPath, "--outdir", outDir, ...nativeExternals], root, env)
      expect(build.stderr).toBe("")
      expect(build.exitCode).toBe(0)

      const run = runBun([join(outDir, "entry.js")], root, env)
      expect(run.stderr).toBe("")
      expect(run.exitCode).toBe(0)

      const resolved = JSON.parse(run.stdout.trim().split("\n").at(-1)!) as { wasm: string; highlights: string }
      // The bundler renames emitted file assets (content hashes), but the
      // basenames keep identifying which asset each path resolved to.
      expect(basename(resolved.highlights)).toMatch(/^highlights\.strict.*\.scm$/)
      expect(basename(resolved.wasm)).toMatch(/^tree-sitter-markdown_inline.*\.wasm$/)
      for (const path of [resolved.highlights, resolved.wasm]) {
        expect(existsSync(path)).toBe(true)
        // Live paths must come from the bundle's emitted assets, not from the
        // source tree the inlined fallback URL would have pointed past.
        expect(relative(outDir, path)).not.toStartWith("..")
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)
})
