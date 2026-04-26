'use client';

type ProgressIndicatorProps = {
  activeStep: number;
};

const STEPS = ['Fetching page...', 'Extracting content...', 'Processing images...', 'Ready.'];

export function ProgressIndicator({ activeStep }: ProgressIndicatorProps) {
  return (
    <div className="mt-6 w-full rounded-xl border border-[var(--color-border)] bg-white p-4 text-left">
      <ol className="space-y-2">
        {STEPS.map((step, index) => {
          const isComplete = index < activeStep;
          const isActive = index === activeStep;

          return (
            <li key={step} className="flex items-center gap-3 text-sm">
              <span
                className={`inline-flex size-5 items-center justify-center rounded-full border text-[11px] font-semibold ${
                  isComplete
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                    : isActive
                      ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                      : 'border-[var(--color-border)] text-[var(--color-muted)]'
                }`}
              >
                {isComplete ? '✓' : index + 1}
              </span>
              <span className={isActive ? 'text-[var(--color-ink)]' : 'text-[var(--color-muted)]'}>{step}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
