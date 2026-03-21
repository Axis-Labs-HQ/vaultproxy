import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { proxyHandler } from "./handlers/proxy";
import { authMiddleware } from "./middleware/auth";

type Bindings = {
  CONTROL_PLANE_URL: string;
  PROXY_TOKEN: string;
  CACHE?: KVNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", logger());
app.use("*", cors());

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok", service: "vaultproxy-edge" });
});

// Proxy routes — intercept API calls and inject real keys
// Pattern: POST /proxy/:alias/* → resolve alias → replace header → forward
app.all("/proxy/:alias/*", authMiddleware, proxyHandler);

export default app;
