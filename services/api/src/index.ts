import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import {
  requestLogger,
  requireAuth,
  errorHandler,
  notFoundHandler,
} from "./middleware";
import { mintHandler } from "./routes/mint";
import { burnHandler } from "./routes/burn";
import { transferHandler } from "./routes/transfer";
import { supplyHandler } from "./routes/supply";

// ─── App Setup ────────────────────────────────────────────────────────────────

const app = express();

// Security headers
app.use(helmet());

// CORS — tighten in production by setting CORS_ORIGIN env var
const allowedOrigin = process.env["CORS_ORIGIN"] ?? "*";
app.use(
  cors({
    origin: allowedOrigin,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Body parsing
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// Request logging (all routes)
app.use(requestLogger);

// ─── Public Routes ────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "@solana-stablecoin-standard/api",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

// Supply is a read-only GET — requires auth to prevent enumeration
app.get("/v1/supply", requireAuth, supplyHandler);

// ─── Protected Mutation Routes ────────────────────────────────────────────────

app.post("/v1/mint", requireAuth, mintHandler);
app.post("/v1/burn", requireAuth, burnHandler);
app.post("/v1/transfer", requireAuth, transferHandler);

// ─── Fallthrough Handlers ─────────────────────────────────────────────────────

app.use(notFoundHandler);
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────

const PORT = parseInt(process.env["PORT"] ?? "3001", 10);

const server = app.listen(PORT, () => {
  console.log(
    JSON.stringify({
      level: "INFO",
      message: `Stablecoin API listening on port ${PORT}`,
      port: PORT,
      env: process.env["NODE_ENV"] ?? "development",
      timestamp: new Date().toISOString(),
    })
  );
});

// Graceful shutdown
function shutdown(signal: string): void {
  console.log(
    JSON.stringify({
      level: "INFO",
      message: `Received ${signal}, shutting down gracefully`,
      timestamp: new Date().toISOString(),
    })
  );

  server.close((err) => {
    if (err) {
      console.error(
        JSON.stringify({
          level: "ERROR",
          message: "Error during server shutdown",
          error: err.message,
          timestamp: new Date().toISOString(),
        })
      );
      process.exit(1);
    }
    console.log(
      JSON.stringify({
        level: "INFO",
        message: "Server closed cleanly",
        timestamp: new Date().toISOString(),
      })
    );
    process.exit(0);
  });

  // Force exit after 10s if close hangs
  setTimeout(() => {
    console.error(
      JSON.stringify({
        level: "ERROR",
        message: "Forced shutdown after timeout",
        timestamp: new Date().toISOString(),
      })
    );
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  console.error(
    JSON.stringify({
      level: "ERROR",
      message: "Unhandled promise rejection",
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      timestamp: new Date().toISOString(),
    })
  );
});

export default app;
