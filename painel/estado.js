let estado = { periodo: '7d', contabilidade: null, atual: null };
const ouvintes = new Set();
export function lerEstado() { return estado; }
export function atualizarEstado(mudancas) { estado = { ...estado, ...mudancas }; for (const ouvir of ouvintes) ouvir(estado); }
export function observar(ouvir) { ouvintes.add(ouvir); ouvir(estado); return () => ouvintes.delete(ouvir); }
