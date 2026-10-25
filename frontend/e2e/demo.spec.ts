import { expect, test, type Page } from "@playwright/test";

async function approveAllWaiting(page: Page, exclude = /pay with Stripe/i) {
  // Approve every outbound step that is waiting for the user (except payments).
  for (let i = 0; i < 30; i++) {
    const btn = page.locator('[data-testid=step][data-state=waiting_for_user] button:has-text("Approve")').filter({ hasNotText: exclude }).first();
    if (!(await btn.count())) break;
    await btn.click();
    await page.waitForTimeout(400);
  }
}

test("demo story runs end to end", async ({ page }) => {
  const started = Date.now();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Maya sets up her move (seeded) and the map flies from Long Beach to San Francisco.
  await page.goto("/login");
  await page.getByTestId("try-demo").click();
  await expect(page.getByTestId("resolved-pct")).toBeVisible();
  await page.getByRole("button", { name: "Replay map fly-through" }).click();
  await expect(page.getByText("Your route")).toBeVisible();
  await page.getByTestId("skip-flythrough").click();
  await expect(page.getByTestId("resolved-pct")).toBeVisible();

  // She snaps a chair and a table; Handoff identifies them with value ranges.
  await page.goto("/stuff?tab=scan");
  await page.getByTestId("sample-photos").click();
  await page.goto("/stuff?tab=items");
  await expect(page.getByText("Dining chair")).toBeVisible();
  await expect(page.getByText("Dining table")).toBeVisible();

  // The plan appears across five lanes; she approves it and each step runs live with receipts.
  await page.goto("/run?propose=1");
  await expect(page.getByTestId("plan-actions")).toContainText("List the writing desk");
  await expect(page.getByTestId("plan-actions")).toContainText("Offer the office chair");
  await expect(page.getByTestId("plan-actions")).toContainText("city pickup");
  await expect(page.getByTestId("plan-actions")).toContainText("haul quotes");
  await page.getByTestId("approve-plan").click();
  await expect(page.getByRole("heading", { name: /Done\. Here's what I did/ })).toBeVisible({ timeout: 120_000 });
  await approveAllWaiting(page);

  // Three hauler quotes arrive; she books one with Stripe (test card).
  await page.goto("/transport");
  await expect(page.getByTestId("book-quote")).toHaveCount(3, { timeout: 60_000 });
  await page.getByTestId("book-quote").first().click();
  await page.getByTestId("approve-pay").click();
  await page.waitForURL(/checkout/);
  if (page.url().includes("/checkout/")) await page.getByTestId("pay-test").click(); // simulated checkout when Stripe is unreachable
  await expect(page.getByText("Booked & paid")).toBeVisible();

  // Her notice letter and new-lease summary are ready.
  await page.goto("/old-home");
  await expect(page.getByText("Notice of intent to vacate")).toBeVisible();
  await page.getByRole("button", { name: "I signed and sent it" }).click();
  await page.goto("/new-home");
  await expect(page.getByTestId("lease-flag").first()).toBeVisible();

  // The Command Center shows 70%+ resolved, money earned, and every step visible.
  await page.goto("/");
  await expect
    .poll(async () => parseInt((await page.getByTestId("resolved-pct").innerText()).replace("%", ""), 10), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(70);
  await expect(page.getByText("What Handoff did")).toBeVisible();
  expect(errors).toEqual([]);
  expect(Date.now() - started).toBeLessThan(120_000);
});
