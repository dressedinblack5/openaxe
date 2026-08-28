import { describe, expect, test } from "bun:test"
import { crc32, deflateRawSync, gzipSync } from "node:zlib"
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"
import { extractTgz, extractZip } from "@opencode-ai/core/util/archive"
import { tmpdir } from "../fixture/tmpdir"

// Build a minimal zip in memory. Entries: [{ name, data }]. Methods:
// "store" and "deflate" are exercised; directories are implicit via names
// ending in "/" or by nesting.
function buildZip(entries: Array<{ name: string; data?: Uint8Array; method?: number }>): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let localOffset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8")
    const data = entry.data ?? Buffer.alloc(0)
    const method = entry.method ?? (entry.name.endsWith("/") ? 0 : 8)
    const compressed = method === 8 ? deflateRawSync(data) : method === 0 ? Buffer.from(data) : Buffer.alloc(0)
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // PK\x03\x04
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // extra len
    chunks.push(local, name, compressed)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0) // PK\x01\x02
    cd.writeUInt16LE(20, 4) // version made by
    cd.writeUInt16LE(20, 6) // version needed
    cd.writeUInt16LE(0, 8) // flags
    cd.writeUInt16LE(method, 10)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(compressed.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt16LE(0, 30) // extra len
    cd.writeUInt16LE(0, 32) // comment len
    cd.writeUInt32LE(localOffset, 42)
    central.push(cd, name)
    localOffset += local.length + name.length + compressed.length
  }

  const centralBuffer = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0) // PK\x05\x06
  eocd.writeUInt16LE(entries.length, 8) // total entries
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuffer.length, 12)
  eocd.writeUInt32LE(localOffset, 16)
  eocd.writeUInt16LE(0, 20) // comment len

  return Buffer.concat([...chunks, centralBuffer, eocd])
}

// Build a minimal ustar tar.gz in memory.
function buildTgz(files: Array<{ name: string; data?: string; type?: "file" | "dir" }>): Buffer {
  const blocks: Buffer[] = []
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8")
    const isDir = file.type === "dir" || file.name.endsWith("/")
    const data = Buffer.from(file.data ?? "", "utf8")
    const header = Buffer.alloc(512)
    name.copy(header, 0, 0, Math.min(name.length, 100))
    const mode = isDir ? "0000755\0" : "0000644\0"
    header.write(mode, 100, 8, "ascii")
    header.write("0000000\0", 108, 8, "ascii") // uid
    header.write("0000000\0", 116, 8, "ascii") // gid
    header.write(data.length.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii")
    header.write("00000000000\0", 136, 12, "ascii") // mtime
    header.write("        ", 148, 8, "ascii") // chksum placeholder
    header.write(isDir ? "5" : "0", 156, 1, "ascii") // typeflag
    header.write("ustar", 257, 5, "ascii")
    header.write("00", 263, 2, "ascii")
    let sum = 0
    for (const byte of header) sum += byte
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii")
    blocks.push(header)
    if (!isDir) {
      blocks.push(data)
      const pad = 512 - (data.length % 512)
      if (pad < 512) blocks.push(Buffer.alloc(pad))
    }
  }
  blocks.push(Buffer.alloc(1024)) // end marker
  return gzipSync(Buffer.concat(blocks))
}

describe("extractZip", () => {
  test("extracts stored and deflated entries with nested dirs", async () => {
    await using dir = await tmpdir()
    const archive = path.join(dir.path, "test.zip")
    writeFileSync(
      archive,
      buildZip([
        { name: "pkg/", method: 0 },
        { name: "pkg/nested/", method: 0 },
        { name: "pkg/nested/rg", data: new TextEncoder().encode("#!/bin/sh\necho hi\n"), method: 0 },
        { name: "pkg/file.txt", data: new TextEncoder().encode("deflated content"), method: 8 },
      ]),
    )

    const out = path.join(dir.path, "out")
    mkdirSync(out, { recursive: true })
    extractZip(archive, out)

    expect(readFileSync(path.join(out, "pkg", "nested", "rg"), "utf8")).toBe("#!/bin/sh\necho hi\n")
    expect(readFileSync(path.join(out, "pkg", "file.txt"), "utf8")).toBe("deflated content")
  })

  test("skips path-traversal entries", async () => {
    await using dir = await tmpdir()
    const archive = path.join(dir.path, "evil.zip")
    writeFileSync(
      archive,
      buildZip([
        { name: "..", method: 0 },
        { name: "../escape.txt", data: new TextEncoder().encode("nope"), method: 0 },
        { name: "ok.txt", data: new TextEncoder().encode("yes"), method: 0 },
      ]),
    )

    const out = path.join(dir.path, "out")
    mkdirSync(out, { recursive: true })
    extractZip(archive, out)

    expect(readFileSync(path.join(out, "ok.txt"), "utf8")).toBe("yes")
    expect(existsSync(path.join(out, "escape.txt"))).toBe(false)
    expect(existsSync(path.join(dir.path, "escape.txt"))).toBe(false)
  })

  test("throws on non-zip input", async () => {
    await using dir = await tmpdir()
    const archive = path.join(dir.path, "not.zip")
    writeFileSync(archive, "this is not a zip")
    expect(() => extractZip(archive, dir.path)).toThrow()
  })
})

describe("extractTgz", () => {
  test("extracts files and dirs", async () => {
    await using dir = await tmpdir()
    const archive = path.join(dir.path, "test.tgz")
    writeFileSync(
      archive,
      buildTgz([
        { name: "pkg/", type: "dir" },
        { name: "pkg/lib/", type: "dir" },
        { name: "pkg/lib/codegraph.js", data: "module.exports = 42\n" },
        { name: "pkg/bin/codegraph", data: "#!/bin/sh\n" },
      ]),
    )

    const out = path.join(dir.path, "out")
    mkdirSync(out, { recursive: true })
    extractTgz(archive, out)

    expect(readFileSync(path.join(out, "pkg", "lib", "codegraph.js"), "utf8")).toBe("module.exports = 42\n")
    expect(readFileSync(path.join(out, "pkg", "bin", "codegraph"), "utf8")).toBe("#!/bin/sh\n")
  })

  test("stripComponents flattens the npm package/ prefix", async () => {
    await using dir = await tmpdir()
    const archive = path.join(dir.path, "npm.tgz")
    writeFileSync(
      archive,
      buildTgz([
        { name: "package/", type: "dir" },
        { name: "package/lib/dist/bin/codegraph.js", data: "module.exports = 1\n" },
      ]),
    )

    const out = path.join(dir.path, "out")
    mkdirSync(out, { recursive: true })
    extractTgz(archive, out, 1)

    expect(existsSync(path.join(out, "package"))).toBe(false)
    expect(readFileSync(path.join(out, "lib", "dist", "bin", "codegraph.js"), "utf8")).toBe("module.exports = 1\n")
  })

  test("skips path-traversal entries", async () => {
    await using dir = await tmpdir()
    const archive = path.join(dir.path, "evil.tgz")
    writeFileSync(
      archive,
      buildTgz([
        { name: "../escape.txt", data: "nope" },
        { name: "ok.txt", data: "yes" },
      ]),
    )

    const out = path.join(dir.path, "out")
    mkdirSync(out, { recursive: true })
    extractTgz(archive, out)

    expect(readFileSync(path.join(out, "ok.txt"), "utf8")).toBe("yes")
    expect(existsSync(path.join(dir.path, "escape.txt"))).toBe(false)
  })
})
