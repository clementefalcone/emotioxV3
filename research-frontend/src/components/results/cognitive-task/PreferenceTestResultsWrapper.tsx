import { useState, useEffect, useMemo } from 'react';
import { usePreferenceTestResults } from '../../../hooks/usePreferenceTestResults';
import { PreferenceTestCard } from './components/PreferenceTestCard';
import { useResearch } from '../../../hooks/useResearchQuery';
import type { Module } from '../../../services/research.service';
import { mediaService } from '../../../services/media.service';

interface PreferenceTestResultsWrapperProps {
    researchId: string;
    moduleId: string;
    moduleName: string;
    questionNumber: string;
    filteredParticipantIds?: Set<string> | null;
}

interface ModuleComponent {
    type: string;
    value?: string;
    [key: string]: unknown;
}

interface ModuleConfigStructure {
    structure?: {
        components?: ModuleComponent[];
    };
}

interface UploadedFileData {
    id?: string;
    url?: string;
    s3Key?: string;
    name?: string;
}

interface ImageData {
    id: string;
    url: string;
    s3Key?: string;
    name?: string;
}

export const PreferenceTestResultsWrapper = ({
    researchId,
    moduleId,
    moduleName,
    questionNumber,
    filteredParticipantIds
}: PreferenceTestResultsWrapperProps) => {
    const { data: rawData, isLoading: isResultsLoading } = usePreferenceTestResults(researchId, moduleId);

    // Apply participant filter
    const data = rawData && filteredParticipantIds
        ? (() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const filtered = rawData.responses.filter((r: any) => filteredParticipantIds.has(r.participantId));
            const counts: Record<string, number> = {};
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            filtered.forEach((r: any) => { const img = r.selectedImageId || r.selectedImage; if (img) counts[img] = (counts[img] || 0) + 1; });
            return {
                ...rawData,
                responses: filtered,
                selections: rawData.selections.map(s => {
                    const count = counts[String(s.imageId)] || 0;
                    return { ...s, count, percentage: filtered.length > 0 ? (count / filtered.length) * 100 : 0 };
                }),
            };
        })()
        : rawData;

    // Use React Query cached research (shared across all result wrappers — single request)
    const { data: research, isLoading: isResearchLoading } = useResearch(researchId);

    // Find module within the cached research
    const foundModule: Module | null = useMemo(() => {
        if (!research?.stages) return null;
        for (const stage of research.stages) {
            const found = stage.modules.find((m: Module) => m.id === moduleId);
            if (found) return found;
        }
        return null;
    }, [research, moduleId]);

    const [images, setImages] = useState<ImageData[]>([]);
    const [urlsResolved, setUrlsResolved] = useState(false);

    useEffect(() => {
        if (!foundModule) { setUrlsResolved(false); return; }

        let cancelled = false;
        const resolveUrls = async () => {
            const config = foundModule.config as ModuleConfigStructure | undefined;
            const components = config?.structure?.components || [];
            const fu = components.find((c: ModuleComponent) => c.type === 'file-upload');
            if (!fu?.value) { if (!cancelled) setUrlsResolved(true); return; }

            try {
                const files = JSON.parse(fu.value);
                if (Array.isArray(files) && files.length > 0) {
                    const resolvedImages = await Promise.all(
                        files.map(async (file: UploadedFileData, index: number) => {
                            let url = file.url;
                            if (file.s3Key) {
                                try {
                                    const mediaResponse = await mediaService.getMediaUrlByS3Key(file.s3Key);
                                    url = mediaResponse.url;
                                } catch (err) {
                                    console.warn('Failed to resolve media URL for image', file.s3Key, err);
                                }
                            }
                            return {
                                id: file.id || String(index + 1),
                                url: url || '',
                                s3Key: file.s3Key,
                                name: file.name || `Image ${index + 1}`
                            };
                        })
                    );
                    if (!cancelled) setImages(resolvedImages.filter(img => img.url));
                }
            } catch (e) {
                console.error('Failed to parse preference test images:', e);
            }
            if (!cancelled) setUrlsResolved(true);
        };

        resolveUrls();
        return () => { cancelled = true; };
    }, [foundModule]);

    const isLoading = isResultsLoading || isResearchLoading || (!urlsResolved && !!foundModule);

    if (isLoading || !data) {
        return (
            <div className="p-6 border rounded-lg bg-gray-50 animate-pulse">
                <div className="h-6 bg-gray-200 rounded w-1/3 mb-4" />
                <div className="h-32 bg-gray-200 rounded" />
            </div>
        );
    }

    // Compute intensity breakdown per image
    const intensityByImage: Record<number, { slight: number; strong: number }> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data.responses.forEach((r: any) => {
        const imgId = r.selectedImageId;
        if (!imgId) return;
        if (!intensityByImage[imgId]) intensityByImage[imgId] = { slight: 0, strong: 0 };
        const intensity = r.preferenceIntensity === 'slight' ? 'slight' : 'strong';
        intensityByImage[imgId][intensity]++;
    });

    // Map selections to steps with images
    const steps = data.selections.map((selection) => {
        const imageData = images.find(img => img.id === String(selection.imageId)) || images[selection.imageId - 1];
        const intensity = intensityByImage[selection.imageId] || { slight: 0, strong: 0 };

        return {
            stepNumber: selection.imageId,
            title: imageData?.name || `Image ${selection.imageId}`,
            duration: `${Math.round(data.averageViewTime / 1000)}s`,
            completionRate: Math.round(selection.percentage),
            participantCount: data.totalResponses,
            selectionCount: selection.count,
            progressColor: selection.percentage > 50 ? '#9333EA' : '#6366F1',
            imageUrl: imageData?.url,
            intensitySlight: intensity.slight,
            intensityStrong: intensity.strong,
        };
    });

    return (
        <PreferenceTestCard
            questionNumber={questionNumber}
            questionText={moduleName}
            questionType="Preference Test"
            conditionalityDisabled={true}
            required={false}
            steps={steps}
        />
    );
};
