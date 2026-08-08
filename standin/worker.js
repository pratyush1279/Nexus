const { getNextJobForWorker, completeJob } = require('../engine/queue');
const { recordWorkerHeartbeat, recordWorkerSuccess, recordWorkerFailure } = require('../engine/supervisor');
const db = require('../database');

/**
 * Stand-in Worker Process (Thing 02)
 */

class StandinWorker {
  constructor(workerId = 'worker-1') {
    this.workerId = workerId;
    this.mode = 'NORMAL'; // NORMAL, SLOW, CRASH
    this.isRunning = false;
    this.timer = null;
  }

  setMode(mode) {
    this.mode = mode;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    this.timer = setInterval(() => {
      this.tick();
    }, 2000);
  }

  stop() {
    this.isRunning = false;
    if (this.timer) clearInterval(this.timer);
  }

  tick() {
    // Check if worker has been TAKEN_OUT_OF_SERVICE by supervisor
    const workerRecord = db.prepare('SELECT status FROM workers WHERE worker_id = ?').get(this.workerId);
    if (workerRecord && workerRecord.status === 'TAKEN_OUT_OF_SERVICE') {
      return; // Do not fetch or process work if quarantined!
    }

    recordWorkerHeartbeat(this.workerId);

    const job = getNextJobForWorker(this.workerId);
    if (!job) return;

    recordWorkerHeartbeat(this.workerId, job.job_id);

    // Check for simulated failure mode or poison pill payload
    const isPoisonPill = job.payload.includes('POISON_PILL') || job.payload.includes('CRASH');

    if (this.mode === 'CRASH' || isPoisonPill) {
      // Simulate crash!
      recordWorkerFailure(this.workerId, job.job_id, 'Simulated worker crash / Unhandled exception in task handler');
      return;
    }

    if (this.mode === 'SLOW') {
      // Simulate slow execution exceeding lease time
      setTimeout(() => {
        completeJob(job.job_id, this.workerId, { status: 'processed_slowly' });
        recordWorkerSuccess(this.workerId);
      }, 12000);
      return;
    }

    // NORMAL MODE: Process job cleanly
    completeJob(job.job_id, this.workerId, { status: 'processed_successfully' });
    recordWorkerSuccess(this.workerId);
  }
}

// Module singleton workers
const workerPool = [
  new StandinWorker('worker-1'),
  new StandinWorker('worker-2'),
  new StandinWorker('worker-3')
];

function startWorkerPool() {
  workerPool.forEach(w => w.start());
}

function setWorkerPoolMode(mode) {
  workerPool.forEach(w => w.setMode(mode));
}

function getWorkerPool() {
  return workerPool;
}

module.exports = {
  StandinWorker,
  workerPool,
  startWorkerPool,
  setWorkerPoolMode,
  getWorkerPool
};
