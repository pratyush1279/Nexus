const db = require('../database');
const { logEvent } = require('./auditLogger');

/**
 * Queue Engine (R-01: Safe Work, R-02: Explicit Terminal States, R-03: Harmless Duplicate Delivery)
 */

function enqueueJob({ jobId, payload }) {
  const now = Date.now();
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

  // Check R-03 Idempotency: Does jobId already exist?
  const existing = db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId);

  if (existing) {
    // Duplicate delivery detected!
    logEvent({
      eventType: 'DUPLICATE_SUPPRESSED',
      entityType: 'JOB',
      entityId: jobId,
      reason: `Duplicate job delivery suppressed. Existing job status: ${existing.status}`,
      details: { status: existing.status, original_created_at: existing.created_at }
    });

    return {
      success: true,
      duplicate: true,
      job: existing,
      message: `Job ${jobId} already accepted previously. Duplicate delivery suppressed.`
    };
  }

  // R-01: Persist work BEFORE acknowledging success
  const stmt = db.prepare(`
    INSERT INTO jobs (job_id, payload, status, attempts, created_at, updated_at)
    VALUES (?, ?, 'QUEUED', 0, ?, ?)
  `);

  stmt.run(jobId, payloadStr, now, now);

  logEvent({
    eventType: 'JOB_ENQUEUED',
    entityType: 'JOB',
    entityId: jobId,
    reason: 'Job accepted and persisted safely to queue.',
    details: { payload }
  });

  const createdJob = db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId);

  return {
    success: true,
    duplicate: false,
    job: createdJob,
    message: `Job ${jobId} enqueued safely.`
  };
}

function getNextJobForWorker(workerId, leaseDurationMs = 10000) {
  const now = Date.now();

  // Find job that is QUEUED (and backoff delay passed) OR whose lease has expired while in PROCESSING
  const job = db.prepare(`
    SELECT * FROM jobs
    WHERE (status = 'QUEUED' AND (lease_expires_at IS NULL OR lease_expires_at <= ?))
       OR (status = 'PROCESSING' AND lease_expires_at < ?)
    ORDER BY created_at ASC
    LIMIT 1
  `).get(now, now);

  if (!job) return null;

  const newAttempts = job.attempts + 1;
  const leaseExpiresAt = now + leaseDurationMs;

  db.prepare(`
    UPDATE jobs
    SET status = 'PROCESSING',
        attempts = ?,
        assigned_worker = ?,
        lease_expires_at = ?,
        updated_at = ?
    WHERE job_id = ?
  `).run(newAttempts, workerId, leaseExpiresAt, now, job.job_id);

  logEvent({
    eventType: job.attempts > 0 ? 'JOB_RETRY_DISPATCHED' : 'JOB_DISPATCHED',
    entityType: 'JOB',
    entityId: job.job_id,
    reason: `Dispatched to worker ${workerId} (Attempt ${newAttempts})`,
    details: { workerId, attempt: newAttempts, is_retry: job.attempts > 0 }
  });

  return db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(job.job_id);
}

function completeJob(jobId, workerId, result = {}) {
  const now = Date.now();
  const job = db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId);

  if (!job) return { success: false, reason: 'Job not found' };

  if (job.status === 'COMPLETED') {
    logEvent({
      eventType: 'STALE_ACK_RECEIVED',
      entityType: 'JOB',
      entityId: jobId,
      reason: `Stale ACK received from worker ${workerId} for job already marked COMPLETED.`,
      details: { workerId }
    });
    return { success: true, duplicate: true };
  }

  db.prepare(`
    UPDATE jobs
    SET status = 'COMPLETED',
        updated_at = ?
    WHERE job_id = ?
  `).run(now, jobId);

  logEvent({
    eventType: 'JOB_COMPLETED',
    entityType: 'JOB',
    entityId: jobId,
    reason: `Job successfully completed by worker ${workerId}.`,
    details: { workerId, attempts: job.attempts, result }
  });

  return { success: true, duplicate: false };
}

function quarantineJob(jobId, reason) {
  const now = Date.now();
  db.prepare(`
    UPDATE jobs
    SET status = 'QUARANTINED',
        updated_at = ?
    WHERE job_id = ?
  `).run(now, jobId);

  logEvent({
    eventType: 'JOB_QUARANTINED',
    entityType: 'JOB',
    entityId: jobId,
    reason: `Job moved to DLQ Quarantine: ${reason}`,
    details: { reason }
  });
}

function getJobStats() {
  const total = db.prepare('SELECT COUNT(*) as count FROM jobs').get().count;
  const queued = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'QUEUED'").get().count;
  const processing = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'PROCESSING'").get().count;
  const completed = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'COMPLETED'").get().count;
  const quarantined = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'QUARANTINED'").get().count;
  
  const oldestQueued = db.prepare("SELECT created_at FROM jobs WHERE status = 'QUEUED' ORDER BY created_at ASC LIMIT 1").get();
  const oldestAgeSec = oldestQueued ? Math.floor((Date.now() - oldestQueued.created_at) / 1000) : 0;

  return { total, queued, processing, completed, quarantined, oldestAgeSec };
}

module.exports = {
  enqueueJob,
  getNextJobForWorker,
  completeJob,
  quarantineJob,
  getJobStats
};
