# Guía de cambios · Sistema de Gestión TIZ v2

Esta versión reemplaza al MVP de noviembre 2025. Mantiene la idea original (presupuesto con materiales y mano de obra → OT → tareas por sector → pagos) y suma lo que hoy tiene tiz-app, con estructura en capas y seguridad reforzada.

Las funciones se reescribieron desde cero sobre tu diseño. No se copió código de tiz-app.

---

## 1. Antes de subir: limpiar el repo

Esta versión cambia toda la estructura. Conviene reemplazar el contenido del repo y no copiar encima.

1. En tu carpeta local de SistemaEPR-TIZ borrá todo menos la carpeta oculta `.git`.
2. Copiá dentro el contenido del zip.
3. Verificá que NO queden estos archivos del repo viejo:
   - `IniciodeProyectos.txt` (tenía la contraseña de MongoDB)
   - `generateHash.js` (tenía una contraseña fija)
   - `src/imagenes/` (fotos de WhatsApp)
   - `Captura de pantalla 2025-10-27 160906.jpg`
   - `public/img/dashboardbkp.js`, `src/View/QuoteControlView_bkp.js`
4. `npm install` (hay dependencias nuevas).
5. Copiá `.env.example` como `.env` y completalo.
6. Subí a GitHub. El `.gitignore` ya excluye `.env`, certificados y fotos.

La contraseña vieja de MongoDB sigue en el historial de git. Como ya la cambiaste, no sirve para entrar. Si querés borrarla también del historial, se puede hacer con `git filter-repo`; avisame y te paso los pasos.

Base de datos: la v2 usa nombres de campos nuevos. Por defecto apunta a una base nueva (`erp_tiz`), así que los datos del MVP quedan intactos. Si esos datos hay que pasarlos, te armo un script de migración.

---

## 2. Primer arranque

1. `SEED_ADMIN_EMAIL=tu@email.com SEED_ADMIN_PASSWORD='Una-Clave-Segura-2026' npm run seed`
   - Crea 8 roles, 7 sectores, un checklist de calidad y el primer administrador.
   - La contraseña tiene que tener 10 caracteres o más, con mayúscula, minúscula y número.
2. `npm start` y entrar a http://localhost:3000
3. Te va a pedir cambiar la contraseña.
4. En Administración → Empresa y ARCA, cargá los datos fiscales de TIZ.
5. En Administración → Mano de obra, cargá las tarifas con su sector.
6. Cargá insumos, clientes y proveedores, y creá los usuarios.

---

## 3. Seguridad: qué cambió

| Problema del MVP | Cómo quedó |
|---|---|
| Contraseña de MongoDB y token escritos en el repo | Todo va en `.env`. El servidor no arranca si falta algo o si el secreto es corto. |
| Clientes, productos y tareas de una OT visibles sin login | Ninguna ruta de datos es pública. Solo el login. |
| Rutas de admin sin control de rol | Cada ruta exige un permiso concreto. Hay 33 permisos. |
| Cualquier logueado podía borrar clientes o registrar pagos | Idem: permisos por acción. |
| Roles fijos en el código | Roles en la base, editables desde Administración. Se aplican al instante. |
| Token en localStorage, expuesto a XSS | Sesión en cookie httpOnly + SameSite=Strict. El JavaScript no puede leerla. |
| 53 `innerHTML` con datos sin escapar | Todo dato se escapa antes de mostrarse. Probado con un cliente llamado `<img onerror=...>`. |
| CORS abierto a cualquier sitio | Mismo origen. Otros dominios solo si se declaran en `CORS_ORIGINS`. |
| Sin límite de intentos de login | 10 intentos cada 15 minutos por IP. Además, bloqueo del usuario 15 minutos tras 5 errores. |
| Token válido 30 días | 8 horas (configurable). Al desactivar un usuario o cambiar su clave, la sesión se corta al instante. |
| Sin validación de datos de entrada | Todo lo que entra se valida (tipos, largos, CUIT con dígito verificador). |

También se agregó:

