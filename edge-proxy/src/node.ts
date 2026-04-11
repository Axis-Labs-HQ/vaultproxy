import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { proxyHandler } from "./handlers/proxy";
import { purgeHandler } from "./handlers/purge";
import { authMiddleware } from "./middleware/auth";

// Node.js adapter — same app logic as the CF Worker, but reads env from process.env
const app = new Hono();

app.use("*", logger());
app.use("*", cors());

// Inject env vars from process.env into Hono context
app.use("*", async (c, next) => {
  c.env = {
    CONTROL_PLANE_URL: process.env.CONTROL_PLANE_URL || "http://control-plane.railway.internal:8080",
    PROXY_TOKEN: process.env.PROXY_TOKEN || "",
    PURGE_SECRET: process.env.PURGE_SECRET || "",
  } as any;
  await next();
});

app.get("/health", (c) => {
  return c.json({ status: "ok", service: "vaultproxy-edge" });
});

app.all("/proxy/:alias/*", authMiddleware, proxyHandler);
app.post("/purge/:alias", purgeHandler);

const port = parseInt(process.env.PORT || "3001");
console.log(`VaultProxy edge proxy starting on port ${port}`);
serve({ fetch: app.fetch, port });
