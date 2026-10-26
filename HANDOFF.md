# HANDOFF — EmotioX V3

Actualizado: 2026-10-26 · Versión: v0.99.18 · Producción = `main` (backend y research desplegados hoy; participant sin cambios).

## Estado actual

- **Website Tracking (v0.99.18):** revisión forense completa, 16 correcciones medidas en producción (ver CHANGELOG). Integridad (visitas, lock de lotes, tope rrweb 16 MB, snapshots con URL normalizada), acceso por estudio, botón "Saltar" en cámara, mirada solo con Gaze Tracking, emociones sin WebGL. Webcam video, mouse-attention y rutas sin uso eliminados. Proxies en `proxy-rewrite.ts`.
- **Eye Tracking — unidad de la mirada:** fijaciones y mirada en video se guardan en % del estímulo (`fixationUnit` / `gazeTimelineUnit: 'stimulus-percent'`). El backend lee respuestas viejas con la conversión anterior; las líneas de tiempo de video viejas ya no se muestran.
- **Shelf:** sin recorte, misma góndola en teléfono y escritorio, una regla de columnas compartida (`shelfLayout` en participant y research), barajado una vez por participante guardado en `shelfColumnOrder` y reubicado en el backend.
- **Resultados ET:** AOIs y promedios se calculan con el grupo en pantalla (`?moduleId=&participants=`). Margen de AOI por eje y fijaciones repartidas entre AOIs cercanas (suma ≤ 100%). Aviso cuando todos quedan excluidos por calibración.
- **Evaluación de emociones (fase 1):** `/test/expression-capture` graba con instrucciones y tiempos exactos; `/test/expression-eval?dataset=<carpeta>` puntúa face-api y MediaPipe blendshapes por unidad de acción. Probado con un video real, sin grabación etiquetada todavía.

## Qué falta

- **Website Tracking:** (a) servidor guarda máx. 50 eventos por envío y el snippet puede mandar más — sin medir; (b) `url( "…" )` con espacios en CSS proxificado no se reescribe; (c) emociones y mirada nunca se activaron en estudios reales — activar en uno para tener datos; (d) prueba real en producción con cámara (el test forense fue local).
1. **Grabación etiquetada** con `/test/expression-capture` (6 min). Guardar en `participant-frontend/eval/datasets/expressions-<fecha>/` (`video.webm`, `ground-truth.json`, `metadata.json`) y abrir `/test/expression-eval?dataset=expressions-<fecha>`.
2. **Decidir face-api vs blendshapes** con esos números.
3. **Fase 2 (20 personas):** cambiar la captura para procesar en el navegador y guardar solo cambios respecto a la cara neutra (no video); revisión legal del consentimiento.
4. **Prueba real con cámara** (Shelf y video) con el link del estudio, no vista previa: confirmar que la respuesta trae `fixationUnit`, `shelfColumnOrder`, `gazeTimelineUnit`, y que la góndola no cambia al final en teléfono.
5. **Calificación de calibración:** el umbral de 200 px excluye a todos (error real 214–649 px). Pendiente calificar por tamaño de AOI.

**Decisión (2026-10-24):** no usar tecnología ni datos que requieran licencia de terceros (DISFA, AM-FED+, SEWA, AffectNet, etc.). La referencia para calibrar emociones son grabaciones propias con consentimiento.

## Ficheros clave

| Tema | Archivo |
|---|---|
| Captura ET participante | `participant-frontend/src/components/renderers/EyeTrackingRenderer.tsx` |
| Góndola | `participant-frontend/src/components/renderers/eye-tracking/ShelfGrid.tsx`, `.../shelfLayout.ts`, `research-frontend/src/utils/shelfLayout.ts` |
| Analítica ET | `backend/src/modules/analytics/eye-tracking.analytics.ts` (`placeInShelfColumn`, `computeEyeTrackingMetrics`) |
| AOIs | `backend/src/modules/analytics/aoi-metrics.ts` (`softAoiWeight`, reparto) |
| Resultados ET | `research-frontend/src/components/results/eye-tracking/StimulusCard.tsx`, `useScopedEyeTrackingStimulus.ts`, `AllExcludedNotice.tsx`, `VideoGazePlayer.tsx` |
| Evaluación emociones | `participant-frontend/src/lib/expressionEval/` (`protocol.ts`, `metrics.ts`, `blendshapeActionUnits.ts`), `src/pages/ExpressionCapturePage.tsx`, `ExpressionEvalPage.tsx` |
| Consentimiento | `docs/consentimiento-captura-expresiones.md` |
| Website Tracking | `backend/src/modules/tracking/` (`tracking.controller.ts`, `tracking.service.ts`, `tracking-snippet.ts`, `proxy-rewrite.ts`, `public-fetch.ts`) |

## Preguntas abiertas

- ¿Se activan emociones/mirada en `d3e0822b` o `1d673c9f`? Hoy están apagadas, por eso hay 0 datos.
- ¿Qué umbral de calidad de calibración se considera aceptable para mostrar resultados por defecto?
- ¿Las 17 respuestas Shelf de prueba (sin orden de columnas ni unidad) se borran o se dejan?
- Estudio archivado `0f300142`: 9 productos en 3 columnas (6 nunca se mostraron). ¿Se corrige o se deja?
- ¿Se quiere vender "esfuerzo mental"? Con webcam no es viable; requeriría eye tracker infrarrojo.
- Orden de despliegue: backend siempre antes que participant cuando cambia el formato de respuesta.
