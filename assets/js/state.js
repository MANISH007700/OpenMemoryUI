/* All mutable app state plus its localStorage persistence.
   localStorage is the app's database; the keys are stable across releases
   so existing users keep their memories after an upgrade. */

import {
  STORE_KEY,
  SETTINGS_KEY,
  DEFAULT_MODELS,
  PROVIDERS,
} from "./config.js";
import { now, uid } from "./utils.js";

/* Long-term + session memory (persisted). */
export const memory = {
  session: [], // {id, role, content, at, tokens}
  episodic: [], // memory items, kind: 'episode'
  semantic: [], // memory items, kind: 'fact'|'preference'|'skill'
  traces: [], // per-turn pipeline traces (funnels + full step data), newest last
  sessionStartedAt: null,
};

/* Settings (persisted separately). */
export const settings = {
  mode: "demo",
  provider: "openrouter", // openrouter | anthropic | openai
  keys: { openrouter: "", anthropic: "", openai: "" },
  models: { ...DEFAULT_MODELS }, // last chosen model per provider
  hideWelcome: false, // "don't show again" on the welcome overlay
  insightsTipShown: false, // one-time nudge toward the insights view
  soundOn: false, // synthesized techno music + SFX (off until toggled)
  mcpServers: [], // remote MCP server URLs to reconnect on boot
};

/* Per-visit runtime state (never persisted). */
export const runtime = {
  contextual: [], // derived: [{item, score, matched:[...]}] for last turn
  lastPrompt: null, // exact messages array sent to the model on last turn
  lastExtractRaw: null, // raw extractor output for the last turn
  busy: false,
  budgetWarned: false, // once-per-session nudge when the context window fills up
};

export const currentKey = () => settings.keys[settings.provider] || "";
export const currentModel = () =>
  settings.models[settings.provider] || DEFAULT_MODELS[settings.provider];

export function persistMemory() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(memory));
    window.dispatchEvent(new CustomEvent("glassbox:persisted"));
  } catch (e) {
    console.warn("glassbox: could not persist memory", e);
  }
}
export function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn("glassbox: could not persist settings", e);
  }
}

export function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) Object.assign(memory, JSON.parse(raw));
  } catch (e) {}
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      // migrate pre-provider settings ({apiKey, model} was OpenRouter-only)
      if (!s.keys) {
        s.keys = { openrouter: s.apiKey || "", anthropic: "", openai: "" };
        s.models = {
          ...DEFAULT_MODELS,
          openrouter: s.model || DEFAULT_MODELS.openrouter,
        };
        delete s.apiKey;
        delete s.model;
      }
      Object.assign(settings, s);
      settings.keys = Object.assign(
        { openrouter: "", anthropic: "", openai: "" },
        settings.keys,
      );
      settings.models = Object.assign({ ...DEFAULT_MODELS }, settings.models);
      if (!PROVIDERS[settings.provider]) settings.provider = "openrouter";
    }
  } catch (e) {}
}

export function resetMemory() {
  Object.assign(memory, {
    session: [],
    episodic: [],
    semantic: [],
    traces: [],
    sessionStartedAt: null,
  });
  runtime.contextual = [];
  runtime.lastPrompt = null;
  runtime.lastExtractRaw = null;
  persistMemory();
}

export function makeItem(type, kind, content, reason, source) {
  return {
    id: uid(type.slice(0, 2)),
    type,
    kind,
    content,
    reason,
    source, // the user message (or summary) it came from
    createdAt: now(),
    updatedAt: now(),
    retrievals: [], // {at, query, score, matched}
    history: [], // {at, prev, why}
    importance: 0.5,
  };
}
