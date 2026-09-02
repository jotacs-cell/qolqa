# Desplegar en Hostinger

## 1. Generar el build estático

```bash
npm run build
```

Esto crea `dist/` con HTML/CSS/JS estático (incluye `app/index.html`, el
panel ERP, servido como archivo estático dentro del mismo build).

Antes de compilar, edita `.env` con las URLs reales:

- `VITE_APP_LOGIN_URL` / `VITE_APP_SIGNUP_URL`: si despliegas el ERP en un
  subdominio aparte (ej. `https://app.tudominio.pe`), apunta ahí en vez de
  `/app/index.html`.
- `VITE_LEADS_API_URL`: endpoint real de `qolqa-backend` para el formulario
  del footer, con CORS habilitado para el dominio del landing.

## 2. Subir a Hostinger (hosting compartido)

1. En hPanel → **Administrador de archivos**, entra a `public_html` (o la
   subcarpeta del dominio/subdominio que uses).
2. Sube **el contenido de `dist/`** (no la carpeta `dist` en sí).
3. Alternativa: hPanel → **FTP** te da host, usuario y puerto para subir
   con un cliente FTP/SFTP (FileZilla, WinSCP). La contraseña la generas y
   guardas tú directamente en hPanel — no la compartas en el chat.

## 3. El backend (`qolqa-backend`) necesita Node.js + PostgreSQL

El hosting compartido básico de Hostinger no ejecuta procesos Node
persistentes. Opciones:

- Plan **Cloud/Business** de Hostinger con la sección **"Node.js"** en
  hPanel (crea la app, define `src/server.js` como entry point y las
  variables de `.env` ahí).
- O un servicio dedicado a Node (Railway, Render, un VPS) y apuntar
  `VITE_LEADS_API_URL` / las URLs del ERP a ese dominio.

## 4. Dominio

En hPanel → **Dominios**, apunta el dominio (o subdominio, ej.
`app.tudominio.pe` para el ERP) al hosting donde subiste cada parte.

---

Cuando tengas el plan de Hostinger elegido y el dominio, dime el/los
dominios reales y actualizo `.env` con las URLs definitivas.
