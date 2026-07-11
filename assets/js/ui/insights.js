/* Analytics views: the insights drawer (funnels, growth chart, keyword map)
   and the per-turn trace drawer. Every number is recomputed live from the
   raw records in localStorage - nothing is estimated. */

import { STORE_COLORS, KIND_COLORS, TRACE_CAP } from "../config.js";
import { memory } from "../state.js";
import { tokenize } from "../retrieval.js";
import { esc, fmtTime } from "../utils.js";
import { openDrawer } from "./drawer.js";
import { kindClass } from "./render.js";

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

function insightCards(cards) {
  return `
    <div class="insight-summary">
      ${cards
        .map(
          (c) => `
        <div class="insight-card">
          <b>${c.n}</b>
          <span>${esc(c.label)}</span>
        </div>`,
        )
        .join("")}
    </div>`;
}

function growthChartSVG() {
  const pts = [
    ...memory.semantic.map((i) => ({ at: i.createdAt, t: "s" })),
    ...memory.episodic.map((i) => ({ at: i.createdAt, t: "e" })),
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
  for (const it of memory.semantic)
    for (const t of new Set(tokenize(it.content))) bump(t, "semantic");
  for (const it of memory.episodic)
    for (const t of new Set(tokenize(it.content))) bump(t, "episodic");
  for (const it of [...memory.semantic, ...memory.episodic])
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

export function openInsights() {
  const t = memory.traces[memory.traces.length - 1];
  const semWrites = t
    ? t.write.written.filter((w) => w.type === "semantic").length
    : 0;
  const epiWrites = t
    ? t.write.written.filter((w) => w.type === "episodic").length
    : 0;
  const rejected = t ? t.extract.dupesRejected + t.write.invalidRejected : 0;
  const toolCalls = t?.act?.calls || [];
  const toolSuccesses = toolCalls.filter((c) => c.ok).length;
  const toolFailures = toolCalls.length - toolSuccesses;
  const actFunnelHtml =
    t && t.act
      ? `
    <div class="funnel-block"><h5>Act funnel</h5>
    <p class="dim">What the orchestrator did before answering.</p>
    ${funnelRows([
      {
        label: "planned tool calls",
        n: toolCalls.length,
        color: "#ffd166",
        title: "Calls selected by the demo regex router or live LLM planner",
      },
      {
        label: "succeeded",
        n: toolSuccesses,
        color: STORE_COLORS.contextual,
        title: "Tool calls that returned usable results",
      },
      {
        label: "failed",
        n: toolFailures,
        color: "#f87693",
        title: "Tool calls that failed or were blocked by the remote service",
      },
    ])}</div>`
      : "";

  const lastTurnHtml = !t
    ? `<div class="empty-state"><b>No turn trace yet.</b><span>Send a message and this drawer will show exactly what was retrieved, which tools ran, and what was written.</span></div>`
    : `
    <p class="dim" style="margin-bottom:2px">Your last message: <i>"${esc(t.text.slice(0, 90))}${t.text.length > 90 ? "…" : ""}"</i></p>
    ${insightCards([
      { n: t.retrieve.picked, label: "memories injected into prompt" },
      { n: toolCalls.length, label: "tool calls planned" },
      { n: t.write.written.length, label: "memory writes committed" },
      { n: rejected, label: "candidates rejected" },
    ])}
    <div class="funnel-block"><h5>Retrieval funnel</h5>
    <p class="dim">Of everything in long-term memory, what made it into the prompt.</p>
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
    ])}</div>
    ${actFunnelHtml}
    <div class="funnel-block"><h5>Write funnel</h5>
    <p class="dim">Of what the extractor proposed, what got stored and what was rejected.</p>
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
    ])}</div>
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
  memory.semantic.forEach((i) => {
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
      n: memory.episodic.length,
      color: KIND_COLORS.episode,
      title: "Journaled events",
    },
  ]);

  const recalled = [...memory.semantic, ...memory.episodic]
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
    <div class="d-section"><h4>Latest turn - where things went</h4>${lastTurnHtml}</div>
    <div class="d-section"><h4>Memory growth over time (cumulative)</h4>${growthHtml}</div>
    <div class="d-section"><h4>What is stored, by kind</h4>${kindHtml}</div>
    <div class="d-section"><h4>Most recalled memories</h4>${recalledHtml}</div>
    <div class="d-section"><h4>Keywords → where they went</h4>${kwHtml}</div>
    <div class="d-section"><p class="dim">Every number here is recomputed live from the raw records in localStorage - nothing is estimated. Click any memory card in the main panels for its full provenance.</p></div>`,
    true,
  );
}

export function openTrace(id) {
  const t = memory.traces.find((x) => x.id === id);
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
  // older traces predate the Act stage - number the sections dynamically
  const hasAct = !!t.act;
  const n = hasAct
    ? { act: 3, gen: 4, ext: 5, wr: 6 }
    : { gen: 3, ext: 4, wr: 5 };
  const actHtml = hasAct
    ? `
    <div class="trace-stage"><h5>${n.act} · Act - tools</h5>
      <p class="dim">Planner: ${esc(t.act.engine)}. ${t.act.calls.length ? `${t.act.calls.length} tool call(s):` : "No tools were needed for this message."}</p>
      ${t.act.calls
        .map(
          (c) => `
      <div class="d-history-item">
        <b>${esc(c.tool)}</b>(${esc(JSON.stringify(c.args))}) · ${c.ms} ms · ${c.ok ? "✓" : "✗ failed"}
        <div class="dim">${esc(c.ok ? c.summary : c.error)}</div>
      </div>`,
        )
        .join("")}</div>`
    : "";
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
    ${actHtml}
    <div class="trace-stage"><h5>${n.gen} · Generate</h5>
      <div class="d-kv">
        <span class="k">engine</span><span class="v">${esc(t.generate.provider)} / ${esc(t.generate.model)}</span>
        <span class="k">latency</span><span class="v">${t.generate.ms} ms</span>
        <span class="k">prompt</span><span class="v">${t.generate.promptMessages} messages · ~${t.generate.promptTokens} tokens</span>
        <span class="k">reply</span><span class="v">~${t.generate.replyTokens} tokens</span>
      </div>
      <p class="dim" style="margin-top:6px">The exact prompt (retrieved memories are inside the system message):</p>
      <pre class="promptdump">${esc(t.promptDump)}</pre></div>

    <div class="trace-stage"><h5>${n.ext} · Extract</h5>
      <p class="dim">Engine: ${esc(t.extract.engine)}. ${t.extract.candidates} candidate(s)${t.extract.dupesRejected ? `, ${t.extract.dupesRejected} rejected as duplicates` : ""}.</p>
      ${extractItems}
      <p class="dim" style="margin-top:6px">Episode: ${esc(t.extract.episodeSummary)}</p>
      ${t.extract.raw ? `<p class="dim" style="margin-top:6px">Raw model output:</p><pre class="promptdump">${esc(t.extract.raw)}</pre>` : ""}</div>

    <div class="trace-stage"><h5>${n.wr} · Write</h5>
      ${writeItems || `<p class="dim">Nothing written.</p>`}
      ${t.write.invalidRejected ? `<p class="dim">${t.write.invalidRejected} item(s) dropped as malformed extractor output.</p>` : ""}</div>`,
    true,
  );
}
