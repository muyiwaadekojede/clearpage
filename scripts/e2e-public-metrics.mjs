const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

const response = await fetch(`${baseUrl}/api/public-metrics`);
if (!response.ok) {
  throw new Error(`Public metrics endpoint failed: ${response.status}`);
}

const json = await response.json();
if (!json.success || !json.metrics) {
  throw new Error(`Public metrics payload invalid: ${JSON.stringify(json)}`);
}

const metrics = json.metrics;
const requiredNumeric = [
  'totalUsers',
  'usersToday',
  'usersLast7Days',
  'pagesParsedTotal',
  'pagesParsedLast7Days',
  'docsExportedTotal',
  'docsExportedLast7Days',
  'totalTrackedSessions',
  'excludedBotSessions',
  'excludedLowQualitySessions',
];

for (const key of requiredNumeric) {
  if (typeof metrics[key] !== 'number') {
    throw new Error(`Public metrics field ${key} is not numeric.`);
  }
}

if (typeof metrics.updatedAt !== 'string' || !metrics.updatedAt) {
  throw new Error('Public metrics updatedAt is missing.');
}

console.log('e2e-public-metrics passed');
