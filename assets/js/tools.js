/* The toolbox: free, keyless tools the agent can call from the browser.
   Web tools hit public CORS-enabled APIs; local tools run in-page.
   The planner (regex in demo mode, LLM in live mode) picks which to run
   during the Act stage of the pipeline. */

import { settings } from "./state.js";
import { callLLM } from "./llm.js";
import { callMcpTool, mcpToolList } from "./mcp.js";

const WMO = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "rime fog",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  66: "freezing rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  80: "rain showers",
  81: "rain showers",
  82: "violent rain showers",
  95: "thunderstorm",
  96: "thunderstorm with hail",
  99: "thunderstorm with heavy hail",
};

async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`service replied ${res.status}`);
  return res.json();
}

async function geocode(place) {
  const d = await getJSON(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`,
  );
  const g = d.results?.[0];
  if (!g) throw new Error(`could not find a place called "${place}"`);
  return g;
}

const LANGS = {
  english: "en",
  hindi: "hi",
  spanish: "es",
  french: "fr",
  german: "de",
  japanese: "ja",
  chinese: "zh-CN",
  korean: "ko",
  italian: "it",
  portuguese: "pt",
  russian: "ru",
  arabic: "ar",
  dutch: "nl",
  turkish: "tr",
  bengali: "bn",
  tamil: "ta",
  telugu: "te",
  marathi: "mr",
  gujarati: "gu",
  punjabi: "pa",
  urdu: "ur",
  greek: "el",
  polish: "pl",
};

const COINS = {
  btc: "bitcoin",
  bitcoin: "bitcoin",
  eth: "ethereum",
  ethereum: "ethereum",
  sol: "solana",
  solana: "solana",
  doge: "dogecoin",
  dogecoin: "dogecoin",
  ada: "cardano",
  cardano: "cardano",
  xrp: "ripple",
  bnb: "binancecoin",
  ltc: "litecoin",
  litecoin: "litecoin",
  dot: "polkadot",
  polkadot: "polkadot",
};

const FIAT =
  "usd eur inr gbp jpy aud cad chf cny hkd sgd krw mxn brl zar sek nok dkk nzd thb php idr myr".split(
    " ",
  );

/* value-to-SI factor per dimension; temperatures handled separately */
const UNITS = {
  km: ["len", 1000],
  kilometer: ["len", 1000],
  kilometers: ["len", 1000],
  mi: ["len", 1609.344],
  mile: ["len", 1609.344],
  miles: ["len", 1609.344],
  m: ["len", 1],
  meter: ["len", 1],
  meters: ["len", 1],
  ft: ["len", 0.3048],
  foot: ["len", 0.3048],
  feet: ["len", 0.3048],
  cm: ["len", 0.01],
  in: ["len", 0.0254],
  inch: ["len", 0.0254],
  inches: ["len", 0.0254],
  kg: ["mass", 1],
  kilogram: ["mass", 1],
  kilograms: ["mass", 1],
  lb: ["mass", 0.45359237],
  lbs: ["mass", 0.45359237],
  pound: ["mass", 0.45359237],
  pounds: ["mass", 0.45359237],
  g: ["mass", 0.001],
  gram: ["mass", 0.001],
  grams: ["mass", 0.001],
  oz: ["mass", 0.028349523],
  ounce: ["mass", 0.028349523],
  ounces: ["mass", 0.028349523],
  l: ["vol", 1],
  liter: ["vol", 1],
  liters: ["vol", 1],
  litre: ["vol", 1],
  litres: ["vol", 1],
  gal: ["vol", 3.785411784],
  gallon: ["vol", 3.785411784],
  gallons: ["vol", 3.785411784],
  ml: ["vol", 0.001],
  kmh: ["speed", 1],
  kph: ["speed", 1],
  mph: ["speed", 1.609344],
};

function safeCalc(expr) {
  const FNS =
    "sqrt abs round floor ceil sin cos tan log log2 log10 exp pow min max".split(
      " ",
    );
  const tokens = expr.match(/[a-z][a-z0-9]*|\d+\.?\d*|\*\*|[+\-*/%(),^]|\s+/gi);
  if (!tokens || tokens.join("") !== expr)
    throw new Error("only numbers, operators and math functions are allowed");
  const js = tokens
    .map((t) => {
      if (/^\s+$/.test(t) || /^\d/.test(t) || /^[+\-*/%(),]$|^\*\*$/.test(t))
        return t;
      if (t === "^") return "**";
      const low = t.toLowerCase();
      if (low === "pi") return "Math.PI";
      if (low === "e") return "Math.E";
      if (FNS.includes(low)) return "Math." + low;
      throw new Error(`"${t}" is not a known math function`);
    })
    .join("");
  const val = Function(`"use strict"; return (${js});`)();
  if (typeof val !== "number" || !isFinite(val))
    throw new Error("that did not evaluate to a finite number");
  return val;
}

/* ------------------------------ registry ------------------------------ */
/* Each tool: {icon, group, desc, example, run(args) -> {summary, detail?}} */
export const TOOLS = {
  weather: {
    icon: "🌤",
    group: "live data",
    desc: "Current weather anywhere, via Open-Meteo",
    example: "What's the weather in Delhi?",
    args: { place: "city or place name" },
    async run({ place }) {
      const g = await geocode(place);
      const d = await getJSON(
        `https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m`,
      );
      const c = d.current;
      return {
        summary: `Weather in ${g.name}, ${g.country}: ${c.temperature_2m}°C (feels like ${c.apparent_temperature}°C), ${WMO[c.weather_code] || "unknown sky"}, humidity ${c.relative_humidity_2m}%, wind ${c.wind_speed_10m} km/h.`,
      };
    },
  },
  air_quality: {
    icon: "🫁",
    group: "live data",
    desc: "Air quality (PM2.5, US AQI) for any place, via Open-Meteo",
    example: "Air quality in Mumbai",
    args: { place: "city or place name" },
    async run({ place }) {
      const g = await geocode(place);
      const d = await getJSON(
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${g.latitude}&longitude=${g.longitude}&current=pm2_5,pm10,us_aqi`,
      );
      const c = d.current;
      const band =
        c.us_aqi <= 50
          ? "good"
          : c.us_aqi <= 100
            ? "moderate"
            : c.us_aqi <= 150
              ? "unhealthy for sensitive groups"
              : c.us_aqi <= 200
                ? "unhealthy"
                : "very unhealthy";
      return {
        summary: `Air quality in ${g.name}: US AQI ${c.us_aqi} (${band}), PM2.5 ${c.pm2_5} µg/m³, PM10 ${c.pm10} µg/m³.`,
      };
    },
  },
  time_in: {
    icon: "🕐",
    group: "live data",
    desc: "Current local time in any city (geocoded to its timezone)",
    example: "What time is it in Tokyo?",
    args: { place: "city or place name" },
    async run({ place }) {
      const g = await geocode(place);
      const now = new Intl.DateTimeFormat("en", {
        timeZone: g.timezone,
        dateStyle: "full",
        timeStyle: "medium",
      }).format(new Date());
      return {
        summary: `In ${g.name}, ${g.country} it is ${now} (${g.timezone}).`,
      };
    },
  },
  locate: {
    icon: "📍",
    group: "live data",
    desc: "Geographic facts about a place: coordinates, population, timezone",
    example: "Locate Reykjavik",
    args: { place: "city or place name" },
    async run({ place }) {
      const g = await geocode(place);
      return {
        summary: `${g.name}, ${g.admin1 || ""} ${g.country}: lat ${g.latitude}, lon ${g.longitude}${g.population ? `, population ~${g.population.toLocaleString()}` : ""}, timezone ${g.timezone}.`,
      };
    },
  },
  wikipedia: {
    icon: "📚",
    group: "knowledge",
    desc: "Summary of any topic from Wikipedia",
    example: "wiki Alan Turing",
    args: { topic: "topic to look up" },
    async run({ topic }) {
      const fetchSummary = (t) =>
        getJSON(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, "_"))}`,
        );
      let d;
      try {
        d = await fetchSummary(topic);
      } catch (e) {
        const s = await getJSON(
          `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(topic)}&limit=1&origin=*&format=json`,
        );
        if (!s[1]?.[0]) throw new Error(`Wikipedia has nothing on "${topic}"`);
        d = await fetchSummary(s[1][0]);
      }
      return { summary: `${d.title}: ${d.extract}` };
    },
  },
  define: {
    icon: "📖",
    group: "knowledge",
    desc: "Dictionary definition of an English word",
    example: "define serendipity",
    args: { word: "the word" },
    async run({ word }) {
      const d = await getJSON(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      ).catch(() => {
        throw new Error(`no dictionary entry for "${word}"`);
      });
      const meanings = d[0].meanings
        .slice(0, 2)
        .map((m) => `(${m.partOfSpeech}) ${m.definitions[0].definition}`)
        .join(" ");
      return { summary: `${word}: ${meanings}` };
    },
  },
  translate: {
    icon: "🌐",
    group: "knowledge",
    desc: "Translate text into 20+ languages, via MyMemory",
    example: "translate good morning to hindi",
    args: { text: "text to translate", to: "target language" },
    async run({ text, to }) {
      const code = LANGS[(to || "").toLowerCase()] || to;
      const d = await getJSON(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=Autodetect|${code}`,
      );
      const out = d.responseData?.translatedText;
      if (!out) throw new Error("translation service returned nothing");
      return { summary: `"${text}" in ${to}: ${out}` };
    },
  },
  currency: {
    icon: "💱",
    group: "live data",
    desc: "Convert between 30+ fiat currencies, via Frankfurter (ECB rates)",
    example: "convert 100 usd to inr",
    args: { amount: "number", from: "currency code", to: "currency code" },
    async run({ amount, from, to }) {
      const d = await getJSON(
        `https://api.frankfurter.dev/v1/latest?amount=${amount}&from=${from.toUpperCase()}&to=${to.toUpperCase()}`,
      );
      const val = d.rates?.[to.toUpperCase()];
      if (val == null) throw new Error(`no rate for ${from}→${to}`);
      return {
        summary: `${amount} ${from.toUpperCase()} = ${val.toLocaleString()} ${to.toUpperCase()} (ECB reference rate).`,
      };
    },
  },
  crypto: {
    icon: "🪙",
    group: "live data",
    desc: "Live crypto prices, via CoinGecko",
    example: "price of bitcoin",
    args: { coin: "coin name or symbol" },
    async run({ coin }) {
      const id = COINS[(coin || "").toLowerCase()];
      if (!id) throw new Error(`unknown coin "${coin}" (try btc, eth, sol...)`);
      const d = await getJSON(
        `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd,inr&include_24hr_change=true`,
      );
      const p = d[id];
      return {
        summary: `${id}: $${p.usd.toLocaleString()} / ₹${p.inr.toLocaleString()} (${p.usd_24h_change >= 0 ? "+" : ""}${p.usd_24h_change.toFixed(2)}% in 24h).`,
      };
    },
  },
  country: {
    icon: "🌍",
    group: "knowledge",
    desc: "Key facts about any country, via REST Countries",
    example: "country info Japan",
    args: { name: "country name" },
    async run({ name }) {
      const d = await getJSON(
        `https://restcountries.com/v3.1/name/${encodeURIComponent(name)}?fields=name,capital,population,region,subregion,currencies,languages,flag`,
      ).catch(() => {
        throw new Error(`no country matched "${name}"`);
      });
      const c = d[0];
      const langs = Object.values(c.languages || {}).join(", ");
      const curr = Object.values(c.currencies || {})
        .map((x) => x.name)
        .join(", ");
      return {
        summary: `${c.flag} ${c.name.common}: capital ${c.capital?.[0]}, population ${c.population.toLocaleString()}, ${c.subregion || c.region}. Languages: ${langs}. Currency: ${curr}.`,
      };
    },
  },
  github_repo: {
    icon: "🐙",
    group: "live data",
    desc: "Stats for any public GitHub repository",
    example: "github repo MANISH007700/OpenMemoryUI",
    args: { repo: "owner/name" },
    async run({ repo }) {
      const d = await getJSON(`https://api.github.com/repos/${repo}`).catch(
        () => {
          throw new Error(`repo "${repo}" not found (or rate-limited)`);
        },
      );
      return {
        summary: `${d.full_name}: ★${d.stargazers_count} stars, ${d.forks_count} forks, ${d.open_issues_count} open issues, mostly ${d.language || "?"}. "${d.description || ""}"`,
      };
    },
  },
  hackernews: {
    icon: "🗞",
    group: "live data",
    desc: "Top 5 Hacker News stories right now",
    example: "what's on hacker news?",
    args: {},
    async run() {
      const ids = (
        await getJSON("https://hacker-news.firebaseio.com/v0/topstories.json")
      ).slice(0, 5);
      const items = await Promise.all(
        ids.map((id) =>
          getJSON(`https://hacker-news.firebaseio.com/v0/item/${id}.json`),
        ),
      );
      return {
        summary:
          "Top of Hacker News: " +
          items
            .map((s, i) => `${i + 1}) ${s.title} (${s.score} pts)`)
            .join(" "),
      };
    },
  },
  trivia: {
    icon: "🧠",
    group: "fun",
    desc: "A random trivia question (with the answer), via Open Trivia DB",
    example: "give me a trivia question",
    args: {},
    async run() {
      const d = await getJSON(
        "https://opentdb.com/api.php?amount=1&type=multiple&encode=url3986",
      );
      const q = d.results[0];
      return {
        summary: `Trivia (${decodeURIComponent(q.category)}): ${decodeURIComponent(q.question)} … Answer: ${decodeURIComponent(q.correct_answer)}.`,
      };
    },
  },
  joke: {
    icon: "😄",
    group: "fun",
    desc: "A random dad joke, via icanhazdadjoke",
    example: "tell me a joke",
    args: {},
    async run() {
      const d = await getJSON("https://icanhazdadjoke.com/", {
        headers: { Accept: "application/json" },
      });
      return { summary: d.joke };
    },
  },
  quote: {
    icon: "💬",
    group: "fun",
    desc: "A random quote",
    example: "inspire me with a quote",
    args: {},
    async run() {
      const d = await getJSON("https://dummyjson.com/quotes/random");
      return { summary: `"${d.quote}" - ${d.author}` };
    },
  },
  cat_fact: {
    icon: "🐈",
    group: "fun",
    desc: "A random cat fact",
    example: "cat fact",
    args: {},
    async run() {
      const d = await getJSON("https://catfact.ninja/fact");
      return { summary: d.fact };
    },
  },
  calculator: {
    icon: "🧮",
    group: "utility",
    desc: "Evaluate math expressions locally (sqrt, sin, log, pi...)",
    example: "calculate sqrt(144) * (3 + 4)",
    args: { expression: "math expression" },
    async run({ expression }) {
      const val = safeCalc(expression);
      return { summary: `${expression} = ${val}` };
    },
  },
  convert_units: {
    icon: "📐",
    group: "utility",
    desc: "Convert length, mass, volume, speed and temperature locally",
    example: "convert 10 km to miles",
    args: { value: "number", from: "unit", to: "unit" },
    async run({ value, from, to }) {
      const v = parseFloat(value);
      const f = (from || "").toLowerCase();
      const t = (to || "").toLowerCase();
      const temps = {
        c: "c",
        celsius: "c",
        f: "f",
        fahrenheit: "f",
        k: "k",
        kelvin: "k",
      };
      if (temps[f] && temps[t]) {
        const toC = {
          c: (x) => x,
          f: (x) => ((x - 32) * 5) / 9,
          k: (x) => x - 273.15,
        };
        const fromC = {
          c: (x) => x,
          f: (x) => (x * 9) / 5 + 32,
          k: (x) => x + 273.15,
        };
        const out = fromC[temps[t]](toC[temps[f]](v));
        return {
          summary: `${v}°${temps[f].toUpperCase()} = ${Math.round(out * 100) / 100}°${temps[t].toUpperCase()}`,
        };
      }
      const A = UNITS[f],
        B = UNITS[t];
      if (!A || !B) throw new Error(`unknown unit "${!A ? from : to}"`);
      if (A[0] !== B[0]) throw new Error(`cannot convert ${A[0]} to ${B[0]}`);
      const out = (v * A[1]) / B[1];
      return { summary: `${v} ${f} = ${Math.round(out * 10000) / 10000} ${t}` };
    },
  },
  random: {
    icon: "🎲",
    group: "utility",
    desc: "Dice rolls, coin flips and random numbers, locally",
    example: "roll 2d6",
    args: { spec: "e.g. 2d6, coin, 1-100" },
    async run({ spec }) {
      const s = (spec || "coin").toLowerCase().trim();
      let m;
      if ((m = s.match(/^(\d*)d(\d+)$/))) {
        const n = Math.min(parseInt(m[1] || "1", 10), 20);
        const sides = parseInt(m[2], 10);
        const rolls = Array.from(
          { length: n },
          () => 1 + Math.floor(Math.random() * sides),
        );
        return {
          summary: `Rolled ${n}d${sides}: [${rolls.join(", ")}] = ${rolls.reduce((a, b) => a + b, 0)}`,
        };
      }
      if (s.includes("coin"))
        return {
          summary: `Coin flip: ${Math.random() < 0.5 ? "heads" : "tails"}`,
        };
      if ((m = s.match(/^(-?\d+)\s*-\s*(-?\d+)$/))) {
        const lo = parseInt(m[1], 10),
          hi = parseInt(m[2], 10);
        return {
          summary: `Random number ${lo}-${hi}: ${lo + Math.floor(Math.random() * (hi - lo + 1))}`,
        };
      }
      throw new Error('try "2d6", "coin" or "1-100"');
    },
  },
  uuid: {
    icon: "🆔",
    group: "utility",
    desc: "Generate a v4 UUID locally",
    example: "generate a uuid",
    args: {},
    async run() {
      return { summary: `UUID: ${crypto.randomUUID()}` };
    },
  },
  sha256: {
    icon: "🔒",
    group: "utility",
    desc: "SHA-256 hash of any text, locally via WebCrypto",
    example: "sha256 of hello world",
    args: { text: "text to hash" },
    async run({ text }) {
      const buf = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(text),
      );
      const hex = [...new Uint8Array(buf)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return { summary: `sha256("${text.slice(0, 40)}") = ${hex}` };
    },
  },
  text_stats: {
    icon: "📊",
    group: "utility",
    desc: "Word count, characters and reading time for any text, locally",
    example: "text stats: the quick brown fox jumps over the lazy dog",
    args: { text: "text to analyze" },
    async run({ text }) {
      const words = (text.match(/\S+/g) || []).length;
      const sentences = (text.match(/[.!?]+/g) || []).length || 1;
      const mins = Math.max(1, Math.round(words / 200));
      return {
        summary: `${words} words, ${text.length} characters, ~${sentences} sentence(s), ~${mins} min read.`,
      };
    },
  },
  tool_search: {
    icon: "🔎",
    group: "orchestration",
    desc: "Search the built-in and connected MCP toolbox by name, group or description",
    example: "tool search weather",
    args: { query: "tool keyword" },
    async run({ query }) {
      const q = (query || "").toLowerCase().trim();
      const hits = allTools()
        .filter((t) =>
          [t.name, t.group, t.desc, t.example]
            .filter(Boolean)
            .some((value) => value.toLowerCase().includes(q)),
        )
        .slice(0, 8);
      if (!hits.length) return { summary: `No tools matched "${query}".` };
      return {
        summary:
          `Tool search for "${query}": ` +
          hits.map((t) => `${t.name} (${t.group}) - ${t.desc}`).join(" · "),
      };
    },
  },
  tool_map: {
    icon: "🗺",
    group: "orchestration",
    desc: "Show the current tool map grouped by capability",
    example: "tool map",
    args: {},
    async run() {
      const groups = new Map();
      for (const tool of allTools()) {
        const list = groups.get(tool.group) || [];
        list.push(tool.name);
        groups.set(tool.group, list);
      }
      return {
        summary:
          "Tool map: " +
          [...groups.entries()]
            .map(([group, names]) => `${group}: ${names.join(", ")}`)
            .join(" · "),
      };
    },
  },
};

