import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { testRegistrationGate } from './fixtures/design-registry-gate.mjs';
import { checkTypography } from './check-typography.mjs';

const dock = 'src/components/NodeInputRegion.tsx';
await testRegistrationGate({
  name: 'typography', sourceFile: dock, marker: 'data-type-surface="node-input"',
  expected: /NodeInputRegion\.tsx:\d+: [^\n]*node-input/, check: checkTypography,
  async extraBuildTest(fixture, rejectedBuild) {
    // The canvas still exposes the dock's unscaled text if both the marker
    // and the corresponding registry entry are missing.
    const file = path.join(fixture, 'src/design-system/typography-canvas.json');
    const original = await fs.readFile(file, 'utf8');
    const manifest = JSON.parse(original);
    delete manifest.boundaries[dock]['.node-input-content'];
    await fs.writeFile(file, JSON.stringify(manifest));
    const caller = 'src/components/ThoughtNode.tsx';
    const source = await fs.readFile(path.join(fixture, caller), 'utf8');
    const line = source.split('\n').findIndex(text => /<NodeInputRegion\b/.test(text)) + 1;
    const report = rejectedBuild();
    assert.ok(line && report.includes(caller + ':' + line + ': canvas-geometry contains text'), report);
    console.log('PASS omitting both the marker and its registry entry was detected at the dock call site');
    await fs.writeFile(file, original);
  },
});
