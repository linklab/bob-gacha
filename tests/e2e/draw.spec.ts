import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";

async function watchWheelCapture(wheel: Locator) {
  await wheel.evaluate((element) => {
    element.addEventListener(
      "gotpointercapture",
      (event) => {
        if (event instanceof PointerEvent) {
          element.setAttribute("data-test-pointer-id", String(event.pointerId));
        }
      },
      { once: true },
    );
  });
}

async function dropWheelCapture(wheel: Locator) {
  await wheel.evaluate((element) => {
    const pointerId = Number(element.getAttribute("data-test-pointer-id"));
    if (!element.hasPointerCapture(pointerId)) throw new Error("The wheel did not capture input");
    element.releasePointerCapture(pointerId);
  });
}

async function replaceCandidates(dialog: Locator, text: string) {
  await dialog.getByRole("button", { name: "여러 줄 붙여넣기", exact: true }).click();
  await dialog.getByRole("textbox", { name: "붙여넣을 후보", exact: true }).fill(text);
  await dialog.getByRole("button", { name: "목록 교체", exact: true }).click();
}

test("runs both 3D draws with the entered candidates", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    let celebrations = 0;
    let labelCanvas: HTMLCanvasElement | undefined;
    let labels: string[] = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      if (maxWidth === undefined) fillText.call(this, text, x, y);
      else fillText.call(this, text, x, y, maxWidth);
      if (labelCanvas !== this.canvas) {
        labelCanvas = this.canvas;
        labels = [];
      }
      labels.push(text);
      document.documentElement.setAttribute("data-wheel-labels", JSON.stringify(labels));
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
      start.call(this, when, offset, duration);
      if (!this.loop && duration && duration > 0.5) {
        document.documentElement.setAttribute("data-celebrations", String(++celebrations));
      }
    };
  });
  const names = ["김밥", "비빔밥", "우동", "카레"];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("./");
  await expect(page.getByRole("heading")).toHaveText("Bob Gacha");
  const wheelLabels = async () => {
    const labels = await page.locator("html").getAttribute("data-wheel-labels");
    return (JSON.parse(labels ?? "[]") as string[]).sort();
  };
  await expect
    .poll(wheelLabels)
    .toEqual(["김밥", "비빔밥", "돈가스", "쌀국수", "우동", "카레"].sort());
  const summary = page.locator(".candidate-summary");
  await expect(summary).toHaveText("김밥 · 비빔밥 · 돈가스 외 3개");
  const edit = page.getByRole("button", { name: /^후보 \d+개 · 편집$/ });
  const dialog = page.getByRole("dialog", { name: "후보 편집", exact: true });
  const apply = dialog.getByRole("button", { name: /^후보 \d+개 적용$/ });
  const entrantList = page.getByRole("list", { name: "구슬 번호와 후보" });
  await edit.click();
  await replaceCandidates(dialog, names.join("\n"));
  await apply.click();
  await expect(summary).toHaveText("김밥 · 비빔밥 · 우동 외 1개");
  await expect.poll(wheelLabels).toEqual([...names].sort());
  await expect(edit).toBeFocused();

  const start = page.getByRole("button", { name: "룰렛 돌리기", exact: true });
  const stop = page.getByRole("button", { name: "중지", exact: true });
  const again = page.getByRole("button", { name: "다시 뽑기", exact: true });
  const actionElement = await start.elementHandle();
  await start.click();
  await expect(page.getByText("룰렛이 돌고 있습니다", { exact: true })).toHaveCount(0);
  await expect(page.getByText("포켓 배정 보기", { exact: true })).toHaveCount(0);
  await expect(stop).toBeFocused();
  expect(await stop.evaluate((element, initial) => element === initial, actionElement)).toBe(true);
  const result = page.getByTestId("draw-result");
  await expect(result.locator("strong")).toHaveText(/^(김밥|비빔밥|우동|카레)$/, {
    timeout: 40_000,
  });
  await expect(page.locator(".scene-view").getByTestId("draw-result")).toBeVisible();
  await expect
    .poll(() => result.evaluate((element) => element.getAnimations({ subtree: true }).length))
    .toBeGreaterThan(0);
  const revealDelay = await result.locator(".winner").evaluate((element) => {
    const [reveal] = element.getAnimations();
    return reveal?.effect?.getTiming().delay ?? 0;
  });
  expect(revealDelay).toBeGreaterThanOrEqual(350);
  expect(revealDelay).toBeLessThan(550);
  const waveDelays = await result
    .locator(".shockwave")
    .evaluateAll((waves) =>
      waves.map((wave) => wave.getAnimations()[0]?.effect?.getTiming().delay),
    );
  expect(waveDelays).toHaveLength(3);
  expect(waveDelays[0]).toBe(revealDelay);
  expect(waveDelays[1]).toBeGreaterThan(revealDelay + 300);
  expect(waveDelays[2]).toBeGreaterThan(revealDelay + 700);
  const ongoingEffects = await result.evaluate(
    (element) =>
      element
        .getAnimations({ subtree: true })
        .filter(
          (animation) =>
            animation.playState === "running" &&
            animation.effect?.getTiming().iterations === Infinity,
        ).length,
  );
  expect(ongoingEffects).toBeGreaterThan(1);
  await expect(result.locator(".pocket-result")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-celebrations", "1");
  expect(await again.evaluate((element, initial) => element === initial, actionElement)).toBe(true);
  expect(await wheelLabels()).toContain(await result.locator("strong").innerText());

  const finishedResult = (await result.innerText()).trim();
  await edit.click();
  await dialog.getByRole("textbox", { name: "후보 1 이름", exact: true }).fill("초밥");
  await page.keyboard.press("Escape");
  await expect(result).toHaveText(finishedResult);

  await edit.click();
  await replaceCandidates(dialog, `  ${names.join("\n\n")}\n`);
  await apply.click();
  await expect(result).toHaveText(finishedResult);

  const raceNames = ["김밥", "라멘", "우동", "카레"].map(
    (name) => `${name} ${"아주긴후보이름".repeat(20)}`,
  );
  await edit.click();
  await replaceCandidates(dialog, raceNames.join("\n"));
  await apply.click();
  await expect(summary).toHaveText(`${raceNames.slice(0, 3).join(" · ")} 외 1개`);
  await expect(start).toBeEnabled();
  await expect(result).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 410 });
  await page.getByRole("button", { name: "구슬 경주", exact: true }).click();
  await expect(entrantList.locator(".entrant-name")).toHaveText(raceNames);
  const startRace = page.getByRole("button", { name: "경주 시작", exact: true });
  await startRace.click();
  await expect(stop).toBeFocused();
  const reverse = page.getByRole("button", { name: "회전 바 뒤집기", exact: true });
  await reverse.click();
  await expect(page.getByRole("button", { name: "회전 바 뒤집음", exact: true })).toBeDisabled();
  await expect(page.getByText("구슬이 달리고 있습니다", { exact: true })).toHaveCount(0);
  await expect(result.locator("strong")).toBeVisible({ timeout: 40_000 });
  await expect(page.locator(".scene-view").getByTestId("draw-result")).toBeVisible();
  expect(await result.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(
    0,
  );
  await expect(result.locator(".pocket-result")).toHaveText(/\d+번 구슬/);
  await expect(result.locator(".pocket-result")).toBeInViewport();
  await expect(page.locator("html")).toHaveAttribute("data-celebrations", "2");
  const raceWinner = await result.locator("strong").innerText();
  expect(raceNames).toContain(raceWinner);
  await page.getByText("당첨 이름 전체 보기", { exact: true }).click();
  await expect(page.locator(".full-winner-name p")).toHaveText(raceWinner);
  const marble = (await result.locator(".pocket-result").innerText()).match(/\d+/)?.[0];
  const entrant = entrantList.locator("li.winner");
  await expect(entrant.locator(".entrant-name")).toHaveText(raceWinner);
  await expect(entrant.locator(".entrant-number")).toHaveText(marble ?? "");
  await again.click();
  await expect(reverse).toBeEnabled();
  await stop.click();
  await expect(startRace).toBeEnabled();
  await expect(result).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("starts roulette with a drag on the wheel", async ({ page }) => {
  await page.goto("./");
  const start = page.getByRole("button", { name: "룰렛 돌리기", exact: true });
  const stop = page.getByRole("button", { name: "중지", exact: true });
  await expect(start).toBeEnabled();
  const wheel = await page.locator(".scene-view").boundingBox();
  if (!wheel) throw new Error("The roulette wheel is missing");
  const centerX = wheel.x + wheel.width / 2;
  const centerY = wheel.y + wheel.height / 2;
  const radius = wheel.height * 0.34;
  const view = page.locator(".scene-view");
  await page.mouse.click(centerX, centerY);
  await expect(start).toBeEnabled();
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 8, centerY);
  await expect(view).toHaveClass(/dragging-wheel/);
  await page.mouse.up();
  await expect(stop).toBeEnabled();
  await stop.click();
  await expect(start).toBeEnabled();

  await page.mouse.click(centerX + radius, centerY);
  await expect(start).toBeEnabled();
  await page.mouse.move(centerX + radius, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + radius, centerY + 8);
  await expect(view).toHaveClass(/dragging-wheel/);
  for (let step = 1; step <= 8; step++) {
    const angle = (step * Math.PI) / 12;
    await page.mouse.move(
      centerX + Math.cos(angle) * radius,
      centerY + Math.sin(angle) * radius * 0.75,
    );
  }
  await expect(start).toBeEnabled();
  await page.mouse.up();
  await expect(stop).toBeEnabled();
  await expect(page.getByTestId("draw-result")).toBeVisible({ timeout: 30_000 });
});

