import type { NextApiRequest } from 'next';

import db from '@/lib/db';

export type AnalyticsEventInput = {
  sessionId?: string | null;
  eventName: string;
  eventGroup?: string | null;
  status?: 'attempt' | 'success' | 'failure' | string | null;
  pagePath?: string | null;
  attemptedUrl?: string | null;
  sourceUrl?: string | null;
  exportFormat?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  metadata?: unknown;
};

export type AnalyticsDashboard = {
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

export type PublicUsageMetrics = {
  totalUsers: number;
  usersToday: number;
  usersLast7Days: number;
  pagesParsedTotal: number;
  pagesParsedLast7Days: number;
  docsExportedTotal: number;
  docsExportedLast7Days: number;
  totalTrackedSessions: number;
  excludedBotSessions: number;
  excludedLowQualitySessions: number;
  updatedAt: string;
};

function trimNullable(value: unknown, maxLen = 1000): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLen);
}

function getForwardedIp(req: NextApiRequest): string {
  const forwarded = req.headers['x-forwarded-for'];

  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }

  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].split(',')[0].trim();
  }

  return req.socket.remoteAddress || 'unknown';
}

function extractSessionId(req: NextApiRequest): string | null {
  const sessionHeader = req.headers['x-clearpage-session'];

  if (typeof sessionHeader === 'string') {
    return trimNullable(sessionHeader, 128);
  }

  if (Array.isArray(sessionHeader) && sessionHeader[0]) {
    return trimNullable(sessionHeader[0], 128);
  }

  const bodyMaybe = req.body as { sessionId?: string } | undefined;
  return trimNullable(bodyMaybe?.sessionId, 128);
}

function stringifyMetadata(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  try {
    return JSON.stringify(value).slice(0, 12_000);
  } catch {
    return trimNullable(String(value), 12_000);
  }
}

