-- D1 schema for portfolio analytics
-- Apply with: wrangler d1 execute portfolio_analytics --file=cloudflare/schema.sql --remote

CREATE TABLE IF NOT EXISTS views (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         INTEGER NOT NULL,
    path       TEXT    NOT NULL,
    referrer   TEXT    NOT NULL DEFAULT '',
    ua         TEXT    NOT NULL DEFAULT '',
    country    TEXT    NOT NULL DEFAULT '',
    city       TEXT    NOT NULL DEFAULT '',
    region     TEXT    NOT NULL DEFAULT '',
    org        TEXT    NOT NULL DEFAULT '',
    asn        TEXT    NOT NULL DEFAULT '',
    ip_hash    TEXT    NOT NULL DEFAULT '',
    screen     TEXT    NOT NULL DEFAULT '',
    is_bot     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_views_ts      ON views(ts DESC);
CREATE INDEX IF NOT EXISTS idx_views_path    ON views(path);
CREATE INDEX IF NOT EXISTS idx_views_org     ON views(org);
CREATE INDEX IF NOT EXISTS idx_views_country ON views(country);
CREATE INDEX IF NOT EXISTS idx_views_is_bot  ON views(is_bot);
