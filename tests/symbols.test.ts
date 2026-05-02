import { describe, it, expect } from "vitest";
import { findSymbol, listSymbols, detectLang } from "../src/cli/symbols.js";

// ─── detectLang ─────────────────────────────────────────────────────────────

describe("detectLang", () => {
  it("detects TypeScript", () => expect(detectLang("src/foo.ts")).toBe("ts"));
  it("detects TSX", () => expect(detectLang("src/Foo.tsx")).toBe("ts"));
  it("detects JavaScript", () => expect(detectLang("src/foo.js")).toBe("js"));
  it("detects MJS", () => expect(detectLang("src/foo.mjs")).toBe("js"));
  it("detects Python", () => expect(detectLang("src/foo.py")).toBe("py"));
  it("returns null for unknown ext", () => expect(detectLang("src/foo.go")).toBeNull());
  it("returns null for no ext", () => expect(detectLang("Makefile")).toBeNull());
});

// ─── JS symbols ─────────────────────────────────────────────────────────────

const JS_SRC = `
function greet(name) {
  return "Hello " + name;
}

const add = (a, b) => a + b;

class Calculator {
  multiply(x, y) {
    return x * y;
  }
}
`.trimStart();

describe("listSymbols (JS)", () => {
  it("lists top-level symbols", () => {
    const names = listSymbols(JS_SRC, "js");
    expect(names).toContain("greet");
    expect(names).toContain("add");
    expect(names).toContain("Calculator");
  });
});

describe("findSymbol (JS)", () => {
  it("finds a function declaration", () => {
    const loc = findSymbol(JS_SRC, "js", "greet");
    expect(loc).not.toBeNull();
    expect(loc!.startLine).toBe(1);
    expect(loc!.endLine).toBe(3);
    expect(loc!.sigSha6).toHaveLength(6);
  });

  it("finds an arrow function (const assignment)", () => {
    const loc = findSymbol(JS_SRC, "js", "add");
    expect(loc).not.toBeNull();
    expect(loc!.startLine).toBe(5);
  });

  it("finds a class method via dot notation", () => {
    const loc = findSymbol(JS_SRC, "js", "Calculator.multiply");
    expect(loc).not.toBeNull();
    expect(loc!.startLine).toBeGreaterThan(7);
  });

  it("returns null for unknown symbol", () => {
    expect(findSymbol(JS_SRC, "js", "nonexistent")).toBeNull();
  });

  it("sigSha6 is stable across calls", () => {
    const a = findSymbol(JS_SRC, "js", "greet");
    const b = findSymbol(JS_SRC, "js", "greet");
    expect(a!.sigSha6).toBe(b!.sigSha6);
  });
});

// ─── TypeScript symbols ──────────────────────────────────────────────────────

const TS_SRC = `
export function parseValue(raw: string): number {
  return parseInt(raw, 10);
}

export class Formatter {
  format(value: number): string {
    return String(value);
  }
}
`.trimStart();

describe("findSymbol (TS)", () => {
  it("finds exported function", () => {
    const loc = findSymbol(TS_SRC, "ts", "parseValue");
    expect(loc).not.toBeNull();
    expect(loc!.startLine).toBe(1);
  });

  it("finds exported class", () => {
    const loc = findSymbol(TS_SRC, "ts", "Formatter");
    expect(loc).not.toBeNull();
  });

  it("finds class method via dot notation", () => {
    const loc = findSymbol(TS_SRC, "ts", "Formatter.format");
    expect(loc).not.toBeNull();
  });
});

// ─── Python symbols ──────────────────────────────────────────────────────────

const PY_SRC = `
def greet(name):
    return f"Hello {name}"

class Calc:
    def add(self, a, b):
        return a + b
`.trimStart();

describe("findSymbol (Python)", () => {
  it("finds a top-level function", () => {
    const loc = findSymbol(PY_SRC, "py", "greet");
    expect(loc).not.toBeNull();
    expect(loc!.startLine).toBe(1);
  });

  it("finds a class", () => {
    const loc = findSymbol(PY_SRC, "py", "Calc");
    expect(loc).not.toBeNull();
  });

  it("finds a method via dot notation", () => {
    const loc = findSymbol(PY_SRC, "py", "Calc.add");
    expect(loc).not.toBeNull();
    expect(loc!.startLine).toBeGreaterThan(3);
  });

  it("returns null for unknown symbol", () => {
    expect(findSymbol(PY_SRC, "py", "unknown")).toBeNull();
  });
});
