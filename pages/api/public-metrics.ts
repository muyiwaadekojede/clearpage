import type { NextApiRequest, NextApiResponse } from 'next';

import { getPublicUsageMetrics } from '@/lib/analytics';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed.' });
  }

  const metrics = getPublicUsageMetrics();
  return res.status(200).json({ success: true, metrics });
}

