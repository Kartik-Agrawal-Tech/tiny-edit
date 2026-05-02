# patchframe

**85–98% fewer output tokens when LLMs edit your code.**

Instead of rewriting an entire 500-line file to fix one function, patchframe teaches any LLM to emit a 25-token diff frame. A local CLI validates anchors, applies the patch atomically, and rolls back on failure.

```
# Without patchframe: LLM rewrites 500 lines (~3500 tokens)
# With patchframe: LLM emits 25 tokens
TW1
R a @42/9c1f0d..@44/2b8e11
```
def total(xs):
    return sum(x.amount for x in xs if x.active)
```
```

---

## How it works

1. **Index** — patchframe scans your repo and builds a compact file manifest (`id|path|sha8|loc`).
2. **Inject** — paste the manifest + system prompt into your LLM session once (prompt-cached).
3. **Edit** — ask the LLM for changes. It responds with a `TW1` frame instead of a full file.
4. **Apply** — `patchframe apply patch.tw1` validates anchors (sha6 fingerprints), applies bottom-up, runs rollback on any failure.

```
┌────────┐  TW1 frame (25 tokens)  ┌─────────────────┐  atomic write  ┌──────────┐
│  LLM   │ ──────────────────────▶ │  patchframe CLI  │ ─────────────▶ │  repo    │
└────────┘                         │  parse+apply    │                └──────────┘
    ▲                              └─────────────────┘
    │ file index (cached, ~50 tokens)       │
    └───────────────────────────────────────┘
```

---

## Token efficiency

| Scenario | Full file | Unified diff | **patchframe** |
|---|---|---|---|
| 1-line fix in 200-LOC file | ~1 400 tokens | ~120 tokens | **~25 tokens** |
| Replace 1 function (15 LOC) in 500-LOC file | ~3 500 tokens | ~180 tokens | **~95 tokens** |
| 3-file refactor, ~50 LOC changed | ~10 000 tokens | ~600 tokens | **~340 tokens** |

*Measured on cl100k tokenizer (Claude/GPT family). Input-side index is prompt-cached, cost ~zero after first turn.*

---

## Install

```bash
npm install -g patchframe
# or run without installing:
npx patchframe
```

**Requirements:** Node.js 18+

**Develop from source:**
```bash
git clone https://github.com/Kartik-Agrawal-Tech/patchframe.git
cd patchframe
npm install
npm run build
npm link        # makes `patchframe` and `pf` available globally
npm test        # 53 tests
```

---

## Setup

### Claude Code (Anthropic CLI)

The fastest integration — patchframe exposes an MCP server. Claude gets `tw1_apply`, `tw1_index`, and `tw1_stats` tools natively, no file writing needed.

**1. Add to `.claude/settings.json`:**
```json
{
  "mcpServers": {
    "patchframe": {
      "command": "npx",
      "args": ["patchframe", "mcp"]
    }
  }
}
```

**2. Init your project:**
```bash
patchframe init
```
This indexes your repo and writes a TW1 section into `CLAUDE.md`. Claude Code reads `CLAUDE.md` automatically — zero extra steps.

**3. Start editing:**
```
> refactor the parseValue function to handle negative numbers
```
Claude emits a TW1 frame and calls `tw1_apply` directly. Files update, token savings tracked.

---

### Cursor / VS Code

Install the VS Code extension:
```bash
cd vscode-extension && npm install && npm run package
code --install-extension patchframe-0.1.0.vsix
```
On workspace open, the extension silently injects the system prompt into `.cursorrules` and watches for `patch.tw1` files. Ask Cursor to make changes — it writes `patch.tw1`, the extension auto-applies.

---

## Quickstart

```bash
# 1. Initialise in your project root
cd /path/to/your/project
patchframe init

# 2. Copy the printed file index into your LLM system prompt
#    (see prompts/tw1_system.md for the full system prompt template)

# 3. Ask the LLM to make a change. It will output something like:
#
#    TW1
#    R a @42/9c1f0d..@44/2b8e11
#    ```
#    def total(xs):
#        return sum(x.amount for x in xs if x.active)
#    ```

# 4. Save it to a file and apply
patchframe apply patch.tw1

