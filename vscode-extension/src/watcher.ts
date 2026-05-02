import * as vscode from 'vscode';
import { unlinkSync } from 'fs';
import { runApply } from './cli';
import { refresh } from './statusBar';

export function createWatcher(
  workspaceRoot: string,
  statusBar: vscode.StatusBarItem,
): vscode.FileSystemWatcher {
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceRoot, '*.tw1'),
  );

  watcher.onDidCreate(async (uri) => {
    const filePath = uri.fsPath;

    const result = await runApply(filePath, workspaceRoot);

    if (result.ok) {
      try { unlinkSync(filePath); } catch { /* already gone */ }
      refresh(statusBar, workspaceRoot);

      const saved = result.savedTokens ?? 0;
      const pct = result.savedPct ?? 0;
      const written = result.written.length;
      const savingsMsg = saved > 0 ? `  ·  saved ~${saved.toLocaleString()} tokens (${pct}%)` : '';
      vscode.window.setStatusBarMessage(
        `$(check) patchframe applied ${written} file${written !== 1 ? 's' : ''}${savingsMsg}`,
        5000,
      );
    } else {
      const errors = result.errors ?? [];
      const detail = errors.map(e => `${e.code}: ${e.detail}`).join('\n');
      vscode.window.showErrorMessage(`patchframe apply failed:\n${detail}`);
    }
  });

  return watcher;
}
