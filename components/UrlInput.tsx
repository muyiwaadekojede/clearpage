'use client';

import Link from 'next/link';
import { useRef } from 'react';

type UrlInputProps = {
  url: string;
  onUrlChange: (url: string) => void;
  onSubmit: (urlValue?: string) => void;
  loading: boolean;
  subtitle: string;
  usageMetrics?: {
    totalUsers: number;
    usersLast7Days: number;
    pagesParsedTotal: number;
    pagesParsedLast7Days: number;
    docsExportedTotal: number;
    docsExportedLast7Days: number;
  } | null;
};

function fmt(value: number): string {
  return Math.max(0, Number(value || 0)).toLocaleString();
}

function wordForCount(value: number, singular: string, plural: string): string {
  return Number(value) === 1 ? singular : plural;
}

export function UrlInput({ url, onUrlChange, onSubmit, loading, subtitle, usageMetrics }: UrlInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasUsageData =
    !!usageMetrics &&
    (usageMetrics.totalUsers > 0 || usageMetrics.pagesParsedTotal > 0 || usageMetrics.docsExportedTotal > 0);
  const hasAnyGrowth =
    !!usageMetrics &&
    (usageMetrics.usersLast7Days > 0 ||
      usageMetrics.pagesParsedLast7Days > 0 ||
      usageMetrics.docsExportedLast7Days > 0);

  function submitCurrentUrl(): void {
    const currentValue = inputRef.current?.value ?? url;
    onSubmit(currentValue);
  }

  return (
    <div className="cp-shell cp-enter flex min-h-screen items-center justify-center px-6 py-10">
      <div className="w-full max-w-3xl text-center">
        <h1 className="logo-mark text-6xl font-semibold text-[var(--color-ink)]">Clearpage</h1>
        <p className="mt-2 text-lg text-[var(--color-muted)]">{subtitle}</p>

        <div className="mt-12 flex flex-col gap-4 md:flex-row md:items-center">
          <label htmlFor="url-input" className="sr-only">
            Article URL
          </label>
          <input
            id="url-input"
            ref={inputRef}
            type="url"
            inputMode="url"
            placeholder="https://example.com/article"
            autoComplete="off"
            value={url}
            onChange={(event) => onUrlChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitCurrentUrl();
            }}
            className="h-16 w-full rounded-xl border border-[var(--color-border)] bg-white px-5 text-lg outline-none transition focus:border-[var(--color-accent)]"
          />

          <button
            type="button"
            onClick={submitCurrentUrl}
            disabled={loading}
            className="h-16 min-w-48 rounded-xl bg-[var(--color-accent)] px-8 text-base font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? 'Extracting...' : 'Read & Export'}
          </button>
        </div>

        <p className="mt-3 min-h-5 text-sm text-[var(--color-muted)]">
          {loading ? 'Fetching page and extracting content...' : ''}
        </p>

        {hasUsageData && usageMetrics ? (
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            <span>
              <span className="font-semibold text-[var(--color-ink)]">{fmt(usageMetrics.totalUsers)}</span>{' '}
              {wordForCount(usageMetrics.totalUsers, 'user', 'users')}
              {usageMetrics.usersLast7Days > 0 ? (
                <span className="text-[var(--color-accent)]"> (+{fmt(usageMetrics.usersLast7Days)})</span>
              ) : null}
            </span>
            <span aria-hidden="true"> · </span>
            <span>
              <span className="font-semibold text-[var(--color-ink)]">{fmt(usageMetrics.pagesParsedTotal)}</span>{' '}
              {wordForCount(usageMetrics.pagesParsedTotal, 'page', 'pages')} parsed
              {usageMetrics.pagesParsedLast7Days > 0 ? (
                <span className="text-[var(--color-accent)]"> (+{fmt(usageMetrics.pagesParsedLast7Days)})</span>
              ) : null}
            </span>
            <span aria-hidden="true"> · </span>
            <span>
              <span className="font-semibold text-[var(--color-ink)]">{fmt(usageMetrics.docsExportedTotal)}</span>{' '}
              {wordForCount(usageMetrics.docsExportedTotal, 'export', 'exports')}
              {usageMetrics.docsExportedLast7Days > 0 ? (
                <span className="text-[var(--color-accent)]"> (+{fmt(usageMetrics.docsExportedLast7Days)})</span>
              ) : null}
            </span>
            {hasAnyGrowth ? <span className="ml-2 text-xs">7d</span> : null}
          </p>
        ) : null}

        <p className="mt-5 text-sm text-[var(--color-muted)]">
          <Link href="/batch" className="text-[var(--color-accent)] hover:underline">
            Need bulk processing? Open Batch Workspace
          </Link>
        </p>
      </div>
    </div>
  );
}
