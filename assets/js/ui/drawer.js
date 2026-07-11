/* The provenance drawer: memory item details, session turns, panel
   explainers, and the prompt x-ray. */

import { EXPLAINERS, PROVIDERS } from "../config.js";
import { memory, settings, runtime, currentModel } from "../state.js";
import { $, esc, fmtFull } from "../utils.js";
import { dumpPrompt } from "../llm.js";

export function openDrawer(title, bodyHtml, wide = false) {
  $("#drawer").classList.toggle("wide", wide);
  $("#drawerTitle").textContent = title;
  $("#drawerBody").innerHTML = bodyHtml;
  $("#overlay").classList.add("open");
  $("#drawer").classList.add("open");
}

export function closeDrawer() {
  $("#overlay").classList.remove("open");
  $("#drawer").classList.remove("open");
}

export function openExplainer(key) {
  const ex = EXPLAINERS[key];
  if (!ex) return;
  const body = ex.sections
    .map((s) => `<div class="d-section"><h4>${s.heading}</h4>${s.html}</div>`)
    .join("");
  openDrawer(ex.title, body);
}

export function openItem(id) {
  const item = [...memory.semantic, ...memory.episodic].find(
    (i) => i.id === id,
  );
  if (!item) return;
  const typeName = item.type === "semantic" ? "Semantic" : "Episodic";
  const historyHtml = item.history.length
    ? item.history
        .map(
          (h) => `
        <div class="d-history-item">
          <div class="h-when">${fmtFull(h.at)} - ${esc(h.why)}</div>
          <div>was: "${esc(h.prev)}"</div>
        </div>`,
        )
        .join("")
    : `<p class="dim">Never updated - still the original version.</p>`;
  const retrievalsHtml = item.retrievals.length
    ? item.retrievals
        .slice(-6)
        .reverse()
        .map(
          (r) => `
        <div class="d-history-item">
          <div class="h-when">${fmtFull(r.at)} · score ${r.score}${r.matched?.length ? " · matched: " + esc(r.matched.join(", ")) : ""}</div>
          <div class="dim">query: "${esc(r.query)}"</div>
        </div>`,
        )
        .join("")
    : `<p class="dim">Never retrieved yet. It will surface when a future message resembles it.</p>`;
  openDrawer(
    `${typeName} · ${item.kind}`,
    `
    <div class="d-section"><h4>Stored memory</h4>
      <p style="font-size:15px">${esc(item.content)}</p></div>
    <div class="d-section"><h4>Why it was stored</h4>
      <p>${esc(item.reason)}</p></div>
    <div class="d-section"><h4>Source - the message it came from</h4>
      <div class="d-quote">${esc(item.source)}</div></div>
    <div class="d-section"><h4>How it was stored</h4>
      <p class="dim">${
        item.type === "semantic"
          ? "Pipeline stage 4 (Extract) analyzed the exchange and emitted this as a durable " +
            item.kind +
            ". Stage 5 (Write) committed it to the semantic store in this browser's localStorage, where it survives sessions and reloads."
          : "Pipeline stage 5 (Write) journals every exchange as an event. Episodes keep the when and what of the conversation even when no facts were extracted."
      }</p></div>
    <div class="d-section"><h4>Record</h4>
      <div class="d-kv">
        <span class="k">id</span><span class="v">${item.id}</span>
        <span class="k">type</span><span class="v">${item.type} / ${item.kind}</span>
        <span class="k">created</span><span class="v">${fmtFull(item.createdAt)}</span>
        <span class="k">updated</span><span class="v">${fmtFull(item.updatedAt)}</span>
        <span class="k">importance</span><span class="v">${item.importance}</span>
        <span class="k">times recalled</span><span class="v">${item.retrievals.length}</span>
      </div></div>
    <div class="d-section"><h4>Edit history</h4>${historyHtml}</div>
    <div class="d-section"><h4>Retrieval history</h4>${retrievalsHtml}</div>
    <div class="d-section"><h4>Your data, your call</h4>
      <button class="tbtn danger" data-forget="${item.id}">forget this memory</button>
      <p class="dim" style="margin-top:6px">Removes it permanently from the ${item.type} store. The agent will genuinely no longer know this.</p></div>`,
  );
}

export function openSessionTurn(id) {
  const t = memory.session.find((x) => x.id === id);
  if (!t) return;
  openDrawer(
    "Session memory · turn",
    `
    <div class="d-section"><h4>Verbatim content</h4>
      <div class="d-quote">${esc(t.content)}</div></div>
    <div class="d-section"><h4>Why it is here</h4>
      <p>This is raw working memory. The turn was appended to the context window the moment it
      happened - no analysis, no filtering, no compression. It is stored so the model can see
      the conversation so far on the next request.</p></div>
    <div class="d-section"><h4>What happens to it</h4>
      <p class="dim">It is re-sent to the model on every turn (costing ~${t.tokens} tokens each time)
      until the session ends. It will NOT survive "end session" - only whatever the
      extraction stage saved to episodic/semantic memory will.</p></div>
    <div class="d-section"><h4>Record</h4>
      <div class="d-kv">
        <span class="k">role</span><span class="v">${t.role}</span>
        <span class="k">at</span><span class="v">${fmtFull(t.at)}</span>
        <span class="k">est. tokens</span><span class="v">${t.tokens}</span>
      </div></div>`,
  );
}

export function openXray() {
  if (!runtime.lastPrompt) {
    openDrawer(
      "Prompt x-ray",
      `<div class="d-section"><p class="dim">No prompt captured yet. Send a message first, then come back - you will see the exact messages array sent to the model, with retrieved memories highlighted inside it.</p></div>`,
    );
    return;
  }
  const dump = dumpPrompt(runtime.lastPrompt);
  openDrawer(
    "Prompt x-ray · last turn",
    `
    <div class="d-section"><h4>What this is</h4>
      <p>The exact messages array sent to the ${settings.mode === "live" ? "model via " + PROVIDERS[settings.provider].label : "demo model"} on the last turn.
      Notice the RETRIEVED MEMORIES block inside the system message - that is contextual memory doing its job,
      and the conversation turns below it are session memory being replayed.</p></div>
    <div class="d-section"><h4>Messages</h4>
      <pre class="promptdump">${esc(dump)}</pre></div>
    ${
      runtime.lastExtractRaw
        ? `<div class="d-section"><h4>Raw extraction output (stage 4)</h4>
      <pre class="promptdump">${esc(runtime.lastExtractRaw)}</pre></div>`
        : ""
    }`,
  );
}
