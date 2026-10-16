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

// As gravações do Nexo de verdade que a Apresentação e o Lançamento mostram (src/base/gravacoes.js). Quem grava é o
// video-discord (Playwright dirigindo o Nexo, com servidor, contas e câmeras de mentira; ver video-discord/README.md),
// e o preparar de lá deixa os clipes com quadro-chave a cada 15 quadros em video-discord/public/clipes. Daqui só se
// leva: elo quando dá (são ~150 MB), cópia quando não.
const CLIPES = path.join(__dirname, '..', '..', 'video-discord', 'public', 'clipes');
const DESTINO_DOS_CLIPES = path.join(__dirname, '..', 'public', 'clipes');
const USADOS = ['01-abrir', '02b-convite', '03-cameras', '04-assistir', '05-transmitir', '06-volume', '07-chat', '08-mesa-de-sons', '09-musica', '10-perfil', '12-temas', '15-celular'];
const semClipe = USADOS.filter(nome => !fs.existsSync(path.join(CLIPES, `${nome}.mp4`)));
if (semClipe.length) {
  console.error(`Faltam as gravações ${semClipe.join(', ')} em video-discord/public/clipes. Grave e prepare por lá:`
    + ' node captura\\gravar.cjs --isolado … e node scripts\\preparar.cjs (video-discord/README.md).');
  process.exit(1);
}
fs.mkdirSync(DESTINO_DOS_CLIPES, { recursive: true });
for (const nome of USADOS) {
  const origem = path.join(CLIPES, `${nome}.mp4`), destino = path.join(DESTINO_DOS_CLIPES, `${nome}.mp4`);
  if (fs.existsSync(destino) && fs.statSync(destino).mtimeMs >= fs.statSync(origem).mtimeMs) continue;
  fs.rmSync(destino, { force: true });
  try { fs.linkSync(origem, destino); } catch (_) { fs.copyFileSync(origem, destino); }
}
console.log(`Gravações do Nexo levadas: ${USADOS.length}.`);

// O Reels de humor tem áudio próprio (falas, trilha e efeitos, gerados no ElevenLabs e tratados por
// scripts/reels-audio.cjs). Só ele precisa disso: os outros vídeos renderizam sem.
if (!fs.existsSync(path.join(__dirname, '..', 'public', 'audio', 'reels', 'fala', 'v01.mp3'))) {
  console.warn('Aviso: faltam as falas do Reels de humor em video/public/audio/reels (ver docs/novidades.md); os outros vídeos não são afetados.');
}
