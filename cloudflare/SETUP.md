# Analytics Setup Guide

End state: every pageview on sundharganesh.in is logged to a private database. You and only you can view the dashboard at https://sundharganesh.in/analytics, gated by Cloudflare Access (one-time PIN to your email).

Pieces involved:
- GitHub Pages (the static site, already live)
- Cloudflare (DNS + Worker + D1 database + Access)
- A small Cloudflare Worker that logs and reads pageviews
- The `analytics/index.html` page in this repo (already built)

You should be able to finish this in about 45 minutes. Steps are in strict order.

---

## 0. What you need

- A Cloudflare account (free). Sign up at https://dash.cloudflare.com if you have not.
- Access to your domain registrar where sundharganesh.in is registered (to change nameservers).
- Node.js 18+ installed locally so you can run `wrangler` (Cloudflare's CLI).
- Your email ganeshmuthvel303@gmail.com (this is what Cloudflare Access will send the login PIN to).

---

## 1. Add sundharganesh.in to Cloudflare

1. In the Cloudflare dashboard, click **Add a Site** and enter `sundharganesh.in`.
2. Pick the **Free** plan.
3. Cloudflare will scan your existing DNS records. It should auto-import the `CNAME` records pointing to `sundharganesh.github.io` (or whatever GH Pages target you use).
4. Cloudflare will give you two new nameservers (something like `xxx.ns.cloudflare.com`).
5. Go to your registrar and replace the existing nameservers with those two. Save.
6. DNS propagation can take a few minutes to a few hours. Cloudflare will email you when the zone is **Active**. Do NOT continue until it is active.

> Sanity check: open https://sundharganesh.in once Cloudflare is active. It should still serve the portfolio normally. If anything broke, the most likely cause is a DNS record that didn't come over. Compare DNS in Cloudflare against your old registrar settings.

In the Cloudflare DNS panel for `sundharganesh.in`, make sure the records pointing to GH Pages have the orange cloud (proxy) **enabled**. Without orange cloud, the Worker route won't fire.

---

## 2. Install Wrangler and log in

In a terminal on your machine, from the repo root:

```bash
npm install -g wrangler
wrangler login
```

This opens a browser tab and links the CLI to your Cloudflare account.

Confirm you are logged in:

```bash
wrangler whoami
```

---

## 3. Create the D1 database

```bash
cd cloudflare
wrangler d1 create portfolio_analytics
```

Output will look like:

```
✅ Successfully created DB 'portfolio_analytics'
[[d1_databases]]
binding = "DB"
database_name = "portfolio_analytics"
database_id = "abcd1234-5678-90ef-aaaa-bbbbcccccccc"
```

Copy the `database_id`. Open `wrangler.toml` and replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with that value.

> Note: `account_id` is left commented out by default. Wrangler will automatically use the account you logged in with. You only need to uncomment and set it if you have multiple Cloudflare accounts on the same login.

---

## 4. Apply the schema

From the `cloudflare/` directory:

```bash
wrangler d1 execute portfolio_analytics --file=schema.sql --remote
```

You should see "Executed N commands". This creates the `views` table.

---

## 5. Set the IP salt secret

The salt is used to one-way hash visitor IPs so the raw IP never lands in the database. Pick a long random string and feed it in:

```bash
wrangler secret put IP_SALT
```

Paste a random string when prompted. Anything 32+ random characters is fine. **Do not commit this string anywhere.** If you ever lose it the "unique visitor" count will reset across hashes; no other harm done.

---

## 6. Deploy the Worker

From the `cloudflare/` directory:

```bash
wrangler deploy
```

After deploy, smoke test it.

**PowerShell (Windows):**

```powershell
Invoke-RestMethod -Method Post -Uri "https://sundharganesh.in/api/track" -ContentType "application/json" -Body '{"path":"/setup-test","referrer":""}'
```

**Bash / macOS / Linux:**

```bash
curl -X POST https://sundharganesh.in/api/track \
     -H "Content-Type: application/json" \
     -d '{"path":"/setup-test","referrer":""}'
```

You should get `ok` back either way. (PowerShell's built-in `curl` alias is actually `Invoke-WebRequest` and does not accept bash-style flags - that's why we use `Invoke-RestMethod`.)

Confirm it landed in D1.

**PowerShell:**

```powershell
wrangler d1 execute portfolio_analytics --remote --command "SELECT id, ts, path, country, org FROM views ORDER BY ts DESC LIMIT 5;"
```

**Bash:**

```bash
wrangler d1 execute portfolio_analytics --remote \
  --command "SELECT id, ts, path, country, org FROM views ORDER BY ts DESC LIMIT 5;"
```

You should see your test row.

> Heads up: bash uses `\` to continue a command across lines. PowerShell uses backtick `` ` ``. If you copy a multi-line bash command into PowerShell, either join it into one line or replace each `\` with backtick.

---

## 7. Protect /analytics and /api/list with Cloudflare Access

You want only your email (ganeshmuthvel303@gmail.com) to be able to view the dashboard. This uses Cloudflare's Zero Trust product (free for under 50 users).

1. In the Cloudflare dashboard, go to **Zero Trust** (icon on the left sidebar). If it asks you to create a team, accept the defaults and pick a team name (e.g. `sundharganesh`).
2. Inside Zero Trust, go to **Access -> Applications -> Add an application -> Self-hosted**.
3. Fill in:
   - **Application name:** `Portfolio Analytics`
   - **Session duration:** 24 hours (or longer if you prefer)
   - **Application domain:** Add two entries:
     - `sundharganesh.in` path `/analytics*`
     - `sundharganesh.in` path `/api/list`
     - `sundharganesh.in` path `/api/stats`
4. Click **Next** to add a policy:
   - **Policy name:** `Only me`
   - **Action:** Allow
   - **Include:** rule `Emails`, value `ganeshmuthvel303@gmail.com`
5. Identity providers: leave the default `One-time PIN` enabled. That's what emails you a 6-digit login code.
6. Save.

Test it: open an incognito window and go to https://sundharganesh.in/analytics. Cloudflare should redirect to a login page. Enter your email. Check inbox, get the PIN, enter it. You should land on your dashboard.

> If you ever lose access to that email, you can edit the Access policy from another browser as long as you can still log into your Cloudflare account.

---

## 8. Verify the full pipeline

1. Open https://sundharganesh.in in a fresh incognito window. Browse a few pages.
2. Open https://sundharganesh.in/analytics in your normal browser. Sign in via Cloudflare Access PIN.
3. The dashboard should show the pageviews you just generated with location, org/network, and referrer.

If it doesn't:
- DevTools network tab: look for POST `/api/track` returning 200.
- DevTools network tab on `/analytics`: GET `/api/list` should return 200 with JSON.
- If `/api/track` returns 4xx/5xx, run `wrangler tail` in the `cloudflare/` directory and refresh the page. Logs will show the error.

---

## 9. Day-to-day operations

- **View raw data fast:** `wrangler d1 execute portfolio_analytics --remote --command "SELECT * FROM views ORDER BY ts DESC LIMIT 20;"`
- **Wipe and restart:** `wrangler d1 execute portfolio_analytics --remote --command "DELETE FROM views;"`
- **Tail live logs:** `cd cloudflare && wrangler tail`
- **Redeploy the Worker after editing worker.js:** `cd cloudflare && wrangler deploy`

---

## 10. What you will and will not see

You **will** see:
- Every pageview on the public site (path, time, referrer)
- Country, region, city of the visitor (from Cloudflare's geo data)
- The ASN / network operator (e.g. "Reliance Jio", "Infosys Limited", "Amazon AWS")
- A bot flag for obvious crawlers (search engines, uptime monitors)

You **will not** see:
- The visitor's name, email, or any personal identifier
- The raw IP (only a salted hash, used for unique-visitor counts)
- The org of visitors browsing from home, mobile, or VPN (it just shows the ISP name in those cases)

Realistic expectation: when a recruiter at a large company browses from their office network, you'll see their employer's name. When they browse from home, you'll see "Reliance Jio Infocomm Limited" or similar. Treat the org column as a signal, not a verdict.

---

## 11. If you ever want to remove all of this

- `wrangler delete portfolio-analytics` (removes the Worker)
- `wrangler d1 delete portfolio_analytics` (removes the database)
- In Zero Trust -> Access -> Applications, delete the `Portfolio Analytics` application
- Remove the tracking block at the top of `script.js`
- Delete the `analytics/` folder

The Cloudflare DNS can stay or you can move back to your previous DNS host. The site keeps working either way.
