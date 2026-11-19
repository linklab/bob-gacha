<script lang="ts">
  import { onMount } from "svelte";
  import type { Vector2 } from "three";

  import rewardTiming from "../lib/audio/draw-win-timing.json";
  import type { Candidate, DrawMode, DrawResult, DrawScene } from "../lib/draw";
  import type { DrawPlayer } from "../lib/draw-player";
  import CandidateEditor from "./CandidateEditor.svelte";
  import DrawCelebration from "./DrawCelebration.svelte";
  import "./app.css";

  const modes = {
    roulette: {
      title: "카지노 룰렛",
      action: "룰렛 돌리기",
    },
    race: {
      title: "구슬 경주",
      action: "경주 시작",
    },
  };
  const modeIds = ["roulette", "race"] as const;
  const colors = [
    "#f6b856", "#80dca4", "#88c8ff", "#fc7d70", "#bea3fa", "#f098bd",
    "#a8d750", "#52d4cd", "#899eff", "#e68e59", "#e6dd85", "#c2d1d6",
  ];
  const previewLimit = 3;
  const swipeRadius = 1.6;
  const fullSpeed = 4.8;
  const soundPreference = "bob-gacha:draw-sound";
  const previousSoundPreference = "bob-gacha:roulette-sound";

  type Phase = "loading" | "ready" | "running" | "finished" | "failed" | "unavailable";

  interface WheelDrag {
    pointerId: number;
    clientX: number;
    clientY: number;
    swipeAxis?: Vector2;
    lastAt: number;
    rotation: number;
    velocity: number;
    direction: number;
    active: boolean;
  }

  let candidateNames = $state.raw(["김밥", "비빔밥", "돈가스", "쌀국수", "우동", "카레"]);
  let mode = $state<DrawMode>("roulette");
  let phase = $state<Phase>("loading");
  let result = $state<DrawResult>();
  let assignments: DrawScene["assignments"] = $state.raw();
  let message = $state("");
  let spinnerAvailable = $state(false);
  let spinnerUsed = $state(false);
  let draggingWheel = $state(false);
  let soundEnabled = $state(true);
  let viewport = $state<HTMLDivElement>();
  let editor = $state<ReturnType<typeof CandidateEditor>>();

  let player: DrawPlayer | undefined;
  let loadVersion = 0;
  let wheelDrag: WheelDrag | undefined;

  const candidates: Candidate[] = $derived(
    candidateNames.map((name, index) => ({ id: index + 1, name, color: colors[index] })),
  );
  const settings = $derived(modes[mode]);
  const candidatePreview = $derived(candidateNames.slice(0, previewLimit).join(" · "));
  const hiddenCandidates = $derived(candidateNames.length - previewLimit);
  const isRunning = $derived(phase === "running");
  const canDragWheel = $derived(
    mode === "roulette" && (phase === "ready" || phase === "finished" || phase === "failed"),
  );
  const raceRunning = $derived(isRunning && mode === "race");
  const action = $derived(
    isRunning ? "중지"
    : phase === "unavailable" ? "다시 불러오기"
    : phase === "finished" || phase === "failed" ? "다시 뽑기"
    : settings.action,
  );
  async function showMode(next: DrawMode) {
    const host = viewport;
    if (!host) return;
    cancelWheelDrag();
    const version = ++loadVersion;
    player?.dispose();
    player = undefined;
    mode = next;
    phase = "loading";
    result = undefined;
    assignments = undefined;
    message = "";

    try {
      const { createDrawPlayer, loadDrawScene } = await import("../lib/draw-player");
      const createScene = await loadDrawScene(next);
      if (version !== loadVersion) return;
      player = createDrawPlayer(host, createScene, candidates, {
        onResult(draw) {
          result = draw;
          phase = "finished";
        },
        onTimeout() {
          reportFailure("결과가 나오지 않았습니다. 다시 시작해 주세요.");
        },
        onError() {
          reportFailure("진행 중 오류가 발생했습니다. 다시 시작해 주세요.");
        },
        onContextLost() {
          cancelWheelDrag();
          result = undefined;
          assignments = undefined;
          phase = "unavailable";
          message = "3D 화면 연결이 끊어졌습니다.";
        },
        onSpinnerAvailabilityChange(available) {
          spinnerAvailable = available;
        },
      }, next, soundEnabled);
      phase = "ready";
    } catch {
      if (version !== loadVersion) return;
      phase = "unavailable";
      message = "3D 화면을 열 수 없습니다.";
    }
  }

  function reportFailure(text: string) {
    message = text;
    phase = "failed";
  }

  function resetRound() {
    result = undefined;
    assignments = undefined;
    if (!player || phase === "unavailable") return;

    message = "";
    try {
      player.reset(candidates);
      phase = "ready";
    } catch {
      reportFailure("장면을 다시 열 수 없습니다. 다시 시도해 주세요.");
    }
  }

  function handleControl() {
    cancelWheelDrag();
    if (isRunning) {
      resetRound();
      return;
    }
    if (phase === "unavailable") {
      void showMode(mode);
      return;
    }
    startRound();
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    player?.setSoundEnabled(soundEnabled);
    try {
      localStorage.setItem(soundPreference, soundEnabled ? "on" : "off");
    } catch {
      // The current session still works if the browser blocks storage.
    }
  }

  function startRound(spin?: number) {
    if (!player || isRunning) return;
    result = undefined;
    assignments = undefined;
    message = "";
    spinnerUsed = false;
    phase = "running";
    try {
      assignments = player.start(candidates, spin);
    } catch {
      reportFailure("뽑기를 시작할 수 없습니다. 다시 시도해 주세요.");
    }
  }

  function startWheelDrag(event: PointerEvent) {
    if (!canDragWheel || wheelDrag || !event.isPrimary || event.button !== 0) return;
    if (
      !(event.currentTarget instanceof HTMLElement) ||
      !player?.wheelPointAt(event.clientX, event.clientY, true)
    ) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    wheelDrag = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      lastAt: event.timeStamp,
      rotation: 0,
      velocity: 0,
      direction: 0,
      active: false,
    };
  }

  function moveWheelDrag(event: PointerEvent) {
    const drag = wheelDrag;
    if (!drag || drag.pointerId !== event.pointerId || !player) return;
    if (event.clientX === drag.clientX && event.clientY === drag.clientY) return;
    if (!drag.active && phase !== "ready") resetRound();
    if (phase !== "ready") return;

    const previous = player.wheelPointAt(drag.clientX, drag.clientY);
    const point = player.wheelPointAt(event.clientX, event.clientY);
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    if (!point || !previous) return;

    const travel = point.clone().sub(previous);
    const distance = travel.length();
    if (distance === 0) return;
    const radius = previous.length();
    const arc = Math.atan2(previous.cross(point), previous.dot(point));
    if (!drag.active && (radius < swipeRadius || Math.abs(arc) * radius < distance * 0.35)) {
      // A straight pull has no orbital angle. Use its starting axis so pulling back reverses it.
      const axisDirection = Math.sign(
        Math.abs(travel.x) >= Math.abs(travel.y) ? travel.x : travel.y,
      );
      drag.swipeAxis = travel
        .clone()
        .multiplyScalar(axisDirection / (distance * Math.max(radius, swipeRadius)));
    }
    const delta =
      drag.swipeAxis ?
        travel.dot(drag.swipeAxis)
      : arc * Math.min(1, radius / swipeRadius, point.length() / swipeRadius);
    if (delta === 0) return;

    const dt = Math.max((event.timeStamp - drag.lastAt) / 1000, 0.008);
    const direction = Math.sign(delta);
    if (drag.direction !== direction) drag.velocity = 0;
    drag.direction = direction;
    drag.lastAt = event.timeStamp;
    drag.velocity += (delta / dt - drag.velocity) * (1 - Math.exp(-dt / 0.035));
    drag.rotation += delta;
    drag.active = draggingWheel = true;
    player.turnWheel(delta);
  }

  function releaseWheelDrag(event: PointerEvent) {
    const drag = wheelDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    wheelDrag = undefined;
    draggingWheel = false;
    if (!drag.active || phase !== "ready") return;
    const pause = Math.max(0, event.timeStamp - drag.lastAt - 35);
    const speed = Math.abs(drag.velocity) * Math.exp(-pause / 85);
    const power = Math.min(speed / fullSpeed, 1);
    startRound(drag.direction * Math.max(power, 0.001));
  }

  function cancelWheelDrag(event?: PointerEvent) {
    const drag = wheelDrag;
    if (!drag || (event && drag.pointerId !== event.pointerId)) return;
    wheelDrag = undefined;
    draggingWheel = false;
    if (drag.active) player?.turnWheel(-drag.rotation);
  }

  function handleCandidateControl() {
    if (raceRunning) {
      if (spinnerAvailable && player?.reverseSpinner()) spinnerUsed = true;
    } else {
      openEditor();
    }
  }

  function openEditor() {
    if (isRunning || !editor) return;
    cancelWheelDrag();
    editor.open();
  }

  function applyCandidates(names: string[]) {
    if (names.join("\n") === candidateNames.join("\n")) return;
    candidateNames = names;
    resetRound();
  }

  onMount(() => {
    try {
      soundEnabled =
        (localStorage.getItem(soundPreference) ?? localStorage.getItem(previousSoundPreference)) !== "off";
    } catch {
      // Storage is optional for playback.
    }
    void showMode(mode);
    return () => {
      loadVersion++;
      player?.dispose();
    };
  });
