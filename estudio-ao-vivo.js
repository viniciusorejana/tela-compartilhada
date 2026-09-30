// O Estúdio no ar: as páginas do OBS, a credencial de cada uma e o aviso à sala.
//
// Cada fonte que alguém põe no OBS é uma página (public/obs.html) com um link assinado
// (estudio.js). A página abre um socket no namespace `/estudio` apresentando o link, e daqui
// sai o estado dela: aguardando quem criou o link entrar numa sala, aguardando a pessoa que ela
// mostra, recusada por essa pessoa, ou no ar -- com a credencial de mídia para entrar na sala.
//
// ---------- Uma participante oculta, que só recebe ----------
//
// A página entra no servidor de mídia com um token oculto (não aparece na lista de ninguém nem
// conta como gente na sala), sem poder publicar nada nem mandar dados. Ela só recebe. A tela
// chega pelo RTP, como para qualquer espectador; ver docs/estudio.md para os três caminhos.
//
// ---------- Quem é capturado fica sabendo ----------
//
// Oculta não quer dizer escondida. A sala inteira recebe `estudio-capturas`: quem está levando
// o quê para o OBS. E cada pessoa decide se pode ser levada (`permiteEstudio`, no membro): quem
// desliga derruba na hora as capturas que já existiam, e nenhuma nova começa.
//
// Tudo mora na memória: nada daqui sobrevive a reiniciar o servidor, e a página do OBS volta
// sozinha quando ele sobe de novo -- o link é que é permanente, não a captura.
const crypto = require('node:crypto');
const { FONTES, chaveDaPessoa, chaveValida, normalizarCodigo, normalizarNome, criarAssinador } = require('./estudio');

const PREFIXO_DA_IDENTIDADE = 'nexo-estudio#';
// Uma cena de OBS com cinco amigos, câmera e tela de cada um e os rostos, são uns doze links.
const PAGINAS_POR_DIRETOR = 24;
const PAGINAS_NO_SERVIDOR = 512;
// A rede de segurança: tudo o que muda passa por um aviso, e um aviso perdido não pode deixar
// uma página presa em "aguardando" para sempre.
const MS_ENTRE_CONFERENCIAS = 30000;

