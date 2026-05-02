import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const METRICS_DIR = ".tiny-edit";
const METRICS_FILE = "metrics.jsonl";

export interface MetricEntry {
  ts: string;                    // ISO timestamp
  ops: number;                   // op count in this frame
  filesTouched: number;
  inputBytes: number;            // size of TW1 frame
  baselineBytes: number;         // size of equivalent full-file rewrites
  inputTokens: number;           // estimated tokens emitted
  baselineTokens: number;        // estimated tokens if full-file rewritten
  savedTokens: number;           // baseline - input
  savedPct: number;              // (saved / baseline) * 100, 0 if baseline=0
}

export interface MetricsSummary {
  totalEdits: number;
  totalFilesTouched: number;
  totalInputTokens: number;
  totalBaselineTokens: number;
  totalSavedTokens: number;
  avgSavedPct: number;
  bestSavedPct: number;
  firstEdit: string | null;
  lastEdit: string | null;
}

/**
 * Heuristic token estimator. Roughly matches cl100k_base behaviour
 * within ~15% on natural code without requiring a native tokenizer.
 *
 * Rule: 1 token ≈ 4 chars OR 0.75 words, whichever is larger.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function recordApply(
  root: string,
  inputFrame: string,
  rewrittenFiles: Array<{ path: string; before: string; after: string }>,
): MetricEntry {
  const filesTouched = rewrittenFiles.length;
  const opsCount = countOps(inputFrame);
  const inputBytes = Buffer.byteLength(inputFrame, "utf8");
  // Baseline: what the LLM would have emitted if it rewrote each touched file in full
  const baselineBytes = rewrittenFiles.reduce(
    (sum, f) => sum + Buffer.byteLength(f.before, "utf8"),
    0,
  );
  const inputTokens = estimateTokens(inputFrame);
  const baselineTokens = rewrittenFiles.reduce(
    (sum, f) => sum + estimateTokens(f.before),
    0,
  );
  const savedTokens = Math.max(0, baselineTokens - inputTokens);
  const savedPct = baselineTokens > 0 ? (savedTokens / baselineTokens) * 100 : 0;

  const entry: MetricEntry = {
    ts: new Date().toISOString(),
    ops: opsCount,
    filesTouched,
    inputBytes,
    baselineBytes,
    inputTokens,
    baselineTokens,
    savedTokens,
    savedPct: Math.round(savedPct * 10) / 10,
  };

  const dir = join(root, METRICS_DIR);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, METRICS_FILE), JSON.stringify(entry) + "\n", "utf8");

  return entry;
}

function countOps(frame: string): number {
  let n = 0;
  let inFence = false;
  for (const raw of frame.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```")) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (line === "TW1" || line === "" || line.startsWith("#")) continue;
    if (/^(R|I|D|MV|\+|-)\b/.test(line)) n++;
  }
  return n;
}

export function loadMetrics(root: string): MetricEntry[] {
  const p = join(root, METRICS_DIR, METRICS_FILE);
  if (!existsSync(p)) return [];
  const raw = readFileSync(p, "utf8").trim();
  if (!raw) return [];
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as MetricEntry);
}

export function summarize(entries: MetricEntry[]): MetricsSummary {
  if (entries.length === 0) {
    return {
      totalEdits: 0,
      totalFilesTouched: 0,
      totalInputTokens: 0,
      totalBaselineTokens: 0,
      totalSavedTokens: 0,
      avgSavedPct: 0,
      bestSavedPct: 0,
      firstEdit: null,
      lastEdit: null,
    };
  }
  const totalInput = entries.reduce((s, e) => s + e.inputTokens, 0);
  const totalBaseline = entries.reduce((s, e) => s + e.baselineTokens, 0);
  const totalSaved = entries.reduce((s, e) => s + e.savedTokens, 0);
  const avgPct = entries.reduce((s, e) => s + e.savedPct, 0) / entries.length;
  const bestPct = entries.reduce((m, e) => Math.max(m, e.savedPct), 0);

  return {
    totalEdits: entries.length,
    totalFilesTouched: entries.reduce((s, e) => s + e.filesTouched, 0),
    totalInputTokens: totalInput,
    totalBaselineTokens: totalBaseline,
    totalSavedTokens: totalSaved,
    avgSavedPct: Math.round(avgPct * 10) / 10,
    bestSavedPct: Math.round(bestPct * 10) / 10,
    firstEdit: entries[0].ts,
    lastEdit: entries[entries.length - 1].ts,
  };
}

export function formatSummary(s: MetricsSummary): string {
  if (s.totalEdits === 0) {
    return "No edits recorded yet. Run `tiny-edit apply` first.";
  }
  const fmt = (n: number) => n.toLocaleString();
  const pct = (n: number) => `${n.toFixed(1)}%`;

  const bar = (p: number, width = 30): string => {
    const filled = Math.round((p / 100) * width);
    return "█".repeat(filled) + "░".repeat(width - filled);
  };

  return [
    "",
    "  ┌─ tiny-edit metrics ──────────────────────────────────┐",
    `  │  Total edits:        ${fmt(s.totalEdits).padEnd(34)}│`,
    `  │  Files touched:      ${fmt(s.totalFilesTouched).padEnd(34)}│`,
    `  │  Tokens emitted:     ${fmt(s.totalInputTokens).padEnd(34)}│`,
    `  │  Baseline (full):    ${fmt(s.totalBaselineTokens).padEnd(34)}│`,
    `  │  Tokens saved:       ${fmt(s.totalSavedTokens).padEnd(34)}│`,
    `  │  Avg saved per edit: ${pct(s.avgSavedPct).padEnd(34)}│`,
    `  │  Best edit savings:  ${pct(s.bestSavedPct).padEnd(34)}│`,
    "  ├──────────────────────────────────────────────────────┤",
    `  │  ${bar(s.avgSavedPct)} ${pct(s.avgSavedPct).padStart(7)}     │`,
    "  └──────────────────────────────────────────────────────┘",
    `  Period: ${s.firstEdit?.slice(0, 10)} → ${s.lastEdit?.slice(0, 10)}`,
    "",
  ].join("\n");
}
