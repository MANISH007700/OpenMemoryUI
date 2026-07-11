/* Chat column: message bubbles and the clickable provenance chips under them. */

import { $, esc } from "../utils.js";

export function addChatMsg(role, content, chips = []) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
  if (role === "agent") {
    wrap.classList.add("just-arrived");
    window.setTimeout(() => wrap.classList.remove("just-arrived"), 1800);
  }
  const chipHtml = chips
    .map(
      (c) =>
        `<span class="chip w-${c.type}" data-open="${c.open || ""}" title="${esc(c.title || "")}">${esc(c.label)}</span>`,
    )
    .join("");
  wrap.innerHTML = `
    <div class="who">${role === "user" ? "you" : role === "agent" ? "agent" : "system"}</div>
    <div class="bubble">${esc(content)}</div>
    ${chipHtml ? `<div class="meta-chips">${chipHtml}</div>` : ""}`;
  $("#chatScroll").appendChild(wrap);
  $("#chatScroll").scrollTop = $("#chatScroll").scrollHeight;
  return wrap;
}

export function addChipsTo(msgEl, chips) {
  let row = $(".meta-chips", msgEl);
  if (!row) {
    row = document.createElement("div");
    row.className = "meta-chips";
    msgEl.appendChild(row);
  }
  chips.forEach((c) => {
    const span = document.createElement("span");
    span.className = `chip w-${c.type}`;
    span.dataset.open = c.open || "";
    span.title = c.title || "";
    span.textContent = c.label;
    row.appendChild(span);
  });
}

export function clearHero() {
  $("#hero")?.remove();
}

/* The orchestrator card: shows the planner's decision and each tool agent
   working in real time during the Act stage. */
export function addAgentActivity(calls) {
  const wrap = document.createElement("div");
  wrap.className = "msg orchestrator";
  wrap.innerHTML = `
    <div class="who">orchestrator</div>
    <div class="orch">
      <div class="orch-row"><span class="o-icon">🧭</span><b>planner</b>
        <span class="o-note">routed to ${calls.length} tool agent(s)</span>
        <span class="o-status done">✓</span></div>
      ${calls
        .map(
          (c, i) => `
      <div class="orch-row" data-call="${i}">
        <span class="o-icon">🛠</span><b>${esc(c.tool)}</b>
        <span class="o-note">${esc(
          Object.values(c.args || {})
            .join(", ")
            .slice(0, 60),
        )}</span>
        <span class="o-status pending">queued</span>
        <div class="o-result"></div>
      </div>`,
        )
        .join("")}
    </div>`;
  $("#chatScroll").appendChild(wrap);
  $("#chatScroll").scrollTop = $("#chatScroll").scrollHeight;
  return wrap;
}

export function setActivity(el, i, status, text) {
  const row = $(`[data-call="${i}"]`, el);
  if (!row) return;
  const st = $(".o-status", row);
  st.className = `o-status ${status}`;
  st.textContent =
    status === "running" ? "running…" : status === "done" ? "✓" : "✗ failed";
  if (text) $(".o-result", row).textContent = text;
  $("#chatScroll").scrollTop = $("#chatScroll").scrollHeight;
}
