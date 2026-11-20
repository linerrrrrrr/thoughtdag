import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { testRegistrationGate } from './fixtures/design-registry-gate.mjs';
import { checkSettingsSpacing } from './check-settings-spacing.mjs';

await testRegistrationGate({
  name: 'settings-spacing',
  sourceFile: 'src/components/ui/WorkspaceSettings.css',
  marker: 'row-gap: var(--settings-space-row);',
  expected: /Missing registered CSS declaration: .*WorkspaceSettings\.css \| \.settings-route-controls/,
  check: checkSettingsSpacing,
  async extraBuildTest(fixture) {
    const file = path.join(fixture, 'src/design-system/settings-spacing.json');
    const original = await fs.readFile(file, 'utf8');
    const registry = JSON.parse(original);
    delete registry.pages.nodes;
    registry.roles.row.px = registry.roles.heading.px;
    registry.principles.forms.source = 'missing-source';
    await fs.writeFile(file, JSON.stringify(registry));
    const diagnostics = checkSettingsSpacing(fixture).join('\n');
    assert.match(diagnostics, /unregistered settings page nodes/);
    assert.match(diagnostics, /expected hint < heading < row < section/);
    assert.match(diagnostics, /incomplete upstream reference or adaptation for forms/);
    await fs.writeFile(file, original);
  },
});
