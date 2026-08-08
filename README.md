# NEXUS — Internal Reliability & Orchestration Platform MVP

NEXUS is an internal platform built to move background work reliably between services, carry releases safely, observe execution telemetry, cap worker crash loops, and reconstruct system incidents for on-call engineers.

This submission runs 100% locally on a single machine, requires no external cloud services or network dependencies, and survives platform restarts without losing accepted work.

---

## 🚀 START

To launch the NEXUS platform, stand-in worker pool, and Operator Dashboard:

```bash
npm start
```

Once started, NEXUS will be live at:
* **Operator Dashboard (Thing 03):** `http://localhost:3000`
* **SQLite Persistence (R-01):** `./nexus.db`

---

## 📦 USE

1. Open `http://localhost:3000` in your web browser.
2. Click **"➕ Enqueue Job"** or **"📦 Enqueue Batch (5 Jobs)"** in the Operator Controls panel.
3. Watch the background worker pool poll and process jobs.
4. Observe **Completed Jobs** count incrementing safely.

---

## 💥 BREAK (Reviewer Chaos Testing - Thing 04)

Reviewers can trigger failure modes on demand either via the **Operator Dashboard buttons** or using the **CLI tool**:

### 1. Test Retry Budget Ceiling & Crash Loop Quarantine (R-04 & R-02)
```bash
npm run chaos poison-pill
```
* **What Happens:** Injects a "poison pill" task and switches workers to crash mode. NEXUS retries 3 times with exponential backoff (1s → 2s → 4s), then caps retries and moves the job to `QUARANTINED` (DLQ) and marks the worker `TAKEN_OUT_OF_SERVICE`.

### 2. Test Idempotency & Duplicate Delivery (R-03)
```bash
npm run chaos duplicate
```
* **What Happens:** Resends an identical `jobId`. NEXUS detects duplicate entry in SQLite ledger, suppresses execution, and logs `DUPLICATE_SUPPRESSED` on the timeline.

### 3. Test Release-Timeline Correlation & 1-Click Rollback (R-06 & R-07)
```bash
npm run chaos bad-release
```
* **What Happens:** Deploys broken version `v1.2.0` and triggers crashes. On-call dashboard links the crash timeline to `v1.2.0`.
* **To Undo:** Click **"↩️ 1-Click Rollback"** on the dashboard or run:
```bash
npm run chaos rollback
```
* **What Happens:** Executes atomic 1-click rollback back to baseline `v1.0.0`, restoring worker stability.

### 4. Test Platform Survival Across Restarts (R-01 & R-05)
```bash
# Enqueue work, then stop NEXUS (Ctrl+C)
npm start
```
* **What Happens:** All accepted jobs, quarantine states, releases, and chronological audit history survive intact from `./nexus.db`.

---

## 👁️ LOOK (What to Notice in the 90-Second Operator View)

When you open `http://localhost:3000`:
1. **Top Banner (R-12 Diagnostic Headline):** If a worker is crash-looping, the header instantly turns RED and states:
   * *What is wrong:* Worker `worker-1` Taken OUT OF SERVICE (Crash-Loop Quarantined).
   * *When it started:* First symptom timestamp.
   * *What changed before:* Linked active release version (e.g., `v1.2.0`).
2. **Chronological Audit Timeline (R-05):** Right-hand panel displaying linked event feed of releases, dispatches, retries, and rollbacks.
3. **Worker Supervision Cards (R-04):** Shows worker health, consecutive failure counters, and `QUARANTINED` badges.