// `salaPermite(sala, identidade)` é o controle de quem abriu a sala (server.js): com o OBS
// desligado nela, só o dono leva alguém para lá.
function criarEstudioAoVivo({ io, contas, sfu, membros, limitarOrigem = () => true, enderecoDoSfu, publicUrl = null, emitirNaSala, formatarCodigo = c => c, salaPermite = () => true }) {
  const assinador = criarAssinador(sfu.segredoDerivado('estudio'));
  const paginas = new Set();
  const porConta = new Map();       // conta do diretor -> Set<socket>
  const acessos = new Map();        // identidade de mídia da página -> { sala, pagina }
  const anunciadas = new Map();     // sala -> o que a sala já sabe (JSON)

  // ---------- Quem está onde ----------

  const codigoDoMembro = membro => (membro?.contaId ? normalizarCodigo(membro.perfil?.codigo) : null);
  const chaveDoMembro = membro => chaveDaPessoa({ codigo: codigoDoMembro(membro), nome: membro?.name });

  // "Uma conta, uma conexão" (server.js): a conta está em uma sala só.
  function localizarConta(contaId) {
    if (!contaId) return null;
    for (const [sala, lista] of membros) for (const membro of lista.values()) if (membro.contaId === contaId) return { sala, membro };
    return null;
  }

  // Uma pessoa por identidade: numa oscilação de rede ela tem dois sockets por um instante.
  function pessoasDaSala(sala) {
    const vistas = new Map();
    for (const membro of membros.get(sala)?.values() || []) {
      if (!membro.identidade || vistas.has(membro.identidade)) continue;
      vistas.set(membro.identidade, {
        identidade: membro.identidade, nome: membro.name, chave: chaveDoMembro(membro), contaId: membro.contaId || null,
        perfil: membro.perfil ? { cor: membro.perfil.cor || null, marca: membro.perfil.marca || null, avatar: membro.perfil.avatar || null, codigo: membro.perfil.codigo || null } : null,
        // Do estado, o servidor só sabe o que a pessoa anuncia: se está ensurdecida (server.js,
        // "ensurdecer"), que o OBS usa para trocar o rosto. Câmera, tela e microfone são da mídia:
        // a página do OBS e o painel do Estúdio (que roda na sala) os leem de lá, ao vivo.
        estado: { ensurdecido: Boolean(membro.state?.ensurdecido) },
        permite: membro.permiteEstudio !== false
      });
    }
    return [...vistas.values()];
  }

  // O que a página do OBS e o Estúdio podem saber de cada pessoa. Nada de conta, nada de estado
  // de socket: o nome, a chave, a aparência e se ela aceita ser levada.
  const publica = ({ identidade, nome, chave, perfil, estado, permite }) => ({ identidade, nome, chave, perfil, estado, permite });

  // ---------- Os links ----------

  function caminho(link) { return `/obs/${link}`; }

  function criarLink(conta, { tipo = 'fonte', alvo = null, fonte = null, nome = '' } = {}) {
    if (!['fonte', 'reativo'].includes(tipo)) return { ok: false, status: 400, error: 'Tipo de link desconhecido.' };
    const chave = alvo === null || alvo === undefined || alvo === '' ? null : chaveValida(String(alvo));
    if (alvo && !chave) return { ok: false, status: 400, error: 'Pessoa inválida.' };
    if (tipo === 'fonte' && (!chave || !Object.prototype.hasOwnProperty.call(FONTES, fonte))) return { ok: false, status: 400, error: 'Diga a pessoa e a fonte.' };
    // O nome vai no link para a página dizer "aguardando a Bia" antes de a Bia chegar.
    const rotulo = nome || (chave?.startsWith('n:') ? chave.slice(2) : chave ? contas.contaPorCodigo(chave.slice(2))?.apelido || '' : '');
    const link = assinador.criar({ tipo, diretor: conta.codigo, geracao: contas.geracaoDoEstudio(conta.id), alvo: chave, fonte: tipo === 'fonte' ? fonte : null, nome: rotulo });
    return { ok: true, caminho: caminho(link) };
  }

  // Todos os links de uma pessoa de uma vez: a página copia na hora do clique, sem ida ao
  // servidor no meio -- a área de transferência não espera uma resposta de rede.
  function linksDaPessoa(conta, chave, nome = '') {
    const links = {};
    for (const fonte of Object.keys(FONTES)) links[fonte] = criarLink(conta, { tipo: 'fonte', alvo: chave, fonte, nome }).caminho;
    links.reativo = criarLink(conta, { tipo: 'reativo', alvo: chave, nome }).caminho;
    return links;
  }

  // Pelo código de conta, ou pelo nome de quem entra sem conta ("endereçar" alguém).
  function acharPessoa({ codigo = '', nome = '' } = {}) {
    if (String(codigo || '').trim()) {
      const conta = contas.contaPorCodigo(codigo);
      if (!conta || contas.suspensa(conta)) return { ok: false, status: 404, error: 'Nenhuma conta com esse código.' };
      const perfil = contas.perfil(conta);
      return { ok: true, pessoa: { chave: `c:${conta.codigo}`, rotulo: conta.apelido, perfil: { cor: perfil.cor, marca: perfil.marca, avatar: perfil.avatar, codigo: formatarCodigo(conta.codigo) } } };
    }
    const limpo = String(nome || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const chave = chaveDaPessoa({ nome: limpo });
    if (!chave) return { ok: false, status: 400, error: 'Digite um código de conta ou um nome.' };
    return { ok: true, pessoa: { chave, rotulo: limpo, perfil: null } };
  }

  // O que o painel do Estúdio mostra do agora: a sala em que o diretor está, quem está nela e
  // os links de cada um, prontos para copiar.
  function retrato(conta) {
    const onde = localizarConta(conta.id);
    const links = { grupo: criarLink(conta, { tipo: 'reativo' }).caminho, pessoas: {} };
    const pessoas = onde ? pessoasDaSala(onde.sala) : [];
    for (const pessoa of pessoas) if (pessoa.chave) links.pessoas[pessoa.chave] = linksDaPessoa(conta, pessoa.chave, pessoa.nome);
    // Quem foi guardado pelo código aparece com a foto e o apelido de agora, mesmo fora da sala.
    const perfis = {};
    for (const [chave, dados] of Object.entries(contas.configDoEstudio(conta.id).pessoas)) {
      if (!links.pessoas[chave]) links.pessoas[chave] = linksDaPessoa(conta, chave, dados.rotulo);
      if (!chave.startsWith('c:')) continue;
      const achada = acharPessoa({ codigo: chave.slice(2) });
      if (achada.ok) perfis[chave] = { ...achada.pessoa.perfil, apelido: achada.pessoa.rotulo };
    }
    return {
      publicUrl, links, perfis,
      sala: onde ? { pessoas: pessoas.map(p => ({ ...publica(p), eu: p.contaId === conta.id })), bloqueada: !salaPermite(onde.sala, onde.membro.identidade) } : null,
      capturas: onde ? capturasDaSala(onde.sala) : []
    };
  }

  // ---------- A credencial de mídia de cada página ----------

  function liberar(pagina) {
    const midia = pagina.data.midia;
    if (!midia) return;
    pagina.data.midia = null;
    acessos.delete(midia.identidade);
    sfu.consultar('RemoveParticipant', { room: midia.sala, identity: midia.identidade }).catch(() => { /* já tinha saído */ });
  }

  function credencial(pagina, sala, conta) {
    const atual = pagina.data.midia;
    if (atual?.sala === sala) return atual.publica;
    liberar(pagina);
    if (!sfu.estado.ativo) return null;
    const identidade = `${PREFIXO_DA_IDENTIDADE}${crypto.randomBytes(12).toString('hex')}`;
    const token = sfu.criarToken(sala, identidade, `OBS de ${conta.apelido}`, { podeReceber: true, podePublicar: false, dados: false, oculto: true });
    const publicaDaMidia = { url: enderecoDoSfu(pagina.request), token, identidade };
    pagina.data.midia = { sala, identidade, publica: publicaDaMidia };
    acessos.set(identidade, { sala, pagina });
    return publicaDaMidia;
  }

  // ---------- O estado de cada página ----------

  function indexar(pagina, contaId) {
    if (pagina.data.contaId === contaId) return;
    porConta.get(pagina.data.contaId)?.delete(pagina);
    pagina.data.contaId = contaId;
    if (!contaId) return;
    if (!porConta.has(contaId)) porConta.set(contaId, new Set());
    porConta.get(contaId).add(pagina);
  }

  function decidir(pagina) {
    const link = pagina.data.link;
    const conta = contas.contaPorCodigo(link.diretor);
    if (!conta || contas.suspensa(conta)) { indexar(pagina, null); return { estado: { tipo: 'invalido', texto: 'A conta que criou este link não existe mais.' } }; }
    indexar(pagina, conta.id);
    if (contas.geracaoDoEstudio(conta.id) !== link.geracao) return { estado: { tipo: 'revogado', texto: 'Quem criou este link desligou os links antigos. Peça um novo.' } };
    const onde = localizarConta(conta.id);
    if (!onde) return { estado: { tipo: 'aguardando', motivo: 'diretor', texto: `Aguardando ${conta.apelido} entrar numa sala do Nexo.` } };
    // Presa à sala mesmo recusada: volta sozinha quando quem abriu a sala religar o OBS.
    if (!salaPermite(onde.sala, onde.membro.identidade)) return { estado: { tipo: 'recusado', motivo: 'sala', texto: 'Quem abriu a sala desligou o OBS nela.' }, sala: onde.sala };
    const pessoas = pessoasDaSala(onde.sala);

    if (link.tipo === 'fonte') {
      const alvo = pessoas.find(p => p.chave === link.alvo);
      const nome = alvo?.nome || link.nome || 'a pessoa';
      // Esperando a pessoa na MESMA sala, a página continua conectada: um F5 dela volta em dois
      // segundos, e sair e entrar de novo no servidor de mídia custaria mais que isso.
      if (!alvo) return { estado: { tipo: 'aguardando', motivo: 'alvo', texto: `Aguardando ${nome} entrar na sala de ${conta.apelido}.` }, sala: onde.sala, manter: true, conta };
      // Recusada, a página continua presa à sala -- sem mídia nenhuma --, para voltar sozinha
      // no instante em que a pessoa deixar, ou quando o diretor sair.
      if (!alvo.permite) return { estado: { tipo: 'recusado', texto: `${alvo.nome} não deixa levar a própria câmera, tela e voz para o OBS.` }, sala: onde.sala };
      // As faixas vão junto: a página assina exatamente estas, e a tabela de fontes mora só em
      // estudio.js.
      const { video, audio } = FONTES[link.fonte];
      return { estado: { tipo: 'ok', fonte: link.fonte, video, audio, alvo: publica(alvo) }, sala: onde.sala, conta, diretor: onde.membro.identidade };
    }

    const config = contas.configDoEstudio(conta.id);
    const lista = pessoas.filter(p => p.permite && (!link.alvo || p.chave === link.alvo) && !config.pessoas[p.chave]?.oculto);
    return {
      estado: { tipo: 'ok', reativo: true, individual: Boolean(link.alvo), nome: link.nome || '', pessoas: lista.map(publica), config },
      sala: onde.sala, conta, diretor: onde.membro.identidade
    };
  }

  // `pagina.data.sala` é a sala a que a página está presa agora -- no ar, ou esperando a pessoa
  // dentro dela. É por ela, e não pela credencial de mídia, que a sala fica sabendo: a captura
  // é anunciada no instante em que passa a valer, mesmo que o servidor de mídia ainda esteja
  // voltando e a imagem demore.
  function avaliar(pagina, salasTocadas = new Set()) {
    if (!pagina.connected) return;
    const salaAntes = pagina.data.sala || null;
    const decisao = decidir(pagina);
    let midia = null;
    if (decisao.estado.tipo === 'ok') midia = credencial(pagina, decisao.sala, decisao.conta);
    else if (decisao.manter && pagina.data.midia?.sala === decisao.sala) midia = pagina.data.midia.publica;
    else liberar(pagina);
    pagina.data.sala = decisao.sala || null;
    pagina.data.diretor = decisao.diretor || null;
    pagina.data.estado = decisao.estado;
    const estado = { ...decisao.estado, midia };
    const assinatura = JSON.stringify(estado);
    if (assinatura !== pagina.data.enviado) {
      pagina.data.enviado = assinatura;
      pagina.emit('estado', estado);
    }
    if (salaAntes) salasTocadas.add(salaAntes);
    if (pagina.data.sala) salasTocadas.add(pagina.data.sala);
  }

  // ---------- O que a sala vê ----------
  //
  // Uma linha por captura no ar: quem a criou, quem aparece e o quê. Capturas iguais (a mesma
  // câmera em duas cenas do mesmo OBS) viram uma linha só -- para quem é capturado, é o mesmo.
  function capturasDaSala(sala) {
    const vistas = new Map();
    for (const pagina of paginas) {
      const estado = pagina.data.estado;
      if (estado?.tipo !== 'ok' || pagina.data.sala !== sala || !pagina.data.diretor) continue;
      const linha = estado.reativo
        ? { diretor: pagina.data.diretor, alvo: estado.individual ? estado.pessoas[0]?.identidade || null : null, fonte: 'reativo' }
        : { diretor: pagina.data.diretor, alvo: estado.alvo.identidade, fonte: estado.fonte };
      if (estado.reativo && estado.individual && !linha.alvo) continue;
      vistas.set(`${linha.diretor}|${linha.alvo}|${linha.fonte}`, linha);
    }
    return [...vistas.values()];
  }

  function anunciar(salas) {
    for (const sala of salas) {
      const lista = capturasDaSala(sala);
      const assinatura = JSON.stringify(lista);
      if ((anunciadas.get(sala) || '[]') === assinatura) continue;
      if (lista.length) anunciadas.set(sala, assinatura); else anunciadas.delete(sala);
      emitirNaSala(sala, 'estudio-capturas', { lista });
    }
  }

  function reavaliar(conjunto) {
    const tocadas = new Set();
    for (const pagina of conjunto) avaliar(pagina, tocadas);
    anunciar(tocadas);
  }

  // Alguém entrou, saiu, mudou o perfil ou a permissão numa sala. Reavalia quem está ligado a
  // ela: as páginas conectadas nela e as de todo diretor que está nela agora (quem acabou de
  // chegar tira as páginas dele do "aguardando").
  function mudouSala(sala) {
    const alvo = new Set();
    for (const pagina of paginas) if (pagina.data.sala === sala) alvo.add(pagina);
    for (const membro of membros.get(sala)?.values() || []) for (const pagina of porConta.get(membro.contaId) || []) alvo.add(pagina);
    reavaliar(alvo);
  }

  // A configuração, a geração dos links ou a própria conta mudou.
  function mudouConta(contaId) {
    reavaliar(new Set(porConta.get(contaId) || []));
  }

  // ---------- As páginas do OBS ----------
  const ns = io.of('/estudio');
  ns.use((socket, next) => {
    if (!limitarOrigem(socket.request, 'estudio-conexao')) return next(new Error('Muitas conexões. Aguarde um minuto.'));
    if (paginas.size >= PAGINAS_NO_SERVIDOR) return next(new Error('O servidor está no limite de fontes do OBS. Tente daqui a pouco.'));
    const link = assinador.ler(socket.handshake.auth?.link);
    if (!link) return next(new Error('link-invalido'));
    const conta = contas.contaPorCodigo(link.diretor);
    if (conta && (porConta.get(conta.id)?.size || 0) >= PAGINAS_POR_DIRETOR) return next(new Error(`Cada conta pode ter até ${PAGINAS_POR_DIRETOR} fontes no OBS ao mesmo tempo.`));
    socket.data.link = link;
    next();
  });
  ns.on('connection', pagina => {
    paginas.add(pagina);
    reavaliar([pagina]);
    // A página pede de novo quando a conexão de mídia dela cai: a credencial pode ter vencido,
    // ou o servidor de mídia pode ter reiniciado sem ela.
    pagina.on('renovar', () => {
      if (Date.now() - (pagina.data.renovadaEm || 0) < 1500) return;
      pagina.data.renovadaEm = Date.now();
      liberar(pagina);
      pagina.data.enviado = null;
      reavaliar([pagina]);
    });
    pagina.on('disconnect', () => {
      const sala = pagina.data.sala;
      pagina.data.sala = null;
      liberar(pagina);
      paginas.delete(pagina);
      porConta.get(pagina.data.contaId)?.delete(pagina);
      if (porConta.get(pagina.data.contaId)?.size === 0) porConta.delete(pagina.data.contaId);
      if (sala) anunciar([sala]);
    });
  });

  const conferencia = setInterval(() => reavaliar(new Set(paginas)), MS_ENTRE_CONFERENCIAS);
  conferencia.unref?.();

  return {
    // A terceira porta do servidor de mídia (telemetria/index.js): a identidade oculta desta
    // página, na sala para a qual a credencial foi emitida, e em mais nenhuma.
    aceita: ({ sala, identidade } = {}) => acessos.get(identidade)?.sala === sala,
    mudouSala, mudouConta, capturasDaSala, criarLink, linksDaPessoa, acharPessoa, retrato,
    chaveDoMembro, pessoasDaSala,
    PREFIXO_DA_IDENTIDADE,
    encerrar() { clearInterval(conferencia); for (const pagina of paginas) liberar(pagina); },
    paginas: () => paginas.size
  };
}

module.exports = { criarEstudioAoVivo, PREFIXO_DA_IDENTIDADE, normalizarNome };
