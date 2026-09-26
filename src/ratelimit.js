// src/ratelimit.js
// 轻量限流 / 登录锁定工具。
//
// ⚠️ 能力边界（重要）：本模块基于 Workers KV 实现，而 KV 是「最终一致」的，
// 且同一个 key 每秒只允许 1 次写入。因此它属于「第二层」防护：
//   - 能挡住常规的密码爆破、脚本小子扫描、低频滥用；
//   - 挡不住高速洪水攻击（写入会被 KV 限流，计数跟不上）。
// 第一层防护请在 Cloudflare 控制台配置 WAF 速率限制规则（免费版有 1 条额度），
// 在请求到达 Worker 之前就在边缘拦掉，详见 README「防暴力破解与限流」一节。

const nowSec = () => Math.floor(Date.now() / 1000);

// 取客户端真实 IP。Cloudflare 会在边缘注入 CF-Connecting-IP，客户端无法伪造。
export function getClientIp(request) {
    const cf = request.headers.get('CF-Connecting-IP');
    if (cf) return cf.trim();
    const xff = request.headers.get('X-Forwarded-For');
    if (xff) return xff.split(',')[0].trim();
    return 'unknown';
}

// 对 IP 做 SHA-256 再存 KV，避免把明文 IP 落盘
export async function hashIp(ip) {
    try {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
        return Array.from(new Uint8Array(buf)).slice(0, 12)
            .map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
        console.error('计算 IP 哈希失败:', e.message);
        return 'unknown';
    }
}

async function readRecord(env, key) {
    if (!env.DOMAIN_KV) return null; // 未绑定 KV：降级为不限流，避免整站不可用
    try {
        const raw = await env.DOMAIN_KV.get(key, { type: 'json' });
        return (raw && typeof raw === 'object') ? raw : null;
    } catch (e) {
        console.error('读取限流记录失败:', e.message);
        return null;
    }
}

async function writeRecord(env, key, value, ttlSeconds) {
    if (!env.DOMAIN_KV) return;
    try {
        await env.DOMAIN_KV.put(key, JSON.stringify(value), {
            expirationTtl: Math.max(60, Math.ceil(ttlSeconds)),
        });
    } catch (e) {
        // 高频攻击下同 key 写入可能被 KV 拒绝；此处降级为「放行」，由 WAF 兜底
        console.error('写入限流记录失败:', e.message);
    }
}

// ---------- 登录失败锁定 ----------

// 返回剩余锁定秒数，0 表示未锁定
export async function getLoginLockSeconds(env, ipHash) {
    const rec = await readRecord(env, `rl:login:${ipHash}`);
    if (!rec || !rec.lockUntil) return 0;
    return Math.max(0, rec.lockUntil - nowSec());
}

// 记一次失败；达到阈值则开启锁定。锁定窗口同时作为失败计数的滑动窗口。
export async function recordLoginFailure(env, ipHash, maxAttempts, lockSeconds) {
    const key = `rl:login:${ipHash}`;
    const now = nowSec();
    const rec = await readRecord(env, key);
    const prev = (rec && rec.lockUntil > now) ? 0 : (rec?.n || 0);
    let attempts = prev + 1;
    let lockUntil = 0;

    if (attempts >= maxAttempts) {
        lockUntil = now + lockSeconds;
        attempts = 0; // 锁定后清零，解锁后重新计数
    }

    await writeRecord(env, key, { n: attempts, lockUntil }, lockSeconds);
    return {
        attempts,
        lockUntil,
        remaining: lockUntil ? 0 : Math.max(0, maxAttempts - attempts),
    };
}

// 登录成功后清空该 IP 的失败记录
export async function clearLoginFailures(env, ipHash) {
    if (!env.DOMAIN_KV) return;
    try {
        await env.DOMAIN_KV.delete(`rl:login:${ipHash}`);
    } catch (e) {
        console.error('清除登录失败记录失败:', e.message);
    }
}

// ---------- 通用固定窗口限流 ----------

// 固定窗口计数：windowSeconds 内最多 limit 次
export async function throttle(env, key, limit, windowSeconds) {
    const now = nowSec();
    const rec = await readRecord(env, key);

    let count = 1;
    let reset = now + windowSeconds;
    if (rec && rec.reset > now) {
        count = (rec.n || 0) + 1;
        reset = rec.reset;
    }

    await writeRecord(env, key, { n: count, reset }, reset - now);

    return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        retryAfter: Math.max(1, reset - now),
    };
}

// ---------- 响应工具 ----------

export function rateLimitedResponse(retryAfter, message) {
    return new Response(JSON.stringify({
        success: false,
        error: message || '请求过于频繁，请稍后再试。',
        retryAfter,
    }), {
        status: 429,
        headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            'Retry-After': String(retryAfter),
            'Cache-Control': 'no-store',
        },
    });
}

// 常量时间字符串比较，避免通过响应耗时逐字节试探密码
export function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}
