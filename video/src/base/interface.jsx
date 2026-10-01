// A sala do Nexo redesenhada para o vídeo: a barra de controles, o palco com uma tela no ar, o
// volume de uma pessoa, o chat com @, a mesa de sons, a fila de música e a miniatura de temas.
// Não são capturas de tela: é a mesma linguagem visual, maior e mais simples, porque no vídeo o
// olho tem dois segundos para entender cada coisa.
import React from 'react';
import { interpolateColors, useCurrentFrame } from 'remotion';
import NexoTema from '../../../public/tema.js';
import { COR, FONTE, PESSOAS, entre, mola } from './tema';
import { Avatar, Icone } from './componentes';

// ---------- A barra de controles ----------
const CONTROLES = { mic: ['mic', 'Microfone'], ouvir: ['fone', 'Ouvir'], camera: ['camera', 'Câmera'], tela: ['tela', 'Tela'] };
const CORES_LIGADO = { mic: [COR.accentForte, '#fff'], ouvir: ['#3a2530', COR.dangerTexto], camera: [COR.accentForte, '#fff'], tela: ['#20352c', COR.onlineTexto] };

// `ligados`: { mic: quadro em que ligou, ... }. A cor desliza na mola, como o clique na sala.
export function BarraDeControles({ ligados = {}, botoes = ['mic', 'ouvir', 'camera', 'tela'], tamanho = 1 }) {
  const q = useCurrentFrame();
  return (
    <div style={{ display: 'flex', gap: 14 * tamanho, padding: 16 * tamanho, borderRadius: 28 * tamanho, background: COR.bg0, boxShadow: `inset 0 0 0 1.5px ${COR.linha}, 0 30px 70px rgba(0,0,0,.4)` }}>
      {botoes.map(nome => {
        const quando = ligados[nome];
        const p = quando === undefined ? 0 : mola(q, quando, { amortecimento: 12 });
        const [fundo, texto] = CORES_LIGADO[nome];
        const cor = interpolateColors(Math.min(1, p), [0, 1], [COR.bg3, fundo]);
        const tinta = interpolateColors(Math.min(1, p), [0, 1], [COR.texto2, texto]);
        const pulo = quando === undefined ? 1 : 1 + Math.sin(Math.min(1, entre(q, [quando, quando + 10])) * Math.PI) * 0.08;
        return (
          <div key={nome} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 * tamanho, width: 148 * tamanho, height: 124 * tamanho, borderRadius: 20 * tamanho, background: cor, color: tinta, fontFamily: FONTE, fontSize: 24 * tamanho, fontWeight: 600, transform: `scale(${pulo})`, boxShadow: p > 0.5 && nome !== 'ouvir' && nome !== 'tela' ? `0 14px 34px ${COR.accentForte}66` : 'none' }}>
            <Icone nome={CONTROLES[nome][0]} tamanho={42 * tamanho} />
            {CONTROLES[nome][1]}
          </div>
        );
      })}
    </div>
  );
}

