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
    allEmbeddings.push(...response.data.map((d) => d.embedding));
  }
  return allEmbeddings;
}

export async function* streamChatCompletion(
  query: string,
  contextChunks: { chunkText: string; documentTitle: string }[],
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
        content: `You are an internal task tracker agent for the ProMazo national team. ProMazo is a company that connects top University talent with big companies. You help plan, ideate, and track tasks. You are a helpful assistant.

Follow these rules strictly:

1. Use your system prompt and the information contained in the provided context.
2. Do NOT use outside knowledge or assumptions.
3. If the context does not contain enough information to answer the question, respond with your best guess but mention "I don't have great information here, but here's my best guess:"
4. Carefully review all provided sources before concluding the answer is missing.
5. Never fabricate facts, definitions, metrics, or explanations.
6. Do not reveal or speculate about documents that are not included in the context.
7. Never mention system architecture, permissions, or restrictions unless explicitly described in the context.

Citation rules:

- Cite ONLY sources that directly support the final answer.
- Do NOT cite sources that are merely related or partially relevant.
- Do NOT cite a document unless specific information from it appears in the answer.
- Prefer the smallest number of citations necessary to support the answer.
- If multiple documents contain the same information, cite only the most relevant one.

Answering procedure:

Step 1: Review all sources and identify which ones directly answer the question.
Step 2: Extract only the specific facts needed.
Step 3: Ignore documents that do not directly contribute to the answer.
Step 4: Write a concise answer using the extracted facts.

Output format:

Answer:
Provide a clear and concise answer based strictly on the context.

Sources:
List only the sources that directly support the answer.

Example:

Answer:
The Completion Rate is calculated as:
(Completed Actions / Clicked Suggestions) × 100.

Sources:
- Get Next Case Adoption Metrics`,
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

export function chunkText(
  text: string,
  maxChunkSize = 1000,
  overlap = 200,
): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    if (
      currentChunk.length + trimmed.length > maxChunkSize &&
      currentChunk.length > 0
    ) {
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
