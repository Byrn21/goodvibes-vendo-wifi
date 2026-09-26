# Koyeb Deployment Guide

Deploy your Omada captive portal backend to **Koyeb** — completely free, no credit card required.

---

## ✅ What You Get (Free Forever)

- **2 free web services** (1 backend + 1 database/worker)
- **No cold starts** on free tier
- **512 MB RAM** per service
- **2 GB disk storage**
- **Automatic HTTPS** and custom domains
- **Global edge network** (low latency)
- **No payment info required**

---

## 🚀 Quick Deployment

### **Step 1: Create Koyeb Account**

1. Go to https://www.koyeb.com
2. Sign up with GitHub (easiest) or email
3. **No credit card required** ✅

### **Step 2: Deploy from GitHub**

1. Click **"Create App"**
2. Select **"GitHub"** as source
3. Connect your repository: `Byrn21/goodvibes-vendo-wifi`
4. Configure deployment:

```yaml
App Name: goodvibes-vendo-wifi
Region: Choose closest to your location (Singapore for PH)
Builder: Buildpack
Build Command: cd backend && npm install
Run Command: cd backend && npm start
Port: 8080
```

### **Step 3: Add Environment Variables**

Click **"Environment"** tab and add these variables:

```bash
NODE_ENV=production
PORT=8080
BASE_URL=https://goodvibes-vendo-wifi-[your-org].koyeb.app
FRONTEND_ORIGIN=https://your-frontend-url.pages.dev

# Omada Controller
OMADA_BASE_URL=https://192.168.1.252:8043
OMADA_API_TOKEN=your-controller-api-token-here
OMADA_SITE=Default
OMADA_TLS_REJECT=true
OMADA_MOCK=false

# Database (SQLite - already configured)
DATABASE_URL=sqlite:./data/portal.db

# Session Settings
DEFAULT_SESSION_DURATION=60
SESSION_DURATION_OPTIONS=60,120,180,360,720,1440
PAUSE_ENABLED=true
SESSION_ENFORCE_INTERVAL=60000

# Redirect Settings
ALLOWED_REDIRECT_DOMAINS=
DEFAULT_REDIRECT_URL=https://www.google.com

# Security
JWT_SECRET=<GENERATE_RANDOM_STRING_HERE>
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=20
CORS_ORIGINS=https://your-frontend-url.pages.dev

# Logging
LOG_LEVEL=info
```

### **Step 4: Add Persistent Storage**

1. Scroll to **"Volumes"** section
2. Click **"Add Volume"**
3. Configure:
   - **Name**: `portal-data`
   - **Size**: `1 GB` (free tier)
   - **Mount Path**: `/workspace/backend/data`

### **Step 5: Deploy**

1. Click **"Deploy"**
2. Wait 2-3 minutes for build
3. Your backend will be live at:
   ```
   https://goodvibes-vendo-wifi-[your-org].koyeb.app
   ```

---

## 🔧 Post-Deployment

### **1. Test Your Backend**

```bash
# Health check
curl https://goodvibes-vendo-wifi-[your-org].koyeb.app/api/health

# Expected response:
# {"success":true,"message":"Server is healthy"}
```

### **2. Update Frontend Config**

Edit `config/config.js`:

```javascript
const BACKEND_URL = 'https://goodvibes-vendo-wifi-[your-org].koyeb.app';
```

### **3. Generate JWT Secret**

```bash
# Generate a secure random string
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy output and update `JWT_SECRET` in Koyeb environment variables.

---

## 📊 Monitoring

### **View Logs**

1. Go to Koyeb dashboard
2. Select your app
3. Click **"Logs"** tab
4. Real-time logs appear here

### **Check Metrics**

- CPU usage
- Memory usage
- Request count
- Response times

All visible in the **"Metrics"** tab.

---

## 🔄 Auto-Deploy on Git Push

Koyeb automatically redeploys when you push to `main`:

```bash
git add .
git commit -m "Update backend"
git push origin main
# Koyeb auto-deploys in 2-3 minutes ✅
```

---

## 🛠️ Troubleshooting

### **Issue: Database resets on deploy**

**Cause**: SQLite file is not in persistent volume

**Fix**: Ensure volume is mounted at `/workspace/backend/data`

### **Issue: "Cannot connect to Omada Controller"**

**Cause**: Your Omada controller is on a local network, Koyeb cannot reach it

**Solutions**:
1. Use **OMADA_MOCK=true** for testing without controller
2. Deploy on-premise instead (use Oracle Cloud Always Free VM)
3. Expose your controller via VPN/tunnel (not recommended for security)

### **Issue: CORS errors**

**Fix**: Update `CORS_ORIGINS` to match your frontend URL exactly

---

## 💰 Cost Breakdown

| Resource | Koyeb Free Tier | Cost |
|----------|-----------------|------|
| Web Service | 512 MB RAM | **$0** |
| Persistent Disk | 1 GB | **$0** |
| Custom Domain | Yes | **$0** |
| HTTPS | Yes | **$0** |
| **Total** | | **$0/month** |

No limits, no trials, free forever.

---

## 📚 Additional Resources

- [Koyeb Documentation](https://www.koyeb.com/docs)
- [Koyeb CLI](https://www.koyeb.com/docs/cli)
- [Community Support](https://community.koyeb.com)

---

## 🎯 Next Steps

1. ✅ Backend deployed on Koyeb
2. ⬜ Deploy frontend to Cloudflare Pages / GitHub Pages
3. ⬜ Configure Omada controller to use your captive portal
4. ⬜ Test end-to-end with a voucher

See **FRONTEND_DEPLOYMENT.md** for frontend setup.
