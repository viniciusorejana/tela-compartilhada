// As peças que as duas composições dividem: o fundo, a marca, o texto que entra palavra por
// palavra, o cursor que clica, os ícones da sala e o som posicionado num quadro.
import React from 'react';
import { AbsoluteFill, Html5Audio, Sequence, random, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { COR, FONTE, entre, mola } from './tema';

// ---------- Formato ----------
//
// Os mesmos vídeos saem em 16:9 e em 9:16 (lançamento para Reels, Shorts e TikTok). Cada cena
// pergunta aqui se está em pé, e a `escala` leva as medidas pensadas para 1920 de largura a
// qualquer tamanho.
export function useFormato() {
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  return { vertical, largura: width, altura: height, escala: vertical ? width / 1080 : width / 1920 };
}

// ---------- Som ----------
export function Som({ src, em, volume = 0.6, duracao = 150 }) {
  const arquivo = src.includes('/') ? src : `audio/${src}.mp3`;
  return (
    <Sequence from={Math.max(0, Math.round(em))} durationInFrames={duracao} layout="none">
      <Html5Audio src={staticFile(arquivo)} volume={volume} />
    </Sequence>
  );
}

// ---------- Fundo ----------
// O fundo escuro do Nexo com o brilho violeta da página inicial, uma grade de pontos quase
// invisível e faíscas que sobem devagar. Tudo se move pouco: o fundo não compete com a cena.
export function Fundo({ intensidade = 1, matiz = COR.accent }) {
  const q = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const deriva = Math.sin(q / 90) * 60;
  const faiscas = Array.from({ length: 16 }, (_, i) => {
    const x = random(`fx${i}`) * width;
    const velocidade = 0.25 + random(`fv${i}`) * 0.5;
    const y = height - ((random(`fy${i}`) * height + q * velocidade * 2) % (height + 80));
    const tamanho = 12 + random(`ft${i}`) * 18;
    const opacidade = 0.08 + random(`fo${i}`) * 0.16;
    return <span key={i} style={{ position: 'absolute', left: x, top: y, fontSize: tamanho, color: i % 5 === 0 ? COR.faisca : COR.accentHi, opacity: opacidade * intensidade, transform: `rotate(${q * (i % 2 ? 0.4 : -0.4)}deg)` }}>✦</span>;
  });
  return (
    <AbsoluteFill style={{ background: COR.bg, overflow: 'hidden' }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 60% 55% at ${72 + deriva / 30}% ${22 + deriva / 50}%, ${matiz}33, transparent 70%), radial-gradient(ellipse 50% 45% at ${18 - deriva / 40}% 88%, ${COR.accentForte}22, transparent 70%)`, opacity: intensidade }} />
      <AbsoluteFill style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.05) 1.2px, transparent 1.2px)', backgroundSize: '34px 34px', backgroundPosition: `0 ${-q * 0.3}px`, maskImage: 'radial-gradient(ellipse 80% 70% at 50% 50%, black, transparent)' }} />
      {faiscas}
    </AbsoluteFill>
  );
}

// ---------- A marca ----------
// public/mark.svg, desenhado aqui para poder animar a faísca à parte.
export function Marca({ tamanho = 120, faisca = 1, style }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 64 64" style={{ overflow: 'visible', filter: `drop-shadow(0 ${tamanho / 10}px ${tamanho / 4}px ${COR.accent}55)`, ...style }}>
      <rect width="64" height="64" rx="20" fill={COR.marca} />
      <path d="M18 45V19h7l14 17V19h7v26h-7L25 28v17z" fill="#fff" />
      <path d="m44 10 1.7 4.3L50 16l-4.3 1.7L44 22l-1.7-4.3L38 16l4.3-1.7z" fill={COR.faisca} style={{ transformOrigin: '44px 16px', transform: `scale(${faisca}) rotate(${(1 - faisca) * 90}deg)` }} />
    </svg>
  );
}

// ---------- Texto que entra palavra por palavra ----------
// Cada palavra sobe de dentro de uma máscara, uma depois da outra. `destaque` pinta palavras de
// violeta, como o "Seu momento." da página inicial; '\n' quebra a linha.
export function Palavras({ texto, inicio = 0, fim = Infinity, destaque = [], tamanho = 72, peso = 700, cor = COR.texto, passo = 3, alinhar = 'left', altura = 1.08, espacamento = -0.045, style }) {
  const q = useCurrentFrame();
  const linhas = texto.split('\n');
  let indice = 0;
  const saida = entre(q, [fim - 10, fim], [0, 1]);
  return (
    <div style={{ fontFamily: FONTE, fontSize: tamanho, fontWeight: peso, lineHeight: altura, letterSpacing: `${espacamento}em`, color: cor, textAlign: alinhar, ...style }}>
      {linhas.map((linha, l) => (
        <div key={l} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: alinhar === 'center' ? 'center' : 'flex-start', gap: `0 ${tamanho * 0.26}px` }}>
          {linha.split(' ').filter(Boolean).map((palavra, p) => {
            const i = indice++;
            const progresso = mola(q, inicio + i * passo, { amortecimento: 16 });
            const limpa = palavra.replace(/[.,!?:;…]+$/, '');
            const destacada = destaque.some(d => d === limpa || d === palavra);
            return (
              <span key={p} style={{ display: 'inline-block', overflow: 'hidden', paddingBottom: tamanho * 0.12, marginBottom: -tamanho * 0.12 }}>
                <span style={{ display: 'inline-block', transform: `translateY(${(1 - progresso) * 105 + saida * -105}%)`, opacity: Math.min(1, progresso * 1.4) * (1 - saida), color: destacada ? COR.accentHi : undefined }}>{palavra}</span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// O rótulo pequeno em caixa-alta que abre cada cena ("02 · SUA VEZ").
export function Rotulo({ children, inicio = 0, fim = Infinity, tamanho = 22 }) {
  const q = useCurrentFrame();
  const p = mola(q, inicio);
  const saida = entre(q, [fim - 10, fim], [0, 1]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: tamanho * 0.6, fontFamily: FONTE, fontSize: tamanho, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: COR.accentTexto, opacity: p * (1 - saida), transform: `translateX(${(1 - p) * -30}px)` }}>
      <span style={{ fontSize: tamanho * 1.3, color: COR.accentHi }}>✦</span>{children}
    </div>
  );
}

// ---------- Cursor ----------
// `caminho`: [[quadro, x, y], ...]. `cliques`: os quadros em que ele aperta. O clique é uma onda
// que se abre e some, e o cursor encolhe um instante -- o gesto que o olho reconhece.
export function Cursor({ caminho, cliques = [], escala = 1 }) {
  const q = useCurrentFrame();
  if (!caminho.length || q < caminho[0][0] - 8) return null;
  let x = caminho[0][1], y = caminho[0][2];
  for (let i = 0; i < caminho.length - 1; i++) {
    const [qa, xa, ya] = caminho[i], [qb, xb, yb] = caminho[i + 1];
    if (q >= qa && q <= qb) { x = entre(q, [qa, qb], [xa, xb]); y = entre(q, [qa, qb], [ya, yb]); break; }
    if (q > qb) { x = xb; y = yb; }
  }
  const aparece = entre(q, [caminho[0][0] - 8, caminho[0][0]], [0, 1]);
  const ultimo = caminho[caminho.length - 1][0];
  const some = entre(q, [ultimo + 20, ultimo + 30], [1, 0]);
  const apertando = cliques.some(c => q >= c && q < c + 5);
  return (
    <div style={{ position: 'absolute', left: x, top: y, zIndex: 50, opacity: aparece * some, pointerEvents: 'none' }}>
      {cliques.map(c => {
        const t = (q - c) / 16;
        if (t < 0 || t > 1) return null;
        return <span key={c} style={{ position: 'absolute', left: -40 * escala, top: -40 * escala, width: 80 * escala, height: 80 * escala, borderRadius: '50%', border: `${3 * escala}px solid ${COR.accentHi}`, transform: `scale(${0.3 + t})`, opacity: 1 - t }} />;
      })}
      <svg width={38 * escala} height={38 * escala} viewBox="0 0 24 24" style={{ transform: `scale(${apertando ? 0.85 : 1})`, transformOrigin: '0 0', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,.45))' }}>
        <path d="M4 2.5v17.2l4.6-4.3 3 6.6 3.1-1.4-3-6.5h6.4Z" fill="#fff" stroke="#15151f" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// ---------- Ícones: os mesmos traços da sala e de public/novidades.js ----------
const ICONES = {
  mic: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3" /></>,
  fone: <><path d="M4 15v-3a8 8 0 0 1 16 0v3" /><path d="M4 14h3v7H5a1 1 0 0 1-1-1ZM20 14h-3v7h2a1 1 0 0 0 1-1Z" /></>,
  camera: <><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m16 10 6-3v10l-6-3" /></>,
  tela: <><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  olho: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  som: <><path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  enviar: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
  musica: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  alca: <><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" /></>,
  grade: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  compacto: <><rect x="2" y="5" width="20" height="14" rx="2" /><rect x="12" y="11" width="7.5" height="5.5" rx="1" /></>,
  cheia: <><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>,
  celular: <><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M11 18h2" /></>,
  navegador: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 9h20M6 6.5h.01M9 6.5h.01" /></>,
  pausa: <><path d="M8 5v14M16 5v14" /></>
};
export function Icone({ nome, tamanho = 24, cor = 'currentColor', traco = 1.8, style }) {
  return <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke={cor} strokeWidth={traco} strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', ...style }}>{ICONES[nome]}</svg>;
}

export function Avatar({ pessoa, tamanho = 56, anel, style }) {
  return (
    <span style={{ display: 'grid', placeItems: 'center', width: tamanho, height: tamanho, borderRadius: '50%', background: pessoa.cor, color: '#15121f', fontFamily: FONTE, fontWeight: 700, fontSize: tamanho * 0.42, flex: 'none', boxShadow: anel ? `0 0 0 ${tamanho * 0.07}px ${COR.bg2}, 0 0 0 ${tamanho * 0.13}px ${anel}` : undefined, ...style }}>
      {pessoa.nome[0]}
    </span>
  );
}

// Um cartão das superfícies do Nexo: `--bg-2` com a borda sutil e a sombra dos modais.
export function Cartao({ children, style }) {
  return <div style={{ background: COR.bg2, borderRadius: 26, boxShadow: `0 40px 90px rgba(0,0,0,.45), 0 0 0 1.5px ${COR.linha2}`, fontFamily: FONTE, color: COR.texto, ...style }}>{children}</div>;
}

// A pílula de "chip" usada para dizer um fato curto ("Até 1440p a 60 quadros").
export function Chip({ children, inicio = 0, cor = COR.accentTexto, fundo = 'rgba(136,121,246,.14)', tamanho = 26, style }) {
  const q = useCurrentFrame();
  const p = mola(q, inicio);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: `${tamanho * 0.4}px ${tamanho * 0.8}px`, borderRadius: 999, background: fundo, boxShadow: `inset 0 0 0 1.5px ${cor}33`, color: cor, fontFamily: FONTE, fontSize: tamanho, fontWeight: 650, opacity: Math.min(1, p * 1.3), transform: `translateY(${(1 - p) * 24}px) scale(${0.9 + p * 0.1})`, ...style }}>{children}</span>
  );
}
