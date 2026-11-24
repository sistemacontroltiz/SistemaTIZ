// Catálogo único de permisos. Los roles se guardan en la base y se editan desde
// Administración, sin tocar código. Estos son solo los valores iniciales.

export const PERMISSIONS = {
    'dashboard:read': 'Ver inicio',
    'clients:read': 'Ver clientes',
    'clients:write': 'Crear/editar clientes',
    'suppliers:read': 'Ver proveedores',
    'suppliers:write': 'Crear/editar proveedores',
    'catalog:read': 'Ver catálogo de insumos',
    'catalog:write': 'Editar catálogo y costos',
    'stock:adjust': 'Ajustar stock',
    'opportunities:create': 'Cargar oportunidades / alta de presupuesto',
    'quotes:read': 'Ver presupuestos',
    'quotes:write': 'Crear/editar presupuestos',
    'quotes:approve': 'Aprobar presupuestos (genera OT)',
    'workorders:read': 'Ver órdenes de trabajo',
    'workorders:write': 'Cambiar estado / reprogramar OT',
    'workorders:baja': 'Dar de baja OT',
    'production:read': 'Ver tareas de producción',
    'production:work': 'Tomar y finalizar tareas',
    'production:assign': 'Asignar tareas a sectores',
    'materials:consume': 'Registrar consumo de materiales',
    'purchases:read': 'Ver compras',
    'purchases:write': 'Registrar compras',
    'quality:read': 'Ver control de calidad',
    'quality:write': 'Realizar controles de calidad',
    'installations:read': 'Ver todas las colocaciones',
    'installations:own': 'Ver solo mis colocaciones',
    'installations:write': 'Programar/cerrar colocaciones',
    'invoices:read': 'Ver facturas',
    'invoices:issue': 'Emitir facturas y notas de crédito',
    'payments:read': 'Ver cobranzas',
    'payments:write': 'Registrar cobros',
    'stats:read': 'Ver estadísticas',
    'users:admin': 'Administrar usuarios y roles',
    'settings:admin': 'Configuración (emisor, ARCA, sectores)',
    'audit:read': 'Ver auditoría',
};

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

const read = ['dashboard:read'];

export const DEFAULT_ROLES = {
    admin: { label: 'Administrador', permissions: ALL_PERMISSIONS },
    ventas: {
        label: 'Ventas',
        permissions: [...read, 'clients:read', 'clients:write', 'catalog:read', 'quotes:read', 'quotes:write',
            'quotes:approve', 'workorders:read', 'workorders:write', 'workorders:baja', 'production:read',
            'installations:read', 'invoices:read', 'payments:read', 'stats:read'],
    },
    produccion: {
        label: 'Producción',
        permissions: [...read, 'workorders:read', 'production:read', 'production:work', 'materials:consume', 'catalog:read'],
    },
    supervisor: {
        label: 'Supervisor de producción',
        permissions: [...read, 'workorders:read', 'workorders:write', 'production:read', 'production:work',
            'production:assign', 'materials:consume', 'catalog:read', 'quality:read', 'quality:write',
            'installations:read', 'installations:write'],
    },
    compras: {
        label: 'Compras',
        permissions: [...read, 'suppliers:read', 'suppliers:write', 'catalog:read', 'catalog:write', 'stock:adjust',
            'purchases:read', 'purchases:write', 'workorders:read'],
    },
    calidad: {
        label: 'Calidad',
        permissions: [...read, 'workorders:read', 'quality:read', 'quality:write'],
    },
    colocador: {
        label: 'Colocador',
        permissions: [...read, 'installations:own', 'installations:write'],
    },
    contabilidad: {
        label: 'Facturación y cobranzas',
        permissions: [...read, 'clients:read', 'clients:write', 'quotes:read', 'workorders:read', 'invoices:read',
            'invoices:issue', 'payments:read', 'payments:write', 'stats:read', 'suppliers:read', 'purchases:read'],
    },
};
