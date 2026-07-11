/* Static configuration. Provider catalog and panel explainers live in
   assets/data/*.json so copy and model lists can change without touching code. */

async function loadJSON(name) {
  const res = await fetch(new URL(`../data/${name}`, import.meta.url));
  if (!res.ok) throw new Error(`failed to load ${name}: ${res.status}`);
  return res.json();
}

const [providerData, explainers, onboarding] = await Promise.all([
  loadJSON("providers.json"),
  loadJSON("explainers.json"),
  loadJSON("onboarding.json"),
]);

export const STORE_KEY = "glassbox.memory.v1";
export const SETTINGS_KEY = "glassbox.settings.v1";
export const TOKEN_BUDGET = 6000;
export const RETRIEVE_TOP_K = 4;
export const TRACE_CAP = 25;

export const DEFAULT_MODELS = providerData.defaultModels;
// Free OpenRouter models rate-limit often; when the chosen one 429s, fall through this chain.
export const FALLBACK_MODELS = providerData.fallbackModels;
export const PROVIDERS = providerData.providers;
PROVIDERS.openrouter.staticModels = FALLBACK_MODELS;

export const EXPLAINERS = explainers;
export const ONBOARDING = onboarding;

export const STORE_COLORS = {
  session: "#6fd3ff",
  episodic: "#ffb454",
  semantic: "#a78bfa",
  contextual: "#57e6c4",
};
export const KIND_COLORS = {
  fact: "#a78bfa",
  preference: "#f87693",
  skill: "#6fd3ff",
  episode: "#ffb454",
};
