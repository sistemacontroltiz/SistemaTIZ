import mongoose from 'mongoose';

// Protección contra inyección NoSQL en tres capas:
// 1) middleware `sanitize` borra claves con $ o punto de todo lo que llega,
// 2) los esquemas zod obligan a que cada campo sea del tipo esperado (string, número...),
// 3) strictQuery descarta campos de filtro que no existan en el modelo.
mongoose.set('strictQuery', true);

export async function connectDB(uri) {
    const conn = await mongoose.connect(uri);
    console.log(`[db] MongoDB conectado: ${conn.connection.host}`);
    return conn;
}

export async function disconnectDB() {
    await mongoose.disconnect();
}
