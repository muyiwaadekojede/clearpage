import type { NextApiRequest, NextApiResponse } from 'next';

type CheckResult = {
  ok: boolean;
  detail: string;
};

async function probeImport(loader: () => Promise<unknown>): Promise<CheckResult> {
  try {
    await loader();
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

  const checks: Record<string, CheckResult> = {
    jsdom: await probeImport(() => import('jsdom')),
    '@mozilla/readability': await probeImport(() => import('@mozilla/readability')),
    'isomorphic-dompurify': await probeImport(() => import('isomorphic-dompurify')),
    playwright: await probeImport(() => import('playwright')),
    turndown: await probeImport(() => import('turndown')),
    docx: await probeImport(() => import('docx')),
    'better-sqlite3': await probeImport(() => import('better-sqlite3')),
  };

  return res.status(200).json({
    success: true,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    vercel: Boolean(process.env.VERCEL),
    checks,
  });
}
