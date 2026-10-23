import type OpenAI from 'openai';

/**
 * Minimal OpenAI-compatible chat client on native fetch.
 * (The openai SDK v4's node-fetch breaks on Gemini responses under Node 24.)
 *
 * GEMINI_API_KEY set → Google's OpenAI-compatible endpoint, otherwise OpenAI.
 * Model lists are tried in order: an overloaded or retired model (429/503/404)
 * falls through to the next one. Override with AI_MODEL / AI_SUMMARY_MODEL (comma-separated).
 */

type Purpose = 'assistant' | 'summary';

const GEMINI = {
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  models: { assistant: ['gemini-3.5-flash', 'gemini-flash-lite-latest'], summary: ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite'] },
};
const OPENAI = {
  baseUrl: 'https://api.openai.com/v1',
  models: { assistant: ['gpt-4o'], summary: ['gpt-4o-mini'] },
};

const FALLTHROUGH_STATUSES = new Set([404, 429, 500, 503]);

function provider() {
  if (process.env.GEMINI_API_KEY) return { ...GEMINI, apiKey: process.env.GEMINI_API_KEY };
  if (process.env.OPENAI_API_KEY) return { ...OPENAI, apiKey: process.env.OPENAI_API_KEY };
  throw new Error('No AI key: set GEMINI_API_KEY or OPENAI_API_KEY');
}

function modelsFor(purpose: Purpose, defaults: string[]): string[] {
  const override = purpose === 'assistant' ? process.env.AI_MODEL : process.env.AI_SUMMARY_MODEL;
  return override ? override.split(',').map((m) => m.trim()).filter(Boolean) : defaults;
}

export type ChatRequest = Omit<OpenAI.ChatCompletionCreateParamsNonStreaming, 'model'>;

export async function chatCompletion(purpose: Purpose, body: ChatRequest): Promise<OpenAI.ChatCompletion> {
  const { baseUrl, apiKey, models } = provider();
  let lastError: Error | null = null;

  for (const model of modelsFor(purpose, models[purpose])) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, model }),
      signal: AbortSignal.timeout(45_000),
    }).catch((err: Error) => err);

    if (res instanceof Error) {
      lastError = res;
      continue;
    }
    if (res.ok) return res.json() as Promise<OpenAI.ChatCompletion>;

    lastError = new Error(`AI ${model} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    if (!FALLTHROUGH_STATUSES.has(res.status)) break;
  }
  throw lastError ?? new Error('AI request failed');
}
