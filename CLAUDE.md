# CLAUDE.md

## Al iniciar conversacion
- Leer `BITACORA.md` y `CHANGELOG.md` para entender el estado actual y cambios recientes
- Comunicarse en espanol
- Empieza cada respuesta con mi nombre: Clemente

## Antes de cerrar la sesion
- Escribir `HANDOFF.md` con el estado actual del proyecto: que esta hecho, que falta, ficheros clave y preguntas abiertas

## Project Overview
EmotioX V3 — plataforma SaaS de investigacion UX. Permite a investigadores crear estudios con stages: SmartVOC (NPS, CSAT, CES, CV, NEV, VOC), Cognitive Tasks (Ranking, Single/Multiple Choice, Short/Long Text, Linear Scale, Navigation Flow, Preference Test), Screener, Implicit Association (Attribute Testing, Comparing Attribute, Objects Comparing), Eye Tracking. Configurar demografia, cuotas, y analizar resultados en tiempo real. Los participantes responden encuestas via URL/QR.

### Tecnica "Biometric, Cognitive and Predictive"
Default stages: Screener -> Welcome Screen -> Research Configuration -> Implicit Association -> Cognitive Tasks -> Eye Tracking -> Thank You Screen.
- **Screener** (`single_module`): pregunta de filtrado con choices Qualify/Disqualify.
- **Implicit Association** (`module_collection`): 3 paradigmas:
  - **Attribute Testing** (Implicit Priming Test, 2 pasos): 2-5 targets + hasta 5 criteria con `targetId`. Step 1 = practica de targets. Step 2 = criteria como estimulo, respuesta correcta = target asignado. Hide criteria toggle, test-title interno.
  - **Comparing Attribute** (Reaction Time Test, 1 paso): 1-5 objects + 2 dimensions + hasta 15 criteria. Botones = dimension labels. Solo RT.
  - **Objects Comparing** (IAT clasico, 3 pasos): 2-7 targets + criteria-1/criteria-2 + hasta 15 criteria items. Clasificacion en 3 pasos.
  - Features: targets dinamicos, preview modal, flowchart reactivo, multi-lang instrucciones (EN/ES JSON).
- **Eye Tracking** (`single_module`): stimuli (imagenes/video), modalidades Stand Alone y Shelf. Incluye Emotion Recognition y prediccion de atencion.
- **Rendering generico**: `ResearchBuilderPage` usa `module_collection` generalizada — todo lo que no sea Smart VOC usa `CognitiveTaskModuleCard`.
- **Attention Prediction**: research type sin stages. Flujo AOI-first: upload → AOI Editor (zonas manuales) → criterio (`settings.attentionPrompt`) → predict TranSalNet (`POST /predict`, sincrono) → analyze IA (manual, fire-and-forget + polling). Heatmap visual = `stimulus.heatmapData` (no sintetizado desde autoAois). AOIs editables (nombre, move, resize) en `stimulus.aois[]`. Gate D-07: ≥1 AOI o `aoiSkipped`. **Video**: frames client-side → `POST /video-predict` + SSE → heatmap acumulado. Ver `docs/prediccion-plan.md`.
- **Insights Finding**: research type sin stages. Documentos (.csv, .txt, .xlsx, .docx, .pdf) -> parseo client-side -> GPT-4o analysis (sentiment/themes/keywords). Fire-and-forget + polling.
- **`isFileBasedResearch`**: unifica Attention Prediction e Insights Finding (`skip_default_modules: true`).
- **Custom Screening Questions**: preguntas de seleccion unica con descalificacion dentro de Demographics. Keys `customQuestion_<id>`, `questionLabel` editable.
- **Condicionalidad**: 3 tipos — demografica (`DemographicConditionality`), pregunta del estudio (`ModuleConditionality`), link con modulo (`LinkedModuleConditionality`). Evaluacion recursiva con proteccion anti-loop.
- **Duplicate research**: `POST /research/:id/duplicate` clona estudio completo como draft. Remap conditionality y media.

