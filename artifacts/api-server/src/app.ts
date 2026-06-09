import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { tvMediaDir } from "./lib/tv-voice-events";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// CORS — only needed in dev (Vite proxy handles it in production)
if (process.env.NODE_ENV !== "production") {
  app.use(cors());
}

app.use(express.json({ limit: "250mb" }));
app.use(express.urlencoded({ extended: true, limit: "250mb" }));

fs.mkdirSync(tvMediaDir, { recursive: true });
app.use("/tv-media", express.static(tvMediaDir));

app.use("/api", router);

// ── Static frontend serving (production / local single-server mode) ──────────
// In development, Vite's dev server runs separately and proxies /api to here.
// In production, we serve the built React app from this same process.
const isProduction = process.env.NODE_ENV === "production";
const serveStatic = isProduction || process.env.SERVE_STATIC === "true";

if (serveStatic) {
  // Path resolution works whether run from workspace root or directly
  const frontendDist =
    process.env.FRONTEND_DIST ??
    path.resolve(__dirname, "../../enrollment-system/dist/public");

  if (fs.existsSync(frontendDist)) {
    logger.info({ frontendDist }, "Serving frontend static files");
    app.use(express.static(frontendDist));
    // SPA catch-all — send index.html for any non-API route (Express 5 syntax)
    app.get("/{*path}", (_req, res) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  } else {
    logger.warn(
      { frontendDist },
      "Frontend dist not found — run `pnpm build:local` first",
    );
  }
}

export default app;
