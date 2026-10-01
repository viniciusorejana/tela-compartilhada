// As cenas 1 a 5 do Reels de humor: o gancho do Léo, a chegada do Nexo, a tela com som, o
// "assistir só quem quer" e o volume por pessoa. Cada cena vive numa <Sequence>: o quadro 0 é o
// começo dela. `c` traz `de`, `dur` e `vozEm` (o quadro global em que a fala entra).
import React from 'react';
import { AbsoluteFill, random, useCurrentFrame } from 'remotion';
import { COR, FONTE, entre, mola } from '../base/tema';
import { Avatar, Cursor, Icone, Marca } from '../base/componentes';
import { Jogo, Palco } from '../base/interface';
import { A, Adesivo, Camera, Clarao, Confete, ConversaGrupo, Etiqueta, L, Legenda, PESSOAS_REELS as P, COLUNA } from './pecas';
import { DROP, quadros, trecho } from './linha';

// Algo que chega de baixo com mola, sem fundo próprio.
export function Chegada({ em = 0, fim = Infinity, y, x = COLUNA.x, w = COLUNA.w, children, from = 80 }) {
  const q = useCurrentFrame();
  if (q < em - 1 || q >= fim) return null;
  const p = mola(q, em, { amortecimento: 12, rigidez: 190 });
  const saida = entre(q, [fim - 6, fim]);
  return <div style={{ position: 'absolute', left: x, top: y, width: w, opacity: Math.min(1, p * 1.5) * (1 - saida), transform: `translateY(${(1 - p) * from + saida * 40}px) scale(${0.95 + p * 0.05})` }}>{children}</div>;
}

// Uma bolha de conversa solta (fora de uma lista), à esquerda ou à direita.
function Bolha({ pessoa, texto, em, x, y, lado = 'esq', cor, tinta, tamanho = 40 }) {
  const q = useCurrentFrame();
  if (q < em - 1) return null;
  const p = mola(q, em, { amortecimento: 9, rigidez: 240 });
  const dir = lado === 'dir';
  return (
    <div style={{ position: 'absolute', left: x, top: y, display: 'flex', flexDirection: dir ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 14, opacity: Math.min(1, p * 2), transform: `scale(${0.6 + p * 0.4}) translateY(${(1 - p) * 30}px)`, transformOrigin: dir ? 'right bottom' : 'left bottom', fontFamily: FONTE }}>
      <Avatar pessoa={pessoa} tamanho={64} />
      <div style={{ padding: '16px 30px', borderRadius: 30, borderBottomLeftRadius: dir ? 30 : 8, borderBottomRightRadius: dir ? 8 : 30, background: cor ?? COR.bg3, color: tinta ?? COR.texto, fontSize: tamanho, fontWeight: 650, boxShadow: '0 16px 36px rgba(0,0,0,.4)' }}>{texto}</div>
    </div>
  );
}

// ============================ 1 · O GANCHO ============================
// "Todo grupo tem um Léo": 0 a 7 s, na introdução filtrada da trilha. A piada é o intervalo entre
// a fala (que termina cedo) e o drop: o cartão de "47 minutos depois", com o disco arranhando.
function CartaoTempo({ em, fim }) {
  const q = useCurrentFrame();
  if (q < em || q >= fim) return null;
  const t = q - em;
  const bate = mola(q, em, { amortecimento: 10, rigidez: 260 });
  const relogio = t * 26;
  return (
    <AbsoluteFill style={{ zIndex: 70, background: 'radial-gradient(ellipse at 50% 38%, #2f58a6 0%, #10224d 62%, #08101f 100%)', alignItems: 'center', justifyContent: 'center', gap: 30, transform: `scale(${1.22 - 0.22 * bate + t * 0.0009})` }}>
      <div style={{ position: 'relative', width: 250, height: 250, borderRadius: '50%', background: '#f4f1e6', boxShadow: '0 0 0 14px #1a1a24, 0 30px 60px rgba(0,0,0,.5)' }}>
        <i style={{ position: 'absolute', left: '50%', top: '50%', width: 10, height: 92, marginLeft: -5, marginTop: -92, background: '#1a1a24', borderRadius: 6, transformOrigin: '50% 100%', transform: `rotate(${relogio}deg)` }} />
        <i style={{ position: 'absolute', left: '50%', top: '50%', width: 8, height: 130, marginLeft: -4, marginTop: -130, background: COR.danger, borderRadius: 6, transformOrigin: '50% 100%', transform: `rotate(${relogio * 12}deg)` }} />
        <i style={{ position: 'absolute', left: '50%', top: '50%', width: 26, height: 26, marginLeft: -13, marginTop: -13, background: '#1a1a24', borderRadius: '50%' }} />
      </div>
      <div style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', fontWeight: 700, fontSize: 150, lineHeight: 1.02, textAlign: 'center', color: '#fff', textShadow: '0 8px 0 rgba(0,0,0,.35)' }}>47 minutos<br />depois…</div>
    </AbsoluteFill>
  );
}

