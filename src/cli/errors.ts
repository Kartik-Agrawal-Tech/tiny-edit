export type TW1ErrorCode =
  | "E_ANCHOR_DRIFT"
  | "E_SYMBOL"
  | "E_PARSE"
  | "E_FID"
  | "E_OVERLAP"
  | "E_FENCE"
  | "E_FILE_EXISTS"
  | "E_FILE_MISSING"
  | "E_READONLY";

export interface TW1Error {
  code: TW1ErrorCode;
  fid?: string;
  detail: string;
}

export function formatError(e: TW1Error): string {
  const fid = e.fid ? ` fid=${e.fid}` : "";
  return `${e.code}${fid} ${e.detail}`;
}

export function anchorDrift(fid: string, line: number, want: string, got: string): TW1Error {
  return {
    code: "E_ANCHOR_DRIFT",
    fid,
    detail: `line=${line} want=${want} got=${got}`,
  };
}

export function unknownFid(fid: string, knownIds: string[]): TW1Error {
  return {
    code: "E_FID",
    fid,
    detail: `unknown fid. known=[${knownIds.slice(0, 8).join(",")}]`,
  };
}

export function parseError(msg: string): TW1Error {
  return { code: "E_PARSE", detail: msg };
}

export function overlapError(fid: string, lines: number[]): TW1Error {
  return { code: "E_OVERLAP", fid, detail: `overlapping ops on lines ${lines.join(",")}` };
}

export function symbolNotFound(fid: string, symbolPath: string, candidates: string[]): TW1Error {
  return {
    code: "E_SYMBOL",
    fid,
    detail: `symbol "$${symbolPath}" not found. available=[${candidates.slice(0, 8).join(",")}]`,
  };
}

export function symbolDrift(fid: string, symbolPath: string, want: string, got: string): TW1Error {
  return {
    code: "E_SYMBOL",
    fid,
    detail: `symbol "$${symbolPath}" sig drift want=${want} got=${got}`,
  };
}

export function unsupportedLang(fid: string, ext: string): TW1Error {
  return {
    code: "E_SYMBOL",
    fid,
    detail: `unsupported language "${ext}" for symbol op. supported=[.ts,.tsx,.js,.jsx,.py]`,
  };
}
