function criarUso({ agora = Date.now } = {}) {
  const salas = new Map(), sessoes = new Map();
  let inicio = agora(), ultimo = inicio;
  const novo = () => ({ distribuicao: { '1': 0, '2': 0, '3–6': 0, '7–15': 0, '16+': 0 }, salasConcluidas: 0, segundosSalas: 0, sessoesConcluidas: 0, segundosPermanencia: 0, picoSimultaneas: 0 });
  let janela = novo();
  const faixa = n => n === 1 ? '1' : n === 2 ? '2' : n <= 6 ? '3–6' : n <= 15 ? '7–15' : '16+';
  function integrar() {
    const instante = agora(), segundos = Math.max(0, instante - ultimo) / 1000; ultimo = instante;
    for (const sala of salas.values()) janela.distribuicao[faixa(sala.quantidade)] += segundos;
    janela.picoSimultaneas = Math.max(janela.picoSimultaneas, salas.size);
  }
  function entrar(id, codigo) {
    if (sessoes.has(id)) return;
    if (sessoes.size >= 2048 || (!salas.has(codigo) && salas.size >= 512)) return;
    integrar();
    const sala = salas.get(codigo) || { inicio: agora(), quantidade: 0 };
    sala.quantidade++; salas.set(codigo, sala); sessoes.set(id, { sala: codigo, inicio: agora() });
    janela.picoSimultaneas = Math.max(janela.picoSimultaneas, salas.size);
  }
  function sair(id) {
    const sessao = sessoes.get(id); if (!sessao) return;
    integrar(); sessoes.delete(id);
    janela.sessoesConcluidas++; janela.segundosPermanencia += Math.max(0, agora() - sessao.inicio) / 1000;
    const sala = salas.get(sessao.sala);
    if (sala && --sala.quantidade === 0) {
      janela.salasConcluidas++; janela.segundosSalas += Math.max(0, agora() - sala.inicio) / 1000; salas.delete(sessao.sala);
    }
  }
  function fechar() {
    integrar(); const fim = agora();
    const registro = { v: 1, t: new Date(fim).toISOString(), segundos: Math.max(0.001, (fim - inicio) / 1000), simultaneas: salas.size, ...janela };
    inicio = fim; janela = novo(); return registro;
  }
  return { entrar, sair, fechar, atual: () => ({ salas: salas.size, sessoes: sessoes.size }) };
}
module.exports = { criarUso };
