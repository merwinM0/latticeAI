# 大肥鱼 · Lattice AI

**一个有表情的 AI 聊天伙伴。**

中文 · [English](README.en.md)

Lattice AI 把聊天窗口变成一个安静的陪伴空间：由原画构成的粒子角色会眨眼、随回复轻声开口，文字在身旁浮现。没有聊天列表，也没有不断堆叠的消息气泡，只有角色、输入框和当下的对话。

> **仅支持 DeepSeek API**：真实模型模式需要 DeepSeek API 密钥，不接受其他服务商的 API。

![Lattice AI 聊天界面](./show.png)

## 特色

- **会动的粒子角色**：保留原画色彩与轮廓，用二维网格驱动眨眼和说话动作；支持 WebGL，无法使用时回退到 Canvas 2D。
- **轻量的对话体验**：回复分成短消息逐条浮现，停留后淡出；悬停或键盘聚焦可以暂停消失。文字消失后，当前对话上下文仍然保留。
- **连接 DeepSeek**：支持 `deepseek-chat` 和 `deepseek-reasoner`，在设置中选择模型。
- **无需密钥也能体验**：内置明确标注的本地演示模式，不调用外部 AI 服务。
- **照顾不同使用方式**：适配手机和桌面，支持键盘操作、中文输入法、减少动态效果及屏幕阅读器提示。

项目使用 **Bun + React + TypeScript**，前后端同源运行，只需启动一个服务。当前适合个人本地使用，暂不提供语音输入或朗读。

## 快速开始

安装 [Bun](https://bun.sh) **1.3.14 或更新版本**，在项目目录运行：

```bash
bun install
bun run dev
```

打开 **http://127.0.0.1:3000**。未配置密钥时，可以直接体验演示模式。

### 连接真实模型

以 DeepSeek 为例，先创建本地配置文件（已有 `.env` 时直接编辑，不要覆盖）：

```bash
cp .env.example .env
```

在 `.env` 中填写：

```dotenv
DEEPSEEK_API_KEY=你的密钥
```

重启服务，在输入栏左侧的设置中选择「连接真实模型」。首次使用且未保存模式偏好时，应用会自动选择已配置的服务商。

也可以在设置中临时填写密钥：密钥仅保存在当前页面内存，刷新后清除。切换模式、服务商或模型会开始新对话。

## 模型配置

仅接受 DeepSeek 服务商，不支持其他服务商或本地 Ollama。

| 环境变量 | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 |
| `DEEPSEEK_MODEL` | 首选模型，可选，默认 `deepseek-chat` |
| `DEEPSEEK_BASE_URL` | 服务端接口基础地址，可选，默认 `https://api.deepseek.com` |

支持 `deepseek-chat` 和 `deepseek-reasoner`。实际模型可用性与费用以 DeepSeek 为准。基础地址不要包含 `/chat/completions`，且只能由服务端配置。完整示例见 [`.env.example`](.env.example)。

## 隐私与部署

- 对话仅保存在当前页面内存，刷新即清空；浏览器只持久保存服务商、模型名和模式偏好。
- 真实模型模式会将对话上下文发送给所选服务商，请避免输入敏感信息。
- 服务端密钥不会打包进前端；`.env` 已被 Git 忽略，请勿将密钥写入源码或提交到仓库。
- 前端不依赖外部字体、图片或 CDN；本地演示不请求外部 AI 服务。

生产模式启动：

```bash
bun run start
```

默认仅监听 `127.0.0.1:3000`。如需局域网访问，可在 `.env` 中设置：

```dotenv
HOST=0.0.0.0
APP_ORIGIN=http://192.168.1.10:3000
```

将示例 IP 替换为实际地址，修改配置后重启服务。

**当前版本没有用户认证，不应直接暴露到公网。** 公网部署前请添加认证、用户级限流、调用配额及 HTTPS，并将 `APP_ORIGIN` 设置为实际站点源。使用反向代理时，需要关闭 SSE 缓冲。

## 开发与定制

```bash
bun run typecheck
bun run test
bunx playwright install chromium  # 首次运行浏览器测试时
bun run test:e2e
```

测试使用本地模拟上游，不会验证付费模型接口的在线可用性。

- **对话风格**：[系统提示词](prompts/companion.md) 控制回复语气、长度和表情协议，修改后重启服务。
- **角色与动画**：[粒子实现文档](docs/image-particles.md) 介绍原画处理、网格绑定和资源生成。运行项目不需要 Python；重新生成角色资源需要 Python 3 与 Pillow。
- **角色预览**：启动后访问 [`/preview/character`](http://127.0.0.1:3000/preview/character)，查看原色、粒子和动作中间帧。角色采用二维动画，并非三维重建或音频口型同步；替换原画需要重新校准。
- **设计说明**：参见 [设计文档](docs/design.md)。

### 项目结构

```text
index.ts               Bun 服务入口
src/client/            React 界面、粒子动画与对话状态
src/server/            模型适配、流式回复与请求校验
src/shared/            前后端共享类型
src/images/            角色配置与原画素材目录
prompts/               系统提示词
scripts/               角色资源生成工具
tests/                 单元测试与浏览器测试
```

### API

- `GET /api/providers`：获取服务商、候选模型及配置状态，不返回密钥或私有接口地址。
- `POST /api/chat`：发送对话，通过 SSE 返回表情、消息及完成事件。

```bash
curl -N http://127.0.0.1:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"provider":"deepseek","model":"deepseek-chat","messages":[{"role":"user","content":"你好"}]}'
```

默认使用服务端密钥；可选的 `apiKey` 字段仅覆盖本次请求。系统提示词由服务端管理。
