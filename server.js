const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { execFile, spawn } = require('child_process');

const HELPER_PATH = path.join(__dirname, 'native', 'audio-helper', 'x64', 'Release', 'ApplicationLoopback.exe');
const AGENTE_PATH = path.join(__dirname, 'native', 'audio-agent', 'x64', 'Release', 'AgenteAudio.exe');

// Trecho do nome do arquivo que carrega a URL da sala (em base64url). O agente le o
// proprio nome ao iniciar -- por isso o participante so precisa dar um duplo clique.
const MARCADOR_NOME_CONFIG = '.cfg-';

// Familias de navegador aceitas na captura por processo. Whitelist fechada: o valor vira
// argumento de um processo nativo, entao nada que venha do cliente passa direto.
const FAMILIAS_DE_NAVEGADOR = {
  chrome: 'chrome.exe',
  msedge: 'msedge.exe',
  firefox: 'firefox.exe',
  opera: 'opera.exe',
  brave: 'brave.exe',
  vivaldi: 'vivaldi.exe'
};

const sfu = require('./sfu');
const musica = require('./musica');
const soundboard = require('./soundboard');
const medicao = require('./medicao');
const { criarModeracao } = require('./moderacao');
const { criarSalas } = require('./salas');
const { criarTempos, chaveDeTempo } = require('./tempos');
const { criarEspectadores } = require('./espectadores');
const { criarChaveDeWebCodecs } = require('./chave-webcodecs');
const planos = require('./public/planos');
const vitrineComum = require('./public/vitrine');
const { iniciarTelemetria } = require('./telemetria');
const { criarContas } = require('./contas');
const { instalarRotasDeContas } = require('./contas/rotas');
const { formatarCodigo } = require('./contas/regras');
const { origemDaPaginaPermitida, origensConfiguradas } = require('./telemetria/origem');
const { dimensaoDaFaixa } = require('./telemetria/livekit');
const { criarEstudioAoVivo, PREFIXO_DA_IDENTIDADE: PREFIXO_DO_ESTUDIO } = require('./estudio-ao-vivo');
const { criarAmigos } = require('./contas/amigos');
const { criarSocial } = require('./social');

// Quem manda em cada sala. Vive só em memória, como o resto da sala: ver moderacao.js.
const moderacao = criarModeracao();
// Quem abre a sala, quanto ela espera vazia e o que some quando ela fecha: ver salas.js.
//
// NEXO_ANONIMO_ABRE_SALA=1 é a janela de transição do roteiro: o grupo que já usa o Nexo
// continua abrindo salas sem conta enquanto cria as suas. A regra decidida é a outra, e é o
// padrão.
const ANONIMO_ABRE_SALA = (process.env.NEXO_ANONIMO_ABRE_SALA || '').trim() === '1';
const salas = criarSalas({ anonimoAbre: ANONIMO_ABRE_SALA });
// Há quanto tempo a sala está aberta e há quanto tempo cada pessoa está nela, sem zerar no F5:
// ver tempos.js.
const tempos = criarTempos();
// Quem está vendo a tela de quem, para quem transmite saber: ver espectadores.js.
const espectadores = criarEspectadores();
// O teto de pessoas por sala: base e com um assinante presente. Os números de partida são 25
// e 50 (public/planos.js); NEXO_PESSOAS_POR_SALA="base,comAssinante" ajusta sem mexer no código.
const PESSOAS_POR_SALA = (() => {
  const [base, comAssinante] = String(process.env.NEXO_PESSOAS_POR_SALA || '').split(',').map(Number);
  return Number.isInteger(base) && base > 0 && Number.isInteger(comAssinante) && comAssinante >= base
    ? { base, comAssinante } : planos.PESSOAS;
})();
// NEXO_PLANOS=0 desliga os tetos de RESOLUÇÃO e de quadros: todo mundo transmite com o nível completo.
// É como o Nexo roda hoje -- o grupo transmite em 1440p sem limite --, e a chave deixa a regra de
// limites pronta e desligada para o dia em que um servidor precise dela. O teto de pessoas não
// depende dela.
const PLANOS_LIGADOS = (process.env.NEXO_PLANOS || '').trim() !== '0';
// NEXO_NOVIDADES=0 impede a apresentação e as novidades de abrirem sozinhas (public/novidades.js);
// o botão "Novidades" continua abrindo. Serve a quem hospeda para um público que já conhece o
// Nexo, e aos testes de navegador, que entram na sala num navegador sempre "de primeira vez".
const NOVIDADES_AUTOMATICAS = (process.env.NEXO_NOVIDADES || '').trim() !== '0';
// Quanto tempo quem transmite acima do plano tem para republicar menor antes de a tela cair.
// É o que um cliente honesto e desatualizado precisa; os testes encurtam.
const MS_PARA_AJUSTAR_A_TELA = Number(process.env.NEXO_ESPERA_TETO_MS) > 0 ? Number(process.env.NEXO_ESPERA_TETO_MS) : 5000;
// roomCode -> Map<socketId, { name, state, identidade, contaId, perfil }>. É o mapa do ciclo de
// vida: quem entra e sai passa por `salas`, e o resto do servidor só o lê.
const roomMembers = salas.mapa;

const app = express();
// O Express se anuncia em todo cabeçalho; ninguém de fora precisa saber o que roda aqui.
app.disable('x-powered-by');
const server = http.createServer(app);
// Precisa vir antes do Socket.IO: os dois escutam "upgrade" no mesmo servidor, e cada um
// so atende o proprio caminho.
sfu.instalarProxy(app, server);
const io = new Server(server, {
  // A origem é conferida no aperto de mão, e não só por CORS: o WebSocket não passa por CORS
  // nenhum. Sem isto, no dia em que a conta viaja num cookie, qualquer site aberto por quem
  // tem conta abriria um socket em nome dela. Ver telemetria/origem.js.
  allowRequest: (req, callback) => callback(null, origemDaPaginaPermitida(req)),
  cors: origensConfiguradas().length ? { origin: origensConfiguradas(), credentials: true } : undefined,
  // Por padrao o Socket.IO encerra QUALQUER upgrade que nao seja dele um segundo depois,
  // supondo que ninguem mais o tratou. Neste servidor ha mais dois: o agente de audio e a
  // sinalizacao do servidor de midia -- e era esse encerramento que derrubava a sala no
  // meio da conversa. Quem nao for de ninguem e fechado logo abaixo, explicitamente.
  destroyUpgrade: false,
  // Quem some sem avisar -- fechou o notebook, perdeu o Wi-Fi -- só é notado quando o
  // heartbeat falha. O aperto aqui já foi de 15s, mirando notar em 25: curto demais para
  // uma aba em segundo plano num celular, que perde batimento por throttling sem ter
  // saído de lugar nenhum. Cada falso positivo desses anunciava a saída de alguém que
  // estava ali, e com isso a sala "desconectava" quem só tinha ficado quieto.
  //
  // Quem decide quem está na sala é o servidor de mídia, conferido a cada cinco segundos;
  // este heartbeat é só um atalho para o caso comum. Atalho pode ser mais paciente.
  pingInterval: 10000,
  pingTimeout: 25000
});
// O botão de pânico da tela por WebCodecs (ver chave-webcodecs.js). Mora na pasta do painel,
// que é privada, e muda pelo painel; quem já está numa sala fica sabendo pelo socket, na hora.
const chaveDeWebCodecs = criarChaveDeWebCodecs({
  pasta: path.resolve(process.env.NEXO_PASTA_PAINEL || path.join(__dirname, 'native', 'painel')),
  aoMudar: estado => io.emit('midia-webcodecs', { ligado: estado.ligado })
});
// As contas nascem antes da telemetria porque o painel precisa delas; os alertas das contas
// vão para a telemetria, que só existe uma linha abaixo -- daí o `telemetria?.`.
let telemetria = null;
let estudio = null;
// Amigos ao vivo (social.js): nasce depois das contas e do Socket.IO, e as contas avisam por ele
// quando alguém ganha uma conquista ou apaga a conta -- daí o `social?.`.
let social = null;
const contas = criarContas({
  aoAlertar: alerta => telemetria?.alertar(alerta), planosLigados: PLANOS_LIGADOS,
  aoGanharConquista: (contaId, conquista) => social?.conquistou(contaId, conquista),
  aoApagarConta: contaId => social?.esquecerConta(contaId)
});
telemetria = iniciarTelemetria({
  app, io, sfu, medicao, soundboard, moderacao, salas: () => roomMembers,
  contas: { listar: contas.listarParaOPainel, agir: agirNaContaPeloPainel },
  midia: { estado: chaveDeWebCodecs.estado, definir: chaveDeWebCodecs.definir },
  aoFaixaDeTela: conferirTela, tetoDePessoas: estadoDoTeto,
  // Cada tela que entra no ar soma no contador da conta (as conquistas "No palco" e "Diretor de
  // cena"). Só a publicação conta, e não a conferência periódica, que vê a mesma tela de novo.
  aoPublicarTela: sessao => contas.contar(sessao?.contaId, 'telas'),
  aceitarCaptura: identidade => Boolean(estudio?.aceita(identidade))
});
// O Estúdio: a câmera, a tela e a voz de quem está na sala levadas ao OBS por um link, e os
// rostos que reagem à voz. Ver estudio.js e docs/estudio.md.
estudio = criarEstudioAoVivo({
  io, contas, sfu, membros: roomMembers, limitarOrigem: telemetria.limitarOrigem, enderecoDoSfu,
  publicUrl: origemPublica(), formatarCodigo, salaPermite: estudioPermitidoNaSala,
  emitirNaSala: (sala, evento, dados) => io.to(roomName(sala)).emit(evento, dados)
});
// Amigos: a regra (contas/amigos.js) e a parte ao vivo (social.js). Quem muda a lista de alguém
// avisa as abas dessa pessoa pelo socket `/social`.
const amigos = criarAmigos({ contas, aoMudar: (contaIds, motivo) => social?.mudouAmizade(contaIds, motivo) });
const rotasDeContas = instalarRotasDeContas(app, {
  contas, limitarOrigem: telemetria.limitarOrigem, abrirSemConta: ANONIMO_ABRE_SALA, planosLigados: PLANOS_LIGADOS, novidadesAutomaticas: NOVIDADES_AUTOMATICAS,
  aoMudarPerfil: conta => aplicarPerfilNasSalas(conta), aoMudarSocial: conta => social?.mudouPresenca(conta.id), estudio, amigos
});
social = criarSocial({ io, contas, amigos, tokenDoPedido: rotasDeContas.tokenDoPedido, ondeEsta: salaDaConta, limitarOrigem: telemetria.limitarOrigem });

// Em que sala uma conta está agora, para a presença dos amigos. "Uma conta, uma conexão"
// (substituirConexoesAntigas): ela está em uma sala só.
function salaDaConta(contaId) {
  for (const [sala, membros] of roomMembers) {
    for (const membro of membros.values()) {
      if (membro.contaId !== contaId) continue;
      return { sala, pessoas: salas.pessoas(sala), trancada: Boolean(configuracaoPorSala.get(sala)?.trancada), desde: membro.desde || null };
    }
  }
  return null;
}
// Quem tem conta numa sala: é a presença dessas pessoas que muda quando a sala muda.
const contasNaSala = sala => [...new Set([...(roomMembers.get(sala)?.values() || [])].map(m => m.contaId).filter(Boolean))];
// Preferências temporárias da sala. Como chat e moderação, desaparecem quando a última
// pessoa sai. A aprovação usa a identidade privada da sessão, nunca o nome exibido.
const configuracaoPorSala = new Map();
const pedidosDeEntradaPorSala = new Map();
const aprovadosPorSala = new Map();
const identidadesConhecidasPorSala = new Map();
const configuracaoPadrao = () => ({ trancada: false, compartilharTela: true, soundboard: true, musica: true, estudio: true });
function configuracaoDaSala(sala) {
  if (!configuracaoPorSala.has(sala)) configuracaoPorSala.set(sala, configuracaoPadrao());
  return configuracaoPorSala.get(sala);
}
function pedidosDaSala(sala) {
  if (!pedidosDeEntradaPorSala.has(sala)) pedidosDeEntradaPorSala.set(sala, new Map());
  return pedidosDeEntradaPorSala.get(sala);
}
// A fila de entrada é assunto de quem modera. Mandá-la para a sala inteira entregava a todos
// o nome de quem está do lado de fora -- alguém que nem foi aceito ainda, e que pode acabar
// recusado. O cliente já descartava o evento para os demais; o que faltava era não enviá-lo.
function avisarQuemModera(sala, evento, dados) {
  for (const [socketId, membro] of roomMembers.get(sala) || []) {
    if (moderacao.pode(sala, membro.identidade, 'expulsar')) io.to(socketId).emit(evento, dados);
  }
}
function aprovadosDaSala(sala) {
  if (!aprovadosPorSala.has(sala)) aprovadosPorSala.set(sala, new Set());
  return aprovadosPorSala.get(sala);
}
function identidadesConhecidasDaSala(sala) {
  if (!identidadesConhecidasPorSala.has(sala)) identidadesConhecidasPorSala.set(sala, new Set());
  return identidadesConhecidasPorSala.get(sala);
}
// Quem já esteve nesta sala volta sem pedir: pela identidade (a oscilação de rede) ou pela
// conta (o F5, que troca a identidade). Consultar não cria estado para um código qualquer.
function jaEsteveNaSala(sala, { identidade, contaId }) {
  const conhecidas = identidadesConhecidasPorSala.get(sala);
  return Boolean(conhecidas && (conhecidas.has(identidade) || (contaId && conhecidas.has(`conta:${contaId}`))));
}
// A tranca vale enquanto a sala existe -- inclusive nos 60 segundos em que ela espera vazia,
// senão bastava o dono dar F5 sozinho para qualquer um com o link entrar sem pedir.
const salaComGente = sala => Boolean(roomMembers.get(sala)?.size) || salas.emCarencia(sala);

// "Ainda não abriu" e "já fechou" são o mesmo estado (salas.js), e a mesma frase serve aos
// dois -- inclusive ao caso mais comum: quem abriu o link antes de quem convidou.
const MENSAGEM_SALA_FECHADA = 'A sala ainda não foi aberta. Assim que alguém com conta entrar, você entra junto.';
// A regra 4 do banimento: quem é barrado por um nome que também pode ser de outra pessoa
// recebe a saída, e não só a parede.
const MENSAGEM_NOME_BARRADO = 'Esse nome foi barrado nesta sala. Se não é você quem foi removido, entre com a sua conta.';
// Um build por sistema, todos opcionais: o Windows é compilado aqui, e os outros vêm de onde
// houver macOS e Linux para compilá-los (o electron-builder não gera .dmg no Windows) -- e o
// Android de onde houver o SDK (android/, docs/android.md). Quem só tem o .exe na pasta continua
// servindo só o .exe, e a página mostra o que existe. As fichas de atualização (latest.yml) que o
// electron-builder escreve ao lado dos instaladores saem pela mesma pasta.
const pastaDosBuilds = path.join(__dirname, 'app', 'dist');
require('./desktop-download')(app, {
  'windows-instalador': path.join(pastaDosBuilds, 'Nexo-Setup.exe'),
  windows: path.join(pastaDosBuilds, 'SalaCompartilhada.exe'),
  linux: path.join(pastaDosBuilds, 'Nexo.AppImage'),
  'linux-deb': path.join(pastaDosBuilds, 'Nexo.deb'),
  mac: path.join(pastaDosBuilds, 'Nexo.dmg'),
  android: path.join(pastaDosBuilds, 'Nexo.apk')
}, { permitir: req => telemetria.limitarOrigem(req), versoes: path.join(pastaDosBuilds, 'versao.json'), atualizacoes: pastaDosBuilds });
app.use('/api/soundboard', telemetria.soundboardHttp);

app.get('/vendor/livekit-client.js', (_req, res) => res.sendFile(path.join(__dirname, 'node_modules/livekit-client/dist/livekit-client.umd.js')));
app.get('/vendor/livekit-LICENSE', (_req, res) => res.sendFile(path.join(__dirname, 'node_modules/livekit-client/LICENSE')));
app.get('/vendor/rnnoise-sync.js', (_req, res) => res.sendFile(path.join(__dirname, 'node_modules/@jitsi/rnnoise-wasm/dist/rnnoise-sync.js')));
app.get('/vendor/rnnoise-LICENSE', (_req, res) => res.sendFile(path.join(__dirname, 'node_modules/@jitsi/rnnoise-wasm/LICENSE')));
// A porta de entrada decide quem é: com conta, o início (amigos, conversas, salas recentes); sem,
// a apresentação de sempre. Antes do `static`, que serviria o index.html em `/` sem perguntar. A
// apresentação continua em `/sobre` para quem tem conta, e a resposta não fica em cache de
// ninguém -- ela depende de quem pediu.
app.get(['/', '/index.html'], (req, res) => {
  res.set('Cache-Control', 'no-store');
  const comConta = Boolean(rotasDeContas.sessaoDoPedido(req, res));
  res.sendFile(path.join(__dirname, 'public', comConta ? 'inicio.html' : 'index.html'));
});
app.get('/sobre', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
// A imagem de uma mensagem direta (social.js): só na memória, e só para os dois da conversa -- a
// sessão da conta é conferida a cada pedido, e o id não se adivinha. A entrega é a das imagens da
// conta (contas/rotas.js): tipo conferido pelos bytes, `nosniff` e uma CSP que não deixa nada
// rodar. O cache é privado: é a conversa de duas pessoas, e não uma imagem pública.
app.get('/api/social/imagem/:id', (req, res) => {
  if (!telemetria.limitarOrigem(req, 'imagem')) return res.status(429).set('Retry-After', '60').end();
  const achada = rotasDeContas.sessaoDoPedido(req, res);
  const imagem = achada && social?.imagemPara(achada.conta.id, String(req.params.id || ''));
  if (!imagem) return res.status(404).end();
  res.set({
    'Content-Type': imagem.tipo, 'Content-Length': String(imagem.bytes.length),
    'Cache-Control': 'private, max-age=259200, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin'
  });
  res.end(imagem.bytes);
});
// O que chegou para a conta, para o aplicativo Android notificar com a página parada
// (social.js, `avisosPara`; android/…/AvisosJob.java). Só leitura, pelo cookie da sessão.
app.get('/api/social/avisos', (req, res) => {
  if (!telemetria.limitarOrigem(req, 'social-avisos')) return res.status(429).set('Retry-After', '60').end();
  res.set('Cache-Control', 'no-store');
  const achada = rotasDeContas.sessaoDoPedido(req, res);
  if (!achada) return res.status(401).json({ error: 'sem-conta' });
  const avisos = social?.avisosPara(achada.conta.id);
  if (!avisos) return res.status(401).json({ error: 'sem-conta' });
  res.json(avisos);
});
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/sala', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sala.html'));
});

