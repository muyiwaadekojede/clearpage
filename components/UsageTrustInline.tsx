'use client';

type UsageTrustInlineProps = {
  totalUsers: number;
  usersToday: number;
  updatedAt: string;
  loading: boolean;
};

function compact(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Math.max(0, value));
}

function ringFill(totalUsers: number): number {
  if (totalUsers <= 0) return 10;
  const milestone = 1000;
  return Math.max(10, Math.round(((totalUsers % milestone) / milestone) * 100));
}

function formatUpdated(value: string): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function UsageTrustInline({ totalUsers, usersToday, updatedAt, loading }: UsageTrustInlineProps) {
  const fill = ringFill(totalUsers);

  return (
    <div className="inline-flex items-center gap-3 rounded-full border border-[var(--color-border)] bg-white/75 px-3 py-2 text-left shadow-sm backdrop-blur">
      <div
        className="relative grid size-9 place-items-center rounded-full"
        style={{
          background: `conic-gradient(var(--color-accent) ${fill}%, color-mix(in srgb, var(--color-accent) 14%, transparent) ${fill}% 100%)`,
        }}
        aria-hidden="true"
      >
        <div className="grid size-[calc(100%-6px)] place-items-center rounded-full border border-[var(--color-border)] bg-white text-[10px] font-semibold text-[var(--color-ink)]">
          {loading ? '...' : compact(totalUsers)}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-[var(--color-ink)]">
          {loading ? 'Loading trust signal...' : `${totalUsers.toLocaleString()} trusted users`}
        </p>
        <p className="text-[11px] text-[var(--color-muted)]">
          {loading ? '...' : `+${usersToday.toLocaleString()} today`}
        </p>
      </div>

      <span className="text-[10px] text-[var(--color-muted)]" title={`Last updated: ${formatUpdated(updatedAt)}`}>
        Updated
      </span>
    </div>
  );
}
