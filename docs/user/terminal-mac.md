# Mac panel (custom build)

The **Mac** surface (shortcut V in the add-surface menu) shows a live, clickable view of a
[terminal-mac](https://github.com/govijr/terminal-mac) virtual Mac running on this machine.
Click the view to control it; keys go to the guest while it has focus.

- Needs `~/.local/bin/terminal-mac` and a VM named `default` (`terminal-mac setup`).
- Inside the guest, `TerminalMacGuest.app` must run with Screen Recording and Accessibility.
- Agents drive the same VM through `terminal-mac mcp`.
