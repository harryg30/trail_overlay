# Upstash Redis Setup Guide

## Quick Setup via Vercel Marketplace (5 minutes)

### 1. Install Upstash Redis Integration

```bash
# From your project directory
vercel integration add upstash-redis
```

Or visit: https://vercel.com/integrations/upstash

### 2. Follow the prompts:
- Select your project: `trail_overlay`
- Choose plan: **Free** (10K commands/day, 256MB storage)
- Name your database: `trail-overlay-redis`

### 3. Environment Variables (Auto-configured)

The integration automatically adds to your Vercel project:
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

### 4. Pull Environment Variables Locally

```bash
vercel env pull .env.local
```

This creates `.env.local` with your Redis credentials.

### 5. Verify Setup

```bash
# Check that vars are present
cat .env.local | grep UPSTASH
```

You should see:
```
UPSTASH_REDIS_REST_URL="https://xxx.upstash.io"
UPSTASH_REDIS_REST_TOKEN="AXXXxxxxxxxxx"
```

---

## Option B: Manual Setup (if Vercel CLI doesn't work)

### 1. Sign Up for Upstash
- Visit: https://console.upstash.com/
- Sign in with GitHub

### 2. Create a Redis Database
- Click **"Create Database"**
- Name: `trail-overlay`
- Type: **Regional** (cheaper than Global)
- Region: Choose closest to your Vercel deployment (usually `us-east-1`)
- Plan: **Free Tier**

### 3. Get Credentials
After creation, click your database and scroll to **"REST API"** section:
- Copy `UPSTASH_REDIS_REST_URL`
- Copy `UPSTASH_REDIS_REST_TOKEN`

### 4. Add to Vercel Project
```bash
# Add to Vercel environment variables
vercel env add UPSTASH_REDIS_REST_URL
# Paste the URL when prompted

vercel env add UPSTASH_REDIS_REST_TOKEN
# Paste the token when prompted
```

### 5. Add to Local `.env.local`
Create/edit `.env.local`:
```bash
UPSTASH_REDIS_REST_URL="https://xxx-xxxxx.upstash.io"
UPSTASH_REDIS_REST_TOKEN="AXXXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

---

## Testing the Connection

Create a test script:

```bash
node -e "
const { Redis } = require('@upstash/redis');
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
redis.set('test', 'hello').then(() => 
  redis.get('test').then(val => console.log('✓ Redis working:', val))
);
"
```

Expected output: `✓ Redis working: hello`

---

## Free Tier Limits

| Metric | Limit |
|--------|-------|
| Commands/day | 10,000 |
| Storage | 256 MB |
| Bandwidth | 200 MB/day |
| Concurrent connections | 1,000 |

**Estimated usage for Trail Overlay:**
- 100 imports/day = ~500 commands (well under limit)
- Cache storage: ~10-50 MB (Overpass responses)

---

## Troubleshooting

**Error: `UPSTASH_REDIS_REST_URL is not defined`**
- Run `vercel env pull .env.local`
- Restart your dev server

**Error: `401 Unauthorized`**
- Check that `UPSTASH_REDIS_REST_TOKEN` is correct
- Regenerate token in Upstash console if needed

**Error: `getaddrinfo ENOTFOUND`**
- Check internet connection
- Verify URL format: `https://xxx.upstash.io` (no trailing slash)

---

## Next Steps

Once Redis is set up:
1. ✅ Rate limiting will work (10 imports/day per user)
2. ✅ Overpass caching will work (30min TTL)
3. ✅ Ready to test OSM import feature
