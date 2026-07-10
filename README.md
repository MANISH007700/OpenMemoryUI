# OpenMemoryUI - Memory Glassbox

A fully transparent agentic memory system you can talk to.
Every message you send is traced live through a real memory pipeline, so you can watch exactly where it gets stored, why, and how it is recalled later.

## What it shows

The agent's memory is split into four stores, each rendered as a live panel:

| Store | What it holds | Lifetime |
|---|---|---|
| **Session memory** | The context window: every turn, verbatim, re-sent to the model on each request | Until you end the session |
| **Episodic memory** | A time-stamped diary of events ("that exchange at 23:16") | Persistent (localStorage) |
| **Semantic memory** | Distilled facts, preferences, and skills extracted from what you say | Persistent (localStorage) |
| **Contextual memory** | The retrieval spotlight: which memories were recalled for the last message, with relevance scores | Recomputed every turn |

Every message runs through a visible five-stage pipeline: **Receive → Retrieve → Generate → Extract → Write**.
Animated packets fly from your message into whichever store it lands in, and the memory-bus log at the bottom records every read and write.

Click any stored memory to open its provenance drawer: the exact source message, the reason it was stored, its edit history, and its full retrieval history.
Click the `?` on any panel for a plain-language explainer of that memory type.

## Running it

It is a single self-contained `index.html`.
Open it in a browser, or serve it from any static host.

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

## Extras worth trying

- **prompt x-ray**: see the exact messages array sent to the model on the last turn, with retrieved memories injected into the system prompt.
- **end session**: watch working memory get consolidated into a single episodic summary before being wiped, the way real agents survive context-window limits.
- Say "actually, I prefer..." to watch a semantic memory get updated in place, keeping its edit history.
- Ask "what do you remember about me?" to trigger a recall-all retrieval.

## How memory works here (the honest version)

- **Storage**: everything lives in `localStorage` under `glassbox.memory.v1`, as plain JSON records with id, kind, content, reason, source, timestamps, retrieval log, and edit history.
- **Retrieval**: transparent lexical scoring: word overlap between your message and each memory, normalized by memory length, plus recency, reinforcement (often-recalled memories score higher), and importance boosts. Production systems use embeddings; the idea is the same, the matching is fuzzier.
- **Extraction**: in live mode a second LLM call returns strict JSON deciding what is durable enough to keep, and whether it should add a new memory or update an existing one. In demo mode the same decision is made by regex heuristics.
