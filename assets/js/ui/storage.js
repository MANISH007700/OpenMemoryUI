/* The "db" meter: how much of localStorage the glassbox is using, what
   fills each store, and what deletes from it. Makes memory pressure -
   filling up AND clearing out - visible instead of implied. */

import { STORE_KEY, SETTINGS_KEY, TRACE_CAP, STORE_COLORS } from "../config.js";
import { memory } from "../state.js";
import { $ } from "../utils.js";
import { openDrawer } from "./drawer.js";

const bytes = (obj) => new Blob([JSON.stringify(obj)]).size;
const fmtKB = (b) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`);

export function updateDbMeter() {
  const total =
    (localStorage.getItem(STORE_KEY) || "").length +
    (localStorage.getItem(SETTINGS_KEY) || "").length;
  $("#dbSize").textContent = fmtKB(total);
}

export function openStorage() {
  const rows = [
    {
      key: "session",
      label: "session turns",
      color: STORE_COLORS.session,
      n: memory.session.length,
      b: bytes(memory.session),
    },
    {
      key: "episodic",
      label: "episodes",
      color: STORE_COLORS.episodic,
      n: memory.episodic.length,
      b: bytes(memory.episodic),
    },
    {
      key: "semantic",
      label: "semantic items",
      color: STORE_COLORS.semantic,
      n: memory.semantic.length,
      b: bytes(memory.semantic),
    },
    {
      key: "traces",
      label: "turn traces",
      color: "#8ca0b3",
      n: memory.traces.length,
      b: bytes(memory.traces),
    },
  ];
  const total = rows.reduce((a, r) => a + r.b, 0) || 1;
  const barRows = rows
    .map(
      (r) => `
    <div class="f-row">
      <span class="f-label">${r.label}</span>
      <span class="f-bar"><i style="width:${Math.max((r.b / total) * 100, 2)}%; background:${r.color}"></i></span>
      <span class="f-n">${r.n} · ${fmtKB(r.b)}</span>
    </div>`,
    )
    .join("");
  openDrawer(
    "Storage · what fills up, what gets deleted",
    `
    <div class="d-section"><h4>Where memory physically lives</h4>
      <p>Everything is plain JSON in this browser's <b>localStorage</b> - no server, no cloud.
      Right now the glassbox is using <b>${fmtKB(total)}</b> of a ~5&nbsp;MB browser quota.</p>
      <div class="funnel">${barRows}</div></div>

    <div class="d-section"><h4>What fills it up</h4>
      <p class="dim">· Every chat turn is appended to <b>session</b> verbatim.<br>
      · Every exchange journals one <b>episode</b>.<br>
      · Extraction writes durable <b>semantic</b> items (facts / preferences / skills).<br>
      · Every turn stores a full <b>trace</b> (scores, prompt, extraction output) - the heaviest record here.</p></div>

    <div class="d-section"><h4>What deletes from it (all of it visible)</h4>
      <p class="dim">· <b>Trace cap</b>: only the last ${TRACE_CAP} traces are kept - older ones are evicted automatically and logged on the memory bus.<br>
      · <b>End session</b>: the whole session buffer is deleted after being compressed into one episode.<br>
      · <b>Forget</b>: the button in any memory's drawer removes exactly that record.<br>
      · <b>Wipe all</b>: clears every store at once.<br>
      · <b>Import</b>: replaces all stores with the file's contents.</p></div>

    <div class="d-section"><p class="dim">Nothing is ever deleted silently without a memory-bus log line -
      that is the whole point of a glass box. Use "export" for a backup before any big cleanup.</p></div>`,
  );
}

export function initStorage() {
  updateDbMeter();
  window.addEventListener("glassbox:persisted", updateDbMeter);
  $("#dbBtn").addEventListener("click", openStorage);
}
