#!/usr/bin/env npx tsx
/**
 * patchframe Lab Runner
 * Applies one TW1 frame per op type against sample files.
 * Tracks pass/fail and token savings vs full-file rewrite.
 * Run: npx tsx lab/run.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTW1 } from '../src/cli/parse.js';
import { applyFrame } from '../src/cli/apply.js';
import { buildIndex } from '../src/cli/index-files.js';
import { estimateTokens } from '../src/cli/metrics.js';
import { findSymbol } from '../src/cli/symbols.js';
import type { FileIndex } from '../src/cli/index-files.js';

const LAB = fileURLToPath(new URL('.', import.meta.url));
const SAMPLES = join(LAB, 'samples');
const WORK = join(LAB, '.work');

const SAMPLE_FILES = ['calc.ts', 'utils.js', 'formatter.py'] as const;

function sha6(line: string): string {
  return createHash('sha256').update(line.trimEnd()).digest('hex').slice(0, 6);
}

function prep(name: string): string {
  const dir = join(WORK, name.replace(/\W+/g, '-'));
  if (existsSync(dir)) rmSync(dir, { recursive: true });
  mkdirSync(dir, { recursive: true });
  for (const f of SAMPLE_FILES) {
    writeFileSync(join(dir, f), readFileSync(join(SAMPLES, f), 'utf8'));
  }
  return dir;
}

interface CaseResult {
  name: string;
  opType: string;
  passed: boolean;
  error?: string;
  inputTokens: number;
  baselineTokens: number;
  savedPct: number;
}

type TestFn = (dir: string, idx: FileIndex) => {
  frame: string;
  baseline: string;
  verify: (dir: string) => boolean;
};

async function run(name: string, opType: string, fn: TestFn): Promise<CaseResult> {
  const dir = prep(name);
  try {
    const idx = await buildIndex(dir);
    const { frame, baseline, verify } = fn(dir, idx);
    const parsed = parseTW1(frame);
    const result = applyFrame(parsed.ops, idx);

    if (!result.ok) {
      return {
        name, opType, passed: false,
        error: result.errors.map(e => `${e.code}: ${e.detail}`).join('; '),
        inputTokens: estimateTokens(frame),
        baselineTokens: estimateTokens(baseline),
        savedPct: 0,
      };
    }

    const passed = verify(dir);
    const inputTokens = estimateTokens(frame);
    const baselineTokens = estimateTokens(baseline);
    const savedTokens = Math.max(0, baselineTokens - inputTokens);
    const savedPct = baselineTokens > 0 ? (savedTokens / baselineTokens) * 100 : 0;
    return { name, opType, passed, inputTokens, baselineTokens, savedPct };
  } catch (e) {
    return { name, opType, passed: false, error: String(e), inputTokens: 0, baselineTokens: 0, savedPct: 0 };
  }
}

// ── Test cases ────────────────────────────────────────────────────────────────

const results: CaseResult[] = [];

// 1. R — replace a single line inside a method
results.push(await run('R: replace line in method', 'R', (dir, idx) => {
  const src = readFileSync(join(dir, 'calc.ts'), 'utf8');
  const lines = src.split('\n');
  const n = 3; // "    return a + b;"
  const s = sha6(lines[n - 1]);
  const fid = idx.byPath.get('calc.ts')!;
  return {
    frame: `TW1\nR ${fid} @${n}/${s}..@${n}/${s}\n\`\`\`\n    return (a + b) | 0;\n\`\`\``,
    baseline: src,
    verify: d => readFileSync(join(d, 'calc.ts'), 'utf8').includes('(a + b) | 0'),
  };
}));

// 2. I — insert a comment after closing brace of greet
results.push(await run('I: insert line after anchor', 'I', (dir, idx) => {
  const src = readFileSync(join(dir, 'utils.js'), 'utf8');
  const lines = src.split('\n');
  const n = 3; // "}"
  const s = sha6(lines[n - 1]);
  const fid = idx.byPath.get('utils.js')!;
  return {
    frame: `TW1\nI ${fid} @${n}/${s}\n\`\`\`\n// greet: returns greeting string\n\`\`\``,
    baseline: src,
    verify: d => readFileSync(join(d, 'utils.js'), 'utf8').includes('greet: returns greeting'),
  };
}));

// 3. D — delete the double arrow function line
results.push(await run('D: delete arrow function line', 'D', (dir, idx) => {
  const src = readFileSync(join(dir, 'utils.js'), 'utf8');
  const lines = src.split('\n');
  const n = 5; // "const double = (x) => x * 2;"
  const s = sha6(lines[n - 1]);
  const fid = idx.byPath.get('utils.js')!;
  return {
    frame: `TW1\nD ${fid} @${n}/${s}..@${n}/${s}`,
    baseline: src,
    verify: d => !readFileSync(join(d, 'utils.js'), 'utf8').includes('const double'),
  };
}));

// 4. M — replace Calculator.add by symbol name
results.push(await run('M: replace symbol by name', 'M', (dir, idx) => {
  const src = readFileSync(join(dir, 'calc.ts'), 'utf8');
  const loc = findSymbol(src, 'ts', 'Calculator.add')!;
  const fid = idx.byPath.get('calc.ts')!;
  const payload = `  add(a: number, b: number): number {\n    return Math.trunc(a + b);\n  }`;
  return {
    frame: `TW1\nM ${fid} $Calculator.add@${loc.sigSha6}\n\`\`\`\n${payload}\n\`\`\``,
    baseline: src,
    verify: d => readFileSync(join(d, 'calc.ts'), 'utf8').includes('Math.trunc'),
  };
}));

// 5. + — create a new constants file
results.push(await run('+: create new file', '+', (dir, _idx) => {
  return {
    frame: `TW1\n+ 'constants.ts'\n\`\`\`\nexport const PI = 3.14159;\nexport const E = 2.71828;\n\`\`\``,
    baseline: '',
    verify: d => existsSync(join(d, 'constants.ts')) &&
      readFileSync(join(d, 'constants.ts'), 'utf8').includes('PI'),
  };
}));

// 6. - — delete formatter.py
results.push(await run('-: delete a file', '-', (dir, idx) => {
  const src = readFileSync(join(dir, 'formatter.py'), 'utf8');
  const fid = idx.byPath.get('formatter.py')!;
  return {
    frame: `TW1\n- ${fid}`,
    baseline: src,
    verify: d => !existsSync(join(d, 'formatter.py')),
  };
}));

// 7. MV — rename utils.js → helpers.js
results.push(await run('MV: rename file', 'MV', (dir, idx) => {
  const src = readFileSync(join(dir, 'utils.js'), 'utf8');
  const fid = idx.byPath.get('utils.js')!;
  return {
    frame: `TW1\nMV ${fid} 'helpers.js'`,
    baseline: src,
    verify: d => !existsSync(join(d, 'utils.js')) && existsSync(join(d, 'helpers.js')),
  };
}));

// ── Dashboard ─────────────────────────────────────────────────────────────────

const W = 72;
const LINE = '═'.repeat(W);
const passed = results.filter(r => r.passed).length;
const total = results.length;
const savingsEntries = results.filter(r => r.baselineTokens > 0);
const avgSavings = savingsEntries.length > 0
  ? savingsEntries.reduce((s, r) => s + r.savedPct, 0) / savingsEntries.length
  : 0;

console.log();
console.log('  patchframe Lab — TW1 Protocol Test Results');
console.log('  ' + LINE);
console.log();
console.log(`  ${'Op'.padEnd(4)} ${'Test'.padEnd(34)} ${'in'.padStart(4)} ${'base'.padStart(5)} ${'saved'.padStart(7)}  status`);
console.log('  ' + '─'.repeat(W));

for (const r of results) {
  const icon = r.passed ? '✓' : '✗';
  const savedStr = r.baselineTokens > 0 ? `${Math.round(r.savedPct).toString().padStart(3)}%` : ' N/A';
  const inTok = r.inputTokens.toString().padStart(4);
  const base = r.baselineTokens.toString().padStart(5);
  const label = r.name.padEnd(34);
  const op = r.opType.padEnd(4);
  const errStr = r.error ? `  [${r.error.slice(0, 40)}]` : '';
  console.log(`  ${op} ${label} ${inTok} ${base} ${savedStr.padStart(4)}    ${icon}${errStr}`);
}

console.log();
console.log('  ' + LINE);
console.log(`  SUCCESS RATE  ${passed}/${total}  (${Math.round(passed / total * 100)}%)`);
if (savingsEntries.length > 0) {
  console.log(`  AVG SAVINGS   ${avgSavings.toFixed(1)}%  vs full-file rewrite`);
}
console.log();
