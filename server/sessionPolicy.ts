import type { SessionOptions } from "express-session";
import type { CookieOptions, Express, Response, Request } from "express";

export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_NAME = "connect.sid";

export function sessionPolicy(app: Express): Pick<SessionOptions, "secret" | "rolling" | "resave" | "saveUninitialized" | "cookie"> {
  const hosted = Boolean(process.env.REPL_ID) || process.env.NODE_ENV === "production";
  const secret = process.env.SESSION_SECRET;
  if (!secret && hosted) {
    throw new Error("SESSION_SECRET must be configured for hosted sessions");
  }
  // Only the immediate hosting proxy may supply the forwarded protocol.
  // Local development without a proxy does not trust forwarded headers.
  app.set("trust proxy", hosted ? 1 : false);
  return {
    secret: secret || "local-development-only-secret",
    rolling: true,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: SESSION_LIFETIME_MS,
      httpOnly: true,
      secure: "auto",
      sameSite: "lax",
      path: "/",
    },
  };
}

export function clearSessionCookie(req: Request, res: Response) {
  const options: CookieOptions = {
    httpOnly: true, sameSite: "lax", path: "/", secure: req.secure,
  };
  res.clearCookie(SESSION_COOKIE_NAME, options);
}
