'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import { getClientSessionId, trackClientEvent } from '@/lib/clientAnalytics';

type FeedbackRow = {
  id: number;
  submitted_at: string;
  failed_url: string | null;
  error_code: string | null;
  checked_reasons: string | null;
  free_text: string | null;
};

type DashboardResponse = {
  success: boolean;
  summary: {
    totalSessions: number;
    totalEvents: number;
    extractAttempts: number;
    extractSuccesses: number;
    extractFailures: number;
    exportAttempts: number;
    exportSuccesses: number;
    exportFailures: number;
    feedbackSubmissions: number;
  };
  exportBreakdown: Array<{ format: string; count: number }>;
  topErrors: Array<{ errorCode: string; count: number }>;
  recentEvents: Array<Record<string, unknown>>;
  recentSessions: Array<Record<string, unknown>>;
};

type SessionResponse = {
  success: boolean;
  session: Record<string, unknown> | null;
  events: Array<Record<string, unknown>>;
};

type AuthResponse = {
  success: boolean;
  authenticated: boolean;
  username: string | null;
};

const EMPTY_SUMMARY: DashboardResponse['summary'] = {
  totalSessions: 0,
  totalEvents: 0,
  extractAttempts: 0,
  extractSuccesses: 0,
  extractFailures: 0,
  exportAttempts: 0,
  exportSuccesses: 0,
  exportFailures: 0,
  feedbackSubmissions: 0,
};

