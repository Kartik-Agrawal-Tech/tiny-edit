# tiny-edit VS Code Extension

**Zero-click AI code patching.** Ask Cursor to make a change — it writes `patch.tw1` — the extension auto-applies it and shows token savings in the status bar.

## How it works

1. **On workspace open** — extension silently injects the TW1 system prompt + file index into `.cursorrules`. Your Cursor AI now knows the protocol.
2. **You chat with Cursor** — AI writes changes as `patch.tw1` in the workspace root instead of rewriting whole files.
3. **Extension detects `patch.tw1`** — applies it atomically, deletes the file.
4. **Status bar updates** — `📉 TW1 93% 56.6k saved`

No commands to run. No copy-paste. No manual steps.

## Requirements

- [tiny-edit](https://www.npmjs.com/package/tiny-edit) must be installed: `npm install -g tiny-edit`
- Node.js 18+
- [Cursor](https://cursor.sh) (or any editor that reads `.cursorrules`)

## Commands

Two optional commands in the Command Palette:

| Command | Action |
|---|---|
| `tiny-edit: Show Token Savings` | Display cumulative savings dashboard |
| `tiny-edit: Refresh File Index` | Re-index repo and update `.cursorrules` |

## Status bar

`$(arrow-down) TW1  93%  56.6k saved` — click to show savings dashboard.

## Error handling

- If apply fails: notification shows the `E_*` error code + detail. `patch.tw1` is NOT deleted so you can inspect it.
- If tiny-edit not installed: one-time warning with install instructions.

## Token efficiency

| Scenario | Full file | **tiny-edit** |
|---|---|---|
| 1-line fix in 200-LOC file | ~1 400 tokens | **~25 tokens** |
| Replace 1 function (15 LOC) in 500-LOC file | ~3 500 tokens | **~95 tokens** |

## Local build

```bash
cd vscode-extension
npm install
node esbuild.mjs          # build → out/extension.js
npm run package           # produce tiny-edit-x.y.z.vsix
code --install-extension tiny-edit-0.1.0.vsix
```
