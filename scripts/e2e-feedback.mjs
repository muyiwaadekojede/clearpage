import { loginAsAdmin } from './e2e-admin-auth.mjs';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

const payload = {
  failedUrl: 'https://example.com/unreachable',
  errorCode: 'FETCH_FAILED',
  checkedReasons: ['The page exists and is publicly accessible'],
  freeText: 'E2E feedback test',
};

const postResponse = await fetch(`${baseUrl}/api/feedback`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

if (!postResponse.ok) {
  throw new Error(`Feedback POST failed: ${postResponse.status}`);
}

const { cookie } = await loginAsAdmin(baseUrl);

const getResponse = await fetch(`${baseUrl}/api/feedback`, {
  headers: { Cookie: cookie },
});
if (!getResponse.ok) {
  throw new Error(`Feedback GET failed: ${getResponse.status}`);
}

const getJson = await getResponse.json();
if (!getJson.success || !Array.isArray(getJson.feedback)) {
  throw new Error('Feedback GET payload invalid.');
}

const inserted = getJson.feedback.find((row) => row.free_text === payload.freeText);
if (!inserted) {
  throw new Error('Inserted feedback row not found.');
}

const deleteResponse = await fetch(`${baseUrl}/api/feedback?id=${inserted.id}`, {
  method: 'DELETE',
  headers: { Cookie: cookie },
});

if (!deleteResponse.ok) {
  throw new Error(`Feedback DELETE failed: ${deleteResponse.status}`);
}

console.log('e2e-feedback passed');
