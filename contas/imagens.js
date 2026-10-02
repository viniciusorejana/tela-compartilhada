// As imagens que uma conta pode guardar: o avatar e as do Estúdio.
//
// O tipo é decidido pelos BYTES, nunca pelo nome do arquivo nem pelo cabeçalho que o navegador
// manda: uma imagem é servida para a sala inteira, e um "PNG" que fosse HTML ou SVG por dentro
// seria um script rodando na origem do Nexo. SVG fica de fora pelo mesmo motivo -- é um
// documento, não uma imagem. A entrega completa a defesa (contas/rotas.js): tipo fixo, `nosniff`
// e uma CSP que não deixa nada rodar mesmo que alguém abra o endereço direto.
//
// Não há decodificação aqui: o servidor não carrega biblioteca de imagem nenhuma, e o teto é de
// bytes. Quem redimensiona o avatar é a página, antes de enviar (public/imagem-envio.js).

const MiB = 1024 * 1024;

const LIMITES = Object.freeze({
  // O avatar chega redimensionado a 512 px pela página (256 se não couber), e assim fica em
  // dezenas de KB. Quem usa o teto é o GIF animado, que vem como está -- e que cada pessoa da sala
  // baixa (uma vez só: o endereço muda a cada troca, e fica em cache para sempre).
  avatar: { bytes: 6 * MiB },
  // As do Estúdio vêm como estão: são a arte de quem transmite, muitas vezes GIF animado ou PNG
  // com fundo transparente, e recomprimir estragaria as duas coisas. O total da conta acompanha o
  // teto de cada uma: com 12 MB por imagem, um teto de 16 caberia uma imagem só.
  estudio: { bytes: 12 * MiB, quantas: 40, total: 64 * MiB },
  // O rosto que a própria pessoa escolhe para os Estúdios dos outros: uma imagem por estado
  // (quatro no máximo, pela forma -- contas/banco.js troca a anterior), com o teto das do Estúdio.
  rosto: { bytes: 12 * MiB },
  // O banner e o fundo do cartão de perfil (public/vitrine.js). A imagem parada chega reduzida
  // pela página; o GIF vem como está -- é a animação que a pessoa escolheu --, e cada pessoa que
  // abre o cartão o baixa uma vez (o endereço muda a cada troca e fica em cache para sempre).
  banner: { bytes: 8 * MiB },
  fundo: { bytes: 8 * MiB }
});

function tipoDosBytes(bytes) {
  if (!bytes || bytes.length < 12) return null;
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  const inicio = Buffer.from(b.subarray(0, 6)).toString('latin1');
  if (inicio === 'GIF87a' || inicio === 'GIF89a') return 'image/gif';
  if (Buffer.from(b.subarray(0, 4)).toString('latin1') === 'RIFF' && Buffer.from(b.subarray(8, 12)).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// Devolve `{ tipo }` ou `{ erro }`. O tipo declarado tem de bater com o dos bytes: um desencontro
// é arquivo renomeado, e dizer isso ajuda mais do que aceitar calado.
function conferirImagem(bytes, uso, tipoDeclarado = '') {
  const limite = LIMITES[uso];
  if (!limite) return { erro: 'Uso de imagem desconhecido.' };
  if (!bytes || !bytes.length) return { erro: 'A imagem chegou vazia.' };
  if (bytes.length > limite.bytes) return { erro: `A imagem passa de ${limite.bytes >= MiB ? `${Math.round(limite.bytes / MiB)} MB` : `${Math.round(limite.bytes / 1024)} KB`}.`, status: 413 };
  const tipo = tipoDosBytes(bytes);
  if (!tipo) return { erro: 'Aceitamos PNG, JPEG, GIF e WebP.' };
  const declarado = String(tipoDeclarado || '').split(';')[0].trim().toLowerCase();
  if (declarado && declarado !== 'application/octet-stream' && declarado !== tipo) return { erro: 'O arquivo não é do tipo que diz ser.' };
  return { tipo };
}

module.exports = { LIMITES, tipoDosBytes, conferirImagem };
