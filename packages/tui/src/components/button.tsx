import { type ComponentProps, Show, splitProps } from "solid-js"

export interface ButtonProps
  extends ComponentProps<"box">,
    Pick<ComponentProps<"button">, "children"> {
  variant?: "primary" | "secondary" | "ghost"
  size?: "small" | "normal" | "large"
}

export function Button(props: ButtonProps) {
  const [split, rest] = splitProps(props, ["variant", "size"])
  
  // Default variants
  const variantMap = {
    primary: { backgroundColor: "theme.primary", fg: "theme.selectedListItemText" },
    secondary: { backgroundColor: "theme.backgroundElement", fg: "theme.text" },
    ghost: { backgroundColor: "transparent", fg: "theme.text" }
  }
  
  const sizeMap = {
    small: { paddingLeft: 2, paddingRight: 2 },
    normal: { paddingLeft: 3, paddingRight: 3 },
    large: { paddingLeft: 4, paddingRight: 4 }
  }
  
  const variantStyle = variantMap[split.variant ?? "secondary"]
  const sizeStyle = sizeMap[split.size ?? "normal"]
  
  return (
    <box
      {...rest}
      backgroundColor={variantStyle.backgroundColor}
      {...sizeStyle}
    >
      <text fg={variantStyle.fg}>{props.children}</text>
    </box>
  )
}
