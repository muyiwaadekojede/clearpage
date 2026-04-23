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
    jsdom: await probeImport(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('jsdom');
    }),
    '@mozilla/readability': await probeImport(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@mozilla/readability');
    }),
    'isomorphic-dompurify': await probeImport(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('isomorphic-dompurify');
    }),
    playwright: await probeImport(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('playwright');
    }),
    turndown: await probeImport(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('turndown');
    }),
    docx: await probeImport(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('docx');
    }),
    'better-sqlite3': await probeImport(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('better-sqlite3');
    }),
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
