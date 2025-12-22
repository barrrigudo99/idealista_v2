/*
  SCRAPER IDEALISTA – FLUJO HUMANO, ROBUSTO Y OPTIMIZADO
*/

import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';
import readline from 'readline';

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ======================================================
// ===================== UTILIDADES =====================
// ======================================================

const esperar = (min, max) =>
  new Promise(resolve =>
    setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min)
  );

const esperarTecla = (mensaje = '➡️ Pulsa ENTER para continuar...') =>
  new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(`\n${mensaje}\n`, () => {
      rl.close();
      resolve();
    });
  });

async function getTextSafe(page, selector, type = 'css') {
  try {
    if (type === 'xpath') {
      const el = await page.waitForXPath(selector, { timeout: 5000 });
      return await page.evaluate(el => el.innerText.trim(), el);
    } else {
      await page.waitForSelector(selector, { timeout: 5000 });
      return await page.$eval(selector, el => el.innerText.trim());
    }
  } catch {
    return null;
  }
}

function extraerIdDesdeHref(href) {
  const match = href.match(/inmueble\/(\d+)/);
  return match ? match[1] : null;
}

function guardarDetallePisoEnArchivo({ id, detalle }) {
  if (!id || !detalle) return;

  const dirPath = path.join(__dirname, 'pisos');
  const filePath = path.join(dirPath, 'pisos_detalle.json');

  // Crear carpeta si no existe
  fs.mkdirSync(dirPath, { recursive: true });

  let data = [];

  // Si el archivo ya existe, leerlo
  if (fs.existsSync(filePath)) {
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      console.log('⚠️ Error leyendo pisos_detalle.json, se reinicia');
      data = [];
    }
  }

  // Evitar duplicados por ID
  const yaExiste = data.some(p => p.id === id);
  if (yaExiste) {
    console.log(`⏭️ Piso ${id} ya guardado, se omite`);
    return;
  }

  // Añadir nuevo piso
  data.push({ id, detalle });

  // Guardar archivo actualizado
  fs.writeFileSync(
    filePath,
    JSON.stringify(data, null, 2),
    'utf-8'
  );

  console.log(`💾 Piso ${id} añadido a pisos_detalle.json`);
}


function marcarPisoComoProcesado({ id, pagina }) {
  const filePath = path.join(
    __dirname,
    `links_pagina_${pagina}.json`
  );

  if (!fs.existsSync(filePath)) {
    console.log(`⚠️ No existe ${filePath}`);
    return;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    console.log(`❌ Error leyendo ${filePath}`);
    return;
  }

  const piso = data.find(p => p.id === id);
  if (!piso) {
    console.log(`⚠️ Piso ${id} no encontrado en links`);
    return;
  }

  piso.estado = true;

  fs.writeFileSync(
    filePath,
    JSON.stringify(data, null, 2),
    'utf-8'
  );

  console.log(`✅ Estado actualizado a true para piso ${id}`);
}

function obtenerIdsPendientesPagina(pagina) {
  const filePath = path.join(__dirname, `links_pagina_${pagina}.json`);

  if (!fs.existsSync(filePath)) return new Set();

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  return new Set(
    data
      .filter(p => p.estado === false)
      .map(p => p.id)
  );
}

// ======================================================
// ===================== SETUP PAGE =====================
// ======================================================

async function setupBrowser() {
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--incognito',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const [page] = await browser.pages();
  return { browser, page };
}

async function setupRequestInterception(page) {
  await page.setRequestInterception(true);
  page.on('request', req => {
    const type = req.resourceType();
    if (['font', 'media'].includes(type)) req.abort();
    else req.continue();
  });

  page.on('console', msg => console.log('📢 NAV:', msg.text()));
}

// ======================================================
// =============== DETECTOR about:blank =================
// ======================================================

function setupAboutBlankDetector(page) {
  let aboutBlankDetected = false;

  page.on('framenavigated', frame => {
    if (frame === page.mainFrame() && frame.url() === 'about:blank') {
      aboutBlankDetected = true;
      console.log('⚠️ about:blank detectado (framenavigated)');
    }
  });

  return {
    reset: () => (aboutBlankDetected = false),
    detected: () => aboutBlankDetected
  };
}

// ======================================================
// =================== ACCIONES PAGE ====================
// ======================================================

async function aceptarCookies(page) {
  try {
    await page.waitForSelector('#didomi-notice-disagree-button', { timeout: 10000 });
    await page.click('#didomi-notice-disagree-button');
    console.log('✅ Cookies rechazadas');
  } catch {
    console.log('⚠️ No apareció el banner de cookies');
  }
}

async function scrollListado(page) {
  await page.keyboard.press('End');
  await esperar(2000, 4500);
}

async function irSiguientePagina(page) {
  const btn = await page.$('a.icon-arrow-right-after');
  if (!btn) return false;

  await btn.click();
  await page.waitForSelector('#main-content section article');
  await esperar(3000, 6000);
  return true;
}

// ======================================================
// ================= SCRAPING LISTADO ==================
// ======================================================

async function obtenerArticulos(page) {
  await page.waitForSelector('#main-content section article');
  return await page.$$('#main-content section article');
}

