// Footer layout
//
// Renders the footer region as a compact vertical stack:
//   1. Single-line composer or active footer body
//   2. Optional autocomplete/menu panels below the composer
//   3. A statusline-style footer row carrying state, hints, and model info
//
// All state comes from the parent RunFooter through SolidJS signals.
// The view itself is stateless except for derived memos.
/** @jsxImportSource @opentui/solid */
import { useTerminalDimensions } from "@opentui/solid"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import "opentui-spinner/solid"
import { createColors, createFrames } from "@opencode-ai/tui/ui/spinner"
import {
  RUN_SUBAGENT_PANEL_ROWS,
  RunCommandMenuBody,
  RunModelSelectBody,
  RunQueuedPromptSelectBody,
  RunSkillSelectBody,
  RunSubagentSelectBody,
  RunVariantSelectBody,
} from "./footer.command"
import { FOOTER_MENU_ROWS, RunFooterMenu } from "./footer.menu"
import { RunFooterSubagentBody } from "./footer.subagent"
import { RunPromptBody, createPromptState } from "./footer.prompt"
import { RunPermissionBody } from "./footer.permission"
import { RunQuestionBody } from "./footer.question"
import { footerWidthPolicy } from "./footer.width"
import {
  OPENCODE_BASE_MODE,
  useBindings,
  useKeymapSelector,
  type OpenTuiKeymap,
} from "@opencode-ai/tui/keymap"
import type {
  FooterPromptRoute,
  FooterQueuedPrompt,
  FooterState,
  FooterSubagentState,
  FooterView,
  PermissionReply,
  QuestionReject,
  QuestionReply,
  RunAgent,
  RunCommand,
  RunDiffStyle,
  RunInput,
  RunPrompt,
  RunProvider,
  RunResource,
  RunTuiConfig,
} from "./types"
import type { RunTheme } from "./theme"
import { modelInfo } from "./variant.shared"

const EMPTY_BORDER = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
}

type RunFooterViewProps = {
  directory: string
  findFiles: (query: string) => Promise<string[]>
  agents: () => RunAgent[]
  resources: () => RunResource[]
  commands: () => RunCommand[] | undefined
  providers: () => RunProvider[] | undefined
  currentModel: () => RunInput["model"]
  variants: () => string[]
  currentVariant: () => string | undefined
  state: () => FooterState
  view?: () => FooterView
  subagent?: () => FooterSubagentState
  queuedPrompts?: () => FooterQueuedPrompt[]
  theme: () => RunTheme
  diffStyle?: RunDiffStyle
  tuiConfig: RunTuiConfig
  backgroundSubagents: boolean
  history?: RunPrompt[]
  agent: string
  onSubmit: (input: RunPrompt) => boolean
  onPermissionReply: (input: PermissionReply) => void | Promise<void>
  onQuestionReply: (input: QuestionReply) => void | Promise<void>
  onQuestionReject: (input: QuestionReject) => void | Promise<void>
  onCycle: () => void
  onInterrupt: () => boolean
  onBackground?: () => void
  onThinkingCollapse?: () => void
  onEditorOpen: (input: { value: string }) => Promise<string | undefined>
  onInputClear: () => void
  onExitRequest?: () => boolean
  onRequestExit?: (fn: (() => boolean) | undefined) => void
  onExit: () => void
  onModelSelect: (model: NonNullable<RunInput["model"]>) => void
  onVariantSelect: (variant: string | undefined) => void
  onRows: (rows: number) => void
  onLayout: (input: { route: FooterPromptRoute; autocomplete: boolean; subagentRows: number }) => void
  onStatus: (text: string) => void
  onSubagentSelect?: (sessionID: string | undefined) => void
  onQueuedRemove: (messageID: string) => Promise<boolean>
}

export { TEXTAREA_MIN_ROWS, TEXTAREA_MAX_ROWS } from "./footer.prompt"

