/* The provenance drawer: memory item details, session turns, panel
   explainers, the prompt x-ray, and the first-visit onboarding. */

import { EXPLAINERS, PROVIDERS } from "../config.js";
import { memory, settings, runtime, currentModel } from "../state.js";
import { $, esc, fmtFull } from "../utils.js";
import { dumpPrompt } from "../llm.js";

export function openDrawer(title, bodyHtml, wide = false) {
  $("#drawer").classList.toggle("wide", wide);
  $("#drawerTitle").textContent = title;
  $("#drawerBody").innerHTML = bodyHtml;
  $("#overlay").classList.add("open");
  $("#drawer").classList.add("open");
}

export function closeDrawer() {
  $("#overlay").classList.remove("open");
  $("#drawer").classList.remove("open");
}

export function openExplainer(key) {
  const ex = EXPLAINERS[key];
  if (!ex) return;
  const body = ex.sections
    .map((s) => `<div class="d-section"><h4>${s.heading}</h4>${s.html}</div>`)
    .join("");
  openDrawer(ex.title, body);
}

export function openItem(id) {
  const item = [...memory.semantic, ...memory.episodic].find(
    (i) => i.id === id,
  );
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

export function openSessionTurn(id) {
  const t = memory.session.find((x) => x.id === id);
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

export function openXray() {
  if (!runtime.lastPrompt) {
    openDrawer(
      "Prompt x-ray",
      `<div class="d-section"><p class="dim">No prompt captured yet. Send a message first, then come back - you will see the exact messages array sent to the model, with retrieved memories highlighted inside it.</p></div>`,
    );
    return;
  }
  const dump = dumpPrompt(runtime.lastPrompt);
  openDrawer(
    "Prompt x-ray · last turn",
    `
    <div class="d-section"><h4>What this is</h4>
      <p>The exact messages array sent to the ${settings.mode === "live" ? "model via " + PROVIDERS[settings.provider].label : "demo model"} on the last turn.
      Notice the RETRIEVED MEMORIES block inside the system message - that is contextual memory doing its job,
      and the conversation turns below it are session memory being replayed.</p></div>
    <div class="d-section"><h4>Messages</h4>
      <pre class="promptdump">${esc(dump)}</pre></div>
    ${
      runtime.lastExtractRaw
        ? `<div class="d-section"><h4>Raw extraction output (stage 4)</h4>
      <pre class="promptdump">${esc(runtime.lastExtractRaw)}</pre></div>`
        : ""
    }`,
  );
}

export function openOnboarding() {
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
