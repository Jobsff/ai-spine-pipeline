# AI Bone Studio 图片网关 / V0.3 Beta

这是可部署的服务端代码，不是已经开通的付费生图服务。当前公开 GitHub Pages 只有前端；未配置网关与供应商密钥时，角色上传、纯色抠图、拼装、骨骼与动画均可本地使用。供应商适配已用模拟响应测试；本次没有真实生图调用、Cloudflare 部署或费用验证。

## 安全模型

首版面向单个内部团队，不是多租户 SaaS。持有同一个服务访问口令的人可以看到该网关的全部任务。不要把口令公开给不受信任的人。正式多租户需要独立登录、项目隔离与计费账户隔离，不在本版范围内。

供应商 API Key 只存在服务端环境 / Cloudflare Secrets。网页只输入网关地址和至少 32 字符的服务访问口令，口令仅保存在当前页面内存。网页不能把某个任意 URL、模型或 API Key 当作请求参数发给代理。上游配置仅由管理员修改，结果图 URL 必须位于精确的管理员 CDN 白名单，禁止自动重定向。

默认每 UTC 日 30 次任务，上限可配 1～1000 次；最多 10 个排队/执行任务、200 条未清理记录。数字无效时拒绝启动。费用未知，不提供虚假金额预估。提交、429/401、5xx、超时均不自动重复调用上游。相同 requestId 按输入指纹去重，结果未知需要查供应商账单，不能直接反复重试。

## A. Node 部署（单进程）

要求 Node 22+，无第三方运行依赖。

```bash
cd apps/gateway
cp .env.example .env
# 本机生成随机口令，然后填入 .env，不要提交文件：
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
npm test
npm start
```

必填 STUDIO_ACCESS_TOKEN；按需要配置 OPENAI_API_KEY/OPENAI_MODEL 或 GEMINI_API_KEY/GEMINI_MODEL。模型名由管理员填写实际可用且支持图像的模型，不猜测“最新版”。ALLOWED_ORIGINS 是网页源，不带路径，例如 `https://jobsff.github.io`，不是项目 URL。

默认只监听 127.0.0.1:8787，远程访问必须使用 HTTPS 反向代理。Dockerfile 以非 root 用户运行；数据目录需要可写的持久化卷。禁止 PM2 cluster、多个实例共享同一目录：文件存储的锁仅限单进程。

服务使用 0700 数据目录、0600 原子写入文件。禁止把 data 目录挂到公网静态服务或提交仓库。进程在上游执行时重启，任务标记 unknown，不重新调用上游。启动时恢复队列但不等待长任务才开始监听。

## B. Cloudflare 部署（需账号授权，未代为开通）

代码入口 `src/worker.mjs`，配置 `wrangler.jsonc`。采用一个 Durable Object 串行管理内部团队任务，小索引 / 限额存在 DO；原画和结果保存在私有 R2，不把大图片写入 DO 单值。

```bash
cd apps/gateway
# 安装/使用你批准版本的 Wrangler CLI 并登录账户。
npx wrangler login
npx wrangler r2 bucket create ai-bone-studio-private-jobs
npx wrangler secret put STUDIO_ACCESS_TOKEN
npx wrangler secret put OPENAI_API_KEY
# 或配置 GEMINI_API_KEY；不使用的供应商不用设置。
npx wrangler deploy
```

部署前在 wrangler.jsonc 的 vars 添加实际使用的 OPENAI_MODEL 或 GEMINI_MODEL，核对 ALLOWED_ORIGINS、R2 绑定和账号额度。R2 必须保持私有，不启用 r2.dev 或公开域名，不自行打开付费升级。DO/Workflows/R2 的账号可用性和费用应在部署时审核，本次没有创建这些资源。当前实现使用 DO Alarm，不要求另加 Workflows。

部署得到 HTTPS Worker 地址后，在网页“角色与拆件 → 服务与任务”填写该地址与服务访问口令。点击连接只读取配置，不调用图片供应商。第一次实际生成仍需明确确认；文生图与参考图编辑应分别做一次真实验收。

## 供应商适配

- OpenAI Images：`/images/generations` JSON；`/images/edits` multipart `image[]`。通过环境变量明确配置模型；使用 opaque/PNG，不要求模型透明输出。
- Gemini 原生：`/models/{model}:generateContent`，text + inlineData 输入，TEXT/IMAGE 响应。不会盲目附加 OpenAI 的 background 参数。此实现针对该协议，不宣称覆盖所有 Google 图像产品或后续替代接口。
- OpenAI Images 兼容：COMPAT_BASE_URL 为管理员可信 HTTPS 地址。COMPAT_EDIT_ENABLED 默认 false；确认支持 edits multipart 后再开。COMPAT_OPAQUE_PARAMETER 默认 false，未知字段不乱发。提示词始终要求纯色背景。某服务只能聊天不能编辑图片，会报错，不退化为无参考生成。

部件请求必须有参考图与 #RRGGBB 色值。服务端再次追加“只有不透明纯色背景”的约束。返回图仍须由网页抠图检查台验收，接口返回成功并不表示艺术质量合格。

## 协议与保留策略

带 `Authorization: Bearer <服务访问口令>`：

- GET /capabilities：支持的配置与保留期，不暴露上游密钥和地址。
- POST /jobs：`requestId,kind,provider,prompt,reference?,color,confirmed:true`。返回任务编号。必须先在浏览器持久化编号，避免刷新重复付费请求。
- GET /jobs：无原画/结果的任务概要。
- GET /jobs/:id：成功后可取回内嵌图片与安全筛选的 usage；cost 为 null。
- DELETE /jobs/:id：仅完成/失败/未知任务可删除。已在客户端取回的图片不删除。

默认任务保留 7 天（可设 1～30），执行结束立即清除服务记录中的 prompt/reference，保留结果到到期或用户删除。删除保留不含图片的去重 tombstone 30 天，当日额度不返还。排队/执行中的任务不会因清理而重复提交；无法保证中断上游停止计费。供应商自己的数据保留政策不由这个网关控制。

## 检查与边界

`npm test` 覆盖适配协议、鉴权、CORS、限额、任务持久化、重启恢复、重复请求、未知状态、R2/DO 分离和残旧索引不重复调用。所有供应商返回是模拟数据；Cloudflare SDK/账号、真实供应商、负载与跨地区网络还需部署后测试。

接口参考：
- https://developers.openai.com/api/reference/resources/images/methods/edit
- https://developers.openai.com/api/docs/guides/image-generation
- https://ai.google.dev/api/generate-content
