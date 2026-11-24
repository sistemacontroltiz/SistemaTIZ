// Lee y valida las variables de entorno una sola vez.
// Si falta algo obligatorio, el servidor no arranca (mejor que arrancar inseguro).
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    MONGODB_URI: z.string().min(1, 'MONGODB_URI es obligatoria'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
    JWT_EXPIRES_HOURS: z.coerce.number().positive().default(8),
    CORS_ORIGINS: z.string().default(''),
    UPLOAD_DIR: z.string().default('uploads'),
    UPLOAD_MAX_MB: z.coerce.number().positive().default(8),

    // ARCA (ex AFIP)
    ARCA_MODE: z.enum(['homologacion', 'produccion', 'simulado']).default('homologacion'),
    ARCA_CUIT: z.string().regex(/^\d{11}$/).optional(),
    ARCA_CERT_PATH: z.string().optional(),
    ARCA_KEY_PATH: z.string().optional(),
    ARCA_CERT_PEM: z.string().optional(),
    ARCA_KEY_PEM: z.string().optional(),

    // IA opcional para leer facturas de compra
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_MODEL: z.string().default('claude-sonnet-5-5'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    const detail = parsed.error.issues.map(i => `- ${i.path.join('.')}: ${i.message}`).join('\n');
    console.error(`[config] Variables de entorno inválidas:\n${detail}`);
    process.exit(1);
}

const env = parsed.data;
if (env.ARCA_MODE === 'produccion' && env.NODE_ENV !== 'production') {
    console.warn('[config] ATENCIÓN: ARCA en modo PRODUCCIÓN fuera de NODE_ENV=production.');
}

export const corsOrigins = env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
export const isProd = env.NODE_ENV === 'production';
export default env;
