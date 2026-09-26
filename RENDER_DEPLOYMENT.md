# Deploying to Render

This guide shows how to deploy the Omada Captive Portal backend to Render's free tier.

## Prerequisites

- A Render account (sign up at https://render.com)
- Your code pushed to a Git repository (GitHub, GitLab, or Bitbucket)
- Your Omada Controller credentials and settings ready

## Step 1: Push Your Code

```bash
git add .
git commit -m "Configure for Render deployment with SQLite"
git push origin main
```

## Step 2: Create a New Web Service on Render

1. Go to https://dashboard.render.com
2. Click **New +** → **Web Service**
3. Connect your Git repository
4. Configure the service:
   - **Name**: `omada-portal-backend` (or your choice)
   - **Region**: Choose closest to your location
   - **Branch**: `main`
   - **Root Directory**: Leave empty (render.yaml handles this)
   - **Environment**: `Node`
   - **Build Command**: `cd backend && npm install && npm run db:migrate`
   - **Start Command**: `cd backend && npm start`
   - **Plan**: **Free**

## Step 3: Add Environment Variables

In the Render dashboard, go to **Environment** and add these variables:

### Required Variables

```bash
# Backend URLs
BASE_URL=https://your-app-name.onrender.com
FRONTEND_ORIGIN=https://your-frontend-domain.com

# Omada Controller
OMADA_BASE_URL=https://192.168.1.252:8043
OMADA_API_TOKEN=your-controller-api-token-here
OMADA_SITE=Default
OMADA_TLS_REJECT=true

# Security
JWT_SECRET=generate-a-random-secret-here
CORS_ORIGINS=https://your-frontend-domain.com

# Payment Provider (Xendit)
XENDIT_SECRET_KEY=your_xendit_secret_key
XENDIT_WEBHOOK_SECRET=your_xendit_webhook_secret
XENDIT_EWALLET_CHANNELS=GCASH,PAYMAYA,SHOPEEPAY
XENDIT_QRIS_ENABLED=true
```

### Optional Variables (already set in render.yaml)

These are pre-configured in `render.yaml` but can be overridden:

```bash
NODE_ENV=production
PORT=8080
DATABASE_URL=sqlite:./data/portal.db
DEFAULT_SESSION_DURATION=60
PAUSE_ENABLED=true
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=20
```

## Step 4: Add Persistent Disk

1. In the Render dashboard, go to **Disks**
2. Click **Add Disk**
3. Configure:
   - **Name**: `portal-data`
   - **Mount Path**: `/opt/render/project/src/backend/data`
   - **Size**: `1 GB` (free tier)
4. Click **Save**

## Step 5: Deploy

1. Click **Manual Deploy** → **Deploy latest commit**
2. Wait for deployment to complete (~3-5 minutes)
3. Check logs for any errors

## Step 6: Verify Deployment

Test the health endpoint:

```bash
curl https://your-app-name.onrender.com/health
```

Expected response:
```json
{
  "ok": true,
  "timestamp": "2026-09-26T...",
  "env": "production"
}
```

## Step 7: Seed Test Vouchers (Development Only)

If you want test vouchers in production (not recommended):

```bash
# In Render Shell (Dashboard → Shell)
cd backend
NODE_ENV=development npm run db:seed
```

## Important Notes

### Cold Starts

- Free tier services spin down after 15 minutes of inactivity
- First request after sleep takes **30-50 seconds** to wake up
- Subsequent requests are instant
- This is acceptable for captive portals (users expect delays during WiFi login)

### Database Persistence

- SQLite database is stored on the persistent disk
- Data survives across deployments
- **Backup your database regularly** (download via Render Shell)

### OMADA_BASE_URL Configuration

Your Omada Controller must be publicly accessible or on the same network as Render. Options:

1. **Public IP**: Use your controller's public IP with port forwarding
2. **VPN**: Set up a VPN connection (requires paid Render plan)
3. **Cloudflare Tunnel**: Expose your controller securely

### Webhook Configuration

For payment webhooks (Xendit), configure:

```
Webhook URL: https://your-app-name.onrender.com/api/payment/webhook
```

## Monitoring

- **Logs**: Dashboard → Logs (live tail)
- **Metrics**: Dashboard → Metrics (CPU, memory, requests)
- **Health Check**: Automatically pings `/health` endpoint

## Troubleshooting

### Database Migration Failed

Check logs for permission errors. Ensure the disk is mounted correctly at `/opt/render/project/src/backend/data`.

### Omada Connection Failed

1. Verify `OMADA_BASE_URL` is correct and accessible from Render servers
2. Check firewall rules on your controller
3. Set `OMADA_TLS_REJECT=false` if using self-signed certificates (development only)

### Cold Start Too Slow

Upgrade to a paid plan to keep the service always running (no cold starts).

## Cost

- **Free tier**: $0/month
  - 750 hours/month of compute
  - 1 GB persistent disk
  - Spins down after 15 minutes inactivity

- **Starter plan**: $7/month
  - Always running (no cold starts)
  - Better performance
  - More resources

## Next Steps

1. Configure your frontend to point to `https://your-app-name.onrender.com`
2. Test the full authentication flow
3. Set up monitoring and alerts
4. Configure your Omada Controller to use the portal URL
5. Generate production vouchers or configure payment provider
