<script lang="ts">
  import { flushSync, onMount } from "svelte";

  interface CandidateRow {
    id: number;
    name: string;
  }

  let { names, colors, onApply }: {
    names: readonly string[];
    colors: readonly string[];
    onApply: (names: string[]) => void;
  } = $props();

  let dialog: HTMLDialogElement;
  let title: HTMLHeadingElement;
  let body: HTMLDivElement;
  let pasteInput: HTMLTextAreaElement | undefined;
  let pasteToggle: HTMLButtonElement;
  let addButton: HTMLButtonElement;
  let rows = $state<CandidateRow[]>([]);
  let nextId = 0;
  let pasteOpen = $state(false);
  let pastedText = $state("");

  const maxCandidates = $derived(colors.length);
  const pendingNames = $derived(rows.map(({ name }) => name.trim()).filter(Boolean));
  const duplicateNames = $derived(new Set(
    pendingNames.filter((name, index) => pendingNames.indexOf(name) !== index),
  ));
  const pastedNames = $derived(pastedText.split(/\r\n?|\n/).map((name) => name.trim()).filter(Boolean));
  const canReplace = $derived(pastedNames.length > 0 && pastedNames.length <= maxCandidates);
  const canAppend = $derived(canReplace && rows.length + pastedNames.length <= maxCandidates);
  const validation = $derived(
    pendingNames.length < 2 ? "후보를 두 개 이상 입력하세요."
    : pendingNames.length !== rows.length ? "비어 있는 후보의 이름을 입력하세요."
    : duplicateNames.size > 0 ? "중복된 후보 이름을 수정하세요."
    : "",
  );

  function asRow(name: string): CandidateRow {
    return { id: ++nextId, name };
  }

  function updateViewport() {
    const viewport = window.visualViewport;
    if (!dialog.open || !viewport) return;
    const bottom = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    dialog.style.setProperty("--visible-height", `${viewport.height}px`);
    dialog.style.setProperty("--keyboard-inset", `${bottom}px`);
  }

  export function open() {
    if (dialog.open) return;
    flushSync(() => {
      nextId = 0;
      rows = names.map(asRow);
      pasteOpen = false;
      pastedText = "";
    });
    dialog.showModal();
    body.scrollTop = 0;
    title.focus({ preventScroll: true });
    updateViewport();
  }

  function addCandidate() {
    if (rows.length >= maxCandidates) return;
    const row = asRow("");
    flushSync(() => rows.push(row));
    dialog.querySelector<HTMLInputElement>(`#candidate-name-${row.id}`)?.focus();
  }

  function removeCandidate(index: number) {
    flushSync(() => rows.splice(index, 1));
    const next = rows[index] ?? rows[index - 1];
    const button = next && dialog.querySelector<HTMLButtonElement>(`#candidate-remove-${next.id}`);
    (button || addButton).focus();
  }

  function togglePaste() {
    flushSync(() => {
      pasteOpen = !pasteOpen;
      if (!pasteOpen) pastedText = "";
    });
    if (pasteOpen) pasteInput?.focus();
  }

  function usePaste(replace: boolean) {
    if (replace ? !canReplace : !canAppend) return;
    const incoming = pastedNames.map(asRow);
    flushSync(() => {
      rows = replace ? incoming : [...rows, ...incoming];
      pasteOpen = false;
      pastedText = "";
    });
    pasteToggle.focus();
    if (replace) body.scrollTop = 0;
  }

  function apply() {
    if (validation || pastedNames.length > 0) return;
    onApply(pendingNames);
    dialog.close();
  }

  onMount(() => {
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport);
    return () => {
      viewport?.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
    };
  });
</script>

