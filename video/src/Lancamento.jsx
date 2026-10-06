// O vídeo de lançamento: o Nexo em meio minuto, para quem nunca ouviu falar dele. Sai em 16:9
// (página inicial, YouTube) e em 9:16 (Reels, Shorts, TikTok), do mesmo código.
//
// A trilha tem 8 s de introdução filtrada e um "drop" no compasso 4. O roteiro segue isso: o
// problema na introdução (o squad espalhado), a marca exatamente no drop, sete recursos, um por
// compasso, e o convite. As frases de efeito são as da página inicial -- o vídeo e o site falam
// com a mesma voz.
import React from 'react';
import { AbsoluteFill, Html5Audio, Sequence, interpolate, random, staticFile, useCurrentFrame } from 'remotion';
import { COR, FONTE, PESSOAS, compasso, entre, mola } from './base/tema';
import { Avatar, Chip, Cursor, Fundo, Icone, Marca, Palavras, Som, useFormato } from './base/componentes';
import { Apoio, Cena, useLarguraDaDemo } from './base/cena';
import { BarraDeControles, CapaAssistir, Grupo, Jogo, LinhaDeVolume, Mesa, MiniSala, Palco, SalaEnchendo } from './base/interface';

export const DURACAO_DO_LANCAMENTO = 1020;
const DROP = compasso(4);

// ---------- 0–8 s: o squad espalhado ----------
function Janela({ titulo, pessoa, children, x, y, rotacao, escala, opacidade }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: 420, transform: `translate(-50%,-50%) rotate(${rotacao}deg) scale(${escala})`, opacity: opacidade, borderRadius: 24, overflow: 'hidden', background: COR.bg1, boxShadow: `0 40px 80px rgba(0,0,0,.5), 0 0 0 1.5px ${COR.linha2}`, fontFamily: FONTE }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', color: COR.texto2, fontSize: 22, fontWeight: 600 }}>
        <Avatar pessoa={pessoa} tamanho={34} />{titulo}
      </div>
      <div style={{ position: 'relative', height: 236, background: '#0b0b12' }}>{children}</div>
    </div>
  );
}

function Filme() {
  const q = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at ${50 + Math.sin(q / 30) * 10}% 45%, #3b5a8a, #0d1422 70%)` }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 26, background: '#000' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 26, background: '#000' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 38, textAlign: 'center', color: '#fff', fontSize: 18, fontFamily: FONTE, textShadow: '0 2px 4px #000' }}>— Você também viu isso?</div>
    </div>
  );
}

function Conversa() {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 10, padding: 18, background: COR.bg2, fontFamily: FONTE, fontSize: 19 }}>
      <span style={{ alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 14, background: COR.bg3, color: COR.texto2 }}>alguém aí? 🥲</span>
      <span style={{ alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 14, background: COR.bg3, color: COR.texto2 }}>tô sozinha aqui</span>
    </div>
  );
}

