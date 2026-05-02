import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { resolve } from "node:path";
import { parseTW1, ParseError } from "../cli/parse.js";
import { applyFrame } from "../cli/apply.js";
import { buildIndex, formatIndex } from "../cli/index-files.js";
import { recordApply, loadMetrics, summarize, formatSummary } from "../cli/metrics.js";
import { formatError, parseError } from "../cli/errors.js";

const server = new Server(
  { name: "tiny-edit", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "tw1_apply",
      description:
        "Apply a TW1 frame — compact code edit DSL. " +
        "Replaces, inserts, deletes, creates, renames, or rewrites-by-symbol. " +
        "Returns { ok, written[], savedTokens, savedPct } or { ok:false, errors[] }.",
      inputSchema: {
        type: "object",
        properties: {
          frame: {
            type: "string",
            description: "Full TW1 frame string starting with 'TW1' on the first line.",
          },
          root: {
            type: "string",
            description: "Workspace root path. Defaults to current working directory.",
          },
        },
        required: ["frame"],
      },
    },
    {
      name: "tw1_index",
      description:
        "Return the current file index for the workspace in id|path|sha8|loc format. " +
        "Inject this into your system prompt once per session.",
      inputSchema: {
        type: "object",
        properties: {
          root: {
            type: "string",
            description: "Workspace root path. Defaults to current working directory.",
          },
        },
      },
    },
    {
      name: "tw1_stats",
      description: "Return cumulative token savings dashboard for the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          root: { type: "string" },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const root = resolve((args?.root as string | undefined) ?? process.cwd());

  if (name === "tw1_apply") {
    const frame = args?.frame as string | undefined;
    if (!frame) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, errors: [{ code: "E_PARSE", detail: "frame is required" }] }) }] };
    }

    let parsed;
    try {
      parsed = parseTW1(frame);
    } catch (err) {
      const detail = err instanceof ParseError ? err.message : String(err);
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, errors: [{ code: "E_PARSE", detail }] }) }] };
    }

    const index = await buildIndex(root);
    const result = applyFrame(parsed.ops, index);

    if (result.ok) {
      const entry = recordApply(root, frame, result.captures);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ok: true,
            written: result.written,
            savedTokens: entry.savedTokens,
            savedPct: entry.savedPct,
          }),
        }],
      };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: false,
          errors: result.errors.map(e => ({ code: e.code, detail: formatError(e) })),
        }),
      }],
    };
  }

  if (name === "tw1_index") {
    const index = await buildIndex(root);
    return { content: [{ type: "text", text: formatIndex(index) }] };
  }

  if (name === "tw1_stats") {
    const entries = loadMetrics(root);
    const summary = summarize(entries);
    return { content: [{ type: "text", text: formatSummary(summary) }] };
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
});

export async function startMcpServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
