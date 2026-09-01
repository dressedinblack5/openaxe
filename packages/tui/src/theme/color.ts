import { RGBA, type TerminalColors } from "@opentui/core"

export function ansiToRgba(code: number): RGBA {
  if (code < 16) {
    const ansi = [
      "#000000",
      "#800000",
      "#008000",
      "#808000",
      "#000080",
      "#800080",
      "#008080",
      "#c0c0c0",
      "#808080",
      "#ff0000",
      "#00ff00",
      "#ffff00",
      "#0000ff",
      "#ff00ff",
      "#00ffff",
      "#ffffff",
    ]
    return RGBA.fromHex(ansi[code] ?? "#000000")
  }
  if (code < 232) {
    const index = code - 16
    const b = index % 6
    const g = Math.floor(index / 6) % 6
    const r = Math.floor(index / 36)
    const value = (x: number) => (x === 0 ? 0 : x * 40 + 55)
    return RGBA.fromInts(value(r), value(g), value(b))
  }
  if (code < 256) {
    const gray = (code - 232) * 10 + 8
    return RGBA.fromInts(gray, gray, gray)
  }
  return RGBA.fromInts(0, 0, 0)
}

export function tint(base: RGBA, overlay: RGBA, value: number): RGBA {
  return RGBA.fromInts(
    Math.round((base.r + (overlay.r - base.r) * value) * 255),
    Math.round((base.g + (overlay.g - base.g) * value) * 255),
    Math.round((base.b + (overlay.b - base.b) * value) * 255),
  )
}

export function luminance(color: RGBA): number {
  return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b
}

export function mode(bg: RGBA): "dark" | "light" {
  return luminance(bg) > 0.5 ? "light" : "dark"
}

export function terminalMode(colors: TerminalColors): "dark" | "light" | undefined {
  const bg = colors.defaultBackground
  if (!bg) return undefined
  return mode(RGBA.fromHex(bg))
}

export function alpha(color: RGBA, value: number): RGBA {
  return RGBA.fromValues(color.r, color.g, color.b, Math.max(0, Math.min(1, value)))
}

export function rgba(hex: string, value?: number): RGBA {
  const color = RGBA.fromHex(hex)
  return value === undefined ? color : alpha(color, value)
}

export function blend(color: RGBA, bg: RGBA): RGBA {
  if (color.a >= 1) return color
  return RGBA.fromValues(bg.r + (color.r - bg.r) * color.a, bg.g + (color.g - bg.g) * color.a, bg.b + (color.b - bg.b) * color.a, 1)
}

export function chroma(color: RGBA): number {
  return Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b)
}

export function fade(color: RGBA, base: RGBA, fallback: number, scale: number, limit: number): RGBA {
  if (color.a === 0) return RGBA.fromValues(color.r, color.g, color.b, Math.max(0, Math.min(1, fallback)))
  const target = Math.min(limit, color.a * scale)
  const mix = Math.min(1, target / color.a)
  return RGBA.fromValues(base.r + (color.r - base.r) * mix, base.g + (color.g - base.g) * mix, base.b + (color.b - base.b) * mix, color.a)
}
