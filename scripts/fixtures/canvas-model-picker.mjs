import assert from 'node:assert/strict';

export async function assertSettingsModal(page) {
  const dialog = page.getByRole('dialog').and(page.locator('[data-settings-panel]'));
  await dialog.waitFor();
  assert.equal(await dialog.getAttribute('aria-modal'), 'true');
  const { x, y, width, height } = await dialog.boundingBox();
  const viewport = page.viewportSize();
  const scale = await dialog.evaluate(el => Number(getComputedStyle(el).getPropertyValue('--ui-scale')));
  const maxWidth = 1216 * scale;
  const maxHeight = 1260 * scale;
  const horizontalInsets = 2 * 32 * scale;
  const verticalInsets = 2 * 20 * scale;
  assert.ok(width >= Math.min(viewport.width - horizontalInsets, maxWidth) - 1 && width <= maxWidth + 1,
    `Settings fit the available width up to ${maxWidth}px: ${width}px in a ${viewport.width}px viewport`);
  assert.ok(height >= Math.min(viewport.height - verticalInsets, maxHeight) - 1 && height <= maxHeight + 1,
    `Settings fit the available height up to ${maxHeight}px: ${height}px in a ${viewport.height}px viewport`);
  assert.ok(x >= 4 && y >= 4, 'Settings keep visible outer margins');
  assert.ok(Math.abs(viewport.width - width - 2 * x) <= 2 && Math.abs(viewport.height - height - 2 * y) <= 2,
    'Settings stay centered on both viewport axes');
  return dialog;
}

export async function clickSettingsBackdrop(page) {
  const dialog = page.locator('[data-settings-panel]');
  const { x, y, height } = await dialog.boundingBox();
  await page.mouse.click(x / 2, y + height / 2);
  await dialog.waitFor({ state: 'detached' });
}

export async function openSettingsSection(page, section) {
  const settings = page.locator('[data-settings-panel]');
  if (!await settings.isVisible()) await page.locator('[data-settings-entry]').click();
  await settings.waitFor();
  const select = settings.locator('[data-settings-select]');
  if (await select.isVisible()) await select.selectOption(section);
  else await settings.locator(`[data-settings-section="${section}"]`).click();
}

export async function openModelConnection(page, type) {
  await openSettingsSection(page, type === 'agents' ? 'agents' : 'providers');
  await page.locator(`[data-connection-page="${type}"]`).waitFor();
}
