import ObjectClient from './ObjectClient';
import { Suspense } from 'react';

export const runtime = 'edge';

export default function ObjectPage({ params }: { params: { id: string } }) {
    return (
        <Suspense fallback={<div className="h-screen w-full flex items-center justify-center">Loading…</div>}>
            <ObjectClient objectId={params.id} />
        </Suspense>
    );
}
