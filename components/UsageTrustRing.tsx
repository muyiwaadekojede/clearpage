'use client';

type UsageTrustRingProps = {
  totalUsers: number;
  usersToday: number;
  usersLast7Days: number;
  totalTrackedSessions: number;
  excludedBotSessions: number;
  excludedLowQualitySessions: number;
  updatedAt: string;
  loading: boolean;
};

function compactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Math.max(0, value));
}

function resolveRingFill(totalUsers: number): number {
  if (totalUsers <= 0) return 8;
  const milestone = 1000;
  const progress = (totalUsers % milestone) / milestone;
  return Math.max(12, Math.round(progress * 100));
}

function formatUpdatedAt(value: string): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function UsageTrustRing({
  totalUsers,
  usersToday,
  usersLast7Days,
  totalTrackedSessions,
  excludedBotSessions,
  excludedLowQualitySessions,
  updatedAt,
  loading,
}: UsageTrustRingProps) {
  const fillPercent = resolveRingFill(totalUsers);

  return (
    <aside className="mx-auto mt-6 w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-white/80 p-4 text-left shadow-sm backdrop-blur">
      <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-muted)]">Product Trust Signal</p>

      <div className="mt-3 flex items-center gap-4">
        <div
          className="relative grid size-24 place-items-center rounded-full"
          style={{
            background: `conic-gradient(var(--color-accent) ${fillPercent}%, color-mix(in srgb, var(--color-accent) 16%, transparent) ${fillPercent}% 100%)`,
          }}
          aria-hidden="true"
        >
          <div className="grid size-[calc(100%-10px)] place-items-center rounded-full border border-[var(--color-border)] bg-white/95">
            <span className="text-lg font-semibold text-[var(--color-ink)]">
              {loading ? '...' : compactNumber(totalUsers)}
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--color-ink)]">Trusted by active readers</p>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            {loading
              ? 'Loading usage stats...'
              : `${totalUsers.toLocaleString()} total users tracked.`}
          </p>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            {loading
              ? '...'
              : `+${usersToday.toLocaleString()} today | +${usersLast7Days.toLocaleString()} in 7 days`}
          </p>
          <p className="mt-1 text-[11px] text-[var(--color-muted)]">
            {loading
              ? '...'
              : `${excludedBotSessions.toLocaleString()} bot sessions + ${excludedLowQualitySessions.toLocaleString()} low-quality sessions filtered from ${totalTrackedSessions.toLocaleString()} tracked.`}
          </p>
          <p className="mt-1 text-[11px] text-[var(--color-muted)]">
            {loading ? '...' : `Last updated: ${formatUpdatedAt(updatedAt)}`}
          </p>
        </div>
      </div>
    </aside>
  );
}

