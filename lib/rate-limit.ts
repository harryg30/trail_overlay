import { Redis } from '@upstash/redis';

// Initialize Redis client
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN!,
});

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export async function checkImportQuota(
  userId: string
): Promise<RateLimitResult> {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const dailyKey = `import:quota:${userId}:${today}`;
  const monthlyKey = `import:quota:${userId}:monthly`;

  // Check daily limit (10/day)
  const dailyCount = (await redis.get<number>(dailyKey)) || 0;
  if (dailyCount >= 10) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    return {
      allowed: false,
      remaining: 0,
      resetAt: tomorrow,
    };
  }

  // Check monthly limit (100/month)
  const monthlyCount = (await redis.get<number>(monthlyKey)) || 0;
  if (monthlyCount >= 100) {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(1);
    nextMonth.setHours(0, 0, 0, 0);

    return {
      allowed: false,
      remaining: 0,
      resetAt: nextMonth,
    };
  }

  return {
    allowed: true,
    remaining: 10 - dailyCount,
    resetAt: new Date(Date.now() + 86400000), // +24h
  };
}

export async function incrementImportQuota(userId: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const dailyKey = `import:quota:${userId}:${today}`;
  const monthlyKey = `import:quota:${userId}:monthly`;

  // Increment daily (with 24h TTL)
  await redis.incr(dailyKey);
  await redis.expire(dailyKey, 86400); // 24 hours

  // Increment monthly (with 30d TTL)
  await redis.incr(monthlyKey);
  await redis.expire(monthlyKey, 2592000); // 30 days
}

export async function getCachedOverpassResult(
  queryHash: string
): Promise<any | null> {
  const cacheKey = `overpass:${queryHash}`;
  return await redis.get(cacheKey);
}

export async function setCachedOverpassResult(
  queryHash: string,
  result: any
): Promise<void> {
  const cacheKey = `overpass:${queryHash}`;
  await redis.set(cacheKey, result, { ex: 1800 }); // 30 min TTL
}
