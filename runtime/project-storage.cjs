'use strict';
const path = require('node:path');

// A source checkout owns its canvas library. Explicitly configured legacy
// installations and browser-only deployments keep their existing behavior.
function projectStorage(projectRoot, env, defaultEnabled = true) {
  const mode = env.THOUGHTDAG_DISK_STORAGE;
  if (mode === undefined ? !defaultEnabled : mode !== '1') return null;
  const projectHome = path.join(projectRoot, 'local-data', 'data');
  const dataRoot = env.THOUGHTDAG_HOME ?? projectHome;
  if (!path.isAbsolute(dataRoot)) throw new Error('An absolute THOUGHTDAG_HOME is required');
  return { dataRoot, database: path.relative(projectHome, dataRoot) === '' };
}

module.exports = { projectStorage };