</script>

<!-- Pointer capture can end before the gesture. Keep tracking its pointer across the page. -->
<svelte:window
  onpointermovecapture={moveWheelDrag}
  onpointerupcapture={releaseWheelDrag}
  onpointercancelcapture={cancelWheelDrag}
/>

<div class="site-shell">
  <header class="topbar">
    <h1>Bob Gacha</h1>
    <nav class="mode-nav" aria-label="뽑기 방식">
      {#each modeIds as id (id)}
        <button
          type="button"
          aria-pressed={mode === id}
          aria-controls="draw-stage"
          disabled={isRunning && mode !== id}
          onclick={() => { if (mode !== id) void showMode(id); }}
        >{modes[id].title}</button>
      {/each}
    </nav>
  </header>

  <main class="draw-stage" id="draw-stage" data-mode={mode} aria-label={settings.title}>
    <div
      class="scene-view"
      role="group"
      aria-label={mode === "roulette" ? "룰렛 휠" : "구슬 경주 트랙"}
      class:dragging-wheel={draggingWheel}
      class:celebrating={!!result}
      style:--reward-impact={`${rewardTiming.impactMs}ms`}
      data-wheel-draggable={canDragWheel ? "" : undefined}
      onpointerdown={startWheelDrag}
    >
      <div class="scene-canvas" bind:this={viewport}></div>
      <div aria-live="polite" aria-atomic="true">
        {#if result}
          <DrawCelebration {result} />
        {/if}
      </div>
      <button
        class="sound-toggle"
        type="button"
        aria-label={mode === "roulette" ? "룰렛 소리" : "구슬 경주 소리"}
        aria-pressed={soundEnabled}
        onpointerdown={(event) => event.stopPropagation()}
        onclick={toggleSound}
      >{soundEnabled ? "소리 켬" : "소리 끔"}</button>
      {#if canDragWheel && !draggingWheel}
        <span class="wheel-hint">휠을 끌었다 놓아 돌리기</span>
      {/if}
    </div>

    <div class="draw-controls">
      <div class="candidate-line">
        <button
          class="button-secondary"
          type="button"
          aria-haspopup={raceRunning ? undefined : "dialog"}
          aria-controls={raceRunning ? undefined : "candidate-editor"}
          aria-disabled={raceRunning && !spinnerAvailable ? "true" : undefined}
          disabled={isRunning && !raceRunning}
          onclick={handleCandidateControl}
        >{raceRunning ? (spinnerUsed ? "회전 바 뒤집음" : "회전 바 뒤집기")
          : `후보 ${candidateNames.length}개 · 편집`}</button>
        {#if mode === "roulette"}
          <p class="candidate-summary">
            <span>{candidatePreview}</span>{#if hiddenCandidates > 0}
              <span>{` 외 ${hiddenCandidates}개`}</span>
            {/if}
          </p>
        {/if}
      </div>

      <div class="round-feedback" aria-live="polite" aria-atomic="true">
        {#if message}
          <p class="error-message">{message}</p>
        {:else if phase === "loading"}
          <p class="loading-message">장면 불러오는 중</p>
        {/if}
      </div>

      <button
        class="draw-action"
        type="button"
        disabled={phase === "loading"}
        onclick={handleControl}
      >{action}</button>
    </div>

    {#if result && result.candidate.name.length > 26}
      <details class="full-winner-name">
        <summary>당첨 이름 전체 보기</summary>
        <p>{result.candidate.name}</p>
      </details>
    {/if}

    {#if mode === "race"}
      <ul class="race-entrants" aria-label="구슬 번호와 후보">
        {#each candidates as candidate (candidate.id)}
          <li class:winner={result?.candidate.id === candidate.id}>
            <span class="entrant-number" style:background={candidate.color}>{candidate.id}</span>
            <span class="entrant-name">{candidate.name}</span>
          </li>
        {/each}
      </ul>
    {:else if assignments}
      {#key assignments}
        <details class="pocket-assignments">
          <summary>포켓 배정 보기</summary>
          <ul>
            {#each candidates as candidate (candidate.id)}
              <li class:winner={result?.candidate.id === candidate.id}>
                <span class="entrant-name">{candidate.name}</span>
                <span class="entrant-pockets">{assignments.get(candidate.id)?.join(", ")}</span>
              </li>
            {/each}
          </ul>
        </details>
      {/key}
    {/if}
  </main>
</div>

<CandidateEditor bind:this={editor} names={candidateNames} {colors} onApply={applyCandidates} />
