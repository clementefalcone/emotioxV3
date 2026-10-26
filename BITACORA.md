# Bitácora de desarrollo — EmotioxV3

> Documento vivo actualizado al final de cada sesión de trabajo con Claude.
> Al iniciar una nueva conversación, el agente debe leer este archivo y `CHANGELOG.md` para entender el estado actual del proyecto.

---

## Última actualización: 2026-10-26 (sesión 52)

---

## Sesión 52: 26 de octubre de 2026 — Revisión forense de Website Tracking (v0.99.18)

### Qué se hizo
- Revisión completa de backend, snippet y resultados de Website Tracking; cada hallazgo medido en producción (MariaDB, logs de Apache) antes de corregir. 16 commits, uno por hallazgo.
- Integridad: visitas partidas, lotes rrweb/emociones/mirada pisados (lock de fila), tope rrweb 16 MB con badge, snapshots perdidos por URL sin normalizar (`emotio.cx/es`), scroll por defecto.
- Acceso: lecturas y escrituras de sesiones limitadas al estudio de la ruta; proxies con tope de 10 MB.
- Test forense local de cámara (Chromium real + vídeo de cara como cámara + API falsa): visitante bloqueado sin salida (botón "Saltar"), mirada enviada sin Gaze Tracking, emociones fallaban sin WebGL.
- Eliminado: vídeo de webcam, mouse-attention, rutas sin uso. Proxies unificados en `proxy-rewrite.ts` con comparación byte a byte.

### Hallazgos clave
- 0 datos de emociones/mirada en producción porque los dos estudios reales las tienen apagadas, no por fallo.
- El "fallo 2" (emociones esperan a la calibración) es deliberado: durante la calibración el visitante no ve la web.

### Pendiente
- Resuelto en la misma sesión: tope de 50 eventos (riesgo latente desde 4-oct, 0 sesiones afectadas) y visitas mezcladas tras fallos de sesión.
- `url( "…" )` con espacios en CSS proxificado no se reescribe.
- Activar emociones/mirada en un estudio real para tener datos.

---

## Sesión 51, día 2: 24 de octubre de 2026 — AOIs honestas y evaluación forense de emociones (v0.99.17)

### Qué se hizo
- "Todos en 0" en resultados: los 5 participantes de `edee0a59` superan 200 px de error de calibración y quedaban excluidos sin aviso. Aviso + botón "Incluir todos".
- AOIs y promedios ahora se calculan en el backend con el grupo que ve el investigador (filtros + casillas).
- Margen de AOI por eje y reparto de cada fijación entre AOIs cercanas: Shelf de 413% a ~100%.
- Herramientas de evaluación de emociones: `/test/expression-capture` y `/test/expression-eval`. Borrador de consentimiento para la fase 2.
- Investigado y descartado por ahora: pupilometría con webcam (el efecto es ~0,2–1 px, menor que el ruido; la luz lo tapa). Bases públicas de expresiones: AM-FED+ y SEWA prohíben uso comercial; DISFA no está claro.

### Decisiones
- La emoción no se "lee" de la cara: el objetivo es medir bien movimientos faciales y triangular con mirada, respuestas y conducta. LLM solo como capa de interpretación sobre datos agregados, nunca sobre imágenes.
- No reemplazar face-api por blendshapes hasta medir con la grabación etiquetada.
- No usar tecnología ni datos que requieran licencia de terceros (DISFA, AM-FED+, SEWA, AffectNet…). La referencia son grabaciones propias con consentimiento.
- El umbral de calidad de 200 px se mantiene; queda pendiente calificar por tamaño de AOI en vez de píxeles.

### Pendientes
- Grabación propia con `/test/expression-capture` → correr `/test/expression-eval`.
- Fase 2: la página de captura debe procesar en el navegador y guardar solo cambios, no video, antes de usarla con terceros.
- Confirmar en un teléfono, con una respuesta guardada, que la góndola ya no cambia al final.

---

## Sesión 51: 23 de octubre de 2026 — Eye Tracking Shelf y unidad de la mirada (v0.99.16)

**Origen:** "Eye Tracking modo shelf está cortando las imágenes". La revisión llevó a un error mayor: cada lado usaba una unidad distinta para la posición de la mirada.

### Qué se hizo
- Shelf sin recorte (`object-contain`, celdas con la proporción del primer producto, góndola completa en pantalla) y sin reordenamiento en teléfono.
- Una regla única de columnas (`shelfLayout`) en builder, participante, backend y resultados. Barajado una vez por participante, orden guardado en `shelfColumnOrder`.
- Fijaciones y mirada en video guardadas en porcentaje del estímulo (`fixationUnit` / `gazeTimelineUnit: 'stimulus-percent'`).
- Detalle en CHANGELOG v0.99.16. Desplegado en orden: backend → participant → research.

### Decisiones
- **Orden de despliegue obligatorio:** backend antes que participant. Participant nuevo con backend viejo divide porcentajes por la pantalla.
- **Datos viejos no se migran:** las 17 respuestas Shelf previas son de prueba; no guardaron orden ni tamaño de la góndola, no son recuperables.
- **Teléfono:** misma góndola que escritorio, más chica, en vez de guardar el layout por respuesta.

### Pendientes
- Verificar con una sesión real con cámara (Shelf y video) que las respuestas nuevas guardan `fixationUnit`, `shelfColumnOrder` y `gazeTimelineUnit`.
- Estudio archivado `0f300142`: 9 productos en 3 columnas, 6 nunca se mostraron.

---

## Sesión 50: 27 de julio de 2026 — Gauntlet de tests + medición real de Eye Tracking

**Origen:** `docs/bob-martin.jpeg` — rodear al agente de restricciones (unit tests, coverage, mutation testing) en vez de leer su código.

### Commit `9c3886b`
Coverage en los 3 subproyectos, Stryker en backend y participant, 45 tests rojos reparados, 3 bugs reales de emociones corregidos. `tracking-emotion.analytics.ts` 0% → 100% líneas / 92.64% mutación. `zoneRegistry` 67.96% → 99.45% mutación. Detalle completo en CHANGELOG v0.90.1.

### Medición de precisión de Eye Tracking (NO commiteado — solo medición)

El harness `participant-frontend/eval/` funciona. Cómo correrlo:

```bash
cd participant-frontend
./node_modules/.bin/vite --port 12600 --strictPort          # servidor (usar el binario, npx lo reescribe el hook RTK)
EVAL_ENGINE=mediapipe EVAL_VIDEO_PATH="$PWD/eval/datasets/session-auto/video.y4m" \
  ./node_modules/.bin/playwright test --config eval/playwright/playwright.eval.config.ts --project=desktop-1280x720
```

**Número actual (MediaPipe+Ridge, 1 sujeto, 3 repeticiones):** RMSE mediana **414 px** en viewport 1280×720 — unos **8-9°**, o el 32% del ancho de pantalla. Rango entre repeticiones 377–499 px, o sea ±60 px de varianza con el mismo video.

Referencia: webcam calibrado en literatura anda en 1.5–3°; IR de laboratorio (Tobii/EyeLink) en 0.5°. Estamos 3-4× peor que el estándar de webcam.

**Implicación:** una celda de grilla 3×3 mide 427×240 px. El error es del tamaño de la celda. La asignación de zona en 3×3 no es confiable hoy. Antes de encender `EYE_TRACKING_V2_ENABLED` hay que bajar el error o dimensionar las zonas al error real (2×2).

### RESULTADO NEGATIVO — no repetir estos 3 intentos

Los residuales por punto de calibración muestran compresión sistemática hacia el centro (la fila superior se predice ~250 px más abajo; el modelo recupera solo ~40% del rango vertical). Parece un bug. **No lo es.** Se probaron tres arreglos, cada uno aislado, 3 repeticiones, mismo código base:

