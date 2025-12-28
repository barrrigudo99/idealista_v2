// scraper-fotocasa.js
// Node.js + Puppeteer con Stealth
// Lee anuncios desde anuncios-fotocasa.json y entra al DETALLE

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import UserAgent from 'user-agents';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
const { Client } = pkg;

puppeteer.use(StealthPlugin());

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ===================== UTILIDADES =====================

async function volcarDetalleRaw(detalle) {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    user: 'admin',
    password: 'admin123',
    database: 'inmobiliaria'
  });

  await client.connect();

  await client.query(
    `
    INSERT INTO detalle_raw (id, url, data, timestamp)
    VALUES ($1, $2, $3::jsonb, $4)
    ON CONFLICT (id) DO NOTHING
    `,
    [
      detalle.id,
      detalle.url,
      JSON.stringify(detalle),
      detalle.timestamp
    ]
  );

  await client.end();
}



const esperar = (min, max) =>
  new Promise(r =>
    setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min)
  );

function leerAnuncios() {
  const ruta = path.join(__dirname, 'data/enlaces/anuncios-fotocasa.json');
  if (!fs.existsSync(ruta)) throw new Error('❌ anuncios-fotocasa.json no existe');
  return JSON.parse(fs.readFileSync(ruta, 'utf-8'));
}

function marcarProcesado(id) {
  const ruta = path.join(__dirname, 'data/enlaces/anuncios-fotocasa.json');
  const anuncios = JSON.parse(fs.readFileSync(ruta, 'utf-8'));

  for (const a of anuncios) {
    if (a.id === id) {
      a.estado = true;
      a.visitado = new Date().toISOString();
      break;
    }
  }

  fs.writeFileSync(ruta, JSON.stringify(anuncios, null, 2));
}

function guardarDetalle(detalle) {
  const ruta = path.join(__dirname, 'data/pisos/detalles-fotocasa.json');
  let datos = [];

  if (fs.existsSync(ruta)) {
    datos = JSON.parse(fs.readFileSync(ruta, 'utf-8'));
  }

  if (datos.some(d => d.id === detalle.id)) {
    console.log(`⏭️ ${detalle.id} ya guardado`);
    return;
  }

  datos.push(detalle);
  fs.writeFileSync(ruta, JSON.stringify(datos, null, 2));
  console.log(`💾 Detalle guardado: ${detalle.id}`);
}

async function scrollHumano(page) {
  const veces = Math.floor(Math.random() * 3) + 2;
  for (let i = 0; i < veces; i++) {
    await page.mouse.wheel({ deltaY: 300 + Math.random() * 400 });
    await esperar(800, 1800);
  }
}