app.get('/conta', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'conta.html'));
});

// A página que vai para dentro do OBS (o Estúdio em si é um painel da sala, estudio.js). O link
// não é conferido aqui: a página apresenta-o ao socket `/estudio`, que responde com o estado -- e
// um link inválido recebe a mesma página, que diz o que aconteceu em vez de um 404 seco.
app.get('/obs/:link', (req, res, next) => {
  if (!/^[A-Za-z0-9_-]{8,600}\.[A-Za-z0-9_-]{16,64}$/.test(req.params.link)) return next();
  res.set('Cache-Control', 'no-store');
  // O link carrega o acesso à câmera de alguém: ele não vai de carona para site nenhum.
  res.set('Referrer-Policy', 'no-referrer');
  res.sendFile(path.join(__dirname, 'public', 'obs.html'));
});

// Um código que nenhuma sala pode ter cai na página de "não encontrada", e não numa sala que
// só descobriria o problema depois do nome digitado, com um "código inválido" seco.
const CODIGO_NO_ENDERECO = /^[a-z0-9_-]{4,32}$/i;
app.get('/:roomCode/sala', (req, res, next) => {
  if (!CODIGO_NO_ENDERECO.test(req.params.roomCode)) return next();
  res.sendFile(path.join(__dirname, 'public', 'sala.html'));
});

// Links antigos continuam funcionando, apontando para a sala unificada.
app.get(['/compartilhar', '/ao-vivo'], (req, res) => res.redirect('/sala'));
app.get(['/:roomCode/compartilhar', '/:roomCode/ao-vivo'], (req, res, next) => {
  if (!CODIGO_NO_ENDERECO.test(req.params.roomCode)) return next();
  res.redirect(`/${req.params.roomCode}/sala`);
});

// A pagina precisa de tres coisas para entrar na sala: o endereco do servidor de midia,
// um token que autoriza AQUELA sala, e o endereco publico para o convite.
//
// O token e emitido aqui e ja carrega sala, identidade, permissoes e prazo. O navegador
// nao escolhe nada disso, e o segredo que o assina nunca sai desta maquina.
app.get('/api/sala-config', (req, res) => {
  const sala = String(req.query.sala || '').toLowerCase();
  // Com conta, o apelido da conta vence o campo de nome: é ele que a pessoa escolheu para ser
  // reconhecida, e deixá-lo trocar a cada entrada desfaria o motivo de ter um.
  const naConta = rotasDeContas.sessaoDoPedido(req, res);
  const conta = naConta?.conta || null;
  const nomeEscolhido = conta ? conta.apelido : String(req.query.nome || 'Convidado').trim().slice(0, 40);
  const nome = nomeQueNaoSeFingeDeBot(nomeEscolhido || 'Convidado');
  if (!/^[a-z0-9_-]{4,32}$/.test(sala)) return res.status(400).json({ error: 'Codigo de sala invalido.' });

  let publicUrl = null;
  try {
    const configured = new URL(process.env.PUBLIC_URL);
    if (['https:', 'http:'].includes(configured.protocol)) publicUrl = configured.origin;
  } catch (_) { /* Without configuration, invite links use the browser's origin. */ }

  // Banido não recebe credencial nem token, e esta é a metade que faltava.
  //
  // Recusar só no `join-room` deixava um furo que apareceu no teste: o cliente pede a
  // configuração, entra no servidor de MÍDIA com o token que recebeu, e só então pede a
  // entrada na sinalização -- que era recusada. O resultado era alguém fora do chat e
  // DENTRO da mídia, aparecendo na lista de todo mundo como um par sem nome na sala.
  //
  // Conta e nome são conhecidos antes de existir sessão ou identidade, e é por eles que o
  // banimento acerta: a conta para quem tem uma, o nome só para anônimos (ver moderacao.js).
  const castigo = moderacao.banido(sala, { contaId: conta?.id || null, nome });
  if (castigo) {
    // O `motivo` existe para o cliente distinguir esta recusa das outras: sem ele a página
    // cai no "não foi possível preparar a entrada, recarregue" -- que manda a pessoa fazer
    // exatamente o que não vai funcionar, e esconde o único dado útil, o prazo.
    if (castigo.porNome) return res.status(403).json({ error: MENSAGEM_NOME_BARRADO, motivo: 'nome-barrado' });
    return res.status(403).json({ error: `Você foi removido desta sala. Tente novamente em ${castigo.minutos} min.`, motivo: 'removido' });
  }

  // Só uma conta abre a sala. Quem chega a um código que não está aberto, sem conta, espera --
  // e esperar não cria sessão, nem estado, nem nada que um robô varrendo códigos pudesse
  // fazer crescer. A página pergunta de novo a cada cinco segundos.
  const acesso = salas.acesso(sala, { temConta: Boolean(conta) });
  if (acesso === 'espera') {
    if (!telemetria.limitarOrigem(req, 'sala-espera')) return res.status(429).set('Retry-After', '30').json({ error: 'Muitos pedidos. Aguarde um pouco.' });
    return res.status(403).json({ error: MENSAGEM_SALA_FECHADA, motivo: 'sala-fechada', publicUrl });
  }
  if (acesso === 'lotado') return res.status(503).json({ error: 'O servidor atingiu o número máximo de salas abertas. Tente daqui a pouco.', motivo: 'lotado' });

  const preparada = telemetria.prepararSessao(req, res, sala, nome, conta ? { id: conta.id, perfil: perfilNaSala(conta) } : null);
  if (!preparada) return;
  const { sessao, credencial: credencialSessao } = preparada;
  const identidade = sessao.identidade;
  res.set('Cache-Control', 'no-store');
  // O plano vai para a página, que mostra o cadeado e não pede o que ele não libera. Quem
  // confere de verdade é `conferirTela`, aqui no servidor.
  const nivel = nivelDaSessao(sessao);
  const plano = planoPublico(nivel);
  if (!cabeNaSala(sala, { identidade, nivel })) {
    return res.status(403).json({ error: MENSAGEM_SALA_CHEIA(), motivo: 'sala-cheia', publicUrl });
  }

  // Consultar uma sala inexistente não cria estado permanente: bots varrendo códigos não
  // podem fazer estes mapas crescerem. O estado só nasce quando alguém efetivamente entra.
  const configuracao = configuracaoPorSala.get(sala) || configuracaoPadrao();
  const jaEstaDentro = Array.from(roomMembers.get(sala)?.values() || []).some(m => m.identidade === identidade);
  const podeRetomar = jaEsteveNaSala(sala, { identidade, contaId: conta?.id || null });
  if (configuracao.trancada && salaComGente(sala) && !jaEstaDentro && !podeRetomar && !aprovadosDaSala(sala).has(identidade)) {
    const pedidos = pedidosDaSala(sala);
    const anterior = pedidos.get(identidade);
    if (anterior?.estado === 'recusado') {
      return res.status(403).json({ error: 'Seu pedido de entrada não foi aceito.', motivo: 'recusado', identidade, credencialSessao, publicUrl });
    }
    // Quem espera repergunta a cada dois segundos. Reanunciar o mesmo pedido a cada resposta
    // enchia a sala inteira de eventos idênticos enquanto a pessoa estivesse na fila; o
    // anúncio é do pedido NOVO, e o cliente já mantém o que está pendente na tela.
    const pedido = anterior || { identidade, nome, em: Date.now(), estado: 'aguardando' };
    if (!anterior) {
      pedidos.set(identidade, pedido);
      avisarQuemModera(sala, 'pedido-entrada', pedido);
    }
    return res.status(423).json({ error: 'A sala está trancada. Aguardando aprovação.', motivo: 'aguardando', identidade, credencialSessao, publicUrl });
  }

  if (!sfu.estado.ativo) {
    return res.status(503).json({ error: 'servidor-de-midia-indisponivel', motivo: sfu.estado.motivo, publicUrl, identidade, nome, plano, credencialSessao });
  }

  // A retomada agora apresenta uma credencial privada da sessão. O sufixo visível aos
  // pares continua estável, mas conhecê-lo não permite assumir a sessão de outra pessoa.
  // Uma credencial com prazo nao pode ficar em cache de proxy nenhum.
  res.set('Cache-Control', 'no-store');
  // `webcodecs` é a chave do servidor para o caminho novo da tela. Vai em toda credencial, e
  // não só na primeira: cada volta de uma queda pede credencial nova, e é por ela que quem
  // estava fora do ar quando a chave mudou fica sabendo.
  res.json({ url: enderecoDoSfu(req), token: sfu.criarToken(sala, identidade, nome), identidade, nome, plano, publicUrl, credencialSessao, webcodecs: chaveDeWebCodecs.ligado() });
});

// O que a sala vê de quem tem conta: cor, marca e o código permanente. O id da conta nunca
// entra aqui -- ele não sai do servidor.
function perfilNaSala(conta) {
  const { cor, marca, avatar, rosto } = contas.perfil(conta);
  // O rosto do Estúdio vai junto, como a foto: é público por escolha da pessoa, e é daqui que o
  // painel do Estúdio de quem está na sala e as fontes do OBS o leem. O cartão também (a vitrine
  // efetiva, a frase do status e as conquistas ganhas, public/vitrine.js): é o que a sala mostra
  // quando alguém clica na pessoa.
  //
  // O `status` (disponível, ausente, não incomodar, invisível) é o ponto ao lado do nome na lista da
  // sala. Quem está na mesma sala já se vê ali, então ele não revela onde ninguém está: só diz como a
  // pessoa quer ser tratada (a de "não incomodar" não quer ser chamada). Fora da sala continua sendo
  // assunto da presença, que só os amigos veem (social.js). Mudar o status chega aqui por
  // `aplicarPerfilNasSalas`, como a foto: a sala inteira vê na hora, e quem entra depois já o recebe.
  return { conta: true, codigo: formatarCodigo(conta.codigo), cor, marca, avatar, rosto, status: contas.socialDe(conta.id).status, cartao: contas.cartaoPublico(conta) };
}

// O endereço público configurado, para os convites e os links do OBS. Sem configuração, cada
// página usa a própria origem.
function origemPublica() {
  try {
    const configurado = new URL(process.env.PUBLIC_URL);
    if (['https:', 'http:'].includes(configurado.protocol)) return configurado.origin;
  } catch (_) { /* sem PUBLIC_URL */ }
  return null;
}

// ---------- Uma conta, uma conexão ----------
//
// A mesma conta entrou numa sala por outro aparelho (ou outra aba): a conexão mais antiga
// sai, nesta sala ou em qualquer outra. Duas conexões da mesma conta eram a mesma pessoa
// aparecendo duas vezes -- duas vozes, dois quadradinhos, o notebook esquecido aberto no
// quarto ouvindo a chamada que ela já tinha levado para o celular.
//
// Fica de fora a MESMA sessão voltando por um socket novo (uma oscilação de rede): a
// identidade é a mesma, e quem cuida dela é `sessoes.associar`, que já troca o socket.
// Anônimos também: sem conta, não há como saber que duas abas são a mesma pessoa.
//
// A saída é a da moderação -- motivo, depois o socket, depois o servidor de mídia --, e pelo
// mesmo motivo: fechar o socket junto com o aviso corta o aviso antes de ele sair.
function substituirConexoesAntigas(socket, sessao, salaNova) {
  if (!sessao.contaId) return;
  for (const [sala, membros] of roomMembers) {
    for (const [socketId, membro] of membros) {
      if (membro.contaId !== sessao.contaId || socketId === socket.id || membro.identidade === sessao.identidade) continue;
      const antigo = io.sockets.sockets.get(socketId);
      if (antigo) {
        antigo.leave(roomName(sala));
        antigo.emit('removido-da-sala', { motivo: 'outra-conexao', mesmaSala: sala === salaNova });
        setTimeout(() => { try { antigo.disconnect(true); } catch (_) { /* já saiu por conta própria */ } }, MS_ATE_FECHAR_O_SOCKET);
      }
      if (membro.identidade) sfu.consultar('RemoveParticipant', { room: sala, identity: membro.identidade }).catch(() => {});
    }
  }
}

// O perfil mudou -- pelo painel da sala ou pela página da conta, em outra aba. Quem está numa
// sala com essa conta passa a aparecer do jeito novo para todo mundo, na hora. Antes o perfil
// "valia na próxima vez que você entrar numa sala": trocar a cor pedia sair da chamada.
//
// O nome muda em quatro lugares, e cada um tem o seu motivo: o membro (é dele que o chat e a
// música tiram o autor), a sessão (é ela que uma reconexão apresenta), a moderação (é o nome
// que um banimento passaria a barrar) e o servidor de mídia (é de lá que quem chegar depois
// lê o nome -- o antigo estava gravado no token da entrada).
function aplicarPerfilNasSalas(conta) {
  const nome = nomeQueNaoSeFingeDeBot(conta.apelido);
  const perfil = perfilNaSala(conta);
  for (const [roomCode, membros] of roomMembers) {
    for (const [socketId, membro] of membros) {
      if (membro.contaId !== conta.id) continue;
      membro.name = nome;
      membro.perfil = perfil;
      const sessao = io.sockets.sockets.get(socketId)?.data.sessaoNexo;
      if (sessao) { sessao.nome = nome; sessao.perfil = perfil; }
      moderacao.renomear(roomCode, membro.identidade, nome);
      if (membro.identidade) sfu.consultar('UpdateParticipant', { room: roomCode, identity: membro.identidade, name: nome }).catch(() => {});
      io.to(roomName(roomCode)).emit('peer-perfil', { identidade: membro.identidade, name: nome, perfil });
      // Os rostos no OBS também: a foto nova aparece na cena sem ninguém recarregar a fonte.
      estudio.mudouSala(roomCode);
    }
  }
  // E os amigos, onde estiverem: o cartão e a lista deles mostram o perfil novo.
  social?.mudouPerfil(conta.id);
}

// Quem desistiu na tela de espera precisa sumir da fila imediatamente. `keepalive` permite
// que este DELETE termine inclusive quando o clique já está levando o navegador de volta
// para a página inicial.
app.delete('/api/sala-pedido', (req, res) => {
  const sala = String(req.query.sala || '').toLowerCase();
  const sessao = telemetria.sessoes.obter(req.headers['x-nexo-sessao']);
  if (!/^[a-z0-9_-]{4,32}$/.test(sala) || !sessao || sessao.sala !== sala) return res.status(403).end();
  const pedidos = pedidosDeEntradaPorSala.get(sala);
  if (pedidos?.delete(sessao.identidade)) {
    if (!pedidos.size) pedidosDeEntradaPorSala.delete(sala);
    avisarQuemModera(sala, 'pedido-entrada-cancelado', { identidade: sessao.identidade });
  }
  res.status(204).end();
});

// A identidade de midia e `nome#sufixo`, e a do bot de musica e `nexo-dj#sala`. Quem se
// chamasse "nexo-dj" produziria uma identidade com o MESMO prefixo -- e a sala passaria a
// tratar essa pessoa como o bot: sem controle de microfone, com cara de robo na lista e
// com os comandos de musica respondendo por ela. Um sufixo no nome resolve sem recusar a
// entrada de ninguem.
// A página do OBS tem a mesma questão: `nexo-estudio#...` é a identidade oculta dela, e o
// servidor de mídia aceita essa identidade pela porta do Estúdio (telemetria/index.js).
function nomeQueNaoSeFingeDeBot(nome) {
  const reservados = [musica.PREFIXO_DA_IDENTIDADE, PREFIXO_DO_ESTUDIO].map(prefixo => prefixo.replace('#', ''));
  return reservados.includes(nome.toLowerCase()) ? `${nome} (pessoa)` : nome;
}

// O cliente acrescenta "/rtc" sozinho, entao aqui vai so a origem -- a MESMA que serviu a
// pagina. Assim a sinalizacao herda o HTTPS do tunel, sem porta nem certificado extra.
// Serve também ao pedido cru do socket do Estúdio, que não passou pelo Express e não tem
// `req.protocol`: ali o protocolo vem de a conexão ser ou não cifrada.
function enderecoDoSfu(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const protocolo = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || req.protocol || (req.socket?.encrypted ? 'https' : 'http');
  return `${protocolo === 'https' ? 'wss' : 'ws'}://${host}`;
}


const TOKEN_VALIDO = /^[a-f0-9]{16,64}$/i;

