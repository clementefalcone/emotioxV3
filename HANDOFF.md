# HANDOFF — EmotioX V3

Actualizado: 2026-10-27 · Versión: v0.99.25 · Producción = `main` local (backend, research y participant desplegados hoy). `main` va 28 commits por delante de `origin/main`: falta `git push`.

## Estado actual

- **Website Tracking — cámara opt-in (v0.99.24–25):** la cámara nunca arranca sola. Primera visita: footer (es/en según la página) con "Activar cámara" / "Entendido"; después una píldora abajo a la derecha la enciende o apaga. La elección (`_ecx_cam_<id>`) se guarda solo cuando la cámara funciona; en páginas siguientes se retoma sin pantallas solo si la calibración tiene < 10 min. Con consentimiento obligatorio, el banner suma "Aceptar y activar cámara". Textos escapados a ASCII. Fallos de carga de face-api tras `pagehide` no se reportan.
- **Website Tracking — calibración de Eye Tracking en sitios (v0.99.19):** el snippet carga `participant/embed/eye.js` (mismas pantallas que el módulo ET, en shadow root). Selector 5/9 puntos eliminado.
- **Website Tracking — medidas de mirada (v0.99.20–21):** cuadrante desde la mirada calibrada (3×3 de la ventana), fijaciones a 20 Hz. Visitas con calibración "low" fuera de la cuadrícula de cuadrantes y zonas (misma regla `dropLowQuality` en `tracking-gaze.analytics.ts`); aviso en la pestaña Attention.
- **Eye Tracking — calibración a pantalla completa (v0.99.22):** los puntos cubrían solo el área bajo las instrucciones y el centro de la calibración caía debajo del estímulo en teléfonos (12/12 respuestas de teléfono con 49–100% en la fila inferior; `kiosk-13` con 0 fijaciones → LOW). Ahora cubren toda la pantalla; las instrucciones flotan en la mitad opuesta al punto.
- **Encuestas en iframe (v0.99.23):** participant responde `frame-ancestors 'self' https:` (antes `X-Frame-Options: SAMEORIGIN` bloqueaba el iframe del cliente). Escrito por `deploy-participant-frontend-cpanel.sh`.
- **Otros:** etiquetas de mes de History sin depender del locale; `deploy-backend-cpanel.sh` avisa si el build remoto muere.

## Qué falta

1. **Prueba real de Pamela** (teléfono y computador, link de participante sin `?preview=true`, navegador nuevo o tras 10 min) para confirmar que v0.99.22 saca a los teléfonos de LOW.
2. **Precisión en computadores:** errores de calibración 214–649 px (solo `kiosk-7` bajo 200). El arreglo de hoy corrige dónde cae la mirada, no el error.
3. **Shelf con 3 puntos de mirada** (`kiosk-13`, integridad 0,03): causa desconocida.
4. **Umbral de 200 px** igual para monitor y teléfono (157 px = 40% de un teléfono de 390 px).
5. **Congelamiento de 2,8 s al cerrar la calibración** (medido con GPU; probable `trainRidge`). Afecta ET y Website Tracking.
6. **Website Tracking:** mirada ~600 px a la izquierda de los clics en `c23d9543` (ver con sesión nueva); hueco de 8 s al iniciar captura en producción no reproducido; sesiones antiguas aún usan `quadrantProbs` (iris sin calibrar).
7. **Encuesta desde el snippet** (no construido): disparador, tope por visitante, `ECX=<visitor_id>`, cierre con `postMessage` al terminar.
8. **Infra:** el deploy de participant vacía la carpeta remota antes de copiar 121 MB (sitio a medio subir unos minutos); causa del build remoto muerto (límites LVE) sin confirmar.

## Ficheros clave

| Tema | Archivo |
|---|---|
| Snippet Website Tracking | `backend/src/modules/tracking/tracking-snippet.ts` (cámara opt-in, `viewportQuadrant`, `sampleFixation`, `reportModelFailure`) |
| Analítica mirada / zonas | `backend/src/modules/tracking/tracking-gaze.analytics.ts`, `tracking-zones.analytics.ts` |
| Embed calibración | `participant-frontend/src/embed/` (`eye.tsx`, `EyeCalibrationFlow.tsx`, `eyeSession.ts`), `vite.embed.config.ts` |
| Calibración ET | `participant-frontend/src/components/renderers/eye-tracking/CalibrationPhase.tsx`, `useCalibrationSequence.ts` |
| Captura ET participante | `participant-frontend/src/components/renderers/EyeTrackingRenderer.tsx` |
| Analítica ET | `backend/src/modules/analytics/eye-tracking.analytics.ts` (`classifyQuality`, umbral 200 px) |
| Pestaña Attention | `research-frontend/src/components/results/website-tracking/TrackingAttentionTab.tsx` |
| Deploy | `scripts/deploy-*-cpanel.sh` (participant escribe el `.htaccess`) |

## Preguntas abiertas

- ¿El texto del footer de cámara debe ser configurable por estudio/cliente? Hoy es fijo en el snippet.
- ¿Umbral de calidad relativo al tamaño de pantalla en vez de 200 px fijos?
- ¿El iframe se restringe a los dominios del estudio (requiere cabecera desde el backend) o queda abierto a cualquier HTTPS?
- ¿La encuesta en modal desde el snippet se cobra con Website Tracking o aparte?
- `docs/emociones.jpeg`, `docs/net.jpeg`, `docs/problema1.jpeg` sin commitear: ¿van al repo?
- Con la cámara opt-in llegarán muchos menos datos de emociones y mirada: ¿se acepta para los estudios activos?
