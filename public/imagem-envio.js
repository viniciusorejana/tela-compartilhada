/* Preparar uma imagem no navegador antes de enviá-la: o avatar e as do Estúdio.
 *
 * O servidor não decodifica imagem nenhuma (contas/imagens.js): ele confere o tipo pelos bytes
 * e o tamanho. Quem recorta e reduz é a página, e por um motivo prático -- uma foto de celular
 * tem 4 MB e 4000 px, e o avatar aparece num círculo de 40. Enviar a foto inteira seria fazer
 * cada pessoa da sala baixar 4 MB para ver um círculo.
 *
 * O GIF passa como está quando cabe: recortá-lo num canvas guardaria só o primeiro quadro, e a
 * animação é justamente o motivo de alguém escolher um GIF.
 */
(function (root) {
  const TIPOS_ACEITOS = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const LADO_DO_AVATAR = 256;
  const BYTES_DO_AVATAR = 512 * 1024;
  const BYTES_DO_ESTUDIO = 2 * 1024 * 1024;
  const LADO_MAXIMO_DO_ESTUDIO = 1024;

  class ProblemaDeImagem extends Error {}

  function conferirTipo(arquivo) {
    if (!arquivo) throw new ProblemaDeImagem('Nenhum arquivo escolhido.');
    if (!TIPOS_ACEITOS.includes(arquivo.type)) throw new ProblemaDeImagem('Escolha uma imagem PNG, JPEG, GIF ou WebP.');
  }

  function paraBlob(canvas, tipo, qualidade) {
    return new Promise(resolve => canvas.toBlob(resolve, tipo, qualidade));
  }

  // WebP quando o navegador sabe gerar; senão PNG. Os dois guardam transparência, e é comum o
  // avatar de quem transmite ser um recorte sem fundo.
  async function exportar(canvas) {
    const webp = await paraBlob(canvas, 'image/webp', 0.9);
    if (webp && webp.type === 'image/webp') return webp;
    return paraBlob(canvas, 'image/png');
  }

  async function decodificar(arquivo) {
    try { return await createImageBitmap(arquivo); }
    catch (_) { throw new ProblemaDeImagem('Não foi possível abrir esta imagem.'); }
  }

  // O avatar: o quadrado do meio da imagem, em 256 px.
  async function prepararAvatar(arquivo) {
    conferirTipo(arquivo);
    if (arquivo.type === 'image/gif') {
      if (arquivo.size <= BYTES_DO_AVATAR) return arquivo;
      throw new ProblemaDeImagem('GIF animado como foto pode ter até 512 KB. Este tem mais.');
    }
    const imagem = await decodificar(arquivo);
    const lado = Math.min(imagem.width, imagem.height);
    const canvas = Object.assign(document.createElement('canvas'), { width: LADO_DO_AVATAR, height: LADO_DO_AVATAR });
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imagem, (imagem.width - lado) / 2, (imagem.height - lado) / 2, lado, lado, 0, 0, LADO_DO_AVATAR, LADO_DO_AVATAR);
    imagem.close?.();
    const blob = await exportar(canvas);
    if (!blob || blob.size > BYTES_DO_AVATAR) throw new ProblemaDeImagem('Não foi possível reduzir esta imagem.');
    return blob;
  }

  // As do Estúdio vão como estão quando cabem: é a arte de quem transmite. Uma imagem parada
  // grande demais é reduzida até 1024 px no lado maior, sem recorte; um GIF grande demais não
  // tem como ser reduzido aqui sem perder a animação, e a pessoa fica sabendo.
  async function prepararDoEstudio(arquivo) {
    conferirTipo(arquivo);
    if (arquivo.size <= BYTES_DO_ESTUDIO) return arquivo;
    if (arquivo.type === 'image/gif') throw new ProblemaDeImagem('Um GIF pode ter até 2 MB. Este tem mais.');
    const imagem = await decodificar(arquivo);
    const escala = Math.min(1, LADO_MAXIMO_DO_ESTUDIO / Math.max(imagem.width, imagem.height));
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(imagem.width * escala), height: Math.round(imagem.height * escala) });
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imagem, 0, 0, canvas.width, canvas.height);
    imagem.close?.();
    const blob = await exportar(canvas);
    if (!blob || blob.size > BYTES_DO_ESTUDIO) throw new ProblemaDeImagem('A imagem continua grande demais mesmo reduzida.');
    return blob;
  }

  // Sobe o arquivo como corpo cru, com o tipo dele: o servidor confere os bytes de qualquer jeito.
  async function enviar(caminho, blob, { metodo = 'PUT', csrf = '' } = {}) {
    let resposta;
    try {
      resposta = await fetch(caminho, { method: metodo, credentials: 'same-origin', headers: { 'Content-Type': blob.type || 'application/octet-stream', 'X-Nexo-CSRF': csrf }, body: blob });
    } catch (_) {
      return { ok: false, status: 0, dados: { error: 'Sem conexão com o servidor. Tente de novo.' } };
    }
    const dados = await resposta.json().catch(() => ({}));
    return { ok: resposta.ok, status: resposta.status, dados };
  }

  root.NexoImagem = { prepararAvatar, prepararDoEstudio, enviar, ProblemaDeImagem, TIPOS_ACEITOS };
})(window);
