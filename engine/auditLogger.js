const db = require('../database');

/**
 * Audit Logger (R-05: The past can be reconstructed & R-07: Changes linked to what followed)
 */

function getActiveReleaseVersion() {
  const activeRelease = db.prepare(`SELECT version_tag FROM releases WHERE status IN ('ACTIVE', 'WATCHING') ORDER BY deployed_at DESC LIMIT 1`).get();
  return activeRelease ? activeRelease.version_tag : 'v1.0.0';
}

function logEvent({ eventType, entityType, entityId, reason, details = {}, releaseVersion = null }) {
  const now = Date.now();
  const version = releaseVersion || getActiveReleaseVersion();
  const detailsStr = typeof details === 'string' ? details : JSON.stringify(details);

  const stmt = db.prepare(`
    INSERT INTO audit_events (timestamp, event_type, entity_type, entity_id, release_version, reason, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(now, eventType, entityType, entityId, version, reason, detailsStr);
}

function getTimeline(limit = 100) {
  return db.prepare(`
    SELECT * FROM audit_events ORDER BY id DESC LIMIT ?
  `).all(limit);
}

module.exports = {
  logEvent,
  getTimeline,
  getActiveReleaseVersion
};
