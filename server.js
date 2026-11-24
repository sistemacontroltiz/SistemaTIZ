import env from './src/config/env.js';
import { connectDB } from './src/config/db.js';
import { createApp } from './src/app.js';

try {
    await connectDB(env.MONGODB_URI);
} catch (e) {
    console.error(`[db] No se pudo conectar a MongoDB: ${e.message}`);
    process.exit(1);
}

const app = createApp();
app.listen(env.PORT, () => {
    console.log(`[server] ${env.NODE_ENV} · ARCA ${env.ARCA_MODE} · http://localhost:${env.PORT}`);
});
