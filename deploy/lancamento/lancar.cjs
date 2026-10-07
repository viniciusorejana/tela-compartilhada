#!/usr/bin/env node
'use strict';

// O lançamento dos aplicativos do Nexo, de ponta a ponta, num comando só:
//
//   npm run lancar             mostra o plano e pergunta antes de fazer
//   npm run lancar -- --sim    não pergunta (e mesmo assim não reinicia o servidor com gente em chamada)
//   npm run lancar:plano       só mostra o que faria
//
// 1. Confere o ramo: é o configurado, está limpo no que entra nos builds e não está atrás do GitHub.
// 2. Lê a máquina pela SSH: em que commit está, o que o versao.json dela anuncia, quem está em chamada.
// 3. Decide, por produto, se precisa de versão nova e quais builds saem (versoes.cjs).
// 4. Sobe a versão e faz o commit; envia o ramo ao GitHub.
// 5. Gera aqui o Windows (instalador e portátil) e o Android.
// 6. Leva a máquina para o commit do lançamento, se ela estiver atrás (reinicia o serviço).
// 7. Manda os builds, confere o SHA-256 lá, troca no app/dist e anota as versões.
// 8. Gera o Linux (AppImage e .deb) na própria máquina.
// 9. Confere pelo endereço público o que o servidor anuncia.
//
// Rodar de novo depois de uma falha retoma de onde parou: toda decisão sai do que o servidor anuncia
// agora, e não de um registro deste script. A configuração (máquina, ramo, endereço) mora em
// deploy/lancamento/config.json, fora do Git; o modelo é config.exemplo.json. Tudo em docs/lancar-aplicativos.md.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline/promises');
const { spawn, spawnSync } = require('node:child_process');
const versoes = require('./versoes.cjs');
const anotador = require('../../app/escrever-versao.js');
const { escrever: escreverServidorPadrao, origemDoServidor } = require('../../scripts/servidor-padrao.cjs');

const RAIZ = path.join(__dirname, '..', '..');
const PASTA_APP = path.join(RAIZ, 'app');
const DIST_LOCAL = path.join(PASTA_APP, 'dist');
// O build sai numa pasta à parte: só o que ESTE lançamento gerou pode seguir para o servidor. Num
// build que falhasse no meio, o app/dist ainda teria o executável da vez anterior, pronto para ser
// mandado como se fosse o novo.
const NOME_DA_SAIDA = 'dist-lancamento';
const SAIDA_LOCAL = path.join(PASTA_APP, NOME_DA_SAIDA);
const GRADLE = path.join(RAIZ, 'android', 'app', 'build.gradle');
const AGENTE = path.join(RAIZ, 'native', 'audio-agent', 'x64', 'Release', 'AgenteAudio.exe');

const AJUDA = `Lança as versões novas dos aplicativos do Nexo (docs/lancar-aplicativos.md).

  npm run lancar [-- opções]

  --plano                só mostra o plano; nada muda
  --sim                  segue sem perguntar
  --nivel <n>            força o nível da versão nova: patch, minor ou major
  --ramo <nome>          outro ramo que o do config.json
  --config <arquivo>     outro arquivo de configuração
  --reiniciar-com-gente  reinicia o serviço mesmo com gente em chamada (derruba as chamadas)
`;

// ---------- Opções e configuração ----------

function lerOpcoes(argv) {
  const opcoes = { plano: false, sim: false, nivel: null, ramo: null, reiniciarComGente: false, ajuda: false,
    config: path.join(__dirname, 'config.json') };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const valor = () => {
      const proximo = argv[++i];
      if (!proximo || proximo.startsWith('--')) throw new Error(`${arg} pede um valor.`);
      return proximo;
    };
    if (arg === '--plano') opcoes.plano = true;
    else if (arg === '--sim') opcoes.sim = true;
    else if (arg === '--nivel') opcoes.nivel = valor();
    else if (arg === '--ramo') opcoes.ramo = valor();
    else if (arg === '--config') opcoes.config = path.resolve(valor());
    else if (arg === '--reiniciar-com-gente') opcoes.reiniciarComGente = true;
    else if (arg === '--ajuda' || arg === '-h' || arg === '--help') opcoes.ajuda = true;
    else throw new Error(`Opção desconhecida: ${arg}. Veja: npm run lancar -- --ajuda`);
  }
  if (opcoes.nivel && !versoes.NIVEIS.includes(opcoes.nivel)) throw new Error(`--nivel aceita ${versoes.NIVEIS.join(', ')}.`);
  return opcoes;
}

