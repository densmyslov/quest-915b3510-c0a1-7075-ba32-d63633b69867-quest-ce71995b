import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'edge';
import { proxyToAwsRuntime } from '@/runtime-core/awsRuntimeProxy';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const questId = searchParams.get('questId');
  const questVersion = searchParams.get('questVersion');

  if (!questId || !questVersion) {
    return NextResponse.json(
      { success: false, error: 'Missing questId or questVersion' },
      { status: 400 }
    );
  }

  try {
    const response = await proxyToAwsRuntime('/runtime/compiled', 'GET', undefined, { questId, questVersion });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to load compiled definition' },
      { status: 500 }
    );
  }
}

