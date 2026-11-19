<script lang="ts">
  import { onMount } from "svelte";

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
  const initialDraft = "김밥\n비빔밥\n돈가스\n쌀국수\n우동\n카레";

  type Phase = "loading" | "ready" | "running" | "finished" | "failed" | "unavailable";

  let draft = $state(initialDraft);
  let mode = $state<DrawMode>("roulette");
  let phase = $state<Phase>("loading");
  let result: DrawResult | undefined = $state();
  let assignments: DrawScene["assignments"] = $state.raw();
  let sceneCandidates: readonly Candidate[] = $state.raw([]);
  let message = $state("");
  let viewport: HTMLDivElement | undefined = $state();

  let player: DrawPlayer | undefined;
  let loadVersion = 0;

  const names = $derived(draft.split(/\r?\n/).map((name) => name.trim()).filter(Boolean));
  const candidates = $derived(makeCandidates(names.slice(0, maxCandidates)));
  const validation = $derived(
    names.length < 2 ? "후보를 두 개 이상 입력하세요."
    : names.length > maxCandidates ? `후보는 최대 ${maxCandidates}개까지 입력할 수 있습니다.`
    : new Set(names).size !== names.length ? "같은 이름의 후보가 있습니다."
    : "",
  );
  const settings = $derived(modes[mode]);
  const showRaceMap = $derived(
    mode === "race" && phase !== "loading" && phase !== "unavailable" && (!validation || !!result),
  );
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
    : validation ? "후보 확인 필요"
    : "준비 완료",
  );

  function makeCandidates(entries: string[]): Candidate[] {
    return entries.map((name, index) => ({ id: index + 1, name, color: colors[index] }));
  }

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
      const entries = previewCandidates();
      player = createDrawPlayer(host, createScene, entries, {
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
      sceneCandidates = entries;
      phase = "ready";
    } catch {
      if (version !== loadVersion) return;
      phase = "unavailable";
      message = "3D 화면을 열 수 없습니다.";
    }
  }

  function previewCandidates() {
    return validation ? makeCandidates(initialDraft.split("\n")) : candidates;
  }

  function reportFailure(text: string) {
    message = text;
    phase = "failed";
  }

  function start() {
    if (!player || validation || isRunning) return;
    result = undefined;
    assignments = undefined;
    message = "";
    phase = "running";
    try {
      assignments = player.start(candidates);
      sceneCandidates = candidates;
    } catch {
      reportFailure("뽑기를 시작할 수 없습니다. 다시 시도해 주세요.");
    }
  }

  function stop() {
    assignments = undefined;
    try {
      const entries = previewCandidates();
      player?.reset(entries);
      sceneCandidates = entries;
      phase = "ready";
    } catch {
      reportFailure("장면을 다시 열 수 없습니다. 다시 시도해 주세요.");
    }
  }

  function handleControl() {
    if (isRunning) stop();
    else if (phase === "unavailable") void showMode(mode);
    else start();
  }

  $effect(() => {
    const entries = candidates;
    if (mode !== "race" || phase !== "ready" || validation || sceneCandidates === entries) return;
    const timer = window.setTimeout(() => {
      try {
        player?.reset(entries);
        sceneCandidates = entries;
      } catch {
        reportFailure("장면을 다시 열 수 없습니다. 다시 시도해 주세요.");
      }
    }, 180);
    return () => window.clearTimeout(timer);
  });

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

  <main class="studio">
    <section class="draw-stage" id="draw-stage" aria-labelledby="mode-title">
      <div class="stage-visual">
        <div class="mode-heading">
          <h2 id="mode-title">{settings.title}</h2>
          <p>{settings.description}</p>
        </div>
        <div class="scene-view">
          <div class="scene-canvas" bind:this={viewport}></div>
          {#if phase === "loading"}
            <span class="scene-loading" aria-hidden="true"></span>
          {/if}
        </div>
        <div class="stage-toolbar">
          <div class="stage-readout" class:active={isRunning} aria-live="polite" aria-atomic="true">
            {#if result}
              <div class="draw-result" data-testid="draw-result">
                <span class="result-label">당첨</span>
                <strong>{result.candidate.name}</strong>
                <span class="pocket-result">
                  {result.pocket !== undefined ? `${result.pocket}번 포켓` : `${result.candidate.id}번 구슬`}
                </span>
                {#if validation}
                  <span class="next-draw-warning">후보 확인 필요</span>
                {/if}
              </div>
            {:else}
              <span class="stage-status" class:error-status={!!message || !!validation}>
                <span class="status-light" aria-hidden="true"></span>
                {stageStatus}
              </span>
            {/if}
          </div>
          <button
            class="draw-action"
            class:stop-button={isRunning}
            type="button"
            disabled={phase === "loading" || (!isRunning && phase !== "unavailable" && !!validation)}
            aria-describedby={validation && phase !== "unavailable" ? "candidate-error" : undefined}
            onclick={handleControl}
          >
            {#if isRunning}
              <span class="stop-mark" aria-hidden="true"></span>
            {:else if phase !== "unavailable"}
              <span class="play-mark" aria-hidden="true"></span>
            {/if}
            {action}
          </button>
        </div>
      </div>
    </section>

    <aside class="control-panel" class:with-mapping={showRaceMap || !!assignments} aria-label="뽑기 설정">
      <div class="editor-heading">
        <div class="field-heading">
          <label for="candidates">후보</label>
          <span class="candidate-count">{names.length}개</span>
        </div>
        <p id="candidate-hint">한 줄에 하나씩, 2–{maxCandidates}개</p>
      </div>
      <div class="editor-field">
        <textarea
          id="candidates"
          spellcheck="false"
          autocapitalize="off"
          rows="6"
          aria-describedby={validation ? "candidate-hint candidate-error" : "candidate-hint"}
          aria-invalid={!!validation}
          readonly={isRunning}
          bind:value={draft}
        ></textarea>
        <div aria-live="polite">
          {#if validation}
            <p id="candidate-error" class="candidate-error">{validation}</p>
          {/if}
        </div>
      </div>
      {#if showRaceMap}
        <details class="round-details" open>
          <summary>{result ? "직전 경주 구슬 번호" : "구슬 번호"}</summary>
          <ul class="entrants">
            {#each sceneCandidates as candidate (candidate.id)}
              <li>
                <span class="entrant-number" style:background={candidate.color}>{candidate.id}</span>
                <span class="entrant-name">{candidate.name}</span>
              </li>
            {/each}
          </ul>
        </details>
      {:else if assignments}
        <details class="round-details pocket-assignments" open>
          <summary>{result ? "직전 룰렛 포켓 배정" : "포켓 배정"}</summary>
          <dl>
            {#each sceneCandidates as candidate (candidate.id)}
              <div>
                <dt>{candidate.name}</dt>
                <dd>{assignments.get(candidate.id)?.join(", ")}</dd>
              </div>
            {/each}
          </dl>
        </details>
      {/if}
    </aside>
  </main>
</div>