// ===================== MAIN =====================

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const anuncios = leerAnuncios();

  for (const anuncio of anuncios) {
    if (anuncio.estado === true) continue;

    console.log(`➡️ Accediendo a ${anuncio.url}`);

    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    // UA y headers humanos
    const ua = new UserAgent().random().toString();
    await page.setUserAgent(ua);

    await page.setViewport({
      width: 1200 + Math.floor(Math.random() * 200),
      height: 800 + Math.floor(Math.random() * 200)
    });

    await page.setExtraHTTPHeaders({
      'accept-language': 'es-ES,es;q=0.9'
    });

    await esperar(3000, 6000);

    // ---------- Navegación con backoff ----------
    let ok = false;
    for (let intento = 0; intento < 4; intento++) {
      try {
        const resp = await page.goto(anuncio.url, {
          waitUntil: 'networkidle2',
          timeout: 45000
        });

        if (resp?.status() === 429) throw new Error('429');

        ok = true;
        break;
      } catch {
        const backoff = Math.pow(2, intento) * 3000;
        console.log(`⏳ Backoff ${backoff} ms`);
        await esperar(backoff, backoff + 2000);
      }
    }

    if (!ok) {
      console.log(`❌ No se pudo acceder a ${anuncio.id}`);
      await page.close();
      await context.close();
      continue;
    }

    // ---------- Simulación humana ----------
    await scrollHumano(page);
    await esperar(2000, 4000);

    // rechazar cookies si aparece el banner
    try {
      await page.waitForSelector('#didomi-notice-disagree-button', {
        timeout: 8000
      });
      await page.click('#didomi-notice-disagree-button');
      await esperar(1000, 2000);
      console.log('✅ Cookies rechazadas');
    } catch {
      console.log('ℹ️ No apareció el banner de cookies');
    }

    await scrollHumano(page);
    await esperar(2000, 4000);

    // Forzar carga de secciones inferiores (mapa / ubicación)
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await esperar(2000, 3000);



    // ---------- EXTRACCIÓN COMPLETA ----------
    const detalle = await page.evaluate(() => {

      const textoNumero = t =>
        t ? parseInt(t.replace(/\D/g, ''), 10) : null;

      const getText = sel =>
        document.querySelector(sel)?.innerText.trim() ?? null;

      const url = location.href;
      const id = url.split('/').slice(-2).join('/');

      // ===== BLOQUE CARACTERÍSTICAS =====
      const section = document.querySelector(
        '#main-content > section:nth-child(2) > div'
      );

      let featuresBlock = null;

      if (section) {
        const title =
          section.querySelector('h2')?.innerText.trim() ?? null;

        const list = section.querySelector('[data-testid="featuresList"]');

        const features = list
          ? [...list.querySelectorAll('.re-DetailFeaturesList-feature')]
              .map(item => {
                const label =
                  item.querySelector(
                    '.re-DetailFeaturesList-featureLabel'
                  )?.innerText.trim() ?? null;

                const value =
                  item.querySelector(
                    '.re-DetailFeaturesList-featureValue'
                  )?.innerText.trim() ?? null;

                if (!label || !value) return null;
                return { label, value };
              })
              .filter(Boolean)
          : [];

        featuresBlock = { title, features };
      }

      // EXTRAER EXTRAS

      const extras = (() => {
        const ul = document.querySelector(
          '#main-content > section:nth-child(2) > div > div > div.re-DetailExtras > ul'
        );

        if (!ul) return [];

        return [...ul.querySelectorAll('li')]
          .map(li => li.innerText.trim())
          .filter(Boolean);
      })();

      // EXTRAER UBICACIÓN
      const ubicacion = (() => {
        const h2s = [...document.querySelectorAll('#main-content h2')];

        for (const h2 of h2s) {
          const text = h2.innerText.trim();
          if (
            text.length > 5 &&
            !/características|descripción|precio|extras/i.test(text)
          ) {
            return text;
          }
        }

        return null;
      })();


      return {
        id,
        url,
        precio: textoNumero(getText('.re-DetailHeader-price')),
        titulo: getText('.re-DetailHeader-propertyTitle'),
        municipio: getText('.re-DetailHeader-municipalityTitle'),
        descripcion: getText('.re-DetailDescription'),
        habitaciones: textoNumero(
          getText('.re-DetailHeader-rooms span:nth-child(2)')
        ),
        banos: textoNumero(
          getText('.re-DetailHeader-bathrooms span:nth-child(2)')
        ),
        metros: textoNumero(
          getText('.re-DetailHeader-surface span:nth-child(2)')
        ),
        planta: getText(
          '.re-DetailHeader-featuresItem.floor span:nth-child(2)'
        ),
        featuresBlock,
        extras,
        ubicacion,
        timestamp: new Date().toISOString()
      };
    });

    if (detalle) {
      guardarDetalle(detalle);
      marcarProcesado(detalle.id);
      // volcar en postgres sql
      try {
        await volcarDetalleRaw(detalle);
        console.log(`🗄️ Detalle volcado en DB: ${detalle.id}`);
      } catch (e) {
        console.error(`❌ Error volcando ${detalle.id} en DB`, e.message);
      }
    }

    await page.close();
    await context.close();

    // ⏸️ pausa humana fuerte
    await esperar(10000, 20000);
  }

  await browser.close();
  console.log('🏁 Scraping finalizado');
})();
