import samples from "../features/roulette/audio/roulette-samples.json";
import celebrationUrl from "./audio/draw-win.mp3?inline";
import type { DrawImpact, DrawMode, DrawSound } from "./draw";

const recordingUrl = new URL("../features/roulette/audio/roulette-samples.wav", import.meta.url);
const celebrationPreviewUrl = import.meta.env.DEV
  ? import.meta.glob<string>("./audio/preview.local/draw-win.wav", {
      eager: true,
      import: "default",
      query: "?inline",
    })["./audio/preview.local/draw-win.wav"]
  : undefined;
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

function createMixer(context: AudioContext) {
  const master = context.createGain();
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -13;
  compressor.knee.value = 14;
  compressor.ratio.value = 2.5;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.055;
  master.gain.value = volume;
  master.connect(compressor).connect(context.destination);

  const fretPresence = context.createBiquadFilter();
  fretPresence.type = "peaking";
  fretPresence.frequency.value = 2300;
  fretPresence.Q.value = 0.85;
  fretPresence.gain.value = 3;
  fretPresence.connect(master);

  function voice(
    buffer: AudioBuffer,
    clip: Clip,
    gain: number,
    pan: number,
    pitch: number,
    loop = false,
    output: AudioNode = master,
  ) {
    const source = context.createBufferSource();
    const level = context.createGain();
    const position = context.createStereoPanner();
    source.buffer = buffer;
    source.loop = loop;
    source.playbackRate.value = pitch;
    level.gain.value = gain;
    position.pan.value = pan;
    source.connect(level).connect(position).connect(output);
    if (loop) {
      source.loopStart = clip.start;
      source.loopEnd = clip.start + clip.duration;
      source.start(context.currentTime, clip.start);
    } else {
      source.start(context.currentTime + 0.008, clip.start, clip.duration);
    }
    return { source, level, position };
  }

  const hits = new Set<ReturnType<typeof voice>>();
  let tracks: ReturnType<typeof rouletteTracks> | undefined;
  let celebration: AudioBuffer | undefined;
  void fetch(celebrationPreviewUrl ?? celebrationUrl)
    .then((response) => response.arrayBuffer())
    .then((bytes) => context.decodeAudioData(bytes))
    .then((clip) => {
      celebration = clip;
    })
    .catch(() => undefined);

  function rouletteTracks(recording: AudioBuffer) {
    return {
      recording,
      rail: voice(recording, samples.rail, 0, 0, 1, true),
      pockets: voice(recording, samples.pockets, 0, 0, 1, true),
    };
  }

  function oneShot(
    buffer: AudioBuffer,
    clip: Clip,
    gain: number,
    pan: number,
    pitch: number,
    output: AudioNode = master,
  ) {
    const hit = voice(buffer, clip, gain, pan, pitch, false, output);
    hits.add(hit);
    hit.source.onended = () => {
      hits.delete(hit);
      hit.source.disconnect();
      hit.level.disconnect();
      hit.position.disconnect();
    };
  }

  function play(kind: DrawImpact, take: number, strength: number, pan: number) {
    if (!tracks) return;
    const isFret = kind === "fret";
    const intensity = Math.sqrt(clamp(strength));
    const gain = isFret ? Math.min(intensity * 1.5, 0.89) : intensity * 0.88;
    const pitch = 0.97 + strength * 0.07;
    oneShot(
      tracks.recording,
      samples[kind][take],
      gain,
      clamp(pan, -0.68, 0.68),
      pitch,
      isFret ? fretPresence : master,
    );
  }

  function quietRoll() {
    if (!tracks) return;
    approach(tracks.rail.level.gain, 0, context.currentTime, 0.023);
    approach(tracks.pockets.level.gain, 0, context.currentTime, 0.023);
  }

  return {
    context,
    master,
    play,
    quietRoll,
    get hasRecording() {
      return tracks !== undefined;
    },
    loadRecording(recording: AudioBuffer) {
      tracks = rouletteTracks(recording);
    },
    celebrate() {
      if (!celebration) return 0;
      oneShot(celebration, { start: 0, duration: celebration.duration }, 0.96, 0, 1);
      return celebration.duration;
    },
    roll(speed: number, pan: number, onRail: boolean) {
      if (!tracks) return;
      const time = context.currentTime;
      const power = clamp(speed / (onRail ? 29 : 8));
      const strength = Math.sqrt(power) * clamp((speed - 0.18) / 0.9);
      const track = onRail ? tracks.rail : tracks.pockets;
      const other = onRail ? tracks.pockets : tracks.rail;
      approach(track.level.gain, strength * (onRail ? 0.79 : 0.44), time, 0.022);
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

export function createDrawSound(mode: DrawMode, initiallyEnabled: boolean) {
  const request = new AbortController();
  const contacts = new Map<DrawImpact, { time: number; take: number }>();
  let enabled = initiallyEnabled;
  let playing = false;
  let unavailable = false;
  let context: AudioContext | undefined;
  let mixer: ReturnType<typeof createMixer> | undefined;
  let recording: Promise<ArrayBuffer | undefined> | undefined;
  let loadingRecording = false;
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

  if (mode === "roulette" && enabled && typeof AudioContext !== "undefined") {
    void preload();
  }

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

  async function loadRoulette(current: AudioContext) {
    loadingRecording = true;
    try {
      const bytes = await preload();
      if (context !== current || !bytes) return;
      const decoded = await current.decodeAudioData(bytes);
      if (context === current) mixer?.loadRecording(decoded);
    } catch {
      if (context === current) disableAudio();
    } finally {
      loadingRecording = false;
    }
  }

  function activate() {
    if (!enabled || unavailable || typeof AudioContext === "undefined") return;
    clearTimeout(suspendTimer);
    try {
      const current = (context ??= new AudioContext());
      // Resume in the gesture handler even when the recording still needs decoding.
      void current.resume().catch(() => undefined);
      mixer ??= createMixer(current);
      if (mode === "roulette" && !mixer.hasRecording && !loadingRecording) {
        void loadRoulette(current);
      }
    } catch {
      disableAudio();
    }
  }

  function suspendAfterFade(tailSeconds = 0) {
    const current = context;
    if (!current) return;
    clearTimeout(suspendTimer);
    suspendTimer = setTimeout(
      () => {
        void current.suspend().catch(() => undefined);
      },
      tailSeconds * 1000 + 150,
    );
  }

  function stop() {
    playing = false;
    lastRoll = -Infinity;
    contacts.clear();
    withMixer((current) => current.stop());
    suspendAfterFade();
  }

  const signals: DrawSound = {
    audible: () =>
      playing &&
      enabled &&
      !document.hidden &&
      mixer?.hasRecording === true &&
      mixer.context.state === "running",
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
      const take = ((previous?.take ?? -1) + 1) % samples[kind].length;
      contacts.set(kind, { time, take });
      withMixer((current) => current.play(kind, take, strength, pan));
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
      const celebrate = playing && enabled && !document.hidden && context?.state === "running";
      playing = false;
      let tail = 0;
      withMixer((current) => {
        current.quietRoll();
        if (celebrate) tail = current.celebrate();
      });
      suspendAfterFade(tail);
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
