/* Synthesized audio: a dim uplifting techno bed plus tiny event tones for
   response, retrieval, tool calls and writes. No audio files are used. */

import { settings, persistSettings } from "../state.js";
import { $ } from "../utils.js";
import { showToast } from "./toast.js";

let ctx = null;
let ambient = null; // {master, oscs, timers}

const BPM = 118;
const BEAT = 60 / BPM;
const ROOTS = [220, 246.94, 196, 293.66]; // A, B, G, D - bright but calm

async function ensureCtx() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) throw new Error("WebAudio is not available in this browser");
  if (!ctx) ctx = new AudioCtor();
  if (ctx.state === "suspended") await ctx.resume();
  return ctx;
}

function note({
  freq,
  dur = 0.08,
  type = "sine",
  vol = 0.04,
  delay = 0,
  slideTo = null,
  filter = null,
}) {
  if (!settings.soundOn || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  let destination = gain;

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);

  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = filter.type;
    f.frequency.setValueAtTime(filter.freq, t0);
    if (filter.q) f.Q.value = filter.q;
    destination.connect(f).connect(ctx.destination);
  } else {
    destination.connect(ctx.destination);
  }

  osc.connect(gain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function blip(freq, dur = 0.08, type = "sine", vol = 0.04, delay = 0) {
  note({ freq, dur, type, vol, delay });
}

function chord(freqs, delay = 0, vol = 0.025, dur = 0.28) {
  freqs.forEach((freq, i) =>
    note({
      freq,
      dur: dur + i * 0.02,
      type: i % 2 ? "triangle" : "sine",
      vol,
      delay: delay + i * 0.045,
      filter: { type: "lowpass", freq: 1800, q: 0.6 },
    }),
  );
}

function kick(delay = 0, vol = 0.032) {
  note({
    freq: 92,
    slideTo: 48,
    dur: 0.16,
    type: "sine",
    vol,
    delay,
    filter: { type: "lowpass", freq: 180, q: 0.8 },
  });
}

function bass(freq, delay = 0) {
  note({
    freq,
    dur: 0.18,
    type: "sawtooth",
    vol: 0.014,
    delay,
    filter: { type: "lowpass", freq: 260, q: 2.2 },
  });
}

function tick(delay = 0, vol = 0.009) {
  if (!settings.soundOn || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * 0.026);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.4;

  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 5200;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.025);
  src.buffer = buffer;
  src.connect(hp).connect(gain).connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + 0.03);
}

export const sfx = {
  send: () => {
    kick(0, 0.036);
    blip(587, 0.08, "triangle", 0.028, 0.07);
  },
  stage: () => tick(0, 0.007),
  retrieve: () => {
    blip(880, 0.07, "sine", 0.035);
    blip(1174, 0.09, "triangle", 0.026, 0.07);
    tick(0.02, 0.008);
  },
  respondStart: () => {
    blip(392, 0.08, "triangle", 0.025);
    blip(523, 0.08, "triangle", 0.022, 0.08);
    tick(0.16, 0.007);
  },
  response: () => chord([523.25, 659.25, 783.99], 0, 0.026, 0.32),
  extract: () => {
    blip(698.46, 0.07, "sine", 0.018);
    blip(1046.5, 0.08, "sine", 0.016, 0.06);
  },
  write: () => {
    blip(392, 0.12, "sine", 0.04);
    blip(587, 0.16, "triangle", 0.034, 0.09);
  },
  tool: () => {
    blip(311, 0.08, "square", 0.02);
    blip(622, 0.06, "triangle", 0.016, 0.08);
  },
  complete: () => chord([587.33, 739.99, 987.77], 0, 0.022, 0.24),
  error: () => blip(130, 0.25, "sawtooth", 0.035),
  preview: () => {
    kick(0, 0.038);
    bass(110, 0.08);
    tick(0.18, 0.011);
    chord([440, 554.37, 659.25, 880], 0.18, 0.024, 0.3);
  },
  clap: () => {
    blip(740, 0.06, "triangle", 0.045);
    blip(988, 0.08, "triangle", 0.038, 0.05);
  },
};

function startAmbient() {
  if (ambient || !ctx) return;

  const master = ctx.createGain();
  master.gain.value = 0.0001;
  master.gain.exponentialRampToValueAtTime(0.052, ctx.currentTime + 2.2);

  const padGain = ctx.createGain();
  padGain.gain.value = 0.018;
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = 720;
  padFilter.Q.value = 0.6;

  const oscs = [ctx.createOscillator(), ctx.createOscillator()];
  oscs[0].type = "sawtooth";
  oscs[0].detune.value = -7;
  oscs[1].type = "triangle";
  oscs[1].detune.value = 5;
  oscs.forEach((osc) => osc.connect(padFilter));
  padFilter.connect(padGain).connect(master).connect(ctx.destination);

  let chordStep = 0;
  let beatStep = 0;

  const tunePad = () => {
    const root = ROOTS[chordStep % ROOTS.length];
    const t = ctx.currentTime;
    oscs[0].frequency.linearRampToValueAtTime(root, t + 1.1);
    oscs[1].frequency.linearRampToValueAtTime(root * 1.5, t + 1.1);
    chordStep++;
  };

  const pulse = () => {
    const root = ROOTS[Math.floor(beatStep / 8) % ROOTS.length] / 2;
    if (beatStep % 2 === 0) kick(0, 0.018);
    bass(beatStep % 4 === 2 ? root * 1.5 : root);
    if (beatStep % 2 === 1) tick(0, 0.0065);
    if (beatStep % 8 === 6) {
      const top = root * 4;
      chord([top, top * 1.25, top * 1.5], 0, 0.008, 0.14);
    }
    beatStep++;
  };

  tunePad();
  pulse();
  oscs.forEach((osc) => osc.start());

  ambient = {
    master,
    oscs,
    timers: [
      setInterval(tunePad, BEAT * 8 * 1000),
      setInterval(pulse, BEAT * 1000),
    ],
  };
}

function stopAmbient() {
  if (!ambient) return;
  const { master, oscs, timers } = ambient;
  timers.forEach((timer) => clearInterval(timer));
  master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
  setTimeout(() => oscs.forEach((osc) => osc.stop()), 1000);
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
    sfx.preview();
    showToast(
      "Music on",
      "Dim techno pulse, response tones and tool cues are active.",
      "success",
    );
  } else {
    settings.soundOn = false;
    persistSettings();
    stopAmbient();
    showToast("Music off", "Techno pulse and event tones are paused.", "info");
  }
  renderBtn();
}

export function initSound() {
  renderBtn();
  // A saved "on" preference still needs a user gesture to unlock audio.
  if (settings.soundOn) {
    const unlock = async () => {
      try {
        await ensureCtx();
        startAmbient();
      } catch (e) {
        settings.soundOn = false;
        persistSettings();
        renderBtn();
      }
      document.removeEventListener("pointerdown", unlock);
    };
    document.addEventListener("pointerdown", unlock, { once: true });
  }
}
