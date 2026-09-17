import type { ToolCall } from "./toolIntentSelector";

export type SettledReadToolResult<T> =
  | { call: ToolCall; status: "fulfilled"; value: T }
  | { call: ToolCall; status: "rejected"; error: string };

/**
 * Read tools are independent sources. One unavailable source should be visible
 * to the final-answer model without discarding results from the other sources.
 */
export async function settleReadToolCalls<T>(
  calls: ToolCall[],
  execute: (call: ToolCall) => Promise<T>,
): Promise<SettledReadToolResult<T>[]> {
  return Promise.all(calls.map(async call => {
    try {
      return { call, status: "fulfilled", value: await execute(call) } as const;
    } catch (error) {
      return {
        call,
        status: "rejected",
        error: error instanceof Error ? error.message : "Unknown read-tool error",
      } as const;
    }
  }));
}