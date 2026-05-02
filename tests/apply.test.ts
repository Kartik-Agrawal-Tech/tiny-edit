import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { applyFrame } from "../src/cli/apply.js";
import type { FileIndex, FileEntry } from "../src/cli/index-files.js";
import type { Op } from "../src/cli/parse.js";

function sha6(line: string): string {
  return createHash("sha256").update(line.trimEnd()).digest("hex").slice(0, 6);
}

function makeIndex(root: string, files: Record<string, string>): FileIndex {
  const entries = new Map<string, FileEntry>();
  const byPath = new Map<string, string>();
  let seq = 0;
  const ids = "abcdefghijklmnopqrstuvwxyz";
  for (const [path, content] of Object.entries(files)) {
    writeFileSync(join(root, path), content, "utf8");
    const id = ids[seq++];
    const sha8 = createHash("sha256").update(content).digest("hex").slice(0, 8);
    const loc = content.split("\n").length;
    entries.set(id, { id, path, sha8, loc });
    byPath.set(path, id);
  }
  return { entries, byPath, root };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `tiny-edit-test-${Date.now()}`);
  mkdirSync(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("applyFrame — R (replace)", () => {
  it("replaces target lines", () => {
    const original = "line1\nline2\nline3\nline4\nline5";
    const index = makeIndex(tmpDir, { "a.py": original });
    const lines = original.split("\n");

    const ops: Op[] = [{
      code: "R",
      fid: "a",
      from: { line: 2, sha6: sha6(lines[1]) },
      to:   { line: 3, sha6: sha6(lines[2]) },
      payload: "REPLACED_LINE2\nREPLACED_LINE3",
    }];

    const result = applyFrame(ops, index);
    expect(result.ok).toBe(true);
    const updated = readFileSync(join(tmpDir, "a.py"), "utf8");
    expect(updated).toBe("line1\nREPLACED_LINE2\nREPLACED_LINE3\nline4\nline5");
  });

  it("fails on anchor drift", () => {
    const original = "line1\nline2\nline3";
    const index = makeIndex(tmpDir, { "a.py": original });

    const ops: Op[] = [{
      code: "R",
      fid: "a",
      from: { line: 2, sha6: "000000" },  // wrong sha
      to:   { line: 3, sha6: "000001" },
      payload: "new",
    }];

    const result = applyFrame(ops, index);
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe("E_ANCHOR_DRIFT");
  });
});

describe("applyFrame — + (create)", () => {
  it("creates new file with payload", () => {
    const index = makeIndex(tmpDir, {});
    const ops: Op[] = [{
      code: "+",
      path: "src/new.ts",
      payload: "export const x = 1;",
    }];

    mkdirSync(join(tmpDir, "src"), { recursive: true });
    const result = applyFrame(ops, index);
    expect(result.ok).toBe(true);
    const content = readFileSync(join(tmpDir, "src/new.ts"), "utf8");
    expect(content).toBe("export const x = 1;");
  });
});

describe("applyFrame — - (delete)", () => {
  it("deletes existing file", () => {
    const index = makeIndex(tmpDir, { "a.py": "hello" });
    const ops: Op[] = [{ code: "-", fid: "a" }];
    const result = applyFrame(ops, index);
    expect(result.ok).toBe(true);
    expect(existsSync(join(tmpDir, "a.py"))).toBe(false);
  });
});

describe("applyFrame — MV (rename)", () => {
  it("renames file", () => {
    const index = makeIndex(tmpDir, { "old.ts": "const x = 1;" });
    const ops: Op[] = [{ code: "MV", fid: "a", newPath: "new.ts" }];
    const result = applyFrame(ops, index);
    expect(result.ok).toBe(true);
    expect(existsSync(join(tmpDir, "new.ts"))).toBe(true);
    expect(existsSync(join(tmpDir, "old.ts"))).toBe(false);
  });
});

describe("applyFrame — unknown fid", () => {
  it("returns E_FID for unknown file id", () => {
    const index = makeIndex(tmpDir, { "a.py": "x\ny\nz" });
    const ops: Op[] = [{ code: "-", fid: "z" }];
    const result = applyFrame(ops, index);
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe("E_FID");
  });
});
