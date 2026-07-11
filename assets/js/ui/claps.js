/* The clap button in the footer: a global applause counter backed by the
   free Abacus counter API (no backend, no key). Falls back to a local-only
   count if the API is unreachable; your own claps also persist locally. */

import { $ } from "../utils.js";
import { logEvent } from "./log.js";
import { sfx } from "./sound.js";

const COUNTER_URL = "https://abacus.jasoncameron.dev";
const COUNTER_PATH = "openmemoryui/claps";
const LOCAL_KEY = "glassbox.claps.v1";

let globalCount = null; // null until the API answers
let myClaps = Number(localStorage.getItem(LOCAL_KEY) || 0);

function renderCount() {
  $("#clapCount").textContent =
    globalCount !== null
      ? globalCount.toLocaleString()
      : myClaps
        ? myClaps.toLocaleString()
        : "";
}

function floatEmoji() {
  const btn = $("#clapBtn");
  btn.classList.remove("pop");
  void btn.offsetWidth; // restart the pop animation
  btn.classList.add("pop");
  const r = btn.getBoundingClientRect();
  const f = document.createElement("div");
  f.className = "clap-float";
  f.textContent = ["👏", "💜", "✨"][Math.floor(Math.random() * 3)];
  f.style.left = r.left + r.width / 2 - 8 + "px";
  f.style.top = r.top - 6 + "px";
  document.body.appendChild(f);
  f.animate(
    [
      { transform: "translateY(0) scale(0.8)", opacity: 1 },
      {
        transform: `translate(${Math.random() * 40 - 20}px, -60px) scale(1.3)`,
        opacity: 0,
      },
    ],
    { duration: 900, easing: "cubic-bezier(.2,.6,.3,1)" },
  ).onfinish = () => f.remove();
}

export async function initClaps() {
  renderCount();
  try {
    const res = await fetch(`${COUNTER_URL}/get/${COUNTER_PATH}`);
    if (res.ok) {
      globalCount = (await res.json()).value;
    } else if (res.status === 404) {
      globalCount = 0; // counter not created yet - first clap will create it
    }
    renderCount();
  } catch (e) {}
}

export async function clap() {
  myClaps++;
  localStorage.setItem(LOCAL_KEY, String(myClaps));
  if (globalCount !== null) globalCount++; // optimistic bump
  renderCount();
  floatEmoji();
  sfx.clap();
  if (myClaps === 1)
    logEvent(
      "info",
      "clap received - thanks for the love 💜 (clap as many times as you like)",
    );
  try {
    const res = await fetch(`${COUNTER_URL}/hit/${COUNTER_PATH}`);
    if (res.ok) {
      globalCount = (await res.json()).value; // sync to the true global count
      renderCount();
    }
  } catch (e) {}
}
