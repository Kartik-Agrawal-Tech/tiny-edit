#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { buildIndex, formatIndex, refreshEntry } from "./index-files.js";
import { parseTW1, ParseError } from "./parse.js";
import { applyFrame, formatApplyResult } from "./apply.js";
import { formatError, parseError } from "./errors.js";
import { recordApply, loadMetrics, summarize, formatSummary } from "./metrics.js";

const STATE_DIR = ".patchframe";
const STATE_FILE = "state.json";

interface State {
  root: string;
  indexSnapshot: string;
}

function loadState(root: string): State | null {
  const p = join(root, STATE_DIR, STATE_FILE);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as State;
  } catch {
    return null;
  }
}

function saveState(root: string, state: State): void {
  const dir = join(root, STATE_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, STATE_FILE), JSON.stringify(state, null, 2), "utf8");
}

function usage(): void {
  console.log(`
patchframe — TW1 token-efficient code edit protocol

USAGE
  patchframe init [dir]        index repo, write .patchframe/state.json
  patchframe index [dir]       print file index to stdout
  patchframe apply [file]      read TW1 frame from file (or stdin) and apply
  patchframe stats             show token savings dashboard
  patchframe help              show this message

EXAMPLES
  patchframe init               # initialise in current directory
  patchframe apply patch.tw1    # apply patch file
  echo "TW1\\nR a ..." | patchframe apply  # pipe from LLM output
  patchframe stats              # view cumulative savings
`);
}

async function cmdStats(root: string): Promise<void> {
  const entries = loadMetrics(root);
  const summary = summarize(entries);
  console.log(formatSummary(summary));
}

const CLAUDE_MD_MARKER_START = "<!-- patchframe:start -->";
const CLAUDE_MD_MARKER_END = "<!-- patchframe:end -->";

function buildClaudeMdSection(index: string): string {
  const promptPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "prompts", "tw1_system.md");
  const prompt = existsSync(promptPath) ? readFileSync(promptPath, "utf8") : "";
  return `${CLAUDE_MD_MARKER_START}
## patchframe — TW1 token-efficient code editing

${prompt}

## File index (id|path|sha8|loc)
${index}
${CLAUDE_MD_MARKER_END}`;
}

function injectClaudeMd(root: string, index: string): void {
  const claudeMdPath = join(root, "CLAUDE.md");
  const existing = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, "utf8") : "";
  const start = existing.indexOf(CLAUDE_MD_MARKER_START);
  const end = existing.indexOf(CLAUDE_MD_MARKER_END);
  const section = buildClaudeMdSection(index);

  let updated: string;
  if (start !== -1 && end !== -1) {
    updated = existing.slice(0, start) + section + existing.slice(end + CLAUDE_MD_MARKER_END.length);
  } else {
    updated = existing ? `${existing}\n\n${section}\n` : `${section}\n`;
  }
  writeFileSync(claudeMdPath, updated, "utf8");
}

async function cmdInit(root: string): Promise<void> {
  console.log(`Indexing ${root} ...`);
  const index = await buildIndex(root);
  const snapshot = formatIndex(index);
  saveState(root, { root, indexSnapshot: snapshot });
  injectClaudeMd(root, snapshot);
  console.log(`Indexed ${index.entries.size} files.`);
  console.log(`\nFile index (inject into LLM system prompt):\n`);
  console.log(snapshot);
  console.log(`\nCLAUDE.md updated with TW1 system prompt.`);
  console.log(`MCP server: add to .claude/settings.json → see README for setup.`);
}

async function cmdIndex(root: string): Promise<void> {
  const index = await buildIndex(root);
  console.log(formatIndex(index));
}

async function cmdApply(root: string, source: string | null, json = false): Promise<void> {
  let input: string;
  if (source && existsSync(source)) {
    input = readFileSync(source, "utf8");
  } else if (source) {
    if (json) process.stdout.write(JSON.stringify({ ok: false, written: [], errors: [{ code: "E_PARSE", detail: `File not found: ${source}` }] }));
    else console.error(`File not found: ${source}`);
    process.exit(1);
  } else {
    input = readFileSync("/dev/stdin", "utf8");
  }

  let frame;
  try {
    frame = parseTW1(input);
  } catch (err) {
    const detail = err instanceof ParseError ? err.message : String(err);
    if (json) process.stdout.write(JSON.stringify({ ok: false, written: [], errors: [{ code: "E_PARSE", detail }] }));
    else console.error(formatError(parseError(detail)));
    process.exit(1);
  }

  const index = await buildIndex(root);
  const result = applyFrame(frame.ops, index);

  if (result.ok) {
    const entry = recordApply(root, input, result.captures);
    if (json) {
      process.stdout.write(JSON.stringify({ ok: true, written: result.written, savedTokens: entry.savedTokens, savedPct: entry.savedPct }));
    } else {
      console.log("Applied:");
      console.log(formatApplyResult(result));
      if (entry.savedPct > 0) {
        console.log(`  saved ~${entry.savedTokens.toLocaleString()} tokens (${entry.savedPct}% vs full-file rewrite)`);
      }
    }
    for (const p of result.written) {
      if (!p.startsWith("(deleted)")) {
        refreshEntry(index, p.includes(" → ") ? p.split(" → ")[1] : p);
      }
    }
    saveState(root, { root, indexSnapshot: formatIndex(index) });
  } else {
    if (json) process.stdout.write(JSON.stringify({ ok: false, written: [], errors: result.errors }));
    else { console.error("Apply failed:"); console.error(formatApplyResult(result)); }
    process.exit(1);
  }
}

function cmdPrompt(): void {
  const promptPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "prompts", "tw1_system.md");
  if (existsSync(promptPath)) {
    process.stdout.write(readFileSync(promptPath, "utf8"));
  } else {
    console.error("prompts/tw1_system.md not found");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const [, , cmd, ...args] = process.argv;
  const root = resolve(args[0] && !args[0].endsWith(".tw1") ? args[0] : process.cwd());

  switch (cmd) {
    case "init":
      await cmdInit(root);
      break;
    case "index":
      await cmdIndex(root);
      break;
    case "apply": {
      const jsonFlag = args.includes("--json");
      const fileArg = args.find((a) => !a.startsWith("-")) ?? null;
      await cmdApply(process.cwd(), fileArg, jsonFlag);
      break;
    }
    case "stats":
      await cmdStats(process.cwd());
      break;
    case "prompt":
      cmdPrompt();
      break;
    case "mcp": {
      const { startMcpServer } = await import("../mcp/server.js");
      await startMcpServer();
      break;
    }
    case "help":
    case "--help":
    case "-h":
    case undefined:
      usage();
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      usage();
      process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
