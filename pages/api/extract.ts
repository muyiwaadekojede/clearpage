import type { NextApiRequest, NextApiResponse } from 'next';

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

  res.setHeader('X-RateLimit-Limit', '10');
  res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(rate.resetAt / 1000)));

  if (!rate.allowed) {
    return res.status(429).json({
      success: false,
      errorMessage: 'Too many extraction requests. Try again in a minute.',
    });
  }

  const body = req.body as { url?: string; images?: ImageMode };

  if (!body?.url || typeof body.url !== 'string') {
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
    return res.status(400).json(result);
  }

  return res.status(200).json(result);
}
