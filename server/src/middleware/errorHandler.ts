import type { Context, Next } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';

export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (err) {
    console.error('[Error]', err);

    if (err instanceof ZodError) {
      return c.json(
        {
          error: 'Validation error',
          details: err.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        },
        400
      );
    }

    if (err instanceof AppError) {
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }

    return c.json({ error: 'Internal server error' }, 500);
  }
}

export class AppError extends Error {
  constructor(
    message: string,
    public status: number = 400
  ) {
    super(message);
    this.name = 'AppError';
  }
}