export function trackAnalyticsEvent(req: NextApiRequest, input: AnalyticsEventInput): void {
  const eventName = trimNullable(input.eventName, 120);
  if (!eventName) return;

  const now = new Date().toISOString();
  const sessionId = trimNullable(input.sessionId, 128) || extractSessionId(req);
  const userAgent =
    trimNullable(input.userAgent, 1000) || trimNullable(req.headers['user-agent'], 1000);
  const ipAddress = trimNullable(input.ipAddress, 120) || getForwardedIp(req);

  const row = {
    eventTime: now,
    sessionId,
    eventName,
    eventGroup: trimNullable(input.eventGroup, 120),
    status: trimNullable(input.status, 64),
    pagePath: trimNullable(input.pagePath, 500),
    attemptedUrl: trimNullable(input.attemptedUrl, 2000),
    sourceUrl: trimNullable(input.sourceUrl, 2000),
    exportFormat: trimNullable(input.exportFormat, 32),
    errorCode: trimNullable(input.errorCode, 120),
    errorMessage: trimNullable(input.errorMessage, 2000),
    referrer: trimNullable(input.referrer, 2000),
    utmSource: trimNullable(input.utmSource, 255),
    utmMedium: trimNullable(input.utmMedium, 255),
    utmCampaign: trimNullable(input.utmCampaign, 255),
    utmTerm: trimNullable(input.utmTerm, 255),
    utmContent: trimNullable(input.utmContent, 255),
    userAgent,
    ipAddress,
    metadata: stringifyMetadata(input.metadata),
  };

  const tx = db.transaction(() => {
    if (sessionId) {
      db.prepare(
        `
        INSERT INTO analytics_sessions (
          session_id,
          started_at,
          last_seen_at,
          landing_page,
          landing_referrer,
          utm_source,
          utm_medium,
          utm_campaign,
          utm_term,
          utm_content,
          first_user_agent,
          first_ip
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          last_seen_at = excluded.last_seen_at
        `,
      ).run(
        sessionId,
        now,
        now,
        row.pagePath,
        row.referrer,
        row.utmSource,
        row.utmMedium,
        row.utmCampaign,
        row.utmTerm,
        row.utmContent,
        row.userAgent,
        row.ipAddress,
      );
    }

    db.prepare(
      `
      INSERT INTO analytics_events (
        event_time,
        session_id,
        event_name,
        event_group,
        status,
        page_path,
        attempted_url,
        source_url,
        export_format,
        error_code,
        error_message,
        referrer,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_term,
        utm_content,
        user_agent,
        ip_address,
        metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      row.eventTime,
      row.sessionId,
      row.eventName,
      row.eventGroup,
      row.status,
      row.pagePath,
      row.attemptedUrl,
      row.sourceUrl,
      row.exportFormat,
      row.errorCode,
      row.errorMessage,
      row.referrer,
      row.utmSource,
      row.utmMedium,
      row.utmCampaign,
      row.utmTerm,
      row.utmContent,
      row.userAgent,
      row.ipAddress,
      row.metadata,
    );
  });

  try {
    tx();
  } catch (error) {
    console.error('Analytics tracking error:', error);
  }
}

export function getAnalyticsDashboard(limit = 120): AnalyticsDashboard {
  const safeLimit = Math.min(500, Math.max(20, Number(limit) || 120));

  const summary = db
    .prepare(
      `
      SELECT
        (SELECT COUNT(*) FROM analytics_sessions) AS totalSessions,
        (SELECT COUNT(*) FROM analytics_events) AS totalEvents,
        (SELECT COUNT(*) FROM analytics_events WHERE event_name = 'api_extract_request') AS extractAttempts,
        (SELECT COUNT(*) FROM analytics_events WHERE event_name = 'api_extract_result' AND status = 'success') AS extractSuccesses,
        (SELECT COUNT(*) FROM analytics_events WHERE event_name = 'api_extract_result' AND status = 'failure') AS extractFailures,
        (SELECT COUNT(*) FROM analytics_events WHERE event_name = 'api_export_request') AS exportAttempts,
        (SELECT COUNT(*) FROM analytics_events WHERE event_name = 'api_export_result' AND status = 'success') AS exportSuccesses,
        (SELECT COUNT(*) FROM analytics_events WHERE event_name = 'api_export_result' AND status = 'failure') AS exportFailures,
        (SELECT COUNT(*) FROM analytics_events WHERE event_name = 'feedback_submitted' AND status = 'success') AS feedbackSubmissions
      `,
    )
    .get() as AnalyticsDashboard['summary'];

  const exportBreakdown = db
    .prepare(
      `
      SELECT COALESCE(export_format, 'unknown') AS format, COUNT(*) AS count
      FROM analytics_events
      WHERE event_name = 'api_export_result' AND status = 'success'
      GROUP BY export_format
      ORDER BY count DESC
      `,
    )
    .all() as Array<{ format: string; count: number }>;

  const topErrors = db
    .prepare(
      `
      SELECT COALESCE(error_code, 'UNKNOWN') AS errorCode, COUNT(*) AS count
      FROM analytics_events
      WHERE status = 'failure'
      GROUP BY error_code
      ORDER BY count DESC
      LIMIT 12
      `,
    )
    .all() as Array<{ errorCode: string; count: number }>;

  const recentEvents = db
    .prepare(
      `
      SELECT
        id,
        event_time AS eventTime,
        session_id AS sessionId,
        event_name AS eventName,
        event_group AS eventGroup,
        status,
        page_path AS pagePath,
        attempted_url AS attemptedUrl,
        source_url AS sourceUrl,
        export_format AS exportFormat,
        error_code AS errorCode,
        error_message AS errorMessage,
        referrer,
        utm_source AS utmSource,
        utm_medium AS utmMedium,
        utm_campaign AS utmCampaign,
        user_agent AS userAgent,
        ip_address AS ipAddress,
        metadata
      FROM analytics_events
      ORDER BY id DESC
      LIMIT ?
      `,
    )
    .all(safeLimit) as Array<Record<string, unknown>>;

  const recentSessions = db
    .prepare(
      `
      SELECT
        s.session_id AS sessionId,
        s.started_at AS startedAt,
        s.last_seen_at AS lastSeenAt,
        s.landing_page AS landingPage,
        s.landing_referrer AS landingReferrer,
        s.utm_source AS utmSource,
        s.utm_medium AS utmMedium,
        s.utm_campaign AS utmCampaign,
        s.first_ip AS firstIp,
        (
          SELECT COUNT(*)
          FROM analytics_events e
          WHERE e.session_id = s.session_id
        ) AS eventCount,
        (
          SELECT COUNT(*)
          FROM analytics_events e
          WHERE e.session_id = s.session_id AND e.status = 'failure'
        ) AS failureCount
      FROM analytics_sessions s
      ORDER BY s.last_seen_at DESC
      LIMIT 80
      `,
    )
    .all() as Array<Record<string, unknown>>;

  return {
    summary,
    exportBreakdown,
    topErrors,
    recentEvents,
    recentSessions,
  };
}

export function getSessionJourney(sessionId: string): {
  session: Record<string, unknown> | null;
  events: Array<Record<string, unknown>>;
} {
  const safeSessionId = trimNullable(sessionId, 128);
  if (!safeSessionId) {
    return { session: null, events: [] };
  }

  const session = db
    .prepare(
      `
      SELECT
        session_id AS sessionId,
        started_at AS startedAt,
        last_seen_at AS lastSeenAt,
        landing_page AS landingPage,
        landing_referrer AS landingReferrer,
        utm_source AS utmSource,
        utm_medium AS utmMedium,
        utm_campaign AS utmCampaign,
        utm_term AS utmTerm,
        utm_content AS utmContent,
        first_user_agent AS firstUserAgent,
        first_ip AS firstIp
      FROM analytics_sessions
      WHERE session_id = ?
      LIMIT 1
      `,
    )
    .get(safeSessionId) as Record<string, unknown> | undefined;

  const events = db
    .prepare(
      `
      SELECT
        id,
        event_time AS eventTime,
        event_name AS eventName,
        event_group AS eventGroup,
        status,
        page_path AS pagePath,
        attempted_url AS attemptedUrl,
        source_url AS sourceUrl,
        export_format AS exportFormat,
        error_code AS errorCode,
        error_message AS errorMessage,
        referrer,
        utm_source AS utmSource,
        utm_medium AS utmMedium,
        utm_campaign AS utmCampaign,
        metadata
      FROM analytics_events
      WHERE session_id = ?
      ORDER BY id ASC
      LIMIT 2000
      `,
    )
    .all(safeSessionId) as Array<Record<string, unknown>>;

  return { session: session || null, events };
}

function isLikelyBotUserAgent(userAgent: string): boolean {
  const lowered = (userAgent || '').toLowerCase();
  if (!lowered) return true;

  const markers = [
    'bot',
    'spider',
    'crawl',
    'crawler',
    'slurp',
    'headless',
    'phantom',
    'python-requests',
    'python-urllib',
    'curl/',
    'wget/',
    'uptime',
    'monitor',
    'httpclient',
    'postmanruntime',
  ];

  return markers.some((marker) => lowered.includes(marker));
}

export function getPublicUsageMetrics(now = new Date()): PublicUsageMetrics {
  const utcStartToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const utcStart7Days = new Date(utcStartToday.getTime() - 6 * 24 * 60 * 60 * 1000);

  const sessions = db
    .prepare(
      `
      SELECT
        s.session_id AS sessionId,
        s.started_at AS startedAt,
        s.last_seen_at AS lastSeenAt,
        COALESCE(s.first_user_agent, '') AS firstUserAgent,
        (
          SELECT COUNT(*)
          FROM analytics_events e
          WHERE e.session_id = s.session_id
        ) AS eventCount,
        (
          SELECT COUNT(*)
          FROM analytics_events e
          WHERE e.session_id = s.session_id
            AND (
              e.event_group IN ('extract', 'export', 'settings')
              OR e.event_name IN (
                'extract_submit',
                'extract_result',
                'batch_extract_submit',
                'batch_extract_result',
                'api_extract_request',
                'api_extract_result',
                'api_export_request',
                'api_export_result'
              )
            )
        ) AS toolEventCount,
        (
          SELECT COUNT(*)
          FROM analytics_events e
          WHERE e.session_id = s.session_id
            AND e.status = 'success'
        ) AS successEventCount
      FROM analytics_sessions s
      `,
    )
    .all() as Array<{
    sessionId: string;
    startedAt: string;
    lastSeenAt: string;
    firstUserAgent: string;
    eventCount: number;
    toolEventCount: number;
    successEventCount: number;
  }>;

  let totalUsers = 0;
  let usersToday = 0;
  let usersLast7Days = 0;
  let excludedBotSessions = 0;
  let excludedLowQualitySessions = 0;

  for (const session of sessions) {
    const botLike = isLikelyBotUserAgent(session.firstUserAgent || '');
    if (botLike) {
      excludedBotSessions += 1;
      continue;
    }

    const startedAtMs = Date.parse(session.startedAt || '');
    const lastSeenAtMs = Date.parse(session.lastSeenAt || '');
    const sessionDurationMs =
      Number.isFinite(startedAtMs) && Number.isFinite(lastSeenAtMs)
        ? Math.max(0, lastSeenAtMs - startedAtMs)
        : 0;

    const lowQuality =
      Number(session.eventCount || 0) < 2 ||
      Number(session.toolEventCount || 0) < 1 ||
      (sessionDurationMs < 4_000 && Number(session.successEventCount || 0) === 0);

    if (lowQuality) {
      excludedLowQualitySessions += 1;
      continue;
    }

    totalUsers += 1;

    if (Number.isFinite(startedAtMs)) {
      if (startedAtMs >= utcStartToday.getTime()) {
        usersToday += 1;
      }

      if (startedAtMs >= utcStart7Days.getTime()) {
        usersLast7Days += 1;
      }
    }
  }

  const pagesParsedTotals = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN event_time >= ? THEN 1 ELSE 0 END) AS last7Days
      FROM analytics_events
      WHERE event_name = 'api_extract_result' AND status = 'success'
      `,
    )
    .get(utcStart7Days.toISOString()) as { total: number; last7Days: number | null };

  const docsExportedTotals = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN event_time >= ? THEN 1 ELSE 0 END) AS last7Days
      FROM analytics_events
      WHERE event_name = 'api_export_result' AND status = 'success'
      `,
    )
    .get(utcStart7Days.toISOString()) as { total: number; last7Days: number | null };

  return {
    totalUsers,
    usersToday,
    usersLast7Days,
    pagesParsedTotal: Number(pagesParsedTotals?.total || 0),
    pagesParsedLast7Days: Number(pagesParsedTotals?.last7Days || 0),
    docsExportedTotal: Number(docsExportedTotals?.total || 0),
    docsExportedLast7Days: Number(docsExportedTotals?.last7Days || 0),
    totalTrackedSessions: sessions.length,
    excludedBotSessions,
    excludedLowQualitySessions,
    updatedAt: now.toISOString(),
  };
}
