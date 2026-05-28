import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { RuntimeConfig } from "../config/env.js";

interface SessionPayload {
  exp: number;
  iat: number;
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(secret: string, ttlMs = 8 * 60 * 60 * 1000): { token: string; expiresAt: string } {
  const now = Date.now();
  const payload: SessionPayload = {
    iat: now,
    exp: now + ttlMs
  };
  const encodedPayload = base64Url(JSON.stringify(payload));
  return {
    token: `${encodedPayload}.${sign(encodedPayload, secret)}`,
    expiresAt: new Date(payload.exp).toISOString()
  };
}

export function validateSessionToken(secret: string, token: string | undefined): boolean {
  if (!token) {
    return false;
  }
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return false;
  }
  const expected = sign(encodedPayload, secret);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return false;
  }
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as SessionPayload;
  return Date.now() < payload.exp;
}

export function tokenFromRequest(req: Request): string | undefined {
  const authorization = req.header("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length);
  }
  const queryToken = req.query.token;
  return typeof queryToken === "string" ? queryToken : undefined;
}

export function requireSession(config: RuntimeConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!validateSessionToken(config.sessionSecret, tokenFromRequest(req))) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}
