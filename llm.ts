/**
 * LLM client for memory extraction, dedup, and merge.
 * Uses OpenAI-compatible chat completions API.
 */

import OpenAI from "openai";

export class LlmClient {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string, baseUrl?: string) {
    this.client = new OpenAI({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });
    this.model = model;
  }

  async complete(prompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    });
    return response.choices[0]?.message?.content?.trim() ?? "";
  }

  async completeJson<T>(prompt: string): Promise<T | null> {
    const raw = await this.complete(prompt);
    return parseJsonFromResponse<T>(raw);
  }
}

/** Extract JSON from LLM response that may contain markdown fences. */
export function parseJsonFromResponse<T>(text: string): T | null {
  // Try direct parse first
  try {
    return JSON.parse(text) as T;
  } catch {
    // noop
  }

  // Try extracting from markdown code fence
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]) as T;
    } catch {
      // noop
    }
  }

  // Try balanced brace extraction — find first { and its matching }
  // Tracks string context to avoid counting braces inside JSON string literals
  const braceStart = text.indexOf("{");
  if (braceStart !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = braceStart; i < text.length; i++) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\" && inString) {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(braceStart, i + 1)) as T;
          } catch {
            break;
          }
        }
      }
    }
  }

  return null;
}
