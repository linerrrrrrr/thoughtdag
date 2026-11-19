export async function openModelConnection(page, type) {
  await page.locator('[data-project-switcher] [data-model-picker-trigger]').click();
  await page.locator('[data-picker-view="settings"]').click();
  const entry = type === 'agents' ? '[data-picker-agent]' : '[data-picker-apikey]';
  await page.locator(entry).click();
  await page.locator(`[data-connection-page="${type}"]`).waitFor();
}
