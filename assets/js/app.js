"use strict";
/* =====================================================================
   Memory Glassbox
   A transparent agentic memory system. Four stores:
   - session   : working memory (the context window), volatile
   - episodic  : time-stamped diary of exchanges
   - semantic  : extracted facts / preferences / skills
   - contextual: derived view - what retrieval selected for the last turn
   ===================================================================== */

const STORE_KEY = "glassbox.memory.v1";
const SETTINGS_KEY = "glassbox.settings.v1";
const TOKEN_BUDGET = 6000;
const RETRIEVE_TOP_K = 4;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();
const uid = (p) =>
  p + "-" + now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmtTime = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtFull = (ts) => new Date(ts).toLocaleString();
const estTokens = (t) => Math.max(1, Math.ceil((t || "").length / 4));

/* ------------------------------ state ------------------------------ */
let M = {
  // long-term + session state (persisted)
  session: [], // {id, role, content, at, tokens}
  episodic: [], // memory items, kind: 'episode'
  semantic: [], // memory items, kind: 'fact'|'preference'|'skill'
  traces: [], // per-turn pipeline traces (funnels + full step data), newest last
  sessionStartedAt: null,
};
const TRACE_CAP = 25;
let contextual = []; // derived: [{item, score, matched:[...]}] for last turn
let lastPrompt = null; // exact messages array sent to the model on last turn
let lastExtractRaw = null;
let busy = false;

const DEFAULT_MODELS = {
  openrouter: "nvidia/nemotron-3-super-120b-a12b:free",
  anthropic: "claude-sonnet-5",
  openai: "gpt-4o-mini",
};
let S = {
  // settings (persisted separately)
  mode: "demo",
  provider: "openrouter", // openrouter | anthropic | openai
  keys: { openrouter: "", anthropic: "", openai: "" },
  models: { ...DEFAULT_MODELS }, // last chosen model per provider
  onboarded: false,
};
// Free OpenRouter models rate-limit often; when the chosen one 429s, fall through this chain.
const FALLBACK_MODELS = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "google/gemma-4-31b-it:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "openai/gpt-oss-120b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];
const PROVIDERS = {
  openrouter: {
    label: "OpenRouter",
    keyPlaceholder: "sk-or-v1-...",
    keyUrl: "https://openrouter.ai/settings/keys",
    needsKeyForModels: false, // catalog endpoint is public
    browseUrl: "https://openrouter.ai/models",
    staticModels: FALLBACK_MODELS,
  },
  anthropic: {
    label: "Anthropic",
    keyPlaceholder: "sk-ant-...",
    keyUrl: "https://console.anthropic.com/settings/keys",
    needsKeyForModels: true,
    staticModels: [
      "claude-opus-4-8",
      "claude-sonnet-5",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ],
  },
  openai: {
    label: "OpenAI",
    keyPlaceholder: "sk-...",
    keyUrl: "https://platform.openai.com/api-keys",
    needsKeyForModels: true,
    staticModels: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"],
  },
};
const currentKey = () => S.keys[S.provider] || "";
const currentModel = () => S.models[S.provider] || DEFAULT_MODELS[S.provider];

function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify(M));
}
function persistSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(S));
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) M = Object.assign(M, JSON.parse(raw));
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
      S = Object.assign(S, s);
      S.keys = Object.assign(
        { openrouter: "", anthropic: "", openai: "" },
        S.keys,
      );
      S.models = Object.assign({ ...DEFAULT_MODELS }, S.models);
      if (!PROVIDERS[S.provider]) S.provider = "openrouter";
    }
  } catch (e) {}
}