<dialog id="candidate-editor" aria-labelledby="editor-title" bind:this={dialog}>
  <div class="editor-layout">
    <header class="editor-heading">
      <h2 id="editor-title" tabindex="-1" bind:this={title}>후보 편집</h2>
      <span class="editor-count" aria-live="polite">{pendingNames.length} / {maxCandidates}개</span>
    </header>

    <div class="editor-body" bind:this={body}>
      <div class="editor-tools">
        <button
          class="button-secondary editor-tool"
          type="button"
          aria-expanded={pasteOpen}
          aria-controls="candidate-paste"
          bind:this={pasteToggle}
          onclick={togglePaste}
        >여러 줄 붙여넣기</button>
      </div>

      <section id="candidate-paste" class="paste-panel" hidden={!pasteOpen}>
        <label for="candidate-paste-text">붙여넣을 후보</label>
        <textarea
          id="candidate-paste-text"
          rows="4"
          placeholder="한 줄에 한 후보씩 붙여넣으세요."
          spellcheck="false"
          autocapitalize="off"
          bind:this={pasteInput}
          bind:value={pastedText}
        ></textarea>
        {#if pastedNames.length > 0}
          <p class="paste-status" role="status">
            {#if !canReplace}
              최대 {maxCandidates}개까지 붙여넣을 수 있습니다.
            {:else}
              붙여넣을 후보 {pastedNames.length}개
              {#if !canAppend}<span> · 목록 교체만 가능</span>{/if}
            {/if}
          </p>
        {/if}
        <div class="paste-actions">
          <button class="button-secondary" type="button" disabled={!canAppend} onclick={() => usePaste(false)}>목록에 추가</button>
          <button class="button-secondary" type="button" disabled={!canReplace} onclick={() => usePaste(true)}>목록 교체</button>
        </div>
      </section>

      <ul class="candidate-rows" aria-label="후보 목록">
        {#each rows as row, index (row.id)}
          {@const duplicate = duplicateNames.has(row.name.trim())}
          <li class="candidate-row">
            <span class="candidate-number" style:background={colors[index]} aria-hidden="true">{index + 1}</span>
            <input
              id={`candidate-name-${row.id}`}
              type="text"
              aria-label={`후보 ${index + 1} 이름`}
              aria-invalid={duplicate}
              aria-describedby={duplicate ? `duplicate-candidate-${row.id}` : undefined}
              placeholder="후보 이름"
              spellcheck="false"
              autocapitalize="off"
              bind:value={row.name}
            />
            <button
              id={`candidate-remove-${row.id}`}
              class="remove-candidate"
              type="button"
              aria-label={`후보 ${index + 1} 삭제`}
              onclick={() => removeCandidate(index)}
            >삭제</button>
            {#if duplicate}
              <span class="row-error" id={`duplicate-candidate-${row.id}`}>다른 후보와 이름이 같습니다.</span>
            {/if}
          </li>
        {/each}
      </ul>

      <button
        class="button-secondary add-candidate"
        type="button"
        aria-label="후보 추가"
        disabled={rows.length >= maxCandidates}
        bind:this={addButton}
        onclick={addCandidate}
      ><span aria-hidden="true">＋</span> 후보 추가</button>
    </div>

    <footer class="editor-footer">
      <div class="editor-error" aria-live="polite">{validation}</div>
      <button class="button-secondary" type="button" onclick={() => dialog.close()}>취소</button>
      <button class="button-primary" type="button" disabled={!!validation || pastedNames.length > 0} onclick={apply}>
        후보 {pendingNames.length}개 적용
      </button>
    </footer>
  </div>
</dialog>

<style>
  dialog {
    position: fixed;
    inset: 0 0 0 auto;
    width: min(452px, 100%);
    height: 100dvh;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 0;
    border-inline-start: 1px solid #363636;
    background: var(--panel);
    color: var(--ink);
    box-shadow: -14px 0 56px rgb(0 0 0 / 45%);
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 58%);
  }

  .editor-layout {
    display: grid;
    height: 100%;
    grid-template-rows: auto minmax(0, 1fr) auto;
  }

  .editor-heading,
  .editor-body,
  .editor-footer {
    padding-inline: clamp(16px, 5vw, 24px);
  }

  .editor-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding-block: var(--space-5) var(--space-4);
    border-bottom: 1px solid #292929;
  }

  h2 {
    margin: 0;
    outline: none;
    font-size: 24px;
    font-weight: 750;
    letter-spacing: -0.04em;
  }

  .editor-count {
    color: var(--muted);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .editor-body {
    overflow: auto;
    overscroll-behavior: contain;
    padding-block: var(--space-3) var(--space-5);
    scroll-padding-block: var(--space-3);
  }

  .editor-tools {
    display: flex;
    justify-content: flex-end;
    margin-bottom: var(--space-3);
  }

  .editor-tool[aria-expanded="true"] {
    background: var(--surface-hover);
  }

  .paste-panel {
    margin-bottom: var(--space-4);
    padding: var(--space-3);
    border: 1px solid #414141;
    border-radius: 12px;
    background: var(--surface-raised);
  }

  .paste-panel label {
    display: block;
    margin-bottom: var(--space-2);
    font-size: 13px;
    font-weight: 700;
  }

  .paste-panel textarea {
    display: block;
    width: 100%;
    min-height: 72px;
    padding: var(--space-2) var(--space-3);
    resize: vertical;
    border: 1px solid var(--field-line);
    border-radius: 8px;
    background: var(--panel);
    color: var(--ink);
    font-size: 16px;
  }

  .paste-panel textarea::placeholder,
  .candidate-row input::placeholder {
    color: var(--disabled);
  }

  .paste-status {
    margin: var(--space-2) 0 0;
    color: var(--muted);
    font-size: 13px;
  }

  .paste-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .paste-actions button {
    background: #303030;
  }

  .candidate-rows {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .candidate-rows:not(:empty) {
    overflow: hidden;
    border: 1px solid #343434;
    border-radius: 12px;
  }

  .candidate-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    column-gap: var(--space-2);
    padding: 5px var(--space-2) 5px var(--space-3);
    background: #1a1a1a;
  }

  .candidate-row + .candidate-row {
    border-top: 1px solid #303030;
  }

  .candidate-number {
    display: grid;
    width: 24px;
    aspect-ratio: 1;
    place-items: center;
    border-radius: 50%;
    color: #111;
    font-size: 12px;
    font-weight: 750;
    font-variant-numeric: tabular-nums;
  }

  .candidate-row input {
    width: 100%;
    min-height: 44px;
    padding: 0 8px;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    background: #151515;
    color: var(--ink);
    font: inherit;
    font-size: 16px;
  }

  .candidate-row input:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: -2px;
    background: #262626;
  }

  .candidate-row input[aria-invalid="true"] {
    border-color: var(--negative);
  }

  .remove-candidate {
    min-width: 48px;
    min-height: 44px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    font-size: 13px;
  }

  @media (hover: hover) {
    .candidate-row input:not(:focus):not([aria-invalid="true"]):hover {
      border-color: #505050;
    }

    .remove-candidate:hover {
      background: var(--surface-hover);
      color: var(--negative);
    }
  }

  .row-error {
    grid-column: 2 / -1;
    padding: 3px 8px 6px;
    color: var(--negative);
    font-size: 12px;
  }

  .add-candidate {
    width: 100%;
    margin-top: var(--space-3);
    border: 1px dashed #4b4b4b;
    border-radius: 9px;
    background: transparent;
  }

  .editor-footer {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2);
    padding-block: var(--space-3) max(var(--space-4), env(safe-area-inset-bottom));
    border-top: 1px solid #303030;
    background: #171717;
  }

  .editor-error {
    grid-column: 1 / -1;
    color: var(--negative);
    font-size: 13px;
  }

  .editor-error:empty {
    display: none;
  }

  @media (max-width: 700px) {
    dialog {
      inset: auto 0 var(--keyboard-inset, 0px);
      width: 100%;
      height: min(660px, calc(var(--visible-height, 100dvh) - 16px));
      border-inline-start: 0;
      border-top: 1px solid #414141;
      border-radius: 18px 18px 0 0;
      box-shadow: 0 -12px 45px rgb(0 0 0 / 50%);
    }

    .editor-heading {
      padding-block: var(--space-3);
    }
  }
</style>
