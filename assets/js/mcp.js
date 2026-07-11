/* Minimal MCP (Model Context Protocol) client over Streamable HTTP.
   Connect any remote MCP server by URL; its tools join the toolbox and
   the planner can route to them. The server must allow browser CORS -
   that is a property of the server, not of this client. */

import { settings, persistSettings } from "./state.js";
import { esc } from "./utils.js";
import { logEvent } from "./ui/log.js";

const connections = new Map(); // url -> {url, name, sessionId, tools: [...]}
let rpcId = 0;

export const MCP_PRESETS = [
  {
    name: "Browser automation MCP",
    transport: "remote HTTP or local bridge",
    tools: "open pages, click, scrape, screenshot, verify UI",
    bestFor: "real-world web tasks and local app testing",
  },
  {
    name: "GitHub MCP",
    transport: "remote HTTP with GitHub auth",
    tools: "issues, PRs, commits, repo search, code review helpers",
    bestFor: "turning chat requests into repository actions",
  },
  {
    name: "Filesystem MCP",
    transport: "local bridge",
    tools: "read, write, search and organize local files",
    bestFor: "personal knowledge work and project automation",
  },
  {
    name: "Database MCP",
    transport: "remote HTTP or local bridge",
    tools: "query SQL tables, inspect schemas, run analytics",
    bestFor: "memory-backed agents that need structured data",
  },
  {
    name: "Search/RAG MCP",
    transport: "remote HTTP",
    tools: "web search, document search, vector retrieval",
    bestFor: "grounded answers over fresh or private sources",
  },
  {
    name: "Calendar/tasks MCP",
    transport: "remote HTTP with user auth",
    tools: "create events, list tasks, schedule reminders",
    bestFor: "safe real-world action after user confirmation",
  },
];

function parseBody(text) {
  // Streamable HTTP responses are either plain JSON or an SSE stream of
  // `data:` lines - take the last data payload in that case.
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("["))
    return JSON.parse(trimmed);
  const datas = trimmed
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim());
  if (!datas.length) throw new Error("empty MCP response");
  return JSON.parse(datas[datas.length - 1]);
}

async function rpc(conn, method, params, isNotification = false) {
  const body = { jsonrpc: "2.0", method, params };
  if (!isNotification) body.id = ++rpcId;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (conn.sessionId) headers["Mcp-Session-Id"] = conn.sessionId;
  const res = await fetch(conn.url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const sid = res.headers.get("mcp-session-id");
  if (sid) conn.sessionId = sid;
  if (isNotification) return null;
  if (!res.ok) throw new Error(`MCP server replied ${res.status}`);
  const msg = parseBody(await res.text());
  if (msg.error) throw new Error(msg.error.message || "MCP error");
  return msg.result;
}

export async function connectMcp(url) {
  const conn = { url, name: new URL(url).hostname, sessionId: null, tools: [] };
  const init = await rpc(conn, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "memory-glassbox", version: "1.0" },
  });
  conn.name = init?.serverInfo?.name || conn.name;
  await rpc(conn, "notifications/initialized", {}, true).catch(() => {});
  const list = await rpc(conn, "tools/list", {});
  conn.tools = (list?.tools || []).map((t) => ({
    name: `mcp:${t.name}`,
    icon: "🔌",
    group: `mcp · ${conn.name}`,
    desc: (t.description || "").slice(0, 140) || "remote MCP tool",
    example: `use mcp:${t.name} ...`,
    args: Object.fromEntries(
      Object.entries(t.inputSchema?.properties || {}).map(([k, v]) => [
        k,
        v.description || v.type || "",
      ]),
    ),
    _conn: conn.url,
    _raw: t.name,
  }));
  connections.set(url, conn);
  if (!settings.mcpServers.includes(url)) {
    settings.mcpServers.push(url);
    persistSettings();
  }
  logEvent(
    "info",
    `MCP connected: ${esc(conn.name)} - ${conn.tools.length} tool(s) added to the toolbox`,
  );
  return conn;
}

export function disconnectMcp(url) {
  const conn = connections.get(url);
  connections.delete(url);
  settings.mcpServers = settings.mcpServers.filter((u) => u !== url);
  persistSettings();
  if (conn) logEvent("info", `MCP disconnected: ${esc(conn.name)}`);
}

export function mcpConnections() {
  return [...connections.values()];
}

export function mcpToolList() {
  return [...connections.values()].flatMap((c) => c.tools);
}

export async function callMcpTool(name, args) {
  const tool = mcpToolList().find((t) => t.name === name);
  if (!tool) throw new Error(`MCP tool "${name}" is not connected`);
  const conn = connections.get(tool._conn);
  const result = await rpc(conn, "tools/call", {
    name: tool._raw,
    arguments: args || {},
  });
  const text = (result?.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .slice(0, 600);
  if (result?.isError) throw new Error(text || "MCP tool reported an error");
  return { summary: text || "(MCP tool returned no text)" };
}

/* Silently reconnect saved servers on boot. */
export function initMcp() {
  for (const url of settings.mcpServers || []) {
    connectMcp(url).catch((e) =>
      logEvent(
        "error",
        `MCP reconnect failed for ${esc(url)}: ${esc(e.message)}`,
      ),
    );
  }
}