/* --------------------------- memory items --------------------------- */
function makeItem(type, kind, content, reason, source) {
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

/* --------------------------- retrieval ------------------------------ */
const STOP = new Set(
  "a an and are as at be but by for from has have i im i'm in is it its me my of on or so that the this to was we what when where which who why will with you your yours do does did dont don't can could would should about tell me please hey hi hello".split(
    " ",
  ),
);
function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9']+/g) || []).filter(
    (w) => w.length > 1 && !STOP.has(w),
  );
}
function scoreItem(queryTokens, item) {
  const itemTokens = new Set(tokenize(item.content + " " + (item.kind || "")));
  const matched = [...new Set(queryTokens)].filter((t) => itemTokens.has(t));
  if (!matched.length && !queryTokens.length) return { score: 0, matched: [] };
  let score = matched.length / Math.sqrt(Math.max(4, itemTokens.size));
  // recency boost: memories touched in the last 10 minutes get a nudge
  const ageMin = (now() - item.updatedAt) / 60000;
  if (ageMin < 10) score += 0.08;
  // reinforcement: frequently retrieved memories are "stronger"
  score += Math.min(0.15, item.retrievals.length * 0.03);
  score += (item.importance - 0.5) * 0.1;
  return { score: Math.round(score * 100) / 100, matched };
}
function isRecallQuery(text) {
  const normalized = text.toLowerCase();
  return [
    /\bwhat\b[^?!.]{0,60}\b(remember|recall|know)\b[^?!.]{0,60}\b(about me|me)\b/,
    /\b(do you|can you)\b[^?!.]{0,40}\b(remember|recall)\b[^?!.]{0,40}\b(about me|me|my)\b/,
    /\b(remember|recall)\b[^?!.]{0,40}\b(about me|me|my)\b/,
    /\b(my|your)\s+(memory|memories)\b/,
    /\b(forgot|forget)\b[^?!.]{0,40}\b(about me|me|my)\b/,
  ].some((pattern) => pattern.test(normalized));
}
let lastRetrieveDiag = null; // full scoring diagnostics for the last retrieval (feeds trace + funnel)
function retrieve(query) {
  const qt = tokenize(query);
  const pool = [...M.semantic, ...M.episodic];
  const recall = isRecallQuery(query);
  const scoredAll = pool
    .map((item) => {
      const { score, matched } = scoreItem(qt, item);
      // a "what do you remember" question should surface everything semantic
      const boosted = recall && item.type === "semantic" ? score + 0.5 : score;
      return { item, score: Math.round(boosted * 100) / 100, matched };
    })
    .sort((a, b) => b.score - a.score);
  const above = scoredAll.filter((x) => x.score > 0.05);
  const picked = above.slice(0, recall ? 8 : RETRIEVE_TOP_K);
  const pickedIds = new Set(picked.map((x) => x.item.id));
  lastRetrieveDiag = {
    queryTokens: qt,
    rawTokens: query.toLowerCase().match(/[a-z0-9']+/g) || [],
    recall,
    pool: pool.length,
    above: above.length,
    picked: picked.length,
    candidates: scoredAll.slice(0, 12).map((x) => ({
      id: x.item.id,
      type: x.item.type,
      kind: x.item.kind,
      content: x.item.content.slice(0, 90),
      score: x.score,
      matched: x.matched,
      picked: pickedIds.has(x.item.id),
    })),
  };
  return picked;
}

/* ------------------------- demo-mode brain -------------------------- */
/* Rule-based extraction so the whole pipeline works with zero setup.
   Live mode replaces generation + extraction with real LLM calls;
   storage, retrieval and provenance are identical in both modes. */
function demoExtract(userMsg) {
  const out = [];
  const push = (kind, content, reason) =>
    out.push({ action: "add", kind, content, reason });
  let m;
  if (
    (m = userMsg.match(
      /(?:my name is|i am called|call me|i'm)\s+([A-Z][a-z]+)(?!\w)/i,
    )) &&
    m[1].length > 1
  )
    push(
      "fact",
      `User's name is ${m[1]}.`,
      `The message contains an explicit self-introduction pattern ("my name is / call me"), which is a stable identity fact worth keeping across sessions.`,
    );
  if (
    (m = userMsg.match(/i (?:work|am working) (?:as|at|in|on)\s+([^.,!?\n]+)/i))
  )
    push(
      "fact",
      `User works ${userMsg.match(/i (?:work|am working) ((?:as|at|in|on)\s+[^.,!?\n]+)/i)[1].trim()}.`,
      `Occupation statements ("I work as/at...") describe durable personal context that helps tailor future answers.`,
    );
  if (
    (m = userMsg.match(
      /i (prefer|like|love|enjoy|hate|dislike)\s+([^.!?\n]+?)(?=\s+(?:and|but|because)\s+i\b|[.!?\n]|$)/i,
    ))
  ) {
    const verb3 = {
      prefer: "prefers",
      like: "likes",
      love: "loves",
      enjoy: "enjoys",
      hate: "hates",
      dislike: "dislikes",
    }[m[1].toLowerCase()];
    push(
      "preference",
      `User ${verb3} ${m[2].trim()}.`,
      `First-person preference verbs ("prefer / like / love / hate") signal a taste or working style the agent should respect in every future reply.`,
    );
  }
  if (
    (m = userMsg.match(
      /i (?:am learning|am studying|want to learn)\s+([^.,!?\n]+?)(?=\s+(?:and|but|because)\s+i\b|[.,!?\n]|$)/i,
    ))
  )
    push(
      "skill",
      `User is learning ${m[1].trim()}.`,
      `Learning statements describe an evolving skill. Tracking it lets the agent pitch explanations at the right level and follow progress over time.`,
    );
  if (
    (m = userMsg.match(
      /i (know|can|use|am good at|am experienced (?:in|with))\s+([^.,!?\n]+?)(?=\s+(?:and|but|because)\s+i\b|[.,!?\n]|$)/i,
    ))
  ) {
    const v = m[1].toLowerCase();
    const verb3 =
      v === "know"
        ? "knows"
        : v === "use"
          ? "uses"
          : v === "can"
            ? "can"
            : v.replace(/^am /, "is ");
    push(
      "skill",
      `User ${verb3} ${m[2].trim()}.`,
      `Capability statements ("I know / I can / I use") define the user's skill set, so answers can skip basics they already master.`,
    );
  }
  if (
    (m = userMsg.match(
      /i (?:live|am based|am located) (?:in|at|near)\s+([^.,!?\n]+)/i,
    ))
  )
    push(
      "fact",
      `User lives ${userMsg.match(/(?:in|at|near)\s+[^.,!?\n]+/i)[0].trim()}.`,
      `Location is stable personal context, useful for timezone, locale and region-specific answers.`,
    );
  // dedupe against existing semantic memory (demo-grade similarity)
  const kept = out.filter((c) => {
    const ct = new Set(tokenize(c.content));
    return !M.semantic.some((ex) => {
      const et = tokenize(ex.content);
      const overlap = et.filter((t) => ct.has(t)).length;
      return overlap >= Math.min(ct.size, et.length) * 0.8;
    });
  });
  return { items: kept, dupesRejected: out.length - kept.length };
}
function demoReply(userMsg, retrieved) {
  const sem = retrieved.filter((r) => r.item.type === "semantic");
  if (isRecallQuery(userMsg)) {
    if (!sem.length)
      return "Honestly? Nothing yet. My semantic store is empty, so I have no facts, preferences or skills on file about you. Tell me something about yourself and watch the violet panel on the right.";
    const lines = sem.map(
      (r) =>
        `- ${r.item.content} (${r.item.kind}, stored ${fmtTime(r.item.createdAt)}, retrieved ${r.item.retrievals.length + 1}x)`,
    );
    return `Here is literally everything my retrieval step just pulled from long-term memory:\n\n${lines.join("\n")}\n\nEach of those was scored against your question - the teal panel shows the scores. Click any item to see why it was stored.`;
  }
  let openers = ["Got it.", "Noted.", "Interesting.", "Nice."];
  let reply = openers[Math.floor(Math.random() * openers.length)] + " ";
  if (sem.length) {
    reply += `Since I remember that ${sem[0].item.content.replace(/^User(?:'s)?\s*/i, "you ").replace(/\.$/, "")}, I'm keeping that in mind. `;
  }
  reply +=
    "I'm a simulated model in demo mode, so my conversation is shallow - but the memory machinery around me is fully real. ";
  reply +=
    "Check the pipeline strip below your message: what you just said was scanned for facts, preferences and skills, and anything extracted is being written to the stores on the right.";
  return reply;
}

/* --------------------------- live LLM calls -------------------------- */
/* All calls go straight from the browser to the selected provider.
   OpenRouter keeps its free-model fallback chain; Anthropic and OpenAI
   call exactly the model you picked. */
async function callLLM(messages, opts = {}) {
  if (S.provider === "openrouter") return callOpenRouter(messages, opts);
  return callProviderOnce(S.provider, currentModel(), messages, opts);
}
function callProviderOnce(provider, model, messages, opts) {
  if (provider === "anthropic") return callAnthropic(model, messages, opts);
  if (provider === "openai") return callOpenAI(model, messages, opts);
  return callModelOnce(model, messages, opts);
}
async function callOpenRouter(messages, opts = {}) {
  const chain = [
    currentModel(),
    ...FALLBACK_MODELS.filter((m) => m !== currentModel()),
  ];
  let lastErr;
  for (const model of chain) {
    try {
      const text = await callModelOnce(model, messages, opts);
      if (model !== chain[0])
        logEvent(
          "info",
          `answered by fallback model ${esc(model.split("/").pop())}`,
        );
      return text;
    } catch (err) {
      lastErr = err;
      if (
        !/429|rate.?limit|404|No endpoints|unavailable|temporarily|empty response/i.test(
          err.message,
        )
      )
        throw err;
      logEvent(
        "info",
        `${esc(model.split("/").pop())} unavailable, trying next free model...`,
      );
    }
  }
  throw new Error(
    `All ${chain.length} free models are busy right now. Last error: ${lastErr.message}`,
  );
}
async function readApiError(res, providerLabel) {
  let detail = "";
  try {
    detail = (await res.json()).error?.message || "";
  } catch (e) {}
  return new Error(
    `${providerLabel} ${res.status}: ${detail || res.statusText}`,
  );
}
async function callModelOnce(
  model,
  messages,
  { json = false, maxTokens = 700 } = {},
) {
  const body = {
    model,
    messages,
    temperature: json ? 0.1 : 0.7,
    max_tokens: maxTokens,
  };
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${S.keys.openrouter}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://local.memory-glassbox",
      "X-Title": "Memory Glassbox",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await readApiError(res, "OpenRouter");
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("Model returned an empty response.");
  return text;
}
async function callAnthropic(model, messages, { maxTokens = 700 } = {}) {
  // The Messages API takes the system prompt as a top-level field.
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const turns = messages.filter((m) => m.role !== "system");
  while (turns.length && turns[0].role !== "user") turns.shift(); // API requires a user turn first
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": S.keys.anthropic,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "Content-Type": "application/json",
    },
    // Extra max_tokens headroom: on thinking-enabled Claude models,
    // reasoning tokens count against max_tokens before any visible text.
    body: JSON.stringify({
      model,
      max_tokens: Math.max(maxTokens, 2048),
      system,
      messages: turns,
    }),
  });
  if (!res.ok) throw await readApiError(res, "Anthropic");
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text) throw new Error("Model returned an empty response.");
  return text;
}
async function callOpenAI(model, messages, { maxTokens = 700 } = {}) {
  // max_completion_tokens (not max_tokens) and default temperature, so both
  // classic gpt-4o-style and reasoning models accept the same request.
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${S.keys.openai}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_completion_tokens: Math.max(maxTokens, 2048),
    }),
  });
  if (!res.ok) throw await readApiError(res, "OpenAI");
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("Model returned an empty response.");
  return text;
}

/* ------------------------- model catalogs ---------------------------- */
/* Each provider's model list is fetched live from its own API, so the
   dropdown always shows exactly the models the pasted key can reach.
   Returns [{label, models: [{id, title}]}] optgroups. */
