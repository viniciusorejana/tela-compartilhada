// O molde de quase toda cena: um rótulo, um título que entra palavra por palavra, uma frase de
// apoio e, ao lado (ou embaixo, em pé), a demonstração. Os quadros aqui são os da cena: cada uma
// vive dentro de uma <Sequence>, então o quadro 0 é o começo dela.
import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { COR, FONTE, entre, mola } from './tema';
import { Palavras, Rotulo, useFormato } from './componentes';

// Largura da área da demonstração: o que sobra ao lado do texto (16:9) ou a tela toda (9:16).
export const useLarguraDaDemo = () => (useFormato().vertical ? 940 : 980);

export function Apoio({ children, inicio = 0, fim = Infinity, tamanho = 32, alinhar = 'left', style }) {
  const q = useCurrentFrame();
  const p = mola(q, inicio, { amortecimento: 18 });
  const saida = entre(q, [fim - 10, fim], [0, 1]);
  return <p style={{ margin: 0, fontFamily: FONTE, fontSize: tamanho, lineHeight: 1.45, fontWeight: 450, color: COR.texto3, textAlign: alinhar, opacity: Math.min(1, p * 1.3) * (1 - saida), transform: `translateY(${(1 - p) * 20}px)`, ...style }}>{children}</p>;
}

// `grande`: as cenas de 2 s do lançamento. Sem frase de apoio e com pouco tempo para ler, o
// título cresce.
export function Cena({ rotulo, titulo, destaque = [], apoio, duracao, children, inicioDaDemo = 4, grande = false }) {
  const q = useCurrentFrame();
  const { vertical } = useFormato();
  const entrada = mola(q, inicioDaDemo, { amortecimento: 16 });
  const saida = entre(q, [duracao - 12, duracao], [0, 1]);
  return (
    <AbsoluteFill style={{ flexDirection: vertical ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: vertical ? 90 : 90, padding: vertical ? '0 70px 80px' : '0 100px' }}>
      <div style={{ width: vertical ? '100%' : 620, flex: 'none', display: 'flex', flexDirection: 'column', gap: vertical ? 30 : 26 }}>
        {rotulo && <Rotulo inicio={2} fim={duracao} tamanho={vertical ? 26 : 22}>{rotulo}</Rotulo>}
        <Palavras texto={titulo} destaque={destaque} inicio={grande ? 2 : 6} passo={grande ? 2 : 3} fim={duracao} tamanho={grande ? (vertical ? 104 : 100) : (vertical ? 92 : 82)} />
        {apoio && <Apoio inicio={22} fim={duracao} tamanho={vertical ? 38 : 31}>{apoio}</Apoio>}
      </div>
      <div style={{ flex: vertical ? 'none' : 1, display: 'grid', placeItems: 'center', opacity: Math.min(1, entrada * 1.2) * (1 - saida), transform: `translate(${vertical ? 0 : (1 - entrada) * 80 - saida * 60}px, ${vertical ? (1 - entrada) * 80 : 0}px) scale(${0.94 + entrada * 0.06})` }}>
        {children}
      </div>
    </AbsoluteFill>
  );
}
