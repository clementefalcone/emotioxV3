import { useState, useMemo, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MousePointerClick, Trash2, Plus } from 'lucide-react';
import * as trackingService from '../../services/tracking.service';
import type { TrackingZone } from '../../services/tracking.service';
import { CustomSelect } from '../ui/CustomSelect';
import { sanitizeSnapshot } from '../../utils/snapshotHtml';
import { buildZoneSelector } from '../../utils/zoneSelector';

const PICKER_STYLE = `<style>
    .__ecx-zone-hover { outline: 2px dashed #006AFF !important; outline-offset: 2px !important; cursor: crosshair !important; }
    .__ecx-zone-picked { outline: 3px solid #16a34a !important; outline-offset: 2px !important; }
</style>`;

const pagePath = (pageUrl: string): string => {
    try {
        return new URL(pageUrl).pathname;
    } catch {
        return pageUrl;
    }
};

interface TrackingZonesEditorProps {
    researchId: string;
    zones: TrackingZone[];
    onChange: (zones: TrackingZone[]) => void;
}

export const TrackingZonesEditor = ({ researchId, zones, onChange }: TrackingZonesEditorProps) => {
    const [pickingPageUrl, setPickingPageUrl] = useState<string | null>(null);
    const { data: pages = [] } = useQuery({
        queryKey: ['tracking', researchId, 'pages'],
        queryFn: () => trackingService.getTrackedPages(researchId),
    });
    const pagesWithSnapshot = pages.filter((page) => page.hasSnapshot);

    const handleAdd = useCallback((zone: TrackingZone) => {
        onChange([...zones, zone]);
        setPickingPageUrl(null);
    }, [zones, onChange]);

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-3 mb-2">
                <div>
                    <h3 className="text-xs font-semibold text-slate-900">Zones</h3>
                    <p className="text-[10px] text-gray-400">Mark page elements (a button, a banner) to measure attention and emotion on them, like Eye Tracking AOIs.</p>
                </div>
                {pickingPageUrl === null && (
                    <div className="w-64">
                        <CustomSelect
                            placeholder={pagesWithSnapshot.length ? 'Add zone on page…' : 'No captured pages yet'}
                            disabled={pagesWithSnapshot.length === 0}
                            options={pagesWithSnapshot.map((page) => ({ value: page.pageUrl, label: page.pageTitle || pagePath(page.pageUrl) }))}
                            onChange={setPickingPageUrl}
                        />
                    </div>
                )}
            </div>

            {zones.length > 0 && (
                <div className="flex flex-col gap-1 mb-2">
                    {zones.map((zone) => (
                        <ZoneRow key={zone.id} zone={zone} onRemove={() => onChange(zones.filter((z) => z.id !== zone.id))} />
                    ))}
                </div>
            )}

            {pickingPageUrl !== null && (
                <ZonePicker
                    researchId={researchId}
                    pageUrl={pickingPageUrl}
                    onPick={handleAdd}
                    onCancel={() => setPickingPageUrl(null)}
                />
            )}
        </div>
    );
};

const ZoneRow = ({ zone, onRemove }: { zone: TrackingZone; onRemove: () => void }) => (
    <div className="flex items-center gap-3 px-2 py-1.5 rounded-lg bg-gray-50 text-xs">
        <MousePointerClick className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
        <span className="font-medium text-slate-800">{zone.label}</span>
        <span className="text-gray-400">{pagePath(zone.pageUrl)}</span>
        <span className="text-gray-300 font-mono truncate flex-1" title={zone.selector}>{zone.selector}</span>
        <button onClick={onRemove} aria-label={`Remove zone ${zone.label}`} className="text-gray-400 hover:text-red-500">
            <Trash2 className="h-3.5 w-3.5" />
        </button>
    </div>
);

interface ZonePickerProps {
    researchId: string;
    pageUrl: string;
    onPick: (zone: TrackingZone) => void;
    onCancel: () => void;
}

const ZonePicker = ({ researchId, pageUrl, onPick, onCancel }: ZonePickerProps) => {
    const [selector, setSelector] = useState<string | null>(null);
    const [label, setLabel] = useState('');
    const pickedRef = useRef<Element | null>(null);
    const { data: snapshotHtml, isLoading } = useQuery({
        queryKey: ['tracking', researchId, 'snapshot', pageUrl],
        queryFn: () => trackingService.getPageSnapshot(researchId, pageUrl),
    });
    const srcDoc = useMemo(
        () => (snapshotHtml ? sanitizeSnapshot(snapshotHtml).replace('</head>', `${PICKER_STYLE}</head>`) : ''),
        [snapshotHtml],
    );

    const handleLoad = useCallback((event: React.SyntheticEvent<HTMLIFrameElement>) => {
        const doc = event.currentTarget.contentDocument;
        if (!doc) return;
        doc.addEventListener('mouseover', (e) => (e.target as Element).classList?.add('__ecx-zone-hover'));
        doc.addEventListener('mouseout', (e) => (e.target as Element).classList?.remove('__ecx-zone-hover'));
        doc.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const target = e.target as Element;
            pickedRef.current?.classList.remove('__ecx-zone-picked');
            target.classList.add('__ecx-zone-picked');
            pickedRef.current = target;
            setSelector(buildZoneSelector(target));
        }, true);
    }, []);

    const handleSave = () => {
        if (!selector || !label.trim()) return;
        onPick({ id: crypto.randomUUID(), label: label.trim(), pageUrl, selector });
    };

    if (isLoading) return <div className="h-96 rounded-lg bg-gray-100 animate-pulse" />;

    if (!srcDoc) {
        return (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                <span>This page has no captured snapshot yet. Open it once with the snippet installed, then try again.</span>
                <button onClick={onCancel} className="text-amber-900 underline">Close</button>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            <p className="text-[11px] text-gray-500">Click the element you want to measure in <span className="font-medium">{pagePath(pageUrl)}</span>.</p>
            <iframe
                title="Page snapshot"
                srcDoc={srcDoc}
                sandbox="allow-same-origin"
                onLoad={handleLoad}
                className="w-full h-96 rounded-lg border border-gray-200 bg-white"
            />
            <div className="flex items-center gap-2">
                <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder={selector ? 'Zone name, e.g. Buy button' : 'Click an element first'}
                    disabled={!selector}
                    className="flex-1 px-2 py-1 text-[11px] border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 outline-none disabled:bg-gray-50"
                />
                <button
                    onClick={handleSave}
                    disabled={!selector || !label.trim()}
                    className="flex items-center gap-1 px-3 py-1 text-[11px] font-medium rounded-md bg-blue-600 text-white disabled:opacity-40"
                >
                    <Plus className="h-3 w-3" /> Add zone
                </button>
                <button onClick={onCancel} className="px-3 py-1 text-[11px] rounded-md bg-gray-100 text-gray-600">Cancel</button>
            </div>
            {selector && <p className="text-[10px] font-mono text-gray-400 truncate" title={selector}>{selector}</p>}
        </div>
    );
};