export function Gancho({ c }) {
  const V = c.vozEm - c.de;
  return (
    <Camera golpes={[V, 74, 163, 200]} forca={0.028} tremer={[[200, 213, 9]]}>
      <Etiqueta em={2} x={380} y={272} tamanho={36} rot={-2} fundo="rgba(255,255,255,.92)" fim={114}>POV: o grupo marcou call</Etiqueta>
      <Legenda troca pecas={[
        { t: 'Todo grupo de\namigos tem um *Léo.*', em: V, y: 340, tamanho: 108 },
        { t: 'Ele já\n*tá entrando.*', em: V + trecho('v01', 1), y: 340, tamanho: 118, fim: 116 },
        { t: 'Ainda\n*tá entrando.*', em: 166, y: 340, tamanho: 118 }
      ]} />
      <Adesivo em={24} fim={116} x={900} y={730} tamanho={150} rot={12}>🐌</Adesivo>
      <ConversaGrupo y={760} h={690} realce={{ em: 200, ate: 216 }} mensagens={[
        { pessoa: P.ana, texto: 'bora jogar hoje? 🎮', em: 14 },
        { pessoa: P.bia, texto: 'bora!! chama o Léo', em: 34 },
        { pessoa: P.rafa, texto: 'já tô on 😎', em: 52 },
        { pessoa: P.leo, texto: 'já tô entrando', em: 76 },
        { pessoa: P.ana, texto: 'Léo??', em: 163 },
        { pessoa: P.bia, texto: 'cadê vc 😅', em: 172 },
        { pessoa: P.rafa, texto: 'ele tá digitando há 47 min', em: 180 },
        { pessoa: P.leo, texto: 'já tô entrando', em: 200 }
      ]} digitando={[{ pessoa: P.leo, de: 62, ate: 76 }, { pessoa: P.leo, de: 186, ate: 200 }]} />
      <Etiqueta em={202} x={790} y={640} rot={6} tamanho={40}>de novo 🙃</Etiqueta>
      <CartaoTempo em={117} fim={162} />
    </Camera>
  );
}
export const sonsGancho = () => [
  ['pop', 14, 0.35], ['pop', 34, 0.35], ['pop', 52, 0.35], ['teclado', 62, 0.22], ['audio/sala/mensagem.mp3', 76, 0.7],
  ['audio/reels/arranhao.mp3', 117, 0.95], ['pop', 163, 0.35], ['pop', 172, 0.35], ['pop', 180, 0.35], ['teclado', 186, 0.22],
  ['audio/sala/mensagem.mp3', 200, 0.7], ['whoosh', 196, 0.55]
];

// ============================ 2 · O NEXO ============================
// Aí chega o Nexo: o carimbo cai exatamente no drop (DROP quadros desde o início do vídeo). Depois,
// um link, um clique, e o Léo -- finalmente -- entra na sala.
function Faiscas({ de, n = 30 }) {
  const q = useCurrentFrame();
  const t = q - de;
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const ang = random(`fa${i}`) * Math.PI * 2;
        const dist = entre(t, [0, 34]) * (260 + random(`fd${i}`) * 620);
        return <span key={i} style={{ position: 'absolute', left: L / 2 + Math.cos(ang) * dist, top: 880 + Math.sin(ang) * dist, fontSize: 22 + random(`ft${i}`) * 36, color: i % 4 ? COR.accentHi : COR.faisca, opacity: entre(t, [8, 40], [1, 0]), transform: 'translate(-50%,-50%)' }}>✦</span>;
      })}
    </>
  );
}

