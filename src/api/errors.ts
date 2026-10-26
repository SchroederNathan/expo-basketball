export type ApiErrorKind = 'not-found' | 'unavailable' | 'network' | 'contract';

type ApiErrorDetails = {
  readonly status?: number | null;
  readonly issuePath?: string | null;
  readonly cause?: unknown;
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly issuePath: string | null;

  constructor(kind: ApiErrorKind, message: string, details: ApiErrorDetails = {}) {
    super(message, { cause: details.cause });
    this.name = 'ApiError';
    this.kind = kind;
    this.status = details.status ?? null;
    this.issuePath = details.issuePath ?? null;
  }
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'not-found';
}

export function shouldRetry(failureCount: number, error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.kind === 'network' || error.kind === 'unavailable') &&
    failureCount < 2
  );
}

// Server error bodies can contain upstream URLs, so the interface only shows
// these fixed messages.
export function loadErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong while loading.';
  switch (error.kind) {
    case 'not-found':
      return 'This page is not available.';
    case 'network':
      return 'The connection failed. Check your network and try again.';
    case 'unavailable':
      return 'The score service is unavailable right now.';
    case 'contract':
      return 'The score service sent data this version of the app can’t read.';
    default: {
      const exhaustive: never = error.kind;
      return exhaustive;
    }
  }
}
