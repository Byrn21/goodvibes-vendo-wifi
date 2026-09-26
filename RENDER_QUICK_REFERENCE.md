# Quick Reference: Render Deployment

## 🚀 Deploy Command (After pushing to Git)

```bash
# 1. Commit and push
git add .
git commit -m "Configure for Render deployment with SQLite"
git push origin main

# 2. Go to Render Dashboard
# https://dashboard.render.com
```

## 🔑 Required Environment Variables

Copy these into Render dashboard under **Environment**:

```bash
# URLs
BASE_URL=https://YOUR-APP-NAME.onrender.com
FRONTEND_ORIGIN=https://your-frontend-domain.com

# Omada Controller
OMADA_BASE_URL=https://192.168.1.252:8043
OMADA_API_TOKEN=your_controller_token_here
OMADA_SITE=Default

# Security
JWT_SECRET=generate_a_random_32_char_secret
CORS_ORIGINS=https://your-frontend-domain.com

# Payment (Xendit)
XENDIT_SECRET_KEY=xnd_...
XENDIT_WEBHOOK_SECRET=whsec_...
```

## 📦 Render Service Configuration

| Setting | Value |
|---------|-------|
| **Type** | Web Service |
| **Region** | Singapore (or closest) |
| **Branch** | main |
| **Build Command** | `cd backend && npm install && npm run db:migrate` |
| **Start Command** | `cd backend && npm start` |
| **Plan** | Free |

## 💾 Persistent Disk

| Setting | Value |
|---------|-------|
| **Name** | portal-data |
| **Mount Path** | `/opt/render/project/src/backend/data` |
| **Size** | 1 GB |

## ✅ Testing After Deployment

```bash
# Health check
curl https://YOUR-APP-NAME.onrender.com/health

# Expected response:
{"ok":true,"timestamp":"2026-09-26T...","env":"production"}
```

## 🔗 Webhook URL (for Xendit)

```
https://YOUR-APP-NAME.onrender.com/api/payment/webhook
```

## 🐛 Common Issues

### Issue: Database migration failed
**Fix**: Ensure persistent disk is mounted at `/opt/render/project/src/backend/data`

### Issue: Omada connection failed
**Fix**: 
- Verify `OMADA_BASE_URL` is accessible from internet
- Check firewall rules
- For self-signed certs, set `OMADA_TLS_REJECT=false`

### Issue: Cold start too slow
**Fix**: This is normal on free tier (30s). Upgrade to Starter plan ($7/mo) for always-on.

## 📊 Free Tier Limits

- ✅ 750 hours/month compute (24/7 coverage)
- ✅ 1 GB persistent storage
- ⚠️ Spins down after 15 min inactivity
- ⚠️ 30-50 second cold start after sleep

## 💡 Pro Tips

1. **Backup your database**: Download from Render Shell regularly
2. **Monitor logs**: Dashboard → Logs (live tail)
3. **Test vouchers**: Use `WIFI-TEST-0001` (after seeding)
4. **Payment testing**: Use Xendit test mode first

---

**Full Documentation**: See `RENDER_DEPLOYMENT.md` for detailed guide
