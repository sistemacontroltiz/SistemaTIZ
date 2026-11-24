// Error de negocio con código HTTP. Lo que se lanza con AppError se muestra
// al usuario tal cual; cualquier otro error se oculta como "Error interno".
export default class AppError extends Error {
    constructor(message, status = 400, details) {
        super(message);
        this.status = status;
        this.details = details;
        this.expose = true;
    }
    static badRequest(msg, details) { return new AppError(msg, 400, details); }
    static unauthorized(msg = 'No autenticado.') { return new AppError(msg, 401); }
    static forbidden(msg = 'No tenés permiso para esta acción.') { return new AppError(msg, 403); }
    static notFound(what = 'Recurso') { return new AppError(`${what} no encontrado.`, 404); }
    static conflict(msg) { return new AppError(msg, 409); }
}
