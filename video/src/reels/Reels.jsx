// O Reels de humor do Nexo, 1080×1920, em duas versões que dividem tudo (imagem, trilha e
// efeitos): `voz` liga a narração. Sem voz, o texto na tela já é a piada inteira -- a voz só o lê.
//
// Cada cena é uma <Sequence>; as falas, a trilha e os efeitos ficam no nível de cima, para que a
// cauda de um som atravesse o corte em vez de ser cortada junto com a cena.
import React from 'react';
import { AbsoluteFill, Html5Audio, Sequence, interpolate, staticFile } from 'remotion';
import { COR } from '../base/tema';
import { Fundo, Som } from '../base/componentes';
import { CENAS, DROP, TOTAL, duracaoDa } from './linha';
import { Entrada } from './pecas';
import * as a from './cenas-a';
import * as b from './cenas-b';

export { TOTAL as DURACAO_DO_REELS };

// cena → [componente, efeitos, cor do brilho do fundo]
const CENA = {
  gancho: [a.Gancho, a.sonsGancho, COR.accent], nexo: [a.Nexo, a.sonsNexo, COR.accent],
  tela: [a.Tela, a.sonsTela, '#3fc98f'], assistir: [a.Assistir, a.sonsAssistir, COR.rosa],
  volume: [a.Volume, a.sonsVolume, '#4f9dff'], mesa: [b.MesaDeSons, b.sonsMesa, COR.rosa],
  musica: [b.Musica, b.sonsMusica, COR.accent], placa: [b.Placa, b.sonsPlaca, '#3fc98f'],
  tema: [b.Tema, b.sonsTema, '#4f9dff'], onde: [b.Onde, b.sonsOnde, '#4f9dff'],
  gratis: [b.Gratis, b.sonsGratis, COR.aviso], quiz: [b.Quiz, b.sonsQuiz, COR.accent],
  fim: [b.Fim, b.sonsFim, COR.accent]
};

// Os efeitos que precisam de mais corpo que o original saem de public/audio/reels/sfx
// (scripts/reels-audio.cjs).
const REFORCADOS = new Set(['audio/sala/entrada.mp3', 'audio/sala/mensagem.mp3', 'audio/sala/tela.mp3', 'audio/sala/assistir.mp3', 'audio/sala/mencao.mp3', 'audio/sala/mic-ligado.mp3', 'impacto']);
const arquivo = src => (REFORCADOS.has(src) ? `audio/reels/sfx/${src.replace(/^audio\/sala\//, '').replace(/\.mp3$/, '')}.mp3` : src);

// ---------- A mixagem ----------
// A trilha desce sob cada fala (o "ducking") e sobe nos respiros; no drop ela ganha um golpe
// de volume para o carimbo do NEXO bater. Sem voz, fica alta o tempo todo.
const FALAS = CENAS.map(c => [c.vozEm, c.vozEm + duracaoDa(c.fala)]);
const limite = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
const sobFala = f => Math.max(...FALAS.map(([ini, fim]) => interpolate(f, [ini - 6, ini, fim, fim + 8], [0, 1, 1, 0], limite)));
const volumeDaTrilha = voz => f => {
  const entrada = interpolate(f, [0, 8], [0, 1], limite);
  const saida = interpolate(f, [TOTAL - 45, TOTAL], [1, 0], limite);
  if (!voz) return 0.85 * entrada * saida;
  const golpe = interpolate(f, [DROP - 3, DROP, DROP + 45], [0, 1, 0], limite);
  return (0.5 - 0.34 * sobFala(f) + 0.28 * golpe) * entrada * saida;
};

export function Reels({ voz = true }) {
  return (
    <AbsoluteFill style={{ background: COR.bg }}>
      {CENAS.map(c => {
        const [Cena, , brilho] = CENA[c.id];
        return (
          <Sequence key={c.id} from={c.de} durationInFrames={c.dur}>
            <Fundo matiz={brilho} />
            <Entrada><Cena c={c} /></Entrada>
          </Sequence>
        );
      })}

      <Html5Audio src={staticFile('audio/reels/trilha-a.mp3')} volume={volumeDaTrilha(voz)} />

      {CENAS.map(c => {
        const [, sons] = CENA[c.id];
        return (
          <React.Fragment key={`s${c.id}`}>
            {sons(c).map(([src, local, volume], i) => <Som key={`${src}${local}${i}`} src={arquivo(src)} em={c.de + local} volume={volume} />)}
            {c.de > DROP + 60 && <Som src="whoosh" em={c.de - 5} volume={0.2} duracao={30} />}
          </React.Fragment>
        );
      })}

      {voz && CENAS.map(c => (
        <Sequence key={`v${c.id}`} from={c.vozEm} durationInFrames={duracaoDa(c.fala) + 12} layout="none">
          <Html5Audio src={staticFile(`audio/reels/fala/${c.fala}.mp3`)} volume={1} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