## Tech Stack
- **Backend:** Node.js + TypeScript, Express 5, MySQL (mysql2), JWT + Google OAuth, AWS SDK (S3 media, Cognito legacy), Passenger (cPanel)
- **Research Frontend:** React 19, Vite, TypeScript, Zustand, React Query, Tailwind CSS, React Hook Form + Zod, i18n (ES/EN)
- **Participant Frontend:** React 19, Vite, TypeScript, Zustand, React Query, Tailwind CSS, Recharts, i18n (ES/EN)
- **Infra:** cPanel (emotio.cx), MySQL (emotvehe_emotiox), GitHub Actions CI/CD
- **Monorepo:** root package.json con Husky pre-commit hooks

## Architecture
```
emotioxV3/
├── backend/              # Express API, Passenger entry (server-cpanel.js)
│   ├── src/
│   │   ├── router.ts         # Normaliza paths API Gateway/Express, CORS, dispatch
│   │   ├── server.ts         # Dev entry (localhost:3000)
│   │   ├── server-cpanel.ts  # cPanel/Passenger entry
│   │   ├── handler.ts        # AWS Lambda entry (legacy)
│   │   └── modules/          # auth, research, stages, modules, responses, analytics, media, monitor, cache, config, quotas
│   └── server-cpanel.js      # Passenger startup wrapper
├── research-frontend/    # Herramienta del investigador (dashboard, builder, config, results)
├── participant-frontend/  # Interfaz del participante (survey flow, steps, thank you)
├── database/             # Migraciones MySQL (20 archivos)
└── scripts/              # Deploy scripts, migraciones, utilidades
```
- **Estado:** Zustand + localStorage persistence + React Query (server state)
- **Auth:** JWT en Zustand store con axios interceptor, Google OAuth
- **Media:** Presigned S3 URLs (dev) o filesystem local (cPanel)
- **Real-time:** SSE para SmartVOC analytics (`/monitor/events/:researchId`)
- **Data:** JSONB para configs flexibles de modulos

## Development
```bash
cd backend && npm install && npm run dev          # tsx watch -> localhost:3000
cd research-frontend && npm install && npm run dev # Vite -> localhost:5173
cd participant-frontend && npm install && npm run dev # Vite -> localhost:5174
```
- **No hay backend local** — ambos frontends apuntan a `https://emotio.cx/api` incluso en dev
- Backend usa `backend/.env` (symlink en root)
- Frontends usan `public/runtime-config.json` para API URL
- Pre-commit: build + type-check + lint (Husky, no skip)