function Espalhados() {
  const q = useCurrentFrame();
  const { largura, altura, vertical } = useFormato();
  const junta = entre(q, [150, 236], [0, 1], t => t * t * t);
  const janelas = [
    { titulo: 'Ana · no jogo', pessoa: PESSOAS.ana, conteudo: <Jogo q={q} />, em: 4, de: vertical ? [0.3, 0.22] : [0.2, 0.3], rot: -6 },
    { titulo: 'Léo · no filme', pessoa: PESSOAS.leo, conteudo: <Filme />, em: 12, de: vertical ? [0.7, 0.4] : [0.8, 0.28], rot: 5 },
    { titulo: 'Bia · no chat', pessoa: PESSOAS.bia, conteudo: <Conversa />, em: 20, de: vertical ? [0.36, 0.6] : [0.5, 0.74], rot: -3 }
  ];
  const escalaBase = vertical ? 1.1 : 1.15;
  const frases = [
    { texto: 'Seu squad tá espalhado.', destaque: ['espalhado.'], de: 6, ate: 70 },
    { texto: 'Um no jogo. Um no filme.\nUm só querendo conversar.', destaque: ['jogo.', 'filme.', 'conversar.'], de: 72, ate: 150 },
    { texto: 'E se todo mundo\nestivesse no mesmo lugar?', destaque: ['mesmo', 'lugar?'], de: 152, ate: 240 }
  ];
  return (
    <AbsoluteFill>
      {janelas.map((j, i) => {
        const p = mola(q, j.em, { amortecimento: 12 });
        const deriva = Math.sin((q + i * 40) / 40) * 12;
        const x = interpolate(junta, [0, 1], [j.de[0] * largura, largura / 2]) + deriva * (1 - junta);
        const y = interpolate(junta, [0, 1], [j.de[1] * altura, altura / 2]) + deriva * 0.6 * (1 - junta);
        return <Janela key={i} titulo={j.titulo} pessoa={j.pessoa} x={x} y={y} rotacao={j.rot * (1 - junta) + (1 - p) * 10} escala={(0.6 + p * 0.4) * escalaBase * (1 - junta * 0.5)} opacidade={Math.min(1, p * 1.5) * (1 - entre(q, [226, 240]))}>{j.conteudo}</Janela>;
      })}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: vertical ? 'flex-end' : 'center', paddingBottom: vertical ? 300 : 0 }}>
        <div style={{ padding: '26px 44px', borderRadius: 30, background: 'rgba(18,19,28,.72)', backdropFilter: 'blur(12px)', position: 'relative', minHeight: vertical ? 260 : 220, minWidth: vertical ? 960 : 1300, display: 'grid', placeItems: 'center', opacity: 1 - entre(q, [226, 238]) }}>
          {frases.map(f => q >= f.de - 2 && q < f.ate + 2 && (
            <div key={f.de} style={{ position: 'absolute' }}>
              <Palavras texto={f.texto} destaque={f.destaque} inicio={f.de} fim={f.ate} passo={4} tamanho={vertical ? 76 : 80} peso={750} alinhar="center" />
            </div>
          ))}
        </div>
      </AbsoluteFill>
      <Som src="pop" em={4} volume={0.35} /><Som src="pop" em={12} volume={0.35} /><Som src="pop" em={20} volume={0.35} />
      <Som src="whoosh" em={222} volume={0.45} duracao={30} />
    </AbsoluteFill>
  );
}

// ---------- 8–12 s: a marca, no drop ----------
function Explosao() {
  const q = useCurrentFrame();
  const { largura, altura } = useFormato();
  return (
    <AbsoluteFill>
      {Array.from({ length: 28 }, (_, i) => {
        const angulo = random(`a${i}`) * Math.PI * 2;
        const distancia = entre(q, [0, 40], [0, 1]) * (300 + random(`d${i}`) * 700);
        const opacidade = entre(q, [10, 50], [1, 0]);
        return <span key={i} style={{ position: 'absolute', left: largura / 2 + Math.cos(angulo) * distancia, top: altura / 2 + Math.sin(angulo) * distancia, fontSize: 18 + random(`t${i}`) * 30, color: i % 4 ? COR.accentHi : COR.faisca, opacity: opacidade, transform: 'translate(-50%,-50%)' }}>✦</span>;
      })}
    </AbsoluteFill>
  );
}