export function RunFooterView(props: RunFooterViewProps) {
  const term = useTerminalDimensions()
  const width = createMemo(() => term().width)
  const responsive = createMemo(() => footerWidthPolicy(width()))
  const active = createMemo<FooterView>(() => props.view?.() ?? { type: "prompt" })
  const subagent = createMemo<FooterSubagentState>(() => {
    return (
      props.subagent?.() ?? {
        tabs: [],
        details: {},
        permissions: [],
        questions: [],
      }
    )
  })
  const [route, setRoute] = createSignal<FooterPromptRoute>({ type: "composer" })
  const [subagentMenuRows, setSubagentMenuRows] = createSignal(RUN_SUBAGENT_PANEL_ROWS)
  const queuedPrompts = createMemo(() => props.queuedPrompts?.() ?? [])
  const skills = createMemo(() => (props.commands() ?? []).filter((item) => item.source === "skill"))
  
  // Consolidated derived state - single memo instead of 20+ individual memos
  const derived = createMemo(() => {
    const currentActive = active()
    const currentRoute = route()
    const currentSubagent = subagent()
    const currentQueuedPrompts = queuedPrompts()
    const currentSkills = skills()
    const currentBackgroundSubagents = props.backgroundSubagents
    const currentProviders = props.providers()
    const currentCurrentModel = props.currentModel()
    const currentState = props.state()
    const currentCommands = props.commands()
    const currentVariants = props.variants()
    const currentCurrentVariant = props.currentVariant()
    const currentTuiConfig = props.tuiConfig
    
    const isPrompt = currentActive.type === "prompt"
    const prompt = isPrompt && currentRoute.type === "composer"
    const selectingSubagent = isPrompt && currentRoute.type === "subagent-menu"
    const selectingQueued = isPrompt && currentRoute.type === "queued-menu"
    const inspecting = isPrompt && currentRoute.type === "subagent"
    const commanding = isPrompt && currentRoute.type === "command"
    const skilling = isPrompt && currentRoute.type === "skill"
    const modeling = isPrompt && currentRoute.type === "model"
    const varianting = isPrompt && currentRoute.type === "variant"
    const panel = 
      currentActive.type === "permission" ||
      currentActive.type === "question" ||
      selectingQueued ||
      selectingSubagent ||
      commanding ||
      skilling ||
      modeling ||
      varianting
    const selected = currentRoute.type === "subagent" ? currentRoute.sessionID : undefined
    const tabs = currentSubagent.tabs
    const activeTabs = tabs.filter((item) => item.status === "running")
    const selectedTab = tabs.find((item) => item.sessionID === selected)
    const selectedIndex = selected
      ? tabs.findIndex((item) => item.sessionID === selected) + 1
      : 0
    const foregroundSubagents = currentBackgroundSubagents && activeTabs.some((item) => !item.background)
    const model = currentCurrentModel
      ? modelInfo(currentProviders, currentCurrentModel)
      : { model: currentState.model, provider: undefined }
    const detail = currentRoute.type === "subagent" ? currentSubagent.details[currentRoute.sessionID] : undefined
    
    const leaderKey = currentTuiConfig.keybinds.get("leader")?.[0]?.key ?? "ctrl+x"
    const resolveKey = (key: string) => key.replace(/<leader>/gi, leaderKey + " ")
    const formatKey = (name: string) => {
      const entry = currentTuiConfig.keybinds.get(name)?.[0]
      return entry?.key ? resolveKey(String(entry.key)) : ""
    }
    
    const keymaps = {
      command: formatKey("command.palette.show"),
      subagent: formatKey("session.child.first"),
      queued: formatKey("session.queued_prompts"),
      background: formatKey("session.background"),
      interrupt: formatKey("session.interrupt"),
      variantCycle: formatKey("variant.cycle"),
      clearShortcut: formatKey("prompt.clear"),
    }
    
    const state = currentState
    const busy = state.phase === "running"
    const armed = state.interrupt > 0
    const exiting = state.exit > 0
    const queue = state.queue
    const usage = state.usage
    
    const runTheme = props.theme()
    const themeData = {
      footer: runTheme.footer,
      block: runTheme.block,
      highlight: runTheme.footer.highlight,
      surface: runTheme.footer.surface,
      status: runTheme.footer.status,
      statusAccent: runTheme.footer.statusAccent,
      error: runTheme.footer.error,
      warning: runTheme.footer.warning,
      text: runTheme.footer.text,
      muted: runTheme.footer.muted,
    }
    
    const permissionView = currentActive.type === "permission" ? currentActive : undefined
    const questionView = currentActive.type === "question" ? currentActive : undefined
    const promptView = isPrompt ? (currentRoute.type === "composer" ? "prompt" : currentRoute.type) : currentActive.type
    
    return {
      // View state
      prompt,
      selectingSubagent,
      selectingQueued,
      inspecting,
      commanding,
      skilling,
      modeling,
      varianting,
      panel,
      selected,
      tabs,
      activeTabs,
      selectedTab,
      selectedIndex,
      foregroundSubagents,
      model,
      detail,
      // Keymaps
      keymaps,
      // State
      busy,
      armed,
      exiting,
      queue,
      usage,
      interruptLabel: keymaps.interrupt ? (keymaps.interrupt === "escape" ? "esc" : keymaps.interrupt) : undefined,
      // Theme
      theme: themeData.footer,
      block: themeData.block,
      spin: {
        frames: createFrames({ color: themeData.highlight, style: "blocks", inactiveFactor: 0.6, minAlpha: 0.3 }),
        color: createColors({ color: themeData.highlight, style: "blocks", inactiveFactor: 0.6, minAlpha: 0.3 }),
      },
      permission: permissionView,
      question: questionView,
      promptView,
    }
  })
  
  // Accessor functions - zero overhead, just delegate to derived memo
  const prompt = () => derived().prompt
  const selectingSubagent = () => derived().selectingSubagent
  const selectingQueued = () => derived().selectingQueued
  const inspecting = () => derived().inspecting
  const commanding = () => derived().commanding
  const skilling = () => derived().skilling
  const modeling = () => derived().modeling
  const varianting = () => derived().varianting
  const panel = () => derived().panel
  const selected = () => derived().selected
  const tabs = () => derived().tabs
  const activeTabs = () => derived().activeTabs
  const selectedTab = () => derived().selectedTab
  const selectedIndex = () => derived().selectedIndex
  const foregroundSubagents = () => derived().foregroundSubagents
  const model = () => derived().model
  const detail = () => derived().detail
  
  const keymaps = () => derived().keymaps
  const busy = () => derived().busy
  const armed = () => derived().armed
  const exiting = () => derived().exiting
  const queue = () => derived().queue
  const usage = () => derived().usage
  const interruptLabel = () => derived().interruptLabel
  const theme = () => derived().theme
  const block = () => derived().block
  const spin = () => derived().spin
  const permission = () => derived().permission
  const question = () => derived().question
  const promptView = () => derived().promptView

  const openCommand = () => {
    setRoute({ type: "command" })
    props.onSubagentSelect?.(undefined)
  }

  const openModel = () => {
    setRoute({ type: "model" })
    props.onSubagentSelect?.(undefined)
  }

  const openSkillMenu = () => {
    if (props.commands() && skills().length === 0) {
      return
    }

    setRoute({ type: "skill" })
    props.onSubagentSelect?.(undefined)
  }

  const openVariant = () => {
    setRoute({ type: "variant" })
    props.onSubagentSelect?.(undefined)
  }

  const openSubagentMenu = () => {
    if (tabs().length === 0) {
      return
    }

    setRoute({ type: "subagent-menu" })
    props.onSubagentSelect?.(undefined)
  }

  const openQueuedMenu = () => {
    if (queuedPrompts().length === 0) return
    setRoute({ type: "queued-menu" })
    props.onSubagentSelect?.(undefined)
  }

  const closePanel = () => {
    setRoute({ type: "composer" })
  }

  const openTab = (sessionID: string) => {
    setRoute({ type: "subagent", sessionID })
    props.onSubagentSelect?.(sessionID)
  }

  const closeTab = () => {
    setRoute({ type: "composer" })
    props.onSubagentSelect?.(undefined)
  }

  const cycleTab = (dir: -1 | 1) => {
    if (tabs().length === 0) {
      return
    }

    const routeState = route()
    const current =
      routeState.type === "subagent" ? tabs().findIndex((item) => item.sessionID === routeState.sessionID) : -1
    const index = current === -1 ? 0 : (current + dir + tabs().length) % tabs().length
    const next = tabs()[index]
    if (!next) {
      return
    }

    openTab(next.sessionID)
  }
  const composer = createPromptState({
    directory: props.directory,
    findFiles: props.findFiles,
    agents: props.agents,
    resources: props.resources,
    commands: props.commands,
    tuiConfig: props.tuiConfig,
    state: props.state,
    view: promptView,
    prompt: prompt,
    width,
    theme,
    history: props.history,
    onSubmit: props.onSubmit,
    onCycle: props.onCycle,
    onInterrupt: props.onInterrupt,
    onEditorOpen: props.onEditorOpen,
    onInputClear: props.onInputClear,
    onExitRequest: props.onExitRequest,
    onExit: props.onExit,
    onSkillMenu: openSkillMenu,
    onRows: props.onRows,
    onStatus: props.onStatus,
  })
const menu = composer.visible
const statusLineData = createMemo(() => {
    const d = derived()
    const state = props.state()
    const currentModel = props.currentModel()
    const currentVariant = props.currentVariant()
    const currentProviders = props.providers()
    const currentCommands = props.commands()
    const currentBackgroundSubagents = props.backgroundSubagents
    const currentResponsive = responsive()
    const currentPrompt = d.prompt
    const currentBusy = d.busy
    const currentArmed = d.armed
    const currentExiting = d.exiting
    const currentUsage = d.usage
    const currentKeymaps = d.keymaps
    const currentTheme = d.theme
    const currentActiveTabs = d.activeTabs
    const currentQueuedPrompts = queuedPrompts()
    const stateStatus = state.status.trim()
    const modeLabel = currentExiting ? "EXIT" : ""
    const modeColor = currentExiting ? currentTheme.error : currentTheme.highlight
    const statusText = currentExiting ? `Press ${currentKeymaps.clearShortcut || "ctrl+c"} again to exit` : 
      currentBusy ? (currentArmed ? "again to interrupt" : "interrupt") : 
      stateStatus.length > 0 ? stateStatus : ""
    const activityMeta = currentResponsive.statusline.showActivityMeta && currentUsage.length > 0 ? currentUsage : ""
    const modelStatus = currentPrompt && currentModel ? {
      model: d.model.model,
      variant: currentVariant,
      provider: undefined,
    } : undefined
    const statusColor = currentExiting ? currentTheme.error : 
      currentArmed ? currentTheme.highlight : 
      currentBusy || stateStatus.length > 0 ? currentTheme.text : currentTheme.muted
    const statuslineBackground = currentTheme.status
    const hasActivityMeta = activityMeta.length > 0
    const hasModelStatus = currentResponsive.statusline.showModel && Boolean(modelStatus)
    const contextHints = currentPrompt && currentResponsive.statusline.showContextHints ? 
      (() => {
        const items: Array<{ kind: string; key: string; label: string }> = []
        if (currentBackgroundSubagents && currentActiveTabs.length > 0 && currentKeymaps.background) {
          items.push({ kind: "background", key: currentKeymaps.background, label: "background" })
        }
        if (currentQueuedPrompts.length > 0 && currentKeymaps.queued) {
          items.push({ kind: "queued", key: currentKeymaps.queued, label: `${state.queue} queued` })
        }
        if (currentActiveTabs.length > 0 && currentKeymaps.subagent) {
          items.push({ kind: "subagents", key: currentKeymaps.subagent, label: "subagents" })
        }
        const limit = currentResponsive.statusline.contextHintLimit
        return limit === undefined ? items : items.slice(0, limit)
      })() : []
    const hasContextHints = contextHints.length > 0
    const commandHint = currentPrompt && currentResponsive.statusline.showCommandHint ? 
      d.keymaps.command ? { key: d.keymaps.command, label: "cmd" } : undefined : undefined
    
    return {
      menu,
      stateStatus,
      modeLabel,
      modeColor,
      statusText,
      activityMeta,
      modelStatus,
      statusColor,
      statuslineBackground,
      hasActivityMeta,
      hasModelStatus,
      contextHints,
      hasContextHints,
      commandHint,
    }
  })
  const sectionSeparator = () => <span style={{ fg: theme().muted }}>· </span>

  // Consolidated effects - single effect instead of 6 separate ones
  createEffect(() => {
    // Effect 1: Request exit callback
    console.log('render', Date.now())
    props.onRequestExit?.(composer.requestExit)
    
    // Effect 2: Auto-close subagent tab when session ends
    const currentRoute = route()
    if (currentRoute.type === "subagent" && !tabs().some((item) => item.sessionID === currentRoute.sessionID)) {
      closeTab()
    }
    
    // Effect 3: Auto-close subagent menu when no tabs
    if (currentRoute.type === "subagent-menu" && tabs().length === 0) {
      closePanel()
    }
    
    // Effect 4: Auto-close queued menu when empty
    if (currentRoute.type === "queued-menu" && queuedPrompts().length === 0) {
      closePanel()
    }
    
    // Effect 5: Auto-close panel when active view changes from prompt
    if (active().type !== "prompt") {
      const routeType = currentRoute.type
      if (["command", "skill", "model", "variant", "queued-menu", "subagent-menu"].includes(routeType)) {
        closePanel()
      }
    }
    
    // Effect 6: Layout callback
    props.onLayout({
      route: currentRoute,
      autocomplete: menu(),
      subagentRows: subagentMenuRows(),
    })
  })

  onCleanup(() => {
    props.onRequestExit?.(undefined)
  })

  // ponytail: auto-open model selector when providers arrive and no model is configured
  {
    let autoOpened = false
    createEffect(() => {
      if (autoOpened) return
      const providers = props.providers()
      const current = props.currentModel()
      if (providers?.length && !current && route().type === "composer") {
        autoOpened = true
        openModel()
      }
    })
  }

  const bindings = useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    enabled: active().type === "prompt" && route().type === "composer" && !composer.visible(),
    commands: [
      {
        name: "command.palette.show",
        title: "Open command palette",
        category: "Prompt",
        run: openCommand,
      },
      {
        name: "variant.cycle",
        title: "Cycle model variant",
        category: "Model",
        run: props.onCycle,
      },
      {
        name: "session.background",
        title: "Background subagents",
        category: "Session",
        run: () => props.onBackground?.(),
      },
      {
        name: "session.child.first",
        title: "View subagents",
        category: "Session",
        run: openSubagentMenu,
      },
      {
        name: "session.queued_prompts",
        title: "Manage queued prompts",
        category: "Session",
        run: openQueuedMenu,
      },
      {
        name: "session.toggle.thinking",
        title: "Toggle reasoning collapse",
        category: "Session",
        run: () => props.onThinkingCollapse?.(),
      },
    ],
    bindings: [
      ...props.tuiConfig.keybinds.get("command.palette.show"),
      ...props.tuiConfig.keybinds.get("variant.cycle"),
      ...props.tuiConfig.keybinds.get("session.background"),
      ...props.tuiConfig.keybinds.get("session.child.first"),
      ...props.tuiConfig.keybinds.get("session.queued_prompts"),
      ...props.tuiConfig.keybinds.get("session.toggle.thinking"),
    ],
  }))

  return (
    <box
      width="100%"
      height="100%"
      border={false}
      backgroundColor="transparent"
      flexDirection="column"
      gap={0}
      padding={0}
    >
      <Show when={panel() || inspecting()}>
        <box width="100%" height={1} flexShrink={0} backgroundColor="transparent" />
      </Show>

      <Show
        when={inspecting()}
        fallback={
          <box width="100%" flexDirection="column" gap={0}>
            <For each={[promptView()]}>
              {() => (
                <box
                  width="100%"
                  flexShrink={0}
                  border={panel() || prompt() ? false : ["left"]}
                  borderColor={panel() || prompt() ? undefined : theme().highlight}
                  customBorderChars={
                    panel() || prompt()
                      ? undefined
                      : {
                          ...EMPTY_BORDER,
                          vertical: "█",
                        }
                  }
                >
                  <box
                    width="100%"
                    flexGrow={1}
                    paddingLeft={0}
                    paddingRight={0}
                    paddingTop={0}
                    flexDirection="column"
                    backgroundColor={panel() || prompt() ? "transparent" : theme().surface}
                    gap={0}
                  >
                    <box width="100%" flexGrow={1} flexShrink={1} flexDirection="column">
                      <Switch>
                        <Match when={active().type === "prompt" && route().type === "composer"}>
                          <RunPromptBody
                            theme={theme}
                            background={() => props.theme().background}
                            placeholder={composer.placeholder}
                            onSubmit={composer.onSubmit}
                            onKeyDown={composer.onKeyDown}
                            onContentChange={composer.onContentChange}
                            bind={composer.bind}
                          />
                        </Match>
                        <Match when={selectingSubagent()}>
                          <RunSubagentSelectBody
                            theme={theme}
                            tabs={tabs}
                            current={selected}
                            onClose={closePanel}
                            onSelect={openTab}
                            onRows={setSubagentMenuRows}
                          />
                        </Match>
                        <Match when={selectingQueued()}>
                          <RunQueuedPromptSelectBody
                            theme={theme}
                            prompts={queuedPrompts}
                            onClose={closePanel}
                            onDelete={(item) => void props.onQueuedRemove(item.messageID)}
                            onEdit={async (item) => {
                              if (!(await props.onQueuedRemove(item.messageID))) return
                              closePanel()
                              queueMicrotask(() => composer.replacePrompt(item.prompt))
                            }}
                            onRows={setSubagentMenuRows}
                          />
                        </Match>
                        <Match when={commanding()}>
                          <RunCommandMenuBody
                            theme={theme}
                            commands={props.commands}
                            subagents={tabs}
                            queued={queuedPrompts}
                            variants={props.variants}
                            variantCycle={keymaps().variantCycle}
                            onClose={closePanel}
                            onModel={openModel}
                            onEditor={() => {
                              closePanel()
                              void composer.openEditor()
                            }}
                            onSkill={openSkillMenu}
                            onSubagent={openSubagentMenu}
                            onQueued={openQueuedMenu}
                            onVariant={openVariant}
                            onVariantCycle={() => {
                              props.onCycle()
                              closePanel()
                            }}
                            onCommand={(name) => {
                              composer.submitText(`/${name}`)
                              closePanel()
                            }}
                            onNew={() => {
                              composer.submitText("/new")
                              closePanel()
                            }}
                            onExit={props.onExit}
                          />
                        </Match>
                        <Match when={skilling()}>
                          <RunSkillSelectBody
                            theme={theme}
                            commands={props.commands}
                            onClose={closePanel}
                            onSelect={(name) => {
                              composer.replacePrompt({
                                text: `/${name} `,
                                parts: [],
                                command: {
                                  name,
                                  arguments: "",
                                },
                              })
                              closePanel()
                            }}
                          />
                        </Match>
                        <Match when={modeling()}>
                          <RunModelSelectBody
                            theme={theme}
                            providers={props.providers}
                            current={props.currentModel}
                            onClose={closePanel}
                            onSelect={(model) => {
                              props.onModelSelect(model)
                              closePanel()
                            }}
                          />
                          </Match>
                        <Match when={varianting()}>
                          <RunVariantSelectBody
                            theme={theme}
                            variants={props.variants}
                            current={props.currentVariant}
                            onClose={closePanel}
                            onSelect={(variant) => {
                              props.onVariantSelect(variant)
                              closePanel()
                            }}
                          />
                        </Match>
                        <Match when={active().type === "permission"}>
                          <RunPermissionBody
                            request={permission()!.request}
                            theme={theme()}
                            block={block()}
                            diffStyle={props.diffStyle}
                            onReply={props.onPermissionReply}
                          />
                        </Match>
                        <Match when={active().type === "question"}>
                          <RunQuestionBody
                            request={question()!.request}
                            theme={theme()}
                            onReply={props.onQuestionReply}
                            onReject={props.onQuestionReject}
                          />
                        </Match>
                      </Switch>
                    </box>
                  </box>
                </box>
              )}
            </For>

            <Show when={!panel() && menu()}>
              <RunFooterMenu
                theme={theme}
                items={composer.options}
                selected={composer.selected}
                offset={composer.offset}
                rows={composer.rows}
                limit={FOOTER_MENU_ROWS}
                border={false}
                paddingLeft={0}
              />
            </Show>

            <Show when={!panel() && !menu()}>
              <box
                width="100%"
                height={1}
                flexDirection="row"
                gap={0}
                flexShrink={0}
                backgroundColor={statusLineData().statuslineBackground}
              >
                <Show when={statusLineData().modeLabel}>
                  <box paddingLeft={1} paddingRight={1} backgroundColor={theme().statusAccent} flexShrink={0}>
                    <text wrapMode="none" truncate>
                      <span style={{ fg: statusLineData().modeColor, bold: true }}>{statusLineData().modeLabel}</span>
                    </text>
                  </box>
                </Show>

                <box
                  flexDirection="row"
                  gap={1}
                  flexGrow={1}
                  flexShrink={1}
                  minWidth={12}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor="transparent"
                >
                  <Show when={busy() && !exiting()}>
                    <box flexShrink={0}>
                      <spinner color={spin().color} frames={spin().frames} interval={40} />
                    </box>
                  </Show>

                  <text fg={statusLineData().statusColor} wrapMode="none" truncate flexGrow={1} flexShrink={1}>
                    <Show when={busy() && !exiting()} fallback={statusLineData().statusText}>
                      <Show when={interruptLabel()}>
                        {(label) => <span style={{ fg: armed() ? statusLineData().statusColor : theme().muted }}>{label()} </span>}
                      </Show>
                      {statusLineData().statusText}
                    </Show>
                  </text>
                </box>

                <Show when={statusLineData().activityMeta.length > 0}>
                  <box paddingRight={1} backgroundColor="transparent" flexShrink={1}>
                    <text fg={theme().muted} wrapMode="none" truncate>
                      {statusLineData().activityMeta}
                    </text>
                  </box>
                </Show>

                <Show when={responsive().statusline.showModel && statusLineData().modelStatus}>
                  {(info) => (
                    <box paddingRight={1} backgroundColor="transparent" flexShrink={0}>
                      <text fg={theme().text} wrapMode="none">
                        {info().model}
                        <Show when={info().provider}>
                          {(provider) => <span style={{ fg: theme().muted }}> {provider()}</span>}
                        </Show>
                        <Show when={info().variant}>
                          {(variant) => (
                            <>
                              <span style={{ fg: theme().warning, bold: true }}> {variant()}</span>
                            </>
                          )}
                        </Show>
                      </text>
                    </box>
                  )}
                </Show>

                <For each={statusLineData().contextHints}>
                  {(hint, index) => (
                    <box paddingRight={1} backgroundColor="transparent" flexShrink={0} maxWidth={24}>
                      <text fg={theme().text} wrapMode="none" truncate>
                        <Show when={index() > 0 || ((statusLineData().hasActivityMeta || statusLineData().hasModelStatus) && index() === 0)}>
                          {sectionSeparator()}
                        </Show>
                        <span style={{ fg: theme().text }}>{hint.key}</span>{" "}
                        <span style={{ fg: theme().muted }}>{hint.label}</span>
                      </text>
                    </box>
                  )}
                </For>

                <Show when={statusLineData().commandHint}>
                  {(hint) => (
                    <box paddingRight={1} backgroundColor="transparent" flexShrink={0} maxWidth={18}>
                      <text fg={theme().text} wrapMode="none" truncate>
                        <Show when={statusLineData().hasActivityMeta || statusLineData().hasModelStatus || statusLineData().hasContextHints}>
                          {sectionSeparator()}
                        </Show>
                        <span style={{ fg: theme().text }}>{hint().key}</span>{" "}
                        <span style={{ fg: theme().muted }}>{hint().label}</span>
                      </text>
                    </box>
                  )}
                </Show>
              </box>
            </Show>
          </box>
        }
      >
        <box
          width="100%"
          flexGrow={1}
          flexShrink={1}
          border={["left"]}
          borderColor={theme().highlight}
          customBorderChars={{
            ...EMPTY_BORDER,
            vertical: "┃",
          }}
        >
          <RunFooterSubagentBody
            active={inspecting}
            theme={() => props.theme()}
            tab={selectedTab}
            index={selectedIndex}
            total={() => tabs().length}
            detail={detail}
            width={width}
            diffStyle={props.diffStyle}
            onCycle={cycleTab}
            onClose={closeTab}
          />
        </box>
      </Show>
    </box>
  )
}
