export function getQuestApiUrl(): string {
    if (process.env.NEXT_PUBLIC_QUEST_API_URL) {
        return process.env.NEXT_PUBLIC_QUEST_API_URL.replace(/\/+$/, '');
    }
    if (process.env.NEXT_PUBLIC_API_URL) {
        return process.env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '');
    }
    if (typeof window !== 'undefined') {
        return window.location.origin;
    }
    return 'http://localhost:8787';
}