## Conventions
- **Antes de escribir o modificar cualquier componente React**, consultar reglas en `.claude/skills/react-best-practices/references/rules/`
- **No definir componentes React inline** dentro de switch/case o renders — extraer como componentes standalone
- **URLs de media del backend son relativas** (`/api/media/...`) — frontends usan `resolveMediaUrl()` para absolutas
- **ComponentType union** en `moduleBuilder.types.ts` debe incluir todos los tipos del seed/BD
- El save de modulos usa el **toggle Hide explicito** del investigador, NO auto-calcula hidden
- **Condicionalidad de modulos**: union `ConditionalityConfig`, type guards `isDemographicCondition()` / `isModuleCondition()` en `moduleRequired.ts`
- **Cuotas demograficas**: siempre porcentaje (%), aplicacion inmediata. Techo = `ceil(% x participantLimit / 100)`. `validateDemographics` -> `tryIncrementQuota`. `saveParticipantResponses` no incrementa cuotas.
- **Bloqueo de participantes** 3 capas: (1) `checkQuotaPreAvailability` al cargar, (2) `validateDemographics` al enviar, (3) `saveParticipantResponses` al guardar (410). Frontend: `MobileRestrictionScreen`.
- TypeScript strict en los 3 subproyectos. 0 errors, 0 warnings (enforced por pre-commit).
- `Record<string, any>` solo donde genuinamente dinamico, marcado con eslint-disable
- Commits en ingles, codigo en ingles, comentarios mixto. Branching: main (produccion).
- **Backlink redirects**: reemplazan `@id` con participant ID, agregan `https://` si falta.
- **CES scale**: participant lee `comp.value` primero, fallback `selectRange.predefined`. Pregunta "Que tan facil fue?" — score alto = facil = positivo (verde), score bajo = dificil = negativo (rojo). Zones: escala 1-5 -> positive [4,5], neutral [3,3], negative [1,2]. Solo CES, no CV ni Linear Scale.
- **NEV emociones**: 20 canonicas. "Descontento" = negativa. Fila 1 = positivas (7), Fila 2 = atencion (5), Fila 3 = negativas (8).
- **CES analytics dinamico**: backend envia `scaleConfigs`, frontend usa `getCESZones(scaleMax)`.
- **View Progress**: `getVisibleModuleIdsForProgress` con INNER JOIN stages. `panelStatus = 'responded'` -> 100%. Sin completar -> cap 99%. Filtro de progreso minimo (slider 0-100%).
- **Response saving**: `saveParticipantResponses` usa batch INSERT (1 query para N responses). Sin SELECTs post-INSERT. Sentiment se computa antes de abrir transaccion.
- **Analytics caching**: `getResearchConfiguration` (60s), `getParticipantCount` (10s), `getMediaUrlByS3Key` (5min client-side). Results wrappers usan `useResearch()` (React Query dedup).
- **DB pool**: `connectionLimit: 20`. MySQL `max_user_connections = 50` (limite de hosting). Indice compuesto `idx_responses_research_module_component`.
- **`/cognitive-tasks` payload**: modulos con endpoint propio (Nav Flow, Preference, Choice, Scale, Ranking) retornan solo COUNT — no responses completas. Short/Long Text si traen `value` + sentiment.
- **Study Logo**: `config.studyLogo: { enabled, s3Key? }`. Client logo o EmotioCX default.
- **Loading states**: skeleton (`animate-pulse`), nunca spinners.
- **Design system**: spec en `docs/design-system/emotiox-palette.md`. Light-only: surface-app `#F1F5F9`, accent `#006AFF`, heading slate-900, body slate-500. Font: Plus Jakarta Sans (research), Inter (participant).
- **Screener ordering**: special step. Orden fijo: `welcome -> screener -> demographics -> resto -> thank-you`.
- **Draft persistence**: `useModuleDraftStore` (Zustand, session-scoped). `PendingDraftsDropdown` en header.
- **Eye Tracking hibrido**: BlazeGaze + One-Euro filter + IDW + I-DT fixation detection. 9-point calibracion, validacion RMSE. Mobile: tap proxy. IDs canonicos: 10 componentes en template (migracion 020).
- **Eye Tracking AOI**: Stand Alone: `AOIDrawer` dibuja rectangulos sobre stimulus. Shelf: AOIs auto-generadas (1 por columna, 100% altura). Backend lee `aois` para intersecciones.
- **Eye Tracking Shelf mode**: Auto-detectado cuando >1 imagen subida. Column-based grid. `ShelfGrid` componente reutilizable (participant). `display-mode` se sincroniza automaticamente. `randomize-stimuli` baraja orden de columnas por participante.
- **Ciudades en Country & City**: `demographics.country.cities` + `demographics.city`. Cuotas por ciudad (countryCity) o por pais (countryOnly), nunca ambos.
- **NavigationFlow**: `<img>` directo (no LazyImage). Hitzones px -> %. Triple handler con dedupe 150ms. Completion overlay con "Tap to continue". `key={module.id}` fuerza re-mount.
- **Configurable language switcher**: `linkConfig.allowLanguageSwitch` (default false).
- **Research collaborators**: `research_collaborators` table. `buildOwnershipClause` includes collaborator access. Endpoints: `GET/POST/DELETE /research/:id/collaborators`. `ShareResearchDrawer` in builder sidebar.
- **Passenger dual entry points**: `server-cpanel.js` (JS, Passenger entry) and `src/server-cpanel.ts` (TS, compiled to `dist/`). New Express routes must be added to **both** files.

