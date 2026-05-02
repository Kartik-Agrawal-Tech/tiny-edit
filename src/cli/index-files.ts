import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

export interface FileEntry {
  id: string;
  path: string;
  sha8: string;
  loc: number;
}

export interface FileIndex {
  entries: Map<string, FileEntry>;    // id → entry
  byPath: Map<string, string>;        // path → id
  root: string;
}

const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", ".next", ".turbo",
  "coverage", "__pycache__", ".venv", "vendor",
]);

const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
  ".c", ".cpp", ".h", ".hpp", ".cs",
  ".json", ".yaml", ".yml", ".toml", ".env.example",
  ".md", ".txt", ".sh", ".bash", ".zsh",
  ".html", ".css", ".scss", ".sass", ".less",
  ".sql", ".graphql", ".proto",
]);

function isText(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return false;
  return TEXT_EXTS.has(filePath.slice(dot).toLowerCase());
}

function sha8(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 8);
}

function countLines(content: string): number {
  let n = 1;
  for (const ch of content) if (ch === "\n") n++;
  return n;
}

function makeId(seq: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  if (seq < 36) return chars[seq];
  if (seq < 36 * 36) {
    return chars[Math.floor(seq / 36)] + chars[seq % 36];
  }
  return String(seq);
}

async function collectPaths(dir: string, root: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...await collectPaths(full, root));
    } else if (e.isFile() && isText(e.name)) {
      results.push(full);
    }
  }
  return results.sort();
}

export async function buildIndex(root: string): Promise<FileIndex> {
  const paths = await collectPaths(root, root);
  const entries = new Map<string, FileEntry>();
  const byPath = new Map<string, string>();

  let seq = 0;
  for (const abs of paths) {
    const rel = relative(root, abs).replace(/\\/g, "/");
    let content: string;
    try {
      content = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const id = makeId(seq++);
    const entry: FileEntry = {
      id,
      path: rel,
      sha8: sha8(content),
      loc: countLines(content),
    };
    entries.set(id, entry);
    byPath.set(rel, id);
  }

  return { entries, byPath, root };
}

export function formatIndex(index: FileIndex): string {
  const lines: string[] = [];
  for (const e of index.entries.values()) {
    lines.push(`${e.id}|${e.path}|${e.sha8}|${e.loc}`);
  }
  return lines.join("\n");
}

export function refreshEntry(index: FileIndex, relPath: string): void {
  const norm = relPath.replace(/\\/g, "/");
  const abs = join(index.root, norm);
  let content: string;
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    const id = index.byPath.get(norm);
    if (id) { index.entries.delete(id); index.byPath.delete(norm); }
    return;
  }
  const existingId = index.byPath.get(norm);
  const id = existingId ?? makeId(index.entries.size);
  const entry: FileEntry = {
    id,
    path: norm,
    sha8: sha8(content),
    loc: countLines(content),
  };
  index.entries.set(id, entry);
  index.byPath.set(norm, id);
}
