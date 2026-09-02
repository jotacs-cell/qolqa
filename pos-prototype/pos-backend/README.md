# Sistema de Ventas Web + Facturación Electrónica SUNAT

Backend en Node.js/Express + PostgreSQL para un sistema de punto de venta
(POS) que emite comprobantes electrónicos (factura y boleta) y los envía
a SUNAT.

## Antes de empezar: qué necesitas conseguir tú (esto el código no lo resuelve)

Este proyecto trae **todo el código funcional**: base de datos, API REST,
motor de ventas transaccional y la integración con NubeFacT para emitir
y enviar los comprobantes. NubeFacT es un OSE (Operador de Servicios
Electrónicos) homologado por SUNAT: le mandas los datos de la venta en
JSON y ellos arman el XML UBL 2.1, lo firman con su propio certificado
digital y lo envían a SUNAT — por eso este proyecto **ya no genera ni
firma su propio XML** (ver `nubefactClient.js`).

Aun así, tu negocio necesita dos cosas que **nadie puede generar por
software**, porque están atadas legalmente a tu RUC:

1. **RUC activo y en condición de "HABIDO"**, verificable en el portal de
   SUNAT.
2. **Una cuenta NubeFacT** (contrato con ellos como tu OSE) — desde ahí
   obtienes la `NUBEFACT_RUTA` y el `NUBEFACT_TOKEN` que van en el
   `.env` (Integración → API dentro de tu cuenta). Empiezan con
   credenciales de **DEMO** que no afectan tu facturación real; cambias
   a las de producción cuando un envío de prueba salga aceptado.

   ⚠️ Los nombres de campo del JSON que arma `nubefactClient.js`
   (`tipo_de_comprobante`, `sunat_transaction`, etc.) están tomados de la
   documentación pública de NubeFacT, pero su manual completo vive
   dentro de tu cuenta y no fue posible verificar cada valor exacto
   desde aquí — compáralo contra el manual real antes de facturar en
   serio (más detalle en el comentario al inicio de ese archivo). Ya no
   necesitas comprar un certificado digital propio: NubeFacT firma con
   el suyo.

Sin la cuenta NubeFacT configurada, el proyecto corre igual (puedes
vender, controlar stock y ver el comprobante en estado `pendiente`),
pero el paso final de *enviar* fallará con un error claro — el
comprobante queda en estado `error_envio` para reintentar apenas
configures las credenciales reales.

## Qué SÍ hace el código, de punta a punta

- Autenticación JWT con 4 roles (`admin`, `vendedor`, `cajero`, `contador`) y
  una matriz de permisos por acción (`src/config/permisos.js`) — no por
  módulo entero, sino por operación específica: por ejemplo un vendedor
  puede emitir boleta y factura pero no anularlas; un cajero puede emitir
  boleta pero no factura; un contador anula y ve reportes pero no vende.
  Ver "Usuarios, roles y sesiones" más abajo.
- CRUD de productos con baja lógica (nunca se borra un producto con
  ventas asociadas).
- Motor de ventas: una única transacción SQL que bloquea el stock
  (`SELECT ... FOR UPDATE`), inserta la venta y su detalle, descuenta
  stock y **reserva** serie/correlativo del comprobante — todo o nada.
- Envío del comprobante (factura, boleta o nota de crédito) a NubeFacT,
  que arma el XML UBL 2.1, lo firma con su certificado y lo transmite a
  SUNAT — fuera de la transacción de la venta, siempre (ver
  `nubefactClient.js`).
- Guardado del resultado (`aceptado`, `rechazado`, `error_envio`, etc.)
  y de los enlaces al PDF/XML/CDR que NubeFacT genera y aloja.
- Reintento manual del envío (`PATCH /api/comprobantes/:id/reenviar`).
- **Notas de crédito** sobre una factura o boleta ya aceptada:
  devoluciones parciales o totales, descuentos, bonificaciones y
  correcciones — con el catálogo 09 de SUNAT completo (11 motivos).
- **Cancelación de facturas/boletas ya aceptadas**: en Perú esto NO es
  un `DELETE` ni un simple cambio de estado — se hace emitiendo una
  nota de crédito con motivo `01` (Anulación de la operación) que cubre
  el 100% de las líneas. Eso es exactamente lo que hace
  `PATCH /api/comprobantes/:id/anular`.
- Reposición de stock inteligente: solo los motivos que implican que el
  producto físicamente regresa (`01`, `06`, `07`) reponen inventario —
  un descuento o una corrección de RUC no lo hace.
- Control de saldo por acreditar: no deja emitir una segunda nota de
  crédito sobre unidades que ya fueron acreditadas en una anterior.
