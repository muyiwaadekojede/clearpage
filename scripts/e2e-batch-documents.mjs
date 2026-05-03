import fs from 'node:fs/promises';
import path from 'node:path';
import { upload } from '@vercel/blob/client';
import { chromium } from 'playwright';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';
const sessionId = `e2e-batch-documents-${Date.now()}`;

function fail(message) {
  throw new Error(message);
}

async function createFixtures() {
  const dir = path.join(process.cwd(), '.tmp-e2e-batch-documents');
  await fs.mkdir(dir, { recursive: true });

  const textPath = path.join(dir, 'batch-note.txt');
  const markdownPath = path.join(dir, 'batch-summary.md');
  const invalidPath = path.join(dir, 'unsupported.png');

  await fs.writeFile(textPath, 'Clearpage batch upload test.\n\nThis file should convert cleanly.');
  await fs.writeFile(markdownPath, '# Batch Summary\n\nThis markdown file should convert cleanly.');
  await fs.writeFile(invalidPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  return { textPath, markdownPath, invalidPath };
}

async function assertApiDocumentBatch(textPath) {
  const configResponse = await fetch(`${baseUrl}/api/batch-upload-config`);
  if (!configResponse.ok) {
    fail(`Upload config failed: ${configResponse.status}`);
  }

  const configJson = await configResponse.json();
  if (!configJson.success || !['filesystem', 'blob'].includes(configJson.mode)) {
    fail(`Unexpected upload config: ${JSON.stringify(configJson)}`);
  }

  const textBytes = await fs.readFile(textPath);
  let completePayload;

  if (configJson.mode === 'blob') {
    const file = new File([textBytes], 'batch-note.txt', { type: 'text/plain' });
    const pathname = `${sessionId}/api-batch-note.txt`;
    const blob = await upload(pathname, file, {
      access: 'private',
      handleUploadUrl: `${baseUrl}/api/batch-upload-token`,
      multipart: false,
      contentType: 'text/plain',
      clientPayload: JSON.stringify({
        sessionId,
        filename: 'batch-note.txt',
        contentType: 'text/plain',
        byteSize: textBytes.byteLength,
      }),
      headers: {
        'x-clearpage-session': sessionId,
      },
    });

    completePayload = {
      mode: 'blob',
      pathname: blob.pathname,
      filename: 'batch-note.txt',
    };
  } else {
    const uploadResponse = await fetch(
      `${baseUrl}/api/batch-upload-local?sessionId=${encodeURIComponent(sessionId)}&filename=${encodeURIComponent('batch-note.txt')}&contentType=${encodeURIComponent('text/plain')}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: textBytes,
      },
    );
    const uploadJson = await uploadResponse.json();
    if (!uploadResponse.ok || !uploadJson.success || !uploadJson.file?.objectKey) {
      fail(`Local upload failed: ${uploadResponse.status} ${JSON.stringify(uploadJson)}`);
    }

    completePayload = {
      mode: 'filesystem',
      objectKey: uploadJson.file.objectKey,
      objectUrl: uploadJson.file.objectUrl,
      downloadUrl: uploadJson.file.downloadUrl,
      filename: uploadJson.file.originalFilename,
      contentType: uploadJson.file.contentType,
      byteSize: uploadJson.file.byteSize,
    };
  }

  const completeResponse = await fetch(`${baseUrl}/api/batch-upload-complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-clearpage-session': sessionId,
    },
    body: JSON.stringify(completePayload),
  });
  const completeJson = await completeResponse.json();
  if (!completeResponse.ok || !completeJson.success || !completeJson.file?.uploadId) {
    fail(`Upload completion failed: ${completeResponse.status} ${JSON.stringify(completeJson)}`);
  }

  const createResponse = await fetch(`${baseUrl}/api/batch-jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-clearpage-session': sessionId,
    },
    body: JSON.stringify({
      inputMode: 'document',
      files: [{ uploadId: completeJson.file.uploadId }],
      format: 'txt',
      images: 'off',
      settings: {
        fontFace: 'serif',
        fontSize: 16,
        lineSpacing: 1.6,
        colorTheme: 'light',
      },
    }),
  });
  const createJson = await createResponse.json();
  if (!createResponse.ok || !createJson.success || !createJson.job?.jobId) {
    fail(`Document batch create failed: ${createResponse.status} ${JSON.stringify(createJson)}`);
  }

  const jobId = createJson.job.jobId;
  const timeoutAt = Date.now() + 180_000;
  let detail = null;

  while (Date.now() < timeoutAt) {
    const response = await fetch(
      `${baseUrl}/api/batch-jobs?jobId=${encodeURIComponent(jobId)}&limit=50&offset=0`,
      {
        headers: {
          'x-clearpage-session': sessionId,
        },
      },
    );

    if (!response.ok) {
      fail(`Document batch status failed: ${response.status} ${await response.text()}`);
    }

    const json = await response.json();
    detail = json;
    if (json.job?.status === 'completed' || json.job?.status === 'failed') {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  if (!detail?.job || detail.job.status !== 'completed') {
    fail(`Document batch API did not complete: ${JSON.stringify(detail)}`);
  }

  if (!Array.isArray(detail.items) || detail.items[0]?.status !== 'success' || !detail.items[0]?.id) {
    fail(`Document batch API returned unexpected items: ${JSON.stringify(detail)}`);
  }

  const downloadResponse = await fetch(
    `${baseUrl}/api/batch-jobs/download?jobId=${encodeURIComponent(jobId)}&itemId=${detail.items[0].id}`,
    {
      headers: {
        'x-clearpage-session': sessionId,
      },
    },
  );

  if (!downloadResponse.ok) {
    fail(`Document batch download failed: ${downloadResponse.status} ${await downloadResponse.text()}`);
  }

  const contentDisposition = downloadResponse.headers.get('content-disposition') || '';
  if (!/\.txt/i.test(contentDisposition)) {
    fail(`Expected TXT document batch download, got: ${contentDisposition}`);
  }
}

async function assertUiDocumentBatch(fixtures) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    await page.goto(`${baseUrl}/batch`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Documents' }).click();

    await page.locator('input[type="file"]').setInputFiles([
      fixtures.textPath,
      fixtures.markdownPath,
      fixtures.invalidPath,
    ]);

    await page.getByText('batch-note.txt').waitFor({ timeout: 60_000 });
    await page.getByText('batch-summary.md').waitFor({ timeout: 60_000 });
    await page.getByText('Unsupported file type.').waitFor({ timeout: 60_000 });

    await page.getByRole('button', { name: 'Start Batch' }).click();
    await page.getByText(/Completed in/i).waitFor({ timeout: 180_000 });

    const firstDownload = page.waitForEvent('download', { timeout: 120_000 });
    await page.locator('article button:has-text("Download")').first().click();
    const singleDownload = await firstDownload;
    if (!/\.(pdf|txt|md|docx)$/i.test(singleDownload.suggestedFilename())) {
      fail(`Unexpected single document batch filename: ${singleDownload.suggestedFilename()}`);
    }

    const allDownloadOne = page.waitForEvent('download', { timeout: 120_000 });
    const allDownloadTwo = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByRole('button', { name: /Download 2/i }).click();
    const downloads = await Promise.all([allDownloadOne, allDownloadTwo]);

    if (downloads.length !== 2) {
      fail('Expected two downloads from Download All.');
    }
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }
}

async function main() {
  const fixtures = await createFixtures();
  await assertApiDocumentBatch(fixtures.textPath);
  await assertUiDocumentBatch(fixtures);
  console.log('e2e-batch-documents passed');
}

await main();