- **Sentiment Score (v0.74.0)**: `((positive - negative) / (positive + negative)) * 100`. Range -100 to +100. Neutrals/indeterminate excluded from denominator.
- **Multi-column CSV (v0.74.0)**: `CsvColumnSelector` supports multi-select checkboxes. Each column creates a `FileItem` with `mediaId__colN` suffix. Sidebar shows each as separate tab.
- **Insights Finding PDF (v0.74.0)**: `window.open` + `window.print()` — no `html2pdf.js` (causes blank pages). Includes Sentiment Score metric.
- **CustomSelect disabled options (v0.74.0)**: `SelectOption.disabled` renders gray, `cursor-not-allowed`, non-clickable.
- **Research page filters (v0.74.0)**: Two `CustomSelect` dropdowns — techniques + research types. Both fetch all from system; options without researches disabled.
- **Heatmap backdrop priority (v0.74.1)**: snapshot-html (DOM captured by snippet with JS-rendered styles) > proxy-page (live HTML, scripts stripped) > screenshot (static image). `hasSnapshot` prop controls selection.
- **Proxy CSS (v0.74.1)**: `proxy-page` rewrites `<link rel="stylesheet">` through `/proxy-asset`. Text assets served as plain text, binary as base64.
- **Idle session filter (v0.74.1)**: `getVisitorJourneys` excludes visits with 0 events. `getOverviewMetrics` uses `INNER JOIN` on events.
- **Insights themes client-side (v0.74.2)**: Expanded themes show ALL matching entries via client-side word matching (not LLM `supportingQuotes`). Count/percentage from real data. Scrollable `max-h-240px`.
- **Sentiment Score tooltip (v0.74.2)**: `SentimentScoreBadge` component with `createPortal` tooltip. Instant on hover, shows formula + breakdown.
- **Re-analyze (v0.74.2)**: Button in Insights Finding header re-triggers LLM analysis without re-uploading.
- **Prompt presets (v0.75.0)**: `localStorage` key `emotiox-prompt-presets` (analysis) and `emotiox-heatmap-presets` (heatmap settings). Named presets shared across all studies. *(v0.77: criterio usa `emotiox-criteria-presets`.)*
- **Bulk analysis (v0.75.0, removed v0.77)**: ~~Auto-queue on mount~~ — reemplazado por flujo manual AOI-first.
- **AOI Editor backdrop (v0.75.2)**: Shows `HeatmapRenderer` with enforced minimum visibility (blur≥10, opacity≥40, threshold≤20). Auto-detected AOIs as 2px dashed rects with solid-color labels.
- **Gaze Paths sub-tabs (v0.75.0)**: `gazeMode` state toggles "Routes" (static) vs "Scanpath" (animated). `max-height: 60vh`.
- **File-based status labels (v0.75.0)**: Sidebar shows Prediction/Analysis/Tracking instead of Draft. Non-clickable `<span>` vs `<button>`.
- **Snippet v3.5 DOM snapshot (v0.75.1)**: Captures `outerHTML` 3s after session, sends to `/public/tracking/:id/snapshot`. 30s hidden → fresh session. Enables snapshot-html heatmap backdrop.
- **Proxy CSS pipeline (v0.75.1)**: proxy-asset rewrites `url()`/`@import` inside CSS. Proxy URLs must be absolute (not relative `/api/...`) because `<base>` tag points to tracked site. Protocol-relative `//` handled. `media="none"` → `media="all"` for lazy-loaded stylesheets.
- **Video Attention Prediction (v0.85.0)**: Server-side DINO ViT-B/16 render via Python subprocess (`render_cli.py`). Output: side-by-side WebM (original | JET heatmap + 3×3 grid Q-labels). `VIDEO_SALIENCY_BACKEND=dino` in `.env`. Node spawns Python directly (no HTTP/uvicorn). Auto-downscale >640px, `sample_interval_s=2.0` (keyframes only), VP8/WebM codec. Frontend: `<video autoPlay loop muted>` when `stimulus.heatmapVideoUrl` exists. Legacy `VideoThermalGrid` fallback for old data. Upload from Colab: `POST /api/attention-prediction/upload-heatmap-video`.
- **Attention Prediction AOI-first (v0.77.0)**: No auto-analyze on upload/mount. `AoiRectEditor` + criterio drawer. `predictAttention()` wired for images. Backend analyze receives manual AOIs. Heatmap from TranSalNet only; AI zones as optional dashed overlay.
- **Attention Prediction live AOIs (v0.77.1)**: `onAoiListChange` + `liveAois` en View — panel IA y header del card comparten la misma lista en memoria al analizar.
- **Attention Prediction manual AOI predict (v0.78.0)**: `POST /predict` recibe AOIs; hybrid saliency aplica boost semántico + espacial en zonas del investigador.
- **Attention Prediction Precise + visor unificado (v0.79.0)**: Extracción granular NMS en backend. Visor único con capas (tabs = presets). Viewport flex + `ResizeObserver` — sin scroll por alturas `100vh` apiladas. `HeatmapRenderer` precise/smooth. `reconcileAutoAoisWithManual`. `stimulusImageCache.ts`.
- **Attention Prediction heatmap modes (v0.80.0)**: `Classic | Spotlight | Cold` en Heatmap tab. Lab preset default. `SpotlightRenderer`, `ColdMapRenderer`, `VideoAccumulatedHeatmapOverlay`. NMS 72 pts. Spec: `docs/attention-prediction-heatmap-viz-spec.md`.
- **Attention Prediction feedback emotiox (v0.81.0)**: P1–P9 del PDF `docs/emotiox.pdf` — AOI-first refinado, scanpath, vista compuesta, criterio nombrado, wizard en panel IA, guards teclado AOIs, `persistStimuli`/`handleSavePrompt` con settings frescos. 44 tests FE.
- **Attention Prediction refinements (v0.81.1)**: NMS denso (200 pts, `gridCols` 64). Scanpath como capa inline (`GazeScanpathPlayer` `transparent`). Controles contextuales por tab. Panel IA en español. `reconcileAutoAoisWithManual` simplificado (sin ocultamiento IoU). `recharts` en `react-vendor` chunk.
- **Attention Prediction refactor (v0.81.2)**: `AttentionPredictionCard` descompuesto en `HeatmapSettingsModal`, `VideoFrameScrubber`, `StimulusOverlayFrame`, `MapModeControlBar`. NMS ultra-denso (500 pts, `gridCols` 100). Legacy threshold 600. Prompt IA forzado a español. Tests Website Tracking actualizados.
- **Attention Prediction product context (v0.82.0)**: Contexto `product_isolated` en `AnalysisProfile`. NMS selectivo por contexto (`getExtractOptions`). Whitespace agresivo para producto (`getTextureThresholds`). `modulateIntensityByAoiProximity` post-NMS (Chebyshev + Gaussian falloff). `useViewportHeight` hook reactivo. Auto-switch tab post-predict. Badge "Recalcular con zonas actuales". `estimateExposureTime` en tooltip AOI. 36 tests.
- **Video grid AOIs + timeline (v0.83.0)**: Grid presets (3×3, 5×5, 10×10) generan `ManualAOI[]` con `source: 'imported-grid'`. Backend `predictVideoFrames` acepta `gridConfig` (2-10 cols/rows, default 4×4) y `aoiTimeRanges` para filtrado temporal per-AOI. `AoiTimelineBar` con handles draggables start/end, snap a frames. `preprocessSharp` fix para Safari Canvas PNGs (flatten + sRGB fallback). 44 tests.
- **Video thermal heatmap (v0.84.0→v0.85.0)**: Replaced browser-side IDW/thermal/canvas pipeline with server-side DINO render. See v0.85.0 above. Legacy `VideoThermalGrid` kept as fallback for pre-v0.85 data.
- **Warm heatmap gradient restored (v0.84.2)**: `HeatmapRenderer` gradients reverted to green→yellow→orange→red. Applies to images only — videos use server-rendered WebM.
- **Video AI analysis (v0.85.1)**: Video stimuli now support AI analysis. Backend extracts midpoint frame via ffmpeg (`extractVideoFrame`) before sending to Gemini/OpenAI. Frontend gates (`canRunAnalysisGate`, `hasHeatmap`) accept `heatmapVideoUrl` as valid heatmap for DINO videos. 14 tests.
- **Video per-frame render (v0.85.2→v0.85.3)**: `VIDEO_SAMPLE_INTERVAL` env var controls DINO keyframe spacing. `0.0` = every frame (fluid). `VIDEO_MAX_DIM` controls downscale limit. Both local and cPanel now use `0.0` (frame-by-frame). cPanel uses `VIDEO_MAX_DIM=480` to stay within LVE limits. `isLegacyAttentionStimulus` fixed for DINO video with AI analysis.
- **Eye Tracking V2 zone pipeline (v0.86.0)**: Zone-based attention analysis replacing coordinate-centric approach. Pipeline: `ZoneRegistry` → `ZoneClassifier` (Gaussian probabilistic) → `HysteresisEngine` (temporal stability) → `ZoneEventEmitter` (semantic events). Feature flag `EYE_TRACKING_V2_ENABLED = false` in `v2ResponseBuilder.ts`. V2 response: `zoneEvents[]` + `zoneMetrics{}` + backward-compat `fixations[]`/`zoneMass{}`. `DeviceProfile` tunes radius/hysteresis per device. `CalibrationStore` persists to localStorage (30min TTL). Backend `eye-tracking-v2.analytics.ts` dual-reads V1/V2. Test page: `/test/eye-tracking-v2`. 469 tests.

