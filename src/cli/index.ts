#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildIndex, formatIndex, refreshEntry } from "./index-files.js";
import { parseTW1, ParseError } from "./parse.js";
import { applyFrame, formatApplyResult } from "./apply.js";
import { formatError, parseError } from "./errors.js";
import { recordApply, loadMetrics, summarize, formatSummary } from "./metrics.js";

const STATE_DIR = ".tiny-edit";
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
tiny-edit — TW1 token-efficient code edit protocol

USAGE
  tiny-edit init [dir]        index repo, write .tiny-edit/state.json
  tiny-edit index [dir]       print file index to stdout
  tiny-edit apply [file]      read TW1 frame from file (or stdin) and apply
  tiny-edit stats             show token savings dashboard
  tiny-edit help              show this message

EXAMPLES
  tiny-edit init               # initialise in current directory
  tiny-edit apply patch.tw1    # apply patch file
  echo "TW1\\nR a ..." | tiny-edit apply  # pipe from LLM output
  tiny-edit stats              # view cumulative savings
`);
}

async function cmdStats(root: string): Promise<void> {
  const entries = loadMetrics(root);
  const summary = summarize(entries);
  console.log(formatSummary(summary));
}

async function cmdInit(root: string): Promise<void> {
  console.log(`Indexing ${root} ...`);
  const index = await buildIndex(root);
  const snapshot = formatIndex(index);
  saveState(root, { root, indexSnapshot: snapshot });
  console.log(`Indexed ${index.entries.size} files.`);
  console.log(`\nFile index (inject into LLM system prompt):\n`);
  console.log(snapshot);
}

async function cmdIndex(root: string): Promise<void> {
  const index = await buildIndex(root);
  console.log(formatIndex(index));
}

async function cmdApply(root: string, source: string | null): Promise<void> {
  let input: string;
  if (source && existsSync(source)) {
    input = readFileSync(source, "utf8");
  } else if (source) {
    console.error(`File not found: ${source}`);
    process.exit(1);
  } else {
    input = readFileSync("/dev/stdin", "utf8");
  }

  let frame;
  try {
    frame = parseTW1(input);
  } catch (err) {
    if (err instanceof ParseError) {
      console.error(formatError(parseError(err.message)));
    } else {
      console.error(String(err));
    }
    process.exit(1);
  }

  const index = await buildIndex(root);
  const result = applyFrame(frame.ops, index);

  if (result.ok) {
    console.log("Applied:");
    console.log(formatApplyResult(result));

    // Record metrics for this apply
    const entry = recordApply(root, input, result.captures);
    const savedStr = entry.savedPct > 0
      ? `  saved ~${entry.savedTokens.toLocaleString()} tokens (${entry.savedPct}% vs full-file rewrite)`
      : "";
    if (savedStr) console.log(savedStr);

    // Refresh state
    for (const p of result.written) {
      if (!p.startsWith("(deleted)")) {
        refreshEntry(index, p.includes(" → ") ? p.split(" → ")[1] : p);
      }
    }
    saveState(root, { root, indexSnapshot: formatIndex(index) });
  } else {
    console.error("Apply failed:");
    console.error(formatApplyResult(result));
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
    case "apply":
      await cmdApply(process.cwd(), args[0] ?? null);
      break;
    case "stats":
      await cmdStats(process.cwd());
      break;
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