// ---------- O palco ----------
// Uma "partida" desenhada: céu de fim de tarde, sol, dois morros e a pista correndo. `visto`
// vai de 0 (borrado, "Assistir") a 1 (nítido, chegando). É o jogo que alguém compartilha.
export function Jogo({ q }) {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: 'linear-gradient(180deg,#241d49 0%,#5d3f86 48%,#e39a6d 78%,#f2c188 100%)' }}>
      <div style={{ position: 'absolute', left: '58%', top: '26%', width: '20%', aspectRatio: '1', borderRadius: '50%', background: 'radial-gradient(circle,#ffe2a8,#f7a86a 70%)', boxShadow: '0 0 90px #f7b27a' }} />
      <div style={{ position: 'absolute', bottom: '18%', left: `${-20 - ((q * 0.35) % 60)}%`, width: '200%', height: '42%', background: 'radial-gradient(ellipse 18% 100% at 15% 100%,#3a2a5e 98%,transparent),radial-gradient(ellipse 22% 90% at 45% 100%,#3a2a5e 98%,transparent),radial-gradient(ellipse 18% 100% at 75% 100%,#3a2a5e 98%,transparent)' }} />
      <div style={{ position: 'absolute', bottom: '11%', left: `${-((q * 0.9) % 50)}%`, width: '200%', height: '28%', background: 'radial-gradient(ellipse 14% 100% at 10% 100%,#231a3d 98%,transparent),radial-gradient(ellipse 16% 100% at 35% 100%,#231a3d 98%,transparent),radial-gradient(ellipse 12% 100% at 60% 100%,#231a3d 98%,transparent),radial-gradient(ellipse 15% 100% at 85% 100%,#231a3d 98%,transparent)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '13%', background: '#15112a' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: '44%', height: 5, backgroundImage: 'repeating-linear-gradient(90deg,#f2c188 0 40px,transparent 40px 80px)', backgroundPosition: `${-q * 14}px 0` }} />
      </div>
      <div style={{ position: 'absolute', left: '44%', bottom: '9%', width: '12%', height: '9%', borderRadius: '30% 30% 10% 10%', background: COR.accentHi, boxShadow: '0 8px 0 #15112a', transform: `translateY(${Math.sin(q / 3) * 3}px)` }} />
    </div>
  );
}

export function Palco({ largura = 900, visto = 1, legenda, aoVivo = true, espectadores = [], contagemExtra = 0, capa = null, barra = 0 }) {
  const q = useCurrentFrame();
  const altura = largura * 10 / 16;
  const e = largura / 900;
  const presentes = espectadores.filter(({ em }) => q >= em);
  return (
    <div style={{ position: 'relative', width: largura, height: altura, borderRadius: 26 * e, overflow: 'hidden', background: '#0b0b12', boxShadow: `0 40px 90px rgba(0,0,0,.5), 0 0 0 1.5px ${COR.linha2}`, fontFamily: FONTE }}>
      <div style={{ position: 'absolute', inset: 0, filter: `blur(${(1 - visto) * 14}px) brightness(${0.45 + visto * 0.55})`, transform: `scale(${1.06 - visto * 0.06})` }}><Jogo q={q} /></div>
      <div style={{ position: 'absolute', left: 20 * e, top: 18 * e, padding: `${5 * e}px ${12 * e}px`, borderRadius: 8 * e, background: 'rgba(0,0,0,.42)', color: '#fff', fontSize: 17 * e, fontWeight: 700, letterSpacing: '0.06em', fontFamily: 'ui-monospace, Consolas, monospace', opacity: visto }}>VOLTA 2/3 · 01:42</div>
      {aoVivo && <span style={{ position: 'absolute', left: 20 * e, bottom: 20 * e, padding: `${6 * e}px ${14 * e}px`, borderRadius: 999, background: COR.rosa, color: '#1d0a12', fontSize: 17 * e, fontWeight: 800, letterSpacing: '0.14em' }}>AO VIVO</span>}
      {legenda && <span style={{ position: 'absolute', left: 150 * e, bottom: 20 * e, padding: `${6 * e}px ${14 * e}px`, borderRadius: 10 * e, background: 'rgba(12,12,20,.72)', color: '#fff', fontSize: 20 * e, fontWeight: 600 }}>{legenda}</span>}
      {(presentes.length > 0 || contagemExtra > 0) && (
        <span style={{ position: 'absolute', right: 18 * e, top: 16 * e, display: 'flex', alignItems: 'center', gap: 10 * e, padding: `${7 * e}px ${9 * e}px ${7 * e}px ${14 * e}px`, borderRadius: 999, background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 24 * e, fontWeight: 700 }}>
          <Icone nome="olho" tamanho={26 * e} />
          {presentes.length + contagemExtra}
          <span style={{ display: 'flex' }}>
            {presentes.map(({ pessoa, em }, i) => {
              const p = mola(q, em, { amortecimento: 10 });
              return <Avatar key={i} pessoa={pessoa} tamanho={34 * e} style={{ marginLeft: i ? -9 * e : 0, boxShadow: '0 0 0 3px #15151f', transform: `scale(${p})` }} />;
            })}
          </span>
        </span>
      )}
      {capa}
      {barra > 0 && (
        <div style={{ position: 'absolute', left: '50%', bottom: 18 * e, display: 'flex', gap: 6 * e, padding: 7 * e, borderRadius: 14 * e, background: 'rgba(12,12,20,.75)', color: '#fff', opacity: barra, transform: `translate(-50%, ${(1 - barra) * 20}px)` }}>
          {['grade', 'compacto', 'cheia'].map(nome => <span key={nome} style={{ display: 'grid', placeItems: 'center', width: 46 * e, height: 46 * e, borderRadius: 10 * e }}><Icone nome={nome} tamanho={24 * e} /></span>)}
        </div>
      )}
    </div>
  );
}

