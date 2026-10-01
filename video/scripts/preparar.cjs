// Traz para o vídeo os avisos sonoros de verdade da sala (public/sons), para ele soar como o
// Nexo soa. Cópia, e não link: o Remotion só serve o que está na pasta public dele. A cópia não
// vai para o git (video/.gitignore) -- a fonte continua sendo public/sons.
//
//   node scripts/preparar.cjs      (o `npm run estudio` e o `npm run renderizar` já chamam)
const fs = require('node:fs');
const path = require('node:path');

const ORIGEM = path.join(__dirname, '..', '..', 'public', 'sons');
const DESTINO = path.join(__dirname, '..', 'public', 'audio', 'sala');
const SONS = ['entrada', 'saida', 'tela', 'assistir', 'mencao', 'mensagem', 'mic-ligado'];

fs.mkdirSync(DESTINO, { recursive: true });
for (const som of SONS) fs.copyFileSync(path.join(ORIGEM, `${som}.mp3`), path.join(DESTINO, `${som}.mp3`));

// Sem a trilha e os efeitos (gerados no ElevenLabs, versionados em public/audio), nada toca.
const faltam = ['trilha-apresentacao', 'trilha-lancamento', 'whoosh', 'pop', 'brilho', 'impacto', 'teclado', 'piada', 'uhh', 'palmas', 'boing']
  .filter(nome => !fs.existsSync(path.join(__dirname, '..', 'public', 'audio', `${nome}.mp3`)));
if (faltam.length) {
  console.error(`Faltam em video/public/audio: ${faltam.join(', ')}.mp3 (ver docs/novidades.md).`);
  process.exit(1);
}
console.log(`Sons da sala copiados: ${SONS.length}.`);

// O Reels de humor tem áudio próprio (falas, trilha e efeitos, gerados no ElevenLabs e tratados por
// scripts/reels-audio.cjs). Só ele precisa disso: os outros vídeos renderizam sem.
if (!fs.existsSync(path.join(__dirname, '..', 'public', 'audio', 'reels', 'fala', 'v01.mp3'))) {
  console.warn('Aviso: faltam as falas do Reels de humor em video/public/audio/reels (ver docs/novidades.md); os outros vídeos não são afetados.');
}
