import * as vscode from 'vscode';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

interface MetricEntry {
  savedTokens: number;
  baselineTokens: number;
  savedPct: number;
}

function loadMetrics(workspaceRoot: string): MetricEntry[] {
  const p = join(workspaceRoot, '.patchframe', 'metrics.jsonl');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line) as MetricEntry; } catch { return null; }
    })
    .filter((e): e is MetricEntry => e !== null);
}

export function createStatusBar(workspaceRoot: string): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = 'tinyEdit.showStats';
  refresh(item, workspaceRoot);
  item.show();
  return item;
}

export function refresh(item: vscode.StatusBarItem, workspaceRoot: string): void {
  const entries = loadMetrics(workspaceRoot);
  if (entries.length === 0) {
    item.text = '$(arrow-down) TW1 active';
    item.tooltip = 'patchframe: no edits yet';
    return;
  }
  const totalSaved = entries.reduce((s, e) => s + e.savedTokens, 0);
  const totalBaseline = entries.reduce((s, e) => s + e.baselineTokens, 0);
  const pct = totalBaseline > 0 ? Math.round((totalSaved / totalBaseline) * 100) : 0;
  const saved = totalSaved >= 1000 ? `${(totalSaved / 1000).toFixed(1)}k` : String(totalSaved);
  item.text = `$(arrow-down) TW1  ${pct}%  ${saved} saved`;
  item.tooltip = `patchframe: ${entries.length} edits, ${saved} tokens saved vs full-file rewrites`;
}
