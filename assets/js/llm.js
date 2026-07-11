/* Live-mode LLM layer: provider calls, model catalogs, prompt builders and
   extraction parsing. All calls go straight from the browser to the selected
   provider. OpenRouter keeps its free-model fallback chain; Anthropic and
   OpenAI call exactly the model you picked. */

import { FALLBACK_MODELS } from "./config.js";
import { memory, settings, runtime, currentModel } from "./state.js";
import { esc, estTokens } from "./utils.js";
import { logEvent } from "./ui/log.js";

export async function callLLM(messages, opts = {}) {
  if (settings.provider === "openrouter") return callOpenRouter(messages, opts);
  return callProviderOnce(settings.provider, currentModel(), messages, opts);
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

export async function readApiError(res, providerLabel) {
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
      Authorization: `Bearer ${settings.keys.openrouter}`,
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
      "x-api-key": settings.keys.anthropic,
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
      Authorization: `Bearer ${settings.keys.openai}`,
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

/* Each provider's model list is fetched live from its own API, so the
   dropdown always shows exactly the models the pasted key can reach.
   Returns [{label, models: [{id, title}]}] optgroups. */
export async function fetchModelGroups(provider) {
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
        "x-api-key": settings.keys.anthropic,
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
    headers: { Authorization: `Bearer ${settings.keys.openai}` },
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

export function buildChatMessages(userMsg, retrieved) {
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
  let hist = memory.session.slice(-13);
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
    memory.semantic
      .map((s) => `${s.id} | ${s.kind} | ${s.content}`)
      .join("\n") || "(none)";
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

export async function extractLive(userMsg, reply) {
  if (settings.provider !== "openrouter") {
    const raw = await callProviderOnce(
      settings.provider,
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
  runtime.lastExtractRaw = text;
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

export const promptTokenCount = (messages) =>
  messages.reduce((a, m) => a + estTokens(m.content), 0);

export const dumpPrompt = (messages) =>
  messages
    .map((m) => `[${m.role}]\n${m.content}`)
    .join("\n\n" + "-".repeat(40) + "\n\n");