async function fetchModelGroups(provider) {
  if (provider === "openrouter") {
    const res = await fetch("https://openrouter.ai/api/v1/models");
    if (!res.ok) throw await readApiError(res, "OpenRouter");
    const data = (await res.json()).data || [];
    if (!data.length) throw new Error("empty catalog");
    const free = data
      .filter((m) => m.id.endsWith(":free"))
      .sort((a, b) => a.id.localeCompare(b.id));
    const paid = data
      .filter((m) => !m.id.endsWith(":free"))
      .sort((a, b) => a.id.localeCompare(b.id));
    const mk = (m) => ({
      id: m.id,
      title: m.context_length
        ? `${m.name || m.id} · ${Math.round(m.context_length / 1000)}k context`
        : m.name || m.id,
    });
    return [
      { label: `Free models (${free.length})`, models: free.map(mk) },
      {
        label: `Paid models (${paid.length}) - need OpenRouter credits`,
        models: paid.map(mk),
      },
    ];
  }
  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: {
        "x-api-key": S.keys.anthropic,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
    });
    if (!res.ok) throw await readApiError(res, "Anthropic");
    const data = (await res.json()).data || [];
    if (!data.length) throw new Error("empty catalog");
    return [
      {
        label: `Anthropic models (${data.length})`,
        models: data.map((m) => ({ id: m.id, title: m.display_name || m.id })),
      },
    ];
  }
  // openai - /v1/models lists everything (embeddings, tts, whisper...);
  // keep only chat-capable model ids.
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${S.keys.openai}` },
  });
  if (!res.ok) throw await readApiError(res, "OpenAI");
  const data = (await res.json()).data || [];
  const chat = data
    .map((m) => m.id)
    .filter(
      (id) =>
        /^(gpt-|o[134](-|$)|chatgpt-)/.test(id) &&
        !/(embed|whisper|tts|audio|realtime|image|dall-e|moderation|transcribe|search)/.test(
          id,
        ) &&
        !/-instruct/.test(id),
    )
    .sort();
  if (!chat.length) throw new Error("no chat models found for this key");
  return [
    {
      label: `OpenAI chat models (${chat.length})`,
      models: chat.map((id) => ({ id, title: id })),
    },
  ];
}

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
  if (S.provider === "openrouter") {
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

function syncModelSelection() {
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
  const cfg = PROVIDERS[S.provider];
  renderModelGroups([
    {
      label: `${cfg.label} - common models`,
      models: cfg.staticModels.map((id) => ({ id, title: id })),
    },
  ]);
}

async function populateModels() {
  const provider = S.provider;
  const cfg = PROVIDERS[provider];
  if (cfg.needsKeyForModels && !S.keys[provider]) {
    logEvent(
      "info",
      `${cfg.label}: paste an API key to load your live model list (showing common defaults for now)`,
    );
    return;
  }
  try {
    const groups = await fetchModelGroups(provider);
    if (S.provider !== provider) return; // user switched provider mid-fetch
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

function buildChatMessages(userMsg, retrieved) {
  const memLines = retrieved.map(
    (r) =>
      `- [${r.item.type}/${r.item.kind}] ${r.item.content} (relevance ${r.score})`,
  );
  const system = [
    "You are the conversational core of 'Memory Glassbox', a teaching tool that makes agentic memory visible.",
    "Answer the user naturally and concisely (2-6 sentences).",
    "You have real long-term memory. The items below were retrieved for this message; use them when relevant and feel free to reference that you remember them.",
    "",
    memLines.length
      ? "RETRIEVED MEMORIES:\n" + memLines.join("\n")
      : "RETRIEVED MEMORIES: (none - your long-term store had nothing relevant)",
  ].join("\n");
  // the current user message was already appended to session memory in stage 1,
  // so drop it from the history slice to avoid sending it twice
  let hist = M.session.slice(-13);
  if (
    hist.length &&
    hist[hist.length - 1].role === "user" &&
    hist[hist.length - 1].content === userMsg
  )
    hist = hist.slice(0, -1);
  const turns = hist.slice(-12).map((t) => ({
    role: t.role === "agent" ? "assistant" : "user",
    content: t.content,
  }));
  return [
    { role: "system", content: system },
    ...turns,
    { role: "user", content: userMsg },
  ];
}

function buildExtractMessages(userMsg, reply) {
  const existing =
    M.semantic.map((s) => `${s.id} | ${s.kind} | ${s.content}`).join("\n") ||
    "(none)";
  const system = [
    "You are the memory-extraction module of an agentic memory system.",
    "Given the user's latest message, decide what deserves to be written to long-term SEMANTIC memory.",
    "Extract only stable, reusable knowledge about the user: facts (identity, job, location), preferences (tastes, working style, likes/dislikes), skills (what they know, use, or are learning).",
    "Do NOT store small talk, questions, or one-off requests.",
    "If a new statement contradicts or refines an existing memory, return an update for that memory id instead of adding a duplicate.",
    "",
    "EXISTING SEMANTIC MEMORIES:",
    existing,
    "",
    "Respond with ONLY valid JSON, no prose, in this exact shape:",
    '{"items":[{"action":"add"|"update","id":"(only for update)","kind":"fact"|"preference"|"skill","content":"third-person statement about the user","reason":"one sentence: why this is worth remembering"}],',
    ' "episode":{"summary":"one sentence describing this exchange as an event","importance":0.0}}',
    'If nothing is worth storing, return {"items":[],"episode":{...}} - the episode is always required.',
  ].join("\n");
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `USER MESSAGE:\n${userMsg}\n\nASSISTANT REPLY:\n${reply}`,
    },
  ];
}

async function extractLive(userMsg, reply) {
  if (S.provider !== "openrouter") {
    const raw = await callProviderOnce(
      S.provider,
      currentModel(),
      buildExtractMessages(userMsg, reply),
      { json: true, maxTokens: 900 },
    );
    return parseExtraction(raw);
  }
  // Free OpenRouter endpoints sometimes return prose or garbage instead of
  // JSON, so a parse failure is treated like a model failure: move on down the chain.
  const chain = [
    currentModel(),
    ...FALLBACK_MODELS.filter((m) => m !== currentModel()),
  ];
  let lastErr;
  for (const model of chain) {
    try {
      const raw = await callModelOnce(
        model,
        buildExtractMessages(userMsg, reply),
        { json: true, maxTokens: 900 },
      );
      return parseExtraction(raw);
    } catch (err) {
      lastErr = err;
      logEvent(
        "info",
        `extract via ${esc(model.split("/").pop())} failed (${esc(err.message.slice(0, 50))}), trying next model...`,
      );
    }
  }
  throw lastErr;
}

function parseExtraction(text) {
  lastExtractRaw = text;
  let t = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim()
    .replace(/^```(?:json)?/m, "")
    .replace(/```\s*$/m, "")
    .trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON found");
  const obj = JSON.parse(t.slice(start, end + 1));
  if (!Array.isArray(obj.items)) obj.items = [];
  return obj;
}

/* ----------------------------- rendering ----------------------------- */
function kindClass(k) {
  return (
    {
      fact: "fact",
      preference: "preference",
      skill: "skill",
      episode: "episode",
    }[k] || "fact"
  );
}

function renderSession() {
  const body = $("#body-session");
  if (!M.session.length) {
    body.innerHTML = `<div class="empty-note">Empty. Your next message lands here first: raw, verbatim, short-lived.</div>`;
  } else {
    body.innerHTML = M.session
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
  $("#count-session").textContent = M.session.length;
  const used = M.session.reduce((a, t) => a + t.tokens, 0);
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

function renderEpisodic() {
  const body = $("#body-episodic");
  const items = [...M.episodic].sort((a, b) => b.updatedAt - a.updatedAt);
  body.innerHTML = items.length
    ? items.map((i) => itemCard(i)).join("")
    : `<div class="empty-note">No episodes yet. Each exchange is journaled here as a time-stamped event.</div>`;
  $("#count-episodic").textContent = M.episodic.length;
}

function renderSemantic() {
  const body = $("#body-semantic");
  const order = { fact: 0, preference: 1, skill: 2 };
  const items = [...M.semantic].sort(
    (a, b) => order[a.kind] - order[b.kind] || b.updatedAt - a.updatedAt,
  );
  body.innerHTML = items.length
    ? items.map((i) => itemCard(i)).join("")
    : `<div class="empty-note">Nothing learned yet. Tell the agent about yourself and watch facts crystallize here.</div>`;
  $("#count-semantic").textContent = M.semantic.length;
}

function renderContextual() {
  const body = $("#body-contextual");
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

function renderAll() {
  renderSession();
  renderEpisodic();
  renderSemantic();
  renderContextual();
}

/* ------------------------------- log -------------------------------- */
function logEvent(op, html) {
  const line = document.createElement("div");
  line.className = `log-line op-${op}`;
  line.innerHTML = `<span class="t">${fmtTime(now())}</span> <b>${op.toUpperCase().padEnd(6, " ")}</b> ${html}`;
  const scroll = $("#logScroll");
  scroll.appendChild(line);
  scroll.scrollTop = scroll.scrollHeight;
}

/* ----------------------------- pipeline ------------------------------ */
function setStage(name, note) {
  $$("#pipeline .stage").forEach((s) => {
    if (s.dataset.stage === name) {
      s.classList.add("active");
      s.classList.remove("done");
      if (note !== undefined) $(".s-note", s).textContent = note;
    } else if (s.classList.contains("active")) {
      s.classList.remove("active");
      s.classList.add("done");
    }
  });
}
function stageNote(name, note) {
  const s = $(`#pipeline .stage[data-stage="${name}"]`);
  if (s) $(".s-note", s).textContent = note;
}
function resetStages() {
  $$("#pipeline .stage").forEach((s) => {
    s.classList.remove("active", "done");
    $(".s-note", s).textContent = "";
  });
}

/* --------------------------- packet animation ------------------------ */
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function firePackets(fromEl, toEl, color, count = 3) {
  if (REDUCED || !fromEl || !toEl) return;
  const f = fromEl.getBoundingClientRect();
  const t = toEl.getBoundingClientRect();
  const x1 = f.left + f.width / 2,
    y1 = f.top + f.height / 2;
  const x2 = t.left + t.width / 2,
    y2 = t.top + Math.min(30, t.height / 2);
  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    p.className = "packet";
    p.style.background = color;
    p.style.boxShadow = `0 0 12px ${color}`;
    p.style.left = x1 + "px";
    p.style.top = y1 + "px";
    document.body.appendChild(p);
    const midX = (x1 + x2) / 2 + (Math.random() * 80 - 40);
    const midY = Math.min(y1, y2) - 40 - Math.random() * 50;
    p.animate(
      [
        { transform: "translate(0,0) scale(0.7)", opacity: 0.2 },
        {
          transform: `translate(${midX - x1}px, ${midY - y1}px) scale(1.15)`,
          opacity: 1,
          offset: 0.5,
        },
        {
          transform: `translate(${x2 - x1}px, ${y2 - y1}px) scale(0.6)`,
          opacity: 0.1,
        },
      ],
      {
        duration: 700 + i * 130,
        delay: i * 90,
        easing: "cubic-bezier(.3,.1,.3,1)",
      },
    ).onfinish = () => p.remove();
  }
}
function flashPanel(type) {
  const panel = $(`.mem-panel[data-type="${type}"]`);
  if (!panel) return;
  panel.classList.add(`flash-${type}`);
  setTimeout(() => panel.classList.remove(`flash-${type}`), 1400);
}
function flashCard(id, cls) {
  const el = $(`#card-${id}`) || $(`[data-open="item:${id}"]`);
  if (el) {
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 1700);
  }
}

