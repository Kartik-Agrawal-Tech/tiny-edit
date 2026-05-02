import * as vscode from 'vscode';
import { existsSync } from 'fs';
import { join } from 'path';
import { runInit, runStats } from './cli';
import { injectCursorRules } from './inject';
import { createStatusBar, refresh } from './statusBar';
import { createWatcher } from './watcher';

let statusBar: vscode.StatusBarItem | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return;

  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  // Verify patchframe is accessible
  const { exitCode } = await (await import('./cli')).runCli(['--help'], workspaceRoot);
  if (exitCode !== 0 && exitCode !== 1) {
    vscode.window.showWarningMessage(
      'patchframe not found. Install with: npm install -g patchframe',
    );
    return;
  }

  // Init: ensure .patchframe/state.json exists
  if (!existsSync(join(workspaceRoot, '.patchframe', 'state.json'))) {
    await runInit(workspaceRoot);
  }

  // Inject TW1 system prompt + file index into .cursorrules (silent)
  await injectCursorRules(workspaceRoot);

  // Status bar
  statusBar = createStatusBar(workspaceRoot);
  context.subscriptions.push(statusBar);

  // .tw1 file watcher — auto-apply on creation
  const watcher = createWatcher(workspaceRoot, statusBar);
  context.subscriptions.push(watcher);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('tinyEdit.showStats', async () => {
      const stats = await runStats(workspaceRoot);
      if (stats) {
        const panel = vscode.window.createOutputChannel('patchframe stats');
        panel.clear();
        panel.appendLine(stats);
        panel.show();
      } else {
        vscode.window.showInformationMessage('No patchframe stats yet. Apply a patch first.');
      }
    }),

    vscode.commands.registerCommand('tinyEdit.refreshIndex', async () => {
      await runInit(workspaceRoot);
      await injectCursorRules(workspaceRoot);
      if (statusBar) refresh(statusBar, workspaceRoot);
      vscode.window.setStatusBarMessage('$(sync) patchframe index refreshed', 3000);
    }),
  );
}

export function deactivate(): void {
  statusBar?.dispose();
}