| Configuración | RMSE mediana |
|---|---|
| Control (como está hoy) | **414** |
| Solo pruning de outliers por MAD | 439 |
| Solo stretch calculado por centroides en vez de min/max | 499 |
| Solo lambda elegido por LOOCV en vez del fijo `DEFAULT_RIDGE_LAMBDA = 10` | 613 |
| Los tres juntos | 683 |

**Los tres empeoran.** El más dañino es el lambda automático, y de la manera más engañosa: consigue el **mejor** cvRmse de calibración (541 vs 553 del control) y la **peor** precisión real. Optimizar la validación cruzada sobre los 9 puntos de calibración anticorrelaciona con el tracking: un lambda bajo ajusta mejor esos puntos pero se sobreajusta a la pose de cabeza del momento de calibrar.

Conclusión: la compresión hacia el centro **es el shrinkage funcionando correctamente** bajo incertidumbre, no un defecto. `DEFAULT_RIDGE_LAMBDA = 10` es empíricamente mejor que elegirlo por CV. No tocar sin medir con el harness.

**Lección de método:** `cvRmsePx` no sirve como métrica de calidad de calibración. El único juez válido es el RMSE del eval contra los puntos de evaluación.

### Pendientes
- Correr el eval con más sujetos y sesiones (1 sujeto no es validación).
- Mobile usa "tap proxy" (un toque como sustituto de la mirada). Si se mezcla con gaze real en los mismos resultados hay que separarlo o etiquetarlo. **No verificado en código.**
- `emoStartTime` se reinicia al volver la pestaña a visible (`tracking-snippet.ts:415`), solapando timestamps en sesiones con pausas. Afecta timeline y Valence/Arousal.
- Tab "Original" de Attention Prediction no enciende overlays; contradice el spec P6 de v0.81.0.
- Workflows de GitHub Actions no corren desde el 1 de julio — el deploy automático a cPanel está caído.

---

## Sesión 49: 8 de junio de 2026 — Feedback emotiox Attention Prediction (v0.81)

**Origen:** `docs/emotiox.pdf` — 9 bloques de feedback (estudios TikTok/IG, AOI-first).

| Área | Qué se hizo |
|------|-------------|
| P1 Legacy | Banner, panel IA bloqueado, zonas IA off, convertir AOIs, `%` desde heatmap |
| P2 Gaze | `GazeScanpathPlayer`, overlay visible, rutas ancladas (FE+BE) |
| P3–P4 Heatmap | Whitespace mask, NMS fino, modal Settings live, toolbar resumida |
| P5 Criterio | `attentionCriteriaName` en header y panel |
| P6 Compuesta | Capas auto en Original, «Vista completa», leyenda rutas |
| P7–P8 AOIs | Guards teclado (modal, label, drawer criterio) |
| P9 Wizard | Paso a paso en panel derecho; criterio ✓ si guardado |
| Persistencia | `persistStimuli` + `handleSavePrompt` con `getById` fresco |

**Tests:** 44 FE + 3 BE. **Pendiente UAT:** regenerar heatmaps viejos para P3; tiempos predict (~backend).

## Sesión 48: 7 de junio de 2026 — Modos Classic / Spotlight / Cold (v0.80)

- **Backend.** NMS más estricto (72 puntos máx.) en predict imagen y video.
- **Frontend.** Tres modos de mapa conmutables; preset Lab default en Classic. Fix del selector (estado + capa Heatmap).
- **Deploy.** research-frontend + backend en cPanel.

## Sesión 47: 7 de junio de 2026 — Precise heatmaps + visor sin scroll (v0.79)

- **Backend.** Extracción de puntos granular (NMS), preset Precise, hybrid saliency más selectivo. Video alineado.
- **Frontend.** Visor unificado con capas; layout flex mide viewport real (sin scroll por `100vh` + chrome). Canvas con sizing explícito vía `computeStimulusDisplaySize`.
- **Deploy.** research-frontend + backend en cPanel (`index-Dyb9qEAK.js`).

## Sesión 46: 6 de junio de 2026 — Fase 7: AOIs en hybrid predict (v0.78)

- **Predict con AOIs manuales.** `POST /predict` recibe zonas del investigador; pipeline híbrido aplica boost semántico + espacial.
- **Frontend.** `predictAttention()` y botón "Generar heatmap" envían `liveAois` (mismo patrón que analyze).
- **D-04 completo.** AOIs alimentan predict y analyze.

## Sesión 45: 6 de junio de 2026 — Fix AOIs stale en panel IA (Attention Prediction)

- **Bug:** Analizar desde el panel lateral enviaba `activeStimulus.aois` (cache) en lugar de las zonas dibujadas en el card.
- **Fix:** `onAoiListChange` en `AttentionPredictionCard` + estado `liveAois` en `AttentionPredictionView`. Panel y header comparten la misma lista al llamar `runAnalysis`.
- **Contexto v0.77:** Flujo AOI-first desplegado en sesión anterior (predict TranSalNet, sin auto-analyze, criterio manual). Este fix cierra el último gap del flujo de analyze.

## Sesión 44: 15 de abril de 2026 — Research detail drawer + fix JOIN

- **Fix JOIN:** `r.user_id` → `r.created_by` en queries de activity (columna correcta en `researches`).
- **Detail endpoint:** `GET /research/:id/detail` con 4 queries paralelas: research+user, stages, modules, response stats. Timeline ensamblada server-side.
- **Drawer con tabs:** Overview (info + stats), Stages (accordion con módulos anidados), Timeline (eventos cronológicos con iconos). Filas clickeables en Research Tracking.
- **Viewers invitados:** `GET /users/viewers` lista viewers. Drawer de Invite Viewer muestra listado de invitados con email y fecha, se refresca al enviar nuevas invitaciones.

## Sesión 43: 15 de abril de 2026 — Fix ruta global de tracking

- **Orden de rutas corregido:** `GET /research/activity` quedó antes de `GET /research/:id`, evitando que `activity` se interpretara como ID de research y devolviera 404.

## Sesión 42: 15 de abril de 2026 — Tracking con filtros por columna

- **Tabla con filtros por columna:** `/research-tracking` dejó los selectors superiores y ahora usa una tabla con filtros por columna para summary, research, technique, researcher y action.

## Sesión 41: 15 de abril de 2026 — Tracking con estados locales de carga/error

- **Carga/error acotados:** `/research-tracking` mantiene header y filtros visibles, y ahora muestra skeleton o error solo en el panel que carga la actividad.

## Sesión 40: 15 de abril de 2026 — Tracking global e invitaciones de viewers

- **Tracking global:** Se creó una bitácora de actividad para researches con feed global en `/research-tracking`, accesible desde el sidebar principal.
- **Filtros de tracking:** La vista global permite filtrar por investigación, técnica, investigador, acción y búsqueda libre.
- **Eventos registrados:** Creación, edición, cambio de estado, activación, duplicado, archivado, creación/eliminación de stages, eliminación de módulos, stages por defecto y share progress.
- **Invite Viewer mejorado:** La invitación de viewers pasó a Drawer, sin nombre/apellido, y ahora permite agregar varios emails y reintentar solo los fallidos.
- **Toolbar de Research:** `Invite Viewer` y `Create Research` quedaron alineados con el toggle de Cards/Table, y se eliminó el encabezado de texto superior.

## Sesión 39: 15 de abril de 2026 — Workflow backend más claro en SSH

- **Deploy backend endurecido:** El workflow `deploy-backend-cpanel.yml` ahora valida `CPANEL_SSH_HOST`, reintenta `ssh-keyscan` hasta 3 veces y deja un error más claro si no puede obtener la host key del servidor cPanel.

## Sesión 38: 15 de abril de 2026 — Progreso público robusto + CORS SSE

- **Progreso público más tolerante:** `PublicProgressPage` ahora normaliza respuestas envueltas o serializadas antes de leer `metrics` y `participants`.
- **Nueva acción en View Progress:** Se agregó `Open link` para abrir directamente la URL pública del progreso.
- **Impresión pública preparada:** La vista pública soporta `?print=1` y espera a que carguen datos y fonts antes de llamar `window.print()`.
- **SSE CORS corregido en cPanel:** `server-cpanel` permite `Cache-Control` en preflight y responde `OPTIONS /api/monitor/events/:researchId`, evitando bloqueos desde `localhost:12800`.

