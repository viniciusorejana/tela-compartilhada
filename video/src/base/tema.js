// As cores do Nexo escuro (public/tema.css, as constantes `--e-*` e o violeta) e o relógio dos
// vídeos. O vídeo é sempre escuro: é assim que a sala aparece para quem chega, e é o tema que
// não depende de escolha.
import { Easing, interpolate, spring } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Inter';

export const COR = {
  fundo: '#12131c', bg0: '#171820', bg: '#191a24', bg1: '#1c1d28', bg2: '#20212d',
  cartao: '#252532', bg3: '#2a2b3a', bg4: '#353647', bg5: '#40415a',
  texto: '#eeeef5', texto2: '#cfcde0', texto3: '#b6b0ca', muted: '#a2a2b8', faint: '#8f8ea6', apagado: '#6f6d86',
  accent: '#8879f6', accentHi: '#a092ff', accentForte: '#6c5ce7', accentTexto: '#c7bcff', marca: '#8174fa', faisca: '#d1ffc1',
  online: '#90dfb3', onlineTexto: '#a6e7c4', rosa: '#e87fa3', aviso: '#e8c07a', avisoTexto: '#f1d58c', danger: '#f07583', dangerTexto: '#ff98a4',
  linha: 'rgba(255,255,255,0.07)', linha2: 'rgba(255,255,255,0.11)'
};

// As cores de perfil de public/perfil.js: os amigos do vídeo usam as mesmas que a sala oferece.
export const PESSOAS = {
  ana: { nome: 'Ana', cor: '#e6b86a' }, leo: { nome: 'Léo', cor: '#7fb5ee' }, rafa: { nome: 'Rafa', cor: '#7fd1ae' },
  bia: { nome: 'Bia', cor: '#e994c4' }, voce: { nome: 'Você', cor: '#a996f2' }
};

// Uma família só, carregada do Google Fonts no render: o resultado é o mesmo em qualquer
// máquina, e a Inter tem o desenho próximo da Segoe UI que a sala usa.
export const { fontFamily: FONTE } = loadFont('normal', { weights: ['400', '500', '600', '700', '800'], subsets: ['latin', 'latin-ext'] });

// ---------- O relógio ----------
//
// As duas trilhas saíram a 120 BPM (medido: 120,25): uma batida a cada 15 quadros e um compasso
// a cada 60, a 30 quadros por segundo. A primeira batida cai ~2 quadros depois do zero (0,046 a
// 0,075 s). Toda troca de cena cai num compasso, e todo gesto importante numa batida -- é isso
// que faz o vídeo parecer "no ritmo" sem ninguém saber por quê.
export const FPS = 30;
export const BATIDA = 15;
export const COMPASSO = 60;
export const ATRASO_DA_BATIDA = 2;
export const batida = n => Math.round(ATRASO_DA_BATIDA + n * BATIDA);
export const compasso = n => Math.round(ATRASO_DA_BATIDA + n * COMPASSO);

// ---------- Movimento ----------
const SUAVE = Easing.bezier(0.2, 0.8, 0.2, 1);
// Um intervalo que nunca chega (`fim = Infinity`, "não sai de cena") fica no valor de partida.
export const entre = (quadro, [a, b], [de, para] = [0, 1], easing = SUAVE) =>
  Number.isFinite(a) && Number.isFinite(b)
    ? interpolate(quadro, [a, b], [de, para], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing })
    : (quadro < a ? de : para);

// A mola do Nexo: `--curva-mola` do tema.css passa um pouco do ponto e volta.
export const mola = (quadro, inicio, { amortecimento = 13, massa = 0.7, rigidez = 140 } = {}) =>
  spring({ frame: quadro - inicio, fps: FPS, config: { damping: amortecimento, mass: massa, stiffness: rigidez } });

// Aparece em `inicio` e some em `fim`: 0 → 1 → 0, com a mola na entrada.
export const vida = (quadro, inicio, fim, saida = 10) =>
  Math.min(mola(quadro, inicio), entre(quadro, [fim - saida, fim], [1, 0]));
