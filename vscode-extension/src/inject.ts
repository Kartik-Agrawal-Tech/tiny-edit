import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runIndex } from './cli';

const MARKER_START = '# === patchframe (auto-managed) ===';
const MARKER_END = '# === end patchframe ===';

const BASE_PROMPT = `You output ONLY TW1 frames for code changes. No prose outside payload fences.

## TW1 syntax
TW1
R <fid> @<line>/<sha6>..@<line>/<sha6>
\`\`\`
<replacement lines>
\`\`\`
I <fid> @<line>/<sha6>
\`\`\`
<lines to insert after anchor>
\`\`\`
D <fid> @<line>/<sha6>..@<line>/<sha6>
+ '<new/path.ext>'
\`\`\`
<full file content>
\`\`\`
- <fid>
MV <fid> '<new/path.ext>'
M <fid> $<symbolName>@<sigSha6>
\`\`\`
<full replacement function or class>
\`\`\`

## Rules
1. Emit TW1 header once, then ops.
2. @LINE/SHA6 — SHA6 = first 6 hex chars of sha256(line.trimEnd()).
3. Ranges inclusive, 1-indexed. Prefer smallest range.
4. Never re-emit unchanged code. Never quote files outside fences.
5. M op: $funcName@sigSha6 (sigSha6 = sha6 of declaration line). $Class.method@sha6 for members.
6. IMPORTANT: Write your TW1 frame to a file named \`patch.tw1\` in the workspace root.
   The patchframe VS Code extension will auto-apply it. Do NOT show file contents in chat.`;

function buildSection(index: string): string {
  return `${MARKER_START}
${BASE_PROMPT}

## File index (id|path|sha8|loc)
${index}
${MARKER_END}`;
}

function spliceSection(existing: string, section: string): string {
  const start = existing.indexOf(MARKER_START);
  const end = existing.indexOf(MARKER_END);

  if (start !== -1 && end !== -1) {
    return existing.slice(0, start) + section + existing.slice(end + MARKER_END.length);
  }

  return existing ? `${existing}\n\n${section}\n` : `${section}\n`;
}

const CLAUDE_MD_START = '<!-- patchframe:start -->';
const CLAUDE_MD_END = '<!-- patchframe:end -->';

function buildClaudeMdSection(index: string): string {
  return `${CLAUDE_MD_START}
## patchframe — TW1 protocol

${BASE_PROMPT}

## File index (id|path|sha8|loc)
${index}
${CLAUDE_MD_END}`;
}

function spliceClaudeMd(existing: string, section: string): string {
  const start = existing.indexOf(CLAUDE_MD_START);
  const end = existing.indexOf(CLAUDE_MD_END);
  if (start !== -1 && end !== -1) {
    return existing.slice(0, start) + section + existing.slice(end + CLAUDE_MD_END.length);
  }
  return existing ? `${existing}\n\n${section}\n` : `${section}\n`;
}

export async function injectAll(workspaceRoot: string): Promise<boolean> {
  const index = await runIndex(workspaceRoot);
  if (!index) return false;

  // .cursorrules (Cursor AI)
  const rulesPath = join(workspaceRoot, '.cursorrules');
  const existingRules = existsSync(rulesPath) ? readFileSync(rulesPath, 'utf8') : '';
  writeFileSync(rulesPath, spliceSection(existingRules, buildSection(index)), 'utf8');

  // CLAUDE.md (Claude Code)
  const claudePath = join(workspaceRoot, 'CLAUDE.md');
  const existingClaude = existsSync(claudePath) ? readFileSync(claudePath, 'utf8') : '';
  writeFileSync(claudePath, spliceClaudeMd(existingClaude, buildClaudeMdSection(index)), 'utf8');

  return true;
}

export const injectCursorRules = injectAll;
