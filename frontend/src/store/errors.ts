/**
 * Backend API error response shapes and client error classes.
 * Modeled directly on backend error handler.
 */

export interface ApiFieldError {
  field: string;
  message: string;
}

export interface ApiErrorPayload {
  success: false;
  message: string;
  errors?: ApiFieldError[];
  stack?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly errors?: ApiFieldError[];
  readonly raw?: unknown;

  constructor(message: string, status: number, errors?: ApiFieldError[], raw?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
    this.raw = raw;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  getFieldError(fieldName: string): string | undefined {
    return this.errors?.find((e) => e.field === fieldName)?.message;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isServerError(): boolean {
    return this.status >= 500;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export function extractErrorMessage(
  err: unknown,
  fallback = 'Something went wrong. Please try again.'
): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null) {
    const payload = err as { message?: string; errors?: ApiFieldError[] };
    if (payload.errors && payload.errors.length > 0 && payload.errors[0]?.message) {
      return payload.errors[0].message;
    }
    if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
      return payload.message;
    }
  }
  if (typeof err === 'string' && err.trim().length > 0) return err;
  return fallback;
}