/* ------------------------------ chat UI ------------------------------ */
function addChatMsg(role, content, chips = []) {
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
function addChipsTo(msgEl, chips) {
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

/* --------------------------- write handling -------------------------- */
function applyExtraction(result, sourceMsg, userMsgEl) {
  const written = [];
  let invalidRejected = 0;
  const chatPanel = $("#chatScroll");
  // semantic items
  for (const it of result.items || []) {
    if (
      !it ||
      !it.content ||
      !["fact", "preference", "skill"].includes(it.kind)
    ) {
      invalidRejected++;
      continue;
    }
    if (it.action === "update" && it.id) {
      const existing = M.semantic.find((s) => s.id === it.id);
      if (existing) {
        existing.history.push({
          at: now(),
          prev: existing.content,
          why: it.reason || "refined by a newer statement",
        });
        existing.content = it.content;
        existing.reason = it.reason || existing.reason;
        existing.updatedAt = now();
        existing.source = sourceMsg;
        written.push({ item: existing, op: "update" });
        continue;
      }
    }
    const item = makeItem(
      "semantic",
      it.kind,
      it.content,
      it.reason || "Extracted as stable knowledge about the user.",
      sourceMsg,
    );
    M.semantic.push(item);
    written.push({ item, op: "write" });
  }
  // episode
  const ep = result.episode || {};
  const epItem = makeItem(
    "episodic",
    "episode",
    ep.summary || `User said: "${sourceMsg.slice(0, 90)}"`,
    ep.reason ||
      "Every exchange is journaled as an event so the agent can later recall what happened and when, even if no facts were extracted.",
    sourceMsg,
  );
  epItem.importance =
    typeof ep.importance === "number"
      ? Math.max(0, Math.min(1, ep.importance))
      : 0.5;
  M.episodic.push(epItem);
  written.push({ item: epItem, op: "write" });

  // render + animate + log + chips
  renderSemantic();
  renderEpisodic();
  const chips = [];
  for (const w of written) {
    const t = w.item.type;
    flashPanel(t);
    firePackets(
      userMsgEl || chatPanel,
      $(`.mem-panel[data-type="${t}"]`),
      t === "episodic" ? "#ffb454" : "#a78bfa",
      3,
    );
    flashCard(w.item.id, w.op === "update" ? "just-updated" : "just-written");
    logEvent(
      w.op === "update" ? "update" : "write",
      `${t}/${w.item.kind} <a data-open="item:${w.item.id}">${esc(w.item.content.slice(0, 80))}</a>`,
    );
    chips.push({
      type: t,
      label: `${w.op === "update" ? "updated" : "stored"} → ${t}${w.item.kind !== "episode" ? " (" + w.item.kind + ")" : ""}`,
      open: `item:${w.item.id}`,
      title: w.item.reason,
    });
  }
  if (userMsgEl) addChipsTo(userMsgEl, chips);
  persist();
  return { written, invalidRejected };
}

/* ----------------------------- send flow ----------------------------- */
async function handleSend() {
  if (busy) return;
  const input = $("#input");
  const text = input.value.trim();
  if (!text) return;
  if (S.mode === "live" && !currentKey()) {
    logEvent(
      "error",
      `Live mode needs a ${PROVIDERS[S.provider].label} API key. Paste one in the top bar (get one at ${PROVIDERS[S.provider].keyUrl}), or switch to demo mode.`,
    );
    $("#apiKey").focus();
    return;
  }
  busy = true;
  $("#sendBtn").disabled = true;
  input.value = "";
  $("#hero")?.remove();
  resetStages();

  /* 1 · RECEIVE - into session (working) memory */
  setStage("receive", "message enters working memory, verbatim");
  const trace = { id: uid("tr"), at: now(), text }; // full pipeline trace for this turn
  const userMsgEl = addChatMsg("user", text);
  const turn = {
    id: uid("t"),
    role: "user",
    content: text,
    at: now(),
    tokens: estTokens(text),
  };
  trace.receive = { tokens: turn.tokens, sessionTurnsBefore: M.session.length };
  if (!M.session.length) M.sessionStartedAt = now();
  M.session.push(turn);
  renderSession();
  flashPanel("session");
  firePackets(userMsgEl, $(`.mem-panel[data-type="session"]`), "#6fd3ff", 3);
  logEvent(
    "write",
    `session <a data-open="session:${turn.id}">user turn, ~${turn.tokens} tokens</a> - kept verbatim in the context window`,
  );
  addChipsTo(userMsgEl, [
    {
      type: "session",
      label: "→ session memory",
      open: `session:${turn.id}`,
      title:
        "Stored verbatim in the context window. Re-sent to the model on every turn until the session ends.",
    },
  ]);
  persist();
  await sleep(500);

  /* 2 · RETRIEVE - search long-term stores */
  setStage("retrieve", "scoring long-term memories against your message");
  contextual = retrieve(text);
  trace.retrieve = lastRetrieveDiag;
  for (const r of contextual) {
    r.item.retrievals.push({
      at: now(),
      query: text.slice(0, 120),
      score: r.score,
      matched: r.matched,
    });
    firePackets(
      $(`.mem-panel[data-type="${r.item.type}"]`),
      $(`.mem-panel[data-type="contextual"]`),
      "#57e6c4",
      2,
    );
  }
  renderContextual();
  renderEpisodic();
  renderSemantic();
  contextual.forEach((r) => flashCard(r.item.id, "just-retrieved"));
  if (contextual.length) {
    flashPanel("contextual");
    stageNote(
      "retrieve",
      `${contextual.length} memor${contextual.length === 1 ? "y" : "ies"} recalled`,
    );
    logEvent(
      "read",
      `contextual - retrieved ${contextual.length} item(s), top score ${contextual[0].score}: <a data-open="item:${contextual[0].item.id}">${esc(contextual[0].item.content.slice(0, 60))}</a>`,
    );
  } else {
    stageNote("retrieve", "nothing relevant in long-term memory");
    logEvent(
      "read",
      "contextual - long-term stores searched, nothing scored above threshold",
    );
  }
  persist();
  await sleep(650);

  /* 3 · GENERATE */
  setStage(
    "generate",
    S.mode === "live"
      ? `calling ${currentModel().split("/").pop()} via ${PROVIDERS[S.provider].label}`
      : "demo model composing a reply",
  );
  lastPrompt = buildChatMessages(text, contextual);
  trace.generate = {
    mode: S.mode,
    provider: S.mode === "live" ? PROVIDERS[S.provider].label : "demo",
    model: S.mode === "live" ? currentModel() : "simulated",
    promptMessages: lastPrompt.length,
    promptTokens: lastPrompt.reduce((a, m) => a + estTokens(m.content), 0),
  };
  trace.promptDump = lastPrompt
    .map((m) => `[${m.role}]\n${m.content}`)
    .join("\n\n" + "-".repeat(40) + "\n\n");
  const genStart = performance.now();
  let reply;
  try {
    if (S.mode === "live") {
      reply = await callLLM(lastPrompt);
    } else {
      await sleep(600);
      reply = demoReply(text, contextual);
    }
  } catch (err) {
    stageNote("generate", "model call failed");
    logEvent("error", `generate: ${esc(err.message)}`);
    addChatMsg(
      "system-note",
      `The model call failed: ${err.message}\nCheck your API key / model in the top bar, or switch to demo mode. Your message is still in session memory.`,
    );
    busy = false;
    $("#sendBtn").disabled = false;
    return;
  }
  trace.generate.ms = Math.round(performance.now() - genStart);
  trace.generate.replyTokens = estTokens(reply);
  const agentEl = addChatMsg("agent", reply);
  const aTurn = {
    id: uid("t"),
    role: "agent",
    content: reply,
    at: now(),
    tokens: estTokens(reply),
  };
  M.session.push(aTurn);
  renderSession();
  if (contextual.length) {
    addChipsTo(agentEl, [
      {
        type: "contextual",
        label: `used ${contextual.length} retrieved memor${contextual.length === 1 ? "y" : "ies"}`,
        open: "xray",
        title:
          "These memories were injected into the prompt. Click to see the exact prompt.",
      },
    ]);
  }
  logEvent("write", `session - agent turn, ~${aTurn.tokens} tokens`);
  persist();
  await sleep(350);

  /* 4 · EXTRACT */
  setStage("extract", "mining the exchange for durable knowledge");
  let extraction;
  let dupesRejected = 0;
  let extractEngine = S.mode === "live" ? "llm" : "heuristic";
  lastExtractRaw = null;
  try {
    if (S.mode === "live") {
      extraction = await extractLive(text, reply);
    } else {
      await sleep(650);
      const de = demoExtract(text);
      dupesRejected = de.dupesRejected;
      extraction = {
        items: de.items,
        episode: {
          summary: `User ${isRecallQuery(text) ? "asked what the agent remembers" : `said: "${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"`} and the agent replied.`,
          importance: 0.4,
        },
      };
    }
  } catch (err) {
    logEvent(
      "error",
      `extract: ${esc(err.message)} - falling back to heuristic extraction`,
    );
    extractEngine = "heuristic (llm failed)";
    const de = demoExtract(text);
    dupesRejected = de.dupesRejected;
    extraction = {
      items: de.items,
      episode: {
        summary: `User said: "${text.slice(0, 80)}"`,
        importance: 0.4,
      },
    };
  }
  const semCount = (extraction.items || []).length;
  trace.extract = {
    engine: extractEngine,
    candidates: semCount + dupesRejected,
    dupesRejected,
    raw: lastExtractRaw,
    items: (extraction.items || []).map((it) => ({
      action: it.action || "add",
      kind: it.kind,
      content: (it.content || "").slice(0, 110),
    })),
    episodeSummary: (extraction.episode?.summary || "").slice(0, 140),
  };
  stageNote(
    "extract",
    semCount
      ? `${semCount} durable item(s) found`
      : "no durable knowledge in this message",
  );
  await sleep(450);

  /* 5 · WRITE */
  setStage("write", "committing to long-term stores");
  const { written, invalidRejected } = applyExtraction(
    extraction,
    text,
    userMsgEl,
  );
  trace.write = {
    invalidRejected,
    written: written.map((w) => ({
      id: w.item.id,
      type: w.item.type,
      kind: w.item.kind,
      op: w.op,
      content: w.item.content.slice(0, 110),
    })),
  };
  M.traces.push(trace);
  if (M.traces.length > TRACE_CAP) M.traces = M.traces.slice(-TRACE_CAP);
  persist();
  addChipsTo(userMsgEl, [
    {
      type: "contextual",
      label: "full trace",
      open: `trace:${trace.id}`,
      title:
        "Step-by-step trace of this turn: retrieval scores, exact prompt, extraction output, and every write.",
    },
  ]);
  stageNote(
    "write",
    `${written.length} write(s): ${written.map((w) => w.item.type + "/" + w.item.kind).join(", ")}`,
  );
  await sleep(500);
  setStage("__done__"); // marks last stage done
  $$("#pipeline .stage").forEach((s) => s.classList.remove("active"));
  $$("#pipeline .stage").forEach((s) => s.classList.add("done"));

  busy = false;
  $("#sendBtn").disabled = false;
  input.focus();
}

/* --------------------------- consolidation --------------------------- */
function endSession() {
  if (!M.session.length) {
    logEvent("info", "session is already empty - nothing to consolidate");
    return;
  }
  const userTurns = M.session.filter((t) => t.role === "user").length;
  const gist = M.session
    .filter((t) => t.role === "user")
    .map((t) => t.content.slice(0, 60))
    .slice(0, 3)
    .join(" / ");
  const item = makeItem(
    "episodic",
    "episode",
    `Session with ${userTurns} user message(s), ${fmtTime(M.sessionStartedAt || now())}-${fmtTime(now())}. Topics: ${gist || "(empty)"}`,
    "Session consolidation: when working memory is cleared, the whole conversation is compressed into one episodic summary. This mirrors how real agents survive context-window limits - the verbatim transcript is gone, but the gist of the event survives.",
    "(whole session transcript)",
  );
  item.importance = 0.7;
  M.episodic.push(item);
  M.session = [];
  M.sessionStartedAt = null;
  contextual = [];
  persist();
  renderAll();
  flashPanel("episodic");
  flashCard(item.id, "just-written");
  firePackets(
    $(`.mem-panel[data-type="session"]`),
    $(`.mem-panel[data-type="episodic"]`),
    "#ffb454",
    4,
  );
  logEvent(
    "write",
    `episodic <a data-open="item:${item.id}">session consolidated into one episode</a>; working memory cleared`,
  );
  addChatMsg(
    "system-note",
    "Session ended. Working memory was wiped, but first it was consolidated: one episodic summary of the whole conversation now lives in the amber panel. This is how agents survive context-window limits.",
  );
}

/* ------------------------------ drawer ------------------------------- */
const EXPLAIN = {
  session: {
    title: "Session memory (working memory)",
    color: "var(--session)",
    body: `
      <div class="d-section"><h4>What it is</h4>
        <p>The model's short-term attention: the context window. Every turn you see here is
        re-sent to the LLM <b>verbatim, on every single request</b>. Nothing here is "learned" -
        it is literally pasted into the prompt each time.</p></div>
      <div class="d-section"><h4>Why it exists</h4>
        <p class="dim">LLMs are stateless. Between two API calls the model remembers nothing.
        The illusion of a continuous conversation is created by replaying this buffer.</p></div>
      <div class="d-section"><h4>Its fatal flaw</h4>
        <p class="dim">It is finite (watch the token bar fill) and volatile - close the session and
        it is gone. That is exactly why the other three memory systems exist: they are the
        agent's way of saving what matters before this buffer dies.</p></div>
      <div class="d-section"><h4>Try it</h4>
        <p class="dim">Press "end session" in the top bar and watch the buffer get compressed
        into a single episodic memory before being wiped.</p></div>`,
  },
  episodic: {
    title: "Episodic memory",
    color: "var(--episodic)",
    body: `
      <div class="d-section"><h4>What it is</h4>
        <p>A diary of <b>events</b>: time-stamped records of what happened in each exchange -
        who said what, when, and how important it felt. Like your own memory of
        "that conversation last Tuesday".</p></div>
      <div class="d-section"><h4>How it gets written</h4>
        <p class="dim">After every reply, the extraction stage summarizes the exchange into one
        episode. When a session ends, the whole conversation is consolidated into a single
        richer episode - that mirrors what happens in humans during sleep.</p></div>
      <div class="d-section"><h4>How it gets read</h4>
        <p class="dim">When a new message resembles a past event, retrieval pulls the episode into
        contextual memory, so the agent can say "last time we talked about X...".</p></div>
      <div class="d-section"><h4>Episodic vs semantic</h4>
        <p class="dim">Episodic remembers <i>that Tuesday you mentioned Rust</i>.
        Semantic remembers <i>you are learning Rust</i> - the event stripped away, only the
        knowledge kept.</p></div>`,
  },
  semantic: {
    title: "Semantic memory",
    color: "var(--semantic)",
    body: `
      <div class="d-section"><h4>What it is</h4>
        <p>Distilled knowledge about you: stable <b>facts</b> (name, job, location),
        <b>preferences</b> (tastes, working style), and <b>skills</b> (what you know or are
        learning). The original sentence is thrown away; only the meaning survives.</p></div>
      <div class="d-section"><h4>How it gets written</h4>
        <p class="dim">Stage 4 of the pipeline runs an extraction pass over every exchange asking:
        "is there anything durable and reusable here?". Chit-chat is rejected; identity,
        preference and capability statements are kept, each with a recorded reason.</p></div>
      <div class="d-section"><h4>How it gets updated</h4>
        <p class="dim">New statements that contradict or refine an old memory <b>update it in place</b>
        instead of duplicating it - say "actually I prefer long answers now" and watch the
        preference item change, keeping its full edit history.</p></div>
      <div class="d-section"><h4>Why it matters</h4>
        <p class="dim">This store is what makes an agent feel like it knows you across sessions.
        It survives "end session" and even a browser restart (it lives in localStorage).</p></div>`,
  },
  contextual: {
    title: "Contextual memory (retrieval)",
    color: "var(--contextual)",
    body: `
      <div class="d-section"><h4>What it is</h4>
        <p>Not a store - a <b>spotlight</b>. For every message you send, the agent searches its
        episodic + semantic stores, scores every memory for relevance, and injects only the
        winners into the prompt. This panel shows exactly what was recalled for the last
        message, and why.</p></div>
      <div class="d-section"><h4>How scoring works here</h4>
        <p class="dim">This demo uses transparent lexical scoring: word overlap between your message
        and each memory, normalized by memory length, plus a recency boost, a reinforcement
        boost (often-recalled memories score higher), and an importance boost. Production
        systems use embedding vectors instead - same idea, fuzzier matching.</p></div>
      <div class="d-section"><h4>Why not inject everything?</h4>
        <p class="dim">The context window is small and expensive (watch the blue token bar).
        Retrieval is the art of spending those tokens only on memories that will actually
        improve this specific answer.</p></div>
      <div class="d-section"><h4>See it yourself</h4>
        <p class="dim">Each retrieved card shows its score, which of your words matched, and glows
        teal in its home panel at the moment of recall. Press "prompt x-ray" to see the
        retrieved memories sitting inside the real prompt.</p></div>`,
  },
};

function openDrawer(title, bodyHtml, wide = false) {
  $("#drawer").classList.toggle("wide", wide);
  $("#drawerTitle").textContent = title;
  $("#drawerBody").innerHTML = bodyHtml;
  $("#overlay").classList.add("open");
  $("#drawer").classList.add("open");
}
function closeDrawer() {
  $("#overlay").classList.remove("open");
  $("#drawer").classList.remove("open");
}

function openItem(id) {
  const item = [...M.semantic, ...M.episodic].find((i) => i.id === id);
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
    <div class="d-section"><h4>Retrieval history</h4>${retrievalsHtml}</div>`,
  );
}

function openSessionTurn(id) {
  const t = M.session.find((x) => x.id === id);
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

function openXray() {
  if (!lastPrompt) {
    openDrawer(
      "Prompt x-ray",
      `<div class="d-section"><p class="dim">No prompt captured yet. Send a message first, then come back - you will see the exact messages array sent to the model, with retrieved memories highlighted inside it.</p></div>`,
    );
    return;
  }
  const dump = lastPrompt
    .map((m) => `[${m.role}]\n${m.content}`)
    .join("\n\n" + "-".repeat(40) + "\n\n");
  openDrawer(
    "Prompt x-ray · last turn",
    `
    <div class="d-section"><h4>What this is</h4>
      <p>The exact messages array sent to the ${S.mode === "live" ? "model via " + PROVIDERS[S.provider].label : "demo model"} on the last turn.
      Notice the RETRIEVED MEMORIES block inside the system message - that is contextual memory doing its job,
      and the conversation turns below it are session memory being replayed.</p></div>
    <div class="d-section"><h4>Messages</h4>
      <pre class="promptdump">${esc(dump)}</pre></div>
    ${
      lastExtractRaw
        ? `<div class="d-section"><h4>Raw extraction output (stage 4)</h4>
      <pre class="promptdump">${esc(lastExtractRaw)}</pre></div>`
        : ""
    }`,
  );
}

/* ---------------------------- onboarding ----------------------------- */
function openOnboarding() {
  openDrawer(
    "How Memory Glassbox works",
    `
    <div class="launch-demo">
      <video controls playsinline preload="metadata" poster="assets/openmemoryui-launch.jpg" src="assets/openmemoryui-launch.mp4"></video>
      <div class="caption"><span>Launch demo</span><span>21 seconds</span></div>
    </div>

    <div class="d-section"><h4>What this is</h4>
      <p>A transparent agentic memory playground. Every message you send is traced
      through a real 5-stage memory pipeline - <b>receive → retrieve → generate →
      extract → write</b> - and the panels on the right show every read and write
      as it happens. Click any stored memory to see exactly why it was kept.</p></div>

    <div class="d-section"><h4>1 · Pick a mode</h4>
      <p><b>demo</b> needs no key: a simulated model answers, but the memory
      machinery (storage, retrieval, provenance) is fully real. Start here.</p>
      <p class="dim"><b>live</b> replaces the simulated model with a real LLM -
      generation and memory extraction are then done by the model you choose.</p></div>

    <div class="d-section"><h4>2 · Bring your own key (live mode)</h4>
      <p>Choose a provider in the top bar, then paste that provider's API key:</p>
      <p class="dim">
        · <b>OpenRouter</b> - one key, hundreds of models, several free ones.
          Get a key at <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener">openrouter.ai/settings/keys</a><br>
        · <b>Anthropic</b> - Claude models (Opus, Sonnet, Haiku).
          Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a><br>
        · <b>OpenAI</b> - GPT and o-series models.
          Get a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a></p>
      <p class="dim">You can add a key for each provider - each one is remembered
      separately, and switching provider switches back to its key and model.</p></div>

    <div class="d-section"><h4>3 · Your models appear automatically</h4>
      <p>The moment a key is added, the model dropdown is filled by asking the
      provider's own models API - so it lists exactly the models <b>your</b> key
      can access, not a hardcoded list. Pick one and start chatting; there is also
      a "custom model id" escape hatch if you know a model the list misses.</p>
      <p class="dim">On OpenRouter, if your chosen free model is rate-limited the
      app automatically falls through a chain of other free models.</p></div>

    <div class="d-section"><h4>4 · Where your key lives</h4>
      <p class="dim">Keys are stored only in this browser's localStorage and are
      sent only to the provider you selected - requests go straight from your
      browser to api.anthropic.com / api.openai.com / openrouter.ai. There is no
      backend and nothing is logged anywhere else. "wipe all" clears memories;
      clearing your browser storage removes the keys too.</p></div>

    <div class="d-section"><h4>5 · Watch the memory</h4>
      <p class="dim">The four panels are the whole story: <b>session</b> is the
      context window (replayed every turn), <b>episodic</b> is a diary of events,
      <b>semantic</b> holds distilled facts / preferences / skills, and
      <b>contextual</b> shows what retrieval recalled for the last message and why.
      Press "prompt x-ray" any time to see the exact prompt the model received,
      with retrieved memories inside it. The "?" button on each panel explains it
      in depth.</p>
      <p class="dim">For the full picture, open <b>insights</b> in the top bar:
      retrieval and write funnels for your last turn, memory growth graphs, and a
      map of which keywords went to which store. And under every message you send,
      a <b>full trace</b> chip replays that turn step by step - tokenization,
      every retrieval score (including rejects), the exact prompt, the raw
      extraction output, and every write.</p></div>

    <div class="d-section"><h4>Try it now</h4>
      <p class="dim">Stay in demo mode and send: "My name is Manish and I work as a
      data engineer" - then watch the violet semantic panel light up. Ask "what do
      you remember about me?" a few messages later.</p></div>`,
  );
}

/* ----------------------------- insights ------------------------------ */
const STORE_COLORS = {
  session: "#6fd3ff",
  episodic: "#ffb454",
  semantic: "#a78bfa",
  contextual: "#57e6c4",
};
const KIND_COLORS = {
  fact: "#a78bfa",
  preference: "#f87693",
  skill: "#6fd3ff",
  episode: "#ffb454",
};

function funnelRows(rows) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    `<div class="funnel">` +
    rows
      .map(
        (r) => `
    <div class="f-row" title="${esc(r.title || "")}">
      <span class="f-label">${esc(r.label)}</span>
      <span class="f-bar"><i style="width:${r.n ? Math.max((r.n / max) * 100, 3) : 0}%; background:${r.color}"></i></span>
      <span class="f-n">${r.n}</span>
    </div>`,
      )
      .join("") +
    `</div>`
  );
}

