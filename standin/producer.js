const { enqueueJob } = require('../engine/queue');

/**
 * Stand-in Job Producer (Thing 02)
 */

let counter = 100;

function produceSampleJob(customJobId = null, customPayload = null) {
  counter++;
  const jobId = customJobId || `job-order-${counter}`;
  const payload = customPayload || {
    order_id: `ORD-${counter}`,
    customer: `Customer_${Math.floor(Math.random() * 1000)}`,
    amount: Math.floor(Math.random() * 500) + 10,
    timestamp: new Date().toISOString()
  };

  return enqueueJob({ jobId, payload });
}

function produceBatch(count = 5) {
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(produceSampleJob());
  }
  return results;
}

module.exports = {
  produceSampleJob,
  produceBatch
};