> **Feature-specific conventions** (IAT, Website Tracking, Attention Prediction, Eye Tracking, Results, Insights): see [.agent/CONVENTIONS_FEATURES.md](.agent/CONVENTIONS_FEATURES.md)

## Key Files
### Backend
- `backend/src/router.ts` — routing central, CORS, path normalization
- `backend/server-cpanel.js` — entry point produccion (Passenger)
- `backend/src/modules/enterprises/enterprises.controller.ts` — CRUD enterprises
- `backend/src/modules/participants/participants.service.ts` — CRUD participantes panel, CSV import
- `backend/src/modules/email/email.service.ts` — Nodemailer + invitation template
- `backend/src/modules/research-techniques/research-techniques.service.ts` — CRUD tecnicas con `default_stages`
- `backend/src/modules/quotas/quota.service.ts` — cuotas demograficas atomicas (`tryIncrementQuota`)
- `backend/src/modules/public/public.service.ts` — endpoints publicos, validacion, save responses
- `backend/src/modules/analytics/analytics.service.ts` — metricas SmartVOC, NEV, Eye Tracking (FACS, AOI, sequence), IAT (D-score, errors)
- `backend/src/modules/attention-prediction/attention-prediction.controller.ts` — TranSalNet prediction (research stimuli + module stimuli + video)
- `backend/src/modules/attention-prediction/video-prediction.service.ts` — Video frame-by-frame prediction, accumulation, temporal grid
- `backend/src/modules/attention-prediction/video-prediction-jobs.ts` — SSE job registry for video prediction progress
- `backend/src/modules/tracking/tracking.controller.ts` — Website Tracking public + auth endpoints
- `backend/src/modules/tracking/tracking.service.ts` — sessions, events batch insert, heatmap aggregation
- `backend/src/modules/tracking/tracking-snippet.ts` — injectable JS generator
- `backend/src/modules/research/research-in-progress.service.ts` — progreso participantes

