import { chromium } from 'playwright';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('#url-input').fill('https://httpbin.org/html');
  await page.getByRole('button', { name: 'Read & Export' }).click();

  const pdfButton = page.getByRole('button', { name: 'Download PDF' }).first();
  await pdfButton.waitFor({ state: 'attached', timeout: 60_000 });
  await pdfButton.scrollIntoViewIfNeeded();
  await pdfButton.waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByRole('button', { name: 'New URL' }).first().click();

  await page.locator('#url-input').waitFor({ timeout: 10_000 });

  await page.locator('#url-input').fill('https://example.invalid');
  await page.getByRole('button', { name: 'Read & Export' }).click();

  await page.getByRole('heading', { name: "We couldn't extract this page" }).waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Close' }).click();

  console.log('e2e-ui passed');
} finally {
  await page.close();
  await browser.close();
}