export function allTools() {
  return [
    ...Object.entries(TOOLS).map(([name, t]) => ({ name, ...t })),
    ...mcpToolList(),
  ];
}

export async function runTool(name, args) {
  if (name.startsWith("mcp:")) {
    const ok = confirm(
      `Call remote MCP tool "${name}"?\n\nMCP servers can read or change external systems depending on how you configured them. Continue only if this is the tool you intended to use.`,
    );
    if (!ok) throw new Error("remote MCP call cancelled by user");
    return callMcpTool(name, args);
  }
  const tool = TOOLS[name];
  if (!tool) throw new Error(`unknown tool "${name}"`);
  return tool.run(args || {});
}

/* --------------------------- demo planner ----------------------------- */
/* Deterministic intent router: transparent, instant, zero-cost. */
const FIAT_RE = FIAT.join("|");
/* strip filler words that ride along with place names ("delhi right now") */
const cleanPlace = (s) =>
  s
    .trim()
    .replace(/\s+(right now|now|today|tonight|currently|please)\s*$/i, "")
    .trim();
export function planDemo(text) {
  const t = text.toLowerCase();
  const calls = [];
  let m;
  if (
    (m = t.match(/\bweather\b(?:[^]*?\b(?:in|at|for)\s+([a-z .,'-]+?))[?!.]*$/))
  )
    calls.push({ tool: "weather", args: { place: cleanPlace(m[1]) } });
  if (
    (m = t.match(
      /\bair quality\b(?:[^]*?\b(?:in|at|for)\s+([a-z .,'-]+?))[?!.]*$/,
    ))
  )
    calls.push({ tool: "air_quality", args: { place: cleanPlace(m[1]) } });
  if ((m = t.match(/\b(?:what )?time(?: is it)?\s+in\s+([a-z .,'-]+?)[?!.]*$/)))
    calls.push({ tool: "time_in", args: { place: cleanPlace(m[1]) } });
  if ((m = t.match(/\blocate\s+([a-z .,'-]+?)[?!.]*$/)))
    calls.push({ tool: "locate", args: { place: cleanPlace(m[1]) } });
  if ((m = t.match(/\bwiki(?:pedia)?\s+(?:about\s+)?(.+?)[?!.]*$/)))
    calls.push({ tool: "wikipedia", args: { topic: m[1].trim() } });
  if ((m = t.match(/\b(?:define|meaning of)\s+([a-z-]+)[?!.]*$/)))
    calls.push({ tool: "define", args: { word: m[1] } });
  if (
    (m = text.match(
      /translate\s+["']?(.+?)["']?\s+(?:to|into)\s+(\w+)[?!.]*$/i,
    ))
  )
    calls.push({ tool: "translate", args: { text: m[1], to: m[2] } });
  if (
    (m = t.match(
      new RegExp(`([\\d.]+)\\s*(${FIAT_RE})\\s+(?:to|in|into)\\s+(${FIAT_RE})`),
    ))
  )
    calls.push({
      tool: "currency",
      args: { amount: m[1], from: m[2], to: m[3] },
    });
  else if (
    (m = t.match(/\bconvert\s+([\d.]+)\s*([a-z]+)\s+(?:to|into)\s+([a-z]+)/))
  )
    calls.push({
      tool: "convert_units",
      args: { value: m[1], from: m[2], to: m[3] },
    });
  if ((m = t.match(/\b(?:price of|how much is)\s+(\w+)\b/)) && COINS[m[1]])
    calls.push({ tool: "crypto", args: { coin: m[1] } });
  else if (
    (m = t.match(
      /\b(btc|bitcoin|eth|ethereum|sol|solana|doge|dogecoin)\s+price\b/,
    ))
  )
    calls.push({ tool: "crypto", args: { coin: m[1] } });
  if ((m = t.match(/\bcountry\s+(?:info\s+)?([a-z .'-]+?)[?!.]*$/)))
    calls.push({ tool: "country", args: { name: m[1].trim() } });
  else if ((m = t.match(/\bcapital of\s+([a-z .'-]+?)[?!.]*$/)))
    calls.push({ tool: "country", args: { name: m[1].trim() } });
  if ((m = text.match(/github(?:\.com\/|\s+repo\s+)([\w.-]+\/[\w.-]+)/i)))
    calls.push({ tool: "github_repo", args: { repo: m[1] } });
  if (/\bhacker ?news\b|\btop stories\b/.test(t))
    calls.push({ tool: "hackernews", args: {} });
  if (/\btrivia\b|\bquiz me\b/.test(t))
    calls.push({ tool: "trivia", args: {} });
  if (/\bjoke\b/.test(t)) calls.push({ tool: "joke", args: {} });
  if (/\bquote\b|\binspire me\b/.test(t))
    calls.push({ tool: "quote", args: {} });
  if (/\bcat fact\b/.test(t)) calls.push({ tool: "cat_fact", args: {} });
  if ((m = text.match(/\bcalc(?:ulate)?\s+(.+?)[?!.]*$/i)))
    calls.push({ tool: "calculator", args: { expression: m[1].trim() } });
  else if ((m = text.match(/^\s*([\d(][\d\s+\-*/%^().]*[\d)])\s*[?=]*\s*$/)))
    calls.push({ tool: "calculator", args: { expression: m[1].trim() } });
  if ((m = t.match(/\broll\s+(\d*d\d+)\b/)))
    calls.push({ tool: "random", args: { spec: m[1] } });
  else if (/\bflip a coin\b/.test(t))
    calls.push({ tool: "random", args: { spec: "coin" } });
  else if (
    (m = t.match(/\brandom number\b(?:.*?(\d+)\s*(?:and|to|-)\s*(\d+))?/))
  )
    calls.push({
      tool: "random",
      args: { spec: m[1] ? `${m[1]}-${m[2]}` : "1-100" },
    });
  if (/\buuid\b/.test(t)) calls.push({ tool: "uuid", args: {} });
  if ((m = text.match(/sha-?256\s+(?:of\s+)?["']?(.+?)["']?[?!.]*$/i)))
    calls.push({ tool: "sha256", args: { text: m[1] } });
  if ((m = text.match(/text stats:?\s+([^]+)$/i)))
    calls.push({ tool: "text_stats", args: { text: m[1] } });
  if ((m = text.match(/\btool\s+search\s+(.+?)[?!.]*$/i)))
    calls.push({ tool: "tool_search", args: { query: m[1].trim() } });
  if (/\btool\s+map\b|\bwhat tools\b|\bshow tools\b/i.test(text))
    calls.push({ tool: "tool_map", args: {} });
  // explicit invocation: "use <tool> <input>" (works for MCP tools too)
  if ((m = text.match(/^use\s+([\w:-]+)\s*([^]*)$/i))) {
    const name = m[1];
    const known = allTools().find((x) => x.name === name);
    if (known) {
      const argNames = Object.keys(known.args || {});
      calls.push({
        tool: name,
        args: argNames.length ? { [argNames[0]]: m[2].trim() } : {},
      });
    }
  }
  return calls.slice(0, 4); // keep a turn bounded
}

/* --------------------------- live planner ----------------------------- */
export async function planLive(text) {
  const list = allTools()
    .map(
      (t) =>
        `- ${t.name}: ${t.desc}. args: ${JSON.stringify(Object.keys(t.args || {}))}`,
    )
    .join("\n");
  const messages = [
    {
      role: "system",
      content: [
        "You are the tool-routing planner of an agentic system. Decide if the user's message needs any real-world tools.",
        "Only call a tool when the message actually asks for live or computed information. Chit-chat and questions about memories need NO tools.",
        "AVAILABLE TOOLS:",
        list,
        "",
        'Respond with ONLY valid JSON: {"calls":[{"tool":"name","args":{...}}]} - at most 3 calls, or {"calls":[]} if none are needed.',
      ].join("\n"),
    },
    { role: "user", content: text },
  ];
  try {
    const raw = await callLLM(messages, { json: true, maxTokens: 300 });
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const obj = JSON.parse(raw.slice(start, end + 1));
    const valid = (obj.calls || []).filter(
      (c) => c && allTools().some((t) => t.name === c.tool),
    );
    return valid.slice(0, 3);
  } catch (e) {
    return planDemo(text); // planner model failed - fall back to the regex router
  }
}

export async function plan(text) {
  return settings.mode === "live" ? planLive(text) : planDemo(text);
}