### Research Frontend
- `research-frontend/src/pages/research/ResearchBuilderPage.tsx` — builder principal, module_collection generalizada
- `research-frontend/src/components/layout/ResearchBuilderSidebar.tsx` — sidebar con status modal, stage management
- `research-frontend/src/components/research/ResearchConfigurationModule.tsx` — config, QR, URL, demografia, study logo, screening questions
- `research-frontend/src/stores/useModuleDraftStore.ts` — draft store session-scoped
- `research-frontend/src/components/research/PendingDraftsDropdown.tsx` — save individual/all drafts
- `research-frontend/src/utils/demographicsMapper.ts` — mapeo demografia + LocationGranularity
- `research-frontend/src/utils/moduleRequired.ts` — flags modulo, ConditionalityConfig, type guards
- `research-frontend/src/components/research/ConditionalityModal.tsx` — modal condicionalidad (demografica + study question)
- `research-frontend/src/components/research/AOIDrawer.tsx` — AOI drawing sobre imagenes
- `research-frontend/src/components/results/smart-voc/SmartVOCResults.tsx` — panel SmartVOC completo
- `research-frontend/src/components/research/AttentionPredictionCard.tsx` — analisis por stimulus (heatmap, video, AOI)
- `research-frontend/src/components/research/WebsiteTrackingConfig.tsx` — tracking config panel (snippet, domains, toggles)
- `research-frontend/src/components/results/website-tracking/WebsiteTrackingResults.tsx` — click heatmap + overview
- `research-frontend/src/services/tracking.service.ts` — API client for tracking endpoints
- `research-frontend/src/hooks/useResearchForm.ts` — form creacion con prioridad default_stages

