import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export function resolveDataDir(): string {
  const custom = process.env.CLEARPAGE_DATA_DIR?.trim();
  if (custom) return custom;

  if (process.env.VERCEL) {
    return path.join('/tmp', 'clearpage-data');
  }

  return path.join(process.cwd(), 'data');
}

function openDatabase(): Database.Database {
  const dataDir = resolveDataDir();
  const filePath = path.join(dataDir, 'clearpage.db');

  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const fileDb = new Database(filePath);
    try {
      fileDb.pragma('journal_mode = WAL');
    } catch {
      // Some runtimes/filesystems do not support WAL.
    }
    return fileDb;
  } catch (error) {
    console.error('Database file initialization failed, falling back to in-memory DB:', error);
    return new Database(':memory:');
  }
}

const db = openDatabase();

function hasColumn(tableName: string, columnName: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function ensureColumn(tableName: string, columnName: string, definition: string): void {
  if (hasColumn(tableName, columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

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

db.exec(`
  CREATE TABLE IF NOT EXISTS batch_jobs (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    status TEXT NOT NULL,
    input_mode TEXT NOT NULL DEFAULT 'url',
    export_format TEXT NOT NULL,
    images_mode TEXT NOT NULL,
    settings_json TEXT,
    total_urls INTEGER NOT NULL,
    processed_urls INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    average_duration_ms INTEGER,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL,
    last_error_code TEXT,
    last_error_message TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS batch_job_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    url TEXT NOT NULL,
    status TEXT NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    extraction_id TEXT,
    source_url TEXT,
    title TEXT,
    original_filename TEXT,
    content_type TEXT,
    byte_size INTEGER,
    source_object_key TEXT,
    output_object_key TEXT,
    output_filename TEXT,
    output_format TEXT,
    error_code TEXT,
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY(job_id) REFERENCES batch_jobs(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS batch_uploads (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    object_key TEXT NOT NULL,
    object_url TEXT,
    download_url TEXT,
    original_filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )
`);

ensureColumn('batch_jobs', 'input_mode', "TEXT NOT NULL DEFAULT 'url'");
ensureColumn('batch_job_items', 'original_filename', 'TEXT');
ensureColumn('batch_job_items', 'content_type', 'TEXT');
ensureColumn('batch_job_items', 'byte_size', 'INTEGER');
ensureColumn('batch_job_items', 'source_object_key', 'TEXT');
ensureColumn('batch_job_items', 'output_object_key', 'TEXT');
ensureColumn('batch_job_items', 'output_filename', 'TEXT');
ensureColumn('batch_job_items', 'output_format', 'TEXT');

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_batch_jobs_status_created
  ON batch_jobs(status, created_at)
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_batch_items_job_position
  ON batch_job_items(job_id, position)
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_batch_items_job_status
  ON batch_job_items(job_id, status)
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_batch_uploads_created
  ON batch_uploads(created_at)
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_batch_uploads_session
  ON batch_uploads(session_id, created_at)
`);

export default db;
