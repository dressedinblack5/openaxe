import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../config"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"
import { usePluginRuntime } from "../../plugin/runtime"
import { isFocused } from "../../context/focus"

import { getScrollAcceleration } from "../../util/scroll"
import { WorkspaceLabel } from "../../component/workspace-label"

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const pluginRuntime = usePluginRuntime()
  const project = useProject()
  const sync = useSync()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const workspace = () => {
    const workspaceID = session()?.workspaceID
    if (!workspaceID) return undefined
    return project.workspace.get(workspaceID)
  }
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))

return (
          <Show when={session()}>
            {(current) => {
              const s = current()
              const workspaceID = s.workspaceID
              const shareURL = s.share?.url
              const sidebarFocused = isFocused("sidebar")
              return (
                <box
                  backgroundColor={theme.backgroundPanel}
                  width={42}
                  height="100%"
                  paddingTop={1}
                  paddingBottom={1}
                  paddingLeft={2}
                  paddingRight={2}
                  position={props.overlay ? "absolute" : "relative"}
                  border={sidebarFocused() ? ["right"] : []}
                  borderColor={sidebarFocused() ? theme.primary : undefined}
                >
            <scrollbox
              flexGrow={1}
              scrollAcceleration={scrollAcceleration()}
              verticalScrollbarOptions={{
                trackOptions: {
                  backgroundColor: theme.background,
                  foregroundColor: theme.borderActive,
                },
              }}
            >
              <box flexShrink={0} gap={1} paddingRight={1}>
                <pluginRuntime.Slot
                  name="sidebar_title"
                  mode="single_winner"
                  session_id={props.sessionID}
                  title={s.title}
                  share_url={shareURL}
                >
                  <box paddingRight={1}>
                    <text fg={theme.text}>
                      <b>{s.title}</b>
                    </text>
                    <Show when={InstallationChannel !== "latest"}>
                      <text fg={theme.textMuted}>{props.sessionID}</text>
                    </Show>
                    {workspaceID && (
                      <text fg={theme.textMuted}>
                        <Show
                          when={workspace()}
                          fallback={<WorkspaceLabel type="unknown" name={workspaceID} status="error" icon />}
                        >
                          {(item) => (
                            <WorkspaceLabel
                              type={item().type}
                              name={item().name}
                              status={project.workspace.status(item().id) ?? "error"}
                              icon
                            />
                          )}
                        </Show>
                      </text>
                    )}
                    {shareURL && (
                      <text fg={theme.textMuted}>{shareURL}</text>
                    )}
                  </box>
                </pluginRuntime.Slot>
                <pluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />
              </box>
            </scrollbox>

            <box flexShrink={0} gap={1} paddingTop={1}>
              <pluginRuntime.Slot name="sidebar_footer" mode="single_winner" session_id={props.sessionID}>
                <text fg={theme.textMuted}>
                  <span style={{ fg: theme.success }}>•</span> <b>Open</b>
                  <span style={{ fg: theme.text }}>
                    <b>Axe</b>
                  </span>{" "}
                  <span>{InstallationVersion}</span>
                </text>
              </pluginRuntime.Slot>
            </box>
          </box>
        )
      }}
    </Show>
  )
}
