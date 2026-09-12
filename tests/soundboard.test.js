const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const soundboard = require('../soundboard');
const { caminhoDoFfmpeg } = require('../scripts/baixar-musica.cjs');

// Áudio de VERDADE, gerado na hora. A mesa passa tudo pelo ffmpeg para cortar e
// uniformizar, então bytes inventados não exercitariam o caminho que a sala usa -- eles
// seriam recusados logo na entrada, e o teste passaria sem ter testado nada.
const temFfmpeg = fs.existsSync(caminhoDoFfmpeg());

function gerar(segundos, argumentos) {
  return execFileSync(caminhoDoFfmpeg(), [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${segundos}`,
    ...argumentos, 'pipe:1'
  ], { maxBuffer: 8 * 1024 * 1024, windowsHide: true });
}

const audio = temFfmpeg ? {
  MP3: gerar(1, ['-c:a', 'libmp3lame', '-b:a', '96k', '-f', 'mp3']),
  OGG: gerar(1, ['-c:a', 'libvorbis', '-f', 'ogg']),
  WAV: gerar(1, ['-c:a', 'pcm_s16le', '-f', 'wav']),
  LONGO: gerar(40, ['-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3'])
} : {};
const EXE = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(62)]);

const salaNova = (() => { let n = 0; return () => `sala-teste-${++n}`; })();
const semFfmpeg = { skip: temFfmpeg ? false : 'o ffmpeg não está instalado (npm run musica:instalar)' };

// 128 kbps é o que sai da normalização, então o tamanho guardado diz quantos segundos
// entraram — é assim que se confere um corte sem decodificar de novo.
const segundosGuardados = som => som.tamanho / (128000 / 8);

test('o que entra na mesa é conferido pelos bytes, não pelo que o navegador declara', semFfmpeg, async () => {
  const sala = salaNova();
  assert.ok((await soundboard.adicionar(sala, { nome: 'ok', tipo: 'audio/mpeg', bytes: audio.MP3 })).som);
  assert.ok((await soundboard.adicionar(sala, { nome: 'ok', tipo: 'audio/ogg', bytes: audio.OGG })).som);
  assert.ok((await soundboard.adicionar(sala, { nome: 'ok', tipo: 'audio/wav', bytes: audio.WAV })).som);

  // Um executável com o tipo de áudio na etiqueta é exatamente o caso que a conferência de
  // assinatura existe para barrar: ele seria guardado e servido de volta para a sala.
  assert.match((await soundboard.adicionar(sala, { nome: 'x', tipo: 'audio/mpeg', bytes: EXE })).erro, /não parece ser áudio/);
  assert.match((await soundboard.adicionar(sala, { nome: 'x', tipo: 'application/x-msdownload', bytes: audio.MP3 })).erro, /Formato não aceito/);
  assert.match((await soundboard.adicionar(sala, { nome: 'x', tipo: 'audio/mpeg', bytes: Buffer.alloc(0) })).erro, /vazio/);
  assert.match((await soundboard.adicionar(sala, { nome: 'x', tipo: 'audio/mpeg', bytes: 'nem é buffer' })).erro, /vazio/);
  soundboard.limparSala(sala);
});

// Recusar um arquivo longo seria grosseiro com quem só queria o comecinho de uma música.
// O corte é feito no SERVIDOR, e não na boa vontade de quem envia: é isto que o teste fixa.
test('áudio longo entra cortado, não recusado', semFfmpeg, async () => {
  const sala = salaNova();
  const { som, erro, cortado } = await soundboard.adicionar(sala, {
    nome: 'musica inteira', tipo: 'audio/mpeg', bytes: audio.LONGO, segundos: 40
  });
  assert.equal(erro, undefined, 'tinha de aceitar, cortando');
  assert.equal(cortado, true);

  // O corte tem de aparecer no tamanho -- senão ele não aconteceu, e o teste estaria só
  // conferindo que nada quebrou.
  const guardado = soundboard.obter(sala, som.id);
  const duracao = segundosGuardados(guardado);
  assert.ok(duracao > 27 && duracao < 33, `esperava ~30 s guardados, deu ~${duracao.toFixed(0)} s`);
  // Tudo sai como MP3, seja o que for que tenha entrado: é o que todo navegador toca.
  assert.equal(guardado.tipo, 'audio/mpeg');
  soundboard.limparSala(sala);
});

test('um som curto passa inteiro e não se anuncia como cortado', semFfmpeg, async () => {
  const sala = salaNova();
  const { som, cortado } = await soundboard.adicionar(sala, { nome: 'curto', tipo: 'audio/mpeg', bytes: audio.MP3, segundos: 1 });
  assert.equal(cortado, false);
  const duracao = segundosGuardados(soundboard.obter(sala, som.id));
  assert.ok(duracao < 2, `um som de 1 s virou ${duracao.toFixed(1)} s`);
  soundboard.limparSala(sala);
});

test('o nome vira rótulo de botão: sem controles, sem tamanho ilimitado, nunca vazio', semFfmpeg, async () => {
  const sala = salaNova();
  const nomeDe = async bruto => (await soundboard.adicionar(sala, { nome: bruto, tipo: 'audio/mpeg', bytes: audio.MP3 })).som.nome;
  assert.equal(await nomeDe('risada\nda\tmesa'), 'risada da mesa');
  assert.equal(await nomeDe('   '), 'Som');
  assert.equal(await nomeDe(undefined), 'Som');
  assert.equal((await nomeDe('x'.repeat(200))).length, soundboard.TAMANHO_MAXIMO_DO_NOME);
  soundboard.limparSala(sala);
});

test('os limites da sala existem para a memória de quem hospeda ter fim', semFfmpeg, async () => {
  const sala = salaNova();
  const grande = Buffer.concat([audio.MP3, Buffer.alloc(soundboard.BYTES_MAXIMOS_DO_SOM)]);
  assert.match((await soundboard.adicionar(sala, { nome: 'grande', tipo: 'audio/mpeg', bytes: grande })).erro, /MB/);

  for (let i = 0; i < soundboard.SONS_MAXIMOS_POR_SALA; i++) {
    assert.ok((await soundboard.adicionar(sala, { nome: `som ${i}`, tipo: 'audio/mpeg', bytes: audio.MP3 })).som);
  }
  assert.match((await soundboard.adicionar(sala, { nome: 'a mais', tipo: 'audio/mpeg', bytes: audio.MP3 })).erro, /já tem/);
  assert.equal(soundboard.listar(sala).length, soundboard.SONS_MAXIMOS_POR_SALA);
  soundboard.limparSala(sala);
});

test('a lista que a sala recebe nunca carrega os bytes do som', semFfmpeg, async () => {
  const sala = salaNova();
  const { som } = await soundboard.adicionar(sala, { nome: 'risada', tipo: 'audio/mpeg', bytes: audio.MP3, porQuem: 'Vinicius' });
  assert.equal(som.bytes, undefined);
  assert.equal(soundboard.listar(sala)[0].bytes, undefined);
  assert.equal(soundboard.listar(sala)[0].porQuem, 'Vinicius');
  // Só quem pede o arquivo por HTTP recebe o conteúdo.
  assert.ok(Buffer.isBuffer(soundboard.obter(sala, som.id).bytes));
  soundboard.limparSala(sala);
});

test('uma sala não enxerga a mesa de outra, e some inteira quando a sala acaba', semFfmpeg, async () => {
  const umaSala = salaNova();
  const outraSala = salaNova();
  const { som } = await soundboard.adicionar(umaSala, { nome: 'risada', tipo: 'audio/mpeg', bytes: audio.MP3 });

  assert.equal(soundboard.obter(outraSala, som.id), null);
  assert.equal(soundboard.listar(outraSala).length, 0);

  soundboard.limparSala(umaSala);
  assert.equal(soundboard.obter(umaSala, som.id), null);
  assert.equal(soundboard.listar(umaSala).length, 0);
  assert.equal(soundboard.espacoDaSala(umaSala).usado, 0);
});

// O limite por sala se multiplica pelo número de salas, que não tem limite: sem um teto
// global, vinte salas cheias são meio giga de Buffer e o processo inteiro cai -- levando
// vídeo e voz junto, por causa de uma mesa de sons. O teto só vale se a contabilidade for
// exata nos dois sentidos; um caminho de saída que esqueça de devolver o espaço faz o
// teto fechar sozinho até recusar tudo, e isso não apareceria em nenhum outro teste.
test('o espaço global é devolvido por todo caminho de saída', semFfmpeg, async () => {
  const inicio = soundboard.usoGlobal();
  const salas = [salaNova(), salaNova(), salaNova()];
  for (const sala of salas) {
    for (let i = 0; i < 4; i++) await soundboard.adicionar(sala, { nome: `s${i}`, tipo: 'audio/mpeg', bytes: audio.MP3 });
  }
  const cheio = soundboard.usoGlobal();
  assert.ok(cheio.contabilizado > inicio.contabilizado, 'o uso tem de ter subido');
  assert.equal(cheio.contabilizado, cheio.real, 'o contador tem de bater com a soma das mesas');

  // saída 1: apagar um som
  soundboard.remover(salas[0], soundboard.listar(salas[0])[0].id);
  assert.equal(soundboard.usoGlobal().contabilizado, soundboard.usoGlobal().real);

  // saída 2: a sala esvaziar (o caminho normal, quando a última pessoa sai)
  for (const sala of salas) soundboard.limparSala(sala);
  const fim = soundboard.usoGlobal();
  assert.equal(fim.contabilizado, inicio.contabilizado, 'tudo que entrou tem de ter saído');
  assert.equal(fim.contabilizado, fim.real);
});

test('o teto global recusa em vez de deixar o processo cair', semFfmpeg, async () => {
  const sala = salaNova();
  // Um som maior que o teto global inteiro: seria aceito pelos limites por sala, e é
  // exatamente o caso que o teto global existe para barrar.
  const gigante = Buffer.concat([audio.MP3, Buffer.alloc(soundboard.BYTES_MAXIMOS_DE_TODAS)]);
  const { erro } = await soundboard.adicionar(sala, { nome: 'enorme', tipo: 'audio/mpeg', bytes: gigante });
  assert.ok(erro, 'tinha de recusar');
  assert.equal(soundboard.listar(sala).length, 0);
  assert.equal(soundboard.usoGlobal().contabilizado, soundboard.usoGlobal().real);
  soundboard.limparSala(sala);
});

test('apagar um som devolve o espaço dele', semFfmpeg, async () => {
  const sala = salaNova();
  const { som } = await soundboard.adicionar(sala, { nome: 'risada', tipo: 'audio/mpeg', bytes: audio.MP3 });
  assert.ok(soundboard.espacoDaSala(sala).usado > 0);
  assert.equal(soundboard.remover(sala, som.id).nome, 'risada');
  assert.equal(soundboard.remover(sala, som.id), null);   // apagar duas vezes não quebra
  assert.equal(soundboard.espacoDaSala(sala).usado, 0);
});