// A capa de quem ainda não clicou: "Rafa está compartilhando" e o botão Assistir.
export function CapaAssistir({ e = 1, apertado, some = 0 }) {
  const q = useCurrentFrame();
  const aperto = apertado !== undefined && q >= apertado && q < apertado + 6 ? 0.94 : 1;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', justifyItems: 'center', gap: 18 * e, opacity: 1 - some, textAlign: 'center' }}>
      <span style={{ padding: `${6 * e}px ${14 * e}px`, borderRadius: 999, background: COR.rosa, color: '#1d0a12', fontSize: 18 * e, fontWeight: 800, letterSpacing: '0.14em' }}>AO VIVO</span>
      <strong style={{ color: '#fff', fontSize: 34 * e, fontWeight: 650 }}>Rafa está compartilhando a tela</strong>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 * e, padding: `${14 * e}px ${30 * e}px`, borderRadius: 14 * e, background: COR.accentForte, color: '#fff', fontSize: 26 * e, fontWeight: 650, transform: `scale(${aperto})`, boxShadow: `0 16px 34px ${COR.accentForte}55` }}><Icone nome="olho" tamanho={28 * e} />Assistir</span>
    </div>
  );
}

// ---------- O volume de uma pessoa ----------
export function LinhaDeVolume({ valor = 100, largura = 820 }) {
  const q = useCurrentFrame();
  const e = largura / 820;
  const nivel = valor / 100;
  return (
    <div style={{ width: largura, padding: 34 * e, borderRadius: 28 * e, background: COR.bg2, boxShadow: `0 40px 90px rgba(0,0,0,.45), 0 0 0 1.5px ${COR.linha2}`, fontFamily: FONTE, color: COR.texto }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 * e }}>
        <Avatar pessoa={PESSOAS.leo} tamanho={84 * e} anel={`rgba(144,223,179,${0.25 + nivel * 0.3})`} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 36 * e, fontWeight: 650 }}>Léo</div>
          <div style={{ fontSize: 22 * e, color: COR.muted }}>fala baixinho</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 * e, height: 64 * e }}>
          {[0, 1, 2, 3, 4].map(i => {
            const onda = (Math.sin(q / 4 + i * 1.7) + 1) / 2;
            return <i key={i} style={{ display: 'block', width: 11 * e, borderRadius: 6 * e, background: COR.online, height: `${(12 + onda * 30) * Math.min(1.7, 0.4 + nivel * 0.65)}%` }} />;
          })}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 26 * e, marginTop: 34 * e }}>
        <div style={{ position: 'relative', flex: 1, height: 12 * e, borderRadius: 6 * e, background: COR.bg4 }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${valor / 2}%`, borderRadius: 6 * e, background: `linear-gradient(90deg, ${COR.accent}, ${COR.accentHi})` }} />
          <div style={{ position: 'absolute', left: '50%', top: -8 * e, bottom: -8 * e, width: 2, background: COR.bg5 }} />
          <div style={{ position: 'absolute', left: `${valor / 2}%`, top: '50%', width: 34 * e, height: 34 * e, borderRadius: '50%', background: '#fff', transform: 'translate(-50%,-50%)', boxShadow: `0 4px 12px rgba(0,0,0,.4), 0 0 0 5px ${COR.accent}` }} />
        </div>
        <div style={{ minWidth: 150 * e, textAlign: 'right', fontSize: 58 * e, fontWeight: 750, fontVariantNumeric: 'tabular-nums', color: valor > 100 ? COR.accentTexto : COR.texto }}>{Math.round(valor)}%</div>
      </div>
    </div>
  );
}

// ---------- O chat ----------
// `mensagens`: [{ pessoa, texto, em }]. `rascunho`: o que está sendo digitado, letra a letra a
// partir de `inicio`. `@Nome` vira a pílula violeta, como na sala.
function comPilulas(texto) {
  return texto.split(/(@\S+)/).map((parte, i) => parte.startsWith('@')
    ? <span key={i} style={{ padding: '2px 10px', borderRadius: 8, background: 'rgba(136,121,246,.24)', color: COR.accentTexto, fontWeight: 650 }}>{parte}</span>
    : parte);
}
export function Chat({ mensagens = [], rascunho = '', inicioRascunho = 0, porLetra = 2, lista = null, largura = 820 }) {
  const q = useCurrentFrame();
  const e = largura / 820;
  const visiveis = mensagens.filter(m => q >= m.em);
  const letras = Math.max(0, Math.min(rascunho.length, Math.floor((q - inicioRascunho) / porLetra)));
  const digitado = q >= inicioRascunho ? rascunho.slice(0, letras) : '';
  return (
    <div style={{ width: largura, padding: 30 * e, borderRadius: 28 * e, background: COR.bg1, boxShadow: `0 40px 90px rgba(0,0,0,.45), 0 0 0 1.5px ${COR.linha2}`, fontFamily: FONTE, color: COR.texto }}>
      <div style={{ fontSize: 22 * e, fontWeight: 650, color: COR.muted, marginBottom: 18 * e }}># chat da sala</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 * e, minHeight: 250 * e, justifyContent: 'flex-end' }}>
        {visiveis.slice(-4).map((m, i) => {
          const p = mola(q, m.em);
          return (
            <div key={`${m.em}-${i}`} style={{ display: 'flex', gap: 16 * e, alignItems: 'flex-start', opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 20}px)` }}>
              <Avatar pessoa={m.pessoa} tamanho={52 * e} />
              <div>
                <div style={{ fontSize: 21 * e, fontWeight: 700, color: m.pessoa.cor }}>{m.pessoa.nome}</div>
                <div style={{ fontSize: 27 * e, color: COR.texto2, lineHeight: 1.4 }}>{comPilulas(m.texto)}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12 * e, marginTop: 22 * e, padding: `${10 * e}px ${10 * e}px ${10 * e}px ${22 * e}px`, borderRadius: 16 * e, background: COR.cartao, boxShadow: `inset 0 0 0 1.5px ${digitado ? COR.accent : COR.linha2}` }}>
        <span style={{ flex: 1, fontSize: 27 * e, color: digitado ? COR.texto : COR.faint, whiteSpace: 'pre' }}>
          {digitado ? comPilulas(digitado) : 'Converse com o squad…'}
          {digitado && q % 20 < 12 && <span style={{ display: 'inline-block', width: 3, height: 30 * e, marginLeft: 3, background: COR.accentHi, verticalAlign: 'middle' }} />}
        </span>
        <span style={{ display: 'grid', placeItems: 'center', width: 54 * e, height: 54 * e, borderRadius: 12 * e, background: COR.accentForte, color: '#fff' }}><Icone nome="enviar" tamanho={26 * e} /></span>
        {lista && (() => {
          const p = Math.min(mola(q, lista.de), entre(q, [lista.ate - 6, lista.ate], [1, 0]));
          if (p <= 0.01) return null;
          return (
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: `calc(100% + ${12 * e}px)`, padding: 10 * e, borderRadius: 16 * e, background: COR.bg2, boxShadow: `0 20px 50px rgba(0,0,0,.5), 0 0 0 1.5px ${COR.linha2}`, opacity: p, transform: `translateY(${(1 - p) * 16}px)` }}>
              {[PESSOAS.ana, PESSOAS.bia, PESSOAS.rafa].map(pessoa => (
                <div key={pessoa.nome} style={{ display: 'flex', alignItems: 'center', gap: 16 * e, padding: `${10 * e}px ${14 * e}px`, borderRadius: 12 * e, fontSize: 26 * e, background: pessoa === PESSOAS.rafa && q >= lista.ativo ? 'rgba(136,121,246,.28)' : 'transparent' }}>
                  <Avatar pessoa={pessoa} tamanho={40 * e} />{pessoa.nome}
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ---------- A mesa de sons ----------
export const PADS = [['🥁', 'Ba-dum-tss'], ['😮', 'Uhhh'], ['👏', 'Palmas'], ['🌀', 'Boing']];
export function Mesa({ tocados = {}, largura = 820 }) {
  const q = useCurrentFrame();
  const e = largura / 820;
  return (
    <div style={{ width: largura, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 * e, fontFamily: FONTE }}>
      {PADS.map(([emoji, nome], i) => {
        const t = tocados[i];
        const ativo = t !== undefined && q >= t ? Math.max(0, 1 - (q - t) / 24) : 0;
        return (
          <div key={nome} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 * e, height: 170 * e, borderRadius: 22 * e, background: interpolateColors(ativo, [0, 1], [COR.bg3, COR.accentForte]), color: ativo > 0.3 ? '#fff' : COR.texto2, fontSize: 24 * e, fontWeight: 650, transform: `scale(${1 + Math.sin(ativo * Math.PI) * 0.08})`, boxShadow: ativo ? `0 0 0 ${10 * ativo * e}px rgba(136,121,246,${0.25 * ativo})` : `inset 0 0 0 1.5px ${COR.linha}` }}>
            <span style={{ fontSize: 58 * e, lineHeight: 1 }}>{emoji}</span>{nome}
          </div>
        );
      })}
    </div>
  );
}

// ---------- A fila de música ----------
// Três pedidos; em `troca`, o último é arrastado para o topo -- a fila que se arruma.
const FAIXAS = [['Lo-fi para jogar junto', 'Ana', '3:12'], ['Tema da vitória', 'Léo', '2:47'], ['Aquela que todo mundo canta', 'Bia', '3:58']];
export function Fila({ troca = Infinity, largura = 820 }) {
  const q = useCurrentFrame();
  const e = largura / 820;
  const t = entre(q, [troca, troca + 18]);
  const alturaItem = 92 * e;
  const posicoes = [t * alturaItem, t * alturaItem, -2 * t * alturaItem];
  return (
    <div style={{ width: largura, padding: 30 * e, borderRadius: 28 * e, background: COR.bg1, boxShadow: `0 40px 90px rgba(0,0,0,.45), 0 0 0 1.5px ${COR.linha2}`, fontFamily: FONTE, color: COR.texto }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 * e, padding: 20 * e, borderRadius: 20 * e, background: COR.bg2 }}>
        <span style={{ display: 'grid', placeItems: 'center', width: 86 * e, height: 86 * e, borderRadius: 16 * e, background: `linear-gradient(135deg, ${COR.accentForte}, ${COR.rosa})`, color: '#fff' }}><Icone nome="musica" tamanho={40 * e} /></span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17 * e, fontWeight: 700, letterSpacing: '0.14em', color: COR.accentTexto }}>TOCANDO AGORA</div>
          <div style={{ fontSize: 30 * e, fontWeight: 650 }}>Trilha da noite de jogo</div>
          <div style={{ marginTop: 12 * e, height: 8 * e, borderRadius: 4 * e, background: COR.bg4 }}><div style={{ width: `${30 + ((q * 0.12) % 60)}%`, height: '100%', borderRadius: 4 * e, background: COR.accent }} /></div>
        </div>
      </div>
      <div style={{ fontSize: 20 * e, fontWeight: 650, color: COR.muted, margin: `${24 * e}px 0 ${10 * e}px` }}>A seguir · 3</div>
      <div style={{ position: 'relative', height: alturaItem * 3 }}>
        {FAIXAS.map(([titulo, quem, tempo], i) => {
          const arrastando = i === 2 && t > 0 && t < 1;
          return (
            <div key={titulo} style={{ position: 'absolute', left: 0, right: 0, top: i * alturaItem + posicoes[i], height: alturaItem - 12 * e, display: 'flex', alignItems: 'center', gap: 18 * e, padding: `0 ${18 * e}px`, borderRadius: 16 * e, background: arrastando ? COR.bg3 : COR.bg2, boxShadow: arrastando ? `0 20px 40px rgba(0,0,0,.5), 0 0 0 2px ${COR.accent}` : 'none', transform: `scale(${arrastando ? 1.03 : 1})`, zIndex: arrastando ? 2 : 1 }}>
              <Icone nome="alca" tamanho={26 * e} cor={COR.faint} traco={3} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 26 * e, fontWeight: 600 }}>{titulo}</div>
                <div style={{ fontSize: 19 * e, color: COR.muted }}>pedida por {quem}</div>
              </div>
              <span style={{ fontSize: 21 * e, color: COR.faint, fontVariantNumeric: 'tabular-nums' }}>{tempo}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- O convite ----------
// Uma conversa de grupo qualquer, fora do Nexo -- é lá que o link circula. `link.em` é quando o
// link chega; `link.clique` é quando alguém toca nele.
export function Grupo({ mensagens = [], link, largura = 820 }) {
  const q = useCurrentFrame();
  const e = largura / 820;
  const bolha = (m, i) => {
    const p = mola(q, m.em);
    const minha = m.pessoa === PESSOAS.voce;
    return (
      <div key={i} style={{ display: 'flex', justifyContent: minha ? 'flex-end' : 'flex-start', gap: 14 * e, opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 24}px) scale(${0.96 + p * 0.04})`, transformOrigin: minha ? 'right bottom' : 'left bottom' }}>
        {!minha && <Avatar pessoa={m.pessoa} tamanho={46 * e} />}
        <div style={{ maxWidth: '78%', padding: `${14 * e}px ${20 * e}px`, borderRadius: 22 * e, borderBottomLeftRadius: minha ? 22 * e : 6 * e, borderBottomRightRadius: minha ? 6 * e : 22 * e, background: minha ? COR.accentForte : COR.bg3, color: minha ? '#fff' : COR.texto2, fontSize: 27 * e }}>
          {!minha && <div style={{ fontSize: 19 * e, fontWeight: 700, color: m.pessoa.cor, marginBottom: 2 }}>{m.pessoa.nome}</div>}
          {m.texto}
        </div>
      </div>
    );
  };
  const pLink = link ? mola(q, link.em) : 0;
  const tocado = link && q >= link.clique ? Math.max(0, 1 - (q - link.clique) / 14) : 0;
  return (
    <div style={{ width: largura, padding: 28 * e, borderRadius: 30 * e, background: COR.bg1, boxShadow: `0 40px 90px rgba(0,0,0,.45), 0 0 0 1.5px ${COR.linha2}`, fontFamily: FONTE, color: COR.texto }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 * e, paddingBottom: 20 * e, marginBottom: 22 * e, borderBottom: `1.5px solid ${COR.linha}` }}>
        <span style={{ display: 'flex' }}>{[PESSOAS.ana, PESSOAS.leo, PESSOAS.rafa].map((p, i) => <Avatar key={p.nome} pessoa={p} tamanho={44 * e} style={{ marginLeft: i ? -12 * e : 0, boxShadow: `0 0 0 3px ${COR.bg1}` }} />)}</span>
        <div><div style={{ fontSize: 26 * e, fontWeight: 650 }}>squad da noite</div><div style={{ fontSize: 19 * e, color: COR.muted }}>Ana, Léo, Rafa e você</div></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 * e }}>
        {mensagens.filter(m => q >= m.em - 2).map(bolha)}
        {link && q >= link.em - 2 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', opacity: Math.min(1, pLink * 1.4), transform: `translateY(${(1 - pLink) * 24}px) scale(${(0.96 + pLink * 0.04) * (1 + tocado * 0.04)})`, transformOrigin: 'right bottom' }}>
            <div style={{ width: '72%', borderRadius: 22 * e, borderBottomRightRadius: 6 * e, overflow: 'hidden', background: COR.accentForte, boxShadow: tocado ? `0 0 0 ${8 * tocado * e}px rgba(160,146,255,.35)` : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 * e, padding: 16 * e, background: 'rgba(0,0,0,.18)' }}>
                <svg width={58 * e} height={58 * e} viewBox="0 0 64 64"><rect width="64" height="64" rx="20" fill={COR.marca} /><path d="M18 45V19h7l14 17V19h7v26h-7L25 28v17z" fill="#fff" /><path d="m44 10 1.7 4.3L50 16l-4.3 1.7L44 22l-1.7-4.3L38 16l4.3-1.7z" fill={COR.faisca} /></svg>
                <div><div style={{ fontSize: 24 * e, fontWeight: 700, color: '#fff' }}>Nexo · squad-da-noite</div><div style={{ fontSize: 19 * e, color: 'rgba(255,255,255,.75)' }}>Entrar na sala</div></div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 * e, padding: `${12 * e}px ${18 * e}px`, fontSize: 24 * e, color: '#fff' }}><Icone nome="link" tamanho={24 * e} />…/squad-da-noite/sala</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// "4 na sala": o selo que enche quando cada um entra. `entradas`: [{ pessoa, em }].
export function SalaEnchendo({ entradas = [], tamanho = 1 }) {
  const q = useCurrentFrame();
  const dentro = entradas.filter(({ em }) => q >= em);
  const p = entradas.length ? mola(q, entradas[0].em - 6) : 0;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 18 * tamanho, padding: `${14 * tamanho}px ${26 * tamanho}px ${14 * tamanho}px ${16 * tamanho}px`, borderRadius: 999, background: COR.bg2, boxShadow: `0 24px 60px rgba(0,0,0,.45), 0 0 0 1.5px ${COR.linha2}`, fontFamily: FONTE, color: COR.texto, opacity: Math.min(1, p * 1.3), transform: `translateY(${(1 - p) * 30}px)` }}>
      <span style={{ display: 'flex' }}>
        {dentro.map(({ pessoa, em }, i) => {
          const s = mola(q, em, { amortecimento: 9 });
          return <Avatar key={pessoa.nome} pessoa={pessoa} tamanho={56 * tamanho} style={{ marginLeft: i ? -14 * tamanho : 0, boxShadow: `0 0 0 4px ${COR.bg2}`, transform: `scale(${s}) translateY(${(1 - s) * 30}px)` }} />;
        })}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 12 * tamanho, fontSize: 28 * tamanho, fontWeight: 650 }}>
        <i style={{ width: 12 * tamanho, height: 12 * tamanho, borderRadius: '50%', background: COR.online, boxShadow: `0 0 12px ${COR.online}` }} />
        {dentro.length} na sala
      </span>
    </div>
  );
}

// ---------- Os temas ----------
// A mesma conta de tema.js: cada tema pronto vira a paleta que a sala usa de verdade.
export const TEMAS = ['nexo', 'meia-noite', 'floresta', 'sakura'].map(id => {
  const tema = NexoTema.TEMAS.find(t => t.id === id);
  return { id, nome: tema.nome, cores: NexoTema.derivar(NexoTema.resolver({ tema: id })) };
});

export function MiniSala({ trocas = [], largura = 900, temas = TEMAS }) {
  const q = useCurrentFrame();
  const e = largura / 900;
  // Qual tema vale agora e o anterior, para a cor deslizar entre os dois.
  let atual = 0;
  trocas.forEach((quando, i) => { if (q >= quando) atual = i + 1; });
  atual = Math.min(atual, temas.length - 1);
  const anterior = Math.max(0, atual - 1);
  const t = atual === 0 ? 1 : entre(q, [trocas[atual - 1], trocas[atual - 1] + 10]);
  const c = nome => interpolateColors(t, [0, 1], [temas[anterior].cores[nome], temas[atual].cores[nome]]);
  const bloco = (w, h, cor, extra = {}) => <div style={{ width: w, height: h, borderRadius: 8 * e, background: cor, ...extra }} />;
  return (
    <div style={{ width: largura }}>
      <div style={{ display: 'grid', gridTemplateColumns: '22% 1fr 28%', gap: 12 * e, height: largura * 0.52, padding: 12 * e, borderRadius: 26 * e, background: c('--bg'), boxShadow: `0 40px 90px rgba(0,0,0,.5), 0 0 0 1.5px ${COR.linha2}` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 * e, padding: 18 * e, borderRadius: 16 * e, background: c('--bg-1') }}>
          {bloco('70%', 16 * e, c('--accent'))}{bloco('90%', 14 * e, c('--bg-3'))}{bloco('80%', 14 * e, c('--bg-3'))}{bloco('60%', 14 * e, c('--bg-3'))}
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 8 * e }}>{[PESSOAS.ana, PESSOAS.leo, PESSOAS.rafa].map(p => <Avatar key={p.nome} pessoa={p} tamanho={30 * e} />)}</div>
        </div>
        <div style={{ position: 'relative', borderRadius: 16 * e, overflow: 'hidden', background: '#0b0b12' }}><Jogo q={q} /></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 * e, padding: 18 * e, borderRadius: 16 * e, background: c('--bg-1') }}>
          {bloco('100%', 40 * e, c('--bg-3'))}{bloco('75%', 40 * e, c('--accent-suave-hi'))}{bloco('90%', 40 * e, c('--bg-3'))}
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 8 * e }}>{bloco('100%', 44 * e, c('--bg-2'), { boxShadow: `inset 0 0 0 1.5px ${c('--bg-3')}` })}{bloco(44 * e, 44 * e, c('--accent-forte'), { flex: 'none' })}</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 18 * e, marginTop: 26 * e }}>
        {temas.map((tema, i) => (
          <div key={tema.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 * e, fontFamily: FONTE, fontSize: 22 * e, fontWeight: 600, color: i === atual ? COR.texto : COR.faint }}>
            <span style={{ width: 62 * e, height: 62 * e, borderRadius: '50%', background: `linear-gradient(135deg, ${tema.cores['--bg']} 0 52%, ${tema.cores['--accent']} 52% 100%)`, boxShadow: i === atual ? `0 0 0 ${4 * e}px ${COR.bg}, 0 0 0 ${8 * e}px ${tema.cores['--accent']}` : `0 0 0 1.5px ${COR.linha2}`, transform: `scale(${i === atual ? 1.08 : 1})` }} />
            {tema.nome}
          </div>
        ))}
      </div>
    </div>
  );
}
