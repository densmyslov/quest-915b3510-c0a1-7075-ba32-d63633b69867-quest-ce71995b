import { useEffect, useRef } from 'react';
import { Map as LeafletMap, Marker } from 'leaflet';
import { COLORS, createVintageIcon } from '@/components/map/MapStyles';

type UserLocationLayerProps = {
    map: LeafletMap | null;
    userLocation: [number, number] | null;
};

export function UserLocationLayer({ map, userLocation }: UserLocationLayerProps) {
    const userMarkerRef = useRef<Marker | null>(null);

    useEffect(() => {
        if (!map || !userLocation) return;

        const [lat, lng] = userLocation;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return;
        }

        try {
            if (!userMarkerRef.current) {
                userMarkerRef.current = new Marker([lat, lng], {
                    icon: createVintageIcon('player')
                }).addTo(map).bindPopup(`
	                    <div style="font-family:'Cinzel',serif;color:${COLORS.sepia};text-align:center;padding:4px;">
	                        <strong>Tu sei qui</strong><br/>
	                        <span style="font-family:'Crimson Text',serif;font-style:italic;font-size:12px;">Viaggiatore nel tempo</span>
	                    </div>
	                `);
            } else {
                userMarkerRef.current.setLatLng([lat, lng]);
                // Ensure it's on the map
                if (!map.hasLayer(userMarkerRef.current)) {
                    userMarkerRef.current.addTo(map);
                }
            }
        } catch {
            // ignore
        }

        return () => {
            // We can choose to remove it or keep it.
            // Usually keeping it is fine unless map changes.
            // If map changes, the parent effect will unmount this component, so this cleanup runs.
            if (userMarkerRef.current) {
                userMarkerRef.current.remove();
                userMarkerRef.current = null;
            }
        };
    }, [map, userLocation]);

    return null;
}
