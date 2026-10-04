import { type FormEvent, useState, useEffect, useCallback } from 'react';
import { analyzeSentimentLocal } from '../../utils/sentimentLocal';
import { parseDocument, detectCsvColumns, type CsvColumnInfo } from '../../utils/documentParser';
import { CsvColumnSelector } from './CsvColumnSelector';
import { useNavigate } from 'react-router-dom';
import { Stepper } from '../ui/Stepper';
import { Button } from '../ui/Button';
import { ResearchFormStep1 } from './ResearchFormStep1';
import { ResearchFormStep2 } from './ResearchFormStep2';
import { useResearchForm } from '../../hooks/useResearchForm';
import { useAuthStore } from '../../stores/auth.store';
import { useEnterprise } from '../../hooks/useEnterprise';
import { type AutocompleteOption } from '../ui/Autocomplete';
import { Drawer } from '../ui/Drawer';
import { FileUpload } from '../ui/FileUpload';
import { Trash2, Search, Eye, Loader2 } from 'lucide-react';
import { mediaService } from '../../services/media.service';
import { researchService, type Research } from '../../services/research.service';

interface BenchmarkResearchOption {
    id: string;
    name: string;
    status: string;
    created_at: string;
    etModuleCount: number;
}

interface CreateResearchFormProps {
    onSuccess?: (researchId: string) => void;
}

