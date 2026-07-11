/* Renderers for the four memory panels and the context-window budget bar. */

import { TOKEN_BUDGET } from "../config.js";
import { memory, runtime } from "../state.js";
import { $, esc, fmtTime } from "../utils.js";

export function kindClass(k) {
  return (
    {
      fact: "fact",
      preference: "preference",
      skill: "skill",
      episode: "episode",
    }[k] || "fact"
  );
}

export function renderSession() {
  const body = $("#body-session");
  if (!memory.session.length) {
    body.innerHTML = `<div class="empty-note">Empty. Your next message lands here first: raw, verbatim, short-lived.</div>`;
  } else {
    body.innerHTML = memory.session
      .map(
        (t) => `
      <div class="mem-item" data-open="session:${t.id}">
        <div class="mi-top">
          <span class="kind ${t.role === "user" ? "turn-user" : "turn-agent"}">${t.role === "user" ? "you" : "agent"}</span>
          <span class="mi-when">${fmtTime(t.at)} · ~${t.tokens} tok</span>
        </div>
        <div class="mi-content">${esc(t.content.length > 140 ? t.content.slice(0, 140) + "…" : t.content)}</div>
      </div>`,
      )
      .join("");
  }
  $("#count-session").textContent = memory.session.length;
  const used = memory.session.reduce((a, t) => a + t.tokens, 0);
  const pct = Math.min(100, (used / TOKEN_BUDGET) * 100);
  $("#budgetBar i").style.width = pct + "%";
  $("#budgetBar i").style.background =
    pct > 85 ? "var(--danger)" : "var(--session)";
  $("#budgetText").textContent =
    `${used.toLocaleString()} / ${TOKEN_BUDGET.toLocaleString()} tokens`;
  body.scrollTop = body.scrollHeight;
}

function itemCard(item, extra = "") {
  return `
    <div class="mem-item" data-open="item:${item.id}" id="card-${item.id}">
      <div class="mi-top">
        <span class="kind ${kindClass(item.kind)}">${item.kind}</span>
        <span class="mi-when">${fmtTime(item.updatedAt)}</span>
      </div>
      <div class="mi-content">${esc(item.content)}</div>
      <div class="mi-foot">
        <span>recalled ${item.retrievals.length}x</span>
        ${item.history.length ? `<span>updated ${item.history.length}x</span>` : ""}
      </div>
      ${extra}
    </div>`;
}

export function renderEpisodic() {
  const body = $("#body-episodic");
  const items = [...memory.episodic].sort((a, b) => b.updatedAt - a.updatedAt);
  body.innerHTML = items.length
    ? items.map((i) => itemCard(i)).join("")
    : `<div class="empty-note">No episodes yet. Each exchange is journaled here as a time-stamped event.</div>`;
  $("#count-episodic").textContent = memory.episodic.length;
}

export function renderSemantic() {
  const body = $("#body-semantic");
  const order = { fact: 0, preference: 1, skill: 2 };
  const items = [...memory.semantic].sort(
    (a, b) => order[a.kind] - order[b.kind] || b.updatedAt - a.updatedAt,
  );
  body.innerHTML = items.length
    ? items.map((i) => itemCard(i)).join("")
    : `<div class="empty-note">Nothing learned yet. Tell the agent about yourself and watch facts crystallize here.</div>`;
  $("#count-semantic").textContent = memory.semantic.length;
}

export function renderContextual() {
  const body = $("#body-contextual");
  const contextual = runtime.contextual;
  body.innerHTML = contextual.length
    ? contextual
        .map(
          (r) => `
      <div class="mem-item" data-open="item:${r.item.id}">
        <div class="mi-top">
          <span class="kind ${kindClass(r.item.kind)}">${r.item.kind}</span>
          <span class="mi-when">score ${r.score}</span>
        </div>
        <div class="mi-content">${esc(r.item.content)}</div>
        <div class="mi-foot">
          <span>from ${r.item.type} memory</span>
          ${r.matched.length ? `<span>matched: ${esc(r.matched.slice(0, 5).join(", "))}</span>` : `<span>recall-all boost</span>`}
        </div>
        <div class="score-bar"><i style="width:${Math.min(100, r.score * 100)}%"></i></div>
      </div>`,
        )
        .join("")
    : `<div class="empty-note">Nothing retrieved yet. When you send a message, the agent searches its long-term stores and the winners appear here with their relevance scores.</div>`;
  $("#count-contextual").textContent = contextual.length;
}

export function renderAll() {
  renderSession();
  renderEpisodic();
  renderSemantic();
  renderContextual();
}
