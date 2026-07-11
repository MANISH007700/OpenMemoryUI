/* The toolbox drawer: every tool the agent can reach during the Act stage,
   grouped and clickable (each example fills the composer), plus the MCP
   connector for adding remote tool servers. */

import { allTools } from "../tools.js";
import {
  MCP_PRESETS,
  connectMcp,
  disconnectMcp,
  mcpConnections,
} from "../mcp.js";
import { settings } from "../state.js";
import { $, esc } from "../utils.js";
import { openDrawer, closeDrawer } from "./drawer.js";
import { logEvent } from "./log.js";

const GROUP_ORDER = [
  "live data",
  "knowledge",
  "utility",
  "orchestration",
  "fun",
];

function toolRow(t) {
  return `
    <div class="tool-row" data-tool-name="${esc(t.name)}" data-tool-group="${esc(t.group)}" data-tool-search="${esc(`${t.name} ${t.group} ${t.desc} ${t.example || ""}`.toLowerCase())}">
      <span class="tool-icon">${t.icon}</span>
      <div class="tool-main">
        <b>${esc(t.name)}</b>
        <span class="tool-desc">${esc(t.desc)}</span>
      </div>
      ${t.example ? `<button class="tool-try" data-fill="${esc(t.example)}" title="Put this example in the composer">try</button>` : ""}
    </div>`;
}

function presetSection() {
  return `
    <div class="d-section"><h4>MCP server presets · good next connectors</h4>
      <p class="dim">Static Netlify pages cannot spawn stdio servers directly, so Memory Glassbox speaks MCP over Streamable HTTP. Run a bridge or remote MCP server for one of these presets, paste its URL below, and its tools join the same Act-stage planner.</p>
      ${MCP_PRESETS.map(
        (p) => `
        <div class="tool-row mcp-preset">
          <span class="tool-icon">🔌</span>
          <div class="tool-main">
            <b>${esc(p.name)}</b>
            <span class="tool-desc">${esc(p.bestFor)}</span>
            <span class="tool-meta">${esc(p.transport)} · ${esc(p.tools)}</span>
          </div>
        </div>`,
      ).join("")}
    </div>`;
}

function mcpSection() {
  const conns = mcpConnections();
  const list = conns.length
    ? conns
        .map(
          (c) => `
      <div class="tool-row">
        <span class="tool-icon">🔌</span>
        <div class="tool-main"><b>${esc(c.name)}</b>
          <span class="tool-desc">${c.tools.length} tool(s) · ${esc(c.url)}</span></div>
        <button class="tool-try danger" data-mcp-remove="${esc(c.url)}">remove</button>
      </div>`,
        )
        .join("")
    : `<p class="dim">No MCP servers connected. Paste the URL of any remote MCP server (Streamable HTTP) and its tools join this toolbox. The server must allow browser CORS.</p>`;
  return `
    <div class="d-section"><h4>MCP servers · bring your own tools</h4>
      ${list}
      <div class="mcp-add">
        <input type="text" id="mcpUrl" placeholder="https://example.com/mcp" spellcheck="false" />
        <button class="tbtn" id="mcpConnect">connect</button>
        <span id="mcpStatus" class="dim"></span>
      </div>
      <p class="dim" style="margin-top:6px">MCP tools are invoked like any other: the live-mode planner routes to them automatically, or type
      <span class="mono-hint">use mcp:&lt;tool&gt; &lt;input&gt;</span> in any mode. Before a remote MCP call runs, the browser asks you to confirm.</p></div>`;
}

export function openToolbox() {
  const tools = allTools();
  const groups = [...new Set([...GROUP_ORDER, ...tools.map((t) => t.group)])];
  const sections = groups
    .filter((g) => tools.some((t) => t.group === g))
    .map(
      (g) => `
      <div class="d-section"><h4>${esc(g)} · ${tools.filter((t) => t.group === g).length} tool(s)</h4>
        ${tools
          .filter((t) => t.group === g)
          .map(toolRow)
          .join("")}</div>`,
    )
    .join("");
  openDrawer(
    `Toolbox · ${tools.length} tools the agent can act with`,
    `
    <div class="d-section"><p class="dim">During stage 3 (<b>Act</b>) a planner reads your message and decides which of
    these to call - regex routing in demo mode, an LLM router in live mode. Every call, its arguments and its result are
    logged on the memory bus and recorded in the turn trace. Click <b>try</b> to load an example prompt.</p></div>
    <div class="tool-searchbar">
      <input id="toolSearch" type="search" placeholder="Search tools by name, group or capability..." autocomplete="off" />
      <span id="toolSearchCount">${tools.length} shown</span>
    </div>
    ${sections}
    ${presetSection()}
    ${mcpSection()}`,
    true,
  );
  wireMcpControls();
  wireToolSearch(tools.length);
}

function wireMcpControls() {
  $("#mcpConnect")?.addEventListener("click", async () => {
    const url = $("#mcpUrl").value.trim();
    if (!url) return;
    const st = $("#mcpStatus");
    st.textContent = "connecting…";
    try {
      const conn = await connectMcp(url);
      st.textContent = `✓ ${conn.tools.length} tool(s) added`;
      setTimeout(openToolbox, 600); // re-render with the new server listed
    } catch (e) {
      st.textContent = `✗ ${e.message}`;
      logEvent("error", `MCP connect failed: ${esc(e.message)}`);
    }
  });
  // onclick (not addEventListener) so re-opening the toolbox never stacks handlers
  $("#drawerBody").onclick = (e) => {
    const rm = e.target.closest("[data-mcp-remove]");
    if (rm) {
      disconnectMcp(rm.dataset.mcpRemove);
      openToolbox();
    }
  };
}

function wireToolSearch(total) {
  const input = $("#toolSearch");
  const count = $("#toolSearchCount");
  if (!input || !count) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll(".tool-row[data-tool-search]").forEach((row) => {
      const hit = !q || row.dataset.toolSearch.includes(q);
      row.hidden = !hit;
      if (hit) shown++;
    });
    count.textContent = `${shown} / ${total} shown`;
  });
}
