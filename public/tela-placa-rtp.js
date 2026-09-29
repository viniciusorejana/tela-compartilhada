/* A tela pela placa de vídeo, transportada pelo RTP.
 *
 * A tela sai pela mesma publicação RTP de sempre -- simulcast H.264, a camada de 360p e a
 * cheia --, com duas diferenças que quem assiste não vê:
 *  - as camadas nascem encolhidas no remetente (`miniaturas`, tela-decisoes.js): o codificador
 *    do WebRTC trabalha em 320x180, e não em 1440p, e quase não custa processador;
 *  - uma RTCRtpScriptTransform (tela-placa-rtp-trabalhador.js) troca o conteúdo de cada quadro
 *    que ele produz pelo quadro que a placa de vídeo codificou no tamanho da camada.
 *
 * O resultado junta o que cada caminho tinha de bom. A codificação é da placa, como na faixa
 * de dados; o transporte é o RTP -- o servidor de mídia só repassa pacotes, umas cinco vezes
 * menos processador por espectador (medido, docs/plano-webcodecs.md, "Teste de carga"), com
 * NACK, controle de congestionamento e o buffer de quem assiste, que são do navegador. E quem
 * assiste não precisa de nada: decodifica H.264 pelo RTP, em qualquer navegador e no celular.
 *
 * Uma exigência do Chrome decide a forma deste módulo: a transform tem de existir ANTES de o
 * remetente começar a enviar -- pendurada depois, ela é ignorada (medido: 104 quadros contra 0).
 * Por isso ela entra no `addTransceiver` que o LiveKit chama ao publicar, e não depois.
 */
