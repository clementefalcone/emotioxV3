import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import es from '../i18n/locales/es.json';
import en from '../i18n/locales/en.json';
import embedStyles from './eye.css?inline';
import { EyeCalibrationFlow } from './EyeCalibrationFlow';
import { loadCalibration, type CalibrationFlowOptions, type EyeStartOptions } from './eyeSession';

const HOST_STYLE = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';

const start = (options: EyeStartOptions): void => {
    const i18n = createInstance();
    void i18n.use(initReactI18next).init({
        resources: { es: { translation: es }, en: { translation: en } },
        lng: options.lang === 'en' ? 'en' : 'es',
        fallbackLng: 'es',
        interpolation: { escapeValue: false },
    });
    const host = document.createElement('div');
    host.setAttribute('style', HOST_STYLE);
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = embedStyles;
    const mount = document.createElement('div');
    shadowRoot.append(style, mount);
    document.body.appendChild(host);
    const root = createRoot(mount);
    const close = () => {
        root.unmount();
        host.remove();
    };
    const flowOptions: CalibrationFlowOptions = {
        storageKey: options.storageKey,
        hasEmotionRecognition: options.hasEmotionRecognition,
        onCameraDenied: options.onCameraDenied,
        onReady: (gaze) => options.onReady({ ...gaze, stop: close }),
        onDecline: () => {
            close();
            options.onDecline();
        },
    };
    root.render(
        <I18nextProvider i18n={i18n}>
            <EyeCalibrationFlow options={flowOptions} storedCalibration={loadCalibration(options.storageKey, Date.now())} />
        </I18nextProvider>,
    );
};

(window as Window & { EmotioxEye?: { start: typeof start } }).EmotioxEye = { start };
