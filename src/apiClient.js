import { ApiError } from './tracer.js';

function categoryFromStatus(status) {
  if (status === 503) return 'TEMPORARY_UNAVAILABLE';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 408 || status === 504) return 'TIMEOUT';
  if (status === 401 || status === 403) return 'AUTH_FAILED';
  if (status >= 400 && status < 500) return 'BAD_REQUEST';
  return 'UPSTREAM_ERROR';
}

// Thin HTTP client used by the demo integration. Reads the billed cost from
// the response header on both success and failure.
export async function callApi(origin, { method = 'GET', path, body, headers = {} }) {
  let res;
  try {
    res = await fetch(origin + path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    throw new ApiError(`Network error: ${err.message}`, {
      category: 'NETWORK_ERROR',
      retryable: true,
    });
  }

  const cost = Number(res.headers.get('x-sandbox-cost-usd') ?? 0);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const info = data?.error ?? {};
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new ApiError(info.message ?? `HTTP ${res.status}`, {
      category: info.category ?? categoryFromStatus(res.status),
      httpStatus: res.status,
      retryable: info.retryable ?? (res.status >= 500 || res.status === 429),
      cost,
      retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : null,
      body: data,
    });
  }
  return { data, cost, httpStatus: res.status };
}