function Carimbo({ de, ate }) {
  const q = useCurrentFrame();
  if (q < de || q >= ate) return null;
  const bate = mola(q, de, { amortecimento: 8, rigidez: 250, massa: 0.8 });
  const saida = entre(q, [ate - 8, ate]);
  return (
    <AbsoluteFill style={{ zIndex: 60, background: `radial-gradient(circle at 50% 44%, #3b2f96 0%, #0d0e18 66%)`, alignItems: 'center', justifyContent: 'center', gap: 36, opacity: 1 - saida, transform: `scale(${1 + saida * 0.12})` }}>
      <Faiscas de={de} />
      <Marca tamanho={360} faisca={mola(q, de + 6, { amortecimento: 8 })} style={{ transform: `scale(${2.7 - bate * 1.7})`, opacity: Math.min(1, bate * 2.4) }} />
      <div style={{ fontFamily: FONTE, fontSize: 230, fontWeight: 800, letterSpacing: '0.14em', color: '#fff', textShadow: '0 10px 0 rgba(0,0,0,.3)', transform: `scale(${0.6 + 0.4 * mola(q, de + 3, { amortecimento: 9, rigidez: 260 })})`, opacity: Math.min(1, mola(q, de + 3) * 2) }}>NEXO</div>
    </AbsoluteFill>
  );
}

function GradeSala({ y, entradas, de }) {
  const q = useCurrentFrame();
  if (q < de) return null;
  const pessoas = [P.ana, P.bia, P.rafa, P.leo];
  return (
    <div style={{ position: 'absolute', left: COLUNA.x, top: y, width: COLUNA.w, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
      {pessoas.map((p, i) => {
        const em = entradas[i];
        const pop = q >= em ? mola(q, em, { amortecimento: 9, rigidez: 220 }) : 0;
        const ultimo = i === 3;
        const fala = 0.5 + 0.5 * Math.sin(q / 3 + i * 2);
        return (
          <div key={p.nome} style={{ position: 'relative', height: 300, borderRadius: 36, border: '3px dashed rgba(255,255,255,.14)', boxSizing: 'border-box' }}>
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 36, background: `linear-gradient(160deg, ${COR.bg3}, ${COR.bg1})`, boxShadow: ultimo && pop ? `0 0 0 6px ${COR.online}, 0 30px 60px rgba(0,0,0,.5)` : `0 0 0 2px ${COR.linha2}, 0 30px 60px rgba(0,0,0,.4)`, opacity: Math.min(1, pop * 2), transform: `scale(${0.7 + pop * 0.3})` }}>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}><Avatar pessoa={p} tamanho={150} anel={COR.online} /></div>
            <span style={{ position: 'absolute', left: 22, bottom: 20, padding: '8px 18px', borderRadius: 999, background: 'rgba(12,12,20,.72)', color: '#fff', fontFamily: FONTE, fontSize: 30, fontWeight: 650 }}>{p.nome}</span>
            <span style={{ position: 'absolute', right: 22, bottom: 22, display: 'flex', alignItems: 'flex-end', gap: 5, height: 40 }}>{[0, 1, 2, 3].map(k => <i key={k} style={{ display: 'block', width: 8, borderRadius: 4, background: COR.online, height: 10 + (Math.sin(q / 3 + k * 1.3 + i) + 1) * 12 * (ultimo ? 1 : fala) }} />)}</span>
          </div>
          </div>
        );
      })}
    </div>
  );
}

