/* Small shared helpers: DOM shorthands, escaping, time and token formatting. */

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => Date.now();
export const uid = (p) =>
  p + "-" + now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const fmtTime = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const fmtFull = (ts) => new Date(ts).toLocaleString();
export const estTokens = (t) => Math.max(1, Math.ceil((t || "").length / 4));
