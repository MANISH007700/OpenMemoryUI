/* The 6-stage memory pipeline every message goes through
   (receive → retrieve → act → generate → extract → write), plus session
   consolidation and the full wipe. */

import { PROVIDERS, TRACE_CAP, TOKEN_BUDGET } from "./config.js";
import {
  memory,
  settings,
  runtime,
  currentKey,
  currentModel,
  makeItem,
  persistMemory,
  persistSettings,
  resetMemory,
} from "./state.js";
import { $, esc, sleep, now, uid, estTokens, fmtTime } from "./utils.js";
import { retrieve, isRecallQuery, tokenize } from "./retrieval.js";
import { demoExtract, demoReply } from "./demo.js";
import { plan, runTool } from "./tools.js";
import { sfx } from "./ui/sound.js";
import {
  callLLM,
  extractLive,
  buildChatMessages,
  promptTokenCount,
  dumpPrompt,
} from "./llm.js";
import { logEvent } from "./ui/log.js";
import { showToast } from "./ui/toast.js";
import {
  setStage,
  stageNote,
  resetStages,
  finishStages,
  firePackets,
  flyKeywords,
  flashPanel,
  flashCard,
} from "./ui/effects.js";
import {
  addChatMsg,
  addChipsTo,
  addPromptActions,
  clearHero,
  addAgentActivity,
  setActivity,
} from "./ui/chat.js";
import {
  renderAll,
  renderSession,
  renderEpisodic,
  renderSemantic,
  renderContextual,
} from "./ui/render.js";

/* The words that "jumped": tokens the stored memory shares with the source
   message. These are what visibly fly from your sentence into the store. */
function jumpedWords(sourceMsg, content) {
  const src = new Set(tokenize(sourceMsg));
  const shared = [...new Set(tokenize(content))].filter((t) => src.has(t));
  return shared.length ? shared.slice(0, 3) : tokenize(content).slice(0, 3);
}