export function Nexo({ c }) {
  const slam = DROP - c.de;
  const clique = 80;
  const entradas = [86, 94, 102, 112];
  return (
    <Camera golpes={[slam, 52, 112]} forca={0.05} tremer={[[slam, slam + 14, 16]]}>
      <Legenda troca pecas={[
        { t: 'Aí chega\no *Nexo!*', em: 2, y: 262, tamanho: 130, fim: slam },
        { t: 'Um *link.*', em: 52, y: 262, tamanho: 140 },
        { t: 'Um *clique.*', em: 75, y: 262, tamanho: 140 },
        { t: '…e ele\n^entrou!^', em: 109, y: 262, tamanho: 140 }
      ]} />
      <ConversaGrupo y={740} h={660} fim={clique + 6} mensagens={[
        { pessoa: P.leo, texto: 'já tô entrando', em: -300 },
        { pessoa: P.ana, tipo: 'link', em: 8 }
      ]} />
      <GradeSala y={720} entradas={entradas} de={clique + 4} />
      <Etiqueta em={116} x={540} y={1410} tamanho={44} fundo={COR.online} tinta="#0d2a1c" rot={-2}>Léo entrou na sala ✅</Etiqueta>
      <Adesivo em={112} x={880} y={700} tamanho={140} rot={12}>🎉</Adesivo>
      <Cursor caminho={[[56, 800, 1010], [78, 480, 1310]]} cliques={[clique]} escala={1.6} />
      <Confete em={114} x={540} y={1000} n={46} />
      <Clarao em={slam} dur={12} forca={0.95} />
      <Carimbo de={slam} ate={52} />
    </Camera>
  );
}
export const sonsNexo = c => [
  ['audio/sala/mensagem.mp3', 8, 0.6], ['impacto', DROP - c.de, 1], ['brilho', DROP - c.de + 2, 0.45], ['whoosh', 46, 0.4],
  ['pop', 66, 0.35], ['audio/sala/entrada.mp3', 86, 0.9], ['audio/sala/entrada.mp3', 94, 0.8], ['audio/sala/entrada.mp3', 102, 0.8],
  ['audio/sala/entrada.mp3', 112, 1], ['palmas', 114, 0.3], ['brilho', 114, 0.4]
];

// ============================ 3 · TELA COM SOM ============================
function Equalizador({ em, x, y }) {
  const q = useCurrentFrame();
  const p = mola(q, em);
  return (
    <div style={{ position: 'absolute', left: x, top: y, display: 'flex', alignItems: 'center', gap: 16, padding: '14px 28px 14px 22px', borderRadius: 999, background: COR.bg2, boxShadow: `0 0 0 2px ${COR.linha2}, 0 20px 40px rgba(0,0,0,.4)`, fontFamily: FONTE, color: COR.onlineTexto, fontSize: 34, fontWeight: 650, opacity: Math.min(1, p * 2), transform: `scale(${0.8 + p * 0.2})`, transformOrigin: 'left center' }}>
      <Icone nome="som" tamanho={42} />
      áudio da tela
      <span style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 44 }}>{[0, 1, 2, 3, 4, 5].map(k => <i key={k} style={{ display: 'block', width: 9, borderRadius: 5, background: COR.online, height: 10 + (Math.sin(q / 2.6 + k * 1.4) + 1) * 15 }} />)}</span>
    </div>
  );
}

export function Tela({ c }) {
  const V = c.vozEm - c.de;
  return (
    <Camera golpes={[V, V + 26, 68]} forca={0.03} tremer={[[68, 80, 10]]}>
      <Legenda pecas={[
        { t: 'Tela *com som*', em: V, y: 250, tamanho: 118 },
        { t: 'de primeira.', em: V + 26, y: 372, tamanho: 118, fim: 68 },
        { t: '^Milagre.^', em: 68, y: 372, tamanho: 130 }
      ]} />
      <Chegada em={4} y={640}>
        <Palco largura={COLUNA.w} legenda="1440p · 60 fps" espectadores={[{ pessoa: P.ana, em: 22 }, { pessoa: P.bia, em: 30 }, { pessoa: P.rafa, em: 38 }]} />
      </Chegada>
      <Equalizador em={14} x={COLUNA.x} y={1236} />
      <Bolha pessoa={P.rafa} texto="tá ouvindo?" em={36} x={COLUNA.x} y={1352} />
      <Bolha pessoa={P.ana} texto="TÔ!! 🔊" em={50} x={470} y={1442} lado="esq" cor={COR.accentForte} tinta="#fff" />
      <Adesivo em={68} x={830} y={490} tamanho={220} rot={-10}>🙏</Adesivo>
      <Confete em={70} x={620} y={840} n={44} />
    </Camera>
  );
}
export const sonsTela = () => [['audio/sala/tela.mp3', 6, 0.9], ['pop', 22, 0.3], ['pop', 30, 0.3], ['pop', 38, 0.3], ['pop', 36, 0.4], ['pop', 50, 0.4], ['brilho', 68, 0.5], ['palmas', 70, 0.35]];

