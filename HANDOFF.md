# HANDOFF — EmotioX V3

Actualizado: 2026-11-01 · Versión: v0.99.60 · Producción = `main` = `origin/main` (backend, research y participant desplegados hoy).

## Hecho en esta sesión (v0.99.39 → v0.99.58)

Resultados:
- Progreso: el Screener cuenta solo si tiene respuesta real; ningún participante quedaba al 100 %.
- Aviso "ningún participante cumple el filtro" en IAT, SmartVOC, Cognitive Tasks, Eye Tracking y Screener. El Screener respeta los filtros (0–100 %).

Protección de datos (Ley 21.719 / GDPR), Eye Tracking y Website Tracking, uno a la vez:
- **Consentimiento:** se registra en `consent_records` (migración 034) con el texto exacto, su sha256, el idioma y la decisión (acepta, rechaza o retira). Tiene botón de rechazo en Eye Tracking y Emotion Analysis, y casilla de mayoría de edad antes de la cámara y del tracking.
- **Aviso de privacidad por estudio:** responsable, email y URL de la política. Se configura en `PrivacyContactSection`.
- **Retención:**
  - Cron diario 03:30 con `dist/scripts/purge-expired-data.js`. Tracking 90 días por defecto; biometría 12 meses, configurable a 3, 6, 12 o 24 meses.
  - Respaldo gzip NDJSON en `~/retention-backups`, que se borra a los 7 días (solo archivos `retention-*`).
- **Snippet de Website Tracking:**
  - Solo graba después de aceptar, con texto enmascarado y sin `targetText`.
  - El visitante puede "Borrar mis datos".
  - La config pública se eliminó.
- **Pase de revisión:** "Ver como participante" usa un JWT de 30 minutos en el fragmento de la URL. Si caduca, se muestra un aviso (v0.99.57).
- **Endpoints públicos:**
  - Límite de 1000 peticiones por minuto por IP.
  - Las respuestas del progreso público van con alias.
- **Páginas `/test/*` y `/eye-tracking-hybrid`:** solo en desarrollo (v0.99.51).
- **JWT del investigador:** ya no viaja en la URL. El SSE del monitor y el iframe del heatmap usan la cookie httpOnly. Se borró `/tracking/:id/live/stream`, que no tenía uso (v0.99.52).
- **User agent de tracking:** se guarda resumido (`desktop · macOS · Chrome`). Las 934 sesiones antiguas están reescritas, con respaldo (v0.99.53).
- **GPS del participante:** eliminado, junto con el interruptor "Track respondents location". Nunca se enviaba al servidor. Para la ubicación se usa la pregunta demográfica Country & City (v0.99.54).
- **Derecho de acceso:** botón "Exportar datos" en la ficha del participante, que descarga un JSON con respuestas, demografía, invitación y consentimientos (v0.99.55).
- **Registro de consentimientos:** sección en Settings y en la config de Website Tracking, con totales, últimos 10 y CSV completo (v0.99.58).
- **Cerulean:** apagado en producción (sin variables `CERULEAN_*`). No envía datos.

Errores corregidos:
- `participants.service.ts` leía `affectedRows` en vez de `rowCount`. Borrar un participante del panel respondía 404 y borrar todos decía 0 (v0.99.56).

Tests al cierre: backend 711, research 708, participant 1162. Todos pasando.

## Qué falta

1. **Probar con una sesión real** (no se pudo desde aquí):
   - el tiempo real de SmartVOC y el iframe del heatmap tras el cambio a cookie;
   - "Exportar datos";
   - "Registro de consentimientos".
2. **934 grabaciones antiguas de Website Tracking sin enmascarar:** decidido esperar (2026-11-01); la retención de 90 días las borra sola.
3. **Respaldos en `~/retention-backups`:** el del 30-oct es de 101 MB y se borra solo el 6 y 7 de noviembre.
4. **Inodos del hosting resueltos (2026-11-01):** de 294.632 a 172.953 archivos. Se borraron `backend/node_modules.backup`, la copia vieja `~/emotioxV3` y el entorno dev muerto (`backend-dev` + `public_html/dev`). Respaldos en `~/cleanup-backups-2026-11-01`. Base de datos `emotvehe_emotiox_dev` borrada (era una copia vieja: 16 usuarios y 8 empresas, todos existentes en producción; volcado en `~/cleanup-backups-2026-11-01/emotiox_dev.sql.gz`). **Falta quitar el subdominio `dev.emotio.cx` desde la interfaz de cPanel** (Dominios); desde la terminal no se puede por CageFS. Hoy responde 404.
5. **Pendientes anteriores sin revisar en esta sesión:**
   - precisión de mirada en móviles;
   - AbortError en el segundo módulo de Eye Tracking;
   - (resuelto en v0.99.60: el Export CSV ya no traga errores, incluye el Screener y el atributo del IAT). El export a PPTX aún omite secciones que fallan sin avisar.
6. **`monitor/handler.ts` (WebSocket de AWS heredado):** aún lee el token por query. No está desplegado en cPanel.

## Ficheros clave

| Tema | Archivo |
|---|---|
| Consentimiento (público) | `backend/src/modules/public/public.consent.ts`, `participant-frontend/src/hooks/useConsentRecorder.ts` |
| Registro para investigadores | `backend/src/modules/research/research-consent-records.ts`, `research-frontend/src/components/research/ConsentRecordsSection.tsx` |
| Exportar datos de participante | `backend/src/modules/research/participant-data-export.ts` |
| Retención | `backend/src/modules/retention/retention.service.ts`, `backend/src/scripts/purge-expired-data.ts` |
| Aviso de privacidad | `backend/src/modules/research/research-privacy.ts` |
| Snippet tracking | `backend/src/modules/tracking/tracking-snippet.ts`, `tracking/user-agent.ts` |
| Rate limit | `backend/src/public-rate-limit.ts` (montado en las dos entradas cPanel) |
| Auth (cookie, pase de revisión) | `backend/src/utils/auth.local.ts` |
| CSV compartido | `research-frontend/src/utils/csvDownload.ts` |

## Preguntas abiertas

- Ninguna. Decidido el 2026-11-01: no habrá estudios con menores (basta la casilla de 18+). Las imágenes `docs/emociones.jpeg`, `net.jpeg` y `problema1.jpeg` se movieron a la Papelera del Mac; `emociones.jpeg` es la pirámide de valor emocional citada en el CHANGELOG (NEV).
