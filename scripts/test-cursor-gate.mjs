import { testRegistrationGate } from './fixtures/design-registry-gate.mjs';
import { checkCursors } from './check-cursors.mjs';

await testRegistrationGate({
  name: 'cursor', sourceFile: 'src/components/ui/CondenseDialog.tsx',
  marker: "data-cursor={dragging ? 'dragging' : 'draggable'}",
  expected: /CondenseDialog\.tsx:\d+: [^\n]*cursor/i, check: checkCursors,
});
