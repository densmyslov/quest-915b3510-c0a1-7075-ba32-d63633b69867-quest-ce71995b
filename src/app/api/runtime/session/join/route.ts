import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'edge';
import { proxyToAwsRuntime } from '@/runtime-core/awsRuntimeProxy';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const response = await proxyToAwsRuntime('/runtime/session/join', 'POST', body);
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to join session' },
      { status: 500 }
    );
  }
}
