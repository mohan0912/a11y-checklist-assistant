module.exports = async ({ page }) => {
  await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /sign in|log in|submit/i }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
};
