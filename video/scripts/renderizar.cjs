// Renderiza os vídeos do Nexo e entrega em public/midia, prontos para a página servir.
//
//   npm --prefix video run renderizar            (os três)
//   npm --prefix video run renderizar -- Apresentacao
//   npm --prefix video run renderizar -- --so-video   (os três, só em video/saida: nada entra em public/midia)
//
// Três passos por vídeo:
//   1. o Remotion renderiza (H.264, CRF 23: imagem de interface comprime muito bem, e o
//      arquivo sai pela banda de quem hospeda -- cada MB conta);
//   2. o ffmpeg nivela o som a −16 LUFS, o padrão da web, sem mexer na imagem, e põe o índice
//      no começo do arquivo (`faststart`): sem isso o navegador precisa baixar o vídeo inteiro
//      antes de começar a tocar;
//   3. uma capa em JPEG, que é o que o modal mostra antes do play.
//
// E os sons da mesa de demonstração do modal (public/midia/mesa), nivelados por volume médio:
// são curtos demais para a loudness integrada medir direito.
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync, spawnSync } = require('node:child_process');
const { bundle } = require('@remotion/bundler');
const { selectComposition, renderMedia, renderStill } = require('@remotion/renderer');

const RAIZ = path.join(__dirname, '..');
const SAIDA = path.join(RAIZ, 'saida');
const MIDIA = path.join(RAIZ, '..', 'public', 'midia');

// id da composição → nome do arquivo e o quadro da capa (o momento que melhor diz o que é).
// `soVideo`: fica em video/saida (não é para o site) e não entra no `renderizar` sem argumentos;
// pede-se pelo nome, ou pelo grupo: `renderizar -- Reels`.
const VIDEOS = {
  Apresentacao: { arquivo: 'apresentacao', capa: 100 },
  Lancamento: { arquivo: 'lancamento', capa: 320 },
  LancamentoVertical: { arquivo: 'lancamento-vertical', capa: 320 },
  ReelsComVoz: { arquivo: 'nexo-reels-com-voz', capa: 250, soVideo: true },
  ReelsSemVoz: { arquivo: 'nexo-reels-sem-voz', capa: 250, soVideo: true }
};
const GRUPOS = { Reels: ['ReelsComVoz', 'ReelsSemVoz'] };
const MESA = ['piada', 'uhh', 'palmas', 'boing'];

const ffmpeg = argumentos => execFileSync('ffmpeg', ['-v', 'error', '-y', ...argumentos], { stdio: ['ignore', 'pipe', 'pipe'] });
const mb = arquivo => (fs.statSync(arquivo).size / 1048576).toFixed(1);

// `--so-video`: tudo fica em video/saida, como os Reels. Serve para refazer um vídeo e olhar antes de ele
// ir para o site: public/midia (o que a página serve) não é tocado, nem a mesa de sons.
const SO_VIDEO = process.argv.includes('--so-video');

async function main() {
  const pedidos = process.argv.slice(2).flatMap(id => GRUPOS[id] ?? [id]).filter(id => VIDEOS[id]);
  const ids = pedidos.length ? pedidos : Object.keys(VIDEOS).filter(id => !VIDEOS[id].soVideo);
  fs.mkdirSync(SAIDA, { recursive: true });
  if (!SO_VIDEO) fs.mkdirSync(path.join(MIDIA, 'mesa'), { recursive: true });

  console.log('Empacotando…');
  const serveUrl = await bundle({ entryPoint: path.join(RAIZ, 'src', 'index.js'), publicDir: path.join(RAIZ, 'public') });

  for (const id of ids) {
    const { arquivo, capa } = VIDEOS[id];
    const soVideo = VIDEOS[id].soVideo || SO_VIDEO;
    const composition = await selectComposition({ serveUrl, id });
    const bruto = path.join(SAIDA, soVideo ? `${arquivo}.bruto.mp4` : `${arquivo}.mp4`);
    let ultimo = -1;
    await renderMedia({
      composition, serveUrl, codec: 'h264', crf: 23, pixelFormat: 'yuv420p', audioBitrate: '192k', outputLocation: bruto,
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 10) * 10;
        if (pct !== ultimo) { ultimo = pct; process.stdout.write(`\r${id}: ${pct}%   `); }
      }
    });
    const final = path.join(soVideo ? SAIDA : MIDIA, `${arquivo}.mp4`);
    // O Reels tem golpes de efeito e risada em cima da trilha: depois do AAC o pico passou de 0 dBFS
    // (medido: +0,2), então ele ganha um limitador em −1 dBFS depois da loudnorm.
    const filtro = VIDEOS[id].soVideo ? 'loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.89:level=0' : 'loudnorm=I=-16:TP=-1.5:LRA=11';
    ffmpeg(['-i', bruto, '-c:v', 'copy', '-af', filtro, '-ar', '48000', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', final]);
    await renderStill({ composition, serveUrl, output: path.join(soVideo ? SAIDA : MIDIA, `${arquivo}.jpg`), frame: capa, imageFormat: 'jpeg', jpegQuality: 82, scale: composition.width > 1280 ? 2 / 3 : 1 });
    if (soVideo) fs.unlinkSync(bruto);
    console.log(`\r${id}: ${mb(final)} MB → ${soVideo ? 'video/saida' : 'public/midia'}/${arquivo}.mp4 (+ capa .jpg)`);
  }

  for (const som of SO_VIDEO ? [] : MESA) {
    const origem = path.join(RAIZ, 'public', 'audio', `${som}.mp3`);
    // O volumedetect escreve no stderr.
    const medida = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', origem, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    const media = Number(/mean_volume: (-?[\d.]+)/.exec(String(medida))?.[1] ?? -20);
    // −23 dB de média: audível ao lado dos avisos da sala sem assustar ninguém que clicar.
    ffmpeg(['-i', origem, '-af', `volume=${(-23 - media).toFixed(1)}dB,alimiter=limit=0.89`, '-ac', '1', '-b:a', '96k', path.join(MIDIA, 'mesa', `${som}.mp3`)]);
  }
  if (!SO_VIDEO) console.log(`Mesa de sons: ${MESA.length} arquivos em public/midia/mesa.`);
}

main().catch(erro => { console.error(erro); process.exit(1); });
