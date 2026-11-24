// Carga inicial: roles, sectores base, datos de empresa y el primer administrador.
// La contraseña del admin se toma de SEED_ADMIN_PASSWORD (nunca queda escrita en el código).
// Uso:  SEED_ADMIN_EMAIL=admin@tiz.com SEED_ADMIN_PASSWORD='Clave-Segura-2026' npm run seed
import env from '../src/config/env.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Role, Sector, getSettings } from '../src/models/catalogs.js';
import { QualityTemplate } from '../src/models/operations.js';
import User from '../src/models/User.js';
import { DEFAULT_ROLES } from '../src/config/permissions.js';
import { passwordRule } from '../src/validators/schemas.js';

await connectDB(env.MONGODB_URI);

for (const [key, def] of Object.entries(DEFAULT_ROLES)) {
    const exists = await Role.findOne({ key });
    if (exists) {
        if (key === 'admin') { exists.permissions = def.permissions; await exists.save(); }
        continue;
    }
    await Role.create({ key, label: def.label, permissions: def.permissions, system: key === 'admin' });
    console.log(`Rol creado: ${key}`);
}

for (const name of ['Diseño', 'Impresión', 'Ploteo', 'Carpintería', 'Herrería', 'Armado', 'Colocación']) {
    if (!(await Sector.exists({ name }))) await Sector.create({ name });
}

if (!(await QualityTemplate.exists({}))) {
    await QualityTemplate.create({
        name: 'Control general de cartelería',
        items: ['Medidas según OT', 'Colores según diseño aprobado', 'Sin rayas, burbujas ni manchas', 'Terminaciones y bordes prolijos', 'Estructura firme y fijaciones completas', 'Embalaje para traslado'],
    });
}
await getSettings();

const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
const adminRole = await Role.findOne({ key: 'admin' });
if (await User.exists({ role: adminRole._id })) {
    console.log('Ya existe un administrador: no se crea otro.');
} else if (!email || !password) {
    console.log('Para crear el primer admin definí SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD.');
} else {
    const check = passwordRule.safeParse(password);
    if (!check.success) {
        console.error(`Contraseña débil: ${check.error.issues.map(i => i.message).join(', ')}`);
        process.exitCode = 1;
    } else {
        await User.create({ name: 'Administrador', email, password, role: adminRole._id, mustChangePassword: true });
        console.log(`Administrador creado: ${email} (deberá cambiar la contraseña al ingresar)`);
    }
}
await disconnectDB();
