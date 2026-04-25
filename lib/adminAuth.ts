import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextApiRequest, NextApiResponse } from 'next';

type AdminCredentials = {
  username: string;
  password: string;
  createdAt: string;
};

const ADMIN_COOKIE_NAME = 'clearpage_admin';
const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;

let inMemoryCredentials: AdminCredentials | null = null;

function resolveCredentialsDir(): string {
  const custom = process.env.CLEARPAGE_SECRETS_DIR?.trim();
  if (custom) return custom;

  if (process.env.VERCEL) {
    return path.join('/tmp', 'clearpage-secrets');
  }

  return path.join(process.cwd(), 'secrets');
}

function getCredentialsPath(): string {
  return path.join(resolveCredentialsDir(), 'admin-credentials.json');
}

function randomToken(length: number): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

function buildGeneratedCredentials(): AdminCredentials {
  if (process.env.VERCEL) {
    return {
      username: process.env.CLEARPAGE_FALLBACK_ADMIN_USER || 'admin',
      password: process.env.CLEARPAGE_FALLBACK_ADMIN_PASS || 'clearpage-admin',
      createdAt: new Date().toISOString(),
    };
  }

  return {
    username: `admin_${randomToken(10)}`,
    password: randomToken(24),
    createdAt: new Date().toISOString(),
  };
}

function readCredentialsFromEnv(): AdminCredentials | null {
  const username = process.env.CLEARPAGE_ADMIN_USERNAME?.trim();
  const password = process.env.CLEARPAGE_ADMIN_PASSWORD?.trim();

  if (!username || !password) return null;

  return {
    username,
    password,
    createdAt: process.env.CLEARPAGE_ADMIN_CREATED_AT || new Date().toISOString(),
  };
}

function ensureCredentialsFile(): void {
  if (readCredentialsFromEnv()) {
    return;
  }

  const credentialsDir = resolveCredentialsDir();
  const credentialsPath = getCredentialsPath();

  try {
    if (!fs.existsSync(credentialsDir)) {
      fs.mkdirSync(credentialsDir, { recursive: true });
    }

    if (!fs.existsSync(credentialsPath)) {
      fs.writeFileSync(credentialsPath, JSON.stringify(buildGeneratedCredentials(), null, 2), 'utf8');
    }
  } catch (error) {
    console.error('Admin credentials file initialization failed, using in-memory credentials:', error);
    if (!inMemoryCredentials) {
      inMemoryCredentials = buildGeneratedCredentials();
    }
  }
}

function readCredentials(): AdminCredentials {
  const envCredentials = readCredentialsFromEnv();
  if (envCredentials) return envCredentials;

  ensureCredentialsFile();
  const credentialsPath = getCredentialsPath();

  try {
    const raw = fs.readFileSync(credentialsPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AdminCredentials>;

    if (!parsed.username || !parsed.password) {
      throw new Error('Invalid admin credentials file: missing username/password.');
    }

    return {
      username: String(parsed.username),
      password: String(parsed.password),
      createdAt: parsed.createdAt ? String(parsed.createdAt) : new Date().toISOString(),
    };
  } catch (error) {
    console.error('Failed reading admin credentials file, using in-memory credentials:', error);
    if (!inMemoryCredentials) {
      inMemoryCredentials = buildGeneratedCredentials();
    }
    return inMemoryCredentials;
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const output: Record<string, string> = {};
  if (!cookieHeader) return output;

  for (const pair of cookieHeader.split(';')) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    output[name] = decodeURIComponent(value);
  }

  return output;
}

function signToken(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function buildSessionToken(credentials: AdminCredentials): string {
  const expiresAt = Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000;
  const payload = Buffer.from(
    JSON.stringify({ u: credentials.username, e: expiresAt }),
    'utf8',
  ).toString('base64url');
  const signature = signToken(payload, credentials.password);
  return `${payload}.${signature}`;
}

function verifySessionToken(token: string, credentials: AdminCredentials): boolean {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const expected = signToken(payload, credentials.password);
  if (!safeEqual(signature, expected)) return false;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      u?: string;
      e?: number;
    };
    if (!decoded?.u || !decoded?.e) return false;
    if (decoded.u !== credentials.username) return false;
    if (Date.now() > Number(decoded.e)) return false;
    return true;
  } catch {
    return false;
  }
}

function buildCookie(value: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${ADMIN_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function getAdminCredentialsPath(): string {
  ensureCredentialsFile();
  return getCredentialsPath();
}

export function getAdminCredentials(): AdminCredentials {
  return readCredentials();
}

export function validateAdminCredentials(username: string, password: string): boolean {
  const credentials = readCredentials();
  return safeEqual(username, credentials.username) && safeEqual(password, credentials.password);
}

export function setAdminLoginCookie(res: NextApiResponse): void {
  const credentials = readCredentials();
  const token = buildSessionToken(credentials);
  res.setHeader('Set-Cookie', buildCookie(token, ADMIN_SESSION_TTL_SECONDS));
}

export function clearAdminLoginCookie(res: NextApiResponse): void {
  res.setHeader('Set-Cookie', buildCookie('', 0));
}

export function isAdminAuthenticated(req: NextApiRequest): boolean {
  const credentials = readCredentials();
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[ADMIN_COOKIE_NAME];
  if (!token) return false;
  return verifySessionToken(token, credentials);
}

export function requireAdminAuth(req: NextApiRequest, res: NextApiResponse): boolean {
  if (isAdminAuthenticated(req)) {
    return true;
  }

  res.status(401).json({ success: false, error: 'Unauthorized' });
  return false;
}