### Participant Frontend
- `participant-frontend/src/pages/ResearchPage.tsx` — flujo encuesta (kiosk reset, screener blocking, demographics validation)
- `participant-frontend/src/utils/researchPageHelpers.ts` — utilidades extraidas de ResearchPage
- `participant-frontend/src/hooks/usePreviewMode.ts` — preview vs participant vs kiosk
- `participant-frontend/src/hooks/useNavigation.ts` — navegacion, condiciones, filtro steps
- `participant-frontend/src/hooks/useBlazeGaze.ts` — BlazeGaze CNN + One-Euro filter
- `participant-frontend/src/components/steps/DemographicsStep.tsx` — paso demografico (3 formatos + custom screening)
- `participant-frontend/src/components/ui/NavigationFlow.tsx` — flujo fullscreen hitzones
- `participant-frontend/src/components/ui/CustomSelect.tsx` — selector custom, position:fixed, auto-flip
- `participant-frontend/src/components/renderers/ImplicitAssociationRenderer.tsx` — IAT 3 paradigmas
- `participant-frontend/src/components/renderers/EyeTrackingRenderer.tsx` — BlazeGaze desktop, click proxy mobile, face-api.js emotion recognition, video stimulus
- `participant-frontend/src/hooks/useFaceApiEmotions.ts` — face-api.js TinyFaceDetector + FaceExpressionNet for 7 Ekman emotions
- `participant-frontend/src/lib/eyeTracking/facsClassifier.ts` — EmotionSample types + aggregation utilities
- `participant-frontend/src/components/ErrorBoundary.tsx` — error boundary para produccion

## Deploy
- **Referencia completa:** [Deploy Skill](skills/deploy.md)
- **NO usar:** aws-runbook.md, git-deploy.md, server-runbook.md — este proyecto se despliega en cPanel
- **SSH:** `ssh cpanel-emotio` — credenciales en `.env.claude`

### Deploy manual (scripts locales)
```bash
./scripts/deploy-backend-cpanel.sh              # rsync src -> remoto, npm install + build en remoto
./scripts/deploy-research-frontend-cpanel.sh    # build local, rsync dist/ -> ~/public_html/research/
./scripts/deploy-participant-frontend-cpanel.sh # build local, rsync dist/ -> ~/public_html/participant/
```
Post-deploy backend: `ssh cpanel-emotio "cd ~/emotioxv3/backend && touch tmp/restart.txt"`
- **ONNX model:** `backend/models/transalnet_res.onnx` (290MB) is gitignored. Deploy script auto-syncs it if missing on server. CI/CD excludes `models/` from rsync `--delete`.

### CI/CD (GitHub Actions, auto en push a main)
- `deploy-backend-cpanel.yml` — trigger: `backend/**`
- `deploy-research-frontend-cpanel.yml` — trigger: `research-frontend/**`
- `deploy-participant-frontend-cpanel.yml` — trigger: `participant-frontend/**`
- Secrets: `CPANEL_SSH_PRIVATE_KEY`, `CPANEL_SSH_HOST`, `CPANEL_SSH_USER`, `CPANEL_SSH_PORT`

### Rutas remotas
```
~/emotioxv3/backend/          -> Backend (src + dist + .env + server-cpanel.js)
~/public_html/research/       -> Research Frontend (Vite dist + runtime-config.json + .htaccess)
~/public_html/participant/    -> Participant Frontend (Vite dist + runtime-config.json + .htaccess)
```

