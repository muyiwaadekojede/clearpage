import type { NextApiRequest, NextApiResponse } from 'next';

import { trackAnalyticsEvent } from '@/lib/analytics';
import { storeExtractSnapshot } from '@/lib/extractCache';
import { extractFromUrl } from '@/lib/extract';
import { batchExtractRateLimiter, extractRateLimiter } from '@/lib/rateLimit';
import type { ExtractResponse, ImageMode } from '@/lib/types';

const VALID_IMAGE_MODES: ImageMode[] = ['on', 'off', 'captions'];
const HOMEPAGE_MAX_ATTEMPTS = 3;
const HOMEPAGE_RETRY_BASE_DELAY_MS = 1_000;
const HOMEPAGE_RETRY_MAX_DELAY_MS = 8_000;
const HOMEPAGE_DOMAIN_COOLDOWN_BASE_MS = 2_000;
const HOMEPAGE_DOMAIN_COOLDOWN_MAX_MS = 16_000;

type DomainCooldownState = {
  nextAllowedAt: number;
  consecutiveFailures: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __clearpageExtractDomainCooldowns: Map<string, DomainCooldownState> | undefined;
}

function getDomainCooldownStore(): Map<string, DomainCooldownState> {
  if (!global.__clearpageExtractDomainCooldowns) {
    global.__clearpageExtractDomainCooldowns = new Map<string, DomainCooldownState>();
  }

  return global.__clearpageExtractDomainCooldowns;
}

function sleep(ms: number): Promise<void> {
  const safeMs = Math.max(0, Math.floor(ms));
  if (safeMs === 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, safeMs));
}

function getHostFromUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return 'unknown-host';
  }
}

function isRetryableExtractFailure(response: ExtractResponse): boolean {
  if (response.success) return false;
  return response.errorCode === 'TIMEOUT' || response.errorCode === 'FETCH_FAILED';
}

function computeRetryDelayMs(attemptNumber: number): number {
  const exponent = Math.max(0, attemptNumber - 1);
  const delay = HOMEPAGE_RETRY_BASE_DELAY_MS * 2 ** exponent;
  return Math.min(HOMEPAGE_RETRY_MAX_DELAY_MS, delay);
}

function computeDomainCooldownMs(consecutiveFailures: number): number {
  const exponent = Math.max(0, consecutiveFailures - 1);
  const delay = HOMEPAGE_DOMAIN_COOLDOWN_BASE_MS * 2 ** exponent;
  return Math.min(HOMEPAGE_DOMAIN_COOLDOWN_MAX_MS, delay);
}

