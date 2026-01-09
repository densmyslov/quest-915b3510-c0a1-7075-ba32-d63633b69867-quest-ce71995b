'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { PuzzleData } from '../../types/puzzle';

const S3_FALLBACK_BASE_URL =
  process.env.NEXT_PUBLIC_S3_URL ||
  'https://quest-platform-images-dev-us-east-2.s3.us-east-2.amazonaws.com/';

const CLOUDFLARE_IMAGES_ACCOUNT_HASH =
  process.env.CLOUDFLARE_ACCOUNT_HASH ||
  process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE ||
  process.env.NEXT_PUBLIC_CF_IMAGES_ACCOUNT_HASH ||
  '';

const CLOUDFLARE_IMAGES_VARIANT =
  process.env.NEXT_PUBLIC_CLOUDFLARE_IMAGES_VARIANT ||
  process.env.NEXT_PUBLIC_CF_IMAGES_VARIANT ||
  'public';

const PUZZLE_DATA_WORKER_BASE_URL =
  process.env.NEXT_PUBLIC_PUZZLE_DATA_WORKER_URL ||
  process.env.NEXT_PUBLIC_PUZZLE_DATA_PROXY_URL ||
  // Dev default used elsewhere in this template
  'https://quest-data-proxy-dev.denslov.workers.dev';

const stripLeadingSlashes = (s: string) => s.replace(/^\/+/, '');

const stripUrlQueryAndHash = (s: string) => s.split('#')[0]?.split('?')[0] ?? s;