// ============================ 4 · ASSISTIR SÓ QUEM QUER ============================
function Planilha() {
  const linhas = 12, colunas = 6;
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#f6f8f7', fontFamily: 'Arial, Helvetica, sans-serif', color: '#3b4750' }}>
      <div style={{ height: 46, background: '#1f7a4a', color: '#fff', display: 'flex', alignItems: 'center', padding: '0 18px', fontSize: 22, fontWeight: 700 }}>planilha_final_v9_AGORA_VAI.xlsx</div>
      <div style={{ display: 'grid', gridTemplateColumns: `60px repeat(${colunas}, 1fr)`, fontSize: 20 }}>
        {['', 'A', 'B', 'C', 'D', 'E', 'F'].map((h, i) => <div key={`h${i}`} style={{ padding: '6px 10px', background: '#e6ebe8', borderRight: '1px solid #cfd6d2', borderBottom: '1px solid #cfd6d2', textAlign: 'center', fontWeight: 700 }}>{h}</div>)}
        {Array.from({ length: linhas }, (_, r) => ['#', ...Array.from({ length: colunas }, (_, k) => k)].map((k, i) => (
          <div key={`${r}-${i}`} style={{ padding: '6px 10px', height: 30, borderRight: '1px solid #dfe5e1', borderBottom: '1px solid #dfe5e1', background: i === 0 ? '#e6ebe8' : r === 0 ? '#dff0e6' : '#fff', fontWeight: r === 0 || i === 0 ? 700 : 400, overflow: 'hidden', whiteSpace: 'nowrap' }}>
            {i === 0 ? r + 1 : r === 0 ? ['Item', 'Qtd', 'Valor', 'Total', 'Obs', 'OK?'][k] : Math.round(random(`pl${r}${k}`) * 900 + 40)}
          </div>
        )))}
      </div>
    </div>
  );
}

function Transmissao({ y, quem, titulo, borrado = 0, capa, visto, contagem = 0, avatares = [], conteudo, realce }) {
  const q = useCurrentFrame();
  const e = COLUNA.w / 900;
  return (
    <div style={{ position: 'absolute', left: COLUNA.x, top: y, width: COLUNA.w, height: 400, borderRadius: 32, overflow: 'hidden', background: '#0b0b12', boxShadow: `0 40px 90px rgba(0,0,0,.5), 0 0 0 ${realce ? 5 : 2}px ${realce ?? COR.linha2}`, fontFamily: FONTE }}>
      <div style={{ position: 'absolute', inset: 0, filter: `blur(${borrado * 18}px) brightness(${1 - borrado * 0.5})`, transform: `scale(${1 + borrado * 0.06})` }}>{conteudo}</div>
      {capa}
      <span style={{ position: 'absolute', left: 22, top: 20, display: 'flex', alignItems: 'center', gap: 12, padding: '8px 18px 8px 8px', borderRadius: 999, background: 'rgba(12,12,20,.78)', color: '#fff', fontSize: 28, fontWeight: 650 }}><Avatar pessoa={quem} tamanho={40} />{titulo}</span>
      <span style={{ position: 'absolute', right: 22, top: 20, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px 8px 16px', borderRadius: 999, background: 'rgba(0,0,0,.66)', color: '#fff', fontSize: 30, fontWeight: 750 }}>
        <Icone nome="olho" tamanho={30} />{contagem}
        <span style={{ display: 'flex' }}>{avatares.map(({ pessoa, em }, i) => { const p = mola(q, em, { amortecimento: 10 }); return <Avatar key={pessoa.nome} pessoa={pessoa} tamanho={38} style={{ marginLeft: i ? -10 : 0, boxShadow: '0 0 0 3px #15151f', transform: `scale(${p})` }} />; })}</span>
      </span>
    </div>
  );
}

function CapaLeo({ quem, apertado, some = 0, aoVivo = true }) {
  const q = useCurrentFrame();
  const aperto = apertado !== undefined && q >= apertado && q < apertado + 6 ? 0.92 : 1;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', justifyItems: 'center', gap: 16, opacity: 1 - some, textAlign: 'center', fontFamily: FONTE, background: 'rgba(8,8,16,.18)' }}>
      {aoVivo && <span style={{ padding: '6px 16px', borderRadius: 999, background: COR.rosa, color: '#1d0a12', fontSize: 22, fontWeight: 800, letterSpacing: '0.14em' }}>AO VIVO</span>}
      <strong style={{ color: '#fff', fontSize: 40, fontWeight: 700, textShadow: '0 4px 20px rgba(0,0,0,.6)' }}>{quem} está compartilhando a tela</strong>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14, padding: '18px 44px', borderRadius: 18, background: COR.accentForte, color: '#fff', fontSize: 38, fontWeight: 700, transform: `scale(${aperto})`, boxShadow: `0 18px 40px ${COR.accentForte}66` }}><Icone nome="olho" tamanho={40} />Assistir</span>
    </div>
  );
}