test("starts roulette when a captured mouse drag is released outside the wheel", async ({
  page,
}) => {
  await page.goto("./");
  const view = page.locator(".scene-view");
  const start = page.getByRole("button", { name: "룰렛 돌리기", exact: true });
  await expect(start).toBeEnabled();
  const wheel = await view.boundingBox();
  if (!wheel) throw new Error("The roulette wheel is missing");
  const x = wheel.x + wheel.width / 2;
  const y = wheel.y + wheel.height / 2;
  await watchWheelCapture(view);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y);
  await expect(view).toHaveClass(/dragging-wheel/);
  await dropWheelCapture(view);
  await page.mouse.move(x + 30, wheel.y - 10);
  await expect(start).toBeEnabled();
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "중지", exact: true })).toBeEnabled();
});

test.describe("mobile roulette", () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });

  test("follows a touch from the center before the spin starts", async ({ page }) => {
    await page.goto("./");
    const view = page.locator(".scene-view");
    const start = page.getByRole("button", { name: "룰렛 돌리기", exact: true });
    await expect(start).toBeEnabled();
    const wheel = await view.boundingBox();
    if (!wheel) throw new Error("The roulette wheel is missing");
    const x = Math.round(wheel.x + wheel.width / 2);
    const y = Math.round(wheel.y + wheel.height / 2);
    const touch = await page.context().newCDPSession(page);
    await watchWheelCapture(view);
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + 8, y }],
    });
    await expect(view).toHaveClass(/dragging-wheel/);
    await expect(start).toBeEnabled();
    await dropWheelCapture(view);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + 8, y: Math.ceil(wheel.y + wheel.height + 10) }],
    });
    await expect(start).toBeEnabled();
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.getByRole("button", { name: "중지", exact: true })).toBeEnabled();
  });
});