async function extraerLinksPagina(articles) {
  const links = [];

  for (let i = 0; i < articles.length; i++) {
    try {
      const data = await articles[i].$eval(
        'div.item-info-container > a',
        el => ({
          texto: el.innerText.trim(),
          href: el.href
        })
      );

      links.push(data);
      console.log(`🔗 Link ${i + 1}`);
      console.log('   Texto:', data.texto);
      console.log('   Href:', data.href);
    } catch {
      console.log(`⚠️ Piso ${i + 1} sin link`);
    }
  }

  return links;
}

// ======================================================
// ================= SCRAPING PISO ======================
// ======================================================

async function procesarPiso({page,article,detector,listadoURL,estado}) {
  try {
    await article.evaluate(el =>
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    );

    await esperar(600, 1400);
    //await esperarTecla('Pulsa ENTER para entrar');

    detector.reset();
    await article.click({ delay: 120 });
    await esperar(1200);

    if (detector.detected()) {
      estado.errores++;
      console.log('🚫 Navegación abortada (about:blank)');
      try {
        await page.goBack({ waitUntil: 'networkidle2' });
      } catch {
        await page.goto(listadoURL, { waitUntil: 'networkidle2' });
      }
      return;
    }

    await page.waitForSelector('h1', { timeout: 10000 });

    const detalleInfo = await getTextSafe(
    page,
    '#main > div > main > section.detail-info.ide-box-detail-first-picture.ide-box-detail--reset.overlay-box'
    );
    const currentUrl = page.url();
    const id = extraerIdDesdeHref(currentUrl);

    guardarDetallePisoEnArchivo({
    id,
    detalle: detalleInfo
    });
    marcarPisoComoProcesado({
    id,
    pagina: estado.pagina
    });



    console.log('📦 Detalle info (texto completo):');
    console.log(detalleInfo);

    estado.pisosVisitados++;
    console.log(`✅ Piso ${estado.pisosVisitados}`);

    await esperar(1800, 3200);
    await page.goBack({ waitUntil: 'networkidle2' });

  } catch {
    estado.errores++;
    try {
      await page.goBack({ waitUntil: 'networkidle2' });
    } catch {}
  }
}

// ======================================================
// ======================= MAIN =========================
// ======================================================

(async () => {
  const { browser, page } = await setupBrowser();
  await setupRequestInterception(page);

  const detector = setupAboutBlankDetector(page);

  const listadoURL =
    'https://www.idealista.com/alquiler-viviendas/madrid/centro/malasana-universidad/';

  const estado = {
    pagina: 1,
    pisosVisitados: 0,
    errores: 0
  };

  await page.goto(listadoURL, { waitUntil: 'networkidle2' });
  await aceptarCookies(page);

  while (true) {
    console.log(`\n📄 Página ${estado.pagina}`);

    await scrollListado(page);

    const articles = await obtenerArticulos(page);
    console.log(`🏠 Pisos encontrados: ${articles.length}`);

    // 1️⃣ Obtener links de la página
    const linksPagina = await extraerLinksPagina(articles);

    // 2️⃣ Convertir a tu estructura JSON
    const jsonPagina = linksPagina.map(link => ({
    id: extraerIdDesdeHref(link.href),
    pagina: estado.pagina,
    links: [link],
    estado: false
    }));

    // 3️⃣ Guardar en archivo
    const outputFile = path.join(
    __dirname,
    `links_pagina_${estado.pagina}.json`
    );

    let jsonFinal = jsonPagina;

    if (fs.existsSync(outputFile)) {
    const existente = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));

    jsonFinal = jsonPagina.map(nuevo => {
        const viejo = existente.find(e => e.id === nuevo.id);
        return viejo ? viejo : nuevo;
    });
    }

    fs.writeFileSync(
    outputFile,
    JSON.stringify(jsonFinal, null, 2),
    'utf-8'
    );


    console.log(`💾 JSON guardado: ${outputFile}`);

    let idsPendientes = obtenerIdsPendientesPagina(estado.pagina);

    while (idsPendientes.size > 0) {
    console.log(
        `🔁 Reprocesando página ${estado.pagina} | Pendientes: ${idsPendientes.size}`
    );

    const articlesPagina = await obtenerArticulos(page);

    for (const article of articlesPagina) {
        let href, id;

        try {
        href = await article.$eval(
            'div.item-info-container > a',
            el => el.href
        );
        id = extraerIdDesdeHref(href);
        } catch {
        continue;
        }

        // 🚦 SOLO visitar pendientes
        if (!idsPendientes.has(id)) continue;

        await procesarPiso({
        page,
        article,
        detector,
        listadoURL,
        estado
        });
    }

    // 🔄 Releer pendientes tras procesar
    idsPendientes = obtenerIdsPendientesPagina(estado.pagina);

    if (idsPendientes.size > 0) {
        console.log('⏳ Aún quedan pisos pendientes, reintentando...');
        await scrollListado(page);
    }
    }




    const hayMas = await irSiguientePagina(page);
    if (!hayMas) break;

    estado.pagina++;
  }

  console.log('\n📊 RESUMEN FINAL');
  console.log(`✔️ Pisos visitados: ${estado.pisosVisitados}`);
  console.log(`❌ Errores: ${estado.errores}`);

  // await browser.close();
})();
