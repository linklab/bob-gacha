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

test("runs both 3D draws with the entered candidates", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    let celebrations = 0;
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
  const summary = page.locator(".candidate-summary");
  await expect(summary).toHaveText("김밥 · 비빔밥 · 돈가스 외 3개");
  const edit = page.getByRole("button", { name: "후보 편집", exact: true });
  const dialog = page.getByRole("dialog", { name: "후보 편집", exact: true });
  const draft = dialog.getByRole("textbox", { name: "후보 이름", exact: true });
  const apply = dialog.getByRole("button", { name: "적용", exact: true });
  const assignments = page.locator("details");
  const entrantList = page.getByRole("list", { name: "구슬 번호와 후보" });
  await edit.click();
  await draft.fill(names.join("\n"));
  await apply.click();
  await expect(summary).toHaveText("김밥 · 비빔밥 · 우동 외 1개");
  await expect(assignments).toHaveCount(0);
  await expect(edit).toBeFocused();

  const start = page.getByRole("button", { name: "룰렛 돌리기", exact: true });
  const stop = page.getByRole("button", { name: "중지", exact: true });
  const again = page.getByRole("button", { name: "다시 뽑기", exact: true });
  const actionElement = await start.elementHandle();
  await start.click();
  await expect(page.getByText("룰렛이 돌고 있습니다", { exact: true })).toHaveCount(0);
  const toggleAssignments = page.getByText("포켓 배정 보기", { exact: true });
  await expect(toggleAssignments).toBeVisible();
  await expect(assignments).toHaveJSProperty("open", false);
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
  expect(revealDelay).toBeGreaterThanOrEqual(180);
  expect(revealDelay).toBeLessThan(350);
  await expect(result.locator(".pocket-result")).toHaveText(/\d+번 포켓/);
  await expect(page.locator("html")).toHaveAttribute("data-celebrations", "1");
  expect(await again.evaluate((element, initial) => element === initial, actionElement)).toBe(true);
  const winner = await result.locator("strong").innerText();
  const pocket = (await result.locator(".pocket-result").innerText()).match(/\d+/)?.[0];
  await toggleAssignments.click();
  const winnerPockets = await assignments
    .locator("li")
    .filter({ has: page.getByText(winner, { exact: true }) })
    .locator(".entrant-pockets")
    .innerText();
  expect(winnerPockets.split(", ")).toContain(pocket);

  const finishedResult = (await result.innerText()).trim();
  await edit.click();
  await draft.fill("김밥");
  await page.keyboard.press("Escape");
  await expect(result).toHaveText(finishedResult);

  await edit.click();
  await draft.fill(`  ${names.join("\n\n")}\n`);
  await apply.click();
  await expect(result).toHaveText(finishedResult);

  const raceNames = ["김밥", "라멘", "우동", "카레"].map(
    (name) => `${name} ${"아주긴후보이름".repeat(20)}`,
  );
  await edit.click();
  await draft.fill(raceNames.join("\n"));
  await apply.click();
  await expect(summary).toHaveText(`${raceNames.slice(0, 3).join(" · ")} 외 1개`);
  await expect(start).toBeEnabled();
  await expect(result).toHaveCount(0);
  await expect(assignments).toHaveCount(0);
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
  const oneShots = (await sounds()).filter(({ loop }) => !loop);
  const contacts = oneShots.slice(0, -1);
  expect(contacts.length).toBeGreaterThan(3);
  expect(Math.max(...contacts.map(({ seconds }) => seconds))).toBeLessThan(0.1);
  const celebration = oneShots[oneShots.length - 1];
  expect(celebration?.seconds).toBeGreaterThan(0.5);
  expect(celebration?.seconds).toBeLessThan(2);
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

test("validates candidate drafts and discards unconfirmed changes", async ({ page }) => {
  await page.goto("./");
  const initialNames = ["김밥", "비빔밥", "돈가스", "쌀국수", "우동", "카레"];
  const summary = page.locator(".candidate-summary");
  const edit = page.getByRole("button", { name: "후보 편집", exact: true });
  const dialog = page.getByRole("dialog", { name: "후보 편집", exact: true });
  const draft = dialog.getByRole("textbox", { name: "후보 이름", exact: true });
  const apply = dialog.getByRole("button", { name: "적용", exact: true });
  await expect(summary).toHaveText("김밥 · 비빔밥 · 돈가스 외 3개");
  await page.locator("#candidate-draft").evaluate((element) => {
    if (!(element instanceof HTMLTextAreaElement)) throw new Error("Expected a textarea");
    element.addEventListener("focus", () => {
      element.dataset.valueOnFocus = element.value;
      element.dataset.invalidOnFocus = element.getAttribute("aria-invalid") ?? "";
    });
  });
  await edit.click();
  await expect(dialog.and(page.locator("dialog:modal"))).toBeVisible();
  await expect(draft).toHaveValue(initialNames.join("\n"));
  await expect(draft).toHaveAttribute("data-value-on-focus", initialNames.join("\n"));
  await expect(draft).toHaveAttribute("data-invalid-on-focus", "false");

  await draft.fill("김밥");
  await expect(apply).toBeDisabled();
  await draft.fill("김밥\n 김밥 ");
  await expect(apply).toBeDisabled();
  await expect(dialog.getByText("같은 이름의 후보가 있습니다.", { exact: true })).toBeVisible();
  const boundaryNames = Array.from({ length: 13 }, (_, index) => `후보 ${index + 1}`);
  await draft.fill(boundaryNames.join("\n"));
  await expect(apply).toBeDisabled();
  await draft.fill(boundaryNames.slice(0, 12).join("\n"));
  await expect(apply).toBeEnabled();
  await expect(summary).toHaveText("김밥 · 비빔밥 · 돈가스 외 3개");
  await draft.fill("김밥");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();
  await expect(summary).toHaveText("김밥 · 비빔밥 · 돈가스 외 3개");

  await edit.click();
  await expect(draft).toHaveValue(initialNames.join("\n"));
  await expect(draft).toHaveAttribute("data-value-on-focus", initialNames.join("\n"));
  await expect(draft).toHaveAttribute("data-invalid-on-focus", "false");
  await draft.fill("샐러드\n라멘");
  await expect(apply).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();
  await expect(summary).toHaveText("김밥 · 비빔밥 · 돈가스 외 3개");
  await expect(page.getByRole("button", { name: "룰렛 돌리기", exact: true })).toBeEnabled();
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
  const candidates = page.getByRole("button", { name: "후보 편집", exact: true });
  const race = page.getByRole("button", { name: "구슬 경주", exact: true });
  await expect(action).toBeEnabled();
  await expect(action).toBeInViewport();
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