- Protección CSRF: toda escritura exige una cabecera especial que un sitio externo no puede mandar.
- Limpieza contra inyección NoSQL (se descartan claves con `$` o con punto).
- Cabeceras de seguridad con helmet. La política CSP bloquea scripts inline y externos.
- Contraseñas con bcrypt (costo 12) y regla de complejidad. Cambio obligatorio en el primer ingreso.
- Siempre tiene que quedar al menos un administrador activo.
- Fotos: se valida el contenido real del archivo, se guardan con nombre aleatorio fuera de la carpeta pública y se sirven solo con permiso.
- Auditoría: quién hizo qué y desde qué IP (aprobaciones, facturas, cobros, compras, cambios de usuarios...).
- Los errores internos no muestran detalles técnicos al navegador.

---

## 4. Módulos y procesos

### Presupuestos

- Cotizador por ítem: materiales del catálogo + mano de obra con sector + margen %. También admite precio fijo.
- El servidor recalcula todos los importes. No se confía en lo que manda el navegador.
- Tipo de factura (A/B/C) e IVA (21, 10,5, 27 o 0).
- Vigencia comercial: vence sola y se puede extender.
- Estados: Borrador → Enviado → Aprobado / Rechazado / Vencido / Baja.
- Al aprobar, el sistema revisa costos:
  - Errores que bloquean: costo en 0, insumo inactivo, vigencia vencida.
  - Avisos que hay que confirmar: el costo del catálogo subió más de 5%, material sin vincular, precio bajo costo.
- La aprobación crea la OT y una tarea por cada línea de mano de obra, todo en una sola transacción.
- Duplicar presupuesto, PDF con logo e historial.

### Órdenes de trabajo

- Estados: Pendiente, Diseño, Producción, Calidad, Colocación, Lista para entrega, Entregada, Baja.
- Reglas de proceso:
  - No pasa a Calidad con tareas abiertas.
  - No pasa de Calidad sin un control aprobado.
  - Si lleva colocación, no se entrega sin colocación realizada.
- Semáforo: en término, vence pronto (3 días o menos), vencida, cumplida, cumplida tarde.
- Reprogramaciones con motivo obligatorio e historial. Se guarda la fecha original.
- Baja con motivo. No se permite si tiene facturas o cobros.
- Consumo de materiales del stock imputado a la OT.
- Costo real (consumos + compras imputadas) contra costo previsto.

### Producción

- Cada operario ve las tareas de su sector, las toma y las finaliza.
- No puede tomar tareas de otro sector.
- El supervisor ve todas, reasigna y revierte.
- Al empezar la primera tarea, la OT pasa sola a Producción. El avance se calcula solo.

### Control de calidad

- Checklists configurables.
- Cada punto rechazado necesita observación.
- Si aprueba, la OT avanza a Colocación o a Lista para entrega. Si rechaza, vuelve a Producción.

### Colocaciones

- Agenda por día con equipo, horario, vehículo e indicaciones.
- El colocador solo ve las colocaciones donde está asignado.
- Fotos desde el celular (abre la cámara).
- No se puede cerrar como realizada sin al menos una foto. Al cerrarla, la OT queda entregada.

### Compras y stock

- Proveedores con contactos.
- Compra con ítems vinculados al catálogo y equivalencias de unidades (por ejemplo, 1 rollo = 160 m2).
- Al registrar: suma stock, actualiza el costo del insumo (con historial) e imputa costos a OT (servicios tercerizados).
- No deja cargar dos veces la misma factura de un proveedor.
- Anulación que revierte el stock.
- Ajustes de stock con motivo. Alerta de stock mínimo.
- Opcional: leer la factura del proveedor con IA (PDF o foto). Completa el formulario para revisar; no guarda nada solo. Necesita `ANTHROPIC_API_KEY`.

### Facturación ARCA

- Factura A, B o C según la condición de IVA de TIZ y del cliente.
- Una factura puede incluir varias OT del mismo cliente o una parte de una OT (facturación por avance).
- Numeración protegida: dos personas no pueden emitir a la vez el mismo tipo de comprobante.
- Si se corta la conexión con ARCA, "Reintentar" consulta primero si el comprobante llegó, para no duplicarlo.
- Notas de crédito asociadas a la factura.
- PDF con letra, CAE, vencimiento del CAE y QR oficial.
- Al consultar un CUIT, trae razón social, domicilio y condición de IVA desde el padrón de ARCA.
- Informa la condición de IVA del receptor (obligatoria desde 2025).

