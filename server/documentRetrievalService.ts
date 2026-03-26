import { getEmbedding } from "./openai";
import { storage } from "./storage";
import type { User } from "@shared/schema";

export type DocChunk = {
  documentId: number;
  documentTitle: string;
  chunkId: number;
  chunkText: string;
  similarity: number;
};

export type DocRetrievalResult = {
  chunks: DocChunk[];
  contextText: string;
};

export async function retrieveDocumentContext(
  query: string,
  user: User,
  limit = 5
): Promise<DocRetrievalResult> {
  const accessibleDocIds = await storage.getAccessibleDocumentIds(user);
  if (accessibleDocIds.length === 0) {
    return { chunks: [], contextText: "" };
  }

  const embedding = await getEmbedding(query);
  const similarChunks = await storage.searchSimilarChunks(embedding, accessibleDocIds, limit);

  if (similarChunks.length === 0) {
    return { chunks: [], contextText: "" };
  }

  const allDocs = await storage.getAllDocuments();
  const docMap = new Map(allDocs.map((d) => [d.id, d]));

  const chunks: DocChunk[] = similarChunks.map((chunk) => ({
    documentId: chunk.documentId,
    documentTitle: docMap.get(chunk.documentId)?.title ?? "Unknown",
    chunkId: chunk.id,
    chunkText: chunk.chunkText,
    similarity: chunk.similarity,
  }));

  const contextText = chunks
    .map((c, i) => `[Source ${i + 1}: ${c.documentTitle}]\n${c.chunkText.slice(0, 200)}`)
    .join("\n\n---\n\n");

  return { chunks, contextText };
}