# or pipe directly from LLM output
echo "$LLM_OUTPUT" | patchframe apply
```

---

## TW1 protocol reference

### Header

Every frame starts with:
```
TW1
```

### Operations

| Op | Meaning | Syntax |
|---|---|---|
| `R` | Replace line range with payload | `R <fid> @<line>/<sha6>..@<line>/<sha6>` + fence |
| `I` | Insert payload after anchor line | `I <fid> @<line>/<sha6>` + fence |
| `D` | Delete line range | `D <fid> @<line>/<sha6>..@<line>/<sha6>` |
| `+` | Create new file | `+ '<path>'` + fence |
| `-` | Delete file | `- <fid>` |
| `MV` | Rename file | `MV <fid> '<new-path>'` |
| `M` | Replace function/class by symbol name | `M <fid> $<symbol>@<sigSha6>` + fence |

### Symbol ops (`M`)

`M` replaces an entire function or class by name — no line numbers needed. The LLM names the symbol; patchframe locates it via tree-sitter AST parsing and replaces it atomically.

```
TW1
M a $parseValue@abc123
```
function parseValue(raw: string): number {
  return parseInt(raw, 10) * 2;
}
```
```

Supported languages: TypeScript (`.ts`, `.tsx`), JavaScript (`.js`, `.jsx`, `.mjs`), Python (`.py`).

Use dot notation for class members: `$Calculator.add@sha6`

`sigSha6` = sha6 of the declaration line. Acts as a drift guard — if the function was renamed or refactored since the index was built, patchframe emits `E_SYMBOL` with a candidate list instead of patching the wrong symbol.

### Anchors

`@42/9c1f0d` = line 42, sha6 = first 6 hex chars of `sha256(line.trimEnd())`.

Anchors prevent silent drift: if a file was edited between sessions, the sha won't match and patchframe emits a compact error instead of applying a wrong patch.

### Error frames (fed back to LLM for self-correction)

```
E_ANCHOR_DRIFT fid=a line=42 want=9c1f0d got=8af201
E_FID fid=z unknown fid. known=[a,b,c,d]
E_OVERLAP fid=a overlapping ops on lines 42,43
E_PARSE TW1 parse error at line 3: unterminated fence block
E_SYMBOL fid=a symbol "$parseOld" not found. available=[parseValue,format,slugify]
```

---

## Multi-file example

```
TW1
R a @5/1a2b3c..@7/4d5e6f
```
const handler = async (req, res) => {
  const user = await db.users.findById(req.params.id);
  res.json(user);
};
```
I b @10/4a2c91
```
import { db } from '../db/client.js';
```
+ 'src/db/client.ts'
```
import { createClient } from './pool.js';
export const db = createClient(process.env.DATABASE_URL!);
```
MV c 'src/handlers/users.ts'
- d
```

---

## CLI reference

```
patchframe init [dir]     Scan repo, write .patchframe/state.json, print index
patchframe index [dir]    Print file index to stdout (no state written)
patchframe apply [file]   Apply TW1 frame from file or stdin
patchframe help           Show usage
```

---

## System prompt

See [`prompts/tw1_system.md`](prompts/tw1_system.md) for the full system prompt template to inject into any LLM.

Works with: Claude (Anthropic), GPT-4o (OpenAI), Gemini 1.5 Pro, Mistral Large, and any model following the system prompt.

---

## Design goals

- **Model-agnostic.** Plain text DSL, no structured output required.
- **Deterministic.** Same TW1 frame + same file state = same result, always.
- **Safe.** Anchor validation prevents stale patches. Atomic writes with rollback.
- **Minimal deps.** Core anchor ops are zero-dep. Symbol ops add tree-sitter for accurate AST parsing.
- **Composable.** Pipe-friendly. Works with any editor, IDE, or automation script.

---

## Token savings dashboard

Every `patchframe apply` records a metrics entry in `.patchframe/metrics.jsonl`. Run `patchframe stats` to see cumulative savings:

```
  ┌─ patchframe metrics ──────────────────────────────────┐
  │  Total edits:        47                              │
  │  Files touched:      83                              │
  │  Tokens emitted:     4,821                           │
  │  Baseline (full):    61,400                          │
  │  Tokens saved:       56,579                          │
  │  Avg saved per edit: 92.1%                           │
  │  Best edit savings:  98.4%                           │
  ├──────────────────────────────────────────────────────┤
  │  ████████████████████████████░  92.1%               │
  └──────────────────────────────────────────────────────┘
  Period: 2026-05-01 → 2026-05-02
```

After each successful apply, a one-liner is printed inline:

```
Applied:
  wrote src/auth.py
  saved ~1,240 tokens (93.4% vs full-file rewrite)
```

Metrics are stored locally in `.patchframe/metrics.jsonl` (append-only JSONL). Each entry records: timestamp, op count, files touched, input tokens, baseline tokens, tokens saved, and savings percentage. Nothing is sent anywhere.

---

## Roadmap

- [x] MVP — anchor ops (`R`, `I`, `D`, `+`, `-`, `MV`) for all text files
- [x] Token savings tracker + stats dashboard (`patchframe stats`)
- [x] Symbol ops — `M $functionName@sha6` via tree-sitter (JS/TS/Python)
- [x] VS Code extension — auto-inject file index into Copilot/Cursor system prompt
- [ ] Streaming apply — apply partial frames as LLM streams (cut perceived latency)
- [x] MCP server — expose patchframe as an MCP tool for Claude Code / Cursor

---

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

MIT © Kartik
