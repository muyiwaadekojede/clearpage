import type { NextApiRequest, NextApiResponse } from 'next';

type CheckResult = {
  ok: boolean;
  detail: string;
};

async function probeImport(moduleName: string): Promise<CheckResult> {
  try {
    await import(moduleName);
    return { ok: true, detail: 'ok' };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const checks: Record<string, CheckResult> = {};
  const modules = [
    'jsdom',
    '@mozilla/readability',
    'isomorphic-dompurify',
    'playwright',
    'turndown',
    'docx',
    'better-sqlite3',
  ];

  for (const moduleName of modules) {
    checks[moduleName] = await probeImport(moduleName);
  }

  return res.status(200).json({
    success: true,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    vercel: Boolean(process.env.VERCEL),
    checks,
  });
}
