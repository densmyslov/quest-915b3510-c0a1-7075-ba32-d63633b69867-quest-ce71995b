'use client';

import { useQuest } from '@/context/QuestContext';
import { useEffect, useState } from 'react';

export function GeolocationTracker() {
    const { data, unlockPiece, progress } = useQuest();

    // Haversine formula
    const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
        const R = 6371e3;
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    };

    useEffect(() => {
        if (!navigator.geolocation || !data) return;

        // Aggregate all triggers
        const allTriggers = data.puzzles.flatMap(puzzle =>
            puzzle.locationTriggers?.map(trigger => ({
                ...trigger,
                puzzleId: puzzle.id,
                linkedObjects: puzzle.linked_objects // Pass linked objects down
            })) || []
        );

        if (allTriggers.length === 0) return;

        const id = navigator.geolocation.watchPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;

                // Check triggers
                allTriggers.forEach(trigger => {
                    // Skip if already collected
                    if (progress.collectedPieces.includes(trigger.pieceId)) return;

                    const distance = calculateDistance(lat, lng, trigger.lat, trigger.lng);

                    // Determine radius: Try to find a linked object with custom radius
                    let radius = 20; // Default

                    // Helper to get linked IDs from DynamoDB format or plain array
                    const getIds = (lo: any) => {
                        if (!lo) return [];
                        if (Array.isArray(lo)) return lo.map((x: any) => x.S || x);
                        if (lo.L) return lo.L.map((x: any) => x.S || x);
                        return [];
                    };

                    const linkedIds = getIds(trigger.linkedObjects);
                    const linkedObj = data.objects.find(o => linkedIds.includes(o.id));

                    if (linkedObj && linkedObj.triggerRadius) {
                        radius = linkedObj.triggerRadius;
                    }

                    if (distance < radius) {
                        console.log('Unlocking piece:', trigger.pieceId, 'Distance:', distance, 'Radius:', radius);
                        unlockPiece(trigger.pieceId);
                        alert(trigger.unlockMessage || "You found a puzzle piece!");
                    }
                });
            },
            (error) => {
                console.error('Geolocation error:', error);
            },
            {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 0
            }
        );

        return () => {
            navigator.geolocation.clearWatch(id);
        };
    }, [data, unlockPiece, progress.collectedPieces]);

    return null; // Component is logic-only
}
