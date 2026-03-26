import { retrieveDocumentContext, type DocChunk } from "./documentRetrievalService";
import type { User } from "@shared/schema";
import type { ReadDocsArgs } from "./toolIntentSelector";

export type ReadDocsResult = {
  chunks: DocChunk[];
  contextText: string;
  isEmpty: boolean;
  suggestRetry?: string;
};

export async function runReadDocsTool(
  args: ReadDocsArgs,
  user: User
): Promise<ReadDocsResult> {
  const limit = args.limit ?? 5;
  const result = await retrieveDocumentContext(args.query, user, limit);

  if (result.chunks.length === 0) {
    return {
      chunks: [],
      contextText: "",
      isEmpty: true,
      suggestRetry: `I searched the documents for "${args.query}" but didn't find anything useful. Should we try again with a different phrasing or a broader search term?`,
    };
  }

  return {
    chunks: result.chunks,
    contextText: result.contextText,
    isEmpty: false,
  };
}