- **PDF del comprobante** (`GET /api/comprobantes/:id/pdf`): la
  representación impresa de la boleta/factura/nota de crédito —lo que
  se le entrega al cliente en el mostrador o se le manda por correo—,
  con el código QR que exige SUNAT, el hash, y el **estado SUNAT
  estampado en el papel** (aceptado, pendiente, rechazado...) para que
  no haga falta abrir el sistema para saber si pasó. Recuerda: el PDF es
  solo informativo, lo que tiene valor legal es el XML firmado + su CDR
  (que arma y aloja NubeFacT — ver `GET /api/comprobantes/:id/xml` y
  `/cdr`, que redirigen a esos enlaces).
- **Dashboard/analítica** (`/api/dashboard/...`): recaudación diaria,
  productos de mayor rotación y rendimiento por vendedor — la fase 6
  del plan original.

### Sobre "recibos"

Si con "recibos" te refieres al comprobante que ve el cliente en el
mostrador, eso ya está cubierto: es la **boleta de venta** (o factura,
si el cliente tiene RUC) — no existe un tipo de documento "recibo"
separado para venta de productos en el sistema de comprobantes de pago
de SUNAT. El **Recibo por Honorarios** sí es un documento SUNAT
distinto, pero es para servicios prestados por profesionales
independientes (renta de cuarta categoría), no para venta de productos
en un POS — si tu negocio también factura honorarios, es un módulo
aparte con sus propias reglas.

## Estructura del proyecto

```
src/
├── server.js                      punto de entrada
├── app.js                         Express app, middlewares globales, manejo de errores
├── config/
│   ├── db.js                      pool de PostgreSQL + helper de transacciones
│   ├── empresa.js                 RUC + credenciales de NubeFacT (ruta y token)
│   └── permisos.js                matriz de permisos por rol + middleware exigirPermiso
├── db/
│   ├── schema.sql                 esquema completo (ejecutar con npm run db:migrate)
│   └── migrate.js
├── middlewares/
│   └── auth.js                    verificarToken (valida JWT + que la sesión no esté revocada), verificarRol
├── routes/                        auth, productos, ventas, comprobantes, dashboard, auditoria
├── controllers/                   uno por recurso
└── services/
    ├── ventas.service.js          la transacción SQL del motor de ventas
    ├── correlativos.service.js    reserva atómica de serie/correlativo
    ├── notasCredito.service.js    devoluciones, descuentos y anulación de comprobantes aceptados
    ├── auditoria.service.js       registrar()/listar() del historial de auditoría
    └── facturacion/
        ├── catalogosSunat.js      catálogos SUNAT compartidos (tipos de doc., motivos, IGV)
        ├── numeroALetras.js       monto en letras para el PDF
        ├── nubefactClient.js      arma el JSON y envía el comprobante a NubeFacT (OSE)
        ├── pdf.builder.js         representación impresa (PDF) con QR + estado SUNAT
        └── facturacion.service.js orquesta todo lo anterior (factura/boleta Y notas)
```

## Puesta en marcha

```bash
cp .env.example .env        # completa DATABASE_URL, JWT_SECRET, EMPRESA_RUC,
                             # NUBEFACT_RUTA y NUBEFACT_TOKEN (los de DEMO al inicio)
npm install
npm run db:migrate          # crea las tablas en PostgreSQL

# Inserta los datos de tu empresa (una sola vez):
psql "$DATABASE_URL" -c "INSERT INTO empresa_emisora (ruc, razon_social, ubigeo, direccion)
  VALUES ('20123456789', 'MI EMPRESA S.A.C.', '150101', 'AV. EJEMPLO 123, LIMA');"

# Crea el primer usuario admin (hashea la contraseña con bcrypt tú mismo,
# o expón temporalmente el endpoint de registro sin protección para el primer usuario).

npm run dev
```

## Endpoints principales

Ver el detalle completo (request/response de cada uno) en el documento
de diseño de la API ya compartido. Resumen:

| Método | Ruta | Permiso requerido |
|---|---|---|
| POST | `/api/auth/login` | público |
| GET | `/api/auth/permisos` | autenticado — la matriz de roles tal cual la usa el backend |
| POST | `/api/auth/logout` | autenticado — revoca la sesión actual (el `jti` del token) |
| GET | `/api/auth/sesiones` | autenticado — propias; admin puede ver las de otro con `?usuario_id=` |
| DELETE | `/api/auth/sesiones/:id` | dueño de la sesión, o admin |
| GET | `/api/auth/me` | autenticado |
| POST | `/api/auth/usuarios` | `gestionarUsuarios` (admin) |
| PATCH | `/api/auth/usuarios/:id/estado` | `gestionarUsuarios` (admin) |
| GET | `/api/productos` | autenticado |
| POST/PUT | `/api/productos` \| `/:id` | `gestionarProductos` (admin) |
| PATCH | `/api/productos/:id/estado` \| `/stock` | `gestionarProductos` (admin) |
| POST | `/api/ventas` (`tipo_comprobante: "factura"\|"boleta"`, `items`) | autenticado — `factura` exige además `emitirFactura` (admin, vendedor) |
| GET | `/api/ventas` \| `/:id` | autenticado — cajero solo ve las propias |
| PATCH | `/api/ventas/:id/anular` | `anularOEmitirNotaCredito` (admin, contador) |
| GET | `/api/comprobantes/:id` \| `/xml` \| `/cdr` \| `/pdf` | autenticado |
| PATCH | `/api/comprobantes/:id/reenviar` | `anularOEmitirNotaCredito` (admin, contador) |
| GET | `/api/comprobantes/:id/notas-credito` | autenticado |
| POST | `/api/comprobantes/:id/notas-credito` (`codigo_motivo`, `motivo_detalle`, `items?`) | `anularOEmitirNotaCredito` (admin, contador) |
| PATCH | `/api/comprobantes/:id/anular` (`motivo`) — cancela la factura/boleta completa | `anularOEmitirNotaCredito` (admin, contador) |
| GET | `/api/dashboard/...` | `verReportes` (admin, contador) |
| GET | `/api/auditoria` | `gestionarUsuarios` (admin) |

