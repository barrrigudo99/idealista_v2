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

// -------------------- UTILIDAD PAUSAS --------------------

const esperar = (min, max) =>
  new Promise(resolve =>
    setTimeout(
      resolve,
      Math.floor(Math.random() * (max - min + 1)) + min
    )
  );

  async function checkAboutBlank(page, context = '') {
  if (page.url() === 'about:blank') {
    console.log(`⚠️ about:blank detectado ${context}`);
    return true;
  }
  return false;
  }

const esperarTecla = (mensaje = '➡️ Pulsa ENTER para continuar...') => {
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
};

// -------------------- FUNCIÓN SEGURA DE EXTRACCIÓN --------------------

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

// -------------------- MAIN --------------------

(async () => {
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


  // -------------------- DETECTOR GLOBAL about:blank --------------------

let aboutBlankDetected = false;

page.on('framenavigated', frame => {
  if (frame === page.mainFrame() && frame.url() === 'about:blank') {
    aboutBlankDetected = true;
    console.log('⚠️ about:blank detectado (framenavigated)');
  }
});

  // -------------------- AHORRO DE TRÁFICO (NO BLOQUEAR IMÁGENES) --------------------

  await page.setRequestInterception(true);
  page.on('request', req => {
    const type = req.resourceType();
    if (['font', 'media'].includes(type)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  page.on('console', msg => console.log('📢 NAV:', msg.text()));

  let pagina = 1;
  let pisosVisitados = 0;
  let errores = 0;

  const listadoURL =
    'https://www.idealista.com/alquiler-viviendas/madrid/centro/malasana-universidad/';

  // -------------------- ENTRADA --------------------

  await page.goto(listadoURL, { waitUntil: 'networkidle2' });

 


  try {
    await page.waitForSelector('#didomi-notice-disagree-button', { timeout: 10000 });
    await page.click('#didomi-notice-disagree-button');
    console.log('✅ Cookies rechazadas');
  } catch {
    console.log('⚠️ No apareció el banner de cookies');
  }

  // -------------------- LOOP PÁGINAS --------------------

  while (true) {
    

    console.log(`\n📄 Página ${pagina}`);

    await page.keyboard.press('End');
    await esperar(2000, 4500);

    await page.waitForSelector('#main-content section article');

    const articlesCount = await page.$$eval(
      '#main-content section article',
      els => els.length
    );

    console.log(`🏠 Pisos encontrados: ${articlesCount}`);


    // -------------------- EXTRACCIÓN LINKS DE LA PÁGINA --------------------

    const articles = await page.$$('#main-content section article');

    const linksPagina = [];

    for (let i = 0; i < articles.length; i++) {
      try {
        const data = await articles[i].$eval(
          'div.item-info-container > a',
          el => ({
            texto: el.innerText.trim(),
            href: el.href
          })
        );

        linksPagina.push(data);

        console.log(`🔗 Link ${i + 1}`);
        console.log('   Texto:', data.texto);
        console.log('   Href:', data.href);

      } catch {
        console.log(`⚠️ Piso ${i + 1} sin link`);
      }
    }


    // -------------------- LOOP PISOS --------------------
for (let i = 0; i < articlesCount; i++) {
  try {
    const articles = await page.$$('#main-content section article');
    const article = articles[i];
    if (!article) continue;

    await article.evaluate(el =>
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    );

    await esperar(600, 1400);
    await esperarTecla('Pulsa ENTER para entrar');

    // 🔥 CLICK SOBRE EL ARTICLE
    aboutBlankDetected = false; // 🔁 reset antes del click

    await article.click({ delay: 120 });
    await esperar(1200);

    if (aboutBlankDetected) {
      errores++;
      console.log('🚫 Navegación abortada (about:blank)');
      try {
        await page.goBack({ waitUntil: 'networkidle2' });
      } catch {
        await page.goto(listadoURL, { waitUntil: 'networkidle2' });
      }
      continue;
    }

    await page.waitForSelector('h1', { timeout: 10000 });

    // EXTRACCIÓN
    const titulo = await getTextSafe(page, 'h1 span');
    const nombreComercial = await getTextSafe(page, '#commercial-name');
    console.log(`🏷️ Título: ${titulo}`);
    console.log(`🏢 Comercial: ${nombreComercial}`);

    pisosVisitados++;
    console.log(`✅ Piso ${pisosVisitados}`);

    await esperar(1800, 3200);
    await page.goBack({ waitUntil: 'networkidle2' });

  } catch {
    errores++;
    try { await page.goBack({ waitUntil: 'networkidle2' }); } catch {}
  }
}
 


    // -------------------- SIGUIENTE PÁGINA --------------------

    const siguienteBtn = await page.$('a.icon-arrow-right-after');

    if (!siguienteBtn) {
      console.log('\n🏁 No hay más páginas');
      break;
    }

    await Promise.all([
      siguienteBtn.click(),
      page.waitForNavigation({ waitUntil: 'networkidle2' })
    ]);

    pagina++;
    await esperar(3000, 6000);
  }

  // -------------------- RESUMEN --------------------

  console.log('\n📊 RESUMEN FINAL');
  console.log(`✔️ Pisos visitados: ${pisosVisitados}`);
  console.log(`❌ Errores: ${errores}`);

  // await browser.close();
})();
