import { createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  renameSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import type { Op, Anchor, ReplaceOp, InsertOp, DeleteOp } from "./parse.js";
import type { FileIndex } from "./index-files.js";
import {
  formatError,
  anchorDrift,
  unknownFid,
  overlapError,
  type TW1Error,
} from "./errors.js";

export interface ApplyResult {
  ok: boolean;
  errors: TW1Error[];
  written: string[];
}

function sha6(line: string): string {
  return createHash("sha256").update(line.trimEnd()).digest("hex").slice(0, 6);
}

function resolveAnchor(
  lines: string[],
  anchor: Anchor,
  fid: string,
): TW1Error | null {
  const idx = anchor.line - 1;
  if (idx < 0 || idx >= lines.length) {
    return anchorDrift(fid, anchor.line, anchor.sha6, "out-of-bounds");
  }
  const actual = sha6(lines[idx]);
  if (actual !== anchor.sha6) {
    return anchorDrift(fid, anchor.line, anchor.sha6, actual);
  }
  return null;
}

type LineOp =
  | { kind: "replace"; from: number; to: number; payload: string }
  | { kind: "insert"; after: number; payload: string }
  | { kind: "delete"; from: number; to: number };

function checkOverlap(ops: LineOp[], fid: string): TW1Error | null {
  const touched = new Set<number>();
  for (const op of ops) {
    if (op.kind === "insert") {
      if (touched.has(op.after)) return overlapError(fid, [op.after]);
      touched.add(op.after);
    } else {
      for (let l = op.from; l <= op.to; l++) {
        if (touched.has(l)) return overlapError(fid, [l]);
        touched.add(l);
      }
    }
  }
  return null;
}

function applyLineOps(original: string[], ops: LineOp[]): string[] {
  // Process bottom-up so line numbers stay stable
  const sorted = [...ops].sort((a, b) => {
    const aLine = a.kind === "insert" ? a.after : a.from;
    const bLine = b.kind === "insert" ? b.after : b.from;
    return bLine - aLine;
  });

  const result = [...original];
  for (const op of sorted) {
    if (op.kind === "replace") {
      const payloadLines = op.payload.split("\n");
      result.splice(op.from - 1, op.to - op.from + 1, ...payloadLines);
    } else if (op.kind === "insert") {
      const payloadLines = op.payload.split("\n");
      result.splice(op.after, 0, ...payloadLines);
    } else {
      result.splice(op.from - 1, op.to - op.from + 1);
    }
  }
  return result;
}

export function applyFrame(ops: Op[], index: FileIndex): ApplyResult {
  const errors: TW1Error[] = [];
  const written: string[] = [];

  // Group file-mutation ops by fid
  const fileOps = new Map<string, LineOp[]>();
  const createOps: Array<{ path: string; payload: string }> = [];
  const deleteOps: string[] = [];
  const moveOps: Array<{ fid: string; newPath: string }> = [];

  const knownIds = [...index.entries.keys()];

  for (const op of ops) {
    if (op.code === "+") {
      createOps.push({ path: op.path, payload: op.payload });
      continue;
    }
    if (op.code === "-") {
      if (!index.entries.has(op.fid)) {
        errors.push(unknownFid(op.fid, knownIds));
        continue;
      }
      deleteOps.push(op.fid);
      continue;
    }
    if (op.code === "MV") {
      if (!index.entries.has(op.fid)) {
        errors.push(unknownFid(op.fid, knownIds));
        continue;
      }
      moveOps.push({ fid: op.fid, newPath: op.newPath });
      continue;
    }

    if (!index.entries.has(op.fid)) {
      errors.push(unknownFid(op.fid, knownIds));
      continue;
    }

    if (!fileOps.has(op.fid)) fileOps.set(op.fid, []);

    if (op.code === "R") {
      fileOps.get(op.fid)!.push({ kind: "replace", from: op.from.line, to: op.to.line, payload: op.payload });
    } else if (op.code === "I") {
      fileOps.get(op.fid)!.push({ kind: "insert", after: op.after.line, payload: op.payload });
    } else if (op.code === "D") {
      fileOps.get(op.fid)!.push({ kind: "delete", from: op.from.line, to: op.to.line });
    }
  }

  if (errors.length > 0) return { ok: false, errors, written };

  // Dry-run: validate all anchors before touching disk
  for (const [fid, lineOps] of fileOps) {
    const entry = index.entries.get(fid)!;
    const abs = join(index.root, entry.path);
    const content = readFileSync(abs, "utf8");
    const lines = content.split("\n");

    for (const lop of lineOps) {
      if (lop.kind === "replace" || lop.kind === "delete") {
        const rop = ops.find(
          (o): o is ReplaceOp | DeleteOp =>
            (o.code === "R" || o.code === "D") && o.fid === fid,
        );
        if (rop && "from" in rop) {
          const e1 = resolveAnchor(lines, rop.from, fid);
          if (e1) { errors.push(e1); continue; }
          const e2 = resolveAnchor(lines, rop.to, fid);
          if (e2) { errors.push(e2); continue; }
        }
      } else if (lop.kind === "insert") {
        const iop = ops.find(
          (o): o is InsertOp => o.code === "I" && o.fid === fid,
        );
        if (iop) {
          const e = resolveAnchor(lines, iop.after, fid);
          if (e) errors.push(e);
        }
      }
    }

    const overlapErr = checkOverlap(lineOps, fid);
    if (overlapErr) errors.push(overlapErr);
  }

  if (errors.length > 0) return { ok: false, errors, written };

  // Commit phase: apply all changes atomically (in-memory apply, then write)
  const snapshots = new Map<string, { abs: string; original: string }>();

  try {
    // Apply line mutations
    for (const [fid, lineOps] of fileOps) {
      const entry = index.entries.get(fid)!;
      const abs = join(index.root, entry.path);
      const content = readFileSync(abs, "utf8");
      const lines = content.split("\n");
      snapshots.set(fid, { abs, original: content });

      const updated = applyLineOps(lines, lineOps);
      const tmp = abs + ".tw1.tmp";
      writeFileSync(tmp, updated.join("\n"), "utf8");
      renameSync(tmp, abs);
      written.push(entry.path);
    }

    // Create new files
    for (const { path, payload } of createOps) {
      const abs = join(index.root, path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, payload, "utf8");
      written.push(path);
    }

    // Delete files
    for (const fid of deleteOps) {
      const entry = index.entries.get(fid)!;
      const abs = join(index.root, entry.path);
      if (existsSync(abs)) unlinkSync(abs);
      written.push(`(deleted) ${entry.path}`);
    }

    // Move files
    for (const { fid, newPath } of moveOps) {
      const entry = index.entries.get(fid)!;
      const absOld = join(index.root, entry.path);
      const absNew = join(index.root, newPath);
      mkdirSync(dirname(absNew), { recursive: true });
      renameSync(absOld, absNew);
      written.push(`${entry.path} → ${newPath}`);
    }
  } catch (err) {
    // Rollback written files
    for (const [, snap] of snapshots) {
      try { writeFileSync(snap.abs, snap.original, "utf8"); } catch { /* best-effort */ }
    }
    errors.push({ code: "E_PARSE", detail: String(err) });
    return { ok: false, errors, written: [] };
  }

  return { ok: true, errors: [], written };
}

export function formatApplyResult(result: ApplyResult): string {
  if (result.ok) {
    return result.written.map((p) => `  wrote ${p}`).join("\n");
  }
  return result.errors.map(formatError).join("\n");
}
