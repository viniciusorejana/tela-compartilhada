// A apresentação: o Nexo em um minuto, dentro do modal de boas-vindas (public/novidades.js).
//
// Nove cenas, cada uma começando num compasso da trilha (a cada 2 s). A trilha tem 16 s de
// introdução mais leve e entra cheia no compasso 8 -- é ali que a tela é compartilhada, o
// momento que o Nexo existe para resolver.
//
// O que se vê ao lado de cada título é o Nexo de verdade: gravações do aplicativo (base/gravacao.jsx), e não mais a
// sala redesenhada. Os avisos sincronizados com os desenhos saíram junto com eles; ficaram a trilha e as passagens.
import React from 'react';
import { AbsoluteFill, Html5Audio, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { COR, FPS, compasso, entre, mola } from './base/tema';
import { Chip, Fundo, Marca, Palavras, Som } from './base/componentes';
import { Apoio, Cena, useLarguraDaDemo } from './base/cena';
import { GRAVACOES, Janela, ajustar, emSequencia } from './base/gravacao';

export const DURACAO_DA_APRESENTACAO = 1800;

// Onde cada cena começa, em compassos. A última vai até o fim do vídeo.
const CENAS = [
  ['abertura', 0], ['link', 2], ['controles', 5], ['tela', 8], ['assistir', 11],
  ['volume', 14], ['chat', 17], ['musica', 21], ['fim', 25]
];

// O "vuush" entre cenas: começa 8 quadros antes do corte, e o pico dele (0,13 s) cai no corte.
const Vuush = ({ duracao }) => <Som src="whoosh" em={duracao - 8} volume={0.28} duracao={30} />;

function Abertura({ duracao }) {
  const q = useCurrentFrame();
  const p = mola(q, 8, { amortecimento: 11 });
  const faisca = mola(q, 22, { amortecimento: 8 });
  const saida = entre(q, [duracao - 14, duracao], [0, 1]);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 34, opacity: 1 - saida, transform: `scale(${1 + saida * 0.06})` }}>
      <Som src="brilho" em={0} volume={0.45} duracao={80} />
      <Marca tamanho={190} faisca={faisca} style={{ transform: `scale(${p}) rotate(${(1 - p) * -14}deg)` }} />
      <Palavras texto="NEXO" inicio={26} tamanho={120} peso={800} espacamento={0.12} alinhar="center" />
      <Palavras texto="Seu squad, mais perto." destaque={['perto.']} inicio={44} passo={4} tamanho={54} peso={600} cor={COR.texto2} alinhar="center" />
      <Vuush duracao={duracao} />
    </AbsoluteFill>
  );
}

// Uma cena com a gravação ao lado do texto. `gravacao` é do catálogo (ou duas em sequência); ela é esticada ou
// encolhida para caber na cena, e os chips descem embaixo dela.
function CenaGravada({ duracao, gravacao, chips = [], ...cena }) {
  const largura = useLarguraDaDemo();
  const ajustada = ajustar(gravacao, duracao / FPS);
  return (
    <Cena duracao={duracao} {...cena}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26 }}>
        <Janela gravacao={ajustada} largura={largura} />
        {chips.length > 0 && (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
            {chips.map((texto, i) => <Chip key={texto} inicio={Math.round(duracao * 0.45) + i * 12}>{texto}</Chip>)}
          </div>
        )}
      </div>
      <Vuush duracao={duracao} />
    </Cena>
  );
}

const Link = ({ duracao }) => (
  <CenaGravada duracao={duracao} gravacao={emSequencia(GRAVACOES.abrir, GRAVACOES.convite)}
    rotulo="01 · Entrar" titulo={'Uma sala\né um link.'} destaque={['link.']}
    apoio="Mande no grupo, ou chame um amigo pelo Nexo. Quem clica entra pelo navegador — sem instalar nada." />
);

const Controles = ({ duracao }) => (
  <CenaGravada duracao={duracao} gravacao={GRAVACOES.cameras} chips={['Ctrl + Shift + M liga o microfone']}
    rotulo="02 · Sua vez" titulo={'Tudo começa\ndesligado.'} destaque={['desligado.']}
    apoio="Microfone e câmera só ligam quando você quiser. E quem fala acende na sala." />
);

const Tela = ({ duracao }) => (
  <CenaGravada duracao={duracao} gravacao={GRAVACOES.transmitir} chips={['Até 1440p a 60 quadros', 'Com o som junto']}
    rotulo="03 · Tela" titulo={'Sua tela vira\no encontro.'} destaque={['encontro.']}
    apoio="A partida, o filme ou a ideia: uma aba, uma janela ou a tela inteira — com o som junto." />
);

