// A chave do servidor para a tela por WebCodecs.
//
// O caminho novo troca o transporte da fonte mais cara da sala, e uma reescrita de transporte
// sem botão de desligar é irresponsável. Esta chave desliga o caminho novo para TODO mundo, sem
// ninguém atualizar nada: ela vai no `sala-config` de quem entra e, para quem já está na sala,
// por um aviso do socket -- e a sala inteira volta ao caminho de hoje em segundos.
//
// Duas origens, e o ambiente vence. `NEXO_WEBCODECS=0` (ou `=1`) é a chave de quem opera a
// máquina, e precisa valer mesmo que o painel tenha guardado outra coisa semanas antes. Sem
// ela, vale o que o painel guardou; sem nenhuma das duas, o caminho novo fica liberado -- e cada
// aparelho ainda decide sozinho se o usa (o "Automático" só entra com placa de vídeo).
const fs = require('node:fs');
const path = require('node:path');

function criarChaveDeWebCodecs({ pasta, ambiente = process.env.NEXO_WEBCODECS, aoMudar = () => {} }) {
  const arquivo = path.join(pasta, 'webcodecs.json');
  const doAmbiente = ambiente === '0' ? false : ambiente === '1' ? true : null;
  let guardado = null;
  try {
    const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    if (typeof dados?.ligado === 'boolean') guardado = { ligado: dados.ligado, em: Number(dados.em) || null };
  } catch (_) { /* sem arquivo: vale o padrão */ }

  function estado() {
    if (doAmbiente !== null) return { ligado: doAmbiente, origem: 'ambiente', em: null };
    if (guardado) return { ligado: guardado.ligado, origem: 'painel', em: guardado.em };
    return { ligado: true, origem: 'padrao', em: null };
  }

  function definir(ligado) {
    if (typeof ligado !== 'boolean') return { ok: false, status: 400, error: 'Diga se o caminho novo fica ligado ou desligado.' };
    if (doAmbiente !== null) {
      return { ok: false, status: 409, error: 'A chave está fixada pela variável NEXO_WEBCODECS. Mude no ambiente e reinicie o servidor.' };
    }
    const novo = { ligado, em: Date.now() };
    // Grava num temporário e renomeia: uma queda no meio da escrita deixaria um JSON pela
    // metade, e ele seria lido como "sem arquivo" -- o caminho novo voltaria sozinho ao ar
    // justamente depois de alguém ter apertado o botão de pânico.
    fs.mkdirSync(pasta, { recursive: true });
    const temporario = `${arquivo}.${process.pid}.tmp`;
    fs.writeFileSync(temporario, JSON.stringify(novo));
    fs.renameSync(temporario, arquivo);
    const mudou = guardado?.ligado !== ligado;
    guardado = novo;
    if (mudou) aoMudar(estado());
    return { ok: true, estado: estado() };
  }

  return { estado, ligado: () => estado().ligado, definir };
}

module.exports = { criarChaveDeWebCodecs };