function toReadableDate(value: unknown): string {
  if (!value || typeof value !== 'string') return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function parseMetadata(value: unknown): string {
  if (!value || typeof value !== 'string') return '';

  try {
    const parsed = JSON.parse(value) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return String(value);
  }
}

export default function AdminPage() {
  const [authLoading, setAuthLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [adminUsername, setAdminUsername] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string>('');
  const [loginSubmitting, setLoginSubmitting] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [feedbackRows, setFeedbackRows] = useState<FeedbackRow[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [sessionJourney, setSessionJourney] = useState<SessionResponse | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);

  const extractSuccessRate = useMemo(() => {
    const attempts = dashboard?.summary.extractAttempts || 0;
    if (attempts === 0) return '0%';
    const successes = dashboard?.summary.extractSuccesses || 0;
    return `${Math.round((successes / attempts) * 100)}%`;
  }, [dashboard]);

  useEffect(() => {
    void trackClientEvent({
      eventName: 'admin_page_opened',
      eventGroup: 'admin',
      status: 'attempt',
      pagePath: '/admin',
      metadata: { sessionId: getClientSessionId() },
    });

    void checkAuth();
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    void loadAll();
  }, [authenticated]);

  async function checkAuth(): Promise<void> {
    setAuthLoading(true);

    try {
      const response = await fetch('/api/admin-auth', {
        method: 'GET',
        headers: {
          'x-clearpage-session': getClientSessionId(),
        },
      });

      const json = (await response.json()) as AuthResponse;
      setAuthenticated(Boolean(json.authenticated));
      setAdminUsername(json.username || null);
    } catch {
      setAuthenticated(false);
      setAdminUsername(null);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoginError('');
    setLoginSubmitting(true);

    try {
      const response = await fetch('/api/admin-auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-clearpage-session': getClientSessionId(),
        },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        setLoginError('Invalid username or password.');
        return;
      }

      await checkAuth();

      void trackClientEvent({
        eventName: 'admin_login',
        eventGroup: 'admin',
        status: 'success',
        pagePath: '/admin',
      });
    } catch {
      setLoginError('Login failed. Please try again.');
    } finally {
      setLoginSubmitting(false);
    }
  }

  async function handleLogout(): Promise<void> {
    await fetch('/api/admin-auth', {
      method: 'DELETE',
      headers: {
        'x-clearpage-session': getClientSessionId(),
      },
    });

    setAuthenticated(false);
    setAdminUsername(null);
    setDashboard(null);
    setFeedbackRows([]);
    setSessionJourney(null);
    setSelectedSessionId('');

    void trackClientEvent({
      eventName: 'admin_logout',
      eventGroup: 'admin',
      status: 'success',
      pagePath: '/admin',
    });
  }

  async function loadAll(): Promise<void> {
    setLoading(true);

    try {
      const [analyticsRes, feedbackRes] = await Promise.all([
        fetch('/api/analytics?limit=150', {
          headers: {
            'x-clearpage-session': getClientSessionId(),
          },
        }),
        fetch('/api/feedback', {
          headers: {
            'x-clearpage-session': getClientSessionId(),
          },
        }),
      ]);

      if (analyticsRes.status === 401 || feedbackRes.status === 401) {
        setAuthenticated(false);
        setAdminUsername(null);
        return;
      }

      const analyticsJson = (await analyticsRes.json()) as DashboardResponse;
      const feedbackJson = (await feedbackRes.json()) as { success: boolean; feedback: FeedbackRow[] };

      if (analyticsJson.success) {
        setDashboard(analyticsJson);
      }

      if (feedbackJson.success) {
        setFeedbackRows(feedbackJson.feedback || []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function refreshAll(): Promise<void> {
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  }

  async function deleteFeedback(id: number): Promise<void> {
    const response = await fetch(`/api/feedback?id=${id}`, {
      method: 'DELETE',
      headers: {
        'x-clearpage-session': getClientSessionId(),
      },
    });

    if (response.status === 401) {
      setAuthenticated(false);
      setAdminUsername(null);
      return;
    }

    if (response.ok) {
      setFeedbackRows((current) => current.filter((row) => row.id !== id));
    }
  }

  async function loadSessionJourney(sessionId: string): Promise<void> {
    setSelectedSessionId(sessionId);
    setSessionLoading(true);

    try {
      const response = await fetch(`/api/analytics?sessionId=${encodeURIComponent(sessionId)}`, {
        headers: {
          'x-clearpage-session': getClientSessionId(),
        },
      });

      if (response.status === 401) {
        setAuthenticated(false);
        setAdminUsername(null);
        return;
      }

      const json = (await response.json()) as SessionResponse;
      if (json.success) {
        setSessionJourney(json);
      }
    } finally {
      setSessionLoading(false);
    }
  }

  if (authLoading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-md px-6 py-16">
        <p className="text-sm text-[var(--color-muted)]">Checking admin session...</p>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-16">
        <section className="w-full rounded-2xl border border-[var(--color-border)] bg-white p-6">
          <h1 className="logo-mark text-4xl font-semibold">Admin Login</h1>
          <p className="mt-2 text-sm text-[var(--color-muted)]">Sign in to access Clearpage telemetry and feedback.</p>

          <form className="mt-6 space-y-4" onSubmit={(event) => void handleLogin(event)}>
            <div>
              <label htmlFor="admin-username" className="mb-1 block text-sm font-medium text-[var(--color-ink)]">
                Username
              </label>
              <input
                id="admin-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
                required
              />
            </div>

            <div>
              <label htmlFor="admin-password" className="mb-1 block text-sm font-medium text-[var(--color-ink)]">
                Password
              </label>
              <input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
                required
              />
            </div>

            {loginError ? <p className="text-sm text-red-700">{loginError}</p> : null}

            <button
              type="submit"
              disabled={loginSubmitting}
              className="w-full rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loginSubmitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </section>
      </main>
    );
  }

  const summary = dashboard?.summary || EMPTY_SUMMARY;
  const recentEvents = dashboard?.recentEvents || [];
  const recentSessions = dashboard?.recentSessions || [];
  const topErrors = dashboard?.topErrors || [];
  const exportBreakdown = dashboard?.exportBreakdown || [];

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="logo-mark text-5xl font-semibold">Admin Dashboard</h1>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            Full journey telemetry + feedback inbox for Clearpage.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-xs text-[var(--color-muted)]">
            {adminUsername ? `Signed in as ${adminUsername}` : 'Signed in'}
          </span>
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={refreshing || loading}
            className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-semibold hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? 'Refreshing...' : 'Refresh Data'}
          </button>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-semibold hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            Logout
          </button>
        </div>
      </div>

      {loading ? <p className="mt-8 text-sm">Loading dashboard...</p> : null}

      {!loading ? (
        <>
          <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-5">
            <MetricCard label="Sessions" value={summary.totalSessions.toLocaleString()} />
            <MetricCard label="Events" value={summary.totalEvents.toLocaleString()} />
            <MetricCard label="Extract Success" value={extractSuccessRate} />
            <MetricCard label="Exports" value={summary.exportSuccesses.toLocaleString()} />
            <MetricCard label="Feedback" value={summary.feedbackSubmissions.toLocaleString()} />
          </section>

          <section className="mt-8 grid gap-6 lg:grid-cols-2">
            <Panel title="Top Failure Codes">
              {topErrors.length === 0 ? <p className="text-sm text-[var(--color-muted)]">No failures logged yet.</p> : null}
              <div className="space-y-2">
                {topErrors.map((row) => (
                  <div key={`${row.errorCode}-${row.count}`} className="flex items-center justify-between text-sm">
                    <span className="font-medium text-[var(--color-ink)]">{row.errorCode}</span>
                    <span className="text-[var(--color-muted)]">{row.count}</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Successful Export Formats">
              {exportBreakdown.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">No successful exports logged yet.</p>
              ) : null}
              <div className="space-y-2">
                {exportBreakdown.map((row) => (
                  <div key={`${row.format}-${row.count}`} className="flex items-center justify-between text-sm">
                    <span className="font-medium text-[var(--color-ink)]">{row.format.toUpperCase()}</span>
                    <span className="text-[var(--color-muted)]">{row.count}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </section>

          <section className="mt-8 grid gap-6 xl:grid-cols-[1.1fr_1fr]">
            <Panel title="Recent Sessions">
              {recentSessions.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">No sessions yet.</p>
              ) : null}
              <div className="space-y-3">
                {recentSessions.map((session) => {
                  const sessionId = String(session.sessionId || 'unknown');
                  const active = selectedSessionId === sessionId;

                  return (
                    <button
                      key={sessionId}
                      type="button"
                      onClick={() => void loadSessionJourney(sessionId)}
                      className={`w-full rounded-lg border p-3 text-left ${
                        active
                          ? 'border-[var(--color-accent)] bg-white'
                          : 'border-[var(--color-border)] bg-white'
                      }`}
                    >
                      <p className="truncate text-xs font-semibold text-[var(--color-ink)]">{sessionId}</p>
                      <p className="mt-1 text-xs text-[var(--color-muted)]">
                        Last seen: {toReadableDate(session.lastSeenAt)}
                      </p>
                      <p className="mt-1 text-xs text-[var(--color-muted)]">
                        Events: {Number(session.eventCount || 0)} | Failures: {Number(session.failureCount || 0)}
                      </p>
                      <p className="mt-1 truncate text-xs text-[var(--color-muted)]">
                        Landing: {String(session.landingPage || 'Unknown')}
                      </p>
                    </button>
                  );
                })}
              </div>
            </Panel>

            <Panel title="Session Journey">
              {sessionLoading ? <p className="text-sm">Loading session journey...</p> : null}
              {!sessionLoading && !sessionJourney?.session ? (
                <p className="text-sm text-[var(--color-muted)]">Select a session to inspect its full event timeline.</p>
              ) : null}

              {!sessionLoading && sessionJourney?.session ? (
                <div className="space-y-3">
                  <p className="text-xs text-[var(--color-muted)]">
                    Started: {toReadableDate(sessionJourney.session.startedAt)}
                  </p>
                  <p className="text-xs text-[var(--color-muted)]">
                    Referrer: {String(sessionJourney.session.landingReferrer || 'Direct')}
                  </p>

                  <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                    {sessionJourney.events.map((event) => (
                      <div key={String(event.id)} className="rounded-md border border-[var(--color-border)] bg-white p-2">
                        <p className="text-xs font-semibold text-[var(--color-ink)]">
                          {String(event.eventName)}
                          {event.status ? ` (${String(event.status)})` : ''}
                        </p>
                        <p className="text-[11px] text-[var(--color-muted)]">{toReadableDate(event.eventTime)}</p>
                        {event.attemptedUrl ? (
                          <p className="mt-1 break-all text-[11px] text-[var(--color-muted)]">
                            Attempted URL: {String(event.attemptedUrl)}
                          </p>
                        ) : null}
                        {event.sourceUrl ? (
                          <p className="mt-1 break-all text-[11px] text-[var(--color-muted)]">
                            Source URL: {String(event.sourceUrl)}
                          </p>
                        ) : null}
                        {event.errorCode ? (
                          <p className="mt-1 text-[11px] text-red-700">
                            {String(event.errorCode)}: {String(event.errorMessage || '')}
                          </p>
                        ) : null}
                        {event.metadata ? (
                          <pre className="mt-2 overflow-x-auto rounded border border-[var(--color-border)] bg-white p-2 text-[10px] text-[var(--color-muted)]">
                            {parseMetadata(event.metadata)}
                          </pre>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </Panel>
          </section>

          <section className="mt-8">
            <Panel title="Recent Events">
              {recentEvents.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">No events yet.</p>
              ) : null}

              <div className="max-h-[420px] overflow-auto">
                <table className="w-full min-w-[900px] text-left text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr>
                      <th className="px-2 py-2 font-semibold">Time</th>
                      <th className="px-2 py-2 font-semibold">Event</th>
                      <th className="px-2 py-2 font-semibold">Status</th>
                      <th className="px-2 py-2 font-semibold">Session</th>
                      <th className="px-2 py-2 font-semibold">URL</th>
                      <th className="px-2 py-2 font-semibold">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentEvents.map((event) => (
                      <tr key={String(event.id)} className="border-t border-[var(--color-border)] align-top">
                        <td className="px-2 py-2 text-[var(--color-muted)]">{toReadableDate(event.eventTime)}</td>
                        <td className="px-2 py-2 font-medium text-[var(--color-ink)]">{String(event.eventName || '')}</td>
                        <td className="px-2 py-2 text-[var(--color-muted)]">{String(event.status || '')}</td>
                        <td className="max-w-48 truncate px-2 py-2 text-[var(--color-muted)]">
                          {String(event.sessionId || '')}
                        </td>
                        <td className="max-w-72 break-all px-2 py-2 text-[var(--color-muted)]">
                          {String(event.attemptedUrl || event.sourceUrl || '')}
                        </td>
                        <td className="px-2 py-2 text-red-700">{String(event.errorCode || '')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </section>

          <section className="mt-8">
            <Panel title="Feedback Inbox">
              {feedbackRows.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">No feedback submitted yet.</p>
              ) : null}
              <div className="space-y-4">
                {feedbackRows.map((row) => {
                  const reasons = parseJsonArray(row.checked_reasons);

                  return (
                    <article
                      key={row.id}
                      className="rounded-xl border border-[var(--color-border)] bg-white p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs text-[var(--color-muted)]">Submitted</p>
                          <p className="text-sm font-semibold">{toReadableDate(row.submitted_at)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void deleteFeedback(row.id)}
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
            </Panel>
          </section>
        </>
      ) : null}
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-white p-3">
      <p className="text-xs text-[var(--color-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-white p-4">
      <h2 className="text-lg font-semibold text-[var(--color-ink)]">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
