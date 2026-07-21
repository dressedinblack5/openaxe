import { createMemo } from "solid-js"
import { useLocal } from "../context/local"
import { useSDK } from "../context/sdk"
import { DialogSelect } from "../ui/dialog-select"
import { DialogModel } from "./dialog-model"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"

export function DialogConfigureAgent() {
  const local = useLocal()
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()

  const options = createMemo(() =>
    local.agent.list().map((item) => ({
      value: item.name,
      title: item.name,
      description: item.description,
    })),
  )

  function onAgentSelect(option: { value: string }) {
    const agentName = option.value
    dialog.replace(() => (
      <DialogModel
        onModelSelect={(providerID, modelID) => {
          const model = `${providerID}/${modelID}`
          void sdk.client.config.update({ config: { agent: { [agentName]: { model } } } }).then((result) => {
            if (result.error) {
              toast.show({
                variant: "error",
                message: "Failed to save agent model",
                duration: 5000,
              })
            } else {
              toast.show({
                variant: "info",
                message: `Agent ${agentName} model set to ${model}`,
                duration: 3000,
              })
            }
          })
          dialog.clear()
        }}
      />
    ))
  }

  return (
    <DialogSelect
      title="Select agent to configure"
      options={options()}
      onSelect={onAgentSelect}
    />
  )
}
