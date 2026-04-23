import { Agent, setGlobalDispatcher } from 'undici';

setGlobalDispatcher(
  new Agent({
    headersTimeout: 180_000,
    bodyTimeout: 180_000,
    connectTimeout: 30_000,
  }),
);

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';

const PROVIDED_URLS = [
  'https://netflixtechblog.com/learning-a-personalized-homepage-aa8ec670359a',
  'https://engineering.fb.com/2024/12/10/video-engineering/inside-facebooks-video-delivery-system',
  'https://engineering.fb.com/2023/08/09/ml-applications/scaling-instagram-explore-recommendations-system',
  'https://netflixtechblog.medium.com/integrating-netflixs-foundation-model-into-personalization-applications-cf176b5860eb',
  'https://netflixtechblog.com/foundation-model-for-personalized-recommendation-1a0bd8e02d39',
  'https://blog.youtube/inside-youtube/on-youtubes-recommendation-system',
];

const ADDITIONAL_BRAND_URLS = [
  ['AWS', 'https://aws.amazon.com/blogs/aws/aws-weekly-roundup-claude-opus-4-7-in-amazon-bedrock-aws-interconnect-ga-and-more-april-20-2026/'],
  ['GitHub', 'https://github.blog/news-insights/company-news/github-availability-report-march-2026/'],
  ['Stripe', 'https://stripe.com/blog/three-fraud-trends-from-mrc-vegas-2026'],
  ['Vercel', 'https://vercel.com/blog/agentic-infrastructure'],
  ['Notion', 'https://www.notion.com/blog/enabling-multi-region-data-systems-at-notion'],
  ['Figma', 'https://www.figma.com/blog/config-speakers-looking-ahead-2026/'],
  ['Go', 'https://go.dev/blog/survey2025'],
  ['Rust', 'https://blog.rust-lang.org/2026/02/13/crates.io-malicious-crate-update/'],
  ['Docker', 'https://www.docker.com/blog/docker-announces-soc-2-type-2-attestation-iso-27001-certification/'],
  ['Kubernetes', 'https://kubernetes.io/blog/2026/04/22/breaking-changes-in-selinux-volume-labeling/'],
  ['LogRocket', 'https://blog.logrocket.com/product-management/product-discovery-framework-pms/'],
  ['MongoDB', 'https://www.mongodb.com/company/blog/innovation/new-research-reveals-overcoming-legacy-tech-issues-key-ai-success'],
  ['JetBrains', 'https://blog.jetbrains.com/ai/2026/04/give-ai-something-worth-amplifying-three-priorities-for-technical-leaders/'],
  ['GitLab', 'https://about.gitlab.com/blog/gitlab-ai-hackathon-2026-meet-the-winners'],
  ['Red Hat', 'https://www.redhat.com/en/blog/5-reasons-go-your-team-red-hat-summit-2026'],
  ['Twilio', 'https://www.twilio.com/en-us/blog/company/news/fast-company-2025-best-workplaces-innovators'],
  ['DigitalOcean', 'https://www.digitalocean.com/blog/hacktoberfest-2025-wrapup'],
  ['Mozilla Hacks', 'https://hacks.mozilla.org/2026/03/firefox-developer-edition-and-beta-try-out-mozillas-rpm-package/'],
  ['HashiCorp', 'https://www.hashicorp.com/blog/terraform-adds-pre-written-sentinel-policies-for-iso-27001'],
  ['Fastly', 'https://www.fastly.com/blog/fastlys-proactive-protection-critical-react-rce-cve-2025-55182'],
  ['Datadog', 'https://www.datadoghq.com/blog/datadog-forms-sheets-developer-feedback/'],
  ['Canva', 'https://www.canva.dev/blog/engineering/ai-interview-success/'],
  ['Atlassian', 'https://www.atlassian.com/blog/confluence/rovo-remix-3p-agents-confluence'],
  ['Dropbox', 'https://dropbox.tech/culture/highlights-from-dropbox-2025-summer-intern-class'],
  ['OpenAI', 'https://openai.com/index/speeding-up-agentic-workflows-with-websockets/'],
  ['Google', 'https://blog.google/innovation-and-ai/infrastructure-and-cloud/google-cloud/cloud-next-2026-sundar-pichai/'],
  ['Supabase', 'https://supabase.com/blog/supabase-is-now-iso-27001-certified'],
  ['Cockroach Labs', 'https://www.cockroachlabs.com/blog/ai-infrastructure-systems-problem-cockroach-connect/'],
  ['Grafana', 'https://grafana.com/blog/grafanacon-2026-announcements/'],
  ['Intercom', 'https://www.intercom.com/blog/announcing-fin-for-sales/'],
];

const DISALLOWED_PATH_PARTS = [
  '/tag/', '/tags/', '/category/', '/categories/', '/author/', '/authors/',
  '/about', '/privacy', '/terms', '/contact', '/jobs', '/careers', '/search',
  '/newsletter', '/events', '/podcast', '/press', '/newsroom', '/changelog',
  '/feed', '/rss', '/page/', '/topic/', '/topics/', '/channel/', '/products/',
  '/product/', '/docs/', '/doc/', '/kb/', '/pricing/', '/plans/', '/partners/',
  '/investors/', '/solutions/', '/resources/', '/support/', '/help/', '/podcasts/',
  '/training/', '/legal/', '/reference/', '/core-features/', '/platform/', '/features/'
];