function lerConfig(arquivo, opcoes) {
  if (!fs.existsSync(arquivo)) {
    throw new Error(`Falta ${path.relative(RAIZ, arquivo)}. Copie deploy/lancamento/config.exemplo.json para config.json e preencha (docs/lancar-aplicativos.md).`);
  }
  let lida;
  try { lida = JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch (erro) { throw new Error(`${path.relative(RAIZ, arquivo)} não é um JSON válido: ${erro.message}`); }
  const vps = { usuario: 'ubuntu', porta: 22, pasta: '/opt/nexo', usuarioDoServico: 'nexo', servico: 'nexo', chave: null, ...(lida.vps || {}) };
  const config = {
    ramo: opcoes.ramo || lida.ramo,
    remoto: lida.remoto || 'origin',
    urlPublica: origemDoServidor(lida.urlPublica),
    javaHome: lida.javaHome || null,
    construir: { windows: true, android: true, linux: true, ...(lida.construir || {}) },
    vps
  };
  const faltando = [!config.ramo && 'ramo', !vps.host && 'vps.host', !config.urlPublica && 'urlPublica (https://...)'].filter(Boolean);
  if (faltando.length) throw new Error(`Falta no ${path.relative(RAIZ, arquivo)}: ${faltando.join(', ')}.`);
  // O servidor que os aplicativos trazem preenchido. Sem um próprio, é o endereço público -- o
  // mesmo para os quatro builds, venha o build daqui ou da máquina.
  config.servidorPadrao = origemDoServidor(lida.servidorPadrao || lida.urlPublica);
  if (lida.servidorPadrao && !config.servidorPadrao) throw new Error(`servidorPadrao precisa ser um endereço http(s), e veio "${lida.servidorPadrao}".`);
  if (vps.chave) {
    vps.chave = path.resolve(vps.chave.replace(/^~(?=$|[\\/])/, os.homedir()));
    if (!fs.existsSync(vps.chave)) throw new Error(`A chave da SSH não está em ${vps.chave}.`);
  }
  return config;
}

// ---------- Saída ----------

const inicio = Date.now();
function passo(titulo) { console.log(`\n▸ ${titulo}`); }
function info(texto) { console.log(`  ${texto}`); }
function aviso(texto) { console.log(`  ! ${texto}`); }
const curto = commit => (commit || '').slice(0, 7) || '?';
const megas = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function confirmar(pergunta, opcoes) {
  if (opcoes.sim) return true;
  if (!process.stdin.isTTY) {
    console.log(`\n${pergunta} Sem terminal para perguntar: rode com --sim para seguir.`);
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return /^s(im)?$/i.test((await rl.question(`\n${pergunta} [s/N] `)).trim()); } finally { rl.close(); }
}

// ---------- Processos ----------

function git(args, { permitirFalha = false } = {}) {
  const r = spawnSync('git', args, { cwd: RAIZ, encoding: 'utf8' });
  if (r.status !== 0) {
    if (permitirFalha) return null;
    throw new Error(`git ${args.join(' ')}: ${(r.stderr || '').trim()}`);
  }
  return r.stdout.trim();
}
const gitPassa = args => spawnSync('git', args, { cwd: RAIZ, stdio: 'ignore' }).status === 0;

function rodar(comando, args, extra = {}) {
  const r = spawnSync(comando, args, { cwd: RAIZ, stdio: 'inherit', ...extra });
  if (r.error) throw new Error(`Não consegui rodar ${comando}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${path.basename(comando)} terminou com o código ${r.status}. O motivo está acima.`);
}

// O npm no Windows é um .cmd, e .cmd só roda pelo interpretador: vai como uma linha de comando fixa.
function rodarNpm(linha, cwd) {
  const r = spawnSync(`npm ${linha}`, { cwd, stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error(`npm ${linha} terminou com o código ${r.status}.`);
}

function sha256(arquivo) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(arquivo).on('data', pedaco => hash.update(pedaco)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

// ---------- A máquina, pela SSH ----------

const alvoSsh = config => `${config.vps.usuario}@${config.vps.host}`;
function opcoesSsh(config, chavePorta = '-p') {
  return [
    ...(config.vps.chave ? ['-i', config.vps.chave] : []),
    chavePorta, String(config.vps.porta),
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'LogLevel=ERROR', '-o', 'ServerAliveInterval=30'
  ];
}
const aspas = valor => `'${String(valor).replace(/'/g, `'\\''`)}'`;

// Roda um dos scripts de remoto/ na máquina, como root (sudo sem senha), com os parâmetros
// exportados antes dele. O script vai entre chaves: o bash lê o grupo inteiro antes de executar, e
// nenhum comando lá dentro (npm, apt) consegue engolir o resto do script pela entrada padrão.
function remoto(config, script, parametros = {}, { capturar = false } = {}) {
  const exportadas = Object.entries({
    NEXO_PASTA: config.vps.pasta, NEXO_USUARIO: config.vps.usuarioDoServico, NEXO_SERVICO: config.vps.servico, ...parametros
  }).map(([nome, valor]) => `export ${nome}=${aspas(valor)}`).join('\n');
  const corpo = fs.readFileSync(path.join(__dirname, 'remoto', script), 'utf8').replace(/\r\n/g, '\n');
  const texto = `${exportadas}\n{\n${corpo}\n}\n`;
  return new Promise((resolve, reject) => {
    const filho = spawn('ssh', [...opcoesSsh(config), alvoSsh(config), 'sudo -n bash -s'], { stdio: ['pipe', capturar ? 'pipe' : 'inherit', 'inherit'] });
    let saida = '';
    if (capturar) filho.stdout.on('data', pedaco => { saida += pedaco; });
    filho.on('error', erro => reject(new Error(`Não consegui rodar o ssh: ${erro.message}`)));
    filho.on('close', codigo => (codigo === 0 ? resolve(saida)
      : reject(new Error(`${script} na máquina terminou com o código ${codigo}.${codigo === 255 ? ' (a SSH não conectou: endereço, porta ou chave)' : ''}`))));
    filho.stdin.end(texto);
  });
}

async function lerEstado(config) {
  const todos = [...new Set(Object.values(versoes.ARQUIVOS).flat())];
  const saida = await remoto(config, 'estado.sh', { NEXO_ARQUIVOS: todos.join(' ') }, { capturar: true });
  const linha = saida.split('\n').find(l => l.startsWith('@@ESTADO@@'));
  if (!linha) throw new Error(`A máquina não respondeu o estado. Ela disse:\n${saida}`);
  return JSON.parse(linha.slice('@@ESTADO@@'.length));
}

// ---------- A decisão ----------

function versaoNoCodigo(produto) {
  if (produto === 'android') return versoes.lerVersaoDoGradle(fs.readFileSync(GRADLE, 'utf8')).nome;
  return JSON.parse(fs.readFileSync(path.join(PASTA_APP, 'package.json'), 'utf8')).version;
}

// Um build anotado antes do lançamento existir não tem commit: vale o commit que pôs aquele número
// no código. O mais antigo que mexeu na linha é o que a introduziu (o mais novo seria o que a tirou).
function commitQueIntroduziu(produto, versao) {
  const [agulha, arquivo] = produto === 'android'
    ? [`versionName = '${versao}'`, 'android/app/build.gradle']
    : [`"version": "${versao}"`, 'app/package.json'];
  const lista = git(['log', '--reverse', '--format=%H', '-S', agulha, '--', arquivo], { permitirFalha: true });
  return (lista || '').split('\n')[0] || null;
}

// Devolve o porquê de o código do build anunciado não ser o de agora, ou null se é o mesmo.
function mudancaDesde(produto, entrada, config) {
  if (entrada.sujo) return { motivo: 'o build saiu com mudanças não commitadas', base: entrada.commit || null };
  if (entrada.servidor && origemDoServidor(entrada.servidor) !== config.servidorPadrao) {
    return { motivo: `o build traz outro servidor (${entrada.servidor})`, base: entrada.commit || null };
  }
  const base = entrada.commit || commitQueIntroduziu(produto, entrada.versao);
  if (!base || !gitPassa(['cat-file', '-e', `${base}^{commit}`])) return { motivo: 'não se sabe de que commit o build saiu', base: null };
  if (!gitPassa(['diff', '--quiet', base, 'HEAD', '--', ...anotador.caminhosDoBuild(produto)])) {
    return { motivo: `o código mudou desde ${curto(base)}`, base };
  }
  return null;
}

function commitsDesde(produto, base) {
  if (!base) return [];
  const lista = git(['log', '--format=%h %s', `${base}..HEAD`, '--', ...anotador.caminhosDoBuild(produto)], { permitirFalha: true });
  return (lista || '').split('\n').filter(Boolean);
}

function planejarProduto(produto, estado, config, opcoes) {
  const servidas = {};
  const mudancas = {};
  for (const chave of versoes.PRODUTOS[produto].chaves) {
    const entrada = estado.versoes[chave];
    if (!entrada) continue;
    const mudanca = mudancaDesde(produto, entrada, config);
    mudancas[chave] = mudanca;
    servidas[chave] = { ...entrada, mudou: Boolean(mudanca), existe: versoes.ARQUIVOS[chave].every(a => estado.arquivos[a] > 0) };
  }
  const atual = versaoNoCodigo(produto);
  const decisao = versoes.decidir({ produto, versaoNoCodigo: atual, servidas });
  let nova = atual;
  let motivos = [];
  let nivel = null;
  if (decisao.precisaSubir) {
    const congelada = Object.keys(servidas).find(chave => servidas[chave].versao === atual && servidas[chave].mudou);
    motivos = commitsDesde(produto, mudancas[congelada].base);
    nivel = opcoes.nivel || versoes.nivelPelosCommits(motivos.map(linha => linha.replace(/^\S+\s/, '')));
    nova = versoes.subirVersao(atual, nivel);
    decisao.motivo = mudancas[congelada].motivo;
  }
  const chaves = versoes.chavesParaConstruir({ produto, versao: nova, servidas: decisao.precisaSubir ? {} : servidas });
  return { produto, atual, nova, nivel, motivos, decisao, chaves, servidas };
}

function planejar(config, estado, opcoes, ramo) {
  const produtos = { desktop: planejarProduto('desktop', estado, config, opcoes), android: planejarProduto('android', estado, config, opcoes) };
  const chaves = [...produtos.desktop.chaves, ...produtos.android.chaves];
  const desejados = versoes.buildsParaChaves(chaves);
  const builds = desejados.filter(build => config.construir[build]);
  const pulados = desejados.filter(build => !config.construir[build]);
  const subidas = Object.values(produtos).filter(p => p.decisao.precisaSubir);
  return { produtos, builds, pulados, subidas, frente: ramo.frente, vpsAtras: estado.head !== ramo.head };
}

function mostrarPlano(plano, estado, ramo) {
  passo('O plano');
  for (const p of Object.values(plano.produtos)) {
    const nome = versoes.PRODUTOS[p.produto].nome;
    const noAr = p.decisao.maiorNoAr ? `${p.decisao.maiorNoAr} no ar` : 'nunca lançado neste servidor';
    if (p.decisao.precisaSubir) {
      info(`${nome}: ${noAr}, ${p.decisao.motivo} -> ${p.nova} (${p.nivel})`);
      for (const linha of p.motivos.slice(0, 12)) info(`    ${linha}`);
      if (p.motivos.length > 12) info(`    ... e mais ${p.motivos.length - 12}`);
    } else if (p.chaves.length) {
      const ainda = p.decisao.maiorNoAr && p.atual !== p.decisao.maiorNoAr ? `, ${p.atual} no código` : '';
      info(`${nome}: ${noAr}${ainda} -> gerar ${p.nova} para ${p.chaves.join(', ')}`);
    } else {
      info(`${nome}: ${noAr}, o código é o mesmo do build -> nada a fazer`);
    }
  }
  const ondeSai = { windows: 'Windows (aqui)', android: 'Android (aqui)', linux: 'Linux (na máquina)' };
  info(`Builds: ${plano.builds.length ? plano.builds.map(b => ondeSai[b]).join(', ') : 'nenhum'}`);
  for (const build of plano.pulados) aviso(`${ondeSai[build]} precisaria sair, mas está desligado em "construir" no config.json.`);
  const aEnviar = plano.frente + (plano.subidas.length ? 1 : 0);
  info(`GitHub: ${aEnviar ? `${aEnviar} commit(s) a enviar${plano.subidas.length ? ' (contando o da versão nova)' : ''}` : 'em dia'}`);
  if (plano.vpsAtras || plano.subidas.length) {
    const gente = estado.participantes == null ? 'não sei quantas pessoas estão em chamada' : `${estado.participantes} pessoa(s) em chamada agora`;
    info(`Máquina: ${curto(estado.head)} -> ${plano.subidas.length ? 'o commit da versão nova' : curto(ramo.head)} (reinicia o serviço; ${gente})`);
  } else {
    info(`Máquina: já está em ${curto(estado.head)}`);
  }
}

// ---------- Os passos ----------

function conferirRamo(config) {
  passo(`O ramo ${config.ramo}`);
  const atual = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (atual !== config.ramo) throw new Error(`Você está em ${atual}, e o lançamento é do ${config.ramo}. Troque (git switch ${config.ramo}) ou mude "ramo" no config.json.`);
  const caminhos = [...anotador.caminhosDoBuild('desktop'), ...anotador.caminhosDoBuild('android')];
  const pendentes = git(['status', '--porcelain', '--', ...caminhos]);
  if (pendentes) {
    throw new Error(`Há mudanças não commitadas no que entra nos builds:\n${pendentes}\nFaça o commit (ou descarte) antes: cada build anota o commit de onde saiu.`);
  }
  git(['fetch', '--quiet', config.remoto]);
  const remotoRef = `${config.remoto}/${config.ramo}`;
  const head = git(['rev-parse', 'HEAD']);
  if (!gitPassa(['rev-parse', '--verify', '--quiet', `refs/remotes/${remotoRef}`])) {
    const frente = Number(git(['rev-list', '--count', 'HEAD']));
    info(`O ramo ainda não existe no ${config.remoto}: vai ser criado no envio.`);
    return { head, frente, novo: true };
  }
  const [atras, frente] = git(['rev-list', '--left-right', '--count', `${remotoRef}...HEAD`]).split(/\s+/).map(Number);
  if (atras > 0) {
    throw new Error(frente
      ? `O ramo divergiu do ${remotoRef} (${frente} seus, ${atras} de lá). Resolva (git pull --rebase) antes de lançar.`
      : `O ${remotoRef} tem ${atras} commit(s) que você não tem. Rode git pull antes de lançar.`);
  }
  info(frente ? `${curto(head)}, ${frente} commit(s) à frente do ${remotoRef}.` : `${curto(head)}, igual ao ${remotoRef}.`);
  return { head, frente, novo: false };
}

function aplicarVersoesNovas(plano) {
  passo('A versão nova');
  const arquivos = [];
  for (const p of plano.subidas) {
    if (p.produto === 'desktop') {
      const arquivo = path.join(PASTA_APP, 'package.json');
      fs.writeFileSync(arquivo, versoes.trocarVersaoDoPackage(fs.readFileSync(arquivo, 'utf8'), p.nova));
      arquivos.push('app/package.json');
    } else {
      const texto = fs.readFileSync(GRADLE, 'utf8');
      const { codigo } = versoes.lerVersaoDoGradle(texto);
      fs.writeFileSync(GRADLE, versoes.trocarVersaoDoGradle(texto, p.nova, codigo + 1));
      arquivos.push('android/app/build.gradle');
    }
    info(`${versoes.PRODUTOS[p.produto].nome}: ${p.atual} -> ${p.nova}`);
  }
  const titulo = `chore: versão nova -- ${plano.subidas.map(p => `${versoes.PRODUTOS[p.produto].nome} ${p.nova}`).join(' e ')}`;
  const corpo = ['Feito pelo lançamento (npm run lancar, docs/lancar-aplicativos.md). O que mudou desde o build anterior:', '',
    ...plano.subidas.flatMap(p => [`${versoes.PRODUTOS[p.produto].nome} (${p.decisao.motivo}):`, ...(p.motivos.length ? p.motivos.map(l => `  ${l}`) : ['  (sem commits no código do build)'])])
  ].join('\n');
  git(['commit', '--quiet', '-m', titulo, '-m', corpo, '--', ...arquivos]);
  info(`Commit ${curto(git(['rev-parse', 'HEAD']))}: ${titulo}`);
}

function enviarAoGitHub(config, novo) {
  passo(`Enviando o ${config.ramo} ao ${config.remoto}`);
  rodar('git', ['push', ...(novo ? ['-u'] : []), config.remoto, `HEAD:refs/heads/${config.ramo}`]);
}

function garantirDependenciasDoApp() {
  const lock = crypto.createHash('sha256').update(fs.readFileSync(path.join(PASTA_APP, 'package-lock.json'))).digest('hex');
  const marca = path.join(PASTA_APP, 'node_modules', '.nexo-lock');
  const montada = fs.existsSync(path.join(PASTA_APP, 'node_modules', 'electron-builder', 'cli.js'));
  let anterior = null;
  try { anterior = fs.readFileSync(marca, 'utf8').trim(); } catch (_) { /* nunca marcada */ }
  if (montada && anterior === lock) return;
  info('Instalando as dependências do aplicativo (npm ci)...');
  rodarNpm('ci --no-audit --no-fund', PASTA_APP);
  fs.writeFileSync(marca, `${lock}\n`);
}

// O agente de áudio é compilado à parte (Visual Studio) e entra pronto no build do Windows. O
// lançamento não o compila: só avisa quando o código dele mudou desde o executável.
//
// A data não serve de prova: o executável costuma ser compilado da cópia de trabalho ANTES do commit
// do mesmo código, e aí o commit parece mais novo. Quem prova é a marca ao lado do executável
// (AgenteAudio.exe.fonte, fora do Git): a árvore do native/audio-agent de que ele saiu, gravada
// quando alguém confirma que ele está em dia. Sem marca, sobra a comparação de datas, como aviso.
function conferirAgenteDeAudio() {
  if (!fs.existsSync(AGENTE)) throw new Error(`Falta ${path.relative(RAIZ, AGENTE)}: compile o agente de áudio (native/audio-agent) antes.`);
  const arvore = git(['rev-parse', 'HEAD:native/audio-agent'], { permitirFalha: true });
  const marca = `${AGENTE}.fonte`;
  const comando = `git rev-parse HEAD:native/audio-agent > ${path.relative(RAIZ, marca)}`;
  let marcada = null;
  try { marcada = fs.readFileSync(marca, 'utf8').trim(); } catch (_) { /* nunca marcado */ }
  if (marcada) {
    if (arvore && marcada !== arvore) aviso(`O código do agente de áudio mudou desde que o AgenteAudio.exe foi compilado. Compile de novo e marque: ${comando}`);
    return;
  }
  const ultimoCommit = Number(git(['log', '-1', '--format=%ct', '--', 'native/audio-agent'], { permitirFalha: true })) * 1000;
  if (ultimoCommit && fs.statSync(AGENTE).mtimeMs < ultimoCommit) {
    aviso(`O código do agente de áudio tem commit mais novo que o AgenteAudio.exe. Se o executável já tem esse código, marque: ${comando}`);
  }
}

function construirWindows(config, versao) {
  passo(`Windows ${versao} (instalador e portátil)`);
  garantirDependenciasDoApp();
  conferirAgenteDeAudio();
  info(`Servidor padrão: ${escreverServidorPadrao({ NEXO_SERVIDOR_PADRAO: config.servidorPadrao })}`);
  fs.rmSync(SAIDA_LOCAL, { recursive: true, force: true });
  rodar(process.execPath, [path.join(PASTA_APP, 'node_modules', 'electron-builder', 'cli.js'),
    '--win', 'nsis', 'portable', '--x64', '--publish', 'never', `-c.directories.output=${NOME_DA_SAIDA}`],
  { cwd: PASTA_APP, env: { ...process.env, NEXO_SERVIDOR_PADRAO: config.servidorPadrao } });
  const saiu = /^version:\s*(\S+)/m.exec(fs.readFileSync(path.join(SAIDA_LOCAL, 'latest.yml'), 'utf8'))?.[1];
  if (saiu !== versao) throw new Error(`O build do Windows saiu como ${saiu}, e o lançamento é da ${versao}.`);
  fs.mkdirSync(DIST_LOCAL, { recursive: true });
  for (const arquivo of [...versoes.ARQUIVOS['windows-instalador'], ...versoes.ARQUIVOS.windows]) {
    fs.copyFileSync(path.join(SAIDA_LOCAL, arquivo), path.join(DIST_LOCAL, arquivo));
  }
  fs.rmSync(SAIDA_LOCAL, { recursive: true, force: true });
  anotador.anotar(['windows-instalador', 'windows'], { servidor: config.servidorPadrao });
}

// Um JDK 17 ou 21: o Gradle do Android não roda com o 25 (docs/android.md).
function acharJava(config) {
  const candidatos = [config.javaHome, process.env.JAVA_HOME];
  for (const base of ['C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Microsoft', '/usr/lib/jvm', '/Library/Java/JavaVirtualMachines']) {
    try { for (const nome of fs.readdirSync(base)) candidatos.push(path.join(base, nome), path.join(base, nome, 'Contents', 'Home')); } catch (_) { /* não existe */ }
  }
  for (const pasta of candidatos.filter(Boolean)) {
    let release = '';
    try { release = fs.readFileSync(path.join(pasta, 'release'), 'utf8'); } catch (_) { continue; }
    const maior = Number(/JAVA_VERSION="(\d+)/.exec(release)?.[1]);
    if (maior === 17 || maior === 21) return pasta;
  }
  throw new Error('O Android precisa de um JDK 17 ou 21 (o 25 não serve). Instale um, ou diga onde está em "javaHome" no config.json.');
}

function construirAndroid(config, versao) {
  passo(`Android ${versao}`);
  const java = acharJava(config);
  info(`JDK: ${java}`);
  rodar(process.execPath, [path.join(RAIZ, 'scripts', 'empacotar-android.cjs')],
    { env: { ...process.env, JAVA_HOME: java, NEXO_SERVIDOR_PADRAO: config.servidorPadrao } });
}

function exigirSalaVazia(estado, opcoes) {
  if (!estado.servicoAtivo || estado.participantes === 0 || opcoes.reiniciarComGente) return;
  throw new Error(estado.participantes == null
    ? 'Não consegui saber se há gente em chamada (as métricas do servidor de mídia não responderam). Confira e rode de novo com --reiniciar-com-gente.'
    : `Há ${estado.participantes} pessoa(s) em chamada, e atualizar a máquina reinicia o serviço -- derrubaria todas. Rode de novo quando a sala esvaziar, ou com --reiniciar-com-gente.`);
}

async function sincronizarMaquina(config, commit, opcoes) {
  passo(`Levando a máquina para ${curto(commit)}`);
  exigirSalaVazia(await lerEstado(config), opcoes);
  await remoto(config, 'sincronizar.sh', { NEXO_REMOTO: config.remoto, NEXO_RAMO: config.ramo, NEXO_COMMIT: commit });
}

async function publicar(config, chaves) {
  const arquivos = chaves.flatMap(chave => versoes.ARQUIVOS[chave]);
  passo(`Mandando para a máquina: ${arquivos.join(', ')}`);
  const tamanhos = {};
  const somas = [];
  for (const arquivo of arquivos) {
    const local = path.join(DIST_LOCAL, arquivo);
    tamanhos[arquivo] = fs.statSync(local).size;
    somas.push(`${await sha256(local)}  ${arquivo}`);
  }
  const total = Object.values(tamanhos).reduce((a, b) => a + b, 0);
  info(`${megas(total)} no total.`);
  const entrada = `/tmp/nexo-lancamento-${Date.now()}`;
  rodar('ssh', [...opcoesSsh(config), alvoSsh(config), `mkdir -p -m 700 ${aspas(entrada)}`]);
  rodar('scp', [...opcoesSsh(config, '-P'), ...arquivos, `${alvoSsh(config)}:${entrada}/`], { cwd: DIST_LOCAL });
  await remoto(config, 'publicar.sh', {
    NEXO_ENTRADA: entrada, NEXO_ARQUIVOS: arquivos.join(' '), NEXO_SOMAS: somas.join('\n'),
    NEXO_CHAVES: chaves.join(' '), NEXO_SERVIDOR_PADRAO: config.servidorPadrao
  });
  return tamanhos;
}

async function construirLinux(config, versao) {
  passo(`Linux ${versao} (AppImage e .deb), na máquina`);
  info('Numa máquina pequena isto leva alguns minutos.');
  await remoto(config, 'linux.sh', { NEXO_SERVIDOR_PADRAO: config.servidorPadrao, NEXO_SAIDA: NOME_DA_SAIDA });
}

async function buscar(config, caminho) {
  const resposta = await fetch(`${config.urlPublica}${caminho}`, { signal: AbortSignal.timeout(20000), headers: { 'cache-control': 'no-cache' } });
  if (!resposta.ok) throw new Error(`${config.urlPublica}${caminho} respondeu ${resposta.status}.`);
  return resposta;
}

// O que conta é o que o servidor anuncia para fora, pelo mesmo caminho que a página e os aplicativos usam.
async function conferirNoAr(config, esperadas, tamanhos) {
  passo(`Conferindo em ${config.urlPublica}`);
  const { sistemas = [] } = await (await buscar(config, '/api/desktop-app')).json();
  const problemas = [];
  for (const [chave, versao] of Object.entries(esperadas)) {
    const sistema = sistemas.find(s => s.chave === chave);
    if (!sistema) { problemas.push(`${chave}: não aparece no /api/desktop-app`); continue; }
    const arquivo = versoes.ARQUIVOS[chave][0];
    const tamanhoOk = !tamanhos[arquivo] || tamanhos[arquivo] === sistema.size;
    info(`${chave.padEnd(19)} ${String(sistema.versao).padEnd(8)} ${megas(sistema.size)}${sistema.versao === versao && tamanhoOk ? '' : '   <-- esperado ' + versao}`);
    if (sistema.versao !== versao) problemas.push(`${chave}: anuncia ${sistema.versao}, e o esperado é ${versao}`);
    else if (!tamanhoOk) problemas.push(`${chave}: o arquivo no ar tem ${sistema.size} bytes, e o mandado tem ${tamanhos[arquivo]}`);
  }
  for (const [ficha, chave] of [['latest.yml', 'windows-instalador'], ['latest-linux.yml', 'linux']]) {
    if (!esperadas[chave]) continue;
    const versao = /^version:\s*(\S+)/m.exec(await (await buscar(config, `/downloads/atualizacoes/${ficha}`)).text())?.[1];
    info(`${ficha.padEnd(19)} ${versao}`);
    if (versao !== esperadas[chave]) problemas.push(`${ficha}: diz ${versao}, e o esperado é ${esperadas[chave]}`);
  }
  if (problemas.length) throw new Error(`O servidor não anuncia o esperado:\n  ${problemas.join('\n  ')}`);
}

// ---------- O lançamento ----------

async function main() {
  const opcoes = lerOpcoes(process.argv.slice(2));
  if (opcoes.ajuda) { console.log(AJUDA); return; }
  const config = lerConfig(opcoes.config, opcoes);

  const ramo = conferirRamo(config);

  passo(`A máquina ${alvoSsh(config)}`);
  const estado = await lerEstado(config);
  if (!estado.instalado) throw new Error(`${config.vps.pasta} não existe na máquina. Instale o Nexo lá primeiro (deploy/oracle/instalar.sh, docs/oracle.md).`);
  info(`${config.vps.pasta}: ${estado.ramo} em ${curto(estado.head)}, serviço ${estado.servicoAtivo ? 'no ar' : 'parado'}, `
    + `${estado.participantes == null ? 'sem saber quem está em chamada' : `${estado.participantes} pessoa(s) em chamada`}.`);
  if (estado.sujo) throw new Error(`O código na máquina tem mudanças locais (git -C ${config.vps.pasta} status). Desfaça lá antes: o lançamento não passa por cima.`);
  if (estado.servidorPadrao && origemDoServidor(estado.servidorPadrao) !== config.servidorPadrao) {
    aviso(`O .env.prod da máquina diz NEXO_SERVIDOR_PADRAO=${estado.servidorPadrao}; os builds saem com ${config.servidorPadrao} (config.json).`);
  }

  const plano = planejar(config, estado, opcoes, ramo);
  mostrarPlano(plano, estado, ramo);
  const temTrabalho = plano.builds.length || plano.subidas.length || ramo.frente || plano.vpsAtras;
  if (opcoes.plano) return;
  if (!temTrabalho) {
    await conferirNoAr(config, esperadasDoPlano(plano, config), {});
    console.log(`\nTudo em dia: nada para lançar. (${tempo()})`);
    return;
  }
  if (plano.vpsAtras || plano.subidas.length) exigirSalaVazia(estado, opcoes);
  if (!(await confirmar('Seguir com este plano?', opcoes))) { console.log('Nada foi feito.'); return; }

  if (plano.subidas.length) aplicarVersoesNovas(plano);
  const commit = git(['rev-parse', 'HEAD']);
  if (ramo.frente || plano.subidas.length) enviarAoGitHub(config, ramo.novo);

  const { desktop, android } = plano.produtos;
  if (plano.builds.includes('windows')) construirWindows(config, desktop.nova);
  if (plano.builds.includes('android')) construirAndroid(config, android.nova);

  if (estado.head !== commit) await sincronizarMaquina(config, commit, opcoes);

  const locais = [
    ...(plano.builds.includes('windows') ? versoes.BUILDS.windows.chaves : []),
    ...(plano.builds.includes('android') ? versoes.BUILDS.android.chaves : [])
  ];
  const tamanhos = locais.length ? await publicar(config, locais) : {};
  if (plano.builds.includes('linux')) await construirLinux(config, desktop.nova);

  await conferirNoAr(config, esperadasDoPlano(plano, config), tamanhos);
  const final = await lerEstado(config);
  if (final.head !== commit) throw new Error(`A máquina terminou em ${curto(final.head)}, e o lançamento é do ${curto(commit)}.`);
  console.log(`\nLançado: ${Object.values(plano.produtos).map(p => `${versoes.PRODUTOS[p.produto].nome} ${p.nova}`).join(', ')}; a máquina está em ${curto(commit)}. (${tempo()})`);
}

// O que o servidor deve anunciar no fim: o número novo de cada produto, nas chaves que este
// lançamento constrói (as desligadas em "construir" ficam de fora -- delas não se espera nada).
function esperadasDoPlano(plano, config) {
  const esperadas = {};
  for (const p of Object.values(plano.produtos)) {
    for (const chave of versoes.PRODUTOS[p.produto].chaves) {
      const build = Object.keys(versoes.BUILDS).find(b => versoes.BUILDS[b].chaves.includes(chave));
      if (config.construir[build]) esperadas[chave] = p.nova;
    }
  }
  return esperadas;
}

function tempo() {
  const segundos = Math.round((Date.now() - inicio) / 1000);
  return segundos >= 60 ? `${Math.floor(segundos / 60)} min ${segundos % 60} s` : `${segundos} s`;
}

module.exports = { lerOpcoes, lerConfig };

if (require.main === module) {
  main().catch(erro => {
    console.error(`\n✗ ${erro.message}`);
    process.exitCode = 1;
  });
}
