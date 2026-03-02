import { Request, Response, NextFunction } from "express";

// ─── Request Logger ───────────────────────────────────────────────────────────

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const level =
      res.statusCode >= 500
        ? "ERROR"
        : res.statusCode >= 400
        ? "WARN"
        : "INFO";

    console.log(
      JSON.stringify({
        level,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: duration,
        timestamp: new Date().toISOString(),
        ip: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      })
    );
  });

  next();
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const operatorSecret = process.env["OPERATOR_SECRET"];

  if (!operatorSecret) {
    res.status(500).json({
      error: "Server misconfiguration: OPERATOR_SECRET is not set",
      code: "SERVER_MISCONFIGURATION",
    });
    return;
  }

  const authHeader = req.headers["authorization"];

  if (!authHeader) {
    res.status(401).json({
      error: "Missing Authorization header",
      code: "UNAUTHORIZED",
    });
    return;
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer") {
    res.status(401).json({
      error: "Authorization header must be in format: Bearer <token>",
      code: "UNAUTHORIZED",
    });
    return;
  }

  const token = parts[1];
  if (!token || token !== operatorSecret) {
    res.status(403).json({
      error: "Invalid operator secret",
      code: "FORBIDDEN",
    });
    return;
  }

  next();
}

// ─── Error Handler ────────────────────────────────────────────────────────────

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

export function errorHandler(
  err: ApiError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const statusCode = err.statusCode ?? 500;
  const code = err.code ?? "INTERNAL_SERVER_ERROR";
  const message =
    statusCode === 500
      ? "An unexpected error occurred"
      : err.message;

  console.error(
    JSON.stringify({
      level: "ERROR",
      method: req.method,
      path: req.path,
      status: statusCode,
      code,
      error: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString(),
    })
  );

  res.status(statusCode).json({
    error: message,
    code,
  });
}

// ─── Not Found Handler ────────────────────────────────────────────────────────

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: `Route ${req.method} ${req.path} not found`,
    code: "NOT_FOUND",
  });
}

// ─── Validation Error Factory ─────────────────────────────────────────────────

export function createApiError(
  message: string,
  statusCode: number,
  code: string
): ApiError {
  const err = new Error(message) as ApiError;
  err.statusCode = statusCode;
  err.code = code;
  return err;
}
