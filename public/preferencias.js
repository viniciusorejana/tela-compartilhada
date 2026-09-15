/* O que a pessoa escolheu, lembrado para a próxima vez.
 *
 * A sala já guardava as escolhas grandes -- nome, dispositivos, qualidade, codec. O que
 * faltava eram as pequenas, que são justamente as que mais irritam quando se perdem:
 * abaixar o volume de alguém que fala alto, calar o som de uma tela, desligar a redução
 * de ruído. Cada uma sozinha é um clique; refazer todas em toda entrada é o que cansa.
 *
 * Três decisões dão forma a este arquivo:
 *
 *   - Tudo vive no NAVEGADOR de cada um, em `localStorage`. Nenhuma preferência daqui vai
 *     para o servidor nem é vista por outra pessoa -- abaixar o volume de alguém é uma
 *     decisão privada, e continua sendo.
 *   - O volume de uma pessoa é lembrado pelo NOME dela, não pela identidade. A identidade
 *     carrega um sufixo sorteado a cada entrada (`Ana#3f2a91c0`), então lembrar por ela
 *     seria não lembrar nada. Pelo nome, a escolha atravessa sessões e salas -- e é por
 *     isso que o volume do bot de música também sobrevive: o nome dele é sempre o mesmo.
 *   - Só se guarda o que FOI mudado. Volume em 100% e sem mudo é o padrão: gravá-lo
 *     encheria o armazenamento de entradas que não dizem nada, e a lista tem teto.
 */
(function (root) {
  const PREFIXO = 'nexo.pref.';
  // Teto de pessoas lembradas. Uma sala grande, ao longo de meses, passaria de centenas de
  // nomes -- e o que interessa é sempre o punhado com quem se conversa. Ao encher, sai
  // quem foi ajustado há mais tempo.
  const PESSOAS_LEMBRADAS = 40;

  function ler(chave, padrao) {
    try {
      const bruto = localStorage.getItem(PREFIXO + chave);
      if (bruto === null) return padrao;
      return JSON.parse(bruto);
    } catch (_) {
      // Sem armazenamento (janela privada, cookies bloqueados) ou valor corrompido: a sala
      // funciona igual, só não lembra. Nunca é motivo para quebrar nada.
      return padrao;
    }
  }

  function gravar(chave, valor) {
    try {
      if (valor === undefined || valor === null) localStorage.removeItem(PREFIXO + chave);
      else localStorage.setItem(PREFIXO + chave, JSON.stringify(valor));
      return true;
    } catch (_) {
      return false;
    }
  }

  // ---------- Volume por pessoa ----------

  // Nomes diferindo só por maiúscula ou espaço são a mesma pessoa para quem está na sala,
  // e precisam ser a mesma entrada aqui.
  function chaveDaPessoa(nome) {
    return String(nome || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
  }

  const PADRAO = { voz: 1, vozMuda: false, tela: 1, telaMuda: false };
  const ehPadrao = a => a.voz === 1 && !a.vozMuda && a.tela === 1 && !a.telaMuda;

  function todasAsPessoas() {
    const guardado = ler('audioPorPessoa', {});
    return guardado && typeof guardado === 'object' ? guardado : {};
  }

  // O que foi escolhido para esta pessoa, ou o padrão se nunca se mexeu nela.
  function audioDe(nome) {
    const chave = chaveDaPessoa(nome);
    const entrada = todasAsPessoas()[chave];
    if (!entrada) return { ...PADRAO };
    return {
      voz: typeof entrada.voz === 'number' ? entrada.voz : 1,
      vozMuda: Boolean(entrada.vozMuda),
      tela: typeof entrada.tela === 'number' ? entrada.tela : 1,
      telaMuda: Boolean(entrada.telaMuda)
    };
  }

  function guardarAudioDe(nome, audio) {
    const chave = chaveDaPessoa(nome);
    if (!chave) return;
    const pessoas = todasAsPessoas();

    // Voltar tudo ao padrão APAGA a entrada em vez de gravar o padrão. Sem isso, quem
    // mexesse e desfizesse deixaria lixo ocupando uma das quarenta vagas.
    if (ehPadrao(audio)) {
      if (!(chave in pessoas)) return;
      delete pessoas[chave];
      gravar('audioPorPessoa', pessoas);
      return;
    }

    pessoas[chave] = { ...audio, em: Date.now() };

    const nomes = Object.keys(pessoas);
    if (nomes.length > PESSOAS_LEMBRADAS) {
      nomes.sort((a, b) => (pessoas[a].em || 0) - (pessoas[b].em || 0))
        .slice(0, nomes.length - PESSOAS_LEMBRADAS)
        .forEach(velho => delete pessoas[velho]);
    }
    gravar('audioPorPessoa', pessoas);
  }

  // ---------- Escolhas que valem só numa sala ----------
  //
  // Quase tudo aqui é da PESSOA e atravessa salas de propósito: o nome, os aparelhos, o
  // volume de quem fala alto. A mesa de sons é a exceção, porque ela não é a mesma coisa
  // em duas salas: cada uma tem os sons que subiram nela. Uma mesa de gritaria pede 20%;
  // uma de trilha de fundo pede 80%. Um número só para todas fazia reajustar a cada troca.
  //
  // Entrar numa sala nova não começa do zero: vale o último volume escolhido em qualquer
  // lugar, e só a partir do primeiro ajuste ali aquela sala passa a ter o dela.
  const SALAS_LEMBRADAS = 20;

  function nomeDaSala(sala) {
    return String(sala || '').trim().toLowerCase().slice(0, 60);
  }

  function todasAsSalas() {
    const guardado = ler('porSala', {});
    return guardado && typeof guardado === 'object' ? guardado : {};
  }

  function daSala(sala, chave, padrao) {
    const entrada = todasAsSalas()[nomeDaSala(sala)];
    const valor = entrada && entrada[chave];
    return valor === undefined ? padrao : valor;
  }

  function guardarDaSala(sala, chave, valor) {
    const nome = nomeDaSala(sala);
    if (!nome) return;
    const salas = todasAsSalas();
    salas[nome] = { ...(salas[nome] || {}), [chave]: valor, em: Date.now() };

    const nomes = Object.keys(salas);
    if (nomes.length > SALAS_LEMBRADAS) {
      nomes.sort((a, b) => (salas[a].em || 0) - (salas[b].em || 0))
        .slice(0, nomes.length - SALAS_LEMBRADAS)
        .forEach(velha => delete salas[velha]);
    }
    gravar('porSala', salas);
  }

  function esquecerTudo() {
    try {
      Object.keys(localStorage).filter(k => k.startsWith(PREFIXO)).forEach(k => localStorage.removeItem(k));
      return true;
    } catch (_) {
      return false;
    }
  }

  // Quantas escolhas estão guardadas. Usado pela tela de preferências para poder dizer
  // "esquecer o que ajustei" com um número em vez de uma promessa vaga.
  function resumo() {
    const pessoas = Object.keys(todasAsPessoas()).length;
    const salas = Object.keys(todasAsSalas()).length;
    let chaves = 0;
    try { chaves = Object.keys(localStorage).filter(k => k.startsWith(PREFIXO)).length; } catch (_) { /* sem acesso */ }
    return { pessoas, salas, chaves };
  }

  root.Preferencias = {
    ler, gravar, audioDe, guardarAudioDe, daSala, guardarDaSala,
    esquecerTudo, resumo, PESSOAS_LEMBRADAS, SALAS_LEMBRADAS
  };
})(window);
