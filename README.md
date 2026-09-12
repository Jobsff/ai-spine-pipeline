# AI Spine Pipeline / AI Bone Studio

面向新手的 2D 角色流程：准备角色 → 纯色拆件与检查 → 拼装 → 骨骼 → 表情与动作 → 游戏资源。

## V0.3 Beta / 第一阶段

在线入口：**https://jobsff.github.io/ai-spine-pipeline/**

页面顶部“角色与拆件 · V0.3”打开新流程。试用不需要 API：拆件检查台 → 试用练习拆件图 → 3列4行网格切分 → 逐件确认 → 送入拼装画板。已有透明 PNG 仍可直接导入旧画板。

### 本版新增

- 角色需求整理、原画上传、采用版本、裁选视图；`.prep.json` 保存独立准备工程。
- 头像 / 待机拆件清单、语义编号、局部/分组生成提示词。
- **AI 部件强制纯色背景，不使用模型原生透明。** 浏览器抠图、边缘去色、框选/网格/连通候选、擦除/恢复、归组、逐件确认、透明 PNG ZIP 和画板导入。
- 真实表情换图：睁闭眼 / 嘴型替换图、对齐、离散关键帧、眨眼模板；预览、保存和 Spine 3.8 导出一致。
- `apps/gateway`：OpenAI Images / Gemini 原生 / 可配置兼容服务的后端适配，鉴权、持久化任务、去重、限额、未知状态不重试。提供单进程 Node 与 Cloudflare Worker+DO+私有R2 实现。

**在线能力边界：** GitHub Pages 只托管前端，上传、抠图、拼装、骨骼、表情和导出可本地运行。真实AI生图需要另行部署网关并配置合法可用的供应商密钥；本次没有开通收费服务、没有真实付费调用，也没有把密钥放进网页。角色“生成”入口未配置服务时会明确提示，而不是返回模拟图片。

### 兼容与未完成项

V0.2工程可迁移打开；V0.3工程包含图片与换图轨道。游戏导出为 Spine 3.8.99 区域贴图 / FK / Attachment子集。Laya/Cocos对应版本的资源加载、真机与平台验收仍需执行，不把格式或浏览器测试叫做引擎认证。

全身七动作只是后续规划，本版没有七套完整动作模板、AI自动拼装、IK、网格权重和动态层级。不把 source_bbox 当成角色初始坐标。半透明、发光与主体撞色仍可能需要手工修复。

## 开发

```bash
cd apps/editor
npm install --ignore-scripts
npm test
npm run dev
```

`npm run build` 输出 `dist/AI-Bone-Studio.html` 单文件。服务端单独运行见 [网关说明](apps/gateway/README.md)。不配置服务端不影响本地编辑。

## 文档

- [V0.3编辑器使用说明](apps/editor/README.md)
- [网关部署、密钥与计费边界](apps/gateway/README.md)
- [V0.3交付与QA](docs/v0.3-release.md)
- [已批准的范围和不可变生产决策](docs/v0.3-approved-plan.md)
- [Spine/Laya/Cocos兼容边界](docs/v0.2-compatibility.md)
- [原有V0.2 QA](docs/v0.2-qa.md)
- [素材规范](docs/asset-spec.md)

`Build web preview` 在 main 更新后测试并生成 site-build 分支；发布时将经过检查的构建推进 gh-pages，再由 GitHub Pages 部署。构建成功不等于线上已更新，发布后需验证 version.json 与线上浏览器。

## 授权与隐私

不分发 Spine Runtime，使用游戏运行库仍须遵守相应授权。本仓库未擅自添加开源授权；代码和角色的授权由仓库所有者决定。API Key、网关口令不写入工程；纯本地导入不上传图片。只有明确确认的AI请求才发送对应原画和提示词。公开站点不意味着用户编辑内容自动公开。
