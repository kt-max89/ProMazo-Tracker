import OpenAI from "openai";
import crypto from "crypto";

if (!process.env.OPENAI_API_KEY) {
  console.warn("OPENAI_API_KEY not set - AI features will not work");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

export async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const batchSize = 100;
  const allEmbeddings: number[][] = [];
  
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch,
    });
    allEmbeddings.push(...response.data.map(d => d.embedding));
  }
  return allEmbeddings;
}

export async function* streamChatCompletion(
  query: string,
  contextChunks: { chunkText: string; documentTitle: string }[]
): AsyncGenerator<string> {
  const contextText = contextChunks
    .map((c, i) => `[Source ${i + 1}: ${c.documentTitle}]\n${c.chunkText}`)
    .join("\n\n---\n\n");

  const stream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    stream: true,
    messages: [
      {
        role: "system",
        content: `You are a helpful assistant that answers questions based on internal company documents. 
Use ONLY the provided context to answer questions. If the context doesn't contain enough information, say so clearly.
Always cite your sources using [Source N] notation when referencing information from the context.
Be concise and accurate.`,
      },
      {
        role: "user",
        content: `Context:\n${contextText}\n\n---\n\nQuestion: ${query}`,
      },
    ],
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      yield content;
    }
  }
}

export function chunkText(text: string, maxChunkSize = 1000, overlap = 200): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    if (currentChunk.length + trimmed.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-Math.floor(overlap / 5));
      currentChunk = overlapWords.join(" ") + "\n\n" + trimmed;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + trimmed;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  if (chunks.length === 0 && text.trim().length > 0) {
    for (let i = 0; i < text.length; i += maxChunkSize - overlap) {
      chunks.push(text.slice(i, i + maxChunkSize).trim());
    }
  }

  return chunks;
}

export function hashChunk(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}
