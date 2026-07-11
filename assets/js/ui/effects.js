/* Visual feedback: the 5-stage pipeline strip, flying packets on the
   memory bus, and panel / card flash animations. */

import { $, $$ } from "../utils.js";

export function setStage(name, note) {
  $$("#pipeline .stage").forEach((s) => {
    if (s.dataset.stage === name) {
      s.classList.add("active");
      s.classList.remove("done");
      if (note !== undefined) $(".s-note", s).textContent = note;
    } else if (s.classList.contains("active")) {
      s.classList.remove("active");
      s.classList.add("done");
    }
  });
}

export function stageNote(name, note) {
  const s = $(`#pipeline .stage[data-stage="${name}"]`);
  if (s) $(".s-note", s).textContent = note;
}

export function resetStages() {
  $$("#pipeline .stage").forEach((s) => {
    s.classList.remove("active", "done");
    $(".s-note", s).textContent = "";
  });
}

export function finishStages() {
  $$("#pipeline .stage").forEach((s) => {
    s.classList.remove("active");
    s.classList.add("done");
  });
}

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function firePackets(fromEl, toEl, color, count = 3) {
  if (REDUCED || !fromEl || !toEl) return;
  const f = fromEl.getBoundingClientRect();
  const t = toEl.getBoundingClientRect();
  const x1 = f.left + f.width / 2,
    y1 = f.top + f.height / 2;
  const x2 = t.left + t.width / 2,
    y2 = t.top + Math.min(30, t.height / 2);
  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    p.className = "packet";
    p.style.background = color;
    p.style.boxShadow = `0 0 12px ${color}`;
    p.style.left = x1 + "px";
    p.style.top = y1 + "px";
    document.body.appendChild(p);
    const midX = (x1 + x2) / 2 + (Math.random() * 80 - 40);
    const midY = Math.min(y1, y2) - 40 - Math.random() * 50;
    p.animate(
      [
        { transform: "translate(0,0) scale(0.7)", opacity: 0.2 },
        {
          transform: `translate(${midX - x1}px, ${midY - y1}px) scale(1.15)`,
          opacity: 1,
          offset: 0.5,
        },
        {
          transform: `translate(${x2 - x1}px, ${y2 - y1}px) scale(0.6)`,
          opacity: 0.1,
        },
      ],
      {
        duration: 700 + i * 130,
        delay: i * 90,
        easing: "cubic-bezier(.3,.1,.3,1)",
      },
    ).onfinish = () => p.remove();
  }
}

export function flashPanel(type) {
  const panel = $(`.mem-panel[data-type="${type}"]`);
  if (!panel) return;
  panel.classList.add(`flash-${type}`);
  setTimeout(() => panel.classList.remove(`flash-${type}`), 1400);
}

export function flashCard(id, cls) {
  const el = $(`#card-${id}`) || $(`[data-open="item:${id}"]`);
  if (el) {
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 1700);
  }
}
