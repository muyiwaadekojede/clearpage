const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const sessionId = `e2e-batch-${Date.now()}`;

const urls = [
  'https://httpbin.org/html',
  'https://example.com',
  'https://example.invalid',
];

const createResponse = await fetch(`${baseUrl}/api/batch-jobs`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-clearpage-session': sessionId,
  },
  body: JSON.stringify({
    urls,
    format: 'txt',
    images: 'off',
    settings: {
      fontFace: 'serif',
      fontSize: 16,
      lineSpacing: 1.6,
      colorTheme: 'light',
    },
  }),
});

const created = await createResponse.json();

if (!createResponse.ok || !created.success || !created.job?.jobId) {
  throw new Error(`Batch create failed: ${createResponse.status} ${JSON.stringify(created)}`);
}

const jobId = created.job.jobId;
const timeoutAt = Date.now() + 180_000;
let detail = null;

while (Date.now() < timeoutAt) {
  const response = await fetch(`${baseUrl}/api/batch-jobs?jobId=${encodeURIComponent(jobId)}&limit=50&offset=0`, {
    headers: {
      'x-clearpage-session': sessionId,
    },
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Batch status failed: ${response.status} ${raw}`);
  }

  const json = await response.json();
  if (!json.success || !json.job) {
    throw new Error(`Batch status payload invalid: ${JSON.stringify(json)}`);
  }

  detail = json;

  if (json.job.status === 'completed' || json.job.status === 'failed') {
    break;
  }

  await new Promise((resolve) => setTimeout(resolve, 1200));
}

if (!detail?.job) {
  throw new Error('Batch status polling timed out without job detail.');
}

const job = detail.job;
if (job.processedUrls !== job.totalUrls) {
  throw new Error(`Batch did not process all URLs: ${job.processedUrls}/${job.totalUrls}`);
}

if (job.successCount + job.failureCount !== job.totalUrls) {
  throw new Error('Batch success/failure counts do not match total URLs.');
}

if (job.successCount < 1) {
  throw new Error('Batch expected at least one successful extraction.');
}

if (!Array.isArray(detail.items)) {
  throw new Error('Batch detail is missing items array.');
}

console.log('e2e-batch passed');
