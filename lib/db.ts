import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dataDir = path.join(process.cwd(), 'data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'clearpage.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submitted_at TEXT NOT NULL,
    failed_url TEXT,
    error_code TEXT,
    checked_reasons TEXT,
    free_text TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS analytics_sessions (
    session_id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    landing_page TEXT,
    landing_referrer TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_term TEXT,
    utm_content TEXT,
    first_user_agent TEXT,
    first_ip TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS analytics_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_time TEXT NOT NULL,
    session_id TEXT,
    event_name TEXT NOT NULL,
    event_group TEXT,
    status TEXT,
    page_path TEXT,
    attempted_url TEXT,
    source_url TEXT,
    export_format TEXT,
    error_code TEXT,
    error_message TEXT,
    referrer TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_term TEXT,
    utm_content TEXT,
    user_agent TEXT,
    ip_address TEXT,
    metadata TEXT
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_analytics_events_time
  ON analytics_events(event_time DESC)
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_analytics_events_session
  ON analytics_events(session_id)
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_analytics_events_name
  ON analytics_events(event_name)
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_analytics_events_status
  ON analytics_events(status)
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_analytics_events_error_code
  ON analytics_events(error_code)
`);

export default db;
