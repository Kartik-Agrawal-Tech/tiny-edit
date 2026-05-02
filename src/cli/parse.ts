import { createHash } from "node:crypto";

export type OpCode = "R" | "I" | "D" | "+" | "-" | "MV";

export interface Anchor {
  line: number;
  sha6: string;
}

export interface BaseOp {
  fid: string;
}

export interface ReplaceOp extends BaseOp {
  code: "R";
  from: Anchor;
  to: Anchor;
  payload: string;
}

export interface InsertOp extends BaseOp {
  code: "I";
  after: Anchor;
  payload: string;
}

export interface DeleteOp extends BaseOp {
  code: "D";
  from: Anchor;
  to: Anchor;
}

export interface CreateOp {
  code: "+";
  path: string;
  payload: string;
}

export interface DeleteFileOp extends BaseOp {
  code: "-";
}

export interface MoveOp extends BaseOp {
  code: "MV";
  newPath: string;
}

export type Op = ReplaceOp | InsertOp | DeleteOp | CreateOp | DeleteFileOp | MoveOp;

export interface TW1Frame {
  ops: Op[];
}

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly lineNumber: number,
  ) {
    super(`TW1 parse error at line ${lineNumber}: ${message}`);
    this.name = "ParseError";
  }
}

type ParseState = "header" | "op" | "fence";

function parseAnchor(raw: string, lineNum: number): Anchor {
  const m = raw.match(/^@(\d+)\/([0-9a-f]{6})$/i);
  if (!m) throw new ParseError(`invalid anchor "${raw}"`, lineNum);
  return { line: parseInt(m[1], 10), sha6: m[2].toLowerCase() };
}

function parseStr(raw: string, lineNum: number): string {
  if (!raw.startsWith("'") || !raw.endsWith("'"))
    throw new ParseError(`expected quoted string, got "${raw}"`, lineNum);
  return raw.slice(1, -1);
}

function collectFence(lines: string[], start: number): { payload: string; end: number } {
  const fenceMarker = lines[start];
  const fenceLen = fenceMarker.match(/^(`+)/)?.[1].length ?? 3;
  const closing = "`".repeat(fenceLen);
  let i = start + 1;
  const collected: string[] = [];
  while (i < lines.length) {
    if (lines[i] === closing) return { payload: collected.join("\n"), end: i };
    collected.push(lines[i]);
    i++;
  }
  throw new ParseError("unterminated fence block", start);
}

export function sha6(line: string): string {
  return createHash("sha256")
    .update(line.trimEnd())
    .digest("hex")
    .slice(0, 6);
}

export function parseTW1(input: string): TW1Frame {
  const lines = input.split("\n");
  let i = 0;
  let state: ParseState = "header";
  const ops: Op[] = [];

  if (lines[i]?.trim() !== "TW1") {
    throw new ParseError('first line must be "TW1"', 0);
  }
  i++;
  state = "op";

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "" || line.startsWith("#")) { i++; continue; }

    if (state !== "op") throw new ParseError("unexpected state", i);

    const parts = line.trim().split(/\s+/);
    const code = parts[0] as OpCode;

    switch (code) {
      case "R": {
        if (parts.length < 4) throw new ParseError("R needs fid from..to anchors", i);
        const fid = parts[1];
        const [fromRaw, toRaw] = parts[2].split("..");
        if (!fromRaw || !toRaw) throw new ParseError("R range must be @from..@to", i);
        const from = parseAnchor(fromRaw, i);
        const to = parseAnchor(toRaw, i);
        i++;
        if (!lines[i]?.startsWith("`")) throw new ParseError("R op must be followed by fence", i);
        const { payload, end } = collectFence(lines, i);
        i = end + 1;
        ops.push({ code: "R", fid, from, to, payload });
        break;
      }
      case "I": {
        if (parts.length < 3) throw new ParseError("I needs fid anchor", i);
        const fid = parts[1];
        const after = parseAnchor(parts[2], i);
        i++;
        if (!lines[i]?.startsWith("`")) throw new ParseError("I op must be followed by fence", i);
        const { payload, end } = collectFence(lines, i);
        i = end + 1;
        ops.push({ code: "I", fid, after, payload });
        break;
      }
      case "D": {
        if (parts.length < 3) throw new ParseError("D needs fid from..to", i);
        const fid = parts[1];
        const [fromRaw, toRaw] = parts[2].split("..");
        if (!fromRaw || !toRaw) throw new ParseError("D range must be @from..@to", i);
        const from = parseAnchor(fromRaw, i);
        const to = parseAnchor(toRaw, i);
        i++;
        ops.push({ code: "D", fid, from, to });
        break;
      }
      case "+": {
        if (parts.length < 2) throw new ParseError("+ needs path", i);
        const path = parseStr(parts[1], i);
        i++;
        if (!lines[i]?.startsWith("`")) throw new ParseError("+ op must be followed by fence", i);
        const { payload, end } = collectFence(lines, i);
        i = end + 1;
        ops.push({ code: "+", path, payload });
        break;
      }
      case "-": {
        if (parts.length < 2) throw new ParseError("- needs fid", i);
        ops.push({ code: "-", fid: parts[1] });
        i++;
        break;
      }
      case "MV": {
        if (parts.length < 3) throw new ParseError("MV needs fid newpath", i);
        const fid = parts[1];
        const newPath = parseStr(parts[2], i);
        ops.push({ code: "MV", fid, newPath });
        i++;
        break;
      }
      default:
        throw new ParseError(`unknown op "${code}"`, i);
    }
  }

  if (ops.length === 0) throw new ParseError("empty TW1 frame (no ops)", 1);
  return { ops };
}
