import { expect, test } from "@playwright/test";

test("runs both 3D draws with the entered candidates", async ({ page }) => {
  test.setTimeout(90_000);
  const names = ["김밥", "비빔밥", "우동", "카레"];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("./");
  const candidates = page.getByLabel("후보", { exact: true });
  await expect(candidates).toBeVisible();
  await candidates.fill("김밥\n김밥");
  await expect(page.getByRole("button", { name: "룰렛 돌리기" })).toBeDisabled();
  await expect(page.getByText("같은 이름의 후보가 있습니다.")).toBeVisible();
  await candidates.fill(names.join("\n"));

  await page.getByRole("button", { name: "룰렛 돌리기" }).click();
  await expect(page.getByText("룰렛이 돌고 있습니다")).toBeVisible();
  await expect(page.getByRole("button", { name: "중지" })).toBeFocused();
  const result = page.getByTestId("draw-result");
  await expect(result).toContainText(/김밥|비빔밥|우동|카레/, { timeout: 40_000 });
  await expect(result).toContainText(/\d+번 포켓/);
  await page.getByText("포켓 배정", { exact: true }).click();
  const winner = await result.locator("strong").textContent();
  const pocket = (await result.locator(".pocket-result").textContent())?.match(/\d+/)?.[0];
  const winnerPockets = await page
    .locator(".pocket-assignments dl div")
    .filter({ hasText: winner ?? "" })
    .locator("dd")
    .textContent();
  expect(winnerPockets?.split(", ")).toContain(pocket);

  await page.getByRole("button", { name: "구슬 경주", exact: true }).click();
  await expect(result).toHaveCount(0);
  await page.getByRole("button", { name: "경주 시작" }).click();
  await expect(page.getByText("구슬이 달리고 있습니다")).toBeVisible();
  await expect(result).toContainText(/김밥|비빔밥|우동|카레/, { timeout: 40_000 });
  await page.getByRole("button", { name: "다시 뽑기" }).click();
  await page.getByRole("button", { name: "중지" }).click();
  await expect(page.getByText("준비 완료")).toBeVisible();
  await expect(result).toHaveCount(0);
  expect(pageErrors).toEqual([]);
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
