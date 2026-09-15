const net = require('node:net');
const limparIp = valor => String(valor || '').replace(/^::ffff:/, '');
const local = ip => ['127.0.0.1', '::1'].includes(limparIp(ip));
const proxies = () => (process.env.NEXO_PROXIES_CONFIAVEIS || '').split(',').map(limparIp).filter(Boolean);
function ipDoPedido(req) {
  const ip = limparIp(req.socket?.remoteAddress || req.conn?.remoteAddress);
  if (proxies().includes(ip)) {
    const cadeia = String(req.headers?.['x-forwarded-for'] || '').split(',').map(s => limparIp(s.trim())).filter(s => net.isIP(s));
    // Percorrer da conexão para fora evita aceitar um IP inventado na ponta esquerda.
    let atual = ip;
    while (cadeia.length && proxies().includes(atual)) atual = cadeia.pop();
    return atual;
  }
  return ip || 'desconhecido';
}
function origemSegura(req) {
  const host = String(req.headers.host || '');
  let endereco;
  try { endereco = new URL(`http://${host}`); } catch (_) { return null; }
  const diretoLocal = local(req.socket.remoteAddress) && ['localhost', '127.0.0.1', '[::1]'].includes(endereco.hostname)
    && !['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'].some(k => req.headers[k]);
  if (diretoLocal) return { origem: endereco.origin, segura: false, local: true };
  let publica;
  try { publica = new URL(process.env.PUBLIC_URL); } catch (_) { return null; }
  if (publica.protocol !== 'https:' || publica.host !== host) return null;
  const tls = req.socket.encrypted || (proxies().includes(limparIp(req.socket.remoteAddress)) && req.headers['x-forwarded-proto'] === 'https');
  return tls ? { origem: publica.origin, segura: true, local: false } : null;
}

// O painel mostra as salas abertas, os nomes que dispararam alertas e o custo de tudo. É a
// visão administrativa do servidor, e por isso ela para na máquina do servidor.
//
// Antes, quem decidia isso por acidente era NEXO_PROXIES_CONFIAVEIS: sem ela o painel ficava
// fechado de fora, e ao ligá-la -- que é o recomendado para os limites por IP funcionarem
// atrás de um túnel -- o login passava a responder pelo endereço público também. Duas
// decisões sem relação nenhuma presas na mesma variável. Agora são separadas: os limites
// seguem o proxy, o painel segue esta função, e ligar um não mexe no outro.
//
// NEXO_PAINEL_REMOTO=1 devolve o acesso remoto para quem quiser, de propósito e por escrito.
const remotoLiberado = () => (process.env.NEXO_PAINEL_REMOTO || '').trim() === '1';
function origemDoPainel(req) {
  const origem = origemSegura(req);
  if (!origem) return null;
  return origem.local || remotoLiberado() ? origem : null;
}
module.exports = { ipDoPedido, origemSegura, origemDoPainel, local, remotoLiberado };
