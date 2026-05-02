import { describe, it, expect } from "vitest";
import { parseTW1, sha6, ParseError } from "../src/cli/parse.js";

describe("sha6", () => {
  it("hashes line deterministically", () => {
    const h = sha6("def total(xs):");
    expect(h).toHaveLength(6);
    expect(h).toMatch(/^[0-9a-f]{6}$/);
    expect(sha6("def total(xs):")).toBe(h);
  });

  it("ignores trailing whitespace", () => {
    expect(sha6("hello")).toBe(sha6("hello   "));
  });
});

describe("parseTW1", () => {
  it("rejects missing TW1 header", () => {
    expect(() => parseTW1("R a @1/abc123..@2/def456\n```\nfoo\n```")).toThrow(ParseError);
  });

  it("rejects empty frame", () => {
    expect(() => parseTW1("TW1\n")).toThrow(ParseError);
  });

  it("parses R op", () => {
    const frame = parseTW1("TW1\nR a @42/9c1f0d..@44/2b8e11\n```\nnew line\n```");
    expect(frame.ops).toHaveLength(1);
    const op = frame.ops[0];
    expect(op.code).toBe("R");
    if (op.code === "R") {
      expect(op.fid).toBe("a");
      expect(op.from.line).toBe(42);
      expect(op.from.sha6).toBe("9c1f0d");
      expect(op.to.line).toBe(44);
      expect(op.payload).toBe("new line");
    }
  });

  it("parses I op", () => {
    const frame = parseTW1("TW1\nI b @10/4a2c91\n```\nimport x\n```");
    expect(frame.ops).toHaveLength(1);
    const op = frame.ops[0];
    expect(op.code).toBe("I");
    if (op.code === "I") {
      expect(op.fid).toBe("b");
      expect(op.after.line).toBe(10);
      expect(op.payload).toBe("import x");
    }
  });

  it("parses D op", () => {
    const frame = parseTW1("TW1\nD c @5/aabbcc..@7/ddeeff");
    expect(frame.ops).toHaveLength(1);
    expect(frame.ops[0].code).toBe("D");
  });

  it("parses + op", () => {
    const frame = parseTW1("TW1\n+ 'src/new.ts'\n```\nexport const x = 1;\n```");
    expect(frame.ops).toHaveLength(1);
    const op = frame.ops[0];
    expect(op.code).toBe("+");
    if (op.code === "+") {
      expect(op.path).toBe("src/new.ts");
      expect(op.payload).toBe("export const x = 1;");
    }
  });

  it("parses - op", () => {
    const frame = parseTW1("TW1\n- d");
    expect(frame.ops[0].code).toBe("-");
  });

  it("parses MV op", () => {
    const frame = parseTW1("TW1\nMV e 'src/renamed.ts'");
    const op = frame.ops[0];
    expect(op.code).toBe("MV");
    if (op.code === "MV") expect(op.newPath).toBe("src/renamed.ts");
  });

  it("parses multi-op frame", () => {
    const input = [
      "TW1",
      "R a @1/111111..@2/222222",
      "```",
      "line1",
      "line2",
      "```",
      "- b",
      "+ 'src/new.js'",
      "```",
      "const x = 1;",
      "```",
    ].join("\n");
    const frame = parseTW1(input);
    expect(frame.ops).toHaveLength(3);
    expect(frame.ops.map((o) => o.code)).toEqual(["R", "-", "+"]);
  });

  it("throws on unterminated fence", () => {
    expect(() => parseTW1("TW1\nR a @1/aabbcc..@2/ddeeff\n```\nno close")).toThrow(ParseError);
  });

  it("throws on unknown op", () => {
    expect(() => parseTW1("TW1\nX a @1/aabbcc")).toThrow(ParseError);
  });

  it("ignores blank lines and comments", () => {
    const frame = parseTW1("TW1\n\n# comment\nD a @1/aabbcc..@2/ddeeff");
    expect(frame.ops).toHaveLength(1);
  });
});
