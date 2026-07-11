/* Synthesized audio: an uplifting techno loop plus event tones for response,
   retrieval, tool calls and writes. No audio files are used. */

import { settings, persistSettings } from "../state.js";
import { $ } from "../utils.js";
import { showToast } from "./toast.js";

let ctx = null;
let output = null;
let ambient = null; // {master, oscs, timers}

const BPM = 118;
const BEAT = 60 / BPM;
const STEP = BEAT / 2;
const ROOTS = [220, 246.94, 196, 293.66]; // A, B, G, D - bright but calm

async function ensureCtx() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) throw new Error("WebAudio is not available in this browser");
  if (!ctx) ctx = new AudioCtor();
  if (ctx.state === "suspended") await ctx.resume();
  return ctx;
}

function out() {
  if (!output) {
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 20;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.16;
    compressor.connect(ctx.destination);
    output = compressor;
  }
  return output;
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
    destination.connect(f).connect(out());
  } else {
    destination.connect(out());
  }

  osc.connect(gain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function blip(freq, dur = 0.08, type = "sine", vol = 0.04, delay = 0) {
  note({ freq, dur, type, vol, delay });
}

function chord(freqs, delay = 0, vol = 0.04, dur = 0.28) {
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
    dur: 0.19,
    type: "sine",
    vol,
    delay,
    filter: { type: "lowpass", freq: 180, q: 0.8 },
  });
}

function bass(freq, delay = 0, vol = 0.045) {
  note({
    freq,
    dur: 0.22,
    type: "sawtooth",
    vol,
    delay,
    filter: { type: "lowpass", freq: 420, q: 2.2 },
  });
}

function noiseHit({
  delay = 0,
  vol = 0.03,
  dur = 0.04,
  filterType = "highpass",
  freq = 5200,
  q = 0.7,
}) {
  if (!settings.soundOn || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = freq;
  filter.Q.value = q;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.buffer = buffer;
  src.connect(filter).connect(gain).connect(out());
  src.start(t0);
  src.stop(t0 + dur + 0.01);
}

function tick(delay = 0, vol = 0.028) {
  noiseHit({ delay, vol, dur: 0.032, filterType: "highpass", freq: 6200 });
}

function openHat(delay = 0, vol = 0.03) {
  noiseHit({ delay, vol, dur: 0.12, filterType: "highpass", freq: 4600 });
}

function snare(delay = 0, vol = 0.07) {
  noiseHit({
    delay,
    vol,
    dur: 0.095,
    filterType: "bandpass",
    freq: 1450,
    q: 1.1,
  });
  blip(190, 0.055, "triangle", vol * 0.32, delay);
}

function lead(freq, delay = 0, vol = 0.042) {
  note({
    freq,
    dur: 0.13,
    type: "square",
    vol,
    delay,
    filter: { type: "lowpass", freq: 2600, q: 1.8 },
  });
}

export const sfx = {
  send: () => {
    kick(0, 0.08);
    blip(587, 0.08, "triangle", 0.045, 0.07);
  },
  stage: () => tick(0, 0.018),
  retrieve: () => {
    blip(880, 0.07, "sine", 0.052);
    blip(1174, 0.09, "triangle", 0.04, 0.07);
    tick(0.02, 0.026);
  },
  respondStart: () => {
    blip(392, 0.08, "triangle", 0.045);
    blip(523, 0.08, "triangle", 0.04, 0.08);
    tick(0.16, 0.022);
  },
  response: () => chord([523.25, 659.25, 783.99], 0, 0.05, 0.34),
  extract: () => {
    blip(698.46, 0.07, "sine", 0.034);
    blip(1046.5, 0.08, "sine", 0.03, 0.06);
  },
  write: () => {
    blip(392, 0.12, "sine", 0.058);
    blip(587, 0.16, "triangle", 0.052, 0.09);
  },
  tool: () => {
    blip(311, 0.08, "square", 0.038);
    blip(622, 0.06, "triangle", 0.032, 0.08);
  },
  complete: () => chord([587.33, 739.99, 987.77], 0, 0.045, 0.26),
  error: () => blip(130, 0.25, "sawtooth", 0.06),
  preview: () => {
    kick(0, 0.11);
    snare(0.12, 0.07);
    bass(110, 0.06, 0.065);
    tick(0.18, 0.034);
    openHat(0.3, 0.034);
    chord([440, 554.37, 659.25, 880], 0.18, 0.052, 0.34);
  },
  clap: () => {
    blip(740, 0.06, "triangle", 0.062);
    blip(988, 0.08, "triangle", 0.054, 0.05);
  },
};

function startAmbient() {
  if (ambient || !ctx) return;

  const master = ctx.createGain();
  master.gain.value = 0.0001;
  master.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 1.2);

  const padGain = ctx.createGain();
  padGain.gain.value = 0.075;
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = 1050;
  padFilter.Q.value = 0.6;

  const oscs = [ctx.createOscillator(), ctx.createOscillator()];
  oscs[0].type = "sawtooth";
  oscs[0].detune.value = -7;
  oscs[1].type = "triangle";
  oscs[1].detune.value = 5;
  oscs.forEach((osc) => osc.connect(padFilter));
  padFilter.connect(padGain).connect(master).connect(out());

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
    const root = ROOTS[Math.floor(beatStep / 16) % ROOTS.length] / 2;
    const step = beatStep % 16;
    const bassPattern = [
      1, 0, 1.5, 0, 1, 0.75, 1.5, 0, 1, 0, 1.25, 0, 1.5, 0.75, 1.25, 0,
    ];
    const leadPattern = [4, 5, 6, 5, 8, 6, 5, 4, 5, 6, 8, 6, 10, 8, 6, 5];

    if (step % 2 === 0) kick(0, 0.095);
    if (step % 8 === 2 || step % 8 === 6) snare(0, 0.058);
    if (step % 2 === 1) tick(0, 0.027);
    if (step % 4 === 3) openHat(0, 0.032);

    const bassStep = bassPattern[step];
    if (bassStep) bass(root * bassStep, 0, 0.052);

    if (step % 4 === 0 || step % 4 === 3) {
      lead(root * leadPattern[step], 0.02, 0.035);
    }

    if (step === 14) {
      const top = root * 4;
      chord([top, top * 1.25, top * 1.5], 0, 0.034, 0.18);
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
      setInterval(tunePad, STEP * 16 * 1000),
      setInterval(pulse, STEP * 1000),
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
      "Techno music, response tones and tool cues are active.",
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
