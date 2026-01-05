/**
 * Proxy runtime API calls to AWS Lambda backend
 * Replaces in-memory state management with DynamoDB-backed persistence
 */

export async function proxyToAwsRuntime(
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
  queryParams?: Record<string, string>
): Promise<Response> {
  const runtimeApiUrl = process.env.NEXT_PUBLIC_RUNTIME_API_URL || process.env.RUNTIME_API_URL;

  console.log('[awsRuntimeProxy] proxyToAwsRuntime START', { path, method, runtimeApiUrl, body, queryParams });

  if (!runtimeApiUrl) {
    console.error('[awsRuntimeProxy] RUNTIME_API_URL not configured');
    throw new Error('RUNTIME_API_URL not configured');
  }

  // Construct URL by appending path to base (handle leading slash)
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  const baseUrl = runtimeApiUrl.endsWith('/') ? runtimeApiUrl.slice(0, -1) : runtimeApiUrl;
  const fullUrl = `${baseUrl}/${normalizedPath}`;

  const url = new URL(fullUrl);
  if (queryParams) {
    Object.entries(queryParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  console.log('[awsRuntimeProxy] Fetching URL:', url.toString());
  const response = await fetch(url.toString(), {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  console.log('[awsRuntimeProxy] Response received', { status: response.status, ok: response.ok });
  return response;
}
