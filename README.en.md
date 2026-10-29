# Lattice AI · 大肥鱼

**An AI chat companion with an expressive particle character.**

[中文](README.md) · English

Lattice AI turns a chat window into a quiet space for conversation. A character made from illustrated particles blinks and moves its mouth as replies appear nearby. There is no conversation sidebar or growing wall of chat bubbles—just the character, an input field, and the conversation at hand.

![Lattice AI chat interface](./show.png)

## Features

- **An animated particle character**: Preserves the original artwork's colors and silhouette, with 2D mesh-driven blinking and speaking motions. Uses WebGL with a Canvas 2D fallback.
- **A lighter way to chat**: Short replies appear one at a time and fade after a while. Hover or focus a message to keep it visible. Conversation context remains available after the text fades.
- **Your choice of models**: Supports DeepSeek, OpenAI, Claude, Gemini, Qwen, Kimi, SiliconFlow, OpenAI-compatible endpoints, and local Ollama models.
- **Try it without a key**: A clearly labeled local demo works without contacting an AI provider.
- **Built for different ways of using the app**: Responsive layouts, keyboard navigation, Chinese IME support, reduced-motion preferences, and screen-reader announcements.

Built with **Bun + React + TypeScript**, with the frontend and backend served from a single process. The current version is intended for personal, local use. Voice input and text-to-speech are not included.

## Quick start

Install [Bun](https://bun.sh) **1.3.14 or later**, then run in the project directory:

```bash
bun install
bun run dev
```

Open **http://127.0.0.1:3000**. Without an API key, you can use demo mode immediately.

### Connect a real model

For DeepSeek, create a local configuration file first. If `.env` already exists, edit it instead of overwriting it.

```bash
cp .env.example .env
```

Add your key to `.env`:

```dotenv
DEEPSEEK_API_KEY=your_api_key
```

Restart the server, open settings to the left of the input field, and select real-model mode. On first use, if no mode preference has been saved, the app automatically selects a configured provider.

You can also enter a temporary key in settings. It stays in page memory and is cleared on refresh. Switching mode, provider, or model starts a new conversation.

## Model configuration

Configure only the providers you want to use.

| Provider | API key variable | Example models |
| --- | --- | --- |
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek-chat` / `deepseek-reasoner` |
| OpenAI | `OPENAI_API_KEY` | `gpt-4.1-mini` / `gpt-4.1` |
| Claude | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` |
| Gemini | `GEMINI_API_KEY` | `gemini-2.5-flash` / `gemini-2.5-pro` |
| Qwen | `QWEN_API_KEY` | `qwen-plus` / `qwen-turbo` |
| Kimi | `MOONSHOT_API_KEY` | `moonshot-v1-8k` / `moonshot-v1-32k` |
| SiliconFlow | `SILICONFLOW_API_KEY` | `deepseek-ai/DeepSeek-V3` |
| Custom endpoint | `CUSTOM_API_KEY` | Depends on your endpoint |

Each provider also supports `*_BASE_URL` and `*_MODEL` to override its base URL and preferred model. Do not include endpoint paths such as `/chat/completions` or `/messages` in the base URL. You can also enter model names in the interface. Names, availability, and pricing depend on your provider.

Claude and Gemini use their native protocols; other providers use the OpenAI Chat Completions-compatible protocol. See [`.env.example`](.env.example) for configuration examples.

### Local Ollama

Download and start a model with [Ollama](https://ollama.com), then configure:

```dotenv
CUSTOM_BASE_URL=http://127.0.0.1:11434/v1
CUSTOM_API_KEY=ollama
CUSTOM_MODEL=qwen2.5:7b
```

Restart the server and select the custom provider in settings. Upstream URLs are configured on the server, not supplied arbitrarily by the browser.

## Privacy and deployment

- Conversations stay in page memory and are cleared on refresh. Only provider, model, and mode preferences are persisted in the browser.
- Real-model mode sends conversation context to the selected provider. Avoid sharing sensitive information.
- Server-side API keys are not bundled into the frontend. `.env` is ignored by Git; never put keys in source code or commit them.
- The frontend does not depend on external fonts, images, or CDNs. Local demo mode does not contact external AI services.

To run in production mode:

```bash
bun run start
```

The server listens on `127.0.0.1:3000` by default. For LAN access, set the following in `.env`:

```dotenv
HOST=0.0.0.0
APP_ORIGIN=http://192.168.1.10:3000
```

Replace the example IP with your actual address and restart after configuration changes.

**This version has no user authentication and should not be exposed directly to the internet.** Before public deployment, add authentication, per-user rate limits, usage quotas, and HTTPS. Set `APP_ORIGIN` to the actual site origin and disable SSE buffering in your reverse proxy.

## Development and customization

```bash
bun run typecheck
bun run test
bunx playwright install chromium  # Before the first browser test run
bun run test:e2e
```

Tests use local mock upstreams; they do not verify live paid-model availability.

- **Conversation style**: The [system prompt](prompts/companion.md) controls tone, reply length, and the emotion protocol. Restart the server after editing.
- **Character and animation**: The [particle implementation guide](docs/image-particles.md) covers artwork processing, mesh binding, and asset generation. Running the app does not require Python; regenerating character assets requires Python 3 and Pillow.
- **Character preview**: Visit [`/preview/character`](http://127.0.0.1:3000/preview/character) while the server is running to inspect original colors, particles, and intermediate animation frames. This is 2D animation, not 3D reconstruction or audio-driven lip sync. Replacing the artwork requires recalibration.
- **Design notes**: See the [design document](docs/design.md).

The linked implementation documents and system prompt are currently in Chinese.

### Project structure

```text
index.ts               Bun server entry point
src/client/            React UI, particle animation, conversation state
src/server/            Model adapters, streaming replies, request validation
src/shared/            Shared frontend/backend types
src/images/            Character configuration and source artwork directory
prompts/               System prompts
scripts/               Character asset generation tools
tests/                 Unit and browser tests
```

### API

- `GET /api/providers`: Returns providers, model suggestions, and configuration status, without keys or private endpoint URLs.
- `POST /api/chat`: Accepts a conversation and streams emotion, message, and completion events over SSE.

```bash
curl -N http://127.0.0.1:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"provider":"deepseek","model":"deepseek-chat","messages":[{"role":"user","content":"Hello"}]}'
```

Requests use the server-side key by default. An optional `apiKey` field overrides it for that request only. The server manages the system prompt.
