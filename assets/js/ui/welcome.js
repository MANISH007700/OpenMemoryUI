/* First-visit welcome overlay: the four memory stores as cards (plain-English
   plus an under-the-hood line), the 6-stage pipeline, and when to reach for
   the analytics tools. Shows on every visit until "don't show again" is
   checked; the "how it works" button reopens it any time. */

import { ONBOARDING } from "../config.js";
import { settings, persistSettings } from "../state.js";
import { $, esc } from "../utils.js";

function cardHtml(c) {
  return `
    <div class="w-card" style="--wc: var(--${c.type})">
      <div class="w-card-head">
        <span class="w-swatch"></span>
        <h3>${esc(c.name)}</h3>
        <span class="w-tag">${esc(c.tagline)}</span>
      </div>
      <p class="w-what">${esc(c.what)}</p>
      <p class="w-how"><b>in the app</b> ${esc(c.how)}</p>
      <p class="w-hood">${esc(c.hood)}</p>
    </div>`;
}

function analyticsHtml(a) {
  return `
    <div class="w-tool">
      <div class="w-tool-head">
        <b>${esc(a.name)}</b><span class="w-when">${esc(a.when)}</span>
      </div>
      <p>${esc(a.what)}</p>
    </div>`;
}

function render() {
  $("#welcomePipe").innerHTML = ONBOARDING.pipeline
    .map((s, i) => `<span class="w-stage">${i + 1} · ${esc(s)}</span>`)
    .join(`<span class="w-arrow">→</span>`);
  $("#welcomeCards").innerHTML = ONBOARDING.cards.map(cardHtml).join("");
  $("#welcomeAnalytics").innerHTML =
    `<h4>The receipts - when you want proof</h4>
     <div class="w-tools">${ONBOARDING.analytics.map(analyticsHtml).join("")}</div>`;
}

export function showWelcome() {
  if (!$("#welcomeCards").innerHTML) render();
  $("#welcomeDontShow").checked = !!settings.hideWelcome;
  $("#welcome").hidden = false;
}

function close() {
  settings.hideWelcome = $("#welcomeDontShow").checked;
  persistSettings();
  $("#welcome").hidden = true;
}

export function initWelcome() {
  $("#welcomeClose").addEventListener("click", close);
  $("#welcomeStart").addEventListener("click", () => {
    close();
    $("#input").focus();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#welcome").hidden) close();
  });
  if (!settings.hideWelcome) showWelcome();
}
