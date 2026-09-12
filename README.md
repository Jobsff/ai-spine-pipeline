# AI Spine Pipeline / AI Bone Studio

面向新手的 2D 角色资产流程：AI 设计与补绘 → 透明零件 → 网页拼装 → 骨骼绑定 → 动作 → 游戏资源。

## 当前版本：编辑器 V0.2 Beta

已实现四步式网页编辑器，以及 Spine 3.8.99 区域贴图 / FK 子集导出。**格式检查与浏览器测试通过，不等于已经通过 Laya / Cocos 项目及真机验收。**

```bash
cd apps/editor
npm install
npm run dev
```

打开终端显示的本地地址，点“先试一试练习角色”，可直接播放、拖动关节、保存并导出。无需准备人物素材。图片处理与编辑在浏览器本地进行，不上传服务器。

`npm run build` 还会生成 `apps/editor/dist/AI-Bone-Studio.html` 单文件版本：可复制到电脑，用现代浏览器打开；不依赖外部 CDN。手机建议访问已部署的网页或电脑的局域网服务，不依赖文件预览器执行 HTML。当前仓库尚未配置在线部署。

## 能力与边界

- 拼装：PNG/WebP/部件 ZIP、移动、旋转、缩放、镜像、层级、锁定、旋转点、40 步撤销。
- 骨骼：点击创建关节链、父子层级、保持位置绑定、调整骨长、父骨带动子骨；一张零件绑定一个骨骼。
- 动作：多个动作、平移/旋转/等比骨骼缩放、自动关键帧、循环播放、摆动/呼吸模板。
- 输出：包含图片的 `.project.json`；Spine `.json + .atlas + .png` ZIP；透明 PNG；15fps PNG 序列帧。
- 未实现：IK、网格与多骨权重、变形、动态换图、曲线编辑器、动态层级、Spine 工程/二进制导出、AI 自动组装。

目标引擎：LayaAir 3.x / Cocos Creator 3.8.x，均使用 Spine 3.8 运行库。不能通过改版本字符串获得 4.x 兼容。PNG 序列帧为备用输出，不是骨骼资源，也不会自动生成引擎动画 clip。

## 文档与测试

- [编辑器使用说明](apps/editor/README.md)
- [格式、引擎接入与验收边界](docs/v0.2-compatibility.md)
- [本次测试记录](docs/v0.2-qa.md)
- [早期 AI 拆件流程](docs/workflow.md)
- [早期素材规范](docs/asset-spec.md)

`npm test` 在编辑器目录执行类型编译与 33 项核心测试。浏览器测试为可选 Python Playwright 脚本，详见编辑器说明。

原有 `scripts/extract_chroma_parts.py` 是早期抠图原型，本次没有把它的结果自动判断为合格动画素材。部件连接、去绿边、命名与隐藏区域仍需复核；源图集中的 `source_bbox` 不是拼好人物的坐标。

## 授权

本工具自己实现二维 FK 编辑与格式输出，没有分发 Spine Runtime。游戏使用 Spine Runtime 时仍须遵守 Esoteric Software 相应授权条款。自行开发编辑器不豁免运行库授权。项目未擅自添加开源许可证；代码及角色素材的对外授权由仓库所有者决定。
