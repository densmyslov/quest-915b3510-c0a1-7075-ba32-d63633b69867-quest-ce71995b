

export const getTextDisplayConfig = (item: any): { mode: 'seconds' | 'until_close'; seconds: number } => {
    const rawMode = item?.displayMode ?? item?.display_mode ?? 'until_close';
    const mode: 'seconds' | 'until_close' = rawMode === 'until_close' ? 'until_close' : 'seconds';
    const rawSeconds = item?.displaySeconds ?? item?.display_seconds ?? 5;
    const seconds = Number.isFinite(Number(rawSeconds)) ? Math.max(1, Number(rawSeconds) || 5) : 5;
    return { mode, seconds };
};

export const getVideoConfig = (item: any) => {
    const rawAutoPlay = item?.autoPlay ?? item?.autoplay ?? item?.auto_play;
    const rawMuted = item?.muted ?? item?.mute;
    const rawLoop = item?.loop;
    const rawPoster = item?.posterUrl ?? item?.poster_url ?? item?.poster;
    const autoPlay = typeof rawAutoPlay === 'boolean' ? rawAutoPlay : true;
    return {
        autoPlay,
        // Default to muted when autoplaying to satisfy browser autoplay policies.
        muted: typeof rawMuted === 'boolean' ? rawMuted : autoPlay,
        loop: typeof rawLoop === 'boolean' ? rawLoop : false,
        posterUrl: typeof rawPoster === 'string' ? rawPoster : undefined
    };
};

export const getItemImageUrls = (item: any): string[] => {
    const raw = item?.image_urls ?? item?.imageUrls ?? [];
    if (!Array.isArray(raw)) return [];
    return raw.filter((v: unknown): v is string => typeof v === 'string' && v.length > 0);
};