function Marcante({ duracao }) {
  const q = useCurrentFrame();
  const { vertical } = useFormato();
  const batida = mola(q, 0, { amortecimento: 9, rigidez: 220 });
  const clarao = entre(q, [0, 16], [0.55, 0]);
  const saida = entre(q, [duracao - 12, duracao], [0, 1]);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 50%, ${COR.accentHi}, transparent 60%)`, opacity: clarao }} />
      <Explosao />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 30, opacity: 1 - saida, transform: `scale(${1 + saida * 0.08})` }}>
        <Marca tamanho={vertical ? 220 : 200} faisca={mola(q, 10, { amortecimento: 8 })} style={{ transform: `scale(${2.4 - batida * 1.4})`, opacity: Math.min(1, batida * 2) }} />
        <Palavras texto="NEXO" inicio={6} tamanho={vertical ? 150 : 140} peso={800} espacamento={0.12} alinhar="center" />
        <div style={{ display: 'flex', flexDirection: vertical ? 'column' : 'row', alignItems: 'center', gap: vertical ? 6 : 26 }}>
          <Palavras texto="Seu squad." inicio={28} passo={4} tamanho={vertical ? 72 : 62} peso={650} cor={COR.texto2} alinhar="center" />
          <Palavras texto="Seu espaço." inicio={43} passo={4} tamanho={vertical ? 72 : 62} peso={650} cor={COR.texto2} alinhar="center" />
          <Palavras texto="Seu momento." destaque={['Seu', 'momento.']} inicio={58} passo={4} tamanho={vertical ? 72 : 62} peso={700} alinhar="center" />
        </div>
      </AbsoluteFill>
      <Som src="impacto" em={0} volume={0.9} duracao={60} />
      <Som src="brilho" em={4} volume={0.3} duracao={80} />
    </AbsoluteFill>
  );
}

// ---------- 12–26 s: um recurso por compasso ----------
function Dispositivos({ largura }) {
  const q = useCurrentFrame();
  const e = largura / 900;
  const itens = [['navegador', 'No navegador', 6], ['celular', 'No celular', 14], ['tela', 'No aplicativo', 22]];
  return (
    <div style={{ display: 'flex', gap: 30 * e, alignItems: 'flex-end' }}>
      {itens.map(([icone, nome, em], i) => {
        const p = mola(q, em, { amortecimento: 11 });
        const celular = icone === 'celular';
        return (
          <div key={nome} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 * e, opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 60}px)` }}>
            <div style={{ display: 'grid', placeItems: 'center', width: (celular ? 170 : 300) * e, height: (celular ? 320 : 220) * e, borderRadius: (celular ? 34 : 22) * e, background: COR.bg1, boxShadow: `0 30px 70px rgba(0,0,0,.45), 0 0 0 ${3 * e}px ${COR.bg4}` }}>
              <Marca tamanho={76 * e} />
            </div>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 * e, fontFamily: FONTE, fontSize: 28 * e, fontWeight: 600, color: COR.texto2 }}><Icone nome={icone} tamanho={28 * e} cor={COR.accentTexto} />{nome}</span>
          </div>
        );
      })}
    </div>
  );
}

function Rapida({ titulo, destaque, duracao, children }) {
  return <Cena titulo={titulo} destaque={destaque} duracao={duracao} inicioDaDemo={0} grande>{children}</Cena>;
}

function Montagem() {
  const largura = useLarguraDaDemo();
  const q = useCurrentFrame();
  const D = 60;
  const cartoes = [
    { titulo: 'Voz, câmera\ne tela.', destaque: ['tela.'], demo: () => <BarraDeControles tamanho={largura / 680} ligados={{ mic: 10, camera: 20, tela: 30 }} />, sons: [['audio/sala/mic-ligado.mp3', 10, 1], ['pop', 20, 0.35], ['audio/sala/tela.mp3', 30, 0.9]] },
    { titulo: 'Tela com som,\naté 1440p.', destaque: ['1440p.'], demo: () => (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26 }}>
        <Palco largura={largura * 0.95} legenda="1440p · 60 quadros" espectadores={[{ pessoa: PESSOAS.ana, em: 8 }, { pessoa: PESSOAS.leo, em: 14 }]} />
        <Chip inicio={16}>Até 1440p a 60 quadros, para todo mundo</Chip>
      </div>) },
    { titulo: 'Assista só\no que quiser.', destaque: ['quiser.'], demo: ({ l }) => (
      <Palco largura={largura * 0.95} visto={entre(l, [20, 36])} aoVivo={l >= 36} espectadores={[{ pessoa: PESSOAS.ana, em: 0 }, { pessoa: PESSOAS.voce, em: 30 }]} capa={<CapaAssistir e={largura * 0.95 / 900} apertado={18} some={entre(l, [18, 26])} />} />), sons: [['audio/sala/assistir.mp3', 18, 1]] },
    { titulo: 'Cada um no\nseu volume.', destaque: ['volume.'], demo: ({ l }) => <LinhaDeVolume largura={largura * 0.92} valor={interpolate(entre(l, [8, 38]), [0, 1], [100, 200])} /> },
    { titulo: 'Música, @ e\nmesa de sons.', destaque: ['mesa', 'sons.'], demo: () => <Mesa largura={largura * 0.92} tocados={{ 0: 10, 3: 32 }} />, sons: [['piada', 10, 0.5], ['boing', 32, 0.45]] },
    { titulo: 'Do seu\njeito.', destaque: ['jeito.'], demo: () => <MiniSala largura={largura * 0.95} trocas={[10, 24, 38]} />, sons: [['pop', 10, 0.3], ['pop', 24, 0.3], ['pop', 38, 0.3]] },
    { titulo: 'No navegador,\nno celular e no app.', destaque: ['navegador,', 'celular', 'app.'], demo: () => <Dispositivos largura={largura} />, sons: [['pop', 6, 0.3], ['pop', 14, 0.3], ['pop', 22, 0.3]] }
  ];
  return (
    <>
      {cartoes.map((c, i) => (
        <Sequence key={i} from={i * D} durationInFrames={D} layout="none">
          <Rapida titulo={c.titulo} destaque={c.destaque} duracao={D}>{c.demo({ l: q - i * D })}</Rapida>
          {(c.sons || []).map(([src, em, volume]) => <Som key={`${src}${em}`} src={src} em={em} volume={volume} />)}
          <Som src="whoosh" em={D - 8} volume={0.18} duracao={30} />
        </Sequence>
      ))}
    </>
  );
}

