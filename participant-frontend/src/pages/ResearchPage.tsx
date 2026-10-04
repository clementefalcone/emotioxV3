import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MainLayout } from '../components/layout/MainLayout';
import { Button } from '../components/ui/Button';
import { DevSidebar } from '../components/layout/DevSidebar';
import { DynamicStep } from '../components/steps/DynamicStep';
import { PreviewModeBanner } from '../components/ui/PreviewModeBanner';
import { ResearchCompletionContent } from '../components/ui/ResearchCompletionContent';
import { UnconfiguredStepContent } from '../components/ui/UnconfiguredStepContent';
import { WelcomeStep } from '../components/steps/WelcomeStep';
import { DemographicsStep } from '../components/steps/DemographicsStep';
import { LanguageSelector } from '../components/ui/LanguageSelector';
import { useSessionStore } from '../stores/useSessionStore';
import { useParticipantStore } from '../stores/useParticipantStore';
import { useNavigation } from '../hooks/useNavigation';
import { useDeviceCollector } from '../hooks/useDeviceCollector';
import { useLocationCollector } from '../hooks/useLocationCollector';
import { useSessionTimer } from '../hooks/useSessionTimer';
import { usePreviewMode } from '../hooks/usePreviewMode';
import { useButtonConfig } from '../hooks/useButtonConfig';
import { useKioskMode } from '../hooks/useKioskMode';
import { useHandleNext } from '../hooks/useHandleNext';
import { useEnterToContinue } from '../hooks/useEnterToContinue';
import { publicService, type Module } from '../services/public.service';
import { getComponentText } from '../utils/moduleComponent';
import { mediaService } from '../services/media.service';
import { queryClient } from '../providers/queryClient';
import { isRecord, isModuleHidden, isModuleConfigured, getLinkConfig, getBacklinks, getDemographicsConfig, getStudyLogo, getStepIdFromModuleName, normalizeModule } from '../utils/researchPageHelpers';
import {
  RedirectingScreen,
  AlreadyRespondedScreen,
  KioskTransitionScreen,
  MobileRestrictionScreen,
  InvalidResearchScreen,
  LoadingScreen,
  ErrorScreen,
} from './ResearchPageScreens';

// Turnstile temporarily disabled - will be re-enabled when TURNSTILE_SECRET_KEY is configured
const TURNSTILE_ENABLED = false;


