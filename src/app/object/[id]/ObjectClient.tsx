'use client';

import { useQuest } from '@/context/QuestContext';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useState, useEffect } from 'react';
import { PulsatingEffect } from '@/types/quest';

interface ObjectClientProps {
    objectId: string;
}

export default function ObjectClient({ objectId }: ObjectClientProps) {
    const { data } = useQuest();
    const router = useRouter();
    const [saving, setSaving] = useState(false);
    const [showEffectsPanel, setShowEffectsPanel] = useState(false);

    const object = data?.objects.find(o => o.id === objectId);

    // Initialize effect configuration with defaults
    const [effectConfig, setEffectConfig] = useState<PulsatingEffect>({
        enabled: false,
        effectType: 'pulsating_circles',
        color: '#ff0000',
        effectRadius: 50,
        startEffectDistance: 100,
        speed: 100,
    });

    // Sync state with object data when available
    useEffect(() => {
        if (object?.pulsating_effect) {
            setEffectConfig({
                enabled: object.pulsating_effect.enabled || false,
                effectType: object.pulsating_effect.effectType || 'pulsating_circles',
                color: object.pulsating_effect.color || '#ff0000',
                effectRadius: object.pulsating_effect.effectRadius || 50,
                startEffectDistance: object.pulsating_effect.startEffectDistance || 100,
                speed: object.pulsating_effect.speed || 100,
            });
        }
    }, [object]);

    if (!data) return null;

    const handleSaveEffect = async () => {
        setSaving(true);
        try {
            // Get API URL and userId from environment or localStorage
            const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
            const userId = localStorage.getItem('userId') || 'default-user';

            const response = await fetch(`${API_URL}/api/v1/objects/${objectId}?client_id=${userId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    ...object,
                    pulsating_effect: effectConfig,
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to save effect configuration');
            }

            alert('Map effect saved successfully! Refresh the page to see changes.');
        } catch (err: any) {
            console.error('Error saving effect:', err);
            alert(err.message || 'Failed to save effect');
        } finally {
            setSaving(false);
        }
    };

    if (!object) {
        return (
            <div className="h-screen w-full flex flex-col items-center justify-center bg-white dark:bg-black text-black dark:text-white">
                <h1 className="text-2xl mb-4">Object Not Found</h1>
                <button
                    onClick={() => router.push('/')}
                    className="px-4 py-2 bg-blue-600 rounded text-white hover:bg-blue-500"
                >
                    Back to Map
                </button>
            </div>
        );
    }

    const objectImages = (object.images || [])
        .map((img: any) => {
            if (typeof img === 'string') return img;
            return img?.url || img?.imageUrl || img?.image_url || img?.src || null;
        })
        .filter((url: any): url is string => typeof url === 'string' && url.length > 0);

    return (
        <div className="min-h-screen bg-white dark:bg-black text-black dark:text-white p-4">
            <div className="max-w-2xl mx-auto">
                <button
                    onClick={() => router.push('/')}
                    className="mb-4 text-blue-500 hover:underline"
                >
                    &larr; Back to Map
                </button>

                <h1 className="text-3xl font-bold mb-2">{object.name}</h1>
                <p className="text-gray-600 dark:text-gray-400 mb-6">{object.description}</p>

                {objectImages.length > 0 && (
                    <div className="grid grid-cols-1 gap-4 mb-6">
                        {objectImages.map((img, idx) => (
                            <div key={idx} className="relative w-full h-64 md:h-96 rounded-lg overflow-hidden">
                                <Image
                                    src={img}
                                    alt={`${object.name} ${idx + 1}`}
                                    fill
                                    className="object-cover"
                                />
                            </div>
                        ))}
                    </div>
                )}

                {/* Audio Effects Section */}
                <div className="mt-8 p-6 bg-gray-100 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
                    <h3 className="text-xl font-bold mb-4">Audio Effects</h3>
                    {object?.audio_effect?.enabled ? (
                        <div className="space-y-3">
                            <div>
                                <p className="text-sm text-gray-600 dark:text-gray-400">Effect Name</p>
                                <p className="font-medium">{object.audio_effect.name}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-600 dark:text-gray-400">Trigger Radius</p>
                                <p className="font-medium">{object.audio_effect.triggerRadius || 20}m</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-600 dark:text-gray-400">Audio File</p>
                                {object.audio_effect.media_url ? (
                                    <div className="flex items-center gap-3 mt-2">
                                        <audio
                                            controls
                                            preload="metadata"
                                            className="w-full max-w-md"
                                        >
                                            <source src={object.audio_effect.media_url} />
                                            Your browser does not support the audio element.
                                        </audio>
                                        <a
                                            href={object.audio_effect.media_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 transition whitespace-nowrap"
                                        >
                                            Open Link
                                        </a>
                                    </div>
                                ) : (
                                    <p className="text-gray-500 italic">No audio file attached</p>
                                )}
                            </div>
                            {object.audio_effect.loop !== undefined && (
                                <div>
                                    <p className="text-sm text-gray-600 dark:text-gray-400">Loop</p>
                                    <p className="font-medium">{object.audio_effect.loop ? 'Yes' : 'No'}</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className="text-gray-500 dark:text-gray-400">No audio effects configured for this object.</p>
                    )}
                </div>

                {/* Map Effects Configuration Panel */}
                <div className="mt-8 p-6 bg-gray-100 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-bold">Map Effects</h3>
                        <button
                            onClick={() => setShowEffectsPanel(!showEffectsPanel)}
                            className="px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition text-sm"
                        >
                            {showEffectsPanel ? 'Hide' : 'Show'}
                        </button>
                    </div>

                    {showEffectsPanel && (
                        <div className="space-y-4">
                            {/* Enable/Disable Toggle */}
                            <div className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    id="effectEnabled"
                                    checked={effectConfig.enabled}
                                    onChange={(e) => setEffectConfig({ ...effectConfig, enabled: e.target.checked })}
                                    className="w-5 h-5"
                                />
                                <label htmlFor="effectEnabled" className="font-medium">
                                    Enable Map Effect
                                </label>
                            </div>

                            {/* Effect Type Dropdown */}
                            <div>
                                <label className="block text-sm font-medium mb-2">Effect Type</label>
                                <select
                                    value={effectConfig.effectType}
                                    onChange={(e) => setEffectConfig({ ...effectConfig, effectType: e.target.value })}
                                    className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg"
                                    disabled={!effectConfig.enabled}
                                >
                                    <option value="pulsating_circles">Pulsating Circles</option>
                                </select>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    Select the type of visual effect to display on the map
                                </p>
                            </div>

                            {/* Color Picker */}
                            <div>
                                <label className="block text-sm font-medium mb-2">Effect Color</label>
                                <input
                                    type="color"
                                    value={effectConfig.color}
                                    onChange={(e) => setEffectConfig({ ...effectConfig, color: e.target.value })}
                                    className="w-full h-10 rounded-lg cursor-pointer"
                                    disabled={!effectConfig.enabled}
                                />
                            </div>

                            {/* Effect Radius */}
                            <div>
                                <label className="block text-sm font-medium mb-2">
                                    Effect Radius: {effectConfig.effectRadius}m
                                </label>
                                <input
                                    type="range"
                                    min="10"
                                    max="200"
                                    step="5"
                                    value={effectConfig.effectRadius}
                                    onChange={(e) => setEffectConfig({ ...effectConfig, effectRadius: Number(e.target.value) })}
                                    className="w-full"
                                    disabled={!effectConfig.enabled}
                                />
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    The radius of the pulsating effect circle
                                </p>
                            </div>

                            {/* Start Effect Distance */}
                            <div>
                                <label className="block text-sm font-medium mb-2">
                                    Start Effect Distance: {effectConfig.startEffectDistance}m
                                </label>
                                <input
                                    type="range"
                                    min="50"
                                    max="500"
                                    step="10"
                                    value={effectConfig.startEffectDistance}
                                    onChange={(e) => setEffectConfig({ ...effectConfig, startEffectDistance: Number(e.target.value) })}
                                    className="w-full"
                                    disabled={!effectConfig.enabled}
                                />
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    Distance from object center where the effect starts
                                </p>
                            </div>

                            {/* Animation Speed */}
                            <div>
                                <label className="block text-sm font-medium mb-2">
                                    Animation Speed: {effectConfig.speed}ms
                                </label>
                                <input
                                    type="range"
                                    min="50"
                                    max="500"
                                    step="10"
                                    value={effectConfig.speed}
                                    onChange={(e) => setEffectConfig({ ...effectConfig, speed: Number(e.target.value) })}
                                    className="w-full"
                                    disabled={!effectConfig.enabled}
                                />
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    Speed of the pulsating animation (lower = faster)
                                </p>
                            </div>

                            {/* Save Button */}
                            <button
                                onClick={handleSaveEffect}
                                disabled={saving}
                                className="w-full py-3 bg-green-600 text-white font-bold rounded-lg hover:bg-green-500 transition disabled:bg-gray-400 disabled:cursor-not-allowed"
                            >
                                {saving ? 'Saving...' : 'Save Effect Configuration'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
