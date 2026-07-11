/* Top-bar settings: mode toggle, provider picker, API key validation and
   the live model catalog dropdown. */

import { PROVIDERS } from "../config.js";
import { settings, persistSettings, currentModel } from "../state.js";
import { $, esc } from "../utils.js";
import { fetchModelGroups, readApiError } from "../llm.js";
import { logEvent } from "./log.js";
import { addChatMsg, clearHero } from "./chat.js";

function renderModelGroups(groups) {
  const sel = $("#modelSel");
  sel.innerHTML = "";
  for (const g of groups) {
    const og = document.createElement("optgroup");
    og.label = g.label;
    for (const m of g.models) {
      const o = document.createElement("option");
      o.value = m.id;
      o.textContent = m.id;
      if (m.title) o.title = m.title;
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  if (settings.provider === "openrouter") {
    const oBrowse = document.createElement("option");
    oBrowse.value = "__browse";
    oBrowse.textContent = "browse all on openrouter.ai ↗";
    sel.appendChild(oBrowse);
  }
  const oCustom = document.createElement("option");
  oCustom.value = "__custom";
  oCustom.textContent = "custom model id...";
  sel.appendChild(oCustom);
  syncModelSelection();
}

export function syncModelSelection() {
  const sel = $("#modelSel");
  const model = currentModel();
  if ([...sel.options].some((o) => o.value === model)) {
    sel.value = model;
    $("#modelCustom").style.display = "none";
  } else {
    sel.value = "__custom";
    $("#modelCustom").style.display = "inline-block";
    $("#modelCustom").value = model;
  }
}

function renderStaticModels() {
  // Instant fallback list while (or in case) the live catalog fetch is out.
  const cfg = PROVIDERS[settings.provider];
  renderModelGroups([
    {
      label: `${cfg.label} - common models`,
      models: cfg.staticModels.map((id) => ({ id, title: id })),
    },
  ]);
}

async function populateModels() {
  const provider = settings.provider;
  const cfg = PROVIDERS[provider];
  if (cfg.needsKeyForModels && !settings.keys[provider]) {
    logEvent(
      "info",
      `${cfg.label}: paste an API key to load your live model list (showing common defaults for now)`,
    );
    return;
  }
  try {
    const groups = await fetchModelGroups(provider);
    if (settings.provider !== provider) return; // user switched provider mid-fetch
    renderModelGroups(groups);
    const total = groups.reduce((a, g) => a + g.models.length, 0);
    logEvent(
      "info",
      `${cfg.label} model catalog loaded: ${total} model(s) available to your key`,
    );
  } catch (e) {
    logEvent(
      "error",
      `could not load ${cfg.label} models (${esc(e.message)}) - using the built-in list`,
    );
  }
}

export async function validateKey(announceInChat) {
  const provider = settings.provider,
    cfg = PROVIDERS[provider],
    key = settings.keys[provider];
  const st = $("#keyStatus");
  if (!key) {
    st.className = "";
    st.textContent = "";
    populateModels();
    return;
  }
  st.className = "busy";
  st.textContent = "checking key…";
  try {
    if (provider === "openrouter") {
      // the catalog is public, so prove the key itself with the key-info endpoint
      const res = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw await readApiError(res, "OpenRouter");
    }
    const groups = await fetchModelGroups(provider);
    if (settings.provider !== provider) return; // user switched provider mid-check
    renderModelGroups(groups);
    const total = groups.reduce((a, g) => a + g.models.length, 0);
    st.className = "ok";
    st.textContent = `✓ key ok · ${total} models`;
    logEvent(
      "info",
      `${cfg.label} key verified - ${total} model(s) loaded into the picker`,
    );
    if (announceInChat) {
      clearHero();
      addChatMsg(
        "system-note",
        `✓ Your ${cfg.label} API key works. ${total} model${total === 1 ? "" : "s"} it can access are now in the model picker (top bar). Currently selected: ${currentModel()}. Switch to live mode and say hi!`,
      );
    }
  } catch (e) {
    if (settings.provider !== provider) return;
    st.className = "bad";
    st.textContent = "✗ key failed";
    logEvent("error", `${cfg.label} key check failed: ${esc(e.message)}`);
    if (announceInChat) {
      clearHero();
      addChatMsg(
        "system-note",
        `✗ Your ${cfg.label} API key did not validate: ${e.message}\nDouble-check the key (get one at ${cfg.keyUrl}) and try again.`,
      );
    }
  }
}

export function setMode(mode) {
  settings.mode = mode;
  $("#modeDemo").classList.toggle("on", mode === "demo");
  $("#modeLive").classList.toggle("on", mode === "live");
  $("#liveCtls").style.display = mode === "live" ? "flex" : "none";
  persistSettings();
  logEvent(
    "info",
    mode === "live"
      ? `live mode: real LLM calls via ${PROVIDERS[settings.provider].label} (${esc(currentModel())})`
      : "demo mode: simulated model, real memory pipeline",
  );
}

export function setProvider(provider) {
  settings.provider = provider;
  persistSettings();
  const cfg = PROVIDERS[provider];
  $("#providerSel").value = provider;
  $("#apiKey").value = settings.keys[provider] || "";
  $("#apiKey").placeholder = cfg.keyPlaceholder;
  $("#apiKey").title =
    `${cfg.label} API key. Stored only in this browser's localStorage. Press Enter to verify it. Get one at ${cfg.keyUrl}`;
  $("#keyStatus").className = "";
  $("#keyStatus").textContent = "";
  renderStaticModels(); // instant list; replaced by the live catalog below
  if (settings.keys[provider])
    validateKey(false); // silently re-verify the saved key + load its models
  else populateModels();
}
