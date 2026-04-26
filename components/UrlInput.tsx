'use client';

import { useRef } from 'react';
import type { ReactNode } from 'react';

type UrlInputProps = {
  url: string;
  onUrlChange: (url: string) => void;
  onSubmit: (urlValue?: string) => void;
  loading: boolean;
  trustWidget?: ReactNode;
  batchPanel?: ReactNode;
};

export function UrlInput({
  url,
  onUrlChange,
  onSubmit,
  loading,
  trustWidget,
  batchPanel,
}: UrlInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function submitCurrentUrl(): void {
    const currentValue = inputRef.current?.value ?? url;
    onSubmit(currentValue);
  }

  return (
    <div className="cp-shell cp-enter flex min-h-screen items-center justify-center px-6 py-10">
      <div className="w-full max-w-6xl">
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
          <section className="text-center lg:text-left">
            <h1 className="logo-mark text-6xl font-semibold tracking-wide text-[var(--color-ink)]">Clearpage</h1>
            <p className="mt-2 text-lg text-[var(--color-muted)]">Paste any URL. Get a clean, exportable document.</p>

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
                className="h-16 w-full rounded-xl border border-[var(--color-border)] bg-white/95 px-5 text-lg shadow-sm outline-none transition focus:border-[var(--color-accent)] focus:ring-4 focus:ring-[color:color-mix(in_srgb,var(--color-accent)_20%,transparent)]"
              />

              <button
                type="button"
                onClick={submitCurrentUrl}
                disabled={loading}
                className="h-16 min-w-48 rounded-xl bg-[var(--color-accent)] px-8 text-base font-semibold text-white transition hover:bg-[var(--color-accent-strong)] active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? 'Extracting...' : 'Read & Export'}
              </button>
            </div>
          </section>

          {trustWidget ? <div className="lg:pt-1">{trustWidget}</div> : null}
        </div>

        {batchPanel}
      </div>
    </div>
  );
}
