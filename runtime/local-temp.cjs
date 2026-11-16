'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Keep app-created temporary files alongside the configured local data. */
function thoughtdagTempRoot() {
  if (process.env.THOUGHTDAG_DISK_STORAGE !== '1') return os.tmpdir();
  const home = process.env.THOUGHTDAG_HOME;
  if (!home || !path.isAbsolute(home)) throw new Error('An absolute THOUGHTDAG_HOME is required');
  const dir = path.join(home, 'tmp');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

module.exports = { thoughtdagTempRoot };
