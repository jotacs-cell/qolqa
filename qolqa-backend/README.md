# Qolqa API — Backend Fase 1

Backend del ERP SaaS multi-empresa **Qolqa**. Esta entrega es la **Fase 1** del
roadmap aprobado: autenticación, multi-tenancy, empresas, sucursales,
usuarios, roles y permisos, y auditoría. No incluye todavía ventas, compras,
inventario, finanzas ni facturación electrónica real — esas son las fases
2 en adelante (ver la última sección de este documento).

## Aviso sobre el stack: por qué Express plano y no NestJS + Prisma

La arquitectura original propuesta (`arquitectura-erp-saas-peru`, en el
proyecto de Claude) recomendaba NestJS + Prisma. Este entorno de desarrollo
no tiene acceso al registro de npm (`npm install` devuelve 403 para
cualquier paquete), así que instalar NestJS, Prisma o sus CLIs aquí no es
posible. Para no bloquear la Fase 1, este backend se construyó con
**Express + `pg` puro** (el mismo patrón ya usado en `pos-backend`), sin
ningún ORM: el SQL de `schema.sql` y de los controladores es explícito y
se probó en vivo contra un PostgreSQL real dentro de este entorno.

Esto es una decisión pragmática, no una del diseño original. Si tu equipo
sí tiene acceso a instalar paquetes, migrar a NestJS + Prisma sobre este
mismo modelo de datos y estas mismas políticas RLS es viable — el diseño
de aislamiento (RLS + funciones `SECURITY DEFINER`) no depende del
framework, depende de la base de datos.

## Lo que garantiza la Fase 1: aislamiento real entre empresas

La pregunta de fondo — *"varias empresas facturan aquí pero su base de
datos no se mezcla, ¿verdad?"* — se resolvió con **Row-Level Security de
PostgreSQL**, no con filtros a nivel de aplicación (un `WHERE company_id = ?`
olvidado en un controlador nunca filtra datos, porque la propia base de
datos rechaza la fila):

- Cada tabla sensible (`companies`, `branches`, `roles`, `company_users`,
  `sessions`, `audit_logs`) tiene `ENABLE ROW LEVEL SECURITY` +
  `FORCE ROW LEVEL SECURITY` — esto último es necesario para que ni
  siquiera el rol dueño de las tablas quede exento.
- El rol con el que corre la API (`qolqa_app`) es `NOSUPERUSER NOBYPASSRLS`
  — no puede saltarse estas políticas aunque un bug en el código lo
  intentara.
- Toda consulta pasa por `conContexto({ companyId, userId }, fn)`
  (`src/config/db.js`), que fija `app.company_id` y `app.user_id` como
  variables de sesión de Postgres al inicio de cada transacción. Las
  políticas RLS filtran comparando contra esas variables
  (`company_id = current_setting('app.company_id', true)::uuid`).
- Esto se probó en vivo, no solo se escribió: se levantó un PostgreSQL 16
  local, se sembraron dos empresas distintas ("Ferretería San Martín SAC"
  y "Distribuidora Costa SAC") con usuarios propios, y se confirmó que un
  `SELECT` con el contexto de una empresa nunca devuelve filas de la otra,
  y que un `INSERT` directo sin pasar por las funciones autorizadas es
  rechazado por RLS.
- Dos operaciones son legítimamente imposibles de resolver solo con RLS
  (por su propia naturaleza circular) y se resolvieron con funciones
  `SECURITY DEFINER` — un mecanismo controlado de Postgres para saltar RLS
  solo en esos dos casos exactos, nunca de forma general:
  - **Listar mis empresas** (`user_memberships`): antes de saber a qué
    empresa perteneces, RLS no puede filtrar por empresa.
  - **Crear una empresa nueva** (`crear_empresa`): la fila de membresía
    que te daría acceso no puede existir antes que la empresa misma.

  Ambas funciones son de propiedad del rol administrador (nunca de
  `qolqa_app`) y solo se le otorga `EXECUTE`, nunca acceso directo a las
  tablas — no pueden usarse para nada distinto de su propósito puntual.

## Estructura

```
src/
  app.js              # Express app: middlewares, montaje de rutas
  server.js            # arranque, valida variables de entorno requeridas
  config/
    db.js               # pool de pg + conContexto()
    permisos.js          # usuarioTienePermiso() + middleware exigirPermiso()
  middlewares/
    auth.js               # verificarToken, exigirEmpresaActiva
    errorHandler.js        # maneja ApiError, errores de Postgres y RLS
  controllers/
    auth.controller.js       # registro, login, multiempresa, sesiones
    companies.controller.js   # empresa activa, agregar otra empresa
    branches.controller.js     # sucursales
    users.controller.js         # invitar usuarios, cambiar rol/estado
    roles.controller.js          # roles personalizados y permisos
    auditoria.controller.js       # bitácora de auditoría
  services/
    auditoria.service.js  # registra filas en audit_logs dentro de la misma transacción
  utils/
    ApiError.js          # error tipado con status/código/mensaje
  db/
    schema.sql            # tablas, políticas RLS, funciones SECURITY DEFINER
    migrate.js              # aplica schema.sql, crea el rol de aplicación
    seed.js                   # catálogo de permisos + 4 roles plantilla
```

## Puesta en marcha

1. Crea una base de datos PostgreSQL vacía (Postgres 13+; no necesita
   ninguna extensión, `gen_random_uuid()` es nativo).
2. Copia `.env.example` a `.env` y completa `DATABASE_URL_ADMIN` (una
   conexión con privilegios para crear roles y tablas — por ejemplo el
   superusuario `postgres`), `DB_APP_ROLE` y `DB_APP_PASSWORD`.
