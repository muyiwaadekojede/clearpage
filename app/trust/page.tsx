import Link from 'next/link';

import { getPublicUsageMetrics } from '@/lib/analytics';

function formatDate(value: string): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatCount(value: number): string {
  return Math.max(0, Number(value || 0)).toLocaleString();
}

export default function TrustPage() {
  const metrics = getPublicUsageMetrics();

  return (
    <main className="cp-shell cp-enter mx-auto w-full max-w-5xl px-6 py-12">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="logo-mark text-5xl font-semibold text-[var(--color-ink)]">Trust and Usage</h1>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              Public metrics for active reader sessions and quality filtering.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            >
              Back to Homepage
            </Link>
            <Link
              href="/batch"
              className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            >
              Open Batch Workspace
            </Link>
          </div>
        </div>

        <section className="mt-8 rounded-2xl border border-[var(--color-border)] bg-white p-6">
          <h2 className="text-2xl font-semibold text-[var(--color-ink)]">Current totals</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
              <dt className="text-sm text-[var(--color-muted)]">Trusted users</dt>
              <dd className="mt-1 text-3xl font-semibold text-[var(--color-ink)]">
                {formatCount(metrics.totalUsers)}
              </dd>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
              <dt className="text-sm text-[var(--color-muted)]">New trusted users today</dt>
              <dd className="mt-1 text-3xl font-semibold text-[var(--color-ink)]">
                {formatCount(metrics.usersToday)}
              </dd>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
              <dt className="text-sm text-[var(--color-muted)]">Trusted users in last 7 days</dt>
              <dd className="mt-1 text-3xl font-semibold text-[var(--color-ink)]">
                {formatCount(metrics.usersLast7Days)}
              </dd>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
              <dt className="text-sm text-[var(--color-muted)]">Total tracked sessions</dt>
              <dd className="mt-1 text-3xl font-semibold text-[var(--color-ink)]">
                {formatCount(metrics.totalTrackedSessions)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="mt-6 rounded-2xl border border-[var(--color-border)] bg-white p-6">
          <h2 className="text-2xl font-semibold text-[var(--color-ink)]">Filter transparency</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
              <dt className="text-sm text-[var(--color-muted)]">Excluded bot-like sessions</dt>
              <dd className="mt-1 text-3xl font-semibold text-[var(--color-ink)]">
                {formatCount(metrics.excludedBotSessions)}
              </dd>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
              <dt className="text-sm text-[var(--color-muted)]">Excluded low-quality sessions</dt>
              <dd className="mt-1 text-3xl font-semibold text-[var(--color-ink)]">
                {formatCount(metrics.excludedLowQualitySessions)}
              </dd>
            </div>
          </dl>

          <p className="mt-4 text-sm text-[var(--color-muted)]">
            Updated {formatDate(metrics.updatedAt)}.
          </p>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            Sessions are counted as trusted after minimum engagement and quality checks.
          </p>
        </section>
      </div>
    </main>
  );
}