// ---------- 26–31 s: o convite ----------
function Convite({ duracao }) {
  const largura = useLarguraDaDemo();
  return (
    <Cena titulo={'Um link é tudo\nque separa vocês.'} destaque={['link']} duracao={duracao} inicioDaDemo={0}>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 34 }}>
        <Grupo largura={largura * 0.9} mensagens={[{ pessoa: PESSOAS.ana, texto: 'bora hoje?', em: 4 }]} link={{ em: 16, clique: 52 }} />
        <SalaEnchendo entradas={[{ pessoa: PESSOAS.voce, em: 60 }, { pessoa: PESSOAS.ana, em: 72 }, { pessoa: PESSOAS.leo, em: 84 }, { pessoa: PESSOAS.bia, em: 96 }]} />
        <Cursor caminho={[[26, largura * 0.85, 520], [46, largura * 0.6, 300]]} cliques={[52]} />
      </div>
      <Som src="pop" em={4} volume={0.3} /><Som src="pop" em={16} volume={0.35} />
      <Som src="audio/sala/entrada.mp3" em={60} volume={1} /><Som src="audio/sala/entrada.mp3" em={84} volume={0.9} />
      <Som src="whoosh" em={duracao - 8} volume={0.3} duracao={30} />
    </Cena>
  );
}

// ---------- 31–34 s: o cartão final ----------
function Final() {
  const q = useCurrentFrame();
  const { vertical } = useFormato();
  const p = mola(q, 2, { amortecimento: 10 });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 28, padding: vertical ? '0 70px' : 0 }}>
      <Som src="brilho" em={0} volume={0.35} duracao={80} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 34, transform: `scale(${0.8 + p * 0.2})`, opacity: Math.min(1, p * 1.4) }}>
        <Marca tamanho={vertical ? 160 : 190} faisca={mola(q, 12, { amortecimento: 8 })} />
        <span style={{ fontFamily: FONTE, fontSize: vertical ? 140 : 170, fontWeight: 800, letterSpacing: '0.1em', color: COR.texto }}>NEXO</span>
      </div>
      <Palavras texto={vertical ? 'Crie sua sala.\nChame o squad.' : 'Crie sua sala. Chame o squad.'} destaque={['squad.']} inicio={10} passo={3} tamanho={vertical ? 76 : 78} peso={700} alinhar="center" />
      <Apoio inicio={26} tamanho={vertical ? 36 : 36} alinhar="center">Voz, câmera e tela com som · tudo liberado</Apoio>
    </AbsoluteFill>
  );
}

export function Lancamento() {
  const cenas = [
    [0, DROP, Espalhados], [DROP, compasso(6), Marcante], [compasso(6), compasso(13), Montagem],
    [compasso(13), compasso(15) + 30, Convite], [compasso(15) + 30, DURACAO_DO_LANCAMENTO, Final]
  ];
  return (
    <AbsoluteFill style={{ background: COR.bg }}>
      <Fundo />
      {cenas.map(([de, ate, Componente], i) => (
        <Sequence key={i} from={de} durationInFrames={ate - de}>
          <Componente duracao={ate - de} />
        </Sequence>
      ))}
      <Html5Audio src={staticFile('audio/trilha-lancamento.mp3')}
        volume={q => interpolate(q, [0, 4, DURACAO_DO_LANCAMENTO - 20, DURACAO_DO_LANCAMENTO], [0, 0.9, 0.9, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />
    </AbsoluteFill>
  );
}