## Sesión 37: 15 de abril de 2026 — Nombre del estudio en progreso público

- **Header con nombre del research:** La página pública de progreso ahora muestra `Research Progress - {researchName}`.
- **Payload extendido:** El endpoint interno de métricas agrega `researchName` para evitar una segunda carga desde frontend.

---

## Sesión 36: 15 de abril de 2026 — Fix link público de progreso

- **URL de progreso corregida:** El link compartido se estaba generando como `/progress/:id`, pero en producción el research frontend corre bajo `/research`. Actualizado frontend y fallback backend a `/research/progress/:id`.
- **Causa del código inesperado:** El endpoint público de progreso responde `200`; el problema era la URL raíz incorrecta, no la API.

---

## Sesión 35: 10 de abril de 2026 — Builder fixes para estudio cliente (v0.42.4)

- **File upload múltiple:** Navigation Flow y Preference Test solo dejaban subir 1 imagen. El template en BD no tenía `multiple: true` y el default era `false`. Cambiado default a `true` para todos los `file-upload`.
- **Hitzones no persistían:** `FileUploadAdvanced` comparaba archivos por `id/url/s3Key` para evitar re-renders. Las hitzones no estaban en la clave de comparación, así que al actualizar desde el padre el componente no se enteraba. Agregado conteo de hitzones a la clave.

---

## Sesión 34: 10 de abril de 2026 — Eye Tracking encuesta: pipeline híbrido IDW (v0.42.3)

- **`EyeTrackingRenderer`:** Calibración 4 puntos sobre la imagen (mismos centros de cuadrante que el lab), campo IDW al muestrear mirada en fase viewing, BlazeGaze activo ya en calibración, EMA 0.38. Payload: `gazePipeline`, `calibrationRmsePx`.
- **i18n:** `calibrationHint4Point` ES/EN.

---

## Sesión 33: 10 de abril de 2026 — Eye Tracking hybrid: rejilla, cámara y diagnóstico (v0.42.2)

- **Rejilla 2×2 (lab):** Menos correcciones apiladas (sin segundo EMA en zona; campo IDW principal). Ajustes iterativos en `hybridZoneGrid` (nudges, sesgos fila/columna, stretch Y solo en mitad izquierda para separar sup/inf izquierdos). Limpieza de hooks `useEyeTracking` no usados.
- **Cámara BlazeGaze:** Constante compartida `ideal` 1280×720; estadísticas con última resolución de captura; aviso no bloqueante si el lado corto del frame es bajo.
- **Documentación:** `docs/eye-tracking-heatmap.md` alineado con el pipeline (resolución, frames, rol del modelo).

---

## Sesión 31: 3 de abril de 2026 — Implicit Association: 3 paradigmas + Notes + target selector (v0.50.0)

- **Análisis de diseño.** Revisión de 3 imágenes de técnica (`technique-implicit-v1/v2/v3.png`) + 10 pantallas de Figma (`docs/participant-implicit/`) para entender los 3 paradigmas reales.
- **Notes panel (research-frontend).** 2 columnas en `ModuleContentEditor`: contenido del builder (izq) + panel informativo (der, 280px) con instrucciones por tipo IAT.
- **Criteria target selector.** Reemplazo del file upload por `CustomSelect` con opciones "Target 1", "Target 2", etc. Persiste `targetId` en cada criterion. Determina respuesta correcta en participant-frontend.
- **Renderer reescrito con 3 paradigmas:**
  - Attribute Testing: 2 pasos (práctica + priming con criteria asignados a targets).
  - Comparing Attribute: 1 paso Yes/No (Object + Criteria, botones = dimensions).
  - Objects Comparing: 3 pasos IAT clásico (criteria → targets → combinado).
- **Traducciones IAT:** 22 claves ES/EN. Fallback i18n en vez de placeholders inglés del template.
- **Datos verificados en producción:** Research "Probando nuevo" con los 3 tipos configurados (Fanta, Coca cola, Pepsi).

---

## Sesión 30: 3 de abril de 2026 — IAT Attribute Testing fixes (v0.49.1)

- **Criteria images:** `IATAttribute` extendido con `imageUrl`/`imageStorageKey`. Resolución S3 unificada para targets y attributes. Trials de bloque 1 y 3 pasan imagen al estímulo.
- **Criteria distribution:** Primera mitad → izquierda, segunda mitad → derecha. Antes solo criteria[0] iba a la izquierda. `handleSelect` bloque 1 usa `'attr-left'`/`'attr-right'` en vez de IDs fijos.
- **show-results:** Extrae checkbox del config. Muestra accuracy y avg RT al participante al completar.
- **Deploy:** participant-frontend desplegado a producción.

---

## Sesión 29: 3 de abril de 2026 — IAT builder completo + Screener builder + participant renderers (v0.49.0)

- **IAT stage type selector:** Drawer "Add Stage" muestra selector de tipo al elegir Implicit Association. Backend recibe `defaultModuleName` para crear el módulo correcto.
- **IAT builder grid:** Targets/objects en columnas responsivas. `implicitAssociationBuilder.ts` particiona componentes por `groupLabel` (Target N / Object N).
- **Stage filtering por técnica:** Drawer filtra stages disponibles según `default_stages` de la técnica. Backend expone `technique_default_stages` en el detalle del research.
- **Screener builder:** Headers por tipo, toggle para checkboxes, `RadioChoicesEditor` grid, hooks de trim/pad para choices.
- **FileUpload single:** Respeta `fileUpload.multiple` (default false). Fix overflow en grid.
- **Participant renderers:** IAT motor reescrito (config robusta, imágenes S3, bloques estándar). Eye Tracking mejorado. Screener integrado.
- **Migraciones 018-019:** Templates IAT corregidos (componentes y asociaciones al stage template).
- **Verificación de flujo completo:** IAT se guarda correctamente en backend (`config.structure.components`), se entrega vía endpoint público (`extractStructure`), se normaliza en participant-frontend, y se renderiza según tipo detectado por nombre del módulo.

---

## Sesión 28: 1 de abril de 2026 — Technique stage creation fix + backend deploy (v0.48.0)

- **Fix `default_stages`:** "Biometric, Cognitive and Predictive" ahora incluye Research Configuration (order 3). Actualizado en BD producción + migración 016 local.
- **Fix creación de stages:** `stageTemplateNames` incluye "Research Configuration". Cuando la técnica ya lo define, `addDefaultStage` se salta para respetar el orden de la técnica.
- **Deploy backend:** cPanel actualizado de v0.42.0 a v0.48.0 (incluye v0.41–v0.47).
- **Test research creado:** `8682b29e-64f1-4371-b79a-e3472ad86c63` con data en todos los stages para testing de participant-frontend.

---

## Sesión 27: 29 de marzo de 2026 — Design system completo + skeletons + fixes (v0.47.0)

