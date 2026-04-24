# SGO Frontend

Aplicacion React + TypeScript + Vite, preparada para despliegue en Vercel.

## Requisitos

- Node.js 20+
- npm 10+

## Variables de entorno

Crear un archivo `.env` en local usando `.env.example` como base:

```bash
cp .env.example .env
```

Variables disponibles:

- `VITE_API_BASE_URL`: URL base del backend (ejemplo: `https://api.tu-dominio.com/api/v1`)
- `VITE_API_DOCUMENTO`: token para consultas de documento
- `VITE_PASSWORD_EXPIRATION_LOCK_ENABLED`: feature flag (`true` o `false`)

Para LAN usa `.env.lan.example` como referencia y asegúrate de usar la IP del servidor backend (no `localhost`):

```env
VITE_API_BASE_URL=http://192.168.1.50:5000/api/v1
```

## Desarrollo local

```bash
npm install
npm run dev
```

## Build de produccion

```bash
npm run build
```

Para el entorno de Vercel se usa:

```bash
npm run build:vercel
```

## Despliegue en LAN

1. Instala dependencias:

```bash
npm install
```

2. Configura entorno para LAN (ejemplo):

```bash
cp .env.lan.example .env
```

3. Genera build para LAN:

```bash
npm run build:lan
```

4. Sirve la app en red local:

```bash
npm run preview
```

5. Abre desde otro equipo en la misma red:

```text
http://IP_DE_TU_PC:4173
```

Ejemplo:

```text
http://192.168.1.50:4173
```

Notas importantes para que funcione en LAN:

- El backend debe estar accesible por red local.
- `VITE_API_BASE_URL` debe apuntar al host/puerto reales del backend en LAN.
- Abre en firewall el puerto `4173` (frontend) y el puerto del backend (ej. `5000`).
- Si el backend está en otro host/puerto, habilita CORS para el origen del frontend (ej. `http://192.168.1.50:4173`).

### HTTPS en LAN (Windows)

1. Instala `mkcert` y crea CA local:

```powershell
winget install --id FiloSottile.mkcert -e --accept-package-agreements --accept-source-agreements
mkcert -install
```

2. Genera cert para LAN (ajusta IP):

```env
mkcert -cert-file ../certs/lan-cert.pem -key-file ../certs/lan-key.pem 192.168.18.117 localhost 127.0.0.1 ::1
```

3. Configura `.env` (o `.env.lan`) con:

```env
VITE_HTTPS_CERT_PATH=../certs/lan-cert.pem
VITE_HTTPS_KEY_PATH=../certs/lan-key.pem
```

4. Build + preview HTTPS:

```bash
npm run build:lan
npm run preview:https
```

5. Accede desde LAN:

```text
https://IP_DE_TU_PC:4173
```

6. Para móviles/tablets, instala también la CA de `mkcert` (`rootCA.pem`) como certificado de confianza en cada dispositivo.

## Despliegue en Vercel

1. Importar el repositorio en Vercel.
2. Framework preset: `Vite` (opcional, ya existe `vercel.json`).
3. Configurar variables de entorno en Vercel:
   - `VITE_API_BASE_URL`
   - `VITE_API_DOCUMENTO`
   - `VITE_PASSWORD_EXPIRATION_LOCK_ENABLED` (opcional)
4. Deploy.

`vercel.json` ya incluye:

- `buildCommand`: `npm run build`
- `outputDirectory`: `dist`
- fallback de rutas SPA hacia `index.html`

## Notas de arquitectura

- El endpoint de backend se centraliza en `src/config.ts`.
- Para construir endpoints se usa `buildApiUrl(path)`.
- Evita hardcodes de host en componentes/stores para mantener escalabilidad por entorno.
