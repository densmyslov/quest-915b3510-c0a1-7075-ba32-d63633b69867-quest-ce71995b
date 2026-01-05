import PuzzleClient from './PuzzleClient';
import { Suspense } from 'react';

export const runtime = 'edge';

export default function PuzzlePage({ params }: { params: { id: string } }) {
    return (
        <Suspense fallback={<div className="h-screen w-full flex items-center justify-center">Loading…</div>}>
            <PuzzleClient puzzleId={params.id} />
        </Suspense>
    );
}