export function Assistir({ c }) {
  const q = useCurrentFrame();
  const V = c.vozEm - c.de;
  const clique = 22;
  const nitido = entre(q, [clique + 2, clique + 12]);
  return (
    <Camera golpes={[V, 59, 108]} forca={0.028}>
      <Legenda troca pecas={[
        { t: 'Só assiste\n*quem quer.*', em: V, y: 250, tamanho: 118 },
        { t: 'Ninguém clicou\nna ^planilha do Léo.^', em: V + trecho('v04', 1), y: 250, tamanho: 104 }
      ]} />
      <Transmissao y={660} quem={P.rafa} titulo="Rafa · jogo" borrado={1 - nitido} contagem={q >= 28 ? (q >= 36 ? 2 : 1) : 0} avatares={[{ pessoa: P.ana, em: 28 }, { pessoa: P.bia, em: 36 }]} conteudo={<Jogo q={q} />} capa={<CapaLeo quem="Rafa" apertado={clique} some={nitido} />} realce={nitido > 0.8 ? COR.online : null} />
      <Transmissao y={1080} quem={P.leo} titulo="Léo · planilha" contagem={0} conteudo={<Planilha />} borrado={0.55} capa={<CapaLeo quem="Léo" />} realce={q > 62 ? COR.aviso : null} />
      <Adesivo em={70} x={880} y={1490} tamanho={140} rot={-8}>🦗</Adesivo>
      <Etiqueta em={80} x={450} y={1540} tamanho={36} rot={-2} z={40}>0 pessoas assistindo · nem o Léo</Etiqueta>
      <Cursor caminho={[[4, 820, 560], [clique - 2, 540, 880]]} cliques={[clique]} escala={1.6} />
    </Camera>
  );
}
export const sonsAssistir = () => [['audio/sala/assistir.mp3', 22, 1], ['pop', 28, 0.3], ['pop', 36, 0.3], ['whoosh', 57, 0.3], ['pop', 70, 0.4], ['audio/reels/plateia.mp3', 110, 0.5]];

