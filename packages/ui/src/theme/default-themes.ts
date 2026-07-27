import type { DesktopTheme } from "./types"
import oc2ThemeJson from "./themes/oc-2.json"
import amoledThemeJson from "./themes/amoled.json"
import auraThemeJson from "./themes/aura.json"
import ayuThemeJson from "./themes/ayu.json"
import carbonfoxThemeJson from "./themes/carbonfox.json"
import catppuccinThemeJson from "./themes/catppuccin.json"
import catppuccinFrappeThemeJson from "./themes/catppuccin-frappe.json"
import catppuccinMacchiatoThemeJson from "./themes/catppuccin-macchiato.json"
import cobalt2ThemeJson from "./themes/cobalt2.json"
import cursorThemeJson from "./themes/cursor.json"
import draculaThemeJson from "./themes/dracula.json"
import everforestThemeJson from "./themes/everforest.json"
import flexokiThemeJson from "./themes/flexoki.json"
import githubThemeJson from "./themes/github.json"
import gruvboxThemeJson from "./themes/gruvbox.json"
import kanagawaThemeJson from "./themes/kanagawa.json"
import lucentOrngThemeJson from "./themes/lucent-orng.json"
import materialThemeJson from "./themes/material.json"
import matrixThemeJson from "./themes/matrix.json"
import mercuryThemeJson from "./themes/mercury.json"
import monokaiThemeJson from "./themes/monokai.json"
import nightowlThemeJson from "./themes/nightowl.json"
import nordThemeJson from "./themes/nord.json"
import oneDarkThemeJson from "./themes/one-dark.json"
import oneDarkProThemeJson from "./themes/onedarkpro.json"
import openaxeThemeJson from "./themes/opencode.json"
import orngThemeJson from "./themes/orng.json"
import osakaJadeThemeJson from "./themes/osaka-jade.json"
import palenightThemeJson from "./themes/palenight.json"
import rosepineThemeJson from "./themes/rosepine.json"
import shadesOfPurpleThemeJson from "./themes/shadesofpurple.json"
import solarizedThemeJson from "./themes/solarized.json"
import synthwave84ThemeJson from "./themes/synthwave84.json"
import tokyonightThemeJson from "./themes/tokyonight.json"
import vercelThemeJson from "./themes/vercel.json"
import vesperThemeJson from "./themes/vesper.json"
import zenburnThemeJson from "./themes/zenburn.json"

function asDesktopTheme(v: unknown): DesktopTheme {
  return v as DesktopTheme
}

export const oc2Theme = asDesktopTheme(oc2ThemeJson)
export const amoledTheme = asDesktopTheme(amoledThemeJson)
export const auraTheme = asDesktopTheme(auraThemeJson)
export const ayuTheme = asDesktopTheme(ayuThemeJson)
export const carbonfoxTheme = asDesktopTheme(carbonfoxThemeJson)
export const catppuccinTheme = asDesktopTheme(catppuccinThemeJson)
export const catppuccinFrappeTheme = asDesktopTheme(catppuccinFrappeThemeJson)
export const catppuccinMacchiatoTheme = asDesktopTheme(catppuccinMacchiatoThemeJson)
export const cobalt2Theme = asDesktopTheme(cobalt2ThemeJson)
export const cursorTheme = asDesktopTheme(cursorThemeJson)
export const draculaTheme = asDesktopTheme(draculaThemeJson)
export const everforestTheme = asDesktopTheme(everforestThemeJson)
export const flexokiTheme = asDesktopTheme(flexokiThemeJson)
export const githubTheme = asDesktopTheme(githubThemeJson)
export const gruvboxTheme = asDesktopTheme(gruvboxThemeJson)
export const kanagawaTheme = asDesktopTheme(kanagawaThemeJson)
export const lucentOrngTheme = asDesktopTheme(lucentOrngThemeJson)
export const materialTheme = asDesktopTheme(materialThemeJson)
export const matrixTheme = asDesktopTheme(matrixThemeJson)
export const mercuryTheme = asDesktopTheme(mercuryThemeJson)
export const monokaiTheme = asDesktopTheme(monokaiThemeJson)
export const nightowlTheme = asDesktopTheme(nightowlThemeJson)
export const nordTheme = asDesktopTheme(nordThemeJson)
export const oneDarkTheme = asDesktopTheme(oneDarkThemeJson)
export const oneDarkProTheme = asDesktopTheme(oneDarkProThemeJson)
export const openaxeTheme = asDesktopTheme(openaxeThemeJson)
export const orngTheme = asDesktopTheme(orngThemeJson)
export const osakaJadeTheme = asDesktopTheme(osakaJadeThemeJson)
export const palenightTheme = asDesktopTheme(palenightThemeJson)
export const rosepineTheme = asDesktopTheme(rosepineThemeJson)
export const shadesOfPurpleTheme = asDesktopTheme(shadesOfPurpleThemeJson)
export const solarizedTheme = asDesktopTheme(solarizedThemeJson)
export const synthwave84Theme = asDesktopTheme(synthwave84ThemeJson)
export const tokyonightTheme = asDesktopTheme(tokyonightThemeJson)
export const vercelTheme = asDesktopTheme(vercelThemeJson)
export const vesperTheme = asDesktopTheme(vesperThemeJson)
export const zenburnTheme = asDesktopTheme(zenburnThemeJson)

export const DEFAULT_THEMES: Record<string, DesktopTheme> = {
  "oc-2": oc2Theme,
  amoled: amoledTheme,
  aura: auraTheme,
  ayu: ayuTheme,
  carbonfox: carbonfoxTheme,
  catppuccin: catppuccinTheme,
  "catppuccin-frappe": catppuccinFrappeTheme,
  "catppuccin-macchiato": catppuccinMacchiatoTheme,
  cobalt2: cobalt2Theme,
  cursor: cursorTheme,
  dracula: draculaTheme,
  everforest: everforestTheme,
  flexoki: flexokiTheme,
  github: githubTheme,
  gruvbox: gruvboxTheme,
  kanagawa: kanagawaTheme,
  "lucent-orng": lucentOrngTheme,
  material: materialTheme,
  matrix: matrixTheme,
  mercury: mercuryTheme,
  monokai: monokaiTheme,
  nightowl: nightowlTheme,
  nord: nordTheme,
  "one-dark": oneDarkTheme,
  onedarkpro: oneDarkProTheme,
  openaxe: openaxeTheme,
  orng: orngTheme,
  "osaka-jade": osakaJadeTheme,
  palenight: palenightTheme,
  rosepine: rosepineTheme,
  shadesofpurple: shadesOfPurpleTheme,
  solarized: solarizedTheme,
  synthwave84: synthwave84Theme,
  tokyonight: tokyonightTheme,
  vercel: vercelTheme,
  vesper: vesperTheme,
  zenburn: zenburnTheme,
}