### Cobranzas

- Cobro sobre factura con las cuatro retenciones (IVA, IIBB, Ganancias, SUSS).
- Cobros parciales.
- Anticipos contra la OT antes de facturar. Se aplican solos al emitir la factura. Si el anticipo es mayor que la factura, se aplica una parte y el resto queda disponible.
- No acepta fechas futuras ni cobrar más que el saldo.
- Anulación con motivo.
- Saldos por cliente con días de atraso, cuenta corriente imprimible y vista semanal (cobrado contra vencimientos).

### Inicio e indicadores

- Presupuestos emitidos y aprobados, tasa de aprobación.
- OT por estado, entregas a tiempo.
- Facturado, cobrado, por cobrar y vencido.
- Mayores deudores, mejores clientes, margen previsto contra real y stock bajo.

### Lo que NO se pasó de tiz-app

- La sincronización con Google Sheets y Drive ("Base Madre"). En esta versión la base es la única fuente de datos.
- El asistente "Clemen" con agenda personal.
- La Factura de Crédito Electrónica MiPyME (FCE).

Si alguno hace falta, se agrega como módulo.

---

## 5. Conectar ARCA (homologación)

En homologación se puede usar tu CUIT personal para probar.

1. Generar clave privada y pedido de certificado (en tu PC, con OpenSSL):
   ```
   openssl genrsa -out arca.key 2048
   openssl req -new -key arca.key -subj "/C=AR/O=Paulo Reta/CN=sistema-tiz/serialNumber=CUIT 20XXXXXXXXX" -out arca.csr
   ```
2. En ARCA, con clave fiscal: Administrador de Relaciones → Adherir servicio → "WSASS - Autogestión Certificados Homologación".
3. En WSASS → Nuevo certificado: pegá el contenido de `arca.csr`. Guardá el certificado que devuelve como `arca.crt`.
4. En WSASS → Crear autorización a servicio:
   - `wsfe` (factura electrónica)
   - `ws_sr_constancia_inscripcion` (opcional, para consultar CUIT)
5. Copiá `arca.key` y `arca.crt` a la carpeta `certs/` del proyecto. Nunca se suben a GitHub.
6. En el `.env`:
   ```
   ARCA_MODE=homologacion
   ARCA_CUIT=20XXXXXXXXX
   ARCA_CERT_PATH=./certs/arca.crt
   ARCA_KEY_PATH=./certs/arca.key
   ```
7. En Administración → Empresa y ARCA, cargá el mismo CUIT y tocá "Probar conexión".

Para producción, más adelante:

- Lo hace TIZ con su clave fiscal: certificado en "Administración de Certificados Digitales".
- Hay que crear un punto de venta "Web Services" en ARCA.
- Se cambia `ARCA_MODE=produccion`.

---

## 6. Publicar en Render

- Tipo: Web Service. Build: `npm install`. Start: `npm start`.
- Variables: las del `.env.example`, con `NODE_ENV=production`.
- Certificado ARCA: usá `ARCA_CERT_PEM` y `ARCA_KEY_PEM` (pegando el contenido) en lugar de archivos.
- Fotos de colocaciones: Render borra los archivos en cada deploy. Agregá un disco persistente (por ejemplo `/var/data`) y poné `UPLOAD_DIR=/var/data/uploads`.
- MongoDB Atlas ya funciona como replica set, así que las operaciones de varios pasos se guardan completas o no se guardan.

---

## 7. Tests (opcional)

`npm test` corre 30 pruebas automáticas:

- Seguridad: 11 pruebas.
- Circuito completo de presupuesto a cobro: 15 pruebas.
- ARCA con un servidor falso, incluida la verificación de la firma del certificado con OpenSSL: 4 pruebas.

Necesita un MongoDB local en modo replica set. No hace falta correrlos para usar el sistema.
