# GoodVibesVendoWifi — Deployment Guide

## Overview

| Layer | Service | Cost | URL |
|---|---|---|---|
| Frontend (portal) | GitHub Pages | Free | `goodvibesvendowifi.pages.dev` |
| Backend (API + webhooks) | Fly.io | Free tier | `goodvibesvendowifi-backend.fly.dev` |
| DNS + SSL | Cloudflare | Free | `goodvibesvendowifi.com` |

---

## Step 1 — Push Code to GitHub

### 1a. Create a GitHub repository

1. Go to [github.com](https://github.com) and sign in.
2. Click **New repository**.
3. Name it `goodvibes-vendo-wifi` (or your choice).
4. Set it to **Public** (GitHub Pages requires public repos on free tier).
5. Click **Create repository** — leave it empty (don't initialize with README).

### 1b. Push your local code

In your terminal (`PowerShell` or `Git Bash`), run these commands — replace `YOUR_USERNAME` with your GitHub username:

```powershell
cd C:\Users\Admin\omada-captive-portal
git remote add origin https://github.com/YOUR_USERNAME/goodvibes-vendo-wifi.git
git add .
git commit -m "Initial commit: GoodVibesVendoWifi captive portal"
git branch -M main
git push -u origin main
```

> **Important:** Before pushing, confirm that `.env` is in `.gitignore` — it should be. Never commit secrets.

---

## Step 2 — Enable GitHub Pages

### 2a. Configure the repository

1. Open your repo on GitHub: `https://github.com/YOUR_USERNAME/goodvibes-vendo-wifi`
2. Go to **Settings** → **Pages** (left sidebar).
3. Under **Source**, select:
   - **Branch:** `main`
   - **Folder:** `/ (root)`
4. Click **Save**.

GitHub will build and publish your site. After 1–2 minutes, your portal will be live at:

```
https://YOUR_USERNAME.github.io/goodvibes-vendo-wifi/
```

Or, if you configure a custom domain through Cloudflare:

```
https://goodvibesvendowifi.com/
```

### 2b. Test locally before deploying

If you want to preview before pushing:

```powershell
cd C:\Users\Admin\omada-captive-portal
# Option A: Open index.html directly in browser
# Option B: Use a simple HTTP server
python -m http.server 8080
# Then open http://localhost:8080
```

---

## Step 3 — Deploy Backend to Fly.io

Fly.io's free tier includes:
- 3 shared VMs (1GB RAM, shared CPU)
- 160GB outbound bandwidth/month
- **No credit card required** for limited free tier

### 3a. Install Flyctl

In PowerShell:

```powershell
iwr https://fly.io/install.ps1 -useb | iex
```

Or on Git Bash / WSL:

```bash
curl -L https://fly.io/install.sh | sh
```

After installing, authenticate:

```powershell
fly auth login
```

### 3b. Launch the app

```powershell
cd C:\Users\Admin\omada-captive-portal\backend
fly launch
```

When asked:
- **App name:** `goodvibesvendowifi-backend` (or press Enter to accept default)
- **Region:** Choose closest to Philippines — select `Manila` (`nrt`) or `Singapore` (`sin`)
- **Would you like to set up a Postgres database now?** → `No`
- **Would you like to set up an Upstash Redis database now?** → `No`
- **Would you like to deploy now?** → `No` (we need to set secrets first)

### 3c. Set secrets

Fly.io stores secrets securely. Run this for each secret — **replace the placeholder values** with your real credentials:

```powershell
# Payment provider secrets
fly secrets set XENDIT_SECRET_KEY="your_real_xendit_secret_key"
fly secrets set XENDIT_WEBHOOK_SECRET="your_real_xendit_webhook_secret"

# Omada controller secrets
fly secrets set OMADA_API_TOKEN="your_controller_api_token"

# Change the JWT secret to something random
fly secrets set JWT_SECRET="$(python -c 'import secrets; print(secrets.token_hex(32))')"

# Base URL (update this after first deployment)
fly secrets set BASE_URL="https://goodvibesvendowifi-backend.fly.dev"
```

### 3d. Deploy

```powershell
fly deploy
```

On first deploy, Fly.io will:
1. Build a Docker image from `backend/Dockerfile`
2. Upload it to Fly's registry
3. Start the VM in your chosen region

After deploy completes, you'll see output like:

```
==> Monitoring deployment
 1 desired, 1 placed, 1 healthy, 0 unhealthy [health checks: 1 total, 1 passing]
```

### 3e. Get your backend URL

```powershell
fly info
```

Look for the **Public IP** or **Hostname** field — it will be something like:

```
https://goodvibesvendowifi-backend.fly.dev
```

### 3f. Verify it's running

```powershell
curl https://goodvibesvendowifi-backend.fly.dev/api/health
```

You should get a JSON response like `{"ok":true}`. If not, check logs:

```powershell
fly logs
```

---

## Step 4 — Configure Cloudflare (DNS + SSL)

### 4a. Register or transfer a domain

If you don't have a domain yet:
1. Buy one through Cloudflare Registrar (`.com` ≈ $10/year) or any registrar.
2. Transfer it to Cloudflare for free SSL and DNS management.

If using an existing domain:
1. Log in to your current registrar.
2. Change the **nameservers** to Cloudflare's nameservers:
   - `ns1.cloudflare.com`
   - `ns2.cloudflare.com`

### 4b. Add DNS records in Cloudflare Dashboard

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Select your domain.
3. Go to **DNS** → **Records**.

Add these records:

| Type | Name | Content | Proxy status |
|---|---|---|---|
| A | `@` | `76.76.21.21` | DNS only (unproxied) | ← GitHub Pages
| A | `www` | `76.76.21.21` | DNS only (unproxied) | ← GitHub Pages
| CNAME | `api` | `goodvibesvendowifi-backend.fly.dev` | DNS only (unproxied) | ← Fly.io backend

> **Why DNS-only?** GitHub Pages and Fly.io require TLS validation through DNS `CNAME`/`A` records. Do not proxy these through Cloudflare (grey cloud), otherwise Let's Encrypt validation will fail.

### 4c. Enable SSL/TLS

1. Go to **SSL/TLS** → **Overview**.
2. Set encryption mode to **Full (strict)**.
3. For Fly.io: install a certificate:

```powershell
fly certs create api.goodvibesvendowifi.com
```

Then update your DNS CNAME to point to the new certificate hostname Fly.io provides.

### 4d. Configure custom domains on Fly.io

```powershell
cd C:\Users\Admin\omada-captive-portal\backend
fly certs create goodvibesvendowifi.com
fly certs create api.goodvibesvendowifi.com
```

Follow the instructions to add the TXT records Cloudflare shows.

---

## Step 5 — Update Configuration Files

After getting your real URLs, update these files:

### `config/config.js`

```javascript
apiBaseUrl: 'https://api.goodvibesvendowifi.com',  // or your Fly.io URL
allowedRedirectDomains: [
  'goodvibesvendowifi.com',
  'api.goodvibesvendowifi.com',
  'captive.apple.com',
  'connectivitycheck.gstatic.com',
],
```

### `backend/.env`

```env
BASE_URL=https://api.goodvibesvendowifi.com
FRONTEND_ORIGIN=https://goodvibesvendowifi.com
```

Then push to GitHub:

```powershell
git add .
git commit -m "Update production URLs"
git push
```

---

## Step 6 — Configure Xendit Webhook

For payments to work, Xendit needs to call your backend when a payment completes.

1. Log in to [dashboard.xendit.co](https://dashboard.xendit.co)
2. Go to **Developers** → **Webhooks**
3. Add a new webhook:

```
URL: https://goodvibesvendowifi-backend.fly.dev/api/payment/webhook
Events: Invoice Payment Succeeded, Invoice Payment Failed
```

4. Copy the **webhook secret** and update your Fly.io secret:

```powershell
fly secrets set XENDIT_WEBHOOK_SECRET="your_webhook_secret"
fly deploy
```

---

## Step 7 — Configure Omada Controller

Get your controller API token from the Omada SDN Controller:
1. Log into the Omada Controller web UI.
2. Go to **Settings** → **User Access** (or API access).
3. Generate an API key/token.

Update your Fly.io secret:

```powershell
fly secrets set OMADA_API_TOKEN="your_omada_api_token"
fly secrets set OMADA_BASE_URL="https://your-controller-ip:8043"
fly deploy
```

---

## Step 8 — Test the Full Payment Flow

### Test locally first

1. Start the backend locally:
   ```powershell
   cd C:\Users\Admin\omada-captive-portal\backend
   npm install
   npm run dev
   ```

2. Open `index.html` in a browser.
3. Click a payment tile (e.g., GCash).
4. Complete the Xendit checkout flow.
5. Verify the webhook hits your backend (`fly logs`).

### Test on production

1. Open your deployed portal: `https://goodvibesvendowifi.com`
2. Click a payment tile.
3. Check Fly.io logs:
   ```powershell
   fly logs
   ```

You should see webhook events logged:

```
[Webhook processing] Event: invoice.paid, session: sess_xxxx
[activatePaidSession] Omada auth: clientMac=xx:xx:xx:xx:xx:xx
```

---

## Architecture Summary

```
[User connects to WiFi]
        │
        ▼
[Omada redirects to captive portal]
   https://goodvibesvendowifi.com/index.html?clientMac=...&ssidName=...
        │
        ▼
[User clicks payment tile (e.g., GCash)]
   POST https://api.goodvibesvendowifi.com/api/payment/initiate
        │
        ▼
[Backend creates Xendit invoice, returns checkout URL]
   { checkoutUrl: "https://checkout.xendit.co/invoice/..." }
        │
        ▼
[Browser redirects to Xendit checkout]
        │
        ▼
[User completes payment in GCash/Maya/QRPh app]
        │
        ▼
[Xendit sends webhook to backend]
   POST https://api.goodvibesvendowifi.com/api/payment/webhook
        │
        ▼
[Backend verifies webhook, activates session in Omada]
   OmadaController.extPortal.auth(clientMac=..., sessionId=...)
        │
        ▼
[Browser redirects to success page]
   https://goodvibesvendowifi.com/success.html?sessionId=...
        │
        ▼
[User has internet access!]
```

---

## Troubleshooting

### "Cannot connect to captive portal"
- Make sure Omada's external portal is configured to redirect to your deployed URL.
- Check `config/config.js` → `apiBaseUrl` matches your Fly.io URL.

### "Payment webhook not firing"
- Check Fly.io logs: `fly logs`
- Verify Xendit webhook is configured at `dashboard.xendit.co`
- Make sure `XENDIT_WEBHOOK_SECRET` matches in both Xendit dashboard and Fly.io secrets.

### "Omada auth failing"
- Verify `OMADA_BASE_URL` and `OMADA_API_TOKEN` are correct.
- Check that your Omada controller allows external portal auth.

### "GitHub Pages not updating"
- Go to repo **Settings** → **Pages** → check the deployment status.
- GitHub Pages can take up to 5 minutes to update after a push.

### "Fly.io app not responding"
- Check health: `curl https://goodvibesvendowifi-backend.fly.dev/api/health`
- View logs: `fly logs`
- SSH into the VM: `fly ssh console`
