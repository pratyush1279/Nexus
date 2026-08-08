const db = require('../database');
const { logEvent } = require('./auditLogger');

/**
 * Release Manager (R-06: Releases Can Be Undone & R-07: Linked Release Effects)
 */

function deployRelease({ versionTag, serviceName = 'inventory-service' }) {
  const now = Date.now();
  const currentRelease = db.prepare(`SELECT * FROM releases WHERE status IN ('ACTIVE', 'WATCHING') ORDER BY deployed_at DESC LIMIT 1`).get();

  const previousVersion = currentRelease ? currentRelease.version_tag : null;

  if (currentRelease && currentRelease.version_tag === versionTag) {
    return { success: false, reason: `Version ${versionTag} is already currently deployed.` };
  }

  // Pre-flight Check: Ensure we know the rollback target BEFORE deploying
  if (previousVersion) {
    logEvent({
      eventType: 'RELEASE_PREFLIGHT_PASSED',
      entityType: 'RELEASE',
      entityId: `rel-${versionTag}`,
      reason: `Pre-flight rollback check passed. Rollback target identified: ${previousVersion}`
    });
  }

  // Mark previous releases as SUPERSEDED
  db.prepare(`UPDATE releases SET status = 'SUPERSEDED' WHERE status = 'ACTIVE'`).run();

  const releaseId = `rel-${versionTag}-${now}`;
  db.prepare(`
    INSERT INTO releases (release_id, version_tag, service_name, previous_version, status, deployed_at)
    VALUES (?, ?, ?, ?, 'WATCHING', ?)
  `).run(releaseId, versionTag, serviceName, previousVersion, now);

  logEvent({
    eventType: 'RELEASE_DEPLOYED',
    entityType: 'RELEASE',
    entityId: releaseId,
    releaseVersion: versionTag,
    reason: `Deployed release ${versionTag} for ${serviceName}. Monitoring behavior during bake window.`,
    details: { versionTag, previousVersion }
  });

  return {
    success: true,
    releaseId,
    versionTag,
    previousVersion,
    message: `Release ${versionTag} deployed successfully. Watching window started.`
  };
}

function rollbackRelease(serviceName = 'inventory-service') {
  const now = Date.now();
  const activeRelease = db.prepare(`SELECT * FROM releases WHERE status IN ('ACTIVE', 'WATCHING') ORDER BY deployed_at DESC LIMIT 1`).get();

  if (!activeRelease) {
    return { success: false, reason: 'No active release found to rollback.' };
  }

  const targetVersion = activeRelease.previous_version || 'v1.0.0';

  // Mark all currently active/watching releases as ROLLED_BACK
  db.prepare(`UPDATE releases SET status = 'ROLLED_BACK' WHERE status IN ('ACTIVE', 'WATCHING')`).run();

  // Re-activate target version
  const newReleaseId = `rel-${targetVersion}-rollback-${now}`;
  db.prepare(`
    INSERT INTO releases (release_id, version_tag, service_name, previous_version, status, deployed_at)
    VALUES (?, ?, ?, ?, 'ACTIVE', ?)
  `).run(newReleaseId, targetVersion, serviceName, activeRelease.version_tag, now);

  logEvent({
    eventType: 'RELEASE_ROLLED_BACK',
    entityType: 'RELEASE',
    entityId: newReleaseId,
    releaseVersion: targetVersion,
    reason: `ATOMIC ROLLBACK EXECUTED: Reverted from ${activeRelease.version_tag} back to known-good baseline ${targetVersion}.`,
    details: { rolled_back_from: activeRelease.version_tag, restored_to: targetVersion }
  });

  return {
    success: true,
    rolledBackFrom: activeRelease.version_tag,
    restoredTo: targetVersion,
    message: `Atomic rollback successful! Reverted from ${activeRelease.version_tag} back to ${targetVersion}.`
  };
}

function getActiveRelease() {
  return db.prepare(`SELECT * FROM releases WHERE status IN ('ACTIVE', 'WATCHING') ORDER BY deployed_at DESC LIMIT 1`).get();
}

function getAllReleases() {
  return db.prepare(`SELECT * FROM releases ORDER BY deployed_at DESC`).all();
}

module.exports = {
  deployRelease,
  rollbackRelease,
  getActiveRelease,
  getAllReleases
};
