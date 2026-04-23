import fs from 'node:fs/promises';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';

const raw = await fs.readFile('.tmp-extract.json', 'utf8');
const article = JSON.parse(raw);

const settings = {
  fontFace: 'serif',
  fontSize: 16,
  lineSpacing: 1.6,
  colorTheme: 'light',
};

const formats = [
  ['pdf', 'application/pdf', 1_000],
  ['txt', 'text/plain', 200],
  ['md', 'text/markdown', 200],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1_000],
];

for (const [format, expectedType, minSize] of formats) {
  const response = await fetch(`${baseUrl}/api/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      format,
      content: article.content,
      textContent: article.textContent,
      title: article.title,
      byline: article.byline,
      siteName: article.siteName,
      publishedTime: article.publishedTime,
      sourceUrl: article.sourceUrl,
      settings,
    }),
  });

  if (!response.ok) {
    throw new Error(`Export ${format} failed: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes(expectedType)) {
    throw new Error(`Export ${format} unexpected content-type: ${contentType}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());

  if (bytes.length < minSize) {
    throw new Error(`Export ${format} response too small: ${bytes.length}`);
  }
}

console.log('e2e-export passed');
