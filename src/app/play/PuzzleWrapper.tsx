'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import type { PuzzleRendererProps } from '@/components/puzzles/PuzzleRenderer';

// Dynamic import with ssr: false is allowed here because this is a Client Component
const PuzzleRenderer = dynamic(
    () => import('@/components/puzzles/PuzzleRenderer').then(mod => mod.PuzzleRenderer),
    { ssr: false }
);

type PuzzleWrapperProps = PuzzleRendererProps;

export default function PuzzleWrapper(props: PuzzleWrapperProps) {
    return <PuzzleRenderer {...props} />;
}
