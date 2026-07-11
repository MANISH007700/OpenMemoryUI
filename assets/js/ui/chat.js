/* Chat column: message bubbles and the clickable provenance chips under them. */

import { $, esc } from "../utils.js";

export function addChatMsg(role, content, chips = []) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
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
