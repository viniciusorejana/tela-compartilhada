// A gravação do Nexo de verdade dentro de uma cena: a janela 16:9 (ou o celular) com o clipe, e uma câmera virtual que
// aproxima o que importa. As gravações são as do video-discord (Playwright dirigindo o Nexo em 2560x1440, com
// servidor, contas e câmeras de mentira), trazidas para public/clipes por scripts/preparar.cjs.
//
// Antes, cada cena DESENHAVA a sala (interface.jsx): era bonito, mas não era o Nexo -- e ficava para trás a cada
// mudança da interface. Agora quem aparece é o aplicativo, e refazer as gravações atualiza os vídeos.
//
// Uma gravação é uma lista de TRECHOS { clipe, de, ate, dur }: do segundo `de` ao `ate` do clipe, mostrado em `dur`
// segundos de cena (a velocidade sai da conta), um depois do outro. `ajustar` estica ou encolhe os `dur` para a soma
// caber na cena, e o zoom é uma lista de pontos { t (segundo da cena), x, y (o foco, 0..1 da imagem), s (aumento) }.
import React from 'react';
import { OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { FPS } from './tema';

const q = seg => Math.round(seg * FPS);
const limitar = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const suave = p => p * p * (3 - 2 * p);

function camera(pontos, t) {
  if (!pontos?.length) return { x: 0.5, y: 0.5, s: 1 };
  if (t <= pontos[0].t) return pontos[0];
  for (let i = 0; i < pontos.length - 1; i++) {
    const a = pontos[i], b = pontos[i + 1];
    if (t <= b.t) {
      const p = suave(limitar((t - a.t) / Math.max(0.001, b.t - a.t)));
      return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, s: a.s + (b.s - a.s) * p };
    }
  }
  return pontos[pontos.length - 1];
}

// Os `dur` (e o zoom) na escala da cena: a soma passa a ser `total` segundos.
export function ajustar({ trechos, zoom = [] }, total) {
  const soma = trechos.reduce((s, t) => s + t.dur, 0);
  const k = total / soma;
  return { trechos: trechos.map(t => ({ ...t, dur: t.dur * k })), zoom: zoom.map(z => ({ ...z, t: z.t * k })) };
}

function Trechos({ trechos, largura, altura }) {
  let inicio = 0;
  return trechos.map((t, i) => {
    const d = Math.max(1, q(t.dur)), de = inicio;
    inicio += d;
    return (
      <Sequence key={i} from={de} durationInFrames={d} layout="none">
        <OffthreadVideo src={staticFile(`clipes/${t.clipe}.mp4`)} startFrom={q(t.de)} playbackRate={Math.max(0.25, (t.ate - t.de) / t.dur)} muted
          style={{ position: 'absolute', inset: 0, width: largura, height: altura, objectFit: 'cover' }} />
      </Sequence>
    );
  });
}

// A janela do computador: 16:9, cantos redondos, a câmera virtual dentro.
export function Janela({ gravacao, largura = 960 }) {
  const quadro = useCurrentFrame();
  const altura = Math.round(largura * 9 / 16);
  const { x, y, s } = camera(gravacao.zoom, quadro / FPS);
  const tx = limitar(largura / 2 - x * largura * s, largura - largura * s, 0);
  const ty = limitar(altura / 2 - y * altura * s, altura - altura * s, 0);
  return (
    <div style={{ position: 'relative', width: largura, height: altura, borderRadius: 18, overflow: 'hidden', background: '#000', boxShadow: '0 34px 90px rgba(0,0,0,.6), 0 0 0 1.5px rgba(255,255,255,.13)' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: largura, height: altura, transformOrigin: '0 0', transform: `translate(${tx}px, ${ty}px) scale(${s})` }}>
        <Trechos trechos={gravacao.trechos} largura={largura} altura={altura} />
      </div>
    </div>
  );
}