const normaliseAssetKey = (s: string) => stripLeadingSlashes(s).replace(/^image\//, '');

const toCloudflareImageUrl = (key: string): string => {
  const cleaned = normaliseAssetKey(key);
  if (!cleaned) return '';
  if (!CLOUDFLARE_IMAGES_ACCOUNT_HASH) return '';
  return `https://imagedelivery.net/${CLOUDFLARE_IMAGES_ACCOUNT_HASH}/${cleaned}/${CLOUDFLARE_IMAGES_VARIANT}`;
};

const toPuzzleDataUrl = (key: string): string => {
  const cleaned = stripLeadingSlashes(key);
  if (!cleaned) return '';
  return `${PUZZLE_DATA_WORKER_BASE_URL.replace(/\/+$/, '')}/${cleaned}`;
};

const absolutiseImageUrl = (u: unknown): string => {
  const s = typeof u === 'string' ? u : '';
  if (!s) return '';
  if (s.startsWith('data:')) return s;

  if (s.startsWith('http')) {
    if (CLOUDFLARE_IMAGES_ACCOUNT_HASH && s.includes('/image/')) {
      const idx = s.indexOf('/image/');
      if (idx >= 0) {
        const key = stripUrlQueryAndHash(s.slice(idx + '/image/'.length));
        return toCloudflareImageUrl(key) || s;
      }
    }
    return s;
  }

  if (s.startsWith('/puzzle/')) return s;

  return toCloudflareImageUrl(s) || S3_FALLBACK_BASE_URL + stripLeadingSlashes(s);
};

const absolutisePuzzleDataUrl = (u: unknown): string => {
  const s = typeof u === 'string' ? u : '';
  if (!s) return '';
  if (s.startsWith('http')) return s;
  return toPuzzleDataUrl(s);
};

const normaliseFabricData = (pData: PuzzleData): PuzzleData => {
  const boardImageUrl = absolutiseImageUrl((pData as any).boardImageUrl);
  const boardImageDataUrl =
    typeof (pData as any).boardImageDataUrl === 'string' ? (pData as any).boardImageDataUrl : '';
  const originalImageUrl =
    absolutiseImageUrl((pData as any).originalImageUrl) || boardImageUrl || boardImageDataUrl || '';

  return {
    ...pData,
    boardImageUrl,
    originalImageUrl,
    pieces: (pData.pieces || []).map((pc: any) => ({
      ...pc,
      imageUrl: absolutiseImageUrl(pc.imageUrl),
      imageDataUrl: absolutiseImageUrl(typeof pc.imageDataUrl === 'string' ? pc.imageDataUrl : '')
    }))
  };
};

const normaliseWitchKnotData = (raw: Record<string, unknown>): Record<string, unknown> => {
  const doorImageUrl = absolutiseImageUrl(raw.doorImageUrl);
  const originalImageUrl = absolutiseImageUrl(raw.originalImageUrl);

  return {
    ...raw,
    doorImageUrl: doorImageUrl || raw.doorImageUrl,
    originalImageUrl: originalImageUrl || raw.originalImageUrl
  };
};


const normaliseSpotDiffAiData = (raw: Record<string, unknown>): Record<string, unknown> => {
  return {
    ...raw,
    originalImageUrl: absolutiseImageUrl(raw.originalImageUrl),
    diffImageUrl: absolutiseImageUrl(raw.diffImageUrl),
    boardImageUrl: absolutiseImageUrl(raw.boardImageUrl),
  };
};

const FabricPuzzleGame = dynamic(() => import('./mozaic/PuzzleGame'), {
  ssr: false,
  loading: () => <div>Loading Puzzle Engine...</div>
});

const WitchKnotGame = dynamic(() => import('./witch-knot/WitchKnotGame'), {
  ssr: false,
  loading: () => <div>Loading Witch Knot...</div>
});

const WitchKnotGameSimple = dynamic(() => import('./witch-knot-simple/WitchKnotSimpleGame'), {
  ssr: false,
  loading: () => <div>Loading Witch Knot Simple...</div>
});

const SpotDiffAiGame = dynamic(() => import('./spot-diff-ai/SpotDiffAiGame'), {
  ssr: false,
  loading: () => <div>Loading Spot Diff AI...</div>
});

const JigsawCustomGame = dynamic(() => import('./jigsaw-custom/JigsawCustomGame'), {
  ssr: false,
  loading: () => <div>Loading Jigsaw...</div>
});

type PuzzlePayload = PuzzleData | Record<string, unknown>;

export interface PuzzleRendererProps {
  type: 'mozaic' | 'jigsaw' | 'jigsaw_custom' | 'sliding' | 'fabric_custom' | 'witch_knot' | 'witch_knot_simple' | 'spot_diff_ai';
  puzzleId: string;
  userId: string;
  onComplete?: () => void;
  initialData?: PuzzlePayload | null;
  // Distribution context for knot/pattern assignment
  sessionId?: string;
  teamCode?: string;
  startedAt?: string;
  teamMemberIds?: string[]; // Session IDs of all team members for distribution
}

export const PuzzleRenderer: React.FC<PuzzleRendererProps> = ({
  type,
  puzzleId,
  userId,
  onComplete,
  initialData,
  sessionId,
  teamCode,
  startedAt,
  teamMemberIds
}) => {
  const [puzzleData, setPuzzleData] = React.useState<PuzzlePayload | null>(initialData ?? null);
  const [error, setError] = React.useState<string | null>(null);
  const [isMounted, setIsMounted] = React.useState(false);

  React.useEffect(() => {
    setIsMounted(true);
  }, []);

  React.useEffect(() => {
    if (typeof initialData === 'undefined') return;
    setPuzzleData(initialData ?? null);
  }, [initialData]);

  const renderData = React.useMemo(() => {
    if (!puzzleData) return null;
    if (type === 'fabric_custom' || type === 'jigsaw_custom' || type === 'jigsaw') return normaliseFabricData(puzzleData as PuzzleData);
    if (type === 'witch_knot' || type === 'witch_knot_simple') return normaliseWitchKnotData(puzzleData as Record<string, unknown>);
    if (type === 'spot_diff_ai') return normaliseSpotDiffAiData(puzzleData as Record<string, unknown>);
    return puzzleData;
  }, [puzzleData, type]);

  React.useEffect(() => {
    if (typeof initialData !== 'undefined') return;
    if (type !== 'fabric_custom' && type !== 'jigsaw_custom' && type !== 'jigsaw') return;

    const ac = new AbortController();
    let alive = true;

    const fetchPuzzle = async () => {
      try {
        setError(null);

        const API_BASE_URL =
          (process.env.NEXT_PUBLIC_API_URL || 'https://api.quest-platform.com') + '/api/v1';

        const res = await fetch(`${API_BASE_URL}/puzzles?client_id=${userId}`, {
          signal: ac.signal
        });
        if (!res.ok) throw new Error('Failed to load puzzles');

        const data = await res.json();
        const puzzle = (data.puzzles || []).find((p: any) => p.id === puzzleId);
        if (!puzzle) throw new Error('Puzzle not found');

        let pData: PuzzleData;

        if (puzzle.interaction_data?.puzzle_data_url) {
          const puzzleDataUrl = puzzle.interaction_data.puzzle_data_url as unknown;
          let fullUrl = absolutisePuzzleDataUrl(puzzleDataUrl);

          // bypass “/image/” for JSON files if needed
          if (fullUrl.includes('.json') && fullUrl.includes('/image/')) {
            fullUrl = fullUrl.replace('/image/', '/');
          }

          const dataRes = await fetch(fullUrl, { signal: ac.signal });
          if (!dataRes.ok) throw new Error('Failed to load puzzle data');

          pData = (await dataRes.json()) as PuzzleData;
        } else if (puzzle.interaction_data?.puzzle_data) {
          pData = puzzle.interaction_data.puzzle_data as PuzzleData;
        } else if (puzzle.data && puzzle.data.pieces) {
          pData = puzzle.data as PuzzleData;
        } else if (puzzle.pieces) {
          pData = puzzle as PuzzleData;
        } else {
          throw new Error('Unknown puzzle format');
        }

        pData = normaliseFabricData(pData);

        if (!alive) return;
        setPuzzleData(pData);
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        if (!alive) return;
        console.error('❌ Puzzle load error:', e);
        setError(e.message || 'Failed to load puzzle');
      }
    };

    fetchPuzzle();

    return () => {
      alive = false;
      ac.abort();
    };
  }, [type, puzzleId, userId, initialData]);

  if (!isMounted) {
    return <div className="h-screen w-full flex items-center justify-center bg-gray-900 text-white">Loading Puzzle...</div>;
  }

  if (error) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-gray-900 text-white">
        <div className="p-4 text-red-500">Error loading puzzle: {error}</div>
      </div>
    );
  }

  const Loader = () => (
    <div className="h-screen w-full flex items-center justify-center bg-gray-900 text-white">Loading Puzzle...</div>
  );

  const renderPuzzle = () => {
    switch (type) {
      case 'jigsaw':
      case 'jigsaw_custom':
        if (!renderData) return <Loader />;
        return (
          <JigsawCustomGame
            key={`${type}:${puzzleId}`}
            puzzleData={renderData as PuzzleData}
            onComplete={onComplete}
          />
        );
      case 'fabric_custom':
        if (!renderData) return <Loader />;
        return (
          <FabricPuzzleGame
            key={`${type}:${puzzleId}`}
            puzzleData={renderData as PuzzleData}
            onComplete={onComplete}
          />
        );
      case 'witch_knot':
        if (!renderData) return <Loader />;
        return (
          <WitchKnotGame
            key={`${type}:${puzzleId}`}
            puzzleData={renderData}
            onComplete={onComplete}
          />
        );
      case 'witch_knot_simple':
        if (!renderData) return <Loader />;
        return (
          <WitchKnotGameSimple
            key={`${type}:${puzzleId}`}
            puzzleData={renderData}
            onComplete={onComplete}
            sessionId={sessionId}
            teamCode={teamCode}
            startedAt={startedAt}
            puzzleId={puzzleId}
            teamMemberIds={teamMemberIds}
          />
        );
      case 'spot_diff_ai':
        if (!renderData) return <Loader />;
        return (
          <SpotDiffAiGame
            key={`${type}:${puzzleId}`}
            puzzleData={renderData as any}
            onComplete={onComplete}
          />
        );
      default:
        return <div>Unknown puzzle type: {type}</div>;
    }
  };

  return renderPuzzle();
};
