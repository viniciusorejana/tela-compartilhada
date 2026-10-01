// Prepara o áudio do Reels de humor: trata as falas geradas no ElevenLabs e mede o que a
// composição precisa para amarrar a imagem na voz.
//
//   node scripts/reels-audio.cjs
//
// Entrada: public/audio/reels/origem/vNN.mp3 (as falas como saíram do gerador).
// Saída:   public/audio/reels/fala/vNN.mp3 (sem silêncio nas pontas, um pouco mais rápida, no
//          mesmo volume) e src/reels/falas.json (duração e os trechos falados de cada uma).
//
// Por que medir: o roteiro é uma fila de cenas, uma por fala, e cada cena dura o que a fala
// dura. Trocar uma fala (outra voz, outro texto) muda a duração, e o vídeo se refaz sozinho
// sem ninguém mexer nas cenas. Os "trechos" são os pedaços entre pausas: é neles que o texto
// da tela entra, para a palavra aparecer quando é dita.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const ORIGEM = path.join(RAIZ, 'public', 'audio', 'reels', 'origem');
const FALA = path.join(RAIZ, 'public', 'audio', 'reels', 'fala');
const SAIDA = path.join(RAIZ, 'src', 'reels', 'falas.json');

// 1,06 é o ponto em que a voz continua natural e o anúncio ganha o ritmo de Reels.
const RITMO = 1.06;
const ALVO_DB = -19;
// Pausa que separa dois trechos: menor que isso é respiração dentro da frase.
const PAUSA = 0.22;

const ffmpeg = argumentos => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-y', ...argumentos], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg falhou: ${r.stderr}`);
  return r.stderr;
};

const APARAR = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,areverse';

fs.mkdirSync(FALA, { recursive: true });
fs.mkdirSync(path.dirname(SAIDA), { recursive: true });

const falas = {};
for (const arquivo of fs.readdirSync(ORIGEM).filter(f => /^v\d+\.mp3$/.test(f)).sort()) {
  const id = arquivo.replace('.mp3', '');
  const origem = path.join(ORIGEM, arquivo);
  const destino = path.join(FALA, arquivo);

  // 1º passo: aparar, acelerar e limpar; mede o volume médio do resultado.
  const base = `${APARAR},atempo=${RITMO},highpass=f=80,acompressor=threshold=-24dB:ratio=3:attack=6:release=90:makeup=2`;
  const temporario = path.join(FALA, `${id}.tmp.wav`);
  ffmpeg(['-i', origem, '-af', base, '-ar', '44100', '-ac', '1', temporario]);
  const medida = ffmpeg(['-i', temporario, '-af', 'volumedetect', '-f', 'null', '-']);
  const media = Number(/mean_volume: (-?[\d.]+)/.exec(medida)?.[1] ?? ALVO_DB);
  // 2º passo: iguala o volume e limita o pico.
  ffmpeg(['-i', temporario, '-af', `volume=${(ALVO_DB - media).toFixed(2)}dB,alimiter=limit=0.89`, '-ar', '44100', '-ac', '1', '-b:a', '128k', destino]);
  fs.unlinkSync(temporario);

  // Duração e trechos falados do arquivo final.
  const sonda = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', destino], { encoding: 'utf8' });
  const duracao = Number(sonda.stdout.trim());
  const silencios = [];
  const log = ffmpeg(['-i', destino, '-af', `silencedetect=noise=-38dB:d=${PAUSA}`, '-f', 'null', '-']);
  let inicio = null;
  for (const linha of log.split('\n')) {
    const a = /silence_start: (-?[\d.]+)/.exec(linha);
    const b = /silence_end: ([\d.]+)/.exec(linha);
    if (a) inicio = Math.max(0, Number(a[1]));
    if (b && inicio !== null) { silencios.push([inicio, Number(b[1])]); inicio = null; }
  }
  const trechos = [];
  let atual = 0;
  for (const [ini, fim] of silencios) {
    if (ini - atual > 0.05) trechos.push([Number(atual.toFixed(3)), Number(ini.toFixed(3))]);
    atual = fim;
  }
  if (duracao - atual > 0.05) trechos.push([Number(atual.toFixed(3)), Number(duracao.toFixed(3))]);
  falas[id] = { duracao: Number(duracao.toFixed(3)), trechos };
  console.log(`${id}: ${duracao.toFixed(2)} s, ${trechos.length} trecho(s): ${trechos.map(t => `${t[0]}–${t[1]}`).join('  ')}`);
}

fs.writeFileSync(SAIDA, `${JSON.stringify(falas, null, 2)}\n`);
console.log(`Escrito ${path.relative(RAIZ, SAIDA)}.`);

// Os avisos da sala nasceram discretos (média de −25 a −31 dB, para não assustar ninguém dentro
// de uma chamada) e o golpe grave do drop também. Num anúncio de Reels eles têm de aparecer sobre
// a trilha e a voz: cópias mais altas, com o pico limitado, só para o Reels.
const REFORCO = [['sala/entrada', 10], ['sala/mensagem', 12], ['sala/tela', 10], ['sala/assistir', 11], ['sala/mencao', 10], ['sala/mic-ligado', 10], ['impacto', 10]];
const SFX = path.join(RAIZ, 'public', 'audio', 'reels', 'sfx');
fs.mkdirSync(SFX, { recursive: true });
for (const [nome, ganho] of REFORCO) {
  ffmpeg(['-i', path.join(RAIZ, 'public', 'audio', `${nome}.mp3`), '-af', `volume=${ganho}dB,alimiter=limit=0.95`, '-b:a', '128k', path.join(SFX, `${path.basename(nome)}.mp3`)]);
}
console.log(`Efeitos reforçados: ${REFORCO.length} em public/audio/reels/sfx.`);
