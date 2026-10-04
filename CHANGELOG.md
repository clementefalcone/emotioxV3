## v0.97.5 — Security: study access in every module (2026-10-04)

### refactor(research): one study access guard
- `research/research-access.ts` holds the study access rule for every controller: `canAccessResearch` (creator or collaborator; admin/viewer see all), `findResearchIdOf` (resolves the owning study of a child resource from a fixed table dictionary), `isStageOfResearch` and `researchNotFound` (404 + `research_access_denied` JSON log). Analytics now uses it instead of its own copy.

### fix(security): any user could read, wipe or email another study's panel
- **Root cause.** `/participants/:researchId/...` only required a session: any user could list another study's panel (emails, names), import or delete participants, and send invitation emails to that panel with a caller-chosen `baseUrl` (phishing).
- **Fix.** One guard at the top of the controller applies the study access rule to the study id in the path; services already filter by `research_id`, so participant-level routes are covered too.
- **Tests.** `participants.controller.test.ts`: list, delete all, delete one, import, send all and send one on a foreign study → 404 with no service call; owner lists their panel.

### fix(security): remove the unused questions API
- **Why.** `/questions` (create, update, delete, reorder) only required a session, so any user could write questions into another study's modules. The feature was never used: the `questions` table has 0 rows in production and no frontend component calls `questionsService`.
- **Change.** Removed the backend `questions` controller and service, its router entry and its entry in `/config` endpoints, and the unused frontend `questions.service.ts`. The empty table is left untouched.

### fix(security): any user could edit or delete another study's modules
- **Root cause.** `/modules` (create, update, delete, reorder) only required a session; the service filtered by module id alone, and `create` accepted a `stage_id` from any study.
- **Fix.** Every route resolves the owning study (path id, `research_id` body field, or the module's `research_id`) and applies the study access guard; `stage_id` must belong to the same study (400). Unknown module → 404 `Module <id> not found`.
- **Tests.** `modules.controller.test.ts`: foreign delete/edit/reorder/create → 404 with no service call; foreign stage → 400; missing module → 404; owner can edit and delete.

## v0.97.4 — Security: unauthenticated write endpoints (2026-10-04)

### fix(security): anyone could flush the cache
- **Root cause.** `/cache/stats`, `DELETE /cache/clear` and `DELETE /cache/pattern` had no authentication (`router.ts` notes "admin only - add auth check as needed"); `pattern` is compiled as a caller-supplied regex.
- **Fix.** All cache routes require a session and the `admin` role (401 / 403, logged as `cache_admin_required`). Only test scripts use them and they already send a token.
- **Tests.** `cache.controller.test.ts`: no session → 401, researcher → 403, admin clears.

### fix(security): tracking snapshots could run scripts in the researcher's session (stored XSS)
- **Root cause.** `POST /public/tracking/:id/snapshot` is unauthenticated (it keeps the first snapshot per page). Snapshots, and `proxy-page` HTML from external sites, were shown in iframes on the app's own origin: `PageSnapshotHeatmap` with `sandbox="allow-same-origin allow-scripts"` (which cancels the sandbox) and `MultiLayerHeatmap` with no sandbox. Only `<script>` tags were stripped, so handlers like `onerror=` ran with the researcher's session.
- **Fix.** Both iframes use `sandbox="allow-same-origin"` (the parent still reads the DOM to draw the heatmap; nothing inside can execute). `snapshot-html` and `proxy-page` responses send `Content-Security-Policy: script-src 'none'` for direct opens.
- **Tests.** Backend: `snapshot-html` serves the CSP header for a snapshot containing `onerror`. Frontend: `PageSnapshotHeatmap.test.tsx` asserts the iframe sandbox has no `allow-scripts` (fails on the old value).

### fix(security): tracking proxies could reach the server's private network (SSRF)
- **Root cause.** `GET /public/tracking/:id/proxy-asset` (no auth), `/tracking/:id/proxy-asset` and `/tracking/:id/proxy-page` fetched any `url` with `redirect: 'follow'`, so a caller could make the server request `localhost` services, the private network or cloud metadata (`169.254.169.254`) and read the response.
- **Fix.** `fetchPublicUrl` (`public-fetch.ts`) allows only `http`/`https`, resolves DNS and rejects loopback, private, link-local, CGNAT, multicast and IPv6 local addresses (including IPv4-mapped IPv6 in dotted and hex form), and follows up to 5 redirects manually, validating every hop. Blocked URLs answer 400 with the reason. CDN assets keep working because only private targets are refused. Known ceiling: DNS rebinding between the check and the connection; pinning the resolved IP would close it.
- **Tests.** `public-fetch.test.ts`: 10 private/invalid targets blocked, public address allowed, redirect into the private network refused, public redirect chain followed.

### fix(security): anyone could upload files to any study
- **Root cause.** `PUT /api/media/upload-direct` (defined directly in the Passenger entry, outside the authenticated router) accepted `research_id` and `media_path` from anyone, so files could be written over any study's stimuli or uploaded as HTML/SVG served from the API origin. The unused multipart `POST` variant had the same gap. `upload-heatmap-video` fell back to the secret hard-coded in the repo, which is the active one in production because `HEATMAP_UPLOAD_SECRET` is not set.
- **Fix.** The authenticated `POST /media/upload` now returns an S3-style signed URL: HMAC-SHA256 (keyed by `JWT_SECRET`) over research id, media path and a 1 h expiry. `upload-direct` rejects missing, tampered or expired signatures with 403 and logs `media_upload_rejected`. The multipart `POST` is removed. The heatmap upload has no fallback secret: without `HEATMAP_UPLOAD_SECRET` it is closed. The frontend is unchanged (it already PUTs to the returned URL). Both entry points (`server-cpanel.js`, `server-cpanel.ts`) updated.
- **Tests.** `uploadSignature.test.ts`: the issued URL is accepted; missing signature, another study, another path and an expired URL are rejected.

## v0.97.3 — Security: public registration (2026-10-04)

### fix(security): any researcher could manage users and grant themselves admin
- **Root cause.** `/users` (list, get, create, update, delete) only blocked viewers from writing. Any researcher could `PUT /users/<own id> {role:'admin'}`, change another user's email, create admins or delete users, and list every user's email. `role` was written without validation.
- **Fix.** Those routes now require `admin` (403 `Admin role required`, logged as `users_admin_required`). `role` must be `admin`, `researcher` or `viewer` (400). Researchers keep `/users/invite` and `/users/viewers`, which the share flow uses.
- **Tests.** `users.controller.test.ts`: researcher cannot promote themselves or list users, can still list viewers; invalid role → 400; admin can change a role.

### fix(security): public registration could create admins and take over accounts
- **Root cause.** `POST /auth/register` (no auth) passed the request body straight to `register`, which accepted `role`, so anyone could create an `admin`. For an existing email without a readable `password_hash` (Google users, or any user whose `metadata` came back as a JSON string), it set the caller's password on that account — an account takeover.
- **Fix.** The public route only forwards `email`, `password`, `firstName`, `lastName`, so it always creates a `researcher` (the same role Google sign-in already grants). `register` answers 409 `User <email> already exists` for any existing email and never modifies it. Role assignment stays internal for `POST /users`.
- **Production check (read-only).** The only admin is the owner's Google account; the 14 local-password accounts are test accounts, all `researcher`.
- **Tests.** `register.test.ts`: a caller-sent `role: admin` still inserts `researcher`; an existing email returns 409 with no further query.

## v0.97.2 — Enterprise SmartVOC access control (2026-10-04)

### fix(security): study analytics readable by any authenticated user
- **Root cause.** The 22 routes under `/analytics/research/:id/...` and `/analytics/benchmark/:id` only required a valid session. Any user who knew a study id could read its SmartVOC, Eye Tracking, IAT, text responses, demographics, alerts and executive summary, and trigger text analysis or dismiss alerts.
- **Fix.** One guard at the top of `handleAnalyticsRoutes` matches the study id in the path and checks it with `buildOwnershipClause` (creator or collaborator; admin/viewer see all), the same rule as the study list. Denied requests return 404 (`Research <id> not found`, without revealing whether it exists) and log `analytics_access_denied` as JSON.
- **Tests.** Foreign study → 404 with no results read and a structured log; own study → 200; benchmark guarded too.

### fix(security): enterprise SmartVOC ignored study ownership
- **Root cause.** `GET /analytics/enterprise/:id/smartvoc` filtered only by `enterprise_id`, so any authenticated user could consolidate the SmartVOC results of every study of any enterprise, including studies they neither created nor collaborate on.
- **Fix.** The route applies `buildOwnershipClause` (creator or collaborator; admin/viewer see all) on top of the enterprise filter, the same rule as `/analytics/smartvoc/consolidated`. Both now share `buildUserOwnership`.
- **Verified on production data (read-only).** In an enterprise with 4 studies by 2 creators, a researcher went from 4 visible studies to their 3.
- **Tests.** New `analytics.controller.test.ts`: researcher query is scoped by enterprise and ownership; admin sees the whole enterprise.

## v0.97.1 — Zero lint warnings (2026-10-04)

### chore(research): remove lint warnings
- `ViewModeTab` drops the unused `icon` prop (and its 10 call sites in `StimulusCard`); unused icon imports removed.
- `ExecutiveSummaryPanel` print callback no longer lists `researchId`; `PreferenceTestResultsWrapper` drops an unused `eslint-disable`.
- `DashboardPage` trends: the `useMemo`s depended on arrays rebuilt every render, so they never memoized; replaced by a plain `monthOverMonthTrend`.

### refactor(participant): Enter to continue declares what it reads
- **Correction.** v0.97.1 first described this as a bug ("Enter could stay blocked after answering"). An integration test proved otherwise: the old effect read `buttonDisabled` without listing it, but answering also changes `goNext` (it depends on `validateStep` and `steps`), which changes `handleNext` and re-registered the listener. It worked by coincidence, not by declaration.
- **Change.** `useEnterToContinue(canContinue, onContinue)` receives the current state each render, so it no longer depends on that coincidence. Textareas keep Enter for new lines.
- **Tests.** Hook: Enter continues once allowed; Enter inside a textarea does not continue. `ResearchPage.enterKey.test.tsx` mounts the real page (preview, two Short Text questions, real participant store): Enter does nothing before answering and moves to the next question right after answering. It passes on both the old and the new page, documenting that behavior was already correct.

### chore(participant): remove unused props and variables
- `CalibrationPhase` no longer takes `resolvedUrl`, `imgRef`, `onImageLoad`, `shelfConfig`; `SessionQualityGate` no longer takes `earRef`, `frameStatsGetter` (received but never read). Removed an unused import and variable in gaze tests.
- `microExpressionDetector` multi-transient test now asserts both `joy` and `anger` are detected instead of only `length >= 1`.

## v0.97.0 — Website Tracking: visible capture failures (2026-10-04)

### feat: Website Tracking records camera and model failures per session
- **Why.** Camera permission denials, missing cameras and MediaPipe / face-api load failures were swallowed by the script, so a session without emotions or gaze was indistinguishable from a visitor who simply had no face data.
- **Script.** `reportCaptureError(kind)` posts the failure for the current session: `camera-denied` (`NotAllowedError`, no resolution retry), `camera-unavailable` (all resolutions failed or no `mediaDevices`), `mediapipe-failed`, `face-models-failed`. Callback errors are not reported as load failures.
- **Backend.** `POST /public/tracking/:id/capture-error` validates the kind against the `capture-errors.ts` dictionary (400), checks the session belongs to the research (404), logs `tracking_capture_error` as JSON and appends the kind to `tracking_sessions.capture_errors` atomically (`CONCAT_WS` + `FIND_IN_SET`, no duplicates). `getVisitorJourneys` returns `captureErrors` per page.
- **Migration.** `035_add_capture_errors_to_tracking_sessions.sql` — nullable `VARCHAR(255)`, additive.
- **Results.** Sessions tab shows an amber badge per failure on each journey page (`CaptureErrorBadges`), with a description on hover.
- **Tests.** Controller (invalid kind, foreign session, structured log), dictionary parsing, script reporting (denied without retry, unavailable after every resolution, no camera API, model failures), badges.

### feat: Website Tracking calibrated gaze on desktop
- **Why.** With `captureGaze` on, desktop visitors got no real gaze: the pipeline (MediaPipe + ridge + One-Euro + I-DT fixations + click retraining) was gated by `isMobile`, so desktop samples used the cursor position as `pageX/pageY`.
- **Change.** The `isMobile` gates are removed: desktop opens the camera at gaze resolution, shows the same 9/5-point calibration, predicts gaze, emits fixations and retrains every 5 clicks. Before or without a calibration, samples still fall back to the cursor. Backend and results already distinguish calibrated samples (`gazeQuality`), so they are unchanged. Config copy no longer says "Mobile-only".
- **Tests.** No mobile-only branch left; prediction with calibration and cursor fallback; gaze camera resolution; calibration path runs without a device check.

### test: realign 11 stale tests with current behavior
- **Why.** The suites were not green: tests had drifted from intentional changes, so real regressions were hidden among known failures.
- **Snapshot.** `POST /public/tracking/:id/snapshot` limit is 4 MB since v0.94.6; the test still asserted 2 MB.
- **Friction.** `getFrictionSummary` runs a second query for top friction elements; the mock now covers it and the test asserts `topElements`.
- **Eye Tracking analytics.** Fixations are normalized to percent since v0.93.0, the unit `AOIDrawer` stores AOIs in; tests now use percent AOIs with a real viewport. `fixations` includes low-quality participants on purpose since `b6844fa` (filtered in the frontend).
- **StimulusFullscreenModal.** The component copy is English since v0.93.0; tests looked for the old Spanish labels.
- **Result.** Backend 544/544, participant-frontend 1138/1138, research-frontend 612/612.

## v0.96.13 — Website Tracking: emotion & gaze reliability (2026-10-04)

### fix: Website Tracking emotions and gaze were rarely delivered
- **Root cause.** Unlike events (flushed every `flushIntervalMs`), `emoBuf`/`gazeBuf` were only flushed on `visibilitychange: hidden`, and gaze was not flushed on `beforeunload` at all. Both use synchronous XHR at that point, which Chrome blocks during page dismissal and iOS Safari often never fires — a visit that ended without switching tabs lost all emotion and gaze samples.
- **Fix.** The existing flush timer now also calls `flushEmotions()` and `flushGaze()`; `beforeunload` also flushes gaze. At most the last flush interval is lost.
- **Tests.** `tracking-snippet-integration.test.ts`: periodic delivery and gaze flush on unload.

### fix: Website Tracking calibration overlay could freeze over the client site
- **Root cause.** In `runCalibration`, each capture tick returned early when MediaPipe or the camera was not ready, before `fCount++`, so a point never finished. The full-screen overlay (max `z-index`, no close button) stayed over the client's site forever — e.g. when MediaPipe failed and face-api was loaded as fallback.
- **Fix.** Every tick counts; a point always ends after ~600 ms and, without enough samples, calibration closes with no gaze model. Calibration is not opened at all when MediaPipe did not load (face-api fallback has no gaze).
- **Tests.** Calibration tick always counts; no calibration without MediaPipe.

### fix: Website Tracking captured emotions when captureEmotions was disabled
- **Root cause.** `sampleFrame` runs for gaze too (mobile calibrated gaze, resumed sessions) and always computed and buffered emotions — MediaPipe FACS path and face-api fallback — regardless of `captureEmotions`, so `flushEmotions` sent data the client had not enabled.
- **Fix.** Emotions are only computed when `C.emotions` is true, in both paths.
- **Tests.** Both emotion paths are gated by `captureEmotions`.

### fix: Website Tracking opened the camera twice
- **Root cause.** `onSessionReady` calls `startEmotionCapture()` and `startGazeCapture()` in the same tick; each requested its own `getUserMedia` stream and overwrote `emoStream`/`emoVideo`, leaving the other stream orphaned with the camera on. Both paths could also start a second `sampleFrame` interval.
- **Fix.** `withCamera` opens one stream (1280×720 → 640×480 when mobile gaze is on, 320×240 otherwise), queues concurrent requests and hands every caller the same stream. `startSampling` starts the sampling interval only once.
- **Tests.** Two simultaneous requests call `getUserMedia` once and both receive the same stream.

### fix: Website Tracking mobile gaze never sampled with a stored calibration
- **Root cause.** When `startGazeCapture` found a calibration stored in the last 10 minutes it called `startGazeSampling()` and returned without opening the camera or loading MediaPipe. With emotions off, `sampleFrame` had no video and no landmarker, so a reload or a resumed session produced no gaze.
- **Fix.** The stored calibration only skips the calibration overlay; the camera and MediaPipe are always set up first.
- **Tests.** Stored calibration opens the camera and samples without recalibrating; no stored calibration calibrates; no overlay without MediaPipe.

### fix: Website Tracking kept the camera on while the visitor was away
- **Root cause.** No code path ever stopped the camera tracks. Hiding the tab paused sampling but left the camera on indefinitely, and a new session after >30 s away kept reusing that stream (on iOS Safari it can be suspended in the background and never resume).
- **Fix.** `releaseCamera` stops the tracks and removes the hidden video. It runs 30 s after the tab hides (cancelled on a brief switch) and again on return after a long absence, since background timers are throttled. The new session opens a fresh stream through `withCamera`.
- **Tests.** Release stops the tracks and the next request opens a new stream; visibility handler schedules, cancels and forces the release.

### fix: Website Tracking data landed in the wrong session or was lost
- **Root cause.** `flush` sent only `maxEventsPerFlush` events and rescheduled the rest with `setTimeout`, which read the global `sid` later: on an SPA navigation it had already switched (events attributed to the next page) and on unload it never ran (events lost). `createSession` did not flush emotions or gaze, so their buffers went out with the new session id. `flushEmoVideo` read `sid` inside the async `FileReader` callback, after `createSession` had cleared it.
- **Fix.** `flush` sends the whole buffer (the endpoint has no batch limit; `maxEventsPerFlush` still triggers an early flush). `createSession` flushes emotions and gaze before switching. `flushEmoVideo` captures the session id before reading the blob.
- **Tests.** One flush sends every event; the emotion video keeps its session after a switch; session switch flushes emotions and gaze.

---

## v0.96.12 — Eye Tracking emotions, consecutive modules, real validation (2026-10-03)

### fix: Eye Tracking emotions never recorded — broken face landmark model
- **Root cause.** `public/models/face_landmark_68_model.bin` was 55,118 bytes while its manifest declares 356,840. Since `faceLandmark68Net` was added (2026-05-03), `ensureModelsLoaded` threw on that model, `isLoaded` never became true and face-api never sampled — `emotions: []` on every desktop and mobile response. The error only reached the participant's console.
- **Fix.** Replaced the file with the official weights from `@vladmandic/face-api/model` (manifest and the other two models were already identical). Removed the unused `face_landmark_68_model-shard1` copy with the same broken content.
- **Guard.** `faceApiModels.test.ts` checks every face-api weights file against the byte size its manifest declares.

### fix: Second Eye Tracking module recorded no gaze
- **Root cause 1.** Consecutive ET modules skipped calibration using cached residuals only; the trained ridge model lived in the previous module's component, so the next module started untrained.
- **Root cause 2.** Gaze loops (viewing capture, calibration/validation dwell, micro-recalibration) read `gaze.gazeState` from the closure created when the phase started. In the second module the camera was still starting at that moment, so the loop kept reading `'closed'` and discarded all 10 seconds (`gazePointCount: 0`).
- **Fix.** `calibrationCache.ts` keeps the calibration in memory with its trained predictor, handed to the next module via `useMediaPipeGaze({ predictor })` — only for a different module, within 2 minutes, and only if the predictor is trained (after a reload the participant calibrates again). Loops read a live `gazeStateRef`.
- **Tests.** `calibrationCache.test.ts`; consecutive module records gaze when the face is detected after viewing starts.

### fix: Eye Tracking validation recorded 0 px error on tap
- **Root cause.** Tapping a validation point (`handleValidationDwellComplete`) pushed an error of 0 without reading the gaze. On mobile participants tap, so validation always passed (`validationRmsePx: 0`) and a 191 px calibration on a 402 px screen went straight to the stimulus — with that noise I-DT found 0 fixations.
- **Fix.** Dwell and tap share `recordValidationPoint`: a tap measures the error of the current gaze against the dot, the same as a completed dwell. RMSE above `HYBRID_RECALIBRATION_RMSE_THRESHOLD_PX` shows the recalibrate option.
- **Not changed.** I-DT dispersion threshold (70 px) — to be tuned with real mobile data from a validated calibration.
- **Note.** "Fewer elements" in results for Shelf stimuli is by design: Scan Path, First Look, Transparency, Sequence and Image tabs are hidden for `isShelf`.

---

## v0.96.11 — Eye Tracking mobile camera gaze + SmartVOC consolidated dashboard (2026-10-03)

### fix: Eye Tracking calibration cache scoped to module
- **Root cause.** The 2-minute calibration cache in `sessionStorage` was not tied to a module. Reloading or restarting the same ET module within 2 minutes started at `preparing` and jumped straight to the stimulus — intro, setup and calibration were skipped.
- **Fix.** The cache stores `moduleId`; `loadCalibrationFromSession(moduleId)` only reuses a calibration from a *different* ET module (consecutive modules), never from the same one.

### fix: Eye Tracking setup camera preview stayed black
- **Root cause.** `SetupPhase` mounts the preview `<video>` only after `streamReady`. The stream poller set `streamReady` and assigned `srcObject` in the same tick, while `previewRef.current` was still `null` — the preview never received the stream, face detection waited forever on `readyState < 2` and "Center your face on screen" stayed red.
- **Fix.** The stream is attached in the detection effect, which runs after the preview `<video>` exists. Regression test: `SetupPhase.test.tsx`.

### feat: Eye Tracking camera gaze tracking on mobile/tablet
- **Before.** Mobile/tablet used `click-proxy`: no gaze model, the participant had to tap where their attention went, and the 9-point calibration only advanced an index without training anything.
- **Now.** All devices run the same pipeline as desktop: camera → MediaPipe gaze → quality gate → dwell calibration → validation → gaze capture during viewing → micro-recalibration → I-DT fixations. Saved response uses `trackingMethod: 'mediapipe-ridge'` with `gazePointCount`, fixations and calibration/validation RMSE.
- **Calibration tap.** A tap/click on a calibration point now trains the model with the current gaze (same as a completed dwell). Previously a click advanced the point without calling `calibrate()` — on desktop too.
- **Removed.** Tap capture during viewing (`handleImageInteraction`, blue tap markers, "N puntos registrados" counter), mobile checklist, `isDesktop` props on Intro/Setup/Preparing/Viewing/Complete phases, and 7 unused i18n keys (`checkMobile1-4`, `clicks`, `pointsRecorded`, `preparing`).
- **Tests.** New: mobile records camera gaze during viewing without taps. Updated mocks/expectations that assumed the click-proxy path. Backend still reads legacy `click-proxy` responses.

### feat: Consolidated SmartVOC endpoint across clients
- New `GET /analytics/smartvoc/consolidated`: SmartVOC results of every study the user can see (same `buildOwnershipClause` as the research list — admin/viewer see all, researchers see own + collaborations).
- `GET /analytics/enterprise/:id/smartvoc` and the new route share `collectSmartVOCResults`: only studies with a `Smart VOC` stage are queried, and each result now includes `researchName` and `enterpriseName`.
- A study whose analytics fail is skipped with a structured warning log (`smartvoc_consolidation_skipped`) instead of a silent catch.

### feat: Clients page — consolidated SmartVOC charts
- **Before.** "SmartVOC Consolidado" showed 4 tiles with the unweighted mean of per-study scores (Mises Cono Sur NPS 34 while all answers combined give 15), no charts, and the section was hidden for clients without SmartVOC data.
- **Weighted totals.** `buildClientSmartVOCSummary` pools every answer: NPS from promoters/detractors, CSAT/CV with the shared `calculateCSAT`/`calculateCV`, CES classified with each study's `scaleConfigs.ces.max` zones before pooling.
- **Charts (`ClientSmartVOCSection`).** NPS distribution bar (promoters/neutrals/detractors), comparison by study (grouped bars, single -100..100 axis), monthly trend (linear lines, `n` answers per month on the axis). Metric colors from the project categorical palette (NPS `#006AFF`, CSAT `#D97706`, CES `#0D9488`, CV `#E11D48`), validated for CVD/contrast; legend and tooltip in fixed metric order.
- **"Todos los clientes".** New default option in the client selector: consolidated SmartVOC of all accessible studies (labels include client name), plus all studies in the projects chart and table.
- **Tests.** `clientSmartVocSummary.test.ts`: weighting by answers, per-study CES scale, monthly grouping.

---

## v0.96.10 — Eye Tracking mobile Safari fixes + IAT repetitions config (2026-09-25)

### fix: IAT builder translated to Spanish
- `ModuleContentEditor`: "Test title" → "Título del test", "Stimulus repetitions" → "Repeticiones del estímulo", "Add target/object" → "Agregar target/objeto", "Add another choice" → "Agregar otra opción", "Remove" → "Eliminar".
- `CognitiveTaskModuleCard`: "Preview" → "Vista previa", "Live Test" → "Prueba en vivo", "Required/Hide/Show conditionality" → "Requerido/Ocultar/Condicionalidad", "Delete module" dialog fully translated.
- `IATFlowchart`: all phase labels, node descriptions, and summary text translated to Spanish.
- `response-keys` and `trial-repetitions` components hidden from editor body (were rendering as visible inputs). Filter now checks both `c.hidden` and `c.settings?.hidden`.

### feat: IAT stimulus repetitions configurable in research builder
- **Research-frontend**: `ModuleContentEditor` — "Stimulus repetitions" selector (2x, 3x, 4x default, 5x) below test title for all IAT paradigms.
- `CognitiveTaskModuleCard` auto-creates `trial-repetitions` component if missing (same pattern as `response-keys`).
- Participant-frontend already reads `trial-repetitions` (added in v0.96.7) — now configurable instead of hardcoded 4x.

### fix: camera not activating on mobile despite permission granted (Eye Tracking)
- **Root cause.** Hidden `<video>` element only mounted when `isDesktop` — on mobile with emotion recognition enabled, `getUserMedia` obtained the stream but `videoRef.current` was `null`, so the stream was silently discarded. Safari showed the permission prompt, user accepted, but camera never connected.
- **Fix.** `<video>` now mounts when `isDesktop || hasEmotionRecognition` — same condition `startCamera()` uses.

### fix: desktop dwell calibration broken — uncalibrated gaze data (Eye Tracking)
- **Root cause.** CalibrationPhase redesign (white background) removed the stimulus image. Desktop dwell loop called `getStimulusElement()` → `null` → RAF spun infinitely. `gaze.calibrate()` never called. All desktop gaze data was uncalibrated.
- **Fix.** Added `calibrationAreaRef` to CalibrationPhase (the `flex-1 relative` container where dots are positioned). Dwell loop now uses `calibrationAreaRef` instead of `getStimulusElement()`.

### fix: mobile skips validation phase after calibration (Eye Tracking)
- `handleCalibrationClick` went directly to `'viewing'`. Desktop dwell path went to `'validating'`. Now click handler also goes to `'validating'` on desktop (matching dwell), and to `'viewing'` on mobile (no gaze validation possible).

### fix: camera LED stays on after ET completes on mobile (Eye Tracking)
- `faceEmotions.stop()` and `stopCamera()` were gated by `isDesktop`. Changed to `isDesktop || hasEmotionRecognition` in both `complete` phase and `handleRejectSession`.

### fix: quality gate "Reintentar" hangs with infinite spinners (Eye Tracking)
- **Root cause.** Retry button reset check statuses to `pending` but the effect that runs checks depended on `[cameraRef, gazeActive]` — neither changed on retry, so checks never re-executed. Also, if camera stream was never obtained (`video.srcObject === null`), the effect returned silently — spinners stayed forever.
- **Fix.** Added `retryTrigger` state to force effect re-run on retry. When `srcObject` is null, all checks immediately show `fail` with "Cámara no disponible" instead of spinning indefinitely.

### fix: calibration/validation points not responding to tap on mobile Safari (Eye Tracking)
- **Root cause (calibration).** `handleCalibrationClick` required `getStimulusElement()` to return a valid element — but the redesigned CalibrationPhase (white background) no longer mounts the stimulus image during calibration. `getStimulusElement()` returned `null` → handler exited silently.
- **Root cause (both).** Only `onClickCapture` was registered. Safari mobile can suppress synthetic `click` events from `touchend`. Added `onTouchEnd` handler with 300ms dedupe guard to prevent double-advance.
- **Fix.** Removed stimulus element dependency from `handleCalibrationClick` (not needed for point advancement). Added `onTouchEnd` + dedupe to both `CalibrationPhase` and `ValidationPhase`.

### fix: camera retry dead on SetupPhase after initial failure (Eye Tracking)
- **Root cause.** `retryCamera` obtained a new stream but the polling interval (that sets `streamReady`) had already expired — preview never activated. Also, Safari's `NotAllowedError` on retry (permission denied is sticky) showed generic "Camera not available" with a Retry button that could never succeed.
- **Fix.** `retryCamera` now sets `streamReady` and wires preview directly on success. On `NotAllowedError`, shows "Permiso de cámara denegado" with "Recargar página" button instead of futile retry.

### fix: ET phases respect safe-area insets on notch/Dynamic Island devices
- CalibrationPhase header, ValidationPhase progress pill + hint text, ViewingPhase progress pill + timer + click count: all use `env(safe-area-inset-top/bottom)` with `max()` fallback.
- `viewport-fit=cover` added to `index.html` (required for `env()` to return non-zero values).

### fix: sessionQualityChecks tests aligned with Spanish messages
- 4 tests asserted English substrings (`close`, `far`, `still`, `landscape`) — implementation uses Spanish (`cerca`, `lejos`, `quieta`, `horizontal`).
- 1 test expected `canProceed: true` for warnings — `evaluateGate` was intentionally changed to strict mode in v0.96.7 (warnings block advancement).

### quality
- **TypeScript strict** — 0 errors, 0 warnings in all 3 subprojects.
- **Tests** — 1123 pass, 0 fail (was 1118 pass, 5 fail).

---

## v0.96.9 — Eye Tracking glasses tolerance (2026-09-17)

### fix: face detection tolerates glasses (Eye Tracking)
- **TinyFaceDetector** (emotion recognition): `scoreThreshold` 0.4 → 0.25, `inputSize` 224 → 320. Glasses with thick frames or reflections no longer drop below detection threshold.
- **Quality gate faceConfidence**: no longer binary (1.0/0). When MediaPipe detects face landmarks but gaze state is 'closed' (eye glare from lenses), reports 0.85 instead of 0 — passes the 0.8 gate.
- **SetupPhase camera**: preview resolution 320×240 → 640×480 on mobile for better face detection with glasses.
- **Setup check text**: "No light-reflecting glasses on" → "If wearing glasses, avoid direct light reflections on lenses" — no longer implies glasses are prohibited.

### quality
- **TypeScript strict** — 0 errors, 0 warnings in all 3 subprojects.

---

## v0.96.8 — Per-option images in Single/Multiple Choice, Ranking drag-drop fix (2026-09-17)

### feat: per-option images in Single Choice and Multiple Choice
- **Research-frontend**: `RadioChoicesEditor` — 40×40 image upload per option (click + drag-and-drop). Remove via red X button. Uses `mediaService.uploadFile`.
- **Participant-frontend**: `ChoiceQuestion` shows 40×40 thumbnail next to each option label. `OptionThumbnail` component with `useResolvedMediaUrl`.
- `CognitiveTaskRenderer` now extracts `image` field from choice JSON data.
- `EditableComponent` passes `researchId` to `RadioChoicesEditor` for both `radio` and `checkbox-list`/`option-list` types.

### fix: Ranking per-item image upload supports drag-and-drop
- `RankingItemsEditor` image button now handles `onDragOver`/`onDragLeave`/`onDrop` — previously only click-to-browse worked.
- Validates `file.type.startsWith('image/')` on drop.

### quality
- **TypeScript strict** — 0 errors, 0 warnings in all 3 subprojects.

---

## v0.96.7 — IAT UX, reference images, Preference carousel, mobile polish (2026-09-17)

### fix: IAT take-note instructions adapt to device
- **Mobile (touch):** "Posiciona tus dedos pulgares en cada botón" + full-width "Listo" button below category buttons. Spacebar hint hidden.
- **Desktop:** unchanged — "Posiciona tus dedos índice" + `␣ espacio` hint.
- Detection via `matchMedia('(pointer: coarse)')`.

### feat: IAT Tinder-style stimulus swipe animation
- Stimulus card swipes left/right with 12° rotation + fade on category selection (250ms CSS transition).
- `swipeDir` state blocks double-tap during animation. 280ms delay before advancing trial.

### fix: IAT remove redundant category labels from trial/priming
- Removed duplicate `← = Label` / `→ = Label` text above stimulus — buttons already show category names.
- Stimulus + buttons vertically centered via `flex-1 justify-center` below `StepProgressPill`.

### fix: study logo centered + hidden during IAT
- Logo centered horizontally (`flex justify-center`) instead of pinned top-left.
- Hidden during Implicit Association phases to avoid competing with exercise UI.
- `pointer-events-none` prevents tap interference on mobile.

### fix: mobile content not overlapped by logo
- `MainLayout` adds `pt-14` on mobile to clear the fixed logo. Desktop padding unchanged (`sm:p-6`).

### fix: IAT intro screen — "Objetivo:" heading + mobile-adapted text
- Added `h3` "Objetivo:" heading before the speed instruction (larger `text-lg`).
- Mobile: "los botones" instead of "las teclas ← o →".

### fix: study logo spacing on mobile
- `top-5` (20px) on mobile, `top-3` (12px) on desktop.

### feat: reference images in cognitive tasks
- **DB migration 033**: added `reference-image` (file-upload, single image) component to Ranking, Single/Multiple Choice, Linear Scale, Short/Long Text templates.
- **Research-frontend**: renders automatically via existing `FileUploadEditorComponent`.
- **Participant-frontend**: split layout when reference image exists — image left + question right (desktop), image top + question bottom (mobile). Optional phone frame mockup via `settings.phoneFrame`.

### feat: per-item images in Ranking
- **Research-frontend**: `RankingItemsEditor` — image upload button per item (40×40 thumbnail + remove). Uses `mediaService.uploadFile`.
- **Participant-frontend**: `RankingQuestion` shows 40×40 thumbnail next to each item label. `useResolvedMediaUrl` hook resolves S3 keys.
- Item data extended: `{ id, label, image?: { s3Key, url } }`.

### feat: Preference Test mobile carousel
- Mobile: horizontal carousel — one image at a time, swipe or arrow navigation, dot indicators.
- "Seleccionar" button per image, intensity (Leve/Fuerte) inline below selected.
- Desktop: unchanged grid layout.

### fix: Preference Test zoom modal not covering full screen on mobile
- Zoom modal rendered via `createPortal(document.body)` — no longer clipped by `MainLayout` border-radius.

### feat: IAT configurable stimulus repetitions
- Researcher selects repetition count (1x-8x) per IAT module via "Stimulus repetitions" selector.
- Default 4x (unchanged behavior). Applies to all 3 paradigms.
- `trial-repetitions` component added to Attribute Testing, Comparing Attribute, Objects Comparing templates.

### feat: Eye Tracking Shelf — comparative product view
- "Comparativa" tab for shelf mode with AOIs — cards per product sorted by % AOI.
- Winner highlighted in green. 6 metrics: % AOI, fixations, duration, participants, TTFF, notice rate.
- Progress bar relative to max for visual comparison.

### feat: Emotion Recognition — EmScore + mood states
- **EmScore**: `2(C+Q) + 1.5E - (W+U) - 2T` — single metric for emotional climate of a design.
- **Mood States**: Frustración, Interés, Concentración — computed from Ekman emotion distribution.
- Spanish labels throughout EmotionPanel.

### feat: Eye Tracking Shelf — group repetitions
- Research-frontend: "Repeticiones" selector (1x-6x) in shelf config. Each product repeats N columns.
- Participant-frontend: `ShelfGrid` expands URLs by repetition count before rendering grid.
- Config stored as `shelf-repetitions` component value.

### feat: Vista Cliente — SmartVOC consolidado por enterprise
- Backend: `GET /analytics/enterprise/:id/smartvoc` aggregates SmartVOC across all researches.
- Clients page: "SmartVOC Consolidado" section with NPS, CSAT, CES, CV averages.
- Only visible when enterprise has SmartVOC data.

### fix: ET AOI modal — correct image + edited metrics
- AOI drawer uses `effectiveStimulusUrl` (shelf composite for shelf mode) instead of raw URL.
- Metrics section shows edited AOIs (live state) instead of original saved AOIs.
- "Métricas" label in Spanish.

### fix: ET Transparency — constrain image size + Spanish text
- Canvas constrained to `max-h-[60vh]` matching Scan Path sizing.
- Description translated to Spanish.

### feat: ET Prediction tab — heatmap sliders + dark overlay
- Same 4 controls as Heatmap: Opacidad, Blur/suavizado, Exposición/intensidad, Capa negra.
- Dark overlay layer for prediction visualization.

### fix: ET Scanpath reacts to quality gate exclusions
- Scanpath now filters by `excludedParticipants` — previously showed all fixations regardless.

### fix: ET heatmap slider labels match EmotioSMI
- Opacidad (red), Blur/suavizado (green), Exposición/intensidad (blue), Capa negra (dark blue).
- Color-coded sliders for visual distinction.

### feat: Eye Tracking heatmap — dark overlay control
- 4th slider "Capa oscura" (0-80) adds black overlay behind heatmap to isolate hot zones.
- Matches EmotioSMI's "Capa negra / Oscurecer fondo" control.

### fix: Eye Tracking Shelf — hide inapplicable result tabs
- Shelf mode hides: Scan Path, First Look, Transparency, Sequence, Image, Prediction.
- Only shows: Mapa de calor + Emotions (if enabled).

### feat: Eye Tracking — merge Density into Heatmap with inline controls
- Removed "Density" tab — single "Mapa de calor" tab replaces both.
- Inline sliders (Opacidad, Blur, Intensidad) below heatmap for real-time control.
- Removed Settings modal button — controls are always visible.

### fix: Eye Tracking results — hide visualizations when 0 responses
- Tabs (Heatmap, Density, Scan Path, etc.) hidden when `totalResponses === 0`.
- Only metrics bar + "Sin respuestas aún" message shown.
- Metrics labels translated to Spanish.

### fix: Cognitive Task results duplicated across stage tabs
- `CognitiveTaskResults` now receives `stageId` and filters modules by stage.
- Each "Cognitive Tasks" / "Cognitive Tasks 2" tab shows only its own modules.
- Uses `useResearch` (cached) to resolve stage → module mapping.

### feat: IAT chart/table toggle + CSV export
- Toggle switcher (Gráfico/Tabla) at top of each IAT module card.
- Table view shows clean data grid — selectable, copy-pasteable.
- "Exportar CSV" button downloads UTF-8 CSV compatible with Excel/Google Sheets.
- Empty state and response count translated to Spanish.

### feat: IAT charts unified across paradigms
- **Attribute Testing**: added vertical bar chart below radar + association strength.
- **Comparing Attribute**: unchanged (bars + radar + bands).
- **Objects Comparing**: added vertical bar chart + radar chart below divergent horizontal bars.

### fix: Screener results — Spanish translation + real choice labels
- Legend shows actual choice labels (Hombre, Mujer) with eligibility (clasifica/descalifica) instead of "Route 1/Route 2".
- All UI text translated: titles, cards, tooltips, day rows, empty state.

### fix: Eye Tracking viewing phase — white background for all modes
- Stand Alone and Shelf both use pure white background. Removed gradient.
- Duration options expanded: 3, 5, 7, 10, 15, 20, 30, 45, 60 seconds.

### fix: Eye Tracking shelf — tight spacing
- Shelf viewing phase uses pure white background instead of gradient.
- Gap reduced from 2/4px to 1/2px (mobile/desktop) — simulates real gondola spacing.
- `object-cover` instead of `object-contain` — images fill cells without internal gaps.

### feat: Eye Tracking calibration redesign — white background, camera preview
- White background instead of dark blurred stimulus image.
- Clear instructions: "Mira y toca cada punto" (mobile) / "Mira y haz clic en cada punto" (desktop).
- Progress: "Punto X de 9 — un toque por punto".
- Larger green dot (40px) with pulsing ring on both devices.
- Camera preview (80px circle) at bottom during calibration for position awareness.
- Single click/tap phase — removed confusing two-phase system.

### fix: Eye Tracking quality gate — Spanish, blocking validation, action hints
- All check labels, messages, and buttons translated to Spanish.
- Warnings now block advancement — only all-pass proceeds to calibration.
- Each failed/warning check shows actionable hint (e.g. distance: "Mantente a 50-70 cm").
- Removed "Continue anyway" button — only "Reintentar" until all checks pass.

### feat: Eye Tracking camera preview + face detection in setup
- Circular preview (136px) with live camera feed on desktop and mobile (when emotion recognition enabled).
- Border color: green = position correct, red = face not centered, gray = waiting.
- Luminance-based presence detection in center zone — no extra dependencies.
- Camera error state with retry button and help text.
- Mobile now shows preview instead of static icon.

### fix: Eye Tracking camera permission on mobile
- `useFaceApiEmotions` no longer gated by `isDesktop` — emotion recognition works on mobile.
- Camera starts on mobile during setup/preparing when emotion recognition is enabled.
- Browser prompts camera permission on mobile via `getUserMedia`.

### fix: Eye Tracking intro — unified description + camera warning on mobile
- Same description text on desktop and mobile (previously different).
- "Webcam access will be required" warning now shown on both devices (was desktop-only).

### fix: IAT complete screen removed between exercises
- Removed green checkmark "Prueba completada" screen that appeared between IAT exercises — caused confusion by implying the study was done.
- IAT now saves and advances immediately to the next module. Completion feedback only at the final Thank You screen.

### fix: Ranking numbers removed when images present
- Rank numbers removed from items — images + labels are sufficient.

### feat: Preference Test intensity visible in results
- `preferenceIntensity` (`slight`/`strong`) was saved by participant but never shown in research results.
- Inline: `NL / NF` (Leve/Fuerte) next to selection count per image.
- Expanded: dot badges "Leve: N" / "Fuerte: N" below image detail.

### quality
- **TypeScript strict** — 0 errors, 0 warnings in all 3 subprojects.

---

## v0.96.6 — ET emotion fix, button validation, IAT layout stability (2026-09-11)

### fix: Eye Tracking emotion recognition not capturing
- **Root cause.** `faceEmotions.start()` was called during `phase === 'viewing'` but face-api.js models hadn't loaded yet. `start()` returned silently and was never retried — `emotions: []` in every response.
- **Fix.** `start()` now queues a pending start. When models finish loading, sampling auto-starts.

### fix: ET emotion analytics reads eye-tracking-data responses
- Backend query now reads both `emotion-analysis` (legacy) and `eye-tracking-data` (current) component IDs. Parses both `stimuli[].emotionSamples` and flat `emotions[]` formats.

### fix: ET validation point stuck on desktop
- Click fallback now works on desktop too. Previously `handleValidationDwellComplete` returned early on desktop — if gaze tracking produced no data, validation was stuck forever.

### fix: footer button disabled until response selected
- "Guardar y continuar" disabled until participant selects an option. Applies to Preference Test, Single/Multiple Choice, Screener, Ranking, etc.

### fix: remove "Opción seleccionada" text from ChoiceQuestion
- Visual indicator (blue border + check) is sufficient.

### fix: Screener hides default placeholder description
- "Screening questions for participant qualification" not shown to participants. Custom descriptions written by researchers still display.

### fix: IAT layout stability between priming and trial
- Both phases use identical top-down layout with fixed `h-[500px]` wrapper and `h-[200px]` stimulus area. Priming includes invisible button spacer matching trial buttons. No layout shift between phases.

### quality
- **TypeScript strict** — 0 errors, 0 warnings in all 3 subprojects.

---

## v0.96.5 — IAT arrow fix, Screener description filter (2026-09-11)

### fix: IAT Comparing Attribute double arrow in buttons
- `blockBuilders.ts` added `< ` / ` >` to dimension labels. Runner already prefixed `← = ` or `A = `. Result: `← = < SI`. Removed redundant arrows from labels.

### fix: IAT take-note "␣ espacio" wrapping to two lines
- Added `whitespace-nowrap` and `shrink-0` to the kbd+text container.

### fix: Screener hides default placeholder description in participant view
- "Screening questions for participant qualification" no longer shown to participants. Custom descriptions written by researchers still display.

---

## v0.96.4 — Dashboard row index column (2026-09-11)

### feat: row index in dashboard research table
- Added `#` column with 1-based index. Compact: `w-6`, `text-[11px]`.

---

## v0.96.3 — UI polish: results layout, charts, dashboard consistency (2026-09-11)

### fix: Screener results layout
- Right column (3 status cards + weekly chart) now matches left card height via flexbox. Weekly chart fills remaining space.
- Removed banner "1.0.- Screener" and subtitle. Filters aligned to content top.
- Cards use `rounded-lg shadow-none` to match Filters styling.

### fix: IAT Reaction Time Distribution box plot rendering
- **Root cause.** SVG used `viewBox="0 0 100 ${svgH}"` with `preserveAspectRatio="none"` — squashed Y axis, invisible strokes (0.3px), unreadable text (3px).
- **Fix.** Removed viewBox. X coordinates use percentage, Y in real px. Normal stroke widths and font sizes.

### fix: IAT Comparing Attribute association bands
- Replaced raw `<svg><rect>` with Recharts `ReferenceArea` — bands now render inside plot area only.
- Saturated band colors (`#86EFAC`, `#FDE047`, `#FCA5A5`) + higher opacity (0.45).
- Toggleable bands: click pill to show/hide each association zone individually.

### feat: IAT Comparing Attribute toggleable chart series
- Bar chart and Radar chart share `visibleTargets` state — click target pills to show/hide series in both charts.
- Replaced Recharts `Legend` with custom toggle pills (same style as band toggles).

### fix: IAT color picker square overflow
- Color swatch is now a styled `<span>` with hidden `input[type="color"]` — clean borders, no native chrome overflow.

### fix: IAT header banner removed
- Removed "3.0.- Implicit Association" banner with Export button.

### fix: ET stimulus image size consistency across sub-tabs
- Container uses fixed width from `stimulusSize` across all view modes. No more size jumps when switching tabs.
- ScanpathOverlay: removed `inline-block max-h-[60vh]` — uses parent width.
- Image scale cap raised from 1.0 to 1.2 (20% larger), maxH 60→72vh, maxW 1000→1200px.

### fix: Research Tracking action labels
- **Root cause.** Backend sends `research.active`, `research.completed` etc. Frontend displayed raw values.
- **Fix.** `ACTION_CONFIG` maps full action strings to friendly labels (Active, Completed, etc.) with correct badge colors.

### fix: Dashboard input heights
- Search input and date pickers now use `h-10 text-sm` — same height as CustomSelect dropdowns.

### fix: Dashboard border visibility
- Summary cards and table wrapper: `border-gray-100` → `border-gray-200`.

### quality
- **TypeScript strict** — 0 errors, 0 warnings in all 3 subprojects.

---

## v0.96.2 — IAT analytics fix, ET shelf heatmap, quality gate, pagination (2026-09-05)

### fix: IAT Objects Comparing results not registering
- **Root cause.** Participant-frontend was rewritten in v0.95.1 from 7-block Greenwald to 2 blocks (`block-1` = practice, `block-2` = test). Backend analytics still looked for `block-3/4/6/7` — found 0 trials — returned empty scores.
- **Fix.** Removed dead 7-block logic. All functions now universally exclude `block-1` (practice). Objects Comparing uses the same RT-based scoring as other paradigms. D-score limited to Attribute Testing. Backward compat: legacy 7-block data auto-detected and scored with Greenwald method.

### feat: IAT category labels visible during priming and trial
- Persistent `A = Category` / `L = Category` labels at top of screen during priming phase and trial phase.

### fix: IAT participant-frontend text translated to Spanish
- All `t()` fallback strings translated: intro, take-note, complete, results, not-configured.

### feat: customizable IAT chart colors
- Color picker inputs above each IAT chart. Researchers change bar/radar colors in real time. Persisted in localStorage per module ID.

### feat: ET shelf heatmap renders over full gondola grid
- Backend sends all shelf image URLs (`shelfUrls`). Frontend composites them into a single canvas image matching the shelf layout. All tabs (Heat map, Density, Scan Path, First Look, Transparency, Prediction, Image) render over the composite shelf image.

### fix: ET Density tab uses real fixation data
- Density tab now shows fixation count density from real participant data instead of V3 probabilistic model. V3 kept as fallback.

### fix: ET Heat map reacts to quality gate checkboxes
- Heat map, Density, First Look, Transparency tabs all filter by `excludedParticipants`. Including/excluding participants via checkboxes updates visualizations in real time.

### feat: ET quality gate select-all checkbox
- "Include" column header has checkbox to select/deselect all participants. Indeterminate state for partial selection.

### fix: ET First Look and Transparency show all participants
- Backend now sends all fixations (including low-quality) so frontend quality gate controls inclusion. Low-quality excluded by default but toggleable.

### fix: ET Scan Path fills stimulus image
- Image constrained to `max-h-60vh` with `inline-block` container. SVG overlay uses `xMidYMid meet`.

### fix: face-api.js emotion recognition not capturing
- **Root cause.** `face_landmark_68_model.bin` missing from `participant-frontend/public/models/`. Only `-shard1` variant existed. Deploy rsync `--delete` overwrote prior server fix.
- **Fix.** Committed `.bin` file to repo. Emotion recognition now works for new ET responses.

### fix: unbounded database queries paginated
- `responses.getByResearch`: LIMIT 5000 + offset pagination.
- `tracking.getExportData`: sessions LIMIT 10000, events LIMIT 500000.
- `tracking.getSessionEvents`: LIMIT 50000 per session.
- `tracking.getAttentionHeatmapData`: LIMIT 500000.
- `tracking.getMouseAttentionHeatmapData`: LIMIT 500 sessions.
- `tracking.getVisitorJourneys`: LIMIT 5000 sessions.
- `tracking.getSessionFrictionTags`: LIMIT 5000.

### quality
- **TypeScript strict** — 0 errors, 0 warnings in all 3 subprojects.
- **Builds** — all 3 subprojects build successfully.

---

## v0.96.1 — ET heatmap + AOI move/resize + calibration table + Fly.io predict (2026-09-03)

---

## v0.96.1 — ET heatmap + AOI move/resize + calibration table + Fly.io predict (2026-09-03)

### fix: Eye Tracking heatmap not visible
- **Heat map tab** now uses `HeatmapRenderer` (simpleheat with warm gradient) instead of `ZoneHeatmapOverlay` (colored rectangles) when fixation point data exists. Zone overlay kept as fallback.
- **Zone overlay visibility** improved: `sqrt` intensity scale + min alpha raised from 0.05 to 0.15.

### fix: Eye Tracking unified stimulus size across all sub-tabs
- All sub-tabs (Heat map, Density, Scan Path, First Look, Transparency, Image) render within a fixed container computed on image load (max 60vh). Switching tabs no longer reloads the image or changes its size.

### fix: Eye Tracking First Look zoom bug
- `HeatmapRenderer` had no height limit, causing the image to stretch to full container width and overflow. Fixed with `max-h-[60vh]` constraint.

### feat: AOI move + resize with mouse drag
- AOIs now support drag-to-move (click inside) and resize via corner/edge handles. Cursor changes to indicate available action. Persists via Save button in module config.

### feat: calibration quality table with include/exclude
- Expandable table below Quality Gate banner showing per-participant: anonymized ID, grade (good/fair/low), calibration method, RMSE, integrity score, fixations, dwell time. Checkbox to include/exclude each participant. Low-quality excluded by default.

### fix: Attention Prediction 503 — moved ONNX to Fly.io
- **Root cause.** cPanel Passenger recycles Node process when RSS exceeds 512MB. TranSalNet ONNX model (290MB) pushed RSS to ~1GB.
- **Fix.** New `saliency-service/` deployed on Fly.io (`emotiox-saliency.fly.dev`). shared-cpu-2x, 2GB RAM, auto-stop when idle. Backend sends image via multipart POST. Cold start ~45s, warm ~15s. Cost: ~$0-2/month.
- All prediction functions (`predictAttention`, `predictAttentionRaw`, `predictAttentionFast`, `predictAttentionAsImage`) now route through Fly.io API.
- Frontend timeout for predict endpoints raised from 30s to 120s.

### fix: Emotion Recognition not capturing
- **Root cause.** `face_landmark_68_model.bin` was deployed as `face_landmark_68_model-shard1`. face-api.js couldn't load the model, so `isLoaded` stayed false and emotion sampling never started.
- **Fix.** Copied shard file to expected `.bin` name on server.

### feat: dynamic results tabs per stage
- Results tabs generated from research stages in order. Duplicate stage types get numbered suffix (IAT 2, Eye Tracking 2). IAT and Eye Tracking endpoints accept `?stageId=` query param to filter by specific stage.

### feat: CSV export
- Export changed from XLSX to CSV (one file per data sheet). More reliable, no dependency issues.

### fix: multiple IAT/ET stages — LIMIT 1 removed
- IAT and Eye Tracking analytics queries used `LIMIT 1` on stage lookup, missing modules in duplicate stages. Now queries all matching stages.

### quality
- **TypeScript strict** — 0 errors, 0 warnings in all 3 subprojects.
- **Builds** — all 3 subprojects build successfully.

---

## v0.96.0 — IAT 4x trials, Comparing Attribute results redesign, stage reorder (2026-09-02)

### feat: IAT — each stimulus 4 times in random order
- All 3 paradigms (Attribute Testing, Comparing Attribute, Objects Comparing) now repeat each criterion×target combination 4 times before shuffling. Practice remains 8 trials.

### feat: IAT Comparing Attribute results redesign
- **Grouped bar chart.** Criteria on X-axis, bars per object. Association bands: baja <25%, media 25-55%, fuerte ≥56%. Tooltip on hover.
- **Radar/spider chart.** Same criteria as axes, one line per object.
- **Net Association Strength.** Summary: "X de Y atributos a favor de [leader]".
- **Backend.** Extracts criteria items for Comparing Attribute. `criteriaScores`: per-criterion per-object scores (dim1Pct, dim2Pct, netScore, meanRT, trials).

### feat: stage reorder in research builder
- **Backend.** `PUT /research/:id/stages/reorder` — updates `display_order` of multiple stages in a transaction.
- **Frontend.** Arrow buttons (↑↓) on hover to move stages up/down. Welcome Screen and Thank You Screen stay pinned first/last.
- **`sortStages`** now uses `display_order` from backend instead of name-based ordering.

### feat: Research Configuration separated from stages
- Research Configuration extracted from the stage list into a fixed "Configuration" section with ⚙️ icon, between Status and Stages. No longer reorderable or deletable from the stage list.

### fix: Eye Tracking — click fallback on all devices
- Calibration click handler was blocked on desktop (`if (isDesktop) return`). If gaze tracking failed to start (Safari, camera permissions), participants were stuck. Click now works on all devices as fallback.
- Calibration cache (sessionStorage, 2min TTL) was desktop-only. Now enabled on mobile — consecutive ET modules skip calibration.

### feat: Preference Test — intensity below selected image (ES)
- "How strong is your preference?" with Slight/Strong buttons moved below the selected image (proximity association). i18n translations: "¿Qué tan fuerte es tu preferencia?" / "Leve" / "Fuerte".

### feat: i18n "Step X of Y"
- `StepProgressPill` in Eye Tracking and IAT now uses i18n. ES: "Paso X de Y".

### quality
- **TypeScript strict** — 0 errors, 0 warnings in all 3 subprojects.
- **Builds** — all 3 subprojects build successfully.

---

## v0.95.1 — Fix image upload + IAT unified paradigm rewrite (2026-08-31)

### fix: image upload fails with "Upload failed" in IAT builder
- **Root cause.** Physical directory `~/public_html/api/media/` (containing face-api-models for tracking snippet) collided with the API route `POST /api/media`. Apache's `mod_dir` issued a 301 redirect (`/api/media` → `/api/media/`) before Passenger could handle the request. CORS preflight rejects redirects, so the browser blocked the request entirely — affecting all file uploads that save metadata via `POST /api/media`.
- **Fix.** Moved `face-api-models/` out of `~/public_html/api/media/` into `~/emotioxv3/media/face-api-models/` (served by Express static at the same URL). Added `DirectorySlash Off` to `/api/.htaccess` as defense-in-depth. No code changes — server configuration only.
- **Impact.** All image uploads in IAT targets (Attribute Testing, Comparing Attribute, Objects Comparing), Eye Tracking stimuli, Navigation Flow, and Preference Test now work correctly.

### fix: IAT — unified paradigm rewrite (all 3 types)
- **Problem.** Each IAT paradigm had different trial mechanics: Attribute Testing used priming incorrectly (criterion flash → target classify) with correct/incorrect feedback and pre-assigned targets. Comparing Attribute skipped priming entirely. Objects Comparing used a 7-block Greenwald structure with 180 trials causing participant fatigue. None followed the shared base principle.
- **Shared principle.** All 3 paradigms now follow: target/object IMAGE shown briefly (priming, configurable ms) → criterion TEXT replaces it → waits for keypress indefinitely → no feedback. Practice: 8 trials to learn key mapping. Test: all criterion × target combinations, shuffled with no consecutive repeats (`shuffleNoConsecutive`). Both sides valid — implicit association measured by choice distribution + RT.
- **Attribute Testing.** Target image (400ms) → criterion text → keypress. All criterion × target combinations.
- **Comparing Attribute.** Object image (400ms) → criterion text → keypress. Dimension labels as buttons. Added practice block (was missing).
- **Objects Comparing.** Simplified from 7-block Greenwald (180 trials) to 2-block base pattern. Target image (400ms) → criterion text → keypress. Category labels as buttons.
- **Removed.** 2000ms auto-advance timeout, correct/incorrect feedback, keep-in-mind phase, target selector in builder (all 3 paradigms). −233 lines of dead code.
- **Target selector removed** from all 3 IAT paradigms in builder. Criteria are never pre-assigned to targets.

### feat: upload error placeholders (participant)
- **IAT targets.** Broken-image placeholder icon with label when target image has `status: "error"` (upload failed). Applies to all 3 paradigms.
- **Eye Tracking.** Warning icon with "The stimulus image could not be loaded. Please contact the researcher." instead of generic "not configured" when stimuli have failed uploads.

### fix: IAT take-note screen keyboard shortcuts
- **Problem.** Take-note screen displayed `← = Chile` / `→ = Estonia` buttons but only Space/Enter were wired as keyboard shortcuts. Arrow keys and A/L did nothing.
- **Fix.** Added ArrowLeft, ArrowRight, A, and L as valid keys to advance from take-note to the first trial.

### quality
- **TypeScript strict** — 0 errors, 0 warnings in all 3 subprojects.
- **Verified:** CORS preflight 204, POST /api/media/upload 401, face-api-models GET 200, all 3 IAT paradigms: priming → text → keypress flow, no auto-advance, no feedback.

---

## v0.95.0 — Mobile gaze tracking for Website Tracking + PDF export fix (2026-08-26)

### feat: mobile gaze calibration in Website Tracking snippet
- **Calibrated eye tracking on mobile.** Website Tracking snippet now supports camera-based gaze tracking for mobile visitors (no cursor data on touchscreens). Researcher enables "Gaze Tracking" toggle in config; visitors complete a brief calibration (5 or 9 points) before browsing.
- **Ridge regression calibration.** 9-feature vector (per-eye iris displacement, average iris, head yaw/pitch, bias) trained via ridge regression with Gauss-Jordan solver. RMSE validation on held-out calibration point; auto-retry up to 2x if error > 150px.
- **One-Euro adaptive filter.** Temporal smoothing on predicted gaze coordinates (Casiez et al. 2012, minCutoff=0.6Hz, beta=0.007). Smooth during fixation, responsive during saccades.
- **Quality classification.** Each gaze sample includes `gazeQuality` (good/fair/low) and `gazeRmse` based on calibration RMSE. Good ≤80px, fair ≤150px, low >150px.
- **720p camera for gaze.** Mobile gaze uses 1280×720 (vs 320×240 for emotions-only) for better iris landmark precision.
- **Calibration persistence.** Weights cached in localStorage (10min TTL). Returning visitors skip calibration within window.
- **Touch fallback.** `touchmove` listener updates cursor position as fallback for non-gaze mobile heatmaps.
- **Visibility resume.** Tab switch handler resumes gaze sampling when gaze is active (also fixed preexisting bug: `sampleEmotion` → `sampleFrame`).
- **Zero backend changes.** Calibrated gaze coords flow through existing `pageX/pageY` → `getMouseAttentionHeatmapData` pipeline.
- **Config.** `captureGaze` toggle + `gazeCalibrationPoints: 5 | 9` (default 9) in tracking config. Builder shows toggle + point selector.

### feat: passive gaze recalibration
- **Tap-as-ground-truth.** Each mobile tap implicitly adds a calibration sample (users look where they tap). After 5 taps, ridge regression retrains with all samples (original calibration + taps, capped at 30). No visible overlay or interruption.
- **Camera fallback.** 720p → 640×480 if the device rejects 1280×720 front camera constraints.

### feat: gaze data source indicator
- **Heatmap badge.** When the "Gaze Focus" layer is active, a badge in the heatmap corner shows "X cursor / Y gaze" with quality color (green=good, amber=fair, red=low). Backend `getTrackingGazeData` returns `dataSource` breakdown.

### feat: I-DT fixation detection in tracking snippet
- **Dispersion-threshold fixation detector.** If calibrated gaze stays within 100px for >200ms, emits a fixation event with centroid coordinates, duration, and timestamp. Fixations flushed alongside gaze samples and returned in gaze analytics response.

### fix: blank PDF exports
- **Root cause.** `ReportGenerator`, `WebTrackingReportButton`, and `ExecutiveSummaryPanel` injected a full HTML document via `container.innerHTML` into a `<div>`. Browser stripped `<html>/<body>` tags, CSS selectors (`body`, `h1`) leaked into the host page, and `html2canvas` captured the container at its host-page offset (e.g., 600px right for side panels) with contaminated styles — producing blank or mispositioned PDFs.
- **Fix.** All three PDF generators now use `window.open()` + `window.print()` (same pattern as Insights Finding). The new tab has its own document — styles don't leak, content renders at (0,0), and the browser's native "Save as PDF" produces correct output. Removed `html2pdf.js` dependency from these components.

### fix: public results page (`/results/:id`)
- **`results-meta` endpoint 500.** Query referenced `research_type_name` (column doesn't exist — needs JOIN to `research_types`) and `stages.position` (column is `display_order`). Fixed with proper JOIN and correct column name. Public results page now loads correctly without authentication.

### fix: tracking snippet JS syntax errors (preexisting)
- `</style>\n` in snapshot CSS inlining produced invalid JS inside the template literal. Fixed: `<\/style>\\n`.
- `\s*` in regex literals rendered as `s*` (TypeScript consumed the backslash). Fixed: `\\s*`.
- 24 snippet integration tests now pass (was 22 pass / 2 fail).

### quality
- **TypeScript strict** — 0 errors, 0 warnings in all 3 subprojects.
- **24 snippet tests, 0 failures.**
- **Production verified:** public results page, PDF export (Report + Executive Summary), Share button — all tested on emotio.cx.

---

## v0.94.6 — Website Tracking heatmap fixes (2026-08-25)

### fix: snapshot CSS inlining for heatmap backdrop
- Tracking snippet v3.4: fetches all `<link rel="stylesheet">` CSS content and embeds it as inline `<style>` blocks in the DOM snapshot. Snapshots are now self-contained — no dependency on the tracked site keeping old assets after redeploy.
- Snapshot-html endpoint strips `<script>` tags before serving (prevents CORS errors from external JS).
- Proxy-asset endpoint exposed publicly (`/public/tracking/:id/proxy-asset`) so snapshot CSS/fonts load without auth token.
- Snapshot size limit raised from 2MB to 4MB to accommodate inlined CSS.

### feat: gaze zone grid overlay in heatmaps
- "Gaze Focus" layer in Heatmaps tab now renders a 3×3 zone grid with percentage labels (same data as Attention tab's Gaze Zone Distribution) instead of diffuse simpleheat points.

### fix: service worker SPA routing
- Fixed SW `handleRequest` to treat navigation requests and extensionless paths as SPA routes (network-first + index.html fallback) instead of cacheable assets.

## v0.94.5 — Public results page + export fixes (2026-08-24)

### fix: blank PDF/PPTX exports
- PDF: offscreen container (`position:fixed; left:-9999px`) was cloned by html2pdf with its styles intact, causing html2canvas to render a blank area. Removed offscreen positioning in `ReportGenerator` and `WebTrackingReportButton`.
- PPTX: added empty-data guard — shows toast "No hay datos de resultados para exportar" instead of generating a 2-slide file with only title + thank-you.
- `vite.config.ts`: preserved `console.error`/`console.warn` in production builds (previously all console methods were dropped).

### feat: public results page
- New route `/results/:id` — public read-only view of research results, no login required.
- Same result components (SmartVOC, Cognitive Tasks, IAT, Eye Tracking, Emotion Analysis) with demographic filters.
- No export buttons, no study configuration, no editing capabilities.
- Backend: public passthroughs for `/public/analytics/*`, `/public/responses/*`, `/public/participants/*`, `/public/modules/*` + new `GET /public/research/:id/results-meta` endpoint.
- `apiClient` supports `setPublicPrefix()` — prepends `/public` to all requests, skips auth headers and token refresh.
- Share button in results page now copies the public URL instead of the authenticated dashboard URL.

### fix: SmartVOC themes count and verbatims
- Theme count and percentage now computed via client-side word matching against actual comments (was using LLM-estimated `theme.count` which could exceed 100%).
- Theme drawer shows all real matching verbatims with sentiment badges (was showing LLM `supportingQuotes`).
- Theme cards always clickable (was gated on `supportingQuotes` existence).

## v0.94.4 — Shelf rotation interval (2026-08-20)

### feat: periodic shelf image rotation during eye tracking
- **Builder.** New "Rotation interval" selector in Eye Tracking shelf config (visible when Randomize is enabled). Options: 5s, 8s (default), 10s, 15s, 20s. Minimum 5s enforced (below that, fixation detection can't collect meaningful data — I-DT needs ~120ms per fixation, 5s guarantees 3-5 fixations per arrangement).
- **Participant.** `ShelfGrid` re-shuffles image positions via `fisherYatesShuffle` every N seconds during the viewing phase. Previously shuffle was one-shot at mount. Rotation only active when `randomize-stimuli` is enabled; otherwise grid stays static.
- **Config key.** `shelf-rotation-interval` (seconds, integer). Backward compatible — missing value defaults to 8s.

### quality
- **TypeScript strict** — 0 errors, 0 warnings in all 3 subprojects.
- **ShelfGrid tests** — 11 pass, 0 failures.

---

## v0.94.3 — Kiosk mode persistence + study logo save (2026-08-20)

### fix: Kiosk mode reverts to "Panel" on reload (and corrupts on save)
- **Root cause 1 (display).** `ResearchConfigurationModule` used `useState` initializer to read `config.participationMode`, but on first render the config wasn't yet populated by `flattenResearchConfig` (async useEffect). The state initialized to `'panel'` and never synced. Fixed with `useEffect` sync.
- **Root cause 2 (data corruption).** `transformResearchConfigComponentValues` defaulted `participationMode: 'panel'` in its initial config object (line 68). When the user saved ANY config change (e.g., a backlink), the transform always emitted `participationMode: 'panel'`, overwriting the server's `'kiosk'` via `{ ...activeModule.config, ...structuredConfig }`. This silently corrupted the value — the Thank You screen then stopped appearing because the auto-redirect logic (line 173) only skips for `participationMode === 'kiosk'`.
- **Fix.** Removed `participationMode` default from transform initial config. Added server value fallback in the config prop: `componentValues.participationMode || activeModule.config.participationMode || 'panel'`. Now: first render shows server value, save only writes participationMode when the user explicitly changed it.

### fix: Study logo upload doesn't persist
- **Root cause.** `transformResearchConfigComponentValues` had no handler for `studyLogo` key. The value was stored in `componentValues` but dropped when reconstructing the structured config for save. Similarly, `flattenResearchConfig` didn't extract `studyLogo` when loading.
- **Fix.** Added `studyLogo` handler to both `transformResearchConfigComponentValues` and `flattenResearchConfig` in `researchBuilderHelpers.ts`. Added server fallback for studyLogo in config prop (same pattern as participationMode).

### quality
- **TypeScript strict** — 0 errors, 0 warnings in all 3 subprojects.

---

## v0.94.2 — Thank You kiosk fix, PDF blank pages, results share button (2026-08-20)

### fix: Thank You screen invisible in kiosk mode
- **Root cause.** `useKioskMode` set `kioskTransition = true` immediately when `currentStep` became `'thank-you'`. Since `KioskTransitionScreen` is an early-return in `ResearchPage.tsx` (line 506), it replaced the render before the Thank You content ever appeared. Participants saw a spinner ("Preparing next session...") instead of the Thank You message.
- **Fix.** Moved `setKioskTransition(true)` from before `setTimeout` to inside it (`useKioskMode.ts:43`). Thank You now renders for 15s (was 4s), then transition screen shows during async reset.
- **Impact.** CX TADI participants can now read and copy the discount code (`ENCUESTA20`) before kiosk resets.

### fix: PDF report blank pages
- **Root cause.** `html2pdf.js` configured with `pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }`. `avoid-all` treats every element as indivisible — when elements don't fit remaining page space, they cascade to next page leaving blank pages behind.
- **Fix.** Removed `'avoid-all'` from pagebreak mode in `ReportGenerator.tsx` and `WebTrackingReportButton.tsx`. Now uses `['css', 'legacy']` which only breaks on explicit CSS page-break rules.

### feat: Share button in research results
- **Problem.** Share/copy-link buttons existed in View Progress (`ResearchInProgressContent.tsx`) but were never implemented in the Results page.
- **Fix.** Added "Share" button to `ResearchResultsPage.tsx` toolbar (next to Summary). Copies current URL to clipboard with visual feedback (check icon + "Copied!" for 2s).

### quality
- **TypeScript strict** — 0 errors, 0 warnings in all 3 subprojects.
- **1120 tests, 0 failures** in participant-frontend.

---

## v0.94.1 — Screener builder fix + demographics disqualification visibility (2026-08-14)

### fix: Screener builder — "can't add options"
- **Root cause.** `singleChoiceLocked` confused "Single Choice" (participant picks one from many) with "one option row." When Choice Type was "single," the builder trimmed to 1 option, hid "Add another choice," and blocked delete. A screener with 1 option is useless.
- **Fix.** Removed `singleChoiceLocked` entirely. Single/Multiple only affects participant UI (radio vs checkbox), not how many options the researcher can create. Minimum always 2.
- **Deleted dead code.** `useScreenerSingleChoiceTrim`, `useScreenerMultipleChoiceGroupPad`, `screenerBuilder.ts` — all artifacts of the broken concept.

### fix: Screener participant gate — skip unconfigured screener
- **Root cause.** `isModuleConfigured` for Screener only checked if a component with `choice-` existed in its ID. The Choice Type selector (`screener-choice-type`) matched `choice-`, so any screener — even empty — was considered configured. Participants saw a blank dropdown with no question.
- **Fix.** Now verifies question text AND at least one choice with a non-empty label. Without both, the screener step is skipped.

### fix: Demographics — show all age/country ranges including disqualifying
- **Problem.** When `validValues` was missing (legacy studies), `getOptionsForDemographic` fell back to `validAges` which only contained qualifying ranges. Disqualifying options (e.g. 55-64, 65+) were hidden from participants instead of shown and blocked server-side.
- **Fix.** Fallback now concatenates `validAges + disqualifyingAges` (and `validCountries + disqualifyingCountries`). Backend `checkDisqualifications()` handles the blocking.

### chore: docs/ cleanup (115MB → 14MB)
- Removed `cooltool-frames/` (700 jpgs), `emotions-frames/` (82 jpgs), `app-cooltool.mp4` (63MB), legacy specs, Python scripts, credentials README.
- Preserved `design-system/` (active spec) and eval harness files (`gaze-capture.webm`, `ground-truth.json`, `metadata.json`).
- Simplified `.gitignore` credentials rule, removed dead `cpanel-runbook.md` reference from CLAUDE.md.

### quality
- **TypeScript strict** — 0 errors, 0 warnings in all 3 subprojects.

---

## v0.94.0 — IAT paradigm corrections + Website Tracking mouse-attention heatmap (2026-08-12)

### fix: IAT Attribute Testing (Implicit Priming Test) — 3 critical corrections
- **Priming inverted.** Criterion now flashes as the prime (200-400ms) before the target appears as the stimulus. Previously the target was shown simultaneously as secondary text — made the task explicit instead of implicit.
- **Target selector inverted.** Builder now shows the target assignment selector for Attribute Testing (where researchers must assign criteria to targets) and hides it for Comparing Attribute (where assignment is irrelevant). Was backwards.
- **Practice contamination.** Block-1 practice trials (classify targets alone) excluded from score computation and D-score calculation. Previously practice RT contaminated test metrics.
- **Compound stimulusId.** Step 2 trials now use `criterionId__targetId` format so analytics can trace which prime was shown for each response and compute congruent vs incongruent RT.

### fix: IAT Objects Comparing (Classic IAT) — Greenwald 7-block structure
- **7 blocks.** Replaced 3-block structure with the standard Greenwald et al. (1998) 7-block IAT:
  - Block 1: Target practice (A=left, B=right)
  - Block 2: Attribute practice (Good=left, Bad=right)
  - Block 3: Congruent combined practice
  - Block 4: Congruent combined test (40 trials)
  - Block 5: Target practice REVERSED (B=left, A=right)
  - Block 6: Incongruent combined practice
  - Block 7: Incongruent combined test (40 trials)
- **D-score.** Now computed from congruent (blocks 3,4) vs incongruent (blocks 6,7) as per Greenwald improved method, instead of the previous block-2 vs block-3 comparison which measured cognitive interference, not implicit association.
- **Phase labels.** Error analysis shows readable labels: Target Practice, Congruent Test, Incongruent Test, etc.

### feat: Website Tracking mouse-attention heatmap
- **Gaze Focus layer.** New "Gaze Focus" toggle (orange) in the heatmap toolbar. Renders a simpleheat heatmap from cursor positions weighted by iris-based gaze attention score — mouse position is the spatial signal, iris tracking validates attention.
- **Backend.** `getMouseAttentionHeatmapData()` aggregates `pageX/pageY` from gaze samples, weighted by attention score (0-1). Points with score=0 (away) are discarded. Coordinates normalized to viewport-width percentage (same system as click heatmap).
- **Endpoint.** `GET /tracking/:id/mouse-attention?page=URL&device=X`.
- **Snippet.** Gaze samples now include `pageX/pageY` (absolute position with scroll) alongside existing `cursorX/cursorY` (viewport-relative). Backward compatible — aggregation falls back to `cursorX/cursorY` for pre-v0.94 data.

### quality
- **TypeScript strict** — 0 errors, 0 warnings in all 3 subprojects.

---

## v0.93.1 — Website Tracking fixes: emotions/gaze fallback, replay modal, status activation (2026-08-10)

### fix: emotions/gaze tabs show data
- **Page fallback.** Emotions and Attention tabs now auto-fallback to all-pages-combined data when the selected page has no emotion/gaze samples. Previously showed empty state even when other pages had data.
- **DB migration.** `gaze_samples LONGTEXT` column added to `tracking_sessions` (was missing in production).
- **face-api.js models.** Uploaded to `media/face-api-models/` on server — snippet emotion capture requires these models to initialize the camera pipeline.

### fix: Website Tracking status activation
- **Sidebar status button.** Website Tracking researches now show a clickable status badge (like other research types) instead of a static "Tracking" label. Researchers can activate/deactivate from the sidebar via StatusModal.

### fix: Session Replay modal sizing
- **Wider modal.** `90vw/1200px/85vh` → `95vw/1600px/90vh` — accommodates wide viewport recordings without cutting.
- **Proportional scale.** `fitScale` now considers both width AND height (`min(parentW/vpW, parentH/vpH, 1)`), sets frame height explicitly.

### fix: Eye Tracking results tabs
- **ViewModeTab icon optional.** `icon` prop now optional (was required but unused after text-only compaction).
- **AOI modal `modulesService.get`** → `modulesService.getById` (correct method name).
- **AOI modal config access** via `res.module.config` (not `res.config`).

---

## v0.93.0 — Eye Tracking builder UX, quality pipeline, consistency sweep + onboarding (2026-08-09)

### feat: Eye Tracking builder — zero-scroll layout
- **AOI as modal.** "Draw AOI" button with badge next to Task Instructions opens fullscreen modal with `AOIDrawer`. Replaced inline AOI section that caused scroll.
- **AI priming suggestion.** `POST /media/analyze-complexity` sends stimulus to Gemini Flash, returns `{suggestedSeconds, reason}`. Clickable suggestion below priming time selector auto-applies the value.
- **Live Test.** "Live Test" button in builder header opens participant-frontend in iframe (`?preview=true`). Researcher experiences the exact same flow participants will use — quality gate, calibration, stimulus, data capture.
- **Layout compacted.** Removed `minHeight: 380` from stimuli column, reduced grid gaps, Techniques panel aligned to row 1.

### feat: eye tracking quality pipeline (shared)
- **`deviceProfile.ts`** — 7 new fields per device: `maxCalibrationRmsePx` (desktop 80, mobile/tablet 120), `rejectCalibrationRmsePx`, `gazeCollectIntervalMs` (desktop 50ms, mobile 30ms), `requireFullscreen`, `requireLandscape` (mobile/tablet only), `faceLostPauseThresholdS`, `headPoseDriftThresholdDeg`.
- **`sessionQualityChecks.ts`** — 3 new pre-calibration checks: `checkFullscreen()`, `checkLandscape()`, `checkHeadPose(yaw, pitch)`.
- **`runtimeQualityMonitor.ts`** — new module for stimulus viewing: face-loss pause (configurable threshold), orientation change listener, head pose drift detection for micro-recalibration trigger.
- **`EyeTrackingRenderer`** — now saves `viewportWidth`/`viewportHeight` in response payload.

### feat: fixation coordinate normalization
- **Backend** (`eye-tracking.analytics.ts`): fixations normalized to percentage (0-100) before sending to frontend. Uses `viewportWidth/Height` when present; auto-detects legacy viewport-pixel coords (>100) and scales proportionally.
- **Frontend**: `ScanpathOverlay`, `FirstLookOverlay`, `TransparencyMap` all handle percent coords. `HeatmapRenderer` switched to `coordSystem="percent"`.
- **TTFF fix**: Time To First Fixation now relative (first AOI fixation - first global fixation), not absolute Unix timestamp.

### feat: Website Tracking Friction tab
- **`TrackingFrictionTab`** — new results tab: summary cards (total events, types, % sessions affected), breakdown bars (rage-click, dead-click, speed-browsing, mouse-out), per-session friction tags list.
- Backend endpoints `GET /friction` and `GET /friction/sessions` already existed — tab wires them into the UI.

### feat: Research Configuration tabs
- **4-tab layout**: Setup (participation mode + demographics side-by-side), Links & QR (backlinks + share URL side-by-side), Settings (link config + participant limit), Participants (CSV import + panel).
- Eliminated vertical scroll in Research Configuration.

### feat: guided empty states (onboarding)
- **17 files, ~25 empty states** upgraded from plain "No data yet" to guided next-step CTAs.
- **Tier 1**: Dashboard ("New Research" CTA), SmartVOC/Eye Tracking/Screener/IAT results ("Share the study link"), ParticipantsTable ("Import via CSV or share link").
- **Tier 2**: EmotionPanel ("Enable Emotion Recognition"), VOCComments, NEVQuestionCard, FunnelChart ("Define conversion funnels").
- **Tier 3**: UserManagement, ResearchTypes, Modules, Clients, History, ShareResearchDrawer — all with contextual guidance.

### feat: AI stimulus complexity analysis
- **`POST /media/analyze-complexity`** — backend endpoint. Reads image from filesystem, sends to Gemini Flash with eye-tracking-specific prompt, returns `{suggestedSeconds: 5-30, reason}`. Fallback 10s when no API key.
- **Frontend**: `analyzeStimulusComplexity()` in media service. Auto-triggers on stimulus upload in Eye Tracking builder.

### ui: consistency sweep
- **Spanish → English**: ~120+ hardcoded Spanish strings translated across 22 files (error pages, toasts, validations, AI analysis panel, attention prediction, hitzones, SmartVOC, IAT, admin).
- **Native `<select>` → `CustomSelect`**: 13 files migrated (dashboard, tracking, eye tracking overlays, ranking editor, quotas, city config, modules, admin).
- **`CustomSelect` smooth transitions**: fade+scale 150ms on open/close, applied globally via base component.
- **Skeleton improvements**: ResearchPage, ResearchHistoryPage, ClientsPage — header/filters always visible, skeleton only in content area.
- **Builder header**: `mb-8 pb-4` → `mb-3 pb-3` (eliminated dead space).
- **Research Tracking page**: table scroll internal (header sticky), not page-level.
- **Dashboard table**: added `bg-white` (was transparent).
- **Eye Tracking Results**: tabs compacted (text-only, no icons), AOI as overlay on image + modal for metrics/drawing. Download as icon-only button.
- **Enterprise filter** on Research page → CustomSelect.

### fix: data integrity
- **Participant name dedup**: `research-in-progress.service.ts` uses `p.name`/`p.email` from JOIN, not `participant_id` for both fields.
- **Status labels**: backend sends English (`In progress`, `Completed`, `Not started`, `Over quota`, `Disqualified`).
- **Orphan media cleanup**: fixed research with missing stimulus file via DB update.

### test gauntlet (90 tests)
- **Backend** (35): stimulus-complexity service (15), fixation normalization + TTFF (10), research-in-progress status labels (10).
- **Participant-frontend** (55): runtimeQualityMonitor (19), sessionQualityChecks new functions (14), deviceProfile new fields (22).

### quality
- **TypeScript strict** — 0 errors, 0 warnings in all 3 subprojects.

---

## v0.92.0 — Website Tracking gauntlet: 206 tests + probabilistic gaze zones (2026-08-03)

### test gauntlet — website tracking (full feature coverage)
- **206 new tests** across backend and research-frontend. Coverage: controller routing (69), service functions (51 new), report service (22), gaze logic (9 new), gaze analytics (3 new), research-frontend service client (33), ScrollDepthChart (5), TrackingEmotionsTab (6), TrackingAttentionTab (6).
- **Backend controller** (`tracking.controller.ts`, 850 lines) — 0 → 69 tests. Public routes (CORS, script.js, session validation, events, rrweb, snapshot size limits, emotions/gaze sample caps, emotion-video). Authenticated routes (38 endpoints: config, verify, overview, pages, heatmap, element-clicks, sessions, scroll, rrweb, funnels, export, friction, snapshot, attention, visitors, live, emotions, gaze, snippet, screenshot, report). Auth error classification.
- **Backend report service** (`tracking-report.service.ts`, 254 lines) — 0 → 22 tests. Cache read (5), LLM generation with conditional data gathering (17), OpenAI mock, config caching.
- **Backend service expanded** (`tracking.service.ts`, 1512 lines) — 19 → 70 tests. 20 previously untested functions: `getElementClickData`, `getRecentSessionCount`, `getTrackedPages`, `getSessions`, `savePageSnapshot`, `getFrictionSummary`, `getSessionFrictionTags`, `getPageSnapshotHtml`, `getAttentionHeatmapData`, `getVisitorJourneys`, `getLiveSessions`, `savePageScreenshotFromBase64`, `getSessionEvents`, `appendRrwebEvents`, `getRrwebEvents`, `computeFunnelDropoff`, `appendEmotionSamples`, `appendGazeSamples`, `saveEmotionVideo`, `getSessionEmotionSamples`.
- **Research-frontend service client** — 0 → 33 tests. All ~27 tracking API functions verified for correct endpoints, params, response unwrapping.
- **Research-frontend components** — 5 → 22 tests. ScrollDepthChart (loading, empty, bars, colors), TrackingEmotionsTab (loading, empty, distribution, summary, canvas, sessions), TrackingAttentionTab (loading, empty, grid, score, states, sessions).
- **Coverage thresholds added.** `tracking-gaze.analytics.ts` 80% lines/functions, `tracking-report.service.ts` 70% lines/functions.

### feat: probabilistic gaze zone distribution
- **`computeQuadrantProbabilities()`** in `tracking-gaze-logic.ts`. 2D Gaussian over 9 quadrant centroids — each iris sample produces a probability distribution instead of a single discrete zone. σ = direction thresholds (0.08 horizontal, 0.06 vertical). Center gaze spreads ~45% center, ~25% adjacent, ~5% corners.
- **Snippet v3.4.** `quadProbs` inline function sends `quadrantProbs: {center: 0.45, ...}` alongside discrete `quadrant` (backward compatible). New sessions use probabilistic; old data falls back to discrete.
- **Backend weighted aggregation.** `tracking-gaze.analytics.ts` reads `quadrantProbs` when present, accumulates weighted counts per quadrant. Falls back to discrete `quadrant` for pre-v0.92 data.
- **Frontend label.** TrackingAttentionTab grid description: "Probabilistic area estimation — each sample spreads across zones based on iris uncertainty. Not exact gaze."

### quality
- **2,155 tests, 0 failures** across all 3 subprojects (participant: 1065, backend: 483, research: 607). Previously: 1,921.
- **TypeScript strict** — 0 errors, 0 warnings in all 3 subprojects.

---

## v0.91.0 — Bob Martin test gauntlet: eye tracking + website tracking gaze (2026-07-31)

### test gauntlet — eye tracking (Bob Martin methodology)
- **450+ new tests** across 15 previously untested eye tracking modules. Unit tests, boundary precision, integration tests, and golden-file replay from real MediaPipe landmarks (`docs/gaze-capture.webm` → 21-frame fixture).
- **Mutation testing expanded.** Stryker scope: 6 → 18 files (participant-frontend), 1 → 3 files (backend). Break threshold enforced at 50% (was `null`). Scores: oneEuroFilter 96.77%, gazeGapFill 84.29%, hybridCalibrationField 79.53%, tracking-gaze-logic 77.42%, fixationDetector 75.00%, hybridZoneGrid 70.41%, facsClassifier 55.56%.
- **Coverage thresholds.** 18 per-file gates in participant-frontend (80% lines/functions), 4 in backend (60-80%). Enforced in vitest config — build fails if coverage drops.
- **Integration tests.** 9 cross-module pipeline tests: filter→fixation→zone, calibration→correction, gap-fill→heatmap, Ridge→uncertainty→heatmap, emotion→aggregation, zone-weights→AOI. 16 golden-file replay tests with real-world MediaPipe landmarks.
- **Files tested:** ridgeRegression (35), facsClassifier (37), fixationDetector (42), oneEuroFilter (19), gazeGapFill (22), calibrationStore (24), hybridCalibrationField (54), hybridZoneGrid (72), uncertaintyEstimator (28), probabilisticHeatmap (25), featureExtraction (18), microExpressionDetector (16), eye-tracking.analytics (52), spotlightRender (26), coldMapRender (7).
- **Flaky test fix.** `zoneClassifier` performance test threshold 50ms → 200ms (CI load variance).

### feat: website tracking gaze attention
- **MediaPipe FaceLandmarker in tracking snippet.** Replaces face-api.js as primary (face-api.js kept as fallback). Enables iris tracking + FACS emotion from single model (478 landmarks). Dynamic `import()` for ES module loading.
- **Iris-based gaze zone detection.** `tracking-gaze-logic.ts`: 6 pure functions — `computeIrisDisplacement`, `estimateGazeDirection` (3×3 grid), `estimateAttentionState` (engaged/distracted/away), `gazeMatchesCursorArea`, `computeAttentionScore` (0-1). 52 tests, 77% mutation score.
- **Cursor-gaze correlation.** Cursor = primary attention signal, iris = validation. Score: 1.0 (engaged + gaze matches cursor), 0.7 (engaged elsewhere), 0.3 (distracted), 0 (away).
- **FACS emotion inline.** AU extraction from MediaPipe 478 landmarks inlined in snippet (same formulas as `facsClassifier.ts`). Transparent classification vs face-api.js black box.
- **Backend.** `POST /public/tracking/:id/gaze` endpoint, `appendGazeSamples` service, `tracking-gaze.analytics.ts` aggregation (quadrant distribution, attention distribution, timeline, per-session). 10 analytics tests.
- **Frontend.** "Attention" tab in Website Tracking results: 3×3 zone heatmap grid, attention state bars (engaged/distracted/away), attention score timeline, session list.
- **Snippet integration tests (24).** JS validity (`new Function` parse), FACS inline parity, head pose matrix→yaw/pitch extraction (6 rotation matrix tests), data contract validation (snippet output ↔ analytics input), iris landmark index verification.
- **Migration 034.** `gaze_samples LONGTEXT` column on `tracking_sessions`.

### feat: expression-weighted circumplex V/A
- **Snippet sends full expression vector.** `{expressions: {joy: 0.6, neutral: 0.3, ...}}` alongside dominant emotion. Backward compatible.
- **Backend weighted V/A.** `computeVA` uses all 7 expression probabilities for continuous Valence/Arousal positioning instead of 7 fixed lookup points. Falls back to lookup for pre-v0.91 data. 5 new tests.

### feat: RFF enabled in production eye tracking
- **Random Fourier Features** (`D=128, sigma='auto', seed=42`) activated in `EyeTrackingRenderer`. Approximates RBF kernel for nonlinear eye-screen mapping. Was implemented but disabled.

### ui: accuracy claims adjusted
- **Research builder.** Eye Tracking notes: "Gaze tracking reveals..." → "Webcam-based attention tracking... Zone-level accuracy."
- **Participant.** Quality gate: "accurate tracking" → "attention tracking". Validation: "verify accuracy" → "verify calibration". "Accuracy is low" → "Quality is low" (EN + ES).
- **Website Tracking.** Emotion tab: "Expression Intensity" → "Expression Distribution" + methodology note. "Circumplex Model" → "Affect Space". Config: note under Emotions toggle about webcam-based estimation.

### quality
- **1921 tests, 0 failures** across all 3 subprojects (participant: 1065, backend: 329, research: 551). Previously: ~1300.
- **TypeScript strict** — 0 errors, 0 warnings in all 3 subprojects.

---

## v0.90.1 — Test gauntlet: coverage, repaired suites, mutation testing (2026-07-27)

### tooling
- **Coverage instrumentation in all 3 subprojects.** `@vitest/coverage-v8` + `coverage` block in each `vitest.config.ts` (`reportOnFailure: true` so a red suite still reports). New `test:coverage` script in backend and participant-frontend. Baseline measured: backend 4.37%, research-frontend 6.89%, participant-frontend 14.34% lines.
- **Mutation testing.** Stryker (`@stryker-mutator/core` + `vitest-runner`) in backend and participant-frontend, `npm run test:mutation`. Scoped to `tracking-emotion.analytics.ts` and the Eye Tracking V2 zone pipeline. No global threshold set — coverage today would fail any meaningful gate.
- **`participant-frontend` `test` script ran vitest in watch mode**, so it never terminated in CI. Now `vitest run`; watch moved to `test:watch`.
- **.gitignore**: `coverage/`, `reports/mutation/`, `.stryker-tmp/`.

### fixes — emotion analytics (found by the new tests)
- **Empty study reported `joy` as the dominant emotion.** With zero samples every count ties at 0 and the sort returned the first-listed emotion. Now returns `neutral`.
- **Unrecognized emotion labels polluted the figures.** Samples arrive from an uncontrolled browser; a label outside the 7 Ekman emotions was counted in `totalSamples` and could surface as `dominantEmotion` despite never appearing in the distribution. Added `isValidSample` boundary validation (known emotion + finite confidence + finite timestamp).
- **Distribution did not sum to 100%** whenever junk samples were present (consequence of the above). Now guarded by an explicit test.
- Non-numeric `confidence` (`NaN`, strings) entered the average. Rejected by the same guard.

### tests — repaired suites (45 failures, all stale assertions)
- **backend `tracking.service.test.ts` (3).** `createSession` now issues 3 queries, not 4 (a SELECT was replaced by `INSERT IGNORE` to close a race). `getTrackingConfig` deliberately no longer checks status — `script.js` must be servable in draft to verify snippet installation, and `createSession` enforces active status independently; the test now pins that contract. `getScrollDepthData` derives its total by summing buckets (one bucket per session after the `MAX`), so 20 was the correct answer.
- **research-frontend `heatmapPalette.test.ts` (32).** Asserted a blue→violet palette reverted in v0.84.2, and imported `VIDEO_HEATMAP_COLORS` — a symbol removed in v0.85.0. Rewritten against the real contract: images use the warm ramp (blue channel 0 in every stop, green→red monotonic), videos use the FLIR thermal gradient. 85 tests.
- **research-frontend `renderGridComposite.test.ts` (8).** Canvas mock lacked `measureText` and `roundRect`, both used by the renderer. `measureText` approximates 0.6em per character since the renderer drops labels that overflow their cell.
- **research-frontend `thermalContrast.test.ts` (1).** `REBALANCED_THERMAL_STOPS` deliberately ends at dark red `#b40000`; the test demanded literal `#ff0000`.
- **research-frontend `attentionPrediction.p6.test.ts` (1).** The Original tab now enables no overlays — the bare stimulus. Contradicts the P6 spec from v0.81.0, which asked for a composite view; test updated to the implemented behavior.

### tests — emotion pipeline (new)
- `tracking-emotion.analytics.test.ts`: 43 tests covering query construction, malformed input, distribution percentages, per-session summaries, 1-second timeline bucketing and Russell circumplex mapping. Coverage 0% → 100% lines, mutation score 92.64% (remaining survivors are equivalent mutants on unreachable guards).

### tests — Eye Tracking V2 `zoneRegistry` (mutation-driven)
- Mutation score **67.96% → 99.45%** (51 survivors → 1), 54 → 85 tests. Line coverage was already 98.7% — the gap was invisible to coverage.
- **Edge containment.** The existing boundary test asserted only `not.toBeNull()`, so `px <= r.x + r.width` could flip to `<` unnoticed — silently reassigning every gaze landing on a stimulus's far edge. Now pins all four edges, corners, one-pixel-outside and sub-pixel-outside.
- **Shared-edge tie-breaking.** Adjacent zones both contain a point on their shared edge; which one wins was left to insertion order and never asserted. Now pinned (first registered wins; priority still outranks it), including internal grid lines.
- **Grid labels.** All 21 zone label strings could be blanked to `""` with the suite still green. A 10×10 grid now pins every row and column name, plus numbered fallbacks and the 3×3 special case — which had no test distinguishing a 3×5 grid from a 3×3.
- **ResizeObserver wiring.** jsdom ships no `ResizeObserver`, so the registry always ran with `observer === null` and none of the observe/unobserve/disconnect paths executed under test. Added a stubbed observer plus coverage of the no-support environment.
- V2 pipeline mutation score overall: 83.33% → 93.89%.

### refactor
- `THERMAL_GRADIENT` moved from `VideoAccumulatedHeatmapOverlay.tsx` to `utils/thermalContrast.ts`. Exporting constants from a component file breaks fast refresh, and the other thermal palettes already live there.

---

## v0.90.0 — Website Tracking: Emotion Recognition (2026-07-25)

### backend
- **Emotion capture endpoints.** `POST /public/tracking/:id/emotions` saves face-api.js emotion samples (JSON array) to `tracking_sessions.emotion_samples` (LONGTEXT). `POST /public/tracking/:id/emotion-video` saves WebM webcam recording to filesystem (base64, 15MB cap).
- **Emotion analytics endpoint.** `GET /tracking/:id/emotions?page=URL` aggregates emotion data across sessions: distribution (7 Ekman emotions as %), dominant emotion, avg confidence, 1-second timeline, Valence/Arousal (Russell's circumplex), per-session summary with video flag.
- **Emotion video streaming.** `GET /tracking/:id/sessions/:sid/emotion-video` streams stored WebM file.
- **Config extension.** `captureEmotions` and `emotionVideoEnabled` added to `TrackingConfig`. Passed to snippet as `C.emotions`, `C.emoVideo`, `C.emoModelUrl`.

### participant-facing (tracking snippet)
- **Emotion capture in snippet.** When `captureEmotions` enabled: requests camera (320x240), lazy-loads face-api.js from CDN + models from `emotio.cx/api/media/face-api-models/`, runs `detectSingleFace().withFaceExpressions()` at 2fps (500ms interval). Scores accumulated in `emoBuf[]`, flushed on session end (visibilitychange/beforeunload). 5-minute active cap (same as rrweb). Visibility-aware: pauses on tab hidden, resumes on visible.
- **Video recording in snippet.** When `emotionVideoEnabled` enabled: `MediaRecorder` on camera stream (WebM VP8), chunks in memory, uploaded as base64 on session end (best-effort async).
- **Graceful degradation.** Camera denial silently continues without emotions — no breakage of existing tracking.

### research-frontend
- **Config toggles.** "Emotions" and conditional "Record Video" toggles in WebsiteTrackingConfig capture section.
- **Emotions results tab.** New "Emotions" tab in WebsiteTrackingResults with: summary cards (sessions, samples, dominant, confidence), Expression Intensity bars (7 emotions with %), Circumplex Model canvas (emotion dots sized by distribution + V/A trail), Valence & Arousal Timeline canvas (red/yellow lines), session list with emotion dot + video icon.

### database
- **Migration 032.** `ALTER TABLE tracking_sessions ADD COLUMN emotion_samples LONGTEXT, ADD COLUMN emotion_video_path VARCHAR(500)`.

---

## v0.89.6 — UI refresh: Modules page (2026-07-24)

### research-frontend
- **Modules page refresh.** Header/search/sort consistent. Tab active style: black underline + white-on-black count. Cards: rounded-xl, hover-reveal actions, 13px/11px text, smaller icon/badges. Bulk actions bar rounded-xl. Proper scrollable layout with overflow control. Removed SearchInput import.

---

## v0.89.5 — UI refresh: Research Types page (2026-07-24)

### research-frontend
- **Research Types page refresh.** Two-column layout with rounded-xl cards, hover-reveal actions (edit/delete/assign), inline search replacing SearchInput component, FileText/FlaskConical differentiated icons, column headers with count badges. Compact 13px cards, line-clamp descriptions. Removed Button/SearchInput imports.

---

## v0.89.4 — UI refresh: Clients page (2026-07-24)

### research-frontend
- **Clients page refresh.** Same visual language as History: clean chart axes, status dot badges, hover-reveal table actions, latest project cards with dot status, rounded-xl containers, 13px font. Removed Button/Eye/Legend imports.

---

## v0.89.3 — UI refresh: Research History page (2026-07-24)

### research-frontend
- **Research History page refresh.** Chart: cleaner axes (no lines/ticks), vertical grid removed, emerald/blue/amber colors, tooltip rounded. Client info: rounded-xl, stats cards rounded-lg, 11px section headers. Table: status dots, hover-reveal actions, click-to-open rows, 13px font. Skeleton/empty states consistent. Removed unused Button/Legend imports.

---

## v0.89.2 — UI refresh: Research Tracking page (2026-07-24)

### research-frontend
- **Research Tracking page refresh.** Replaced inline thead filters with top-bar search + dropdowns (research, action). Action badges colored by type (created/updated/deleted/archived). Table: 13px, rounded-xl, hover transitions. Skeleton/empty/error states consistent with dashboard. Simplified from 5 filter inputs to 3 controls.

---

## v0.89.1 — UI refresh: Research page (2026-07-24)

### research-frontend
- **Research page refresh.** Cards: compact `rounded-xl`, status dots, hover-reveal actions, 12px metadata, `line-clamp-1` description, click-to-open. Table: 13px font, status dots, hover-reveal actions, removed "Updated" column. Header: title + count + view toggle + Invite/New Research aligned. Filters: consistent with dashboard (search, dropdowns, archive toggle). Modals/drawers: `rounded-xl`, 13px font. Empty states refined.

---

## v0.89.0 — UI refresh: sidebar, login, dashboard (2026-07-24)

### research-frontend
- **Sidebar refresh (Linear-style).** Grouped navigation (Main + Manage sections), user avatar with initials + name/email footer, active indicator bar (3px blue left border), 13px font, PanelLeftClose/PanelLeft toggle, 240px→60px collapse. Consistent rounded-xl + `border-gray-200/60` borders.
- **DashboardLayout.** Background `#f4f5f7`, padding/gap 3 (tighter), main content `rounded-xl` with subtle border.
- **Login page.** Logo above card, title "Sign in to EmotioX", `rounded-2xl` card, `active:scale-[0.98]` on Google button, Terms footer.
- **Dashboard Home.** Greeting header "Welcome back, {name}" + "New Research" button. Summary cards with sparklines (researches/participants over time) and month-over-month trends. Status filter pills (Active/Draft/Completed) with colored dots alongside type pills. Actions column hidden by default, revealed on row hover. Status badges with dot indicator. Removed redundant Status card from right panel. Date format "Jul 24, 2026". Duplicate modal rounded-xl.

---

## v0.88.2 — Eye Tracking: preview modal + video view mode guards (2026-07-24)

### research-frontend
- **Eye Tracking Preview Modal.** New `EyeTrackingPreviewModal` component shows stimulus preview (stand_alone/shelf/video), AOI overlay, config summary (duration, emotion recognition, display mode), and simulated calibration phase. Preview button added to `CognitiveTaskModuleCard` for Eye Tracking modules — same pattern as IAT preview.
- **Video view mode guards.** `StimulusCard` hides image-based tabs (Scan Path, First Look, Transparency, Image) for video stimuli — these use `<img>` tags that can't render video files. Video stimuli default to Video Gaze tab when gaze data exists.

---

## v0.88.1 — Fix: Eye Tracking test page calibration + raw iris coords (2026-07-24)

### participant-frontend
- **Raw iris coords pre-calibration.** `useMediaPipeGaze` now computes screen coordinates from iris landmarks (468/473 avg, mirrored) even before Ridge predictor is trained. Previously `gazePosRef` and `rawScreenRef` were null pre-calibration, blocking any gaze-dependent logic during setup.
- **Click-based calibration in test page.** Replaced dwell-based calibration with click-to-confirm in `EyeTrackingV2TestPage`. Raw iris tracking produces compressed coords near screen center — dwell detection either never triggered (corners) or auto-triggered everything (center). Click is reliable regardless of pre-calibration accuracy.
- **Calibration debug panel.** Shows gazeState, gazePos, rawScreen, model status, and engine during calibration phase for live diagnostics.

---

## v0.88.0 — Eye Tracking: video gaze pipeline improvements (2026-07-24)

### research-frontend
- **Demographic filter for gazeTimeline.** `EyeTrackingResults` now filters `gazeTimeline` by selected demographic participant IDs. Previously video gaze overlay showed all participants regardless of active filters.
- **Participant selector in VideoGazePlayer.** Dropdown to view gaze from individual participants or all combined. Same pattern as ScanpathOverlay.
- **Temporal heatmap overlay.** VideoGazePlayer toggle between Dots (original) and Heatmap modes. Heatmap uses simpleheat with warm gradient (green→yellow→red), 1s accumulation window synced to video playback at 15fps.
- **Video quality badges.** `StimulusCard` shows Completion rate, Gaze Coverage %, and Video Duration when video stimulus detected.
- **V3 temporal density modes.** Density tab shows Density / First Look / Peak Time toggle for video stimuli with V3 data. First Look = earliest attention per cell, Peak Time = moment of maximum density contribution.

### participant-frontend
- **V3 temporal metadata.** `ProbabilisticHeatmap` now tracks per-cell `firstAttentionS` (earliest videoTime) and `peakTimeS` (videoTime of highest density contribution) during `addSample`. New `videoTimeS` parameter. Payload includes `firstAttentionBase64` and `peakTimeBase64` for video stimuli.

### backend
- **Video quality metrics.** `getEyeTrackingResults` computes `videoQuality`: completion rate (`videoEnded` flag), gaze coverage (% of 500ms bins with data), video duration. Only for video stimuli.
- **V3 temporal aggregation.** `extractV3Heatmap` aggregates `firstAttentionBase64` (min across participants) and `peakTimeBase64` (from participant with highest cell density). `V3AggregatedHeatmap` includes `hasTemporalData`, `firstAttentionBase64`, `peakTimeBase64`.

---

## v0.87.1 — Fix: Google OAuth "Premature close" on cPanel (2026-07-22)

### backend
- **Bypass undici for Google token exchange.** `exchangeGoogleCode` now uses stdlib `https.request` (HTTP/1.1) instead of `client.getToken()` which relies on `gaxios`/`undici` native fetch. Node 24 + cPanel LVE causes systematic "Premature close" on HTTP/2 connections to `googleapis.com/token`. ID token decoded directly from JWT payload (safe — received over TLS).

---

## v0.87.0 — Eye Tracking V3: probabilistic heatmap end-to-end (2026-07-13)

### participant-frontend
- **LOOCV ellipses.** V3 uncertainty estimator now reads Ridge LOOCV diagnostics (`predictorRef.diagnostics.perPoint`) instead of in-sample residuals. Fixes ~30-40% underestimated uncertainty. Falls back to `fitFromHybridResiduals` for BlazeGaze engine.
- **Mass-duration consistency.** `ProbabilisticHeatmap.addSample` only increments `totalDurationS` when `kernelSum > 0` — frames where gaze falls entirely outside the grid no longer inflate duration without contributing mass.
- **Payload size reduction.** Removed redundant `normalized[]` array from V3 payload (~16KB savings per session). Backend reconstructs from `densityBase64`.
- **Live head pose + EAR.** `useMediaPipeGaze` now exposes `earRef` and `headPoseRef` (pitch/yaw degrees). V3 uncertainty scaling uses real values instead of hardcoded defaults.
- **Resize-safe grid.** V3 heatmap stores initial stimulus rect at creation. Gaze coordinates are rescaled proportionally when the viewport changes during viewing, preventing cell mismatch.

### backend
- **V3 heatmap aggregation.** `extractV3Heatmap()` in `eye-tracking.analytics.ts` decodes base64 `Float64Array` density grids from per-participant V3 payloads, sums across participants, and returns aggregated heatmap via existing `/analytics/research/:id/eye-tracking` endpoint. Includes normalized grid for rendering, per-AOI aggregated metrics (dwell, attention share, TTFA), per-participant quality summary (confidence, coverage, mass). No new endpoint — `v3Heatmap` is optional on `EyeTrackingStimulus`.

### research-frontend
- **Density tab.** New "Density" `ViewMode` in `StimulusCard` (Grid3X3 icon). Decodes `normalizedBase64` → cell-center points → renders via existing `HeatmapRenderer`. Defaults to density tab when V3 data exists. Shows metrics footer (participant count, confidence %, total mass, spatial coverage) and per-AOI probabilistic attention panel.
- **V3 demographic filters.** `filteredStimuli` now filters `v3Heatmap.perParticipant` by selected demographic IDs, keeping participant count in sync.

### quality
- **16 TS errors + 19 lint warnings fixed** across eye-tracking pipeline files (eval/, useMediaPipeGaze, featureExtraction, onnxGazePredictor, modelAdapters, test pages, test files, vite.config).
- **5 pre-existing test failures fixed** — DemographicsStep (×3, rewritten for CustomSelect + store mock), NavigationFlow (MemoryRouter wrapper), ShelfGrid (sequential cycling expectation).
- **613 tests, 0 failures.** Pre-commit clean across all 3 subprojects.

---

## v0.86.3 — Fix: participation mode reverts to panel on save (2026-07-03)

### research-frontend
- **participationMode round-trip fix.** `flattenResearchConfig` did not extract `participationMode` from stored config, so `componentValues` never contained the key. On every save, `transformResearchConfigComponentValues` defaulted to `'panel'`, silently overwriting a previously saved `'kiosk'` mode.

---

## v0.86.2 — Video heatmap grid label refinements (2026-07-01)

### python-saliency
- **Row-first labeling.** `compute_grid_cells()` labels by row then column: A1, A2, A3 (row A), B1, B2, B3 (row B), etc. Previously column-first (A1, B1, C1…).
- **Labels at cell bottom.** Labels now anchored to the base of each cell instead of vertically centered. Cleaner visual separation between heatmap content and label.
- **Pill alpha 75%.** Dark pill background reduced from 85% to 75% opacity, letting more heatmap show through.

---

## v0.86.1 — Video heatmap grid labels overhaul (2026-06-30)

### python-saliency
- **Label format A1/B2.** `compute_grid_cells()` now generates column-letter + row-number labels (A1, B1, C1, A2…) instead of sequential Q1–Q25. Matches frontend convention.
- **Consistent label mode.** `draw_grid()` checks if ALL cells fit the full label (`A1: 3.2%`). If any doesn't fit, ALL cells show only the percentage. No more mixed formats across rows.
- **Centered labels.** Labels placed at vertical center of each cell instead of pinned to bottom edge. Last row no longer cut off.
- **White text + DUPLEX font.** Switched from green SIMPLEX to white DUPLEX — thicker strokes, anti-aliased (`LINE_AA`), readable over any heatmap color.
- **Semi-transparent pill.** Dark background at 85% opacity with larger padding. Blended via `addWeighted` for smooth edges.
- **Adaptive font scaling.** `_cell_font_params()` scales font proportionally to cell size (factor 2.8, reference 640px). Abbreviation fallback: full → percent-only → skip.

### research-frontend
- **Grid label scaling.** `VideoAccumulatedHeatmapOverlay.tsx` and `VideoFrameScrubber.tsx` — font minimum lowered 14→10px, dark pill background behind labels, abbreviation (full → percent-only → skip) when text exceeds 90% of cell width.

---

## v0.86.0 — Eye Tracking V2: zone-based attention pipeline (2026-06-28)

### participant-frontend
- **Zone Registry.** `ZoneRegistry` class manages named regions over stimulus. Dynamic zones via `getBoundingClientRect` or manual rects. ResizeObserver auto-update. Fallback grid NxN with backward-compat `r{row}c{col}` IDs matching `HYBRID_AOI_GRID`.
- **Zone Classifier.** `classifyGaze()` transforms gaze point + uncertainty radius into probability distribution over zones. Gaussian 2D overlap, configurable radius (desktop 120px, mobile 200px).
- **Hysteresis Engine.** `HysteresisEngine` prevents erratic zone switching. Candidate zone must hold top position for configurable threshold (200ms desktop, 300ms mobile) before committing transition.
- **Zone Event Emitter.** `ZoneEventEmitter` integrates classifier + hysteresis + zone-level fixation detection. Emits `zone_enter`, `zone_leave`, `fixation_start`, `fixation_end` events. Public API: app consumes events, never raw coordinates.
- **Head Pose Compensation.** `compensateHeadPose()` corrects gaze for head rotation. Linear offset proportional to yaw/pitch with configurable gains. Roll warning flag. `extractEulerAngles()` from MediaPipe rotation matrix.
- **Calibration Store.** `calibrationStore.ts` persists calibration in localStorage (30min TTL, device fingerprint validation). Replaces 2min sessionStorage.
- **Partial Recalibration.** `detectDeficientPoints()` identifies bad calibration points via median error factor. `recalibratePartial()` replaces only deficient residuals.
- **V2 Response Builder.** `buildV2Response()` constructs zone-event payload: `zoneEvents[]`, `zoneMetrics{}`, `zones[]`, backward-compat `fixations[]` and `zoneMass{}`. Feature flag `EYE_TRACKING_V2_ENABLED = false`.
- **Device Profile.** `deviceProfile.ts` returns tuning params per device: uncertaintyRadius, hysteresisMs, minConfidence, hasGazeTracking, headPoseGainMultiplier. Desktop < tablet < mobile for radius/hysteresis.
- **Test Page.** `/test/eye-tracking-v2` — standalone page with 5-point calibration + IDW correction + real-time zone highlighting. Desktop: BlazeGaze CNN webcam. Mobile: tap proxy.

### backend
- **V2 Analytics Adapter.** `eye-tracking-v2.analytics.ts` — reads V2 zone-event responses natively. `isV2Response()` detects version. `extractV2ParticipantData()`, `v2HeatmapFromZones()`, `v2SequenceAnalysis()`, `v2AggregateZoneMetrics()`. Dual-read: V1 fixation-based and V2 zone-based.

### research-frontend
- **Zone Metrics Panel.** `ZoneMetricsPanel.tsx` — dwell time bars, first zone badge, exploration order timeline, confidence badge. Renders when V2 data available.
- **V2 UI Utilities.** `eyeTrackingV2.ts` — `hasV2ZoneData()`, `buildDwellBars()`, `firstZoneObserved()`, `explorationOrder()`, `buildAttentionSummary()`, format helpers.

### tests
- **469 tests** across 3 subprojects (participant: 379, backend: 43, research: 47). Zone registry, classifier, hysteresis, event emitter, head pose, calibration store, partial recal, V2 response builder, V2 analytics, UI utilities, device profile.

### config
- **i18n chunk fix.** `react-i18next` moved to `react-vendor` chunk to prevent `createContext` race condition on load.
- **Test exclusion.** `tsconfig.app.json` excludes `__tests__/` from build.

---

## v0.85.3 — Video heatmap frame-by-frame en producción + page transition (2026-06-26)

### config
- **Frame-by-frame en cPanel.** `VIDEO_SAMPLE_INTERVAL=0.0` y `VIDEO_MAX_DIM=480` en `.env` de producción. DINO procesa cada frame del video (no cada 2s). Resultado fluido a fps originales. Testeado: 347 frames (11.5s, 30fps) en 233s sin que LVE mate el proceso.

### research-frontend
- **Page transition.** `DashboardLayout` aplica fade opacity (200ms) al navegar entre páginas. `useLocation` detecta cambio de ruta, `requestAnimationFrame` evita flash.

---

## v0.85.2 — Video heatmap: per-frame render + legacy banner fix (2026-06-25)

### backend
- **Configurable sample interval.** `renderVideoHeatmap` reads `VIDEO_SAMPLE_INTERVAL` and `VIDEO_MAX_DIM` from env. Local: `0.0` (every frame, fluid heatmap). cPanel: `2.0` (keyframes only, lower CPU). Previously hardcoded `2.0`/`640`.

### research-frontend
- **Legacy banner fix for DINO video.** `isLegacyAttentionStimulus` now accepts `hasHeatmapVideo` param. DINO videos with `heatmapVideoUrl` but no `heatmapData` are no longer incorrectly flagged as legacy flow.

### config
- `VIDEO_SAMPLE_INTERVAL=0.0` in local `.env` (every frame)
- `VIDEO_MAX_DIM=960` in local `.env` (higher resolution)

---

## v0.85.1 — Video Attention Prediction: AI analysis support (2026-06-25)

### backend
- **Video frame extraction for AI analysis.** `/analyze/:mediaId` now detects video files and extracts a midpoint frame via ffmpeg before sending to Gemini/OpenAI. Previously `sharp(video.mp4)` crashed silently, leaving analysis stuck in `processing` state forever.
- **`extractVideoFrame` utility.** Exported from `video-prediction.service.ts`. Uses ffmpeg to probe duration, seeks to midpoint, extracts 1 JPEG frame. Temp file cleaned up in `finally` block.
- **Top-level child_process imports.** Replaced inline `require('child_process')` with top-level `import` in `video-prediction.service.ts` — enables proper test mocking.

### research-frontend
- **Analysis gate accepts video heatmaps.** `canRunAnalysisGate` now takes optional `hasHeatmapVideo` param. DINO videos (which have `heatmapVideoUrl` but no `heatmapData`) can now trigger AI analysis.
- **`hasHeatmap` considers `heatmapVideoUrl`.** Both `AttentionPredictionCard` and `AttentionPredictionView` treat `heatmapVideoUrl` as a valid heatmap for gate checks and wizard step completion.

### tests
- **`extractVideoFrame.test.ts`** (5 tests): output path, midpoint seek, duration parsing with hours, fallback without duration, ffmpeg flags.
- **`attentionPrediction.videoAnalysis.test.ts`** (9 tests): gate with/without `heatmapVideoUrl`, backward compat, AOI/skip combinations.

---

## v0.85.0 — Video Attention Prediction: server-side DINO heatmap rendering (2026-06-24)

### backend
- **DINO ViT-B/16 server-side render.** Video heatmap now rendered entirely on the server via Python subprocess (`render_cli.py`). Produces side-by-side WebM: original (left) | JET heatmap + 3x3 grid with Q-label percentages (right). Replaces browser-side canvas rendering (IDW, thermal cache, rAF loop).
- **Python saliency service.** `renderer.py` — pure functions for attention extraction, heatmap overlay, grid drawing, logo footer. `render_cli.py` — CLI entrypoint spawned by Node.js. Single-threaded (`OMP_NUM_THREADS=1`) for cPanel LVE compatibility. Auto-downscales videos >640px to prevent OOM.
- **VP8/WebM output.** `cv2.VideoWriter` with VP80 codec — plays natively in all browsers. MPEG-4 Part 2 (mp4v) and H.264 reencode both failed on cPanel.
- **Sample interval.** `sample_interval_s=2.0` — runs DINO on keyframes only (1 every 2s), reuses overlay for intermediate frames. 529-frame video processes in ~85s on CPU.
- **Subprocess architecture.** Node spawns `python render_cli.py` directly — no HTTP/uvicorn/streaming/sockets. Python writes WebM + `.meta.json` sidecar, prints JSON to stdout. Node reads stdout, persists `heatmapVideoUrl` on stimulus.
- **Upload endpoint.** `POST /api/attention-prediction/upload-heatmap-video` — accepts MP4/WebM from external renderers (Colab). Secret key auth (`HEATMAP_UPLOAD_SECRET`).
- **Backend dispatch.** `VIDEO_SALIENCY_BACKEND=dino` activates server-side render. Falls back to TranSalNet frame-by-frame for `transalnet`/`tased`.

### research-frontend
- **Video heatmap as `<video>`.** When `stimulus.heatmapVideoUrl` exists, Heatmap tab renders a plain `<video autoPlay loop muted>`. No canvas, no IDW, no thermal cache. Legacy `VideoThermalGrid` fallback preserved for old data.
- **No client-side frame extraction.** `processVideoStimulus` sends empty `frames[]` — backend reads video directly.
- **Types.** `StimulusItem` extended with `heatmapVideoUrl`, `heatmapVideoPath`, `gridMetadata`.

### docs
- **`heatmap_colab_emotiox.py`.** Google Colab notebook: upload video → DINO render → auto-upload to EmotioX.

### config
- `VIDEO_SALIENCY_BACKEND=dino` in backend `.env`
- `HEATMAP_UPLOAD_SECRET` for Colab upload endpoint

---

## v0.84.2 — Attention Prediction: restore warm heatmap gradient (2026-06-22)

### research-frontend
- **Warm gradient restored.** `HeatmapRenderer` gradients reverted from blue→purple (introduced in v0.80.0) back to green→yellow→orange→red for all visual profiles (lab, precise, balanced, smooth). Matches the original pre-v0.80.0 Hotjar-style warm overlay.

---

## v0.84.1 — Video Attention Prediction: per-frame temporal modulation (2026-06-19)

### research-frontend
- **Per-frame heatmap modulation.** Base thermal (IDW from accumulated data) built once. Per-frame hotspots modulate pixel alpha via proximity falloff — hot zones shift over time without re-running IDW. Canvas dimensions set once on load, no per-rAF reset.
- **Frame tracking.** `VideoThermalGrid` listens to `timeupdate`/`seeked`, resolves active frame via `resolveFrameIndex`, rebuilds modulated thermal + grid only on frame transitions.
- **Three-layer architecture.** `buildBaseThermal` (once, expensive) → `buildModulatedThermal` (per frame, alpha multiply at 4px step) → `buildGridOverlay` (per frame, lines + labels). `compositeFrame` draws video + thermal + grid with zero computation.

### tests
- **`resolveFrameIndex.test.ts`.** 22 tests: frame resolution (boundaries, irregular intervals, sequential playback) + accumulated modulation (boost/attenuation, immutability, custom params, multi-hotspot).

---

## v0.84.0 — Video Attention Prediction: thermal heatmap overlay with IDW interpolation (2026-06-18)

### research-frontend
- **Thermal heatmap overlay.** Video heatmap tab now renders a FLIR-style thermal overlay using IDW (Inverse Distance Weighting) per-pixel interpolation + colormap LUT. Replaces simpleheat point-based approach. Full canvas coverage with navy→blue→green→yellow→red gradient.
- **Real-time video playback.** Thermal overlay + grid composite cached once, then composited over each video frame via `requestAnimationFrame` loop. Play, pause, and seek update the overlay in real time.
- **Grid overlay.** Configurable grid (2×2 to 10×10) with white lines and green percentage labels per cell. Grid and thermal caches are precomputed for zero-cost per-frame rendering.
- **Adjustable reveal divider.** Draggable handle controls how much of the heatmap overlay is visible via `clipPath`. Default: full coverage.
- **Video content alignment.** Canvas positioned over the actual video content area (excluding letterbox bars) using aspect-ratio-aware bounding calculation.
- **CardHeader cleanup.** Removed file title from card header; title already visible in sidebar.
- **`VideoFrameScrubber` refactor.** Extracted `computeGridPercentages`, `paintHeatmapGradients`, `renderFrameWithHeatmap`, `renderGridComposite` as pure exported functions. Frame-based playback via resolved media URLs.

### tests
- **`renderGridComposite.test.ts`.** 11 tests: grid lines count/positions, label content, layer ordering, grid sizes 2×2 to 10×10, `computeGridPercentages` distribution.

---

## v0.83.0 — Video Attention Prediction: grid AOIs, timeline ranges, preprocessSharp fix (2026-06-13)

### backend
- **preprocessSharp fix.** Safari Canvas PNGs con perfiles de color embebidos causaban `Tensor size mismatch`. Ahora usa `flatten()` + intermediario PNG + fallback `toColourspace('srgb')`. Validación de buffer real vs esperado.
- **Grid configurable.** `predictVideoFrames` acepta `gridConfig: { cols, rows }` (2-10, default 4×4). `POST /video-predict` valida y persiste `gridConfig` en el stimulus.
- **Filtrado temporal per-AOI.** `aoiTimeRanges[]` en `POST /video-predict` filtra frames por rango temporal de cada AOI. Resultado en `stimulus.aoiAttention`. Funciones puras exportadas: `computeAoiTemporalAttention`, `buildGridLabels`, `computeCellAverage`.

### research-frontend
- **Tipos.** `GridConfig`, `AoiTimeRange`, `ManualAOI.timeRange` en `attentionPrediction.types.ts`.
- **`generateGridAois()`.** Función pura que genera `ManualAOI[]` para grids 3×3, 5×5, 10×10. `source: 'imported-grid'`, labels A1..J10, timeRange opcional.
- **Grid preset selector.** Segmented button `Manual | 3×3 | 5×5 | 10×10` en AOI Editor toolbar (solo video). Reemplaza AOIs existentes al cambiar preset.
- **`AoiTimelineBar`.** Barras horizontales por AOI con handles draggables start/end (vanilla JS). Snap a frame timestamps, clamp min gap 0.5s, eje de tiempo adaptativo. Integrado debajo del viewport en tabs AOI Editor y Heatmap.
- **Scrubber.** Grid overlay migrado de CSS Grid a flexbox. Extendido a 10×10. Labels `A1..J10`. Prop `aoiTimeRanges` renderiza barras coloreadas sobre el slider. Prop `initialGridIndex`.
- **Service.** `startVideoPrediction` acepta `gridConfig` y `aoiTimeRanges`. View extrae grid config de AOIs `imported-grid` y time ranges al enviar.

### tests
- **44 tests nuevos.** Backend: `computeCellAverage` (3), `buildGridLabels` (4), `computeAoiTemporalAttention` (6). Frontend: `generateGridAois` (10), `AoiTimelineBar` (11), grid preset handler (10).

---

## v0.82.0 — Attention Prediction: product context, AOI intensity modulation, UX fixes (2026-06-11)

### backend
- **Contexto `product_isolated`.** Nuevo valor en `AnalysisProfile.context` con prompt semántico específico para producto aislado (logo alto, superficies uniformes bajo). β semántico 0.55.
- **NMS por contexto.** `getExtractOptions()` selecciona parámetros según contexto: producto/packaging usa `maxPoints: 150, gridCols: 64, minRelative: 0.58` para cobertura selectiva.
- **Whitespace por contexto.** `getTextureThresholds()` baja luminance threshold a 0.65 para producto, suprimiendo zonas uniformes de packaging.
- **AOI-proximity intensity modulation.** `modulateIntensityByAoiProximity()` post-NMS: Chebyshev + Gaussian falloff. Puntos dentro de AOI retienen intensidad completa; puntos lejanos atenuados (decay 0.6).

### research-frontend
- **Viewport reactivo.** `useViewportHeight` hook reemplaza `useMemo` estático. Debounce 300ms, ignora delta < 20px — AOIs no se desalinean al redimensionar.
- **Auto-switch tab post-predict.** Al completar predicción, visor cambia automáticamente a tab Heatmap. Sin doble click.
- **Guard reconcile durante predict.** `displayAutoAois` retorna vacío mientras `isPredicting` — sin cambios visuales de AOIs durante la espera.
- **Overlay de progreso.** Overlay pulsante con timer sobre el visor durante predicción.
- **Badge "Recalcular con zonas actuales".** Botón amber cuando AOIs cambian post-heatmap. Un solo click para regenerar.
- **Tiempo de exposición estimado.** `estimateExposureTime()` en tooltip de chips AOI (mapea % → tiempo).

### tests
- **36 tests nuevos.** `useViewportHeight` (5), predict flow F2 (5), product context NMS+texture (10), AOI intensity modulation (8), exposure time (8).

---

## v0.81.2 — Attention Prediction: refactor + denser heatmap + test fixes (2026-06-10)

### backend
- **Heatmap ultra-denso.** NMS params: `minRelative` 0.42, `maxPoints` 500, `gridCols` 100 — cobertura completa.
- **Prompt forzado a español.** Análisis IA siempre responde en español independiente del contenido visual.

### research-frontend
- **Refactor AttentionPredictionCard.** Extraídos 4 componentes: `HeatmapSettingsModal`, `VideoFrameScrubber`, `StimulusOverlayFrame`, `MapModeControlBar`. Archivo principal de 2694 → 1542 líneas.
- **MapModeControlBar unificado.** Eliminada duplicación entre control bars de imagen y video.
- **VideoOverlayContent.** Ternario de 4 niveles reemplazado por componente con early returns.
- **Sub-componentes render.** `CardHeader`, `LayerToggles`, `GazeRouteBar`, `AoiEditorToolbar`, `AoiChipList`, modales extraídos del render principal.
- **Viewport estable.** `ResizeObserver` reemplazado por `stableMaxHeight` (calculado una vez desde `window.innerHeight`).
- **Panel IA.** "Attention" → "Atención"; nota aclaratoria score IA vs saliencia TranSalNet.
- **Legacy threshold.** 250 → 600 (coherente con nuevo `maxPoints` 500).

### tests
- **WebsiteTrackingResults.** Tests actualizados al UI actual: `ToastProvider` wrapper, mock de `researchService`, stats inline, tabs renombrados, visitor journeys con formato correcto. 5/5 verdes.
- **Heatmap QA.** Threshold actualizado (601/500).

---

## v0.81.1 — Attention Prediction: heatmap density + scanpath inline + i18n panel (2026-06-10)

### backend
- **Heatmap más denso.** NMS relajado (`minRelative` 0.52, `maxPoints` 200, `gridCols` 64) — cobertura más amplia sin sacrificar hot-spots.

### research-frontend
- **Scanpath inline.** `GazeScanpathPlayer` se renderiza como capa dentro del visor unificado (`transparent` mode) en vez de reemplazar la imagen completa.
- **Controles contextuales.** Map-mode selector solo visible en tab Heatmap; gaze route toggles solo en Gaze Paths; layer toggles ocultos en AOI Editor.
- **Panel IA en español.** Secciones, badges de duración, labels y títulos traducidos al español.
- **Criterio hint.** Nota aclaratoria bajo el botón «Aplicar al estudio» diferenciando criterio IA de regeneración de heatmap.
- **Brand Attention.** Etiqueta «evaluación IA» en score holístico; encabezado «Saliencia medida por heatmap» en logos.
- **Reconcile AOIs simplificado.** Sin ocultamiento por IoU/categoría — todas las zonas IA se muestran; labels similares se alinean a geometría manual.
- **Legacy threshold.** Umbral de heatmap denso elevado a 250 puntos (era 120).
- **Bundle fix.** `recharts` en `react-vendor` chunk (evita circular import); `resolve.dedupe` para React.

### tests
- Test de legacy threshold actualizado (251/200).

---

## v0.81.0 — Attention Prediction: feedback emotiox (P1–P9) (2026-06-08)

### backend
- **Whitespace en heatmap.** `suppressWhitespaceSaliency` reduce saliencia en zonas de bajo texto; NMS más fino (84 pts máx.).
- **Gaze paths.** Prompt y post-proceso con 3 rutas ancladas a hotspots del heatmap.

### research-frontend
- **Flujo legacy (P1).** Banner + panel bloqueado; zonas IA off en AOI Editor; AOIs sistema convertibles a editables; `%` desde saliencia real.
- **Scanpath (P2).** `GazeScanpathPlayer`, overlay más visible, rutas ancladas al heatmap.
- **Heatmap (P3–P4).** Preset Precise default; modal Settings sincronizado con visor; toolbar resumida.
- **Criterio (P5).** Nombre persistido (`attentionCriteriaName`) en header y panel.
- **Vista compuesta (P6).** Capas auto en Original/Gaze Paths; botón «Vista completa»; leyenda de rutas.
- **AOIs y teclado (P7–P8).** Backspace en inputs/modal/criterio no elimina zonas.
- **Wizard (P9).** Paso a paso en panel derecho; criterio marca ✓ al guardar.
- **Persistencia.** `persistStimuli` y `handleSavePrompt` usan `getById` fresco antes de guardar.

### chore
- **Bundles.** Lazy routes y `manualChunks` en research/participant frontends.
- **Docs.** Feedback en `docs/emotiox.pdf`, `docs/emotiox.docx`, capturas en `docs/_emotiox_extract/`.

### tests
- **44 tests** FE (`attentionPrediction.p1`–`p8`, `criteria.p5`/`p9`) + **3** BE (`lowTextureMask`).

---

## v0.80.0 — Attention Prediction: Classic, Spotlight y Cold (2026-06-07)

### backend
- **NMS más estricto.** `minRelative` 0.58, `maxPoints` 72 — hotspots más finos en imagen, video por frame y acumulado.

### research-frontend
- **Modos de mapa.** Selector `Classic | Spotlight | Cold` en pestaña Heatmap (imagen y video). Classic = overlay térmico; Spotlight = frame difuminado con revelado nítido en zonas de atención; Cold = peso invertido, paleta fría.
- **Preset Lab.** Default en Classic (junto a Precise/Balanced/Smooth). Gradiente sin verde en valores bajos; radio máx. 15% del frame.
- **Renderers.** `SpotlightRenderer`, `ColdMapRenderer`, `VideoAccumulatedHeatmapOverlay` para video sin frames individuales.
- **HeatmapRenderer.** Perfil visual `lab | precise | balanced | smooth`; overlay más suave.
- **Legacy banner.** Aviso + regenerar si `heatmapData.length > 120`.
- **Fix selector.** Estado activo usa `mapMode`; capa Heatmap se activa al cambiar modo; Spotlight/Cold deshabilitados en AOI Editor.

### docs
- **`docs/attention-prediction-heatmap-viz-spec.md`.** Spec LOCKED (modos, video, presets).
- **`docs/attention-prediction-heatmap-viz-QA.md`.** Checklist QA.
- **Referencias visuales.** `docs/image.png`–`image4.png`.

### tests
- **`attentionPrediction.heatmapQa.test.ts`.** Radio cap, presets, modos full-frame.

---

## v0.79.0 — Attention Prediction: heatmaps Precise + visor unificado (2026-06-07)

### backend
- **Extracción granular.** Picos locales + NMS (~80 puntos) reemplazan exportación densa. Preset Precise por defecto (blur/threshold ajustados).
- **Hybrid saliency.** Percentil 88, jitter 0.08. Misma lógica en video (frames + acumulado).
- **Predict async.** Polling de estado cuando el endpoint responde 202.

### research-frontend
- **Visor unificado.** Un solo viewport con capas conmutables (Heatmap, Zonas IA, Zonas manuales, Rutas). Tabs = presets de capas.
- **Preset Precise/Balanced/Smooth.** `HeatmapRenderer` con modo `precise` | `smooth`; radios más pequeños en precise.
- **Layout sin scroll.** Viewport flex + `ResizeObserver`; imagen/canvas escalan al espacio disponible (`computeStimulusDisplaySize`), sin `calc(100vh)` acumulado.
- **AutoAois vs manuales.** `reconcileAutoAoisWithManual` oculta/corrige zonas IA conflictivas.
- **Caché de imagen.** `stimulusImageCache.ts` compartido entre tabs y heatmap.

---

## v0.78.0 — Attention Prediction: AOIs condicionan hybrid predict (2026-06-06)

### backend
- **Manual AOI boost en predict.** `POST /predict` acepta `aois` (body o `stimulus.aois`). Pipeline híbrido: prompt semántico + boost en grid + boost espacial con falloff suave + re-normalización.
- **`parseManualAois`.** Helper compartido entre predict y analyze.

### research-frontend
- **Predict con AOIs en memoria.** `predictAttention()` envía `liveAois` al generar heatmap (mismo patrón que analyze).

---

## v0.77.1 — Attention Prediction: AOIs en panel IA (2026-06-06)

### research-frontend
- **Fix panel analyze.** El botón analizar del panel lateral usa AOIs en memoria (`liveAois`), sincronizadas con el card vía `onAoiListChange`, en lugar del cache del research.

---

## v0.77.0 — Attention Prediction: flujo AOI-first (2026-06-06)

### research-frontend
- **Flujo manual.** Upload ya no dispara análisis IA. Secuencia: definir AOIs → criterio → generar heatmap → analizar.
- **Predict conectado.** Botón "Generar heatmap" llama `POST /predict` (TranSalNet). Análisis IA requiere heatmap previo.
- **Heatmap real.** Eliminada síntesis visual desde `autoAois`; el overlay usa solo `heatmapData` del backend. Toggle opcional "Mostrar zonas IA".
- **AOI Editor.** Tab inicial en estímulos nuevos. Crear, nombrar, mover, redimensionar y eliminar zonas. Gate: ≥1 AOI o "Continuar sin zonas".
- **Criterio de análisis.** UI renombrada desde "Prompt". Plantilla recomendada y presets por contexto (`emotiox-criteria-presets`).
- **Panel IA.** Visible antes del análisis con checklist de prerequisitos. Banner de migración si hay análisis sin heatmap.

### backend
- **AOIs en analyze.** `POST /analyze` acepta AOIs manuales (body o `stimulus.aois`) y las incluye como contexto autoritativo en el prompt LLM.

### docs
- **`docs/prediccion-plan.md`.** Decisiones de producto LOCKED (D-01…D-07) y especificación del flujo AOI-first.

---

## v0.76.0 — Video Attention Prediction pipeline (2026-05-29)

### backend
- **Video prediction endpoint.** `POST /video-predict` accepts frame mediaIds, runs `predictAttentionFast` (single-pass TranSalNet, ~3x faster) per frame, accumulates via running average, applies hybrid Gemini fusion on accumulated map. Returns 202 + `jobId`.
- **SSE progress stream.** `GET .../video-predict/stream?jobId=` streams frame-by-frame progress. Auth via unguessable UUID jobId. In-memory registry with 60s cleanup.
- **Memory-efficient.** Running sum ~442KB + 1 active frame. Temporal grid 4x4 computed inline. Max 60 frames.
- **`predictAttentionFast`.** Single inference pass (no augmentations). Video frames don't need TTA — temporal averaging replaces spatial augmentation.
- **Metadata guard.** `saveMetadata` handles undefined metadata (frame uploads without explicit metadata).

### research-frontend
- **Video upload flow.** Video detected by MIME or filename extension. Frames extracted client-side at 1 frame/2s via `extractVideoFrames()` (Canvas API, CORS-safe blob download). Each frame uploaded as PNG, then `POST /video-predict` called.
- **Heatmap split overlay.** Single video with heatmap alpha on right side. Draggable divider (10-90%). Configurable grid (2×2, 3×3, 4×4, 5×5) with Q-labels and attention percentages. Play/pause + seek bar.
- **Process Video button.** Heatmap tab shows "Process Video" button that transforms into progress indicator during prediction. Error state with retry/dismiss.
- **Persistent video element.** Single `<video>` always mounted — no reload on tab switch. Controls shown only on Original tab.
- **Video container.** Fixed height `calc(100vh-250px)`, centered — vertical videos fit without clipping.
- **AOI Editor hidden for video.** Static AOIs not applicable to moving content.
- **Image tabs: no reload.** Original and Heatmap use `display:none/block` instead of unmount — instant tab switch.
- **Bulk analysis skips video.** Auto-queue on mount excludes `isVideo` stimuli.

---

## v0.75.2 — Heatmap presets, AOI visibility, Prompt in card, dashboard cleanup (2026-05-28)

### research-frontend
- **Heatmap settings presets.** Save/load named blur/opacity/threshold presets in Heatmap Settings modal. Stored in `localStorage`, shared across all studies.
- **AOI Editor: visible AI-detected zones.** Auto-detected AOIs now render as 2px dashed rectangles with solid-color labels (red=high, amber=medium, gray=low). Previously nearly invisible.
- **AOI Editor: heatmap backdrop enforced.** Minimum blur=10, opacity=40, threshold=20 ensures the saliency overlay is visible as a drawing guide.
- **Prompt presets below actions.** Presets section moved below the textarea and Default/Save/Apply buttons. Removed "My Presets" label.
- **Prompt button inside card.** Moved "Prompt Custom" button from standalone row into the AttentionPredictionCard header via `headerExtra` prop. Eliminates extra vertical space.
- **HeatmapRenderer: no forced scroll.** Canvas uses `w-full h-auto` instead of `max-h-[60vh] w-auto` — scales proportionally without causing vertical scroll.
- **Sidebar: collapsible Stimuli/Stages.** Section header is clickable with chevron. Smooth `max-height` + `opacity` transition (200ms).
- **Dashboard: removed sidebar charts.** Removed Research Activity, Participants Over Time, and Top by Participants panels.
- **Dashboard: removed "Dashboard" label.** Sidebar logo area no longer shows redundant text.
- **Dashboard: filter pills on second row.** Type pills (All, Attention's Prediction, etc.) render on their own line below the search/filter row.

---

## v0.75.1 — Website Tracking CSS proxy fixes, snippet session management, live tab refactor (2026-05-28)

### backend
- **Proxy URLs absolute.** `proxy-page` and `snapshot-html` now emit absolute proxy URLs (`https://emotio.cx/api/...`). Previously, the `<base>` tag caused relative `/api/...` proxy URLs to resolve against the tracked site's domain, breaking all CSS loading.
- **Protocol-relative URL support.** `<link>` stylesheet and font URL rewriting now handles `//cdn.example.com/...` URLs correctly instead of treating them as relative paths.
- **CSS internal URL rewriting.** `proxy-asset` rewrites `url()` and `@import` references inside proxied CSS files so nested resources (fonts, images, imported stylesheets) also load through the proxy.
- **`media="none"` fix.** Proxy-page and snapshot-html replace `media="none"` with `media="all"` to restore lazy-loaded stylesheets (e.g., Google Fonts) whose `onload` handlers were stripped.
- **Snippet v3.5: 30s session reset.** If tab is hidden for >30s, a fresh session is created on return instead of resuming the stale one.
- **Active duration cap.** `saveEvents` caps `active_duration_ms` to wall-clock time to prevent inflated values from race conditions.
- **Live sessions: indexed query.** `getLiveSessions` filters by `ended_at >= NOW() - 5 MIN` instead of scanning all events with `HAVING MAX(timestamp_ms)`.

### research-frontend
- **Live tab: polling refactor.** `LiveSessionsTab` receives sessions as props (parent polls every 10s) instead of managing its own SSE connection. Simpler lifecycle, no stale EventSource.
- **Visitor journey gap indicators.** Page timeline shows "Left page · Xs away" dividers when >10s gap between consecutive page views within a visit.

---

## v0.75.0 — Prompt presets, bulk analysis, AOI heatmap backdrop, multi-column CSV, gaze path tabs (2026-05-28)

### backend
- **Insights prompt: drop supportingQuotes.** LLM no longer returns verbatim quotes (handled client-side). `max_tokens` reduced to 4000 for faster responses.
- **Tracking snippet v3.4: DOM snapshot capture.** Captures `document.documentElement.outerHTML` 3s after session start and sends to `/public/tracking/:id/snapshot`. Enables snapshot-html backdrop for heatmaps with JS-rendered styles.
- **Proxy-page navbar fix.** Injected CSS forces `min-width: 1280px` on body and `position: relative` on nav/header elements to prevent responsive collapse and fixed-position issues in iframe.

### research-frontend
- **Prompt presets (Attention Prediction).** Save/load named prompts in Analysis Prompt drawer. Stored in `localStorage`, available across all studies. Delete individual presets.
- **Heatmap settings presets.** "My presets" section in HeatmapSettingsModal — save custom blur/opacity/threshold configurations with names. Persistent via `localStorage`.
- **Analysis Profile removed.** Dropdown had no visible impact. Replaced by prompt presets.
- **Multi-column CSV in creation form.** `CreateResearchForm` now creates one FileItem per selected column (with column name in title). Previously only used the first column.
- **Column tabs in InsightsFindingView.** When multiple columns exist, numbered tabs appear above "Sentiment Analysis from text" to switch between columns without sidebar navigation.
- **Analyzing timer.** Both Insights Finding and Attention Prediction show elapsed seconds during analysis (`Analyzing... 12s`).
- **Bulk analysis on mount.** Attention Prediction auto-queues all stimuli without analysis on page load. Shows progress `(2/4)` in the button.
- **AOI Editor: heatmap backdrop.** Shows heatmap at 50% opacity behind AOI drawing zones. Auto-detected AOIs from AI visible as dashed rectangles (red=high, amber=medium, gray=low).
- **Gaze Paths: Routes/Scanpath sub-tabs.** Static gaze path routes and animated scanpath video separated into sub-tabs. Image height capped at 60vh to prevent scroll blocking.
- **File-based research status labels.** Sidebar shows "Prediction" (purple), "Analysis" (indigo), "Tracking" (cyan) instead of "Draft" for file-based research types. Non-clickable.

---

## v0.74.2 — Insights Finding: Re-analyze, client-side theme matching, Sentiment Score tooltip (2026-05-27)

### backend
- **Insights prompt: all verbatim quotes.** LLM prompt now demands every matching entry per theme (`supportingQuotes.length MUST equal count`). `max_tokens` already at 8000.

### research-frontend
- **Re-analyze button.** "Re-analyze" in Insights Finding header re-triggers LLM analysis with current prompt. Spinner while processing, auto-refresh on completion.
- **Client-side theme matching.** Expanded themes list ALL entries matching the theme name (accent/mojibake-insensitive), not just LLM `supportingQuotes`. Scrollable container (`max-h-240px`) with mood badges. Always expandable.
- **Theme count from real data.** Percentage and mention count derived from client-side matching, not LLM approximation. Zero discrepancy between pill and expanded list.
- **Sentiment Score tooltip.** Portal-based tooltip (instant on hover, no browser delay) explains formula, shows positive/negative/neutral breakdown. `SentimentScoreBadge` component with `createPortal`.

---

## v0.74.1 — Website Tracking: snapshot backdrop, CSS proxy, idle session filter, toolbar layout (2026-05-27)

### backend
- **Snapshot-html endpoint.** `GET /tracking/:id/snapshot-html?page=URL` serves the DOM snapshot captured by the tracking snippet as raw HTML. Preserves JS-rendered styles, shadows, parallax, and dynamic layouts that the proxy-page approach strips.
- **Proxy CSS stylesheets.** `proxy-page` now rewrites `<link rel="stylesheet">` URLs through `/proxy-asset`, fixing CORS and Referer-blocked CSS on sites like CBCL.
- **Proxy-asset text vs binary.** CSS and other text assets served as plain text instead of base64-encoded. Fonts and images remain base64.
- **Filter idle sessions.** `getVisitorJourneys` excludes visits where all sessions have zero events. `getOverviewMetrics` uses `INNER JOIN` on events so idle sessions don't inflate visitor/session counts.

### research-frontend
- **Snapshot-first heatmap backdrop.** `MultiLayerHeatmap` prefers `snapshot-html` (real DOM captured with styles) over `proxy-page` (live HTML without scripts). Falls back to proxy when no snapshot exists.
- **Heatmap toolbar two-row layout.** Separated controls into row 1 (page selector + layer toggles) and row 2 (intensity/opacity sliders with values + device filter). Sliders widened to `w-24` with numeric readout. Prevents cramped layout on narrow viewports.
- **CSS layout timeout.** Iframe layout measurement increased from 500ms to 2000ms, giving proxied CSS more time to load before capturing dimensions.

---

## v0.74.0 — Insights Finding PDF report, Sentiment Score, multi-column CSV, Research filters (2026-05-27)

### backend
- **Insights analysis: all quotes + longer descriptions.** LLM prompt now requests ALL matching verbatim quotes per theme (not 2-5) and 2-sentence minimum descriptions. `max_tokens` raised from 3000 to 8000.

### research-frontend
- **Insights Finding PDF report.** "PDF" button generates a printable report (new tab + `window.print()`). Includes metrics, sentiment distribution, Sentiment Score, executive synthesis, actionable recommendations, themes with verbatim quotes, and keyword pills.
- **Sentiment Score.** `((positive - negative) / (positive + negative)) * 100`, range -100 to +100. Shown in Sentiment tab (colored badge) and PDF report (metric card). Green >+20, amber -20 to +20, red <-20.
- **Keywords: real count + percentage.** Pill badges now show client-side matched count and percentage (`amarillo (4 · 3%)`) instead of LLM-approximated count. Eliminates mismatch between pill number and expanded results.
- **Multi-column CSV selection.** `CsvColumnSelector` supports checkboxes for multiple columns. Each selected column creates a separate analysis (unique `mediaId__colN`), appears as its own tab in the sidebar.
- **Research page: type filter dropdown.** New `CustomSelect` dropdown for research types (Attention Prediction, Insights Finding, Website Tracking, etc.) alongside existing technique filter. Both fetch all options from the system; options without researches are disabled.
- **Research page: technique filter uses CustomSelect.** Replaced native `<select>` with portal-based `CustomSelect` for consistent UX.
- **CustomSelect: disabled options.** `SelectOption` interface accepts optional `disabled` flag. Disabled options render gray with `cursor-not-allowed`.

---

## v0.73.4 — Insights Finding overhaul, editable prompts, AOI fixes (2026-05-25)

### backend
- **Specialized analysis prompt.** Insights Finding default prompt rewritten for consumer neuroscience / neuromarketing — structured output: executive synthesis, neurological analysis, business insights, prioritized recommendations. max_tokens raised to 3000.
- **Custom prompt support.** Both `analyzeInsights` and `analyzeAttentionWithAI` accept optional `customPrompt`. Controllers read `config.insightsPrompt` and `config.attentionPrompt` per research.

### research-frontend
- **CSV column selector.** Multi-column CSV/Excel shows a column picker with headers and 5-row preview. User picks which column to analyze. Applied in creation drawer and `InsightsFindingView`.
- **Mojibake repair.** `repairMojibake()` in `documentParser.ts` fixes UTF-8→Latin-1 encoding (diseÃ±o → diseño) at parse time. Keyword matching also normalizes diacritics for existing data.
- **Editable prompts.** "Prompt" button opens a Drawer with editable textarea, reset to default, and save. Applied to both Insights Finding (`config.insightsPrompt`) and Attention Prediction (`config.attentionPrompt`). "Custom" badge when modified.
- **Themes: percentage + verbatims.** Each theme shows a percentage bar and count. Click expands supporting quotes (smooth CSS grid-rows accordion).
- **Keywords: comment filter.** Click a keyword chip → filtered comments table below. Accent-insensitive + mojibake-aware matching.
- **Smooth Drawer transition.** Drawer component animates slide-in/out (300ms) with overlay fade. Applies globally.
- **AOI Editor fixes.** Removed `overflow-hidden` that clipped images. Drawing coordinates clamped to 0-100%. Global document-level mouse handlers prevent stuck drawing when cursor leaves the container mid-drag.
- **Removed unused checkboxes.** Insights Finding comments table cleaned up — analysis runs on all entries automatically.

---

## v0.73.3 — Visit grouping, duration accuracy, font proxy (2026-05-22)

### backend
- **Visit-based grouping.** `getVisitorJourneys` now splits sessions into visits (30-min gap = new visit). Sessions from different days no longer merge under one visitor card — each real visit appears independently.
- **Duration priority: rrweb > active > wall-clock.** Table duration now matches replay duration. `rrweb_duration_ms` computed from event timestamps on each append. `avgSessionDuration` prefers `active_duration_ms` over wall-clock.
- **URL normalization.** `createSession` strips `www.` prefix so `camarablockchain.cl` and `www.camarablockchain.cl` share the same page entry and screenshots.
- **Font proxy.** `GET /tracking/:id/proxy-asset?url=` proxies cross-origin fonts through the backend. `proxy-page` rewrites font URLs in HTML to use this proxy, fixing CORS errors on heatmap backdrop.
- **Binary response support.** `server-cpanel.js` and `server-cpanel.ts` handle `isBase64Encoded` responses for proxied binary assets (fonts, images).

### research-frontend
- **Date in session table.** Visitor detail shows `dd/mm HH:MM` per session instead of time-only. Prevents confusion when sessions span multiple days.
- **Unique visit keys.** Each visit card uses a unique key (visitorId + index) to prevent React duplicate key warnings when the same visitor has multiple visits.

---

## v0.73.2 — Tracking data accuracy fixes (2026-05-22)

### backend
- **Attention dwell: flush session tails.** `getAttentionHeatmapData` now accounts for the time between the last scroll event and `ended_at` for every session. Previously up to 30s of reading time per session was silently dropped.
- **Scroll depth: fix inflated cumulative reach.** Query now takes `MAX(scroll_depth_pct)` per session before bucketing. Previously a session with events at 30% and 80% was counted in both buckets, inflating lower-depth percentages by 2-3x.
- **Tracking pages: INSERT IGNORE.** Replaced SELECT→INSERT with `INSERT IGNORE` + UNIQUE index on `(research_id, page_url)`. Prevents duplicate key errors from concurrent session creation.
- **Remove dead endpoint.** Deleted `/mouse-attention` endpoint and `getMouseAttentionData` — frontend uses `/attention` (scroll-based dwell time).

### snippet v3.3
- **Visibility-aware capture.** Pauses all event capture and rrweb recording when tab is hidden, resumes on focus. Prevents phantom events from background tabs.
- **Sync XHR on unload.** Replaced `sendBeacon` with synchronous XHR for both heatmap and rrweb flushes on `visibilitychange`/`beforeunload`. Fixes silent loss of rrweb DOM snapshots exceeding sendBeacon's ~64KB limit.
- **Active duration tracking.** Snippet tracks real tab-visible time (`activeMs`), sent with each event flush. Backend stores in `active_duration_ms` column; visitor journeys prefer it over wall-clock duration.
- **rrweb active-time cap.** 5-minute recording limit now counts only active time, so background tabs don't consume the budget.

### database
- **Migration 032.** `active_duration_ms` column on `tracking_sessions`.
- **Migration 033.** UNIQUE index on `tracking_pages(research_id, page_url)`.

---

## v0.73.1 — SSE flush, snippet XHR, replay duration fix (2026-05-19)

### backend
- **SSE flush for LiteSpeed.** Added `res.flushHeaders()` and `res.flush()` after every `res.write()` in the live tracking SSE endpoint. Prevents LiteSpeed from buffering SSE chunks, which caused the Live tab to hang indefinitely.
- **Snippet v3.2: XHR-first event flush.** `flush()` now uses XHR as the primary transport for heatmap events. `sendBeacon` is only used during `visibilitychange`/`beforeunload` (where XHR can't complete). Fixes silent event loss on sites where `sendBeacon` failed without error.

### research-frontend
- **Live tab loading timeout.** `LiveSessionsTab` now falls back to empty state after 8s if the SSE connection never delivers data, instead of showing an infinite skeleton.
- **Replay duration consistency.** Disabled `skipInactive` in rrweb Replayer so the replay duration matches the session duration shown in the table. Users can use speed controls (4x/8x/16x) to skip idle periods.

---

## v0.73.0 — Website Tracking: rrweb migration, Page Flow diagram, snippet hardening (2026-05-17)

### backend — Session replay migration
- **rrweb-based DOM recording.** Snippet v3 loads rrweb from CDN, records full DOM snapshot + incremental mutations with CSS inlining. Replaces html2canvas screenshot approach. Events stored in `tracking_sessions.rrweb_events` (LONGTEXT). Migration 031.
- **New endpoints.** `POST /public/tracking/:id/rrweb-events` (public, snippet sends batches via XHR). `GET /tracking/:id/sessions/:sid/rrweb` (auth, frontend fetches for replay).
- **`hasRrweb` flag.** `getSessions` and `getVisitorJourneys` return boolean so frontend can distinguish legacy vs DOM-recorded sessions.
- **Exit page tracking.** `getPageFunnels` now counts exits per page (last page in visitor path). Returned as `exits` field in `topPages`.
- **Domain validation fix.** `createSession` and `saveTrackingConfig` strip protocol/path/port from `allowedDomains` — users pasting `emotio.cx/path` no longer causes "Domain not allowed".
- **Session duration cap.** `getVisitorJourneys` caps `durationMs` at 30 min. `getOverviewMetrics` caps `avgSessionDuration` at 1800s. Prevents idle-tab inflation.

### backend — Snippet v3
- **rrweb recording.** `rrweb.record()` with `inlineStylesheet`, `inlineImages`, `maskAllInputs`, `collectFonts`. Events batched every 5s via XHR (not sendBeacon — 64KB limit breaks 500KB+ DOM snapshots).
- **Heartbeat removed.** Viewport heartbeat (1s interval) was generating ~60 fake events/min, inflating session duration to 960+ minutes. Removed entirely — real scroll events are sufficient.
- **Mousemove throttle.** 100ms → 500ms (10/s → 2/s). Matches Mouseflow. Eliminates event count bloat.
- **SPA navigation debounce.** Only creates new session when pathname changes (ignores hash/query). 1s debounce prevents framework-triggered session spam.
- **Domain check fix.** `checkDomain` strips path from configured domains before comparing with `location.hostname`.
- **Session creation error handling.** Checks `xhr.status >= 400` instead of silently ignoring errors. Sends immediate heartbeat on session ready for faster verification.
- **Cache-busting.** Script URL `?v=` changed from hourly to per-minute to prevent stale cached scripts.

### research-frontend — Session replay
- **rrweb Replayer.** `SessionReplayPlayer` lazy-loads rrweb `Replayer` class (~51KB gzip). Renders DOM-based replay in iframe with mouse trail, play/pause/seek controls. Falls back gracefully for pre-migration sessions.
- **Legacy session indicator.** Replay button grayed out for sessions without DOM recording. Prevents confusing "No DOM recording" message.
- **Friendly visitor names.** Cryptic IDs (`v_f4rc0yl7cqm...`) replaced with deterministic human-readable names (`Blue Fox`, `Jade Owl`) via hash-based lookup. Applied to Sessions, Live, and Replay.

### research-frontend — Page Flow diagram
- **Visual flowchart.** Replaced side-by-side Page Visits / Transitions lists with SVG flowchart. Page nodes as colored boxes (intensity = traffic), Bézier arrows with thickness proportional to transitions. Top-down layout, rows centered, internal scroll.
- **Exit nodes.** Pages where visitors left the site show a separate red dashed box below with "N left / NN% exit", connected by red dashed arrow. Visually isolates leak points.
- **Node contrast.** Light nodes use blue-400/blue-100 with white text (legible). Arrow labels show `N×` (transition count only, no misleading %).

### research-frontend — Verification
- **Single request.** Verify installation changed from 40-request polling loop (1.5s × 60s) to single check against last 5 minutes.

### infra
- **GitHub Actions removed.** All 4 CI/CD workflows deleted. Deploy is manual via scripts.

### database
- **Migration 031.** `ALTER TABLE tracking_sessions ADD COLUMN rrweb_events LONGTEXT DEFAULT NULL`.

---

## v0.72.2 — Docs and .agent cleanup (2026-05-14)

### docs
- **Removed obsolete files.** Deleted `CHANGELOG.md` (redundant with root), `FASE2_NEURO_COMPLETION_PLAN.md` (executed), `prompt.md` and `propuesta.md` (superseded), `design-system/README.md` (Vambe analysis), `research/` sample images.
- **Kept active docs.** `cpanel-runbook.md`, `design-system/` spec, `coolTool/` comparison, `credentials/`.

### .agent
- **Removed obsolete files.** Deleted `SYSTEM_ARCHITECTURE.md` (covered by CLAUDE.md) and `rules.md` (covered by Conventions in CLAUDE.md).
- **Simplified README.** Replaced 393-line index with concise table pointing to 6 remaining docs.

### patterns
- **Removed `devops.md`.** Redundant with Deploy Skill + `cpanel-runbook.md`. Kept `backend.md`, `frontend.md`, `fullstack.md`.

### infrastructure
- **Removed entirely.** Legacy Terraform AWS config — project runs on cPanel/Passenger since v0.68.0.

### scripts
- **Removed 27 obsolete scripts.** AWS setup/CloudFront/Cognito/S3 (17), one-off migrations (4), manual quota tests (5), data copy SQL (1). Kept 12 active: 4 deploy, 2 ONNX converters, SSH, seeds, builds, monitoring.

---

## v0.72.1 — IAT error analysis readable (2026-05-14)

### backend
- **Readable error analysis.** Phase labels show Practice/Test A/Test B instead of block-1/block-2/block-3. Criterion UUIDs resolved to human names. Combinations aggregated by name, filtered to errors only, capped at top 10.

### research-frontend
- **Error table clarity.** Columns renamed to Stimulus/Response/Error %/Errors Total. Only non-zero error combinations shown.

---

## v0.72.0 — IAT RT distribution, raw trial export, research filters (2026-05-14)

### backend
- **RT distribution stats.** `computeRTDistribution` returns box-plot data (min/Q1/median/Q3/max/mean/stdDev) per target. Whiskers capped at 1.5×IQR. Added `rtDistribution` to IAT response.
- **Raw trial export endpoint.** `GET /analytics/research/:id/implicit-association/raw-trials` returns flat array of all IAT trials with resolved target/criterion names.
- **Fix: Attribute Testing scores always 0%.** Trial data stores `criterionId` = target chosen and `targetId` = criterion shown (inverted semantics). Score lookup now uses `rtMap[target.id][attr.id]` for Attribute Testing.
- **Fix: participant data phase filter.** `computeIATParticipantData` now includes `block-*` phases, not just `test`. Attribute Testing uses `block-2` for actual trials.

### research-frontend
- **RT Distribution box plot.** `RTDistributionCard` renders horizontal SVG box plots per condition with whiskers, IQR box, median line, mean dot. Applies to all 3 IAT paradigms.
- **IAT raw trials in XLSX.** New "IAT Raw Trials" sheet with participantId, module, phase, target, criterion, RT, correct. Fetched via new endpoint.
- **Export XLSX button in IAT results.** Header button triggers full XLSX export with participant filter support.
- **IAT slides in PPTX.** Overview slide (metric cards + association scores table) + D-score detail slide (individual table, error summary). Wired into `ResearchResultsPage` export.
- **Research page filters.** Search (name, author, enterprise), technique dropdown, enterprise dropdown, date range, archived toggle, clear button, result count. Both card and table views.
- **Dashboard filters.** Same filter bar added to Dashboard research table: search, technique, enterprise, date range, archived toggle. Author and Enterprise columns replace Responses.

---

## v0.71.2 — IAT association strength, preview images, no-bias criteria (2026-05-11)

### research-frontend
- **IAT association strength badges.** All 3 IAT charts (Attribute Testing, Comparing Attribute, Objects Comparing) now show association strength per item: Fuerte (≥70%), Media (40-69%), Baja (15-39%), Sin asociación (<15%). Color-coded badges below each chart.
- **Attribute Testing: no target selector.** Criteria table hides the "Target" column — attributes iterate through all targets without pre-assignment (no prior bias). `hideTargetSelector` prop on `IATCriteriaEditor`.
- **IAT Preview: stimulus images.** Trial phase now renders target images (via `resolveMediaUrl`) when available, instead of text-only. `stimulusImage` field added to `PreviewTrial`.

---

## v0.71.1 — Studio layout, PPTX export, prediction trigger (2026-05-11)

### research-frontend
- **Studio layout.** Results page fills viewport — no page scroll. Top bar (tabs + exports), content below with internal scroll only.
- **Executive Summary as Drawer.** Moved from inline card to slide-in Drawer (520px). "Summary" button in top bar opens it. Download PDF button inside.
- **AlertsBar as popover.** Converted from full-width cards to bell icon with notification dot in top bar. Click opens dropdown with dismissable alerts.
- **PPTX export.** "Slides" button generates Google Slides-compatible presentation: title, executive summary, SmartVOC metrics/NPS/NEV/VOC, Cognitive Tasks (choice/scale/text/ranking), themes. Uses `pptxgenjs` (lazy-loaded).
- **Cognitive module selector.** Checkbox dropdown above cards to filter which modules are visible. Shows count ("3 of 7 modules").
- **Navigation Test prediction trigger.** "Run Attention Prediction" button in Prediction tab when no data exists. Calls `POST /attention-prediction/.../predict` with `imageIndex` for multi-image.
- **Export buttons unified.** XLSX, Slides, PDF buttons same height (`px-3 py-1.5 text-xs`).

---

## v0.71.0 — Funnel comparison, executive summary overhaul, filter-aware exports (2026-05-11)

### research-frontend
- **Funnel Comparison tab.** New "Comparison" sub-tab in Funnels showing all custom funnels ranked by conversion rate. Table with visitors, conversion bars, avg drop-off, best/worst step. Uses `useQueries` for parallel data fetch (React Query dedup).
- **Custom Funnels scroll containment.** Container uses fixed height with `overflow-y-auto` on cards panel — page never scrolls from funnel count.
- **Executive Summary smooth collapse.** Replaced mount/unmount toggle with CSS `max-height` + `opacity` transition (300ms ease-in-out). Chevron rotates smoothly. Fixed nested `<button>` DOM warning — header now uses `<div role="button">`.
- **Export XLSX + Report PDF grouped.** Both buttons wrapped in flex container, aligned together at right side of tab bar.
- **Min. Completion filter persistence.** SmartVOC and Cognitive Task results migrated from inline filter logic to shared `useResultsFilter` hook. `completionMin` now persists in `localStorage` per research across all 5 result tabs.
- **Min. Completion applied to exports.** Export XLSX, Report PDF, and Executive Summary all receive `filteredParticipantIds` from `useResultsFilter`. XLSX filters all sheets client-side. PDF and Executive Summary pass participant IDs to backend.
- **Theme verbatim drawer.** Clicking a theme in VOC/Text analysis opens a slide-in drawer showing the exact participant quotes that support that theme. Themes with quotes show a quote icon and hover highlight.
- **Comment checkboxes functional.** Selecting comments in the table now affects "Analyze with AI" — analyzes only selected comments instead of all. Button label updates dynamically ("Analyze 3 selected"). Backend accepts `selectedTexts` to skip DB fetch.

### backend
- **Executive Summary rewrite.** Prompt now in Spanish. Gathers data from all module types: SmartVOC (NPS/CSAT/CES/CV/NEV), Screener, Cognitive Tasks (choices, scales, ranking), IAT (reaction times), verbatims with sentiment. Demographics included as context only. Instructions: focus on results, cite verbatims as evidence.
- **Executive Summary participant filter.** `POST /executive-summary` accepts `participantIds` in body. All SQL queries apply `AND resp.participant_id IN (...)` when provided.
- **Theme supporting quotes.** `analyzeInsights` prompt now requests 2-5 exact verbatim quotes per theme (`supportingQuotes` field). No paraphrasing.
- **Text analysis selected texts.** `POST /text-analysis/:moduleId` accepts `selectedTexts` array in body. When provided, uses those texts directly instead of fetching from DB.

---

## v0.70.10 — Fix CORS for external tracking sites (2026-05-11)

### backend
- **Fix: CORS blocking external sites.** `server-cpanel.js` CORS middleware rejected origins not matching `emotio.cx`, preventing tracking on external sites (Joomla, WordPress, etc.). Now accepts any origin — domain validation handled by `createSession` via `allowedDomains` config.

---

## v0.70.9 — Session replay: YouTube-style play/pause overlay (2026-05-11)

### research-frontend
- **Play/pause overlay.** Large centered button on replay viewport. Visible when paused, appears on hover when playing. Click anywhere on viewport to toggle. Matches YouTube behavior.

---

## v0.70.8 — Sessions master-detail layout (2026-05-11)

### research-frontend
- **Sessions master-detail.** Visitor list on the left (340px, scroll), detail panel on the right with page table (#, Time, URL, Timeline, Duration, Events, Replay). Selected visitor highlighted with blue left border. Empty state when no visitor selected.

---

## v0.70.7 — Direct PDF download, screenshot-first heatmap (2026-05-11)

### research-frontend
- **Direct PDF download.** Replaced `window.print()` with `html2pdf.js` — generates and downloads PDF directly without print dialog. Applied to both `WebTrackingReportButton` and `ReportGenerator`.
- **Screenshot-first heatmap.** `MultiLayerHeatmap` now uses captured screenshot as primary backdrop. Proxy iframe only as fallback when no screenshot exists. Fixes broken CSS/images in proxy rendering.
- **PDF i18n.** EN/ES language selector in report picker. All labels, headers, dates respect selected language.
- **Progress bar.** Generate button shows 0-100% fill with step label during report generation.

---

## v0.70.6 — PDF report: i18n EN/ES, progress bar, language selector (2026-05-11)

### research-frontend
- **PDF report language selector.** EN/ES toggle in picker footer. All report labels, headers, dates, and print button respect selected language.
- **Progress bar in button.** Generate button fills 0-100% with step label while fetching data. Fixed height — no layout shift.

---

## v0.70.5 — Funnels: Page Flow side by side, funnel editor fix (2026-05-11)

### research-frontend
- **Page Flow side by side.** "Page Visits" and "Transitions" merged into single "Page Flow" sub-tab. Desktop: flex 50/50 with internal scroll. Mobile: tab switcher.
- **Funnel editor loads data.** Added `key={funnel.id}` to `FunnelEditor` — forces re-mount on edit, loads correct name and steps.
- **Funnels expanded by default.** Funnel cards start expanded instead of collapsed.

---

## v0.70.4 — Analyze endpoint: fire-and-forget with polling (2026-05-10)

### backend
- **`POST /analyze/:mediaId` fire-and-forget.** Responds immediately (202) and runs GPT-4o in background. Saves status to `stimulus.aiAnalysisStatus` (processing/complete/error).
- **`GET /analyze/:mediaId/status` polling endpoint.** Returns current status + analysis result when complete.

### research-frontend
- **Polling-based analysis.** `analyzeAttention` POST launches job, then polls status 3 times at 15s intervals (45s window). Immune to HTTP/2 proxy timeouts.
- **Network retry.** `apiClient` retries 2x on network errors with backoff.
- **Heatmap blur fix.** Blur scales as fraction of radius (min 50% for dense saliency).

### infrastructure
- **Apache `.htaccess` timeout 120s.** For other long-running endpoints.

---

## v0.70.3 — Fix request timeouts, heatmap blur, network retry (2026-05-10)

### infrastructure
- **Fix: Apache proxy timeout.** `TimeOut 120` + `RequestReadTimeout body=120` in `.htaccess`. Long-running endpoints (GPT-4o analysis, 30-60s) were being killed at 30s default, causing `ERR_NETWORK_CHANGED` in browser.

### research-frontend
- **Fix: heatmap "Detailed" preset artifacts.** Blur now scales as fraction of radius (min 50% for dense saliency). Prevents discrete dots when blur is low.
- **Network retry.** `apiClient` retries up to 2x on network errors with 1s/2s backoff. Covers transient failures transparently.
- **Canvas `willReadFrequently`.** Eliminates Chrome performance warning.

---

## v0.70.2 — Attention Prediction heatmap transparency fix (2026-05-10)

### research-frontend
- **Fix: heatmap too opaque.** Dark overlay reduced from 45-72% to max 40% (scaled). Heatmap canvas drawn with `globalAlpha` (50-100%) so the image always shows through clearly.
- **Fix: white flash on heatmap peaks.** Gradient endpoint changed from `#fff` to `#f00` — max intensity is solid red, no white artifacts.
- **Fix: canvas readback warning.** Added `willReadFrequently: true` to both canvas contexts in `HeatmapRenderer`.
- **Presets adjusted.** Smooth: 40%, Balanced: 50%, Detailed: 65% (was 60/72/85%).

---

## v0.70.1 — Website Tracking: PDF report with AI analysis, tooltip fixes (2026-05-10)

### research-frontend
- **PDF Report with section picker.** `WebTrackingReportButton` shows grouped checkboxes matching tab/subtab structure (Funnels, Heatmaps, Sessions, Live, AI Analysis). Only fetches data for selected sections.
- **AI Analysis in PDF.** When enabled, calls `POST /tracking/:id/report` with selected sections. GPT-4o generates contextual analysis (usability score, findings, recommendations, issues) based only on provided data.
- **Portal tooltips.** `Tip` component renders via `createPortal` with viewport clamping. Applied to all tabs, layer toggles, sliders, device buttons, and funnel sub-tabs.
- **Heatmap inline.** Removed modal — heatmap renders directly in tab with full height. Page selector uses `CustomSelect`.
- **Sessions simplified.** Removed "All Sessions" table, only Visitor accordion remains.

### backend
- **`POST /tracking/:id/report`** — contextual AI report generation. Prompt built dynamically from selected sections. Cached in `config.trackingReport`.
- **`GET /tracking/:id/report`** — returns cached report.

---

## v0.70.0 — Website Tracking: snippet rewrite, layout overhaul (2026-05-10)

### backend — Tracking snippet v2
- **Raw pixel coordinates.** Snippet now stores `pageX`/`pageY` as integers. Backend normalizes at query time (`x / viewport_width * 100`). Eliminates double-normalization bug that made all heatmaps render incorrectly.
- **Event queue with retry.** Events buffer until session ID confirms, then flush. Session creation retries once on failure. No more lost events.
- **Viewport heartbeat.** Emits scroll position every 1s for accurate attention heatmap (time-per-zone).
- **Mousemove throttle 100ms.** Matches Hotjar (10 events/s instead of 20).
- **Auth token via query param.** `proxy-page` endpoint accepts `?token=` for iframe authentication.
- **Auth error handling.** Tracking routes return 401 (not 500) on invalid token.

### research-frontend — Results layout
- **Heatmap inline.** Removed modal — heatmap renders directly in the tab with full viewport height.
- **Compact toolbar.** Stats collapsed to inline text. Tabs + stats + date + export in one row.
- **Page selector.** CustomSelect dropdown replaces intermediate table. Select → see heatmap instantly.
- **Sessions unified.** Removed redundant "All Sessions" table — only Visitor accordion with expandable journeys.
- **Funnels simplified.** 3 sub-tabs (Custom Funnels, Page Visits, Transitions). Removed "Tracked Pages" grid.
- **Portal tooltips.** All tabs, layer buttons, sliders, and device filters have portal-based tooltips (never clipped by overflow, viewport-clamped).

### infrastructure
- **Test page fixed.** `emotio.cx/test-tracking` updated with correct research ID. `allowedDomains` corrected from `"emotio.cx/test-tracking"` to `"emotio.cx"`.

---

## v0.69.1 — Fix attention score gauge and profile-aware AI analysis (2026-05-04)

### research-frontend
- **Fix: attention score gauge number.** `ScoreGauge` SVG text was invisible due to CSS `rotate-90 origin-center` not working on SVG `<text>` elements. Replaced with native SVG `transform="rotate(90, cx, cy)"`.

### backend
- **Fix: AI analysis ignoring analysis profile.** `analyzeAttentionWithAI` now receives the `AnalysisProfile` and injects viewer context (gender, age, interests, intention, stimulus context) into the LLM prompt. Previously, the profile only affected the hybrid saliency heatmap but not the textual analysis (AOIs, attention flow, gaze path, neuro-insights), causing identical results across different profiles.
- **Controller reads profile from research settings.** `/analyze/:mediaId` endpoint reads `settings.analysisProfile` and passes it through the analysis chain.

---

## v0.69.0 — Roadmap completion: Neuro, AI automation, blockchain integration (2026-05-03)

### Fase 3 — Data visualization & management
- **Multi-sheet XLSX export.** Participants + SmartVOC + Eye Tracking + IAT in separate sheets.
- **Dashboard cross-research.** Summary cards (total, active, participants, completion rate), activity chart, status breakdown, top-by-participants, NPS/CSAT/CES trends. `GET /research/dashboard-summary`.
- **Search & archive.** Search by name, archive/unarchive toggle, `research_tags` table (migration 027).
- **Enterprise metrics trends.** Participants over time chart, SmartVOC metric deltas (month-over-month).

### Fase 5 — Analysis automation
- **Auto-trigger LLM.** Text analysis fires on status→completed and every 10 participants (`checkAutoAnalysisThreshold`).
- **Executive summary.** `POST/GET /analytics/research/:id/executive-summary`. GPT-4o generates overview, key findings, recommendations with historical benchmark comparison. Cached in config. `ExecutiveSummaryPanel` collapsible in results.
- **Alerts.** `GET /analytics/research/:id/alerts`. NPS drop, negative sentiment spike, participant milestones. `AlertsBar` dismissable in results.
- **PDF report.** `ReportGeneratorButton` opens print-optimized HTML window with metrics, findings, sentiment bars.

### Fase 2 — Neuro completion
- **ET quality fixes.** Recalibration counter increment, mobile integrityScore capped at 0.8, click-proxy classified as max `fair`, video `onEnded` handler, ShelfGrid `overflow-hidden`, low-res camera warning.
- **FACS Action Units.** `extractActionUnitsFrom68()` — 9 AUs (AU1,2,4,6,12,15,20,25,26) from face-api 68 landmarks. `face_landmark_68` model added. `ActionUnitsPanel` in EmotionPanel (bars + timeline heatmap).
- **Micro-expressions.** `microExpressionDetector.ts` — sliding window, brief (<200ms) + micro (200-500ms). Stored in response, aggregated in backend, `MicroExpressionsPanel` in results.
- **IAT D-score.** Trials <300ms excluded (Greenwald 2003). Split-half reliability with Spearman-Brown correction.

### New modules
- **Emotion Analysis.** Standalone webcam emotion module (no eye tracking). Module template (migration 028), `EmotionAnalysisRenderer`, `EmotionAnalysisResults`, `GET /analytics/research/:id/emotion-analysis`.
- **EEG Recording.** Web Bluetooth pairing (Muse/Emotiv/OpenBCI), 5-band power, attention/meditation indices. Module template (migration 029), `EEGRenderer`, `GET /analytics/research/:id/eeg`.
- **Biometric Wearable.** BLE heart rate (standard 0x180D), RR intervals, HRV (RMSSD/SDNN), stress index. Module template (migration 029), `WearableRenderer`, `GET /analytics/research/:id/wearable`.

### Cerulean Ledger integration
- **Research integrity.** SHA-256 hash of all responses → blockchain transaction. `POST /cerulean/research/:id/certify`, `GET .../verify`. Auto-triggered on study close.
- **Study certificate.** Verifiable credential issued on completion. `POST/GET /cerulean/research/:id/certificate`.
- **Participant DID.** Privacy-preserving `did:cerulean:participant-{hash}` registered on response save.
- **Audit trail.** Create/activate/close/certify actions recorded as immutable transactions.
- **Frontend.** `BlockchainCertification` component with verified/mismatch status and expandable details.
- **Config.** `CERULEAN_ENABLED`, `CERULEAN_API_URL`, `CERULEAN_ORG_ID` env vars.

### Attention prediction enhancements
- **Analysis profiles.** `AnalysisProfile` type (gender, age, interests, context, intention, description). Dynamic β by context: shelf/packaging=0.50, ad=0.45, web=0.40. Profile-aware prompts for Gemini/GPT-4o. `AnalysisProfilePanel` in AttentionPredictionView. Persisted in research settings.
- **Brand attention score.** AI analysis prompt detects logos, reports bbox + saliencyScore + brandAttentionScore. `Brand Attention` section in AiAnalysisPanel.
- **ViT ensemble.** Bottom-up feature-integration grid (1 iteration) ensembled with semantic grid (70/30).
- **Mouse attention map.** `GET /tracking/:id/mouse-attention` — mousemove events as gaze proxy heatmap.
- **Attention-memory gap.** `attentionMemoryGap` field in AOI metrics for post-survey recall correlation.

### Database
- Migration 027: `research_tags` table + `archived_at` column on researches.
- Migration 028: Emotion Analysis module + stage template.
- Migration 029: EEG Recording + Biometric Wearable module + stage templates.

---

## v0.68.0 — Website Tracking UX overhaul, attention prediction pipeline v2 (2026-05-03)

### backend — Website Tracking
- **Verify flag persisted.** `trackingConfig.verified` saved on first successful verification. Survives page reload.
- **Client-side screenshot capture.** Snippet uses `html2canvas` to capture pixel-perfect screenshots per device category (mobile/tablet/desktop). `POST /public/tracking/:id/screenshot` saves base64 JPEG to filesystem. `screenshot_devices` JSON column in `tracking_pages`.
- **Attention heatmap: viewport time.** Replaces mousemove dwell with scroll-based viewport time per horizontal band. Measures how long each page zone was visible in the visitor's viewport.
- **Live sessions fix.** Detects active sessions by last event timestamp (not just `started_at`), so long-running tabs appear as live.
- **Session replay: all events returned.** Removed burst filtering — frontend handles compression/speed.
- **JSON body limit 10mb** in `server-cpanel.js` for screenshot payloads.

### backend — Attention Prediction
- **3× TranSalNet averaged.** Runs 3 augmentations (original, h-flip, crop 90%) and averages directly (replaces 4-augmentation logit-space fusion). Preserves natural distribution.
- **Mild center bias.** σ=0.5, floor 60% — periphery retains most of its value instead of being suppressed.
- **Stochastic jitter.** Post-fusion gaussian noise (Box-Muller, smooth field interpolation) breaks mechanical symmetry. Jitter=0.15 for standard, 0.12 for hybrid. Simulates inter-subject variability.
- **Focal equalization.** In hybrid predict: peripheral boost (1.0→1.5) × semantic boost (0.7→1.3) × center attenuation (0.7→1.0). Redistributes attention toward periphery where content exists.
- **Auto-presets.** `computeAutoPresets` analyzes map distribution (concentration, coverage) and recommends blur/opacity/threshold. Returned with each prediction in `autoPresets`.
- **Gridded AOIs.** `computeGriddedAOIs` divides saliency map into 4×4 grid, clusters high-attention cells via flood-fill. Returns ranked AOIs with bounding boxes. Saved as `griddedAOIs` per stimulus.

### research-frontend — Website Tracking
- **Tabs reordered.** Funnels (default) → Heatmaps → Sessions → Live. Visitors and Sessions merged into single "Sessions" tab.
- **Funnel visual.** SVG trapezoids narrowing by conversion rate. "Ver página" button on each step navigates to the page's heatmap.
- **Tracked Pages grid.** Screenshot thumbnail cards below funnels — click opens page heatmap.
- **Device filter.** Desktop/Tablet/Mobile buttons enabled only when screenshot data exists for that device.
- **Attention tab.** Horizontal color bands (green→yellow→red) based on viewport time. No simpleheat — direct canvas bands.
- **Click heatmap.** Red-only gradient (no white center holes).
- **Sessions tab.** Visitor journeys + grouped sessions with expandable accordion. Skeleton loading.
- **Session Replay rewritten.** Screenshot background + animated cursor (blue ring) + click ripples (red, 2s fade). Real timestamps, 1x/4x/8x/16x speed controls, "Skip idle" button. Portal-based modal for full-screen coverage.
- **Tooltips.** Instant CSS hover tooltips on Visitors table headers (Visit order, Timeline, Duration, Events).

### tracking snippet
- **html2canvas screenshot.** Dynamically loads from CDN, captures `document.documentElement`, waits for images to load, JPEG quality 0.85, 8000px height cap. Device classification by viewport width.
- **No `allowTaint`.** Fixes `SecurityError` on `toDataURL` with cross-origin images.

### database
- **Migration 026.** `screenshot_devices` JSON column on `tracking_pages`.

---

## v0.67.2 — Configurable saliency model, conversion scripts for TranSalNet_Dense and SUM (2026-04-30)

### backend
- **Configurable saliency model.** `SALIENCY_MODEL` env var selects ONNX file (default `transalnet_res.onnx`). `SALIENCY_WIDTH` / `SALIENCY_HEIGHT` configure input dimensions (default 384×288, SUM uses 256×256). Hot-swap on restart.

### scripts
- **`convert-transalnet-to-onnx.py`** — Converts TranSalNet_Dense (DenseNet-161) or TranSalNet_Res (ResNet-50) `.pth` to ONNX. Requires cloned repo + pretrained weights.
- **`convert-sum-to-onnx.py`** — Converts SUM (WACV 2025) `.pth` to ONNX with condition code support (SALICON/eye-tracking/e-commerce/UI).

---

## v0.67.1 — Attention Prediction: hybrid predict button, 3 toggleable gaze paths (2026-04-30)

### backend
- **AI analysis prompt: 3 gaze path routes.** Prompt now requests `gazePathRoutes` with 3 distinct viewing strategies (Typical Scan, Group/Category Scan, Novelty/Differentiation Search), each with 5-10 fixation points.
- **`gazePathRoutes` type.** Added to `AiAnalysisResult` — array of `{id, name, description, fixations[]}`.

### research-frontend
- **Hybrid Predict button.** Purple "Hybrid Predict" button in AttentionPredictionCard header. Calls `POST /hybrid-predict` (TranSalNet TTA + LLM semantic fusion). Saves hybrid heatmap to stimulus config.
- **3 toggleable gaze path routes.** Gaze Paths tab shows colored toggle buttons per route (blue/green/amber). Each route renders its own `GazePathOverlay` with unique color and arrow markers. Falls back to single path if `gazePathRoutes` not available.
- **GazePathOverlay `routeColor` + `markerId`.** Supports fixed color and unique SVG marker IDs for multi-route rendering without conflicts.

---

## v0.67.0 — Attention Prediction: UI tabs, TTA pipeline, hybrid saliency fusion (2026-04-30)

### backend
- **TTA pipeline.** `predictAttention` now runs 4 augmented inferences (original, h-flip, brightness +10%, center crop 95%), fuses in logit space, applies center bias correction (gaussian σ=0.4), box blur (radius 5, 3-pass), and normalization. ~4x more stable predictions.
- **`predictAttentionRaw` export.** Returns the raw Float32Array saliency map for downstream fusion.
- **Semantic saliency grid.** `generateSemanticGrid` asks Gemini/GPT-4o to produce a 10×8 attention weight grid based on semantic content (faces, text, logos, objects). Runs 3 iterations and averages to reduce hallucination variance.
- **Hybrid fusion endpoint.** `POST /attention-prediction/research/:id/module/:mediaId/hybrid-predict` — runs TranSalNet TTA + LLM semantic grid → bilinear interpolation → weighted fusion (`α=0.65` computational + `β=0.35` semantic). Saves result with `hybridPrediction: true` flag.

### research-frontend
- **AttentionPredictionCard tabs redesign.** 4 tabs over the stimulus image matching UE Attention Lab layout:
  - **Original** — raw image with zoom
  - **Heatmap** — saliency overlay with inline presets/sliders, video scrubber for video stimuli
  - **Gaze Paths** — predicted fixations on dark alpha overlay (40% black) for visibility, scanpath animation below
  - **AOI Editor** — dedicated tab with "+ Create Manual Zone", colored semitransparent rectangles (7 rotating colors), per-AOI color bar + percentage + remove

---

## v0.66.3 — Website Tracking: session replay heatmap, unified visitor timeline, live activity detail (2026-04-30)

### research-frontend
- **Session replay heatmap.** Clicks rendered as simpleheat overlay (green→red→white) with dark layer, replacing cursor dot. Accumulated progressively during playback.
- **Unified visitor timeline.** Replay loads ALL sessions of the same visitor into one continuous timeline instead of single-session view. DOM snapshot updates dynamically as the playback crosses page boundaries.
- **Live tab activity detail.** Each live visitor row shows page-by-page journey with timestamps (HH:mm:ss), event counts, and per-page replay buttons. Main "Replay" button opens the latest session.

---

## v0.66.2 — Website Tracking: SSE live stream, legacy coordinate normalization, visitor timestamps (2026-04-29)

### backend
- **Fix: legacy pixel coordinates.** Click and attention heatmap queries now normalize coordinates stored as raw pixels (legacy data) by dividing by `viewport_width` when values exceed 100. New data (already percentages) passes through unchanged.
- **SSE live stream.** `GET /tracking/:id/live/stream?token=xxx` — Server-Sent Events endpoint replaces polling. Pushes live session data every 5s, pings every 30s, cleans up on disconnect. Registered in both `server-cpanel.js` (Passenger entry) and `server-cpanel.ts`.

### research-frontend
- **Live tab uses SSE.** `LiveSessionsTab` connects via `EventSource` when the tab is active, disconnects on tab change. Replaces `refetchInterval: 5000` polling.
- **Visitor accordion timestamps.** Each page row in the expanded visitor accordion shows the visit time (HH:mm).

---

## v0.66.1 — Website Tracking: fix snippet crash, heatmap coordinates, configurable funnels, replay modal (2026-04-29)

### backend
- **Fix: snippet `pageStart` scope crash.** Variable declared inside `startCapture` but assigned in `createNewSession` — `"use strict"` threw silent `ReferenceError`, preventing all session creation. Moved to IIFE scope.
- **Fix: `getTrackedPages` adds `lastVisitedAt`.** `MAX(started_at)` included in query and response.
- **Tracking config returns `funnels`.** `getTrackingConfig` now includes `funnels[]` from stored config.
- **Authenticated GET config endpoint.** `GET /tracking/:id/config` (auth) returns full tracking config including funnels.
- **Configurable funnels.** `FunnelDefinition` type: `{id, name, steps: [{url, label}]}`. Stored in `config.trackingConfig.funnels`. New `computeFunnelDropoff` computes sequential visitor reach per step.
- **Funnel drop-off endpoint.** `GET /tracking/:id/funnels/:funnelId` returns per-step visitor count, percentage, drop-off, and overall conversion rate.

### research-frontend
- **Fix: heatmap Y coordinates.** Click, attention, and scroll overlays used `(y/100)*height` but Y is stored as `pageY/viewportWidth*100`. Changed to `(y/100)*width` in `PageSnapshotHeatmap` and `AttentionHeatmapOverlay`.
- **Scroll tab uses DOM snapshot.** `PageSnapshotHeatmap` now supports `heatmapType="scroll"` — renders color-gradient bands (green→red) with percentage labels over the page snapshot. Replaces standalone `ScrollDepthChart` when a page is selected.
- **Session replay as modal.** `SessionReplayPlayer` renders as a fixed overlay (90vw×85vh) instead of replacing the results view. Closes on `×`, backdrop click, or Escape. Uses DOM snapshot iframe instead of requiring a screenshot.
- **Last Visit column.** Pages table shows formatted date+time (`dd/mm/yy HH:mm`) in a new "Last Visit" column.
- **Date+time in Sessions tab.** DATE column now includes time via `formatDateTime`.
- **Date+time in Visitors tab.** Last seen timestamp shown above page count.
- **Configurable funnels UI.** "Create Funnel" button in Funnels tab. Inline editor with name + ordered URL steps + labels. Edit/delete existing funnels. `FunnelDropoffCard` shows step-by-step bars with visitor counts, percentages, drop-off between steps, and conversion rate badge.
- **Status modal contextual texts.** `StatusModal` accepts `researchTypeName` and adapts Draft/Active/Completed descriptions for Website Tracking, Attention Prediction, and Insights Finding.

---

## v0.66.0 — Website Tracking: heatmap views, session replay timeline, friction tags, live sessions (2026-04-29)

### backend
- **DOM snapshot capture.** `POST /public/tracking/:id/snapshot` stores page HTML (scripts stripped) in `tracking_pages.page_snapshot`. Snippet captures automatically after session creation.
- **Attention heatmap.** `GET /tracking/:id/attention?page=URL&device=X` aggregates mousemove dwell time per 2% grid zone.
- **Visitor journeys.** `GET /tracking/:id/visitors` groups sessions by visitor with page-by-page breakdown (duration, clicks per page).
- **Live sessions.** `GET /tracking/:id/live` returns sessions active in last 5 minutes, grouped by visitor.
- **Friction detection.** Snippet detects dead-click, rage-click (3+ in 1s same area), speed-browsing (<2s on page), mouse-out. Stored in event `metadata.friction`. Endpoints: `GET /tracking/:id/friction` (summary), `GET /tracking/:id/friction/sessions` (per-session tags).
- **Date range filter.** `getOverviewMetrics` accepts `from`/`to` query params.
- **Sampling rate.** Config field `samplingRate` (1-100%). Snippet checks at init with localStorage persistence per visitor.
- **IP exclusion.** `excludedIPs` in config. `createSession` checks `X-Forwarded-For`.
- **Page targeting.** `targetPages`/`excludePages` in config. Snippet checks URL patterns at init.
- **Data retention.** `dataRetentionDays` in config (30/60/90/180).

### research-frontend
- **Heatmaps tab restructured.** Single "Heatmaps" tab with sub-tabs: Click, Scroll, Attention. Page metrics table replaces button selector (Views, Clicks, Snapshot status).
- **DOM snapshot rendering.** `PageSnapshotHeatmap` renders captured HTML in sandboxed iframe with heatmap canvas overlay. Scripts sanitized (regex strip of `<script>`, inline handlers, `javascript:` URLs).
- **Scroll heatmap overlay.** `ScrollHeatmapOverlay` renders gradient bands (green→red) over screenshot with % labels.
- **Attention heatmap overlay.** `AttentionHeatmapOverlay` with blue→red simpleheat gradient.
- **Heatmap intensity/opacity sliders.** Adjustable radius and overlay darkness on click and attention heatmaps.
- **Session replay timeline bar.** Mouseflow-style colored bar: red=click, gray=move, dark=idle. Clickable for seeking. Playhead synced.
- **Visitors tab.** Expandable visitor list with page-by-page journey (duration bars, click count, replay per page).
- **Live sessions tab.** Real-time view polling every 5s with green dot indicator, visitor pages as tags.
- **Friction badges.** Color-coded tags (dead-click, rage-click, speed-browsing, mouse-out) on session table rows.
- **Date range filter.** Date inputs above overview cards, filters metrics by period.
- **Tracking Configuration sidebar link.** Separate "Tracking Configuration" and "View Results" links for Website Tracking.
- **Config layout.** Compact 3-column grid (Snippet, Domains, Capture). Status badge (Recording/Draft). Sampling slider, IP exclusion, page targeting, data retention controls.
- **Consent banner config.** Separated labels from inputs, max-width on text field.

### tracking snippet
- **Friction detection.** Dead-click, rage-click, speed-browsing, mouse-out auto-detected and sent as event metadata.
- **Sampling.** Checks `samplingRate` at init with localStorage-persisted decision per visitor.
- **Page targeting.** `checkPage()` validates URL against include/exclude patterns.
- **Content-Type fix.** Reverted to `application/json` (text/plain wasn't parsed by Express).

---

## v0.65.1 — Fix IAT analytics empty charts, fix Eye Tracking shelf grid overflow (2026-04-28)

### backend
- **Fix: IAT module filter.** Analytics query now filters by module name (`Attribute`/`Comparing`/`Objects`) instead of selecting all modules in the Implicit Association stage. Linear Scale modules in the stage were rendered as empty IAT cards.
- **Fix: IAT trial phase filter.** `computeIATScores` accepted only `phase === 'test'` but real trials use `block-1`/`block-2`/`block-3`. All block trials now included.
- **Fix: IAT compound targetId.** Comparing Attribute trials store `"object-1__criterion-UUID"` as targetId. Now extracts base ID (`object-1`) for RT grouping.
- **Fix: Objects Comparing scores.** Always uses `criteria-1`/`criteria-2` as chart dimensions instead of the ranking list items. Computes per-target association via block-2 vs block-3 RT differences.
- **Fix: ResponsiveContainer warning.** Added `minWidth={0}` to all IAT chart ResponsiveContainers.

### participant-frontend
- **Fix: Shelf grid column overflow.** `ShelfGrid` used `Math.max(shelfItems, urls.length)` as column count, expanding beyond researcher config when more images were uploaded. Now uses `shelfItems` directly.

---

## v0.65.0 — Website Tracking overhaul: bug fixes, coordinate normalization, SPA support, onboarding (2026-04-28)

### backend
- **Fix: apiBaseUrl construction.** Uses `API_BASE_URL` env var instead of deriving from `Host` header (unreliable in cPanel/Passenger).
- **Fix: script.js blocked in draft.** Removed status check from `getTrackingConfig` — script is now servable in draft for testing. Session creation still enforces active status.
- **Fix: sendBeacon CORS preflight.** Snippet now sends `text/plain` instead of `application/json`. Added `express.text()` middleware in both servers. Prevents silent event loss from failed preflight.
- **Fix: body parsing for text/plain.** `server.ts` and `server-cpanel.ts` detect string vs object body to avoid double-stringify.
- **Coordinate normalization.** Click and mousemove coordinates stored as viewport-relative percentages (`clientX/innerWidth*100`, `pageY/innerWidth*100`). Heatmap query clusters by `ROUND(x,1)`.
- **Domain validation server-side.** `createSession` validates `Origin`/`Referer` against `allowedDomains` config. Rejects requests from unauthorized domains.
- **Verification endpoint.** `GET /tracking/:id/verify?since=N` returns recent session count for real-time installation verification.
- **Consent banner configurable.** `consentText`, `consentAcceptLabel`, `consentDeclineLabel`, `consentPosition` (top/bottom) in tracking config with defaults.
- **Multi-viewport bucketing.** `getClickHeatmapData` accepts `device` param (mobile/tablet/desktop) filtering by viewport width breakpoints (0-767/768-1024/1025+).

### research-frontend
- **Verification polling.** "Verify Installation" polls for 60s with countdown, checking for real incoming sessions instead of HEAD-only check.
- **Screenshot prompt.** After successful verification, shows upload CTA for page screenshot to enable heatmap overlay.
- **Consent banner config UI.** When consent is enabled, shows text, accept/decline labels, and position (top/bottom) inputs.
- **Device filter on heatmap.** All/Desktop/Tablet/Mobile segmented buttons filter click heatmap by viewport category.
- **Onboarding checklist.** 4-step visual checklist: Activate → Copy snippet → Verify → View results.
- **Heatmap coordSystem.** Changed from `pixel` to `percent` for viewport-normalized coordinates.

### tracking snippet
- **Event buffering.** Capture listeners attach immediately; events buffer until session ID arrives, then flush.
- **Domain validation client-side.** `checkDomain()` validates `location.hostname` against `allowedDomains` at init.
- **Cache-busting.** Embed snippet adds `?v=` with hourly timestamp.
- **SPA navigation.** Intercepts `pushState`, `replaceState`, `popstate`. Creates new session per route change.
- **Configurable consent banner.** Text, button labels, and position (top/bottom) read from config.

---

## v0.64.0 — AI Analysis panel for Attention Prediction, inline heatmap controls, Website Tracking HEAD fix (2026-04-27)

### backend
- **AI Analysis endpoint.** `POST /attention-prediction/research/:id/analyze/:mediaId` sends the original image + TranSalNet saliency summary to GPT-4o Vision. Returns structured JSON: context detection, attention score, confidence, auto-detected AOIs, attention flow (entry/exit/leak), predicted gaze path, neuro-insights & Gestalt principles, methodology. Synchronous (await). Result cached in `stimulus.aiAnalysis`.
- **AI Analysis service.** `ai-analysis.service.ts` — resizes image to 1024px via sharp, base64-encodes for Vision API, summarizes top-15 heatmap hotspots as prompt context. Uses `OPENAI_MODEL` env var (default `gpt-4o`).
- **Fix: Website Tracking HEAD request.** `script.js` endpoint now accepts `HEAD` in addition to `GET`. Fixes "Verify Installation" returning "Could not reach the tracking script".

### research-frontend
- **AI Analysis panel.** `AiAnalysisPanel` with collapsible sections: context & scores (SVG circular gauges), auto-detected AOIs with individual/bulk import, attention flow (entry→exit + leak areas + visual path), predicted gaze path list, neuro-insights & Gestalt cards, technical methodology. "Analyze with AI" button triggers analysis; "Re-analyze" overwrites cached result.
- **Gaze Path tab.** New conditional tab in `AttentionPredictionCard` — renders `GazePathOverlay` (SVG numbered fixation points with saccade lines, blue→red color gradient by order).
- **Inline heatmap controls.** Compact preset buttons (Smooth/Balanced/Detailed) + blur/opacity/threshold sliders rendered below the tabs on the Prediction tab. Settings modal remains for preview + download.
- **Import AOIs from AI.** Auto-detected AOIs can be imported individually or in bulk into the manual AOI list. Duplicate labels are skipped.

---

## v0.63.2 — Website Tracking snippet comment, improved verification, deploy ONNX model sync (2026-04-27)

### backend
- **HTML comment in tracking snippet.** `generateEmbedSnippet` now prepends `<!-- EmotioCX Web Tracker -->` before the `<script>` tag, matching the Google Tag pattern for easy identification in source code.

### research-frontend
- **Improved Verify Installation.** Now performs a `HEAD` request to `script.js` before checking sessions. Three result states: script active with sessions (green), script reachable but no sessions yet (amber), script endpoint unreachable (red).

### infra
- **ONNX model sync in deploy script.** `deploy-backend-cpanel.sh` gains step 6b: checks if `transalnet_res.onnx` (~290MB) exists on the server and uploads it if missing.
- **Protect models/ in CI/CD.** `deploy-backend-cpanel.yml` rsync now excludes `models/` so `--delete` doesn't wipe the ONNX model on each deploy.

---

## v0.63.1 — Eye Tracking Shelf mode: column-based grid with auto-detection and auto-AOIs (2026-04-26)

### research-frontend
- **Shelf preview in builder.** `ModuleContentEditor` renders a column-based CSS Grid preview when multiple stimuli are uploaded. Each image fills an entire column, repeated across rows.
- **Auto-detect shelf mode.** When >1 image is uploaded, `display-mode` is automatically set to `shelf`. No manual toggle needed.
- **Auto-generated AOIs.** In shelf mode, one AOI per column (100% height) is auto-generated and saved to `aois` component. Regenerates when shelf-count, shelf-items, or stimuli change.
- **Shelf config conditional.** Shelf configuration panel (grid preview, Number of Shelfs, Items per Shelf, Randomize) only visible when shelf mode is active. AOI Drawer hidden in shelf mode.

### participant-frontend
- **Shelf grid rendering.** New `ShelfGrid` component renders N×M CSS Grid. Column-based mapping: each URL fills a full column. Used in CalibrationPhase (blurred), ValidationPhase (blurred), and ViewingPhase (clear).
- **`extractConfig` extended.** Returns `stimulusUrls[]`, `shelfCount`, `shelfItems`, `randomizeStimuli`. Auto-detects shelf when >1 image even without explicit `display-mode`.
- **Shelf-aware gaze tracking.** `EyeTrackingRenderer` uses `shelfContainerRef` as bounding rect source. `getStimulusElement()` helper returns the correct ref for each mode. Calibration, validation, micro-recalibration, and click-proxy all work on the composite grid.
- **Column randomization.** When `randomize-stimuli=true`, the URLs array is shuffled (Fisher-Yates), which randomizes column order per participant.
- **Response metadata.** Shelf responses include `displayMode`, `shelfCount`, `shelfItems`, `stimulusCount`.

### backend
- **Analytics metadata.** `extractEyeTrackingConfig` reads `shelf-count` and `shelf-items`. `getEyeTrackingResults` includes `shelfCount`/`shelfItems` in response when `modality=shelf`.

---

## v0.63.0 — Website Tracking: injectable script for click heatmaps on external sites (2026-04-26)

### database
- **New tables.** `tracking_sessions`, `tracking_events`, `tracking_pages` for storing visitor interactions from external websites.
- **New research type.** "Website Tracking" seeded as file-based research (`skip_default_modules: true`).

### backend
- **Tracking module.** `backend/src/modules/tracking/` — controller, service, and snippet generator.
- **Public endpoints (no auth, CORS `*`).** `GET /public/tracking/:id/script.js` serves the injectable JS. `POST .../session` creates a session. `POST .../events` batch-inserts click/scroll/mousemove events.
- **Authenticated endpoints.** `GET /tracking/:id/overview` (metrics), `/heatmap` (aggregated clicks), `/pages` (tracked URLs), `/sessions` (list), `/snippet` (embed code). `PUT /tracking/:id/config` saves capture settings.
- **Injectable script.** Async, <15KB. Captures clicks (+ optional scroll, mousemove). Consent banner, `localStorage` visitor ID, `sendBeacon` flush every 2s, buffer cap 50 events. Configurable per research.

### research-frontend
- **Builder: config panel.** `WebsiteTrackingConfig` shows copiable `<script>` snippet, allowed domains whitelist, capture toggles (clicks, scroll, mousemove, consent banner).
- **Results: click heatmap.** `WebsiteTrackingResults` with overview cards (visitors, sessions, pages, events, avg duration), page selector tabs, click heatmap overlay (reuses `HeatmapRenderer` + simpleheat), and tracked pages table.
- **Research type detection.** "Website Tracking" added to `isFileBasedResearch` across `ResearchBuilderPage`, `ResearchBuilderSidebar`, `CreateResearchForm`, `ResearchFormStep2`, `useResearchForm`. Sidebar shows "Configuration" label.
- **Results page routing.** `ResearchResultsPage` detects Website Tracking and renders dedicated view (no stage-based tabs).

---

## v0.62.1 — Fix eye tracking calibration: double-click interference and strict threshold (2026-04-25)

### participant-frontend
- **Fix: calibration clicks processed twice.** WebEyeTrack registers a global `click` listener that feeds mouse coordinates as calibration data. During calibration/validation, this conflicted with our explicit `blaze.calibrate()` call (correct gaze-at-dot coordinates vs random click position). Fixed with `stopImmediatePropagation()` + `onClickCapture` in `CalibrationPhase` and `ValidationPhase`.
- **Relaxed validation threshold.** `HYBRID_RECALIBRATION_RMSE_THRESHOLD_PX` raised from 100px to 150px. Webcam gaze has ~60-120px natural error — 100px rejected most valid calibrations.

---

## v0.62.0 — Results UX improvements, IAT configurable keys, IAT completion fix (2026-04-25)

### backend
- **Text analysis accepts participant filter.** `POST /analytics/research/:id/text-analysis/:moduleId` now accepts optional `participantIds` array in body. Filters SQL queries so the LLM analyzes only the filtered subset.

### research-frontend
- **Header updated.** Sidebar logo area now shows "EmotioCX - Dashboard" (hidden when collapsed).
- **Percentages in text analysis.** Themes show `{count} mentions ({pct}%)` and keywords show `({count}, {pct}%)` in both tag cloud and frequency table, relative to total comments.
- **Persistent completion filter.** "Min. completion %" slider value persists in localStorage per research — survives page reloads.
- **Refresh analysis button.** "Refresh analysis" button (gray, with refresh icon) appears in Sentiment/Themes/Keywords tabs when analysis already exists. Re-triggers LLM with currently filtered participant IDs.
- **Filtered participant IDs passed to VOCComments.** Both `SmartVOCResults` and `CognitiveTaskResults` forward `filteredParticipantIds` prop.
- **IAT response keys selector.** Segmented control "A / L" vs "← / →" in IAT module header. Stored as `response-keys` component (`letters` or `arrows`, default `letters`).

### participant-frontend
- **IAT configurable response keys.** Reads `response-keys` from module config. Button labels, intro text, and keep-in-mind instructions adapt to show either "A / L" or "← / →". Keyboard handler accepts both modes regardless of visual setting.
- **IAT spacebar icon.** Take-note screen shows a styled `<kbd>` spacebar indicator instead of plain text.
- **Fix: IAT stuck on completion screen.** `onComplete` callback had an unstable reference (15+ deps in `useCallback`). When `saveResponse()` triggered a re-render, the effect cleanup cancelled the 800ms advance timer before it fired. Fixed by storing `onComplete` in a ref — the effect no longer depends on callback identity.

---

## v0.61.2 — Fix CES sentiment zones inverted in results (2026-04-24)

### backend
- **CES zones corrected.** `cesPercentage`, `calculateCESPercentage`, and `generateMonthlyMetricsData` now treat high scores as positive (easy) and low scores as negative (hard). Previously inverted — scores 4-5 were counted as negative.

### research-frontend
- **CES zones aligned with participant-frontend.** `getCESZones()` now returns `positive: [4, 5]`, `negative: [1, 2]` for scale 1-5 (and equivalent for 1-7, 1-10). Fixes results bars showing green for hard experiences and red for easy ones. CPV corrected in cascade.

---

## v0.61.1 — Phase 3 polish: Insights upload in view, benchmark editor, CSV export, configurable LLM (2026-04-21)

### backend
- **Configurable LLM model.** `OPENAI_MODEL` env var controls which model is used for text analysis (default `gpt-4o`).

### research-frontend
- **Insights Finding upload in view.** File upload button ("Add files") in `InsightsFindingView` header. Empty state shows upload CTA. Uses `documentParser` for client-side CSV/TXT/XLSX/DOCX/PDF parsing + `mediaService.uploadFile()`. Auto-triggers LLM analysis.
- **Benchmark research selector.** "Edit selection" button in `ClientsBenchmarkView` opens inline editor with checkboxes for all researches with Eye Tracking. Add/remove researches live — comparative table refreshes immediately.
- **Benchmark CSV export.** "Export CSV" button on comparative table downloads Research/Module/AOI/Attention/Fixations/Participants.

---

## v0.61.0 — Phase 3 analytics: LLM text analysis, ET heatmap settings, video prediction, sentiment filter (2026-04-21)

### backend
- **Text analysis service.** New `POST/GET /analytics/research/:id/text-analysis/:moduleId` endpoints. Reuses GPT-4o pipeline from Insights Finding to generate themes, keywords, and sentiment summaries for any text responses (VOC, Short/Long Text). Results cached in `research.config.textAnalysis.<moduleId>`. Fire-and-forget with polling.

### research-frontend
- **VOCComments themes & keywords.** Replaced placeholder tabs with real content: theme cards with magnitude bars and sentiment badges, keyword tag cloud with frequency table. "Analyze with AI" button triggers LLM analysis; cached results load on mount. Applied to SmartVOC VOC and Cognitive Short/Long Text.
- **ET heatmap settings modal.** New `HeatmapSettingsModal` with detail presets (Smooth/Balanced/Detailed), blur/opacity/threshold sliders, and live preview. Gear button in `StimulusCard` when heatmap tab is active.
- **Video prediction.** `AttentionPredictionView` now accepts video uploads (mp4/webm/mov). Client-side frame extraction via `<video>` + `<canvas>`, sequential upload and TranSalNet prediction per frame. `VideoFrameScrubber` shows side-by-side original/heatmap with frame scrubber synced to video timestamp.
- **Sentiment filter.** New checkbox group (Positive/Negative/Neutral/Indeterminate) in Filters sidebar. Applied to SmartVOC VOC comments and Cognitive text responses.
- **`mediaService.uploadFile()`.** Convenience method for programmatic file uploads (presigned URL → PUT → save metadata).

### participant-frontend
- **Fix: IAT modules stuck after completion.** IAT structure components (`target-*-name`, `criteria`) are researcher config with `required: true`, but participants only save `iat-trials`. Validation now bypasses generic required-field check for IAT modules, allowing auto-advance after completion.

---

## v0.60.7 — Fix choice results bars empty when completion filter active (2026-04-20)

### backend
- **`rawKey` in choice counts.** `getChoiceResponses` now includes `rawKey` (the raw option ID) alongside the display label in each `choiceCounts` entry. Enables frontend to correctly match filtered responses to their choice labels.

### research-frontend
- **Choice bar fix.** `ChoiceResultsWrapper` filter recalculation now uses `rawKey` to look up counts instead of the display label. Previously, responses stored option IDs (`"choice-1"`) but the lookup used labels (`"Muy satisfecho"`), causing all bars to render at 0% when any filter was active.

---

## v0.60.6 — Eye tracking calibration improvements, results coordinate fix (2026-04-19)

### participant-frontend
- **16-point calibration grid.** Expanded from 9 (3×3) to 16 (4×4) points for denser IDW correction field.
- **Stricter validation.** RMSE threshold lowered from 120px to 100px — poor calibrations prompt re-calibration.
- **Micro-recalibration every 15s** (was 20s), weight increased to 0.85 (was 0.75) — drift corrected faster.
- **I-DT tighter dispersion.** Fixation detection threshold lowered from 85px to 70px — more precise fixation centroids.
- **Blink-to-open filter reset.** One-Euro filter resets on closed→open transition so post-blink frames aren't pulled toward drifted position.
- **Hybrid lab gaze dot.** Live red dot on stimulus via direct DOM manipulation (no React re-render). Reads `gazePosRef` from blaze hook (frame-rate updates).

### research-frontend
- **ET coordinate coherence.** `HeatmapRenderer` gains `coordSystem` prop (`pixel`/`percent`/`normalized`) — ET fixations now correctly mapped as image pixels instead of auto-detected as percentage. `ScanpathOverlay` uses image `naturalWidth`/`naturalHeight` for viewBox. `FirstLookOverlay` also passes `coordSystem="pixel"`.
- **CustomSelect scroll fix.** Dropdown no longer closes when scrolling inside its option list (`onWheel` stopPropagation + `data-custom-select-dropdown` scroll exclusion).
- **ClientsPage.** Replaced empty scatter chart with real stacked bar chart (researches by month/status). Removed emoji icons, placeholder sections, and fake progress bars. Added client stats card.
- **ResearchHistoryPage.** Replaced empty line chart with stacked bar chart. Added client stats with status counts and research type badges.

---

## v0.60.5 — Attention Prediction: synchronous predict, AOI persistence, settings cleanup (2026-04-19)

Renumbered from v0.60.4.

---

## v0.60.4 — Attention Prediction: synchronous predict, AOI persistence, settings cleanup (2026-04-17)

### backend
- **Synchronous prediction endpoint.** `POST /attention-prediction/research/:id/predict/:mediaId` now awaits TranSalNet inference and returns result directly instead of fire-and-forget + polling. Status endpoint removed.
- **Error state persistence.** `runPredictionAsync` saves `predictionError`/`predictionErrorAt` to the stimulus config on failure (previously only logged to console). Module prediction already had this — now both paths are consistent.
- **Threshold default unified.** Service, controller, and postprocess all default to `0.3` (was inconsistent: 0.5/0.3/0.3).
- **Console.logs removed.** 10 debug/trace logs removed from controller and service.

### research-frontend
- **Polling removed.** `AttentionPredictionView` uses simple `await` instead of `setInterval` polling. Error state displayed in red banner with Retry button.
- **Upload always visible.** File upload component shown below the analysis card (was hidden when a stimulus existed). Label changes to "Add more images" when stimuli exist.
- **AOI persistence.** Areas of Interest now saved to `stimulus.aois` in research settings. Loaded on mount, persisted on add/remove. Survives tab switches and page reloads.
- **Settings modal cleaned up.** Removed non-functional Composition tab (analysisWindow, framesInFixation, dispersion, mergeRange controls were UI-only). Renamed misleading "Prediction model" selector to "Detail preset" with Smooth/Balanced/Detailed buttons. Individual slider changes mark preset as "Custom".
- **Debug console.log removed** from `ResearchBuilderSidebar`.

---

## v0.60.3 — face-api.js emotion recognition for Eye Tracking (2026-04-17)

### participant-frontend
- **face-api.js integration.** Replaced manual FACS heuristics (AU extraction → threshold-based classification) with face-api.js neural model (TinyFaceDetector + FaceExpressionNet). Detects 7 Ekman emotions (joy, sadness, surprise, anger, disgust, fear, neutral) with trained model confidence scores.
- **New hook `useFaceApiEmotions`.** Loads models from `/models/` (~511KB), samples expressions via RAF at 20fps during viewing phase. Produces `EmotionSample[]` identical to previous format — backend and research-frontend unchanged.
- **Models served statically.** `tiny_face_detector` + `face_expression_model` in `public/models/`.

---

## v0.60.2 — IAT analytics fixes and builder improvements (2026-04-17)

### backend
- **Skip D-score for Comparing Attribute.** `comparing_attribute` is pure RT — no correct/incorrect concept. `participantData`, `dScore`, and `errorAnalysis` now return `undefined` for this paradigm.
- **Type safety: `IATAttribute.targetId`.** Added `targetId?: string` to `IATAttribute` interface. Removed `(attr as any).targetId` cast and dead `imageUrl` field.

### research-frontend
- **Conditional analytics cards.** D-score, Effect Size, and Error Analysis cards hidden for `comparing_attribute` results (only RT chart shown).
- **Error combinations table.** Removed top-5 limit — all combinations shown with scrollable container.
- **IATPreviewModal light theme.** Converted from dark gray-900 to light theme matching design system (white bg, gray-50 header, slate-50 preview area).
- **Builder validation.** Amber warning in `IATCriteriaEditor` when Attribute Testing criteria have no target assigned.
- **Frontend `IATAttribute` aligned.** Replaced dead `imageUrl` with `targetId` in frontend type definition.

---

## v0.60.1 — Fix Share Research drawer not showing invite input (2026-04-17)

### backend
- **Fix: `created_by` missing from research queries.** `getById` and `list` SELECTs did not include `r.created_by`. The frontend's `isOwner` check always evaluated to `false`, hiding the email input in the Share Research drawer. Added `r.created_by` to both queries.

---

## v0.60.0 — Research collaborators, completion filter, eye tracking improvements (2026-04-16)

### backend
- **Research collaborators:** `POST/GET/DELETE /research/:id/collaborators` — share a specific research with another user by email. `buildOwnershipClause` now includes collaborator access (`OR id IN (SELECT research_id FROM research_collaborators WHERE user_id = ?)`).
- **Completion filter support:** Existing `GET /research/:id/participants/status` endpoint already returns per-participant `progress` (0-100%). Results pages now consume this data for filtering.
- **Soft AOI intersection:** AOI metrics use Gaussian contribution instead of binary point-in-rect. Fixations near AOI borders contribute proportionally (σ = 35% of AOI's larger dimension). Inside = 1.0, near edge outside = 0.3-0.8, far = excluded.
- **Eye tracking quality gate:** Participants classified as `good`, `fair`, or `low` based on `calibrationRmsePx` (>200px = low), `integrityScore` (<0.4 = low), and `fixationCount` (<3 = low). Low-quality participants excluded from aggregate heatmap, zone mass, and AOI calculations. `qualitySummary` added to ET response.

### research-frontend
- **Share Research drawer:** `ShareResearchDrawer` component — add collaborators by email, list existing collaborators with remove button. "Share Research" button in builder sidebar.
- **Completion % filter:** Slider "Min. completion" (0-100%, step 5%) added to Filters sidebar across all 5 result tabs (SmartVOC, Cognitive Tasks, Screener, IAT, Eye Tracking). Combines with demographic and user ID filters.
- **Redundant header removed:** Removed duplicate "Cognitive Tasks Results" gray card in Cognitive Task results (tab already provides context).
- **Triple scroll fix:** Removed nested `max-h overflow-y-auto` from CognitiveTaskResults and SmartVOCResults. Single page-level scroll only. Filter sidebar uses `max-h-[calc(100vh-8rem)]` instead of fixed `700px`.
- **ET quality indicator:** Amber banner shows quality gate summary when low-quality participants are excluded from results.

### participant-frontend
- **Micro-recalibration:** During eye tracking viewing phase, a nearly invisible dot (4px, 12% opacity) appears every 45s at edge/corner positions. System captures ~8 gaze samples over 600ms, computes drift vs known position, and updates IDW correction field with weighted residual. Corrects calibration drift without participant awareness.

### database
- Migration 024: `research_collaborators` table with `research_id`, `user_id`, `permission` (viewer/editor), `invited_by`, unique constraint, cascade deletes.

---

## v0.59.9 — Invited viewers list in Invite Viewer drawer (2026-04-15)

### backend
- **Viewers endpoint:** `GET /users/viewers` lists users with role `viewer`, including email, name, and invitation date.

### research-frontend
- **Invited viewers section:** The Invite Viewer drawer now shows a list of previously invited viewers with email and date. Refreshes automatically after sending new invitations.

---

## v0.59.8 — Research detail drawer with tabs (2026-04-15)

### backend
- **Detail endpoint:** `GET /research/:id/detail` returns research info, stages, modules, response stats, and chronological timeline via 4 parallel queries.

### research-frontend
- **Detail Drawer tabs:** Overview (info + stats), Stages (accordion with nested modules), Timeline (chronological events with icons).
- Rows in Research Tracking are clickable to open the detail drawer.

---

## v0.59.6 — Fix research activity JOIN column (2026-04-15)

### backend
- **Activity query fix:** Changed `r.user_id` → `r.created_by` in both `listAllResearchActivity` and `listResearchActivity` queries. The `researches` table uses `created_by`, not `user_id`.

---

## v0.59.5 — Research activity derived from existing tables (2026-04-15)

### backend
- **Activity service rewrite:** Research tracking now derives data from existing tables (`researches`, `stages`, `modules`, `responses`, `users`) instead of requiring a dedicated `research_activity_logs` table.
- **Controller cleanup:** Removed all `logResearchActivity()` write calls — activity is read-only, computed on demand.
- **Deploy workflow:** Added Passenger restart step (`touch tmp/restart.txt`) so new code takes effect after deploy.

### database
- Removed migration 014 (`research_activity_logs`) — no longer needed.

---

## v0.59.4 — Research activity endpoint registration fix (2026-04-15)

### backend
- **Config endpoints:** Added `activity` and `getAllActivity` routes to the dynamic config so the frontend can resolve them through service discovery.

### research-frontend
- **Service discovery for activity endpoints:** `getActivity()` and `getAllActivity()` now use `configService.getEndpoint()` instead of hardcoded paths.

---

## v0.59.3 — Research tracking and viewer invite workflow (2026-04-15)

### research-frontend
- **Global Tracking page:** New `/research-tracking` view with column-level filters for research, technique, researcher, action, and summary.
- **Scoped loading/error states:** Skeleton/error rendering limited to the data panel only.
- **Invite Viewer drawer:** Accepts multiple emails, keeps failed invitations for retry.
- **Research list actions:** Invite Viewer and Create Research on the same row as cards/table toggle.

---

## v0.59.2 — Backend deploy workflow hardening (2026-04-15)

### docs
- **Backend deploy workflow:** `deploy-backend-cpanel.yml` now validates `CPANEL_SSH_HOST`, retries `ssh-keyscan` up to 3 times, and prints a clearer failure message when the cPanel host key cannot be fetched.

---

## v0.59.1 — Public progress resilience, Open link action, SSE CORS fix (2026-04-15)

### backend
- **SSE CORS fix:** `server-cpanel` now allows `Cache-Control` in CORS preflight and responds explicitly to `OPTIONS /api/monitor/events/:researchId`. Fixes blocked monitoring connections from `http://localhost:12800`.
- **cPanel runtime aligned:** The compiled `server-cpanel.js` was updated alongside the TypeScript source so the deployed cPanel server uses the same CORS headers.

### research-frontend
- **Public progress response normalization:** `PublicProgressPage` now accepts wrapped or serialized payload shapes before reading `metrics` and `participants`.
- **Open link action:** View Progress now includes an `Open link` button to open the public progress page directly in a new tab.
- **Print-ready public progress:** The public progress page supports `?print=1` and waits for data/fonts before calling `window.print()`.

---

## v0.59.0 — Scalability, Nav Flow fix, Share Progress, Results optimization (2026-04-15)

### backend
- **Batch INSERT responses:** `saveParticipantResponses` now uses a single batch INSERT instead of N individual INSERTs + N SELECTs. Reduces queries per submission from ~47 to ~5.
- **Composite DB index:** `idx_responses_research_module_component` on `(research_id, module_id, component_id)` for all analytics queries.
- **Cache hot paths:** `getResearchConfiguration` (60s TTL) and `getParticipantCount` (10s TTL) cached to avoid repeated queries during submission bursts.
- **Connection pool:** Raised from 10 to 20 connections per pool.
- **Cognitive tasks payload optimization:** Modules with dedicated endpoints (Nav Flow, Preference Test, Choice, Scale, Ranking) return COUNT only — no full response data. Reduces payload ~70%.
- **Nav Flow analytics:** Strip `clickSequence` from per-participant responses (data lives in `heatmapData` with `participantId`). Reduces Nav Flow payload ~70%.
- **Batch COUNT:** `/cognitive-tasks` uses single grouped COUNT query instead of N individual queries.
- **Share progress endpoint:** `POST /research/:id/share-progress` sends branded email with progress link to multiple recipients.
- **Public progress endpoint:** `GET /public/research/:id/progress` returns metrics + participants without auth.
- **Share progress URL fix:** Fallback share links now point to `https://emotio.cx/research/progress/:id`, matching the production `research-frontend` base path.
- **Progress research name:** Public progress metrics now include the research name for the public header.

### participant-frontend
- **Nav Flow save fix:** Single-image modules now correctly include the triggering click in saved response. Previously, React state batching caused `clickSequence: []` because `setAllClicks` hadn't committed when `saveNavigationResponse` ran.

### research-frontend
- **Results request dedup:** `NavigationFlowResultsWrapper` and `PreferenceTestResultsWrapper` use `useResearch()` (React Query) instead of individual `getById` calls. 10 calls → 1.
- **Media URL cache:** `getMediaUrlByS3Key` caches results in-memory for 5 minutes.
- **Nav Flow AOI computation:** Uses `heatmapData` (with `participantId`) instead of per-response `clickSequence`.
- **Participant count fix:** Cognitive Tasks header shows unique participant count instead of total response rows (was showing ~864 instead of ~52).
- **Progress filter:** ParticipantsTable has minimum progress slider (0-100%) to filter by completion level.
- **Share Progress:** "Send Link" button opens Drawer to add email recipients. "Copy link" copies public URL. Public page at `/progress/:id` shows read-only progress.
- **Progress share link fix:** The copied public link now includes the `/research` prefix in production, avoiding invalid root-level URLs.
- **Public progress header:** The title now appends the research name after "Research Progress".

### docs
- `scalability-audit-results-page.md` — Results page scalability analysis and fixes.
- `scalability-audit-participant.md` — Participant submission capacity analysis.

### database
- Migration 022: composite index on responses table.

---

## v0.58.0 — Phase 3: FACS Emotion Recognition, Attention Prediction, Advanced Analytics (2026-04-14)

### participant-frontend
- **FACS Emotion Recognition:** Parallel MediaPipe FaceLandmarker (`useFaceLandmarks`) runs alongside BlazeGaze during viewing phase. Extracts 9 Action Units from 468 landmarks, classifies Ekman emotions (joy, sadness, surprise, anger, disgust, fear, neutral). Emotion samples stored in response alongside gaze data. Client-side only — zero images transmitted.
- **Video stimulus support:** `EyeTrackingRenderer` detects video files, renders `<video>` with muted autoplay, tracks gaze with `videoTime` sync. Natural dimensions from `videoWidth/Height`.
- **New files:** `facsClassifier.ts` (AU extraction + emotion mapping + aggregation), `useFaceLandmarks.ts` (parallel FaceLandmarker hook).

### backend
- **FACS emotion aggregation:** `computeEmotionMetrics()` — distribution, dominant emotion, per-participant breakdown, 1s-bucket timeline. Returned in Eye Tracking results when emotion recognition enabled.
- **Greenwald D-score (IAT):** `computeGreenwaldDScore()` — proper algorithm (filter >10s, pooled SD). Per-participant D-scores + aggregate with 95% CI. Effect classification: none/slight/moderate/strong.
- **IAT error analysis:** `computeIATErrorAnalysis()` — error rates by phase (practice/test) and by target×attribute combination.
- **Attention prediction for modules:** New endpoints `POST/GET /attention-prediction/research/:id/module/:moduleId/predict|status`. Supports single image (Eye Tracking) and multi-image with `imageIndex` (Navigation Flow). Stores `predictionHeatmap` or `predictionHeatmaps` in module config.
- **Eye Tracking AOI enhancements:** TTFF (Time To First Fixation), notice rate (% who looked), dominant emotion per AOI (temporal join with emotion samples ±100ms).
- **Sequence analysis:** Per-participant AOI visit order, transition probability matrix, included when ≥2 AOIs exist.
- **Video gaze timeline:** Aggregates `gazeTimeline` with `videoTime` from video stimulus responses.

### research-frontend
- **Eye Tracking results tabs:** Heat map, Scan Path (numbered fixations with cool→warm gradient, per-participant selector), First Look (first N fixations heatmap, configurable), Transparency (blur/reveal canvas mask), Emotions (distribution bars, timeline strip, per-participant table), Prediction (TranSalNet saliency, run/re-run button with polling), Video Gaze (synced gaze overlay on video playback), Sequence (transition matrix heatmap, per-participant sequences, most common patterns).
- **AOI row metrics:** TTFF (purple), notice rate (green), dominant emotion badge (color-coded).
- **IAT D-score card:** Aggregate D-score with effect badge, scale bar (-1.5 to +1.5), CI, expandable per-participant table sorted by |D|.
- **IAT effect size histogram:** D-score distribution across 7 buckets (Strong- to Strong+).
- **IAT error analysis card:** Expandable — phase error rates (color-coded), top 5 highest error combinations table.
- **Navigation Flow prediction tab:** "Prediction" tab per step with `HeatmapRenderer` saliency overlay. Per-image predictions from `predictionHeatmaps` in module config.
- **Advanced filters on all results:** `useResultsFilter` shared hook extracts duplicated demographic filtering. Filters sidebar added to Eye Tracking, Implicit Association, and Screener results (SmartVOC and Cognitive Tasks already had them).
- **New files:** `useResultsFilter.ts` (shared demographic filter hook).

### docs
- `PHASE_3_PLAN.md` — 5-feature plan (FACS, Attention Prediction ET/Nav Flow, Video, Filters).
- `COOLTOOL_GAPS.md` — 10 CoolTool parity gaps documented and implemented.

---

## v0.57.2 — Eye Tracking zone heatmap, research table improvements (2026-04-14)

### research-frontend
- **Research list:** Cards show creator name and last update. Table adds Researcher and Updated columns, responsive with `overflow-x-auto`.
- **Eye Tracking Results:** 3x3 zone heatmap overlay (green→yellow→red), responsive image (`max-h-[60vh]`), removed hardcoded header. Supports `zoneMass` from backend and falls back to point-based heatmap.
- **HeatmapRenderer:** Supports absolute image pixel coordinates alongside percentage and normalized formats.
- **Results page scroll fix.** TrustFlowChart height fix. SSE closes on error instead of retrying.

### participant-frontend
- **Eye Tracking gaze pipeline:** Aligned with `/eye-tracking-hybrid` — RAF loop (not setInterval), `gazePosRef` cache, `Date.now()` timestamps, `expandGazeWithMinimumJerkGapFill` with synthetic point penalty. Produces accurate zone-based results.
- **Eye Tracking calibration:** Blurred stimulus image (blur 12px, opacity 0.6) during calibration/validation. Click anywhere to advance (user looks at dot, not cursor). Uses `hybridImagePercentToBlazeNorm` for correct BlazeGaze coordinates.
- **Eye Tracking onComplete fix:** Timer uses ref to survive re-renders. Viewing rect snapshotted before complete phase for accurate coordinate mapping.
- **Eye Tracking preview:** Skips validation phase (no webcam data).
- **Eye Tracking viewing background:** Light gradient instead of black, so the image blends naturally without visual cut.
- **NavigationFlow background:** Light gradient instead of black. Text and progress bar adjusted for light theme.
- **Welcome Screen:** `whitespace-pre-line` for line breaks in message text.
- **Checkbox labels:** Shortened for uniform visual alignment.

### backend
- **CORS:** `Cache-Control` added to allowed headers.
- **Eye Tracking analytics:** `stimulusUrl` parsed from JSON array. `zoneMass` aggregated from responses.

---

## v0.57.1 — Configurable language switcher (2026-04-13)

### research-frontend
- **Language switch toggle:** New checkbox in Link Configuration — "Allow respondents to switch survey language." Disabled by default.

### participant-frontend
- **Conditional language selector:** The ES/EN language button is now hidden unless the researcher enables it. Fixes mobile overlap where the button covered instruction text.
- **NavigationFlow preview hint hidden on mobile:** "Press Esc or click dark area to skip" only shows on desktop — irrelevant on touch devices.

---

## v0.57.0 — Conditionality overhaul, Navigation Flow fix, question numbering (2026-04-13)

### research-frontend
- **Screening question toggle:** `ScreenerQuestionDrawer` uses green/orange toggle (Qualify/Disqualify) instead of dropdown, matching demographic drawer pattern.
- **Screening option padding fix:** Editing existing questions no longer pads to 3 options — shows exactly the saved options.
- **Conditionality: renamed demographics:** Modal reads `questionLabel` from config, so renamed questions display correctly.
- **Conditionality: custom screening questions:** `customQuestion_*` entries show their `questionLabel` instead of raw key ID.
- **Conditionality: study question detection:** Also matches by component type (`radio`, `checkbox-list`, `option-list`). Parses JSON choice values to show readable labels.
- **Conditionality: "Link with module":** New third condition source. Links visibility between modules — "show this question only if the linked module is also shown." Dropdown lists all study modules (excluding Welcome/ThankYou/ResearchConfig) with global numbering.
- **Global order index:** `studyModulesWithOptions` and `linkableModules` use global ordering (`stage.order_index × 10000 + mod.order_index`) for correct cross-stage filtering.
- **Question numbering in builder:** Module cards display ordinal number matching the conditionality dropdown and results page.
- **Reorder guard:** `handleMoveModule` blocks reordering when unsaved modules (local- prefix) exist, showing "Save all modules before reordering."

### participant-frontend
- **Navigation Flow stacking fix:** Consecutive Navigation Flows no longer overlap. All renderers in `DynamicStep` receive `key={module.id}`, forcing full re-mount and state reset when switching modules.
- **Eye Tracking fullscreen:** Calibration, validation, and viewing phases render fullscreen with black background (`fixed inset-0 bg-black`), matching NavigationFlow pattern.
- **Linked module evaluation:** `useNavigation` evaluates linked module conditions recursively with cycle protection.

---

## v0.56.9 — IAT per-participant analytics, XLSX export, preference intensity (2026-04-12)

### backend
- **IAT participant data:** `getImplicitAssociationResults` now returns per-participant data: mean RT by criterion×target combination, accuracy, quality flag (`good`/`fast_responses`/`low_accuracy`/`insufficient_data`), and respondent segmentation (fastest target per criterion).
- **Quality heuristics:** RT < 300ms = fast trial. >30% fast trials = `fast_responses`. Accuracy < 60% = `low_accuracy`. < 5 test trials = `insufficient_data`.

### research-frontend
- **XLSX export enriched:** Export now includes IAT columns per participant: Quality, Accuracy, RT per criterion×target combination (ms), and Segmentation (strongest associated target per criterion).

### participant-frontend
- **Preference intensity:** After selecting an image in Preference Test, participant chooses intensity: "Slight" or "Strong". Saved as `preferenceIntensity` in response data. Backward compatible (defaults to `strong` if not set).

---

## v0.56.8 — NavigationFlow crash fix, ErrorBoundary, Screener validation, AOI persistence (2026-04-12)

### participant-frontend
- **NavigationFlow crash fix:** `currentImage` could be undefined when index exceeded array length, crashing on `.hitZones` access. Now falls back to last image with optional chaining.
- **Blue continue button:** "Tap to continue" on NavigationFlow completion overlay is now a styled blue button consistent with the design system, instead of faint text.
- **ErrorBoundary:** Global error boundary wraps `<App />` in `main.tsx`. Catches render crashes and shows a friendly error screen with "Reload page" button instead of a white screen.
- **Screener validation fix:** Added dedicated Screener handling in `useValidation.ts` and `validation.ts`. Screener saves response as `componentId='choice'` which was not matched by the generic component validation loop.
- **NavigationFlow completion status fix:** Removed `useEffect` that overwrote `completed: false` with `true` for failed flows (3 misses).

### research-frontend
- **AOI persistence fix:** Eye Tracking modules created before migration 020 lacked the `aois` component in their config. AOIs are now injected as virtual components during save (same pattern as `test-title`).
- **Screening binary validation:** `ScreenerQuestionDrawer` now allows 1 qualifying option (was 2), enabling binary Yes/No screening questions.

---

## v0.56.7 — Research page: table/cards toggle, inline rename, duplicate, explicit Open (2026-04-12)

### research-frontend
- **View toggle on /research:** Cards (default) and Table views with switcher. Table shows Name, Status, Type, Created, Technique, and Actions columns.
- **No auto-navigate:** Cards and table rows no longer navigate on click. Explicit "Open" button in actions.
- **Inline rename:** Double-click research name in cards or table to edit inline. Enter/blur saves, Escape cancels.
- **Duplicate with name:** Duplicate button opens modal with editable name pre-filled as "{original} - Copy". Available in both views.

---

## v0.56.6 — Rename research on duplicate and inline in builder (2026-04-12)

### research-frontend
- **Duplicate with custom name:** Clicking Duplicate in Dashboard now opens a modal with the name pre-filled as "{original} - Copy". Researcher can edit before confirming. Enter to confirm, Escape to cancel.
- **Inline rename in builder:** Click the research name in the sidebar to edit inline. Enter or blur saves, Escape cancels. Uses `PUT /research/:id` with `{ name }`.

### backend
- **Duplicate accepts custom name:** `POST /research/:id/duplicate` now accepts optional `{ name }` in body. Falls back to `"{original} - Copy"` if omitted.

---

## v0.56.5 — Fix screening binary validation, Navigation Flow stuck overlay (2026-04-12)

### research-frontend
- **Screening binary validation fix:** `ScreenerQuestionDrawer` now allows saving with 1 qualifying option (was 2). Enables binary questions like "Yes (Qualify) / No (Disqualify)".

### participant-frontend
- **Navigation Flow completion overlay fix:** Overlay now clickable as safety net ("Tap to continue" label). Prevents participants from getting stuck if `onComplete` doesn't unmount the component.
- **i18n:** Added `tapToContinue` key to EN/ES locales.

---

## v0.56.4 — Implicit Association Phase 3: flowchart visual, multi-lang instructions (2026-04-12)

### research-frontend
- **IAT flowchart:** Reactive visual diagram replaces static notes in the builder sidebar. Shows test phases, target/criteria counts, timing, and response branches using live config data. Different layout per paradigm (Attribute Testing, Comparing Attribute, Objects Comparing).
- **Multi-lang instructions:** `MultiLangInput` component with EN/ES tabs for `exercise-instructions` and `test-instructions` fields. Value stored as JSON `{"en":"...","es":"..."}`. Green dot indicator when both languages have content. Backward compatible with plain strings.
- **New files:** `IATFlowchart.tsx`, `MultiLangInput.tsx`.

### participant-frontend
- **Multi-lang resolution:** `resolveMultiLang()` utility picks the correct language string from multi-lang JSON values using `i18n.language`. Falls back to EN → ES → raw string for backward compatibility.
- **New file:** `utils/multiLang.ts`.

---

## v0.56.3 — Implicit Association Phase 2: IAT preview modal (2026-04-12)

### research-frontend
- **IAT preview modal:** New "Preview" button in the IAT module card header. Opens a dark-themed modal simulating the test flow using the researcher's live config (targets, criteria, priming time, dimensions, instructions). Two modes: "Step through" (manual) and "Auto play" (timed). Progress dots in footer. Builds trial sequence per paradigm.
- **New file:** `IATPreviewModal.tsx` — standalone preview component with trial builder logic for all 3 IAT paradigms.

---

## v0.56.2 — Implicit Association Phase 2: dynamic targets (2026-04-12)

### research-frontend
- **Dynamic targets/objects:** Researchers can now add and remove targets (or objects in Comparing Attribute) from the IAT builder. "Add target/object" button below the grid, trash icon per card. Limits per paradigm: Attribute Testing 2-5, Comparing Attribute 1-5, Objects Comparing 2-7. New components are created with sequential IDs (`target-N-name`, `target-N-image`).

### backend
- **Dynamic target extraction:** `extractIATConfig` loops scan up to index 20 with `continue` instead of hardcoded 5. Supports any number of researcher-added targets.

### participant-frontend
- **Dynamic target extraction:** All 3 `extractConfig` loops (Attribute Testing, Comparing Attribute, Objects Comparing) scan up to index 20 with `continue`.

---

## v0.56.1 — Implicit Association Phase 1: hide criteria, test title, fix testType swap (2026-04-12)

### research-frontend
- **Hide criteria toggle:** Each criterion in the IAT builder now has an Eye/EyeOff button. Hidden criteria stay in the config but are excluded from the participant test and analytics. Row renders with reduced opacity when hidden.
- **Internal test title:** New "Test title" input at the top of IAT modules. Internal only (not shown to participants), appears as a label above the chart in results. Saved as a virtual `test-title` component with `hidden: true` in root (excluded from `visibleComponents`, read from `componentValues` directly).
- **Results testTitle:** `IATModuleCard` renders the test title as a subtle uppercase label above the chart when present.

### backend
- **Fix `detectIATTestType` swap:** "Comparing Attribute" now correctly returns `comparing_attribute` (was `objects_comparing`) and "Objects Comparing" returns `objects_comparing` (was `comparing_attribute`). `extractIATConfig` branches updated to match. Results charts now map to the correct paradigm.
- **Hidden criteria filter:** `extractIATConfig` skips criteria with `hidden: true` when building the attributes list.
- **Test title in analytics:** `getImplicitAssociationResults` extracts the `test-title` component and includes it as `testTitle` in the response.

### participant-frontend
- **Hidden criteria filter:** `parseCriteriaRankingList` skips criteria items with `hidden: true` so they never appear in the participant test.

---

## v0.56.0 — Duplicate research from Dashboard (2026-04-12)

### backend
- **Duplicate endpoint:** `POST /research/:id/duplicate` clones a research with all its stages, modules, questions, demographic quotas, and media files. The clone is created as `draft` with name `"{original} - Copy"`. Responses and participants are NOT copied. Quota counters reset to 0.
- **Media filesystem copy:** Cloned media files are copied on disk (`fs.copyFileSync`) with new paths under the new research ID. Non-fatal on failure (record still created).
- **Conditionality remap:** `sourceModuleId` references in `conditionalityConfig` are remapped from old to new module IDs.
- **Stimuli mediaId remap:** For Attention Prediction / Insights Finding, `mediaId` references in `config.stimuli` are updated to point to the cloned media records.

### research-frontend
- **Duplicate button:** Copy icon (lucide `Copy`) in Dashboard table Actions column, next to Delete. Blue hover state. Calls `POST /research/:id/duplicate`, invalidates list cache, shows success/error toast.
- **New files:** None. Changes in `research.service.ts` (method), `useResearchQuery.ts` (hook), `DashboardPage.tsx` (button + handler).

---

## v0.55.1 — Fix custom screening questions persistence (2026-04-12)

### research-frontend
- **Custom screening questions round-trip fix:** `transformResearchConfigComponentValues` had a hardcoded list of demographic keys and silently dropped `customQuestion_*` entries. Added `key.startsWith('customQuestion_')` check so custom screening questions survive the flatten→reconstruct cycle used during save and reload.
- **Screener drawer: include all options on save:** `ScreenerQuestionDrawer.handleSave` was only passing qualifying options to the parent. Disqualifying options were lost from `validValues`, breaking the backend disqualification check. Now passes all options (qualifying + disqualifying) with correct `isQualified` flag.

---

## v0.55.0 — Draft persistence, unsaved changes indicator, i18n cleanup (2026-04-11)

### research-frontend
- **Draft persistence:** Unsaved module edits are now preserved when switching between stages. Zustand session-scoped store (`useModuleDraftStore`) captures `componentValues` and `components` per moduleId. `useModuleComponents` saves draft on navigate-away and restores on return. Only creates drafts when values actually differ from server data (no false "unsaved" markers from visiting a stage).
- **Pending drafts dropdown:** New `PendingDraftsDropdown` component in builder header, next to "Save Changes". Shows amber badge with count of modules with unsaved edits. Dropdown lists each module (name, stage, time ago) with individual Save buttons and "Save all". Saves directly to backend without navigating to the module.
- **Unsaved dot indicator:** Sidebar shows amber dot next to stages with pending drafts.
- **Draft cleanup:** Drafts are cleared after successful save (all three save paths: SmartVOC, collection, single module). All drafts cleared when switching to a different research.
- **Dashboard technique cards:** Replaced dynamic ResearchTypeCard with static technique cards (Eye Tracking, Attention Prediction, Implicit Priming Test, Cognitive Analysis) using icons from `src/assets/`. Cards use full table height with `flex-1`.
- **i18n: all demographic drawers in English.** Translated OptionsTab, QuotasTab, DemographicConfigModalBase, AgeConfigModal, CountryConfigModal, GenderConfigModal, EducationConfigModal, EmploymentStatusConfigModal, HouseholdIncomeConfigModal, DailyHoursOnlineConfigModal, TechnicalProficiencyConfigModal. Clasifica→Qualify, Desclasifica→Disqualify, etc.
- **Screening question drawer cleanup:** Removed Dynamic Quotas tab (irrelevant for screening questions) via `hideQuotasTab` prop. Validation changed to "at least two qualifying options". Removed all quota-related code from `CustomScreeningQuestionConfigModal`.
- **NaN fix:** `OptionsTab` percentage shows `0%` instead of `NaN%` when no options exist.
- **Insights Finding:** Comment column narrowed to `w-2/5`, analysis panel uses `flex-1` for responsive width. Mood column shows literal value (`indeterminate`) instead of `—`.

---

## v0.54.1 — Screener flow fix, DevSidebar & ResearchPage cleanup (2026-04-11)

### participant-frontend
- **Screener step ordering fix:** Demographics was hardcoded as second step, before Screener. Participants got disqualified at demographics without ever reaching the Screener. Now: `welcome → screener → demographics → rest → thank-you`. Screener is a special step like welcome and thank-you.
- **Screener real-time disqualification:** `ScreenerChoiceOption` now preserves `eligibility` field from module config. When participant selects a "Disqualify" choice, they are blocked immediately (backlink redirect or restriction screen). Previously, Screener choices were passive — only categorized in analytics.
- **DevSidebar rewrite:** Extracted SVG icons as components, moved helpers outside render (`formatDuration`, `getDisplayName`, `getModuleGroup`). Replaced mutable `globalIndex` with `useMemo`+`flatItems`. Replaced `document.querySelector` with `useRef`. Removed dead `MOCK_MODULES` import and unreachable `'screener'` group.
- **ResearchPage extraction:** Moved 9 utility functions (400+ lines) to `utils/researchPageHelpers.ts`. DRY'd `isModuleConfigured` with shared `hasValidFileUpload()`. Moved `normalizeModule` from inside useEffect to standalone function. Removed 12 dead "Removed excessive logging" comments. File reduced from 1425 → 990 lines.

### backend
- **Disqualification logging:** `checkDisqualifications` now logs the exact demographic key, participant answer, and matching disqualification value on block.

---

## v0.54.0 — Design system alignment & dashboard table fix (2026-04-11)

### research-frontend
- **Login aligned to design system:** AuthLayout background → `#F1F5F9` (surface-app). Card: removed decorative shadow, border → semi-transparent `black/[0.08]`. Text colors → slate palette (slate-900 heading, slate-500 subtitle). Error alert → red-800 text, red-300 border per spec. Google button border → semi-transparent with proper hover state.
- **Font import:** Added Plus Jakarta Sans (Google Fonts) in `index.css` to match tailwind config and design system spec.
- **Dashboard table overlap fix:** On 13" screens, ACTIONS column overlapped RESEARCHER. Researcher column now hidden below `xl` breakpoint (was `lg`). Column widths redistribute dynamically: Name 35%, Status/Created/Updated 15% each at `<xl`. Researcher cell content truncated at 180px for long names.

---

## v0.53.1 — Eye Tracking hybrid: upgrade to 3×3 grid (2026-04-11)

### participant-frontend
- **Grid upgrade:** `HYBRID_GRID_SIZE` from 2×2 (4 zones) to 3×3 (9 zones). New zones: center column and center row.
- **Retuned stretch/nudge parameters:** All values halved to prevent the center band from being compressed. Stretch X 1.12→1.06, Y 1.22→1.10, nudge factors ~50%, biases reduced proportionally.
- **Noise threshold:** Lowered from 10% to 5% (uniform distribution is ~11% per zone in 3×3).
- **UI:** Grid overlays and results breakdown updated to `grid-cols-3 grid-rows-3`.

---

## v0.53.0 — Custom screening questions & editable demographic labels (2026-04-11)

### research-frontend
- **Custom screening questions:** Researchers can add single-choice filtering questions in the Demographics section. Each question opens the same Drawer as predefined demographics (options with Qualify/Disqualify + quotas). Stored as `demographics.customQuestion_<id>` in Research Configuration.
- **Editable demographic labels:** All demographic config drawers now include a "Question label" field. Researchers can rename any question (e.g. "Ingresos Familiares" → "Ingresos Mensuales"). Label shows in parentheses next to the default name in the builder row.
- **New files:** `CustomScreeningQuestionConfigModal.tsx`.
- **Modified:** `DemographicConfigModalBase` (new `headerContent` prop), all 6 generic config modals (forward `headerContent`), `ResearchConfigurationModule` (custom questions section, label editor, label flush), `demographicsMapper` (handles `customQuestion_*` keys, `questionLabel` field).

### participant-frontend
- **Render custom screening questions:** `DemographicsStep` discovers `customQuestion_*` keys and renders them as selects using `questionLabel` as label.
- **Editable label override:** Predefined demographics also use `questionLabel` when set by the researcher.
- **Validation fix:** `ResearchPage` demographics validation now uses `Object.keys(demoConfig)` instead of hardcoded `DEMO_KEYS`, so custom questions are required before advancing.

### backend
- No changes needed. `checkDisqualifications` and `tryIncrementQuota` already iterate all demographics keys dynamically. Tables use `VARCHAR(50)`, not enums.

---

## v0.52.1 — Fix: Navigation Flow stuck on letterbox clicks (2026-04-11)

### participant-frontend
- **Fix:** Clicks on letterboxing bars (black areas around the image in `object-contain` mode) were silently ignored — no failed attempt counted, so the participant could never trigger the 3-miss auto-advance. Now clicks outside the rendered image area count as failed attempts when hitzones are defined.

---

## v0.42.6 — Lint cleanup: zero warnings across both frontends (2026-04-10)

### participant-frontend
- **Fix:** Replaced static EMA `smoothAlpha` option with `queryClient` export split (`queryClient.ts` separate from `QueryProvider.tsx`) to resolve `react-refresh/only-export-components` warning.
- **Fix:** Added `redirectTo` to 3 dependency arrays in `ResearchPage` (safe — stable `useCallback`).
- **Fix:** Suppressed `trackingEnabled` dep in `useLocationCollector` (derived from `config` already in deps).

### research-frontend
- **Fix:** Added `isFileBasedResearch` to Welcome/ThankYou auto-add effect deps in `ResearchBuilderSidebar`.
- **Fix:** Wrapped `stimuli` / `files` in `useMemo` in `AttentionPredictionView` and `InsightsFindingView` to stabilize logical expressions in callback deps.
- **Fix:** Replaced 3 `any` types with `RechartsLabelProps` interface in `ImplicitAssociationResults`.
- **Fix:** Removed unused `_onViewDetails` destructuring in `ParticipantsTable`.
- **Fix:** Added `options.length` to dropdown positioning effect in `CustomSelect`.
- **Fix:** Suppressed mount-only effects in `CreateResearchForm`, `ModuleTemplateSelectionModal`, `ClientsPage`, `ResearchHistoryPage` with documented `eslint-disable-next-line`.

---

## v0.42.5 — Eye Tracking: One-Euro filter, I-DT fixations, 9-point calibration (2026-04-10)

### participant-frontend
- **One-Euro adaptive filter** replaces static EMA in `useBlazeGaze`. Smooth during fixations, responsive during saccades. Configurable via `oneEuroMinCutoff` / `oneEuroBeta`.
- **I-DT fixation detection** (`fixationDetector.ts`): groups raw gaze samples into proper fixations with centroid, duration, and point count. Dispersion threshold 85px, min duration 120ms.
- **`EyeTrackingRenderer`** now saves detected fixations (I-DT) instead of raw gaze points. Response includes `fixationMethod`, `fixationCount`, pipeline `hybrid-idw-idt`.
- **Calibration expanded from 4 to 9 points** (3×3 grid covering corners, edges, and center) for a denser IDW residual field.
- **Post-calibration validation**: new `validating` phase shows an off-grid yellow dot. If gaze error exceeds 120px, offers "Re-calibrate" (up to 2 retries) or "Continue anyway".
- **i18n**: new keys for validation, re-calibration, desktop intro, and mobile check labels (ES/EN).

---

## v0.42.4 — Builder fixes: multi-upload and hitzone persistence (2026-04-10)

### research-frontend
- **Fix: File upload `multiple` default.** Navigation Flow and Preference Test templates were missing `multiple: true` in their `fileUpload` config, limiting uploads to a single image. Default changed from `false` to `true` for all `file-upload` components.
- **Fix: Hitzones lost on modal reopen.** `FileUploadAdvanced` sync key only compared `id`, `url`, and `s3Key` — it ignored `hitZones`. After drawing and saving hitzones, reopening the editor showed an empty canvas. Added hitzone count to the sync key so parent updates propagate correctly.

---

## v0.42.3 — Eye Tracking survey: hybrid IDW calibration (2026-04-10)

### participant-frontend
- **`EyeTrackingRenderer`:** Replaced 9-point viewport calibration with the same 4-point image-relative flow as `/eye-tracking-hybrid` (`HYBRID_IMAGE_CALIBRATION_POINTS`), IDW residual field (`hybridApplyCalibrationField` + `HYBRID_CALIBRATION_FIELD_STRENGTH`), and `hybridImagePercentToBlazeNorm` for `blaze.calibrate()`. BlazeGaze runs during calibration (for residuals) and viewing; `smoothAlpha` 0.38 aligned with hybrid lab.
- **Response payload:** `gazePipeline: 'hybrid-idw'` on desktop, optional `calibrationRmsePx` (viewport RMSE of residuals).

---

## v0.42.2 — Eye Tracking hybrid: zone pipeline, webcam, diagnostics (2026-04-10)

### participant-frontend
- **Lab `/eye-tracking-hybrid`:** Simplified stacked corrections (removed extra EMA on zone mapping; IDW field stays central). `hybridZoneGrid` retuned: half-plane nudges, row/column bias, optional left-half vertical stretch for clearer top/bottom on the left column; corner boosts removed earlier. Related tweaks to calibration field strength and gap-fill synthetic weight.
- **BlazeGaze:** Shared `BLAZE_GAZE_MEDIA_STREAM_CONSTRAINTS` (ideal 1280×720) for hybrid page and `EyeTrackingRenderer`. `BlazeGazeFrameStats` adds last capture width/height; soft warning on hybrid results if capture short edge is below 480px.
- **Cleanup:** Removed unused Ridge/MediaPipe `useEyeTracking` hooks and aligned `lib/eyeTracking` exports.

### docs
- `docs/eye-tracking-heatmap.md`: short notes on resolution, frames, model role, camera constraints, and the low-res hint.

---

## v0.42.1 — Eye Tracking hybrid: 4×4 grid, calibration & countdown fixes (2026-04-08)

### participant-frontend
- **Fix: Countdown never finished.** `finishStimulus` in useEffect dependencies caused the interval to restart on every render. Solved with a stable ref.
- **Fix: Zone mapping used window bounds instead of image bounds.** Gaze points are now mapped relative to the stimulus image's `getBoundingClientRect()`, so zones align with what the participant actually sees.
- **Improvement: 4×4 grid (16 zones) replaces 3×3 (9 zones).** Each zone covers 25% per axis — better resolution without exceeding BlazeGaze's accuracy.
- **Improvement: Stronger calibration.** `calibrate()` now captures 3 frames and runs explicit `adapt()` with 5 gradient steps (was lazy `handleClick` only). Runs fire-and-forget so UI stays instant.
- **Improvement: Less aggressive smoothing.** Alpha raised from 0.10–0.45 to 0.25–0.55 for more responsive zone-level tracking.
- **Cleanup: Removed legacy `/eye-tracking-test` route** and `EyeTrackingTestPage.tsx`. Only `/eye-tracking-hybrid` remains.

---

## v0.42.0 — Eye Tracking: BlazeGaze in survey flow, AOI drawing, canonical IDs (2026-04-08)

### participant-frontend
- Feat: **BlazeGaze integrated into EyeTrackingRenderer** — desktop participants get real webcam gaze tracking inside the survey flow (not just the standalone test page). Tablet/mobile keeps click-proxy as fallback.
- Feat: Persistent `<video>` element across all phases — camera stream no longer drops between calibration → viewing transitions.
- Feat: Response metadata now includes `trackingMethod` (blazegaze/click-proxy), `deviceType`, `gazePointCount`, and real `calibrationQuality` (e.g. `blazegaze-9pt`).
- Feat: Silent tracking during stimulus on desktop — no visible gaze indicator, gaze collected at 50ms intervals.

### research-frontend
- Feat: **AOI drawing** in Eye Tracking builder — when a stimulus is uploaded, an "Areas of Interest" section appears below the config. Researcher draws rectangular AOIs on the image, stored as JSON in the `aois` component.
- Feat: New reusable `AOIDrawer` component — click-drag drawing, SVG overlay, thumbnail list with remove.
- Feat: **User and Enterprise** shown in builder sidebar before Research Type.
- Fix: `getById` query now JOINs `enterprises` table so `enterprise_name` is available in research detail.
- Fix: Exported `resolveMediaUrl` from media service for use outside the service.

### backend
- Feat: Eye Tracking module template (migration 020) — 10 canonical components: `task-instructions`, `stimuli`, `emotion-recognition`, `attention-measurement`, `priming-time`, `display-mode`, `randomize-stimuli`, `shelf-count`, `shelf-items`, `aois`.
- Fix: `extractEyeTrackingConfig` in analytics now prioritizes canonical IDs (`stimuli`, `task-instructions`, `display-mode`) with fallback to legacy IDs.
- Fix: `getById` includes `enterprise_name` via LEFT JOIN.

### alignment
- All 3 layers (builder, renderer, analytics) now use the same canonical component IDs for Eye Tracking configuration.
- Template linked to stage template in production — new Eye Tracking stages auto-create a module with all components.

---

## v0.41.1 — Hybrid Eye Tracking with zone heatmap (2026-04-07)

### participant-frontend
- Feat: New `/eye-tracking-hybrid` route — device-adaptive eye tracking test page.
  - **Desktop**: BlazeGaze webcam gaze tracking with 9-point calibration (instant click, no blocking). Silent tracking during stimulus — no visible gaze dot.
  - **Tablet/mobile**: Touch + viewport attention proxy. No webcam needed.
- Feat: Zone-based attention heatmap (3x3 grid) over stimulus image as result, replacing imprecise pixel-level gaze dot. Color scale: blue (low) → green → yellow → red (peak). Percentage per zone.
- Feat: Instruction step before stimulus — researcher defines what the participant should look for.
- Feat: `useBlazeGaze` hook — `maxPoints: 100`, `clickTTL: 24h`, instant `handleClick` calibration (no frame capture blocking), `refinementCalibrate()` for continuous improvement during tracking.

---

## v0.41.0 — Research History, Clients, Study Logo, Demographics & CES fixes (2026-04-07)

### research-frontend
- Feat: New **Research's History** page — lists all researches by enterprise with chart, "Who is" panel, and full table. Accessible from sidebar.
- Feat: New **Clients** page — Affordances & Signifiers' Benchmark (scatter chart), explanatory panel, best option highlight, latest projects cards, and research table. Accessible from sidebar.
- Feat: **Study Logo** section in Research Configuration — toggle to show/hide logo in participant survey, upload client logo (max 2MB), preview with remove. Stored as `config.studyLogo: { enabled, s3Key }`.
- Fix: Unchecking the "country" demographic now also disables the associated "city" demographic automatically.
- Fix: "Descontento" emotion was already correctly classified as negative (`#fecaca`) in SmartVOCPreview — deployed to production.

### participant-frontend
- Feat: **Study logo** displayed in top-left corner of survey. Shows client logo if configured, EmotioCX default if not, hidden if toggle is off.
- Fix: City field no longer shows a free-text input to participants. Only displays a dropdown when the researcher has configured specific cities.
- Fix: `showCity` now checks `isEnabled('country')` before evaluating granularity — city never appears if country is disabled.
- Fix: CES sentiment zone colors (red/amber/green) and dynamic scale support deployed to production.
- Fix: NEV "Descontento" emotion color correction deployed to production.

### backend
- Feat: New endpoint `GET /enterprises/:id/researches` — returns researches filtered by enterprise with creator info.
- Feat: `listByEnterprise()` in research service with ownership clause + enterprise filter.

---

## v0.40.2 — City-country association in demographics config (2026-04-01)

### research-frontend
- Feat: When adding a city in the Country + City granularity config, the researcher can now select which qualifying country the city belongs to via a dropdown selector next to the city input.
- Feat: Each city chip displays the associated country (e.g. "CDMX — México") for visual clarity.
- Feat: Country selection persists between city additions for quick multi-city entry per country.
- Data: `CityEntry` now carries an optional `country` field. Stored as `{ name, country? }` objects in `demographics.country.cities` for round-trip. Backward-compatible with legacy `string[]` format.
- No participant-frontend or backend changes — `validValues` remains `string[]` of city names.

---

## v0.40.1 — View Progress: orphan modules fix (2026-04-01)

### backend
- Fix: `getVisibleModuleIdsForProgress` now uses `INNER JOIN stages` instead of just checking `stage_id IS NOT NULL`. Modules referencing a deleted stage were counted in the denominator, inflating it (e.g. 8/14 = 57% instead of 8/8 = 100%).
- Fix: Added `isModuleConfiguredForProgress` check — mirrors participant-frontend's `isModuleConfigured` logic so unconfigured template modules (no title, no images, no items) are excluded from the denominator.

---

## v0.40.0 — Eye Tracking System + City demographic (2026-03-28 / 2026-04-01)

### research-frontend
- Feat: When geographic granularity is "País + Ciudad", a new **Cities** section appears in the Country config drawer. The researcher adds cities as free-text chips (type + Enter/Add).
- Feat: Each city has a Clasifica/Desclasifica toggle — disqualifying cities block participants at demographics validation, qualifying cities are shown normally.
- Feat: Quotas tab switches to **per-city quotas** (%) when cities are configured; reverts to per-country quotas when granularity is "Solo país".
- Feat: City list and disqualification state persist across modal open/close via `demographics.country.cities` + `demographics.city.disqualifications`.
- New `/labs/eye-tracking` page — BlazeGaze CNN gaze prediction from webcam
- 17-point guided calibration → live gaze tracking (red dot)
- BlazeGaze model (670KB, webeyetrack) uses eye image patches + head pose
- Adaptive smoothing with deadzone, blink filtering (ignores closed-eye frames)
- MediaPipe face mesh library: 478 landmarks, iris detection, head pose, ridge regression
- Face detection overlay: wireframe volume lines, eye contours, iris circles (debug tool)
- Live telemetry panel: model status, eyes open/closed, gaze coordinates
- CSP updated for cdn.jsdelivr.net (WebEyeTrack's internal MediaPipe WASM)

### participant-frontend
- Feat: When the researcher configured specific cities, the participant sees a **dropdown select** instead of a free-text input for the city field. All cities (qualifying + disqualifying) appear in the dropdown; the backend enforces disqualification.
- No change for researches without configured cities — text input remains as before.
- Refactored eyeTracking lib into modular structure (`lib/eyeTracking/`)

### backend
- No code changes. Existing `checkDisqualifications` and `tryIncrementQuota` in `quota.service.ts` already handle `demographic_type = 'city'` via exact string match and disqualification list iteration.

### docs
- Technical assessment: what works, what doesn't, options evaluated (docs/eye-tracking-assessment.md)

---

## v0.39.3 — CES dynamic analytics, View Progress completion (2026-03-31)

### backend
- Fix: CES analytics now reads the configured scale (1-5, 1-7, 1-10) from the module config. Previously hardcoded to 1-5, discarding responses outside that range.
- Fix: `scaleConfigs` included in SmartVOC analytics response so the frontend can compute sentiment zones dynamically.
- Fix: View Progress — participants with `status = 'responded'` now show 100% progress and "Completado". Previously, conditional modules the participant never saw inflated the denominator, capping progress below 100%.
- Fix: View Progress detail view includes `panel_status` via LEFT JOIN with `participants` table.

### research-frontend
- Fix: CES results dashboard (QuestionCard, MetricCard, CPV, chart data) uses dynamic sentiment zones from backend `scaleConfigs` instead of hardcoded 1-5 ranges.

---

## v0.39.2 — Redirect @id, CES scale fix, NEV emotion fix (2026-03-30)

### participant-frontend
- Fix: Backlink redirects (complete, overquota, disqualified) now replace `@id` placeholder with the real participant ID.
- Fix: Backlink URLs without `https://` protocol are now treated as absolute URLs instead of relative paths (caused blank page).
- Fix: CES scale ignored researcher's selection — always showed 1-7 regardless of config. Root cause: `selectRange.predefined` (template default) was read before `comp.value` (researcher's choice). Priority inverted.
- Fix: CES buttons now display sentiment colors: red (negative/high effort), amber (neutral), green (positive/low effort). Zones per scale: 1-5 → 1-2/3/4-5, 1-7 → 1-3/4/5-7, 1-10 → 1-3/4-7/8-10.
- Fix: NEV emotion "Descontento" moved from attention row (green) to negative row (red). Aligns with backend and results dashboard classification.

### research-frontend
- Fix: Saving a SmartVOC module now syncs `selectRange.predefined` with the value selected by the researcher. Previously only `comp.value` was saved, leaving `selectRange.predefined` stuck at the template default.
- Fix: NEV preview emotion "Descontento" color corrected from green to red.

---

## v0.52.0 — Insights Finding: document analysis + LLM analysis (2026-04-07)

### research-frontend

- **Insights Finding.** Nuevo tipo de research sin stages/módulos. El investigador sube documentos (.csv, .txt, .xlsx, .docx, .pdf) desde un Drawer al crear. Parseo client-side + sentimiento léxico (ES/EN).
- **Document parser** (`documentParser.ts`). 5 formatos: SheetJS (.csv/.xlsx), Mammoth (.docx), PDF.js (.pdf), TextDecoder (.txt). Límite 200 entries × 300 chars para body size.
- **`InsightsFindingView`.** Panel izquierdo: tabla de entries con mood badges. Panel derecho: tabs Sentiment (resumen + accionables LLM), Themes (tabla con magnitude + sentiment score), Keywords (tags con sentimiento). Auto-trigger de análisis LLM con polling.
- **`isFileBasedResearch` flag.** Unifica Attention Prediction e Insights Finding en 4 archivos clave.
- **Delete optimista.** `useDeleteResearch` remueve inmediatamente de la lista con rollback en error.

### backend

- **Insights analysis service** (`insights.service.ts`). GPT-4o vía OpenAI SDK. Genera: sentiment summary + actionables, themes con magnitude/sentimentScore, keywords con sentimiento. Prompt bilingüe ES/EN, response_format JSON.
- **Insights controller.** `POST /insights/research/:id/analyze/:fileMediaId` (202 fire-and-forget) + `GET .../status/:fileMediaId`. Resultado se persiste en `config.stimuli[].analysis`.
- **`skip_default_modules` flag.** Research types file-based no crean stages/módulos default.
- **`express.json({ limit: '10mb' })`** en ambos servers.

---

## v0.51.2 — Attention Prediction: settings funcionales + Attention Video (2026-04-06)

### research-frontend

- **Settings modal funcional.** Blur, Opacity y Threshold ahora controlan el heatmap en tiempo real (debounce 150ms). Prediction Model (Simple/Advanced/Deep Learning) aplica presets automáticos. `CustomSelect` reemplaza `<select>` nativo. Modal renderiza via portal.
- **`AttentionVideoPlayer`.** Animación progresiva del scanpath predicho (5s). Puntos ordenados por saliencia — los más calientes aparecen primero. Controles: Play/Pause, Reset, barra de progreso, timer. Círculo indicador de fijación actual.

---

## v0.51.1 — Attention Prediction: saliency rendering basado en OGAMA (2026-04-06)

### research-frontend

- **`HeatmapRenderer` — dual renderer.** Saliencia usa colormap directo pixel a pixel (enfoque OGAMA/OpenCV) en vez de simpleheat. Cada valor mapea a color vía LUT de 256 entradas con alpha cuadrático. simpleheat se mantiene solo para datos de clicks/fijaciones sparse.
- **Separación real de hotspots.** Threshold 0.4, alpha cuadrático (`val² × 140`), overlay 45%. Las zonas de atención se distinguen sin tapar la imagen subyacente.

### backend

- **Attention Prediction service.** TranSalNet ONNX con normalización relativa min/max, step=3, threshold configurable. Endpoint fire-and-forget para evitar timeout de LiteSpeed.
- **Attention Prediction controller.** `POST /attention-prediction/research/:id/predict/:mediaId` (202 async) + `GET .../status/:mediaId`. Resultado se persiste en `researches.config.stimuli[].heatmapData`.

---

## v0.51.0 — Attention Prediction: builder completo + settings modal (2026-04-05)

### research-frontend

- **Fix: stimulus upload usaba `apiClient.put()` en vez de `fetch()`.** Reemplazado por `fetch()` con body raw, alineado al patrón de `FileUploadAdvanced`. Los stimuli ahora se persisten correctamente en `research.config`.
- **`AttentionPredictionCard`.** Componente dedicado para análisis de stimuli. Tabs: Prediction (heatmap + AOI drawing), Attention Video (placeholder), Image (original). Settings abre modal.
- **Settings modal.** Preview en tiempo real con 3 modos: Heat map, Opacity map, Composición. Controles: Blur (slider), Opacity (slider), Threshold (slider), Prediction model (select). Composición agrega: Analysis window, Frames in fixation (min/max), Dispersion, Merge range. Cambios se aplican solo al confirmar.
- **`HeatmapRenderer` — props `blur`, `opacity`, `threshold`.** Acepta parámetros de renderizado configurables desde el modal de settings.
- **Builder guard para Attention Prediction.** SmartVOC, Cognitive Tasks, módulos regulares y Research Config no se renderizan cuando el research es Attention Prediction.

---

## v0.50.0 — Implicit Association: 3 paradigmas diferenciados + Notes panel + criteria target selector (2026-04-03)

### research-frontend

- **Notes panel por tipo IAT.** Cada tipo de Implicit Association muestra un panel informativo en columna derecha (280px) con instrucciones para el investigador:
  - Attribute Testing: Target Objects (ejemplo Object A/B) + Criteria (hasta 5).
  - Comparing Attribute: Objects (hasta 3) + Dimensions + Criteria (hasta 15).
  - Objects Comparing: Target Objects (hasta 5) + Criteria con ejemplo Satisfaction/Dissatisfaction.
- **Criteria target selector.** La columna "Image" (file upload) en la tabla de criteria fue reemplazada por un selector de target (CustomSelect). El investigador asigna cada criteria a un target (Target 1, Target 2, etc.) para definir la respuesta correcta del participante.

### participant-frontend

- **3 paradigmas IAT diferenciados.** El renderer único fue reemplazado por lógica específica por tipo:
  - **Attribute Testing (Implicit Priming Test, 2 pasos):** Step 1 practica clasificar targets. Step 2 muestra criteria como estímulo; la respuesta correcta es el target asignado por el investigador.
  - **Comparing Attribute (Reaction Time Test, 1 paso):** Muestra Object + Criteria juntos. Botones = dimension labels (ej: Extravagente/Convencional). Sin feedback correcto/incorrecto — solo mide RT.
  - **Objects Comparing (IAT clásico, 3 pasos):** Step 1 clasifica criteria (botones = categorías Positive/Negative). Step 2 clasifica targets. Step 3 combinado.
- **Sin swap de testType.** Cada tipo se mapea a su nombre real, eliminando el swap confuso entre Comparing Attribute ↔ Objects Comparing.
- **Priming contextual.** El priming muestra contenido real (criteria o target según tipo) en vez del símbolo `+` genérico. Comparing Attribute no usa priming — estímulo directo.
- **Traducciones IAT (ES/EN).** 22 claves i18n agregadas. Instrucciones fallback usan traducciones en vez de placeholders en inglés del template.
- **Total de bloques dinámico.** Ya no hardcoded a 3 — se calcula según tipo y datos del test.

---

## v0.49.0 — IAT builder completo, Screener builder UX, participant renderers (2026-04-03)

### research-frontend

- **IAT stage type selector.** Al agregar un stage "Implicit Association" desde el drawer, se muestra un selector con los 3 tipos de test (Attribute Testing, Comparing Attribute, Objects Comparing). El backend crea el módulo correcto según la selección.
- **IAT builder grid layout.** Los targets/objects de cada tipo IAT se renderizan en columnas responsivas (2-5 cols según cantidad). Utility `implicitAssociationBuilder.ts` detecta módulos IAT y particiona componentes por `groupLabel`.
- **Technique-based stage filtering.** El drawer "Add Stage" filtra los stages disponibles según los `default_stages` de la técnica del research. Solo muestra stages que la técnica define.
- **Screener builder UX.** Headers por tipo de componente (choice, checkbox, ranking). Toggle visual para checkboxes. `RadioChoicesEditor` en grid. Hooks `useScreenerSingleChoiceTrim` y `useScreenerMultipleChoiceGroupPad` para mantener choices consistentes.
- **FileUpload single mode.** Respeta `component.fileUpload.multiple` (default `false`) — un solo archivo por target IAT. Fix overflow en `FileUploadAdvanced` para contenedores grid (`min-w-0`).

### backend

- **`defaultModuleName` en createStage.** Permite crear un stage Implicit Association con un tipo de módulo específico en vez de siempre Attribute Testing.
- **`technique_default_stages` en research detail.** El endpoint de detalle ahora incluye los `default_stages` de la técnica para que el frontend filtre stages.

### participant-frontend

- **ImplicitAssociationRenderer reescrito.** Motor IAT mejorado: extracción robusta de config (4 formatos de criteria), resolución async de imágenes S3, bloques estándar (atributos → targets → combinado), priming configurable.
- **EyeTrackingRenderer mejorado.** Resolución de estímulos S3, countdown timer, feedback visual de clicks.
- **ScreenerRenderer mejorado.** Integración con utils de screener participant.
- **DynamicStep simplificado.** Detección de módulos IAT/ET/Screener por nombre, delegación directa a renderers.

### database

- **Migración 018:** Fix de templates IAT — Attribute Testing (2 targets + criteria max 5), Comparing Attribute (3 objects + 2 dimensions + criteria max 15), Objects Comparing (5 targets + criteria-1/criteria-2 + criteria max 15).
- **Migración 019:** Fix de asociaciones `stage_templates_module_templates` — los 3 tipos IAT correctamente asociados al stage template "Implicit Association".

---

## v0.48.0 — Technique stage creation fix, backend deploy (2026-04-01)

### backend
- **Fix: Research creation with technique `default_stages`.** `stageTemplateNames` now includes `"Research Configuration"` — previously it fell through to `individualModules`, creating a spurious stage named after the research type.
- **Fix: Stage ordering for techniques.** When a technique's `default_stages` already includes "Research Configuration", `addDefaultStage` is skipped so stages respect the technique's defined order instead of always placing Research Configuration first.

### database
- **Fix: `default_stages` for "Biometric, Cognitive and Predictive".** Added "Research Configuration" at order 3. Full order: Screener → Welcome Screen → Research Configuration → Implicit Association → Cognitive Tasks → Eye Tracking → Thank You Screen.

### deploy
- Backend deployed to cPanel (v0.42.0 → v0.48.0). Includes all changes from v0.41.0–v0.47.0.

---

## v0.47.0 — Design system, skeletons, dashboard responsive, auth fix (2026-03-29)

### research-frontend

- **Complete EmotioX light color system.** Paleta propia basada en principios Vambe AI, adaptada 100% a light. Tokens en Tailwind config + CSS variables:
  - Surfaces: 5 niveles (`surface-app`, `primary`, `secondary`, `tertiary`, `sunken`).
  - Text: 5 niveles semanticos (`heading`, `body`, `muted`, `faint`, `inverse`).
  - Accent: 6 variantes (`DEFAULT`, `hover`, `pressed`, `light`, `muted`, `subtle`). Hover va mas oscuro (`#0058D4`).
  - Semantic: success, warning, error, info — cada uno con bg, solid, text, border.
  - Chart: 8 colores + auxiliares (grid, axis, reference). NPS: promoter, passive, detractor.
  - Borders semi-transparentes (`rgba(0,0,0,N)`). Sombras solo funcionales (dropdown, modal).
  - Referencia: `docs/design-system/emotiox-palette.md`.
- **Accent color migration.** ~50 componentes migrados de `blue-*` hardcoded a tokens `accent`. Incluye: Button, Sidebar, toggles, checkboxes, inputs (focus rings), file uploads, tabs, links, info boxes, modals, stepper, badges.
- **Loading states: full skeleton.** Eliminados todos los spinners de carga de datos. Nuevo `Skeleton.tsx` con 7 componentes reutilizables. Skeletons en: sidebar, builder, research list, modules grid, drawer, research types/techniques, stage selector modal. App shell skeleton para auth bootstrap y Suspense. Solo quedan spinners en Button (accion) y FileUpload (progreso).
- **Dashboard responsive para desktop.** Tabla con `table-fixed` + `colgroup` porcentual (30/10/14/14/24/8). Name y Researcher con `truncate`. Sidebar derecho y bottom section en `xl+`. Filter pills `rounded-full`. Cards bottom en `flex` single-row.
- **Dashboard filter fix.** Comparacion `String()` para `research_type_id` vs `type.id` (MySQL number vs frontend string).
- **Auth bootstrap fix.** `bootstrapSession` no llama a `/auth/me` si no hay token almacenado.

### backend

- **Auth 400→401 fix.** El catch generico en `auth.controller.ts` sobreescribia `AuthError.statusCode=401` a 400 cuando el mensaje contenia "Invalid". Ahora `isAuthError` tiene prioridad con `else if`.

---

## v0.46.0 ��� Google-only auth + design system foundation (2026-03-28)

### research-frontend
- **Auth simplified to Google OAuth only.** Removed manual login form (email/password), register page, and all related code:
  - Deleted `RegisterPage.tsx`.
  - Removed `login()`, `register()` from `auth.store.ts`.
  - Removed `login()`, `register()` from `auth.service.ts`.
  - Removed `LoginCredentials`, `LoginRequest`, `RegisterCredentials`, `LoginResponse`, `RegisterResponse` from `types/auth.ts`.
  - Removed `/register` route from `routes.tsx`.
- **Design system foundation applied (light theme):**
  - Added Plus Jakarta Sans (400, 600) via Google Fonts.
  - Tailwind config: new `font-sans` (Plus Jakarta Sans), `accent` color tokens (`#006aff`, `#3b82f6`).
  - `AuthLayout`: clean light background (`bg-slate-50`).
  - `LoginPage`: white card with subtle border, "Emotiox" heading + "UX Research Platform" subtitle, single Google button.
- Copied Vambe AI design system reference docs to `docs/design-system/`.

---

## v0.45.0 — Participant rendering: Screener, Implicit Association, Eye Tracking (2026-03-28)

### participant-frontend
- New `ScreenerRenderer` — renders Screener filtering question with Qualify/Disqualify choices. Reuses existing `ChoiceQuestion` component. Response: `component_id = 'choice'`, value = selected choice ID.
- New `ImplicitAssociationRenderer` — full IAT trial engine with:
  - Instructions screen with category labels and keyboard shortcuts (E/I or arrow keys).
  - Priming phase (fixation point, configurable duration from module config).
  - Trial phase: shows target (text or image), participant classifies via buttons or keyboard.
  - Practice trials (1 per target) then test trials (target × attribute, shuffled).
  - Visual feedback (correct/incorrect) between trials.
  - Response: `component_id = 'iat-trials'`, value = `[{ targetId, criterionId, rt, correct, phase }]`.
  - Supports all 3 test types: Attribute Testing, Comparing Attribute, Objects Comparing.
- New `EyeTrackingRenderer` — click/tap tracking as proxy for gaze data:
  - Instructions screen with task description and viewing duration.
  - Stimulus display with countdown timer and crosshair cursor.
  - Click/tap positions recorded as fixations in natural image coordinates.
  - Visual feedback dots on recorded positions.
  - Auto-completes after configurable duration (default 10s).
  - Response: `component_id = 'eye-tracking-data'`, value = `{ fixations: [...], calibrationQuality: 'click-proxy', integrityScore: 1.0 }`.
  - S3 stimulus URL resolution via `mediaService`.
- `DynamicStep`: delegates to new renderers based on module name detection.
- `useNavigation`: `DEFAULT_STEPS_ORDER` includes `screener`, `attribute-testing`, `comparing-attribute`, `objects-comparing`, `eye-tracking`.
- `ResearchPage`:
  - `getStepIdFromModuleName()`: explicit mappings for Screener, IAT module types, Eye Tracking.
  - `isModuleConfigured()`: validation rules for Screener (has choices), IAT (has targets), Eye Tracking (has stimulus).
  - `shouldShowButton()`: hides footer button for IAT and Eye Tracking (internal auto-advance).
- `renderers/index.ts`: exports new renderers.

---

## v0.44.0 — Eye Tracking results analytics (2026-03-28)

### backend
- New endpoint `GET /analytics/research/:id/eye-tracking`.
- Extracts stimulus config per module (image URL, modality, task description, AOIs).
- Computes heatmap data, fixation metrics, and AOI stats from gaze responses (`component_id = 'eye-tracking-data'`).

### research-frontend
- New `EyeTrackingResults` component — per-stimulus cards with:
  - Metrics bar (participants, responses, avg dwell time, avg fixations).
  - Heatmap / Image view toggle (reuses `HeatmapRenderer`).
  - AOI list with dwell %, fixation count, duration, viewer count.
  - Download image button.
- New "Eye Tracking" tab in `ResearchResultsPage`.

---

## v0.43.0 — Implicit Association results analytics (2026-03-28)

### backend
- New endpoint `GET /analytics/research/:id/implicit-association` — finds Implicit Association stage modules, extracts config (targets, attributes, priming time), queries trial responses, and computes D-scores per (attribute, target) pair.
- `analytics.service.ts`: `getImplicitAssociationResults()` detects test type from module name (Attribute Testing, Comparing Attribute, Objects Comparing), parses criteria from ranking-list component, and normalizes reaction times to -100..100 score range.

### research-frontend
- New component `ImplicitAssociationResults` with 3 chart types matching the reference designs:
  - **Attribute Testing** → Recharts RadarChart (2 targets as filled polygons, attributes on axes, -100 to 100 range).
  - **Comparing Attribute** → Grouped BarChart (targets side-by-side per attribute, 0-120 range, average reference line).
  - **Objects Comparing** → Horizontal divergent BarChart (objects on Y axis, 2 dimensions as left/right bars, -100 to 100 range).
- `ResearchResultsPage`: new "Implicit Association" tab (Zap icon), visible only when the research contains an Implicit Association stage.
- `analytics.service.ts` (frontend): new types `IATModuleResult`, `ImplicitAssociationResults` and `getImplicitAssociationResults()` function.

---

## v0.42.0 — Screener results analytics (2026-03-28)

### backend
- New endpoint `GET /analytics/research/:id/screener` — aggregates Screener responses.
- `analytics.service.ts`: `getScreenerResults()` returns choice distribution (Qualify/Disqualify), participant status counts (overquota, disqualified, complete), daily distribution with per-choice breakdown, best/slowest day, and weekly time series.

### research-frontend
- New component `ScreenerResults` — stacked bar chart (distribution by choice/route), 3 status cards, best/slowest day, weekly line chart.
- `ResearchResultsPage`: tab system refactored to data-driven (`TAB_DEFS`); Screener tab appears only when the research contains a Screener stage; auto-selects first available tab on load.
- `analytics.service.ts` (frontend): new types and `getScreenerResults()` function.

---

## v0.41.0 — Technique default stages + generic collection rendering (2026-03-28)

### database
- New column `research_techniques.default_stages` (JSON): permite a cada técnica definir sus propios stages default.
- "Biometric, Cognitive and Predictive" configurada con: Screener → Welcome Screen → Implicit Association → Cognitive Tasks → Eye Tracking → Thank You Screen.

### backend
- `research.service.ts`: `stageTemplateNames` incluye Screener, Implicit Association, Eye Tracking. `create()` prioriza `default_stages` de la técnica sobre `default_modules` del research type.
- `research-techniques.service.ts`: queries incluyen y parsean `default_stages`.
- `research-types.service.ts`: `getTechniquesByType` retorna `default_stages` de cada técnica.

### research-frontend
- `ResearchTechnique` type incluye campo `default_stages`.
- `useResearchForm`: `handleSubmit` envía los stages de la técnica cuando existen.
- `ResearchFormStep2`: muestra la lista de stages de la técnica seleccionada.
- `ResearchBuilderPage`: lógica de `module_collection` generalizada — cualquier stage collection (Cognitive Tasks, Implicit Association, etc.) se renderiza con `CognitiveTaskModuleCard` automáticamente.
- `ResearchBuilderHeader` y `StageEmptyState`: props genéricas para cualquier collection stage.

---

## v0.40.0 — New stages: Screener, Implicit Association, Eye Tracking (2026-03-28)

### database
- New stage **Screener** (`single_module`): pregunta de filtrado con choices Qualify/Disqualify.
- New stage **Implicit Association** (`module_collection`): Attribute Testing, Comparing Attribute, Objects Comparing.
- New stage **Eye Tracking** (`single_module`): stimuli, task config, Stand Alone y Shelf.
- Total stage templates: 8. Total module templates: 22.

---

## v0.39.1 — Participant limit + percentage quotas (2026-03-25)

### backend
- Fix: `getEffectiveParticipantLimitCap` — el límite global (*Limit number of participants*) se aplica tanto si `participantLimit` está guardado como **número** (legacy, igual que en research-frontend) como si es `{ enabled, value }`. Antes solo el objeto se interpretaba; con número, el backend ignoraba el límite y la conversión `% →` cupos absolutos en `tryIncrementQuota` no usaba **N**.
- `validateDemographics`, `checkQuotaPreAvailability` y `saveParticipantResponses` usan la misma resolución.

### deploy
- Backend desplegado en cPanel (emotio.cx) con este cambio.

---

## v0.39.0 — Quota save + pre-check + participant flow (2026-03-25)

### backend
- `checkQuotaPreAvailability`: solo investigación activa y límite global de participantes; ya no usa agotamiento por buckets demográficos en el GET (evita falsos bloqueos y redirecciones antes de demografía).
- `getParticipantStatus`: cuenta solo respuestas con `module_id != 'demographics'` (alineado con el límite global).
- `checkAllQuotasFull` marcado como deprecated (lógica de “todos los buckets llenos” no aplicable si las opciones no cubren el 100% del espacio).

### participant-frontend
- Carga con `ECX`/panel: `getParticipantStatus` antes de quitar loading; reset de `thank-you` persistido sin respuestas reales; evita carrera con redirección a `complete`.

### research-frontend
- Guardado de cuotas de **edad**: `quotas` entra en el mismo `mapModalConfigToBackend` vía `onSave` (cuarto argumento); ya no depende solo del flush `onQuotasSave` + `useEffect`.
- `handleSaveDemographicConfig`: no pisa cuotas con `[]` truthy; solo preserva cuotas antiguas si el payload no trae la clave `quotas`.
- `DemographicConfigModalBase`: siempre llama `onQuotasSave` (vacío si cuotas desactivadas).
- Copy en modales demográficos: cupo lleno = sobre cuota, no “descalificación” por perfil.

### scripts
- Tests de quota-availability / redirect ajustados al nuevo criterio de pre-check.

---

## v0.38.0 — Quotas always percentage, simplified UI (2026-03-25)

### backend
- Fix: Demographic quotas now store `quota_type` column — percentage values persist correctly instead of being lost on reload.
- Fix: `tryIncrementQuota` and `checkAllQuotasFull` resolve percentage quotas to absolute limits using the research's `participantLimit` (e.g., 30% of 100 participants = 30 slots).
- Fix: All quotas enforce immediately after demographics submission — removed unused `post_collection` enforcement path.
- Migration 013: Adds `quota_type` column to `demographic_quotas`, migrates existing rows to `percentage` + `immediate`.

### research-frontend
- Fix: Quota type selector removed — quotas are always percentage (%). Previously saved as "percentage" but always displayed as "Número" on reload due to hardcoded `'absolute'` in `mapBackendQuotasToModal`.
- Fix: Application mode selector removed — quotas always apply immediately after demographics. The "Filtro posterior" option never blocked participants and caused confusion.
- UI: Quota row simplified from 4 columns (option, type, value, application) to 2 columns (option, percentage).
- UI: Info text in all 8 demographic config modals updated to reflect percentage-only behavior.

---

## v0.37.1 — Participant count fix, redirect screen (2026-03-24)

### backend
- Fix: `getParticipantCount` now excludes `module_id = 'demographics'` — participants who only submitted demographics no longer count against the participant limit. Previously ghost entries (`@id`, abandoned participants) consumed limit slots.

### participant-frontend
- Feat: Redirect screen with EmotioCX logo and spinner shown for 1.5s before navigating to backlink URLs (overquota, disqualified, complete).
- i18n: Added `redirecting` key — "Redirigiendo..." / "Redirecting..."

---

## v0.37.0 — Research closed blocking, overquota/disqualified badges (2026-03-24)

### backend
- Fix: `validateDemographics` checks research status before processing — returns `RESEARCH_CLOSED` if not active.
- Fix: `checkQuotaPreAvailability` verifies research is active and participant limit not reached (in addition to quotas).
- Fix: `saveParticipantResponses` returns HTTP 410 instead of 500 for inactive research or participant limit reached.
- Feat: View Progress LEFT JOINs `participants` table — overquota/disqualified status overrides progress-based status.

### participant-frontend
- Fix: Demographics validation handles `RESEARCH_CLOSED` — shows blocking screen instead of generic error.
- Fix: Response save errors for inactive research or participant limit show blocking screen instead of alert.
- Fix: `loadResearch` catch detects "not active" errors → "research closed" screen.
- i18n: Added `errors.researchClosed`.

### research-frontend
- Feat: View Progress badges "Sobre cuota" (orange) and "Descalificado" (red).

### scripts
- New: `test-quota-redirect-scenarios.ts` — 8 scenarios, 20 assertions.

---

## v0.36.0 — Quota fix for non-numeric age, AOI reactive filters (2026-03-22)

### backend
- Fix: `matchesQuotaValue` returned false for non-numeric age options (e.g., "Menor 18") because `parseInt` fails on strings starting with letters. Now falls back to exact string comparison when `parseInt` returns NaN. Previously these participants passed validation as valid.
- Fix: `connect()` dev table prefix list was missing `demographic_quotas` and `participant_demographics` — queries from `tryIncrementQuota` in dev mode now correctly use `dev_` prefixed tables.

### research-frontend
- Fix: AOI stats (percentage, participant count) now recalculate reactively when demographic filters change. Previously stats were computed once at draw time and never updated.
- UI: Navigation Flow result images capped at `max-h-[700px]` (was `max-w-[400px]`).

---

## v0.35.0 — Duplicate modules fix, age reorder, UX polish (2026-03-21)

### participant-frontend
- Fix: Duplicate modules (Navigation Flow, Preference Test, Ranking, etc.) now coexist — uses module UUID as step key instead of name-based key. Previously the second module overwrote the first.
- Fix: Ranking modules not appearing — `isModuleConfigured` now handles `{items: [...]}` object format in addition to direct arrays.
- Fix: Age range options now preserve the order defined by the researcher (removed numeric sort).
- Fix: Demographic question order matches research-frontend (`age, country, gender, ...` instead of `age, gender, country, ...`).
- Fix: Demographic labels aligned with research-frontend — "Age Range", "Country & Geography", "Annual Income" (EN); "Rango de Edad", "País y Geografía", "Ingreso Anual" (ES).
- UI: Emotion selector uses flat 4-column grid (mobile) / 7-column (desktop) instead of separated 3-row layout.
- UI: Ranking items — removed drag handle icon (hamburger), participants reorder with arrow buttons only.
- UI: NavigationFlow in preview mode — Esc key or click on dark area to skip step.
- UI: DevSidebar updated to support UUID-based step keys with proper grouping and ordering.

### research-frontend
- Feat: Age Range options reorderable with up/down arrows in config modal. Order preserved through save → backend → participant.
- Feat: Filters column in SmartVOC and Cognitive Task Results is now sticky with `max-h-700px` scrollable.
- Feat: SmartVOC Results layout restructured — filters column is outside the scrollable content area so it stays visible.
- Feat: AOI labels simplified to `AOI #1`, `AOI #2`, etc. instead of "Area of Interest (AOI)".
- UI: AOI overlay text shows only label and percentage (removed participant count from overlay).

---

## v0.34.0 — Sentiment analysis, heatmap overhaul, UI cleanup (2026-03-21)

### backend
- Feat: Lexicon-based sentiment analysis (`sentiment.service.ts`) — bilingual ES/EN dictionaries with negation and intensifier support. Classifies text as `positive`, `negative`, `neutral`, or `indeterminate`.
- Feat: Sentiment auto-computed on save for text responses (Short/Long Text, VOC) and stored in `metadata.sentiment`.
- Feat: `getModuleResponses` computes sentiment on-the-fly for existing text responses without stored sentiment.
- Feat: Analytics endpoints (`getTextResponses`, `getSmartVOCResults`) return `sentiment` per response.

### research-frontend
- Feat: VOCComments displays sentiment as colored badges (green/red/gray/yellow).
- Feat: VOCComments "Sentiment Analysis" tab shows real distribution bars (positive/negative/neutral/indeterminate) instead of hardcoded placeholder text.
- Feat: Cognitive Task Short/Long Text reads `metadata.sentiment` for mood column.
- Feat: Heatmap rewritten with `simpleheat` library — dark overlay + green→yellow→red gradient, Hotjar-style. Replaces custom pixel-by-pixel renderer.
- UI: Removed duplicate research title from builder sidebar.
- UI: Removed "Update graph" banner from Navigation Flow results.
- UI: Removed non-functional action buttons (three-dots) from Choice and Preference Test cards.
- UI: Removed non-functional filter icon from AOI cards.
- UI: Navigation Flow images capped at 400px width.

---

## v0.33.0 — Filters fix, SmartVOC polish, time ranges, participant drawer (2026-03-20)

### backend
- Fix: `getModuleResponses` returned raw snake_case columns (`participant_id`) — frontend filters failed silently. Now maps to camelCase (`participantId`).
- Fix: `getCognitiveTaskResults` excludes orphan modules (`stage_id IS NULL`).
- Fix: `participant_demographics` collation mismatch (`utf8mb4_general_ci` vs `utf8mb4_unicode_ci`) — unified to `utf8mb4_unicode_ci`.
- Feat: `getSmartVOCResults` returns `questionTexts` per metric type (csat, ces, nps, cv, nev, voc) extracted from module config. Looks for `{type}-title` component with fallback to `placeholder.text`.

### research-frontend
- Fix: Demographic filters now apply to all SmartVOC charts — Trust Flow, MetricCard sparklines, and NPS stacked bars were using pre-aggregated backend data without `participantId`. All charts now compute from filtered individual scores.
- Fix: CES calculation was inverted — treated scores 4-5 as positive (much effort). Now: 1-2 = little effort (positive), 4-5 = much effort (negative).
- Fix: CES breakdown labels corrected: "Little effort" (green) / "Much effort" (red).
- Fix: MetricCard tooltip labels now match card context (CES shows "Little effort/Much effort", not generic "Satisfied/Dissatisfied").
- Fix: NPS Ratio line rendered behind stacked bars. Changed from `Area` to `Line` so it draws on top.
- Feat: Time range selector extended with 6M and 12M options alongside Today/Week/Month.
- Feat: SmartVOC question cards show real questions from backend config instead of hardcoded English text. Title simplified (e.g. "CSAT" instead of "Customer Satisfaction Score (CSAT)").
- Feat: Participant details Drawer — eye button in View Progress table opens slide-in panel with status, progress, duration, and full response list.
- UI: Removed "Acceso a Tests" button and modal from View Progress.
- UI: Removed "Acceso directo" column from participants table.
- UI: Trust Flow chart unified to LineChart for all time ranges (was BarChart for Week).
- UI: Removed duplicate select from Trust Flow chart (uses parent time range selector).
- UI: Participants table has internal scroll (`max-h-[60vh]`, sticky header) instead of page-level scrollbar.
- UI: Sidebar scroll hidden (`scrollbar-hide`) in both Standard and ResearchBuilder sidebars.
- UI: Tooltips added to all Cognitive Task result metrics explaining what each number means.
- UI: Ranking card — wider label column, "—" for mean when no responses, position labels only in header.

---

## v0.32.0 — Dashboard cleanup, progress fix, review mode (2026-03-20)

### backend
- Fix: Participant progress counted orphan modules (no stage) and non-visible module_ids like `demographics`. Now uses `getVisibleModuleIdsForProgress` — only modules with `stage_id`, excluding Welcome/ThankYou/ResearchConfig/hidden.
- Feat: Overview metrics response includes `totalModules` (visible modules configured).
- Feat: Research list query joins `users` table to return `creator_first_name`, `creator_last_name`, `creator_email`.
- Feat: Public endpoint `GET /public/research/:id/participant/:pid/responses` for read-only review mode.

### research-frontend
- Dashboard table: removed fake Progress column, removed Copy ID button, added Created/Updated date columns, Researcher column shows real user name or email.
- View Progress: removed note banner, title/subtitle, "Actualizar datos" bar, "Generar Participantes" tab. Cards compacted (no icons, smaller text). Added "Módulos" card showing total configured.
- View Progress: search bar and status filter removed from participants table.
- View Progress: "Acceso directo" buttons now open review mode URL (`?review=participantId`).

### participant-frontend
- Feat: Review mode (`?review=participantId`) — loads participant responses from backend, shows sidebar + green "Review Mode" banner, no action buttons. Read-only view of what the participant answered.
- Fix: Demographics step initializes local state from store (supports review mode pre-loaded responses).
- Fix: DevSidebar now includes Demographics step in navigation.

---

## v0.31.1 — Template drawer filtering, SmartVOC unique metrics (2026-03-19)

### research-frontend
- Fix: Template drawer showed Cognitive Task modules when opened from SmartVOC stage. Now filters by stage name instead of `stage_type` (both were `module_collection`).
- Feat: SmartVOC metrics are unique — drawer hides metrics already present in the stage.
- Cognitive Tasks still allows repeated module types.

---

## v0.31.0 — Demographics overhaul, Drawer UI, Linear Scale selector, module creation fix (2026-03-19)

### backend
- Fix: `buildOwnershipClause` generated `r.created_by` on queries without table alias → 500 on status change, activate, delete, stage/module operations. Now accepts empty alias for unaliased queries.
- Fix: `modules.create` now includes `stage_id` in INSERT. Previously modules were created without stage association and disappeared on refetch.
- Feat: `getScaleResponses` reads `scale-range` component (new format) with fallback to legacy `scale-start-value`/`scale-end-value`.

### research-frontend
- Feat: Demographic config modals replaced with slide-in Drawer component (right side, overlay close, ESC).
- Fix: Demographics round-trip data loss — mapper now preserves modal-format fields (`validAges`, `options`, `disqualified`) alongside backend format so reopening a modal restores saved state.
- Fix: Disabling a demographic preserves config (`{ ...config, enabled: false }`) instead of destroying all data.
- Fix: Re-enabling a demographic restores existing config instead of overwriting with defaults.
- Fix: Quota flush useEffect used stale closure — now uses refs for fresh reads.
- Feat: Unified all demographic option UIs to match Age pattern: green "Clasifica" / orange "Desclasifica" toggles, icon-only edit/delete.
- Feat: All demographic drawers use consistent blue "Guardar configuración" button.
- Feat: Linear Scale template changed from start/end inputs to select dropdown (1-3, 1-5, 1-7, 1-10, 0-10).
- Fix: `CustomSelect` dropdown used `window.scrollY` with `position:fixed` → drifted on scroll. Now uses viewport-only coords and closes on scroll.
- Fix: Nested `<button>` hydration error in demographic rows — changed wrapper to `<div>`.
- Fix: Participant limit input always disabled — `onChange` serialized `{enabled,value}` object as `"[object Object]"`. Now uses `JSON.stringify` for objects.
- Fix: New modules from template drawer now persist on Save (local modules POST with `stage_id` instead of PUT to nonexistent ID).
- Fix: Template structure parsed from JSON string when MySQL returns it as text.
- Feat: Research URL shows `?ECX=@id` format for panel mode.

### participant-frontend
- Fix: Demographics `getOptionsForDemographic` prefers `validValues` (all options) over `validAges`/`validCountries` (only qualifying) so participants see full range including disqualifying options.
- Fix: Age ranges sorted by leading number in dropdown.
- Feat: `usePreviewMode` and `ResearchPage` read `?ECX=` / `?ecx=` as participantId (new EmotioCX standard param).
- Fix: `trackLocation` now works — removed dead `enableLocationCapture` dependency that blocked it.
- Feat: Auto-redirect on thank-you via `backlinks.complete` useEffect (old code in handleNext never fired because currentStep was stale in closure).
- Fix: Linear Scale renderer reads `scale-range` component first, falls back to legacy `start-value`/`end-value`.

---

## v0.30.0 — Cognitive Results overhaul, admin role, duplicate responses fix (2026-03-19)

### backend
- Feat: Admin role — users with `role: 'admin'` bypass ownership filter and see all studies. `buildOwnershipClause` helper used across all research service queries.
- Fix: Duplicate responses — added `UNIQUE INDEX (research_id, participant_id, module_id, component_id)` on `responses` table. Cleaned 233 duplicate rows. `ON DUPLICATE KEY UPDATE` now works correctly.
- Fix: `getScaleResponses` deduplicates by participant (keeps latest response) as safety net.
- Feat: All analytics endpoints (`getScaleResponses`, `getChoiceResponses`, `getRankingResponses`) now return `questionText` extracted from module config `question-title` component.
- Feat: `getCognitiveTaskResults` includes `questionText` per module so all result types show the configured question.
- Feat: `getRankingResponses` returns configured items even with 0 responses (parses `value` JSON string from `ranking-list` component).
- Feat: `getChoiceResponses` returns configured choice options with labels even with 0 responses.
- Feat: `getScaleResponses` returns full configured range (start–end) even for values with 0 responses.

### research-frontend
- Fix: Linear Scale results — percentage always outside bar (black text), removed `minWidth: 16px` distortion, removed hardcoded "26s" and placeholder question text.
- Fix: All Cognitive Task Results show the real configured question in the header, not the module type name. Fallback to module name if no question configured.
- Fix: Removed duplicate "Question" card that repeated the same text shown in the header (Scale, Choice, Ranking).
- Fix: Removed "Question:" prefix from Short/Long Text headers (VOCComments).
- Fix: Ranking — removed hardcoded "76s" and "Secs" column, removed "Question:" prefix. Column headers aligned with row content.
- Fix: Choice — removed hardcoded placeholder question and "26s".
- Fix: Navigation Flow results — step thumbnails show actual image miniature instead of blue "Step N" placeholder. All steps collapsed by default.
- Fix: Navigation Flow — all tabs (Click Map, Quantity Mapper, Scan Path, Image) use `w-full` for consistent image sizing matching Heat Click Map.
- Fix: Linear Scale "Option 01" labels use `whitespace-nowrap` to prevent line wrapping.

---

## v0.29.1 — Progress fix, filters, demographics sync, image sizing, SW cleanup (2026-03-18)

### backend
- Fix: View Progress — progress calculated by modules answered (`module_id`) instead of sub-components (`component_id`). Excludes Welcome/Thank You/Research Config from total. Participants who answered all questions now show 100% and "Completado".
- Feat: `GET /public/research/:id/participant/:participantId/status` — check if participant already responded.

### research-frontend
- Fix: Cognitive Task Results filters now apply to all module types (Scale, Ranking, Choice, NavigationFlow, PreferenceTest). Previously only Short/Long Text responded to demographic filters.
- Fix: Cognitive Task Results show modules even with 0 responses (previously hidden).
- Fix: Navigation Flow results — images use `w-fit max-w-full` containers so vertical images maintain proportions and SVG overlays align correctly.
- Fix: Linear Scale results — percentage text moved outside bar (always black, always readable).
- Feat: Navigation Flow results — "Download image" button per tab (captures heatmap/clicks/scan path as PNG).
- Fix: Logo path uses `import.meta.env.BASE_URL` for cPanel `/research/` base path compatibility.

### participant-frontend
- Fix: Demographics — values persist to store immediately on change (not just via useEffect), preventing "validation error" on fast clicks.
- Feat: Dynamic step order from backend `order_index` instead of hardcoded `STEPS_ORDER`. Module reorder in research-frontend now reflects in participant flow.
- Feat: Block already-responded participants with "already responded" screen.
- Fix: Choice question (Single/Multiple) — purple color scheme changed to blue.
- Fix: Force unregister stale service workers and clear caches on load (fixes users seeing old "AWS backend" error).

---

## v0.29.0 — Linear Scale controlled ranges, module reorder, Ranking UX, logo (2026-03-18)

### research-frontend
- Feat: Linear Scale — replaced free-form min/max inputs with controlled dropdown: 1-3, 1-5, 1-7, 1-10, 0-10. Start/End labels now always visible.
- Feat: Module reorder — up/down arrows on each SmartVOC and Cognitive Task module card. Persists via `PUT /stages/:stageId/modules/reorder`.
- Feat: Auto-scroll to newly created module after adding from template drawer.
- Fix: Ranking results — display item names instead of UUIDs (backend now returns `label` from module structure).
- Fix: Module creation used stale stage data for `order_index` calculation; now reads fresh stage from query cache.
- Feat: EmotioCX logo (`EmotioCX-logo.svg`) in both StandardSidebar and ResearchBuilderSidebar, replacing BrainCircuit icon.

### participant-frontend
- Fix: Ranking — purple color scheme changed to blue (consistent with rest of UI).
- Fix: Ranking — drag handle icon changed from block to classic 3-line grip icon.

### backend
- Feat: `getRankingResponses` now reads module structure to return `label` for each ranking item (fallback to ID).

---

## v0.28.5 — Translate module templates to English (2026-03-18)

### backend (production database)
- Fix: 8 Cognitive Task module templates had Spanish labels/placeholders. Updated to English: Short Text, Long Text, Linear Scale, Single Choice, Multiple Choice, Navigation Flow, Preference Test, NPS.

---

## v0.28.4 — NavigationFlow 3-attempt limit, demographics validation (2026-03-18)

### participant-frontend
- Fix: `img.decode()` timeout (1s) prevents indefinite hang in Opera/Linux that blocked hitzone detection.
- Feat: NavigationFlow — 3 attempts per image. Correct click advances; 3rd miss ends the flow and moves to the next question.
- Fix: Demographics — ENTER or "Guardar y continuar" now requires all enabled fields answered, not just one.

---

## v0.28.3 — Ranking participant fix, module template drawer (2026-03-18)

### participant-frontend
- Fix: Ranking parser now handles the new `{ items, randomize }` object format.
- Feat: `randomize` flag support — items shuffled on first load when enabled.

### research-frontend
- Feat: Module template selector converted from modal to slide-in drawer. Filters templates by stage type (SmartVOC metrics vs Cognitive Task questions).
- Feat: "Add another question/metric" button at the bottom of both Cognitive Tasks and SmartVOC stages.
- Fix: Removed stale "ultra basico" template from production database.

---

## v0.28.2 — Ranking module: database fix (2026-03-18)

### backend (production database)
- Fix: 4 Ranking modules had legacy structure (input+textarea+select slider) instead of correct `question-title` + `items` (ranking-list). Migrated in-place preserving existing titles.
- Fix: `module_templates.Ranking` still had legacy slider structure — updated to `["input", "ranking-list"]` so new Ranking modules are created correctly.

---

## v0.28.1 — Heatmap, AOI, Ranking redesign, hitzone fix, module delete (2026-03-18)

### research-frontend
- Feat: Heatmap — intensity-based color gradient (blue→purple→red→yellow→white) with 50% alpha overlay, replacing per-click green/red dots.
- Feat: AOI (Areas of Interest) — draw rectangles over heatmap, shows % of participants and count per AOI, with thumbnail and Remove button.
- Feat: Ranking results — redesigned to match Figma: per-option histogram showing vote distribution by position, sorted by mean.
- Feat: Ranking builder — added Qualify/Disqualify selector per option, "Add another choice" button, "Randomize the order of questions" checkbox.
- Feat: Module delete — trash icon on SmartVOC and Cognitive Task module cards with confirmation modal; calls `DELETE /research/:id/modules/:moduleId`.
- Fix: Hitzone overlay in results — converted pixel coordinates to percent before rendering in SVG viewBox; hitzones now align with the image.
- Fix: Hitzone editor — enlarged container (max-w-48rem, h-700px) so drawn areas are proportional to the actual image.
- Fix: VOC download — uses pre-filtered data instead of nonexistent `/responses/.../smart-voc` endpoint.
- Fix: NPS — removed duplicate time-range dropdown (top bar already controls this).

### participant-frontend
- Fix: NavigationFlow — removed container fallback when hitzones exist; clicks now only use rendered image rect, preventing coordinate mismatch that made all clicks incorrect.
- Removed temporary debug overlay.

---

## v0.28.0 — Results UI polish, SmartVOC filters & NavigationFlow fixes (2026-03-17)

### backend
- Feat: SmartVOC scores (CSAT, CES, CV, NPS, NEV) now include `participantId` for frontend demographic filtering.

### research-frontend
- Feat: SmartVOC Results — Filters panel now functional (same as Cognitive Tasks): demographic checkboxes and User ID filter all metrics in real time.
- Feat: MetricCard charts (CSAT, CES, CV) react to Today/Week/Month toggle — previously always showed monthly data.
- Fix: Removed "New data obtained" banner from Filters.
- Fix: Removed duplicate "Copiar todos" / "Descargar CSV" buttons from VOCComments table (kept "Descargar comentarios").
- Fix: Short/Long Text no longer shows hardcoded "Positive" mood.
- Fix: Navigation Flow results — all steps expanded by default (not just step 1).

### participant-frontend
- Fix: Demographics now persist for participants without `?participantId` in URL — previously treated as preview, skipping `validateDemographics` entirely.
- Fix: NavigationFlow — keep imageUrls array aligned with propImages to prevent index mismatch.
- Fix: NavigationFlow — polling safety net for cached images where `onLoad` fires before React ref is ready.
- Fix: NavigationFlow — show red dot feedback for clicks outside hitzone (previously silent).

---

## v0.27.6 — Cognitive Tasks: demographic filters panel (2026-03-17)

### research-frontend
- Feat: Filters sidebar — checkbox filters per demographic type with counts, Show more/less, User ID field, "Update study" banner, Descargar CSV.
- Feat: Cognitive Task Results — main content filters by selected demographics and User ID (responses scoped to matching participants).

---

## v0.27.5 — Cognitive results: demographics, CSV exports, NPS bars (2026-03-17)

### backend
- Feat: GET `/analytics/research/:id/demographics` — returns participant demographic responses for Cognitive Tasks results sidebar and CSV export.

### research-frontend
- Feat: Cognitive Task Results — Navigation Flow shows one step per image with heatmap filtered by imageId; CSV export per question via 3-dot menu.
- Feat: Cognitive Task Results — Linear Scale (3.5) CSV export via 3-dot menu; shared `utils/csvDownload.ts`.
- Feat: Filters (right column) — demographic responses table with max-height 500px scroll and "Descargar CSV" for demographics.
- Feat: VOCComments (Long/Short Text) — table max-height 500px overflow-y-auto; Mood column: "Copiar todos" and "Descargar CSV" buttons.
- Fix: SmartVOC NPS — removed border radius from green/red bars (Progress and Recharts stacked bars) for block-style appearance.

---

## v0.27.4 — Navigation Flow production hardening (2026-03-17)

### participant-frontend
- Fix: Navigation Flow — use `img.decode()` before setting dimensions so hitzones work reliably when images load from cache or cross-origin (avoids 0x0 in some browsers).
- Fix: Navigation Flow — store `containerRect` in state and use it for overlay/click positioning instead of reading `getBoundingClientRect()` during render (avoids layout thrashing and stale values in production).
- Fix: Navigation Flow — add `onError` handler to clear dimensions and show error message when image fails to load, preventing stale hitzone data from previous image.
- i18n: Added `navigationFlow.imageLoadError` (ES/EN) for image load failure message.

---

## v0.27.3 — Quota enforcement stress test (2026-03-17)

### scripts
- New: `scripts/stress-test-quotas.ts` — E2E stress test for atomic quota enforcement. Creates a kiosk research with demographic quotas, fires 10 concurrent participants, and verifies no quota is ever exceeded. Self-registers a temporary user, cleans up after itself.

---

## v0.27.2 — Atomic quota enforcement (2026-03-17)

### backend
- Fix: Replaced two-step quota flow (check → increment) with atomic `tryIncrementQuota` that uses `UPDATE ... WHERE current_count < quota_limit` inside a transaction, eliminating the race condition where concurrent participants could exceed quota limits.
- `checkQuotaAvailability` and `incrementQuota` marked as `@deprecated`.

### participant-frontend
- Chore: `validateDemographics` now sends `participantId` so the backend can perform the atomic check-and-increment in a single transaction.

---

## v0.27.1 — Navigation Flow hitzone fix & CPV display (2026-03-17)

### participant-frontend
- Fix: Navigation Flow — replaced LazyImage with a plain `<img>` since the component is fullscreen and IntersectionObserver caused a race condition where hitzones never activated in Opera and DuckDuckGo.
- Fix: Navigation Flow — added fallback hitzone computation from the img ref when React state hasn't caught up, preventing clicks from being silently ignored.
- Fix: Navigation Flow — replaced fragile heuristic (`looksLikePercent` / `looksLikeRatio`) with direct pixel→percent conversion for hitzone coordinates.
- Fix: CognitiveTaskRenderer — use `??` instead of `||` for hitzone coordinates so a value of `0` is preserved.

### research-frontend
- Fix: CPV card no longer shows `%` — CPV is a ratio (CSAT% / CES%), not a percentage.

---

## v0.27.0 — Module-to-module conditionality (2026-03-16)

### research-frontend
- Feat: Conditionality now supports two sources — demographic response (existing) or study question (new). Researchers can show/hide any module based on a participant's answer to a previous Single Choice or Multiple Choice question.
- `ConditionalityConfig` is a union type with guards `isDemographicCondition()` / `isModuleCondition()`.

### participant-frontend
- Feat: `useNavigation` evaluates module-based conditions reactively. Unanswered source modules default to showing the conditional module.

---

## v0.26.14 — VOCComments CSV download reliability fix (2026-03-16)

### research-frontend
- Fix: VOCComments CSV download — split handleDownloadCSV into sync (Cognitive Tasks) and async (SmartVOC) paths so Cognitive Tasks downloads stay within the browser's user-gesture window. Delayed URL.revokeObjectURL by 200ms, removed display:none from temp anchor, added defensive String() coercion on CSV fields.

---

## v0.26.13 — CustomSelect dropdown direction fix (2026-03-16)

### participant-frontend
- Fix: CustomSelect dropdown now opens upward when there isn't enough space below the trigger, preventing overlap with the "Guardar y continuar" button on demographics fields near the bottom of the screen.

---

## v0.26.12 — Demographics fallback options and label alignment (2026-03-15)

### participant-frontend
- Fix: DemographicsStep renders text input instead of selector when config lacks validValues (legacy researches stored as boolean `true` or `{ enabled: true }` without options). Added FALLBACK_OPTIONS map for all option-based demographics so participants always see a CustomSelect.
- Fix: annualIncome label changed from "Ingreso Anual" / "Annual Income" to "Ingreso Familiar" / "Household Income" to match research-frontend configuration label.

---

## v0.26.11 — Navigation Flow cross-browser fixes (2026-03-15)

### participant-frontend
- Fix: Navigation Flow — reduce click dedupe window from 400ms to 150ms so quick taps are no longer swallowed (all browsers).
- Fix: Navigation Flow — skip placeholder onLoad (1x1 GIF) to prevent imgNatural and renderedRect from being set to incorrect values before the real image loads.
- Fix: Navigation Flow — change touchAction from 'manipulation' to 'none' to fully block browser panning/zooming gestures on the interactive area (Safari, Chrome mobile).
- Fix: Navigation Flow — prevent context menu on long-press (Brave, Opera, Safari mobile).
- Fix: Navigation Flow — reset imgNatural and renderedRect to null on image transition to avoid stale hitzone positioning from the previous image.

---

## v0.26.10 — Navigation Flow advance, CustomSelect dropdown, Long Text CSV (2026-03-12)

### participant-frontend
- Fix: Navigation Flow — getClickableRect falls back to container rect when no img (placeholder, loading, or mock) so taps/clicks advance in Safari, Opera, DuckDuckGo, Chrome, Brave. Non-passive touch listeners for reliable tap handling.
- Fix: CustomSelect dropdown position — use viewport-only coordinates (no scrollY/scrollX) for position:fixed so dropdown aligns in Opera, DuckDuckGo. Download trigger appends link to body before click for browser compatibility.
- Test: NavigationFlow test verifies onComplete when clicking container (fallback rect).

### research-frontend
- Fix: Cognitive Tasks Long Text (e.g. 3.2) — "Descargar comentarios (.csv)" now downloads: VOCComments accepts researchId and cognitiveExportRows; when used from CognitiveTaskResults, CSV is built from module responses and triggerDownload uses appendChild for reliable download.

---

## v0.26.9 — Demographics step: interpret backend config format (2026-03-12)

### participant-frontend
- Fix: DemographicsStep now correctly interprets Research Configuration demographics served by the backend. Backend stores `validValues` (from demographicsMapper); step accepts both backend shape (validValues) and research UI shape (validAges, validCountries, options). Option entries support `name` in addition to value/label. Legacy array or boolean per demographic handled.

---

## v0.26.8 — Demographics defaults, NEV sign, Navigation Flow UX (2026-03-11)

### research-frontend
- Feat: Enabling an option-based demographic (Competencia técnica, gender, educationLevel, etc.) in Research Configuration now injects default validValues so participants always see a selector instead of a free-text input.
- Fix: SmartVOC NEV section shows NEV score with correct Positive/Negative label and color (red when &lt; 0); cluster trends are now data-driven (up/down from cluster value) instead of hardcoded.

### participant-frontend
- Fix: Navigation Flow — title and instructions moved above the image (no overlay) so top hitzones are clickable on mobile, tablet, and desktop.
- Fix: Navigation Flow — pointer and touch events (onPointerUp, onTouchEnd) with click dedupe so taps/clicks register in Opera and all browsers; when no hitzones are configured, whole image is treated as valid so the flow can advance.

---

## v0.26.7 — Thank You Screen: EmotioCX logo (2026-03-11)

### participant-frontend
- Feat: Thank You Screen step now displays EmotioCX logo above title and message. Logo asset in `public/EmotioCX-logo.svg` (from docs); DynamicStep shows it only when module is Thank You Screen, using `import.meta.env.BASE_URL` for dev and production paths.

---

## v0.26.6 — Kiosk transition loop fix (Safari) (2026-03-11)

### participant-frontend
- Fix: Kiosk auto-reset no longer loops in Safari — effect that runs on thank-you was scheduling a new timeout on every run; added `kioskResetScheduledRef` so only one transition timeout is scheduled per thank-you visit, then reset in finally and on effect cleanup.

---

## v0.26.5 — NPS stacked bars at 100% (2026-03-11)

### research-frontend
- Fix: SmartVOC Results NPS — stacked bars (Promoters / Neutrals / Detractors) now display at 100% height. Today/Week chart data use percentages instead of counts; NPSAnalysis normalizes each row so the three segments sum to 100 (fixes rounding and ensures full bar fill).

---

## v0.26.4 — NEV: canonical emotions, normalized keys, Spanish labels only (2026-03-11)

### research-frontend
- Fix: NEV Results — emotional states now use a single canonical list (20 emotions) aligned with participant-frontend EmotionSelector; keys normalized when aggregating so no records are lost (e.g. "Enérgico" / "energico" count together)
- Fix: NEV labels shown only in Spanish; removed mixed English (joy, trust, anger, etc.); clusters use canonical IDs and include all 8 negative emotions (estresado, infeliz, desatendido, apresurado)

### backend
- Fix: NEV calculation — POSITIVE_EMOTIONS and NEGATIVE_EMOTIONS use canonical IDs (lowercase, no accents); added `normalizeEmotionKey` so participant submissions match (e.g. "decepcion" / "Decepción" both count as negative)
- Fix: Emotional states aggregation stores normalized keys so response counts are consistent with frontend

---

## v0.26.3 — Trust Flow: latest-point box in header, tooltip no longer covered (2026-03-11)

### research-frontend
- Fix: Trust Relationship Flow — "Latest point" (NPS/NEV) box moved from chart overlay to header row so Recharts tooltip is not covered when hovering over points (e.g. 15:00)
- Feat: Overlay label now shows the last data point's timestamp (time for Today, date for Week/Month) instead of current time; added "Latest point" label to clarify it is not global average or query time

---

## v0.26.2 — Progress 100% from visible components only (2026-03-11)

### backend
- Fix: Progress and completion rate now use only visible/enabled components — excludes Research Configuration, hidden modules (`config.hidden`), and hidden components; 100% aligns with questions actually shown in the study (e.g. SmartVOC only after removing cognitive block)

---

## v0.26.1 — Status Modal: Change Status (Draft/Active/Completed) (2026-03-11)

### research-frontend
- Feat: Status modal now allows changing between Draft, Active, and Completed — previously only allowed activating
- Feat: Status badge in sidebar uses semantic colors (gray=draft, blue=active, green=completed)
- Fix: Researchers can now return a research to Draft to change participation mode, modules, or configuration

---

## v0.26.0 — SmartVOC Metrics Fixes, Progress Tracking, UI Polish (2026-03-11)

### backend
- Fix: Participant progress tracking now uses `component_id` instead of `question_id` — the modern response endpoint saves to `component_id` while progress was counting `question_id` (always NULL), causing 0% progress and "Por iniciar" status for all participants
- Fix: Total expected responses now computed from module config `components[]` arrays instead of the `questions` table
- Fix: `getParticipantDetails` status/progress now correctly calculated from component-based data
- Fix: Completion rate in overview metrics uses real completed participants count (all components answered)

### research-frontend
- Fix: CPV calculation corrected from `csatPct / cesPct` (ratio) to `csatPct - cesPct` (percentage points) — formula: CSAT positive (4+5) minus CES negative (1+2)
- Fix: CES QuestionCard breakdown was inverted — scores 1+2 labeled "Little effort" (green) and 4+5 "Much effort" (red); now correctly: 4+5 = "Easy" (green), 1+2 = "Difficult" (red)
- Fix: NPS chart in Today/Week views showed individual responses as separate data points; now aggregates scores by day with proper NPS ratio calculation
- Fix: Removed redundant time-range filter inside NPSAnalysis (data arrives pre-filtered from SmartVOCResults)
- Feat: CPVCard redesigned as compact sticky pill at top-left with time range selector — stays visible on scroll
- Feat: NEVQuestionCard now shows percentage labels above each emotion bar
- Feat: NEV clusters displayed side by side (2-column grid) instead of stacked vertically
- Feat: ResearchInProgressContent shows disconnection warning and explanatory note about progress calculation
- Refactor: Simplified publicTestsUrl to prioritize runtime-config.json participantBaseUrl

---

## v0.25.2 — NEV: All Emotions, Cluster Tooltip (2026-03-11)
## v0.25.3 — VOC Comments CSV Export (2026-03-11)

### research-frontend
- Feat: Added button to export all Voice of Customer (VOC) comments to CSV in SmartVOC Results. CSV includes participant_id, demographic data, and all SmartVOC responses for participants who left comments.

### research-frontend
- Feat: NEVQuestionCard now displays all 20 emotions (positive and negative), even if not selected, with a max bar percent of 50% (each emotion can reach up to 5% if distributed equally).
- Feat: Added tooltip to NEV clusters explaining the meaning of up/down arrows and the period (day/week/month) according to the selected time range.
# CHANGELOG

> **533 commits** | **Nov 20 2025 → Feb 17 2026** | Monorepo: research-frontend (196 files) · participant-frontend (67 files) · backend (60 files)

---

## v0.25.1 — TrustFlowChart: Week View as Bar Chart (2026-03-11)

### research-frontend
- Feat: TrustFlowChart "Last week" view now renders as a BarChart (7 grouped bars for NPS/NEV) instead of a LineChart — each bar represents the average ratio for a 24h interval
- Feat: Week view X-axis labels show weekday names (Mon, Tue, Wed…) instead of dates
- Today (intraday lines) and Month (daily lines) views remain unchanged

---

## v0.25.0 — SmartVOC Filters: Time Range Across All Panels (2026-03-11)

### backend
- Feat: Score arrays (`csatScores`, `cesScores`, `cvScores`, `npsScores`) now include timestamps (`{value, date}`) — enables frontend time-range filtering
- Feat: New `npsScores` field in metrics response (previously only aggregate counts were returned)
- Feat: New `nevResponsesData` field with per-response emotions + timestamp for NEV time filtering

### research-frontend
- Feat: Time range filter (Today/Week/Month) now affects all 5 SmartVOC panels — previously only TrustFlowChart and NPSAnalysis were filtered
- Feat: CPVCard value recalculated from filtered CSAT/CES scores per time range
- Feat: MetricCards (CSAT/CES/CV) scores recalculated from filtered data
- Feat: QuestionCards breakdown percentages and response counts reflect selected time range
- Feat: NEVQuestionCard emotional states, clusters, and percentages filtered by time range
- Feat: VOCComments filtered to show only comments within selected time range
- Refactor: Centralized `filterByTimeRange()` helper and `filtered` useMemo in SmartVOCResults — single source of truth for time-filtered data
- Types: Added `TimestampedScore`, updated `SmartVOCMetrics` and `SmartVOCAnalytics` interfaces
- Updated `hasScores()` utility to accept both `number[]` and `{value}[]` arrays

---

## v0.24.0 — SmartVOC Analytics: Real Metrics (2026-03-11)

### backend
- Feat: `generateTimeSeriesData` now computes all metrics per day (NPS, NEV, CSAT, CES, CV, CPV) — previously NEV was hardcoded to 0 and only NPS was calculated
- Feat: Time series expanded from 7 to 30 days to support all frontend time range filters (today/week/month)
- Feat: New `generateMonthlyMetricsData` produces 6-month monthly breakdowns for CSAT (satisfied/dissatisfied), CES (positive/negative), CV (positive/negative), and CPV — consumed by MetricCard charts
- Fix: `generateMonthlyNPSData` used hardcoded year `2024` — now uses actual year from response dates
- Refactor: Extracted shared helpers (`POSITIVE_EMOTIONS`, `parseScoreValue`, `extractScores`, `calculateNPSFromScores`, `calculateNEVFromResponses`, `calculateCSATPercentage`, `calculateCESPercentage`) eliminating duplicated logic
- Refactor: Removed unused `modulesQuery`/`modulesResult` and unnecessary `async`/`researchId` params from helper functions
- Return type of `getSmartVOCResults` now includes `monthlyMetricsData` (auto-broadcast via SSE)

### research-frontend
- Feat: MetricCard (CSAT/CES/CV) mini-charts now render real monthly satisfied/dissatisfied data from `monthlyMetricsData` — previously used hardcoded empty `defaultData`
- Feat: CPVCard generates dynamic SVG curve from real CPV monthly data with auto-positioned peak label — previously used static SVG path and hardcoded "83,62" label
- Feat: TrustFlowChart NEV line now displays real data (backend fix) and Y-axis corrected from arbitrary 0-12k scale to -100/+100 range matching NPS/NEV percentages
- Feat: NPSAnalysis Loyalty Evolution now calculates real month-over-month NPS delta — previously hardcoded "+16% Since last month"
- Feat: NEVQuestionCard clusters now computed from real emotional states grouped by category (Advocacy, Recommendation, Engagement, Destroying) — previously used mock values
- Refactor: Updated `SmartVOCResults`, `SmartVOCAnalytics`, and `SmartVOCTimeSeriesData` types to include new backend fields (`monthlyMetricsData`, `csat`, `ces`, `cv`, `cpv` in time series)
- Cleanup: Removed unused `hasData` prop and `defaultData` constant from MetricCard

---

## v0.23.3 — Memory Leak Fixes (2026-03-11)

### participant-frontend
- Fix: Browser freezing after multiple participant sessions — React Query cache (`gcTime` 10min→2min), MediaService URL cache, and session store interactions accumulated without cleanup between participants
- Fix: `useSessionTimer` effect re-running on every render due to unstable store deps — stabilized with `useRef` + empty deps to prevent event listener and interval accumulation
- Fix: Session store `interactions[]` not cleared on `startSession()` — now resets to empty array
- Fix: Added `mediaService.clearCache()` + `queryClient.clear()` on all session reset paths (participant change, kiosk auto-reset, manual restart)

---

## v0.23.2 — SmartVOC Auto-Advance Fix (2026-03-11)

### participant-frontend
- Fix: SmartVOC scale steps (CSAT, NPS, CES, CV) getting stuck — `onComplete` reference changes caused the auto-advance timer to be canceled via effect cleanup, while the `autoAdvanceFired` guard prevented re-scheduling. Solved by storing `onComplete` in a ref so the effect only depends on `scaleValue`.
- Fix: NPS scale value 0 not registering — `(value as number) || null` treated `0` as falsy. Now uses explicit `typeof` check to preserve zero as a valid selection.

---

## v0.23.1 — Navigation Flow Cross-Browser Fixes (2026-03-11)

### participant-frontend
- Fix: iOS Safari tap highlight (blue/gray flash) — added `-webkit-tap-highlight-color: transparent`
- Fix: iOS Safari long-press context menu on images — added `-webkit-touch-callout: none`
- Fix: Desktop image drag interrupting clicks (Chrome/Edge/Opera) — added `draggable={false}` + `pointer-events-none` on image
- Fix: 300ms touch delay on mobile — added `touch-action: manipulation`
- Fix: Accidental text selection on long-press — added `select-none` on clickable area
- Fix: iPhone X+ notch/home indicator overlapping fullscreen overlay — added `env(safe-area-inset-*)` padding

---

## v0.23.0 — Panel Email Invitations (2026-03-11)

### backend
- New `email` module with Nodemailer transport configured for cPanel SMTP (Exim)
- HTML invitation email template with EmotioX branding, participant name greeting, and participation button/link
- New endpoints for sending invitation emails (authenticated, panel-mode only):
  - `POST /participants/:researchId/send-emails` — bulk send to all pending participants with email, returns `{ sent, failed, results }`
  - `POST /participants/:researchId/:id/send-email` — send to a single participant (for resends/retries)
- Both endpoints validate `participationMode === 'panel'` before sending (returns 400 for kiosk)
- `invited_at` timestamp updated on successful send
- SMTP env variables: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`

### research-frontend
- "Send invitations" button in PanelParticipantsSection — bulk sends to all pending participants with email
- Confirmation dialog before bulk send showing count of recipients
- Per-row resend button (mail icon) for individual participants with email
- New "Invited" column in participants table showing last invitation date
- `researchName` prop threaded from ResearchBuilderPage → ResearchConfigurationModule → PanelParticipantsSection

### pending
- Create `noreply@emotio.cx` email account in cPanel and configure SMTP credentials in production `.env`

---

## v0.22.0 — Panel Participants: CSV Import, Links & Status Tracking (2026-03-11)

### database
- New migration `015_create_participants.sql`: `participants` table with fields for email, name, external_id, status tracking, and unique constraint on (research_id, participant_id)

### backend
- New `participants` module (service + controller) with authenticated endpoints:
  - `GET /participants/:researchId` — list all participants for a research
  - `POST /participants/:researchId/import` — import participants from CSV text (flexible column mapping: email/name/externalId, supports `,` and `;` delimiters)
  - `DELETE /participants/:researchId/:id` — delete single participant
  - `DELETE /participants/:researchId` — delete all participants
- Participant IDs auto-generated as `panel-N` (incremental per research), or uses `externalId` from CSV if provided
- Duplicate detection by email within same research (skipped on import)
- Auto-status tracking: `saveParticipantResponses()` now updates `participants.status` to `'responded'` when responses are saved (non-blocking, backwards-compatible)

### research-frontend
- New `PanelParticipantsSection` component in Research Configuration (visible only in Panel mode):
  - CSV import button with flexible column detection (email, name, externalId — all optional)
  - Participants table with status badges (pending/responded/disqualified/overquota)
  - Copy individual participant link (`?participantId=panel-N`)
  - Copy all links (CSV format to clipboard)
  - Export participants + links as downloadable CSV
  - Delete individual or all participants
  - Stats summary (pending/responded counts)
- New `participants.service.ts` frontend service for API communication

---

## v0.21.0 — Participation Modes: Kiosk vs Panel — Phases 1, 2 & 3 (2026-03-11)

### participant-frontend (Phase 3)
- Kiosk mode: participant-frontend detects participation mode on load via `GET /public/research/:id/mode`
- Kiosk URLs work without `?participantId` — backend auto-assigns incremental IDs (`kiosk-1`, `kiosk-2`, ...)
- `usePreviewMode` hook updated: kiosk mode (no URL participantId) is NOT preview, explicit `?preview=true` always forces preview
- After completing a kiosk survey, a 4-second transition screen shows ("Preparing next participant...") then auto-resets to Welcome
- Reset clears all responses, requests a new kiosk session ID, and navigates to Welcome — SPA reset without page reload
- Kiosk auto-reset uses a dedicated `useEffect` watching `currentStep` (not `handleNext`) since thank-you screen has no button
- Fresh kiosk session always requested on page load to handle stale localStorage from different researches
- `participationMode` persisted in Zustand store (`useParticipantStore`) with localStorage persistence
- Added `getParticipationMode()` and `requestKioskSession()` to `publicService` using service discovery endpoints
- Panel mode and existing researches (no mode set) behave exactly as before — zero retrocompatibility impact
- Added kiosk i18n strings (ES/EN) for transition screen
- Backend config controller updated with `participationMode` and `kioskSession` endpoint discovery

### research-frontend (Phase 2)
- Added participation mode selector (Kiosk / Panel radio cards) in Research Configuration, above demographics
- Kiosk mode hides demographic questions section and disqualification/overquota backlinks
- Panel mode shows all sections as before (retrocompatible)
- Mode selector disabled when research is active (only editable in draft)
- URL helper text adapts to selected mode (kiosk: shared device hint, panel: participantId hint)
- `participationMode` persisted in module config via existing componentValues pipeline

### backend
- Added `ParticipationMode` type (`'kiosk' | 'panel'`) and `getParticipationMode()` service method
- New public endpoint `GET /public/research/:id/mode` returns the participation mode for a research (defaults to `'panel'` for retrocompatibility)
- New public endpoint `POST /public/research/:id/kiosk/session` generates incremental participant IDs (`kiosk-1`, `kiosk-2`, ...) for kiosk-mode researches
- Kiosk session generation uses MySQL transaction with `FOR UPDATE` to prevent race conditions between simultaneous tablets
- Validates research is active and configured in kiosk mode before generating session IDs
- No changes needed to `saveParticipantResponses()` — existing validation accepts kiosk IDs natively

---

## v0.20.3 — Research Configuration quality fixes (2026-03-11)

### research-frontend
- Debounced backlink URL validation (300ms) to avoid per-keystroke validation overhead
- Participant limit input now shows warning toast on invalid values instead of silently falling back to 50
- Replaced fragile `||` chain in quota conversion with `DEMOGRAPHIC_QUOTA_FIELD` lookup map
- Converted demographic row from `<div onClick>` to native `<button>` for keyboard accessibility
- Removed redundant `handleLabelClick` handler (parent button handles the same logic)
- Extracted `demographicLabel` variable to eliminate nested ternary in JSX
- Added `aria-label` attributes to all section toggles, demographic checkboxes, and link config checkboxes
- Removed duplicate `{/* QR Code Modal */}` comment
- Wrapped `backlinks` derivation in `useMemo` to stabilize `useCallback` dependencies
- Used `Number.parseInt` / `Number.isNaN` over global equivalents

---

## v0.20.2 — Navigation Flow UX improvements (2026-03-09)

- Changed cursor from crosshair to pointer for better click affordance
- Last image in flow now treats entire image as hitzone — any click completes the flow
- Reduced advance delay from 500ms to 200ms for snappier image progression
- Removed incorrect click red dots ("christmas tree" effect) — only correct clicks show green feedback
- Incorrect clicks still tracked in analytics data (clickSequence) for research purposes
- Deployed via CI/CD (GitHub Actions → cPanel)

---

## Deploy — v0.17.0 → v0.20.1 shipped to production (2026-03-09)

- Full production deploy of backend, research-frontend, and participant-frontend to cPanel
- All versions from v0.17.0 through v0.20.1 deployed in a single batch
- All 3 endpoints verified healthy (HTTP 200)
- Documented repeatable construction patterns in `/patterns/` (frontend, backend, devops, fullstack)

---

## v0.20.1 — Participant SmartVOC auto-advance fix (2026-03-06)

- Fixed `participant-frontend` SmartVOC scale flow where selecting a number sometimes did not advance to the next step
- Root cause: the internal `autoAdvanceFired` guard in `SmartVOCRenderer` was not resetting when the module changed, so after one scale question advanced, the next one could get stuck
- Fix: reset the auto-advance guard on `module.id` change so each SmartVOC scale module (`CSAT`, `NPS`, `CES`, `CV`) can advance independently after selection
- NEV now enforces the number of selectable emotions based on the instruction/description text coming from backend
- Supported instruction semantics: exact selection (`Selecciona 3`, `Selecciona tres`) vs maximum selection (`Hasta 3`, `Máximo 3`, `No más de 3`)
- Added parser support for numeric digits and number words in Spanish/English, plus participant-side validation for exact/max NEV emotion rules
- Unified the cPanel SSH alias in the local connection helper script to `cpanel-emotio` so it matches the deploy scripts used for frontend deployments

## v0.20.0 — Real-time SmartVOC Results (2026-03-06)

- SmartVOC results now update in real-time via Server-Sent Events (SSE) — no polling
- Backend broadcasts fresh SmartVOC analytics via SSE immediately after a participant submits a SmartVOC response (CSAT, NPS, CES, CV, NEV, VOC)
- `useSmartVOCAnalytics` hook connects to existing SSE endpoint (`/monitor/events/:researchId`) and listens for `smartvoc-update` events
- Initial data still fetched via REST on mount; subsequent updates are pure push from database save → SSE broadcast → UI render
- Added `isLive` state to hook for real-time connection status indicator
- Flow: participant submits → backend COMMIT → `getSmartVOCResults()` → `broadcastToResearch('smartvoc-update', results)` → research-frontend `setData()`
- Fixed preview mode storing previous responses: `clearAllResponses()` now called on preview entry so researchers always see a clean survey
- Fixed Navigation Flow hitzone misalignment on Safari: `object-contain` letterboxing caused `getBoundingClientRect()` to return the element rect instead of the rendered image area; added `getRenderedImageRect()` to compute the actual visible image bounds and used it for both click detection and overlay positioning

## v0.19.6 — Fullscreen Navigation Flow (2026-03-05)

- Navigation Flow now renders fullscreen (fixed, inset-0) with black background — image takes 100% of viewport on both PC and mobile
- Title, description, and progress bar float as a gradient overlay at the top
- Language selector and preview banner remain visible (already fixed/z-50)
- Removed image filename from progress overlay (only shows "Image X of Y")
- Completion overlay adapted to dark theme

## v0.19.5 — SmartVOC auto-advance & Research URL fix (2026-03-05)

- SmartVOC scale modules (CSAT, NPS, CES, CV) now auto-advance 500ms after selection — no button shown (quick-response UX)
- Cognitive task modules (Single Choice, Multiple Choice, Linear Scale, Preference Test) keep the blue "Guardar y continuar" footer button (take-your-time UX)
- NEV and VOC keep the footer button (require explicit confirmation)
- Removed all remaining internal purple "Continue" buttons from LinearScaleQuestion, ChoiceQuestion, PreferenceTest, and SmartVOCRenderer
- Cleaned up unused `onComplete` prop from ChoiceQuestion, LinearScaleQuestion, and PreferenceTest interfaces
- Fixed Research URL in Research Configuration: field, copy button, and QR code now show the public participant URL (without `?preview=true`); only the "Link Preview" button adds the preview parameter

## v0.19.4 — Unified footer button, custom dropdowns & lightbox UX (2026-03-05)

- Removed ALL internal purple "Continue" buttons — Single Choice, Multiple Choice, Linear Scale, NEV, VOC, Preference Test now use the parent "Guardar y continuar" footer button exclusively
- Removed "Seleccionado: filename" text from PreferenceTest (redundant with visual checkmark on selected image)
- Added `CustomSelect` component to participant-frontend (ported from research-frontend) — replaces native `<select>` in Demographics to avoid dark OS popover on iOS/Safari
- PreferenceTest lightbox closes on backdrop click (without drag) and Escape key
- Fixed mobile hamburger menu overlapping with preview mode banner

## v0.19.2 — PreferenceTest & CognitiveTaskRenderer cleanup (2026-03-05)

- PreferenceTest now renders title and description from module config
- Replaced auto-advance (`setTimeout 500ms`) with explicit "Continue" button in PreferenceTest
- Added "Select this image" button inside PreferenceTest zoom lightbox
- Extracted 5 hardcoded Spanish strings to i18n (`preferenceTest.*` keys in es.json + en.json)
- Removed debug/mock text visible in production
- Removed 3 redundant hardcoded hint texts from CognitiveTaskRenderer (LinearScale, SingleChoice, PreferenceTest)
- ChoiceQuestion now receives `onComplete` for both single and multiple choice

## v0.19.0 — Participant UX: explicit Continue buttons (2026-03-04)

- Replaced auto-advance (`setTimeout 500ms`) with explicit "Continue" button across all participant steps
- Affects: ChoiceQuestion (single/multiple), LinearScaleQuestion, SmartVOC (NPS, CSAT, CES, CV, NEV)
- Button appears only after participant makes a selection
- Removed unused `onComplete` prop from ScaleSelector, StarSelector, EmotionSelector
- NavigationFlow now renders title and description; removed instruction box
- Added `common.continue` translation key (ES: "Continuar", EN: "Continue")

## v0.18.1 — Participant vendor chunk fix (2026-03-04)

- Fixed `manualChunks` in participant-frontend Vite config that caused React crash in production
- Root cause: `id.includes('react')` was capturing all react-* libraries (router, i18next, window, turnstile) into `react-vendor` chunk, while `scheduler` (react-dom dependency) fell into generic `vendor` chunk, breaking initialization order
- Fix: specific library matches run before generic React match; core React uses exact path matching (`/react/`, `/react-dom/`, `/scheduler/`) to keep only essential modules together

## v0.18.0 — Participant i18n (2026-03-04)

- Internationalization for participant-frontend using `react-i18next` + `i18next`
- Language selector (🌐 ES/EN) fixed top-right, visible on all pages
- ~90 strings extracted from 22 files into `es.json` and `en.json` translation files
- Language preference persisted in localStorage (`emotiox-lang` key)
- Spanish as default language, English as secondary
- Participant chooses their language (not the researcher)
- Covers: Welcome, Demographics, SmartVOC, Cognitive Tasks, Eye Tracking, Thank You, error screens
- Demographics labels fully translated (Edad/Age, País/Country, Género/Gender, etc.)

## v0.17.0 — Location Granularity (2026-03-04)

- `LocationGranularity` type simplified to `'countryOnly' | 'countryCity'` across all 3 sub-projects
- Researcher picks "Solo país" or "País + Ciudad" in `CountryConfigModal`
- `DemographicsStep` shows a free-text city input when granularity is `countryCity`
- Removed `chile-geography.ts` from both frontends (no longer needed)
- Removed hardcoded Chile region/commune logic from backend `quota.service.ts`
- All 3 sub-projects pass type-check and lint with 0 errors

---

## Current State Summary (as of 2026-02-17)

### research-frontend (https://emotio.cx/research)
- **Dashboard**: Research list with status, type, technique, participant count. Skeleton loader.
- **Research Builder**: Multi-stage editor (Welcome Screen → Research Configuration → Smart VOC → Cognitive Tasks → Thank You). Save Changes per stage. Module reordering for Smart VOC.
- **Research Configuration**: Participant limit, backlinks, demographics with quotas (Age Range, Gender, etc.), QR code generation, link preview.
- **Smart VOC Modules**: NPS (0-10 scale), CSAT (star rating), CES, CV, NEV (20 emotions), VOC (open text). Each with question title, description, and specific configuration. Visual focus and clickable navigation between modules.
- **Cognitive Task Modules**: Short Text, Long Text, Single Choice (option-list + eligibility), Multiple Choice (checkbox-list + eligibility), Linear Scale, Ranking (ranking-list with add/remove items), Navigation Flow (file upload + hitzones), Preference Test (file upload + A/B comparison).
- **Module Editors**: RadioChoicesEditor for Single/Multiple Choice with dynamic add/remove and min 2 enforcement. RankingItemsEditor for Ranking with numbered inputs and min 2 enforcement. FileUploadEditorComponent (standalone) with hitzone editor for Navigation Flow. All editors extracted as standalone components to prevent re-mount on sibling state changes.
- **Results**: SmartVOC results (TrustFlowChart, CPVCard, QuestionCards for CSAT/CES/CV, NEV card, NPS component, VOC component). Cognitive Task results (Choice, LinearScale, Ranking with segmented bar chart, Navigation Flow with heat/click map tabs and hitzone overlay, Preference Test with image rendering).
- **Auth**: Google OAuth login. Session persistence with 24h tokens and auto-refresh.
- **Deployment**: Build locally → rsync to cPanel ~/public_html/research via SSH. Aggressive cache busting for HTML/JSON, immutable hashes for assets. GitHub Actions workflow available.

### participant-frontend (https://emotio.cx/participant)
- **Research Flow**: Welcome Screen → Smart VOC modules → Cognitive Tasks → Thank You Screen. Step-by-step navigation with validation.
- **Smart VOC Renderers**: ScaleSelector (NPS, CES, CV), StarSelector (CSAT), EmotionSelector (NEV with 20 emotions), VOC open text. Auto-advance for SingleChoice. Validation per module type including edge cases (0 values, emotions arrays).
- **Cognitive Task Renderers**: TextQuestion (Short/Long Text with key prop to prevent state sharing), ChoiceSelector (Single/Multiple), LinearScale (slider variant), Ranking (vertical drag reordering), Navigation Flow (iframe + hitzone click detection), Preference Test (A/B image selection).
- **Data Collection**: Location, device, session metadata. Demographic quotas enforcement.
- **Response Submission**: Real-time capture, unified store (Zustand), flush on completion.
- **Preview Mode**: Draft research preview allowed for researchers.
- **DevSidebar**: Module navigation grouped by stage, responsive with burger menu on mobile.
- **Eye Tracking**: Webcam-based gaze estimation with MediaPipe Face Landmarker + Ridge Regression. 9-point calibration (15 frames/point), real-time tracking with lerp smoothing. Standalone test page at `/eye-tracking-test`.
- **i18n**: Spanish (default) + English via react-i18next. Language selector visible on all pages. ~90 translated strings. Persisted in localStorage.
- **Security**: Turnstile disabled for cPanel environment.
- **Deployment**: Build locally → rsync to cPanel ~/public_html/participant. GitHub Actions workflow available.

### backend (https://emotio.cx/api)
- **Database**: MySQL on cPanel (emotvehe_emotiox). Auto-converts PostgreSQL syntax to MySQL ($1→?, ::jsonb removal, JSON_BUILD_OBJECT→JSON_OBJECT, etc.). Environment-aware routing with dev_ table prefixes.
- **Auth**: Local JWT authentication (24h access, 7d refresh). Google OAuth with automatic user registration. No AWS Cognito dependency.
- **API Modules**: research, modules, module-templates, questions, responses, stage-templates, research-types, research-techniques, analytics, media, enterprises, users, quotas, monitor, public, debug, cache, config.
- **Media**: Local file storage on cPanel (~/emotioxv3/media). Upload-direct endpoint for multipart. Static file serving at /api/media for Cognitive Tasks images. Presigned URL fallback for S3 compatibility. Frontend resolves relative media URLs against backend origin for cross-origin compatibility.
- **Analytics**: Ranking responses aggregation (mean position). SmartVOC and Cognitive Task analytics endpoints.
- **Monitoring**: SSE-based real-time monitoring (migrated from WebSocket for cPanel compatibility).
- **Seeds**: Module templates for all Smart VOC and Cognitive Task types. Research types and techniques. Stage templates.
- **Deployment**: Express app on cPanel via Passenger (Node.js 24.12.0). SSH deploy scripts available. GitHub Actions workflow available.

### Known Issues / Technical Debt
- SSH key to cPanel requires passphrase (`sshpass` used in deploy scripts)
- Service worker registration disabled to prevent caching issues
- Some Spanish text remaining in code comments and variable names (research-frontend + backend)
- DB migration pending: `remove_image_upload_from_modules.ts` (clean up image-upload from existing modules)

---

## [0.17.0] Eye-tracking con webcam — calibración + rastreo de mirada — 2026-02-21

### participant-frontend
- **New feature**: Webcam-based eye-tracking system with calibration and gaze estimation
- Added standalone test page at `/eye-tracking-test` with state machine: permission → calibrating → tracking → done
- **MediaPipe Face Landmarker** integration for real-time 478-landmark facial detection (WASM + CDN model loading)
- **Ridge Regression** engine (`ridgeRegression.ts`): pure matrix algebra (transpose, multiply, Gauss-Jordan inverse), maps iris features to screen coordinates
- **Rich feature extraction**: relative iris position within eye (using eye corner landmarks as reference, invariant to head position), head pose (nose tip), polynomial cross-terms (14 features total)
- **Multi-frame calibration**: 9-point calibration grid, collects 15 frames per point with averaged features for noise reduction
- **Calibration UI**: fullscreen white screen with animated red dot, progress ring animation during frame collection, progress bar
- **Tracking UI**: fullscreen dark overlay with webcam feed and green gaze indicator dot with lerp smoothing
- `useWebcam` hook: camera access lifecycle (start/stop), stream management, cleanup on unmount
- `useEyeTracking` hook: orchestrates FaceLandmarker init, calibration state machine, frame collection with setInterval, gaze prediction loop via requestAnimationFrame
- Added `@mediapipe/tasks-vision` dependency; Vite configured with `optimizeDeps.exclude` for WASM compatibility

---

## [0.16.0] Conditionality config persistence & participant-side filtering — 2026-02-21

### research-frontend
- `ConditionalityModal` now fully functional: saves `conditionalityConfig` (demographicKey + demographicValue) to module config
- Added `onSave`/`initialConfig` props to modal; re-opening the modal restores the saved condition
- Save button disabled until both question and answer are selected
- SmartVOC and CognitiveTask cards expose `getConditionalityConfig()` via imperative ref
- Visual indicator below toggle shows configured condition (e.g. "Condition: Show if age = 18-24") with click to re-edit
- Toggling conditionality OFF clears the config; closing modal without saving reverts toggle only if no config was previously set
- `ResearchBuilderPage.handleSaveModule` persists `conditionalityConfig` alongside `conditionality` flag to backend
- Added `ConditionalityConfig` interface, `getModuleConditionalityConfig` and `withModuleConditionalityConfig` helpers in `moduleRequired.ts`

### participant-frontend
- **Conditionality filtering**: `useNavigation` skips modules whose condition is not met based on participant's demographic responses
- Modules with conditions are shown by default until demographics are answered, then re-evaluated
- `demographicResponses` read reactively from Zustand store (re-filters navigation on demographic change)
- **DemographicsStep revamp**: title changed from "Information" to "Demographics", removed internal border/shadow and "Continue" button
- Demographic fields now use configured options from Research Configuration (validAges for age ranges, options for gender/education/etc., validCountries for country)
- Server-side demographic validation (quota/disqualification) moved to `ResearchPage.handleNext` for the demographics step

## [0.15.0] Conditionality toggle & modal for Cognitive Task and Smart VOC — 2026-02-21

### research-frontend
- Added "Show conditionality" toggle to Cognitive Task and Smart VOC module cards (alongside existing Required and Hide toggles)
- Added `ConditionalityModal` component with condition configuration UI: action selector (Show), question selector, answer selector, and optional-target warning banner
- Modal opens automatically when toggle is activated; closing the modal (X, overlay click, or Escape) deactivates the toggle
- Added `getModuleConditionality` / `withModuleConditionality` utility functions in `moduleRequired.ts`
- Conditionality flag persisted to `module.config.conditionality` on save
- ConditionalityModal identifies the source module by name

---

## [0.14.1] Fix preview mode: step reset & sidebar visibility — 2026-02-17

### participant-frontend
- Fixed preview mode showing last visited step instead of first: added `isPreviewMode` condition to always reset `currentStep` to the first available step when `?preview=true`
- Fixed DevSidebar not visible in production for preview mode: changed render condition from `isDev` to `isDev || isPreviewMode` so researchers can navigate between modules

---

## [0.14.0] Technical Debt Resolution — 2026-02-17

### research-frontend
- Eliminated all ~42 ESLint warnings (0 errors, 0 warnings)
- Created typed interfaces replacing `any`: `ModuleTemplateRef`, `BackendQuota`, `ModuleComponent`, `ModuleConfigStructure`, `HitzoneRegion`, `UploadedFileData`
- Added `syncRankingConfig` helper to sync `rankingConfig.items` from `comp.value` on every save (Smart VOC, Cognitive Tasks, active module)
- Inlined `buildParticipantShareUrl` into useMemo, removed dead helper functions
- Fixed `ResearchBuilderSidebar` useEffect dependency alignment
- Removed unused catch variables, destructured props, and obsolete eslint-disable directives
- Removed `image-upload` component from all 6 Cognitive Task seed templates

### participant-frontend
- Eliminated all ~8 ESLint warnings (0 errors, 0 warnings)
- Replaced `as any` casts with proper types in `DemographicsStep.tsx` and test file
- Added `backlinks.complete` to useCallback dependency in `ResearchPage.tsx`
- Replaced `delete (window as any).location` with `Object.defineProperty` in tests

### backend
- Created DB migration script `remove_image_upload_from_modules.ts` for cleaning existing modules

---

## [0.13.0] Results Visualization & Module Editors — 2026-01-28 to 2026-02-17

### research-frontend
- Added image rendering in Preference Test results
- Added HitZones overlay and click correctness visualization in Navigation Flow results
- Added tab navigation with Heat Click Map, Click Map, and Image views in Navigation Flow results
- Added functional Ranking builder with numbered item inputs
- Added dynamic add/remove choices for Multiple Choice module editor
- Added checkbox-list/option-list type support with choice fallback parsing
- Added draft research preview capability
- Extracted RankingItemsEditor as standalone component (fixed React anti-pattern of inline component definition)
- Extracted FileUploadEditorComponent as standalone component (fixed same anti-pattern causing file-upload re-mount on every sibling keystroke)
- Added `ranking-list` to ComponentType union and EditableComponent switch
- Unsupported component types (e.g. image-upload) now silently return null instead of showing error message
- Fixed module Hide auto-override: save now uses researcher's explicit Hide toggle instead of auto-computing `hidden` based on whether module has values (was locking unconfigured modules after save)
- Fixed Hide toggle only visible on localhost — now visible in all environments
- Fixed media URL resolution: `resolveMediaUrl()` in media.service.ts converts relative backend URLs to absolute (enables cross-origin media loading from localhost dev)
- Fixed upload URL resolution: `generateUploadUrl` result now resolved to absolute URL
- Fixed URL preview race condition in Research Configuration
- Fixed CognitiveTask null-safety across results wrappers
- Fixed vite.svg 404 by replacing missing favicon with inline empty icon
- Fixed Multiple Choice choices reset on React Query background refetch (prevContentKey initialization)
- Fixed RadioChoicesEditor delete button disabled when only 2 choices remain
- Fixed quota sync and backlink URL normalization in Research Configuration
- Fixed participantLimit persistence (saved as {enabled, value} for backend)

### participant-frontend
- Added checkbox-list/option-list support in renderers
- Fixed media URL resolution: `resolveMediaUrl()` in media.service.ts converts relative backend URLs to absolute (enables cross-origin image loading from localhost dev for Navigation Flow / Preference Test)
- Fixed config service initialization in dev mode: tries `/runtime-config.json` first (Vite serves `public/` at root), then `/participant/runtime-config.json`, with fallback to `https://emotio.cx/api`
- Fixed sync-runtime-config script: updated default URL from CloudFront (AWS) to `https://emotio.cx/participant`
- Fixed default API base URL from `localhost:3000` to `https://emotio.cx/api` (no local backend)
- Removed stale "AWS backend" text from bootstrap error screen
- Fixed backlinks delivery and demographics persistence
- Fixed vite.svg 404 with inline empty favicon

### backend
- Added DB migration script (fix_ranking_module_config_mysql.ts) to update 24 existing Ranking modules with correct `ranking-list` structure
- Fixed Ranking module config in production DB: replaced image-upload with question-description component for consistency with other modules
- Fixed hidden=true on Navigation Flow/Preference Test modules set by auto-compute logic
- Fixed dotenv path in migration script (../../.env → ../.env for cPanel)
- Fixed quota sync endpoints

---

## [0.12.0] Migration to cPanel & MySQL — 2026-01-18 to 2026-01-25

### backend
- Replaced AWS Cognito with local JWT authentication (bcrypt + jsonwebtoken)
- Implemented PostgreSQL-to-MySQL auto-conversion layer (convertPgToMysql) handling: $N→? placeholders, type casts removal, ILIKE→LIKE, JSON function mapping, column name remapping
- Added environment-aware database routing with dev_ table prefixes based on request origin
- Added upload-direct endpoint for multipart file uploads (replacing S3 presigned URLs)
- Added static file serving for media files stored on cPanel disk
- Migrated real-time monitoring from WebSocket to SSE for cPanel compatibility
- Added Welcome/Thank You screen creation endpoint for existing researches
- Added mod_security disable for API directory (.htaccess) to prevent URL filtering
- Fixed MySQL column compatibility: settings→config, user_id→created_by, stage_type→type
- Fixed PostgreSQL json_agg FILTER to MySQL JSON_ARRAYAGG subquery conversion
- Fixed auth: password_hash update for existing users, JSON metadata parsing from MySQL
- Fixed media endpoint: s3_key/media_path compatibility layer
- Removed backend-graphql service (replaced by REST)
- Removed all AWS dependencies for runtime (Cognito, S3 upload, SSM)

### research-frontend
- Updated API client configuration for cPanel backend
- Added Welcome/Thank You screen auto-addition for new researches
- Fixed duplicate Welcome/Thank You prevention (stage name check, React StrictMode)
- Fixed OAuth callback routing for local development
- Migrated monitoring from WebSocket to SSE
- Standardized padding across SmartVOC and CognitiveTask module cards
- Cleaned up Research Configuration UI labels
- Limited Welcome Screen input widths and disabled textarea resize

### participant-frontend
- Completely disabled Turnstile verification for cPanel environment
- Fixed runtime-config.json path for /participant/ base
- Moved build time injection to buildEnd hook
- Fixed navigation skip for virtual welcome step when not configured
- Added ranking-list format support with items extraction from multiple component types

### infrastructure
- Added GitHub Actions workflows for cPanel deployments (backend, research-frontend, participant-frontend)
- Added SSH port support in deployment workflows
- Migrated CI from PostgreSQL to MySQL
- Improved deploy scripts with aggressive cache busting for HTML/JSON
- Migrated seed scripts to work with both PostgreSQL and MySQL

---

## [0.11.0] Research Builder Refinements & Smart VOC Focus — 2026-01-09 to 2026-01-17

### research-frontend
- Added NEV emotions preview in Smart VOC module editor
- Added visual focus styles for Input and Textarea components
- Added Link Preview validation and error handling in Research Configuration
- Added clickable navigation between Smart VOC modules with visual focus indicator
- Fixed Age Range modal opening and row click behavior
- Fixed Age Range toggle enable/disable functionality
- Fixed QR code URL generation for production
- Fixed stage deletion in ResearchBuilderSidebar
- Fixed Smart VOC module reordering (drag & drop)
- Fixed useParams consistency across sidebar components
- Fixed duplicate bootstrapSession calls
- Fixed service worker cross-origin interception issue

### backend
- Added automatic user registration on Google OAuth login
- Fixed NPS question placeholder updated per PDF specification
- Fixed module order parameter processing in backend updates
- Fixed stage deletion error handling
- Fixed Smart VOC module reordering endpoint
- Added localhost:12800 to CORS allowed origins
- Enabled Google OAuth for localhost development

---

## [0.10.0] Demographics, Custom Domains & Dashboard Polish — 2025-12-29 to 2026-01-04

### research-frontend
- Added demographic quotas system with specific config modals (Age Range, Gender, Location, Education, Occupation, Income)
- Added demographics mapper for transforming modal data to backend format
- Added skeleton loader for dashboard
- Added collapsible sidebar with toggle button
- Added automatic redirect to builder after research creation
- Fixed dashboard layout, column widths, and empty state centering
- Fixed Research Types page layout
- Fixed query invalidation after saving modules to update UI
- Fixed cache synchronization between list and detail views

### participant-frontend
- Added SingleChoice auto-advance behavior
- Removed ThankYou button, replaced with close window message
- Fixed step reset to welcome for new participants
- Fixed sidebar step numbering
- Fixed NEV special validation for emotions array
- Fixed scale selector layout split into two rows
- Improved validation and Turnstile handling

### backend
- Added demographic quotas endpoints and database support
- Added Public User Management system
- Extended token expiration to 24 hours
- Fixed automatic token refresh without session logout
- Fixed refresh token cookie maxAge aligned with Cognito (2 days)
- Fixed API Gateway path normalization (stage prefix removal)
- Fixed error handling for media filenames with spaces
- Fixed Cognitive Tasks module association to correct stage template
- Fixed default module creation on research creation

### infrastructure
- Configured custom domains: emotiox.org for frontends, api.emotiox.org for backend
- Added domain configuration scripts and DNS setup

---

## [0.9.0] Security, Monitoring & UX Improvements — 2025-12-20 to 2025-12-26

### research-frontend
- Added Google login button with OAuth integration
- Added default modules toggle to research creation flow
- Added compact research type cards with resizable table
- Improved research builder UX and module management
- Extracted UI components to separate files for maintainability
- Optimized Sidebar component
- Removed unused examples and consolidated duplicate code
- Fixed session bootstrapping with AuthProvider
- Fixed Research Config componentValues initialization from nested config

### participant-frontend
- Added Cloudflare Turnstile anti-bot CAPTCHA protection
- Extracted UI state screens (bootstrap error, loading) to separate components
- Fixed BootstrapErrorScreen moved to separate file (Fast Refresh warning)

### backend
- Implemented real-time monitoring system (WebSocket-based)
- Fixed WebSocket connection and monitoring endpoint improvements
- Consolidated env variables into backend, removed root env files
- Fixed ESLint warnings and React hooks errors across projects

---

## [0.8.0] Production Stabilization & AWS Fixes — 2025-12-09 to 2025-12-19

### research-frontend
- Added Save Changes button to Cognitive Tasks stage
- Added module hide flag toggle (local-only)
- Added link preview using participant CloudFront URL
- Optimized caching strategy for instant updates (network-first for HTML, immutable for hashed assets)
- Fixed presigned URL usage for S3 image uploads

### participant-frontend
- Added auto-navigation on NavigationFlow completion
- Added dynamic button text based on module type (Continue / Next / Submit)
- Added auto-advance modules with hidden buttons and instruction texts
- Added configurable start button text from Welcome Screen module
- Added responsive DevSidebar with burger menu on mobile
- Added emergency cache clear page for service worker issues
- Fixed module state persistence and Service Worker chrome-extension filter
- Fixed hitzone click detection for object-contain images
- Fixed Navigation Flow display component validation
- Fixed NPS scale numbers made circular with proper spacing
- Fixed scale validation for all SmartVOC modules (CSAT, NPS, CES, CV) including 0-value edge cases
- Fixed stale closure prevention using getState() in validation
- Fixed specific validation for VOC and NEV modules
- Fixed TextQuestion state sharing between Short/Long Text modules (key prop)
- Fixed start_button_text filtering with multiple layers of protection
- Updated service worker to network-first strategy
- Enforced runtime-config.json over VITE_API_URL

### backend
- Added SSM Parameter Store for secrets management
- Added CORS middleware
- Fixed participant public research stages and responses endpoints
- Fixed npm ci by pinning serverless-offline to v13
- Fixed participant flow, runtime config, and media presigned URLs
- Fixed auth 401 handling with refresh and rememberMe
- Fixed Serverless dotenv path and SSM variable resolution
- Added module hide flag persistence and participant-side skip logic

### infrastructure
- Fixed CI workflow: check-changes job, paths-filter, workflow-success conditions
- Fixed CloudFront invalidation wait for deployment completion
- Fixed S3 bucket cleaned before deployment to remove stale assets
- Fixed Content-Type headers for JS files in S3 deployment
- Added CloudFront URLs to CORS allowed origins
- Disabled service worker registration to prevent caching issues

---

## [0.7.0] AWS Production Deployment — 2025-12-05 to 2025-12-07

### research-frontend
- Implemented service discovery pattern for environment-agnostic backend consumption (runtime-config.json)
- Major performance optimizations (code splitting, lazy loading)

### participant-frontend
- Added interactive question components for all module types
- Added real-time participant response capture and submission
- Handled legacy module structure with data format spec
- Major performance optimizations

### backend
- Complete AWS deployment: Lambda, API Gateway, S3, CloudFront
- RDS database setup with SSL, data migration from development
- Database connection timeout and Lambda resources increased
- Complete analytics visualization endpoints with database migration

### infrastructure
- Added complete AWS production deployment infrastructure (GitHub Actions)
- Added Cognito configuration and test scripts
- Added workflow_dispatch for manual deployment triggers
- Added CloudFront permissions fix script for S3 buckets
- Fixed legacy-peer-deps for npm ci in deployment

---

## [0.6.0] Dashboard, Results & Analytics — 2025-12-05

### research-frontend
- Added Research Configuration stage as default for all researches
- Added QR Code modal functionality in Research Configuration
- Added comprehensive Dashboard page with research list, status indicators, and management actions
- Added Results section in sidebar navigation
- Added SmartVOC Results: TrustFlowChart (NPS/NEV dual visualization), CPVCard with wave pattern, QuestionCard format for CSAT/CES/CV, NEV Question Card, NPS component, VOC component
- Added Cognitive Task Results: Choice, LinearScale, Ranking, Navigation Test, and Preference Test cards with Filters sidebar
- Implemented SmartVOC calculation formulas (CPV = CSAT/CES)
- Interactive charts using Recharts library
- Fixed dashboard layout, duplicate filters, and PreferenceTestCard progress bars

### participant-frontend
- Added preview mode for researchers to test survey flow
- Added QR generator with participant-frontend URL

### backend
- Added Research Configuration stage creation as default
- Added participantId validation for response submission
- Added analytics endpoints for SmartVOC and Cognitive Task results

---

## [0.5.0] Participant Frontend — 2025-12-04

### participant-frontend
- Implemented complete participant survey experience from scratch
- Basic responsive layout and styles
- Conditional data collection (location, device, session metadata)
- Development sidebar for module navigation with stage grouping
- Dynamic module system with display-only content rendering
- SmartVOC renderer supporting all module types: NPS (ScaleSelector), CSAT (StarSelector), CES/CV (ScaleSelector), NEV (EmotionSelector with 20 emotions), VOC (open text)
- Cognitive Tasks renderer with ChoiceSelector for Single/Multiple Choice
- Slider variant for Linear Scale
- Ranking module with vertical drag-and-drop reordering
- Navigation Flow with iframe and hitzone tracking
- Preference Test with A/B image comparison
- Unified store (Zustand) for responses and navigation
- Clean user tracking system

### research-frontend
- Added module save functionality for persisting researcher configurations

---

## [0.4.0] Backend Caching & Module Configuration — 2025-12-01 to 2025-12-02

### backend
- Implemented caching system for improved API performance
- Added module-templates usage endpoint
- Fixed SQL errors in getUsage endpoint (500 errors, missing created_at)
- Fixed stage ordering

### research-frontend
- Added Choices component with complete configuration and preview
- Added image selection toggle for participant in File Upload
- Implemented unified Smart VOC view with module configurations
- Smart VOC previews with fixed NPS range (0-10)
- Added Remember Me functionality with refresh token
- Simplified LivePreviewPanel
- Removed `any` types and improved TypeScript typing
- Translated Smart VOC modules to English
- Fixed overflow and scrollbars in Create New Module
- Fixed toggles and removed Validation Rules from ComponentConfigPanel
- Fixed module name and description in preview
- Fixed form field id/name attributes for accessibility
- Fixed NEV range selector visibility
- Optimized usage data loading on ModulesPage

---

## [0.3.0] Stage System & Research Builder — 2025-11-24 to 2025-11-28

### research-frontend
- Added stage system UI for organizing module templates (Smart VOC, Cognitive Tasks)
- Research creation redirect with dynamic sidebar
- Delete functionality for research projects with stage highlighting
- Cognitive Tasks and Smart VOC added to stage selection modal
- Research activation functionality
- Enhanced Module Management with advanced features
- File Upload with multiple file support and hitzone editor for Navigation Flow
- Optimized ResearchBuilderPage with separated components and hooks
- Improved Sidebar structure and stage accordion UI

### backend
- Added stage system with stage_type support
- Added Thank You Screen module template
- Added Cognitive Task modules 3.1 and 3.2 with corrected labels
- Added Smart VOC and Cognitive Tasks seed scripts
- Added module-templates usage endpoint
- Added MCP tools for database optimization and analysis
- Updated Multiple Choice module to use 3 individual input components grouped under CHOICES
- Fixed Thank You Screen module components loading and stage type issues

---

## [0.2.0] Research Type Builder & Module System — 2025-11-22 to 2025-11-23

### research-frontend
- Implemented Research Type Builder with refactored ResearchPage
- Module builder with component-specific configurations
- Module preview modal (full-screen with React Portal)
- Reusable ConfirmationModal component
- Research types and techniques structure with assignment functionality
- Separate module template assignment page
- Card/list view toggle and search/filter on Modules page
- Hidden property for ComponentConfig
- Fixed module structure parsing in ModulePreviewModal

### backend
- Full authentication system with Cognito auto-confirmation
- Module assignment functionality
- Smart VOC module seeds: CES, CSAT, CV, NEV, NPS, VOC
- Welcome Screen module template with configurable start button text
- Fixed module_templates.created_by made nullable
- Fixed invalid date display in research types list

---

## [0.1.0] Foundation — 2025-11-20 to 2025-11-21

### backend
- Initial monorepo setup with Express backend
- Complete REST API implementation with services and controllers
- PostgreSQL database migrations and setup scripts

### research-frontend
- Project initialization with strict TypeScript and Husky pre-commit hooks
- API services architecture with ErrorBoundaries
- Research page with tabs and dashboard layout structure
- Routing system with iterable layouts config and Sidebar navigation
- Clean CSS design with light blue aesthetic

### participant-frontend
- Project initialization and port configuration

### infrastructure
- AWS setup script and environment configuration (EC2, S3, RDS)
- Dynamic JSON-based architecture documentation
