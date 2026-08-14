---
name: win-vm-testing
description: >-
  Test openaxe Windows builds on the scriptOS VirtualBox guest: rebuild, verify,
  remote-control, screenshot. Use when asked to check/test/debug the openaxe.exe
  Windows binary, run the Windows VM, or verify VM behavior.
---
# Windows VM Testing (scriptOS)

Test the openaxe Windows binary on the scriptOS VirtualBox guest.

## VM facts

- Name: `scriptOS`, UUID `88021bb1-356e-4a79-877b-d701fcac5975`
- Windows 10 x64, NAT only (guest IP 10.0.2.15), user `user` (blank password, signed in)
- Lives on `dev`, host bin dir is shared into the guest as `\\VBoxSvr\openaxe (Y:)`

## The 4-step loop

### 1. Build the Windows binary

```bash
cd packages/openaxe
TARGETS=windows-x64 bun run build
```

Output lands in `packages/openaxe/dist/openaxe-windows-x64/bin/`:
`openaxe.exe` + `opentui.dll` + `tiktoken_bg.wasm`. The shared folder maps
directly to this dir, so the guest **automatically** sees new files — no
reconfiguration needed. (Any other `dist/openaxe-windows-*` subdirs left from
older builds are stale; `rm -rf dist/openaxe-windows-*` before crossing.)

### 2. Ensure the VM is running

```bash
VBoxManage list runningvms          # empty → VM is stopped
VBoxManage startvm scriptOS --type gui
```

The VM tends to be stopped between sessions. Boot to a login takes a while;
while waiting, read the release notes.

### 3. See the guest

```bash
VBoxManage controlvm scriptOS screenshotpng /tmp/vm.png
```

then `look_at` the PNG. The guest Explorer **caches** the shared folder
listing — after a rebuild, press F5 in the guest (scancode `3F BF`) and
re-screenshot before believing what you see. A 141 MB `openaxe.exe` is the
fresh build; 138 KB is the old one. Match the file Date column to the build.

### 4. Interact (keyboard injection — last resort)

Guest Access is locked down: `guestcontrol` fails (blank-password logon
blocked by Windows Remote UAC), no sshd, no RDP. The working path is
injected PS/2 scancodes + screenshots:

```bash
VBoxManage controlvm scriptOS keyboardputscancode 1C 9C   # Enter
```

Helper: `/tmp/keyslow.sh "<string>"` types A–Z, a–z, 0–9, space, `.`, `/`,
`-`, `_`, `=` with a 0.15 s delay (reliable). It only knows lowercase-letters
via Shift, no symbols like `@` or `:` — type those as separate scancodes.

Flakiness: keystrokes get dropped or eaten by windows with keyboard focus.
Always confirm the resulting screen with a screenshot before proceeding.

Common scancodes (make, then break = make+0x80):
Escape `01 81`, Enter `1C 9C`, Ctrl+C `1D 9D`, Alt+F4 `38 B8 3E BE 38 B8`,
LeftWin `E0 5B E0 DB`, F5 (refresh Explorer) `3F BF`, arrows
Up `48 C8`, Left `4B CB`, Down `50 D0`, Right `4D CD`; Tab `0F 8F`,
Backspace `0E 8E`.

## Gotchas

- `modifyvm` fails on a running VM ("already locked"); use `controlvm` for
  runtime changes (e.g. `controlvm scriptOS natpf1 "ssh,tcp,,2222,,22"`).
- Never `modifyvm clipboard bidirectional` while the VM is running — it dies
  with a lock error. Stop the VM first if the change requires `modifyvm`.
- The shared machine folder (`openaxe` → host
  `dist/openaxe-windows-x64/bin`) is the only channel in/out of the guest.
