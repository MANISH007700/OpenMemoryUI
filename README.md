# OpenMemoryUI - Memory Glassbox

A fully transparent agentic memory system you can talk to.
Every message you send is traced live through a real memory pipeline, so you can watch exactly where it gets stored, why, and how it is recalled later.

## Launch video

[![OpenMemoryUI launch video preview](assets/openmemoryui-launch-preview.gif)](https://raw.githubusercontent.com/MANISH007700/OpenMemoryUI/master/assets/openmemoryui-launch.mp4)

The animated preview above plays inline on GitHub. [Open the full MP4 with audio](https://raw.githubusercontent.com/MANISH007700/OpenMemoryUI/master/assets/openmemoryui-launch.mp4) - a 21-second demo made with Brag/Hyperframes. The same video is embedded in the starter UI.

## What it shows

The agent's memory is split into four stores, each rendered as a live panel:

| Store                 | What it holds                                                                                     | Lifetime                  |
| --------------------- | ------------------------------------------------------------------------------------------------- | ------------------------- |
| **Session memory**    | The context window: every turn, verbatim, re-sent to the model on each request                    | Until you end the session |
| **Episodic memory**   | A time-stamped diary of events ("that exchange at 23:16")                                         | Persistent (localStorage) |
| **Semantic memory**   | Distilled facts, preferences, and skills extracted from what you say                              | Persistent (localStorage) |
| **Contextual memory** | The retrieval spotlight: which memories were recalled for the last message, with relevance scores | Recomputed every turn     |

Every message runs through a visible five-stage pipeline: **Receive → Retrieve → Generate → Extract → Write**.
Animated packets fly from your message into whichever store it lands in, and the memory-bus log at the bottom records every read and write.

Click any stored memory to open its provenance drawer: the exact source message, the reason it was stored, its edit history, and its full retrieval history.
Click the `?` on any panel for a plain-language explainer of that memory type.

## Running it

OpenMemoryUI is a plain static app built from native ES modules.
There is no framework, bundler, backend, or build step.

Serve the repository root from any static file server and open `index.html`:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

A server is needed because the browser blocks ES module imports and JSON fetches over `file://`.
Netlify publishes this repo directly from the root; `netlify.toml` pins that static publish setup.

### Project structure

```
index.html                  page shell (panels, top bar, drawer skeleton)
assets/css/
  base.css                  design tokens, reset, scrollbars
  layout.css                app frame: top bar, grids, pipeline strip, log shell
  components.css            chat bubbles, chips, memory cards, hero, packets
  drawer.css                provenance drawer, insights funnels, charts, trace
  welcome.css               first-visit welcome overlay
assets/data/
  providers.json            LLM provider catalog, default + fallback models
  explainers.json           panel explainer copy shown in the drawer
  onboarding.json           welcome-overlay card copy (the four memory stores)
assets/js/
  main.js                   entry point: event wiring and boot
  config.js                 constants; loads the JSON data files
  state.js                  memory/settings/runtime state + localStorage persistence
  retrieval.js              lexical scoring, tokenization, recall detection
  demo.js                   demo-mode brain: regex extraction + canned replies
  llm.js                    live-mode provider calls, model catalogs, prompts
  pipeline.js               the 5-stage send flow, consolidation, wipe
  ui/render.js              the four memory panels + budget bar
  ui/chat.js                chat bubbles and provenance chips
  ui/drawer.js              item/session/x-ray drawer views
  ui/welcome.js             first-visit welcome overlay (memory cards)
  ui/insights.js            insights analytics + per-turn trace views
  ui/settings.js            mode, provider, key validation, model dropdown
  ui/effects.js             pipeline stages, packets, flash animations
  ui/log.js                 the memory-bus log
  utils.js                  DOM shorthands, escaping, formatting
```

### Demo mode (default, zero setup)

A simulated model with rule-based extraction, so the whole pipeline works instantly with no API key.
The memory machinery (storage, retrieval, scoring, provenance) is identical to live mode.

### Live mode (real LLM - OpenRouter, Anthropic, or OpenAI)

1. Switch the mode toggle to **live** and pick a provider in the top bar.
2. Paste that provider's API key:
   - **OpenRouter**: [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) - one key, hundreds of models, several free ones.
   - **Anthropic**: [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) - Claude models (Opus, Sonnet, Haiku).
   - **OpenAI**: [platform.openai.com/api-keys](https://platform.openai.com/api-keys) - GPT and o-series models.
3. The model dropdown fills automatically with the models your key can access, fetched live from the provider's own models API.
4. Chat. Replies and memory extraction are now done by the model you picked.

You can store a key per provider; each provider remembers its own key and last chosen model.
Keys live only in your browser's localStorage and are sent only to the provider you selected - requests go straight from the browser to the provider, with no backend in between.
They are never committed to this repo or sent anywhere else.

On OpenRouter, free-tier models get rate-limited upstream, so the app automatically falls back through several free models when the selected one is busy.
Every provider also has a "custom model id" escape hatch for models the list misses.

A "how it works" onboarding opens on first visit and stays available from the top bar.

3.5. When you press Enter on the key field, the key is verified against the provider right away - a green "✓ key ok · N models" appears next to it and a note in the chat confirms which models were loaded.

## Extras worth trying

- **insights**: funnels for your last turn (long-term pool → scored → injected into the prompt; extraction candidates → written vs rejected), a cumulative memory-growth chart, writes by kind, most-recalled memories, and a keyword map showing which words ended up in which store and which ones triggered retrievals.
- **full trace**: every message you send gets a "full trace" chip that replays that turn step by step - tokenization (with dropped stopwords), every retrieval candidate's score including the rejects, the exact prompt, latency, the raw extraction output, and every write with its destination.
- **prompt x-ray**: see the exact messages array sent to the model on the last turn, with retrieved memories injected into the system prompt.
- **end session**: watch working memory get consolidated into a single episodic summary before being wiped, the way real agents survive context-window limits.
- Say "actually, I prefer..." to watch a semantic memory get updated in place, keeping its edit history.
- Ask "what do you remember about me?" to trigger a recall-all retrieval.

## How memory works here (the honest version)

- **Storage**: everything lives in `localStorage` under `glassbox.memory.v1`, as plain JSON records with id, kind, content, reason, source, timestamps, retrieval log, and edit history.
- **Retrieval**: transparent lexical scoring: word overlap between your message and each memory, normalized by memory length, plus recency, reinforcement (often-recalled memories score higher), and importance boosts. Production systems use embeddings; the idea is the same, the matching is fuzzier.
- **Extraction**: in live mode a second LLM call returns strict JSON deciding what is durable enough to keep, and whether it should add a new memory or update an existing one. In demo mode the same decision is made by regex heuristics.

---

Built with ♥ by [Manish Sharma](https://manish-luci.netlify.app).
If the glassbox made memory click for you, hit the 👏 button in the app footer.