test("plays roulette contacts, celebrates the result once, and remembers mute", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const sounds: { loop: boolean; seconds: number }[] = [];
    let context: BaseAudioContext | undefined;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
      start.call(this, when, offset, duration);
      context = this.context;
      sounds.push({
        loop: this.loop,
        seconds: (duration ?? this.buffer?.duration ?? 0) / this.playbackRate.value,
      });
    };
    Object.defineProperty(window, "observedRouletteSounds", { value: sounds });
    Object.defineProperty(window, "rouletteAudioState", { get: () => context?.state });
  });
  const sounds = () =>
    page.evaluate(
      () =>
        (
          window as Window & {
            observedRouletteSounds?: { loop: boolean; seconds: number }[];
          }
        ).observedRouletteSounds ?? [],
    );
  const sound = page.getByRole("button", { name: "룰렛 소리", exact: true });
  const start = page.getByRole("button", { name: "룰렛 돌리기", exact: true });
  const stop = page.getByRole("button", { name: "중지", exact: true });
  const audioState = () =>
    page.evaluate(
      () => (window as Window & { rouletteAudioState?: AudioContextState }).rouletteAudioState,
    );

  const recording = page.waitForResponse(
    (response) =>
      /\/roulette-samples[^/]*\.wav$/.test(new URL(response.url()).pathname) && response.ok(),
  );
  await page.goto("./");
  await recording;
  await expect(start).toBeEnabled();
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  expect(await sounds()).toEqual([]);
  await sound.click();
  await page.reload();
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await start.click();
  await expect(stop).toBeEnabled();
  expect(await sounds()).toEqual([]);
  await stop.click();

  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  await start.click();
  await expect(stop).toBeEnabled();
  await expect.poll(audioState).toBe("running");
  expect((await sounds()).map(({ loop }) => loop)).toEqual([true, true]);
  await expect(page.getByTestId("draw-result")).toBeVisible({ timeout: 40_000 });
  expect(
    await page
      .getByTestId("draw-result")
      .evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBe(0);
  const oneShots = (await sounds()).filter(({ loop }) => !loop);
  const contacts = oneShots.slice(0, -1);
  expect(contacts.length).toBeGreaterThan(3);
  expect(Math.max(...contacts.map(({ seconds }) => seconds))).toBeLessThan(0.1);
  const celebration = oneShots[oneShots.length - 1];
  expect(celebration?.seconds).toBeGreaterThan(3);
  expect(celebration?.seconds).toBeLessThan(3.7);
  await expect.poll(audioState).toBe("suspended");
  await page.getByRole("button", { name: "다시 뽑기", exact: true }).click();
  await expect.poll(audioState).toBe("running");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await expect.poll(audioState).toBe("suspended");
  await stop.click();
  await page.getByRole("button", { name: "구슬 경주", exact: true }).click();
  await expect(sound).toHaveCount(0);
  await expect(page.getByRole("button", { name: "구슬 경주 소리", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("retries a failed roulette recording download on play", async ({ page }) => {
  const recording = /\/roulette-samples[^/]*\.wav$/;
  await page.route(recording, (route) => route.abort(), { times: 1 });
  const failed = page.waitForEvent("requestfailed", (request) => recording.test(request.url()));
  await page.goto("./");
  await failed;

  const loaded = page.waitForResponse(
    (response) => recording.test(response.url()) && response.ok(),
    {
      timeout: 5_000,
    },
  );
  await page.getByRole("button", { name: "룰렛 돌리기", exact: true }).click();
  await loaded;
  await expect(page.getByRole("button", { name: "중지", exact: true })).toBeEnabled();
});

test("keeps the draw running when the sound device fails", async ({ page }) => {
  await page.addInitScript(() => {
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
      if (this.loop) throw new DOMException("Audio device unavailable", "InvalidStateError");
      start.call(this, when, offset, duration);
    };
    const close = AudioContext.prototype.close;
    AudioContext.prototype.close = function () {
      document.documentElement.setAttribute("data-audio-device-closed", "");
      return close.call(this);
    };
  });
  await page.goto("./");
  const start = page.getByRole("button", { name: "룰렛 돌리기", exact: true });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.locator("html")).toHaveAttribute("data-audio-device-closed", "");
  const stop = page.getByRole("button", { name: "중지", exact: true });
  await expect(stop).toBeEnabled();
  await stop.click();
  await expect(start).toBeEnabled();
});

test("edits candidate rows and reviews a pasted list before applying", async ({ page }) => {
  await page.goto("./");
  const summary = page.locator(".candidate-summary");
  const edit = page.getByRole("button", { name: /^후보 \d+개 · 편집$/ });
  const dialog = page.getByRole("dialog", { name: "후보 편집", exact: true });
  const name = (index: number) =>
    dialog.getByRole("textbox", { name: `후보 ${index} 이름`, exact: true });
  const apply = dialog.getByRole("button", { name: /^후보 \d+개 적용$/ });
  const bulk = dialog.getByRole("button", { name: "여러 줄 붙여넣기", exact: true });
  const paste = dialog.getByRole("textbox", { name: "붙여넣을 후보", exact: true });
  const append = dialog.getByRole("button", { name: "목록에 추가", exact: true });
  const replace = dialog.getByRole("button", { name: "목록 교체", exact: true });

  await edit.click();
  await expect(dialog.and(page.locator("dialog:modal"))).toBeVisible();
  await expect(dialog.getByRole("heading")).toBeFocused();
  await expect(name(1)).toHaveValue("김밥");
  await name(2).fill(" 김밥 ");
  await expect(name(1)).toHaveAttribute("aria-invalid", "true");
  await expect(name(2)).toHaveAttribute("aria-invalid", "true");
  await expect(apply).toBeDisabled();
  await name(2).fill("샐러드");
  await dialog.getByRole("button", { name: "후보 3 삭제", exact: true }).click();
  await expect(name(3)).toHaveValue("쌀국수");
  await dialog.getByRole("button", { name: "후보 추가", exact: true }).click();
  await expect(name(6)).toBeFocused();
  await expect(apply).toBeDisabled();
  await name(6).fill("초밥");
  await expect(apply).toBeEnabled();
  await expect(summary).toHaveText("김밥 · 비빔밥 · 돈가스 외 3개");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();

  await edit.click();
  await expect(name(2)).toHaveValue("비빔밥");
  await bulk.click();
  await expect(paste).toBeFocused();
  await paste.fill(Array.from({ length: 13 }, (_, index) => `후보 ${index + 1}`).join("\n"));
  await expect(append).toBeDisabled();
  await expect(replace).toBeDisabled();
  await paste.fill(Array.from({ length: 12 }, (_, index) => `후보 ${index + 1}`).join("\n"));
  await expect(append).toBeDisabled();
  await expect(replace).toBeEnabled();
  await replace.click();
  await expect(name(12)).toHaveValue("후보 12");
  await expect(dialog.getByRole("button", { name: "후보 추가", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();
  await expect(summary).toHaveText("김밥 · 비빔밥 · 돈가스 외 3개");

  await edit.click();
  await replaceCandidates(dialog, "타코");
  await expect(name(1)).toHaveValue("타코");
  await expect(apply).toBeDisabled();
  await bulk.click();
  await paste.fill(" 샐러드 \n\n라멘\n");
  await expect(dialog.getByText("붙여넣을 후보 2개", { exact: true })).toBeVisible();
  await expect(apply).toBeDisabled();
  await append.click();
  await expect(name(2)).toHaveValue("샐러드");
  await expect(name(3)).toHaveValue("라멘");
  await dialog.getByRole("button", { name: "후보 3개 적용", exact: true }).click();
  await expect(summary).toHaveText("타코 · 샐러드 · 라멘");
  await expect(edit).toBeFocused();
});

test("can reload the scene after a WebGL context loss", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("button", { name: "룰렛 돌리기", exact: true })).toBeEnabled();
  const canvas = page.locator(".scene-canvas canvas");
  await canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("Expected a canvas");
    const extension = element.getContext("webgl2")?.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("Chromium did not expose WEBGL_lose_context");
    extension.loseContext();
  });

  await expect(page.getByText("3D 화면 연결이 끊어졌습니다.")).toBeVisible();
  await page.getByRole("button", { name: "다시 불러오기" }).click();
  await expect(page.getByRole("button", { name: "룰렛 돌리기", exact: true })).toBeEnabled();
  await expect(canvas).toHaveCount(1);
});

test("keeps mobile controls in keyboard order and protects a running draw", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");

  const action = page.getByRole("button", { name: "룰렛 돌리기" });
  const candidates = page.getByRole("button", { name: /^후보 \d+개 · 편집$/ });
  const race = page.getByRole("button", { name: "구슬 경주", exact: true });
  await expect(action).toBeEnabled();
  await expect(action).toBeInViewport();
  await candidates.click();
  const sheet = page.getByRole("dialog", { name: "후보 편집", exact: true });
  const sheetBounds = await sheet.boundingBox();
  expect(sheetBounds).not.toBeNull();
  expect(sheetBounds!.width).toBe(390);
  expect(sheetBounds!.y + sheetBounds!.height).toBeCloseTo(664, 0);
  await expect(sheet.getByRole("heading")).toBeFocused();
  await replaceCandidates(
    sheet,
    Array.from({ length: 12 }, (_, index) => `후보 ${index + 1}`).join("\n"),
  );
  const apply = sheet.getByRole("button", { name: "후보 12개 적용", exact: true });
  await expect(apply).toBeInViewport();
  await sheet.getByRole("textbox", { name: "후보 12 이름", exact: true }).focus();
  await expect(apply).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(candidates).toBeFocused();
  const box = await action.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(664);
  await candidates.focus();
  await page.keyboard.press("Tab");
  await expect(action).toBeFocused();

  await action.click();
  await expect(race).toBeDisabled();
  await expect(candidates).toBeDisabled();
  await page.getByRole("button", { name: "중지" }).click();
  await expect(race).toBeEnabled();
  await expect(candidates).toBeEnabled();
});
