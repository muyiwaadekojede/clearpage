import fs from 'node:fs/promises';

const defaultCredentialsPath = 'secrets/admin-credentials.json';

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  const [cookiePart] = setCookieHeader.split(';');
  return cookiePart || null;
}

async function readCredentials(pathname, baseUrl) {
  if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
    return {
      username: String(process.env.ADMIN_USERNAME),
      password: String(process.env.ADMIN_PASSWORD),
    };
  }

  const target = String(baseUrl || '').toLowerCase();
  const isLocalTarget = target.includes('127.0.0.1') || target.includes('localhost');

  if (!isLocalTarget) {
    return {
      username: 'admin',
      password: 'clearpage-admin',
    };
  }

  try {
    const raw = await fs.readFile(pathname, 'utf8');
    const parsed = JSON.parse(raw);

    if (!parsed.username || !parsed.password) {
      throw new Error(`Invalid admin credentials file: ${pathname}`);
    }

    return {
      username: String(parsed.username),
      password: String(parsed.password),
    };
  } catch {
    return {
      username: 'admin',
      password: 'clearpage-admin',
    };
  }
}

export async function loginAsAdmin(baseUrl) {
  const credentialsPath = process.env.ADMIN_CREDENTIALS_PATH || defaultCredentialsPath;

  // Touch the auth endpoint first so server-side credential bootstrap runs if needed.
  await fetch(`${baseUrl}/api/admin-auth`);

  const credentials = await readCredentials(credentialsPath, baseUrl);
  const response = await fetch(`${baseUrl}/api/admin-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    throw new Error(`Admin login failed: ${response.status}`);
  }

  const cookie = extractCookie(response.headers.get('set-cookie'));
  if (!cookie) {
    throw new Error('Admin login did not return a session cookie.');
  }

  return {
    cookie,
    username: credentials.username,
  };
}