## Próximos pasos razonables (fuera del alcance de esta primera versión)

- **Notas de débito**: el esquema y el enum ya contemplan
  `nota_debito` (para cobros adicionales sobre un comprobante ya
  emitido — intereses, gastos no facturados, etc.), pero el flujo de
  emisión no está implementado — es análogo al de notas de crédito.
- **Comunicación de baja**: alternativa más rápida a la nota de crédito
  para anular una boleta el MISMO día de su emisión (no aplica a
  facturas, que siempre van por nota de crédito). Hoy el sistema anula
  boletas y facturas por igual con nota de crédito, lo cual siempre es
  válido aunque no sea la ruta más rápida para boletas del mismo día.
- **Resumen diario de boletas**: SUNAT permite reportar boletas en un
  resumen consolidado en vez de una por una; el flujo async con
  `ticket` en `comprobantes_electronicos` ya está pensado para eso.
- **Cola de reintentos automática**: hoy el reintento es manual
  (`/reenviar`); en producción conviene un job (cron o BullMQ) que
  reintente `error_envio` con backoff.
- **Envío del PDF por correo** al cliente al momento de la venta (hoy
  el PDF se genera bajo demanda vía `GET /api/comprobantes/:id/pdf`,
  pero no se envía automáticamente).
- **Frontend de administración** (React) para productos, usuarios y el
  dashboard — hoy esos datos solo se consumen por API; el POS (fase 4)
  ya tiene una vista previa de referencia.

## Usuarios, roles, sucursales, sesiones y auditoría

Los 4 roles y qué puede hacer cada uno (fuente única de verdad:
`src/config/permisos.js`, la misma matriz que expone
`GET /api/auth/permisos` para que el frontend no la duplique):

| Acción | admin | vendedor | cajero | contador |
|---|---|---|---|---|
| Emitir boleta / recibo | sí | sí | sí | no |
| Emitir factura | sí | sí | no | no |
| Anular comprobante / emitir nota de crédito | sí | no | no | sí |
| Gestionar productos | sí | no | no | no |
| Gestionar usuarios | sí | no | no | no |
| Ver reportes (dashboard) | sí | no | no | sí |

El caso del enunciado original — "un vendedor podría emitir una boleta,
pero no anularla" — está implementado en dos capas: la ruta
`PATCH /api/ventas/:id/anular` exige el permiso `anularOEmitirNotaCredito`
(que un vendedor no tiene), y `POST /api/ventas` revisa
`tipo_comprobante` dentro del controller (no se puede en la ruta, porque
depende del body) para bloquear facturas a quien no tenga
`emitirFactura`.

**Sucursales**: la tabla `sucursales` y la columna `usuarios.sucursal_id`
identifican a qué sede pertenece cada usuario, y permiten filtrar
reportes por sede haciendo `JOIN` desde `ventas.usuario_id`. **Esto NO
es aislamiento de inventario por sucursal** — el stock de `productos`
sigue siendo un único número global, no por sede. Si tu negocio necesita
stock independiente por local, es un cambio de esquema más grande
(tabla `stock_por_sucursal`, o similar) que queda fuera de esta versión.

**Sesiones**: un JWT no se puede revocar antes de que expire por sí
solo, así que cada login inserta una fila en `sesiones` (con un `jti`
único) y `verificarToken` comprueba en cada request que esa sesión no
esté revocada. Esto permite "cerrar sesión" de verdad —incluso cerrar la
sesión de *otro* dispositivo— y no solo borrar el token del lado del
cliente.

**Auditoría**: la tabla `auditoria` registra quién hizo qué y cuándo
(ventas emitidas, anulaciones, notas de crédito, altas/bajas de
productos y usuarios, login). Se escribe con
`src/services/auditoria.service.js#registrar()`, llamado desde cada
controller que muta datos — nunca lanza error si falla el `INSERT`, para
no tumbar la operación real. Se lee con `GET /api/auditoria`.
