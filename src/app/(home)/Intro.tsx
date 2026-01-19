
import { useState, useEffect, useRef } from 'react';

const INTRO_BACKGROUND_IMAGE_URL =
    'https://imagedelivery.net/PLjImLTp3_--j_ey0SPDBA/clients/915b3510-c0a1-7075-ba32-d63633b69867/app-media/20251227-174758-06ec1ee1.jpg/public';

interface IntroProps {
    introText: string;
    onComplete: () => void;
    unlockAudio: () => Promise<void> | Promise<boolean>;
}

export default function Intro({ introText, onComplete, unlockAudio }: IntroProps) {
    const [displayedText, setDisplayedText] = useState('');
    const [isTyping, setIsTyping] = useState(true);
    const scrollRef = useRef<HTMLDivElement>(null);
    const introContainerRef = useRef<HTMLDivElement>(null);

    // --- TYPEWRITER ---
    useEffect(() => {
        if (!isTyping || !introText) return;
        let index = 0;
        const interval = setInterval(() => {
            setDisplayedText(introText.slice(0, index));
            index++;
            if (index > introText.length) {
                clearInterval(interval);
                setIsTyping(false);
            }
        }, 30);
        return () => clearInterval(interval);
    }, [isTyping, introText]);

    useEffect(() => {
        // Only auto-scroll if user is near the bottom (or if content fits)
        if (scrollRef.current && introContainerRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = introContainerRef.current;
            const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
            // Threshold can be adjusted. 100px allows for some leeway.
            if (distanceFromBottom < 150) {
                scrollRef.current.scrollIntoView({ behavior: 'smooth' });
            }
        } else if (scrollRef.current) {
            // Fallback
            scrollRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [displayedText]);

    return (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black animate-fade-in">
            <img
                src={INTRO_BACKGROUND_IMAGE_URL}
                alt=""
                className="border-none w-full h-full object-cover"
            />
            <div ref={introContainerRef} className="absolute inset-0 flex flex-col items-center overflow-y-auto">
                <div className="w-1/2 my-auto py-24 space-y-8 font-mono leading-relaxed text-lg md:text-xl text-white">
                    {displayedText.split('\n').map((line, i) => (
                        <p key={i} className="min-h-[1em] drop-shadow-md">{line}</p>
                    ))}
                    <div ref={scrollRef} />
                    {!isTyping && (
                        <div className="pt-8 flex justify-center animate-fade-in">
                            <button
                                onClick={() => {
                                    unlockAudio().catch(() => { });
                                    onComplete();
                                }}
                                className="rounded-full bg-white text-black px-8 py-3 font-bold hover:bg-gray-200 transition-colors"
                            >
                                Accetta di aprire il portale temporale
                            </button>
                        </div>
                    )}
                </div>
            </div>
            {isTyping && (
                <button onClick={() => {
                    unlockAudio().catch(() => { });
                    setIsTyping(false);
                    setDisplayedText(introText);
                }} className="absolute bottom-8 right-8 z-[70] text-gray-500 hover:text-white text-sm bg-black/50 px-3 py-1 rounded">Skip Animation</button>
            )}
        </div>
    );
}
