import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const _req = createRequire(import.meta.url);

export type SupportedLang = 'js' | 'ts' | 'py';

export interface SymbolLocation {
  startLine: number; // 1-based inclusive
  endLine: number;   // 1-based inclusive
  sigSha6: string;   // sha6 of declaration line — drift guard
}

interface TSPoint { row: number; column: number; }
interface TSNode {
  type: string;
  text: string;
  startPosition: TSPoint;
  endPosition: TSPoint;
  namedChildren: TSNode[];
  childForFieldName(name: string): TSNode | null;
}
interface TSTree { rootNode: TSNode; }
interface TSParser { setLanguage(lang: unknown): void; parse(source: string): TSTree; }
interface TSParserCtor { new(): TSParser; }

function sha6(line: string): string {
  return createHash('sha256').update(line.trimEnd()).digest('hex').slice(0, 6);
}

function loadParser(): TSParser {
  const Ctor = _req('tree-sitter') as TSParserCtor;
  return new Ctor();
}

function loadGrammar(lang: SupportedLang): unknown {
  switch (lang) {
    case 'ts': return (_req('tree-sitter-typescript') as { typescript: unknown }).typescript;
    case 'js': return _req('tree-sitter-javascript');
    case 'py': return _req('tree-sitter-python');
  }
}

export function detectLang(filePath: string): SupportedLang | null {
  const m = filePath.match(/\.([^./\\]+)$/);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  if (ext === 'ts' || ext === 'tsx') return 'ts';
  if (ext === 'py') return 'py';
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return 'js';
  return null;
}

function declarationName(node: TSNode): string | null {
  const { type } = node;
  if (
    type === 'function_declaration' || type === 'function_definition' ||
    type === 'class_declaration'    || type === 'class_definition'
  ) {
    return node.childForFieldName('name')?.text ?? null;
  }
  return null;
}

function searchTopLevel(root: TSNode, name: string): TSNode | null {
  for (const child of root.namedChildren) {
    if (declarationName(child) === name) return child;

    if (child.type === 'export_statement') {
      for (const inner of child.namedChildren) {
        if (declarationName(inner) === name) return inner;
      }
    }

    if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
      for (const decl of child.namedChildren) {
        if (decl.type === 'variable_declarator' && decl.childForFieldName('name')?.text === name) {
          return child;
        }
      }
    }

    if (child.type === 'decorated_definition') {
      for (const inner of child.namedChildren) {
        if (declarationName(inner) === name) return child;
      }
    }
  }
  return null;
}

function searchMember(classNode: TSNode, memberName: string): TSNode | null {
  const body = classNode.childForFieldName('body');
  if (!body) return null;
  for (const child of body.namedChildren) {
    if (child.type === 'method_definition' || child.type === 'function_definition') {
      if (child.childForFieldName('name')?.text === memberName) return child;
    }
    if (child.type === 'decorated_definition') {
      for (const inner of child.namedChildren) {
        if (inner.type === 'function_definition' && inner.childForFieldName('name')?.text === memberName) {
          return child;
        }
      }
    }
  }
  return null;
}

function resolveNode(root: TSNode, symbolPath: string): TSNode | null {
  const dot = symbolPath.indexOf('.');
  if (dot !== -1) {
    const classNode = searchTopLevel(root, symbolPath.slice(0, dot));
    return classNode ? searchMember(classNode, symbolPath.slice(dot + 1)) : null;
  }
  return searchTopLevel(root, symbolPath);
}

export function listSymbols(source: string, lang: SupportedLang): string[] {
  const parser = loadParser();
  parser.setLanguage(loadGrammar(lang));
  const tree = parser.parse(source);
  const names: string[] = [];

  for (const child of tree.rootNode.namedChildren) {
    const n = declarationName(child);
    if (n) { names.push(n); continue; }

    if (child.type === 'export_statement') {
      for (const inner of child.namedChildren) {
        const innerN = declarationName(inner);
        if (innerN) names.push(innerN);
      }
      continue;
    }

    if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
      for (const decl of child.namedChildren) {
        if (decl.type === 'variable_declarator') {
          const vn = decl.childForFieldName('name')?.text;
          if (vn) names.push(vn);
        }
      }
      continue;
    }

    if (child.type === 'decorated_definition') {
      for (const inner of child.namedChildren) {
        const innerN = declarationName(inner);
        if (innerN) names.push(innerN);
      }
    }
  }
  return names;
}

export function findSymbol(source: string, lang: SupportedLang, symbolPath: string): SymbolLocation | null {
  const parser = loadParser();
  parser.setLanguage(loadGrammar(lang));
  const tree = parser.parse(source);
  const lines = source.split('\n');

  const node = resolveNode(tree.rootNode, symbolPath);
  if (!node) return null;

  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const sigSha6 = sha6(lines[node.startPosition.row] ?? '');

  return { startLine, endLine, sigSha6 };
}
