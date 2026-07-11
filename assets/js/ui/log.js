/* The memory-bus log at the bottom: every read and write, as it happens. */

import { $, fmtTime, now } from "../utils.js";

export function logEvent(op, html) {
  const line = document.createElement("div");
  line.className = `log-line op-${op}`;
  line.innerHTML = `<span class="t">${fmtTime(now())}</span> <b>${op.toUpperCase().padEnd(6, " ")}</b> ${html}`;
  const scroll = $("#logScroll");
  scroll.appendChild(line);
  scroll.scrollTop = scroll.scrollHeight;
}
