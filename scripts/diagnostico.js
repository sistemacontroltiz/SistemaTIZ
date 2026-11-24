// Muestra a qué base se está conectando (según el .env) y cuántos registros hay.
import mongoose from 'mongoose';
import env from '../src/config/env.js';
import { connectDB, disconnectDB } from '../src/config/db.js';

await connectDB(env.MONGODB_URI);
console.log('\n================ DIAGNÓSTICO ================');
console.log('Base de datos en uso:', mongoose.connection.name);
for (const col of ['users', 'roles', 'sectors', 'clients', 'products', 'quotes', 'workorders', 'tasks']) {
    const n = await mongoose.connection.collection(col).countDocuments().catch(() => 0);
    console.log(`  ${col.padEnd(12)}: ${n}`);
}
console.log('=============================================\n');
await disconnectDB();