export const ResearchPage = () => {
  const { t } = useTranslation();
  const { researchId } = useParams<{ researchId: string }>();
  const { isPreviewMode, isReviewMode, reviewParticipantId, participantId } = usePreviewMode();
  const { setConfig } = useSessionStore();
  const allowLanguageSwitch = useSessionStore((s) => s.config?.linkConfig?.allowLanguageSwitch);
  const { getResponsesByModule, startNewSession, clearAllResponses } = useParticipantStore();
  const [modules, setModules] = useState<Record<string, Module>>({});

  // Build demographic responses map for conditionality filtering.
  // We serialize to a JSON key so the memo only updates when actual values change.
  const _demoResponsesJson = useParticipantStore((state) => {
    const map: Record<string, string> = {};
    state.responses.forEach((r) => {
      if (r.moduleId === 'demographics' && typeof r.value === 'string') {
        map[r.componentId] = r.value;
      }
    });
    return JSON.stringify(map);
  });
  const demographicResponses: Record<string, string> = useMemo(
    () => JSON.parse(_demoResponsesJson) as Record<string, string>,
    [_demoResponsesJson]
  );

  // Build module responses map for module-based conditionality filtering.
  const _moduleResponsesJson = useParticipantStore((state) => {
    const map: Record<string, { value: string | number | boolean | string[] | number[] | null }> = {};
    state.responses.forEach((r) => {
      if (r.moduleId !== 'demographics') {
        map[`${r.moduleId}_${r.componentId}`] = { value: r.value };
      }
    });
    return JSON.stringify(map);
  });
  const moduleResponses = useMemo(() => {
    const parsed = JSON.parse(_moduleResponsesJson) as Record<string, { value: string | number | boolean | string[] | number[] | null }>;
    return new Map(Object.entries(parsed));
  }, [_moduleResponsesJson]);

  const [stepsOrder, setStepsOrder] = useState<string[]>([]);
  const { currentStep, goNext, isLastStep } = useNavigation(modules, demographicResponses, moduleResponses, stepsOrder);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mobileRestriction, setMobileRestriction] = useState<string | null>(null);
  const [showRestartOption, setShowRestartOption] = useState(false);
  const [backlinks, setBacklinks] = useState<Record<string, string>>({});
  const [alreadyResponded, setAlreadyResponded] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [studyLogoUrl, setStudyLogoUrl] = useState<string | null>(null);
  const [studyLogoEnabled, setStudyLogoEnabled] = useState(true);

  /** Show redirect screen briefly, then navigate.
   *  - Replaces `@id` placeholder with the real participant ID.
   *  - Ensures the URL has a protocol so the browser treats it as absolute. */
  const redirectTo = useCallback((rawUrl: string) => {
    let url = rawUrl.trim();
    // Replace @id placeholder with actual participant ID
    if (participantId) {
      url = url.replace(/@id/gi, encodeURIComponent(participantId));
    }
    // Ensure absolute URL — add https:// if no protocol present
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }
    setRedirecting(true);
    setTimeout(() => { window.location.href = url; }, 1500);
  }, [participantId]);

  // Initialize device collector
  useDeviceCollector();

  // Initialize location collector (will be called manually when needed)
  useLocationCollector();

  // Check for participant change (session persistence fix)
  useEffect(() => {
    if (!participantId) return;

    const storedParticipantId = useParticipantStore.getState().participantId;

    // If we have a new participant (different from stored or no stored ID)
    // we need to reset the session to start from the beginning
    if (!storedParticipantId || storedParticipantId !== participantId) {
      console.log('[ResearchPage] New or changed participant, resetting session');
      clearAllResponses();
      // Clear Turnstile token, but if Turnstile is disabled, auto-verify immediately
      useSessionStore.getState().clearTurnstileToken();
      if (!TURNSTILE_ENABLED) {
        useSessionStore.getState().setTurnstileToken('disabled');
      }
      startNewSession();
      // Flush caches to prevent memory buildup across participant sessions
      mediaService.clearCache();
      queryClient.clear();
      // Reset to the first step (welcome)
      useParticipantStore.getState().setCurrentStep('welcome');
    }

    // Always update to current participant ID
    useParticipantStore.getState().setParticipantId(participantId);
  }, [participantId, clearAllResponses, startNewSession]);

  // Initialize session timer
  useSessionTimer();

  // Auto-initialize Turnstile when disabled
  useEffect(() => {
    if (!TURNSTILE_ENABLED) {
      const { turnstileVerified, turnstileToken } = useSessionStore.getState();
      if (!turnstileVerified || !turnstileToken) {
        useSessionStore.getState().setTurnstileToken('disabled');
      }
    }
  }, []);

  // Kiosk mode management
  const { kioskTransition, participationMode } = useKioskMode(
    currentStep,
    isPreviewMode,
    researchId,
    clearAllResponses,
    startNewSession,
  );

  // Auto-redirect on thank-you for non-kiosk modes (panel / anonymous)
  // Kiosk has its own auto-reset above; preview never redirects.
  useEffect(() => {
    if (currentStep !== 'thank-you' || isPreviewMode || participationMode === 'kiosk') return;

    if (backlinks.complete) {
      redirectTo(backlinks.complete);
      return;
    }

    const linkConfig = useSessionStore.getState().config?.linkConfig;
    if (linkConfig?.allowMultiple === true) {
      setShowRestartOption(true);
    }
  }, [currentStep, isPreviewMode, participationMode, backlinks, redirectTo]);

  // Load research configuration
  useEffect(() => {
    if (!researchId) return;

    const loadResearch = async () => {
      try {
        setLoading(true);
        setError(null);
        setMobileRestriction(null);
        setShowRestartOption(false);

        // Step 1: Detect participation mode (before anything else)
        const mode = await publicService.getParticipationMode(researchId);
        useParticipantStore.getState().setParticipationMode(mode);

        // Step 2: Determine effective preview mode locally
        // (can't rely on hook value — mode was just set, re-render hasn't happened yet)
        const params = new URLSearchParams(window.location.search);
        const urlParticipantId = params.get('participantId') ?? params.get('participantid') ?? params.get('ECX') ?? params.get('ecx');
        const explicitPreview = new URLSearchParams(window.location.search).get('preview') === 'true';
        const reviewParam = params.get('review');
        const effectivePreview = explicitPreview || (!urlParticipantId && mode !== 'kiosk');

        // Step 3: If kiosk mode, always request a fresh session
        // (ensures correct research context even if localStorage has stale kiosk ID from another research)
        if (mode === 'kiosk' && !urlParticipantId && !explicitPreview) {
          const kioskId = await publicService.requestKioskSession(researchId);
          useParticipantStore.getState().setParticipantId(kioskId);
          useParticipantStore.getState().clearAllResponses();
          startNewSession();
          useParticipantStore.getState().setCurrentStep('welcome');
        }

        // Fetch research data from backend
        const research = await publicService.getResearch(researchId, effectivePreview);

        // Panel with ECX/participantId: block repeat submissions and avoid stale persisted thank-you / redirect race
        if (urlParticipantId && !effectivePreview && !reviewParam) {
          const { hasResponded } = await publicService.getParticipantStatus(researchId, urlParticipantId);
          if (hasResponded) {
            setAlreadyResponded(true);
            setModules({});
            setStepsOrder([]);
            setLoading(false);
            return;
          }
        }

        // Check mobile device restriction
        const linkConfig = getLinkConfig(research);

        // Get device info from session store
        const deviceType = useSessionStore.getState().deviceInfo?.deviceType;

        // If mobile devices are not allowed and user is on mobile/tablet
        if (linkConfig.allowMobile === false && deviceType && (deviceType === 'mobile' || deviceType === 'tablet')) {
          setMobileRestriction(t('mobileRestriction.message'));
          setModules({});
          setLoading(false);
          return;
        }

        // Get backlinks configuration
        const researchBacklinks = getBacklinks(research);
        setBacklinks(researchBacklinks);

        // Resolve study logo
        const logoConfig = getStudyLogo(research);
        if (logoConfig) {
          setStudyLogoEnabled(logoConfig.enabled);
          if (logoConfig.enabled && logoConfig.s3Key) {
            mediaService.getMediaUrl(logoConfig.s3Key).then(url => setStudyLogoUrl(url)).catch(() => setStudyLogoUrl(null));
          }
        }

        // Pre-check: are all quota slots exhausted? If so, redirect before demographics
        if (!effectivePreview) {
          try {
            const quotaStatus = await publicService.checkQuotaAvailability(researchId);
            if (!quotaStatus.available) {
              if (researchBacklinks.overquota) {
                redirectTo(researchBacklinks.overquota);
                return;
              }
              // No backlink configured — show message and stop
              setMobileRestriction(t('errors.quotaFull', 'This survey has reached its participant limit for your profile.'));
              setModules({});
              setLoading(false);
              return;
            }
          } catch {
            // Don't block participant if pre-check fails
            console.warn('Quota pre-check failed, continuing normally');
          }
        }

        // Transform stages and modules into flat structure for navigation
        const modulesMap: Record<string, Module> = {};

        // Backend returns modules directly, wrap them in a stage if needed
        const stages = research.stages || [{ id: 'legacy', name: 'Legacy', description: '', order_index: 0, modules: research.modules || [] }];

        const demographicsConfig = getDemographicsConfig(research);
        // Check if any demographic is enabled (boolean true OR object with enabled: true)
        const hasDemographics = demographicsConfig && Object.values(demographicsConfig).some(val => {
          if (val === true) return true;
          if (isRecord(val) && val.enabled === true) return true;
          return false;
        });

        if (hasDemographics) {
          modulesMap['demographics'] = {
            id: 'demographics',
            name: 'Demographics',
            description: 'Demographic Questions',
            structure: { components: [] },
            config: { demographics: demographicsConfig }
          };
        }

        // Build dynamic steps order: stages first (order_index), then modules within each stage.
        // Do not sort all modules by module order_index globally — that interleaves different stages
        // (e.g. Implicit Association + Cognitive Tasks) when order_index is scoped per-stage.
        const dynamicOrder: string[] = [];

        const sortedStages = [...stages].sort(
          (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)
        );

        const allModules: Array<{ module: unknown }> = [];
        for (const stage of sortedStages) {
          const mods = stage.modules || [];
          const sortedMods = [...mods].sort((a, b) => {
            const oi = (m: unknown): number =>
              isRecord(m) && typeof (m as Record<string, unknown>).order_index === 'number'
                ? ((m as Record<string, unknown>).order_index as number)
                : 0;
            return oi(a) - oi(b);
          });
          for (const mod of sortedMods) {
            allModules.push({ module: mod });
          }
        }

        allModules.forEach(({ module }) => {
          try {
            const normalizedModule = normalizeModule(module);
            if (isModuleHidden(normalizedModule)) return;
            if (!isModuleConfigured(normalizedModule)) return;
            const nameBasedId = getStepIdFromModuleName(normalizedModule.name);
            if (!nameBasedId) return;
            // Special steps (welcome, demographics, thank-you) keep their fixed stepId.
            // All other modules use their unique module.id so duplicates don't collide.
            const isSpecial = nameBasedId === 'welcome' || nameBasedId === 'demographics' || nameBasedId === 'thank-you' || nameBasedId === 'screener';
            const stepId = isSpecial ? nameBasedId : normalizedModule.id;
            modulesMap[stepId] = normalizedModule;
            if (!dynamicOrder.includes(stepId)) {
              dynamicOrder.push(stepId);
            }
          } catch (err: unknown) {
            console.error('Error normalizing module:', err, module);
          }
        });

        // Ensure welcome is first, screener before demographics, thank-you last
        const orderedSteps: string[] = [];
        if (dynamicOrder.includes('welcome')) orderedSteps.push('welcome');
        if (dynamicOrder.includes('screener')) orderedSteps.push('screener');
        if (dynamicOrder.includes('demographics') || modulesMap['demographics']) orderedSteps.push('demographics');
        // Add all non-special steps in stage order, then module order within each stage
        dynamicOrder.forEach(s => {
          if (s !== 'welcome' && s !== 'demographics' && s !== 'thank-you' && s !== 'screener') {
            orderedSteps.push(s);
          }
        });
        if (dynamicOrder.includes('thank-you')) orderedSteps.push('thank-you');

        setModules(modulesMap);
        setStepsOrder(orderedSteps);

        const enabledSteps = orderedSteps.filter((stepId) => Boolean(modulesMap[stepId]));
        // If no steps are enabled, default to welcome (shouldn't happen, but safety check)
        const firstStep = enabledSteps.length > 0 ? enabledSteps[0] : 'welcome';

        // In preview mode, always reset to the first step and clear previous responses
        // In review mode, don't clear — responses are loaded separately
        // In participant mode, only reset if user hasn't progressed yet
        const storedStep = useParticipantStore.getState().currentStep;
        if (effectivePreview && !reviewParam) {
          useParticipantStore.getState().clearAllResponses();
          useParticipantStore.getState().setCurrentStep(firstStep);
        } else if (!storedStep || storedStep === 'welcome' || !enabledSteps.includes(storedStep)) {
          useParticipantStore.getState().setCurrentStep(firstStep);
        } else if (
          urlParticipantId &&
          !effectivePreview &&
          !reviewParam &&
          storedStep === 'thank-you'
        ) {
          // Persisted thank-you from a prior session without completed responses — restart flow
          useParticipantStore.getState().setCurrentStep(firstStep);
        }

        // Set session configuration
        setConfig({
          id: researchId,
          settings: {
            enableLocationCapture: true,
            enableDeviceCapture: true,
            enableSessionRecording: true,
            enableInteractionTracking: true,
          },
          linkConfig: linkConfig,
          backlinks: researchBacklinks,
        });

        // Review mode: load participant responses after modules are ready
        if (reviewParam) {
          try {
            const responses = await publicService.getParticipantResponses(researchId, reviewParam);
            for (const r of responses) {
              let parsedValue: unknown = r.value;
              if (typeof parsedValue === 'string') {
                try { parsedValue = JSON.parse(parsedValue); } catch { /* keep as string */ }
              }
              useParticipantStore.getState().saveResponse(r.module_id, r.component_id, parsedValue as import('../types/responses').ResponseValue);
            }
            useParticipantStore.getState().setCurrentStep(firstStep);
          } catch (err) {
            console.error('[ReviewMode] Failed to load responses:', err);
          }
        }

      } catch (err: unknown) {
        console.error('Failed to load research:', err);
        const errMsg = err instanceof Error ? err.message : '';
        // Research is completed/closed — show specific blocking screen
        if (errMsg.includes('not active') || errMsg.includes('404')) {
          setMobileRestriction(t('errors.researchClosed', 'This survey is no longer accepting responses.'));
        } else {
          setError(t('errors.failedToLoadResearch'));
        }
      } finally {
        setLoading(false);
      }
    };

    void loadResearch();
  }, [researchId, setConfig, startNewSession, t, redirectTo]);

  // Check if we're in development mode
  const isDev = useMemo(() => import.meta.env.DEV, []);

  // Get current module
  const currentModule = useMemo(() => modules[currentStep], [modules, currentStep]);

  // Button configuration
  const { getButtonText, shouldShowButton } = useButtonConfig();

  const isSpecialStep = currentStep === 'welcome' || currentStep === 'demographics' || currentStep === 'thank-you';
  const isImplicitAssociation = useMemo(() => {
    const lower = (currentModule?.name || '').toLowerCase();
    return lower.includes('attribute testing') ||
      lower.includes('comparing attribute') ||
      lower.includes('objects comparing') ||
      lower.includes('object comparing');
  }, [currentModule]);
  const currentModuleResponses = currentModule ? getResponsesByModule(currentModule.id) : [];
  const needsResponse = !isSpecialStep && shouldShowButton(currentModule);
  const buttonDisabled = submitting || (needsResponse && currentModuleResponses.length === 0);

  // Handle next step
  const handleNext = useHandleNext({
    isPreviewMode,
    participantId,
    researchId,
    currentModule,
    currentStep,
    showRestartOption,
    backlinks,
    goNext,
    startNewSession,
    clearAllResponses,
    getResponsesByModule,
    setSubmitting,
    setShowRestartOption,
    setMobileRestriction,
    redirectTo,
  });

  useEnterToContinue((shouldShowButton(currentModule) || showRestartOption) && !buttonDisabled, handleNext);

  // --- Early-return screens ---

  if (!researchId) {
    return <InvalidResearchScreen />;
  }

  if (redirecting) {
    return <RedirectingScreen />;
  }

  if (mobileRestriction) {
    return <MobileRestrictionScreen message={mobileRestriction} />;
  }

  if (alreadyResponded) {
    return <AlreadyRespondedScreen />;
  }

  if (loading) {
    return <LoadingScreen />;
  }

  if (error) {
    return <ErrorScreen message={error} onRetry={() => window.location.reload()} />;
  }

  if (kioskTransition) {
    return <KioskTransitionScreen />;
  }

  return (
    <>
      {/* Development Sidebar — also visible in preview mode for researchers */}
      {(isDev || isPreviewMode) && (
        <DevSidebar
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          modules={modules}
          stepsOrder={stepsOrder}
          isPreviewMode={isPreviewMode}
        />
      )}

      {/* Preview / Review Mode Banner */}
      {isReviewMode ? (
        <div className="fixed top-0 left-0 right-0 z-50 bg-emerald-600 text-white text-center py-1.5 text-xs font-medium">
          Review Mode — Participant: {reviewParticipantId}
        </div>
      ) : isPreviewMode ? (
        <PreviewModeBanner />
      ) : null}

      {allowLanguageSwitch && <LanguageSelector />}

      {studyLogoEnabled && !isImplicitAssociation && (
        <div className="fixed top-5 sm:top-3 left-0 right-0 z-40 flex justify-center pointer-events-none">
          <img
            src={studyLogoUrl || `${import.meta.env.BASE_URL}EmotioCX-logo.svg`}
            alt="Logo"
            className="h-8 object-contain"
          />
        </div>
      )}

      <MainLayout
        footer={
          isReviewMode ? null :
          shouldShowButton(currentModule) && !showRestartOption ? (
            <Button
              onClick={handleNext}
              disabled={buttonDisabled}
            >
              {submitting
                ? t('common.saving')
                : isLastStep
                  ? t('common.finish')
                  : getButtonText(currentModule)}
            </Button>
          ) : showRestartOption ? (
            <Button
              onClick={handleNext}
              disabled={submitting}
            >
              {t('common.startOver')}
            </Button>
          ) : null
        }
      >
        {currentModule && currentStep === 'welcome' ? (
          <WelcomeStep
            title={getComponentText(currentModule.structure.components?.find(c => c.id?.includes('title')))}
            message={getComponentText(currentModule.structure.components?.find(c => c.id?.includes('message')))}
          />
        ) : currentModule && currentModule.id !== 'demographics' ? (
          <DynamicStep module={currentModule} onComplete={handleNext} />
        ) : currentModule && currentModule.id === 'demographics' ? (
          <DemographicsStep module={currentModule} onComplete={handleNext} />
        ) : showRestartOption ? (
          <ResearchCompletionContent showRestartOption={showRestartOption} />
        ) : (
          <UnconfiguredStepContent currentStep={currentStep} />
        )}
      </MainLayout>
    </>
  );
};
