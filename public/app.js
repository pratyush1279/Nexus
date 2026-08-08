/**
 * NEXUS Operator Dashboard Client App (R-12: 90-Second Diagnostic Visibility)
 */

async function fetchTelemetry() {
  try {
    const res = await fetch('/api/telemetry');
    const data = await res.json();
    renderDashboard(data);
  } catch (err) {
    console.error('Failed to fetch telemetry:', err);
    renderOfflineStatus();
  }
}

function renderDashboard(data) {
  const { activeRelease, stats, workers, timeline, incident } = data;

  // 1. System Health Status Indicator
  const statusIndicator = document.getElementById('system-status-indicator');
  if (incident && incident.active) {
    statusIndicator.innerHTML = `
      <span class="pulse-dot red"></span>
      <span class="status-text" style="color: var(--accent-red)">INCIDENT ACTIVE</span>
    `;
  } else {
    statusIndicator.innerHTML = `
      <span class="pulse-dot green"></span>
      <span class="status-text" style="color: var(--accent-green)">SYSTEM HEALTHY</span>
    `;
  }

  // 2. R-12 Diagnostic Banner
  const banner = document.getElementById('diagnostic-banner');
  const bannerBadge = document.getElementById('banner-severity');
  const bannerTitle = document.getElementById('banner-title');
  const bannerMeta = document.getElementById('banner-meta');
  const bannerActions = document.getElementById('banner-actions');

  if (incident && incident.active) {
    banner.classList.add('critical');
    bannerBadge.textContent = 'CRITICAL INCIDENT';
    bannerTitle.textContent = incident.title;
    bannerMeta.textContent = incident.meta;
    bannerActions.innerHTML = `
      <button class="btn btn-rollback" onclick="triggerAction('/api/release/rollback')">
        ↩️ 1-Click Rollback to Baseline
      </button>
    `;
  } else {
    banner.classList.remove('critical');
    bannerBadge.textContent = 'SYSTEM NORMAL';
    bannerTitle.textContent = 'All Platform Operations Running Within Parameters';
    bannerMeta.textContent = `Active Version: ${activeRelease ? activeRelease.version_tag : 'v1.0.0'} | Queue: ${stats.queued} waiting | Quarantined: ${stats.quarantined}`;
    bannerActions.innerHTML = '';
  }

  // 3. Metrics
  document.getElementById('metric-active-release').textContent = activeRelease ? activeRelease.version_tag : 'v1.0.0';
  document.getElementById('metric-release-status').textContent = `Status: ${activeRelease ? activeRelease.status : 'ACTIVE'}`;

  document.getElementById('metric-queue-depth').textContent = stats.queued;
  document.getElementById('metric-oldest-age').textContent = `Oldest: ${stats.oldestAgeSec}s`;

  document.getElementById('metric-completed').textContent = stats.completed;
  document.getElementById('metric-quarantined').textContent = stats.quarantined;

  // 4. Workers Pool (3 Workers: worker-1, worker-2, worker-3)
  const workerContainer = document.getElementById('worker-list-container');
  document.getElementById('worker-count-badge').textContent = `${workers.length} Active Workers`;

  workerContainer.innerHTML = workers.map(w => {
    const isQuarantined = w.status === 'TAKEN_OUT_OF_SERVICE';
    const statusClass = isQuarantined ? 'quarantined' : (w.status === 'BUSY' ? 'busy' : 'idle');
    const statusLabel = isQuarantined ? 'QUARANTINED' : w.status;
    const activeJobText = w.active_job_id ? `Processing: <strong>${w.active_job_id}</strong>` : 'No Active Job';

    return `
      <div class="worker-card ${isQuarantined ? 'quarantined' : ''}">
        <div class="worker-info">
          <div class="worker-title-row">
            <span class="worker-name">⚙️ ${w.worker_id}</span>
            <span class="status-tag ${statusClass}">${statusLabel}</span>
          </div>
          <div class="worker-job-assignment">${activeJobText}</div>
          <div class="worker-details">Failures: ${w.consecutive_failures}/3 | Recovery: ${w.successful_jobs_since_reset}/3</div>
          <div class="worker-toolbar">
            <button class="btn-xs btn-primary-xs" onclick="triggerAction('/api/worker/${w.worker_id}/enqueue')">➕ Send Work</button>
            <button class="btn-xs btn-danger-xs" onclick="triggerWorkerMode('${w.worker_id}', 'CRASH')">💥 Crash Mode</button>
            <button class="btn-xs btn-warning-xs" onclick="triggerWorkerMode('${w.worker_id}', 'SLOW')">⏱️ Slow Mode</button>
            <button class="btn-xs btn-outline-xs" onclick="triggerAction('/api/worker/reset/${w.worker_id}')">🔧 Reset</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // 5. Timeline (R-05 & R-07: Incident Reconstruction)
  const timelineContainer = document.getElementById('timeline-container');
  timelineContainer.innerHTML = timeline.map(item => {
    const timeStr = new Date(item.timestamp).toLocaleTimeString();

    let detailsObj = {};
    try {
      if (item.details) detailsObj = typeof item.details === 'string' ? JSON.parse(item.details) : item.details;
    } catch (e) {}

    let resultState = item.event_type;
    if (item.event_type === 'JOB_ENQUEUED') resultState = 'QUEUED';
    else if (item.event_type === 'JOB_DISPATCHED') resultState = `PROCESSING (Attempt ${detailsObj.attempt || 1})`;
    else if (item.event_type === 'JOB_RETRY_DISPATCHED') resultState = `RETRYING (Attempt ${detailsObj.attempt || 1})`;
    else if (item.event_type === 'JOB_COMPLETED') resultState = 'COMPLETED';
    else if (item.event_type === 'JOB_QUARANTINED') resultState = 'QUARANTINED (DLQ)';
    else if (item.event_type === 'WORKER_TAKEN_OUT_OF_SERVICE') resultState = 'OUT_OF_SERVICE';
    else if (item.event_type === 'DUPLICATE_SUPPRESSED') resultState = 'DUPLICATE_SUPPRESSED';
    else if (item.event_type === 'RELEASE_DEPLOYED') resultState = 'WATCHING';
    else if (item.event_type === 'RELEASE_ROLLED_BACK') resultState = 'ROLLED_BACK';

    return `
      <div class="timeline-item ${item.event_type}">
        <div class="timeline-header">
          <span class="timeline-title">${item.event_type}</span>
          <span class="timeline-time">${timeStr}</span>
        </div>
        <div class="timeline-reason">${item.reason}</div>
        <div class="timeline-footer">
          <span class="timeline-entity">Entity: <strong>${item.entity_type}</strong> (${item.entity_id})</span>
          <span class="timeline-state">State: <strong>${resultState}</strong></span>
          <span class="timeline-version">Release: <strong>${item.release_version || 'v1.0.0'}</strong></span>
        </div>
      </div>
    `;
  }).join('');
}

function renderOfflineStatus() {
  const banner = document.getElementById('diagnostic-banner');
  banner.classList.add('critical');
  document.getElementById('banner-severity').textContent = 'PLATFORM UNREACHABLE';
  document.getElementById('banner-title').textContent = '⚠️ Telemetry Stream Interrupted — Platform Connection Lost';
  document.getElementById('banner-meta').textContent = 'Check if NEXUS server process is running on localhost:3000.';
}

async function triggerAction(endpoint) {
  try {
    const res = await fetch(endpoint, { method: 'POST' });
    if (!res.ok) {
      // Fallback for older server processes: if per-worker endpoint is 404, fallback to reset-workers
      if (res.status === 404 && endpoint.startsWith('/api/worker/reset/')) {
        return triggerAction('/api/chaos/reset-workers');
      }
      throw new Error(`Server returned status ${res.status}`);
    }
    const data = await res.json();
    console.log('Action result:', data);
    fetchTelemetry();
  } catch (err) {
    console.warn('Action attempt error:', err.message);
    fetchTelemetry();
  }
}

async function triggerWorkerMode(workerId, mode) {
  try {
    const res = await fetch(`/api/worker/${workerId}/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
    const data = await res.json();
    console.log('Worker mode change:', data);
    fetchTelemetry();
  } catch (err) {
    console.warn('Worker mode change error:', err);
    fetchTelemetry();
  }
}

// Poll telemetry every 1.5 seconds
setInterval(fetchTelemetry, 1500);
fetchTelemetry();
