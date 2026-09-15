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
  if (diretoLocal) return { origem: endereco.origin, segura: false };
  let publica;
  try { publica = new URL(process.env.PUBLIC_URL); } catch (_) { return null; }
  if (publica.protocol !== 'https:' || publica.host !== host) return null;
  const tls = req.socket.encrypted || (proxies().includes(limparIp(req.socket.remoteAddress)) && req.headers['x-forwarded-proto'] === 'https');
  return tls ? { origem: publica.origin, segura: true } : null;
}
module.exports = { ipDoPedido, origemSegura, local };
