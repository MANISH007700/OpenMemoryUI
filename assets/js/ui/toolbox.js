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
import { showToast } from "./toast.js";

const GROUP_ORDER = [
  "live data",
  "knowledge",
  "utility",
  "orchestration",
  "fun",
];

function statusPill(text, tone = "") {
  return `<span class="tool-pill ${tone}">${esc(text)}</span>`;
}

function toolRow(t, source = "built-in") {
  const connected = source === "mcp";
  return `
    <div class="tool-row ${connected ? "connected" : "ready"}" data-tool-name="${esc(t.name)}" data-tool-group="${esc(t.group)}" data-tool-search="${esc(`${t.name} ${t.group} ${t.desc} ${t.example || ""}`.toLowerCase())}">
      <span class="tool-icon">${t.icon}</span>
      <div class="tool-main">
        <div class="tool-title">
          <b>${esc(t.name)}</b>
          ${statusPill(connected ? "connected MCP" : "ready now", connected ? "mcp" : "ready")}
          ${statusPill("auto-routed")}
        </div>
        <span class="tool-desc">${esc(t.desc)}</span>
        <span class="tool-meta">Use it by asking normally, or load the example and send it.</span>
      </div>
      ${t.example ? `<button class="tool-try" data-fill="${esc(t.example)}" title="Put this example in the composer">try</button>` : ""}
    </div>`;
}

function presetSection() {
  return `
    <div class="d-section tool-panel"><h4>Available MCP connectors · not connected yet</h4>
      <p class="dim">These are good server types to add when you want the agent to touch the outside world. Run or host a Streamable HTTP MCP server, paste its URL below, and its tools move into the connected section.</p>
      ${MCP_PRESETS.map(
        (p) => `
        <div class="tool-row mcp-preset offline">
          <span class="tool-icon">MCP</span>
          <div class="tool-main">
            <div class="tool-title"><b>${esc(p.name)}</b>${statusPill("not connected", "offline")}</div>
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
      <div class="tool-row connected">
        <span class="tool-icon">MCP</span>
        <div class="tool-main">
          <div class="tool-title"><b>${esc(c.name)}</b>${statusPill("connected", "mcp")}</div>
          <span class="tool-desc">${c.tools.length} remote tool(s) joined the Act-stage planner.</span>
          <span class="tool-meta">${esc(c.url)}</span>
        </div>
        <button class="tool-try danger" data-mcp-remove="${esc(c.url)}">remove</button>
      </div>`,
        )
        .join("")
    : `<div class="empty-state"><b>No MCP servers connected yet.</b><span>Built-in browser tools are ready now. Add MCP when you want authenticated systems such as GitHub, files, search, browser automation, databases, or calendar/tasks.</span></div>`;
  return `
    <div class="d-section tool-panel"><h4>Connected MCP servers</h4>
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
  const builtIns = tools.filter((t) => !t.name.startsWith("mcp:"));
  const mcpTools = tools.filter((t) => t.name.startsWith("mcp:"));
  const groups = [...new Set([...GROUP_ORDER, ...tools.map((t) => t.group)])];
  const sections = groups
    .filter((g) => builtIns.some((t) => t.group === g))
    .map(
      (g) => `
      <div class="d-section tool-panel"><h4>${esc(g)} · ${builtIns.filter((t) => t.group === g).length} ready tool(s)</h4>
        ${builtIns
          .filter((t) => t.group === g)
          .map((t) => toolRow(t, "built-in"))
          .join("")}</div>`,
    )
    .join("");
  const connectedToolHtml = mcpTools.length
    ? `<div class="d-section tool-panel"><h4>Connected remote tools · ${mcpTools.length}</h4>${mcpTools.map((t) => toolRow(t, "mcp")).join("")}</div>`
    : "";
  openDrawer(
    `Toolbox · ${tools.length} tools the agent can act with`,
    `
    <div class="tool-hero">
      <div><b>${builtIns.length}</b><span>ready now</span></div>
      <div><b>${mcpConnections().length}</b><span>MCP server(s)</span></div>
      <div><b>${mcpTools.length}</b><span>connected remote tools</span></div>
    </div>
    <div class="tool-map">
      <span>your message</span><i></i><span>stage 3 Act planner</span><i></i><span>tool agent</span><i></i><span>answer + trace</span>
    </div>
    <div class="d-section"><p class="dim">Ask naturally. If the message needs live data, math, lookup, conversion, search, or an MCP action, the Act planner selects a tool, runs it, then shows the result in the reply, the memory bus, and the full trace.</p></div>
    <div class="tool-searchbar">
      <input id="toolSearch" type="search" placeholder="Search tools by name, group or capability..." autocomplete="off" />
      <span id="toolSearchCount">${tools.length} shown</span>
    </div>
    <div class="d-section tool-panel"><h4>How to try one</h4>
      <div class="steps">
        <div><b>1</b><span>Click a try button.</span></div>
        <div><b>2</b><span>Send the loaded prompt.</span></div>
        <div><b>3</b><span>Watch the orchestrator card and full trace.</span></div>
      </div>
    </div>
    ${sections}
    ${connectedToolHtml}
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
      showToast(
        "MCP connected",
        `${conn.tools.length} remote tool(s) are now available in the Toolbox.`,
        "success",
      );
      setTimeout(openToolbox, 600); // re-render with the new server listed
    } catch (e) {
      st.textContent = `✗ ${e.message}`;
      logEvent("error", `MCP connect failed: ${esc(e.message)}`);
      showToast("MCP connection failed", e.message, "error");
    }
  });
  // onclick (not addEventListener) so re-opening the toolbox never stacks handlers
  $("#drawerBody").onclick = (e) => {
    const rm = e.target.closest("[data-mcp-remove]");
    if (rm) {
      disconnectMcp(rm.dataset.mcpRemove);
      showToast(
        "MCP disconnected",
        "Remote tools from that server were removed.",
        "info",
      );
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