- **Paleta EmotioX propia:** Sistema de colores light completo (surfaces, text, accent, semantic, chart, borders). Documentado en `docs/design-system/emotiox-palette.md`. El hover del accent va mas oscuro en light theme (#0058D4), no mas claro.
- **Migración accent:** ~50 componentes migrados de `blue-*` hardcoded a tokens `accent` (botones, toggles, checkboxes, focus rings, tabs, links, etc.). Solo quedan `blue-*` en status badges y data viz.
- **Skeletons:** Eliminados todos los spinners de carga de datos. Nuevo `Skeleton.tsx` con 7 componentes reutilizables. App shell skeleton para bootstrap/Suspense.
- **Dashboard responsive:** Tabla con colgroup porcentual, truncate en Name/Researcher, sidebar derecho solo en xl+. Filter pills en flex single-row.
- **Fix filtro tipos:** Comparación `String()` para evitar mismatch number vs string en research_type_id.
- **Fix auth 400:** Backend sobreescribía AuthError 401 a 400 por "Invalid" en el mensaje. Frontend no llama `/auth/me` sin token.

---

## Sesión 26: 28 de marzo de 2026 — Google-only auth + design system (v0.46.0)

- **Auth:** Eliminado login manual (email/password) y registro. Solo queda Google OAuth. Limpieza completa: store, service, types, ruta `/register`, `RegisterPage.tsx`.
- **Design system:** Aplicada base del design system Vambe AI en modo light. Plus Jakarta Sans como font principal. Tokens `accent` en Tailwind. Login rediseñado: card blanca, fondo claro, botón Google único.
- **Regla establecida:** Solo light theme, nunca dark theme.

---

## Sesión 25: 28 de marzo de 2026 — Participant rendering: Screener, IAT, Eye Tracking (v0.45.0)

- **Screener:** `ScreenerRenderer` — reutiliza `ChoiceQuestion` existente. Muestra pregunta + choices con eligibilidad (Qualify/Disqualify). El ruteo se maneja server-side.
- **Implicit Association:** `ImplicitAssociationRenderer` — motor IAT completo. Instrucciones → priming → trials (texto/imagen) → feedback → guardado automático. Teclado E/I + botones touch. Soporta Attribute Testing, Comparing Attribute, Objects Comparing. Extrae config del módulo (targets, attributes, priming time).
- **Eye Tracking:** `EyeTrackingRenderer` — MVP con click/tap tracking como proxy de eye tracking. Instrucciones → imagen estímulo con countdown → registra clicks como fixations en coordenadas naturales. Resuelve URLs de S3 via mediaService.
- **Integración:** `DynamicStep` delega a los 3 nuevos renderers. `useNavigation` incluye nuevos steps. `ResearchPage` mapea nombres, valida configuración, oculta botón para IAT/ET (auto-advance interno).
- Los 3 renderers producen exactamente el formato de respuesta que los endpoints de analytics ya esperan.
- Pendiente: webcam eye tracking (WebGazer.js) como mejora futura.

---

## Sesión 24: 28 de marzo de 2026 — Eye Tracking results (v0.44.0)

- **Backend:** Endpoint `GET /analytics/research/:id/eye-tracking` — extrae config de estímulos y computa métricas de heatmap/fixaciones/AOI.
- **Research UI:** `EyeTrackingResults` con cards por estímulo, toggle heatmap/image, lista AOI, descarga de imagen.
- Nueva tab "Eye Tracking" en `ResearchResultsPage`.
- Datos aparecerán cuando el participant-frontend implemente el flujo (`component_id = 'eye-tracking-data'`).

---

## Sesión 23: 28 de marzo de 2026 — Implicit Association results (v0.43.0)

- **Backend:** Nuevo endpoint analytics para Implicit Association. Detecta tipo de test por nombre del módulo, extrae targets/attributes/priming del config, computa D-scores desde tiempos de reacción.
- **Research UI:** Componente `ImplicitAssociationResults` con 3 gráficos: RadarChart (Attribute Testing), BarChart agrupado (Comparing Attribute), BarChart horizontal divergente (Objects Comparing). Nueva tab en `ResearchResultsPage`.
- Los gráficos muestran la configuración del módulo con scores en 0 hasta que existan respuestas de participantes (`component_id = 'iat-trials'`).
- Ver `CHANGELOG.md` v0.43.0 para detalle.

---

## Sesión 22: 25 de marzo de 2026 — Límite global + cuotas % (v0.39.1)

- **Backend:** `getEffectiveParticipantLimitCap` — el límite de participantes guardado como número (legacy) vuelve a aplicar en API; la conversión `% →` cupos usa **N** correctamente. Deploy cPanel.
- Detalle: `CHANGELOG.md` v0.39.1.

---

## Sesión 21: 25 de marzo de 2026 — Quotas save, pre-check, participant UX (v0.39.0)

- **Backend:** Pre-check público sin `checkAllQuotasFull`; `getParticipantStatus` sin respuestas solo-demografía.
- **Participant:** Panel + ECX: estado respondido y reset de thank-you obsoleto antes de redirigir.
- **Research UI:** Cuotas de edad persisten en un solo `onSave` con `quotas` en el mapper; copy sobre cuota vs descalificación.
- Ver `CHANGELOG.md` v0.39.0 para detalle.

---

## Sesión 20: 20 de marzo de 2026 — Filters, SmartVOC polish, time ranges, sentiment (v0.33.0 → v0.34.0)

### Filtros demográficos
- SmartVOC Trust Flow, MetricCard sparklines y NPS stacked bars usaban datos pre-agregados del backend (sin `participantId`) — los filtros no los afectaban. Ahora todos los gráficos computan desde scores individuales filtrados.
- `getModuleResponses` devolvía `participant_id` (snake_case) — el frontend filtraba con `participantId` (camelCase) y nunca matcheaba. Corregido con mapeo a camelCase.
- Collation mismatch en `participant_demographics` (`utf8mb4_general_ci` vs `utf8mb4_unicode_ci`) corregido con ALTER TABLE.

### CES invertido
- `calculateCES` trataba scores 4-5 como positivos. En CES, 1-2 = poco esfuerzo (bueno). Corregido cálculo y labels (Little effort / Much effort).

### SmartVOC polish
- Preguntas reales del backend en vez de hardcoded. Backend extrae de `{type}-title` component o `placeholder.text`.
- Títulos simplificados: "CSAT", "CES", "NPS" (sin nombre largo).
- NPS Ratio: cambiado de `Area` a `Line` para renderizar por encima de barras.
- Trust Flow unificado a LineChart en todos los rangos. Quitado select duplicado.
- Selector de tiempo: agregados 6M y 12M.

### View Progress
- Quitado botón "Acceso a Tests" y su modal.
- Quitada columna "Acceso directo" de tabla de participantes.
- Tabla con scroll interno (`max-h-[60vh]`, header sticky).
- Botón ojo abre Drawer con detalles y respuestas del participante.

### Sentiment analysis (v0.34.0)
- Nuevo módulo `sentiment/sentiment.service.ts` — lexicon bilingüe ES/EN (~220 palabras por idioma).
- Soporta negación ("no me gusta" → negativo) e intensificadores ("muy bueno" → reforzado).
- Se aplica al guardar respuestas de texto (Short/Long Text, VOC) → `metadata.sentiment`.
- `getModuleResponses` computa on-the-fly para datos existentes sin sentiment.
- Frontend: badges de color en VOCComments + tab "Sentiment Analysis" con barras de distribución reales (reemplaza texto hardcodeado).
- Cognitive Task Short/Long Text lee `metadata.sentiment` para columna mood.

### Heatmap overhaul (v0.34.0)
- Renderer custom reemplazado por `simpleheat` (librería probada, misma que usa Leaflet).
- Estilo Hotjar: imagen + capa oscura 55% + gradiente verde→amarillo→rojo→blanco.
- Radio auto-escalado según tamaño de imagen.

### UI general
- Sidebar sin scrollbar visible, sin título de research duplicado.
- Tooltips en todas las métricas de Cognitive Task Results.
- Ranking card: labels más anchos, Mean "—" sin datos, sin números repetidos.
- Módulos huérfanos (`stage_id IS NULL`) excluidos de Cognitive Task Results.
- Quitados: banner "Update graph", botones de acciones sin función, icono filtro en AOI.
- Imágenes Navigation Flow limitadas a 400px.

---

## Sesión 19: 19 de marzo de 2026 — Cognitive Results overhaul, admin role, duplicados (v0.30.0)

### Admin role
- `carriagadafalcone@gmail.com` → `role: 'admin'` en BD producción.
- Helper `buildOwnershipClause(userId, role)`: admin bypasea `created_by` filter, ve todos los estudios sin quitárselos al owner original.
- Aplicado en todas las funciones de `research.service.ts` y `research-in-progress.service.ts`.

### Respuestas duplicadas
- Root cause: no había `UNIQUE INDEX` en `responses` → `ON DUPLICATE KEY UPDATE` nunca se disparaba.
- Limpieza: 233 filas duplicadas eliminadas (se conservó la más reciente por participante).
- Prevención: `UNIQUE INDEX uq_responses_participant_module_component (research_id, participant_id, module_id, component_id)`.
- Safety net: `getScaleResponses` deduplica al leer con subquery `MAX(created_at)`.

### Cognitive Task Results: preguntas reales
- Antes: todos los módulos mostraban el nombre del tipo ("Linear Scale", "Ranking") como título, con textos placeholder hardcodeados.
- Ahora: `getCognitiveTaskResults` extrae `questionText` del componente `question-title` de cada módulo. El frontend usa `questionText || moduleName` como título.
- Eliminados todos los hardcodes: "This was the best app...", "the question asked to the user in the test", "26s", "76s", columna "Secs", prefijo "Question:".

### Cognitive Task Results: módulos con 0 respuestas
- Ranking: parsea `value` (JSON string) del componente `ranking-list` para obtener items configurados. Muestra opciones aunque no haya respuestas.
- Choice: extrae opciones configuradas (`settings.isChoice`) con sus labels reales.
- Linear Scale: muestra todo el rango configurado (start–end).

### Navigation Flow results
- Thumbnails de step: miniatura de la imagen real en vez de cuadrado azul.
- Steps colapsados por defecto (no expandidos).
- Imágenes con `w-full` en todas las tabs para consistencia con el heatmap.

### Linear Scale results
- Porcentaje siempre fuera de la barra, texto negro.
- Eliminado `minWidth: 16px` que distorsionaba proporciones.
- Labels "Option 01" con `whitespace-nowrap`.

---

## Sesión 18: 18 de marzo de 2026 — Progress, filtros, demographics, imágenes (v0.29.1)

### View Progress: status y progreso corregidos
- El progreso se calculaba con `COUNT(DISTINCT component_id)` vs total de sub-componentes → nunca llegaba a 100%.
- Cambiado a `COUNT(DISTINCT module_id)` vs módulos visibles (excluye Welcome/Thank You/Research Config/hidden).
- Ahora un participante que respondió todo muestra 100% y "Completado".

### Cognitive Task Results: filtros demográficos
- Los filtros del sidebar solo aplicaban a Short/Long Text (renderizados inline con `module.responses`).
- Los wrappers de Scale, Ranking, Choice, NavigationFlow, PreferenceTest hacían fetch independiente e ignoraban filtros.
- Fix: cada wrapper recibe `filteredParticipantIds` y filtra localmente después del fetch.
- Módulos con 0 respuestas ahora se muestran (antes se ocultaban con `totalResponses > 0`).

### Demographics: persistencia inmediata
- `handleChange` en DemographicsStep solo persistía al store vía `useEffect` (asíncrono).
- Si el usuario clickeaba "Guardar y continuar" rápido, el store no tenía la última respuesta → "Error de validación".
- Fix: `updateResponse` se llama inmediatamente en `handleChange`.

### Navigation Flow results: imágenes
- Contenedores de imagen usan `w-fit max-w-full mx-auto` → imágenes verticales no se estiran, SVG overlays alineados.
- Linear Scale: porcentaje movido fuera de la barra (siempre negro, siempre legible).
- Botón "Download image" por pestaña (captura como PNG con overlays).

### Participant: orden dinámico y sesiones
- `useNavigation` acepta `dynamicStepsOrder` desde backend `order_index` (ya no hardcodeado).
- Participantes ya respondidos ven pantalla de bloqueo ("You have already responded").
- Choice question: purple → blue.
- Service workers viejos se desregistran forzosamente al cargar (fix cache con error "AWS backend").

---

## Sesión 17: 18 de marzo de 2026 — Builder UX polish, module reorder, logo (v0.29.0)

### Linear Scale: selector controlado
- Eliminada la opción "Custom" que permitía números arbitrarios como min/max.
- Ahora solo opciones predefinidas: 1-3, 1-5, 1-7, 1-10, 0-10.
- Labels (Start/End) visibles para todas las opciones.
- Backward compatible: datos existentes con `type: 'custom'` siguen funcionando en participant-frontend.

### Module reorder
- Flechas arriba/abajo al costado de cada card de módulo (SmartVOC y Cognitive Tasks).
- Usa endpoint existente `PUT /stages/:stageId/modules/reorder` + `modulesService.updateModulesOrder()`.
- Solo visible cuando hay más de 1 módulo en el stage.

### Ranking UX (participant-frontend)
- Color púrpura → azul (border, badge, hover).
- Drag handle: bloque gris reemplazado por ícono de 3 líneas (grip clásico).

### Ranking results: nombres en vez de IDs
- Backend `getRankingResponses` ahora lee `modules.structure` para extraer `rankingConfig.items` y devuelve `label` por cada item.
- Frontend usa `ranking.label || ranking.item`.

### Auto-scroll al crear módulo
- Después de agregar un módulo desde el drawer, la vista hace scroll suave al módulo recién creado.
- Fix: `selectedStage` stale — ahora se lee el stage fresco de `typedResearch` para calcular `order_index`.

### Logo EmotioCX
- `docs/EmotioCX-logo.svg` copiado a `research-frontend/public/`.
- StandardSidebar: reemplazado BrainCircuit icon por logo SVG.
- ResearchBuilderSidebar: agregado logo arriba del "Back to List".

---

## Sesión 16: 18 de marzo de 2026 — Templates a inglés, revisión auth Google (v0.28.5)

### Module templates: traducción ES → EN en BD producción
- 8 templates de Cognitive Tasks tenían labels y placeholders en español ("Título de la pregunta", "Escribe la pregunta aquí...", etc.).
- Actualizados directamente en `module_templates.structure` vía SQL en producción.
- Templates afectados: Short Text, Long Text, Linear Scale, Single Choice, Multiple Choice, Navigation Flow, Preference Test, NPS.
- Los estudios ya creados no se afectan (los módulos se clonan del template al momento de creación).

### Auth Google OAuth: revisión de persistencia de sesión
- Se revisó el flujo completo de autenticación (login email, Google OAuth, bootstrap, refresh, logout).
- No se encontraron bugs. La sesión con Google depende de cookies httpOnly en producción y de localStorage en localhost.
- El comportamiento reportado (perder sesión al copiar URL de incógnito a normal) es esperado: los contextos de navegador son independientes.

---

## Sesión 15: 18 de marzo de 2026 — NavigationFlow 3 intentos, validación demographics (v0.28.4)

### NavigationFlow: Opera/Linux fix + 3 intentos por imagen
- **Problema**: en Opera/Ubuntu, `img.decode()` se colgaba → clicks ignorados silenciosamente.
- **Fix**: timeout de 1s en `img.decode()`. Si no resuelve, aplica dimensiones directamente.
- **3 intentos por imagen**: click correcto avanza a la siguiente imagen. Al 3er click fuera del hitzone, el flujo termina (`completed: false`) y pasa a la siguiente pregunta del estudio.
- La "barra amarilla con coordenadas" no es nuestra — es herramienta de Opera o extensión del navegador.

### Demographics: validación completa antes de avanzar
- **Bug**: ENTER o click en "Guardar y continuar" avanzaba con solo 1 campo respondido. La validación solo verificaba `length > 0`.
- **Fix**: ahora se extraen las keys habilitadas del config del módulo y se valida que todas tengan respuesta.

---

## Sesión 14: 18 de marzo de 2026 — Ranking fix participant, drawer de templates (v0.28.3)

### Ranking: fix parsing en participant
- `CognitiveTaskRenderer.tsx`: parsing del formato `{ items, randomize }` (third try y fourth try).
- `RankingQuestion.tsx`: prop `randomize` con Fisher-Yates shuffle en carga inicial.

### Drawer de selección de templates
- `ModuleTemplateSelectionModal.tsx`: convertido de modal centrado a drawer lateral derecho. Filtra por `stageType` — SmartVOC solo muestra métricas, Cognitive Tasks solo muestra preguntas. Grid 2 columnas con click directo.
- `ResearchBuilderPage.tsx`: botón "Add another question/metric" al final de ambos stages.
- Eliminado template "ultra basico" de la BD de producción.

---

## Sesión 13: 18 de marzo de 2026 — Ranking: fix en BD producción (v0.28.2)

### Problema
4 módulos Ranking en producción tenían estructura legacy (título + descripción + slider tipo select con rango 1-5). No mostraban los inputs para agregar items ni el editor de ranking-list. Además, el `module_templates.Ranking` seguía con esa misma estructura legacy, así que cualquier Ranking nuevo se creaba roto.

### Corrección
- Migrados los 4 módulos directamente en MySQL de producción: reemplazada la estructura por `question-title` (input) + `items` (ranking-list). Títulos existentes preservados.
- Actualizado `module_templates.Ranking` a la estructura correcta.
- Verificación: 0 módulos Ranking rotos, 31/31 con estructura correcta.

---

## Sesión 12: 18 de marzo de 2026 — Heatmap, AOI, Ranking, hitzone fix (v0.28.1)

### Cambios realizados

#### Heatmap con gradiente de intensidad
Canvas offscreen con círculos aditivos → colorización blue→purple→red→yellow→white con alpha 50%.

#### AOI (Areas of Interest)
Botón "+ Add AOI" en tab Heat click map. Dibuja rectángulos sobre el heatmap, calcula % de participantes únicos dentro del área. Fila con miniatura, label, %, count, filtro, Remove.

#### Ranking rediseñado
- **Builder**: inputs con selector Qualify/Disqualify, botón "Add another choice", checkbox "Randomize the order of questions".
- **Results**: histograma de barras verticales por posición para cada opción, ordenado por mean.

#### Hitzone: root cause encontrado y corregido
- **Resultados**: hitzones se pasaban en píxeles al SVG con viewBox 0-100 → ahora se convierten a % usando dimensiones naturales de la imagen.
- **Participant**: `getClickableRect()` tenía fallback al container fullscreen cuando la imagen no estaba lista → coordenadas de click desfasadas → todos los clicks incorrectos. Eliminado el fallback cuando hay hitzones.
- **Editor**: contenedor ampliado a 700px de alto para que las áreas dibujadas sean proporcionales.

#### Eliminar módulo
Botón basurero en SmartVOC y Cognitive Task cards con modal de confirmación. Llama `DELETE /research/:id/modules/:moduleId`.

---

## Sesión 11: 17 de marzo de 2026 — Results UI polish & NavigationFlow (v0.28.0)

### Cambios realizados

#### SmartVOC: filtros demográficos funcionales
- Backend ahora incluye `participantId` en todos los score arrays (CSAT, CES, CV, NPS, NEV).
- SmartVOC Results usa los mismos filtros demográficos que Cognitive Tasks: checkboxes + User ID filtran todas las métricas.
- MetricCard charts (CSAT, CES, CV) cambian con Today/Week/Month — antes siempre mostraban datos mensuales.

#### Fix: demographics no se guardaban en `participant_demographics`
- Root cause: `usePreviewMode` trataba participantes sin `?participantId` como preview → `validateDemographics` se saltaba → datos demográficos nunca se persistían.
- Fix: solo se salta para `?preview=true` explícito; siempre se envía un participantId al backend.

#### Limpieza UI de resultados
- Quitado banner "New data obtained" del panel Filters.
- Quitados botones duplicados "Copiar todos" / "Descargar CSV" de la tabla de comentarios (queda "Descargar comentarios").
- Short/Long Text ya no muestra "Positive" hardcodeado en columna Mood.
- Navigation Flow Results: todos los steps expandidos por defecto.

#### NavigationFlow (participant): mejoras de confiabilidad
- URLs de imágenes ya no se filtran — se mantiene la alineación de índices con `propImages`.
- Polling de 100ms como safety net para imágenes cacheadas donde `onLoad` dispara antes de que el ref esté listo.
- Clicks fuera del hitzone ahora muestran punto rojo (antes eran silenciosos).

### Deploy
Commits `48cf249`, `0a2821d`, `19b5113` — CI/CD auto-desplegó backend, research-frontend y participant-frontend.

---

## Sesión 10: 17 de marzo de 2026 — Stress test de cuotas (v0.27.3)

### Cambios realizados

#### Script: stress-test-quotas.ts
Script E2E standalone (`npx tsx scripts/stress-test-quotas.ts`) que valida el enforcement atómico de cuotas demográficas:

1. Registra un usuario temporal, crea una investigación kiosk con cuotas ajustadas (gender limit 3, age limit 2 por bucket)
2. Lanza 10 participantes concurrentes contra `validate-demographics` (que usa `tryIncrementQuota`)
3. Verifica que ningún bucket excede su límite y reporta PASS/FAIL
4. Archiva la research al terminar

Ejecutado 2 veces en producción — **PASS** en ambas. Las cuotas atómicas funcionan correctamente bajo concurrencia real.

### Archivos creados
- `scripts/stress-test-quotas.ts`

### Observación
Todos los participantes concurrentes obtienen `kiosk-1` como participantId (race condition en el contador de sesiones kiosk). No afecta la validación de cuotas pero es un detalle a considerar.

---

## Sesión 9: 17 de marzo de 2026 — Cuotas atómicas (v0.27.2)

### Cambios realizados

#### Fix: Race condition en cuotas demográficas
**Problema:** `checkQuotaAvailability` (validación) e `incrementQuota` (incremento) eran operaciones separadas. Bajo concurrencia, dos participantes podían pasar la validación simultáneamente antes de que se incrementara el contador, excediendo el límite.

**Solución:** Nueva función `tryIncrementQuota` que dentro de una transacción con `FOR UPDATE`:
1. Valida disqualifications (JS puro)
2. Guarda `participant_demographics`
3. Incrementa con `UPDATE ... WHERE current_count < quota_limit` — si `rowCount = 0`, la cuota está llena
4. Si alguna cuota falla, revierte los incrementos previos y retorna `QUOTA_FULL`

`validateDemographics` en `public.service.ts` ahora abre la transacción y llama `tryIncrementQuota`. El bloque de `incrementQuota` en `saveParticipantResponses` fue eliminado.

### Archivos modificados
- `backend/src/modules/quotas/quota.service.ts` — nueva `tryIncrementQuota`, deprecated en las antiguas
- `backend/src/modules/public/public.service.ts` — `validateDemographics` con transacción atómica, eliminado incremento en `saveParticipantResponses`
- `backend/src/modules/public/public.controller.ts` — pasa `participantId` al servicio
- `participant-frontend/src/services/public.service.ts` — envía `participantId` en el body
- `participant-frontend/src/pages/ResearchPage.tsx` — pasa `participantId` a `validateDemographics`

---

## Sesión 7: 16 de marzo de 2026 — Module-to-module conditionality (v0.27.0)

### Cambios realizados

#### Feat: Condicionalidad entre preguntas del estudio
**Contexto:** Hasta ahora la condicionalidad solo permitía mostrar/ocultar un módulo según una respuesta demográfica. Se necesitaba poder condicionar según la respuesta a otra pregunta (Single/Multiple Choice).

**Implementación:**
1. **Tipos** (`moduleRequired.ts`) — `ConditionalityConfig` es ahora union de `DemographicConditionality` y `ModuleConditionality`. Type guards para distinguirlas.
2. **ConditionalityModal** — Selector "Condition source" (Demographic / Study question). Al elegir study question: lista módulos choice anteriores por `orderIndex`, checkboxes para seleccionar opciones.
3. **ResearchBuilderPage** — Computa `studyModulesWithOptions` desde los módulos Single/Multiple Choice, lo pasa a ambos ModuleCards.
4. **ModuleCards** — Forwarded al modal, display del resumen de condición adaptado a ambos tipos.
5. **useNavigation** (participant) — Evalúa condiciones de módulo comparando respuesta almacenada vs `selectedValues`. Single=match directo, Multiple=any match.
6. **ResearchPage** (participant) — Construye `moduleResponses` reactivo desde el store y lo pasa a `useNavigation`.

### Archivos modificados
- `research-frontend/src/utils/moduleRequired.ts`
- `research-frontend/src/components/research/ConditionalityModal.tsx`
- `research-frontend/src/components/research/SmartVOCModuleCard.tsx`
- `research-frontend/src/components/research/CognitiveTaskModuleCard.tsx`
- `research-frontend/src/pages/research/ResearchBuilderPage.tsx`
- `participant-frontend/src/hooks/useNavigation.ts`
- `participant-frontend/src/pages/ResearchPage.tsx`

### Verificación E2E (sesión 8, 16 de marzo)
Se trazó el flujo completo de condicionalidad módulo-a-módulo desde el builder hasta el participante:
- **Persistencia:** `conditionalityConfig` se guarda íntegro en la columna `config` (JSON) del módulo. Sin transformaciones ni stripping.
- **Entrega:** La API pública (`GET /public/research/:id`) devuelve el config completo, incluyendo `conditionalityConfig`.
- **Alineación de IDs:** Builder, modal y renderer usan el mismo `c.id` de los componentes choice. No hay desalineación.
- **Evaluación:** `useNavigation` compara correctamente `response.value` contra `selectedValues`.
- **Cache:** El endpoint público cachea 1 minuto (preview lo bypasea, no afecta testing del investigador).

Resultado: flujo sólido, listo para verificar en producción post-deploy.

---

## Última actualización previa: 2026-03-09 (sesión 6)

---

## Sesión 6: 9 de marzo de 2026 — Navigation Flow UX fixes (v0.20.2)

### Cambios realizados

#### Fix: Mejoras UX en Navigation Flow del participant-frontend
**Problema:** El cliente reportó 5 issues en el flujo de Navigation Flow:
1. Cursor de cruz poco intuitivo
2. Última imagen requería click preciso en hitzone
3. Delay de 500ms se sentía lento
4. Puntos rojos por clicks incorrectos confundían ("árbol de navidad")

**Solución (4 cambios en `NavigationFlow.tsx`):**
1. **Cursor** — `cursor-crosshair` → `cursor-pointer` (manito)
2. **Última imagen** — Si `isLastImage`, cualquier click en la imagen cuenta como correcto (toda la imagen es hitzone)
3. **Avance rápido** — Delay reducido de 500ms a 200ms entre imágenes; última imagen avanza de inmediato
4. **Sin puntos rojos** — `clickPoints` solo recibe clicks correctos; clicks incorrectos solo van a `allClicks` para analytics

### Archivos modificados
- `participant-frontend/src/components/ui/NavigationFlow.tsx`
- `CHANGELOG.md`
- `BITACORA.md`

### Deploy
- Push a main → CI/CD despliega participant-frontend automáticamente

### Pendientes
- Verificar compatibilidad cross-browser (Opera vs Chrome) — requiere testing manual en producción
- SmartVOC participantId investigation
- Migración BD pendiente (sesión 2)

---

## Sesión 5: 9 de marzo de 2026 — Deploy masivo v0.17.0 → v0.20.1

### Deploy a producción

Deploy completo de los 3 componentes a cPanel. Incluye todo el trabajo acumulado desde la Sesión 4 (4 de marzo) que no había sido desplegado.

**Componentes desplegados:**
| # | Componente | Estado | URL |
|---|------------|--------|-----|
| 1 | Backend | ✅ 200 | `emotio.cx/api/health` |
| 2 | Research Frontend | ✅ 200 | `emotio.cx/research/` |
| 3 | Participant Frontend | ✅ 200 | `emotio.cx/participant/` |

**Versiones incluidas en este deploy:**
- **v0.17.0** — Location Granularity (countryOnly / countryCity)
- **v0.18.0** — Participant i18n (react-i18next)
- **v0.18.1** — Participant vendor chunk fix
- **v0.19.0** — Explicit Continue buttons
- **v0.19.2** — PreferenceTest & CognitiveTaskRenderer cleanup
- **v0.19.4** — Unified footer button, custom dropdowns & lightbox UX
- **v0.19.5** — SmartVOC auto-advance & Research URL fix
- **v0.19.6** — Fullscreen Navigation Flow
- **v0.20.0** — Real-time SmartVOC Results (SSE)
- **v0.20.1** — SmartVOC auto-advance fix + NEV emotion rules

### Pendientes
- Ninguno

---

## Sesión 4: 4 de marzo de 2026 — Location Granularity (v0.17.0)

### Cambios realizados

#### Feature: Granularidad geográfica configurable por investigación
**Problema:** La estructura de ubicación estaba hardcodeada — Chile tenía 3 niveles (país→región→comuna) y todos los demás países solo 1 nivel. El investigador no podía elegir qué nivel de detalle geográfico pedir.

**Solución (5 fases + simplificación, 5 commits):**

1. **Tipos** — Creado `LocationGranularity` (`countryOnly | countryCity`) en los 3 sub-proyectos:
   - `research-frontend/src/utils/demographicsMapper.ts` (exportado)
   - `backend/src/modules/quotas/quota.service.ts`
   - `participant-frontend/src/components/steps/DemographicsStep.tsx`

2. **Mapper** — `mapCountryConfigToBackend` acepta y serializa `granularity` (default `countryOnly`). `mapModalConfigToBackend` lo pasa al caso country.

3. **UI Investigador** — Selector visual de granularidad (2 radio cards: "Solo país" / "País + Ciudad") en `CountryConfigModal`. Se persiste en el JSON del módulo Research Configuration. `ResearchConfigurationModule` lee/escribe `initialGranularity`.

4. **UI Participante** — `DemographicsStep` reemplazó el hardcode `=== 'Chile'` por lectura de `granularity` del config. Si `countryCity`, muestra un campo de texto libre para ciudad debajo del selector de país.

5. **Limpieza** — Eliminado `chile-geography.ts` de ambos frontends. Eliminada validación hardcodeada de regiones/comunas de Chile del backend. Verificado que el backend no rompe (usa `Object.entries` dinámico, sin validación estricta de schema).

### Archivos modificados
- `research-frontend/src/utils/demographicsMapper.ts`
- `research-frontend/src/components/research/CountryConfigModal.tsx`
- `research-frontend/src/components/research/ResearchConfigurationModule.tsx`
- `research-frontend/src/data/chile-geography.ts` (eliminado)
- `participant-frontend/src/data/chile-geography.ts` (eliminado)
- `backend/src/modules/quotas/quota.service.ts`
- `participant-frontend/src/components/steps/DemographicsStep.tsx`
- `CHANGELOG.md`

### Pendientes
- ~~Deploy a producción~~ (completado en Sesión 5)

---

## Sesión 3: 17 de febrero de 2026 — Fix preview mode (step reset + sidebar)

### Cambios realizados

#### Fix: Preview mode mostraba el último step visitado
**Problema:** Al acceder a una URL de preview (`?preview=true`), el participant-frontend mostraba el último step que el usuario había visitado previamente (ej. Thank You) en lugar del primero (Welcome). Causado por:
- `useParticipantStore` persiste `currentStep` en localStorage
- El efecto de reset de participante hace early return cuando `participantId` es null (preview mode)
- La lógica de reset solo reseteaba si el step guardado no existía en la lista de steps habilitados

**Fix:** En `ResearchPage.tsx`, agregar `isPreviewMode` a la condición de reset: cuando es preview, siempre se resetea al primer step disponible.

#### Fix: Sidebar no visible en producción para preview mode
**Problema:** El `DevSidebar` solo se renderizaba cuando `import.meta.env.DEV === true`. En producción (cPanel), los investigadores no podían navegar entre módulos al hacer preview.

**Fix:** Cambiar condición de `isDev` a `isDev || isPreviewMode` para que el sidebar sea visible para investigadores en preview.

### Deploy
- participant-frontend desplegado a producción (cPanel)

---

## Sesión 2: 17 de febrero de 2026 — Resolución de deuda técnica

### Cambios realizados

#### Fase 1: Variables no usadas + directivas ESLint obsoletas
- Eliminados catch variables no usados en `ResearchBuilderSidebar.tsx`, `StandardSidebar.tsx`, `UserManagementPage.tsx`, `modules.service.ts`
- Eliminadas props destructuradas no usadas en `DemographicConfigModalBase.tsx` (4 props) y `QuotasTab.tsx` (1 prop)
- Eliminados 2 comentarios `eslint-disable-next-line` obsoletos en `EditableComponent.tsx`

#### Fase 2: Reemplazar `any` con tipos propios
- Creada interfaz `ModuleTemplateRef` en `researchTypes.service.ts`
- Tipados `useResearchForm.ts`, `ResearchFormStep2.tsx` con `ModuleTemplateRef`
- Creadas interfaces `ModuleComponent`, `ModuleConfigStructure`, `HitzoneRegion` en `NavigationFlowResultsWrapper.tsx`
- Creadas interfaces `ModuleComponent`, `ModuleConfigStructure`, `UploadedFileData` en `PreferenceTestResultsWrapper.tsx`
- Creada interfaz `BackendQuota` en `ResearchConfigurationModule.tsx`
- Tipados `demographicsMapper.ts` (enforcementMode union)
- Tipados `DemographicsStep.tsx` y `DemographicsStep.test.tsx` en participant-frontend
- Casos donde `Record<string, any>` es genuinamente necesario (demographics config dinámico) marcados con `eslint-disable`

#### Fase 3: Sync rankingConfig.items al guardar
- Agregada función `syncRankingConfig` en `ResearchBuilderPage.tsx`
- Aplicada en los 3 handlers de save (Smart VOC, Cognitive Tasks, módulo activo)

#### Fase 4: Eliminar image-upload muerto de seeds
- Eliminado componente `image-upload` de 6 templates de Cognitive Tasks en `seed_all_module_templates_pg.ts`
- Creado script de migración `remove_image_upload_from_modules.ts` (pendiente de ejecutar en producción)

#### Fase 5: Hooks de React — exhaustive-deps
- Fix `ResearchBuilderSidebar.tsx`: condición alineada con dep array (`activeResearch?.id`)
- Fix `ResearchConfigurationModule.tsx`: inlineado `buildParticipantShareUrl` en useMemo, eliminadas funciones muertas
- Suprimido warning en useEffect de flush demográfico (agregar deps causaría loop infinito)
- Agregado `backlinks.complete` a useCallback en `ResearchPage.tsx`

### Resultado
- **research-frontend**: 0 errors, 0 warnings (lint + build)
- **participant-frontend**: 0 errors, 0 warnings (lint + build)
- **backend**: type-check OK
- Pre-commit hooks: pendiente de verificar en commit

### Pendientes
- Ejecutar migración `remove_image_upload_from_modules.ts` en producción (BD)
- Deploy a producción (opcional, no hay cambios funcionales visibles)

---

## Sesión 1: 17 de febrero de 2026

> ~5 horas (08:00 – 13:15 CLT)
> 10 commits (`eb56965`..`3b2ed0e`) · 12 archivos modificados · 2 deploys a producción · 3 migraciones en BD

### Contexto inicial

El módulo **Ranking** en Cognitive Tasks no funcionaba correctamente: mostraba un selector genérico en vez del editor de items. A partir de ahí se descubrieron y corrigieron múltiples problemas encadenados.

### Cambios realizados

#### 1. Fix del módulo Ranking en research-frontend (`eb56965`, `334a873`)

**Problema:** El seed template usaba `type: 'ranking-list'`, pero `EditableComponent.tsx` solo tenía `case 'ranking'`. El tipo caía al default y se renderizaba como select.

**Fix:**
- Agregado `'ranking-list'` a `ComponentType` en `moduleBuilder.types.ts`
- Extraído `RankingItemsEditor` como componente standalone en `EditableComponent.tsx`
- Agregado `case 'ranking-list':` al switch
- Migración en BD: 24 módulos Ranking actualizados via `fix_ranking_module_config_mysql.ts`

#### 2. Fix de módulos ocultados automáticamente al guardar (`513bb28`)

**Problema:** `ResearchBuilderPage.tsx` calculaba `finalHidden = !hasModuleConfiguredValues(...)`, marcando como hidden cualquier módulo sin datos. Navigation Flow y Preference Test quedaban en blanco.

**Fix:**
- Save ahora usa `moduleRef.getHidden()` (toggle explícito del investigador)
- Toggle Hide visible en todos los entornos (removida restricción `isLocalhost()`)
- BD: corregido `hidden: false` en módulos afectados

#### 3. Fix de resolución de URLs de media — research-frontend (`513bb28`)

**Problema:** Backend devuelve URLs relativas (`/api/media/...`). En localhost, el browser las resolvía contra `localhost:12800` → 404.

**Fix:** `resolveMediaUrl()` centralizado en `media.service.ts` convierte rutas relativas a absolutas contra el origen del backend.

#### 4. Fix de re-mount del FileUploadEditor (`513bb28`)

**Problema:** Escribir en textarea de Navigation Flow/Preference Test causaba parpadeo de imágenes. `FileUploadEditor` estaba definido inline dentro del switch case → React lo re-montaba en cada render.

**Fix:** Extraído `FileUploadEditorComponent` como componente standalone. Default case retorna `null` silenciosamente.

#### 5. Fix del participant-frontend: sync-runtime-config (`12be6c5`)

**Problema:** `npm run dev` fallaba al intentar descargar config de CloudFront (AWS ya no existe).

**Fix:** URL default cambiada a `https://emotio.cx/participant`.

#### 6. Fix del participant-frontend: config service en dev mode (`e27c51c`)

**Problema:** "Initialization failed — AWS backend" al abrir preview en localhost. Config service buscaba `/participant/runtime-config.json` pero Vite sirve `public/` en raíz.

**Fix:**
- Busca primero `/runtime-config.json`, luego `/participant/runtime-config.json`, con fallback a `https://emotio.cx/api`
- Default API URL: `https://emotio.cx/api` (no hay backend local)

#### 7. Fix del participant-frontend: resolución de URLs de media (`af65c4e`)

**Problema:** Imágenes no cargaban en participant-frontend local. Mismo problema de URLs relativas.

**Fix:** `resolveMediaUrl()` agregada a `media.service.ts` del participant-frontend.

### Deploys a producción

| # | Hora | Qué |
|---|------|-----|
| 1 | ~09:30 | research-frontend: fix Ranking + migración BD |
| 2 | ~12:25 | research-frontend: fix Hide, media URLs, FileUpload re-mount |

### Migraciones ejecutadas en BD (MySQL cPanel)

1. `fix_ranking_module_config_mysql.ts` — 24 módulos Ranking → estructura ranking-list
2. UPDATE manual — Ranking de "Clemente probando": removido image-upload, agregado question-description
3. UPDATE manual — Navigation Flow, Preference Test + 1: `hidden=false`

---

## Estado actual del proyecto (2026-02-17)

### Lo que funciona
- **research-frontend**: Dashboard, Research Builder con todos los stages, todos los módulos Smart VOC y Cognitive Tasks editables (Ranking, Single/Multiple Choice, Short/Long Text, Linear Scale, Navigation Flow, Preference Test). Save Changes preserva datos y respeta toggle Hide. Imágenes cargan en local y producción.
- **participant-frontend**: Preview mode funcional en local y producción. Imágenes de Navigation Flow y Preference Test cargan correctamente. Config se resuelve automáticamente.
- **backend**: API estable en cPanel, media serving funcional, analytics endpoints operativos.

### Problemas conocidos pendientes
- Textos en español en algunos comentarios y variables del código
- Migración BD pendiente: `remove_image_upload_from_modules.ts` (limpiar image-upload de módulos existentes)
