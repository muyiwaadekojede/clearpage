import { loginAsAdmin } from './e2e-admin-auth.mjs';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';

const { cookie } = await loginAsAdmin(baseUrl);

const response = await fetch(`${baseUrl}/api/analytics?limit=30`, {
  headers: { Cookie: cookie },
});
if (!response.ok) {
  throw new Error(`Analytics endpoint failed: ${response.status}`);
}

const json = await response.json();

if (!json.success) {
  throw new Error('Analytics endpoint returned unsuccessful payload.');
}

const summary = json.summary || {};
if (typeof summary.totalEvents !== 'number') {
  throw new Error('Analytics summary is missing totalEvents.');
}

if (!Array.isArray(json.recentEvents)) {
  throw new Error('Analytics response missing recentEvents.');
}

console.log('e2e-analytics passed');
