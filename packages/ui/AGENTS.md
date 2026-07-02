# @opencode-ai/ui

Shared SolidJS component library for the openaxe TUI. Icons, app/provider/file icons, components, i18n, theme, v2 components.

## Structure

```
packages/ui/src/
  assets/         audio, favicon, images, and all icon files (1089 SVG icons)
  components/     shared UI components + app-icons + file-icons + provider-icons
  context/        SolidJS context providers
  hooks/          shared SolidJS hooks
  i18n/           internationalization (18 files)
  styles/         CSS + Tailwind config
  theme/          color themes (33+ themes)
  v2/             v2 components and styles
```

## Conventions

- Icons live under `src/assets/icons/` by category (file-types/, provider/, etc.)
- Components use SolidJS + OpenTUI imports
- Theme files are JSON color maps imported with `with { type: "json" }`
- No business logic — rendering only, no DB, no LLM calls
- No direct Effect imports — domain effects go through context hooks
- Component dirs: `components/`, `v2/components/` with subdirs for app-icons, file-icons, provider-icons

## Anti-Patterns

- No barrels across subdirs (import from specific module paths)
- No session/plugin orchestration logic here