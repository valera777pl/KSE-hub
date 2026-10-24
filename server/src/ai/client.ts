import type OpenAI from 'openai';

/**
 * Gemini through Google's OpenAI-compatible endpoint, on native fetch
 * (the openai SDK v4's node-fetch breaks on Gemini responses under Node 24).
 * One model for the assistant and for email summaries; GEMINI_MODEL overrides it.
 */

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
const DEFAULT_MODEL = 'gemini-flash-lite-latest';
// The free tier limits requests per minute; Gemini says how long to wait
const MAX_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 30_000;

export type ChatRequest = Omit<OpenAI.ChatCompletionCreateParamsNonStreaming, 'model'>;

export function hasAI(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

export async function chatCompletion(body: ChatRequest): Promise<OpenAI.ChatCompletion> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, model: process.env.GEMINI_MODEL || DEFAULT_MODEL }),
      signal: AbortSignal.timeout(45_000),
    });
    if (res.ok) return res.json() as Promise<OpenAI.ChatCompletion>;

    const text = await res.text();
    const wait = res.status === 429 || res.status === 503 ? retryDelayMs(text) : null;
    if (wait === null || attempt >= MAX_RETRIES) throw new Error(`Gemini ${res.status}: ${text.slice(0, 300)}`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/** Reads google.rpc.RetryInfo ("retryDelay": "23s"); null when the wait is too long to bother. */
export function retryDelayMs(errorBody: string): number | null {
  const seconds = parseFloat(errorBody.match(/"retryDelay":\s*"([\d.]+)s"/)?.[1] ?? '5');
  const ms = Math.ceil(seconds * 1000) + 500;
  return ms <= MAX_RETRY_WAIT_MS ? ms : null;
}
