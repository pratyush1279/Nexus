const http = require('http');

/**
 * Reviewer Chaos Trigger CLI (Thing 04)
 * Allows reviewers to trigger failure scenarios on demand.
 */

const SERVER_URL = process.env.NEXUS_URL || 'http://localhost:3000';

const args = process.argv.slice(2);
const chaosType = args[0] || 'help';

async function sendChaosRequest(endpoint, payload = {}) {
  const url = `${SERVER_URL}${endpoint}`;
  const data = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ raw: body });
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function runChaos() {
  console.log(`\n=================================================`);
  console.log(`🔥 NEXUS CHAOS TRIGGER CLI (Thing 04)`);
  console.log(`=================================================\n`);

  try {
    switch (chaosType) {
      case 'poison-pill':
        console.log(`💣 Injecting POISON PILL job (Triggers Worker Crash Loop & Quarantine)...`);
        const res1 = await sendChaosRequest('/api/chaos/poison-pill');
        console.log(`Result:`, res1);
        console.log(`\n👉 Watch the Operator Dashboard at http://localhost:3000 for R-04 Quarantine alert!`);
        break;

      case 'duplicate':
        console.log(`🔄 Injecting DUPLICATE JOB (Triggers R-03 Idempotency Deduplication)...`);
        const res2 = await sendChaosRequest('/api/chaos/duplicate');
        console.log(`Result:`, res2);
        console.log(`\n👉 Check audit timeline for DUPLICATE_SUPPRESSED event!`);
        break;

      case 'bad-release':
        console.log(`🚀 Deploying BROKEN RELEASE v1.2.0 (Triggers Release-Timeline Correlation)...`);
        const res3 = await sendChaosRequest('/api/chaos/bad-release');
        console.log(`Result:`, res3);
        console.log(`\n👉 Check Operator Dashboard to see active release v1.2.0 linked to errors!`);
        break;

      case 'rollback':
        console.log(`↩️ Triggering 1-CLICK ATOMIC ROLLBACK back to v1.0.0...`);
        const res4 = await sendChaosRequest('/api/release/rollback');
        console.log(`Result:`, res4);
        console.log(`\n👉 Release reverted back to v1.0.0. Timeline updated!`);
        break;

      case 'backlog-spike':
        console.log(`📈 Injecting BACKLOG SPIKE (Enqueueing 1,000 tasks)...`);
        const res5 = await sendChaosRequest('/api/chaos/backlog-spike', { count: 100 });
        console.log(`Result:`, res5);
        console.log(`\n👉 Check Queue Depth metrics on Operator View!`);
        break;

      case 'reset-workers':
        console.log(`🔧 Resetting all Quarantined Workers back to IDLE...`);
        const res6 = await sendChaosRequest('/api/chaos/reset-workers');
        console.log(`Result:`, res6);
        break;

      default:
        console.log(`Usage: npm run chaos <scenario>\n`);
        console.log(`Available Scenarios:`);
        console.log(`  npm run chaos poison-pill    - Trigger worker crash loop & quarantine (R-04)`);
        console.log(`  npm run chaos duplicate      - Trigger duplicate job delivery (R-03)`);
        console.log(`  npm run chaos bad-release    - Deploy broken v1.2.0 release (R-06/R-07)`);
        console.log(`  npm run chaos rollback       - Execute 1-click rollback back to v1.0.0 (R-06)`);
        console.log(`  npm run chaos backlog-spike  - Enqueue 100 jobs to test backlog metrics`);
        console.log(`  npm run chaos reset-workers  - Reset quarantined workers back to active service`);
        break;
    }
  } catch (err) {
    console.error(`❌ Error connecting to NEXUS server at ${SERVER_URL}:`, err.message);
    console.error(`Ensure NEXUS is running with 'npm start' before executing chaos commands!`);
  }
}

runChaos();
