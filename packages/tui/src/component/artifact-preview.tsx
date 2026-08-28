import { TextAttributes } from "@opentui/core"
import { createMemo, createResource, createSignal, Show } from "solid-js"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { Button } from "../components/button"

interface ArtifactSummary {
  key: string
  version: number
  size: number
  truncated: boolean
  timeCreated: number
  overflowPath?: string
}

interface ArtifactEntry {
  key: string
  version: number
  content: string
  size: number
  truncated: boolean
  timeCreated: number
  overflowPath?: string
}

const CONTENT_PREVIEW_MAX = 2000

async function fetchJson<T>(url: string, fetchFn: typeof fetch, validate: (value: unknown) => value is T): Promise<T> {
  const res = await fetchFn(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const value: unknown = await res.json()
  if (!validate(value)) throw new Error(`Invalid response from ${url}`)
  return value
}

type View = { type: "list" } | { type: "content"; key: string; version: number }

export function ArtifactPreview() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const sdk = useSDK()
  const [view, setView] = createSignal<View>({ type: "list" })

  const baseUrl = () => sdk.url.replace(/\/+$/, "")
  const doFetch = sdk.fetch

  const [list] = createResource(
    () => view().type === "list",
    async () => {
      return fetchJson(`${baseUrl()}/api/artifact`, doFetch, (value): value is ArtifactSummary[] =>
        Array.isArray(value),
      )
    },
  )

  const contentKey = createMemo(() => {
    const v = view()
    if (v.type !== "content") return undefined
    return `${v.key}:${v.version}`
  })

  const [entry] = createResource(contentKey, async (key) => {
    const [k, v] = key.split(":")
    return fetchJson(
      `${baseUrl()}/api/artifact/${encodeURIComponent(k)}/${v}`,
      doFetch,
      (value): value is ArtifactEntry | null => value === null || (typeof value === "object" && !Array.isArray(value)),
    )
  })

  const [showFull, setShowFull] = createSignal(false)

  const options = createMemo(() => {
    const items = list()
    if (!items) return []
    const byKey = new Map<string, ArtifactSummary[]>()
    for (const item of items) {
      const group = byKey.get(item.key) ?? []
      group.push(item)
      byKey.set(item.key, group)
    }
    const result: { title: string; value: string; category: string; footer: string }[] = []
    for (const [key, versions] of byKey) {
      for (const v of versions) {
        result.push({
          title: `v${v.version} — ${new Date(v.timeCreated).toLocaleString()}`,
          value: `${key}:${v.version}`,
          category: key,
          footer: v.truncated ? "truncated" : `${v.size}B`,
        })
      }
    }
    return result
  })

  const showList = () => view().type === "list"
  const showContent = () => view().type === "content"

  return (
    <Show
      when={showList()}
      fallback={
        <Show
          when={showContent()}
          fallback={
            <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
              <text fg={theme.error}>Unknown view</text>
            </box>
          }
        >
          <ContentDisplay
            entry={entry}
            showFull={showFull()}
            onToggle={() => setShowFull(!showFull())}
            onBack={() => {
              setView({ type: "list" })
              setShowFull(false)
            }}
          />
        </Show>
      }
    >
      <Show
        when={!list.loading}
        fallback={
          <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
            <text fg={theme.textMuted}>Loading artifacts...</text>
          </box>
        }
      >
        <Show
          when={!list.error}
          fallback={
            <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
              <text fg={theme.error}>Failed to load artifacts</text>
            </box>
          }
        >
          <Show
            when={options().length > 0}
            fallback={
              <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    Artifacts
                  </text>
                  <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
                    esc
                  </text>
                </box>
                <text fg={theme.textMuted}>No artifacts found</text>
              </box>
            }
          >
            <DialogSelect
              title="Artifacts"
              options={options()}
              onSelect={(opt) => {
                const parts = opt.value.split(":")
                setView({ type: "content", key: parts[0], version: Number(parts[1]) })
              }}
              emptyView={<text fg={theme.textMuted}>No artifacts found</text>}
            />
          </Show>
        </Show>
      </Show>
    </Show>
  )
}

function ContentDisplay(props: {
  entry: { loading: boolean; error?: unknown; latest?: ArtifactEntry | null }
  showFull: boolean
  onToggle: () => void
  onBack: () => void
}) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const data = () => props.entry.latest

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {data() ? `${data()?.key} v${data()?.version}` : "Artifact"}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show when={!props.entry.loading} fallback={<text fg={theme.textMuted}>Loading...</text>}>
        <Show when={!props.entry.error} fallback={<text fg={theme.error}>Failed to load artifact content</text>}>
          <Show when={data()} fallback={<text fg={theme.textMuted}>Artifact not found</text>}>
            {(d) => (
              <box flexDirection="column" gap={1} paddingBottom={1}>
                <box flexDirection="row" gap={2} paddingBottom={1}>
                  <text fg={theme.textMuted}>Size: {d().size}B</text>
                  <Show when={d().truncated}>
                    <text fg={theme.warning}>Truncated</text>
                  </Show>
                  <text fg={theme.textMuted}>{new Date(d().timeCreated).toLocaleString()}</text>
                </box>
                <box
                  flexGrow={1}
                  flexShrink={1}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={theme.backgroundElement}
                >
                  <text wrapMode="word" fg={theme.text}>
                    {props.showFull || !d().truncated
                      ? d().content
                      : d().content.slice(0, CONTENT_PREVIEW_MAX) + "\n\n... content truncated ..."}
                  </text>
                </box>
                <Show when={d().truncated}>
                  <box flexDirection="row" justifyContent="space-between" paddingTop={1}>
                    <Button variant="primary" onMouseUp={props.onToggle}>
                      {props.showFull ? "Show less" : "Show all content"}
                    </Button>
                    <Button variant="secondary" onMouseUp={props.onBack}>
                      Back
                    </Button>
                  </box>
                </Show>
                <Show when={!d().truncated}>
                  <box paddingTop={1}>
                    <Button variant="secondary" onMouseUp={props.onBack}>
                      Back
                    </Button>
                  </box>
                </Show>
              </box>
            )}
          </Show>
        </Show>
      </Show>
    </box>
  )
}
