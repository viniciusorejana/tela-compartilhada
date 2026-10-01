// As peças do Reels de humor: legenda que estoura palavra por palavra, adesivo, etiqueta, confete,
// clarão, a câmera que dá soco na batida e a conversa de grupo. Tudo pensado para 1080×1920 e para
// a zona segura dos Reels: nada importante acima de y≈200 nem abaixo de y≈1560, e a coluna
// direita (curtir, comentar) fica livre a partir de x≈960.
import React from 'react';
import { AbsoluteFill, random, useCurrentFrame } from 'remotion';
import { COR, FONTE, entre, mola } from '../base/tema';
import { Avatar, Icone, Marca } from '../base/componentes';

export const L = 1080;
export const A = 1920;
export const COLUNA = { x: 60, w: 900 };

// ---------- Texto com marcação ----------
// `*violeta*` é o destaque da marca; `^verde^` é a faísca do logo, para o remate da piada.
const COR_MARCA = { '*': COR.accentHi, '^': COR.faisca };
// Cada linha vira uma lista de palavras, e cada palavra uma lista de pedaços coloridos: a vírgula
// colada em "*código*," fica na mesma palavra que ele, sem um espaço no meio.
function fichas(texto, marcas = COR_MARCA) {
  return texto.split('\n').map(linha => {
    const palavras = [];
    let atual = null;
    for (const parte of linha.split(/(\*[^*]+\*|\^[^^]+\^)/).filter(Boolean)) {
      const marca = marcas[parte[0]] && parte.length > 2 && parte.endsWith(parte[0]) ? parte[0] : null;
      const cor = marca ? marcas[marca] : undefined;
      for (const pedaco of (marca ? parte.slice(1, -1) : parte).split(/(\s+)/)) {
        if (!pedaco) continue;
        if (/^\s+$/.test(pedaco)) { atual = null; continue; }
        if (!atual) { atual = []; palavras.push(atual); }
        atual.push({ t: pedaco, cor });
      }
    }
    return palavras;
  });
}

