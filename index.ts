import page from "./src/client/index.html";
import review from "./src/client/review/index.html";
import { handleApiRequest } from "./src/server/app";

const server = Bun.serve({
  hostname: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3000),
  idleTimeout: 120,
  maxRequestBodySize: 64_000,
  development: process.env.NODE_ENV !== "production" ? { hmr: true, console: true } : false,
  routes: { "/": page, "/preview/character": review },
  fetch(request) {
    if (new URL(request.url).pathname.startsWith("/api/")) return handleApiRequest(request);
    return new Response("Not found", { status: 404 });
  },
});

console.log(`\n  点点 / Lattice AI\n  ${server.url}\n  没有 API Key？打开页面即可体验演示模式。\n`);
