// As cenas 6 a 13 do Reels de humor: a mesa de sons e a piada do pato, o bot de música, a placa
// de vídeo, o tema claro, os aparelhos, o grátis, a enquete "qual amigo é você" e a chamada final.
import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import NexoTema from '../../../public/tema.js';
import { COR, FONTE, entre, mola } from '../base/tema';
import { Avatar, Icone, Marca } from '../base/componentes';
import { MiniSala, PADS } from '../base/interface';
import { A, Adesivo, Camera, Clarao, Confete, Etiqueta, L, Legenda, Painel, PESSOAS_REELS as P, COLUNA } from './pecas';
import { Chegada } from './cenas-a';
import { trecho } from './linha';

// ============================ 6 · A MESA DE SONS ============================
function MesaGrande({ y, tocados }) {
  const q = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', left: COLUNA.x, top: y, width: COLUNA.w, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 26, fontFamily: FONTE }}>
      {PADS.map(([emoji, nome], i) => {
        const t = tocados[i];
        const ativo = t !== undefined && q >= t ? Math.max(0, 1 - (q - t) / 26) : 0;
        const entra = mola(q, 6 + i * 3, { amortecimento: 12 });
        return (
          <div key={nome} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, height: 290, borderRadius: 36, background: `linear-gradient(160deg, ${ativo > 0.05 ? COR.accentForte : COR.bg3}, ${ativo > 0.05 ? COR.accent : COR.bg2})`, color: ativo > 0.3 ? '#fff' : COR.texto2, fontSize: 40, fontWeight: 700, opacity: Math.min(1, entra * 2), transform: `scale(${(0.85 + entra * 0.15) * (1 + Math.sin(ativo * Math.PI) * 0.07)})`, boxShadow: ativo ? `0 0 0 ${16 * ativo}px rgba(136,121,246,${0.3 * ativo}), 0 30px 60px rgba(0,0,0,.4)` : `inset 0 0 0 2px ${COR.linha}, 0 30px 60px rgba(0,0,0,.35)` }}>
            <span style={{ fontSize: 118, lineHeight: 1 }}>{emoji}</span>{nome}
          </div>
        );
      })}
    </div>
  );
}

export function MesaDeSons({ c }) {
  const V = c.vozEm - c.de;
  const pergunta = V + trecho('v06', 1);
  const remate = V + trecho('v06', 2);
  const bate = remate + 17;
  return (
    <Camera golpes={[V, pergunta, remate, bate]} forca={0.03} tremer={[[bate, bate + 12, 11]]}>
      <Legenda troca pecas={[
        { t: 'Mesa de\n*sons!*', em: V, y: 250, tamanho: 130 },
        { t: 'O que o pato\ndisse pra pata?', em: pergunta, y: 250, tamanho: 104 },
        { t: '^Vem quá!^', em: remate, y: 270, tamanho: 190 }
      ]} />
      <Adesivo em={pergunta} fim={remate + 60} x={880} y={560} tamanho={170} rot={8}>🦆</Adesivo>
      <MesaGrande y={640} tocados={{ 0: bate, 1: bate + 34, 2: bate + 50, 3: bate + 62 }} />
      <Etiqueta em={bate + 4} x={540} y={1330} tamanho={52} rot={-3} fundo={COR.faisca} tinta="#0f2a06">ba-dum-tss 🥁</Etiqueta>
      <Confete em={bate + 4} x={540} y={900} n={40} />
    </Camera>
  );
}
export const sonsMesa = c => {
  const V = c.vozEm - c.de;
  const bate = V + trecho('v06', 2) + 17;
  return [['pop', V, 0.3], ['pop', V + trecho('v06', 1), 0.3], ['piada', bate, 0.9], ['audio/reels/plateia.mp3', bate + 6, 0.5], ['uhh', bate + 34, 0.5], ['palmas', bate + 50, 0.45], ['boing', bate + 62, 0.5]];
};

