/* Transparent lexical retrieval over the long-term stores:
   word overlap normalized by memory length, plus recency, reinforcement
   and importance boosts. Returns full scoring diagnostics for the trace. */

import { RETRIEVE_TOP_K } from "./config.js";
import { memory } from "./state.js";
import { now } from "./utils.js";

const STOP = new Set(
  "a an and are as at be but by for from has have i im i'm in is it its me my of on or so that the this to was we what when where which who why will with you your yours do does did dont don't can could would should about tell me please hey hi hello".split(
    " ",
  ),
);

export function tokenize(text) {
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

export function isRecallQuery(text) {
  const normalized = text.toLowerCase();
  return [
    /\bwhat\b[^?!.]{0,60}\b(remember|recall|know)\b[^?!.]{0,60}\b(about me|me)\b/,
    /\b(do you|can you)\b[^?!.]{0,40}\b(remember|recall)\b[^?!.]{0,40}\b(about me|me|my)\b/,
    /\b(remember|recall)\b[^?!.]{0,40}\b(about me|me|my)\b/,
    /\b(my|your)\s+(memory|memories)\b/,
    /\b(forgot|forget)\b[^?!.]{0,40}\b(about me|me|my)\b/,
  ].some((pattern) => pattern.test(normalized));
}

/* Returns {picked, diag}: the injected winners plus the full scoring
   diagnostics that feed the per-turn trace and the insights funnels. */
export function retrieve(query) {
  const qt = tokenize(query);
  const pool = [...memory.semantic, ...memory.episodic];
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
  const diag = {
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
  return { picked, diag };
}
