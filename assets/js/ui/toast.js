/* Small visible status messages for actions that otherwise only update
   localStorage or audio state. */

import { $, esc } from "../utils.js";

let timer = null;

export function showToast(title, detail = "", tone = "info") {
  const stack = $("#toastStack");
  if (!stack) return;
  window.clearTimeout(timer);
  stack.innerHTML = `
    <div class="toast ${tone}" role="status">
      <b>${esc(title)}</b>
      ${detail ? `<span>${esc(detail)}</span>` : ""}
    </div>`;
  stack.classList.add("show");
  timer = window.setTimeout(() => {
    stack.classList.remove("show");
  }, 4600);
}