3. `npm install`
4. `npm run db:migrate` — crea el rol `qolqa_app` (sin superusuario, sin
   BYPASSRLS) si no existe, aplica `schema.sql` y le otorga los privilegios
   mínimos, incluyendo `EXECUTE` sobre las dos funciones `SECURITY DEFINER`.
5. Completa `DATABASE_URL` en `.env` apuntando al rol `qolqa_app` recién
   creado (no al rol administrador).
6. `npm run db:seed` — siembra el catálogo de permisos y los 4 roles
   plantilla (`admin`, `vendedor`, `almacenero`, `contabilidad`). Corre con
   la conexión normal de la API; no necesita privilegios especiales.
7. `npm start` (o `npm run dev` para reinicio automático).

## Flujo de autenticación multiempresa

- `POST /api/v1/auth/registrar` crea, en una sola transacción atómica: el
  usuario, la empresa, su sucursal "Sede Principal" y la membresía admin
  — corresponde a los pasos 1, 2 y 5 del onboarding de la arquitectura
  colapsados en una sola llamada.
- `POST /api/v1/auth/login` con solo correo y contraseña: si el usuario
  pertenece a una sola empresa activa, devuelve el token directamente. Si
  pertenece a más de una, **no emite token todavía** — responde
  `{ requiere_seleccion_empresa: true, empresas: [...] }` para que el
  frontend muestre el selector; el segundo paso reenvía `company_id` en el
  mismo `login` (o usa `POST /auth/cambiar-empresa` ya autenticado).
- El token JWT lleva `companyId` y `roleId` embebidos — cambiar de empresa
  significa pedir un token nuevo, no reinterpretar el mismo.
- Las sesiones quedan registradas en la tabla `sessions` (por `jti`), así
  que `logout` revoca la sesión de verdad en el servidor, no solo borra el
  token del cliente. `GET /auth/sesiones` y `DELETE /auth/sesiones/:id`
  permiten ver y cerrar sesiones activas (por ejemplo, desde otro
  dispositivo).

## Endpoints (Fase 1)

Todos bajo `/api/v1`. Los marcados 🔒 requieren `Authorization: Bearer
<token>`; los marcados 🏢 además requieren que el token tenga una empresa
activa (`exigirEmpresaActiva`); los marcados con un permiso entre
paréntesis exigen que el rol del usuario tenga esa clave en
`role_permissions`.

**Auth**
- `POST /auth/registrar` — crear cuenta + primera empresa
- `POST /auth/login` — login (puede pedir selección de empresa)
- `GET /auth/me` 🔒🏢 — datos del usuario y su membresía activa
- `GET /auth/empresas` 🔒 — todas las empresas del usuario (sin exigir una activa)
- `POST /auth/cambiar-empresa` 🔒 — token nuevo para otra de sus empresas
- `POST /auth/logout` 🔒 — revoca la sesión actual
- `GET /auth/sesiones` 🔒 — lista sesiones activas del usuario
- `DELETE /auth/sesiones/:id` 🔒 — revoca una sesión específica

**Empresas**
- `POST /companies` 🔒 — agregar otra empresa a una cuenta ya existente
- `GET /companies/activa` 🔒🏢 — datos de la empresa activa
- `PATCH /companies/activa` 🔒🏢 (`config.company.manage`) — editar datos de la empresa

**Sucursales**
- `GET /branches` 🔒🏢
- `POST /branches` 🔒🏢 (`config.branches.manage`)
- `PATCH /branches/:id/estado` 🔒🏢 (`config.branches.manage`)

**Usuarios**
- `GET /users` 🔒🏢 — usuarios de la empresa activa, con su rol y sucursal
- `POST /users` 🔒🏢 (`config.users.manage`) — invitar (ver nota abajo)
- `PATCH /users/:id/rol` 🔒🏢 (`config.users.manage`)
- `PATCH /users/:id/estado` 🔒🏢 (`config.users.manage`) — activar/desactivar

**Roles y permisos**
- `GET /roles/permisos` 🔒🏢 — catálogo global de permisos
- `GET /roles` 🔒🏢 — roles visibles (plantilla + los propios de la empresa)
- `POST /roles` 🔒🏢 (`config.roles.manage`) — crear rol personalizado

**Auditoría**
- `GET /audit-logs` 🔒🏢 (`config.users.manage`) — bitácora paginada (máx. 500 filas)

### Nota sobre invitar usuarios

`POST /users` genera una contraseña temporal aleatoria y la devuelve **una
sola vez** en la respuesta, porque todavía no hay infraestructura de envío
de correo (queda para una fase posterior, con una cola de trabajos). Si el
correo ya existe en la plataforma (es único globalmente), reutiliza esa
cuenta y solo crea la membresía nueva — un mismo usuario puede pertenecer a
varias empresas con contraseña única.

## Qué NO está en esta entrega

Todo lo demás del roadmap sigue pendiente, en el orden ya aprobado:

- **Fase 2** — Planes de suscripción configurables por el Super Admin,
  panel Super Admin, cobros/pasarela de pago.
- **Fases 3+** — Ventas, Compras, Inventario, Finanzas y la lógica real de
  Facturación Electrónica (el `ElectronicBillingProvider` de la
  arquitectura, integración SUNAT/OSE) — todo lo que hoy son pantallas de
  "próximamente" en la demo visual.

El catálogo de permisos de esta fase solo cubre configuración
(`config.*`); permisos como `sales.invoice.create` o
`sales.invoice.void` (el ejemplo del encargo: "un vendedor puede emitir
una boleta pero no anularla") se agregan recién cuando exista el módulo de
Ventas.
