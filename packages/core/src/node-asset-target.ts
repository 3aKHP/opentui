export type NodeAssetTarget = {
  readonly platform: "darwin" | "linux" | "win32"
  readonly arch: "arm64" | "x64"
  readonly libc?: "glibc" | "musl"
}

export interface NativeAssetDescriptor {
  readonly key: string
  readonly packageName: string
  readonly fileName: string
}

const NATIVE_FILE_NAMES = {
  darwin: "libopentui.dylib",
  linux: "libopentui.so",
  win32: "opentui.dll",
} as const

// Variants the fork builds and publishes under its own scope, carrying the
// native editor fixes. Every other variant resolves the upstream
// @opentui/core-* package: at the fork's base those targets are
// byte-identical upstream builds, so the exposed platform set stays whole.
const FORK_NATIVE_VARIANTS: ReadonlySet<string> = new Set([
  "linux-x64",
  "linux-x64-musl",
  "linux-arm64",
  "linux-arm64-musl",
  "win32-x64",
  "win32-arm64",
])

export function getNativeAssetDescriptor(target: NodeAssetTarget): NativeAssetDescriptor {
  if (!Object.hasOwn(NATIVE_FILE_NAMES, target.platform) || (target.arch !== "arm64" && target.arch !== "x64")) {
    throw new Error(`Unsupported OpenTUI Node asset target: ${String(target.platform)}-${String(target.arch)}`)
  }

  if (target.libc !== undefined && target.libc !== "glibc" && target.libc !== "musl") {
    throw new Error(`Unsupported libc for OpenTUI Node assets: ${String(target.libc)}`)
  }
  if (target.platform !== "linux" && target.libc !== undefined) {
    throw new Error(`OpenTUI Node asset target libc is only supported on Linux, got ${target.platform}`)
  }

  const libcSuffix = target.platform === "linux" && target.libc === "musl" ? "-musl" : ""
  const variant = `${target.platform}-${target.arch}${libcSuffix}`
  const packageName = FORK_NATIVE_VARIANTS.has(variant) ? `@3akhp/opentui-core-${variant}` : `@opentui/core-${variant}`
  const fileName = NATIVE_FILE_NAMES[target.platform]
  return {
    key: `${packageName}/${fileName}`,
    packageName,
    fileName,
  }
}

export function getCurrentNodeAssetTarget(): NodeAssetTarget {
  const libc = process.env.OPENTUI_LIBC
  if (process.platform === "linux" && libc !== undefined && libc !== "" && libc !== "glibc" && libc !== "musl") {
    throw new Error(`On Linux, OPENTUI_LIBC must be unset, empty, "glibc", or "musl", got ${JSON.stringify(libc)}`)
  }

  return {
    platform: process.platform as NodeAssetTarget["platform"],
    arch: process.arch as NodeAssetTarget["arch"],
    ...(process.platform === "linux" && libc === "musl" ? { libc } : {}),
  }
}
