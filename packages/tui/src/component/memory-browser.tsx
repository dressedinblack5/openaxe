import { TextAttributes } from "@opentui/core"
import { createMemo, createResource, createSignal, Show } from "solid-js"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { Button } from "../components/button"

interface MemoryEntry {
  key: string
  value: unknown
  kind: string
  scope: string
  source: string
}

const CONTENT_PREVIEW_MAX = 2000

async function fetchJson<T>(url: string, fetchFn: typeof fetch): Promise<T> {
  const res = await fetchFn(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as T
}

type View =
  | { type: "list" }
  | { type: "content"; key: string }

export function MemoryBrowser() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const sdk = useSDK()
  const [view, setView] = createSignal<View>({ type: "list" })

  const baseUrl = () => sdk.url.replace(/\/+$/, "")
  const doFetch = sdk.fetch

  const [list] = createResource(
    () => view().type === "list",
    async () => {
      return fetchJson<MemoryEntry[]>(`${baseUrl()}/api/memory`, doFetch)
    },
  )

  const options = createMemo(() => {
    const items = list()
    if (!items) return []
    const byKind = new Map<string, MemoryEntry[]>()
    for (const item of items) {
      const group = byKind.get(item.kind) ?? []
      group.push(item)
      byKind.set(item.kind, group)
    }
    const result: { title: string; value: string; category: string; footer: string }[] = []
    for (const [kind, entries] of byKind) {
      for (const e of entries) {
        result.push({
          title: e.key,
          value: e.key,
          category: kind,
          footer: `${e.scope}/${e.source}`,
        })
      }
    }
    return result
  })

  const [showFull, setShowFull] = createSignal(false)

  const selectedEntry = createMemo<MemoryEntry | undefined>(() => {
    const v = view()
    if (v.type !== "content") return undefined
    return list()?.find((e) => e.key === v.key)
  })

  const showList = () => view().type === "list"
  const showContent = () => view().type === "content"

  return (
    <Show when={showList()} fallback={
      <Show when={showContent()} fallback={
        <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
          <text fg={theme.error}>Unknown view</text>
        </box>
      }>
        <ContentDisplay
          entry={selectedEntry()}
          showFull={showFull()}
          onToggle={() => setShowFull(!showFull())}
          onBack={() => { setView({ type: "list" }); setShowFull(false) }}
        />
      </Show>
    }>
      <Show when={!list.loading} fallback={
        <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
          <text fg={theme.textMuted}>Loading memory...</text>
        </box>
      }>
        <Show when={!list.error} fallback={
          <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
            <text fg={theme.error}>Failed to load memory</text>
          </box>
        }>
          <Show when={options().length > 0} fallback={
            <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.text} attributes={TextAttributes.BOLD}>Memory</text>
                <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>esc</text>
              </box>
              <text fg={theme.textMuted}>No memory entries found</text>
            </box>
          }>
            <DialogSelect
              title="Memory Browser"
              options={options()}
              onSelect={(opt) => {
                setView({ type: "content", key: opt.value })
              }}
              emptyView={<text fg={theme.textMuted}>No memory entries found</text>}
            />
          </Show>
        </Show>
      </Show>
    </Show>
  )
}

function ContentDisplay(props: {
  entry: MemoryEntry | undefined
  showFull: boolean
  onToggle: () => void
  onBack: () => void
}) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const data = () => props.entry

  const formatted = createMemo(() => {
    const d = data()
    if (!d) return ""
    const raw = typeof d.value === "string" ? d.value : JSON.stringify(d.value, null, 2)
    if (props.showFull) return raw
    if (raw.length <= CONTENT_PREVIEW_MAX) return raw
    return raw.slice(0, CONTENT_PREVIEW_MAX) + "\n\n... content truncated ..."
  })

  const isTruncated = createMemo(() => {
    const d = data()
    if (!d) return false
    const raw = typeof d.value === "string" ? d.value : JSON.stringify(d.value, null, 2)
    return raw.length > CONTENT_PREVIEW_MAX
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {data() ? data()!.key : "Memory entry"}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>esc</text>
      </box>
      <Show when={data()} fallback={
        <text fg={theme.textMuted}>Entry not found</text>
      }>
        <box flexDirection="row" gap={2} paddingBottom={1}>
          <text fg={theme.textMuted}>kind: {data()!.kind}</text>
          <text fg={theme.textMuted}>scope: {data()!.scope}</text>
          <text fg={theme.textMuted}>source: {data()!.source}</text>
        </box>
        <box flexGrow={1} flexShrink={1} paddingLeft={1} paddingRight={1} backgroundColor={theme.backgroundElement}>
          <text wrapMode="word" fg={theme.text}>
            {formatted()}
          </text>
        </box>
        <Show when={isTruncated()}>
          <box flexDirection="row" justifyContent="space-between" paddingTop={1}>
            <Button variant="primary" onMouseUp={props.onToggle}>
              {props.showFull ? "Show less" : "Show all content"}
            </Button>
            <Button variant="secondary" onMouseUp={props.onBack}>
              Back
            </Button>
          </box>
        </Show>
        <Show when={!isTruncated()}>
          <box paddingTop={1}>
            <Button variant="secondary" onMouseUp={props.onBack}>
              Back
            </Button>
          </box>
        </Show>
      </Show>
    </box>
  )
}