// O celular: moldura de aparelho e a gravação em pé (1170x2532) dentro.
export function Celular({ gravacao, altura = 760 }) {
  const largura = Math.round(altura * 1170 / 2532);
  return (
    <div style={{ position: 'relative', width: largura + 24, height: altura + 24, borderRadius: 54, background: 'linear-gradient(145deg,#2c2a3a,#12101b)', padding: 12, boxShadow: '0 34px 90px rgba(0,0,0,.6), 0 0 0 2.5px rgba(255,255,255,.16)' }}>
      <div style={{ position: 'relative', width: largura, height: altura, borderRadius: 42, overflow: 'hidden', background: '#000' }}>
        <Trechos trechos={gravacao.trechos} largura={largura} altura={altura} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// O catálogo: os trechos e os zooms de cada gravação, calibrados no video-discord (src/roteiro.js) a partir do
// diário de cada clipe (o instante de cada clique). Refez uma gravação? Confira os segundos no diário dela.
// ---------------------------------------------------------------------------------------------
const Z = (t, x, y, s) => ({ t, x, y, s });
const de = (clipe, lista) => lista.map(([inicio, fim, dur]) => ({ clipe, de: inicio, ate: fim, dur }));

export const GRAVACOES = {
  // Abre o início, digita o nome da sala e entra.
  abrir: { trechos: de('01-abrir', [[2.3, 3.5, .6], [3.5, 5.9, 1.2], [5.9, 10.6, 1.0], [10.6, 13.0, .7]]), zoom: [Z(0, .5, .5, 1.05), Z(.5, .84, .82, 1.8), Z(1.8, .84, .82, 1.8), Z(2.3, .5, .5, 1.05)] },
  // O convite chega na tela de quem foi chamado.
  convite: { trechos: de('02b-convite', [[1.7, 3.1, .6], [3.1, 5.6, .9], [5.6, 8.4, .8], [8.4, 12.0, .7]]), zoom: [Z(0, .88, .84, 1.8), Z(1.25, .88, .84, 1.8), Z(1.8, .5, .5, 1.05)] },
  // As câmeras acendem; quem fala, acende.
  cameras: { trechos: de('03-cameras', [[1.2, 6.5, 1.6], [9.6, 10.6, .6], [14.0, 18.0, 1.5], [19.4, 21.8, .8]]), zoom: [Z(0, .45, .74, 1.55), Z(1.6, .45, .74, 1.55), Z(2.2, .5, .5, 1.05)] },
  // A tela chega: "Assistir", e a sala inteira vendo.
  assistir: { trechos: de('04-assistir', [[2.9, 4.2, .6], [4.2, 6.9, .6], [6.9, 8.4, 1.3], [8.4, 10.2, 1.1], [10.2, 13.2, 2.7], [13.2, 16.0, 1.7]]), zoom: [Z(0, .5, .72, 1.45), Z(1.0, .5, .72, 1.45), Z(1.9, .5, .38, 1.2), Z(4.8, .5, .38, 1.2), Z(5.6, .72, .15, 2.1), Z(8, .72, .15, 2.1)] },
  // Quem transmite: o painel, a qualidade, os 60 quadros e o selo de quem assiste.
  transmitir: { trechos: de('05-transmitir', [[3.5, 5.0, .6], [7.3, 8.6, .5], [9.8, 12.6, .9], [14.4, 15.8, .6], [15.8, 24.3, .5], [24.3, 30.3, 2.9]]), zoom: [Z(0, .5, .5, 1.05), Z(.6, .5, .45, 1.5), Z(2.7, .5, .45, 1.5), Z(3.1, .5, .5, 1.05), Z(3.9, .74, .2, 2.1), Z(6, .74, .2, 2.1)] },
  // O volume de uma pessoa: a régua e o número digitado (200%).
  volume: { trechos: de('06-volume', [[3.2, 7.4, 1.6], [8.0, 11.2, 1.2], [11.2, 15.4, 1.2]]), zoom: [Z(0, .45, .74, 1.65), Z(4, .45, .74, 1.65)] },
  // O chat: @, emoji e reação.
  chat: { trechos: de('07-chat', [[.6, 5.0, .9], [8.0, 11.0, .9], [14.4, 19.8, 1.0], [25.2, 29.0, .9], [29.6, 34.5, 1.3]]), zoom: [Z(0, .86, .5, 1.8), Z(5, .86, .4, 1.8)] },
  // A mesa de sons.
  mesa: { trechos: de('08-mesa-de-sons', [[3.6, 5.2, .5], [6.9, 17.0, 1.1], [18.3, 20.8, 1.0], [21.8, 24.2, .9], [24.8, 26.0, .5], [27.5, 28.7, .5]]), zoom: [Z(0, .5, .42, 1.45), Z(4.5, .5, .42, 1.45)] },
  // O bot de música entra na chamada.
  musica: { trechos: de('09-musica', [[3.0, 4.5, .5], [6.6, 10.8, 1.0], [10.8, 15.3, .5], [15.3, 20.3, 2.0]]), zoom: [Z(0, .86, .6, 1.55), Z(1.4, .86, .93, 1.8), Z(1.9, .86, .16, 1.9), Z(4, .86, .16, 1.9)] },
  // O cartão de perfil.
  perfil: { trechos: de('10-perfil', [[2.6, 7.0, .8], [9.8, 11.2, .5], [14.7, 15.6, .4], [20.0, 20.9, .4], [25.1, 26.0, .4], [33.6, 36.0, 1.0], [39.2, 40.4, .5]]), zoom: [Z(0, .5, .5, 1.05), Z(.9, .78, .38, 1.45), Z(4, .78, .38, 1.45)] },
  // Os temas.
  temas: { trechos: de('12-temas', [[3.3, 7.5, .6], [9.8, 11.0, .6], [13.6, 14.8, .45], [16.9, 18.1, .45], [20.1, 21.3, .45], [26.9, 28.4, .45], [30.2, 31.4, .5]]), zoom: [Z(0, .5, .5, 1.2), Z(3.5, .5, .5, 1.2)] },
  // No celular (em pé).
  celular: { trechos: de('15-celular', [[3.0, 5.1, .6], [5.1, 8.0, 1.4], [11.2, 12.2, .5], [14.4, 19.0, 2.0]]) }
};

// Duas gravações seguidas numa cena só (o zoom da segunda começa onde a primeira acaba).
export function emSequencia(a, b) {
  const fimDeA = a.trechos.reduce((s, t) => s + t.dur, 0);
  return { trechos: [...a.trechos, ...b.trechos], zoom: [...(a.zoom || []), ...(b.zoom || []).map(z => ({ ...z, t: z.t + fimDeA + 0.001 }))] };
}
