// Valida body / query / params con un esquema zod y reemplaza el contenido por
// la versión validada (descarta campos no declarados).
import AppError from '../utils/AppError.js';

export function validate(schemas) {
    return (req, res, next) => {
        for (const part of ['params', 'query', 'body']) {
            if (!schemas[part]) continue;
            const result = schemas[part].safeParse(req[part] ?? {});
            if (!result.success) {
                const details = result.error.issues.map(i => ({ field: i.path.join('.'), message: i.message }));
                const first = details[0];
                throw AppError.badRequest(`Dato inválido${first.field ? ` en "${first.field}"` : ''}: ${first.message}`, details);
            }
            if (part === 'query') {
                Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true });
            } else {
                req[part] = result.data;
            }
        }
        next();
    };
}
