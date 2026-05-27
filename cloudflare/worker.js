/**
 * Sundhar Ganesh portfolio analytics Worker.
 *
 * Routes:
 *   POST /api/track   public, logs a single pageview to D1
 *   GET  /api/list    private (CF Access), returns recent pageviews as JSON
 *   GET  /api/stats   private (CF Access), returns aggregate counts as JSON
 *
 * Bindings (configured in wrangler.toml + secrets):
 *   env.DB        D1 database
 *   env.IP_SALT   secret string used to one-way hash visitor IPs
 *   env.SITE      e.g. "https://sundharganesh.in" used for CORS allowlist
 */

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return cors(new Response(null, { status: 204 }), env);
        }

        try {
            if (url.pathname === '/api/track' && request.method === 'POST') {
                return cors(await handleTrack(request, env), env);
            }
            if (url.pathname === '/api/list' && request.method === 'GET') {
                return cors(await handleList(request, env), env);
            }
            if (url.pathname === '/api/stats' && request.method === 'GET') {
                return cors(await handleStats(request, env), env);
            }
            return new Response('Not found', { status: 404 });
        } catch (err) {
            return new Response(JSON.stringify({ error: String(err && err.message || err) }), {
                status: 500,
                headers: { 'content-type': 'application/json' }
            });
        }
    }
};

async function handleTrack(request, env) {
    let body = {};
    try { body = await request.json(); } catch (_) {}

    const path = sanitize(body.path, 200) || '/';
    const referrer = sanitize(body.referrer, 500);
    const screen = sanitize(body.screen, 32);
    const ua = sanitize(request.headers.get('user-agent') || '', 400);
    const ip = request.headers.get('cf-connecting-ip') || '';
    const cf = request.cf || {};

    const country = sanitize(cf.country, 8);
    const city = sanitize(cf.city, 100);
    const region = sanitize(cf.region, 100);
    const org = sanitize(cf.asOrganization, 200);
    const asn = cf.asn ? String(cf.asn) : '';
    const isBot = looksLikeBot(ua) ? 1 : 0;

    const ipHash = await sha256((env.IP_SALT || 'salt') + ip);

    await env.DB.prepare(
        `INSERT INTO views
         (ts, path, referrer, ua, country, city, region, org, asn, ip_hash, screen, is_bot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        Date.now(), path, referrer, ua,
        country, city, region, org, asn, ipHash, screen, isBot
    ).run();

    return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
}

async function handleList(request, env) {
    const url = new URL(request.url);
    const limit = Math.min(1000, Math.max(1, parseInt(url.searchParams.get('limit') || '200', 10)));
    const range = url.searchParams.get('range') || 'all';
    const hideBots = url.searchParams.get('bots') === '0';

    const since = rangeToTimestamp(range);
    const where = [];
    const params = [];
    if (since) { where.push('ts >= ?'); params.push(since); }
    if (hideBots) { where.push('is_bot = 0'); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const stmt = env.DB.prepare(
        `SELECT id, ts, path, referrer, ua, country, city, region, org, asn, is_bot
         FROM views ${whereSql}
         ORDER BY ts DESC
         LIMIT ?`
    );
    const bound = params.length ? stmt.bind(...params, limit) : stmt.bind(limit);
    const { results } = await bound.all();

    return new Response(JSON.stringify({ rows: results || [] }), {
        headers: { 'content-type': 'application/json' }
    });
}

async function handleStats(request, env) {
    const url = new URL(request.url);
    const range = url.searchParams.get('range') || '30d';
    const since = rangeToTimestamp(range) || 0;

    const totals = await env.DB.prepare(
        `SELECT
            COUNT(*)                       AS total_views,
            COUNT(DISTINCT ip_hash)        AS unique_visitors,
            COUNT(DISTINCT country)        AS countries,
            COUNT(DISTINCT org)            AS orgs,
            SUM(CASE WHEN is_bot=1 THEN 1 ELSE 0 END) AS bot_views
         FROM views
         WHERE ts >= ?`
    ).bind(since).first();

    const topPaths = (await env.DB.prepare(
        `SELECT path, COUNT(*) AS n FROM views WHERE ts >= ? AND is_bot=0
         GROUP BY path ORDER BY n DESC LIMIT 10`
    ).bind(since).all()).results || [];

    const topReferrers = (await env.DB.prepare(
        `SELECT referrer, COUNT(*) AS n FROM views
         WHERE ts >= ? AND is_bot=0 AND referrer != ''
         GROUP BY referrer ORDER BY n DESC LIMIT 10`
    ).bind(since).all()).results || [];

    const topOrgs = (await env.DB.prepare(
        `SELECT org, COUNT(*) AS n FROM views
         WHERE ts >= ? AND is_bot=0 AND org != ''
         GROUP BY org ORDER BY n DESC LIMIT 10`
    ).bind(since).all()).results || [];

    return new Response(JSON.stringify({
        range,
        totals,
        topPaths,
        topReferrers,
        topOrgs
    }), { headers: { 'content-type': 'application/json' } });
}

function rangeToTimestamp(range) {
    const now = Date.now();
    switch (range) {
        case '1d':  return now - 24 * 3600 * 1000;
        case '7d':  return now - 7 * 24 * 3600 * 1000;
        case '30d': return now - 30 * 24 * 3600 * 1000;
        case '90d': return now - 90 * 24 * 3600 * 1000;
        case 'all': return 0;
        default:    return now - 30 * 24 * 3600 * 1000;
    }
}

function sanitize(value, maxLen) {
    if (value == null) return '';
    let s = String(value);
    if (s.length > maxLen) s = s.slice(0, maxLen);
    return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function looksLikeBot(ua) {
    if (!ua) return true;
    const re = /\b(bot|crawler|spider|preview|fetch|http-client|curl|wget|python-requests|axios|node-fetch|headless|monitor|uptime|lighthouse|prerender)\b/i;
    return re.test(ua);
}

async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function cors(response, env) {
    const origin = (env && env.SITE) || 'https://sundharganesh.in';
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, CF-Access-Jwt-Assertion');
    headers.set('Access-Control-Max-Age', '86400');
    headers.set('Vary', 'Origin');
    return new Response(response.body, { status: response.status, headers });
}
