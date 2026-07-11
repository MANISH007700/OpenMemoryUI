/* User data controls: export memory to a JSON file, import it back,
   and forget individual memories. The glassbox promise extends to
   portability - everything the app knows fits in one readable file. */

import { memory, persistMemory } from "../state.js";
import { $, esc } from "../utils.js";
import { logEvent } from "./log.js";
import { renderAll } from "./render.js";
import { closeDrawer } from "./drawer.js";

export function exportMemory() {
  const payload = {
    app: "memory-glassbox",
    version: 1,
    exportedAt: new Date().toISOString(),
    memory,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `memory-glassbox-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  logEvent(
    "info",
    `memory exported: ${memory.semantic.length} semantic, ${memory.episodic.length} episodic, ${memory.session.length} session turn(s)`,
  );
}

function validateImport(data) {
  const m = data?.memory;
  if (data?.app !== "memory-glassbox" || !m)
    return "not a Memory Glassbox export file";
  for (const key of ["session", "episodic", "semantic", "traces"])
    if (!Array.isArray(m[key])) return `malformed export: "${key}" is missing`;
  return null;
}

export async function importMemoryFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    logEvent("error", `import failed: ${esc(file.name)} is not valid JSON`);
    return;
  }
  const problem = validateImport(data);
  if (problem) {
    logEvent("error", `import failed: ${esc(problem)}`);
    return;
  }
  const m = data.memory;
  if (
    !confirm(
      `Replace your current memory with "${file.name}"?\n\nIt contains ${m.semantic.length} semantic, ${m.episodic.length} episodic and ${m.session.length} session item(s). Your current memory will be overwritten.`,
    )
  )
    return;
  Object.assign(memory, {
    session: m.session,
    episodic: m.episodic,
    semantic: m.semantic,
    traces: m.traces,
    sessionStartedAt: m.sessionStartedAt ?? null,
  });
  persistMemory();
  renderAll();
  logEvent(
    "info",
    `memory imported from ${esc(file.name)}: ${m.semantic.length} semantic, ${m.episodic.length} episodic item(s) restored`,
  );
}

export function forgetItem(id) {
  for (const store of [memory.semantic, memory.episodic]) {
    const i = store.findIndex((x) => x.id === id);
    if (i === -1) continue;
    const [item] = store.splice(i, 1);
    persistMemory();
    renderAll();
    closeDrawer();
    logEvent(
      "info",
      `forgotten on request: ${item.type}/${item.kind} "${esc(item.content.slice(0, 60))}"`,
    );
    return;
  }
}
