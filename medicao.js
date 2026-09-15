// Quanto a sala custa de banda -- medido onde o número é exato: no que cada pessoa recebeu.
//
// O servidor de mídia não sabe responder isso. O Prometheus dele conta PACOTES, não bytes, e
// não separa tela de câmera: serve para ver se algo está vivo, não para saber o que a conta
// vai cobrar. Quem sabe o número certo é quem recebeu -- cada navegador tem `bytesReceived`
// por faixa, e a soma de todos eles É, por definição, o que saiu daqui.
//
// A medição existe para UMA pergunta: quanto cada fonte custa. Sem ela, "baixar a qualidade
// da tela" e "assinar menos câmeras" são palpites que competem por atenção; com ela, são dois
// números que se comparam. Por isso o que se guarda é pouco e grosso -- bytes por sala, por
// fonte, por janela -- e vai para arquivo, que sobrevive ao reinício e ainda vai estar lá
// quando a pergunta for "o que a mudança do mês passado economizou de verdade".
//
// O que NÃO se guarda, de propósito: quem recebeu. A conta é da sala, não da pessoa. Um
// arquivo que dissesse quanto cada um assistiu seria um registro de comportamento, e isso não
// é necessário para decidir bitrate.
const fs = require('node:fs');
const path = require('node:path');

const PASTA = path.join(__dirname, 'native', 'medicao');
const ARQUIVO = path.join(PASTA, 'banda.jsonl');

// De quanto em quanto tempo o acumulado vai para o disco. Curto demais enche o arquivo de
// linhas quase vazias; longo demais perde a última janela quando o processo cai.
const SEGUNDOS_POR_JANELA = 60;

// Teto do arquivo. Uma sala movimentada gera algumas dezenas de linhas por hora, então isto
// cobre meses -- mas um arquivo sem limite é um jeito lento de encher o disco de quem hospeda.
const BYTES_MAXIMOS = 8 * 1024 * 1024;

const FONTES = ['screen', 'camera', 'micAudio', 'screenAudio'];

// Acumulado da janela corrente, por sala. Zera a cada gravação.
const janela = new Map();
let timer = null;
let avisouFalha = false;

function zerado() {
  return { screen: 0, camera: 0, micAudio: 0, screenAudio: 0, pico: 0, amostras: 0 };
}

// Chamado por cada cliente, com o que ELE recebeu desde o próprio relatório anterior. Vem de
// fora, então nada aqui confia no formato: um número que não é número é descartado em vez de
// virar NaN e contaminar a soma da sala inteira.
//
// O teto por amostra existe pelo mesmo motivo. Num relatório honesto ele nunca é atingido --
// 2 GB numa janela de um minuto seriam 280 Mbps para uma pessoa só -- e num relatório
// adulterado ele é a diferença entre um número estranho e um arquivo inutilizável.
const BYTES_MAXIMOS_POR_AMOSTRA = 2 * 1024 * 1024 * 1024;

function registrar(sala, recebido, pessoas) {
  if (!sala || !recebido || typeof recebido !== 'object') return;
  const atual = janela.get(sala) || zerado();
  let total = 0;
  for (const fonte of FONTES) {
    const bytes = Number(recebido[fonte]);
    if (!Number.isFinite(bytes) || bytes <= 0) continue;
    const limpo = Math.min(bytes, BYTES_MAXIMOS_POR_AMOSTRA);
    atual[fonte] += limpo;
    total += limpo;
  }
  if (!total) return;
  atual.amostras++;
  // Quantas pessoas havia quando o custo foi este. Sem isso, "40 Mbps" não diz se a sala
  // estava cara ou apenas cheia -- e é justamente essa razão que decide o que otimizar.
  const quantos = Number(pessoas);
  if (Number.isFinite(quantos) && quantos > atual.pico) atual.pico = Math.min(quantos, 1000);
  janela.set(sala, atual);
  if (!timer) agendarGravacao();
}

function agendarGravacao() {
  timer = setTimeout(() => { timer = null; gravar(); }, SEGUNDOS_POR_JANELA * 1000);
  timer.unref?.();
}

function gravar() {
  if (!janela.size) return;
  const instante = new Date().toISOString();
  const linhas = [];
  for (const [sala, dados] of janela) {
    const total = FONTES.reduce((soma, fonte) => soma + dados[fonte], 0);
    if (!total) continue;
    linhas.push(JSON.stringify({
      t: instante, sala, segundos: SEGUNDOS_POR_JANELA, pessoas: dados.pico,
      amostras: dados.amostras, total,
      screen: dados.screen, camera: dados.camera,
      micAudio: dados.micAudio, screenAudio: dados.screenAudio
    }));
  }
  janela.clear();
  if (!linhas.length) return;
  try {
    fs.mkdirSync(PASTA, { recursive: true });
    // Passou do teto: o arquivo vira ".anterior" e um novo começa. Guardar uma geração
    // preserva a comparação com o período passado, que é o motivo de medir.
    try {
      if (fs.statSync(ARQUIVO).size > BYTES_MAXIMOS) fs.renameSync(ARQUIVO, `${ARQUIVO}.anterior`);
    } catch (_) { /* Não existe ainda: nada a rotacionar. */ }
    fs.appendFileSync(ARQUIVO, linhas.join('\n') + '\n', 'utf8');
    avisouFalha = false;
  } catch (erro) {
    // Medição não pode derrubar sala. Avisa uma vez e volta a tentar na janela seguinte.
    if (!avisouFalha) {
      avisouFalha = true;
      console.error(`A medição de banda não conseguiu gravar (${erro.message}). A sala segue normalmente.`);
    }
  }
}

// Um processo encerrado no meio de uma janela perderia o último minuto -- justamente o minuto
// em que alguém costuma estar olhando para ver se a mudança funcionou.
function encerrar() {
  clearTimeout(timer);
  timer = null;
  gravar();
}
for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sinal, encerrar);
process.on('exit', encerrar);

module.exports = { registrar, encerrar, ARQUIVO, FONTES, SEGUNDOS_POR_JANELA };