export const CreateResearchForm = ({ onSuccess }: CreateResearchFormProps = {}) => {
    const navigate = useNavigate();
    const [isStimulusDrawerOpen, setIsStimulusDrawerOpen] = useState(false);
    const [uploadStatus, setUploadStatus] = useState<string | null>(null);
    const {
        formData,
        currentStep,
        researchTypes,
        loadingResearchTypes,
        availableTechniques,
        loadingTechniquesForType,
        formErrors,
        isCreating,
        submitError,
        submitSuccess,
        setFormData,
        setCurrentStep,
        handleFieldChange,
        handleNextStep,
        handlePreviousStep,
        handleSubmit,
        resetForm,
        loadTechniquesForType,
    } = useResearchForm();

    const selectedType = researchTypes.find((rt) => rt.id === formData.researchTypeId);
    const isAttentionPrediction = selectedType?.name === 'Attention Prediction' ||
                                selectedType?.name === "Attention's Prediction";
    const isInsightsFinding = selectedType?.name === 'Insights Finding';
    const isClientsBenchmark = selectedType?.name === "Client's Benchmark";
    const isWebsiteTracking = selectedType?.name === 'Website Tracking';
    // These types share: no stages, file upload drawer, sidebar shows files
    const isFileBasedResearch = isAttentionPrediction || isInsightsFinding || isClientsBenchmark || isWebsiteTracking;

    // CSV column selection: when a CSV has multiple columns, user picks which one
    const [csvColumnSelections, setCsvColumnSelections] = useState<Record<string, number[]>>({});
    const [csvColumnHeaders, setCsvColumnHeaders] = useState<Record<string, string[]>>({});
    const [pendingCsvFile, setPendingCsvFile] = useState<{ file: File; columnInfo: CsvColumnInfo } | null>(null);

    // Client's Benchmark: state for research selection
    const [benchmarkResearches, setBenchmarkResearches] = useState<BenchmarkResearchOption[]>([]);
    const [selectedBenchmarkIds, setSelectedBenchmarkIds] = useState<Set<string>>(new Set());
    const [loadingBenchmarkResearches, setLoadingBenchmarkResearches] = useState(false);
    const [benchmarkSearchTerm, setBenchmarkSearchTerm] = useState('');

    const loadBenchmarkResearches = useCallback(async () => {
        setLoadingBenchmarkResearches(true);
        try {
            const response = await researchService.list();
            const researches = response.researches || [];
            // Filter: researches that have Eye Tracking stages
            const withEyeTracking: BenchmarkResearchOption[] = researches
                .filter((r: Research) => {
                    if (!r.stages) return false;
                    return r.stages.some(s =>
                        s.name.toLowerCase() === 'eye tracking' &&
                        (s.modules?.length ?? 0) > 0
                    );
                })
                .map((r: Research) => {
                    const etModuleCount = (r.stages || [])
                        .filter(s => s.name.toLowerCase() === 'eye tracking')
                        .flatMap(s => s.modules || []).length;
                    return {
                        id: r.id,
                        name: r.name,
                        status: r.status,
                        created_at: r.created_at,
                        etModuleCount,
                    };
                });
            setBenchmarkResearches(withEyeTracking);
        } catch (error) {
            console.error('[CreateResearchForm] Failed to load benchmark researches:', error);
        } finally {
            setLoadingBenchmarkResearches(false);
        }
    }, []);

    const toggleBenchmarkResearch = useCallback((researchId: string) => {
        setSelectedBenchmarkIds(prev => {
            const next = new Set(prev);
            if (next.has(researchId)) {
                next.delete(researchId);
            } else {
                next.add(researchId);
            }
            return next;
        });
    }, []);

    // Open drawer when file-based research is selected and no file is present
    // For Client's Benchmark, open drawer when no researches are selected
    useEffect(() => {
        if (isClientsBenchmark && selectedBenchmarkIds.size === 0 && !isStimulusDrawerOpen) {
            setIsStimulusDrawerOpen(true);
            void loadBenchmarkResearches();
        } else if (!isClientsBenchmark && !isWebsiteTracking && isFileBasedResearch && (formData.stimulusFiles || []).length === 0 && !isStimulusDrawerOpen) {
            setIsStimulusDrawerOpen(true);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drawer opens on type change; deps intentionally limited to avoid re-open loops
    }, [formData.researchTypeId, isFileBasedResearch, isClientsBenchmark]);

    // Disable default modules for file-based research (no stages needed)
    useEffect(() => {
        if (isFileBasedResearch && formData.useDefaultModules) {
            handleFieldChange('useDefaultModules', false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleFieldChange is stable; only re-run when these values change
    }, [isFileBasedResearch, formData.useDefaultModules]);

    const { enterprises, loadingEnterprises, createEnterprise } = useEnterprise();
    const isAdmin = useAuthStore((state) => state.user?.role === 'admin');

    const handleEnterpriseSelect = (option: AutocompleteOption): void => {
        setFormData((prev) => ({
            ...prev,
            enterpriseId: option.value,
            enterpriseName: option.label,
        }));
    };

    const handleCreateEnterpriseFromAutocomplete = async (enterpriseName: string): Promise<void> => {
        try {
            const enterpriseId = await createEnterprise(enterpriseName);
            if (enterpriseId) {
                setFormData((prev) => ({
                    ...prev,
                    enterpriseId,
                    enterpriseName,
                }));
            }
        } catch (error: unknown) {
            console.error('Failed to create enterprise:', error);
        }
    };

    const handleFormSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
        e.preventDefault();

        console.log('[CreateResearchForm] Form submitted', {
            currentStep,
            formData,
            formErrors,
        });

        if (currentStep === 0) {
            console.log('[CreateResearchForm] Step 0: Validating and moving to next step');
            handleNextStep();
            return;
        }

        console.log('[CreateResearchForm] Step 1: Processing submission');

        // If enterprise doesn't exist, try to find it by name or create it
        let enterpriseId = formData.enterpriseId;
        if (!enterpriseId && formData.enterpriseName.trim()) {
            try {
                console.log('[CreateResearchForm] Enterprise ID not found, checking existing enterprises or creating new one');
                // First, check if an enterprise with this name already exists
                const existingEnterprise = enterprises.find(
                    (e) => e.name.toLowerCase() === formData.enterpriseName.trim().toLowerCase()
                );

                if (existingEnterprise) {
                    // Use the existing enterprise
                    enterpriseId = existingEnterprise.id;
                    console.log('[CreateResearchForm] Found existing enterprise:', enterpriseId);
                } else {
                    // Create a new enterprise
                    console.log('[CreateResearchForm] Creating new enterprise:', formData.enterpriseName.trim());
                    const newEnterpriseId = await createEnterprise(formData.enterpriseName.trim());
                    if (newEnterpriseId) {
                        enterpriseId = newEnterpriseId;
                        console.log('[CreateResearchForm] Created new enterprise:', enterpriseId);
                    }
                }
            } catch (error: unknown) {
                console.error('[CreateResearchForm] Failed to create enterprise:', error);
                return;
            }
        }

        console.log('[CreateResearchForm] Calling handleSubmit with enterpriseId:', enterpriseId);
        const researchId = await handleSubmit(enterpriseId);
        console.log('[CreateResearchForm] handleSubmit returned:', researchId);

        if (researchId) {
            // Handle file-based research post-creation
            if (isClientsBenchmark && selectedBenchmarkIds.size > 0) {
                // Client's Benchmark: save selected research IDs as stimuli references
                try {
                    const stimuli = Array.from(selectedBenchmarkIds).map(rId => {
                        const r = benchmarkResearches.find(br => br.id === rId);
                        return {
                            researchId: rId,
                            mediaId: rId, // use researchId as mediaId for sidebar navigation
                            name: r?.name || 'Unknown Research',
                            etModuleCount: r?.etModuleCount || 0,
                        };
                    });
                    await researchService.update(researchId, { settings: { stimuli } });
                    console.log('[CreateResearchForm] Benchmark researches saved:', stimuli.length);
                } catch (error) {
                    console.error('[CreateResearchForm] Failed to save benchmark researches:', error);
                }
            }

            const filesToUpload = formData.stimulusFiles || [];
            if (isInsightsFinding && filesToUpload.length > 0) {
                // Insights Finding: parse documents client-side, store entries in config
                // Limit entries & text length to stay under LiteSpeed ~100KB body limit
                const MAX_ENTRIES = 200;
                const MAX_TEXT_LENGTH = 300;
                try {
                    const parsedFiles: Array<{ mediaId: string; name: string; entries: Array<{ text: string; mood: string }>; totalCount: number; processedAt: string }> = [];
                    for (const file of filesToUpload) {
                        const colIndices = csvColumnSelections[file.name];
                        const headers = csvColumnHeaders[file.name];
                        if (colIndices && colIndices.length > 1) {
                            // Multi-column: one FileItem per selected column
                            for (const colIdx of colIndices) {
                                const colName = headers?.[colIdx] || `Column ${colIdx + 1}`;
                                const texts = await parseDocument(file, colIdx);
                                const totalCount = texts.length;
                                const capped = texts.slice(0, MAX_ENTRIES);
                                const entries = capped.map(text => ({
                                    text: text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) + '...' : text,
                                    mood: analyzeSentimentLocal(text),
                                }));
                                parsedFiles.push({
                                    mediaId: crypto.randomUUID(),
                                    name: `${file.name} — ${colName}`,
                                    entries,
                                    totalCount,
                                    processedAt: new Date().toISOString(),
                                });
                            }
                        } else {
                            // Single column or no selection
                            const colIndex = colIndices?.[0];
                            const texts = await parseDocument(file, colIndex);
                            const totalCount = texts.length;
                            const capped = texts.slice(0, MAX_ENTRIES);
                            const entries = capped.map(text => ({
                                text: text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) + '...' : text,
                                mood: analyzeSentimentLocal(text),
                            }));
                            parsedFiles.push({
                                mediaId: crypto.randomUUID(),
                                name: file.name,
                                entries,
                                totalCount,
                                processedAt: new Date().toISOString(),
                            });
                        }
                    }
                    if (parsedFiles.length > 0) {
                        await researchService.update(researchId, { settings: { stimuli: parsedFiles } });
                    }
                    console.log('[CreateResearchForm] Documents parsed and saved:', parsedFiles.length);
                } catch (error) {
                    console.error('[CreateResearchForm] Failed to parse text files:', error);
                    alert('Some files failed to process. You can re-upload them in the builder.');
                }
            } else if (isAttentionPrediction && filesToUpload.length > 0) {
                // Attention Prediction: upload images via media service
                try {
                    let uploaded = 0;
                    setUploadStatus(`Uploading images… (0/${filesToUpload.length})`);
                    const uploadedStimuli = await Promise.all(
                        filesToUpload.map(async (file) => {
                            const contentType = file.type || 'application/octet-stream';
                            const { upload_url, s3_key } = await mediaService.generateUploadUrl({
                                research_id: researchId, file_name: file.name, content_type: contentType,
                            });
                            const uploadResponse = await fetch(upload_url, {
                                method: 'PUT', body: file, headers: { 'Content-Type': contentType },
                            });
                            if (!uploadResponse.ok) throw new Error(`Upload failed: ${uploadResponse.status}`);
                            const { media } = await mediaService.saveMetadata({
                                research_id: researchId, s3_key,
                                metadata: { fileName: file.name, fileType: file.type, fileSize: file.size },
                            });
                            const mediaUrl = await mediaService.getMediaUrl(media.id);
                            uploaded++;
                            setUploadStatus(`Uploading images… (${uploaded}/${filesToUpload.length})`);
                            return { url: mediaUrl.url, mediaId: media.id, name: file.name };
                        })
                    );
                    setUploadStatus('Saving configuration…');
                    await researchService.update(researchId, {
                        settings: { stimuli: uploadedStimuli, stimulusUrl: uploadedStimuli[0]?.url, stimulusMediaId: uploadedStimuli[0]?.mediaId },
                    });
                    console.log('[CreateResearchForm] Stimulus images uploaded:', uploadedStimuli.length);
                } catch (error) {
                    console.error('[CreateResearchForm] Failed to upload stimulus files:', error);
                    alert('Some stimulus images failed to upload. You can re-upload them in the builder.');
                }
            }

            setUploadStatus('Redirecting to builder…');
            resetForm();

            // Handle navigation
            let targetPath = `/research/${researchId}/builder`;
            
            // For file-based research, navigate to first stimulus/research in builder
            if (isClientsBenchmark && selectedBenchmarkIds.size > 0) {
                const firstId = Array.from(selectedBenchmarkIds)[0];
                targetPath = `/research/${researchId}/builder/stimulus/${firstId}`;
            } else if (isFileBasedResearch && (formData.stimulusFiles || []).length > 0) {
                try {
                    // We need to fetch the updated research to get the mediaId of the first stimulus
                    const updatedResearch = await researchService.getById(researchId);
                    const researchData = updatedResearch.research;
                    const firstStimulus = (researchData.settings as { stimuli?: Array<{ mediaId: string }> } | undefined)?.stimuli?.[0];
                    if (firstStimulus?.mediaId) {
                        targetPath = `/research/${researchId}/builder/stimulus/${firstStimulus.mediaId}`;
                    }
                } catch (err) {
                    console.error('Failed to get updated research for navigation:', err);
                }
            }

            // Navigate first, then notify parent (parent's onSuccess may unmount this component)
            navigate(targetPath);
            onSuccess?.(researchId);
        } else {
            console.error('[CreateResearchForm] Failed to create research, check errors above');
        }
    };

    return (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100">
            <div className="p-6">
                <div className="space-y-6">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-800 mb-6">Create Research</h2>
                        <Stepper
                            currentStep={currentStep}
                            totalSteps={2}
                            steps={[
                                { label: 'Basic Information', description: 'Name and Enterprise' },
                                { label: 'Research Configuration', description: 'Type and Technique' },
                            ]}
                            onStepChange={setCurrentStep}
                        >
                            <form onSubmit={handleFormSubmit} className="space-y-6 max-w-2xl">
                                {currentStep === 0 && (
                                    <ResearchFormStep1
                                        name={formData.name}
                                        enterpriseName={formData.enterpriseName}
                                        enterpriseId={formData.enterpriseId}
                                        nameError={formErrors.name}
                                        enterpriseError={formErrors.enterpriseId}
                                        enterprises={enterprises}
                                        loadingEnterprises={loadingEnterprises}
                                        onNameChange={(value) => handleFieldChange('name', value)}
                                        onEnterpriseChange={(value) => {
                                            setFormData((prev) => ({
                                                ...prev,
                                                enterpriseName: value,
                                                enterpriseId: '',
                                            }));
                                        }}
                                        onEnterpriseSelect={handleEnterpriseSelect}
                                        onCreateEnterprise={isAdmin ? handleCreateEnterpriseFromAutocomplete : undefined}
                                    />
                                )}

                                {currentStep === 1 && (
                                    <ResearchFormStep2
                                        researchTypeId={formData.researchTypeId}
                                        researchTechniqueId={formData.researchTechniqueId}
                                        researchTypeError={formErrors.researchTypeId}
                                        researchTechniqueError={formErrors.researchTechniqueId}
                                        researchTypes={researchTypes}
                                        availableTechniques={availableTechniques}
                                        loadingResearchTypes={loadingResearchTypes}
                                        loadingTechniques={loadingTechniquesForType}
                                        stimulusFiles={formData.stimulusFiles}
                                        selectedBenchmarkCount={selectedBenchmarkIds.size}
                                        onResearchTypeChange={(value) => {
                                            handleFieldChange('researchTypeId', value);
                                            void loadTechniquesForType(value);
                                        }}
                                        onResearchTechniqueChange={(value) => {
                                            handleFieldChange('researchTechniqueId', value);
                                        }}
                                        useDefaultModules={formData.useDefaultModules}
                                        onToggleDefaultModules={(value) => handleFieldChange('useDefaultModules', value)}
                                        onOpenStimulusDrawer={() => setIsStimulusDrawerOpen(true)}
                                    />
                                )}

                                {submitError && (
                                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                                        <p className="text-sm text-red-600">{submitError}</p>
                                    </div>
                                )}

                                {(submitSuccess || uploadStatus) && (
                                    <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
                                        {uploadStatus ? (
                                            <>
                                                <svg className="animate-spin h-4 w-4 text-green-600" viewBox="0 0 24 24" fill="none">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                                </svg>
                                                <p className="text-sm text-green-600">{uploadStatus}</p>
                                            </>
                                        ) : (
                                            <p className="text-sm text-green-600">Research created successfully!</p>
                                        )}
                                    </div>
                                )}

                                <div className="flex gap-3 justify-between">
                                    <div>
                                        {currentStep > 0 && (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={handlePreviousStep}
                                                disabled={isCreating}
                                            >
                                                Previous
                                            </Button>
                                        )}
                                    </div>
                                    <div className="flex gap-3">
                                        {currentStep === 0 ? (
                                            <Button type="submit" disabled={isCreating}>
                                                Next
                                            </Button>
                                        ) : (
                                            <Button
                                                type="submit"
                                                isLoading={isCreating}
                                                disabled={isCreating || (isAttentionPrediction && (formData.stimulusFiles || []).length === 0) || (isClientsBenchmark && selectedBenchmarkIds.size === 0)}
                                            >
                                                {isAttentionPrediction && (formData.stimulusFiles || []).length === 0
                                                    ? 'Upload Images to Create'
                                                    : isClientsBenchmark && selectedBenchmarkIds.size === 0
                                                        ? 'Select Researches to Create'
                                                        : 'Create Research'}
                                            </Button>
                                        )}
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={resetForm}
                                            disabled={isCreating}
                                        >
                                            Reset
                                        </Button>
                                    </div>
                                </div>
                            </form>
                        </Stepper>
                    </div>
                </div>
            </div>

            {/* Client's Benchmark: Research selection drawer */}
            <Drawer
                isOpen={isStimulusDrawerOpen && isClientsBenchmark}
                onClose={() => setIsStimulusDrawerOpen(false)}
                title="Client's Benchmark — Select Researches"
                width="md"
            >
                <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                        Select researches with Eye Tracking data to include in the benchmark comparison.
                    </p>

                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search researches..."
                            value={benchmarkSearchTerm}
                            onChange={(e) => setBenchmarkSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                        />
                    </div>

                    {loadingBenchmarkResearches ? (
                        <div className="text-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin mx-auto text-accent" />
                            <p className="mt-2 text-sm text-gray-500">Loading researches...</p>
                        </div>
                    ) : benchmarkResearches.length === 0 ? (
                        <div className="text-center py-8">
                            <Eye className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                            <p className="text-sm text-gray-500">No researches with Eye Tracking found.</p>
                            <p className="text-xs text-gray-400 mt-1">Create a research with Eye Tracking first.</p>
                        </div>
                    ) : (
                        <div className="max-h-80 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-100">
                            {benchmarkResearches
                                .filter(r => !benchmarkSearchTerm || r.name.toLowerCase().includes(benchmarkSearchTerm.toLowerCase()))
                                .map(r => (
                                    <label
                                        key={r.id}
                                        className="flex items-center gap-3 p-3 bg-white hover:bg-gray-50 transition-colors cursor-pointer"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedBenchmarkIds.has(r.id)}
                                            onChange={() => toggleBenchmarkResearch(r.id)}
                                            className="w-4 h-4 text-accent border-gray-300 rounded focus:ring-accent"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-gray-900 truncate">{r.name}</p>
                                            <p className="text-xs text-gray-500">
                                                {r.etModuleCount} ET module{r.etModuleCount !== 1 ? 's' : ''} · {r.status} · {new Date(r.created_at).toLocaleDateString()}
                                            </p>
                                        </div>
                                    </label>
                                ))}
                        </div>
                    )}

                    {selectedBenchmarkIds.size > 0 && (
                        <p className="text-sm font-medium text-accent">
                            {selectedBenchmarkIds.size} research{selectedBenchmarkIds.size !== 1 ? 'es' : ''} selected
                        </p>
                    )}

                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                        <Button variant="outline" onClick={() => setIsStimulusDrawerOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            disabled={selectedBenchmarkIds.size === 0}
                            onClick={() => {
                                setIsStimulusDrawerOpen(false);
                                if (currentStep === 0) handleNextStep();
                            }}
                        >
                            Continue ({selectedBenchmarkIds.size} selected)
                        </Button>
                    </div>
                </div>
            </Drawer>

            {/* File-based research: File upload drawer (Attention Prediction / Insights Finding) */}
            <Drawer
                isOpen={isStimulusDrawerOpen && !isClientsBenchmark && !isWebsiteTracking}
                onClose={() => setIsStimulusDrawerOpen(false)}
                title={isInsightsFinding ? 'Insights Finding — Text Files' : 'Attention Prediction Stimuli'}
                width="md"
            >
                <div className="space-y-6">
                    <div>
                        <p className="text-sm text-gray-600 mb-4">
                            {isInsightsFinding
                                ? 'Upload documents to be analyzed for insights. Supported: CSV, TXT, XLSX, DOCX, PDF.'
                                : 'Attention Prediction requires one or more image stimuli. Please upload the images that will be analyzed.'}
                        </p>
                        <FileUpload
                            id="stimuli-upload"
                            label={isInsightsFinding ? 'Add Text Files' : 'Add Stimulus Images'}
                            multiple={true}
                            onFilesSelect={(files) => {
                                if (!files || files.length === 0) return;
                                if (isInsightsFinding) {
                                    const validExts = ['.csv', '.txt', '.xlsx', '.xls', '.docx', '.pdf'];
                                    const valid = Array.from(files).filter(f => {
                                        const ext = f.name.toLowerCase().slice(f.name.lastIndexOf('.'));
                                        if (!validExts.includes(ext)) {
                                            alert(`"${f.name}" is not supported. Accepted: CSV, TXT, XLSX, DOCX, PDF.`);
                                            return false;
                                        }
                                        return true;
                                    });
                                    if (valid.length > 0) {
                                        // Check if any CSV/Excel has multiple columns
                                        const processFiles = async () => {
                                            for (const f of valid) {
                                                const cols = await detectCsvColumns(f);
                                                if (cols) {
                                                    // Multi-column: show selector before adding
                                                    setPendingCsvFile({ file: f, columnInfo: cols });
                                                    return; // handle one at a time
                                                }
                                            }
                                            // No multi-column files, add all directly
                                            handleFieldChange('stimulusFiles', [...formData.stimulusFiles, ...valid]);
                                        };
                                        void processFiles();
                                    }
                                } else {
                                    handleFieldChange('stimulusFiles', [...formData.stimulusFiles, ...files]);
                                }
                            }}
                            acceptedFormats={isInsightsFinding ? '.csv,.txt,.xlsx,.xls,.docx,.pdf' : 'image/*'}
                            maxSizeMB={isInsightsFinding ? 50 : 10}
                        />
                    </div>
                    
                    {pendingCsvFile && (
                        <CsvColumnSelector
                            fileName={pendingCsvFile.file.name}
                            columnInfo={pendingCsvFile.columnInfo}
                            onSelect={(colIndices) => {
                                const file = pendingCsvFile.file;
                                setCsvColumnSelections(prev => ({ ...prev, [file.name]: colIndices }));
                                setCsvColumnHeaders(prev => ({ ...prev, [file.name]: pendingCsvFile.columnInfo.headers }));
                                handleFieldChange('stimulusFiles', [...formData.stimulusFiles, file]);
                                setPendingCsvFile(null);
                            }}
                            onCancel={() => setPendingCsvFile(null)}
                        />
                    )}

                    {formData.stimulusFiles.length > 0 && (
                        <div className="space-y-2">
                            <h4 className="text-sm font-medium text-gray-700">
                                {isInsightsFinding ? 'Selected Files' : 'Selected Images'} ({formData.stimulusFiles.length})
                            </h4>
                            <div className="max-h-60 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-100">
                                {formData.stimulusFiles.map((file, index) => (
                                    <div key={`${file.name}-${index}`} className="flex items-center justify-between p-3 bg-white hover:bg-gray-50 transition-colors">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="h-10 w-10 flex-shrink-0 bg-blue-50 rounded border border-blue-100 flex items-center justify-center">
                                                <svg className="h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.587-1.587a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                </svg>
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                                                <p className="text-xs text-gray-500">
                                                    {(file.size / 1024 / 1024).toFixed(2)} MB
                                                    {csvColumnSelections[file.name] && (
                                                        <span className="ml-1.5 text-blue-600">
                                                            · {csvColumnSelections[file.name].length} column{csvColumnSelections[file.name].length > 1 ? 's' : ''} selected
                                                        </span>
                                                    )}
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const newFiles = formData.stimulusFiles.filter((_, i) => i !== index);
                                                handleFieldChange('stimulusFiles', newFiles);
                                            }}
                                            className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                        <Button variant="outline" onClick={() => setIsStimulusDrawerOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            disabled={(formData.stimulusFiles || []).length === 0}
                            onClick={() => {
                                setIsStimulusDrawerOpen(false);
                                if (currentStep === 0) handleNextStep();
                            }}
                        >
                            Continue
                        </Button>
                    </div>
                </div>
            </Drawer>

        </div>
    );
};
