// Separate real server process for restart tests. Uses the actual auth routes.
import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { registerRoutes } from "../../server/routes";

if (!process.env.DATABASE_URL?.includes("session_test_")) throw new Error("Isolated schema required");
const app = express();
app.use(express.json());
const server = createServer(app);
await registerRoutes(server, app);
app.use(express.static(path.resolve("dist/public")));
app.get("/{*path}", (_req, res) => res.sendFile(path.resolve("dist/public/index.html")));
server.listen(Number(process.env.SESSION_TEST_PORT || 0), "127.0.0.1", () => {
  console.log(`SESSION_TEST_READY:${(server.address() as { port: number }).port}`);
});
