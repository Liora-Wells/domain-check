// src/index.js

// 导入所有动态逻辑模块
import { getConfig } from './utils.js';
import { HTML_TEMPLATE } from '../frontend/index.js';
import { onRequest as configApi } from './api/config.js';
import { onRequest as domainsApi } from './api/domains.js';
import { onRequest as whoisApi } from './api/whois.js';
import { checkDomainsScheduled } from './cron.js';
import { authenticate, handleLogin } from './auth.js';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const pathname = url.pathname;
        const config = getConfig(env); // 加载环境变量配置
        
        if (pathname === '/login') { return handleLogin(request, env); }

        if (pathname === '/logout') {
            const headers = new Headers();
            headers.set('Location', '/');
            headers.set('Set-Cookie', 'auth=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Path=/; Secure; SameSite=Lax');
            return new Response(null, { status: 302, headers });
        }

        if (pathname === '/api/config') {
            const context = { request, env, ctx, next: () => {} }; 
            return configApi(context);
        }

        if (pathname.startsWith('/api/whois/')) {
            const context = { request, env, ctx, next: () => {} };
            const domain = pathname.replace('/api/whois/', '');
            return whoisApi(context, domain);
        }

        // 处理手动触发 /cron 路由
        if (pathname === '/cron') {
            if (request.method !== 'GET' && request.method !== 'POST') {
                return new Response('Method Not Allowed', { status: 405 });
            }

            // 可选保护：配置了 CRON_TOKEN 后，调用方必须携带 ?token=xxx 或 X-Cron-Token 头。
            // 未配置 CRON_TOKEN 时保持原有的免鉴权行为，不破坏既有用法。
            if (env.CRON_TOKEN) {
                const providedToken = url.searchParams.get('token') || request.headers.get('X-Cron-Token') || '';
                if (providedToken !== env.CRON_TOKEN) {
                    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
                        status: 401,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
            }
            
            try {
                const expiringDomains = await checkDomainsScheduled(env); 
                const responseBody = {
                    success: true,
                    message: expiringDomains.length > 0 
                             ? `${expiringDomains.length} 个域名即将到期`
                             : "没有即将到期的域名",
                    expiringCount: expiringDomains.length,
                    domains: expiringDomains
                };
                
                return new Response(JSON.stringify(responseBody), {
                    headers: { 'Content-Type': 'application/json' },
                });
        
            } catch (error) {
                console.error("手动触发 cron 失败:", error);
                return new Response(JSON.stringify({
                    success: false,
                    error: "cron 任务执行失败",
                    details: error.message
                }), { status: 500, headers: { 'Content-Type': 'application/json' } });
            }
        }
        
        // 定义需要豁免认证的路径
        const authExemptPaths = ['/api/config', '/api/whois', '/cron', '/login'];
        const isExempt = authExemptPaths.includes(pathname); 

        // 如果设置了密码，且请求不是豁免路径，则执行认证
        if (config.password && !isExempt) {
            const authResponse = await authenticate(request, env);
            if (authResponse) {
                return authResponse; // 返回 302 重定向到 /login
            }
        }

        // 处理 API 路由
        if (pathname.startsWith('/api/')) {
            const context = { request, env, ctx, next: () => {} };
            if (url.pathname === '/api/domains') { return domainsApi(context); }
            return new Response('API Not Found', { status: 404 });
        }
 
        // 处理根目录请求
        if (pathname === '/') {
            return new Response(HTML_TEMPLATE(config.siteName, config.siteIcon, config.bgimgURL, config.githubURL, config.blogURL, config.blogName), {
                headers: { 
                    'Content-Type': 'text/html;charset=UTF-8',
                    'Cache-Control': 'no-cache, no-store, must-revalidate'
                }
            });
        }
        
        return new Response('Not Found', { status: 404 });
    },

    // Cron Triggers 定时任务处理器
    async scheduled(event, env, ctx) {
        ctx.waitUntil(checkDomainsScheduled(env).catch(err => {
            console.error('定时任务执行失败:', err);
        }));
    }
};