// A configuracao do agente viaja no NOME do arquivo, nunca dentro dele. Modificar bytes de
// um executavel ja compilado faz o Windows Defender barrar o download como
// Trojan:Win32/Wacatac!ml. Entregando o arquivo sem tocar em nada, todo mundo recebe
// exatamente o mesmo binario -- o que ajuda, mas nao basta: por ser pequeno, sem assinatura
// e capturar audio, o binario ja foi marcado assim mesmo intacto. Ver o aviso de antivirus
// no README (metadados de versao, ganho de reputacao e envio de falso positivo).
app.get('/api/agente', (req, res) => {
  if (!telemetria.limitarOrigem(req)) return res.status(429).set('Retry-After', '60').end();
  const token = String(req.query.token || '');
  if (!TOKEN_VALIDO.test(token)) return res.status(400).send('Token invalido.');
  if (!fs.existsSync(AGENTE_PATH)) {
    return res.status(503).send('O agente ainda nao foi compilado neste servidor. Rode "npm start".');
  }

  // Atras de um tunel o protocolo real vem no cabecalho; sem ele, e a conexao direta.
  const hospedeiro = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`).split(',')[0].trim();
  if (!/^[a-z0-9.\-]+(:\d+)?$/i.test(hospedeiro)) return res.status(400).send('Endereco invalido.');

  // ':' nao e valido em nome de arquivo no Windows, entao a porta viaja como '_'.
  const hostNoNome = hospedeiro.replace(':', '_');
  const nome = `AgenteAudio${MARCADOR_NOME_CONFIG}${token}-${hostNoNome}.exe`;

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  fs.createReadStream(AGENTE_PATH).pipe(res);
  console.log('Agente de áudio baixado.');
});

// ---------- Mesa de sons ----------
//
// O arquivo sobe e desce por HTTP, nao pela sinalizacao. Sao alguns megabytes por som: se
// passassem pelo Socket.IO, empurrariam para tras o chat, os avisos de entrada e saida e
// o estado das midias -- que sao pequenos, mas dependem de chegar na hora. Por HTTP o
// download ainda ganha cache do navegador, entao cada um baixa cada som uma vez so.
const CODIGO_DE_SALA = /^[a-z0-9_-]{4,32}$/;

// A credencial privada foi conferida antes de ler o corpo. Esta consulta confirma que
// o socket autenticado continua na sala, inclusive depois de converter o áudio.
function socketEstaNaSala(socketId, roomCode) {
  return Boolean(socketId) && socketRoomCodes.get(String(socketId)) === roomCode;
}

function nomeDoSocket(socketId) {
  const roomCode = socketRoomCodes.get(String(socketId));
  return roomMembers.get(roomCode)?.get(String(socketId))?.name || 'Alguém';
}

app.post('/api/soundboard/:sala', express.raw({ type: '*/*', limit: soundboard.BYTES_MAXIMOS_DO_SOM }), async (req, res, next) => {
  const sala = String(req.params.sala || '').toLowerCase();
  if (!CODIGO_DE_SALA.test(sala)) return res.status(400).json({ error: 'Código de sala inválido.' });
  const socketId = req.sessaoNexo.socket?.id;
  if (!socketEstaNaSala(socketId, sala)) return res.status(403).json({ error: 'Entre na sala antes de enviar sons.' });
  const membro = roomMembers.get(sala)?.get(String(socketId));
  // Enviar um som é pôr conteúdo na sala de todo mundo, e isso pede conta (grátis basta). É
  // a mesma lógica de abrir a sala: quem cria algo ali é alguém que o servidor reconhece.
  // Tocar os sons que já estão na mesa continua livre.
  if (!membro?.contaId) {
    return res.status(403).json({ error: 'Enviar sons para a mesa exige uma conta grátis. Tocar os que já estão aqui continua livre.', motivo: 'sem-conta' });
  }
  if (!configuracaoDaSala(sala).soundboard && membro?.identidade !== moderacao.dono(sala)) {
    return res.status(403).json({ error: 'A mesa de sons foi restringida por quem abriu a sala.' });
  }

  req.processandoUpload = true;
  try {
  const { erro, som, cortado } = await soundboard.adicionar(sala, {
    nome: req.query.nome,
    tipo: req.headers['content-type'],
    bytes: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
    porQuem: nomeDoSocket(socketId),
    // Só para saber se vale avisar "cortei": o corte em si é do ffmpeg, que não pergunta
    // a ninguém quanto tempo o arquivo tem.
    segundos: req.query.segundos
  });
  if (erro) return res.status(400).json({ error: erro });
  if (!socketEstaNaSala(socketId, sala)) {
    soundboard.remover(sala, som.id);
    return res.status(403).json({ error: 'A sessão saiu da sala durante o envio.' });
  }

  io.to(roomName(sala)).emit('soundboard-lista', { sons: soundboard.listar(sala), espaco: soundboard.espacoDaSala(sala) });
  res.json({ ok: true, som, cortado });
  } catch (erro) { next(erro); }
  finally { req.terminarUpload?.(); }
});

app.get('/api/soundboard/:sala/:id', (req, res) => {
  const sala = String(req.params.sala || '').toLowerCase();
  if (!CODIGO_DE_SALA.test(sala)) return res.status(400).end();
  const som = soundboard.obter(sala, req.params.id);
  if (!som) return res.status(404).end();
  if (!telemetria.downloadPermitido(req, res, som.tamanho)) return;

  res.setHeader('Content-Type', som.tipo);
  res.setHeader('Content-Length', som.tamanho);
  // O identificador e sorteado e o conteudo nunca muda, entao o navegador pode guardar sem
  // perguntar de novo -- e o que faz o disparo ser imediato depois da primeira vez.
  res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
  // O arquivo veio de alguem da sala: o navegador nao deve tentar interpreta-lo como outra
  // coisa por causa do nome ou do conteudo.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(som.bytes);
});
app.use('/api/soundboard', (erro, req, res, _next) => {
  req.terminarUpload?.();
  if (!res.headersSent) res.status(erro.type === 'entity.too.large' ? 413 : 400).json({ error: 'Não foi possível receber o som.' });
});

// ---------- Nenhuma rota respondeu ----------
//
// Última rota registrada, e por isso a última a rodar. Antes era o "Cannot GET /x" do Express:
// uma linha em inglês, sem marca e sem saída, justamente para quem colou um convite cortado.
// Quem pediu uma página recebe a do Nexo, que diz o que aconteceu e oferece o caminho de volta;
// quem pediu dado (uma API, um arquivo) recebe um 404 curto, que é o que um programa sabe ler.
const PAGINA_NAO_ENCONTRADA = path.join(__dirname, 'public', '404.html');
app.use((req, res) => {
  res.status(404);
  if (req.path.startsWith('/api/')) return res.json({ error: 'Não encontrado.' });
  if (!['GET', 'HEAD'].includes(req.method) || !req.accepts('html')) return res.type('text').send('Não encontrado.');
  res.set('Cache-Control', 'no-store');
  res.sendFile(PAGINA_NAO_ENCONTRADA);
});

// Chat da sala. Fica na conexao de sinalizacao, que ja existe e passa o tempo todo ociosa:
// vídeo e voz passam pelo SFU e não encostam nisso. O histórico serve para quem entra
// depois nao achar a sala muda, e vive so na memoria -- some quando a sala esvazia.
const HISTORICO_MAXIMO = 80;
const BYTES_MAXIMOS_DO_HISTORICO = 6 * 1024 * 1024;
const TAMANHO_MAXIMO_DO_TEXTO = 2000;
const TAMANHO_MAXIMO_DA_IMAGEM = 820 * 1024;
// Quantos emojis diferentes uma mensagem do chat aceita como reação.
const REACOES_DIFERENTES_POR_MENSAGEM = 20;
const IMAGEM_VALIDA = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const historicoPorSala = new Map();

const tamanhoDaMensagem = (m) => (m.texto ? m.texto.length : 0) + (m.imagem ? m.imagem.length : 0);

function guardarNoHistorico(roomCode, msg) {
  const lista = historicoPorSala.get(roomCode) || [];
  lista.push(msg);
  while (lista.length > HISTORICO_MAXIMO) lista.shift();
  // Imagens sao pesadas: alem do limite de mensagens ha um teto de bytes, senao algumas
  // capturas de tela coladas no chat prenderiam dezenas de MB por sala.
  let bytes = lista.reduce((soma, m) => soma + tamanhoDaMensagem(m), 0);
  while (bytes > BYTES_MAXIMOS_DO_HISTORICO && lista.length > 1) bytes -= tamanhoDaMensagem(lista.shift());
  historicoPorSala.set(roomCode, lista);
}
// A mensagem guarda, só aqui, a conta de quem escreveu: é o que deixa quem tem conta editar a
// própria mensagem depois de recarregar a página, quando a identidade já é outra. Ela nunca
// viaja -- toda mensagem que sai do servidor passa por aqui antes.
function mensagemPublica(mensagem) {
  const { autorConta, ...publica } = mensagem;
  return publica;
}
// O canal de musica tem historico proprio, e bem menor: ali as mensagens sao pedidos e
// respostas do bot, que envelhecem rapido. Quem entra no meio quer ver o que esta tocando
// -- e isso vem no estado, nao no historico.
const MENSAGENS_DE_MUSICA_NO_HISTORICO = 40;
const historicoDeMusicaPorSala = new Map();

const socketRoomCodes = new Map();
const audioCaptureProcesses = new Map();

// Pareamento agente <-> navegador. E deliberadamente sem estado persistente: o token e
// gerado pelo navegador, guardado no localStorage dele e gravado dentro do executavel.
// Os dois lados se encontram por apresentarem o mesmo token, entao reiniciar o servidor
// nao invalida os agentes ja baixados.
const agentesPorToken = new Map();     // token -> WebSocket
const navegadoresPorToken = new Map(); // token -> socketId
// Porta que o agente abriu em 127.0.0.1 do computador DELE. O navegador daquela pessoa usa
// essa porta para receber o audio direto, sem a volta ate aqui.
const portasLocaisPorToken = new Map(); // token -> porta

function avisarStatusDoAgente(token) {
  const socketId = navegadoresPorToken.get(token);
  if (!socketId) return;
  io.to(socketId).emit('agente-status', { conectado: agentesPorToken.has(token), portaLocal: portasLocaisPorToken.get(token) || null });
}

// Os agentes falam WebSocket puro (bem mais simples de implementar em C++ que o
// protocolo do Socket.IO). Roteamos o upgrade manualmente para nao brigar com o Socket.IO.
const wssAgentes = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

server.on('upgrade', (req, socket, head) => {
  let caminho = '';
  try { caminho = new URL(req.url, 'http://local').pathname; } catch (_) { return; }
  if (caminho !== '/agente') return; // deixa o Socket.IO cuidar do resto

  if (wssAgentes.clients.size >= 128 || !telemetria.limitarOrigem(req, 'conexao')) {
    socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n'); return;
  }

  const token = new URL(req.url, 'http://local').searchParams.get('token') || '';
  if (!TOKEN_VALIDO.test(token)) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }
  wssAgentes.handleUpgrade(req, socket, head, (ws) => {
    ws.tokenDoAgente = token;
    wssAgentes.emit('connection', ws, req);
  });
});

// Ultimo a ser registrado, e por isso o ultimo a rodar: fecha o que ninguem reclamou. Sem
// isto, com destroyUpgrade desligado, um upgrade para um caminho desconhecido ficaria aberto
// consumindo uma conexao ate o sistema operacional desistir.
server.on('upgrade', (req, socket) => {
  if (socket.destroyed || socket.bytesWritten > 0 || socket.writableEnded) return;
  let caminho = '';
  try { caminho = new URL(req.url, 'http://local').pathname; } catch (_) { /* Caminho ilegível: fecha. */ }
  if (caminho === '/agente' || caminho === '/rtc' || caminho.startsWith('/rtc/') || caminho.startsWith('/socket.io')) return;
  socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
});

wssAgentes.on('connection', (ws) => {
  const token = ws.tokenDoAgente;
  const anterior = agentesPorToken.get(token);
  if (anterior && anterior !== ws) anterior.terminate();
  agentesPorToken.set(token, ws);
  console.log('Agente de áudio conectado.');
  avisarStatusDoAgente(token);

  ws.on('message', (dados, ehBinario) => {
    const navegador = io.sockets.sockets.get(navegadoresPorToken.get(token));
    if (!telemetria.agentePermitido(token, dados, ehBinario, navegador)) { ws.close(1008, 'Limite temporário de áudio'); return; }
    if (ehBinario) {
      // PCM do computador do participante -> navegador dele, no mesmo formato que o
      // caminho local ja usa (44100 Hz, estereo, 16 bits). So faz sentido com um
      // navegador do outro lado; sem ele o audio nao tem destino.
      const socketId = navegadoresPorToken.get(token);
      if (socketId) io.to(socketId).emit('audio-data', dados);
      return;
    }
    // As mensagens de controle NAO podem depender de haver navegador registrado: o
    // agente e aberto antes de a pessoa entrar na sala, e e logo ao conectar que ele
    // informa a porta local. Exigir o navegador aqui fazia esse anuncio se perder, e a
    // conexao direta nunca era usada.
    try {
      const mensagem = JSON.parse(dados.toString());
      // Lista de aplicativos com audio, para a pessoa escolher qual nao transmitir.
      if (mensagem.evento === 'aplicativos' && Array.isArray(mensagem.lista)) {
        const destino = navegadoresPorToken.get(token);
        if (destino) io.to(destino).emit('agente-aplicativos', {
          lista: mensagem.lista.slice(0, 40),
          atual: String(mensagem.atual || '').slice(0, 120),
          modo: ['incluir', 'excluir', 'excluir-pid', 'incluir-pid'].includes(mensagem.modo) ? mensagem.modo : undefined
        });
      }
      if (mensagem.evento === 'porta-local' && Number.isInteger(mensagem.porta) && mensagem.porta > 0 && mensagem.porta < 65536) {
        portasLocaisPorToken.set(token, mensagem.porta);
        avisarStatusDoAgente(token);
      }
      if (mensagem.evento === 'erro') {
        const socketId = navegadoresPorToken.get(token);
        if (socketId) io.to(socketId).emit('audio-error', `Agente: ${mensagem.mensagem || 'falha'}`);
      }
    } catch (_) { /* mensagem de controle malformada e ignorada */ }
  });

  ws.on('close', () => {
    if (agentesPorToken.get(token) === ws) {
      agentesPorToken.delete(token);
      portasLocaisPorToken.delete(token);
      console.log('Agente de áudio desconectado.');
      avisarStatusDoAgente(token);
    }
  });
  ws.on('error', () => ws.terminate());
});

// Nome de executavel aceitavel. Fechado de proposito: esse valor vira argumento de um
// processo nativo, entao nada de caminho, aspas ou espaco esquisito.
const EXECUTAVEL_VALIDO = /^[A-Za-z0-9._+-]{1,60}\.exe$/;

// A escolha de audio de uma pessoa. Tres modos, e so estes:
//   excluir      todo o som, menos um programa (vazio = o navegador dela)
//   incluir      SOMENTE o som de um programa
//   excluir-pid  todo o som, menos a arvore de um PID -- o modo do aplicativo proprio
const MODOS_DE_AUDIO = ['excluir', 'incluir', 'excluir-pid', 'incluir-pid'];

function escolhaLimpa(bruta) {
  const dados = bruta && typeof bruta === 'object' ? bruta : {};
  const modo = MODOS_DE_AUDIO.includes(dados.modo) ? dados.modo : 'excluir';
  const executavel = String(dados.executavel || '').slice(0, 120);
  const pid = Number(dados.pid);
  if (executavel && !EXECUTAVEL_VALIDO.test(executavel)) return null;
  // PID vem de um processo que existe de verdade: inteiro positivo e dentro da faixa.
  if (['excluir-pid', 'incluir-pid'].includes(modo) && (!Number.isInteger(pid) || pid <= 0 || pid > 0xFFFFFFFF)) return null;
  if (modo === 'incluir' && !executavel) return null;
  return { modo, executavel, pid: ['excluir-pid', 'incluir-pid'].includes(modo) ? pid : 0 };
}

// Pergunta ao helper quais programas tem audio nesta maquina. E o mesmo codigo que o
// agente usa; a diferenca e so quem executa.
function listarAplicativosLocais(familia) {
  const navegador = FAMILIAS_DE_NAVEGADOR[familia] || '';
  return new Promise((resolve) => {
    execFile(HELPER_PATH, ['--listar', navegador].filter(Boolean),
      { windowsHide: true, maxBuffer: 512 * 1024 }, (erro, stdout) => {
        if (erro) return resolve(null);
        try { resolve(JSON.parse(stdout || 'null')); } catch (_) { resolve(null); }
      });
  });
}

// O agente usa a familia para saber qual e o navegador desta pessoa: e ele que fica na
// lista como escolha automatica, mesmo quando nao esta tocando nada.
function familiaLimpa(valor) {
  const f = String(valor || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(FAMILIAS_DE_NAVEGADOR, f) ? f : '';
}

function comandarAgente(token, comando) {
  const ws = agentesPorToken.get(token);
  if (!ws || ws.readyState !== ws.OPEN) return false;
  ws.send(JSON.stringify(comando));
  return true;
}

// O que o servidor sabe do estado de cada pessoa é só o que ela anuncia pela sinalização: o
// status de presença e se está ensurdecida ("sinal-presenca"). Câmera, tela e microfone são as
// publicações da mídia (room-transport.js), e quem precisa delas as lê de lá -- a sala e o
// painel do Estúdio, que roda na sala. Houve aqui um "media-state" que a página deixou de mandar
// quando a mídia passou a ser o LiveKit; guardado, ele dizia "câmera desligada" para sempre.
const estadoPadrao = () => ({ presenca: '', ensurdecido: false });

function roomCodeForSocket(socket) {
  return socketRoomCodes.get(socket.id) || null;
}

function roomName(roomCode) {
  return `room:${roomCode}`;
}


// ---------- Anunciar quem manda ----------
//
// O dono precisa ser conhecido por TODA a sala, não só por ele mesmo: é a lista de
// participantes que mostra o selo, e é ela que decide para quem aparecem as ações de
// moderação. Quem entra recebe no `join-room`; a sala recebe por este aviso quando muda.
//
// A comparação com o anterior existe porque a sucessão dispara em toda saída. Sem ela, cada
// pessoa que saísse da sala mandaria um aviso de dono idêntico ao que já valia.
const donoAnunciado = new Map();

// Tudo o que é de uma sala some quando ela fecha -- 60 segundos depois de esvaziar, e não no
// instante em que a última pessoa sai (salas.js). O histórico do chat, a mesa de sons, o bot
// de música, a configuração e as filas de entrada: nada de uma sala fechada sobrevive, e
// nada disso tocou o disco. Um mapa novo por sala registra a própria limpeza aqui.
salas.aoFechar(sala => {
  historicoPorSala.delete(sala);
  historicoDeMusicaPorSala.delete(sala);
  soundboard.limparSala(sala);
  musica.esquecerSala(sala);
  donoAnunciado.delete(sala);
  configuracaoPorSala.delete(sala);
  pedidosDeEntradaPorSala.delete(sala);
  aprovadosPorSala.delete(sala);
  identidadesConhecidasPorSala.delete(sala);
  tempos.fechou(sala);
  espectadores.fechou(sala);
  moderacao.fechou(sala);
});

// ---------- Quem está vendo cada tela ----------
//
// O que se guarda é o que cada página disse estar vendo (espectadores.js). Se a tela está no ar
// quem sabe é o servidor de mídia, e não este: cada página só põe na lista uma tela que ela vê
// no ar, e a tira quando a tela cai. O filtro daqui é só o de presença -- a lista de uma página
// que caiu fica até o socket dela perceber, e um placar com quem já saiu seria mentira.
function membroPorIdentidade(roomCode, identidade) {
  for (const membro of roomMembers.get(roomCode)?.values() || []) if (membro.identidade === identidade) return membro;
  return null;
}

function placarDaTela(roomCode, dono) {
  return espectadores.de(roomCode, dono).filter(espectador => membroPorIdentidade(roomCode, espectador));
}

function placarDaSala(roomCode) {
  const placar = {};
  for (const dono of espectadores.donos(roomCode)) {
    const lista = placarDaTela(roomCode, dono);
    if (lista.length) placar[dono] = lista;
  }
  return placar;
}

// Para a sala inteira, e não só para quem transmite: como no Discord, qualquer um vê quem mais
// está na mesma tela -- é o que faz um "olha isso aqui" funcionar sem perguntar quem está vendo.
function anunciarEspectadores(roomCode, donos) {
  for (const dono of donos) io.to(roomName(roomCode)).emit('espectadores', { dono, espectadores: placarDaTela(roomCode, dono) });
}

// ---------- Os planos ----------
//
// O que cada nível libera mora em public/planos.js, lido igual pela página e por aqui. A
// página mostra o cadeado; quem CONFERE é o servidor -- limite só no cliente é sugestão, e no
// dia em que resolução é o que se cobra, sugestão não serve.

// O nível vale AGORA: lido da conta a cada pergunta, porque o painel pode ter acabado de
// marcá-la de nível completo e o prazo vence sozinho.
const nivelDaSessao = sessao => (sessao?.contaId ? contas.nivelDaConta(sessao.contaId) : 'anonimo');
// O nível que vale para a TELA: o da conta, ou o completo para todos com os planos desligados.
const nivelDaTela = nivel => (PLANOS_LIGADOS ? nivel : 'completo');
const planoPublico = nivel => ({ nivel: nivelDaTela(nivel), nome: planos.NOMES[nivel], limites: planos.limites(nivelDaTela(nivel)), livre: !PLANOS_LIGADOS });

// O teto de pessoas. Quem entra conta a si mesmo -- um assinante entra numa sala que está no
// teto base, porque é a presença dele que o aumenta --, e quem já está (uma reconexão) nunca
// é barrado por ele. Quando o assinante sai, ninguém é removido.
let recusasPorLotacao = 0;
function cabeNaSala(sala, { identidade, nivel }) {
  const membros = [...(roomMembers.get(sala)?.values() || [])];
  if (membros.some(m => m.identidade === identidade) || identidadesConhecidasPorSala.get(sala)?.has(identidade)) return true;
  const cabe = planos.cabeNaSala({ presentes: salas.pessoas(sala), algumAssinante: membros.some(m => m.completo), entraAssinante: nivel === 'completo' }, PESSOAS_POR_SALA);
  if (!cabe) recusasPorLotacao++;
  return cabe;
}
const MENSAGEM_SALA_CHEIA = () => `A sala está cheia: ${PESSOAS_POR_SALA.base} pessoas. Com alguém de nível completo na sala, o teto sobe para ${PESSOAS_POR_SALA.comAssinante}.`;

// Para o painel: quantas salas encostam no teto é o que diz se os números de partida estão
// certos. `zerar` fecha a janela de um minuto do histórico.
function estadoDoTeto({ zerar = false } = {}) {
  let noTetoBase = 0, cheias = 0;
  for (const [sala, membros] of roomMembers) {
    const pessoas = salas.pessoas(sala);
    if (pessoas >= PESSOAS_POR_SALA.base) noTetoBase++;
    if (pessoas >= planos.tetoDePessoas({ comAssinante: [...membros.values()].some(m => m.completo) }, PESSOAS_POR_SALA)) cheias++;
  }
  const estado = { ...PESSOAS_POR_SALA, salasNoTetoBase: noTetoBase, salasCheias: cheias, recusas: recusasPorLotacao };
  if (zerar) recusasPorLotacao = 0;
  return estado;
}

// O teto de resolução, conferido no servidor contra o que o servidor de mídia registra da
// publicação (a webhook e a reconciliação periódica). Três passos, nesta ordem:
//
//   1. Folga de 10% (planos.js): a captura raramente entrega exatamente 720.
//   2. Avisar primeiro, pelo socket, e dar alguns segundos para republicar menor. É o que um
//      cliente honesto e desatualizado precisa -- o atual já não passa do teto sozinho.
//   3. Só então desligar a faixa, com MutePublishedTrack. Desliga a TELA, não a pessoa: voz,
//      câmera e chat continuam. A câmera já é capturada a 720p e não entra aqui.
//
// O que isto não pega: um cliente modificado que declare 720 e mande 1440. O servidor de mídia
// registra a resolução declarada, e nenhuma API dele mede a que chega. É um limite conhecido.
const avisosDeTela = new Map();   // sid da faixa -> timer
function conferirTela(sessao, faixa) {
  if (!PLANOS_LIGADOS || !sessao || !faixa?.sid || faixa.muda || avisosDeTela.has(faixa.sid)) return;
  const nivel = nivelDaSessao(sessao);
  if (!planos.excedeTeto(nivel, faixa.largura, faixa.altura)) return;
  sessao.socket?.emit('limite-do-plano', { ...planoPublico(nivel), largura: faixa.largura, altura: faixa.altura, segundos: Math.ceil(MS_PARA_AJUSTAR_A_TELA / 1000) });
  const timer = setTimeout(() => {
    desligarTelaSeContinuar(sessao, faixa.sid).catch(() => { /* a próxima reconciliação confere de novo */ })
      .finally(() => avisosDeTela.delete(faixa.sid));
  }, MS_PARA_AJUSTAR_A_TELA);
  timer.unref?.();
  avisosDeTela.set(faixa.sid, timer);
}
async function desligarTelaSeContinuar(sessao, sid) {
  const resposta = await sfu.consultar('ListParticipants', { room: sessao.sala });
  const publicada = (resposta.participants || []).find(p => p.identity === sessao.identidade)?.tracks?.find(t => t.sid === sid);
  // Republicou menor (outra faixa), parou de compartilhar ou já está muda: nada a fazer.
  if (!publicada || publicada.muted) return;
  const nivel = nivelDaSessao(sessao);
  if (!planos.excedeTeto(nivel, dimensaoDaFaixa(publicada, 'width'), dimensaoDaFaixa(publicada, 'height'))) return;
  await sfu.consultar('MutePublishedTrack', { room: sessao.sala, identity: sessao.identidade, track_sid: sid, muted: true });
  sessao.socket?.emit('tela-desligada-pelo-plano', planoPublico(nivel));
}

// O atalho do painel (nível completo à mão, suspender) vale na hora para quem está numa sala: o plano
// novo chega pelo socket, e a conta suspensa sai da sala -- sinalização e mídia.
function agirNaContaPeloPainel(codigo, pedido) {
  const r = contas.agirPeloPainel(codigo, pedido);
  if (!r.ok) return r;
  // As imagens tiradas pelo painel somem das salas na hora, e uma conta suspensa derruba as
  // capturas do OBS que ela criou.
  if (pedido?.acao === 'remover-imagens') { const conta = contas.contaPorId(r.contaId); if (conta) aplicarPerfilNasSalas(conta); }
  estudio.mudouConta(r.contaId);
  const nivel = contas.nivelDaConta(r.contaId);
  const suspensa = Boolean(r.conta.suspensaAte && r.conta.suspensaAte > Date.now());
  for (const membros of roomMembers.values()) {
    for (const membro of membros.values()) if (membro.contaId === r.contaId) membro.completo = nivel === 'completo';
  }
  for (const socket of io.sockets.sockets.values()) {
    const sessao = socket.data.sessaoNexo;
    if (sessao?.contaId !== r.contaId) continue;
    if (!suspensa) { socket.emit('plano-atualizado', planoPublico(nivel)); continue; }
    socket.emit('removido-da-sala', { motivo: 'suspensa' });
    sfu.consultar('RemoveParticipant', { room: sessao.sala, identity: sessao.identidade }).catch(() => {});
    setTimeout(() => { try { socket.disconnect(true); } catch (_) { /* já saiu */ } }, MS_ATE_FECHAR_O_SOCKET);
  }
  return r;
}

// Quanto tempo o aviso de remoção tem para chegar antes de o socket ser fechado. Curto o
// bastante para ninguém continuar na sala de verdade, longo o bastante para uma mensagem
// atravessar a conexão -- ver o comentário no handler de `moderar`.
const MS_ATE_FECHAR_O_SOCKET = 250;

function anunciarDono(roomCode) {
  const atual = moderacao.dono(roomCode);
  if (donoAnunciado.get(roomCode) === atual) return;
  if (atual === null) donoAnunciado.delete(roomCode);
  else donoAnunciado.set(roomCode, atual);
  io.to(roomName(roomCode)).emit('sala-dono', { identidade: atual });
  // Com o OBS restrito na sala, só o dono leva a sala para lá: trocar de dono muda de quem é.
  estudio.mudouSala(roomCode);
}

// O controle da sala sobre o OBS, com a mesma regra dos outros três: vale para os
// participantes, e quem abriu a sala continua podendo.
function estudioPermitidoNaSala(roomCode, identidade) {
  return (configuracaoPorSala.get(roomCode) || configuracaoPadrao()).estudio !== false || identidade === moderacao.dono(roomCode);
}

// O socket de uma identidade, para poder tirá-la da sala. Uma identidade pode ter mais de um
// socket por um instante durante uma reconexão -- todos precisam sair, ou a pessoa expulsa
// continua ouvindo por um deles.
function socketsDaIdentidade(roomCode, identidade) {
  const encontrados = [];
  for (const id of roomMembers.get(roomCode)?.keys() || []) {
    const alvo = io.sockets.sockets.get(id);
    if (alvo?.data.identidadeDeMidia === identidade) encontrados.push(alvo);
  }
  return encontrados;
}

// O helper nativo roda na maquina do servidor. So faz sentido oferece-lo a quem esta
// nessa mesma maquina (o host); para os demais participantes ele capturaria o audio
// errado -- o do host, e nao o deles.
function enderecoEhDestaMaquina(address) {
  if (!address) return false;
  const limpo = String(address).replace(/^::ffff:/, '');
  if (limpo === '127.0.0.1' || limpo === '::1' || limpo === 'localhost') return true;
  return Object.values(os.networkInterfaces())
    .flat()
    .some(iface => iface && iface.address === limpo);
}

// Atras de um proxy/tunel (Cloudflare Tunnel, nginx...) TODAS as conexoes chegam como
// 127.0.0.1, entao o endereco sozinho nao prova nada: sem esta checagem, qualquer
// participante remoto seria tratado como host e acabaria capturando o audio do host.
const CABECALHOS_DE_PROXY = [
  'x-forwarded-for', 'x-real-ip', 'x-forwarded-host', 'x-forwarded-proto',
  'forwarded', 'cf-connecting-ip', 'cf-ray', 'via'
];

// O Host precisa apontar para um endereco desta maquina E para a porta real do servidor.
// Um proxy escuta em outra porta (ou usa um dominio publico), entao nao passa por aqui.
function hostDaRequisicaoEhLocal(headers) {
  const host = String(headers.host || '');
  const comPorta = host.match(/^\[([^\]]+)\]:(\d+)$/) || host.match(/^([^:]+):(\d+)$/);
  if (!comPorta) return false;
  const porta = Number(comPorta[2]);
  if (porta !== Number(PORT)) return false;
  return enderecoEhDestaMaquina(comPorta[1]);
}

function helperCompilado() {
  return fs.existsSync(HELPER_PATH);
}

// Decide, com varias camadas e sempre falhando para o lado seguro, se este participante
// pode usar a captura nativa (ou seja, se ele esta mesmo no computador do servidor).
function diagnosticarHelper(handshake) {
  const headers = (handshake && handshake.headers) || {};
  if (CABECALHOS_DE_PROXY.some(nome => headers[nome])) {
    return { podeUsarHelper: false, motivo: 'atras-de-proxy' };
  }
  if (!enderecoEhDestaMaquina(handshake && handshake.address) || !hostDaRequisicaoEhLocal(headers)) {
    return { podeUsarHelper: false, motivo: 'remoto' };
  }
  if (!helperCompilado()) {
    return { podeUsarHelper: false, motivo: 'helper-ausente' };
  }
  return { podeUsarHelper: true, motivo: null };
}

function pararCapturaAudio(socketId) {
  const captures = audioCaptureProcesses.get(socketId) || [];
  captures.forEach(capture => capture.kill());
  audioCaptureProcesses.delete(socketId);
}

// Junta as capturas num fluxo só, quadro a quadro.
//
// A mistura esperava um quadro de TODAS as fontes antes de emitir qualquer coisa, e era ali
// que estava o problema: uma fonte que deixasse de produzir -- o aplicativo fechou, o
// processo morreu, o dispositivo sumiu -- travava a condição para sempre. As outras
// continuavam entregando 176 KB por segundo cada uma, e nada consumia: a fila crescia até o
// processo do servidor doer. Em dez minutos são mais de 100 MB de PCM que ninguém vai ouvir,
// porque tudo aquilo só seria tocado em tempo real.
//
// Agora uma fonte parada não cala as outras. Esperar continua sendo o certo por um instante
// -- um engasgo de 20 ms não é uma fonte morta, e emitir sem ela introduziria um buraco no
// som por nada. Passado o teto, quem continua produzindo segue sozinho e quem parou entra
// como silêncio. É a mesma escolha que o reprodutor do lado do navegador já fazia com o
// atraso dele: um pulo curto agora é melhor do que atraso permanente depois.
function misturarAudio(socket, captures) {
  const frameBytes = 441 * 2 * 2;   // 10 ms a 44.100 Hz, estéreo, 16 bits
  // 200 ms. Curto o bastante para a fila não virar memória, e longo o bastante para não
  // confundir engasgo com fonte morta.
  const teto = frameBytes * 20;
  const buffers = captures.map(() => Buffer.alloc(0));
  let avisouDeFonteParada = false;

  captures.forEach((capture, index) => {
    capture.stdout.on('data', chunk => {
      buffers[index] = Buffer.concat([buffers[index], chunk]);
      for (;;) {
        const prontos = [];
        let estourou = false;
        buffers.forEach((buffer, i) => {
          if (buffer.length >= frameBytes) prontos.push(i);
          if (buffer.length > teto) estourou = true;
        });
        if (!prontos.length) break;
        // Com todos prontos, mistura todos. Faltando alguém, só segue depois que a fila de
        // quem continua produzindo passou do teto.
        if (prontos.length < buffers.length && !estourou) break;
        if (prontos.length < buffers.length && !avisouDeFonteParada) {
          avisouDeFonteParada = true;
          console.warn(`Áudio nativo: ${buffers.length - prontos.length} de ${buffers.length} capturas pararam de produzir; misturando sem elas.`);
        }
        const mixed = Buffer.alloc(frameBytes);
        for (let offset = 0; offset < frameBytes; offset += 2) {
          let sample = 0;
          for (const i of prontos) sample += buffers[i].readInt16LE(offset);
          sample = Math.max(-32768, Math.min(32767, sample));
          mixed.writeInt16LE(sample, offset);
        }
        for (const i of prontos) buffers[i] = buffers[i].subarray(frameBytes);
        socket.emit('audio-data', mixed);
      }
    });
  });
}

// ---------- O bot de musica falando com a sala ----------

function publicarNaMusica(roomCode, mensagem) {
  const lista = historicoDeMusicaPorSala.get(roomCode) || [];
  lista.push(mensagem);
  while (lista.length > MENSAGENS_DE_MUSICA_NO_HISTORICO) lista.shift();
  historicoDeMusicaPorSala.set(roomCode, lista);
  io.to(roomName(roomCode)).emit('musica-mensagem', mensagem);
}

// O `tipo` diz O QUE aconteceu -- tocou, entrou na fila, pulou, deu erro --, e é por ele que a
// página desenha cada fala como uma linha curta com um ícone, em vez de um cartão com avatar e
// nome repetidos a cada aviso. O texto continua completo: é ele que o leitor de tela lê, e é
// ele que um histórico antigo, sem tipo, ainda mostra.
function falarComoBot(roomCode, texto, tipo = 'info', extra = {}) {
  const capa = /^https:\/\//.test(extra.capa || '') ? extra.capa : undefined;
  publicarNaMusica(roomCode, { autor: musica.NOME_DO_BOT, autorId: 'bot', doBot: true, texto, tipo, capa, em: Date.now() });
}

// "Procurando…" era uma mensagem: ficava no canal para sempre, uma a cada pedido, dizendo algo
// que só foi verdade por três segundos. Agora é um estado do PEDIDO -- a página mostra um
// indicador embaixo do que a pessoa escreveu e o apaga quando a busca termina. Não entra no
// histórico: quem chega depois quer saber o que tocou, não o que foi procurado.
function avisarBusca(roomCode, pedido, rotulo) {
  if (!pedido) return;
  io.to(roomName(roomCode)).emit('musica-busca', rotulo ? { pedido, rotulo } : { pedido, fim: true });
}

function duracaoLegivel(segundos) {
  if (!segundos) return 'ao vivo';
  const minutos = Math.floor(segundos / 60);
  return `${minutos}:${String(Math.floor(segundos % 60)).padStart(2, '0')}`;
}

const AJUDA_DA_MUSICA = [
  'Escreva o nome de uma música (ou cole um link) e eu toco.',
  '`!bot <música>` · `!lista <nome ou link>` · `!pular` · `!pausar` · `!voltar`',
  '`!proxima <música>` toca a seguir · `!inserir <n> <música>` entra na posição n',
  '`!mover <de> <para>` · `!remover <n>` · `!embaralhar` · `!esvaziar` (a atual continua)',
  '`!repetir` repete a faixa · `!repetir fila` gira a fila inteira · `!repetir não` desliga',
  '`!parar` esvazia a fila e me tira da chamada (`!sair` faz o mesmo).',
  '`!fila` · `!agora` · `!volume 0-150` · Na fila do painel dá para arrastar as faixas.',
  'Aceito YouTube, SoundCloud, Bandcamp, links diretos e muito mais. Link do Spotify eu procuro pelo nome.',
  'Link de playlist entra inteiro. Link de música que estava numa playlist toca só ela — use `!lista` para pegar tudo.'
].join('\n');

// ---------- Repetir ----------
//
// `!repetir` sozinho liga e desliga a faixa, que é o pedido de todo dia ("deixa essa tocando");
// a fila inteira se pede pelo nome. Palavras soltas, nas duas línguas que aparecem num canal de
// música, para ninguém ter de decorar a grafia certa.
const COMANDOS_DE_REPETIR = ['repetir', 'loop', 'repeat', 'rep'];
const COMANDOS_DE_REPETIR_A_FILA = ['repetirfila', 'loopfila', 'loopqueue', 'lq'];
function modoDeRepetirPedido(texto, atual) {
  const palavra = String(texto || '').trim().toLowerCase();
  if (!palavra) return atual === 'faixa' ? 'nao' : 'faixa';
  if (/^(fila|tudo|todas|lista|queue|all)$/.test(palavra)) return 'fila';
  if (/^(faixa|m[uú]sica|essa|esta|uma|1|one|track|song)$/.test(palavra)) return 'faixa';
  if (/^(n[aã]o|off|desligar|desliga|nada|nenhum|0|none)$/.test(palavra)) return 'nao';
  return null;
}
// A mesma frase para o comando e para o botão, com e sem quem mexeu.
function fraseDoRepetir(modo, tocando, quem = null) {
  const titulo = tocando ? musica.semMarcacao(tocando.titulo) : '';
  if (quem) {
    if (modo === 'faixa') return titulo ? `**${quem}** pôs **${titulo}** para repetir.` : `**${quem}** ligou repetir a faixa.`;
    if (modo === 'fila') return `**${quem}** ligou repetir a fila: o que acaba volta para o fim.`;
    return `**${quem}** desligou o repetir.`;
  }
  if (modo === 'faixa') return titulo ? `Repetindo **${titulo}** até alguém desligar.` : 'Repetindo a faixa que tocar até alguém desligar.';
  if (modo === 'fila') return 'Repetindo a fila: cada faixa que acaba volta para o fim.';
  return 'Repetir desligado. A fila segue e acaba.';
}

// `pedido` é o id da mensagem em que a pessoa pediu: é embaixo dela que a página mostra o
// "procurando…", e é por ele que o indicador some quando a busca termina, dê certo ou não.
async function interpretarComandoDeMusica(roomCode, texto, quemPediu, pedido = null) {
  const casou = texto.match(/^!(\S+)\s*([\s\S]*)$/);
  const comando = casou ? casou[1].toLowerCase() : '';
  const resto = casou ? casou[2].trim() : texto;

  // Sem "!", o canal inteiro e um pedido de musica: e para isso que ele existe, e obrigar
  // um prefixo em todas as linhas so seria cerimonia.
  const ehPedido = !casou || ['bot', 'tocar', 'p', 'play', 'toca'].includes(comando);
  let buscando = false;
  const procurar = rotulo => { buscando = true; avisarBusca(roomCode, pedido, rotulo); };

  try {
    if (ehPedido) {
      const busca = ehPedido && casou ? resto : texto;
      if (!busca) return falarComoBot(roomCode, AJUDA_DA_MUSICA, 'ajuda');
      procurar('Procurando…');
      const faixa = await musica.pedir(roomCode, busca, quemPediu);
      if (!faixa) falarComoBot(roomCode, 'Não achei nada com isso.', 'erro');
      return;
    }

    // Força a lista inteira, inclusive quando o link é de uma música que estava dentro
    // dela -- que é a forma como o YouTube monta o endereço de qualquer vídeo aberto a
    // partir de uma playlist.
    if (['lista', 'playlist', 'album', 'álbum'].includes(comando)) {
      if (!resto) return falarComoBot(roomCode, 'Escreva o nome de uma lista ou cole um link: `!lista rock anos 80`', 'dica');
      // Link: já se sabe qual é. Texto: procura listas e deixa a sala escolher, para
      // ninguém ter de sair da conversa, achar a playlist em outro aplicativo, copiar o
      // endereço e voltar.
      if (/^https?:\/\//i.test(resto)) {
        procurar('Abrindo a lista…');
        await musica.pedir(roomCode, resto, quemPediu, { listaInteira: true });
        return;
      }
      procurar('Procurando listas…');
      const achadas = await musica.buscarListas(resto);
      return publicarNaMusica(roomCode, {
        autor: musica.NOME_DO_BOT, autorId: 'bot', doBot: true, em: Date.now(), tipo: 'escolha',
        texto: achadas.length
          ? `Achei ${achadas.length} ${achadas.length === 1 ? 'lista' : 'listas'} de **${musica.semMarcacao(resto).slice(0, 80)}**. Toque em uma para enfileirar:`
          : `Não achei nenhuma lista de **${musica.semMarcacao(resto).slice(0, 80)}**.`,
        opcoes: achadas
      });
    }

    // Pedido com lugar na fila. `!proxima` é o caso de todo dia -- "essa, antes das que já
    // estão esperando" --, e `!inserir 3 <música>` cobre o resto.
    if (['proxima', 'próxima', 'seguinte', 'playnext', 'pn', 'depois'].includes(comando)) {
      if (!resto) return falarComoBot(roomCode, 'Escreva a música: `!proxima nome ou link`', 'dica');
      procurar('Procurando…');
      await musica.pedir(roomCode, resto, quemPediu, { posicao: 1 });
      return;
    }
    if (['inserir', 'posicao', 'posição', 'pos'].includes(comando)) {
      const partes = resto.match(/^(\d{1,3})\s+([\s\S]+)$/);
      if (!partes) return falarComoBot(roomCode, 'Diga a posição e a música: `!inserir 2 nome ou link`', 'dica');
      procurar('Procurando…');
      await musica.pedir(roomCode, partes[2], quemPediu, { posicao: Number(partes[1]) });
      return;
    }
    if (['mover', 'mv', 'move'].includes(comando)) {
      const [de, para] = resto.split(/\s+/).map(Number);
      const faixa = musica.instantaneo(roomCode).fila[de - 1];
      if (!faixa || !Number.isInteger(para) || para < 1) return falarComoBot(roomCode, 'Use `!mover <de> <para>`, com as posições que o `!fila` mostra.', 'dica');
      const movida = musica.moverNaFila(roomCode, faixa.id, para);
      return falarComoBot(roomCode, `**${movida.faixa.titulo}** foi para a posição ${movida.para}.`, 'moveu');
    }
    if (['esvaziar', 'limparfila', 'clear'].includes(comando)) {
      const quantas = musica.esvaziarFila(roomCode);
      return quantas
        ? falarComoBot(roomCode, `Esvaziei a fila (${quantas} ${quantas === 1 ? 'faixa' : 'faixas'}). A que está tocando continua.`, 'esvaziou')
        : falarComoBot(roomCode, 'A fila já está vazia.', 'dica');
    }
    if (['pular', 'skip', 'next', 'n'].includes(comando)) {
      const saindo = musica.pular(roomCode);
      return saindo ? falarComoBot(roomCode, `Pulei **${saindo.titulo}**.`, 'pulou') : falarComoBot(roomCode, 'Não tem nada tocando.', 'dica');
    }
    // Parar é sair. Antes o bot limpava a fila e continuava plantado na sala por mais um
    // minuto e meio, mudo, ocupando um lugar na lista de todo mundo -- e quem escreveu
    // `!parar` já tinha dito que não queria mais música ali.
    if (['parar', 'stop', 'limpar', 'sair', 'leave', 'fora'].includes(comando)) {
      const tinhaFila = musica.instantaneo(roomCode).fila.length;
      await musica.desconectar(roomCode, 'pedido');
      return falarComoBot(roomCode, tinhaFila
        ? `Parei, esvaziei a fila (${tinhaFila} ${tinhaFila === 1 ? 'faixa' : 'faixas'}) e saí da chamada.`
        : 'Parei e saí da chamada. Peça uma música que eu volto.', 'parou');
    }
    if (['pausar', 'pause'].includes(comando)) {
      return musica.pausar(roomCode, true) ? falarComoBot(roomCode, 'Pausado.', 'pausa') : falarComoBot(roomCode, 'Não tem nada tocando.', 'dica');
    }
    if (['voltar', 'resume', 'continuar', 'despausar'].includes(comando)) {
      return musica.pausar(roomCode, false) ? falarComoBot(roomCode, 'Voltando.', 'volta') : falarComoBot(roomCode, 'Não tem nada tocando.', 'dica');
    }
    if (['fila', 'queue', 'q'].includes(comando)) {
      const estado = musica.instantaneo(roomCode);
      if (!estado.tocando && !estado.fila.length) return falarComoBot(roomCode, 'A fila está vazia. Peça alguma coisa.', 'dica');
      const linhas = [estado.tocando ? `Tocando: **${estado.tocando.titulo}** · ${duracaoLegivel(estado.tocando.duracao)}` : null]
        .concat(estado.fila.slice(0, 15).map((faixa, i) => `${i + 1}. ${faixa.titulo} · ${duracaoLegivel(faixa.duracao)} · pedida por ${faixa.pedidoPor}`))
        .filter(Boolean);
      if (estado.fila.length > 15) linhas.push(`…e mais ${estado.fila.length - 15}.`);
      if (estado.repetir === 'faixa') linhas.push('Repetindo a faixa atual.');
      if (estado.repetir === 'fila') linhas.push('Repetindo a fila: o que acaba volta para o fim.');
      return falarComoBot(roomCode, linhas.join('\n'), 'lista-da-fila');
    }
    if (['agora', 'np', 'tocando'].includes(comando)) {
      const estado = musica.instantaneo(roomCode);
      return estado.tocando
        ? falarComoBot(roomCode, `**${estado.tocando.titulo}**${estado.tocando.autor ? ` · ${estado.tocando.autor}` : ''} · ${duracaoLegivel(estado.tocando.decorrido)} de ${duracaoLegivel(estado.tocando.duracao)}`, 'agora', { capa: estado.tocando.capa })
        : falarComoBot(roomCode, 'Não tem nada tocando.', 'dica');
    }
    if (['volume', 'vol', 'v'].includes(comando)) {
      const { porcento, naSala } = musica.definirVolume(roomCode, resto);
      return falarComoBot(roomCode, naSala
        ? `Volume do bot em ${porcento}%. Cada um ainda regula o próprio no painel.`
        : `Anotado: ${porcento}%. O bot ainda não está na sala, mas já entra nesse volume.`, 'volume');
    }
    if (['remover', 'rm', 'tirar'].includes(comando)) {
      const removida = musica.removerDaFila(roomCode, resto);
      return removida ? falarComoBot(roomCode, `Tirei **${removida.titulo}** da fila.`, 'removeu') : falarComoBot(roomCode, 'Não existe essa posição na fila.', 'dica');
    }
    if (['embaralhar', 'shuffle'].includes(comando)) {
      return musica.embaralhar(roomCode) ? falarComoBot(roomCode, 'Embaralhei a fila.', 'embaralhou') : falarComoBot(roomCode, 'Precisa de pelo menos duas faixas na fila.', 'dica');
    }
    if (COMANDOS_DE_REPETIR.includes(comando) || COMANDOS_DE_REPETIR_A_FILA.includes(comando)) {
      if (!musica.estadoDaSala(roomCode)) return falarComoBot(roomCode, 'Peça uma música primeiro: o repetir vale para a fila que estiver tocando.', 'dica');
      const atual = musica.instantaneo(roomCode);
      const modo = COMANDOS_DE_REPETIR_A_FILA.includes(comando)
        ? (atual.repetir === 'fila' ? 'nao' : 'fila')
        : modoDeRepetirPedido(resto, atual.repetir);
      if (!modo) return falarComoBot(roomCode, 'Use `!repetir` (a faixa), `!repetir fila` ou `!repetir não`.', 'dica');
      musica.definirRepetir(roomCode, modo);
      return falarComoBot(roomCode, fraseDoRepetir(modo, atual.tocando), 'repetir');
    }
    if (['ajuda', 'help', 'comandos'].includes(comando)) return falarComoBot(roomCode, AJUDA_DA_MUSICA, 'ajuda');

    falarComoBot(roomCode, `Não conheço \`!${comando}\`. Escreva \`!ajuda\` para ver o que eu faço.`, 'dica');
  } catch (erro) {
    falarComoBot(roomCode, `Não deu: ${erro.message}`, 'erro');
  } finally {
    if (buscando) avisarBusca(roomCode, pedido, null);
  }
}