// ============================ 7 · O BOT DE MÚSICA ============================
function CartaoMusica({ pedido, envia, toca, fila }) {
  const q = useCurrentFrame();
  const letras = Math.max(0, Math.min(pedido.length, Math.floor((q - 62) / 4)));
  const digitado = q >= 62 ? pedido.slice(0, letras) : '';
  const p = mola(q, 2, { amortecimento: 12 });
  const tocando = mola(q, toca, { amortecimento: 11 });
  return (
    <>
      <div style={{ position: 'absolute', left: COLUNA.x, top: 640, width: COLUNA.w, display: 'flex', alignItems: 'center', gap: 16, padding: '16px 16px 16px 34px', borderRadius: 26, background: COR.cartao, fontFamily: FONTE, opacity: Math.min(1, p * 2), transform: `translateY(${(1 - p) * 60}px)`, boxShadow: `inset 0 0 0 3px ${digitado ? COR.accent : COR.linha2}, 0 30px 60px rgba(0,0,0,.4)` }}>
        <Icone nome="musica" tamanho={44} cor={COR.accentTexto} />
        <span style={{ flex: 1, fontSize: 44, color: digitado ? COR.texto : COR.faint }}>{digitado || 'Nome ou link da música…'}{digitado && q < envia && q % 20 < 12 && <span style={{ display: 'inline-block', width: 4, height: 44, marginLeft: 4, background: COR.accentHi, verticalAlign: 'middle' }} />}</span>
        <span style={{ display: 'grid', placeItems: 'center', width: 84, height: 84, borderRadius: 20, background: COR.accentForte, color: '#fff', transform: `scale(${q >= envia && q < envia + 6 ? 0.88 : 1})` }}><Icone nome="enviar" tamanho={40} /></span>
      </div>
      {q >= toca - 1 && (
        <div style={{ position: 'absolute', left: COLUNA.x, top: 790, width: COLUNA.w, padding: 30, borderRadius: 34, background: COR.bg1, fontFamily: FONTE, color: COR.texto, opacity: Math.min(1, tocando * 2), transform: `translateY(${(1 - tocando) * 50}px) scale(${0.95 + tocando * 0.05})`, boxShadow: `0 40px 90px rgba(0,0,0,.5), 0 0 0 2px ${COR.linha2}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 150, height: 150, borderRadius: 28, background: `linear-gradient(135deg, ${COR.accentForte}, ${COR.rosa})`, color: '#fff', transform: `rotate(${Math.sin((q - toca) / 8) * 4}deg)` }}><Icone nome="musica" tamanho={72} /></span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '0.14em', color: COR.accentTexto }}>TOCANDO AGORA</div>
              <div style={{ fontSize: 68, fontWeight: 800, letterSpacing: '-0.03em' }}>Evidências</div>
              <div style={{ marginTop: 14, height: 12, borderRadius: 6, background: COR.bg4 }}><div style={{ width: `${8 + ((q - toca) * 0.5) % 90}%`, height: '100%', borderRadius: 6, background: COR.accent }} /></div>
            </div>
          </div>
        </div>
      )}
      {fila.map(([quem, em], i) => {
        const pp = q >= em ? mola(q, em, { amortecimento: 11 }) : 0;
        return (
          <div key={quem.nome} style={{ position: 'absolute', left: COLUNA.x, top: 1050 + i * 118, width: COLUNA.w, height: 102, display: 'flex', alignItems: 'center', gap: 20, padding: '0 28px', borderRadius: 24, background: COR.bg2, fontFamily: FONTE, color: COR.texto, opacity: Math.min(1, pp * 2), transform: `translateX(${(1 - pp) * 120}px)`, boxShadow: `0 0 0 2px ${COR.linha}` }}>
            <Icone nome="alca" tamanho={34} cor={COR.faint} traco={3} />
            <Avatar pessoa={quem} tamanho={58} />
            <div style={{ flex: 1 }}><div style={{ fontSize: 40, fontWeight: 650 }}>Evidências</div><div style={{ fontSize: 26, color: COR.muted }}>pedida por {quem.nome}</div></div>
            <span style={{ fontSize: 30, color: COR.faint }}>#{i + 2}</span>
          </div>
        );
      })}
    </>
  );
}

export function Musica({ c }) {
  const V = c.vozEm - c.de;
  const evid = V + trecho('v07', 2);
  return (
    <Camera golpes={[V, V + trecho('v07', 1), evid]} forca={0.03} tremer={[[evid, evid + 10, 8]]}>
      <Legenda troca pecas={[
        { t: 'Bot de\n*música.*', em: V, y: 250, tamanho: 130 },
        { t: 'E sempre\nalguém pede…', em: V + trecho('v07', 1), y: 250, tamanho: 112 },
        { t: '^Evidências.^', em: evid, y: 270, tamanho: 150 }
      ]} />
      <CartaoMusica pedido="evidências" envia={evid - 5} toca={evid} fila={[[P.ana, evid + 8], [P.bia, evid + 16], [P.rafa, evid + 24]]} />
      <Adesivo em={evid + 2} x={870} y={1500} tamanho={150} rot={12}>🎤</Adesivo>
      <Adesivo em={evid + 10} x={130} y={1480} tamanho={90} rot={-14} contorno={false}>🎶</Adesivo>
    </Camera>
  );
}
export const sonsMusica = c => {
  const V = c.vozEm - c.de;
  const evid = V + trecho('v07', 2);
  return [['pop', V, 0.3], ['teclado', V + trecho('v07', 1) + 2, 0.22], ['audio/sala/mensagem.mp3', evid - 5, 0.6], ['brilho', evid, 0.45], ['pop', evid + 8, 0.3], ['pop', evid + 16, 0.3], ['pop', evid + 24, 0.3], ['boing', evid + 26, 0.35]];
};

// ============================ 8 · A PLACA DE VÍDEO ============================
function Medidor({ y, titulo, sub, valor, cor, rosto, em }) {
  const q = useCurrentFrame();
  const p = mola(q, em, { amortecimento: 12 });
  return (
    <div style={{ position: 'absolute', left: COLUNA.x, top: y, width: COLUNA.w, height: 330, padding: 38, borderRadius: 38, background: COR.bg2, fontFamily: FONTE, color: COR.texto, opacity: Math.min(1, p * 2), transform: `translateY(${(1 - p) * 70}px)`, boxShadow: `0 40px 90px rgba(0,0,0,.5), 0 0 0 2px ${COR.linha2}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <span style={{ fontSize: 96, lineHeight: 1 }}>{rosto}</span>
        <div style={{ flex: 1 }}><div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '0.12em', color: COR.muted }}>{titulo}</div><div style={{ fontSize: 34, color: COR.texto2 }}>{sub}</div></div>
        <div style={{ fontSize: 110, fontWeight: 800, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums', color: cor }}>{Math.round(valor)}%</div>
      </div>
      <div style={{ marginTop: 34, height: 30, borderRadius: 15, background: COR.bg4, overflow: 'hidden' }}>
        <div style={{ width: `${valor}%`, height: '100%', borderRadius: 15, background: cor, boxShadow: `0 0 30px ${cor}88` }} />
      </div>
    </div>
  );
}

export function Placa({ c }) {
  const q = useCurrentFrame();
  const V = c.vozEm - c.de;
  const cpu = entre(q, [16, 58], [97, 19]);
  const gpu = entre(q, [8, 50], [5, 72]);
  const suor = q < 34;
  return (
    <Camera golpes={[V, 30, V + trecho('v08', 1)]} forca={0.03} tremer={[[V + trecho('v08', 1), V + trecho('v08', 1) + 10, 7]]}>
      <Legenda troca pecas={[
        { t: 'Quem transmite é a\n*placa de vídeo.*', em: V, y: 250, tamanho: 90 },
        { t: 'O processador\nsó ^joga.^', em: V + trecho('v08', 1), y: 250, tamanho: 118 }
      ]} />
      <Medidor y={640} em={4} titulo="PROCESSADOR" sub={q < V + trecho('v08', 1) ? (suor ? 'fazendo tudo sozinho' : 'respirando') : 'só jogando'} valor={cpu} cor={cpu > 60 ? COR.danger : COR.online} rosto={cpu > 60 ? '🥵' : '😎'} />
      <Medidor y={1000} em={10} titulo="PLACA DE VÍDEO" sub="codificando a tela" valor={gpu} cor={COR.accentHi} rosto="📡" />
      <Etiqueta em={V + trecho('v08', 1) + 8} x={540} y={1440} tamanho={54} rot={-3} fundo={COR.online} tinta="#0d2a1c">🎮 144 FPS · sem engasgo</Etiqueta>
      <Confete em={V + trecho('v08', 1) + 8} x={540} y={1400} n={30} forca={0.8} />
    </Camera>
  );
}
export const sonsPlaca = c => {
  const V = c.vozEm - c.de;
  const t = V + trecho('v08', 1);
  return [['whoosh', 6, 0.35], ['pop', 12, 0.3], ['whoosh', 30, 0.25], ['brilho', 46, 0.35], ['audio/sala/mic-ligado.mp3', t + 6, 0.6], ['palmas', t + 10, 0.3]];
};

// ============================ 9 · TEMA CLARO ============================
const TEMAS_GAG = ['nexo', 'claro'].map(id => {
  const tema = NexoTema.TEMAS.find(t => t.id === id);
  return { id, nome: tema.nome, cores: NexoTema.derivar(NexoTema.resolver({ tema: id })) };
});
const MARCAS_CLARO = { '*': '#5b49e0', '^': '#e0558e' };

export function Tema({ c }) {
  const q = useCurrentFrame();
  const V = c.vozEm - c.de;
  const claro = V + trecho('v09', 1);
  const emocao = V + 106;
  const luz = entre(q, [claro, claro + 3]);
  return (
    <Camera golpes={[V, claro, emocao]} forca={0.03} tremer={[[claro, claro + 26, 17], [emocao, emocao + 12, 9]]}>
      <AbsoluteFill style={{ background: '#eceaf8', opacity: luz }} />
      <Legenda troca pecas={[
        { t: '*Tema escuro*\npra madrugada.', em: V, y: 250, tamanho: 112 },
        { t: 'Tema claro\npra quem gosta\nde ^emoção.^', em: claro, y: 250, tamanho: 108, cor: '#15151f', marcas: MARCAS_CLARO, sombra: '0 4px 0 rgba(255,255,255,.7)' }
      ]} />
      <Chegada em={4} y={720}><MiniSala trocas={[claro]} largura={COLUNA.w} temas={TEMAS_GAG} /></Chegada>
      <Adesivo em={16} fim={claro} x={880} y={640} tamanho={150} rot={12}>🌙</Adesivo>
      <Etiqueta em={30} fim={claro} x={330} y={1480} tamanho={40} rot={-3}>03:47 da manhã ⏰</Etiqueta>
      <Adesivo em={claro + 8} x={830} y={1400} tamanho={200} rot={10}>😵</Adesivo>
      <Etiqueta em={claro + 12} x={380} y={1440} tamanho={54} rot={-4} fundo="#15151f" tinta="#fff">MEUS OLHOS</Etiqueta>
      <Adesivo em={emocao} x={935} y={650} tamanho={150} rot={-12}>🕶️</Adesivo>
      <Clarao em={claro} dur={16} forca={1} />
    </Camera>
  );
}
export const sonsTema = c => {
  const V = c.vozEm - c.de;
  const claro = V + trecho('v09', 1);
  return [['whoosh', 4, 0.3], ['pop', 16, 0.3], ['impacto', claro, 0.7], ['audio/reels/buzina.mp3', claro, 0.45], ['pop', claro + 12, 0.35], ['boing', V + 106, 0.45]];
};

// ============================ 10 · ONDE FUNCIONA ============================
function Aparelho({ tipo, x, y, em, fim = Infinity, rot = 0 }) {
  const q = useCurrentFrame();
  if (q < em - 1 || q >= fim) return null;
  const p = mola(q, em, { amortecimento: 9, rigidez: 210 });
  const saida = entre(q, [fim - 8, fim]);
  const base = { position: 'absolute', left: x, top: y, opacity: Math.min(1, p * 2) * (1 - saida), transform: `scale(${p}) translateY(${saida * 200}px) rotate(${rot}deg)`, background: COR.bg1, boxShadow: `0 40px 90px rgba(0,0,0,.5), 0 0 0 3px ${COR.bg4}`, overflow: 'hidden', fontFamily: FONTE };
  if (tipo === 'navegador') {
    return (
      <div style={{ ...base, width: 560, height: 380, borderRadius: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', background: COR.bg0 }}>
          {['#f07583', '#e8c07a', '#90dfb3'].map(k => <i key={k} style={{ display: 'block', width: 16, height: 16, borderRadius: '50%', background: k }} />)}
          <span style={{ marginLeft: 12, flex: 1, padding: '8px 18px', borderRadius: 999, background: COR.bg3, color: COR.muted, fontSize: 24 }}>nexo…/sala</span>
        </div>
        <div style={{ display: 'grid', placeItems: 'center', height: 300 }}><Marca tamanho={150} /></div>
      </div>
    );
  }
  if (tipo === 'celular') {
    return (
      <div style={{ ...base, width: 230, height: 460, borderRadius: 44 }}>
        <div style={{ width: 90, height: 12, borderRadius: 6, background: COR.bg4, margin: '18px auto 0' }} />
        <div style={{ display: 'grid', placeItems: 'center', height: 400 }}><Marca tamanho={110} /></div>
      </div>
    );
  }
  return (
    <div style={{ ...base, width: 600, height: 330, borderRadius: 26, display: 'grid', gridTemplateColumns: '110px 1fr' }}>
      <div style={{ background: COR.bg0, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>{[1, 2, 3, 4].map(k => <i key={k} style={{ display: 'block', height: 16, borderRadius: 8, background: k === 1 ? COR.accent : COR.bg3 }} />)}</div>
      <div style={{ display: 'grid', placeItems: 'center' }}><Marca tamanho={130} /></div>
    </div>
  );
}

// A bateria desenhada: o emoji de bateria fraca não existe na fonte de emoji do Windows.
function Bateria({ largura = 60, nivel = 0.08, cor = COR.danger }) {
  const h = largura * 0.5;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle' }}>
      <span style={{ display: 'block', width: largura, height: h, borderRadius: h * 0.26, border: `${Math.max(2, h * 0.12)}px solid ${cor}`, boxSizing: 'border-box', padding: h * 0.1 }}>
        <i style={{ display: 'block', width: `${nivel * 100}%`, height: '100%', borderRadius: h * 0.1, background: cor }} />
      </span>
      <i style={{ display: 'block', width: h * 0.16, height: h * 0.42, marginLeft: 2, borderRadius: '0 4px 4px 0', background: cor }} />
    </span>
  );
}

function CelularDoRafa({ em }) {
  const q = useCurrentFrame();
  if (q < em - 1) return null;
  const p = mola(q, em, { amortecimento: 6, rigidez: 150, massa: 0.9 });
  return (
    <div style={{ position: 'absolute', left: 540 - 210, top: 610, width: 420, height: 820, borderRadius: 64, background: '#0b0b12', boxShadow: `0 60px 120px rgba(0,0,0,.6), 0 0 0 10px #2a2b3a, 0 0 0 13px #40415a`, transform: `translateY(${(1 - p) * -900}px) rotate(${4 + (1 - p) * 12}deg)`, overflow: 'hidden', fontFamily: FONTE }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '26px 34px 0', fontSize: 30, fontWeight: 700, color: '#fff' }}><span>23:47</span><span style={{ display: 'flex', alignItems: 'center', gap: 10, color: COR.danger }}><Bateria largura={50} />1%</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: 26, marginTop: 40 }}>
        {[P.ana, P.bia, P.rafa, P.leo].map(pessoa => <div key={pessoa.nome} style={{ display: 'grid', placeItems: 'center', height: 220, borderRadius: 24, background: COR.bg2 }}><Avatar pessoa={pessoa} tamanho={90} anel={COR.online} /></div>)}
      </div>
      <div style={{ textAlign: 'center', fontSize: 34, color: COR.onlineTexto, fontWeight: 650, marginTop: 30 }}>4 na sala · funcionando</div>
      <svg width="420" height="820" viewBox="0 0 420 820" style={{ position: 'absolute', inset: 0 }}>
        {[[[250, 0], [230, 90], [270, 170], [210, 260], [250, 380], [190, 470]], [[230, 90], [140, 130], [70, 100]], [[270, 170], [350, 200], [420, 260]], [[210, 260], [130, 300], [40, 360]], [[250, 380], [330, 420], [420, 400]]].map((linha, i) => (
          <polyline key={i} points={linha.map(pt => pt.join(',')).join(' ')} fill="none" stroke="rgba(255,255,255,.75)" strokeWidth={i ? 3 : 5} strokeLinejoin="round" />
        ))}
      </svg>
    </div>
  );
}

export function Onde({ c }) {
  const V = c.vozEm - c.de;
  const aquele = V + 123;
  const rafa = V + trecho('v10', 1);
  return (
    <Camera golpes={[V + 2, V + 26, V + 42, rafa, aquele]} forca={0.03} tremer={[[aquele, aquele + 14, 12]]}>
      <Legenda pecas={[
        { t: '*Navegador,*', em: V + 2, y: 250, tamanho: 104, fim: rafa - 4 },
        { t: '*celular*', em: V + 26, y: 362, tamanho: 104, fim: rafa - 4 },
        { t: 'e *app.*', em: V + 42, y: 474, tamanho: 104, fim: rafa - 4 },
        { t: 'Até no celular\ndo Rafa.', em: rafa, y: 250, tamanho: 108 },
        { t: '^Aquele.^', em: aquele, y: 490, tamanho: 130 }
      ]} />
      <Aparelho tipo="navegador" x={60} y={640} em={V + 4} fim={rafa} rot={-2} />
      <Aparelho tipo="celular" x={710} y={620} em={V + 28} fim={rafa} rot={3} />
      <Aparelho tipo="app" x={150} y={1090} em={V + 44} fim={rafa} rot={-1} />
      <CelularDoRafa em={rafa + 4} />
      <Adesivo em={rafa + 20} x={190} y={720} tamanho={120} rot={-14}><Bateria largura={190} nivel={0.07} /></Adesivo>
      <Etiqueta em={rafa + 30} x={540} y={1490} tamanho={38} rot={-2}>celular de 2016 · 1% de bateria</Etiqueta>
      <Adesivo em={aquele + 2} x={880} y={1040} tamanho={160} rot={12}>💀</Adesivo>
    </Camera>
  );
}
export const sonsOnde = c => {
  const V = c.vozEm - c.de;
  const rafa = V + trecho('v10', 1);
  return [['pop', V + 4, 0.35], ['pop', V + 28, 0.35], ['pop', V + 44, 0.35], ['whoosh', rafa - 4, 0.4], ['impacto', rafa + 6, 0.5], ['audio/sala/entrada.mp3', rafa + 26, 0.8], ['boing', V + 123, 0.5]];
};

// ============================ 11 · GRÁTIS ============================
export function Gratis({ c }) {
  const q = useCurrentFrame();
  const V = c.vozEm - c.de;
  const email = V + trecho('v11', 1);
  const codigo = V + trecho('v11', 2);
  const carimbo = mola(q, email + 8, { amortecimento: 8, rigidez: 240 });
  const p = mola(q, 6, { amortecimento: 8, rigidez: 190 });
  const miudas = entre(q, [codigo + 28, codigo + 36]);
  const letras = Math.max(0, Math.min(14, Math.floor((q - codigo - 6) / 2)));
  return (
    <Camera golpes={[V, email, codigo]} forca={0.03} tremer={[[email + 8, email + 18, 12]]}>
      <Legenda troca pecas={[
        { t: '*Grátis*\npra começar.', em: V, y: 250, tamanho: 124 },
        { t: 'Sem\n*e-mail.*', em: email, y: 250, tamanho: 140 },
        { t: 'Só não perde\no ^código^, tá?', em: codigo, y: 250, tamanho: 108 }
      ]} />
      {q < email && (
        <div style={{ position: 'absolute', left: 540 - 340, top: 760, width: 680, height: 380, borderRadius: 44, background: '#fff', color: '#15151f', fontFamily: FONTE, display: 'grid', placeItems: 'center', transform: `rotate(${-6 + (1 - p) * 20}deg) scale(${p})`, boxShadow: '0 40px 90px rgba(0,0,0,.5)' }}>
          <i style={{ position: 'absolute', left: 36, top: 36, width: 34, height: 34, borderRadius: '50%', background: '#15151f22' }} />
          <div style={{ textAlign: 'center' }}><div style={{ fontSize: 230, fontWeight: 850, letterSpacing: '-0.06em', lineHeight: 1 }}>R$ 0</div><div style={{ fontSize: 46, fontWeight: 650, color: '#6b6a80' }}>pra começar</div></div>
        </div>
      )}
      <Adesivo em={V + 12} fim={email} x={830} y={760} tamanho={150} rot={14} contorno={false}><span style={{ display: 'inline-block', padding: '12px 30px', border: '10px solid #e5384f', borderRadius: 18, color: '#e5384f', fontFamily: FONTE, fontWeight: 850, fontSize: 84, letterSpacing: '0.06em' }}>GRÁTIS</span></Adesivo>
      <Confete em={V + 8} x={540} y={900} n={48} />
      {q >= email - 1 && q < codigo && (
        <>
          <Adesivo em={email + 2} fim={codigo - 2} x={540} y={1000} tamanho={360} rot={-6}>📧</Adesivo>
          <div style={{ position: 'absolute', left: 540, top: 1000, width: 470, height: 470, marginLeft: -235, marginTop: -235, borderRadius: '50%', border: '38px solid #e5384f', opacity: Math.min(1, carimbo * 2), transform: `scale(${2 - carimbo})`, zIndex: 40 }}>
            <i style={{ position: 'absolute', left: -20, right: -20, top: '50%', height: 38, marginTop: -19, background: '#e5384f', transform: 'rotate(-45deg)' }} />
          </div>
        </>
      )}
      {q >= codigo - 1 && (
        <>
          <Painel y={700} h={430} em={codigo}>
            <div style={{ padding: '36px 40px' }}>
              <div style={{ fontSize: 34, fontWeight: 700, color: COR.muted, letterSpacing: '0.08em' }}>CÓDIGO DE RECUPERAÇÃO</div>
              <div style={{ marginTop: 34, padding: '30px 36px', borderRadius: 24, background: COR.bg0, fontFamily: 'Consolas, "Courier New", monospace', fontSize: 66, fontWeight: 700, letterSpacing: '0.08em', color: COR.avisoTexto, boxShadow: `inset 0 0 0 3px ${COR.linha2}` }}>{'K7M2-Q9XA-4TFN'.slice(0, letras)}<span style={{ opacity: q % 16 < 9 ? 1 : 0 }}>▌</span></div>
              <div style={{ marginTop: 30, fontSize: 32, color: COR.muted }}>aparece uma vez só, no cadastro</div>
            </div>
          </Painel>
          <Etiqueta em={codigo + 22} x={760} y={690} tamanho={44} rot={6} fundo="#ffd86b" tinta="#3a2b00">anota aí! 📝</Etiqueta>
          <div style={{ position: 'absolute', left: COLUNA.x, top: 1210, width: COLUNA.w, fontFamily: FONTE, fontSize: 30, lineHeight: 1.4, color: COR.faint, opacity: miudas, transform: `translateY(${(1 - miudas) * 14}px)` }}>*perdeu a senha e o código? perdeu a conta.</div>
        </>
      )}
    </Camera>
  );
}
export const sonsGratis = c => {
  const V = c.vozEm - c.de;
  const email = V + trecho('v11', 1);
  const codigo = V + trecho('v11', 2);
  return [['brilho', V + 6, 0.5], ['pop', V + 12, 0.4], ['palmas', V + 10, 0.3], ['whoosh', email - 2, 0.3], ['impacto', email + 8, 0.55], ['pop', codigo, 0.3], ['teclado', codigo + 6, 0.25], ['pop', codigo + 22, 0.4], ['audio/sala/mensagem.mp3', codigo + 30, 0.5]];
};

// ============================ 12 · QUAL AMIGO É VOCÊ ============================
function CartaoQuiz({ y, letra, cor, pessoa, titulo, sub, em, resultado, pct, vencedor }) {
  const q = useCurrentFrame();
  if (q < em - 1) return null;
  const p = mola(q, em, { amortecimento: 9, rigidez: 220 });
  const barra = entre(q, [resultado, resultado + 26], [0, pct], x => 1 - (1 - x) ** 3);
  return (
    <div style={{ position: 'absolute', left: COLUNA.x, top: y, width: COLUNA.w, height: 206, borderRadius: 36, overflow: 'hidden', background: COR.bg2, fontFamily: FONTE, color: COR.texto, opacity: Math.min(1, p * 2), transform: `translateX(${(1 - p) * 160}px) scale(${vencedor && q > resultado + 24 ? 1.03 : 1})`, boxShadow: vencedor && q > resultado + 24 ? `0 0 0 6px ${COR.faisca}, 0 30px 70px rgba(0,0,0,.5)` : `0 0 0 2px ${COR.linha2}, 0 30px 70px rgba(0,0,0,.4)` }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${barra}%`, background: `${cor}44` }} />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 26, height: '100%', padding: '0 30px' }}>
        <span style={{ display: 'grid', placeItems: 'center', width: 110, height: 110, borderRadius: 30, background: cor, color: '#14121f', fontSize: 74, fontWeight: 850 }}>{letra}</span>
        <Avatar pessoa={pessoa} tamanho={92} />
        <div style={{ flex: 1 }}><div style={{ fontSize: 48, fontWeight: 750 }}>{titulo}</div><div style={{ fontSize: 30, color: COR.muted, lineHeight: 1.2 }}>{sub}</div></div>
        {q >= resultado && <span style={{ fontSize: 64, fontWeight: 850, fontVariantNumeric: 'tabular-nums', color: vencedor ? COR.faisca : COR.texto2 }}>{Math.round(barra)}%</span>}
      </div>
    </div>
  );
}

export function Quiz({ c }) {
  const V = c.vozEm - c.de;
  const a = V + 72, b = V + 84, cc = V + 96;
  const comenta = V + trecho('v12', 1) + 44;
  return (
    <Camera golpes={[V, V + 33, a, b, cc, comenta]} forca={0.028} tremer={[[comenta, comenta + 10, 7]]}>
      <Legenda pecas={[
        { t: 'Agora responde:', em: V, y: 250, tamanho: 62, cor: COR.texto2, peso: 700 },
        { t: 'Qual amigo\né *você?*', em: V + 33, y: 322, tamanho: 128 }
      ]} />
      <CartaoQuiz y={640} letra="A" cor={COR.aviso} pessoa={P.ana} titulo="Ana" sub="organiza tudo, ninguém agradece" em={a} resultado={comenta} pct={18} />
      <CartaoQuiz y={870} letra="B" cor={COR.accentHi} pessoa={P.leo} titulo="Léo" sub="“já tô entrando” (há 47 min)" em={b} resultado={comenta} pct={64} vencedor />
      <CartaoQuiz y={1100} letra="C" cor={COR.online} pessoa={P.rafa} titulo="Rafa" sub="microfone estourado, coração de ouro" em={cc} resultado={comenta} pct={18} />
      <Etiqueta em={comenta + 6} x={540} y={1410} tamanho={46} rot={-2} fundo={COR.faisca} tinta="#0f2a06">comenta a letra 👇</Etiqueta>
      <Etiqueta em={comenta + 34} x={540} y={1500} tamanho={30} rot={1} fundo="rgba(255,255,255,.14)" tinta={COR.texto2}>pesquisa 100% científica · n = 3 amigos</Etiqueta>
      <Confete em={comenta + 26} x={540} y={1000} n={36} />
    </Camera>
  );
}
export const sonsQuiz = c => {
  const V = c.vozEm - c.de;
  const comenta = V + trecho('v12', 1) + 44;
  return [['pop', V, 0.3], ['pop', V + 33, 0.3], ['pop', V + 72, 0.4], ['pop', V + 84, 0.4], ['pop', V + 96, 0.4], ['brilho', comenta, 0.45], ['palmas', comenta + 24, 0.4], ['audio/reels/plateia.mp3', comenta + 28, 0.35]];
};

// ============================ 13 · A CHAMADA FINAL ============================
export function Fim({ c }) {
  const q = useCurrentFrame();
  const V = c.vozEm - c.de;
  const bate = mola(q, V + 2, { amortecimento: 8, rigidez: 240, massa: 0.8 });
  const marca = V + 83;
  const digitando = V + 117;
  const p = mola(q, digitando, { amortecimento: 11 });
  return (
    <Camera golpes={[V + 2, V + 15, V + 32, V + 56, marca, digitando]} forca={0.03} tremer={[[V + 2, V + 12, 12]]}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 34 }}>
        <Marca tamanho={190} faisca={mola(q, V + 10, { amortecimento: 8 })} style={{ transform: `scale(${2.4 - bate * 1.4})`, opacity: Math.min(1, bate * 2.4) }} />
        <span style={{ fontFamily: FONTE, fontSize: 170, fontWeight: 800, letterSpacing: '0.12em', color: '#fff', textShadow: '0 8px 0 rgba(0,0,0,.3)', opacity: Math.min(1, bate * 2), transform: `scale(${0.7 + bate * 0.3})` }}>NEXO</span>
      </div>
      <Legenda pecas={[
        { t: 'Seu *squad.*', em: V + 15, y: 560, tamanho: 118, alinhar: 'center' },
        { t: 'Seu *espaço.*', em: V + 32, y: 690, tamanho: 118, alinhar: 'center' },
        { t: 'Seu *momento.*', em: V + 56, y: 820, tamanho: 118, alinhar: 'center' },
        { t: 'Marca o ^Léo^ 👇', em: marca, y: 985, tamanho: 118, alinhar: 'center', rot: -2 }
      ]} />
      <Adesivo em={marca + 4} x={840} y={1200} tamanho={120} rot={10}><Avatar pessoa={P.leo} tamanho={150} /></Adesivo>
      <Etiqueta em={marca + 6} x={330} y={1230} tamanho={54} rot={-4} fundo={COR.accentForte} tinta="#fff">@Léo</Etiqueta>
      <div style={{ position: 'absolute', left: 130, top: 1330, display: 'flex', alignItems: 'center', gap: 22, padding: '20px 34px', borderRadius: 999, background: COR.bg2, fontFamily: FONTE, color: COR.texto2, fontSize: 38, fontWeight: 600, opacity: Math.min(1, p * 2), transform: `translateY(${(1 - p) * 60}px)`, boxShadow: `0 0 0 2px ${COR.linha2}, 0 30px 60px rgba(0,0,0,.4)` }}>
        <Avatar pessoa={P.leo} tamanho={64} />
        <span>Léo está digitando</span>
        <span style={{ display: 'inline-flex', gap: 9 }}>{[0, 1, 2].map(i => <i key={i} style={{ display: 'block', width: 14, height: 14, borderRadius: '50%', background: COR.muted, transform: `translateY(${-Math.abs(Math.sin((q + i * 4) / 5)) * 10}px)` }} />)}</span>
      </div>
      <Etiqueta em={V + 150} x={540} y={1470} tamanho={48} rot={-2} fundo="#fff" tinta="#15151f">link na bio 🔗</Etiqueta>
      <Confete em={V + 4} x={540} y={420} n={40} />
    </Camera>
  );
}
export const sonsFim = c => {
  const V = c.vozEm - c.de;
  return [['impacto', V + 2, 0.75], ['brilho', V + 4, 0.45], ['pop', V + 15, 0.4], ['pop', V + 32, 0.4], ['pop', V + 56, 0.4], ['audio/sala/mencao.mp3', V + 83, 0.8], ['teclado', V + 118, 0.22], ['pop', V + 150, 0.4], ['audio/sala/mensagem.mp3', V + 168, 0.5]];
};
