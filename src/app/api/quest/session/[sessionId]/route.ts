import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'edge';
import { proxyToAwsRuntime } from '@/runtime-core/awsRuntimeProxy';

export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const url = new URL(request.url);
  const playerId = url.searchParams.get('playerId');

  if (!playerId) {
    return NextResponse.json({ success: false, error: 'Missing playerId' }, { status: 400 });
  }

  try {
    const response = await proxyToAwsRuntime(`/runtime/session/${sessionId}`, 'GET', undefined, { playerId });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to get session' },
      { status: 500 },
    );
  }
}

