import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  estimateTokens,
  recordApply,
  loadMetrics,
  summarize,
  formatSummary,
} from "../src/cli/metrics.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `tiny-edit-metrics-${Date.now()}`);
  mkdirSync(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates short code line", () => {
    const t = estimateTokens("const x = 1;");
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(20);
  });

  it("estimates larger file proportionally", () => {
    const small = estimateTokens("x");
    const big = estimateTokens("x".repeat(400));
    expect(big).toBeGreaterThan(small * 50);
  });

  it("is deterministic", () => {
    const text = "function foo(a: string): number { return a.length; }";
    expect(estimateTokens(text)).toBe(estimateTokens(text));
  });
});

describe("recordApply + loadMetrics", () => {
  it("writes entry to metrics.jsonl", () => {
    const frame = "TW1\nR a @1/abc123..@2/def456\n```\nnew line\n```";
    const captures = [{ path: "a.ts", before: "old\nlines\nhere", after: "new line" }];
    recordApply(tmpDir, frame, captures);

    const entries = loadMetrics(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].ops).toBe(1);
    expect(entries[0].filesTouched).toBe(1);
    expect(entries[0].inputTokens).toBeGreaterThan(0);
    expect(entries[0].baselineTokens).toBeGreaterThan(0);
    expect(entries[0].savedTokens).toBeGreaterThanOrEqual(0);
  });

  it("appends multiple entries", () => {
    const frame = "TW1\n- a";
    recordApply(tmpDir, frame, []);
    recordApply(tmpDir, frame, []);
    expect(loadMetrics(tmpDir)).toHaveLength(2);
  });

  it("entry has valid ISO timestamp", () => {
    recordApply(tmpDir, "TW1\n- a", []);
    const [entry] = loadMetrics(tmpDir);
    expect(() => new Date(entry.ts)).not.toThrow();
    expect(new Date(entry.ts).getFullYear()).toBeGreaterThan(2020);
  });

  it("savedPct between 0 and 100", () => {
    const frame = "TW1\nR a @1/aaa..@2/bbb\n```\nfoo\n```";
    const before = "a\n".repeat(300);
    const after = "foo\n";
    recordApply(tmpDir, frame, [{ path: "a.ts", before, after }]);
    const [entry] = loadMetrics(tmpDir);
    expect(entry.savedPct).toBeGreaterThanOrEqual(0);
    expect(entry.savedPct).toBeLessThanOrEqual(100);
  });
});

describe("summarize", () => {
  it("returns zero summary for empty entries", () => {
    const s = summarize([]);
    expect(s.totalEdits).toBe(0);
    expect(s.avgSavedPct).toBe(0);
    expect(s.firstEdit).toBeNull();
  });

  it("sums totals across entries", () => {
    recordApply(tmpDir, "TW1\n- a", [{ path: "a.ts", before: "x".repeat(800), after: "y" }]);
    recordApply(tmpDir, "TW1\n- b", [{ path: "b.ts", before: "x".repeat(800), after: "y" }]);
    const entries = loadMetrics(tmpDir);
    const s = summarize(entries);
    expect(s.totalEdits).toBe(2);
    expect(s.totalFilesTouched).toBe(2);
    expect(s.totalSavedTokens).toBeGreaterThan(0);
    expect(s.avgSavedPct).toBeGreaterThan(0);
  });

  it("bestSavedPct is the max across entries", () => {
    recordApply(tmpDir, "TW1\n- a", [{ path: "a.ts", before: "x".repeat(2000), after: "y" }]);
    recordApply(tmpDir, "TW1\n- b", [{ path: "b.ts", before: "xx", after: "y" }]);
    const entries = loadMetrics(tmpDir);
    const s = summarize(entries);
    expect(s.bestSavedPct).toBeGreaterThanOrEqual(s.avgSavedPct);
  });
});

describe("formatSummary", () => {
  it("shows 'No edits' for empty summary", () => {
    expect(formatSummary(summarize([]))).toContain("No edits recorded");
  });

  it("contains key labels for non-empty summary", () => {
    recordApply(tmpDir, "TW1\n- a", [{ path: "a.ts", before: "x".repeat(400), after: "y" }]);
    const s = summarize(loadMetrics(tmpDir));
    const out = formatSummary(s);
    expect(out).toContain("tiny-edit metrics");
    expect(out).toContain("Tokens saved");
    expect(out).toContain("Avg saved");
  });
});
