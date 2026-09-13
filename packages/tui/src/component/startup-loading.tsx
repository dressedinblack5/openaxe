import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { Spinner } from "./spinner"

export function StartupLoading(props: { ready: () => boolean }) {
  const theme = useTheme().theme
  const [show, setShow] = createSignal(true)
  const text = createMemo(() => (props.ready() ? "Finishing startup..." : "Whetting the axe..."))
  let hold: NodeJS.Timeout | undefined
  let stamp = Date.now()

  createEffect(() => {
    if (props.ready()) {
      if (!show()) return
      if (hold) return

      const left = 250 - (Date.now() - stamp)
      if (left <= 0) {
        setShow(false)
        return
      }

      hold = setTimeout(() => {
        hold = undefined
        setShow(false)
      }, left).unref()
      return
    }

    if (hold) {
      clearTimeout(hold)
      hold = undefined
    }
    if (!show()) {
      stamp = Date.now()
      setShow(true)
    }
  })

  onCleanup(() => {
    if (hold) clearTimeout(hold)
  })

  return (
    <Show when={show()}>
      <box position="absolute" zIndex={5000} left={0} right={0} bottom={1} justifyContent="center" alignItems="center">
        <box backgroundColor={theme.backgroundPanel} paddingLeft={1} paddingRight={1}>
          <Spinner color={theme.textMuted}>{text()}</Spinner>
        </box>
      </box>
    </Show>
  )
}
