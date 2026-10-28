import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcrypt";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { pool } from "./db";
import type { User } from "@shared/schema";
import { SESSION_LIFETIME_MS, sessionPolicy } from "./sessionPolicy";

declare global {
  namespace Express {
    interface User {
      id: number;
      email: string;
      role: string;
      displayName: string;
      passwordHash: string;
      teamId: number | null;
      isActive: boolean;
      authVersion: number;
    }
  }
}

const PgStore = connectPgSimple(session);

export function setupAuth(app: Express) {
  const policy = sessionPolicy(app);
  app.use(
    session({
      store: new PgStore({
        pool,
        tableName: "session",
        createTableIfMissing: true,
      }),
      ...policy,
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());
  app.use((req, _res, next) => {
    // Existing cookies carry their old originalMaxAge in PostgreSQL. Upgrade
    // authenticated legacy sessions too, without creating anonymous sessions.
    if (req.isAuthenticated() && req.session.cookie.originalMaxAge !== SESSION_LIFETIME_MS) {
      req.session.cookie.maxAge = SESSION_LIFETIME_MS;
    }
    next();
  });

  passport.use(
    new LocalStrategy(
      { usernameField: "email" },
      async (email, password, done) => {
        try {
          const user = await storage.getUserByEmail(email);
          if (!user) return done(null, false, { message: "Invalid credentials" });
          const valid = await bcrypt.compare(password, user.passwordHash);
          if (!valid) return done(null, false, { message: "Invalid credentials" });
          if (!user.isActive) return done(null, false, { message: "Your account is deactivated. Contact an admin to reactivate it." });
          return done(null, user);
        } catch (err) {
          return done(err);
        }
      }
    )
  );

  passport.serializeUser((user: Express.User, done) => {
    done(null, { id: user.id, authVersion: user.authVersion });
  });

  passport.deserializeUser(async (sessionUser: number | { id: number; authVersion: number }, done) => {
    try {
      const id = typeof sessionUser === "number" ? sessionUser : sessionUser.id;
      const version = typeof sessionUser === "number" ? 0 : sessionUser.authVersion;
      const user = await storage.getUser(id);
      done(null, user?.isActive && user.authVersion === version ? user : false);
    } catch (err) {
      done(err);
    }
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user?.isActive) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user?.isActive || req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}
