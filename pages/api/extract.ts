import type { NextApiRequest, NextApiResponse } from 'next';

import { trackAnalyticsEvent } from '@/lib/analytics';
import { storeExtractSnapshot } from '@/lib/extractCache';
import { extractFromUrl } from '@/lib/extract';
import { extractRateLimiter } from '@/lib/rateLimit';
import type { ExtractResponse, ImageMode } from '@/lib/types';

const VALID_IMAGE_MODES: ImageMode[] = ['on', 'off', 'captions'];

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
  const rate = extractRateLimiter.consume(ip);
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
    },
  });

  res.setHeader('X-RateLimit-Limit', '10');
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

  const result = await extractFromUrl(body.url, images);

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
