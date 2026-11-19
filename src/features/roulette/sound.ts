import samples from "./audio/roulette-samples.json";
import type { DrawImpact, DrawSound } from "../../lib/draw";

const recordingUrl = new URL("./audio/roulette-samples.wav", import.meta.url);
const volume = 0.9;
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

interface Clip {
  start: number;
  duration: number;
}

function approach(param: AudioParam, value: number, time: number, speed: number) {
  param.cancelScheduledValues(time);
  param.setTargetAtTime(value, time, speed);
}

function createMixer(context: AudioContext, recording: AudioBuffer) {
  const master = context.createGain();
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -13;
  compressor.knee.value = 14;
  compressor.ratio.value = 2.5;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.055;
  master.gain.value = volume;
  master.connect(compressor).connect(context.destination);

  function voice(clip: Clip, gain: number, pan: number, pitch: number, loop = false) {
    const source = context.createBufferSource();
    const level = context.createGain();
    const position = context.createStereoPanner();
    source.buffer = recording;
    source.loop = loop;
    source.playbackRate.value = pitch;
    level.gain.value = gain;
    position.pan.value = pan;
    source.connect(level).connect(position).connect(master);
    if (loop) {
      source.loopStart = clip.start;
      source.loopEnd = clip.start + clip.duration;
      source.start(context.currentTime, clip.start);
    } else {
      source.start(context.currentTime + 0.008, clip.start, clip.duration);
    }
    return { source, level, position };
  }

  const rail = voice(samples.rail, 0, 0, 1, true);
  const pockets = voice(samples.pockets, 0, 0, 1, true);
  const hits = new Set<ReturnType<typeof voice>>();

  function play(clip: Clip, gain: number, pan: number, pitch: number) {
    const hit = voice(clip, gain, clamp(pan, -0.68, 0.68), pitch);
    hits.add(hit);
    hit.source.onended = () => {
      hits.delete(hit);
      hit.source.disconnect();
      hit.level.disconnect();
      hit.position.disconnect();
    };
  }

  function quietRoll() {
    approach(rail.level.gain, 0, context.currentTime, 0.023);
    approach(pockets.level.gain, 0, context.currentTime, 0.023);
  }

  return {
    context,
    master,
    play,
    quietRoll,
    roll(speed: number, pan: number, onRail: boolean) {
      const time = context.currentTime;
      const power = clamp(speed / (onRail ? 29 : 8));
      const strength = Math.sqrt(power) * clamp((speed - 0.18) / 0.9);
      const track = onRail ? rail : pockets;
      const other = onRail ? pockets : rail;
      approach(track.level.gain, strength * (onRail ? 0.93 : 0.61), time, 0.022);
      approach(other.level.gain, 0, time, 0.025);
      approach(track.source.playbackRate, 0.83 + power * 0.31, time, 0.043);
      approach(track.position.pan, clamp(pan, -0.72, 0.72), time, 0.051);
    },
    stop() {
      quietRoll();
      const time = context.currentTime;
      for (const hit of hits) {
        approach(hit.level.gain, 0, time, 0.011);
        hit.source.stop(time + 0.05);
      }
    },
  };
}

export function createRouletteSound(initiallyEnabled: boolean) {
  const request = new AbortController();
  const contacts = new Map<DrawImpact, { time: number; take: number }>();
  let enabled = initiallyEnabled;
  let playing = false;
  let unavailable = false;
  let context: AudioContext | undefined;
  let mixer: ReturnType<typeof createMixer> | undefined;
  let recording: Promise<ArrayBuffer | undefined> | undefined;
  let suspendTimer: ReturnType<typeof setTimeout> | undefined;
  let lastRoll = -Infinity;

  function preload() {
    recording ??= fetch(recordingUrl, { signal: request.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Roulette recording unavailable");
        return response.arrayBuffer();
      })
      .catch(() => {
        recording = undefined;
        return undefined;
      });
    return recording;
  }

  if (enabled && typeof AudioContext !== "undefined") void preload();

  function close() {
    clearTimeout(suspendTimer);
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
    context = undefined;
    mixer = undefined;
  }

  function disableAudio() {
    unavailable = true;
    request.abort();
    close();
  }

  // Loss of the audio device or graph must never interrupt the draw.
  function withMixer(action: (current: NonNullable<typeof mixer>) => void) {
    if (!mixer) return;
    try {
      action(mixer);
    } catch {
      disableAudio();
    }
  }

  function resume(current: AudioContext) {
    void current.resume().catch(() => undefined);
  }

  function activate() {
    if (!enabled || unavailable || typeof AudioContext === "undefined") return;
    clearTimeout(suspendTimer);
    try {
      if (context) {
        resume(context);
        return;
      }
      const current = new AudioContext();
      context = current;
      // Resume in the gesture handler even when the recording still needs decoding.
      resume(current);
      void preload()
        .then(async (bytes) => {
          if (context !== current) return;
          if (!bytes) {
            close();
            return;
          }
          const decoded = await current.decodeAudioData(bytes);
          if (context !== current) return;
          mixer = createMixer(current, decoded);
          mixer.master.gain.value = enabled ? volume : 0;
        })
        .catch(() => {
          if (context === current) disableAudio();
        });
    } catch {
      disableAudio();
    }
  }

  function suspendAfterFade() {
    const current = context;
    if (!current) return;
    clearTimeout(suspendTimer);
    suspendTimer = setTimeout(() => {
      void current.suspend().catch(() => undefined);
    }, 150);
  }

  function stop() {
    playing = false;
    lastRoll = -Infinity;
    contacts.clear();
    withMixer((current) => current.stop());
    suspendAfterFade();
  }

  const signals: DrawSound = {
    audible: () => playing && enabled && !document.hidden && mixer?.context.state === "running",
    roll(speed, pan, onRail) {
      if (!mixer || !signals.audible()) return;
      const time = mixer.context.currentTime;
      if (time - lastRoll < 0.022) return;
      lastRoll = time;
      withMixer((current) => current.roll(speed, pan, onRail));
    },
    impact(kind, strength, pan) {
      if (!mixer || !signals.audible()) return;
      const time = mixer.context.currentTime;
      const previous = contacts.get(kind);
      const spacing = kind === "fret" ? 0.032 : 0.048;
      if (previous && time - previous.time < spacing) return;
      const takes = samples[kind];
      const take = ((previous?.take ?? -1) + 1) % takes.length;
      contacts.set(kind, { time, take });
      const gain = clamp(Math.sqrt(strength) * 0.88);
      const pitch = 0.97 + strength * 0.07;
      withMixer((current) => current.play(takes[take], gain, pan, pitch));
    },
  };

  return {
    signals,
    start() {
      stop();
      playing = true;
      if (!document.hidden) activate();
    },
    finish() {
      playing = false;
      withMixer((current) => current.quietRoll());
      suspendAfterFade();
    },
    stop,
    quiet() {
      withMixer((current) => current.stop());
    },
    setEnabled(next: boolean) {
      enabled = next;
      if (next && playing) activate();
      if (!next) suspendAfterFade();
      withMixer((current) => {
        approach(current.master.gain, next ? volume : 0, current.context.currentTime, 0.013);
        if (!next) current.stop();
      });
    },
    dispose() {
      stop();
      request.abort();
      close();
    },
  };
}
