import { useState, useEffect } from 'react';
import { researchTypesService, type ModuleTemplateRef } from '../services/researchTypes.service';
import { type ResearchTechnique, type DefaultStageRef } from '../services/researchTechniques.service';
import { useCreateResearch } from './useResearchQuery';
import type { CreateResearchData } from '../services/research.service';
import { useAuthStore } from '../stores/auth.store';

interface CreateResearchFormData {
    name: string;
    enterpriseId: string;
    enterpriseName: string;
    researchTypeId: string;
    researchTechniqueId: string;
    useDefaultModules: boolean;
    stimulusFiles: File[];
}

interface ResearchFormErrors {
    name?: string;
    enterpriseId?: string;
    enterpriseName?: string;
    researchTypeId?: string;
    researchTechniqueId?: string;
    stimulusFiles?: string;
}

export const useResearchForm = () => {
    const isAdmin = useAuthStore((state) => state.user?.role === 'admin');
    const [formData, setFormData] = useState<CreateResearchFormData>({
        name: '',
        enterpriseId: '',
        enterpriseName: '',
        researchTypeId: '',
        researchTechniqueId: '',
        useDefaultModules: true,
        stimulusFiles: [],
    });
    const [currentStep, setCurrentStep] = useState<number>(0);
    const [researchTypes, setResearchTypes] = useState<Array<{ id: string; name: string; default_modules?: ModuleTemplateRef[] }>>([]);
    const [loadingResearchTypes, setLoadingResearchTypes] = useState<boolean>(false);
    const [availableTechniques, setAvailableTechniques] = useState<ResearchTechnique[]>([]);
    const [loadingTechniquesForType, setLoadingTechniquesForType] = useState<boolean>(false);
    const [formErrors, setFormErrors] = useState<ResearchFormErrors>({});
    const [submitError, setSubmitError] = useState<string>('');
    const [submitSuccess, setSubmitSuccess] = useState<boolean>(false);
    
    // Usar el hook de React Query para crear research (con invalidación automática)
    const createResearchMutation = useCreateResearch();

    useEffect(() => {
        void loadResearchTypes();
    }, []);

    const loadResearchTypes = async (): Promise<void> => {
        setLoadingResearchTypes(true);
        try {
            console.log('[useResearchForm] Loading research types...');
            const response = await researchTypesService.list();
            console.log('[useResearchForm] Received research types:', response.researchTypes?.length || 0);
            
            // Filter to ensure we only show active types (backend should already filter, but double-check)
            const activeTypes = (response.researchTypes || []).filter((rt: { is_active?: boolean }) => {
                // If is_active is undefined, assume it's active (for backwards compatibility)
                return rt.is_active !== false;
            });
            
            console.log('[useResearchForm] Active research types after filtering:', activeTypes.length);
            
            // Parse and validate default_modules to ensure it's always an array or undefined
            const normalizedTypes = activeTypes.map((rt: { id: string; name: string; default_modules?: ModuleTemplateRef[] | string }) => {
                let defaultModules: ModuleTemplateRef[] | undefined = undefined;
                
                if (rt.default_modules) {
                    // If it's a string, try to parse it as JSON
                    if (typeof rt.default_modules === 'string') {
                        try {
                            const parsed = JSON.parse(rt.default_modules);
                            defaultModules = Array.isArray(parsed) ? parsed : undefined;
                        } catch (e) {
                            console.warn('[useResearchForm] Failed to parse default_modules as JSON:', rt.default_modules, e);
                            defaultModules = undefined;
                        }
                    } 
                    // If it's already an array, use it
                    else if (Array.isArray(rt.default_modules)) {
                        defaultModules = rt.default_modules;
                    }
                    // Otherwise, ignore it
                    else {
                        console.warn('[useResearchForm] default_modules is not an array or string:', typeof rt.default_modules, rt.default_modules);
                        defaultModules = undefined;
                    }
                }
                
                return {
                    id: rt.id,
                    name: rt.name,
                    default_modules: defaultModules
                };
            });
            
            console.log('[useResearchForm] Normalized research types:', normalizedTypes.map(rt => ({ 
                id: rt.id, 
                name: rt.name, 
                hasDefaultModules: !!rt.default_modules,
                defaultModulesCount: rt.default_modules?.length || 0
            })));
            
            setResearchTypes(normalizedTypes);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to load research types';
            console.error('[useResearchForm] Error loading research types:', error);
            setSubmitError(errorMessage);
            setResearchTypes([]);
        } finally {
            setLoadingResearchTypes(false);
        }
    };

    const loadTechniquesForType = async (researchTypeId: string): Promise<void> => {
        if (!researchTypeId || researchTypeId.trim() === '') {
            console.warn('[useResearchForm] loadTechniquesForType called with empty researchTypeId');
            setAvailableTechniques([]);
            setFormData((prev) => ({ ...prev, researchTechniqueId: '' }));
            return;
        }
        
        // Verify that the research type is in our list of active types
        const selectedType = researchTypes.find(rt => rt.id === researchTypeId);
        if (!selectedType) {
            console.warn('[useResearchForm] Selected research type not found in active types list:', researchTypeId);
            console.warn('[useResearchForm] Available research types:', researchTypes.map(rt => ({ id: rt.id, name: rt.name })));
            setSubmitError('Selected research type is not available');
            setAvailableTechniques([]);
            setFormData((prev) => ({ ...prev, researchTechniqueId: '', researchTypeId: '' }));
            return;
        }
        
        setLoadingTechniquesForType(true);
        setFormData((prev) => ({ ...prev, researchTechniqueId: '' }));
        setSubmitError(''); // Clear any previous errors
        
        try {
            console.log('[useResearchForm] Loading techniques for research type:', researchTypeId, selectedType.name);
            console.log('[useResearchForm] Making API call to getTechniquesByType...');
            
            const techniques = await researchTypesService.getTechniquesByType(researchTypeId);
            
            console.log('[useResearchForm] API call successful, received:', techniques);
            console.log('[useResearchForm] Techniques type:', typeof techniques, 'isArray:', Array.isArray(techniques));
            
            // Ensure techniques is an array
            if (Array.isArray(techniques)) {
                console.log('[useResearchForm] Setting availableTechniques with', techniques.length, 'techniques');
                setAvailableTechniques(techniques);
                if (techniques.length === 0) {
                    console.warn('[useResearchForm] No techniques found for research type:', researchTypeId);
                }
            } else {
                console.error('[useResearchForm] Techniques is not an array:', techniques);
                console.error('[useResearchForm] Techniques value:', JSON.stringify(techniques, null, 2));
                setAvailableTechniques([]);
            }
        } catch (error: unknown) {
            console.error('[useResearchForm] ERROR in loadTechniquesForType:', error);
            console.error('[useResearchForm] Error type:', typeof error);
            console.error('[useResearchForm] Error constructor:', error?.constructor?.name);
            
            if (error instanceof Error) {
                console.error('[useResearchForm] Error message:', error.message);
                console.error('[useResearchForm] Error stack:', error.stack);
            }
            
            if (error && typeof error === 'object' && 'response' in error) {
                const axiosError = error as { response?: { status?: number; data?: unknown; statusText?: string } };
                console.error('[useResearchForm] Axios error response:', {
                    status: axiosError.response?.status,
                    statusText: axiosError.response?.statusText,
                    data: axiosError.response?.data,
                });
            }
            
            const errorMessage = error instanceof Error ? error.message : 'Failed to load research techniques';
            console.error('[useResearchForm] Setting submitError with message:', errorMessage);
            setSubmitError(`Failed to load techniques: ${errorMessage}`);
            setAvailableTechniques([]);
            // Don't clear the researchTypeId on error, let user try again
        } finally {
            console.log('[useResearchForm] loadTechniquesForType completed, setting loading to false');
            setLoadingTechniquesForType(false);
        }
    };

    const validateStep1 = (): boolean => {
        const newErrors: ResearchFormErrors = {};

        if (!formData.name.trim()) {
            newErrors.name = 'Research Name is required';
        }

        if (!formData.enterpriseId && !formData.enterpriseName.trim()) {
            newErrors.enterpriseId = 'Enterprise is required';
        } else if (!formData.enterpriseId && !isAdmin) {
            newErrors.enterpriseId = 'Select an existing client';
        }

        setFormErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const validateStep2 = (): boolean => {
        const newErrors: ResearchFormErrors = {};

        if (!formData.researchTypeId) {
            newErrors.researchTypeId = 'Research Type is required';
        }

        const selectedType = researchTypes.find(rt => rt.id === formData.researchTypeId);
        const isFileBasedResearch = selectedType?.name === 'Attention Prediction' ||
                                   selectedType?.name === "Attention's Prediction" ||
                                   selectedType?.name === 'Insights Finding' ||
                                   selectedType?.name === "Client's Benchmark" ||
                                   selectedType?.name === 'Website Tracking';

        if (!isFileBasedResearch && !formData.researchTechniqueId) {
            newErrors.researchTechniqueId = 'Research Technique is required';
        }

        setFormErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleFieldChange = (field: keyof CreateResearchFormData, value: string | boolean | File[] | null): void => {
        console.log('[useResearchForm] Field changed:', { field, value });
        setFormData((prev) => {
            const newData = { ...prev, [field]: value };
            console.log('[useResearchForm] Updated formData:', newData);
            return newData;
        });
        if (formErrors[field as keyof ResearchFormErrors]) {
            setFormErrors((prev) => ({ ...prev, [field]: undefined }));
        }
        setSubmitError('');
        setSubmitSuccess(false);
    };

    const handleNextStep = (): void => {
        if (currentStep === 0) {
            if (validateStep1()) {
                setCurrentStep(1);
            }
        }
    };

    const handlePreviousStep = (): void => {
        if (currentStep > 0) {
            setCurrentStep(currentStep - 1);
        }
    };

    const handleSubmit = async (enterpriseId?: string, skipStepCheck = false): Promise<string | null> => {
        setSubmitError('');
        setSubmitSuccess(false);

        console.log('[useResearchForm] handleSubmit called', {
            currentStep,
            enterpriseId,
            formData,
            skipStepCheck,
        });

        if (!skipStepCheck && currentStep === 0) {
            handleNextStep();
            return null;
        }

        console.log('[useResearchForm] Validating step 2...');
        if (!validateStep2()) {
            console.error('[useResearchForm] Step 2 validation failed', formErrors);
            return null;
        }

        console.log('[useResearchForm] Validation passed, creating research...');

        try {
            // Extract default modules if enabled
            const selectedType = researchTypes.find(rt => rt.id === formData.researchTypeId);
            const selectedTechnique = availableTechniques.find(t => t.id === formData.researchTechniqueId);
            const isFileBasedType = selectedType?.name === 'Attention Prediction' ||
                                   selectedType?.name === "Attention's Prediction" ||
                                   selectedType?.name === 'Insights Finding' ||
                                   selectedType?.name === "Client's Benchmark" ||
                                   selectedType?.name === 'Website Tracking';

            const createData: CreateResearchData & Record<string, unknown> = {
                name: formData.name.trim(),
                enterprise_id: enterpriseId || formData.enterpriseId || undefined,
                research_type_id: formData.researchTypeId,
                research_technique_id: formData.researchTechniqueId || undefined,
                ...(isFileBasedType ? { skip_default_modules: true } : {}),
            };

            // Clean up data: remove undefined, null, or empty string values
            // research_technique_id should only be sent if it has a valid value
            if (createData.research_technique_id === '' || createData.research_technique_id === undefined) {
                delete createData.research_technique_id;
            }

            // Remove other undefined or empty values
            Object.keys(createData).forEach(key => {
                if (createData[key] === undefined || createData[key] === null || createData[key] === '') {
                    delete createData[key];
                }
            });

            if (formData.useDefaultModules && !isFileBasedType) {
                // Priority: technique default_stages > research type default_modules
                const techniqueStages = selectedTechnique?.default_stages;
                if (Array.isArray(techniqueStages) && techniqueStages.length > 0) {
                    const stageNames = techniqueStages
                        .sort((a: DefaultStageRef, b: DefaultStageRef) => a.order - b.order)
                        .map((s: DefaultStageRef) => s.name)
                        .filter((name: string) => !!name);
                    if (stageNames.length > 0) {
                        createData.use_default_modules = stageNames;
                    }
                } else if (selectedType?.default_modules) {
                    // Fallback to research type default_modules
                    if (Array.isArray(selectedType.default_modules)) {
                        const moduleNames = selectedType.default_modules
                            .map((m: ModuleTemplateRef) => m?.name)
                            .filter((name: string | undefined) => name !== undefined && name !== null);
                        if (moduleNames.length > 0) {
                            createData.use_default_modules = moduleNames;
                        }
                    } else {
                        console.warn('[useResearchForm] default_modules is not an array:', selectedType.default_modules);
                    }
                }
            }

            console.log('[useResearchForm] Sending create request with data:', createData);
            // Usar la mutación de React Query que invalida automáticamente las queries
            const response = await createResearchMutation.mutateAsync(createData);
            console.log('[useResearchForm] Research created successfully:', response);
            setSubmitSuccess(true);
            return response.research.id;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to create research';
            console.error('[useResearchForm] Error creating research:', error);
            setSubmitError(errorMessage);
            return null;
        }
    };

    const resetForm = (): void => {
        setFormData({
            name: '',
            enterpriseId: '',
            enterpriseName: '',
            researchTypeId: '',
            researchTechniqueId: '',
            useDefaultModules: true,
            stimulusFiles: [],
        });
        setFormErrors({});
        setSubmitError('');
        setSubmitSuccess(false);
        setCurrentStep(0);
    };

    return {
        formData,
        currentStep,
        researchTypes,
        loadingResearchTypes,
        availableTechniques,
        loadingTechniquesForType,
        formErrors,
        isCreating: createResearchMutation.isPending,
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
    };
};
