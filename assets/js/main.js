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
  const fill = e.target.closest("[data-fill]");
  if (fill) {
    $("#input").value = fill.dataset.fill;
    $("#input").focus();
  }
});
$("#drawerClose").addEventListener("click", closeDrawer);
$("#overlay").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDrawer();
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
$("#wipeBtn").addEventListener("click", () => {
  if (
    !confirm(
      "Erase ALL memories (session, episodic, semantic) and turn traces? This cannot be undone.",
    )
  )
    return;
  wipeAll();
});
$("#xrayBtn").addEventListener("click", openXray);
$("#insightsBtn").addEventListener("click", openInsights);
$("#howBtn").addEventListener("click", showWelcome);
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
