#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

async function published(name: string, version: string) {
  return (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0
}

async function publish(dir: string, name: string, version: string) {
  // GitHub artifact downloads can drop the executable bit, and Docker uses the
  // unpacked dist binaries directly rather than the published tarball.
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(dir)
  if (await published(name, version)) {
    console.log(`already published ${name}@${version}`)
    return
  }
  await $`bun pm pack`.cwd(dir)
  await $`npm publish *.tgz --access public --tag ${Script.channel}`.cwd(dir)
}

const binaries: Record<string, string> = {}
for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })) {
  const pkg = await Bun.file(`./dist/${filepath}`).json()
  binaries[pkg.name] = pkg.version
}
console.log("binaries", binaries)
if (Object.keys(binaries).length === 0) {
  console.error("no binaries found in ./dist/")
  process.exit(1)
}
const version = Object.values(binaries)[0]

await $`mkdir -p ./dist/${pkg.name}`
await $`mkdir -p ./dist/${pkg.name}/bin`
await $`cp ./script/postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`
await Bun.file(`./dist/${pkg.name}/LICENSE`).write(await Bun.file("../../LICENSE").text())
await Bun.file(`./dist/${pkg.name}/bin/${pkg.name}.exe`).write(
  [
    `echo "Error: ${pkg.name}-ai's postinstall script was not run." >&2`,
    'echo "" >&2',
    'echo "This occurs when using --ignore-scripts during installation, or when using a" >&2',
    'echo "package manager like pnpm that does not run postinstall scripts by default." >&2',
    'echo "" >&2',
    'echo "To fix this, run the postinstall script manually:" >&2',
    `echo "  cd node_modules/${pkg.name}-ai && node postinstall.mjs" >&2`,
    'echo "" >&2',
    `echo "Or reinstall ${pkg.name}-ai without the --ignore-scripts flag." >&2`,
    "exit 1",
    "",
  ].join("\n"),
)

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: pkg.name + "-ai",
      bin: {
        [pkg.name]: `./bin/${pkg.name}.exe`,
      },
      scripts: {
        postinstall: "node ./postinstall.mjs",
      },
      version,
      license: pkg.license,
      os: ["darwin", "linux", "win32"],
      cpu: ["arm64", "x64"],
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

const tasks = Object.entries(binaries).map(async ([name]) => {
  await publish(`./dist/${name}`, name, binaries[name])
})
await Promise.all(tasks)
await publish(`./dist/${pkg.name}`, `${pkg.name}-ai`, version)

