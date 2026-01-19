import { useEffect, useState } from 'react';
import { TimelineDocumentOverlayState } from './types';


type TimelineDocumentOverlayProps = {
    overlay: TimelineDocumentOverlayState;
    onClose: () => void;
    palette: any;
};

export default function TimelineDocumentOverlay({
    overlay,
    onClose,
    palette,
}: TimelineDocumentOverlayProps) {
    const [isClosing, setIsClosing] = useState(false);

    // Debug: Log when document overlay mounts
    useEffect(() => {
        console.log('[TimelineDocumentOverlay] Mounted with overlay:', {
            title: overlay.title,
            media_url: overlay.media_url,
            text: overlay.text?.substring(0, 50),
            zIndex: 5300
        });
        return () => {
            console.log('[TimelineDocumentOverlay] Unmounting');
        };
    }, [overlay]);

    // We'll use a fixed position target for the folder animation.
    // In the real app, this might need to match the actual folder icon position.
    // For now, we animate towards the bottom right where the folder usually is.

    const handleClose = () => {
        setIsClosing(true);
        // Wait for animation to finish before calling onClose
        setTimeout(() => {
            onClose();
        }, 600); // 600ms matches the animation duration
    };

    return (
        <div className="fixed inset-0 z-[5300] flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div
                className={`relative max-w-lg w-full bg-white rounded-lg shadow-2xl overflow-hidden transition-all duration-500 ease-in-out ${isClosing ? 'scale-0 translate-y-[40vh] translate-x-[40vw] opacity-0 rotate-12' : 'scale-100 opacity-100'
                    }`}
                style={{
                    backgroundColor: palette?.parchment ?? '#f5f5dc',
                    color: '#333'
                }}
            >
                <div className="flex justify-between items-center p-4 border-b border-gray-200" style={{ borderColor: palette?.gold ?? '#daa520' }}>
                    <h3 className="text-lg font-bold font-serif">{overlay.title || 'Document'}</h3>
                    <button
                        onClick={handleClose}
                        className="p-1 rounded-full hover:bg-black/10 transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                            <path fillRule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>

                <div className="p-6 flex flex-col items-center">
                    {overlay.media_url && (
                        <div className="mb-6 w-full relative aspect-[3/4] shadow-md rotate-1 bg-white p-2">
                            <img
                                src={overlay.media_url}
                                alt="Document"
                                className="w-full h-full object-cover"
                            />
                        </div>
                    )}

                    {overlay.text && (
                        <div className="text-center font-serif text-lg leading-relaxed max-h-40 overflow-y-auto w-full">
                            {overlay.text}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-gray-200 flex justify-center" style={{ borderColor: palette?.gold ?? '#daa520' }}>
                    <button
                        onClick={handleClose}
                        className="px-6 py-2 rounded-full font-bold text-white shadow-lg transform transition hover:scale-105 active:scale-95"
                        style={{
                            backgroundColor: palette?.gold ?? '#daa520',
                            color: '#fff'
                        }}
                    >
                        Close & Collect
                    </button>
                </div>
            </div>

            <style jsx>{`
        @keyframes flyToFolder {
            0% {
                transform: scale(1) translate(0, 0) rotate(0deg);
                opacity: 1;
            }
            100% {
                transform: scale(0.1) translate(40vw, 40vh) rotate(45deg);
                opacity: 0;
            }
        }
      `}</style>
        </div>
    );
}
