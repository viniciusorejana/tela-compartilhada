// Os três níveis do Nexo, e o que cada um libera. Módulo puro, para o servidor e para a página,
// como quality-utils.js: uma regra de cobrança escrita duas vezes acabaria discordando.
//
// Uma frase orienta tudo (docs/plano-contas.md): cobra-se RESOLUÇÃO, porque é o que custa no
// servidor -- ele manda uma cópia por espectador. Nunca se cobra por segurança nem por
// quadros. A única exceção consciente é o degrau de quadros entre quem não tem conta e quem
// tem: a conta é grátis, e 60 quadros custam de fato ~1,4 vez a banda de 30.
//
//   sem conta        720p a 30 quadros
//   conta grátis     720p a 60 quadros
//   premium          1080p e 1440p, a 60 quadros
//
// Assistir nunca é limitado por plano. Quem assiste recebe a tela na qualidade de quem
// transmite -- e é esse o melhor argumento do premium: um assinante no grupo faz todo mundo ver
// a tela dele em 1080p, inclusive quem nem tem conta.
(function (root) {
  const LIMITES = Object.freeze({
    anonimo: Object.freeze({ altura: 720, quadros: 30 }),
    gratis: Object.freeze({ altura: 720, quadros: 60 }),
    premium: Object.freeze({ altura: 1440, quadros: 60 })
  });
  const NOMES = Object.freeze({ anonimo: 'sem conta', gratis: 'conta grátis', premium: 'premium' });

  // A captura raramente entrega exatamente 720, e o escalonador automático mexe na resolução o
  // tempo todo. Sem folga, a tela de quem está dentro do plano cairia por um pixel.
  const FOLGA = 0.1;

  // Toda sala tem teto de pessoas, e ele SOBE quando há um assinante nela: é o impulso que
  // quem paga dá à sala em que está. 25 fica acima dos picos de 10 a 20 do uso real; 50 é o
  // dobro. São números de partida, e o painel mostra quantas salas encostam no teto -- é isso
  // que diz se eles estão certos.
  const PESSOAS = Object.freeze({ base: 25, comAssinante: 50 });

  // O plano guardado na conta, com o prazo. Premium vencido é conta grátis; e a escolha de
  // qualidade da pessoa continua guardada, para voltar sozinha quando ela renovar.
  function nivelDaConta(conta, agora = Date.now()) {
    if (!conta) return 'anonimo';
    if (conta.plano === 'premium' && (conta.planoAte === null || conta.planoAte === undefined || conta.planoAte > agora)) return 'premium';
    return 'gratis';
  }

  const limites = nivel => LIMITES[nivel] || LIMITES.anonimo;
  const alturaPermitida = (nivel, altura) => Number(altura) <= limites(nivel).altura;
  const quadrosPermitidos = (nivel, quadros) => Number(quadros) <= limites(nivel).quadros;

  // O que vale de fato, a partir do que foi escolhido: a escolha, se o plano libera; senão, o
  // maior degrau que ele libera. `opcoes` é a lista de alturas disponíveis, em qualquer ordem.
  function alturaEfetiva(nivel, escolhida, opcoes) {
    if (alturaPermitida(nivel, escolhida)) return Number(escolhida);
    const cabem = opcoes.map(Number).filter(a => alturaPermitida(nivel, a));
    return cabem.length ? Math.max(...cabem) : Math.min(...opcoes.map(Number));
  }
  const quadrosEfetivos = (nivel, escolhidos) => Math.min(Number(escolhidos) || 30, limites(nivel).quadros);

  // Uma publicação passa do teto quando o lado MENOR passa da altura do plano, ou o maior
  // passa da largura 16:9 correspondente -- os dois com folga. Pelo lado menor, e não pela
  // altura, para uma tela de celular em pé ser medida pelo que ela tem de fato.
  function excedeTeto(nivel, largura, altura) {
    const menor = Math.min(Number(largura) || 0, Number(altura) || 0);
    const maior = Math.max(Number(largura) || 0, Number(altura) || 0);
    const teto = limites(nivel).altura;
    return menor > teto * (1 + FOLGA) || maior > (teto * 16 / 9) * (1 + FOLGA);
  }

  function tetoDePessoas({ comAssinante = false } = {}, pessoas = PESSOAS) {
    return comAssinante ? pessoas.comAssinante : pessoas.base;
  }
  // Quem entra conta a si mesmo: um assinante entra numa sala que já está no teto base,
  // porque é a presença dele que o aumenta. Quando ele sai, ninguém é removido -- novas
  // entradas é que esperam a sala ficar abaixo do teto base, ou outro assinante chegar.
  function cabeNaSala({ presentes, algumAssinante = false, entraAssinante = false }, pessoas = PESSOAS) {
    return presentes < tetoDePessoas({ comAssinante: algumAssinante || entraAssinante }, pessoas);
  }

  // Escolher a cor exata do destaque e do fundo é do premium. É a exceção consciente à regra
  // de só cobrar resolução: não custa nada no servidor, mas é um mimo de quem assina, e a
  // personalização de um clique -- claro e escuro, temas prontos, oito cores -- continua
  // livre para todo mundo. Com os planos desligados (NEXO_PLANOS=0), vale para todos, como o
  // 1440p. Quem deixa o premium vencer não perde as cores: elas ficam guardadas e voltam.
  const podeUsarCoresExatas = (nivel, livre = false) => Boolean(livre) || nivel === 'premium';

  const api = { LIMITES, NOMES, FOLGA, PESSOAS, nivelDaConta, limites, alturaPermitida, quadrosPermitidos, alturaEfetiva, quadrosEfetivos, excedeTeto, tetoDePessoas, cabeNaSala, podeUsarCoresExatas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NexoPlanos = api;
})(typeof window === 'undefined' ? globalThis : window);
