import { APICallError, wrapLanguageModel } from 'ai';

// e2e 0.22.0 folds a mid-stream response.failed into HTTP 400 (dist/oauth/sse.js), which the AI SDK never retries.
// An overload is transient, so only that failure becomes retryable; the SDK's backoff and the step deadline still bound it.
const overloaded = /overloaded|capacity|service unavailable/i;
function retryable(error: unknown) {
  if (!APICallError.isInstance(error) || error.isRetryable || error.statusCode !== 400 || !overloaded.test(`${error.message} ${error.responseBody ?? ''}`)) return error;
  return new APICallError({ message: error.message, url: error.url, requestBodyValues: error.requestBodyValues, statusCode: error.statusCode,
    responseHeaders: error.responseHeaders, responseBody: error.responseBody, cause: error, isRetryable: true, data: error.data });
}
export function retryOverload(model: Parameters<typeof wrapLanguageModel>[0]['model']) {
  return wrapLanguageModel({ model, middleware: { specificationVersion: 'v4',
    wrapGenerate: async ({ doGenerate }) => { try { return await doGenerate(); } catch (error) { throw retryable(error); } },
    wrapStream: async ({ doStream }) => { try { return await doStream(); } catch (error) { throw retryable(error); } },
  } });
}
