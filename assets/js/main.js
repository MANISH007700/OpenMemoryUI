/* Entry point: global event wiring and boot. */

import { memory, settings, loadPersisted, persistSettings } from "./state.js";
import { $ } from "./utils.js";
import { handleSend, endSession, wipeAll } from "./pipeline.js";
import { logEvent } from "./ui/log.js";
import { renderAll } from "./ui/render.js";
import {
  closeDrawer,
  openExplainer,
  openItem,
  openSessionTurn,
  openXray,
} from "./ui/drawer.js";
import { initWelcome, showWelcome } from "./ui/welcome.js";
import { openInsights, openTrace } from "./ui/insights.js";
import {
  setMode,
  setProvider,
  validateKey,
  syncModelSelection,
} from "./ui/settings.js";
import { initClaps, clap } from "./ui/claps.js";
import { exportMemory, importMemoryFile, forgetItem } from "./ui/data.js";
import { openToolbox } from "./ui/toolbox.js";
import { initSound, toggleSound } from "./ui/sound.js";
import { initStorage } from "./ui/storage.js";
import { initMcp } from "./mcp.js";
import { PROVIDERS } from "./config.js";

/* ---- delegated clicks: provenance links, explainers, try-it fills ---- */
document.addEventListener("click", (e) => {
  const opener = e.target.closest("[data-open]");
  if (opener && opener.dataset.open) {
    const [kind, id] = opener.dataset.open.split(":");
    if (kind === "item") openItem(id);
    else if (kind === "session") openSessionTurn(id);
    else if (kind === "trace") openTrace(id);
    else if (kind === "xray") openXray();
    return;
  }
  const explainBtn = e.target.closest("[data-explain]");
  if (explainBtn) {
    openExplainer(explainBtn.dataset.explain);
    return;
  }
  const forget = e.target.closest("[data-forget]");
  if (forget) {
    if (
      confirm(
        "Forget this memory permanently? The agent will no longer know it.",
      )
    )
      forgetItem(forget.dataset.forget);
    return;
  }
  const fill = e.target.closest("[data-fill]");
  if (fill) {
    $("#input").value = fill.dataset.fill;
    if (fill.closest("#drawer")) closeDrawer(); // e.g. a toolbox "try" button
    $("#input").focus();
  }
});
$("#drawerClose").addEventListener("click", closeDrawer);
$("#overlay").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDrawer();
  // "/" focuses the composer from anywhere (unless already typing somewhere)
  if (
    e.key === "/" &&
    !e.ctrlKey &&
    !e.metaKey &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) &&
    $("#welcome").hidden
  ) {
    e.preventDefault();
    $("#input").focus();
  }
});

/* ---- composer ---- */
$("#sendBtn").addEventListener("click", handleSend);
$("#input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

/* ---- top bar ---- */
$("#endSessionBtn").addEventListener("click", endSession);
$("#exportBtn").addEventListener("click", exportMemory);
$("#importBtn").addEventListener("click", () => $("#importFile").click());
$("#importFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) importMemoryFile(file);
  e.target.value = ""; // allow re-importing the same file
});
$("#wipeBtn").addEventListener("click", () => {
  if (
    !confirm(
      'Erase ALL memories (session, episodic, semantic) and turn traces? This cannot be undone.\n\nTip: press "export" first if you want a backup.',
    )
  )
    return;
  wipeAll();
});
$("#xrayBtn").addEventListener("click", openXray);
$("#insightsBtn").addEventListener("click", openInsights);
$("#toolboxBtn").addEventListener("click", openToolbox);
$("#howBtn").addEventListener("click", showWelcome);
$("#soundBtn").addEventListener("click", toggleSound);
$("#clapBtn").addEventListener("click", clap);

$("#modeDemo").addEventListener("click", () => setMode("demo"));
$("#modeLive").addEventListener("click", () => setMode("live"));

$("#providerSel").addEventListener("change", (e) => {
  setProvider(e.target.value);
  logEvent(
    "info",
    `provider switched to ${PROVIDERS[settings.provider].label}`,
  );
});
$("#apiKey").addEventListener("change", (e) => {
  settings.keys[settings.provider] = e.target.value.trim();
  persistSettings();
  validateKey(true); // verify the key, load its models, and announce the result in chat
});
$("#apiKey").addEventListener("keydown", (e) => {
  if (e.key === "Enter") e.target.blur(); // fire the change handler above
});
$("#modelSel").addEventListener("change", (e) => {
  if (e.target.value === "__browse") {
    window.open(PROVIDERS.openrouter.browseUrl, "_blank", "noopener");
    syncModelSelection();
    return;
  }
  if (e.target.value === "__custom") {
    $("#modelCustom").style.display = "inline-block";
    $("#modelCustom").focus();
  } else {
    $("#modelCustom").style.display = "none";
    settings.models[settings.provider] = e.target.value;
    persistSettings();
  }
});
$("#modelCustom").addEventListener("change", (e) => {
  if (e.target.value.trim()) {
    settings.models[settings.provider] = e.target.value.trim();
    persistSettings();
  }
});

/* ---- boot ---- */
loadPersisted();
setProvider(settings.provider);
setMode(settings.mode);
renderAll();
initClaps();
initSound();
initStorage();
initMcp();
initWelcome();
logEvent(
  "info",
  `glassbox online - ${memory.semantic.length} semantic, ${memory.episodic.length} episodic memories loaded from localStorage`,
);
if (memory.session.length)
  logEvent(
    "info",
    `restored ${memory.session.length} session turn(s) from your last visit`,
  );
