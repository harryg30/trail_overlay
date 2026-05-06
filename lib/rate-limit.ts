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

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthlyKey = `import:quota:${userId}:${currentMonth}`;

  // Check daily limit (10/day)
  const dailyCount = (await redis.get<number>(dailyKey)) || 0;
  if (dailyCount >= 10) {
    const tomorrow = new Date(now);
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
    const nextMonth = new Date(now);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(1);
    nextMonth.setHours(0, 0, 0, 0);

    return {
      allowed: false,
      remaining: 0,
      resetAt: nextMonth,
    };
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  return {
    allowed: true,
    remaining: 10 - dailyCount,
    resetAt: tomorrow,
  };
}

export async function incrementImportQuota(userId: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const dailyKey = `import:quota:${userId}:${today}`;

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthlyKey = `import:quota:${userId}:${currentMonth}`;

  // Increment daily (expire at next midnight)
  await redis.incr(dailyKey);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const secondsUntilMidnight = Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
  await redis.expire(dailyKey, secondsUntilMidnight + 60); // +60s buffer

  // Increment monthly (expire at first of next month)
  await redis.incr(monthlyKey);
  const nextMonth = new Date(now);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  nextMonth.setDate(1);
  nextMonth.setHours(0, 0, 0, 0);
  const secondsUntilNextMonth = Math.floor((nextMonth.getTime() - now.getTime()) / 1000);
  await redis.expire(monthlyKey, secondsUntilNextMonth + 60); // +60s buffer
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