function growthChartSVG() {
  const pts = [
    ...M.semantic.map((i) => ({ at: i.createdAt, t: "s" })),
    ...M.episodic.map((i) => ({ at: i.createdAt, t: "e" })),
  ].sort((a, b) => a.at - b.at);
  if (!pts.length) return null;
  const W = 620,
    H = 170,
    L = 30,
    R = 108,
    T = 12,
    B = 24;
  const x0 = pts[0].at,
    x1 = Math.max(pts[pts.length - 1].at, x0 + 1);
  let s = 0,
    e = 0;
  const sPts = [[x0, 0]],
    ePts = [[x0, 0]];
  for (const p of pts) {
    if (p.t === "s") {
      s++;
      sPts.push([p.at, s]);
    } else {
      e++;
      ePts.push([p.at, e]);
    }
  }
  sPts.push([x1, s]);
  ePts.push([x1, e]);
  const maxY = Math.max(s, e, 1);
  const X = (t) => L + ((t - x0) / (x1 - x0)) * (W - L - R);
  const Y = (v) => T + (1 - v / maxY) * (H - T - B);
  const path = (arr) => {
    let d = `M ${X(arr[0][0]).toFixed(1)} ${Y(arr[0][1]).toFixed(1)}`;
    for (let i = 1; i < arr.length; i++)
      d += ` H ${X(arr[i][0]).toFixed(1)} V ${Y(arr[i][1]).toFixed(1)}`;
    return d;
  };
  // keep the two end labels from colliding
  let yS = Y(s),
    yE = Y(e);
  if (Math.abs(yS - yE) < 13) {
    if (yS <= yE) yE = yS + 13;
    else yS = yE + 13;
  }
  const grid = [0, Math.round(maxY / 2), maxY]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map(
      (v) => `
    <line x1="${L}" y1="${Y(v)}" x2="${W - R}" y2="${Y(v)}" stroke="#263548" stroke-width="1"/>
    <text x="${L - 5}" y="${Y(v) + 3}" text-anchor="end" font-size="9" fill="#5c7183" font-family="Spline Sans Mono, monospace">${v}</text>`,
    )
    .join("");
  const endLabel = (color, y, name, n) => `
    <circle cx="${W - R + 4}" cy="${y}" r="3.5" fill="${color}"/>
    <text x="${W - R + 11}" y="${y + 3}" font-size="10" fill="#8ca0b3" font-family="Spline Sans Mono, monospace">${name} · ${n}</text>`;
  return `
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative memory count over time: ${s} semantic, ${e} episodic">
    ${grid}
    <path d="${path(ePts)}" fill="none" stroke="${STORE_COLORS.episodic}" stroke-width="2" stroke-linejoin="round"/>
    <path d="${path(sPts)}" fill="none" stroke="${STORE_COLORS.semantic}" stroke-width="2" stroke-linejoin="round"/>
    ${endLabel(STORE_COLORS.semantic, yS, "semantic", s)}
    ${endLabel(STORE_COLORS.episodic, yE, "episodic", e)}
    <text x="${L}" y="${H - 6}" font-size="9" fill="#5c7183" font-family="Spline Sans Mono, monospace">${new Date(x0).toLocaleString()}</text>
    <text x="${W - R}" y="${H - 6}" text-anchor="end" font-size="9" fill="#5c7183" font-family="Spline Sans Mono, monospace">${new Date(x1).toLocaleString()}</text>
  </svg>`;
}

