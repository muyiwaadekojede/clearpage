'use client';

import { useMemo, useState } from 'react';

import type { ExtractErrorCode } from '@/lib/types';

const REASONS = [
  'The page exists and is publicly accessible',
  'I can read it normally in my browser',
  'It loaded but the extracted text was wrong or incomplete',
  'The images were missing or broken',
  'The formatting was incorrect in the downloaded file',
  'The downloaded file could not be opened',
  'Something else',
];

const ERROR_MESSAGES: Record<ExtractErrorCode, string> = {
  FETCH_FAILED:
    'This URL could not be reached. It may be offline, private, or blocking automated requests.',
  EXTRACTION_FAILED:
    "We reached the page but couldn't identify the main article content. This sometimes happens with homepages, login pages, or highly dynamic layouts.",
  PAYWALL_DETECTED:
    'This page appears to be behind a paywall or requires a login. Clearpage can only extract content that is publicly accessible.',
  EMPTY_CONTENT: 'The page loaded but contained no readable text content.',
  TIMEOUT:
    'The page took too long to load. This can happen with very slow servers or heavily JavaScript-dependent pages.',
};

type FailureModalProps = {
  open: boolean;
  errorCode: ExtractErrorCode;
  failedUrl: string;
  sessionId?: string;
  onSubmitted?: () => void;
  onClose: () => void;
};

export function FailureModal({
  open,
  errorCode,
  failedUrl,
  sessionId,
  onSubmitted,
  onClose,
}: FailureModalProps) {
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [freeText, setFreeText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const subtext = useMemo(() => ERROR_MESSAGES[errorCode], [errorCode]);

  if (!open) return null;

  async function submitFeedback(): Promise<void> {
    setSubmitting(true);

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionId ? { 'x-clearpage-session': sessionId } : {}),
        },
        body: JSON.stringify({
          sessionId,
          failedUrl,
          errorCode,
          checkedReasons: selectedReasons,
          freeText,
        }),
      });

      if (!response.ok) {
        throw new Error('Feedback submission failed.');
      }

      setSubmitted(true);
      onSubmitted?.();
    } catch (error) {
      console.error(error);
    } finally {
      setSubmitting(false);
    }
  }

  function toggleReason(reason: string): void {
    setSelectedReasons((current) =>
      current.includes(reason) ? current.filter((item) => item !== reason) : [...current, reason],
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-6">
      <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-white p-6">
        <h2 className="text-3xl font-semibold text-[var(--color-ink)]">We couldn&apos;t extract this page</h2>
        <p className="mt-2 text-sm text-[var(--color-muted)]">{subtext}</p>

        {submitted ? (
          <div className="mt-6 rounded-lg border border-[var(--color-border)] bg-white p-4 text-sm text-[var(--color-ink)]">
            Thank you. We&apos;ll look into this.
          </div>
        ) : (
          <form
            className="mt-6 space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void submitFeedback();
            }}
          >
            <fieldset>
              <legend className="mb-3 text-sm font-semibold text-[var(--color-ink)]">
                Help us understand what went wrong
              </legend>
              <div className="space-y-2">
                {REASONS.map((reason) => (
                  <label key={reason} className="flex items-start gap-2 text-sm text-[var(--color-ink)]">
                    <input
                      type="checkbox"
                      checked={selectedReasons.includes(reason)}
                      onChange={() => toggleReason(reason)}
                      className="mt-1"
                    />
                    <span>{reason}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor="free-text" className="mb-2 block text-sm font-semibold text-[var(--color-ink)]">
                Anything else you want to tell us? (optional)
              </label>
              <textarea
                id="free-text"
                value={freeText}
                onChange={(event) => setFreeText(event.target.value)}
                className="min-h-28 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Sending...' : 'Send Feedback'}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-5 text-sm font-medium text-[var(--color-accent)] underline-offset-2 hover:underline"
        >
          Close
        </button>
      </div>
    </div>
  );
}
