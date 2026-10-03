import type { Express } from "express";
import { requireAuth } from "./auth";
import { createSprintPlanSchema, updateSprintPlanSchema } from "@shared/schema";
import { createSprintPlan, getSprintPlan, listSprintPlans, SprintPlanError, updateSprintPlan } from "./sprintPlanService";

export function registerSprintPlanRoutes(app: Express) {
  const root = "/api/projects/:projectId/sprint-plans";
  app.use(root, requireAuth, (req, res, next) => {
    if (!Number.isSafeInteger(Number(req.params.projectId)) || Number(req.params.projectId) <= 0)
      return res.status(400).json({ message: "Invalid project id" });
    next();
  });
  function fail(res: import("express").Response, error: unknown) {
    return res.status(error instanceof SprintPlanError ? error.status : 500).json(
      error instanceof SprintPlanError
        ? { message: error.message, ...(error.existingPlan ? { existingPlan: error.existingPlan } : {}) }
        : { message: "Could not load or save sprint plans. Please retry." },
    );
  }
  app.get(root, async (req, res) => {
    try { return res.json(await listSprintPlans(Number(req.params.projectId))); }
    catch (error) { return fail(res, error); }
  });
  app.post(root, async (req, res) => {
    const input = createSprintPlanSchema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ message: input.error.errors[0].message });
    try { return res.status(201).json(await createSprintPlan(Number(req.params.projectId), input.data)); }
    catch (error) { return fail(res, error); }
  });
  for (const method of ["get", "patch"] as const) {
    app[method](`${root}/:planId`, async (req, res) => {
      const planId = Number(req.params.planId);
      if (!Number.isSafeInteger(planId) || planId <= 0) return res.status(400).json({ message: "Invalid sprint plan id" });
      try {
        if (method === "get") return res.json(await getSprintPlan(Number(req.params.projectId), planId));
        const input = updateSprintPlanSchema.safeParse(req.body);
        if (!input.success) return res.status(400).json({ message: input.error.errors[0].message });
        return res.json(await updateSprintPlan(Number(req.params.projectId), planId, input.data.content));
      } catch (error) { return fail(res, error); }
    });
  }
}