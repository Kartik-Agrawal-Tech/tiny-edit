# Contributing to tiny-edit

## Getting started

```bash
git clone https://github.com/Kartik-Agrawal-Tech/tiny-edit.git
cd tiny-edit
npm install
npm run build
npm test        # 53 tests must pass
```

## Workflow

1. Fork the repo and create a branch (`feat/my-thing` or `fix/issue-42`).
2. Write tests first — see `tests/` for existing patterns (vitest, AAA style).
3. Keep coverage ≥ 80%. Run `npm test` before pushing.
4. Open a PR with a clear description of what and why.

## Code style

- TypeScript strict mode. No `any`. Explicit types on all exports.
- No `console.log` in library code (only in `src/cli/index.ts`).
- Functions < 50 lines. Files < 800 lines.
- Immutable patterns — no in-place mutation.
- Commit style: `feat:`, `fix:`, `test:`, `refactor:`, `docs:`.

## Reporting bugs

Open an issue at <https://github.com/Kartik-Agrawal-Tech/tiny-edit/issues> with:
- Node.js version
- OS
- Exact command run
- Expected vs actual output
