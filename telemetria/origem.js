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

// ---------- Quais páginas podem falar com este servidor ----------
//
// Enquanto a credencial vivia só na memória da página, aceitar qualquer origem no Socket.IO
// era inofensivo: outro site não tinha como apresentá-la. A conta viaja num COOKIE, e aí o
// navegador o anexa sozinho -- um site qualquer, aberto por quem tem conta, conseguiria abrir
// um socket ou mandar um POST em nome dela. Por isso esta conferência entra ANTES de o cookie
// existir, e o padrão deixa de ser "qualquer um".
//
// Valem três coisas: a origem do PUBLIC_URL, as de CORS_ORIGIN (lista separada por vírgula),
// e a própria origem do pedido -- a página servida por este servidor, pelo endereço em que
// ela foi aberta. Esta última cobre localhost, a rede local e o aplicativo de mesa sem
// configuração nenhuma, e não abre porta: um site de fora manda a origem DELE, que não bate
// com o endereço daqui.
function origensConfiguradas() {
  const lista = String(process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  if (process.env.PUBLIC_URL) lista.push(process.env.PUBLIC_URL);
  const origens = [];
  for (const texto of lista) {
    try { const url = new URL(texto); if (['http:', 'https:'].includes(url.protocol)) origens.push(url.origin); } catch (_) { /* '*' e afins não valem */ }
  }
  return [...new Set(origens)];
}
function hospedeirosDoPedido(req) {
  const lista = [String(req.headers?.host || '')];
  if (proxies().includes(limparIp(req.socket?.remoteAddress))) lista.push(...String(req.headers?.['x-forwarded-host'] || '').split(','));
  return lista.map(h => h.trim().toLowerCase()).filter(Boolean);
}
// Sem cabeçalho Origin, só pedidos que não vêm de navegador -- que não carregam o cookie
// sozinhos, e por isso não são o ataque que isto evita. Escritas da conta exigem a origem.
function origemDaPaginaPermitida(req, { exigir = false } = {}) {
  const origem = req.headers?.origin;
  if (!origem) return !exigir;
  let url;
  try { url = new URL(origem); } catch (_) { return false; }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  if (origensConfiguradas().includes(url.origin)) return true;
  return hospedeirosDoPedido(req).includes(url.host.toLowerCase());
}
// O cookie leva `Secure` quando quem está do outro lado usa HTTPS -- inclusive atrás de um
// túnel, que entrega em HTTP puro para o Node o que chegou cifrado ao navegador.
function pedidoSeguro(req) {
  if (req.socket?.encrypted) return true;
  if (proxies().includes(limparIp(req.socket?.remoteAddress)) && String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') return true;
  try {
    const publica = new URL(process.env.PUBLIC_URL);
    return publica.protocol === 'https:' && hospedeirosDoPedido(req).includes(publica.host.toLowerCase());
  } catch (_) { return false; }
}
module.exports = { ipDoPedido, origemSegura, origemDoPainel, local, remotoLiberado, origensConfiguradas, origemDaPaginaPermitida, pedidoSeguro };
