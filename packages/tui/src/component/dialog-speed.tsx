import { createMemo } from "solid-js"
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { DialogVariant } from "./dialog-variant"

export function DialogSpeed() {
  const local = useLocal()
  const dialog = useDialog()

  function chainVariant() {
    const list = local.model.variant.list()
    const cur = local.model.variant.selected()
    if (cur === "default" || (cur && list.includes(cur))) {
      dialog.clear()
      return
    }
    if (list.length > 0) {
      dialog.replace(() => <DialogVariant />)
      return
    }
    dialog.clear()
  }

  const options = createMemo(() => {
    return [
      {
        value: "default",
        title: "Default/Normal",
        onSelect: () => {
          local.model.speed.set(undefined)
          chainVariant()
        },
      },
      ...local.model.speed.list().map((speed) => ({
        value: speed.id,
        title: speed.label ?? speed.id,
        onSelect: () => {
          local.model.speed.set(speed.id)
          chainVariant()
        },
      })),
    ]
  })

  return <DialogSelect<string> options={options()} title={"Speed"} current={local.model.speed.selected()} flat={true} />
}
