// A leitura do código de recuperação, igual na página e no servidor.
//
// O código é anotado num papel, num bloco de notas, num gerenciador de senhas -- e volta de
// lá do jeito que foi guardado: com "Nexo:" na frente, com o traço que o editor de texto pôs
// no lugar do hífen, em minúsculas, em grupos separados por espaço. Antes, tudo o que não
// fosse letra do código era jogado fora e o resto era comparado; "Nexo: 3XB2-..." virava
// "NEX3XB2...", e a pessoa com o código certo na mão ouvia só "não conferem".
//
// Esta leitura acha o código dentro do texto e, quando não acha, diz POR QUÊ -- sem olhar
// conta nenhuma, então dizer isso não revela nada sobre quem tem conta.
(function (root) {
  // Sem 0/O/1/I/L: o código é lido em voz alta e copiado à mão, e é aí que esses cinco viram
  // outra coisa. O mesmo alfabeto dos protocolos de relato (telemetria/relatos.js).
  const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const TAMANHO = 20;
  const GRUPO = `[${ALFABETO}]{4}`;
  // O hífen e os traços que editores de texto e celulares põem no lugar dele sozinhos.
  const TRACO = '[-‐-―−]';
  // Uma sequência de grupos ligados por traço. Ela é lida inteira, e só vale com cinco grupos:
  // "PARA-3XB2-..." tem seis, e escolher cinco deles seria adivinhar.
  const SEQUENCIA = new RegExp(`(?<![A-Z0-9])${GRUPO}(?:\\s*${TRACO}\\s*${GRUPO})+(?![A-Z0-9])`, 'g');
  const doAlfabeto = texto => [...texto].every(c => ALFABETO.includes(c));

  // Devolve `{ codigo }` (20 caracteres, sem traço) ou `{ problema, digitados }`.
  function ler(texto) {
    // NFKC desfaz o "３" de largura cheia de alguns teclados; maiúsculas, porque é assim que o
    // código é mostrado.
    const bruto = String(texto ?? '').normalize('NFKC').toUpperCase();
    // 1. Do jeito que foi mostrado, em cinco grupos com traço: acha no meio de qualquer texto.
    //    Dois códigos colados juntos (o velho e o novo) são ambíguos e caem adiante.
    const formatados = [...bruto.matchAll(SEQUENCIA)].map(m => m[0].replace(/[^A-Z0-9]/g, '')).filter(c => c.length === TAMANHO);
    if (formatados.length === 1) return { codigo: formatados[0] };
    // 2. Tudo junto, ou separado por espaço e pontuação, sem mais nada em volta.
    const junto = bruto.replace(/[^A-Z0-9]/g, '');
    if (junto.length === TAMANHO && doAlfabeto(junto)) return { codigo: junto };
    // 3. Cinco grupos de quatro no meio de outras palavras ("nexo: 3xb2 y9ct ..."). Palavras
    //    com O, I ou L -- quase todas as de um rótulo -- já não passam por grupo do código.
    const grupos = bruto.split(/[^A-Z0-9]+/).filter(g => g.length === 4 && doAlfabeto(g));
    if (grupos.length === 5) return { codigo: grupos.join('') };
    if (!junto) return { problema: 'vazio', digitados: 0 };
    if (grupos.length > 5) return { problema: 'misturado', digitados: junto.length };
    if (/[0O1IL]/.test(junto)) return { problema: 'caracteres', digitados: junto.length };
    return { problema: 'tamanho', digitados: junto.length };
  }

  function mensagem({ problema, digitados }) {
    if (problema === 'vazio') return 'Digite o código de recuperação.';
    if (problema === 'misturado') return 'Cole só o código de recuperação, sem outras palavras junto.';
    if (problema === 'caracteres') return 'O código de recuperação não tem as letras O, I e L nem os números 0 e 1. Confira esses caracteres no que você anotou.';
    return `O código de recuperação tem ${TAMANHO} letras e números, em 5 grupos de 4. O que foi digitado tem ${digitados}.`;
  }

  const formatar = codigo => String(codigo || '').match(/.{1,4}/g)?.join('-') || '';

  const api = { ALFABETO, TAMANHO, ler, mensagem, formatar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NexoRecuperacao = api;
})(typeof window === 'undefined' ? globalThis : window);