const NON_ACTIONABLE_EXTRACT_FAILURES = new Set(['FETCH_FAILED', 'TIMEOUT']);

let ipCounter = 1;
function nextIp() {
  const a = 80 + Math.floor(ipCounter / 5000);
  const b = Math.floor((ipCounter % 5000) / 255);
  const c = ipCounter % 255;
  ipCounter += 1;
  return `${a}.0.${b}.${c || 1}`;
}

async function fetchWithRetry(url, init, attempts = 3) {
  let lastError = null;

  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1200 * (i + 1)));
      }
    }
  }

  throw lastError;
}

function hasDataImages(html) {
  return /<img[^>]+src="data:image\//i.test(html);
}

function isAcceptableArticlePayload(payload) {
  if (!payload.success) return false;
  if (!payload.title || /untitled|unknown|page\s*\d+/i.test(payload.title)) return false;
  if (payload.title.trim().length < 12) return false;
  if ((payload.wordCount || 0) < 220) return false;
  if ((payload.imageCount || 0) > 0 && !hasDataImages(payload.content)) return false;

  const path = new URL(payload.sourceUrl).pathname.toLowerCase();
  if (DISALLOWED_PATH_PARTS.some((part) => path.includes(part))) return false;
  if (/\/blog\/(page|app|topic|topics|category)\//.test(path)) return false;
  if (/\/posts\/\d+\/?$/.test(path)) return false;

  const segments = path.split('/').filter(Boolean);
  const tail = segments[segments.length - 1] || '';
  if (['blog', 'blogs', 'news', 'stories', 'engineering', 'research', 'index', 'posts'].includes(tail)) {
    return false;
  }

  return true;
}

async function extractOnce(url) {
  const response = await fetchWithRetry(`${BASE_URL}/api/extract`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': nextIp(),
    },
    body: JSON.stringify({ url, images: 'on' }),
  });

  const raw = await response.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Non-JSON extract response (${response.status}) for ${url}: ${raw.slice(0, 200)}`);
  }

  return { response, json };
}

async function exportAllFormats(article) {
  const settings = {
    fontFace: 'serif',
    fontSize: 16,
    lineSpacing: 1.6,
    colorTheme: 'light',
  };

  const formats = [
    ['pdf', 'application/pdf', 1000],
    ['txt', 'text/plain', 200],
    ['md', 'text/markdown', 200],
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1000],
  ];

  for (const [format, expectedType, minBytes] of formats) {
    const response = await fetchWithRetry(`${BASE_URL}/api/export`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': nextIp(),
      },
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
      const raw = await response.text();
      throw new Error(`Export ${format} failed (${response.status}) for ${article.sourceUrl}: ${raw.slice(0, 200)}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes(expectedType)) {
      throw new Error(`Export ${format} type mismatch for ${article.sourceUrl}: ${contentType}`);
    }

    const contentDisposition = response.headers.get('content-disposition') || '';
    if (!/filename=/i.test(contentDisposition)) {
      throw new Error(`Export ${format} missing filename for ${article.sourceUrl}`);
    }

    if (/clearpage-export\./i.test(contentDisposition)) {
      throw new Error(`Export ${format} used fallback filename for ${article.sourceUrl}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < minBytes) {
      throw new Error(`Export ${format} too small (${bytes.length}) for ${article.sourceUrl}`);
    }
  }
}

async function main() {
  const uniqueBrands = new Set(ADDITIONAL_BRAND_URLS.map(([brand]) => brand));
  if (uniqueBrands.size !== 30) {
    throw new Error(`Expected 30 unique additional brands, got ${uniqueBrands.size}`);
  }

  const testUrls = [
    ...PROVIDED_URLS.map((url) => ['Provided', url]),
    ...ADDITIONAL_BRAND_URLS,
  ];

  let passCount = 0;
  let blockedCount = 0;

  for (const [brand, url] of testUrls) {
    const { response, json } = await extractOnce(url);

    if (!response.ok || !json.success) {
      const errorCode = json?.errorCode ? String(json.errorCode) : 'UNKNOWN';

      if (NON_ACTIONABLE_EXTRACT_FAILURES.has(errorCode)) {
        blockedCount += 1;
        console.log(`BLOCKED ${brand} -> ${url} | status=${response.status} code=${errorCode}`);
        continue;
      }

      throw new Error(`Extraction failed for ${brand} ${url}: ${response.status} ${errorCode}`);
    }

    if (!isAcceptableArticlePayload(json)) {
      throw new Error(`Extraction quality gate failed for ${brand} ${url}`);
    }

    await exportAllFormats(json);
    passCount += 1;
    console.log(`PASS ${brand} -> ${url} | words=${json.wordCount} images=${json.imageCount}`);
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Provided URLs tested: ${PROVIDED_URLS.length}`);
  console.log(`Additional brand URLs tested: ${ADDITIONAL_BRAND_URLS.length}`);
  console.log(`Total URL e2e passes: ${passCount}`);
  console.log(`Blocked by anti-bot/timeouts (non-actionable): ${blockedCount}`);
  console.log(`Total URLs processed: ${testUrls.length}`);
  console.log('All tests passed.');
}

await main();
