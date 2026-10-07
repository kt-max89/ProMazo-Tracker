import type { Express } from "express";
import { requireAdmin } from "./auth";
import { AgentInstructionsConflict, agentInstructionsInput, getAgentInstructions, saveAgentInstructions } from "./agentInstructionsService";

export function registerAgentInstructionsRoutes(app: Express) {
  app.get("/api/admin/agent-instructions", requireAdmin, async (_req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await getAgentInstructions());
    } catch {
      res.status(503).json({ message: "Agent instructions are unavailable. Please try again." });
    }
  });
  app.patch("/api/admin/agent-instructions", requireAdmin, async (req, res) => {
    const parsed = agentInstructionsInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Provide nonblank instructions of up to 16,000 characters and the saved version." });
    try {
      res.setHeader("Cache-Control", "no-store");
      return res.json(await saveAgentInstructions(parsed.data));
    } catch (error) {
      if (error instanceof AgentInstructionsConflict) return res.status(409).json({ message: error.message });
      return res.status(503).json({ message: "Could not save agent instructions. Your changes have not been confirmed saved." });
    }
  });
}
