import type { z } from 'zod';
import { API_BASE_URL } from './config';
import { ApiError } from './errors';
import { DEMO_ENABLED } from '@/demo/config';
import { demoResponse } from './demo';

export type RequestOptions = {
  readonly signal?: AbortSignal;
  // A user-requested refresh must reach the server even inside max-age.
  readonly fresh?: boolean;
};

type GetRequest<S extends z.ZodType> = RequestOptions & {
  readonly path: `/${string}`;
  readonly params: Readonly<Record<string, string>>;
  readonly schema: S;
};

function queryString(params: Readonly<Record<string, string>>): string {
  const pairs = Object.entries(params).map(
    ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
  );
  return pairs.join('&');
}

export async function apiGet<S extends z.ZodType>({
  path,
  params,
  schema,
  signal,
  fresh = false,
}: GetRequest<S>): Promise<z.output<S>> {
  if (DEMO_ENABLED) {
    signal?.throwIfAborted();
    const parsed = schema.safeParse(demoResponse({ path, params }));
    if (!parsed.success) throw new ApiError('contract', 'The demo fixture has an unexpected shape.');
    return parsed.data;
  }
  const url = `${API_BASE_URL}${path}?${queryString(params)}`;
  let response: Response;
  try {
    response = await fetch(url, { signal, cache: fresh ? 'no-store' : 'default' });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new ApiError('network', 'The request failed before the server answered.', { cause });
  }
  if (!response.ok) {
    throw new ApiError(
      response.status === 404 ? 'not-found' : 'unavailable',
      `The server answered with status ${response.status}.`,
      { status: response.status },
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new ApiError('contract', 'The response was not JSON.', { status: response.status, cause });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError('contract', issue?.message ?? 'The response had an unexpected shape.', {
      status: response.status,
      issuePath: issue ? issue.path.map(String).join('.') : null,
    });
  }
  return parsed.data;
}
