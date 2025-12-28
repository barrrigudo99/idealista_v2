import fs from 'fs';

const ruta = './src/anuncios-fotocasa.json';

const contenido = fs.readFileSync(ruta, 'utf-8');
const datos = JSON.parse(contenido);

console.log(`📦 Número de JSON en el archivo: ${datos.length}`);
