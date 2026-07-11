/* Demo-mode brain: rule-based extraction and a canned conversationalist,
   so the whole pipeline works with zero setup. Live mode replaces
   generation + extraction with real LLM calls; storage, retrieval and
   provenance are identical in both modes. */

import { memory } from "./state.js";
import { tokenize, isRecallQuery } from "./retrieval.js";
import { fmtTime } from "./utils.js";

export function demoExtract(userMsg) {
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
    return !memory.semantic.some((ex) => {
      const et = tokenize(ex.content);
      const overlap = et.filter((t) => ct.has(t)).length;
      return overlap >= Math.min(ct.size, et.length) * 0.8;
    });
  });
  return { items: kept, dupesRejected: out.length - kept.length };
}

export function demoReply(userMsg, retrieved, toolResults = []) {
  const sem = retrieved.filter((r) => r.item.type === "semantic");
  if (toolResults.length && !isRecallQuery(userMsg)) {
    const ok = toolResults.filter((r) => r.ok);
    const bad = toolResults.filter((r) => !r.ok);
    let reply = ok.map((r) => r.summary).join("\n\n");
    if (bad.length)
      reply +=
        (reply ? "\n\n" : "") +
        bad.map((r) => `(${r.tool} failed: ${r.error})`).join("\n");
    reply +=
      "\n\nThat answer came from the Act stage: real tool calls made straight from your browser seconds ago. The orchestrator card above shows each agent's work, and it is all recorded in this turn's trace.";
    return reply.trim();
  }
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
