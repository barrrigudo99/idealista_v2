import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';
import readline from 'node:readline';


// ===================== FUNCIONES =====================

const extraerId = (url) =>
  url.split('/').slice(-2).join('/');

// guardar enlaces en archivo json
function guardarEnlaces(enlaces) {
  const rutaArchivo = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'enlaces-fotocasa.json'
  );

  fs.writeFileSync(
    rutaArchivo,
    JSON.stringify([...enlaces], null, 2),
    'utf-8'
  );

  console.log(`💾 Enlaces guardados en ${rutaArchivo}`);
}


function registrarDuplicado(anuncio) {
  const rutaArchivo = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'data/enlaces/duplicados/duplicados-fotocasa.json'
  );

  let duplicados = {};

  if (fs.existsSync(rutaArchivo)) {
    duplicados = JSON.parse(fs.readFileSync(rutaArchivo, 'utf-8'));
  }

  if (!duplicados[anuncio.id]) {
    duplicados[anuncio.id] = {
      url: anuncio.url,
      count: 1,
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString()
    };
  } else {
    duplicados[anuncio.id].count += 1;
    duplicados[anuncio.id].last_seen = new Date().toISOString();
  }

  fs.writeFileSync(
    rutaArchivo,
    JSON.stringify(duplicados, null, 2),
    'utf-8'
  );
}