/* Commit the extractor's output to the long-term stores (stage 6). */
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
      const existing = memory.semantic.find((s) => s.id === it.id);
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
    memory.semantic.push(item);
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
  memory.episodic.push(epItem);
  written.push({ item: epItem, op: "write" });

  // render + animate + log + chips
  renderSemantic();
  renderEpisodic();
  const chips = [];
  for (const w of written) {
    const t = w.item.type;
    flashPanel(t);
    flyKeywords(
      userMsgEl || chatPanel,
      $(`.mem-panel[data-type="${t}"]`),
      jumpedWords(sourceMsg, w.item.content),
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
  if (written.length) sfx.write();
  persistMemory();
  return { written, invalidRejected };
}

export async function handleSend() {
  if (runtime.busy) return;
  const input = $("#input");
  const text = input.value.trim();
  if (!text) return;
  if (settings.mode === "live" && !currentKey()) {
    logEvent(
      "error",
      `Live mode needs a ${PROVIDERS[settings.provider].label} API key. Paste one in the top bar (get one at ${PROVIDERS[settings.provider].keyUrl}), or switch to demo mode.`,
    );
    $("#apiKey").focus();
    return;
  }
  runtime.busy = true;
  $("#sendBtn").disabled = true;
  input.value = "";
  clearHero();
  resetStages();
  sfx.send();

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
  trace.receive = {
    tokens: turn.tokens,
    sessionTurnsBefore: memory.session.length,
  };
  if (!memory.session.length) memory.sessionStartedAt = now();
  memory.session.push(turn);
  renderSession();
  flashPanel("session");
  flyKeywords(
    userMsgEl,
    $(`.mem-panel[data-type="session"]`),
    tokenize(text).slice(0, 3),
    "#6fd3ff",
    3,
  );
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
  persistMemory();
  await sleep(500);

  /* 2 · RETRIEVE - search long-term stores */
  setStage("retrieve", "scoring long-term memories against your message");
  sfx.stage();
  const { picked, diag } = retrieve(text);
  runtime.contextual = picked;
  trace.retrieve = diag;
  for (const r of runtime.contextual) {
    r.item.retrievals.push({
      at: now(),
      query: text.slice(0, 120),
      score: r.score,
      matched: r.matched,
    });
    flyKeywords(
      $(`.mem-panel[data-type="${r.item.type}"]`),
      $(`.mem-panel[data-type="contextual"]`),
      r.matched,
      "#57e6c4",
      2,
    );
  }
  renderContextual();
  renderEpisodic();
  renderSemantic();
  runtime.contextual.forEach((r) => flashCard(r.item.id, "just-retrieved"));
  if (runtime.contextual.length) {
    flashPanel("contextual");
    sfx.retrieve();
    stageNote(
      "retrieve",
      `${runtime.contextual.length} memor${runtime.contextual.length === 1 ? "y" : "ies"} recalled`,
    );
    logEvent(
      "read",
      `contextual - retrieved ${runtime.contextual.length} item(s), top score ${runtime.contextual[0].score}: <a data-open="item:${runtime.contextual[0].item.id}">${esc(runtime.contextual[0].item.content.slice(0, 60))}</a>`,
    );
  } else {
    stageNote("retrieve", "nothing relevant in long-term memory");
    logEvent(
      "read",
      "contextual - long-term stores searched, nothing scored above threshold",
    );
  }
  persistMemory();
  await sleep(650);

  /* 3 · ACT - the orchestrator routes to real-world tools when needed */
  setStage(
    "act",
    settings.mode === "live"
      ? "llm planner reading the toolbox"
      : "planner scanning for tool intents",
  );
  sfx.stage();
  trace.act = {
    engine: settings.mode === "live" ? "llm planner" : "regex planner",
    calls: [],
  };
  const toolResults = [];
  let toolCalls = [];
  try {
    toolCalls = await plan(text);
  } catch (e) {
    toolCalls = [];
  }
  if (toolCalls.length) {
    const actEl = addAgentActivity(toolCalls);
    for (let i = 0; i < toolCalls.length; i++) {
      const c = toolCalls[i];
      setActivity(actEl, i, "running");
      stageNote("act", `${c.tool} running…`);
      const t0 = performance.now();
      try {
        const res = await runTool(c.tool, c.args);
        toolResults.push({ tool: c.tool, ok: true, summary: res.summary });
        trace.act.calls.push({
          tool: c.tool,
          args: c.args,
          ok: true,
          summary: res.summary.slice(0, 200),
          ms: Math.round(performance.now() - t0),
        });
        setActivity(actEl, i, "done", res.summary);
        logEvent("tool", `${esc(c.tool)} → ${esc(res.summary.slice(0, 90))}`);
        sfx.tool();
      } catch (err) {
        toolResults.push({ tool: c.tool, ok: false, error: err.message });
        trace.act.calls.push({
          tool: c.tool,
          args: c.args,
          ok: false,
          error: err.message.slice(0, 200),
          ms: Math.round(performance.now() - t0),
        });
        setActivity(actEl, i, "fail", err.message);
        logEvent("error", `tool ${esc(c.tool)} failed: ${esc(err.message)}`);
        sfx.error();
      }
    }
    stageNote(
      "act",
      `${toolResults.filter((r) => r.ok).length}/${toolCalls.length} tool call(s) succeeded`,
    );
  } else {
    stageNote("act", "no tools needed for this message");
  }
  await sleep(350);

  /* 4 · GENERATE */
  setStage(
    "generate",
    settings.mode === "live"
      ? `calling ${currentModel().split("/").pop()} via ${PROVIDERS[settings.provider].label}`
      : "demo model composing a reply",
  );
  sfx.respondStart();
  runtime.lastPrompt = buildChatMessages(text, runtime.contextual, toolResults);
  trace.generate = {
    mode: settings.mode,
    provider:
      settings.mode === "live" ? PROVIDERS[settings.provider].label : "demo",
    model: settings.mode === "live" ? currentModel() : "simulated",
    promptMessages: runtime.lastPrompt.length,
    promptTokens: promptTokenCount(runtime.lastPrompt),
  };
  trace.promptDump = dumpPrompt(runtime.lastPrompt);
  const genStart = performance.now();
  let reply;
  try {
    if (settings.mode === "live") {
      reply = await callLLM(runtime.lastPrompt);
    } else {
      await sleep(600);
      reply = demoReply(text, runtime.contextual, toolResults);
    }
  } catch (err) {
    stageNote("generate", "model call failed");
    sfx.error();
    logEvent("error", `generate: ${esc(err.message)}`);
    addChatMsg(
      "system-note",
      `The model call failed: ${err.message}\nCheck your API key / model in the top bar, or switch to demo mode. Your message is still in session memory.`,
    );
    runtime.busy = false;
    $("#sendBtn").disabled = false;
    return;
  }
  sfx.stage();
  trace.generate.ms = Math.round(performance.now() - genStart);
  trace.generate.replyTokens = estTokens(reply);
  const agentEl = addChatMsg("agent", reply);
  sfx.response();
  const aTurn = {
    id: uid("t"),
    role: "agent",
    content: reply,
    at: now(),
    tokens: estTokens(reply),
  };
  memory.session.push(aTurn);
  renderSession();
  if (runtime.contextual.length) {
    addChipsTo(agentEl, [
      {
        type: "contextual",
        label: `used ${runtime.contextual.length} retrieved memor${runtime.contextual.length === 1 ? "y" : "ies"}`,
        open: "xray",
        title:
          "These memories were injected into the prompt. Click to see the exact prompt.",
      },
    ]);
  }
  logEvent("write", `session - agent turn, ~${aTurn.tokens} tokens`);
  persistMemory();
  await sleep(350);

  /* 5 · EXTRACT */
  setStage("extract", "mining the exchange for durable knowledge");
  sfx.extract();
  let extraction;
  let dupesRejected = 0;
  let extractEngine = settings.mode === "live" ? "llm" : "heuristic";
  runtime.lastExtractRaw = null;
  try {
    if (settings.mode === "live") {
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
    raw: runtime.lastExtractRaw,
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

  /* 6 · WRITE */
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
  memory.traces.push(trace);
  if (memory.traces.length > TRACE_CAP) {
    memory.traces = memory.traces.slice(-TRACE_CAP);
    logEvent(
      "info",
      `eviction: oldest turn trace dropped - only the last ${TRACE_CAP} are kept (see the db meter below)`,
    );
  }
  persistMemory();
  addChipsTo(userMsgEl, [
    {
      type: "contextual",
      label: "full trace",
      open: `trace:${trace.id}`,
      title:
        "Step-by-step trace of this turn: retrieval scores, exact prompt, extraction output, and every write.",
    },
  ]);
  addPromptActions(userMsgEl, text);
  stageNote(
    "write",
    `${written.length} write(s): ${written.map((w) => w.item.type + "/" + w.item.kind).join(", ")}`,
  );
  await sleep(500);
  finishStages();
  sfx.complete();

  // teaching moment: the context window is nearly full - real agents
  // consolidate at exactly this point
  const usedTokens = memory.session.reduce((a, t) => a + t.tokens, 0);
  if (usedTokens > TOKEN_BUDGET * 0.85 && !runtime.budgetWarned) {
    runtime.budgetWarned = true;
    addChatMsg(
      "system-note",
      `The context window is ${Math.round((usedTokens / TOKEN_BUDGET) * 100)}% full - this is the moment real agents have to act. Press "end session" to watch the whole conversation get consolidated into one episodic summary before working memory is cleared.`,
    );
    logEvent(
      "info",
      `session memory at ${usedTokens.toLocaleString()} / ${TOKEN_BUDGET.toLocaleString()} tokens - consolidation recommended`,
    );
  }

  // one-time nudge: after a few turns there is enough data for the analytics
  if (memory.traces.length === 3 && !settings.insightsTipShown) {
    settings.insightsTipShown = true;
    persistSettings();
    addChatMsg(
      "system-note",
      'Tip: you have a few turns of memory activity now. Open "insights" in the top bar for the funnels, growth chart and keyword map of everything so far - or click "full trace" under any message to replay that turn.',
    );
  }

  runtime.busy = false;
  $("#sendBtn").disabled = false;
  input.focus();
}

/* Consolidate the session into one episodic summary, then clear working memory. */
export function endSession() {
  if (!memory.session.length) {
    logEvent("info", "session is already empty - nothing to consolidate");
    return;
  }
  const userTurns = memory.session.filter((t) => t.role === "user").length;
  const gist = memory.session
    .filter((t) => t.role === "user")
    .map((t) => t.content.slice(0, 60))
    .slice(0, 3)
    .join(" / ");
  const item = makeItem(
    "episodic",
    "episode",
    `Session with ${userTurns} user message(s), ${fmtTime(memory.sessionStartedAt || now())}-${fmtTime(now())}. Topics: ${gist || "(empty)"}`,
    "Session consolidation: when working memory is cleared, the whole conversation is compressed into one episodic summary. This mirrors how real agents survive context-window limits - the verbatim transcript is gone, but the gist of the event survives.",
    "(whole session transcript)",
  );
  item.importance = 0.7;
  memory.episodic.push(item);
  memory.session = [];
  memory.sessionStartedAt = null;
  runtime.contextual = [];
  runtime.budgetWarned = false;
  persistMemory();
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

export function wipeAll() {
  const counts = {
    session: memory.session.length,
    episodic: memory.episodic.length,
    semantic: memory.semantic.length,
    traces: memory.traces.length,
  };
  resetMemory();
  runtime.budgetWarned = false;
  renderAll();
  const detail = `${counts.session} session turn(s), ${counts.episodic} episode(s), ${counts.semantic} semantic memory item(s), ${counts.traces} trace(s) deleted.`;
  logEvent("info", `all memory stores wiped - ${esc(detail)}`);
  addChatMsg(
    "system-note",
    `Wipe complete. ${detail} The app is now starting from empty memory.`,
  );
  showToast("Wipe complete", detail, "danger");
}
