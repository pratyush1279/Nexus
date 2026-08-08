const db = require('../database');
const { logEvent } = require('./auditLogger');
const { quarantineJob } = require('./queue');

/**
 * Worker Supervisor Engine (R-04: Retrying Has a Limit & Floor on Failure)
 */

const MAX_RETRY_ATTEMPTS = 3;
const REQUIRED_SUCCESSES_FOR_RECOVERY = 3; // Settling period rule!

function registerWorker(workerId) {
  const now = Date.now();
  const existing = db.prepare('SELECT * FROM workers WHERE worker_id = ?').get(workerId);

  if (!existing) {
    db.prepare(`
      INSERT INTO workers (worker_id, status, consecutive_failures, successful_jobs_since_reset, last_heartbeat)
      VALUES (?, 'IDLE', 0, 0, ?)
    `).run(workerId, now);

    logEvent({
      eventType: 'WORKER_REGISTERED',
      entityType: 'WORKER',
      entityId: workerId,
      reason: `Worker ${workerId} registered with supervisor.`
    });
  } else {
    db.prepare(`
      UPDATE workers
      SET last_heartbeat = ?
      WHERE worker_id = ?
    `).run(now, workerId);
  }
}

function recordWorkerHeartbeat(workerId, activeJobId = null) {
  const now = Date.now();
  registerWorker(workerId);
  db.prepare(`
    UPDATE workers
    SET last_heartbeat = ?, active_job_id = ?
    WHERE worker_id = ?
  `).run(now, activeJobId, workerId);
}

function recordWorkerSuccess(workerId) {
  const now = Date.now();
  const worker = db.prepare('SELECT * FROM workers WHERE worker_id = ?').get(workerId);

  if (!worker) return;

  const newSuccessCount = worker.successful_jobs_since_reset + 1;
  let newFailures = worker.consecutive_failures;
  let newStatus = worker.status === 'TAKEN_OUT_OF_SERVICE' ? 'TAKEN_OUT_OF_SERVICE' : 'IDLE';

  // EARNING RECOVERY: Only reset failure counter after settling period of 3 successful jobs!
  if (newSuccessCount >= REQUIRED_SUCCESSES_FOR_RECOVERY && newFailures > 0) {
    newFailures = 0;
    newStatus = 'IDLE';
    logEvent({
      eventType: 'WORKER_RECOVERED',
      entityType: 'WORKER',
      entityId: workerId,
      reason: `Worker ${workerId} earned RECOVERED status after completing ${REQUIRED_SUCCESSES_FOR_RECOVERY} consecutive jobs cleanly.`
    });
  }

  db.prepare(`
    UPDATE workers
    SET consecutive_failures = ?,
        successful_jobs_since_reset = ?,
        status = ?,
        active_job_id = NULL,
        last_heartbeat = ?
    WHERE worker_id = ?
  `).run(newFailures, newSuccessCount, newStatus, now, workerId);
}

function recordWorkerFailure(workerId, jobId, errorReason) {
  const now = Date.now();
  const worker = db.prepare('SELECT * FROM workers WHERE worker_id = ?').get(workerId);
  const job = db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId);

  const currentFailures = worker ? worker.consecutive_failures + 1 : 1;
  const jobAttempts = job ? job.attempts : 1;

  logEvent({
    eventType: 'WORKER_FAILED_ATTEMPT',
    entityType: 'WORKER',
    entityId: workerId,
    reason: `Worker ${workerId} failed job ${jobId} (Worker Failures: ${currentFailures}/${MAX_RETRY_ATTEMPTS}, Job Attempt: ${jobAttempts}/${MAX_RETRY_ATTEMPTS}). Error: ${errorReason}`,
    details: { workerId, jobId, currentFailures, jobAttempts, errorReason }
  });

  // Calculate exponential backoff space-out delay
  const backoffMs = Math.pow(2, jobAttempts - 1) * 1000;

  if (jobAttempts >= MAX_RETRY_ATTEMPTS || currentFailures >= MAX_RETRY_ATTEMPTS) {
    // Failure has a floor! Cap retries & Quarantine both job and worker!
    quarantineJob(jobId, `Exceeded maximum attempt ceiling (${MAX_RETRY_ATTEMPTS}). Error: ${errorReason}`);

    db.prepare(`
      UPDATE workers
      SET status = 'TAKEN_OUT_OF_SERVICE',
          consecutive_failures = ?,
          successful_jobs_since_reset = 0,
          active_job_id = NULL,
          last_heartbeat = ?
      WHERE worker_id = ?
    `).run(currentFailures, now, workerId);

    logEvent({
      eventType: 'WORKER_TAKEN_OUT_OF_SERVICE',
      entityType: 'WORKER',
      entityId: workerId,
      reason: `Worker ${workerId} taken OUT OF SERVICE after ${currentFailures} consecutive crash-loop attempts.`,
      details: { consecutive_failures: currentFailures }
    });
  } else {
    // Schedule backoff retry: set job status back to QUEUED with exponential backoff lease delay
    const leaseTime = now + backoffMs;
    db.prepare(`
      UPDATE jobs
      SET status = 'QUEUED',
          lease_expires_at = ?,
          updated_at = ?
      WHERE job_id = ?
    `).run(leaseTime, now, jobId);

    db.prepare(`
      UPDATE workers
      SET consecutive_failures = ?,
          successful_jobs_since_reset = 0,
          status = 'IDLE',
          active_job_id = NULL,
          last_heartbeat = ?
      WHERE worker_id = ?
    `).run(currentFailures, now, workerId);
  }
}

function resetWorkerStatus(workerId) {
  const now = Date.now();
  db.prepare(`
    UPDATE workers
    SET status = 'IDLE',
        consecutive_failures = 0,
        successful_jobs_since_reset = 0,
        last_heartbeat = ?
    WHERE worker_id = ?
  `).run(now, workerId);

  logEvent({
    eventType: 'WORKER_MANUAL_RESET',
    entityType: 'WORKER',
    entityId: workerId,
    reason: `Worker ${workerId} manually reset and restored to service by operator.`
  });
}

function getAllWorkers() {
  return db.prepare('SELECT * FROM workers').all();
}

module.exports = {
  registerWorker,
  recordWorkerHeartbeat,
  recordWorkerSuccess,
  recordWorkerFailure,
  resetWorkerStatus,
  getAllWorkers,
  MAX_RETRY_ATTEMPTS
};
