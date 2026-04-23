import type { NextApiRequest, NextApiResponse } from 'next';
import { getBrowser, getBrowserRuntimeState } from '@/lib/browser';

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

  let browserLaunch: CheckResult = { ok: false, detail: 'not-run' };
  try {
    const browser = await getBrowser();
    if (!browser) {
      browserLaunch = { ok: false, detail: 'getBrowser returned null' };
    } else {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.setContent('<html><body><p>probe</p></body></html>');
      await page.pdf({ format: 'A4' });
      await context.close();
      browserLaunch = { ok: true, detail: 'ok' };
    }
  } catch (error) {
    browserLaunch = {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  return res.status(200).json({
    success: true,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    vercel: Boolean(process.env.VERCEL),
    checks,
    browserLaunch,
    browserState: getBrowserRuntimeState(),
  });
}
