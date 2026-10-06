// A apresentação: o Nexo em um minuto, dentro do modal de boas-vindas (public/novidades.js).
//
// Nove cenas, cada uma começando num compasso da trilha (a cada 2 s). A trilha tem 16 s de
// introdução mais leve e entra cheia no compasso 8 -- é ali que a tela é compartilhada, o
// momento que o Nexo existe para resolver. Os avisos que tocam nas cenas são os da sala de
// verdade (public/sons), para quem assistir reconhecê-los depois.
import React from 'react';
import { AbsoluteFill, Html5Audio, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { COR, PESSOAS, compasso, entre, mola } from './base/tema';
import { Chip, Cursor, Fundo, Marca, Palavras, Som } from './base/componentes';
import { Apoio, Cena } from './base/cena';
import { BarraDeControles, CapaAssistir, Chat, Fila, Grupo, LinhaDeVolume, Mesa, MiniSala, Palco, SalaEnchendo } from './base/interface';

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

function Link({ duracao }) {
  return (
    <Cena rotulo="01 · Entrar" titulo={'Uma sala\né um link.'} destaque={['link.']} apoio="Mande no grupo. Quem clica entra pelo navegador — sem instalar nada, sem cadastro para entrar." duracao={duracao}>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 34 }}>
        <Grupo largura={920} mensagens={[{ pessoa: PESSOAS.ana, texto: 'bora jogar hoje?', em: 14 }, { pessoa: PESSOAS.leo, texto: 'bora! quem abre a sala?', em: 34 }]} link={{ em: 70, clique: 110 }} />
        <SalaEnchendo tamanho={1.15} entradas={[{ pessoa: PESSOAS.voce, em: 118 }, { pessoa: PESSOAS.ana, em: 132 }, { pessoa: PESSOAS.leo, em: 144 }, { pessoa: PESSOAS.rafa, em: 156 }]} />
        <Cursor caminho={[[84, 880, 720], [104, 645, 485]]} cliques={[110]} />
      </div>
      <Som src="pop" em={14} volume={0.35} /><Som src="pop" em={34} volume={0.35} />
      <Som src="teclado" em={50} volume={0.4} /><Som src="pop" em={70} volume={0.4} />
      <Som src="audio/sala/entrada.mp3" em={118} volume={1} /><Som src="audio/sala/entrada.mp3" em={144} volume={0.9} />
      <Vuush duracao={duracao} />
    </Cena>
  );
}

function Controles({ duracao }) {
  // Botões de 1,45×: centro do i-ésimo em x = 130,5 + 234,9·i, y = 113 (ver BarraDeControles).
  return (
    <Cena rotulo="02 · Sua vez" titulo={'Tudo começa\ndesligado.'} destaque={['desligado.']} apoio="Microfone e câmera só ligam quando você quiser. Tudo fica na barra de baixo da sala." duracao={duracao}>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 40 }}>
        <BarraDeControles tamanho={1.45} ligados={{ mic: 66, camera: 98 }} />
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Chip inicio={112}>Ctrl + Shift + M liga o microfone</Chip>
          <Chip inicio={126}>ou segure Espaço para falar</Chip>
        </div>
        <Cursor caminho={[[40, 900, 360], [60, 134, 116], [72, 134, 116], [92, 602, 116]]} cliques={[66, 98]} />
      </div>
      <Som src="audio/sala/mic-ligado.mp3" em={66} volume={1} /><Som src="pop" em={98} volume={0.4} />
      <Vuush duracao={duracao} />
    </Cena>
  );
}

function Tela({ duracao }) {
  const q = useCurrentFrame();
  const aparece = mola(q, 22, { amortecimento: 14 });
  const botao = entre(q, [22, 32], [1, 0]);
  return (
    <Cena rotulo="03 · Tela" titulo={'Sua tela vira\no encontro.'} destaque={['encontro.']} apoio="A partida, o filme ou a ideia: uma aba, uma janela ou a tela inteira — com o som junto." duracao={duracao} inicioDaDemo={0}>
      <div style={{ position: 'relative', width: 1000, height: 760 }}>
        <div style={{ position: 'absolute', left: 500 - 117, top: 320 - 101, opacity: botao, transform: `scale(${0.6 + botao * 0.4})` }}>
          <BarraDeControles botoes={['tela']} tamanho={1.3} ligados={{ tela: 18 }} />
        </div>
        <div style={{ position: 'absolute', left: 20, top: 20, opacity: Math.min(1, aparece * 1.3), transform: `scale(${0.45 + aparece * 0.55})` }}>
          <Palco largura={960} legenda="Você está compartilhando" espectadores={[{ pessoa: PESSOAS.ana, em: 60 }, { pessoa: PESSOAS.leo, em: 72 }, { pessoa: PESSOAS.rafa, em: 84 }]} />
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 660, display: 'flex', gap: 16, justifyContent: 'center' }}>
          <Chip inicio={96}>Até 1440p a 60 quadros</Chip>
          <Chip inicio={110}>Para todo mundo, sem limite</Chip>
        </div>
        <Cursor caminho={[[0, 820, 600], [14, 505, 325]]} cliques={[18]} />
      </div>
      <Som src="audio/sala/tela.mp3" em={18} volume={1} />
      <Som src="pop" em={60} volume={0.25} /><Som src="pop" em={72} volume={0.25} /><Som src="pop" em={84} volume={0.25} />
      <Vuush duracao={duracao} />
    </Cena>
  );
}

