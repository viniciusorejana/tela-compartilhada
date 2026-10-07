// A imagem da splash do portátil do Windows (app/build/splash.bmp), feita da MESMA página da splash do aplicativo
// (app/splash.html): a marca, a roda e a palavra NEXO nascem de um desenho só.
//
// Por que existe um arquivo à parte: o portátil é um executável que se DESEMPACOTA a cada abertura (alguns segundos,
// numa pasta temporária) antes de o Electron sequer começar, e nesse tempo não há janela nenhuma -- a pessoa
// clica e nada acontece. O electron-builder aceita uma imagem para esse intervalo (`portable.splashImage`), e ela
// tem de ser um BMP (o instalador é do NSIS). A splash de verdade, em HTML, só pode existir depois de o Electron
// subir; esta é a que cobre o que vem antes.
//
// Como: a página é aberta no navegador, as animações são paradas num quadro bonito (a roda no meio da volta, a frase
// "Abrindo o Nexo" já visível) e o quadro vira um BMP de 24 bits. `npm run splash:gerar` refaz; o resultado é
// versionado, porque o empacotamento não deve depender do Playwright.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const LARGURA = 460;
const ALTURA = 320;
// O instante da animação que vira a imagem: a roda a meio caminho e a primeira frase inteira (ela entra aos 0,7 s).
const INSTANTE_MS = 1500;

// BMP de 24 bits, sem compressão: cabeçalho de arquivo (14) + de imagem (40), e as linhas de baixo para cima, em BGR,
// cada uma completada até um múltiplo de 4 bytes.
function bmp24(largura, altura, rgba) {
  const linha = Math.ceil((largura * 3) / 4) * 4;
  const tamanho = 54 + linha * altura;
  const saida = Buffer.alloc(tamanho);
  saida.write('BM', 0, 'ascii');
  saida.writeUInt32LE(tamanho, 2);
  saida.writeUInt32LE(54, 10);
  saida.writeUInt32LE(40, 14);
  saida.writeInt32LE(largura, 18);
  saida.writeInt32LE(altura, 22);
  saida.writeUInt16LE(1, 26);
  saida.writeUInt16LE(24, 28);
  saida.writeUInt32LE(linha * altura, 34);
  saida.writeInt32LE(2835, 38);
  saida.writeInt32LE(2835, 42);
  for (let y = 0; y < altura; y++) {
    const destino = 54 + (altura - 1 - y) * linha;
    for (let x = 0; x < largura; x++) {
      const origem = (y * largura + x) * 4;
      saida[destino + x * 3] = rgba[origem + 2];
      saida[destino + x * 3 + 1] = rgba[origem + 1];
      saida[destino + x * 3 + 2] = rgba[origem];
    }
  }
  return saida;
}

(async () => {
  const navegador = await chromium.launch({ headless: true });
  try {
    const pagina = await navegador.newPage({ viewport: { width: LARGURA, height: ALTURA }, deviceScaleFactor: 1 });
    await pagina.goto(`file:///${path.resolve(__dirname, '../app/splash.html').replace(/\\/g, '/')}`);
    // Para as animações no instante escolhido -- e a página inteira, não só a primeira.
    await pagina.evaluate(instante => {
      for (const animacao of document.getAnimations()) { animacao.pause(); animacao.currentTime = instante; }
    }, INSTANTE_MS);
    await pagina.waitForTimeout(150);
    const png = await pagina.screenshot();
    // Do PNG para os pixels: pelo próprio navegador, sem biblioteca de imagem. Numa página em branco: a CSP da splash
    // (`default-src 'none'`) não deixa a dela abrir um `data:`.
    const leitora = await navegador.newPage();
    const rgba = await leitora.evaluate(async ({ base64, largura, altura }) => {
      const imagem = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const tela = new OffscreenCanvas(largura, altura);
      const contexto = tela.getContext('2d');
      contexto.drawImage(imagem, 0, 0);
      return Array.from(contexto.getImageData(0, 0, largura, altura).data);
    }, { base64: png.toString('base64'), largura: LARGURA, altura: ALTURA });
    const destino = path.join(__dirname, '../app/build/splash.bmp');
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, bmp24(LARGURA, ALTURA, Uint8Array.from(rgba)));
    console.log(`app/build/splash.bmp: ${LARGURA}x${ALTURA}, ${fs.statSync(destino).size} bytes`);
  } finally {
    await navegador.close();
  }
})().catch(erro => { console.error(erro); process.exit(1); });