// registries
if (!Script.preview) {
  const githubToken = process.env.GITHUB_TOKEN
  if (!githubToken) {
    console.error("GITHUB_TOKEN is required to update homebrew tap")
    process.exit(1)
  }

  await $`docker buildx build --platform linux/amd64,linux/arm64 -t ghcr.io/dressedinblack5/openaxe:${version} -t ghcr.io/dressedinblack5/openaxe:${Script.channel} --push .`

  // Calculate SHA values
  const arm64Sha = await $`sha256sum ./dist/openaxe-linux-arm64.tar.gz | cut -d' ' -f1`.text().then((x) => x.trim())
  const x64Sha = await $`sha256sum ./dist/openaxe-linux-x64.tar.gz | cut -d' ' -f1`.text().then((x) => x.trim())
  const macX64Sha = await $`sha256sum ./dist/openaxe-darwin-x64.zip | cut -d' ' -f1`.text().then((x) => x.trim())
  const macArm64Sha = await $`sha256sum ./dist/openaxe-darwin-arm64.zip | cut -d' ' -f1`.text().then((x) => x.trim())

  const [pkgver, _subver = ""] = Script.version.split(/(-.*)/, 2)

  const binaryPkgbuild = [
    "# Maintainer: dax",
    "# Maintainer: adam",
    "",
    "pkgname='openaxe-bin'",
    `pkgver=${pkgver}`,
    `_subver=${_subver}`,
    "options=('!debug' '!strip')",
    "pkgrel=1",
    "pkgdesc='The AI coding agent built for the terminal.'",
    "url='https://github.com/dressedinblack5/openaxe'",
    "arch=('aarch64' 'x86_64')",
    "license=('MIT')",
    "provides=('openaxe')",
    "conflicts=('openaxe')",
    "depends=('ripgrep')",
    "",
    `source_aarch64=("\${pkgname}_\${pkgver}_aarch64.tar.gz::https://github.com/dressedinblack5/openaxe/releases/download/v\${pkgver}\${_subver}/openaxe-linux-arm64.tar.gz")`,
    `sha256sums_aarch64=('${arm64Sha}')`,

    `source_x86_64=("\${pkgname}_\${pkgver}_x86_64.tar.gz::https://github.com/dressedinblack5/openaxe/releases/download/v\${pkgver}\${_subver}/openaxe-linux-x64.tar.gz")`,
    `sha256sums_x86_64=('${x64Sha}')`,
    "",
    "package() {",
    '  install -Dm755 ./openaxe "${pkgdir}/usr/bin/openaxe"',
    "}",
    "",
  ].join("\n")

  for (let i = 0; i < 30; i++) {
    try {
      await $`rm -rf ./dist/aur-openaxe-bin`
      await $`git clone ssh://aur@aur.archlinux.org/openaxe-bin.git ./dist/aur-openaxe-bin`
      await $`cd ./dist/aur-openaxe-bin && git checkout master`
      await Bun.file("./dist/aur-openaxe-bin/PKGBUILD").write(binaryPkgbuild)
      await $`cd ./dist/aur-openaxe-bin && makepkg --printsrcinfo > .SRCINFO`
      await $`cd ./dist/aur-openaxe-bin && git add PKGBUILD .SRCINFO`
      if ((await $`cd ./dist/aur-openaxe-bin && git diff --cached --quiet`.nothrow()).exitCode === 0) break
      await $`cd ./dist/aur-openaxe-bin && git commit -m "Update to v${Script.version}"`
      await $`cd ./dist/aur-openaxe-bin && git push`
      break
    } catch (e) {
      console.error(`AUR publish attempt ${i + 1} failed:`, e)
    }
  }

  // Homebrew formula
  const homebrewFormula = [
    "# typed: false",
    "# frozen_string_literal: true",
    "",
    "# This file was generated by GoReleaser. DO NOT EDIT.",
    "class Openaxe < Formula",
    `  desc "The AI coding agent built for the terminal."`,
    `  homepage "https://github.com/dressedinblack5/openaxe"`,
    `  version "${Script.version.split("-")[0]}"`,
    "",
    `  depends_on "ripgrep"`,
    "",
    "  on_macos do",
    "    if Hardware::CPU.intel?",
    `      url "https://github.com/dressedinblack5/openaxe/releases/download/v${Script.version}/openaxe-darwin-x64.zip"`,
    `      sha256 "${macX64Sha}"`,
    "",
    "      def install",
    '        bin.install "openaxe"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm?",
    `      url "https://github.com/dressedinblack5/openaxe/releases/download/v${Script.version}/openaxe-darwin-arm64.zip"`,
    `      sha256 "${macArm64Sha}"`,
    "",
    "      def install",
    '        bin.install "openaxe"',
    "      end",
    "    end",
    "  end",
    "",
    "  on_linux do",
    "    if Hardware::CPU.intel? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/dressedinblack5/openaxe/releases/download/v${Script.version}/openaxe-linux-x64.tar.gz"`,
    `      sha256 "${x64Sha}"`,
    "      def install",
    '        bin.install "openaxe"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/dressedinblack5/openaxe/releases/download/v${Script.version}/openaxe-linux-arm64.tar.gz"`,
    `      sha256 "${arm64Sha}"`,
    "      def install",
    '        bin.install "openaxe"',
    "      end",
    "    end",
    "  end",
    "end",
    "",
    "",
  ].join("\n")

  await $`rm -rf ./dist/homebrew-tap`
  await $`git clone https://x-access-token:${githubToken}@github.com/dressedinblack5/homebrew-tap.git ./dist/homebrew-tap`
  await Bun.file("./dist/homebrew-tap/openaxe.rb").write(homebrewFormula)
  await $`cd ./dist/homebrew-tap && git add openaxe.rb`
  if ((await $`cd ./dist/homebrew-tap && git diff --cached --quiet`.nothrow()).exitCode !== 0) {
    await $`cd ./dist/homebrew-tap && git commit -m "Update to v${Script.version}"`
    await $`cd ./dist/homebrew-tap && git push`
  }
}