function keywordStats() {
  const map = new Map(); // token -> where it ended up / what it triggered
  const bump = (t, k) => {
    const o = map.get(t) || { semantic: 0, episodic: 0, matched: 0 };
    o[k]++;
    map.set(t, o);
  };
  for (const it of M.semantic)
    for (const t of new Set(tokenize(it.content))) bump(t, "semantic");
  for (const it of M.episodic)
    for (const t of new Set(tokenize(it.content))) bump(t, "episodic");
  for (const it of [...M.semantic, ...M.episodic])
    for (const r of it.retrievals)
      for (const t of r.matched || []) bump(t, "matched");
  map.delete("user");
  map.delete("user's"); // every stored memory starts with "User ...", so it carries no signal
  return [...map.entries()]
    .map(([kw, o]) => ({
      kw,
      ...o,
      total: o.semantic + o.episodic + o.matched,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);
}

function openInsights() {
  const t = M.traces[M.traces.length - 1];
  const semWrites = t
    ? t.write.written.filter((w) => w.type === "semantic").length
    : 0;
  const epiWrites = t
    ? t.write.written.filter((w) => w.type === "episodic").length
    : 0;
  const rejected = t ? t.extract.dupesRejected + t.write.invalidRejected : 0;

  const lastTurnHtml = !t
    ? `<p class="dim">Send a message first - the funnels trace your latest turn.</p>`
    : `
    <p class="dim" style="margin-bottom:2px">Your last message: <i>"${esc(t.text.slice(0, 90))}${t.text.length > 90 ? "…" : ""}"</i></p>
    <p style="margin-top:8px"><b>Retrieval funnel</b> - of everything in long-term memory, what made it into the prompt:</p>
    ${funnelRows([
      {
        label: "memories in long-term pool",
        n: t.retrieve.pool,
        color: "#5c7183",
        title: "All semantic + episodic memories that were scored",
      },
      {
        label: "scored above threshold",
        n: t.retrieve.above,
        color: STORE_COLORS.contextual + "99",
        title: "Lexical score > 0.05",
      },
      {
        label: "injected into the prompt",
        n: t.retrieve.picked,
        color: STORE_COLORS.contextual,
        title: "Top-k winners, sent to the model as RETRIEVED MEMORIES",
      },
    ])}
    <p style="margin-top:12px"><b>Write funnel</b> - of what the extractor proposed, what got stored:</p>
    ${funnelRows([
      {
        label: "extraction candidates",
        n: t.extract.candidates,
        color: "#5c7183",
        title: "Durable-knowledge candidates mined from the exchange",
      },
      {
        label: "written to semantic",
        n: semWrites,
        color: STORE_COLORS.semantic,
        title: "Facts / preferences / skills committed",
      },
      {
        label: "rejected (dupe / invalid)",
        n: rejected,
        color: "#f87693",
        title: "Duplicates of existing memories, or malformed extractor output",
      },
      {
        label: "episode journaled",
        n: epiWrites,
        color: STORE_COLORS.episodic,
        title: "The exchange itself, always recorded as one episodic event",
      },
    ])}
    <p class="dim" style="margin-top:8px">Open the <b>full trace</b> chip under any of your messages for the step-by-step version with scores and the exact prompt.</p>`;

  const growth = growthChartSVG();
  const growthHtml = growth
    ? `<div class="chart-box">${growth}</div>
       <div class="legend">
         <span><span class="sw" style="background:${STORE_COLORS.semantic}"></span>semantic (facts, preferences, skills)</span>
         <span><span class="sw" style="background:${STORE_COLORS.episodic}"></span>episodic (events)</span>
       </div>`
    : `<p class="dim">Nothing stored yet - the growth chart appears after your first message.</p>`;

  const kinds = { fact: 0, preference: 0, skill: 0 };
  M.semantic.forEach((i) => {
    if (kinds[i.kind] !== undefined) kinds[i.kind]++;
  });
  const kindHtml = funnelRows([
    {
      label: "facts",
      n: kinds.fact,
      color: KIND_COLORS.fact,
      title: "Identity, job, location...",
    },
    {
      label: "preferences",
      n: kinds.preference,
      color: KIND_COLORS.preference,
      title: "Tastes and working style",
    },
    {
      label: "skills",
      n: kinds.skill,
      color: KIND_COLORS.skill,
      title: "What you know, use, or are learning",
    },
    {
      label: "episodes",
      n: M.episodic.length,
      color: KIND_COLORS.episode,
      title: "Journaled events",
    },
  ]);

  const recalled = [...M.semantic, ...M.episodic]
    .filter((i) => i.retrievals.length)
    .sort((a, b) => b.retrievals.length - a.retrievals.length)
    .slice(0, 6);
  const recalledHtml = recalled.length
    ? funnelRows(
        recalled.map((i) => ({
          label: i.content.slice(0, 34),
          n: i.retrievals.length,
          color: STORE_COLORS.contextual,
          title: i.content,
        })),
      )
    : `<p class="dim">No memory has been recalled yet. Retrieval counts show up as you keep chatting.</p>`;

  const kws = keywordStats();
  const chip = (n, color, label) =>
    n
      ? `<span class="kw-chip" style="background:${color}22; color:${color}">${label} ${n}</span>`
      : "";
  const kwHtml = kws.length
    ? `<table class="kw-table">
        <tr><th>keyword</th><th>where it lives / what it did</th></tr>
        ${kws
          .map(
            (k) => `<tr>
          <td class="kw">${esc(k.kw)}</td>
          <td>${chip(k.semantic, STORE_COLORS.semantic, "semantic")}${chip(k.episodic, STORE_COLORS.episodic, "episodic")}${chip(k.matched, STORE_COLORS.contextual, "retrieval hits")}</td>
        </tr>`,
          )
          .join("")}
      </table>
      <p class="dim" style="margin-top:6px">"semantic / episodic" = how many stored memories contain the keyword.
      "retrieval hits" = how many times that keyword matched a query and helped recall a memory.</p>`
    : `<p class="dim">No keywords yet - they are extracted from stored memories as you chat.</p>`;

  openDrawer(
    "Insights · funnels, graphs & keywords",
    `
    <div class="d-section"><h4>Last turn - where things went</h4>${lastTurnHtml}</div>
    <div class="d-section"><h4>Memory growth over time (cumulative)</h4>${growthHtml}</div>
    <div class="d-section"><h4>What is stored, by kind</h4>${kindHtml}</div>
    <div class="d-section"><h4>Most recalled memories</h4>${recalledHtml}</div>
    <div class="d-section"><h4>Keywords → where they went</h4>${kwHtml}</div>
    <div class="d-section"><p class="dim">Every number here is recomputed live from the raw records in localStorage - nothing is estimated. Click any memory card in the main panels for its full provenance.</p></div>`,
    true,
  );
}

/* ---------------------------- turn trace ------------------------------ */
function openTrace(id) {
  const t = M.traces.find((x) => x.id === id);
  if (!t) {
    openDrawer(
      "Turn trace",
      `<div class="d-section"><p class="dim">This trace has expired (only the last ${TRACE_CAP} turns are kept).</p></div>`,
    );
    return;
  }
  const qset = new Set(t.retrieve.queryTokens);
  const tokenChips = t.retrieve.rawTokens
    .map((w) =>
      qset.has(w)
        ? `<span class="tok hit">${esc(w)}</span>`
        : `<span class="tok drop" title="stopword / too short - ignored by retrieval">${esc(w)}</span>`,
    )
    .join("");
  const candRows = t.retrieve.candidates
    .map(
      (c) => `
    <tr class="${c.picked ? "" : "rejected"}">
      <td class="num">${c.score.toFixed(2)}</td>
      <td class="num">${c.picked ? "✓ injected" : "below cut"}</td>
      <td><span class="kind ${kindClass(c.kind)}">${esc(c.kind)}</span></td>
      <td>${esc(c.content)}${c.matched.length ? ` <span class="muted-s" style="color:var(--faint)">(matched: ${esc(c.matched.slice(0, 4).join(", "))})</span>` : ""}</td>
    </tr>`,
    )
    .join("");
  const extractItems = t.extract.items.length
    ? t.extract.items
        .map(
          (it) =>
            `<div class="d-history-item"><span class="kind ${kindClass(it.kind)}">${esc(it.kind)}</span> ${it.action === "update" ? "<b>update:</b> " : ""}${esc(it.content)}</div>`,
        )
        .join("")
    : `<p class="dim">Nothing durable found in this message.</p>`;
  const writeItems = t.write.written
    .map(
      (w) => `
    <div class="d-history-item">
      <span class="kind ${kindClass(w.kind)}">${esc(w.kind)}</span>
      ${w.op === "update" ? "updated in" : "written to"} <b>${w.type}</b> -
      <a data-open="item:${w.id}">${esc(w.content)}</a>
    </div>`,
    )
    .join("");
  openDrawer(
    `Turn trace · ${fmtTime(t.at)}`,
    `
    <div class="d-section"><div class="d-quote">${esc(t.text)}</div></div>

    <div class="trace-stage"><h5>1 · Receive</h5>
      <p class="dim">Appended verbatim to session memory (~${t.receive.tokens} tokens). The context window already held ${t.receive.sessionTurnsBefore} turn(s).</p></div>

    <div class="trace-stage"><h5>2 · Retrieve</h5>
      <p class="dim">Your message was tokenized; solid chips were used for scoring, dashed ones were dropped as stopwords:</p>
      <p style="margin:6px 0">${tokenChips || '<span class="dim">no scorable tokens</span>'}</p>
      <p class="dim">${t.retrieve.pool} memories scored → ${t.retrieve.above} above threshold → top ${t.retrieve.picked} injected${t.retrieve.recall ? " (recall-all question: semantic memories boosted)" : ""}. Top candidates:</p>
      <table class="cand-table">${candRows || `<tr><td class="dim">long-term memory was empty</td></tr>`}</table></div>

    <div class="trace-stage"><h5>3 · Generate</h5>
      <div class="d-kv">
        <span class="k">engine</span><span class="v">${esc(t.generate.provider)} / ${esc(t.generate.model)}</span>
        <span class="k">latency</span><span class="v">${t.generate.ms} ms</span>
        <span class="k">prompt</span><span class="v">${t.generate.promptMessages} messages · ~${t.generate.promptTokens} tokens</span>
        <span class="k">reply</span><span class="v">~${t.generate.replyTokens} tokens</span>
      </div>
      <p class="dim" style="margin-top:6px">The exact prompt (retrieved memories are inside the system message):</p>
      <pre class="promptdump">${esc(t.promptDump)}</pre></div>

    <div class="trace-stage"><h5>4 · Extract</h5>
      <p class="dim">Engine: ${esc(t.extract.engine)}. ${t.extract.candidates} candidate(s)${t.extract.dupesRejected ? `, ${t.extract.dupesRejected} rejected as duplicates` : ""}.</p>
      ${extractItems}
      <p class="dim" style="margin-top:6px">Episode: ${esc(t.extract.episodeSummary)}</p>
      ${t.extract.raw ? `<p class="dim" style="margin-top:6px">Raw model output:</p><pre class="promptdump">${esc(t.extract.raw)}</pre>` : ""}</div>

    <div class="trace-stage"><h5>5 · Write</h5>
      ${writeItems || `<p class="dim">Nothing written.</p>`}
      ${t.write.invalidRejected ? `<p class="dim">${t.write.invalidRejected} item(s) dropped as malformed extractor output.</p>` : ""}</div>`,
    true,
  );
}

/* -------------------------- key validation ---------------------------- */
async function validateKey(announceInChat) {
  const provider = S.provider,
    cfg = PROVIDERS[provider],
    key = S.keys[provider];
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
    if (S.provider !== provider) return; // user switched provider mid-check
    renderModelGroups(groups);
    const total = groups.reduce((a, g) => a + g.models.length, 0);
    st.className = "ok";
    st.textContent = `✓ key ok · ${total} models`;
    logEvent(
      "info",
      `${cfg.label} key verified - ${total} model(s) loaded into the picker`,
    );
    if (announceInChat) {
      $("#hero")?.remove();
      addChatMsg(
        "system-note",
        `✓ Your ${cfg.label} API key works. ${total} model${total === 1 ? "" : "s"} it can access are now in the model picker (top bar). Currently selected: ${currentModel()}. Switch to live mode and say hi!`,
      );
    }
  } catch (e) {
    if (S.provider !== provider) return;
    st.className = "bad";
    st.textContent = "✗ key failed";
    logEvent("error", `${cfg.label} key check failed: ${esc(e.message)}`);
    if (announceInChat) {
      $("#hero")?.remove();
      addChatMsg(
        "system-note",
        `✗ Your ${cfg.label} API key did not validate: ${e.message}\nDouble-check the key (get one at ${cfg.keyUrl}) and try again.`,
      );
    }
  }
}

/* ------------------------------ wiring ------------------------------- */
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
    const ex = EXPLAIN[explainBtn.dataset.explain];
    if (ex) openDrawer(ex.title, ex.body);
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

$("#sendBtn").addEventListener("click", handleSend);
$("#input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

$("#endSessionBtn").addEventListener("click", endSession);
$("#wipeBtn").addEventListener("click", () => {
  if (
    !confirm(
      "Erase ALL memories (session, episodic, semantic) and turn traces? This cannot be undone.",
    )
  )
    return;
  M = {
    session: [],
    episodic: [],
    semantic: [],
    traces: [],
    sessionStartedAt: null,
  };
  contextual = [];
  lastPrompt = null;
  lastExtractRaw = null;
  persist();
  renderAll();
  logEvent("info", "all memory stores wiped");
});
$("#xrayBtn").addEventListener("click", openXray);
$("#insightsBtn").addEventListener("click", openInsights);

function setMode(mode) {
  S.mode = mode;
  $("#modeDemo").classList.toggle("on", mode === "demo");
  $("#modeLive").classList.toggle("on", mode === "live");
  $("#liveCtls").style.display = mode === "live" ? "flex" : "none";
  persistSettings();
  logEvent(
    "info",
    mode === "live"
      ? `live mode: real LLM calls via ${PROVIDERS[S.provider].label} (${esc(currentModel())})`
      : "demo mode: simulated model, real memory pipeline",
  );
}
$("#modeDemo").addEventListener("click", () => setMode("demo"));
$("#modeLive").addEventListener("click", () => setMode("live"));

function setProvider(provider) {
  S.provider = provider;
  persistSettings();
  const cfg = PROVIDERS[provider];
  $("#providerSel").value = provider;
  $("#apiKey").value = S.keys[provider] || "";
  $("#apiKey").placeholder = cfg.keyPlaceholder;
  $("#apiKey").title =
    `${cfg.label} API key. Stored only in this browser's localStorage. Press Enter to verify it. Get one at ${cfg.keyUrl}`;
  $("#keyStatus").className = "";
  $("#keyStatus").textContent = "";
  renderStaticModels(); // instant list; replaced by the live catalog below
  if (S.keys[provider])
    validateKey(false); // silently re-verify the saved key + load its models
  else populateModels();
}
$("#providerSel").addEventListener("change", (e) => {
  setProvider(e.target.value);
  logEvent("info", `provider switched to ${PROVIDERS[S.provider].label}`);
});
$("#apiKey").addEventListener("change", (e) => {
  S.keys[S.provider] = e.target.value.trim();
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
    S.models[S.provider] = e.target.value;
    persistSettings();
  }
});
$("#modelCustom").addEventListener("change", (e) => {
  if (e.target.value.trim()) {
    S.models[S.provider] = e.target.value.trim();
    persistSettings();
  }
});
$("#howBtn").addEventListener("click", openOnboarding);

/* ------------------------------- boot -------------------------------- */
load();
setProvider(S.provider);
setMode(S.mode);
renderAll();
if (!S.onboarded) {
  S.onboarded = true;
  persistSettings();
  openOnboarding();
}
logEvent(
  "info",
  `glassbox online - ${M.semantic.length} semantic, ${M.episodic.length} episodic memories loaded from localStorage`,
);
if (M.session.length)
  logEvent(
    "info",
    `restored ${M.session.length} session turn(s) from your last visit`,
  );
