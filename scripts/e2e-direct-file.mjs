import { chromium } from 'playwright';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';
const directPdfUrl = 'https://arxiv.org/pdf/1809.03672';
const smallDirectPdfUrl = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
const directDocUrl = 'https://filesamples.com/samples/document/doc/sample1.doc';

async function assertApiFallbackToOriginal() {
  const response = await fetch(`${baseUrl}/api/direct-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: directDocUrl,
      format: 'md',
    }),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Direct file API fallback failed: ${response.status} ${raw}`);
  }

  const fallbackHeader = response.headers.get('x-clearpage-fallback-format') || '';
  if (fallbackHeader !== 'original') {
    throw new Error(`Expected x-clearpage-fallback-format=original, got: ${fallbackHeader || '(missing)'}`);
  }

  const contentDisposition = response.headers.get('content-disposition') || '';
  if (!/filename=/i.test(contentDisposition)) {
    throw new Error('Fallback response missing content-disposition filename.');
  }
}

async function assertHomepageDirectPdfDownload(page) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('#url-input').fill(smallDirectPdfUrl);

  const autoDownloadPromise = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Read & Export' }).click();
  const autoDownload = await autoDownloadPromise;
  if (!/\.(md|txt|docx|pdf)$/i.test(autoDownload.suggestedFilename())) {
    throw new Error(`Unexpected filename for auto direct-file download: ${autoDownload.suggestedFilename()}`);
  }

  await page.getByText('Direct file detected').waitFor({ timeout: 120_000 });
  await page.locator('select').first().selectOption('pdf');

  const downloadPromise = page.waitForEvent('download', { timeout: 180_000 });
  await page.getByRole('button', { name: 'Download' }).first().click();
  const download = await downloadPromise;
  const filename = download.suggestedFilename();

  if (!/\.pdf$/i.test(filename)) {
    throw new Error(`Expected PDF filename from homepage direct download, got: ${filename}`);
  }
}

async function assertArxivDirectPdfEndpoint() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch(`${baseUrl}/api/direct-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: directPdfUrl,
        format: 'pdf',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const raw = await response.text();
      throw new Error(`Arxiv passthrough failed: ${response.status} ${raw}`);
    }

    const contentDisposition = response.headers.get('content-disposition') || '';
    if (!/\.pdf/i.test(contentDisposition)) {
      throw new Error(`Expected arxiv PDF filename in content-disposition, got: ${contentDisposition}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Expected streaming body from arxiv passthrough response.');
    }

    const firstChunk = await reader.read();
    await reader.cancel();
    if (firstChunk.done || !firstChunk.value || firstChunk.value.byteLength <= 0) {
      throw new Error('Arxiv passthrough returned no readable bytes.');
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

async function assertBatchDirectDocDownload(page) {
  await page.goto(`${baseUrl}/batch`, { waitUntil: 'networkidle' });
  await page.locator('#batch-urls').fill(directDocUrl);
  await page.getByRole('button', { name: 'Start Batch' }).click();
  await page.getByText(/Completed in/i).waitFor({ timeout: 180_000 });

  const rowDownloadButton = page.locator('article button:has-text("Download")').first();
  await rowDownloadButton.waitFor({ timeout: 120_000 });

  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
  await rowDownloadButton.click();
  const download = await downloadPromise;
  const filename = download.suggestedFilename();

  if (!/\.doc$/i.test(filename)) {
    throw new Error(`Expected original DOC fallback filename from batch download, got: ${filename}`);
  }
}

async function main() {
  await assertApiFallbackToOriginal();
  await assertArxivDirectPdfEndpoint();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    await assertHomepageDirectPdfDownload(page);
    await assertBatchDirectDocDownload(page);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }

  console.log('e2e-direct-file passed');
}

await main();