## Participation Modes (Kiosko vs Panel)
- **Kiosko**: SmartVOC, ID `kiosk-N`, reset automatico. **Panel**: Cognitive Tasks, ID externo/individual.
- `researches.config.participationMode`: `'kiosk' | 'panel'` (default: `'panel'`)
- Endpoints publicos: `GET /public/research/:id/mode`, `POST /public/research/:id/kiosk/session`
- Endpoints panel: `GET/DELETE /participants/:researchId`, `POST .../import`, email bulk/individual
- `usePreviewMode` distingue preview (`?preview=true`), panel (`?participantId=xxx`), kiosk (sin params)

## Website Tracking (v0.73.0)
- **Research type:** "Website Tracking" (`skip_default_modules: true`, file-based). No stages, no participant-frontend.
- **Injectable script v3.2:** `GET /public/tracking/:id/script.js` — rrweb DOM recording + clicks/scroll/mousemove heatmaps. Buffer cap 50 events, flush every 2s. Domain validation client + server.
- **DOM recording (rrweb):** Full DOM snapshot + incremental mutations + CSS/fonts/images. Events in `tracking_sessions.rrweb_events` (LONGTEXT).
- **SPA support:** Intercepts `pushState`/`replaceState`/`popstate`. 1s debounce.
- **Friction detection:** dead-click, rage-click (3+ in 1s), speed-browsing (<2s), mouse-out.
- **Config:** `captureClicks`, `captureScroll`, `captureMousemove`, `consentRequired`, `samplingRate`, `excludedIPs`, `targetPages`/`excludePages`, `dataRetentionDays`, `allowedDomains`, `verified`, `funnels[]`.
- **Results tabs:** Funnels (SVG + Page Flow + Comparison) -> Heatmaps (Click/Scroll/Attention) -> Sessions (friendly names) -> Live (SSE).
- **Session replay (rrweb):** `SessionReplayPlayer` lazy-loads rrweb `Replayer`. DOM-based replay with mouse trail, play/pause/seek, speed controls.
- **Detection:** `isWebsiteTracking` in `isFileBasedResearch`. Sidebar shows config + results.

> **Detailed Website Tracking conventions**: see [.agent/CONVENTIONS_FEATURES.md](.agent/CONVENTIONS_FEATURES.md#website-tracking-inline-conventions)

## Eye Tracking (v0.58.0)
Summary: BlazeGaze CNN + One-Euro filter + IDW calibration. 9-point calibration, RMSE validation. face-api.js emotion recognition. Stand Alone + Shelf modes. Results: Heatmap, Scan Path, First Look, Transparency, Emotions, Prediction, Video Gaze, Sequence. AOI metrics with soft Gaussian intersection. Quality gate (good/fair/low). Micro-recalibration every 45s.

> **Detailed Eye Tracking conventions**: see [.agent/CONVENTIONS_FEATURES.md](.agent/CONVENTIONS_FEATURES.md#eye-tracking)

## Implicit Association Analytics (v0.65.1)
Summary: Greenwald D-score, per-participant + aggregate (95% CI). Error analysis per-phase and per-combination. Effect size histogram. Demographic filters. Module filter by paradigm name. Trial phases include `block-1/2/3`.

> **Detailed IAT conventions**: see [.agent/CONVENTIONS_FEATURES.md](.agent/CONVENTIONS_FEATURES.md#iat-implicit-association)

## References
- [CHANGELOG](CHANGELOG.md) — historial completo de versiones (533+ commits)
- [BITACORA](BITACORA.md) — notas de sesiones de desarrollo
- [Patterns](patterns/) — patrones de construccion repetibles
- [Issues & Fixes](docs/ISSUES_&_FIXES.md)
- [Plan Modos de Participacion](docs/PLAN_PARTICIPATION_MODES.md)
- [.agent/](/.agent/) — 7 docs de referencia (API, flujos, decisiones tecnicas, glossary, quick ref, module rules, feature conventions)
