// A linha do tempo do Reels de humor: onde cada cena começa e quando cada fala entra.
//
// A trilha tem 8 s de introdução e o "drop" no compasso 4, a 120 BPM, com a batida na fase 0
// (medido: o golpe grave cai em 8,00 s). Tudo o que precisa bater na música -- o corte, o
// carimbo do NEXO -- cai numa batida (15 quadros). As falas são uma fila: cada cena dura o que
// a fala dura, então trocar uma fala (outra voz, outro texto) refaz a linha inteira sozinho.
// A versão sem voz usa a mesma linha: o texto na tela é a piada, a voz só o lê.
import falas from './falas.json';
import { FPS } from '../base/tema';

export const BATIDA = 15;
export const COMPASSO = 60;
export const DROP = 4 * COMPASSO;
const ATRASO = 4; // a fala entra 4 quadros depois do corte: o olho vê a cena antes de ouvir
const FOLGA = 1; // respiro entre o fim de uma fala e a próxima cena: pouco, é anúncio de Reels

export const quadros = segundos => Math.round(segundos * FPS);
const naBatida = q => Math.ceil(q / BATIDA) * BATIDA;
export const duracaoDa = id => Math.ceil(falas[id].duracao * FPS);
// O começo do trecho `i` da fala, em quadros desde o início da fala.
export const trecho = (id, i) => quadros(falas[id].trechos[i][0]);

// "Nexo" é dito 0,9 s depois de a fala começar; o carimbo tem de cair no drop.
const NEXO_NA_FALA = 0.9;

const ORDEM = [
  // id, fala, duração mínima da cena (quando há mais a mostrar do que a fala cobre)
  ['tela', 'v03'], ['assistir', 'v04'], ['volume', 'v05'], ['mesa', 'v06', 195], ['musica', 'v07'],
  ['placa', 'v08'], ['tema', 'v09'], ['onde', 'v10'], ['gratis', 'v11'], ['quiz', 'v12'], ['fim', 'v13', 250]
];

// A abertura é feita à mão: a fala do gancho (v01) e um intervalo que é a piada, até a fala do NEXO
// cair de modo que o nome coincida com o drop.
const NEXO_DE = DROP - quadros(NEXO_NA_FALA);
export const CENAS = [
  { id: 'gancho', de: 0, dur: NEXO_DE, fala: 'v01', vozEm: 6 },
  { id: 'nexo', de: NEXO_DE, dur: 0, fala: 'v02', vozEm: NEXO_DE }
];
let de = naBatida(NEXO_DE + duracaoDa('v02') + FOLGA);
CENAS[1].dur = de - NEXO_DE;
for (const [id, fala, minimo = 0] of ORDEM) {
  const dur = Math.max(minimo, naBatida(ATRASO + duracaoDa(fala) + FOLGA));
  CENAS.push({ id, de, dur, fala, vozEm: de + ATRASO });
  de += dur;
}
export const TOTAL = de;

export const cena = id => CENAS.find(c => c.id === id);
