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

  // ---------- O leitor único das escolhas da sala ----------
  //
  // Eram umas dez chaves de `localStorage` lidas e gravadas em pontos diferentes de sala.js,
  // cada uma no seu formato. Antes de sincronizar qualquer coisa com a conta, isso precisava
  // de um lugar só: é daqui que sai a lista do que sobe, e é aqui que se garante que o que
  // não deve subir -- aparelhos, volume por pessoa -- não sobe.
  //
  // As chaves antigas continuam as mesmas, de propósito: quem já usa o Nexo não perde nada
  // guardado por causa desta arrumação.
  const AJUSTES = {
    qualidade: ['nexoQuality', 'texto'],
    codec: ['nexoCodec', 'texto'],
    prioridade: ['nexoPrioridade', 'texto'],
    quadros: ['nexoFps', 'numero'],
    ladoCamera: ['nexoLadoCamera', 'texto'],
    pushToTalk: ['sala.pushToTalk', 'um-ou-zero'],
    reducaoDeRuido: [PREFIXO + 'reducaoDeRuido', 'json'],
    sons: [PREFIXO + 'sons', 'json'],
    aparencia: [PREFIXO + 'aparencia', 'json'],
    novidades: [PREFIXO + 'novidades', 'numero'],
    // Daqui para baixo, só deste navegador. Ver o porquê em perfil.js.
    nome: ['salaNome', 'texto'],
    economiaDeDados: ['sala.economiaDados', 'um-ou-zero'],
    microfone: ['sala.dispositivo.microfone', 'texto'],
    saida: ['sala.dispositivo.saida', 'texto'],
    camera: ['sala.dispositivo.camera', 'texto']
  };
  const ouvintes = new Set();
  // O que sincroniza vem de perfil.js, que o servidor também usa: uma lista só, e não duas
  // que acabariam discordando. Sem ele carregado, nada sincroniza -- o lado seguro.
  const sincronizados = () => Object.keys(root.NexoPerfil?.AJUSTES_SINCRONIZADOS || {});

  function lerAjuste(nome, padrao) {
    const [chave, formato] = AJUSTES[nome] || [];
    if (!chave) return padrao;
    let bruto;
    try { bruto = localStorage.getItem(chave); } catch (_) { return padrao; }
    if (bruto === null || bruto === '') return padrao;
    if (formato === 'numero') { const n = Number(bruto); return Number.isFinite(n) ? n : padrao; }
    if (formato === 'um-ou-zero') return bruto === '1';
    if (formato === 'json') { try { return JSON.parse(bruto); } catch (_) { return padrao; } }
    return bruto;
  }

  function escrever(nome, valor) {
    const [chave, formato] = AJUSTES[nome] || [];
    if (!chave) return false;
    try {
      if (valor === undefined || valor === null || valor === '') localStorage.removeItem(chave);
      else localStorage.setItem(chave, formato === 'um-ou-zero' ? (valor ? '1' : '0') : formato === 'json' ? JSON.stringify(valor) : String(valor));
      return true;
    } catch (_) { return false; }
  }

  // Gravar um ajuste que sincroniza avisa quem estiver ouvindo -- é assim que a conta fica
  // sabendo que tem o que subir, sem que cada ponto de sala.js precise lembrar disso.
  function gravarAjuste(nome, valor) {
    const gravou = escrever(nome, valor);
    if (gravou && sincronizados().includes(nome)) ouvintes.forEach(ouvir => { try { ouvir(nome, valor); } catch (_) { /* um ouvinte não derruba os outros */ } });
    return gravou;
  }

  // O que sobe para a conta: só a lista fechada, e só valores válidos.
  function ajustesSincronizaveis() {
    const brutos = {};
    for (const nome of sincronizados()) {
      const valor = lerAjuste(nome, undefined);
      if (valor !== undefined) brutos[nome] = valor;
    }
    return root.NexoPerfil ? root.NexoPerfil.limparAjustes(brutos) : {};
  }

  // O que desce da conta. Vale o que o servidor tem; o que ele não tem fica como está neste
  // navegador. Não avisa os ouvintes: isto não é uma escolha nova, é a escolha de sempre
  // chegando de outro aparelho.
  function aplicarAjustesDaConta(ajustes) {
    const limpos = root.NexoPerfil ? root.NexoPerfil.limparAjustes(ajustes) : {};
    for (const [nome, valor] of Object.entries(limpos)) escrever(nome, valor);
    return Object.keys(limpos);
  }

  function aoMudarAjuste(ouvir) { ouvintes.add(ouvir); return () => ouvintes.delete(ouvir); }

  root.Preferencias = {
    ler, gravar, audioDe, guardarAudioDe, daSala, guardarDaSala,
    esquecerTudo, resumo, PESSOAS_LEMBRADAS, SALAS_LEMBRADAS,
    lerAjuste, gravarAjuste, ajustesSincronizaveis, aplicarAjustesDaConta, aoMudarAjuste, AJUSTES
  };
})(window);
