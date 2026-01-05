'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuest } from '@/context/QuestContext';

export default function Navigation() {
    const pathname = usePathname();
    const { progress } = useQuest();

    const isActive = (path: string) => pathname === path;

    return (
        <nav className="fixed bottom-0 left-0 w-full bg-white border-t border-gray-200 dark:bg-zinc-900 dark:border-zinc-800 z-50">
            <div className="flex justify-around items-center h-16 max-w-5xl mx-auto">

                <Link
                    href="/map"
                    className={`flex flex-col items-center justify-center w-full h-full transition-colors ${isActive('/map')
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                        }`}
                >
                    <span className="text-sm font-medium">Map</span>
                </Link>

                <Link
                    href="/play/puzzle"
                    className={`flex flex-col items-center justify-center w-full h-full transition-colors ${isActive('/play/puzzle')
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                        } ${progress?.collectedPieces.length === 0 ? 'opacity-50 pointer-events-none' : ''}`}
                >
                    <span className="text-sm font-medium">
                        Puzzle {progress?.collectedPieces.length > 0 && `(${progress.collectedPieces.length})`}
                    </span>
                </Link>
            </div>
        </nav>
    );
}
