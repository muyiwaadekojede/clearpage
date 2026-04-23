import { chromium } from 'playwright';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('https://example.com/article').fill('https://httpbin.org/html');
  await page.getByRole('button', { name: 'Read & Export' }).click();

  await page.getByRole('button', { name: 'Download PDF' }).first().waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: 'New URL' }).first().click();

  await page.getByPlaceholder('https://example.com/article').waitFor({ timeout: 10_000 });

  await page.getByPlaceholder('https://example.com/article').fill('https://example.invalid');
  await page.getByRole('button', { name: 'Read & Export' }).click();

  await page.getByRole('heading', { name: "We couldn't extract this page" }).waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Close' }).click();

  console.log('e2e-ui passed');
} finally {
  await page.close();
  await browser.close();
}
