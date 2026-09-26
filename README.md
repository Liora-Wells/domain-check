# 域名到期监控系统

**对原有的 [worker版](https://github.com/yutianqq/domain-check-pages/tree/old-worker) 进行模块化重构，kv作为数据储存，前端界面大升级，采用现代化卡片式布局**

基于 Cloudflare Worker 和 Worker KV 构建的域名到期监控仪表盘，支持自动 WHOIS 查询、分组管理、到期提醒等功能。

- 界面预览

<img width="1894" height="879" alt="image" src="https://b2qq.24811213.xyz/2025-11/1763455544-image.webp" />

## 功能特性

- ✅ **域名管理**：支持一级和二级域名的添加、编辑、删除
- 🔍 **WHOIS 自动查询**：一级域名自动获取注册和到期信息
- 📊 **可视化仪表盘**：域名状态概览、进度条、分组展示
- 🔐 **密码保护**：简单的访问控制机制
- 💾 **KV 存储**：使用 Cloudflare Workers KV 持久化数据
- 💾 **数据备份**：支持数据的导出和导入
- 📱 **Telegram 通知**：定时检查并推送即将到期提醒
- 🎨 **响应式设计**：支持移动端和桌面端访问

## 部署平台：Cloudflare Workers

> 放弃在CF网页管理后台直接链接仓库部署的方式  
> 这种方式对于kv空间绑定和定时触发器的设置完全依赖于 wrangler.toml  
> 如果 wrangler.toml 没有进行这些配置，则项目在重新部署后会丢失这些参数，导致kv空间绑定丢失以及定时器丢失  
> 这是CF worker 链接仓库部署一直以来的bug  
> **因此，项目部署方式改为 github action，以确保相关参数配置持久化**  
> 或者你也可以手动通过上传代码的方式部署到 CF worker  

### 前置条件
- 先给把本项目点个⭐，再 Fork，[点击直达](https://github.com/yutian81/domain-check/fork)
- 在 [Cloudflare](https://dash.cloudflare.com) 创建一个 KV 空间，名称随意，例如：`DOMAIN_KV`
- 创建完KV后，KV名称右侧有一串字符，就是KV的ID值，保存下来备用

### 设置仓库 action

- 点开仓库 `settings` → `Secrets and variables` → `Actions`
- 设置如下 `secrets`:
  - **CF_API_TOKEN**: 必须，需要 worker 和 kv 权限
  - **CF_KV_ID**: 必须，创建KV得到的ID值
  - **PASSWORD**: 必须，访问项目前端网页的密码，默认为 `123123`
    > ⚠️ 不设置时会使用公开的默认密码 `123123`，任何人都能登录并增删改你的数据。部署日志会给出显著警告，请务必设置。
  - **TGID**: 可选，tg机器人ID，用于发送tg通知
  - **TGTOKEN**: 可选，tg聊天ID或频道ID，用于发送tg通知
  - **CRON_TOKEN**: 可选，为 `/cron` 手动触发接口启用令牌保护；不设置则该接口保持免鉴权
- 转到 `variables` 选项卡，设置以下变量:
  - **CF_ACCOUNT_ID**: 必须，CF的账户ID，**是ID不是邮箱账号**
  - **CF_CRONS**: 可选，用于定时检查域名到期情况以发送tg通知

### 运行 action

- 点击仓库 `actions` → `all workerflows` → `自动部署到 CF worker`
- 点击 `run workflow`
- 等待 action 运行，查看运行日志，点击输出的 `worker 管理后台` 链接

### 设置 CF worker

- 进入 CF worker管理后台，给项目绑定一个自定义域名
- 在 worker 的环境变量中，还可设置以下可选变量

| 变量名 | 说明 | 默认值/示例值 | 必填 |
|--------|------|--------|------|
| `DAYS` | 到期提醒天数 | `30` | ❌ |
| `SITENAME` | 网站名称 | `域名到期监控` | ❌ |
| `ICON` | 网站图标 | `https://example.com/icon.png` | ❌ |
| `BGIMG` | 背景图片 | `https://example.com/bg.png` | ❌ |
| `GITHUB_URL` | GitHub 链接 | `https://github.com/yutian81/domain-check` | ❌ |
| `BLOG_URL` | 博客链接 | `https://blog.notett.com` | ❌ |
| `BLOG_NAME` | 博客名称 | `QingYun Blog` | ❌ |

### 防暴力破解与限流

项目内置两层防护，建议都开启。

#### 第一层：Cloudflare WAF 速率限制（推荐，免费版可用）

在请求到达 Worker 之前就在边缘拦掉，不消耗 Worker 配额。免费版可配 1 条规则，
因此把几个关键入口合并进同一条。

1. Cloudflare 控制台 → 选择你的域名 → **Security（安全性）→ WAF → Rate limiting rules**
2. 点击 **Create rule**，按下表填写：

| 字段 | 填写内容 |
|------|----------|
| Rule name | `登录与高开销接口限流` |
| If incoming requests match | Custom filter expression |
| 表达式 | `(http.request.uri.path eq "/login") or (starts_with(http.request.uri.path, "/api/whois/")) or (http.request.uri.path eq "/cron")` |
| When rate exceeds | `10` requests per `1` minute |
| Counting characteristics | `IP Address` |
| Then take action | `Block`，Duration `10` minutes |

> 如果被刷的只是首页，可以把表达式换成 `http.request.uri.path eq "/"`。

#### 第二层：Worker 内置（默认已开启，无需配置）

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `LOGIN_MAX_ATTEMPTS` | 连续密码错误多少次后锁定该 IP | `5` |
| `LOGIN_LOCK_SECONDS` | 锁定时长（秒） | `900`（15 分钟） |
| `WHOIS_RATE_LIMIT` | 每个窗口内 `/api/whois/*` 允许次数 | `20` |
| `CRON_RATE_LIMIT` | 每个窗口内 `/cron` 允许次数 | `10` |
| `RATE_LIMIT_WINDOW` | 限流窗口长度（秒） | `60` |

行为说明：

- 密码连续错误达阈值后，该 IP 被锁定并返回 `429`（带 `Retry-After` 头）；
  锁定期内即使密码正确也会被拒绝。
- **携带错误 `auth` Cookie 访问同样计入失败**（阈值放宽 3 倍，默认 15 次）。
  否则攻击者可以用 `Cookie: auth=<猜测值>` 完全绕开登录锁定。
- 匿名访问（不带 Cookie）不计入失败，正常访客不会被误锁。
- 登录成功后自动清空该 IP 的失败记录。

> ⚠️ **能力边界**：这一层基于 Workers KV，KV 是最终一致的，且同一个 key 每秒只允许
> 1 次写入。它能挡住常规的密码爆破与低频滥用，但**挡不住高速洪水攻击**——
> 那种情况请依赖上面的 WAF 规则。

## 本项目 API 接口

https://github.com/yutian81/domain-check/blob/main/API.md

---

## 感谢 YXVM 与 ZMTO 赞助免费服务器

<a href="https://yxvm.com/aff.php?aff=891">
  <img src="https://github.com/user-attachments/assets/33ad6d6e-e159-4840-b6a3-f1ea3faa9df9" width="48%">
</a>
<a href="https://console.zmto.com/?affid=1598">
  <img src="https://github.com/user-attachments/assets/02a0d439-0283-43fe-a028-1212412b324e" width="48%">
</a>
 
## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## ⭐ Star 星星走起
[![Star History Chart](https://api.star-history.com/svg?repos=yutian81/domain-check&type=date&legend=top-left)](https://www.star-history.com/#yutian81/domain-check&type=date&legend=top-left)
