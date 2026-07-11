/* Synthesized audio: tiny WebAudio SFX for pipeline events plus a very
   quiet generative ambient pad. No audio files - everything is oscillators.
   Off by default; the topbar toggle is the user gesture that unlocks audio. */

import { settings, persistSettings } from "../state.js";
import { $ } from "../utils.js";
import { showToast } from "./toast.js";

let ctx = null;
let ambient = null; // {oscs, gain, timer}

async function ensureCtx() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) throw new Error("WebAudio is not available in this browser");
  if (!ctx) ctx = new AudioCtor();
  if (ctx.state === "suspended") await ctx.resume();
  return ctx;
}

function blip(freq, dur = 0.08, type = "sine", vol = 0.06, delay = 0) {
  if (!settings.soundOn || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sfx = {
  send: () => blip(523, 0.09, "sine", 0.05),
  stage: () => blip(660, 0.045, "triangle", 0.025),
  retrieve: () => {
    blip(880, 0.07, "sine", 0.04);
    blip(1174, 0.09, "sine", 0.03, 0.07);
  },
  write: () => {
    blip(392, 0.12, "sine", 0.05);
    blip(587, 0.16, "sine", 0.04, 0.09);
  },
  tool: () => blip(311, 0.1, "square", 0.025),
  error: () => blip(130, 0.25, "sawtooth", 0.04),
  preview: () => {
    blip(440, 0.12, "sine", 0.09);
    blip(660, 0.14, "triangle", 0.07, 0.09);
    blip(880, 0.16, "sine", 0.06, 0.2);
  },
  clap: () => {
    blip(740, 0.06, "triangle", 0.05);
    blip(988, 0.08, "triangle", 0.04, 0.05);
  },
};

/* A slow two-voice pad cycling through a gentle chord progression. */
const CHORDS = [220, 174.61, 130.81, 196]; // A3 F3 C3 G3 roots
function startAmbient() {
  if (ambient || !ctx) return;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.gain.linearRampToValueAtTime(0.024, ctx.currentTime + 2.4);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 520;
  const oscs = [ctx.createOscillator(), ctx.createOscillator()];
  oscs[0].type = "sine";
  oscs[1].type = "triangle";
  oscs.forEach((o) => o.connect(filter));
  filter.connect(gain).connect(ctx.destination);
  let step = 0;
  const tune = () => {
    const root = CHORDS[step % CHORDS.length];
    const t = ctx.currentTime;
    oscs[0].frequency.linearRampToValueAtTime(root, t + 2);
    oscs[1].frequency.linearRampToValueAtTime(root * 1.5, t + 2); // a fifth up
    step++;
  };
  tune();
  oscs.forEach((o) => o.start());
  ambient = { oscs, gain, timer: setInterval(tune, 11000) };
}

function stopAmbient() {
  if (!ambient) return;
  clearInterval(ambient.timer);
  const { oscs, gain } = ambient;
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
  setTimeout(() => oscs.forEach((o) => o.stop()), 1000);
  ambient = null;
}

function renderBtn() {
  const btn = $("#soundBtn");
  btn.textContent = settings.soundOn ? "music on" : "music off";
  btn.classList.toggle("on", settings.soundOn);
  btn.setAttribute("aria-pressed", settings.soundOn ? "true" : "false");
}

export async function toggleSound() {
  const next = !settings.soundOn;
  if (next) {
    try {
      await ensureCtx();
    } catch (e) {
      settings.soundOn = false;
      persistSettings();
      renderBtn();
      showToast("Music could not start", e.message, "error");
      return;
    }
    settings.soundOn = true;
    persistSettings();
    startAmbient();
    sfx.preview(); // audible confirmation
    showToast(
      "Music on",
      "Ambient pad and memory/tool event sounds are active.",
      "success",
    );
  } else {
    settings.soundOn = false;
    persistSettings();
    stopAmbient();
    showToast("Music off", "Ambient pad and event sounds are paused.", "info");
  }
  renderBtn();
}

export function initSound() {
  renderBtn();
  // a saved "on" preference still needs a user gesture to unlock audio
  if (settings.soundOn) {
    const unlock = async () => {
      await ensureCtx();
      startAmbient();
      document.removeEventListener("pointerdown", unlock);
    };
    document.addEventListener("pointerdown", unlock, { once: true });
  }
}
