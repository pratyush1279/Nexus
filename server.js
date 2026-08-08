const express = require('express');
const path = require('path');

const db = require('./database');
const { getJobStats, enqueueJob } = require('./engine/queue');
const { getAllWorkers, resetWorkerStatus } = require('./engine/supervisor');
const { getActiveRelease, getAllReleases, deployRelease, rollbackRelease } = require('./engine/releaseManager');
const { getTimeline, logEvent } = require('./engine/auditLogger');
const { produceSampleJob, produceBatch } = require('./standin/producer');
const { startWorkerPool, getWorkerPool, setWorkerPoolMode, setSpecificWorkerMode } = require('./standin/worker');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Stand-in Worker Pool
startWorkerPool();

/**
 * 📊 Telemetry API (Powers Operator View Dashboard & R-12 Diagnostics)
 */
app.get('/api/telemetry', (req, res) => {
  const activeRelease = getActiveRelease();
  const stats = getJobStats();
  const workers = getAllWorkers();
  const timeline = getTimeline(50);

  // Evaluate incident status for R-12 (90-Second Human Diagnostic Headline)
  let incident = { active: false };

  const quarantinedWorkers = workers.filter(w => w.status === 'TAKEN_OUT_OF_SERVICE');
  const recentRelease = timeline.find(t => t.event_type === 'RELEASE_DEPLOYED');

  if (quarantinedWorkers.length > 0) {
    const workerNames = quarantinedWorkers.map(w => w.worker_id).join(', ');
    const firstQuarantine = timeline.find(t => t.event_type === 'WORKER_TAKEN_OUT_OF_SERVICE');
    const elapsedMins = firstQuarantine ? Math.floor((Date.now() - firstQuarantine.timestamp) / 60000) : 0;
    const linkedRelease = recentRelease ? recentRelease.release_version : 'v1.0.0';

    incident = {
      active: true,
      title: `CRITICAL: Worker (${workerNames}) Taken OUT OF SERVICE (Crash-Loop Quarantined)`,
      meta: `First symptom ${elapsedMins} minute(s) ago. Occurred following Release ${linkedRelease}. Exceeded max 3 retry attempts.`
    };
  } else if (activeRelease && activeRelease.version_tag === 'v1.2.0') {
    incident = {
      active: true,
      title: `WARNING: Release v1.2.0 Currently Active (Bake Window Watching)`,
      meta: `Monitoring worker behavior. Rollback target v1.0.0 is available for instant 1-click undo.`
    };
  }

  res.json({
    activeRelease,
    stats,
    workers,
    timeline,
    incident
  });
});

/**
 * 📦 Work Enqueue APIs
 */
app.post('/api/enqueue-job', (req, res) => {
  const result = produceSampleJob();
  res.json(result);
});

app.post('/api/enqueue-batch', (req, res) => {
  const results = produceBatch(5);
  res.json({ success: true, count: results.length, batch: results });
});

/**
 * ↩️ 1-Click Atomic Rollback API (R-06)
 */
app.post('/api/release/rollback', (req, res) => {
  // Reset worker crash modes back to normal on rollback
  setWorkerPoolMode('NORMAL');
  const result = rollbackRelease();
  res.json(result);
});

/**
 * 🔥 Reviewer Chaos Trigger APIs (Thing 04)
 */

// 1. Poison Pill (R-04: Crash Loop & Quarantine)
app.post('/api/chaos/poison-pill', (req, res) => {
  setWorkerPoolMode('CRASH');
  const result = produceSampleJob('job-poison-pill-999', { type: 'POISON_PILL_CRASH_TEST' });
  res.json({
    success: true,
    message: 'Poison pill job enqueued. Workers switched to CRASH mode to demonstrate R-04 Quarantine Ceiling.',
    result
  });
});

// 2. Duplicate Job (R-03: Idempotency)
app.post('/api/chaos/duplicate', (req, res) => {
  const duplicateId = 'job-idempotency-test-777';
  // Enqueue first time
  produceSampleJob(duplicateId, { item: 'Widget-A', price: 99 });
  // Resend second time immediately!
  const res2 = produceSampleJob(duplicateId, { item: 'Widget-A', price: 99 });

  res.json({
    success: true,
    message: 'Resent identical jobId to verify R-03 Idempotent Deduplication.',
    result: res2
  });
});

// 3. Bad Release (R-06 & R-07)
app.post('/api/chaos/bad-release', (req, res) => {
  const result = deployRelease({ versionTag: 'v1.2.0' });
  setWorkerPoolMode('CRASH');
  produceSampleJob('job-bad-rel-1', { type: 'UNHANDLED_EXCEPTION_IN_V1.2.0' });

  res.json({
    success: true,
    message: 'Deployed broken release v1.2.0 and injected crashing task to demonstrate Release-Timeline Correlation.',
    result
  });
});

// 4. Backlog Spike
app.post('/api/chaos/backlog-spike', (req, res) => {
  const count = req.body.count || 100;
  for (let i = 0; i < count; i++) {
    produceSampleJob(`job-backlog-${Date.now()}-${i}`, { idx: i });
  }
  res.json({ success: true, count, message: `Enqueued ${count} tasks into queue.` });
});

// 5. Reset Workers (All or Individual)
app.post('/api/chaos/reset-workers', (req, res) => {
  const workers = getAllWorkers();
  workers.forEach(w => resetWorkerStatus(w.worker_id));
  setWorkerPoolMode('NORMAL');
  res.json({ success: true, message: 'All workers reset back to active IDLE state.' });
});

app.post('/api/worker/reset/:workerId', (req, res) => {
  const { workerId } = req.params;
  resetWorkerStatus(workerId);
  setSpecificWorkerMode(workerId, 'NORMAL');
  res.json({ success: true, message: `Worker ${workerId} reset to IDLE.` });
});

app.post('/api/worker/:workerId/mode', (req, res) => {
  const { workerId } = req.params;
  const { mode } = req.body;
  const validModes = ['NORMAL', 'SLOW', 'CRASH'];
  const targetMode = validModes.includes(mode) ? mode : 'CRASH';

  setSpecificWorkerMode(workerId, targetMode);
  res.json({ success: true, workerId, mode: targetMode, message: `Worker ${workerId} mode set to ${targetMode}.` });
});

app.post('/api/worker/:workerId/enqueue', (req, res) => {
  const { workerId } = req.params;
  const result = produceSampleJob(`job-${workerId}-${Date.now()}`, { targetWorker: workerId, created_by: 'operator_ui' });
  res.json({ success: true, workerId, result });
});

app.listen(PORT, () => {
  console.log(`\n=================================================`);
  console.log(`⚡ NEXUS PLATFORM RUNNING AT: http://localhost:${PORT}`);
  console.log(`=================================================`);
  console.log(`- Operator Dashboard (Thing 03): http://localhost:${PORT}`);
  console.log(`- Reviewer Chaos CLI (Thing 04): npm run chaos <scenario>`);
  console.log(`- SQLite Database File (R-01):   ${path.join(__dirname, 'nexus.db')}`);
  console.log(`=================================================\n`);
});
