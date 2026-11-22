'use strict';
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

/** The storage lock serializes this connection with file migrations, document
 * updates and other local hosts. Close it after each operation so an inactive
 * library can be backed up or moved without an outstanding file handle. */
function openProjectDatabase(dataRoot) {
  const db = new DatabaseSync(path.join(dataRoot, 'thoughtdag.sqlite'));
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS library (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS records (
        space TEXT NOT NULL CHECK (space IN ('kv', 'settings')),
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (space, key)
      ) WITHOUT ROWID;
    `);
    const selectState = db.prepare('SELECT state FROM library WHERE id = 1');
    const saveState = db.prepare('INSERT OR REPLACE INTO library (id, state) VALUES (1, ?)');
    const get = db.prepare('SELECT CAST(value AS BLOB) AS bytes FROM records WHERE space = ? AND key = ?');
    const set = db.prepare('INSERT OR REPLACE INTO records (space, key, value) VALUES (?, ?, ?)');
    const del = db.prepare('DELETE FROM records WHERE space = ? AND key = ?');
    const keys = db.prepare('SELECT CAST(key AS BLOB) AS bytes FROM records WHERE space = ? ORDER BY key');
    const records = {
      get(space, key) {
        const row = get.get(space, key);
        return row ? Buffer.from(row.bytes).toString('utf8') : null;
      },
      set: (space, key, value) => set.run(space, key, value),
      delete: (space, key) => del.run(space, key),
      keys: space => keys.all(space).map(row => Buffer.from(row.bytes).toString('utf8')),
    };
    const readState = () => selectState.get()?.state ?? null;
    return {
      records,
      readState,
      saveState: state => saveState.run(JSON.stringify(state)),
      // An absent state row indicates a new database. The transaction publishes
      // the old namespace and its complete verified records together.
      async adopt(state, legacy) {
        if (readState() !== null) return;
        db.exec('BEGIN IMMEDIATE');
        try {
          if (db.prepare('SELECT 1 FROM records LIMIT 1').get()) throw new Error('Unidentified canvas database records');
          for (const space of ['kv', 'settings']) {
            for (const key of await legacy.keys(space)) {
              const value = await legacy.get(space, key);
              if (value === null) throw new Error('A legacy canvas record is missing');
              records.set(space, key, value);
              if (records.get(space, key) !== value) throw new Error('Canvas database migration verification failed');
            }
          }
          saveState.run(JSON.stringify(state));
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
      count: () => db.prepare('SELECT count(*) AS total FROM records').get().total,
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

module.exports = { openProjectDatabase };
