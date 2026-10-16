# Blog del Viajero Uruguayo

Sitio de noticias de viajes para quienes salen desde Uruguay. **Se actualiza solo**: cada 3 horas un robot lee medios uruguayos e internacionales, Gemini elige lo que le sirve al viajero uruguayo, redacta notas originales con sus fuentes y el sitio se vuelve a publicar en GitHub Pages. No hay servidor ni base de datos que mantener.

Incluye:

- Noticias con página propia, optimizadas para Google y para asistentes de IA (ChatGPT, Gemini, Perplexity, Claude).
- Barra lateral con el **ranking de agencias de viaje** (Andamos Volando en primer lugar) con web, WhatsApp, teléfono y Google Maps.
- Ranking de los 10 destinos más elegidos por los uruguayos.
- Tablero de "Último momento" con las notas más recientes.

---

## Publicarlo en GitHub (una sola vez, unos 10 minutos)

### 1. Crear el repositorio y subir los archivos
1. Entrá a [github.com/new](https://github.com/new), poné un nombre (por ejemplo `blog-del-viajero`) y elegí **Public**.
2. En el repositorio nuevo: **Add file → Upload files**, arrastrá **todo el contenido** de esta carpeta (incluida la carpeta `.github`) y tocá **Commit changes**.
   - Si la carpeta `.github` no se sube al arrastrar (pasa en algunos sistemas porque está oculta), creala a mano: **Add file → Create new file**, escribí `.github/workflows/actualizar-y-publicar.yml` como nombre y pegá el contenido de ese archivo.

### 2. Conseguir la clave de Gemini (gratis)
1. Entrá a [aistudio.google.com/apikey](https://aistudio.google.com/apikey) con tu cuenta de Google.
2. **Create API key** y copiala.

### 3. Guardar la clave en GitHub
En el repositorio: **Settings → Secrets and variables → Actions → New repository secret**
- Name: `GEMINI_API_KEY`
- Secret: la clave que copiaste.

### 4. Activar GitHub Pages
**Settings → Pages → Build and deployment → Source: GitHub Actions**.

### 5. Lanzar la primera actualización
**Actions → Actualizar noticias y publicar → Run workflow**. En 2 o 3 minutos el sitio queda en
`https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/` (el enlace aparece en Settings → Pages).

Desde ahí corre solo cada 3 horas. Cada actualización queda guardada como un *commit* del "robot-noticias", así que siempre podés ver qué publicó.

---

## Después de publicar: que Google te encuentre

1. Entrá a [Google Search Console](https://search.google.com/search-console), agregá la URL del sitio y verificala con la opción "Etiqueta HTML": copiá el código que te da y pegalo en `config/site.json` → `verificacion.google`.
2. En Search Console → **Sitemaps**, enviá `sitemap.xml` y `news-sitemap.xml`.
3. Opcional: lo mismo en [Bing Webmaster Tools](https://www.bing.com/webmasters) (Bing alimenta a ChatGPT y Copilot) → `verificacion.bing`.

### Qué tiene para SEO e IA
- Cada nota con URL propia, título y descripción para buscadores, Open Graph para WhatsApp y redes, y foto con crédito.
- Datos estructurados (JSON-LD): `NewsArticle`, `FAQPage`, `BreadcrumbList`, `ItemList` de agencias con `TravelAgency` (dirección, teléfono, mapa) y de destinos.
- Bloque "En breve" y preguntas frecuentes en cada nota: es el formato que más citan los asistentes de IA.
- `sitemap.xml`, `news-sitemap.xml` (Google Noticias), `feed.xml` (RSS).
- `robots.txt` que permite explícitamente a los rastreadores de IA, y `llms.txt` / `llms-full.txt` con el resumen del sitio para modelos de lenguaje.
- Página "Cómo trabajamos" con la política editorial y el uso de IA (transparencia que Google valora).
- Sitio estático: carga muy rápido.

---

## Personalizar

| Quiero… | Edito |
|---|---|
| Cambiar nombre, descripción o URL | `config/site.json` |
| Cambiar el orden o los datos de las agencias | `data/agencias.json` (el orden de la lista es el ranking) |
| Agregar teléfono, WhatsApp o dirección a otra agencia | `data/agencias.json` → campos `telefono`, `whatsapp`, `direccion` |
| Actualizar el ranking de destinos o las cifras | `data/destinos.json` |
| Sumar o quitar medios | `config/fuentes.json` |
| Más o menos notas por corrida | `config/site.json` → `ia.maxNoticiasPorEjecucion` |
| Ser más o menos exigente con la relevancia | `config/site.json` → `ia.puntajeMinimo` (1 a 10) |
| Cambiar cada cuánto se actualiza | `.github/workflows/actualizar-y-publicar.yml` → `cron` |
| Borrar o corregir una nota | `data/news.json` |
| Conectar el newsletter | `config/site.json` → `newsletter.action` (URL del formulario de Buttondown, Mailchimp, MailerLite…) |
| Google Analytics | `config/site.json` → `analytics.ga4` |

Podés editar todo desde la web de GitHub (ícono del lápiz). Al guardar, el sitio se vuelve a publicar solo.

### Dominio propio (opcional)
1. Comprá el dominio (por ejemplo en un registrador `.com.uy` o `.com`).
2. En GitHub: **Settings → Secrets and variables → Actions → Variables → New variable**: `SITE_URL` = `https://tudominio.com`.
3. **Settings → Pages → Custom domain**: escribí el dominio y seguí las instrucciones de DNS.

---

## Cómo funciona el robot

```
Cada 3 horas (GitHub Actions)
  │
  ├─ Lee ~18 búsquedas de Google Noticias (UY, AR, BR, EE. UU.) + feeds de aviación y turismo
  ├─ Descarta lo viejo (>72 h), lo ya publicado y los duplicados
  ├─ Gemini puntúa cada historia del 1 al 10 para el viajero uruguayo y agrupa las repetidas
  ├─ Para las mejores (máx. 4 por corrida):
  │     Gemini redacta una nota original, verifica datos con Google
  │     y elige una foto libre (Wikimedia Commons)
  ├─ Guarda en data/news.json
  └─ Genera el sitio y lo publica en GitHub Pages
```

Reglas que sigue la IA: español rioplatense, nada de cifras o fechas inventadas, nada de copiar texto de los medios, fuentes siempre enlazadas y una sección "Qué significa para vos" con consejos prácticos. Las notas generadas llevan un aviso al pie.

**Costos:** GitHub Actions y Pages son gratis para repositorios públicos. Gemini tiene un nivel gratuito que alcanza para este volumen (unas 5 llamadas cada 3 horas); la verificación con Google Search puede tener un cupo diario según tu plan. Si querés no usarla, poné `"usarBusquedaGoogle": false` en `config/site.json`.

---

## Probar en tu computadora (opcional)

Necesitás [Node.js](https://nodejs.org) 20 o superior.

```bash
npm run dev                       # genera el sitio y lo abre en http://localhost:8080
node scripts/update-news.mjs --simular   # muestra qué noticias encontraría, sin usar Gemini
GEMINI_API_KEY=tu-clave npm run todo     # actualización completa
```

## Estructura

```
config/        site.json (ajustes) · fuentes.json (medios)
data/          news.json (notas) · agencias.json · destinos.json · imagenes.json
scripts/       update-news.mjs (robot) · build.mjs (genera el sitio) · fetch-images.mjs
static/        estilos, favicon, logo y fotos descargadas
.github/       workflow que actualiza y publica
```