function Assistir({ duracao }) {
  const q = useCurrentFrame();
  const e = 960 / 900;
  return (
    <Cena rotulo="04 · Assistir" titulo={'Assista só\no que quiser.'} destaque={['quiser.']} apoio="A imagem só chega para quem clica. Quem só quer conversar não gasta a internet com a tela dos outros." duracao={duracao}>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 36 }}>
        <Palco largura={960} visto={entre(q, [56, 80])} aoVivo={q >= 80} legenda={q >= 80 ? 'Tela de Rafa' : undefined}
          espectadores={[{ pessoa: PESSOAS.ana, em: 0 }, { pessoa: PESSOAS.leo, em: 0 }, { pessoa: PESSOAS.voce, em: 70 }]}
          capa={<CapaAssistir e={e} apertado={54} some={entre(q, [54, 64])} />} barra={entre(q, [96, 110])} />
        <Chip inicio={112}>O olho no canto mostra quem está vendo</Chip>
        <Cursor caminho={[[20, 860, 520], [46, 485, 360]]} cliques={[54]} />
      </div>
      <Som src="audio/sala/assistir.mp3" em={54} volume={1} /><Som src="pop" em={70} volume={0.35} />
      <Vuush duracao={duracao} />
    </Cena>
  );
}

function Volume({ duracao }) {
  const q = useCurrentFrame();
  const valor = interpolate(entre(q, [44, 100]), [0, 1], [100, 200]);
  // Com 980 px: trilho de 688 px a partir de x = 41; a bolinha fica em y = 189 (ver LinhaDeVolume).
  return (
    <Cena rotulo="05 · Volume" titulo={'Cada um no\nseu volume.'} destaque={['volume.']} apoio="Até 200%, e só você ouve a diferença. Voz e tela têm volumes separados, e o Nexo lembra na próxima vez." duracao={duracao}>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 36 }}>
        <LinhaDeVolume largura={980} valor={valor} />
        <Chip inicio={110}>Ninguém fica sabendo</Chip>
        <Cursor caminho={[[24, 860, 380], [40, 387, 192], [44, 387, 192], [100, 731, 192]]} cliques={[42]} />
      </div>
      <Vuush duracao={duracao} />
    </Cena>
  );
}

function ChatEMesa({ duracao }) {
  const q = useCurrentFrame();
  // Mesa de 900 px: colunas de (900 − 3·17,6) / 4 = 211,8 px; centro do i-ésimo em
  // x = 105,9 + 229,4·i, y = 93 (ver Mesa).
  return (
    <Cena rotulo="06 · Chat e sons" titulo={'@ chama.\nA mesa responde.'} destaque={['@', 'mesa']} apoio="Imagens, respostas e @ para chamar alguém. E uma mesa de sons que a sala inteira ouve." duracao={duracao}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
        <Chat largura={900} mensagens={[{ pessoa: PESSOAS.ana, texto: 'alguém sobe a tela? 👀', em: -20 }, { pessoa: PESSOAS.rafa, texto: 'subi! vem ver 🎮', em: -20 }, { pessoa: PESSOAS.voce, texto: '@Rafa que jogada!', em: 66 }]}
          rascunho={q < 66 ? '@Rafa que jogada!' : ''} inicioRascunho={18} porLetra={2} lista={{ de: 20, ate: 32, ativo: 26 }} />
        <div style={{ position: 'relative' }}>
          <Mesa largura={900} tocados={{ 0: 124, 2: 168 }} />
          <Cursor caminho={[[96, 820, -40], [116, 110, 96], [130, 110, 96], [158, 566, 96]]} cliques={[124, 168]} />
        </div>
      </div>
      <Som src="teclado" em={18} volume={0.45} /><Som src="pop" em={20} volume={0.3} />
      <Som src="audio/sala/mencao.mp3" em={66} volume={1} />
      <Som src="piada" em={124} volume={0.5} /><Som src="palmas" em={168} volume={0.4} duracao={80} />
      <Vuush duracao={duracao} />
    </Cena>
  );
}

function MusicaETemas({ duracao }) {
  const metade = duracao / 2;
  return (
    <>
      <Sequence durationInFrames={metade} layout="none">
        <Cena rotulo="07 · Música" titulo={'Música para\na sala toda.'} destaque={['toda.']} apoio="Peça pelo nome ou pelo link, e o bot toca para todo mundo. A fila se arrasta para mudar a ordem." duracao={metade}>
          <Fila largura={920} troca={52} />
        </Cena>
        <Som src="pop" em={70} volume={0.35} />
      </Sequence>
      <Sequence from={metade} durationInFrames={metade} layout="none">
        <Cena rotulo="08 · Do seu jeito" titulo={'Do seu\njeito.'} destaque={['jeito.']} apoio="Escuro, claro ou o do sistema, oito temas prontos e a sua cor. E um perfil com apelido, cor e marca." duracao={metade}>
          <MiniSala largura={960} trocas={[24, 44, 64]} />
        </Cena>
        <Som src="pop" em={24} volume={0.3} /><Som src="pop" em={44} volume={0.3} /><Som src="pop" em={64} volume={0.3} />
        <Vuush duracao={metade} />
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