async function volcarDuplicado(anuncio) {
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
    INSERT INTO duplicados (id, url, count, first_seen, last_seen)
    VALUES ($1, $2, 1, NOW(), NOW())
    ON CONFLICT (id)
    DO UPDATE SET
      count = duplicados.count + 1,
      last_seen = NOW()
    `,
    [anuncio.id, anuncio.url]
  );

  await client.end();
}


async function mergeAnuncios(nuevosAnuncios) {
  const rutaArchivo = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'data/enlaces/anuncios-fotocasa.json'
  );

  let existentes = [];

  if (fs.existsSync(rutaArchivo)) {
    existentes = JSON.parse(fs.readFileSync(rutaArchivo, 'utf-8'));
  }

  // Map por ID (preserva estado)
  const map = new Map(
    existentes.map(a => [a.id, a])
  );

  // Añadir solo anuncios nuevos
 if (map.has(a.id)) {
    registrarDuplicado(a);      // JSON local (opcional)
    await volcarDuplicado(a);   // PostgreSQL
  } else {
    map.set(a.id, a);
  }

  fs.writeFileSync(
    rutaArchivo,
    JSON.stringify([...map.values()], null, 2),
    'utf-8'
  );

  console.log(`🔗 Total anuncios únicos: ${map.size}`);
}



async function obtenerEnlaces(page) {
  await page.waitForSelector('article.\\@container.w-full', {
    timeout: 10000
  });

  const enlaces = await page.evaluate(() => {
    return [...document.querySelectorAll('article.\\@container.w-full')]
      .map(article => article.querySelector('h3 a')?.href)
      .filter(Boolean);
  });

  console.log(`🔗 Enlaces encontrados: ${enlaces.length}`);
  return enlaces;
}


function leerNoImportados(limite = 50) {
  const ruta = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'anuncios-fotocasa.json'
  );

  if (!fs.existsSync(ruta)) return [];

  const anuncios = JSON.parse(fs.readFileSync(ruta, 'utf-8'));
  return anuncios
    .filter(a => a.importado !== true)
    .slice(0, limite);
}

import pkg from 'pg';
const { Client } = pkg;

async function volcarEnPostgres(anuncios) {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    user: 'admin',
    password: 'admin123',
    database: 'inmobiliaria'
  });

  await client.connect();

  for (const a of anuncios) {
    await client.query(
      `
      INSERT INTO enlaces (id, url, timestamp)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO NOTHING
      `,
      [a.id, a.url, a.timestamp]
    );
  }

  await client.end();
}


function marcarImportados(ids) {
  const ruta = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'data/enlaces/anuncios-fotocasa.json'
  );

  const anuncios = JSON.parse(fs.readFileSync(ruta, 'utf-8'));

  anuncios.forEach(a => {
    if (ids.includes(a.id)) {
      a.importado = true;
      a.importado_at = new Date().toISOString();
    }
  });

  fs.writeFileSync(ruta, JSON.stringify(anuncios, null, 2));
}


async function obtenerAnuncios(page) {
  await page.waitForSelector('article.\\@container.w-full', {
    timeout: 10000
  });

  return await page.evaluate(() => {
    return [...document.querySelectorAll('article.\\@container.w-full')]
      .map(article => {
        const a = article.querySelector('h3 a');
        if (!a) return null;

        const url = a.href;
        const partes = url.split('/');
        const id = partes.slice(-2).join('/');

        return {
          id,
          url,
          estado: false,
          importado: false,
          timestamp: new Date().toISOString()
        };
      })
      .filter(Boolean);
  });
}



function entradaTeclado(mensaje = '➡️ Pulsa ENTER para continuar...') {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(`\n${mensaje}\n`, () => {
      rl.close();
      resolve();
    });
  });
}


const volverAtras = async (page) => {
  try {
    await page.goBack({
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    return true;
  } catch (e) {
    return false;
  }
};

const scrollHumano = async (page) => {
  const acciones = Math.floor(Math.random() * 3) + 2;

  for (let i = 0; i < acciones; i++) {
    await page.mouse.wheel({
      deltaY: Math.floor(Math.random() * 400) + 200
    });

    await esperar(400, 1200); // 👈 en vez de waitForTimeout
  }
};

const scrollRapidoAbajoYArriba = async (page) => {
  // ⬇️ BAJAR RÁPIDO
  while (true) {
    const bajado = await page.evaluate(() => {
      const antes = window.scrollY;
      window.scrollBy(0, 800);
      return window.scrollY > antes;
    });

    if (!bajado) break;
    await esperar(80, 160); // rápido
  }

  // ⏸️ mini pausa humana
  await esperar(300, 600);

  // ⬆️ SUBIR RÁPIDO
  while (true) {
    const subido = await page.evaluate(() => {
      const antes = window.scrollY;
      window.scrollBy(0, -800);
      return window.scrollY < antes;
    });

    if (!subido) break;
    await esperar(80, 160); // rápido
  }
};


const esperar = (min, max) => new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));

const pausaLargaAleatoria = async () => {
  if (Math.random() < 0.15) {
    await esperar(20000, 42000);
  }
};

const aceptarCookies = async (page) => {
  try {
    await page.waitForSelector('#didomi-notice-disagree-button', { timeout: 8000 }); //document.querySelector("#didomi-notice-disagree-button")
    await page.click('#didomi-notice-disagree-button');
    await page.click('#modal-react-portal > div > div > div.sui-MoleculeModalContent > div > div > button.inline-flex.items-center.justify-center.gap-md.whitespace-nowrap.font-bold.outline-none.focus-visible\\:u-ring.border-sm.border-solid.border-current.bg-transparent.h-40.min-w-40.px-lg.text-body-2.rounded-md.hover\\:bg-basic\\/dim-5.data-\\[state\\=on\\]\\:bg-basic\\/dim-5.enabled\\:active\\:bg-basic\\/dim-5.focus-visible\\:bg-basic\\/dim-5.text-basic.sm\\:order-1');
    await esperar(1000, 2000);
  } catch {}
};

const clickPorSelector = async (page, selector) => {
  const existe = await page.$(selector);
  if (!existe) return false;

  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (el.href) {
      window.location.href = el.href;
    } else {
      el.click();
    }
  }, selector);

  // espera híbrida
  await Promise.race([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.waitForTimeout(3000)
  ]);

  return true;
};



const siguientePagina = async (page) => {
  const exito = await page.evaluate(() => {
    const li = [...document.querySelectorAll('nav ul li')]
      .find(li =>
        li.querySelector('a[aria-label="Ir a la siguiente página"]')
      );

    const a = li?.querySelector('a');
    if (!a) return false;

    a.scrollIntoView({ behavior: 'smooth', block: 'center' });
    a.click();
    return true;
  });

  // Fotocasa es SPA → no siempre hay navegación clásica
  if (exito) {
    await new Promise(r => setTimeout(r, 2500));
  }

  return exito;
};




// ===================== MAIN =====================

// Configuración Puppeteer

puppeteer.use(StealthPlugin());

const BASE_URL ='https://www.fotocasa.es/es/alquiler/viviendas/espana/todas-las-zonas/l/1600';
const browser = await puppeteer.launch({

headless: false,
slowMo: 20, // 🧠 micro-latencia humana
args: [
    '--incognito',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled'
]
});
const [page] = await browser.pages();

await page.setUserAgent(
'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

await page.setExtraHTTPHeaders({
'accept-language': 'es-ES,es;q=0.9',
'upgrade-insecure-requests': '1'
});

const anunciosGlobales = new Map();


// Entrar al listado
await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 60000 });
await aceptarCookies(page);
while (true) {
  await scrollRapidoAbajoYArriba(page);
  await esperar(2000, 4000);
  const anuncios = await obtenerAnuncios(page);

  anuncios.forEach(a => {
    if (!anunciosGlobales.has(a.id)) {
      anunciosGlobales.set(a.id, a);
    }
  });

  console.log(`📦 Total acumulados: ${anunciosGlobales.size}`);
  // guardar enlaces en archivo json
  mergeAnuncios(anuncios);

  // ⬇️ solo anuncios NUEVOS de esta página
  const pendientes = anuncios.filter(a => a.importado !== true);

  if (pendientes.length > 0) {
    console.log(`🚀 Volcando ${pendientes.length} anuncios de esta página`);

    try {
      await volcarEnPostgres(pendientes);
      marcarImportados(pendientes.map(a => a.id));
    } catch (e) {
      console.error('❌ Error en volcado, se reintentará en la siguiente página');
    }
  }


  const ok = await siguientePagina(page);
  if (!ok) {
    console.log('No hay más páginas');
    //await entradaTeclado('⏸️ Fin del scraping. Pulsa ENTER para salir');

    break;
  }

  await esperar(2000, 4000);
}
const pendientesFinales = leerNoImportados(1000);
if (pendientesFinales.length > 0) {
  await volcarEnPostgres(pendientesFinales);
  marcarImportados(pendientesFinales.map(a => a.id));
}


