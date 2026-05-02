# tiny-edit

**85–98% fewer output tokens when LLMs edit your code.**

Instead of rewriting an entire 500-line file to fix one function, tiny-edit teaches any LLM to emit a 25-token diff frame. A local CLI validates anchors, applies the patch atomically, and rolls back on failure.

```
# Without tiny-edit: LLM rewrites 500 lines (~3500 tokens)
# With tiny-edit: LLM emits 25 tokens
TW1
R a @42/9c1f0d..@44/2b8e11
```
def total(xs):
    return sum(x.amount for x in xs if x.active)
```
```

---

## How it works

1. **Index** — tiny-edit scans your repo and builds a compact file manifest (`id|path|sha8|loc`).
2. **Inject** — paste the manifest + system prompt into your LLM session once (prompt-cached).
3. **Edit** — ask the LLM for changes. It responds with a `TW1` frame instead of a full file.
4. **Apply** — `tiny-edit apply patch.tw1` validates anchors (sha6 fingerprints), applies bottom-up, runs rollback on any failure.

```
┌────────┐  TW1 frame (25 tokens)  ┌─────────────────┐  atomic write  ┌──────────┐
│  LLM   │ ──────────────────────▶ │  tiny-edit CLI  │ ─────────────▶ │  repo    │
└────────┘                         │  parse+apply    │                └──────────┘
    ▲                              └─────────────────┘
    │ file index (cached, ~50 tokens)       │
    └───────────────────────────────────────┘
```

---

## Token efficiency

| Scenario | Full file | Unified diff | **tiny-edit** |
|---|---|---|---|
| 1-line fix in 200-LOC file | ~1 400 tokens | ~120 tokens | **~25 tokens** |
| Replace 1 function (15 LOC) in 500-LOC file | ~3 500 tokens | ~180 tokens | **~95 tokens** |
| 3-file refactor, ~50 LOC changed | ~10 000 tokens | ~600 tokens | **~340 tokens** |

*Measured on cl100k tokenizer (Claude/GPT family). Input-side index is prompt-cached, cost ~zero after first turn.*

---

## Install

```bash
npm install -g tiny-edit
# or run without installing:
npx tiny-edit
```

**Requirements:** Node.js 18+

---

## Quickstart

```bash
# 1. Initialise in your project root
cd /path/to/your/project
tiny-edit init

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
tiny-edit apply patch.tw1

# or pipe directly from LLM output
echo "$LLM_OUTPUT" | tiny-edit apply
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

### Anchors

`@42/9c1f0d` = line 42, sha6 = first 6 hex chars of `sha256(line.trimEnd())`.

Anchors prevent silent drift: if a file was edited between sessions, the sha won't match and tiny-edit emits a compact error instead of applying a wrong patch.

### Error frames (fed back to LLM for self-correction)

```
E_ANCHOR_DRIFT fid=a line=42 want=9c1f0d got=8af201
E_FID fid=z unknown fid. known=[a,b,c,d]
E_OVERLAP fid=a overlapping ops on lines 42,43
E_PARSE TW1 parse error at line 3: unterminated fence block
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
tiny-edit init [dir]     Scan repo, write .tiny-edit/state.json, print index
tiny-edit index [dir]    Print file index to stdout (no state written)
tiny-edit apply [file]   Apply TW1 frame from file or stdin
tiny-edit help           Show usage
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
- **Zero runtime dependencies.** Ships as a single Node.js binary, no Python, no tree-sitter (MVP).
- **Composable.** Pipe-friendly. Works with any editor, IDE, or automation script.

---

## Roadmap

- [x] MVP — anchor ops (`R`, `I`, `D`, `+`, `-`, `MV`) for all text files
- [ ] Symbol ops — `M $functionName` using tree-sitter (skip re-anchoring large functions)
- [ ] Language server integration — VS Code extension that auto-injects the index
- [ ] Streaming apply — apply partial frames as LLM streams (cut perceived latency)
- [ ] MCP server — expose tiny-edit as an MCP tool for Claude Code / Cursor

---

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

MIT © Kartik
