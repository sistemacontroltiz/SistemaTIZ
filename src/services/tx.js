// Ejecuta una operación dentro de una transacción de MongoDB, así una operación
// de varios pasos (ej: aprobar presupuesto + crear OT + crear tareas) se guarda
// completa o no se guarda nada. MongoDB Atlas lo soporta siempre.
// Si la base local no es replica set, se ejecuta sin transacción (solo desarrollo).
import mongoose from 'mongoose';

let supported = null;

export async function withTransaction(fn) {
    if (supported === false) return fn(null);
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => { result = await fn(session); });
        supported = true;
        return result;
    } catch (e) {
        if (supported === null && /replica set|Transaction numbers/i.test(e.message)) {
            supported = false;
            console.warn('[db] La base no admite transacciones (no es replica set). Se continúa sin ellas.');
            return fn(null);
        }
        throw e;
    } finally {
        await session.endSession();
    }
}
