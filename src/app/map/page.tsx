'use client';

import dynamic from 'next/dynamic';
import { useQuestData } from '@/context/QuestContext';
import Navigation from '@/components/Navigation';

const QuestMap = dynamic(() => import('@/components/quest-map/QuestMap'), {
    ssr: false,
    loading: () => <div className="h-full w-full flex items-center justify-center bg-gray-100">Loading Map...</div>
});

export default function MapPage() {
    const data = useQuestData();

    if (!data) {
        console.log('[MapPage] No data, returning null');
        return null;
    }
    console.log('[MapPage] Rendering QuestMap');

    return (
        <main className="flex min-h-screen flex-col relative">
            <div className="z-10 w-full max-w-5xl items-center justify-between font-mono text-sm lg:flex p-4 absolute top-0 left-0 pointer-events-none">
                <div className="fixed left-0 top-0 flex w-full justify-center border-b border-gray-300 bg-gradient-to-b from-zinc-200 pb-6 pt-8 backdrop-blur-2xl dark:border-neutral-800 dark:bg-zinc-800/30 dark:from-inherit lg:static lg:w-auto lg:rounded-xl lg:border lg:bg-gray-200 lg:p-4 lg:dark:bg-zinc-800/30 pointer-events-auto">
                    <h1 className="text-xl font-bold">{data.quest.name}</h1>
                </div>
            </div>

            <div className="w-full h-[calc(100vh-4rem)] relative">
                <QuestMap />


            </div>

            <Navigation />
        </main>
    );
}
