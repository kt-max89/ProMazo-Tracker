import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { agentInstructionsTable as settings } from "./schema";
import { AGENT_APPLICATION_RULES, DEFAULT_MAIN_AGENT_INSTRUCTIONS } from "./promptBuilder";

export const agentInstructionsInput = z.object({
  instructions: z.string().min(1).max(16000).refine(text => text.trim().length > 0, "Instructions cannot be blank"),
  version: z.number().int().min(0).max(2147483646),
}).strict();

export class AgentInstructionsConflict extends Error {
  constructor() { super("Another admin changed the instructions. Reload the latest saved version before saving again."); }
}

export async function getAgentInstructions() {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  return {
    instructions: row?.instructions ?? DEFAULT_MAIN_AGENT_INSTRUCTIONS,
    version: row?.version ?? 0,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    applicationRules: AGENT_APPLICATION_RULES,
  };
}

export async function saveAgentInstructions(input: z.infer<typeof agentInstructionsInput>) {
  const validated = agentInstructionsInput.parse(input);
  const row = await db.transaction(async tx => {
    // Insert the default only if absent; do not replace a concurrently saved row.
    await tx.insert(settings).values({ id: 1, instructions: DEFAULT_MAIN_AGENT_INSTRUCTIONS })
      .onConflictDoNothing();
    const changed = await tx.update(settings).set({
      instructions: validated.instructions,
      version: sql`${settings.version} + 1`,
      updatedAt: new Date(),
    }).where(and(eq(settings.id, 1), eq(settings.version, validated.version))).returning();
    if (!changed.length) throw new AgentInstructionsConflict();
    return changed[0];
  });
  return {
    instructions: row.instructions,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    applicationRules: AGENT_APPLICATION_RULES,
  };
}
