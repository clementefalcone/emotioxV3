import { useQuery } from '@tanstack/react-query';
import * as trackingService from '../../../services/tracking.service';
import { AOIRow } from '../eye-tracking/shared';

const pagePath = (pageUrl: string): string => {
    try {
        return new URL(pageUrl).pathname;
    } catch {
        return pageUrl;
    }
};

export const TrackingZonesPanel = ({ researchId }: { researchId: string }) => {
    const { data: zones, isLoading } = useQuery({
        queryKey: ['tracking', researchId, 'zones'],
        queryFn: () => trackingService.getTrackingZones(researchId),
    });

    if (isLoading) return <div className="bg-white rounded-xl border border-gray-200 p-4 h-24 animate-pulse" />;
    if (!zones || zones.length === 0) return null;

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Zones</h3>
            <p className="text-[10px] text-gray-300 mb-3">Same metrics as Eye Tracking AOIs. Each visit to the zone's page counts as one viewer.</p>
            <div className="flex flex-col gap-2">
                {zones.map((zone, index) => (
                    <AOIRow key={zone.id} aoi={zone} index={index} subtitle={`${pagePath(zone.pageUrl)} · ${zone.visits} visits`} />
                ))}
            </div>
        </div>
    );
};
