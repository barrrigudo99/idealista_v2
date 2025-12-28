import { spawn } from 'child_process';

function ejecutar(script) {
  return new Promise((resolve, reject) => {
    const proceso = spawn('node', [script], { stdio: 'inherit' });

    proceso.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${script} terminó con código ${code}`));
    });
  });
}

(async () => {
  try {
    console.log('🔗 FASE 1: Extracción de enlaces');
    await ejecutar('src/minero.js');

    console.log('🏠 FASE 2: Extracción de detalles');
    await ejecutar('src/extractor_detalle.js');

    console.log('✅ PIPELINE COMPLETADO');
  } catch (e) {
    console.error('❌ PIPELINE FALLÓ', e.message);
  }
})();