const Assistir = ({ duracao }) => (
  <CenaGravada duracao={duracao} gravacao={GRAVACOES.assistir} chips={['O olho no canto mostra quem está vendo']}
    rotulo="04 · Assistir" titulo={'Assista só\no que quiser.'} destaque={['quiser.']}
    apoio="A imagem só chega para quem clica. Quem só quer conversar não gasta a internet com a tela dos outros." />
);

const Volume = ({ duracao }) => (
  <CenaGravada duracao={duracao} gravacao={GRAVACOES.volume} chips={['Ninguém fica sabendo']}
    rotulo="05 · Volume" titulo={'Cada um no\nseu volume.'} destaque={['volume.']}
    apoio="Até 200%, e só você ouve a diferença. Voz e tela têm volumes separados, e o Nexo lembra na próxima vez." />
);

const ChatEMesa = ({ duracao }) => (
  <CenaGravada duracao={duracao} gravacao={emSequencia(GRAVACOES.chat, GRAVACOES.mesa)}
    rotulo="06 · Chat e sons" titulo={'@ chama.\nA mesa responde.'} destaque={['@', 'mesa']}
    apoio="Imagens, respostas, reações com qualquer emoji e @ para chamar alguém. E uma mesa de sons que a sala inteira ouve." />
);

function MusicaETemas({ duracao }) {
  const metade = duracao / 2;
  return (
    <>
      <Sequence durationInFrames={metade} layout="none">
        <CenaGravada duracao={metade} gravacao={GRAVACOES.musica}
          rotulo="07 · Música" titulo={'Música para\na sala toda.'} destaque={['toda.']}
          apoio="Peça pelo nome ou pelo link, e o bot toca para todo mundo. A fila se arrasta para mudar a ordem." />
      </Sequence>
      <Sequence from={metade} durationInFrames={metade} layout="none">
        <CenaGravada duracao={metade} gravacao={GRAVACOES.temas}
          rotulo="08 · Do seu jeito" titulo={'Do seu\njeito.'} destaque={['jeito.']}
          apoio="Escuro, claro ou o do sistema, oito temas prontos e a sua cor. E um cartão de perfil todo seu." />
      </Sequence>
    </>
  );
}

function Fim({ duracao }) {
  const q = useCurrentFrame();
  const p = mola(q, 8, { amortecimento: 10 });
  const saida = entre(q, [duracao - 24, duracao], [0, 1]);
  const recursos = ['Voz', 'Câmera', 'Tela com som', 'Chat', 'Música', 'Mesa de sons'];
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 34, opacity: 1 - saida }}>
      <Som src="brilho" em={2} volume={0.4} duracao={80} />
      <Marca tamanho={150} faisca={mola(q, 20, { amortecimento: 8 })} style={{ transform: `scale(${p})` }} />
      <Palavras texto="Bora para a sala?" destaque={['sala?']} inicio={24} passo={4} tamanho={104} peso={750} alinhar="center" />
      <Apoio inicio={56} tamanho={36} alinhar="center" style={{ maxWidth: 1100 }}>Logo abaixo, cada parte com calma — e dá para experimentar tudo ali mesmo.</Apoio>
      <div style={{ display: 'flex', gap: 14, marginTop: 12 }}>
        {recursos.map((r, i) => <Chip key={r} inicio={84 + i * 5} tamanho={24}>{r}</Chip>)}
      </div>
    </AbsoluteFill>
  );
}

const COMPONENTES = { abertura: Abertura, link: Link, controles: Controles, tela: Tela, assistir: Assistir, volume: Volume, chat: ChatEMesa, musica: MusicaETemas, fim: Fim };

export function Apresentacao() {
  return (
    <AbsoluteFill style={{ background: COR.bg }}>
      <Fundo />
      {CENAS.map(([nome, inicio], i) => {
        const de = compasso(inicio);
        const ate = i + 1 < CENAS.length ? compasso(CENAS[i + 1][1]) : DURACAO_DA_APRESENTACAO;
        const Componente = COMPONENTES[nome];
        return (
          <Sequence key={nome} from={de} durationInFrames={ate - de} name={nome}>
            <Componente duracao={ate - de} />
          </Sequence>
        );
      })}
      <Html5Audio src={staticFile('audio/trilha-apresentacao.mp3')}
        volume={q => interpolate(q, [0, 8, DURACAO_DA_APRESENTACAO - 50, DURACAO_DA_APRESENTACAO], [0, 0.85, 0.85, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />
    </AbsoluteFill>
  );
}