async function waitForDomainCooldown(hostname: string): Promise<void> {
  const store = getDomainCooldownStore();
  const cooldown = store.get(hostname);
  if (!cooldown) return;

  const waitMs = cooldown.nextAllowedAt - Date.now();
  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

function markDomainSuccess(hostname: string): void {
  const store = getDomainCooldownStore();
  store.delete(hostname);
}

function markDomainTransientFailure(hostname: string): number {
  const store = getDomainCooldownStore();
  const previous = store.get(hostname);
  const consecutiveFailures = (previous?.consecutiveFailures || 0) + 1;
  const cooldownMs = computeDomainCooldownMs(consecutiveFailures);

  store.set(hostname, {
    consecutiveFailures,
    nextAllowedAt: Date.now() + cooldownMs,
  });

  return cooldownMs;
}

async function extractWithHomepageRetries(url: string, images: ImageMode): Promise<ExtractResponse> {
  const hostname = getHostFromUrl(url);
  let lastResult: ExtractResponse = {
    success: false,
    errorCode: 'EXTRACTION_FAILED',
    errorMessage: 'Extraction failed for this URL.',
  };

  for (let attempt = 1; attempt <= HOMEPAGE_MAX_ATTEMPTS; attempt += 1) {
    await waitForDomainCooldown(hostname);
    const result = await extractFromUrl(url, images);

    if (result.success) {
      markDomainSuccess(hostname);
      return result;
    }

    lastResult = result;

    if (!isRetryableExtractFailure(result) || attempt >= HOMEPAGE_MAX_ATTEMPTS) {
      return result;
    }

    const domainCooldownMs = markDomainTransientFailure(hostname);
    const retryDelayMs = computeRetryDelayMs(attempt);
    await sleep(Math.max(domainCooldownMs, retryDelayMs));
  }

  return lastResult;
}

function getIp(req: NextApiRequest): string {
  const forwarded = req.headers['x-forwarded-for'];

  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }

  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].split(',')[0].trim();
  }

  return req.socket.remoteAddress || 'unknown';
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ExtractResponse | { success: false; errorMessage: string }>,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, errorMessage: 'Method not allowed.' });
  }

  const ip = getIp(req);
  const rawBatchHeader = req.headers['x-clearpage-batch'];
  const isBatchRequest = rawBatchHeader === '1' || (Array.isArray(rawBatchHeader) && rawBatchHeader[0] === '1');
  const rate = isBatchRequest ? batchExtractRateLimiter.consume(ip) : extractRateLimiter.consume(ip);
  const body = req.body as { url?: string; images?: ImageMode };

  trackAnalyticsEvent(req, {
    eventName: 'api_extract_request',
    eventGroup: 'extract',
    status: 'attempt',
    pagePath: '/',
    attemptedUrl: body?.url ?? null,
    metadata: {
      images: body?.images ?? 'on',
      rateRemaining: rate.remaining,
      isBatchRequest,
    },
  });

  res.setHeader('X-RateLimit-Limit', isBatchRequest ? '12000' : '10');
  res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(rate.resetAt / 1000)));

  if (!rate.allowed) {
    trackAnalyticsEvent(req, {
      eventName: 'api_extract_result',
      eventGroup: 'extract',
      status: 'failure',
      pagePath: '/',
      attemptedUrl: body?.url ?? null,
      errorCode: 'RATE_LIMIT',
      errorMessage: 'Too many extraction requests. Try again in a minute.',
    });
    return res.status(429).json({
      success: false,
      errorMessage: 'Too many extraction requests. Try again in a minute.',
    });
  }

  if (!body?.url || typeof body.url !== 'string') {
    trackAnalyticsEvent(req, {
      eventName: 'api_extract_result',
      eventGroup: 'extract',
      status: 'failure',
      pagePath: '/',
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Missing required field: url.',
    });
    return res.status(400).json({
      success: false,
      errorMessage: 'Missing required field: url.',
    });
  }

  const images: ImageMode = VALID_IMAGE_MODES.includes(body.images as ImageMode)
    ? (body.images as ImageMode)
    : 'on';

  const result = isBatchRequest
    ? await extractFromUrl(body.url, images)
    : await extractWithHomepageRetries(body.url, images);

  if (!result.success) {
    trackAnalyticsEvent(req, {
      eventName: 'api_extract_result',
      eventGroup: 'extract',
      status: 'failure',
      pagePath: '/',
      attemptedUrl: body.url,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      metadata: {
        images,
      },
    });
    return res.status(400).json(result);
  }

  trackAnalyticsEvent(req, {
    eventName: 'api_extract_result',
    eventGroup: 'extract',
    status: 'success',
    pagePath: '/',
    attemptedUrl: body.url,
    sourceUrl: result.sourceUrl,
    metadata: {
      images,
      wordCount: result.wordCount,
      imageCount: result.imageCount,
      title: result.title,
      siteName: result.siteName,
    },
  });

  const extractionId = storeExtractSnapshot({
    title: result.title,
    byline: result.byline,
    siteName: result.siteName,
    publishedTime: result.publishedTime,
    sourceUrl: result.sourceUrl,
    textContent: result.textContent,
    contentVariants: result.contentVariants,
  });

  return res.status(200).json({
    ...result,
    extractionId,
  });
}
