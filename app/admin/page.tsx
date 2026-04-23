'use client';

import { useEffect, useState } from 'react';

type FeedbackRow = {
  id: number;
  submitted_at: string;
  failed_url: string | null;
  error_code: string | null;
  checked_reasons: string | null;
  free_text: string | null;
};

export default function AdminPage() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadFeedback();
  }, []);

  async function loadFeedback(): Promise<void> {
    setLoading(true);

    try {
      const response = await fetch('/api/feedback');
      const json = (await response.json()) as { success: boolean; feedback: FeedbackRow[] };
      if (json.success) {
        setRows(json.feedback || []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function deleteRow(id: number): Promise<void> {
    const response = await fetch(`/api/feedback?id=${id}`, { method: 'DELETE' });

    if (response.ok) {
      setRows((current) => current.filter((row) => row.id !== id));
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-10">
      <h1 className="logo-mark text-5xl font-semibold">Feedback Inbox</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">Internal feedback viewer for extraction failures.</p>

      {loading ? <p className="mt-8 text-sm">Loading...</p> : null}

      {!loading && rows.length === 0 ? (
        <p className="mt-8 rounded-xl border border-[var(--color-border)] bg-white/80 p-4 text-sm">
          No feedback submitted yet.
        </p>
      ) : null}

      <div className="mt-8 space-y-4">
        {rows.map((row) => {
          const reasons = (() => {
            try {
              return JSON.parse(row.checked_reasons || '[]') as string[];
            } catch {
              return [];
            }
          })();

          return (
            <article
              key={row.id}
              className="rounded-xl border border-[var(--color-border)] bg-white/85 p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Submitted</p>
                  <p className="text-sm font-semibold">{new Date(row.submitted_at).toLocaleString()}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void deleteRow(row.id)}
                  className="rounded-md border border-[var(--color-border)] px-3 py-1 text-xs font-semibold text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                >
                  Delete
                </button>
              </div>

              <dl className="mt-3 space-y-2 text-sm">
                <div>
                  <dt className="font-semibold">Failed URL</dt>
                  <dd className="break-all text-[var(--color-muted)]">{row.failed_url || 'Unknown'}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Error Code</dt>
                  <dd className="text-[var(--color-muted)]">{row.error_code || 'Unknown'}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Checked Reasons</dt>
                  <dd className="text-[var(--color-muted)]">
                    {reasons.length > 0 ? reasons.join(' | ') : 'None'}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold">Comment</dt>
                  <dd className="whitespace-pre-wrap text-[var(--color-muted)]">{row.free_text || 'None'}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
    </main>
  );
}
