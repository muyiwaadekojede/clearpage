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
const credentialsDir = path.join(process.cwd(), 'secrets');
const credentialsPath = path.join(credentialsDir, 'admin-credentials.json');

function randomToken(length: number): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

function ensureCredentialsFile(): void {
  if (!fs.existsSync(credentialsDir)) {
    fs.mkdirSync(credentialsDir, { recursive: true });
  }

  if (!fs.existsSync(credentialsPath)) {
    const initial: AdminCredentials = {
      username: `admin_${randomToken(10)}`,
      password: randomToken(24),
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(credentialsPath, JSON.stringify(initial, null, 2), 'utf8');
  }
}

function readCredentials(): AdminCredentials {
  ensureCredentialsFile();
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
  return credentialsPath;
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
