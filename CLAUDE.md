# tiny-edit — Claude Session Context

## What this project is

**tiny-edit** implements the **TW1 protocol** — a token-efficient code edit DSL.

Instead of LLMs rewriting entire files, they emit compact diff frames (25–340 tokens). The local CLI validates anchors, applies changes atomically, and rolls back on failure. Measured savings: **85–98% fewer output tokens** vs full-file rewrites.

This is a CV/portfolio project. Prioritise clean, well-structured code and a professional README.

---

## Current state (as of 2026-05-02)

### Done
- TW1 MVP parser (`R`, `I`, `D`, `+`, `-`, `MV`, `M` ops + anchor validation)
- File indexer (`id|path|sha8|loc` manifest, skips binary/vendor)
- Atomic applier (bottom-up ops, sha6 anchor verification, rollback)
- Compact error frames (`E_ANCHOR_DRIFT`, `E_FID`, `E_OVERLAP`, `E_PARSE`, `E_SYMBOL`)
- CLI: `tiny-edit init | index | apply | stats | help`
- Token savings tracker + stats dashboard (`tiny-edit stats`)
- System prompt template (`prompts/tw1_system.md`)
- Symbol ops (`M $fn@sha6`) via tree-sitter — JS, TS, Python; dot notation for members
- Lab test harness (`lab/run.ts`) — 7 test cases, one per op type, with token savings dashboard
- vitest unit tests: parser (14), applier (6), metrics (13), symbols (20) = **53 tests**
- GitHub Actions CI (Node 18/20/22)

### Next milestone
- **VS Code extension** — auto-inject file index into Copilot/Cursor system prompt

---

## Architecture

```
src/cli/
  parse.ts        TW1 lexer/parser → Op AST (R/I/D/+/-/MV/M)
  apply.ts        Atomic applier (validate → dry-run → write → rollback)
  symbols.ts      tree-sitter symbol resolver (JS/TS/Python, dot notation)
  index-files.ts  Repo scanner → FileIndex (id|path|sha8|loc)
  metrics.ts      Token estimator (chars/4), JSONL recorder, dashboard
  errors.ts       Compact E_* error frames
  index.ts        CLI entry (init / index / apply / stats commands)

prompts/
  tw1_system.md   System prompt template (inject into any LLM)

tests/
  parse.test.ts   Parser unit tests (14 tests)
  apply.test.ts   Applier unit tests (6 tests)
  metrics.test.ts Metrics unit tests (13 tests)
  symbols.test.ts Symbol resolver unit tests (20 tests)
  golden/         Fixture pairs (TW1 input → expected fs state)

lab/
  run.ts          Lab runner: 7 test cases, one per op type, token savings report
  samples/        calc.ts, utils.js, formatter.py — target files for lab tests

.tiny-edit/
  state.json      Last-known file shas (session state)
  metrics.jsonl   Append-only token savings log
```

---

## TW1 protocol quick reference

```
TW1
R <fid> @<line>/<sha6>..@<line>/<sha6>    ← replace range
```payload```
I <fid> @<line>/<sha6>                    ← insert after anchor
```payload```
D <fid> @<line>/<sha6>..@<line>/<sha6>    ← delete range
+ '<path>'                                 ← create file
```payload```
- <fid>                                    ← delete file
MV <fid> '<new-path>'                      ← rename file
M <fid> $<symbol>@<sigSha6>               ← replace symbol by name
```payload```
```

Anchors: `@LINE/SHA6` where SHA6 = first 6 hex chars of `sha256(line.trimEnd())`.

Symbol ops: `$funcName@sha6` or `$ClassName.method@sha6`. sigSha6 = sha6 of the
declaration line. Supported languages: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.py`.

---

## Dev commands

```bash
npm install               # install deps (tree-sitter + grammars + devDeps)
npm test                  # run all 53 tests
npm run lint              # tsc --noEmit
npm run build             # compile to dist/
npm run dev               # run CLI via tsx (no build step)
npx tsx src/cli/index.ts init     # test init
npx tsx src/cli/index.ts stats    # test stats
npx tsx lab/run.ts        # lab: apply all 7 op types, print token savings report
```

---

## Coding standards

- TypeScript strict mode. Explicit types on all exports.
- No `any`. Use `unknown` + narrow at boundaries.
- Runtime deps: tree-sitter + JS/TS/Python grammars (symbol ops only). Core anchor ops remain zero-dep.
- No `console.log` in library code (only in CLI entry `index.ts`).
- Immutable patterns — no in-place mutation of arrays/objects.
- Functions < 50 lines. Files < 800 lines.
- Tests: vitest, AAA pattern, descriptive names.
- Commit style: `feat:`, `fix:`, `test:`, `refactor:`, `docs:`.

---

## Key design decisions

| Decision | Rationale |
|---|---|
| Custom DSL over git unified diff | Git diff has 2.5× token overhead (redundant `@@` headers, repeated context lines) |
| Custom DSL over JSON Patch | JSON punctuation tax, tokenizer splits keys badly (3× overhead) |
| SHA6 anchors over line numbers only | Prevents silent drift when file was edited between sessions |
| Bottom-up op ordering | Keeps line numbers stable during multi-op batch |
| Heuristic token estimator (chars/4) | Zero deps, ±15% accuracy — upgrade to js-tiktoken later if needed |
| Append-only JSONL for metrics | Simple, no DB, git-ignorable, easily parseable |
| Rollback via snapshots | Atomic: capture before-state, write to tmp+rename, restore on any failure |
| tree-sitter for symbol ops | Accurate AST parsing beats regex (handles decorators, overloads, generics). Core anchor ops stay zero-dep. |
| sigSha6 on declaration line | Same drift-detection discipline as anchor ops — catches renames between sessions |

---

## Token efficiency numbers (cl100k tokenizer)

| Scenario | Full file | Unified diff | tiny-edit |
|---|---|---|---|
| 1-line fix in 200-LOC file | ~1 400 | ~120 | **~25** |
| Replace 1 function (15 LOC) in 500-LOC file | ~3 500 | ~180 | **~95** |
| 3-file refactor, ~50 LOC | ~10 000 | ~600 | **~340** |

---

## GitHub setup (when ready to push)

```bash
gh repo create tiny-edit --public --source=. --push
# then update package.json repository.url: USERNAME → your handle
```

---

## Roadmap

- [x] Anchor ops MVP (R, I, D, +, -, MV)
- [x] Token savings tracker + stats dashboard
- [x] Symbol ops (M $fn) via tree-sitter — JS/TS/Python
- [x] Lab test harness (7 op types, token savings dashboard)
- [ ] VS Code extension (auto-inject index into Copilot/Cursor system prompt)
- [ ] Streaming apply (apply partial frames as LLM streams)
- [ ] MCP server (expose as Claude Code / Cursor tool)