(function (root) {
  const Codificador = root.NexoTelaCodificador;
  const Decisoes = root.NexoTelaDecisoes;

  const ENDERECO_DO_TRABALHADOR = '/tela-placa-rtp-trabalhador.js';
  // As estatísticas do remetente são o único jeito de saber o que o servidor pede (PLI e FIR,
  // que viram quadro-chave na placa) e quanto o WebRTC destina a cada camada. Um quarto de
  // segundo é o atraso que quem acaba de entrar espera a mais pela primeira imagem.
  const MS_ENTRE_LEITURAS = 250;
  const MS_ENTRE_ESTATISTICAS = 1000;
  // Uma transmissão que ficou dois minutos no ar sem falhar zera a contagem: uma falha isolada
  // não herda a espera de uma série antiga (a mesma regra do caminho pela faixa de dados).
  const MS_NO_AR_QUE_ZERA_AS_FALHAS = 120_000;

  function fluxosTransferiveis() {
    try {
      const canal = new MessageChannel();
      const fluxo = new ReadableStream();
      canal.port1.postMessage(fluxo, [fluxo]);
      canal.port1.close(); canal.port2.close();
      return true;
    } catch (_) { return false; }
  }

  let suporte = null;
  function suportado() {
    if (suporte === null) {
      suporte = typeof RTCRtpScriptTransform === 'function' && typeof MediaStreamTrackProcessor === 'function'
        && typeof VideoEncoder === 'function' && typeof Worker === 'function' && typeof RTCPeerConnection === 'function'
        && Boolean(Codificador && Decisoes) && fluxosTransferiveis();
    }
    return suporte;
  }

  // ---------- O nascimento do remetente ----------
  //
  // Um embrulho só, instalado na primeira vez, e que só age sobre a faixa armada: tudo o mais
  // (microfone, câmera, a tela pelo caminho de hoje) passa por ele sem mudança nenhuma.
  let armado = null;              // { faixa, aoNascer }
  let embrulhado = false;
  function embrulhar() {
    if (embrulhado) return;
    embrulhado = true;
    const original = RTCPeerConnection.prototype.addTransceiver;
    RTCPeerConnection.prototype.addTransceiver = function (faixaOuTipo, init) {
      const alvo = armado;
      if (!alvo || faixaOuTipo !== alvo.faixa) return original.call(this, faixaOuTipo, init);
      armado = null;
      const originais = init?.sendEncodings?.length ? init.sendEncodings : [{}];
      const comMiniaturas = { ...(init || {}), sendEncodings: Decisoes.miniaturas(originais) };
      const transceptor = original.call(this, faixaOuTipo, comMiniaturas);
      try { alvo.aoNascer(transceptor, originais); }
      catch (erro) { console.warn('tela-placa-rtp: a transform não entrou no remetente', erro); }
      return transceptor;
    };
  }

  function criar({ registrar, naFilaDeParametros = tarefa => Promise.resolve().then(tarefa), aoFalhar } = {}) {
    const anotar = (evento, detalhe) => { try { registrar?.(evento, detalhe); } catch (_) { /* diagnóstico nunca derruba nada */ } };
    const tetoPara = (l, a, q) => root.RoomQuality?.tetoDeEnvio?.(l, a, q) ?? Infinity;
    let t = null;                 // a transmissão pela placa no ar (ou sendo preparada)
    let falhas = 0;
    let falhaAte = 0;
    let ultimaFalha = null;
    let ultimaFalhaFoiSubida = false;
    // Para diagnóstico, pelo console de quem transmite -- nenhuma parte da sala chama:
    //   telaPelaPlaca.simularFalha('captura')  a captura não chega à placa (vale desde a próxima
    //                                          transmissão, se chamada antes de compartilhar)
    //   telaPelaPlaca.simularFalha('placa')    a placa não devolve os quadros
    //   telaPelaPlaca.simularFalha(null)       desliga
    let falhaSimulada = null;

    const emTexto = d => `${d.altura}p a ${d.quadros} quadros`;

    // As mesmas escolhas da faixa de dados (tela-webcodecs.js, `escolherCodificadores`): a
    // camada cheia só na placa, descendo a escada de degraus dela se o pedido não couber; a de
    // 360p aceita o processador, porque ali o custo é pequeno e a placa de consumo limita
    // quantas codificações faz ao mesmo tempo.
    async function escolherCodificadores(fonte, p) {
      const pedido = { ...Decisoes.caberNaCaixa(fonte, { largura: p.largura, altura: p.altura }), quadros: p.quadros };
      let alta = null, degrauAceito = null;
      for (const degrau of Decisoes.degrausDaPlaca(pedido, p.prioridade)) {
        const bitrate = Math.min(p.bitrateMax, tetoPara(degrau.largura, degrau.altura, degrau.quadros));
        alta = await Codificador.escolherConfiguracao({ codec: 'h264', ...degrau, bitrate, somenteHardware: true });
        if (alta) { degrauAceito = { ...degrau, bitrate }; break; }
      }
      if (!alta) return { recusa: `a placa de vídeo recusou ${emTexto(pedido)} e os degraus abaixo` };
      const caixa = Decisoes.caberNaCaixa(fonte, { largura: p.baixa.largura, altura: p.baixa.altura });
      const quadrosDaBaixa = Math.min(p.baixa.quadros, p.quadros);
      const baixa = await Codificador.escolherConfiguracao({ codec: 'h264', ...caixa, quadros: quadrosDaBaixa, bitrate: p.baixa.bitrate, somenteHardware: false });
      const reduzido = degrauAceito.altura !== pedido.altura || degrauAceito.quadros !== pedido.quadros;
      return {
        configs: { alta: alta.config, baixa: baixa?.config || null },
        infos: {
          alta: { hardware: alta.hardware, perfil: alta.perfil, quadros: degrauAceito.quadros, bitrateMax: degrauAceito.bitrate, bitrateMin: 300_000 },
          baixa: baixa ? { hardware: baixa.hardware, perfil: baixa.perfil, quadros: quadrosDaBaixa, bitrateMax: p.baixa.bitrate, bitrateMin: 100_000 } : null
        },
        notaDaPlaca: reduzido ? `a placa não aceita ${emTexto(pedido)}, então a imagem cheia sobe em ${emTexto(degrauAceito)}` : null
      };
    }

    function enviarFonte(tr, faixa) {
      tr.copia?.stop();
      tr.copia = faixa.clone();
      // Fila de um quadro: quadro esperando aqui também ocupa um dos poucos buffers da captura (ver
      // QUADROS_DE_CAPTURA_GUARDADOS no Worker), e quadro velho não serve -- vale o mais novo.
      const processador = new MediaStreamTrackProcessor({ track: tr.copia, maxBufferSize: 1 });
      // A largura da captura deixa o Worker saber de que camada é cada miniatura desde o primeiro
      // quadro, antes de as estatísticas dizerem.
      tr.trabalhador.postMessage({ tipo: 'fonte', leitor: processador.readable, larguraDaCaptura: tr.fonte.largura }, [processador.readable]);
    }

    // Deixa tudo pronto para a publicação que vem a seguir: o Worker, a captura chegando nele,
    // os codificadores configurados e o embrulho armado para esta faixa. Devolve `{ ok }` ou o
    // motivo de não ter dado, para a tela seguir pelo caminho de hoje.
    async function preparar(faixa, parametros, motivo) {
      encerrar();
      if (!suportado()) return { ok: false, motivo: 'este navegador não troca o conteúdo dos quadros do RTP' };
      const ajustes = faixa.getSettings?.() || {};
      const fonte = { largura: ajustes.width || parametros.largura, altura: ajustes.height || parametros.altura };
      const escolha = await escolherCodificadores(fonte, parametros);
      if (escolha.recusa) return { ok: false, motivo: escolha.recusa };
      let trabalhador;
      try { trabalhador = new Worker(ENDERECO_DO_TRABALHADOR); }
      catch (erro) { return { ok: false, motivo: `o Worker da placa não abriu (${erro?.message || erro})` }; }
      const tr = {
        faixa, parametros, fonte, escolha, trabalhador, motivo,
        remetente: null, originais: null, publicacao: null, copia: null,
        timer: null, lendo: false, pedidosVistos: {}, envio: null, estatisticas: null, saidas: {}, subidas: {},
        ultimasEstatisticas: 0, falha: null, desde: Date.now()
      };
      let aoAquecer = null;
      tr.primeiroQuadro = new Promise(resolve => { tr.aoPrimeiroQuadro = resolve; });
      trabalhador.onmessage = evento => {
        const m = evento.data || {};
        if (m.tipo === 'estatisticas') tr.estatisticas = m.dados;
        else if (m.tipo === 'falha') { falhar(tr, m.motivo); tr.aoPrimeiroQuadro(); }
        else if (m.tipo === 'aquecido') aoAquecer?.(m.ok);
        else if (m.tipo === 'primeiroQuadro') tr.aoPrimeiroQuadro();
      };
      trabalhador.onerror = evento => { evento.preventDefault?.(); falhar(tr, `o Worker da placa parou (${evento.message || 'erro'})`); };
      if (falhaSimulada) trabalhador.postMessage({ tipo: 'simular', falha: falhaSimulada });
      try { enviarFonte(tr, faixa); }
      catch (erro) { trabalhador.terminate(); return { ok: false, motivo: `a captura não chegou ao Worker da placa (${erro?.message || erro})` }; }
      trabalhador.postMessage({ tipo: 'camadas', configs: escolha.configs, infos: escolha.infos });
      // Os codificadores aquecidos antes de publicar (ver `aquecer`, no Worker): a mídia tem de
      // chegar ao servidor logo depois da publicação, e a placa abrindo a sessão atrasaria.
      await new Promise(resolve => {
        aoAquecer = resolve;
        trabalhador.postMessage({ tipo: 'aquecer' });
        setTimeout(resolve, 2000);
      });
      aoAquecer = null;
      if (tr.falha) { trabalhador.terminate(); tr.copia?.stop(); return { ok: false, motivo: tr.falha }; }
      t = tr;
      embrulhar();
      armado = {
        faixa,
        aoNascer(transceptor, originais) {
          if (tr !== t) return;
          tr.remetente = transceptor.sender;
          tr.originais = originais.map(e => ({ rid: e.rid, escala: e.scaleResolutionDownBy ?? 1 }));
          transceptor.sender.transform = new RTCRtpScriptTransform(trabalhador, { papel: 'envio' });
        }
      };
      const alta = escolha.configs.alta;
      anotar('tela.webcodecs', `H.264 pela placa, transportado pelo RTP · ${alta.codec} ${alta.width}×${alta.height}`
        + `${'framerate' in alta ? '' : ' · taxa não declarada (a placa só aceita assim)'}${escolha.configs.baixa ? '' : ' · sem camada de 360p'}`);
      if (escolha.notaDaPlaca) anotar('tela.placa', escolha.notaDaPlaca);
      return { ok: true };
    }

    // Depois de publicar. Se o LiveKit não passou pelo embrulho, nada foi mexido (nem as
    // miniaturas nem a transform): a publicação é RTP comum, e só este módulo sai de cena.
    //
    // E só volta depois do primeiro quadro trocado sair. O servidor de mídia aceita a
    // publicação na hora, mas só a CRIA quando a mídia chega; uma despublicação antes disso --
    // duas trocas de qualidade seguidas, por exemplo -- deixava lá uma publicação pendente que
    // nunca receberia nada, e a seguinte, com o mesmo id de faixa, entrava numa fila atrás dela
    // para sempre (reproduzido: a tela sumia e nem a reconciliação a trazia de volta). A fila de
    // publicações da sala espera por isto, então nenhuma troca passa na frente.
    const MS_ATE_DESISTIR_DO_PRIMEIRO_QUADRO = 3000;
    const MS_PARA_A_MIDIA_CHEGAR = 150;
    async function anexar(publicacao) {
      const tr = t;
      if (!tr) return false;
      if (armado?.faixa === tr.faixa) armado = null;
      if (!tr.remetente) {
        anotar('tela.caminho', 'RTP: o remetente da tela nasceu sem passar pela placa');
        encerrar();
        return false;
      }
      tr.publicacao = publicacao;
      tr.noAr = Date.now();
      tr.timer = setInterval(() => ler(tr), MS_ENTRE_LEITURAS);
      ler(tr);
      await Promise.race([tr.primeiroQuadro, new Promise(resolve => setTimeout(resolve, MS_ATE_DESISTIR_DO_PRIMEIRO_QUADRO))]);
      await new Promise(resolve => setTimeout(resolve, MS_PARA_A_MIDIA_CHEGAR));
      if (tr !== t || tr.falha) return false;
      anotar('tela.caminho', `WebCodecs (h264) pelo RTP: ${tr.motivo}`);
      return true;
    }

    async function ler(tr) {
      if (tr !== t || tr.lendo || tr.falha) return;
      tr.lendo = true;
      try {
        const relatorio = await tr.remetente.getStats();
        const mapa = {}, destinados = {}, pedidos = [], envio = {};
        relatorio.forEach(s => {
          if (s.type !== 'outbound-rtp' || s.kind !== 'video') return;
          // Sem simulcast não há rid: a camada única é a cheia.
          const rid = s.rid || 'f';
          mapa[s.ssrc] = rid;
          if (s.targetBitrate) destinados[rid] = s.targetBitrate;
          // PLI e FIR vêm do servidor de mídia em nome de quem assiste: quem entrou, quem trocou
          // de camada, quem perdeu um quadro-chave. Cada aumento vira quadro-chave na placa.
          const total = (s.pliCount || 0) + (s.firCount || 0);
          if (tr.pedidosVistos[rid] !== undefined && total > tr.pedidosVistos[rid]) pedidos.push(rid);
          tr.pedidosVistos[rid] = total;
          envio[rid] = { ativa: s.active !== false, fps: s.framesPerSecond || 0, codificados: s.framesEncoded || 0, bytes: s.bytesSent || 0, destinado: s.targetBitrate || 0 };
        });
        if (tr !== t) return;
        if (conferirSaida(tr, envio) || conferirSubida(tr, envio)) return;
        tr.envio = envio;
        tr.trabalhador.postMessage({ tipo: 'rids', mapa });
        if (Object.keys(destinados).length) tr.trabalhador.postMessage({ tipo: 'destinados', destinados });
        if (pedidos.length) tr.trabalhador.postMessage({ tipo: 'pedidos', rids: pedidos });
        if (Date.now() - tr.ultimasEstatisticas >= MS_ENTRE_ESTATISTICAS) {
          tr.ultimasEstatisticas = Date.now();
          tr.trabalhador.postMessage({ tipo: 'estatisticas' });
          conferirMiniaturas(tr);
        }
      } catch (_) { /* a leitura seguinte tenta de novo */ }
      finally { tr.lendo = false; }
    }

    // A transform que engole tudo (`saidaDaCamada`, tela-decisoes.js) devolve a tela ao WebRTC.
    // Por camada: a de 360p saindo não salva quem assiste a cheia.
    function conferirSaida(tr, envio) {
      const agora = Date.now();
      for (const [rid, e] of Object.entries(envio)) {
        const conta = Decisoes.saidaDaCamada(tr.saidas[rid] || [], { agora, codificados: e.codificados, bytes: e.bytes });
        tr.saidas[rid] = conta.historico;
        if (!conta.parada) continue;
        const camada = Decisoes.camadaDoRid(rid);
        falhar(tr, `${porQueNadaSai(tr, camada)}: nenhum quadro da camada ${camada} saiu em ${Decisoes.MS_SEM_SAIDA_ATE_DESISTIR / 1000} s`);
        return true;
      }
      return false;
    }

    // A placa que não cabe na subida (`placaNaoCabe`, tela-decisoes.js) também devolve a tela ao
    // WebRTC: ele sabe encolher e desligar a camada cheia quando falta banda; a placa, não.
    function conferirSubida(tr, envio) {
      const agora = Date.now();
      for (const [rid, e] of Object.entries(envio)) {
        const conta = Decisoes.placaNaoCabe(tr.subidas[rid] || [], { agora, desde: tr.noAr, destinado: e.destinado, bytes: e.bytes, ativa: e.ativa });
        tr.subidas[rid] = conta.historico;
        if (!conta.naoCabe) continue;
        falhar(tr, `a placa não cabe na subida de quem transmite: a imagem ${Decisoes.camadaDoRid(rid)} mandou ${Math.round(conta.enviado / 1000)} kbps onde cabiam ${Math.round(conta.destinado / 1000)}`, { subida: true });
        return true;
      }
      return false;
    }

    // O melhor palpite pelas últimas contas do Worker; o Diagnóstico mostra as contas inteiras.
    function porQueNadaSai(tr, camada) {
      const e = tr.estatisticas?.camadas?.[camada];
      if (!e) return `a camada ${camada} não tem codificador na placa`;
      if (e.semCaptura > 0 || tr.estatisticas.capturaFps === 0) return 'a captura não chega à placa';
      if (e.atrasados > 0) return 'a placa de vídeo não devolve os quadros';
      return 'a placa de vídeo não entrega quadros';
    }

    // O LiveKit mexe nos parâmetros do remetente (o dynacast liga e desliga camadas), e a página
    // também (o teto por qualidade de rede). Se alguma dessas escritas trouxer de volta a escala
    // da camada, o codificador do WebRTC voltaria a trabalhar em 1440p no processador.
    function conferirMiniaturas(tr) {
      naFilaDeParametros(async () => {
        if (tr !== t || tr.falha) return;
        const parametros = tr.remetente.getParameters();
        if (!parametros.encodings?.length) return;
        const esperadas = Decisoes.miniaturas(parametros.encodings);
        if (parametros.encodings.every((e, i) => e.scaleResolutionDownBy === esperadas[i].scaleResolutionDownBy)) return;
        parametros.encodings.forEach((e, i) => { e.scaleResolutionDownBy = esperadas[i].scaleResolutionDownBy; });
        await tr.remetente.setParameters(parametros);
        anotar('tela.placa', 'as miniaturas do remetente foram restauradas');
      }).catch(() => {});
    }

    // A placa parou: os quadros do próprio WebRTC passam sem troca, e as camadas voltam ao
    // tamanho de verdade -- a tela segue pelo RTP comum, sem republicar e sem ninguém perder a
    // imagem por mais que um quadro-chave. A próxima publicação tenta a placa de novo, depois da
    // espera de sempre.
    async function falhar(tr, motivo, { subida = false } = {}) {
      if (tr.falha) return;
      tr.falha = motivo;
      ultimaFalha = motivo;
      ultimaFalhaFoiSubida = subida;
      if (Date.now() - tr.desde > MS_NO_AR_QUE_ZERA_AS_FALHAS) falhas = 0;
      falhas += 1;
      const espera = Decisoes.esperaAteTentarDeNovo(falhas);
      falhaAte = Date.now() + espera;
      anotar('tela.falhou', `${motivo}; a tela segue pelo WebRTC e a placa é tentada de novo em ${Math.round(espera / 1000)} s`);
      clearInterval(tr.timer);
      try { tr.trabalhador.postMessage({ tipo: 'passar' }); } catch (_) { /* já encerrado */ }
      if (tr.remetente && tr.originais) {
        await naFilaDeParametros(async () => {
          const parametros = tr.remetente.getParameters();
          parametros.encodings?.forEach((e, i) => {
            const original = tr.originais.find(o => o.rid === e.rid) || tr.originais[i];
            if (original) e.scaleResolutionDownBy = original.escala;
          });
          await tr.remetente.setParameters(parametros);
        }).catch(() => {});
      }
      try { aoFalhar?.(motivo, espera); } catch (_) { /* quem ouve decide */ }
    }

    function encerrar() {
      const tr = t;
      t = null;
      if (tr && armado?.faixa === tr.faixa) armado = null;
      if (!tr) return;
      clearInterval(tr.timer);
      try { tr.trabalhador.postMessage({ tipo: 'encerrar' }); } catch (_) { /* já encerrado */ }
      // O Worker fecha sozinho ao receber o aviso; o `terminate` é a garantia, depois de ele ter
      // tido tempo de fechar os codificadores e os quadros guardados.
      setTimeout(() => { try { tr.trabalhador.terminate(); } catch (_) { /* já encerrado */ } }, 1000);
      try { tr.copia?.stop(); } catch (_) { /* já parada */ }
    }

    // Na forma do `estadoDoEnvio` da faixa de dados (tela-webcodecs.js), com `transporte: 'rtp'`:
    // o painel de medição e o Diagnóstico mostram a tela pela placa sem saber de onde ela veio.
    function estadoDoEnvio() {
      const tr = t;
      if (!tr || tr.falha || !tr.remetente || !tr.publicacao) return null;
      const porCamada = tr.estatisticas?.camadas || {};
      const camadas = [];
      for (const nome of ['alta', 'baixa']) {
        const e = porCamada[nome];
        if (!e) continue;
        // Camada que o servidor pausou (ninguém assiste nela) não está subindo.
        const rid = Object.keys(tr.envio || {}).find(r => Decisoes.camadaDoRid(r) === nome);
        if (rid && tr.envio[rid].ativa === false) continue;
        if (!(e.fps > 0)) continue;
        camadas.push({
          camada: nome, ...e, espectadores: null, escala: 1, perda: 0, atrasos: [], fila: 0,
          descartes: { ritmo: 0, codificador: 0, fila: 0, rede: 0 }, saidaApertada: false, codificadorApertado: false,
          reconfiguracoes: { soDeBitrate: e.reconfiguracoes, comChaveEspontanea: 0 }
        });
      }
      return {
        modo: 'webcodecs', transporte: 'rtp', codec: 'h264', motivo: tr.motivo, falha: null, notaDaPlaca: tr.escolha.notaDaPlaca,
        captura: 'placa', capturaFps: tr.estatisticas?.capturaFps ?? null, capturaPresa: null, faixaId: tr.faixa.id,
        quadrosPedidos: tr.parametros.quadros, fonte: { ...tr.fonte }, espectadores: null,
        buffer: null, ritmador: { bytes: 0, pedacos: 0, atrasoMs: 0 }, saidaDisponivel: null, envioRecusado: 0,
        camadas
      };
    }

    return {
      preparar, anexar, encerrar, estadoDoEnvio,
      // No ar e trocando o conteúdo dos quadros: é quando a escala pelo custo, que mexe nos
      // mesmos parâmetros do remetente, precisa ficar de fora.
      ativo: () => Boolean(t && t.remetente && !t.falha),
      falhaAte: () => falhaAte,
      ultimaFalha: () => ultimaFalha,
      // Na hora da nova tentativa: depois de a placa não caber na subida, só com banda medida para
      // ela (`subidaComportaAPlaca`). A transmissão que falhou segue no ar pelo WebRTC, e é o
      // remetente dela que diz quanto a rede comporta agora.
      async subidaComporta() {
        if (!ultimaFalhaFoiSubida || !t?.remetente) return true;
        let bps = null;
        try {
          (await t.remetente.getStats()).forEach(s => {
            if (s.type === 'candidate-pair' && s.nominated && s.availableOutgoingBitrate) bps = s.availableOutgoingBitrate;
          });
        } catch (_) { /* sem leitura: tenta */ }
        return Decisoes.subidaComportaAPlaca(bps, t.escolha.infos.alta?.bitrateMax);
      },
      simularFalha(tipo) {
        falhaSimulada = tipo || null;
        try { t?.trabalhador.postMessage({ tipo: 'simular', falha: falhaSimulada }); } catch (_) { /* sem Worker no ar */ }
      }
    };
  }

  const api = { criar, suportado, ENDERECO_DO_TRABALHADOR };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NexoTelaPlacaRtp = api;
})(typeof window === 'undefined' ? globalThis : window);
