import { expect, test } from "@playwright/test";

test("runs both 3D draws with the entered candidates", async ({ page }) => {
  test.setTimeout(90_000);
  const names = ["김밥", "비빔밥", "우동", "카레"];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "후보", exact: true })).toBeVisible();
  const edit = page.getByRole("button", { name: "후보 편집", exact: true });
  const dialog = page.getByRole("dialog", { name: "후보 편집", exact: true });
  const draft = dialog.getByRole("textbox", { name: "후보 이름", exact: true });
  const apply = dialog.getByRole("button", { name: "적용", exact: true });
  const entrants = page.locator(".entrants li");
  await edit.click();
  await draft.fill(names.join("\n"));
  await apply.click();
  await expect(entrants).toHaveText(names);
  await expect(edit).toBeFocused();

  const start = page.getByRole("button", { name: "룰렛 돌리기", exact: true });
  const stop = page.getByRole("button", { name: "중지", exact: true });
  const again = page.getByRole("button", { name: "다시 뽑기", exact: true });
  const actionElement = await start.elementHandle();
  await start.click();
  await expect(page.getByText("룰렛이 돌고 있습니다", { exact: true })).toBeVisible();
  await expect(page.getByText("포켓 배정", { exact: true })).toBeVisible();
  await expect(stop).toBeFocused();
  expect(await stop.evaluate((element, initial) => element === initial, actionElement)).toBe(true);
  const result = page.getByTestId("draw-result");
  await expect(result.locator("strong")).toHaveText(/^(김밥|비빔밥|우동|카레)$/, {
    timeout: 40_000,
  });
  await expect(result.locator(".pocket-result")).toHaveText(/\d+번 포켓/);
  await expect(page.getByText("직전 포켓 배정", { exact: true })).toBeVisible();
  expect(await again.evaluate((element, initial) => element === initial, actionElement)).toBe(true);
  const winner = await result.locator("strong").innerText();
  const pocket = (await result.locator(".pocket-result").innerText()).match(/\d+/)?.[0];
  const winnerPockets = await entrants
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
  await expect(page.getByText("직전 포켓 배정", { exact: true })).toBeVisible();

  const raceNames = ["김밥", "라멘", "우동", "카레"];
  await edit.click();
  await draft.fill(raceNames.join("\n"));
  await apply.click();
  await expect(entrants).toHaveText(raceNames);
  await expect(page.getByText("준비 완료", { exact: true })).toBeVisible();
  await expect(start).toBeEnabled();
  await expect(result).toHaveCount(0);
  await expect(entrants.locator(".entrant-pockets")).toHaveCount(0);
  await expect(page.getByText("직전 포켓 배정", { exact: true })).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "구슬 경주", exact: true }).click();
  await page.getByRole("button", { name: "경주 시작", exact: true }).click();
  await expect(page.getByText("구슬이 달리고 있습니다", { exact: true })).toBeVisible();
  await expect(result.locator("strong")).toHaveText(/^(김밥|라멘|우동|카레)$/, { timeout: 40_000 });
  await expect(result.locator(".pocket-result")).toHaveText(/\d+번 구슬/);
  const raceWinner = await result.locator("strong").innerText();
  const marble = (await result.locator(".pocket-result").innerText()).match(/\d+/)?.[0];
  const entrant = entrants.filter({ has: page.getByText(raceWinner, { exact: true }) });
  await expect(entrant.locator(".entrant-number")).toHaveText(marble ?? "");
  await again.click();
  await stop.click();
  await expect(page.getByText("준비 완료", { exact: true })).toBeVisible();
  await expect(result).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("validates candidate drafts and discards unconfirmed changes", async ({ page }) => {
  await page.goto("./");
  const initialNames = ["김밥", "비빔밥", "돈가스", "쌀국수", "우동", "카레"];
  const entrants = page.locator(".entrants li");
  const edit = page.getByRole("button", { name: "후보 편집", exact: true });
  const dialog = page.getByRole("dialog", { name: "후보 편집", exact: true });
  const draft = dialog.getByRole("textbox", { name: "후보 이름", exact: true });
  const apply = dialog.getByRole("button", { name: "적용", exact: true });
  await expect(entrants).toHaveText(initialNames);
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
  await expect(entrants).toHaveText(initialNames);
  await draft.fill("김밥");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();
  await expect(entrants).toHaveText(initialNames);

  await edit.click();
  await expect(draft).toHaveValue(initialNames.join("\n"));
  await expect(draft).toHaveAttribute("data-value-on-focus", initialNames.join("\n"));
  await expect(draft).toHaveAttribute("data-invalid-on-focus", "false");
  await draft.fill("샐러드\n라멘");
  await expect(apply).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();
  await expect(entrants).toHaveText(initialNames);
  await expect(page.getByRole("button", { name: "룰렛 돌리기", exact: true })).toBeEnabled();
});

test("can reload the scene after a WebGL context loss", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByText("준비 완료")).toBeVisible();
  const canvas = page.locator(".scene-canvas canvas");
  await canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("Expected a canvas");
    const extension = element.getContext("webgl2")?.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("Chromium did not expose WEBGL_lose_context");
    extension.loseContext();
  });

  await expect(page.getByText("3D 화면 연결이 끊어졌습니다.")).toBeVisible();
  await page.getByRole("button", { name: "다시 불러오기" }).click();
  await expect(page.getByText("준비 완료")).toBeVisible();
  await expect(canvas).toHaveCount(1);
});

test("keeps mobile controls in keyboard order and protects a running draw", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  await expect(page.getByText("준비 완료")).toBeVisible();

  const action = page.getByRole("button", { name: "룰렛 돌리기" });
  const candidates = page.getByRole("button", { name: "후보 편집", exact: true });
  const race = page.getByRole("button", { name: "구슬 경주", exact: true });
  await expect(action).toBeInViewport();
  const box = await action.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(664);
  await action.focus();
  await page.keyboard.press("Tab");
  await expect(candidates).toBeFocused();

  await action.click();
  await expect(race).toBeDisabled();
  await expect(candidates).toBeDisabled();
  await page.getByRole("button", { name: "중지" }).click();
  await expect(race).toBeEnabled();
  await expect(candidates).toBeEnabled();
});
