# HANDOFF — EmotioX V3

Actualizado: 2026-10-30 · Versión: v0.99.38 · Producción = `main` local (backend y research desplegados hoy; participant el 2026-10-30 con v0.99.35). `main` va 16 commits por delante de `origin/main`: falta `git push`.

## Estado actual

- **IAT Objects Comparing / "IAT clásico" (v0.99.36–38):** Results calcula cada objeto por % de elecciones Positivo/Negativo (antes por tiempos de reacción → barras vacías) y el desglose por atributo (`criteriaScores`). Pestañas "Desempeño por lugar", gráfico por atributo, radar de atributos. Etiqueta Positivo visible; "Perfil por objeto" quitado.
- **IAT fiabilidad (v0.99.37):** `responseQualities[]` por participante (`too_fast` > 30 % < 300 ms, `same_choice` ≥ 95 % iguales, `reliable`). Botones "Todos / Solo fiables" por IAT; nada se borra. Endpoint acepta `moduleId` y `participants` y recalcula. Los filtros demográficos del panel ahora también recalculan el IAT.
- **IAT raw data (v0.99.38):** botón "Descargar raw data" por IAT → Excel (Trials, Participantes, Leyenda) con atributo, respuesta, RT, calidad y demografía. Raw trials del backend traen `attributeLabel`, `trialNumber`, `moduleId`.
- **Website Tracking cámara (v0.99.35):** emociones y mirada Off / Optional / Required por separado; "Saltar calibración (solo emociones)".
- **Eye Tracking (v0.99.32–34):** warm-up de face-api (sin congelamiento), blendshapes eyeLook + ridge lineal (mejor vertical), calidad relativa al ancho de pantalla, todos los participantes visibles con filtro de fiabilidad.
- **Infra:** cPanel tiene cuota 20 GB / 300.000 archivos. Se borraron 122 copias `public_html/*.backup.*` y los scripts de deploy de frontend ya no las crean (12,2 GB usados; archivos 294k de 300k — cerca del límite).

## Hallazgos del estudio "Exploracion Mercado" (dd5420e1)

- Curacaví es el lugar con menos Positivo en ambos IAT (75 % / 77 % vs 80–84 %); diferencia significativa. Chicureo, Cajón del Maipo y Algarrobo sin diferencia significativa entre sí.
- "Lejos" es el único atributo dividido (≈50 %); Semana santa y Desconexión los más débiles.
- ~1/3 de participantes poco fiables (IAT 1: 30 siempre igual + 15 rápidos de 102; IAT 2: 14 + 21 de 101).
- Excel hecho a mano para el reporte: `~/Downloads/Exploracion_Mercado_IAT_raw_data.xlsx`.

## Qué falta

1. **Inodos del hosting** al 98 % (294k/300k): mayores consumidores `~/emotioxv3/backend/node_modules`, `~/emotioxv3/backend-dev`, `~/emotioxV3` (copia antigua), `~/.npm`. Preguntar antes de borrar.
2. **Precisión de mirada en móviles** y sesiones kiosk-8/11/14/16 trabadas tras el screener (falta pantalla y navegador exactos).
3. **AbortError** al iniciar la cámara del segundo módulo ET.
4. Revisar `calibrationRmsePx` de sesiones nuevas tras v0.99.33.
5. UI de fiabilidad de Eye Tracking y del IAT no vista con sesión real (solo en página de prueba con datos reales).
6. El "Export CSV" general (`export.service.ts`) aún entrega raw trials del IAT sin atributo y traga errores (`catch → []`).

## Ficheros clave

| Tema | Archivo |
|---|---|
| Analítica IAT | `backend/src/modules/analytics/iat.analytics.ts` (`computeChoiceShares`, `computeResponseQualities`, `getIATRawTrials`) |
| Results IAT | `research-frontend/src/components/results/implicit-association/` (`ImplicitAssociationResults.tsx`, `IATReliabilityFilter.tsx`, `iatRawDataExport.ts`) |
| Etiquetas demográficas | `research-frontend/src/components/results/shared/demographicLabels.ts` |
| Snippet Website Tracking | `backend/src/modules/tracking/tracking-snippet.ts` |
| Analítica ET | `backend/src/modules/analytics/eye-tracking.analytics.ts` |
| Deploy | `scripts/deploy-*-cpanel.sh` |

## Preguntas abiertas

- Umbrales de fiabilidad IAT (95 % misma respuesta, 30 % < 300 ms): ¿adecuados o configurables por estudio?
- ¿El raw data debería respetar los filtros activos? Hoy siempre incluye a todos.
- "Alpha heatmap" en video (Attention Prediction): pregunta sin aclarar.
- `docs/emociones.jpeg`, `docs/net.jpeg`, `docs/problema1.jpeg` sin commitear: ¿van al repo?
