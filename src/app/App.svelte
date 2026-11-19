<script lang="ts">
  import { flushSync, onMount } from "svelte";

  import type { Candidate, DrawMode, DrawResult, DrawScene } from "../lib/draw";
  import type { DrawPlayer } from "../lib/draw-player";
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
  const maxCandidates = colors.length;
  const previewLimit = 3;
  const minimumWheelDrag = 0.12;
  const fullSpeed = 8;

  type Phase = "loading" | "ready" | "running" | "finished" | "failed" | "unavailable";

  interface WheelDrag {
    pointerId: number;
    angle: number | undefined;
    lastAt: number;
    rotation: number;
    velocity: number;
    active: boolean;
  }

  let candidateNames = $state.raw(["김밥", "비빔밥", "돈가스", "쌀국수", "우동", "카레"]);
  let draft = $state("");
  let mode = $state<DrawMode>("roulette");
  let phase = $state<Phase>("loading");
  let result = $state<DrawResult>();
  let assignments: DrawScene["assignments"] = $state.raw();
  let message = $state("");
  let spinnerAvailable = $state(false);
  let spinnerUsed = $state(false);
  let draggingWheel = $state(false);
  let viewport = $state<HTMLDivElement>();
  let editor = $state<HTMLDialogElement>();

  let player: DrawPlayer | undefined;
  let loadVersion = 0;
  let wheelDrag: WheelDrag | undefined;

  const candidates: Candidate[] = $derived(
    candidateNames.map((name, index) => ({ id: index + 1, name, color: colors[index] })),
  );
  const pendingNames = $derived(draft.split(/\r?\n/).map((name) => name.trim()).filter(Boolean));
  const validation = $derived(
    pendingNames.length < 2 ? "후보를 두 개 이상 입력하세요."
    : pendingNames.length > maxCandidates ? `후보는 최대 ${maxCandidates}개까지 입력할 수 있습니다.`
    : new Set(pendingNames).size !== pendingNames.length ? "같은 이름의 후보가 있습니다."
    : "",
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
      });
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
    const angle = player?.wheelAngleAt(event.clientX, event.clientY, true);
    if (angle === undefined || !(event.currentTarget instanceof HTMLElement)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    wheelDrag = {
      pointerId: event.pointerId,
      angle,
      lastAt: event.timeStamp,
      rotation: 0,
      velocity: 0,
      active: false,
    };
  }

  function moveWheelDrag(event: PointerEvent) {
    const drag = wheelDrag;
    if (!drag || drag.pointerId !== event.pointerId || !player) return;
    const angle = player.wheelAngleAt(event.clientX, event.clientY);
    const previousAngle = drag.angle;
    drag.angle = angle;
    if (angle === undefined || previousAngle === undefined) return;

    const delta = Math.atan2(Math.sin(angle - previousAngle), Math.cos(angle - previousAngle));
    const dt = Math.max((event.timeStamp - drag.lastAt) / 1000, 0.008);
    drag.lastAt = event.timeStamp;
    drag.velocity += (delta / dt - drag.velocity) * (1 - Math.exp(-dt / 0.055));
    drag.rotation += delta;

    if (drag.active) {
      player.turnWheel(delta);
    } else if (Math.abs(drag.rotation) >= minimumWheelDrag) {
      if (phase !== "ready") {
        resetRound();
        drag.angle = player.wheelAngleAt(event.clientX, event.clientY);
      }
      if (phase !== "ready") return;
      drag.active = draggingWheel = true;
      player.turnWheel(drag.rotation);
    }
  }

  function releaseWheelDrag(event: PointerEvent) {
    const drag = wheelDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    wheelDrag = undefined;
    draggingWheel = false;
    if (!drag.active || phase !== "ready") return;
    const pause = Math.max(0, event.timeStamp - drag.lastAt - 30);
    const velocity = drag.velocity * Math.exp(-pause / 95);
    const direction = Math.sign(Math.abs(velocity) > 0.15 ? velocity : drag.rotation);
    const power = Math.min(Math.abs(velocity) / fullSpeed, 1);
    startRound(direction * power);
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
    flushSync(() => {
      draft = candidateNames.join("\n");
    });
    editor.showModal();
  }

  function applyCandidates(event: SubmitEvent) {
    event.preventDefault();
    if (validation || isRunning) return;

    if (pendingNames.join("\n") !== candidateNames.join("\n")) {
      candidateNames = pendingNames;
      resetRound();
    }
    editor?.close();
  }

  onMount(() => {
    void showMode(mode);
    return () => {
      loadVersion++;
      player?.dispose();
    };
  });
</script>

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
      data-wheel-draggable={canDragWheel ? "" : undefined}
      onpointerdown={startWheelDrag}
      onpointermove={moveWheelDrag}
      onpointerup={releaseWheelDrag}
      onpointercancel={cancelWheelDrag}
      onlostpointercapture={cancelWheelDrag}
    >
      <div class="scene-canvas" bind:this={viewport}></div>
      {#if canDragWheel && !draggingWheel}
        <span class="wheel-hint">휠을 드래그해 돌리기</span>
      {/if}
    </div>

    <div class="draw-controls">
      <div class="candidate-line">
        {#if mode === "roulette"}
          <p class="candidate-summary">
            <span>{candidatePreview}</span>{#if hiddenCandidates > 0}
              <span>{` 외 ${hiddenCandidates}개`}</span>
            {/if}
          </p>
        {/if}
        <button
          class="button-secondary"
          type="button"
          aria-label={raceRunning ? undefined : "후보 편집"}
          aria-disabled={raceRunning && !spinnerAvailable ? "true" : undefined}
          disabled={isRunning && !raceRunning}
          onclick={handleCandidateControl}
        >{raceRunning ? (spinnerUsed ? "회전 바 뒤집음" : "회전 바 뒤집기")
          : mode === "race" ? "후보 편집" : "편집"}</button>
      </div>

      <div class="round-feedback" aria-live="polite" aria-atomic="true">
        {#if result}
          <div class="draw-result" data-testid="draw-result">
            <strong>{result.candidate.name}</strong>
            <span class="result-label">당첨</span>
            <span class="pocket-result">
              {result.pocket !== undefined ? `${result.pocket}번 포켓` : `${result.candidate.id}번 구슬`}
            </span>
          </div>
        {:else if message}
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

<dialog class="candidate-editor" aria-labelledby="editor-title" bind:this={editor}>
  <form onsubmit={applyCandidates}>
    <header class="editor-heading">
      <h2 id="editor-title">후보 편집</h2>
      <p id="candidate-hint">한 줄에 하나씩, 2–{maxCandidates}개를 입력하세요.</p>
    </header>
    <textarea
      id="candidate-draft"
      aria-label="후보 이름"
      rows="6"
      spellcheck="false"
      autocapitalize="off"
      aria-describedby={validation ? "candidate-hint candidate-error" : "candidate-hint"}
      aria-invalid={!!validation}
      bind:value={draft}
    ></textarea>
    <div aria-live="polite">
      {#if validation}
        <p id="candidate-error" class="candidate-error">{validation}</p>
      {/if}
    </div>
    <div class="editor-actions">
      <button class="button-secondary" type="button" onclick={() => editor?.close()}>취소</button>
      <button class="button-primary" type="submit" disabled={!!validation}>적용</button>
    </div>
  </form>
</dialog>
