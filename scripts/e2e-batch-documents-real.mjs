import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';
const sourceDir = path.join(process.cwd(), 'tests documents');
const tempDir = path.join(process.cwd(), '.tmp-e2e-batch-documents-real');
const firstPassFormats = ['pdf', 'md', 'txt', 'docx'];
const secondPassFormats = ['pdf', 'md', 'txt', 'docx'];

function fail(message) {
  throw new Error(message);
}

async function findRealPdfFixture() {
  let entries;
  try {
    entries = await fs.readdir(sourceDir);
  } catch {
    fail(`Missing required fixture directory: ${sourceDir}`);
  }

  const pdfName = entries
    .filter((name) => name.toLowerCase().endsWith('.pdf'))
    .sort()[0];

  if (!pdfName) {
    fail(`No PDF fixtures found in ${sourceDir}`);
  }

  return path.join(sourceDir, pdfName);
}

async function runSingleConversion(browser, inputPath, targetFormat) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const inputName = path.basename(inputPath);

  try {
    await page.goto(`${baseUrl}/batch`, { waitUntil: 'networkidle', timeout: 120_000 });
    await page.getByRole('button', { name: 'Documents' }).click();
    await page.locator('input[type="file"]').setInputFiles([inputPath]);
    await page.getByText(inputName).waitFor({ timeout: 120_000 });
    await page.locator('select').first().selectOption(targetFormat);
    await page.getByRole('button', { name: 'Start Batch' }).click();
    await page.getByText(/Completed in/i).waitFor({ timeout: 240_000 });

    const bodyText = await page.locator('body').innerText();
    const failureLine = bodyText
      .split('\n')
      .find((line) => line.includes('DOCUMENT_CONVERSION_FAILED') || line.includes('Unsupported file type.'));

    if (failureLine) {
      fail(`${inputName} -> ${targetFormat} failed: ${failureLine.trim()}`);
    }

    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.locator('article button:has-text("Download")').first().click();
    const download = await downloadPromise;
    const outputName = download.suggestedFilename();
    const outputPath = path.join(tempDir, outputName);
    await download.saveAs(outputPath);

    if (!outputName.toLowerCase().endsWith(`.${targetFormat}`)) {
      fail(`Unexpected output extension for ${inputName} -> ${targetFormat}: ${outputName}`);
    }

    return {
      inputName,
      inputExt: path.extname(inputName).slice(1).toLowerCase(),
      targetFormat,
      outputName,
      outputPath,
    };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function main() {
  await fs.rm(tempDir, { recursive: true, force: true });
  await fs.mkdir(tempDir, { recursive: true });

  const pdfFixturePath = await findRealPdfFixture();
  const browser = await chromium.launch({ headless: true });

  try {
    const firstPass = [];
    for (const format of firstPassFormats) {
      const result = await runSingleConversion(browser, pdfFixturePath, format);
      firstPass.push(result);
      console.log(`pass1 ${result.inputExt}->${format} ok (${result.outputName})`);
    }

    const representative = new Map(firstPass.map((row) => [row.targetFormat, row.outputPath]));
    const secondPass = [];

    for (const [sourceExt, inputPath] of representative.entries()) {
      for (const format of secondPassFormats) {
        const result = await runSingleConversion(browser, inputPath, format);
        secondPass.push(result);
        console.log(`pass2 ${sourceExt}->${format} ok (${result.outputName})`);
      }
    }

    console.log('e2e-batch-documents-real passed');
  } finally {
    await browser.close();
  }
}

await main();
