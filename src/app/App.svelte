<script lang="ts">
  import { flushSync, onMount } from "svelte";

  import type { Candidate, DrawMode, DrawResult, DrawScene } from "../lib/draw";
  import type { DrawPlayer } from "../lib/draw-player";
  import "./app.css";

  const modes = {
    roulette: {
      title: "카지노 룰렛",
      description: "공이 안착한 포켓에 배정된 후보가 당첨됩니다.",
      action: "룰렛 돌리기",
      running: "룰렛이 돌고 있습니다",
    },
    race: {
      title: "구슬 경주",
      description: "장애물을 지나 결승선을 가장 먼저 통과한 구슬이 당첨됩니다.",
      action: "경주 시작",
      running: "구슬이 달리고 있습니다",
    },
  };
  const modeIds = ["roulette", "race"] as const;
  const colors = [
    "#f6b856", "#80dca4", "#88c8ff", "#fc7d70", "#bea3fa", "#f098bd",
    "#a8d750", "#52d4cd", "#899eff", "#e68e59", "#e6dd85", "#c2d1d6",
  ];
  const maxCandidates = colors.length;

  type Phase = "loading" | "ready" | "running" | "finished" | "failed" | "unavailable";

  let candidateNames = $state.raw(["김밥", "비빔밥", "돈가스", "쌀국수", "우동", "카레"]);
  let draft = $state("");
  let mode = $state<DrawMode>("roulette");
  let phase = $state<Phase>("loading");
  let result = $state<DrawResult>();
  let assignments: DrawScene["assignments"] = $state.raw();
  let message = $state("");
  let viewport = $state<HTMLDivElement>();
  let editor = $state<HTMLDialogElement>();

  let player: DrawPlayer | undefined;
  let loadVersion = 0;

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
  const isRunning = $derived(phase === "running");
  const action = $derived(
    isRunning ? "중지"
    : phase === "unavailable" ? "다시 불러오기"
    : phase === "finished" || phase === "failed" ? "다시 뽑기"
    : settings.action,
  );
  const stageStatus = $derived(
    isRunning ? settings.running
    : message ? message
    : phase === "loading" ? "장면 불러오는 중"
    : "준비 완료",
  );

  async function showMode(next: DrawMode) {
    const host = viewport;
    if (!host) return;
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
          result = undefined;
          assignments = undefined;
          phase = "unavailable";
          message = "3D 화면 연결이 끊어졌습니다.";
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
    if (isRunning) {
      resetRound();
      return;
    }
    if (phase === "unavailable") {
      void showMode(mode);
      return;
    }
    if (!player) return;

    result = undefined;
    assignments = undefined;
    message = "";
    phase = "running";
    try {
      assignments = player.start(candidates);
    } catch {
      reportFailure("뽑기를 시작할 수 없습니다. 다시 시도해 주세요.");
    }
  }

  function openEditor() {
    if (isRunning || !editor) return;
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
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <h1>Bob Gacha</h1>
    </div>
  </header>

  <main class="workspace">
    <section class="draw-stage" data-mode={mode} aria-labelledby="mode-title">
      <nav class="mode-nav" aria-label="뽑기 방식">
        {#each modeIds as id (id)}
          <button
            type="button"
            aria-pressed={mode === id}
            aria-controls="draw-view"
            disabled={isRunning && mode !== id}
            onclick={() => { if (mode !== id) void showMode(id); }}
          >{modes[id].title}</button>
        {/each}
      </nav>
      <header class="mode-heading">
        <h2 id="mode-title">{settings.title}</h2>
        <p>{settings.description}</p>
      </header>

      <div class="scene-view" id="draw-view">
        <div class="scene-canvas" bind:this={viewport}></div>
        {#if phase === "loading"}
          <span class="scene-loading" aria-hidden="true"></span>
        {/if}
      </div>
    </section>

    <div class="stage-toolbar">
      <div class="stage-readout" aria-live="polite" aria-atomic="true">
        {#if result}
          <div class="draw-result" data-testid="draw-result">
            <span class="result-label">당첨</span>
            <strong>{result.candidate.name}</strong>
            <span class="pocket-result">
              {result.pocket !== undefined ? `${result.pocket}번 포켓` : `${result.candidate.id}번 구슬`}
            </span>
          </div>
        {:else}
          <span class="stage-status" class:active={isRunning} class:error-status={!!message}>
            <span class="status-light" aria-hidden="true"></span>
            {stageStatus}
          </span>
        {/if}
      </div>

      <button
        class="draw-action"
        type="button"
        disabled={phase === "loading"}
        onclick={handleControl}
      >
        <span class="action-symbol" aria-hidden="true">
          {#if isRunning}
            <span class="stop-mark"></span>
          {:else if phase === "unavailable"}
            <span class="reload-mark">↻</span>
          {:else}
            <span class="play-mark"></span>
          {/if}
        </span>
        {action}
      </button>
    </div>

    <aside class="control-panel" aria-labelledby="candidate-title">
      <div class="panel-heading">
        <div class="candidate-heading">
          <h2 id="candidate-title">후보</h2>
          <span class="candidate-count">{candidates.length}개</span>
        </div>
        <button class="button-secondary" type="button" disabled={isRunning} onclick={openEditor}>
          후보 편집
        </button>
      </div>
      {#if assignments}
        <p class="roster-context">{result ? "직전 포켓 배정" : "포켓 배정"}</p>
      {/if}
      <ul class="entrants" aria-label={mode === "race" ? "구슬 번호와 후보" : "후보 목록"}>
        {#each candidates as candidate (candidate.id)}
          <li class:winner={result?.candidate.id === candidate.id}>
            <div class="entrant-identity">
              {#if mode === "race"}
                <span class="entrant-number" style:background={candidate.color}>{candidate.id}</span>
              {/if}
              <span class="entrant-name">{candidate.name}</span>
            </div>
            {#if assignments}
              <span class="entrant-pockets">{assignments.get(candidate.id)?.join(", ")}</span>
            {/if}
          </li>
        {/each}
      </ul>
    </aside>
  </main>
</div>

<dialog class="candidate-editor" aria-labelledby="editor-title" bind:this={editor}>
  <form onsubmit={applyCandidates}>
    <header class="editor-heading">
      <h2 id="editor-title">후보 편집</h2>
      <p id="candidate-hint">한 줄에 하나씩, 2–{maxCandidates}개를 입력하세요.</p>
    </header>
    <label class="editor-label" for="candidate-draft">후보 이름</label>
    <textarea
      id="candidate-draft"
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
