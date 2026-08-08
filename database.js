const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'nexus.db');
const db = new Database(dbPath);

// Enable Write-Ahead Logging for concurrency & safety
db.pragma('journal_mode = WAL');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      job_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      status TEXT NOT NULL, -- QUEUED, PROCESSING, COMPLETED, QUARANTINED
      attempts INTEGER NOT NULL DEFAULT 0,
      assigned_worker TEXT,
      lease_expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workers (
      worker_id TEXT PRIMARY KEY,
      status TEXT NOT NULL, -- IDLE, BUSY, STALLED, TAKEN_OUT_OF_SERVICE
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      successful_jobs_since_reset INTEGER NOT NULL DEFAULT 0,
      last_heartbeat INTEGER NOT NULL,
      active_job_id TEXT
    );

    CREATE TABLE IF NOT EXISTS releases (
      release_id TEXT PRIMARY KEY,
      version_tag TEXT NOT NULL,
      service_name TEXT NOT NULL,
      previous_version TEXT,
      status TEXT NOT NULL, -- ACTIVE, WATCHING, ROLLED_BACK, SUPERSEDED
      deployed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      release_version TEXT,
      reason TEXT NOT NULL,
      details TEXT
    );
  `);

  // Ensure initial active release v1.0.0 exists if table is empty
  const releaseCount = db.prepare('SELECT COUNT(*) as count FROM releases').get().count;
  if (releaseCount === 0) {
    const now = Date.now();
    db.prepare(`
      INSERT INTO releases (release_id, version_tag, service_name, previous_version, status, deployed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('rel-initial', 'v1.0.0', 'inventory-service', null, 'ACTIVE', now);

    db.prepare(`
      INSERT INTO audit_events (timestamp, event_type, entity_type, entity_id, release_version, reason, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(now, 'RELEASE_DEPLOYED', 'RELEASE', 'rel-initial', 'v1.0.0', 'Initial baseline release v1.0.0 deployed.', JSON.stringify({ version: 'v1.0.0' }));
  }
}

initSchema();

module.exports = db;
