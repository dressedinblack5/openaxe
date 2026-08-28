import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { gunzipSync, inflateRawSync } from "node:zlib"

// ponytail: pure-JS zip/tar extraction. Shell-based extraction (unzip, tar,
// PowerShell Expand-Archive) is preferred at call sites, but some environments
// — notably Wine — ship none of them (or a stub PowerShell that exits 0
// without extracting), so these are the last-resort fallback.

const EOCD_SIG = 0x06054b50 // "PK\x05\x06"
const CD_SIG = 0x02014b50 // "PK\x01\x02"
const LFH_SIG = 0x04034b50 // "PK\x03\x04"
const TAR_BLOCK = 512

/** Resolve an archive entry name against destDir, guarding against traversal. */
function safeEntry(destDir: string, name: string): string | null {
  const parts = name
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".")
  if (parts.some((part) => part === "..")) return null
  if (parts.length === 0) return null
  return path.join(destDir, ...parts)
}

/**
 * Extract a zip archive using only the central directory + node:zlib.
 * Supports stored (0) and deflate (8) entries. Sync — throws on failure.
 */
export function extractZip(archivePath: string, destDir: string): void {
  const bytes = readFileSync(archivePath)

  // End of central directory: scan backwards for the signature (a trailing
  // comment of up to 64 KiB may follow it).
  let eocd = -1
  const eocdMax = bytes.length - 22
  for (let i = eocdMax; i >= Math.max(0, eocdMax - 65536); i--) {
    if (bytes.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd === -1) throw new Error(`zip: end of central directory not found in ${archivePath}`)

  const entryCount = bytes.readUInt16LE(eocd + 10)
  let offset = bytes.readUInt32LE(eocd + 16)

  for (let index = 0; index < entryCount; index++) {
    if (bytes.readUInt32LE(offset) !== CD_SIG) throw new Error(`zip: corrupt central directory at entry ${index}`)
    const method = bytes.readUInt16LE(offset + 10)
    const compressedSize = bytes.readUInt32LE(offset + 20)
    const nameLength = bytes.readUInt16LE(offset + 28)
    const extraLength = bytes.readUInt16LE(offset + 30)
    const commentLength = bytes.readUInt16LE(offset + 32)
    const localOffset = bytes.readUInt32LE(offset + 42)
    const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLength)
    offset += 46 + nameLength + extraLength + commentLength

    const target = safeEntry(destDir, name)
    if (!target) continue

    if (name.endsWith("/")) {
      mkdirSync(target, { recursive: true })
      continue
    }

    // Locate the compressed data via the local file header (its sizes may be
    // zero when a data descriptor is used, so trust the central directory).
    if (bytes.readUInt32LE(localOffset) !== LFH_SIG) throw new Error(`zip: corrupt local header for ${name}`)
    const lfhNameLength = bytes.readUInt16LE(localOffset + 26)
    const lfhExtraLength = bytes.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lfhNameLength + lfhExtraLength
    const data = bytes.subarray(dataStart, dataStart + compressedSize)

    mkdirSync(path.dirname(target), { recursive: true })
    if (method === 0) writeFileSync(target, data)
    else if (method === 8) writeFileSync(target, inflateRawSync(data))
    else throw new Error(`zip: unsupported compression method ${method} for ${name}`)
  }
}

function tarString(bytes: Buffer, offset: number, length: number): string {
  let end = offset
  while (end < offset + length && bytes[end] !== 0) end++
  return bytes.toString("utf8", offset, end)
}

function parseOctal(bytes: Buffer, offset: number, length: number): number {
  const text = bytes.toString("utf8", offset, offset + length).replace(/[ \0]/g, "")
  if (!text) return 0
  // GNU base-256 encoding for large sizes: the high bit of the first byte is set.
  if (bytes[offset] & 0x80) {
    let value = bytes[offset] & 0x7f
    for (let i = offset + 1; i < offset + length; i++) value = value * 256 + bytes[i]
    return value
  }
  return Number.parseInt(text, 8)
}

/**
 * Extract a .tar.gz archive in pure JS. `stripComponents` drops leading path
 * components (npm tarballs nest everything under `package/`). Sync — throws on
 * failure.
 */
export function extractTgz(archivePath: string, destDir: string, stripComponents = 0): void {
  const bytes = gunzipSync(readFileSync(archivePath))
  let offset = 0
  let pendingName: string | null = null

  while (offset + TAR_BLOCK <= bytes.length) {
    const header = bytes.subarray(offset, offset + TAR_BLOCK)
    // Two zero blocks mark the end of the archive.
    if (header.every((byte) => byte === 0)) break

    const typeflag = String.fromCharCode(header[156])
    let name = pendingName ?? tarString(header, 0, 100)
    pendingName = null
    const prefix = tarString(header, 345, 155)
    if (prefix) name = `${prefix}/${name}`
    const size = parseOctal(header, 124, 12)
    const dataStart = offset + TAR_BLOCK
    const dataEnd = dataStart + size
    if (dataEnd > bytes.length) throw new Error(`tar: truncated entry ${name}`)

    if (typeflag === "L") {
      // GNU long name: the data block holds the real name for the next entry.
      pendingName = bytes.toString("utf8", dataStart, dataEnd).replace(/\0+$/, "")
      offset = Math.ceil(dataEnd / TAR_BLOCK) * TAR_BLOCK
      continue
    }
    if (typeflag === "x" || typeflag === "g" || typeflag === "K") {
      // pax extended header / GNU long link — data is metadata, skip it.
      offset = Math.ceil(dataEnd / TAR_BLOCK) * TAR_BLOCK
      continue
    }

    const parts = name
      .replaceAll("\\", "/")
      .split("/")
      .filter((part) => part !== "" && part !== ".")
    const stripped = parts.slice(stripComponents)
    const target = safeEntry(destDir, stripped.join("/"))
    if (!target) {
      offset = Math.ceil(dataEnd / TAR_BLOCK) * TAR_BLOCK
      continue
    }

    if (typeflag === "5") {
      mkdirSync(target, { recursive: true })
    } else if (typeflag === "0" || typeflag === "7" || typeflag === "\0") {
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, bytes.subarray(dataStart, dataEnd))
    }
    // Symlinks (2) and other types are skipped — the bundles we extract (rg,
    // bundled node.exe) never need them.

    offset = Math.ceil(dataEnd / TAR_BLOCK) * TAR_BLOCK
  }
}

export * as Archive from "./archive"
