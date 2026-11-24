// Resetea la contraseña de un usuario. Uso:
//   RESET_EMAIL=admin@tiz.com RESET_PASSWORD='Nueva-Clave-2026' node scripts/reset-password.js
import env from '../src/config/env.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import { passwordRule } from '../src/validators/schemas.js';

const email = (process.env.RESET_EMAIL || '').toLowerCase();
const password = process.env.RESET_PASSWORD;

if (!email || !password) {
    console.error('Faltan datos. Ejemplo:\n  RESET_EMAIL=admin@tiz.com RESET_PASSWORD=\'Nueva-Clave-2026\' node scripts/reset-password.js');
    process.exit(1);
}
const check = passwordRule.safeParse(password);
if (!check.success) {
    console.error(`Contraseña débil: ${check.error.issues.map(i => i.message).join(', ')}`);
    process.exit(1);
}

await connectDB(env.MONGODB_URI);
const user = await User.findOne({ email }).select('+tokenVersion');
if (!user) {
    console.error(`No existe un usuario con el email ${email}.`);
    await disconnectDB();
    process.exit(1);
}
user.password = password;          // el modelo la encripta sola al guardar
user.failedLogins = 0;
user.lockUntil = null;
user.active = true;
user.mustChangePassword = false;
await user.save();
console.log(`Contraseña actualizada para ${email}. Ya podés ingresar.`);
await disconnectDB();