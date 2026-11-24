// Arma la aplicación Express (sin levantar el puerto, así se puede testear).
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { securityHeaders, cors, csrfGuard, sanitize, apiLimiter } from './middleware/security.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import apiRoutes from './routes/index.js';

export function createApp() {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', 1); // detrás de Render / Nginx: IP real para el límite de intentos

    app.use(securityHeaders);
    app.use(cors);
    app.use(express.json({ limit: '1mb' }));
    app.use(cookieParser());

    app.get('/health', (req, res) => res.json({ ok: true }));

    app.use('/api', apiLimiter, sanitize, csrfGuard, apiRoutes);
    app.use('/api', notFound);

    // Frontend estático. La carpeta uploads NO se publica.
    // Sin caché del navegador para los archivos de la app: así cada cambio en el
    // frontend se ve al recargar, sin pelear con la caché (Brave, Chrome, etc.).
    app.use(express.static(path.resolve('public'), {
        index: 'index.html', extensions: ['html'], etag: true, lastModified: true,
        setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
    }));
    app.use(notFound);
    app.use(errorHandler);
    return app;
}
