import type { NextApiRequest, NextApiResponse } from 'next';

import db from '@/lib/db';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    try {
      const { failedUrl, errorCode, checkedReasons, freeText } = req.body as {
        failedUrl?: string;
        errorCode?: string;
        checkedReasons?: string[];
        freeText?: string;
      };

      db.prepare(`
        INSERT INTO feedback (submitted_at, failed_url, error_code, checked_reasons, free_text)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        new Date().toISOString(),
        failedUrl ?? null,
        errorCode ?? null,
        JSON.stringify(checkedReasons ?? []),
        freeText ?? null,
      );

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('Feedback write error:', err);
      return res.status(500).json({ success: false, error: 'Failed to save feedback.' });
    }
  }

  if (req.method === 'GET') {
    const rows = db.prepare('SELECT * FROM feedback ORDER BY id DESC').all();
    return res.status(200).json({ success: true, feedback: rows });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ success: false, error: 'Missing id.' });
    }

    db.prepare('DELETE FROM feedback WHERE id = ?').run(Number(id));
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