musica.configurar({
  aoMudar: (sala, estado) => io.to(roomName(sala)).emit('musica-estado', estado),
  // O bot so publica. Negar a assinatura no token e o que garante que ele nunca baixe a
  // camera nem a voz de ninguem, por mais que o codigo dele mude no futuro.
  criarToken: (sala, identidade, nome) => sfu.criarToken(sala, identidade, nome, { podeReceber: false }),
  // Ele fala com o servidor de midia pelo endereco local, sem sair para a internet nem
  // passar pelo proxy que existe para os navegadores.
  enderecoLocal: () => `ws://127.0.0.1:${sfu.PORTA_LOCAL}`
});
musica.definirCanalDeMensagens(falarComoBot);

io.on('connection', (socket) => {
  telemetria.instalarSocket(socket);

  // Ida e volta até aqui, medida pelo relógio de quem perguntou. O servidor não responde
  // NADA além da confirmação: quem mede é o cliente, comparando o instante do envio com o do
  // retorno, e assim não há relógio de duas máquinas para conciliar.
  //
  // Existe porque a latência da sala vinha das estatísticas de uma FAIXA de mídia, e quem
  // entra só para ouvir não tem faixa nenhuma -- ficava sem nenhum número sobre a própria
  // conexão justamente no momento em que ele é mais útil, antes de ligar qualquer coisa.
  socket.on('eco', (callback) => { if (typeof callback === 'function') callback(); });

  function sairDaSalaAtual() {
    const roomCode = roomCodeForSocket(socket);
    if (!roomCode) return;
    telemetria.saiu(socket);
    socket.leave(roomName(roomCode));
    // O relógio da pessoa fica parado, e não apagado: se ela voltar logo, ele continua.
    const quemSai = roomMembers.get(roomCode)?.get(socket.id);
    if (quemSai?.chaveDeTempo) tempos.saiu(roomCode, quemSai.chaveDeTempo, socket.id);
    // O tempo desta passagem soma nos minutos da conta (as conquistas de horas em sala). É só a
    // soma: o contador não sabe em que sala, nem com quem.
    if (quemSai?.contaId && quemSai.entrouEm) contas.contarTempo(quemSai.contaId, Date.now() - quemSai.entrouEm);
    // Sala vazia não é esquecida aqui: ela espera 60 segundos e, se ninguém voltar, as
    // limpezas registradas em `salas.aoFechar` apagam tudo o que era dela.
    salas.saiu(roomCode, socket.id);
    // A saída pode mudar quem manda: se quem saiu era o dono sem conta, ou ficou ausente,
    // alguém assume (ver moderacao.js). Isto vem ANTES do "peer-left" de propósito -- quem recebe os dois
    // avisos aplica na ordem em que chegam, e anunciar o dono novo depois da saída faria a
    // lista piscar o selo em quem já não está lá.
    const identidadeQueSaiu = socket.data.identidadeDeMidia || null;
    moderacao.saiu(roomCode, identidadeQueSaiu);
    anunciarDono(roomCode);
    // Quem sai deixa de ver o que via, e a tela dele sai do placar. Só se nenhuma outra conexão
    // com a mesma identidade ficou: a oscilação de socket entra de novo antes de a antiga cair,
    // e a conexão nova pode já ter mandado a lista dela.
    if (identidadeQueSaiu && !membroPorIdentidade(roomCode, identidadeQueSaiu)) {
      anunciarEspectadores(roomCode, espectadores.saiu(roomCode, identidadeQueSaiu));
    }
    // A identidade da midia vai junto: e por ela que a sala reconhece quem saiu. O socket
    // percebe a saida em segundos; o servidor de midia guarda a pessoa por muito mais
    // tempo, esperando ela voltar, e ate la ela ficaria parada na lista.
    socket.to(roomName(roomCode)).emit('peer-left', { id: socket.id, identidade: socket.data.identidadeDeMidia || null });
    pararCapturaAudio(socket.id);
    socketRoomCodes.delete(socket.id);
    // Quem saiu pode ser quem criou uma captura (ela para) ou quem aparece nela (ela espera).
    estudio.mudouSala(roomCode);
    if (quemSai?.contaId) estudio.mudouConta(quemSai.contaId);
    // Os amigos de quem saiu deixam de vê-lo na sala; os de quem ficou veem uma pessoa a menos.
    social.mudouSala([...contasNaSala(roomCode), quemSai?.contaId].filter(Boolean));
  }

  socket.on('leave-room', callback => {
    sairDaSalaAtual();
    const token = socket.data.tokenAgente;
    if (token && navegadoresPorToken.get(token) === socket.id) comandarAgente(token, { acao: 'parar' });
    if (typeof callback === 'function') callback({ ok: true });
  });

  socket.on('join-room', (requestedCode, displayName, identidadeDeMidia, callback) => {
    const roomCode = String(requestedCode || 'principal').toLowerCase();
    const sessao = socket.data.sessaoNexo;
    // O formato ja foi conferido ao emitir a sessao, e a igualdade abaixo torna esta
    // conferencia redundante hoje. Ela fica porque e barata e porque e o que segura o
    // formato no dia em que existir outro caminho para criar uma sessao -- estava solta
    // num "if" seguinte, onde nunca podia ser alcancada e parecia protecao sem proteger.
    const salaValida = /^[a-z0-9_-]{4,32}$/.test(roomCode) && roomCode === sessao.sala;
    if (!salaValida) {
      if (typeof callback === 'function') callback({ ok: false, error: 'Sessão inválida.' });
      return;
    }
    // A sala pode ter fechado entre a configuração e esta entrada: a mesma pergunta das duas
    // portas, feita de novo, e ANTES de criar qualquer estado para um código fechado.
    const acesso = salas.acesso(roomCode, { temConta: Boolean(sessao.contaId) });
    if (acesso === 'espera' || acesso === 'lotado') {
      if (typeof callback === 'function') callback({ ok: false, motivo: acesso === 'espera' ? 'sala-fechada' : 'lotado', error: acesso === 'espera' ? MENSAGEM_SALA_FECHADA : 'O servidor atingiu o número máximo de salas abertas.' });
      return;
    }
    const name = sessao.nome;

    // Banido não entra, e a recusa diz por quanto tempo -- "aguarde" sem prazo é o tipo de
    // mensagem que faz a pessoa tentar dez vezes seguidas.
    const castigo = moderacao.banido(roomCode, { contaId: sessao.contaId, nome: sessao.nome });
    if (castigo) {
      if (typeof callback === 'function') callback({ ok: false, error: castigo.porNome ? MENSAGEM_NOME_BARRADO : `Você foi removido desta sala. Tente novamente em ${castigo.minutos} min.` });
      return;
    }

    const configuracao = configuracaoDaSala(roomCode);
    const identidadeJaPresente = Array.from(roomMembers.get(roomCode)?.values() || []).some(m => m.identidade === sessao.identidade);
    const podeRetomar = jaEsteveNaSala(roomCode, sessao);
    if (configuracao.trancada && salaComGente(roomCode) && !identidadeJaPresente && !podeRetomar && !aprovadosDaSala(roomCode).has(sessao.identidade)) {
      if (typeof callback === 'function') callback({ ok: false, error: 'A sala está trancada e sua entrada ainda não foi aprovada.' });
      return;
    }
    // O teto de pessoas, de novo: entre a configuração e esta entrada a sala pode ter enchido.
    const nivel = nivelDaSessao(sessao);
    if (!cabeNaSala(roomCode, { identidade: sessao.identidade, nivel })) {
      if (typeof callback === 'function') callback({ ok: false, motivo: 'sala-cheia', error: MENSAGEM_SALA_CHEIA() });
      return;
    }
    aprovadosDaSala(roomCode).delete(sessao.identidade);
    pedidosDaSala(roomCode).delete(sessao.identidade);

    // A saida da sala anterior tem de ser anunciada com a identidade ANTIGA. Gravar a nova
    // antes faria o aviso de "fulano saiu" carregar o nome de quem acabou de chegar: os
    // outros tirariam da lista a pessoa errada e deixariam a que saiu parada la.
    sairDaSalaAtual();
    socket.data.identidadeDeMidia = sessao.identidade;

    socket.join(roomName(roomCode));
    socketRoomCodes.set(socket.id, roomCode);
    // A identidade vai em cada par porque é por ela que a moderação funciona: a lista da
    // sala é desenhada a partir da mídia, que é chaveada por identidade, e não por socket.
    // O perfil vai junto (cor, marca e código de quem tem conta); a conta, não -- ela fica no
    // membro, só no servidor, para a moderação e a mesa de sons saberem quem é quem.
    const peers = Array.from(salas.da(roomCode)?.entries() || []).map(([id, info]) => ({ id, name: info.name, state: info.state, identidade: info.identidade || null, perfil: info.perfil || null, desde: info.desde || null }));
    // O relógio é da pessoa: com conta, a conta; sem ela, o sorteio que o navegador guarda. É o
    // que faz um F5 continuar a hora de conversa em vez de zerá-la. A chave fica no membro, só
    // aqui; para a sala vai apenas o instante.
    const chaveDoRelogio = chaveDeTempo({ contaId: sessao.contaId, identidade: sessao.identidade, sorteio: socket.handshake.auth?.tempo });
    const desde = tempos.entrou(roomCode, chaveDoRelogio, socket.id);
    // Se esta pessoa deixa ser levada para o OBS vem no aperto de mão, e não num aviso depois
    // da entrada: entre um e outro, uma captura já poderia ter começado contra a vontade dela.
    const permiteEstudio = socket.handshake.auth?.estudio !== false;
    const { abriu } = salas.entrou(roomCode, socket.id, { name, state: estadoPadrao(), identidade: sessao.identidade, contaId: sessao.contaId || null, perfil: sessao.perfil || null, completo: nivel === 'completo', chaveDeTempo: chaveDoRelogio, desde, permiteEstudio, entrouEm: Date.now() });
    // Abrir uma sala é ser o primeiro num código fechado (salas.js): soma no contador da conta.
    if (abriu && sessao.contaId) contas.contar(sessao.contaId, 'salas');
    identidadesConhecidasDaSala(roomCode).add(sessao.identidade);
    // A conta também: é ela que deixa quem tem conta voltar de um F5 numa sala trancada, já
    // com outra identidade, sem pedir aprovação para entrar na própria sala.
    if (sessao.contaId) identidadesConhecidasDaSala(roomCode).add(`conta:${sessao.contaId}`);
    moderacao.entrou(roomCode, sessao.identidade, { contaId: sessao.contaId || null, nome: sessao.nome });
    telemetria.entrou(socket);
    substituirConexoesAntigas(socket, sessao, roomCode);

    if (typeof callback === 'function') {
      // Quem entra depois recebe o que ja foi conversado, para a sala nao parecer muda. A
      // mesa de sons e o que esta tocando vao junto, e pelo mesmo motivo: chegar numa sala
      // com musica no ar e nao ver o que e (nem conseguir tocar um som que ja esta la)
      // faria parecer que aquilo nao e desta sala.
      callback({
        ok: true, roomCode, selfId: socket.id, peers, perfil: sessao.perfil || null, plano: planoPublico(nivel),
        // Os instantes são do relógio deste servidor. `agora` vai junto para a página medir a
        // diferença para o relógio dela: um computador cinco minutos adiantado mostraria
        // "há cinco minutos" para quem acabou de chegar.
        tempos: { agora: Date.now(), abertaEm: tempos.abertaEm(roomCode), desde },
        // Quem já está vendo cada tela: sem isto, quem chega só saberia do placar na próxima
        // mudança dele.
        espectadores: placarDaSala(roomCode),
        // Quem manda na sala, e o que ESTA pessoa pode fazer. As duas coisas separadas: a
        // primeira desenha o selo na lista, a segunda decide se as ações aparecem. Mandar só
        // a primeira obrigaria o cliente a deduzir a segunda comparando identidades -- e a
        // dedução do cliente deixaria de valer no dia em que existir "moderador".
        dono: moderacao.dono(roomCode),
        podeModerar: moderacao.pode(roomCode, sessao.identidade, 'expulsar'),
        configuracao,
        pedidosEntrada: moderacao.pode(roomCode, sessao.identidade, 'expulsar') ? Array.from(pedidosDaSala(roomCode).values()).filter(p => p.estado === 'aguardando') : [],
        // `propria` marca, para quem tem conta, as mensagens que ela escreveu antes de recarregar
        // a página: a identidade mudou, e sem isto ela não conseguiria mais editá-las.
        historico: (historicoPorSala.get(roomCode) || []).map(m => ({ ...mensagemPublica(m), propria: Boolean(sessao.contaId && m.autorConta === sessao.contaId) })),
        musica: { disponivel: musica.disponivel(), estado: musica.instantaneo(roomCode), historico: historicoDeMusicaPorSala.get(roomCode) || [] },
        soundboard: { sons: soundboard.listar(roomCode), espaco: soundboard.espacoDaSala(roomCode), limiteDoSom: soundboard.BYTES_MAXIMOS_DO_SOM },
        // O que já está sendo levado para o OBS nesta sala: quem chega vê na hora, e não só na
        // próxima mudança.
        estudio: estudio.capturasDaSala(roomCode)
      });
    }
    // A identidade da midia vai junto, e pelo mesmo motivo que ela vai no "peer-left":
    // quem recebe precisa poder ligar este aviso a pessoa certa na lista da midia. Sem
    // ela, uma oscilacao de socket -- em que a pessoa NAO saiu e a midia dela nunca caiu --
    // dispara o "peer-left", tira a pessoa da lista de todo mundo, e nada a traz de volta
    // ate o luto vencer, porque a sessao de midia continua sendo a mesma.
    socket.to(roomName(roomCode)).emit('peer-joined', { id: socket.id, name, state: estadoPadrao(), identidade: socket.data.identidadeDeMidia || null, perfil: sessao.perfil || null, desde });
    // Depois do "peer-joined": o primeiro a entrar numa sala vazia é o dono, e o aviso tem
    // de chegar a ele também -- daí `io.to` dentro de anunciarDono, e não `socket.to`.
    anunciarDono(roomCode);
    // Quem chegou pode ser o diretor de páginas do OBS que o esperavam, ou a pessoa que elas
    // mostram.
    estudio.mudouSala(roomCode);
    // Os amigos de quem chegou passam a vê-lo na sala, e os de quem já estava, uma pessoa a mais.
    social.mudouSala(contasNaSala(roomCode));
  });

  // ---------- O Estúdio ----------
  //
  // Deixar ou não que levem a própria câmera, tela e voz para o OBS. Desligar derruba na hora
  // as capturas que já existiam (estudio-ao-vivo.js).
  socket.on('estudio-permissao', dados => {
    const roomCode = roomCodeForSocket(socket);
    const membro = roomCode && roomMembers.get(roomCode)?.get(socket.id);
    if (!membro) return;
    const permite = dados?.permitir !== false;
    if (membro.permiteEstudio === permite) return;
    membro.permiteEstudio = permite;
    estudio.mudouSala(roomCode);
  });

  // Os links de uma pessoa da sala, para o cartão de perfil copiar na hora do clique. Criar um
  // link pede conta: é a conta que responde pela captura, e é por ela que a captura segue quem
  // a criou de sala em sala.
  socket.on('estudio-links', (dados, callback) => {
    const responder = r => { if (typeof callback === 'function') callback(r); };
    const roomCode = roomCodeForSocket(socket);
    const membro = roomCode && roomMembers.get(roomCode)?.get(socket.id);
    if (!membro) return responder({ ok: false, error: 'Entre na sala antes.' });
    if (!membro.contaId) return responder({ ok: false, motivo: 'sem-conta', error: 'Levar alguém para o OBS exige uma conta grátis.' });
    const conta = contas.contaPorId(membro.contaId);
    if (!conta) return responder({ ok: false, error: 'Conta não encontrada.' });
    if (!estudioPermitidoNaSala(roomCode, membro.identidade)) return responder({ ok: false, motivo: 'sala', error: 'Quem abriu a sala desligou o OBS nela.' });
    const identidade = String(dados?.alvo || '').slice(0, 160);
    const alvo = dados?.alvo === 'self' ? membro : membroPorIdentidade(roomCode, identidade);
    if (!alvo) return responder({ ok: false, error: 'Essa pessoa não está mais na sala.' });
    const chave = estudio.chaveDoMembro(alvo);
    if (!chave) return responder({ ok: false, error: 'Não foi possível identificar essa pessoa.' });
    responder({ ok: true, permite: alvo.permiteEstudio !== false, links: estudio.linksDaPessoa(conta, chave, alvo.name), grupo: estudio.criarLink(conta, { tipo: 'reativo' }).caminho, publicUrl: origemPublica() });
  });

  // ---------- Moderação ----------
  //
  // Uma ação só, com o verbo dentro. Três handlers quase idênticos convidariam a que um deles
  // esquecesse uma das conferências -- e a conferência que importa aqui é sempre a mesma:
  // quem pede tem o papel que a ação exige (ver moderacao.js).
  //
  // A decisão é do SERVIDOR, sempre. O cliente esconde os botões de quem não pode usá-los,
  // mas isso é conveniência de interface: um cliente modificado chega aqui do mesmo jeito.
  socket.on('moderar', (pedido, callback) => {
    const responder = resultado => { if (typeof callback === 'function') callback(resultado); };
    const roomCode = roomCodeForSocket(socket);
    if (!roomCode) return responder({ ok: false, error: 'Você não está numa sala.' });
    const acao = String(pedido?.acao || '');
    const alvo = String(pedido?.identidade || '').slice(0, 120);
    const quemPede = socket.data.identidadeDeMidia || null;

    // Consultar a lista de removidos é a única ação que não age sobre ninguém, então ela sai
    // antes do resto. Ela também é a única que o dono precisa fazer quando NÃO há mais quem
    // moderar -- liberar alguém acontece depois de a sala ter se acalmado.
    if (acao === 'removidos') {
      if (!moderacao.pode(roomCode, quemPede, 'banir')) return responder({ ok: false, error: 'Só quem abriu a sala pode ver isso.' });
      return responder({ ok: true, removidos: moderacao.listarBanidos(roomCode) });
    }
    if (acao === 'desbanir') {
      const liberado = moderacao.desbanir(roomCode, quemPede, String(pedido?.chave || pedido?.nome || '').slice(0, 120));
      if (!liberado.ok) {
        return responder({ ok: false, error: liberado.motivo === 'sem-permissao' ? 'Só quem abriu a sala pode fazer isso.'
          : liberado.motivo === 'nao-estava-banido' ? 'Essa pessoa já pode voltar.' : 'Não foi possível concluir.' });
      }
      return responder({ ok: true, removidos: moderacao.listarBanidos(roomCode) });
    }

    if (!['expulsar', 'banir', 'transferir'].includes(acao)) return responder({ ok: false, error: 'Ação desconhecida.' });

    const resultado = acao === 'banir' ? moderacao.banir(roomCode, quemPede, alvo)
      : acao === 'transferir' ? moderacao.transferir(roomCode, quemPede, alvo)
      : moderacao.expulsar(roomCode, quemPede, alvo);
    if (!resultado.ok) {
      const razoes = {
        'sem-permissao': 'Só quem abriu a sala pode fazer isso.',
        'alvo-e-dono': 'Essa pessoa abriu a sala.',
        'nao-em-si-mesmo': 'Essa ação não se aplica a você.',
        'alvo-desconhecido': 'Não encontrei essa pessoa na sala.',
        'alvo-fora-da-sala': 'Essa pessoa não está mais na sala.',
        'alvo-sem-conta': 'Só dá para passar a sala para quem entrou com uma conta.',
        'banidos-demais': 'Já há remoções demais nesta sala.',
        'sala-desconhecida': 'Esta sala não está mais ativa.'
      };
      return responder({ ok: false, error: razoes[resultado.motivo] || 'Não foi possível concluir.' });
    }

    if (acao === 'transferir') {
      anunciarDono(roomCode);
      return responder({ ok: true });
    }

    // Banir e trancar, no mesmo gesto. Nenhuma lista de banidos fecha a porta a quem volta com
    // outro nome ou outra conta -- uma identidade nova não está nela. O que fecha é dizer quem
    // ENTRA: com a sala trancada, quem volta cai na fila de pedidos, e quem modera vê.
    if (acao === 'banir' && pedido?.trancar === true) {
      const configuracao = configuracaoDaSala(roomCode);
      if (!configuracao.trancada) {
        configuracao.trancada = true;
        io.to(roomName(roomCode)).emit('sala-configuracao', configuracao);
      }
    }

    // Tirar da sala é preciso em DOIS lugares. O socket leva a sinalização -- a lista, o
    // chat, a presença; o servidor de mídia leva a imagem e o som, e ele não sabe nada do
    // socket. Sem a segunda metade, a pessoa expulsa sai da lista e continua vendo e ouvindo
    // a sala, que é o oposto de ter sido removida.
    const alvos = socketsDaIdentidade(roomCode, alvo);
    for (const outro of alvos) {
      // Sai da sala AGORA -- deixa de receber chat e presença no mesmo instante --, recebe o
      // motivo, e só então o socket é fechado.
      //
      // A espera não é zelo: fechar na mesma volta do `emit` corta a mensagem antes de ela
      // sair, e quem foi removido vê "a mídia caiu e não foi possível voltar" em vez do
      // motivo. Medido durante a implementação, com exatamente esse sintoma.
      outro.leave(roomName(roomCode));
      outro.emit('removido-da-sala', { motivo: acao, minutos: resultado.minutos || null });
      setTimeout(() => { try { outro.disconnect(true); } catch (_) { /* já saiu por conta própria */ } }, MS_ATE_FECHAR_O_SOCKET);
    }
    sfu.consultar('RemoveParticipant', { room: roomCode, identity: alvo }).catch(() => {
      // A saída do socket já derruba a sessão de mídia por ausência; isto só encurta a espera.
    });
    responder({ ok: true, alcancados: alvos.length });
  });

  socket.on('sala-configurar', (mudancas, callback) => {
    const responder = r => { if (typeof callback === 'function') callback(r); };
    const roomCode = roomCodeForSocket(socket);
    const identidade = socket.data.identidadeDeMidia || null;
    if (!roomCode || !moderacao.pode(roomCode, identidade, 'expulsar')) return responder({ ok: false, error: 'Só quem abriu a sala pode alterar estes controles.' });
    const atual = configuracaoDaSala(roomCode);
    const estudioAntes = atual.estudio;
    for (const chave of ['trancada', 'compartilharTela', 'soundboard', 'musica', 'estudio']) {
      if (Object.prototype.hasOwnProperty.call(mudancas || {}, chave)) atual[chave] = Boolean(mudancas[chave]);
    }
    io.to(roomName(roomCode)).emit('sala-configuracao', atual);
    // Desligar o OBS na sala derruba na hora o que os participantes tinham no ar.
    if (atual.estudio !== estudioAntes) estudio.mudouSala(roomCode);
    // Trancada, a sala vira "Pedir para entrar" na lista dos amigos de quem está nela.
    social.mudouSala(contasNaSala(roomCode));
    responder({ ok: true, configuracao: atual });
  });

  socket.on('resolver-entrada', (dados, callback) => {
    const responder = r => { if (typeof callback === 'function') callback(r); };
    const roomCode = roomCodeForSocket(socket);
    const quemPede = socket.data.identidadeDeMidia || null;
    if (!roomCode || !moderacao.pode(roomCode, quemPede, 'expulsar')) return responder({ ok: false, error: 'Sem permissão.' });
    const identidade = String(dados?.identidade || '').slice(0, 120);
    const pedido = pedidosDaSala(roomCode).get(identidade);
    if (!pedido) return responder({ ok: false, error: 'Esse pedido não está mais pendente.' });
    if (dados?.aceitar) {
      aprovadosDaSala(roomCode).add(identidade);
      pedidosDaSala(roomCode).delete(identidade);
    } else {
      pedido.estado = 'recusado';
      pedido.em = Date.now();
    }
    avisarQuemModera(roomCode, 'pedido-entrada-resolvido', { identidade, aceitar: Boolean(dados?.aceitar) });
    responder({ ok: true });
  });

  // A presença viaja inteira -- o status escolhido e se a pessoa está ensurdecida --, e nunca
  // um campo solto: quem recebe troca as duas coisas de uma vez e não precisa adivinhar o resto.
  const anunciarPresenca = (roomCode, membro) => io.to(roomName(roomCode)).emit('presenca-atualizada', {
    identidade: membro.identidade, presenca: membro.state.presenca || '', ensurdecido: Boolean(membro.state.ensurdecido)
  });
  socket.on('sinal-presenca', dados => {
    const roomCode = roomCodeForSocket(socket);
    const membro = roomMembers.get(roomCode)?.get(socket.id);
    if (!roomCode || !membro) return;
    const presencas = new Set(['', 'hand', 'brb', 'gaming', 'quiet']);
    if (Object.prototype.hasOwnProperty.call(dados || {}, 'presenca')) {
      const presenca = String(dados.presenca || '');
      if (!presencas.has(presenca)) return;
      membro.state.presenca = presenca;
      anunciarPresenca(roomCode, membro);
    }
    // Qualquer emoji do seletor (public/emojis.js), e nada além de um emoji: a reação vai para a tela de todo
    // mundo, então a regra é a forma -- um emoji inteiro --, e não uma lista de cinco (public/vitrine.js).
    const reacao = typeof dados?.reacao === 'string' ? dados.reacao : '';
    if (vitrineComum.ehUmEmoji(reacao)) {
      io.to(roomName(roomCode)).emit('reacao-sala', { identidade: membro.identidade, nome: membro.name, reacao });
    }
  });

  // Ensurdecer continua sendo local (sala.js): o que chega aqui é só o aviso, para a sala saber
  // por que alguém não responde, e para o Estúdio trocar o rosto dessa pessoa no OBS. Um evento
  // à parte da presença, com freio próprio (telemetria/abuso.js).
  socket.on('ensurdecer', dados => {
    const roomCode = roomCodeForSocket(socket);
    const membro = roomMembers.get(roomCode)?.get(socket.id);
    if (!roomCode || !membro || typeof dados?.ensurdecido !== 'boolean') return;
    if (Boolean(membro.state.ensurdecido) === dados.ensurdecido) return;
    membro.state.ensurdecido = dados.ensurdecido;
    anunciarPresenca(roomCode, membro);
    estudio.mudouSala(roomCode);
  });

  // As telas que esta página está recebendo agora -- a lista inteira, nunca um "liguei" solto
  // (ver espectadores.js). Só entram identidades de quem está nesta sala: o mapa é chaveado
  // pelo que chega do cliente, e nada solto vira chave dele.
  socket.on('assistindo', dados => {
    const roomCode = roomCodeForSocket(socket);
    const membro = roomCode && roomMembers.get(roomCode)?.get(socket.id);
    if (!membro || !Array.isArray(dados?.telas)) return;
    const telas = dados.telas.filter(tela => typeof tela === 'string' && tela.length <= 128 && membroPorIdentidade(roomCode, tela));
    anunciarEspectadores(roomCode, espectadores.definir(roomCode, membro.identidade, telas));
  });

  // Quanto esta página recebeu desde o relatório anterior dela. Somado com o de todo mundo,
  // é o que saiu daqui -- a conta de banda de quem hospeda. Não é reenviado para ninguém e
  // não altera nada na sala: vai direto para o arquivo. Ver medicao.js.
  socket.on('medicao-de-banda', (porFonte) => {
    const roomCode = roomCodeForSocket(socket);
    if (!roomCode) return;
    if (porFonte?.v === 2) {
      const sessao = socket.data.sessaoNexo;
      if (!Number.isSafeInteger(porFonte.sequencia) || porFonte.sequencia <= sessao.sequencia) return;
      sessao.sequencia = porFonte.sequencia;
    }
    medicao.registrar(roomCode, porFonte, roomMembers.get(roomCode)?.size || 0);
  });

  // O cliente pergunta se ESTE participante pode usar a captura nativa por processo.
  socket.on('audio-capabilities', (callback) => {
    if (typeof callback !== 'function') return;
    const token = socket.data.tokenAgente;
    callback({
      ...diagnosticarHelper(socket.handshake),
      urlLocal: `http://localhost:${PORT}`,
      agenteDisponivel: fs.existsSync(AGENTE_PATH),
      agenteConectado: Boolean(token && agentesPorToken.has(token)),
      portaLocalDoAgente: (token && portasLocaisPorToken.get(token)) || null
    });
  });

  // O navegador diz qual e o token do agente dele (gerado por ele e guardado no
  // localStorage). E o que permite o servidor casar o agente com a aba certa.
  socket.on('registrar-agente', (token, callback) => {
    const limpo = String(token || '');
    if (!TOKEN_VALIDO.test(limpo)) {
      if (typeof callback === 'function') callback({ ok: false });
      return;
    }
    const anterior = socket.data.tokenAgente;
    if (anterior && anterior !== limpo && navegadoresPorToken.get(anterior) === socket.id) {
      navegadoresPorToken.delete(anterior);
    }
    socket.data.tokenAgente = limpo;
    navegadoresPorToken.set(limpo, socket.id);
    if (typeof callback === 'function') callback({ ok: true, conectado: agentesPorToken.has(limpo) });
  });

  // Captura todo o audio do sistema MENOS a arvore de processos do navegador de quem
  // pediu -- ou seja, sem o audio desta propria chamada, sem eco.
  //
  // Duas origens possiveis: o agente instalado no PC do proprio participante (vale para
  // qualquer pessoa) ou o helper que roda aqui no servidor (so para quem esta nesta
  // maquina). Nunca capturamos o audio local em nome de outra pessoa.
  socket.on('audio-start', async (request) => {
    if (!roomCodeForSocket(socket)) return;
    const familiaPedida = String(request?.familia || '').toLowerCase();

    if (request?.origem === 'agente') {
      const token = socket.data.tokenAgente;
      if (!token || !agentesPorToken.has(token)) {
        socket.emit('audio-error', 'O agente de audio nao esta conectado neste computador.');
        return;
      }
      comandarAgente(token, { acao: 'iniciar', familia: familiaPedida });
      console.log('Agente iniciou a captura de áudio.');
      return;
    }

    const diagnostico = diagnosticarHelper(socket.handshake);
    if (!diagnostico.podeUsarHelper) {
      // Nunca capturar o audio desta maquina em nome de outra pessoa: ela receberia o
      // som do computador do host em vez do proprio.
      socket.emit('audio-error', diagnostico.motivo === 'helper-ausente'
        ? 'Helper de audio nao encontrado. Compile o projeto nativo.'
        : 'A captura nativa so funciona para quem abre a sala direto no computador que executa o servidor. Seu audio sera capturado pelo navegador.');
      return;
    }

    await iniciarCapturaLocal(socket, familiaPedida);
  });

  // Sobe (ou refaz) a captura local com a escolha da pessoa. Quem descobre a raiz da arvore
  // e o proprio helper, pelo nome do executavel ou pelo PID -- some a volta pelo PowerShell.
  async function iniciarCapturaLocal(socket, familia) {
    const escolha = socket.data.escolhaDeAudio || { modo: 'excluir', executavel: '', pid: 0 };
    let argumentos;
    let alvo;

    if (['excluir-pid', 'incluir-pid'].includes(escolha.modo)) {
      argumentos = ['--' + escolha.modo, String(escolha.pid)];
      alvo = `pid ${escolha.pid}`;
    } else {
      // No modo "incluir" nao existe padrao: incluir o navegador por engano mandaria para a
      // sala exatamente o que a sala acabou de tocar.
      const executavel = escolha.executavel || (escolha.modo === 'incluir' ? '' : FAMILIAS_DE_NAVEGADOR[familia]);
      if (!executavel) {
        socket.emit('audio-error', 'Nao foi possivel identificar o programa do audio.');
        return;
      }
      argumentos = [escolha.modo === 'incluir' ? '--incluir' : '--excluir', executavel];
      alvo = executavel;
    }

    pararCapturaAudio(socket.id);
    const capture = spawn(HELPER_PATH, argumentos, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    const captures = [capture];
    audioCaptureProcesses.set(socket.id, captures);
    misturarAudio(socket, captures);
    console.log('Captura de áudio local iniciada.');

    capture.stderr.on('data', (chunk) => console.error(`Audio helper: ${chunk}`));
    capture.on('close', (codigo) => {
      if (audioCaptureProcesses.get(socket.id)?.includes(capture)) {
        audioCaptureProcesses.set(socket.id, audioCaptureProcesses.get(socket.id).filter(item => item !== capture));
      }
      if (codigo === 2) socket.emit('audio-error', `O programa ${alvo} nao esta aberto.`);
    });
    capture.on('error', (error) => {
      console.error(`Nao foi possivel iniciar o audio helper: ${error.message}`);
      socket.emit('audio-error', 'Helper de audio nao encontrado. Compile o projeto nativo.');
    });
  }

  socket.on('chat-message', (dados) => {
    const roomCode = roomCodeForSocket(socket);
    if (!roomCode) return;
    const membro = roomMembers.get(roomCode)?.get(socket.id);
    if (!membro) return;

    const texto = String(dados?.texto || '').slice(0, TAMANHO_MAXIMO_DO_TEXTO).trim();
    const bruta = typeof dados?.imagem === 'string' ? dados.imagem : '';
    // Aceita apenas data URL de imagem, dentro do limite: o navegador de quem recebe vai
    // colocar isso num <img>, entao nao pode entrar qualquer coisa aqui.
    const imagem = (bruta.length <= TAMANHO_MAXIMO_DA_IMAGEM && IMAGEM_VALIDA.test(bruta)) ? bruta : null;
    if (!texto && !imagem) return;

    const alvoResposta = String(dados?.respostaA || '');
    const original = (historicoPorSala.get(roomCode) || []).find(m => m.id === alvoResposta);
    const resposta = original ? { id: original.id, autor: original.autor, texto: String(original.texto || (original.imagem ? 'Imagem' : '')).slice(0, 140) } : null;
    const mensagem = {
      id: crypto.randomUUID(), autor: membro.name, autorId: membro.identidade,
      texto, imagem, em: Date.now(), resposta, reacoes: {}, fixada: false,
      autorConta: membro.contaId || null
    };
    guardarNoHistorico(roomCode, mensagem);
    io.to(roomName(roomCode)).emit('chat-mensagem', mensagemPublica(mensagem));
    if (membro.contaId) contas.contar(membro.contaId, 'mensagens');
  });

  socket.on('chat-acao', (dados, callback) => {
    const responder = r => { if (typeof callback === 'function') callback(r); };
    const roomCode = roomCodeForSocket(socket);
    const membro = roomMembers.get(roomCode)?.get(socket.id);
    const lista = historicoPorSala.get(roomCode) || [];
    const mensagem = lista.find(m => m.id === String(dados?.id || ''));
    if (!roomCode || !membro || !mensagem) return responder({ ok: false, error: 'Mensagem não encontrada.' });
    const acao = String(dados?.acao || '');
    const ehDono = moderacao.pode(roomCode, membro.identidade, 'expulsar');
    // Sem conta, a mensagem é de quem escreveu até recarregar a página, como sempre foi: o F5
    // sorteia outra identidade. Com conta, é dela sempre -- é a conta que reconhece a autoria.
    const ehAutor = mensagem.autorId === membro.identidade || Boolean(membro.contaId && mensagem.autorConta === membro.contaId);
    if (acao === 'reagir') {
      // Qualquer emoji do seletor, e só um emoji inteiro: ele é a chave de um mapa guardado com a mensagem
      // e vai para a tela de todo mundo (public/vitrine.js, `ehUmEmoji`).
      const emoji = typeof dados?.emoji === 'string' ? dados.emoji : '';
      if (!vitrineComum.ehUmEmoji(emoji)) return responder({ ok: false });
      mensagem.reacoes ||= {};
      const pessoas = new Set(mensagem.reacoes[emoji] || []);
      // Uma mensagem aceita até vinte emojis diferentes: sem teto, qualquer um enchia uma mensagem de
      // reações até ela virar uma parede, com o servidor guardando tudo.
      if (!pessoas.size && Object.keys(mensagem.reacoes).length >= REACOES_DIFERENTES_POR_MENSAGEM) {
        return responder({ ok: false, error: `Esta mensagem já tem ${REACOES_DIFERENTES_POR_MENSAGEM} reações diferentes.` });
      }
      pessoas.has(membro.identidade) ? pessoas.delete(membro.identidade) : pessoas.add(membro.identidade);
      // Quem tirou a última reação daquele emoji leva a chave junto: com a lista de cinco as chaves vazias
      // não cresciam; com qualquer emoji, elas seriam lixo guardado.
      if (pessoas.size) mensagem.reacoes[emoji] = Array.from(pessoas); else delete mensagem.reacoes[emoji];
    } else if (acao === 'editar') {
      if (!ehAutor) return responder({ ok: false, error: 'Você só pode editar suas mensagens.' });
      const texto = String(dados?.texto || '').trim().slice(0, TAMANHO_MAXIMO_DO_TEXTO);
      if (!texto) return responder({ ok: false, error: 'A mensagem não pode ficar vazia.' });
      mensagem.texto = texto;
      mensagem.editada = true;
    } else if (acao === 'excluir') {
      if (!ehAutor && !ehDono) return responder({ ok: false, error: 'Sem permissão.' });
      historicoPorSala.set(roomCode, lista.filter(m => m.id !== mensagem.id));
      io.to(roomName(roomCode)).emit('chat-removida', { id: mensagem.id });
      return responder({ ok: true });
    } else if (acao === 'fixar') {
      if (!ehDono) return responder({ ok: false, error: 'Só quem abriu a sala pode fixar mensagens.' });
      if (!mensagem.fixada && lista.filter(m => m.fixada).length >= 5) return responder({ ok: false, error: 'A sala já tem cinco mensagens fixadas.' });
      mensagem.fixada = !mensagem.fixada;
    } else return responder({ ok: false, error: 'Ação desconhecida.' });
    io.to(roomName(roomCode)).emit('chat-atualizada', mensagemPublica(mensagem));
    responder({ ok: true, mensagem: mensagemPublica(mensagem) });
  });

  // ---------- Canal de musica ----------
  //
  // Um canal separado do chat da sala, e nao um comando escondido no meio da conversa: uma
  // fila de musica e uma conversa entre gente sao duas coisas com ritmos diferentes, e
  // misturadas uma sempre atrapalha a leitura da outra.
  socket.on('musica-comando', async (dados) => {
    const roomCode = roomCodeForSocket(socket);
    if (!roomCode) return;
    const membro = roomMembers.get(roomCode)?.get(socket.id);
    if (!membro) return;
    if (!configuracaoDaSala(roomCode).musica && membro.identidade !== moderacao.dono(roomCode)) {
      return socket.emit('musica-mensagem', { autor: musica.NOME_DO_BOT, autorId: 'bot', doBot: true, tipo: 'aviso', texto: 'Quem abriu a sala restringiu novos pedidos de música.', em: Date.now() });
    }

    const texto = String(dados?.texto || '').slice(0, 400).trim();
    if (!texto) return;
    const terminarBusca = telemetria.comecarBusca(socket, texto);
    if (!terminarBusca) return;
    try {

    // O que a pessoa escreveu aparece para todo mundo antes de qualquer coisa acontecer:
    // uma busca demora alguns segundos, e sem este eco a sala fica sem saber que alguem
    // ja pediu -- e dois pedem a mesma coisa.
    const pedido = crypto.randomUUID();
    // `autorIdentidade` é a identidade de mídia, a mesma pela qual a sala guarda o perfil de cada
    // um: é com ela que o canal mostra a foto, a borda e o nome de quem pediu, como no chat.
    publicarNaMusica(roomCode, { id: pedido, autor: membro.name, autorId: socket.id, autorIdentidade: membro.identidade || null, texto, em: Date.now() });

    if (!musica.disponivel()) {
      return falarComoBot(roomCode, 'O bot não está instalado neste servidor. Rode `npm run musica:instalar` na máquina que hospeda a sala.', 'erro');
    }
    await interpretarComandoDeMusica(roomCode, texto, membro.name, pedido);
    } finally { terminarBusca(); }
  });

  // A fila pela tela: arrastar, "tocar a seguir", "tocar agora", tirar, esvaziar. Estruturado,
  // e não um `!comando` montado pela página, porque a faixa vai pelo `id` -- a posição que a
  // pessoa viu pode já ter mudado quando o pedido chega. E quem mexeu aparece no canal: a
  // fila é de todos, e mexer nela sem rastro seria mexer escondido.
  socket.on('musica-fila', (dados, responder) => {
    const resposta = typeof responder === 'function' ? responder : () => {};
    const roomCode = roomCodeForSocket(socket);
    const membro = roomCode && roomMembers.get(roomCode)?.get(socket.id);
    if (!membro) return resposta({ ok: false, error: 'Entre na sala antes.' });
    if (!configuracaoDaSala(roomCode).musica && membro.identidade !== moderacao.dono(roomCode)) {
      return resposta({ ok: false, error: 'Quem abriu a sala restringiu a música.' });
    }
    const acao = String(dados?.acao || '');
    const id = String(dados?.id || '').slice(0, 40);
    const quem = musica.semMarcacao(membro.name);
    const naFila = musica.instantaneo(roomCode).fila.find(faixa => faixa.id === id);
    const sumiu = () => resposta({ ok: false, error: 'Essa faixa não está mais na fila.' });

    if (acao === 'mover') {
      const movida = musica.moverNaFila(roomCode, id, dados?.para);
      if (!movida) return sumiu();
      if (movida.de !== movida.para) {
        falarComoBot(roomCode, movida.para === 1
          ? `**${quem}** pôs **${movida.faixa.titulo}** para tocar a seguir.`
          : `**${quem}** moveu **${movida.faixa.titulo}** para a posição ${movida.para}.`, movida.para === 1 ? 'a-seguir' : 'moveu');
      }
      return resposta({ ok: true });
    }
    if (acao === 'agora') {
      if (!naFila) return sumiu();
      if (!musica.instantaneo(roomCode).tocando) return resposta({ ok: false, error: 'Não tem nada tocando para pular.' });
      // Anunciado antes: pular já publica o "Tocando", e a ordem no canal é a do que aconteceu.
      falarComoBot(roomCode, `**${quem}** pulou para **${naFila.titulo}**.`, 'pulou');
      musica.tocarAgora(roomCode, id);
      return resposta({ ok: true });
    }
    if (acao === 'remover') {
      const removida = musica.removerDaFilaPorId(roomCode, id);
      if (!removida) return sumiu();
      falarComoBot(roomCode, `**${quem}** tirou **${removida.titulo}** da fila.`, 'removeu');
      return resposta({ ok: true });
    }
    if (acao === 'esvaziar') {
      const quantas = musica.esvaziarFila(roomCode);
      if (quantas) falarComoBot(roomCode, `**${quem}** esvaziou a fila (${quantas} ${quantas === 1 ? 'faixa' : 'faixas'}). A que está tocando continua.`, 'esvaziou');
      return resposta({ ok: true, quantas });
    }
    if (acao === 'embaralhar') {
      if (!musica.embaralhar(roomCode)) return resposta({ ok: false, error: 'Precisa de pelo menos duas faixas na fila.' });
      falarComoBot(roomCode, `**${quem}** embaralhou a fila.`, 'embaralhou');
      return resposta({ ok: true });
    }
    // O botão manda o modo que a pessoa VIU como o próximo, e não "avance um": dois cliques de
    // duas pessoas ao mesmo tempo, avançando cada um, pulariam um modo sem ninguém ter pedido.
    if (acao === 'repetir') {
      const modo = String(dados?.modo || '');
      if (!musica.MODOS_DE_REPETIR.includes(modo)) return resposta({ ok: false, error: 'Modo de repetir desconhecido.' });
      const antes = musica.instantaneo(roomCode);
      if (antes.repetir === modo) return resposta({ ok: true });
      if (!musica.definirRepetir(roomCode, modo)) return resposta({ ok: false, error: 'Peça uma música primeiro: o repetir vale para a fila que estiver tocando.' });
      falarComoBot(roomCode, fraseDoRepetir(modo, antes.tocando, quem), 'repetir');
      return resposta({ ok: true });
    }
    resposta({ ok: false, error: 'Ação desconhecida.' });
  });

  socket.on('musica-estado', (callback) => {
    const roomCode = roomCodeForSocket(socket);
    if (typeof callback !== 'function') return;
    callback({
      disponivel: musica.disponivel(),
      estado: roomCode ? musica.instantaneo(roomCode) : null,
      historico: (roomCode && historicoDeMusicaPorSala.get(roomCode)) || []
    });
  });

  // "A música engasgou" tem duas causas que soam idênticas para quem ouve: o servidor não
  // entregou a tempo, ou a rede de quem escuta perdeu pacote. Isto responde a primeira --
  // se `quaseSecou` for zero, o servidor entregou tudo e o problema é do caminho.
  socket.on('musica-saude', (callback) => {
    const roomCode = roomCodeForSocket(socket);
    if (typeof callback === 'function') callback(roomCode ? musica.saudeDaSala(roomCode) : null);
  });

  // ---------- Mesa de sons ----------
  //
  // O servidor so repassa o aviso: o som ja esta no navegador de cada um, e e la que ele
  // toca. Por isso o disparo e do tamanho de uma mensagem de chat e chega junto para todo
  // mundo, sem passar pelo servidor de midia.
  socket.on('soundboard-tocar', (dados) => {
    const roomCode = roomCodeForSocket(socket);
    if (!roomCode) return;
    const membro = roomMembers.get(roomCode)?.get(socket.id);
    if (!membro) return;
    if (!configuracaoDaSala(roomCode).soundboard && membro.identidade !== moderacao.dono(roomCode)) return;
    const som = soundboard.obter(roomCode, dados?.id);
    if (!som) return;

    // Dois cliques por segundo ja e mais do que qualquer pessoa aperta de proposito, e o
    // suficiente para uma aba com defeito (ou alguem se divertindo) virar um zumbido na
    // sala inteira.
    // O intervalo e a cota são aplicados antes do handler pelo limitador central.

    io.to(roomName(roomCode)).emit('soundboard-tocou', { id: som.id, nome: som.nome, por: membro.name, porId: socket.id });
  });

  // Parar o próprio som no meio. Cada navegador corta o canal de quem mandou -- e só o dessa
  // pessoa, que é o `porId` desta conexão, nunca um vindo do pedido: ninguém para o som dos
  // outros. Vale mesmo com a mesa restringida: travar o tocar não pode prender ninguém num som
  // que já começou.
  socket.on('soundboard-parar', (dados) => {
    const roomCode = roomCodeForSocket(socket);
    if (!roomCode || !roomMembers.get(roomCode)?.has(socket.id)) return;
    const id = String(dados?.id || '').slice(0, 40);
    if (!id) return;
    io.to(roomName(roomCode)).emit('soundboard-parou', { id, porId: socket.id });
  });

  socket.on('soundboard-remover', (dados, callback) => {
    const responder = r => { if (typeof callback === 'function') callback(r); };
    const roomCode = roomCodeForSocket(socket);
    if (!roomCode) return responder({ ok: false });
    const membro = roomMembers.get(roomCode)?.get(socket.id);
    // Apagar um som é apagar o que outra pessoa pôs na sala, e até aqui qualquer um podia --
    // inclusive com a mesa restringida, que travava enviar e tocar mas não apagar. Com 30
    // remoções por minuto no limitador e 30 sons por mesa, uma pessoa sozinha limpava a mesa
    // inteira em um minuto.
    //
    // A regra decidida é "apaga quem tem conta" (docs/plano-contas.md), e quem modera a sala
    // também apaga -- como já apaga qualquer mensagem do chat. É o caminho que sobra quando a
    // sala passou para alguém sem conta.
    if (!membro || !(membro.contaId || moderacao.pode(roomCode, membro.identidade, 'expulsar'))) {
      return responder({ ok: false, error: 'Apagar sons da mesa exige uma conta grátis.' });
    }
    const removido = soundboard.remover(roomCode, dados?.id);
    if (removido) {
      io.to(roomName(roomCode)).emit('soundboard-lista', { sons: soundboard.listar(roomCode), espaco: soundboard.espacoDaSala(roomCode) });
    }
    responder({ ok: Boolean(removido) });
  });

  socket.on('soundboard-lista', (callback) => {
    const roomCode = roomCodeForSocket(socket);
    if (typeof callback !== 'function') return;
    callback({
      sons: roomCode ? soundboard.listar(roomCode) : [],
      espaco: roomCode ? soundboard.espacoDaSala(roomCode) : null,
      limiteDoSom: soundboard.BYTES_MAXIMOS_DO_SOM
    });
  });

  // A escolha de qual programa fica fora da captura. Vale na hora: se o agente ja estiver
  // capturando, ele mesmo refaz a captura com o novo alvo, sem interromper a tela.
  socket.on('agente-aplicativos', async (familia) => {
    const limpa = familiaLimpa(familia);
    const token = socket.data.tokenAgente;
    if (token && agentesPorToken.has(token)) {
      comandarAgente(token, { acao: 'listar-aplicativos', familia: limpa });
      return;
    }
    // Sem agente, mas com o helper disponivel e a pagina aberta na propria maquina do
    // servidor: a captura ja acontece aqui, entao a escolha tambem pode.
    const diagnostico = diagnosticarHelper(socket.handshake);
    if (!diagnostico.podeUsarHelper) return;
    const resposta = await listarAplicativosLocais(limpa);
    if (!resposta || !Array.isArray(resposta.lista)) return;
    socket.emit('agente-aplicativos', {
      lista: resposta.lista.slice(0, 40),
      atual: socket.data.escolhaDeAudio?.executavel || String(resposta.atual || ''),
      modo: socket.data.escolhaDeAudio?.modo || 'excluir'
    });
  });

  // Uma escolha so, para os dois caminhos de captura: o agente no PC da pessoa e o helper
  // aqui no servidor. Antes eram dois eventos com nome de "excluir", que deixou de descrever
  // o que acontece desde que existe o modo "somente este programa".
  socket.on('audio-escolha', async (bruta) => {
    const escolha = escolhaLimpa(bruta);
    if (!escolha) return;
    const familia = familiaLimpa(bruta && bruta.familia);

    const token = socket.data.tokenAgente;
    if (token && agentesPorToken.has(token)) {
      // "escolha" e uma acao nova. Um agente antigo simplesmente a ignora -- e nao faz nada,
      // que e o unico desfecho seguro: entender "somente este programa" como "todos menos
      // este" seria fazer o oposto do pedido, e devolver eco para a sala inteira.
      comandarAgente(token, {
        acao: 'escolha',
        modo: escolha.modo,
        executavel: escolha.executavel,
        // Texto de proposito: o leitor de JSON do agente so le valor entre aspas.
        pid: String(escolha.pid || ''),
        familia
      });
      return;
    }

    socket.data.escolhaDeAudio = escolha;
    if (audioCaptureProcesses.has(socket.id)) await iniciarCapturaLocal(socket, familia);
  });

  socket.on('audio-stop', () => {
    pararCapturaAudio(socket.id);
    if (socket.data.tokenAgente) comandarAgente(socket.data.tokenAgente, { acao: 'parar' });
  });

  socket.on('disconnect', () => {
    sairDaSalaAtual();
    const token = socket.data.tokenAgente;
    if (token && navegadoresPorToken.get(token) === socket.id) {
      // Manda o agente parar de capturar: sem isso ele continuaria gravando o audio da
      // pessoa depois que ela fechou a aba.
      //
      // So se este socket ainda e o dono do agente. Quando a pagina reconecta, o socket novo ja se
      // registrou com o mesmo token, e o `disconnect` do antigo (que o servidor so percebe depois
      // do tempo de espera do ping) chegava e mandava parar a captura DA TRANSMISSAO QUE JA VOLTOU:
      // a tela seguia no ar com o som mudo. Dono diferente, e o socket novo quem manda no agente.
      comandarAgente(token, { acao: 'parar' });
      navegadoresPorToken.delete(token);
    }
  });
});

const PORT = process.env.PORT || 3000;
// "::" escuta IPv4 e IPv6 na mesma porta; "0.0.0.0" escuta so IPv4.
//
// A diferenca aparece em quem digita "localhost". No Windows isso resolve para ::1 ANTES de
// 127.0.0.1, e com o servidor so em IPv4 a tentativa em ::1 nao e recusada -- ela fica
// pendurada. Medido nesta maquina: 1,4 ms por 127.0.0.1, 205 ms por localhost (o navegador
// desiste do IPv6 e recomeca), e 2 s cheios para quem so tem IPv6. Era um pedagio em cada
// conexao, inclusive as do aplicativo de desktop.
//
// Maquina com IPv6 desligado nao consegue abrir "::", entao a queda para IPv4 fica no lugar:
// o servidor tem de subir mesmo na rede mais capenga.
const HOST = process.env.HOST || '::';
const publicUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
let caiuParaIpv4 = false;
server.on('error', erro => {
  // O .env.dev e o .env.prod usam a mesma porta de propósito: com a produção no ar, o dev
  // morre aqui, antes do aoSubir -- que é onde o servidor de mídia que estiver rodando seria
  // encerrado, e com ele as chamadas. É o caminho esperado, então merece uma frase e não
  // um rastro de pilha.
  if (erro.code === 'EADDRINUSE') {
    console.error(`\nA porta ${PORT} já está em uso: outro Nexo está no ar nesta máquina? Encerre-o antes, ou troque PORT.`);
    process.exit(1);
  }
  if (process.env.HOST || caiuParaIpv4 || !['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EINVAL', 'EPROTONOSUPPORT'].includes(erro.code)) throw erro;
  caiuParaIpv4 = true;
  console.log('IPv6 indisponível nesta máquina: escutando só em IPv4.');
  server.listen(PORT, '0.0.0.0', aoSubir);
});
server.listen(PORT, HOST, aoSubir);
function aoSubir() {
  process.send?.({ tipo: 'pronto', porta: server.address().port });
  console.log(`\nServidor rodando em ${publicUrl}`);
  console.log(`  -> Entrar na sala: ${publicUrl}/sala\n`);
  sfu.iniciarSfu(server.address().port);
  // Um download que tenha sobrevivido a uma queda feia do processo anterior nao pode
  // continuar rodando sem dono.
  if (process.env.NEXO_SEM_MIDIA !== '1') musica.encerrarOrfaos();
  // As ferramentas do bot sao conferidas em segundo plano: elas nao seguram a abertura da
  // sala, e a sala funciona inteira sem elas -- so o canal de musica fica de fora.
  if (!musica.disponivel()) {
    console.log('O bot de música ainda não está instalado. Rode "npm run musica:instalar" para habilitá-lo.');
  }
}

// Sem isto, um Ctrl+C deixaria o bot baixando musica em segundo plano e segurando uma
// sessao no servidor de midia.
let encerrandoServidor = false;
function encerrarServidor() {
  if (encerrandoServidor) return;
  encerrandoServidor = true; estudio.encerrar(); social.encerrar(); sfu.encerrarSfu(); salas.encerrar();
  Promise.allSettled([telemetria.encerrar(), musica.encerrarTudo(), contas.encerrar()]).finally(() => process.exit(0));
}
for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sinal, encerrarServidor);
// Supervisores locais e as fixtures podem pedir a mesma saída limpa pelo canal IPC.
process.on('message', mensagem => { if (mensagem?.tipo === 'encerrar') encerrarServidor(); });
