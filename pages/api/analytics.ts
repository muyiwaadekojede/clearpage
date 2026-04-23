import type { NextApiRequest, NextApiResponse } from 'next';

import { requireAdminAuth } from '@/lib/adminAuth';
import {
  getAnalyticsDashboard,
  getSessionJourney,
  trackAnalyticsEvent,
  type AnalyticsEventInput,
} from '@/lib/analytics';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    const body = req.body as Partial<AnalyticsEventInput>;

    if (!body?.eventName || typeof body.eventName !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing eventName.' });
    }

    trackAnalyticsEvent(req, {
      sessionId: body.sessionId,
      eventName: body.eventName,
      eventGroup: body.eventGroup,
      status: body.status,
      pagePath: body.pagePath,
      attemptedUrl: body.attemptedUrl,
      sourceUrl: body.sourceUrl,
      exportFormat: body.exportFormat,
      errorCode: body.errorCode,
      errorMessage: body.errorMessage,
      referrer: body.referrer,
      utmSource: body.utmSource,
      utmMedium: body.utmMedium,
      utmCampaign: body.utmCampaign,
      utmTerm: body.utmTerm,
      utmContent: body.utmContent,
      metadata: body.metadata,
    });

    return res.status(200).json({ success: true });
  }

  if (req.method === 'GET') {
    if (!requireAdminAuth(req, res)) {
      return;
    }

    const { sessionId, limit } = req.query;

    if (typeof sessionId === 'string' && sessionId.trim().length > 0) {
      const payload = getSessionJourney(sessionId);
      return res.status(200).json({ success: true, ...payload });
    }

    const dashboard = getAnalyticsDashboard(Number(limit));
    return res.status(200).json({ success: true, ...dashboard });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