// A legenda: cada peça `{ t, em, fim, x, y, w, tamanho, alinhar, cor, rot }` entra palavra por
// palavra, estourando (uma mola que passa do ponto), e sai seca. `troca`: cada peça termina onde a
// seguinte começa, para uma frase substituir a outra no mesmo lugar.
export function Legenda({ pecas, troca = false, passo = 2 }) {
  const q = useCurrentFrame();
  return (
    <>
      {pecas.map((p, i) => {
        const fim = p.fim ?? (troca && pecas[i + 1] ? pecas[i + 1].em : Infinity);
        if (q < p.em - 1 || q >= fim) return null;
        const tamanho = p.tamanho ?? 112;
        const saida = entre(q, [fim - 4, fim], [0, 1]);
        let indice = 0;
        return (
          <div key={i} style={{ position: 'absolute', left: p.x ?? COLUNA.x, top: p.y ?? 260, width: p.w ?? COLUNA.w, fontFamily: FONTE, fontSize: tamanho, fontWeight: p.peso ?? 800, lineHeight: 1.04, letterSpacing: '-0.04em', color: p.cor ?? '#fff', textAlign: p.alinhar ?? 'left', textShadow: p.sombra ?? '0 5px 0 rgba(0,0,0,.30), 0 12px 44px rgba(0,0,0,.5)', transform: `rotate(${p.rot ?? 0}deg) scale(${1 - saida * 0.06})`, opacity: 1 - saida, zIndex: p.z ?? 20 }}>
            {fichas(p.t, p.marcas).map((linha, l) => (
              <div key={l} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: p.alinhar === 'center' ? 'center' : 'flex-start', gap: `0 ${tamanho * 0.24}px` }}>
                {linha.map((palavra, w) => {
                  const pop = mola(q, p.em + indice++ * passo, { amortecimento: 9, rigidez: 230, massa: 0.6 });
                  return <span key={w} style={{ display: 'inline-block', transform: `translateY(${(1 - pop) * 50}px) scale(${0.7 + pop * 0.3}) rotate(${(1 - pop) * -6}deg)`, opacity: Math.min(1, pop * 3) }}>{palavra.map((pedaco, k) => <span key={k} style={{ color: pedaco.cor }}>{pedaco.t}</span>)}</span>;
                })}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

// ---------- Adesivo ----------
// Um emoji (ou qualquer coisa) que estoura na tela com contorno branco de figurinha e balança.
const CONTORNO = 'drop-shadow(5px 0 0 #fff) drop-shadow(-5px 0 0 #fff) drop-shadow(0 5px 0 #fff) drop-shadow(0 -5px 0 #fff) drop-shadow(0 16px 26px rgba(0,0,0,.45))';
export function Adesivo({ children, em, fim = Infinity, x, y, tamanho = 170, rot = 0, balanco = 5, contorno = true, z = 30 }) {
  const q = useCurrentFrame();
  if (q < em - 1 || q >= fim) return null;
  const pop = mola(q, em, { amortecimento: 7, rigidez: 210, massa: 0.7 });
  const saida = entre(q, [fim - 5, fim], [0, 1]);
  const gira = rot + Math.sin((q - em) / 7) * balanco + (1 - pop) * 24;
  return (
    <div style={{ position: 'absolute', left: x, top: y, zIndex: z, fontSize: tamanho, lineHeight: 1, transform: `translate(-50%,-50%) scale(${pop * (1 - saida * 0.5)}) rotate(${gira}deg)`, opacity: 1 - saida, filter: contorno ? CONTORNO : undefined, fontFamily: FONTE }}>
      {children}
    </div>
  );
}

// A etiqueta branca de meme: texto preto em caixa, levemente torta.
export function Etiqueta({ children, em, fim = Infinity, x, y, rot = -3, tamanho = 46, fundo = '#fff', tinta = '#15151f', z = 30 }) {
  const q = useCurrentFrame();
  if (q < em - 1 || q >= fim) return null;
  const pop = mola(q, em, { amortecimento: 9, rigidez: 240, massa: 0.6 });
  const saida = entre(q, [fim - 5, fim], [0, 1]);
  return (
    <div style={{ position: 'absolute', left: x, top: y, zIndex: z, padding: `${tamanho * 0.3}px ${tamanho * 0.62}px`, borderRadius: tamanho * 0.42, background: fundo, color: tinta, fontFamily: FONTE, fontSize: tamanho, fontWeight: 800, letterSpacing: '-0.02em', whiteSpace: 'nowrap', boxShadow: '0 16px 40px rgba(0,0,0,.4)', transform: `translate(-50%,-50%) rotate(${rot + (1 - pop) * -8}deg) scale(${pop * (1 - saida * 0.4)})`, opacity: 1 - saida }}>
      {children}
    </div>
  );
}

// ---------- Confete ----------
export function Confete({ em, x = L / 2, y = A / 2, n = 40, cores = [COR.accentHi, COR.faisca, COR.rosa, COR.aviso, '#fff'], vida = 46, forca = 1 }) {
  const q = useCurrentFrame();
  const t = q - em;
  if (t < 0 || t > vida) return null;
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const angulo = -Math.PI / 2 + (random(`ca${em}${i}`) - 0.5) * Math.PI * 1.7;
        const vel = (14 + random(`cv${em}${i}`) * 22) * forca;
        const px = x + Math.cos(angulo) * vel * t * 0.9;
        const py = y + Math.sin(angulo) * vel * t * 0.9 + 0.55 * t * t;
        const w = 14 + random(`cw${em}${i}`) * 16;
        return <span key={i} style={{ position: 'absolute', left: px, top: py, width: w, height: w * 0.5, background: cores[i % cores.length], borderRadius: 3, transform: `rotate(${t * (8 + random(`cr${em}${i}`) * 14)}deg)`, opacity: entre(t, [vida - 14, vida], [1, 0]), zIndex: 60 }} />;
      })}
    </>
  );
}

// ---------- Clarão ----------
export function Clarao({ em, dur = 9, cor = '#fff', forca = 0.9 }) {
  const q = useCurrentFrame();
  const o = entre(q, [em, em + dur], [forca, 0], t => 1 - (1 - t) * (1 - t));
  if (q < em || o <= 0.005) return null;
  return <AbsoluteFill style={{ background: cor, opacity: o, zIndex: 80, pointerEvents: 'none' }} />;
}

// ---------- Câmera ----------
// `golpes`: quadros em que a imagem dá um soco de zoom (a batida). `tremer`: [[de, ate, força]].
export function Camera({ golpes = [], tremer = [], forca = 0.035, children }) {
  const q = useCurrentFrame();
  let zoom = 0;
  for (const g of golpes) if (q >= g && q < g + 20) zoom += forca * Math.exp(-(q - g) / 5);
  let dx = 0, dy = 0, rot = 0;
  for (const [de, ate, amp] of tremer) {
    if (q >= de && q < ate) {
      const decai = 1 - (q - de) / (ate - de) * 0.6;
      dx += Math.sin(q * 5.3) * amp * decai; dy += Math.cos(q * 6.7) * amp * decai; rot += Math.sin(q * 4.1) * amp * 0.06 * decai;
    }
  }
  return <AbsoluteFill style={{ transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(${1 + zoom})` }}>{children}</AbsoluteFill>;
}

// A entrada de toda cena: um pequeno zoom-out com o clarão de cor da própria cena.
export function Entrada({ children, dur = 8 }) {
  const q = useCurrentFrame();
  const t = entre(q, [0, dur], [0, 1], x => 1 - (1 - x) ** 3);
  return <AbsoluteFill style={{ transform: `scale(${1.09 - 0.09 * t})`, opacity: Math.min(1, 0.4 + t * 1.2) }}>{children}</AbsoluteFill>;
}

// ---------- Painel ----------
// Um cartão da interface do Nexo que chega de baixo com mola.
export function Painel({ x = COLUNA.x, y, w = COLUNA.w, h, em = 0, fim = Infinity, children, fundo = COR.bg1, raio = 34, style }) {
  const q = useCurrentFrame();
  if (q < em - 1 || q >= fim) return null;
  const p = mola(q, em, { amortecimento: 12, rigidez: 190 });
  const saida = entre(q, [fim - 6, fim], [0, 1]);
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, borderRadius: raio, background: fundo, boxShadow: `0 40px 90px rgba(0,0,0,.5), 0 0 0 2px ${COR.linha2}`, fontFamily: FONTE, color: COR.texto, overflow: 'hidden', opacity: Math.min(1, p * 1.5) * (1 - saida), transform: `translateY(${(1 - p) * 90 + saida * 40}px) scale(${0.95 + p * 0.05})`, ...style }}>
      {children}
    </div>
  );
}

// ---------- A conversa de grupo ----------
// `mensagens`: [{ pessoa, texto, em, tipo: 'link' }]; `digitando`: [{ pessoa, de, ate }]. A pilha
// se alinha embaixo e só as últimas cabem: como no aplicativo de verdade.
function Pontinhos({ q }) {
  return (
    <span style={{ display: 'inline-flex', gap: 9, alignItems: 'center', height: 30 }}>
      {[0, 1, 2].map(i => <i key={i} style={{ display: 'block', width: 14, height: 14, borderRadius: '50%', background: COR.muted, transform: `translateY(${-Math.abs(Math.sin((q + i * 4) / 5)) * 10}px)` }} />)}
    </span>
  );
}

export function ConversaGrupo({ x = COLUNA.x, y, w = COLUNA.w, h = 640, mensagens = [], digitando = [], em = 0, fim = Infinity, titulo = 'squad da noite 🎮', sub = 'Ana, Bia, Rafa e Léo', realce = null }) {
  const q = useCurrentFrame();
  const visiveis = mensagens.filter(m => q >= m.em - 1);
  const ativos = digitando.filter(d => q >= d.de && q < d.ate);
  return (
    <Painel x={x} y={y} w={w} h={h} em={em} fim={fim} raio={38}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '22px 30px', background: COR.bg0, borderBottom: `2px solid ${COR.linha}` }}>
        <span style={{ display: 'flex' }}>{['ana', 'bia', 'rafa', 'leo'].map((k, i) => <Avatar key={k} pessoa={PESSOAS_REELS[k]} tamanho={54} style={{ marginLeft: i ? -16 : 0, boxShadow: `0 0 0 4px ${COR.bg0}` }} />)}</span>
        <div><div style={{ fontSize: 34, fontWeight: 700 }}>{titulo}</div><div style={{ fontSize: 24, color: COR.muted }}>{sub}</div></div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 104, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 16, padding: '0 28px 28px', overflow: 'hidden' }}>
        {visiveis.slice(-5).map((m, i) => {
          const p = mola(q, m.em, { amortecimento: 11, rigidez: 230 });
          const meu = m.pessoa === PESSOAS_REELS.voce;
          const destaque = realce && realce.em <= q && q < realce.ate && realce.em === m.em;
          const pulo = destaque ? 1 + Math.sin(Math.min(1, (q - realce.em) / 10) * Math.PI) * 0.06 : 1;
          if (m.tipo === 'link') {
            return (
              <div key={m.em} style={{ alignSelf: 'flex-start', display: 'flex', gap: 14, opacity: Math.min(1, p * 1.5), transform: `translateY(${(1 - p) * 40}px) scale(${pulo})`, transformOrigin: 'left bottom' }}>
                <Avatar pessoa={m.pessoa} tamanho={54} />
                <div style={{ width: 640, borderRadius: 26, borderBottomLeftRadius: 8, overflow: 'hidden', background: COR.accentForte, boxShadow: `0 16px 40px ${COR.accentForte}66` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16, background: 'rgba(0,0,0,.18)' }}>
                    <Marca tamanho={64} />
                    <div><div style={{ fontSize: 30, fontWeight: 700, color: '#fff' }}>Nexo · squad-da-noite</div><div style={{ fontSize: 23, color: 'rgba(255,255,255,.78)' }}>Entrar na sala</div></div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', fontSize: 26, color: '#fff' }}><Icone nome="link" tamanho={26} />…/squad-da-noite/sala</div>
                </div>
              </div>
            );
          }
          return (
            <div key={m.em} style={{ display: 'flex', justifyContent: meu ? 'flex-end' : 'flex-start', gap: 14, opacity: Math.min(1, p * 1.5), transform: `translateY(${(1 - p) * 40}px) scale(${pulo})`, transformOrigin: meu ? 'right bottom' : 'left bottom' }}>
              {!meu && <Avatar pessoa={m.pessoa} tamanho={54} />}
              <div style={{ maxWidth: 640, padding: '14px 24px', borderRadius: 26, borderBottomLeftRadius: meu ? 26 : 8, borderBottomRightRadius: meu ? 8 : 26, background: meu ? COR.accentForte : COR.bg3, color: meu ? '#fff' : COR.texto2, fontSize: 34, lineHeight: 1.25, boxShadow: destaque ? `0 0 0 5px ${COR.aviso}, 0 16px 40px rgba(0,0,0,.4)` : 'none' }}>
                {!meu && <div style={{ fontSize: 22, fontWeight: 700, color: m.pessoa.cor, marginBottom: 2 }}>{m.pessoa.nome}</div>}
                {m.texto}
              </div>
            </div>
          );
        })}
        {ativos.map(d => (
          <div key={`d${d.de}`} style={{ display: 'flex', gap: 14, alignItems: 'flex-end' }}>
            <Avatar pessoa={d.pessoa} tamanho={54} />
            <div style={{ padding: '18px 26px', borderRadius: 26, borderBottomLeftRadius: 8, background: COR.bg3 }}><Pontinhos q={q} /></div>
          </div>
        ))}
      </div>
    </Painel>
  );
}

export const PESSOAS_REELS = {
  ana: { nome: 'Ana', cor: '#e6b86a' }, leo: { nome: 'Léo', cor: '#7fb5ee' }, rafa: { nome: 'Rafa', cor: '#7fd1ae' },
  bia: { nome: 'Bia', cor: '#e994c4' }, voce: { nome: 'Você', cor: '#a996f2' }
};
