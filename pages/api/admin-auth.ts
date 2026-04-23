import type { NextApiRequest, NextApiResponse } from 'next';

import { trackAnalyticsEvent } from '@/lib/analytics';
import {
  clearAdminLoginCookie,
  getAdminCredentials,
  isAdminAuthenticated,
  setAdminLoginCookie,
  validateAdminCredentials,
} from '@/lib/adminAuth';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    const body = req.body as { username?: string; password?: string };
    const username = body?.username?.trim() || '';
    const password = body?.password || '';

    const isValid = username.length > 0 && password.length > 0 && validateAdminCredentials(username, password);

    if (!isValid) {
      trackAnalyticsEvent(req, {
        eventName: 'admin_login_attempt',
        eventGroup: 'admin',
        status: 'failure',
        pagePath: '/admin',
        errorCode: 'ADMIN_INVALID_CREDENTIALS',
      });
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    setAdminLoginCookie(res);
    trackAnalyticsEvent(req, {
      eventName: 'admin_login_attempt',
      eventGroup: 'admin',
      status: 'success',
      pagePath: '/admin',
    });
    return res.status(200).json({ success: true });
  }

  if (req.method === 'GET') {
    const authenticated = isAdminAuthenticated(req);
    const username = authenticated ? getAdminCredentials().username : null;

    return res.status(200).json({
      success: true,
      authenticated,
      username,
    });
  }

  if (req.method === 'DELETE') {
    clearAdminLoginCookie(res);
    trackAnalyticsEvent(req, {
      eventName: 'admin_logout',
      eventGroup: 'admin',
      status: 'success',
      pagePath: '/admin',
    });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
