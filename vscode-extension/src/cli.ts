import { execFile } from 'child_process';

const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ApplyResult {
  ok: boolean;
  written: string[];
  savedTokens?: number;
  savedPct?: number;
  errors?: Array<{ code: string; detail: string }>;
}

export function runCli(args: string[], cwd: string): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(NPX, ['tiny-edit', ...args], { cwd }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        exitCode: (err as NodeJS.ErrnoException & { code?: number } | null)?.code ?? (err ? 1 : 0),
      });
    });
  });
}

export async function runApply(filePath: string, cwd: string): Promise<ApplyResult> {
  const result = await runCli(['apply', filePath, '--json'], cwd);
  try {
    return JSON.parse(result.stdout) as ApplyResult;
  } catch {
    return { ok: false, written: [], errors: [{ code: 'E_PARSE', detail: result.stderr || result.stdout }] };
  }
}

export async function runIndex(cwd: string): Promise<string | null> {
  const result = await runCli(['index'], cwd);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

export async function runStats(cwd: string): Promise<string | null> {
  const result = await runCli(['stats'], cwd);
  return result.exitCode === 0 ? result.stdout : null;
}

export async function runInit(cwd: string): Promise<boolean> {
  const result = await runCli(['init'], cwd);
  return result.exitCode === 0;
}