// ============================ 5 · CADA UM NO SEU VOLUME ============================
function CartaoVolume({ y, pessoa, descricao, emoji, valor, ativo }) {
  const q = useCurrentFrame();
  const nivel = valor / 100;
  return (
    <div style={{ position: 'absolute', left: COLUNA.x, top: y, width: COLUNA.w, height: 400, padding: 38, borderRadius: 38, background: COR.bg2, fontFamily: FONTE, color: COR.texto, boxShadow: ativo ? `0 0 0 6px ${COR.accentHi}, 0 0 90px ${COR.accent}66, 0 40px 90px rgba(0,0,0,.5)` : `0 0 0 2px ${COR.linha2}, 0 40px 90px rgba(0,0,0,.4)`, transform: `scale(${ativo ? 1 : 0.97})` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
        <Avatar pessoa={pessoa} tamanho={116} anel={`rgba(144,223,179,${0.25 + Math.min(1, nivel) * 0.5})`} />
        <div style={{ flex: 1 }}><div style={{ fontSize: 54, fontWeight: 750 }}>{pessoa.nome} <span style={{ fontSize: 50 }}>{emoji}</span></div><div style={{ fontSize: 32, color: COR.muted }}>{descricao}</div></div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 100 }}>
          {Array.from({ length: 9 }, (_, i) => <i key={i} style={{ display: 'block', width: 13, borderRadius: 7, background: nivel > 1.3 ? COR.accentHi : COR.online, height: `${Math.min(100, (10 + (Math.sin(q / 3.2 + i * 1.6) + 1) * 22) * Math.min(2.1, 0.35 + nivel * 0.75))}%` }} />)}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 46, marginTop: 44 }}>
        <div style={{ position: 'relative', flex: 1, height: 18, borderRadius: 9, background: COR.bg4 }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${valor / 2}%`, borderRadius: 9, background: `linear-gradient(90deg, ${COR.accent}, ${COR.accentHi})` }} />
          <div style={{ position: 'absolute', left: '50%', top: -12, bottom: -12, width: 3, background: COR.bg5 }} />
          <div style={{ position: 'absolute', left: `${valor / 2}%`, top: '50%', width: 50, height: 50, borderRadius: '50%', background: '#fff', transform: 'translate(-50%,-50%)', boxShadow: `0 6px 16px rgba(0,0,0,.4), 0 0 0 7px ${COR.accent}` }} />
        </div>
        <div style={{ minWidth: 230, textAlign: 'right', fontSize: 88, fontWeight: 800, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', color: valor > 100 ? COR.accentTexto : valor < 100 ? COR.avisoTexto : COR.texto }}>{Math.round(valor)}%</div>
      </div>
    </div>
  );
}

export function Volume({ c }) {
  const q = useCurrentFrame();
  const V = c.vozEm - c.de;
  const leo = 100 + 100 * entre(q, [46, 84], [0, 1], t => 1 - (1 - t) * (1 - t));
  const rafa = 100 - 70 * entre(q, [125, 141], [0, 1], t => 1 - (1 - t) * (1 - t));
  const daVez = q < 90 ? 'leo' : 'rafa';
  return (
    <Camera golpes={[V, 46, 91, 127]} forca={0.03} tremer={[[91, 104, 8], [127, 138, 6]]}>
      <Legenda pecas={[
        { t: 'Léo sussurrando?', em: V, y: 235, tamanho: 100, fim: 88 },
        { t: '*Duzentos por cento!*', em: 46, y: 345, tamanho: 86, fim: 88 },
        { t: 'Rafa gritando?', em: 91, y: 235, tamanho: 100 },
        { t: '^Trinta.^', em: 127, y: 345, tamanho: 130 }
      ]} />
      <Chegada em={2} y={560}><CartaoVolume y={0} pessoa={P.leo} descricao="fala baixinho" emoji="🤫" valor={leo} ativo={daVez === 'leo'} /></Chegada>
      <Chegada em={8} y={1010}><CartaoVolume y={0} pessoa={P.rafa} descricao="microfone estourado" emoji="📢" valor={rafa} ativo={daVez === 'rafa'} /></Chegada>
      <Adesivo em={84} fim={120} x={890} y={555} tamanho={110} rot={10}>🔊</Adesivo>
      <Adesivo em={128} x={890} y={985} tamanho={110} rot={-10}>🔇</Adesivo>
    </Camera>
  );
}
export const sonsVolume = () => [['pop', 4, 0.3], ['pop', 10, 0.3], ['whoosh', 46, 0.35], ['brilho', 84, 0.35], ['whoosh', 91, 0.3], ['boing', 127, 0.5]];
