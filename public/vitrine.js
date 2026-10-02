// O cartão de perfil personalizável -- a "vitrine" de cada conta --, o status, a bolha de
// pensamento e as conquistas. Um arquivo só para o servidor e para a página, como perfil.js: o
// catálogo é uma decisão, e duas cópias dele acabariam discordando.
//
// ---------- Forma fechada ----------
//
// Tudo o que a pessoa escolhe passa por `limparVitrine` e `limparSocial`, no servidor e na
// página. O que não está no catálogo é descartado, venha de onde vier: a vitrine vai para o
// cartão de qualquer pessoa que a abrir, e uma chave solta ali seria um lugar para guardar o que
// ninguém decidiu guardar.
//
// ---------- Comum, conquista e premium ----------
//
// Cada peça tem um `requer`: nada (todo mundo tem), o id de uma CONQUISTA (ganha-se usando o
// Nexo) ou 'premium' (segue NEXO_PLANOS: com os planos desligados, todo mundo tem). A escolha
// fica GUARDADA mesmo sem o requisito, como as cores exatas do tema: quem deixou o premium vencer
// volta a ver o banner animado ao renovar. O que os outros veem é a vitrine EFETIVA
// (`vitrineEfetiva`), já sem o que não vale agora.
//
// ---------- O que NÃO mora aqui ----------
//
// As imagens (banner e fundo) são da conta e sobem por rotas próprias (contas/rotas.js); a
// vitrine guarda só os ids, e quem os escreve é o servidor. A presença -- quem está conectado e
// em que sala -- é do momento e mora na memória do servidor (social.js).
(function (root) {
  const DIA = 24 * 60 * 60 * 1000;
  const HORA = 60 * 60 * 1000;

  // ---------- O tema do cartão ----------
  // Duas cores: a primeira manda no banner e no destaque, a segunda no fundo. São cores de
  // decoração, como as do avatar -- iguais nos dois temas do Nexo, porque o cartão é sempre
  // escuro (cartao.css): ele é a "arte" da pessoa, como o vídeo é o de quem transmite.
  const TEMAS = Object.freeze([
    { id: 'nexo', nome: 'Nexo', cores: ['#8879f6', '#2b2456'] },
    { id: 'aurora', nome: 'Aurora', cores: ['#3fd0b0', '#4a3fb5'] },
    { id: 'oceano', nome: 'Oceano', cores: ['#4f9dff', '#123866'] },
    { id: 'crepusculo', nome: 'Crepúsculo', cores: ['#ff9a5a', '#6e2a86'] },
    { id: 'floresta', nome: 'Floresta', cores: ['#4cc38a', '#163b2c'] },
    { id: 'cereja', nome: 'Cereja', cores: ['#ff6f9f', '#5a1532'] },
    { id: 'carvao', nome: 'Carvão', cores: ['#9a9ab0', '#17171f'] },
    { id: 'algodao', nome: 'Algodão-doce', cores: ['#ffa8d4', '#5d7fd6'] },
    { id: 'lava', nome: 'Lava', cores: ['#ff6a3d', '#3b0f0b'] },
    { id: 'ouro', nome: 'Ouro', cores: ['#f2c45a', '#45320e'] }
  ]);
  const TEMA_PADRAO = 'nexo';

  // ---------- O catálogo ----------
  // `requer`: null (comum), o id de uma conquista, ou 'premium'.
  const ANIMADOS = Object.freeze([
    { id: 'aurora', nome: 'Aurora', requer: null },
    { id: 'estrelas', nome: 'Céu estrelado', requer: null },
    { id: 'bolhas', nome: 'Bolhas', requer: null },
    { id: 'ondas', nome: 'Ondas', requer: 'papo' },
    { id: 'prisma', nome: 'Prisma', requer: 'primeira-sala' },
    { id: 'chuva', nome: 'Chuva neon', requer: 'maratona' },
    { id: 'nebulosa', nome: 'Nebulosa', requer: 'premium' },
    { id: 'grade', nome: 'Grade retrô', requer: 'premium' }
  ]);
  // O banner é a faixa de cima do cartão; o fundo, o corpo dele. Os dois aceitam os animados.
  const BANNERS = Object.freeze([
    { id: 'tema', nome: 'Cores do tema', requer: null },
    ...ANIMADOS,
    { id: 'imagem', nome: 'Sua imagem', requer: 'premium' }
  ]);
  const FUNDOS = Object.freeze([
    { id: 'tema', nome: 'Cores do tema', requer: null },
    { id: 'liso', nome: 'Liso', requer: null },
    ...ANIMADOS,
    { id: 'imagem', nome: 'Sua imagem', requer: 'premium' }
  ]);
  // A borda do avatar: a moldura que acompanha a pessoa no cartão e nas listas de amigos.
  const BORDAS = Object.freeze([
    { id: 'nenhuma', nome: 'Nenhuma', requer: null },
    { id: 'tema', nome: 'Cores do tema', requer: null },
    { id: 'brilho', nome: 'Brilho que gira', requer: null },
    { id: 'pulso', nome: 'Pulso', requer: null },
    { id: 'orbita', nome: 'Órbita', requer: 'turma' },
    { id: 'arco-iris', nome: 'Arco-íris', requer: 'maratona' },
    { id: 'fogo', nome: 'Fogo', requer: 'anfitriao' },
    { id: 'neon', nome: 'Neon', requer: 'premium' },
    { id: 'estelar', nome: 'Estelar', requer: 'premium' }
  ]);
  // A moldura do cartão inteiro.
  const MOLDURAS = Object.freeze([
    { id: 'nenhuma', nome: 'Nenhuma', requer: null },
    { id: 'tema', nome: 'Cores do tema', requer: null },
    { id: 'dourada', nome: 'Dourada', requer: 'pioneiro' },
    { id: 'neon', nome: 'Neon', requer: 'diretor' },
    { id: 'holografica', nome: 'Holográfica', requer: 'premium' }
  ]);
  // O efeito que toca por cima do cartão quando alguém o abre: uma animação curta, com
  // transparência, que não cobre nada que se precise ler (cartao.js).
  const EFEITOS = Object.freeze([
    { id: 'nenhum', nome: 'Nenhum', requer: null },
    { id: 'confete', nome: 'Confete', requer: null },
    { id: 'faiscas', nome: 'Faíscas', requer: null },
    { id: 'neve', nome: 'Neve', requer: null },
    { id: 'bolhas', nome: 'Bolhas', requer: null },
    { id: 'coracoes', nome: 'Corações', requer: 'papo' },
    { id: 'petalas', nome: 'Pétalas', requer: 'turma' },
    { id: 'estrelas', nome: 'Estrelas cadentes', requer: 'primeira-sala' },
    { id: 'fogos', nome: 'Fogos', requer: 'premium' },
    { id: 'aurora', nome: 'Luz de aurora', requer: 'premium' }
  ]);
  const NOMES = Object.freeze([
    { id: 'padrao', nome: 'Padrão', requer: null },
    { id: 'tema', nome: 'Cores do tema', requer: null },
    { id: 'brilho', nome: 'Reflexo', requer: 'maratona' },
    { id: 'neon', nome: 'Neon', requer: 'premium' }
  ]);
  const CATALOGO = Object.freeze({ banner: BANNERS, fundo: FUNDOS, borda: BORDAS, moldura: MOLDURAS, efeito: EFEITOS, nome: NOMES });
  const PADROES = Object.freeze({ tema: TEMA_PADRAO, banner: 'tema', fundo: 'tema', borda: 'nenhuma', moldura: 'nenhuma', efeito: 'nenhum', nome: 'padrao' });

  // ---------- As conquistas ----------
  // Saem de contadores da conta (contas/banco.js, tabela `contador`) -- somas, e nada mais: não
  // guardam em que sala, com quem nem quando. `contador` + `alvo` é o caso comum; `regra` é o que
  // depende da conta (idade, plano).
  const ANO_DO_PIONEIRO = Date.UTC(2027, 0, 1);
  const CONQUISTAS = Object.freeze([
    { id: 'boas-vindas', nome: 'Chegou chegando', descricao: 'Criou a conta no Nexo.', regra: () => true },
    { id: 'primeira-sala', nome: 'Primeira sala', descricao: 'Abriu a primeira sala.', contador: 'salas', alvo: 1 },
    { id: 'anfitriao', nome: 'Anfitrião', descricao: 'Abriu 25 salas.', contador: 'salas', alvo: 25 },
    { id: 'palco', nome: 'No palco', descricao: 'Compartilhou a tela pela primeira vez.', contador: 'telas', alvo: 1 },
    { id: 'diretor', nome: 'Diretor de cena', descricao: 'Compartilhou a tela 50 vezes.', contador: 'telas', alvo: 50 },
    { id: 'papo', nome: 'Bom de papo', descricao: 'Mandou 100 mensagens no chat das salas.', contador: 'mensagens', alvo: 100 },
    { id: 'cronista', nome: 'Cronista', descricao: 'Mandou 1.000 mensagens no chat das salas.', contador: 'mensagens', alvo: 1000 },
    { id: 'maratona', nome: 'Maratona', descricao: 'Passou 10 horas em salas.', contador: 'minutos', alvo: 600 },
    { id: 'morador', nome: 'Morador do Nexo', descricao: 'Passou 100 horas em salas.', contador: 'minutos', alvo: 6000 },
    { id: 'turma', nome: 'Turma formada', descricao: 'Tem 3 amigos no Nexo.', contador: 'amigos', alvo: 3 },
    { id: 'popular', nome: 'Popular', descricao: 'Tem 15 amigos no Nexo.', contador: 'amigos', alvo: 15 },
    { id: 'pioneiro', nome: 'Pioneiro', descricao: 'Chegou ao Nexo em 2026, no começo de tudo.', regra: ({ criadaEm }) => criadaEm < ANO_DO_PIONEIRO },
    { id: 'veterano', nome: 'Veterano', descricao: 'Está no Nexo há um ano.', regra: ({ criadaEm, agora }) => agora - criadaEm >= 365 * DIA },
    { id: 'apoiador', nome: 'Apoiador', descricao: 'Apoia o Nexo com o premium.', regra: ({ premium }) => premium }
  ]);
  const CONTADORES = Object.freeze(['salas', 'telas', 'mensagens', 'minutos']);
  const IDS_DAS_CONQUISTAS = new Set(CONQUISTAS.map(c => c.id));

  // Cada conquista com o progresso: `ganhou`, e quanto falta quando ela é de contador.
  // `amigos` vem da tabela de amizades, e não de um contador: desfazer uma amizade tira o número
  // de volta, e a conquista ganha não se perde por isso (`jaGanhas`).
  function conquistasDe({ contadores = {}, amigos = 0, criadaEm = Date.now(), premium = false, agora = Date.now(), jaGanhas = [] } = {}) {
    const valores = { ...contadores, amigos };
    const guardadas = new Set(jaGanhas);
    return CONQUISTAS.map(c => {
      if (c.regra) return { id: c.id, ganhou: Boolean(c.regra({ criadaEm, premium, agora })) };
      const valor = Math.max(0, Number(valores[c.contador]) || 0);
      return { id: c.id, ganhou: valor >= c.alvo || guardadas.has(c.id), valor: Math.min(valor, c.alvo), alvo: c.alvo };
    });
  }
  const ganhas = lista => new Set(lista.filter(c => c.ganhou).map(c => c.id));

  // ---------- Limpar o que chega ----------
  const um = (lista, valor, padrao) => (lista.some(p => p.id === valor) ? valor : padrao);
  const corHex = valor => (typeof valor === 'string' && /^#[0-9a-f]{6}$/i.test(valor) ? valor.toLowerCase() : null);
  const idDeImagem = valor => (typeof valor === 'string' && /^[a-f0-9]{32}$/.test(valor) ? valor : null);

  // Controles e marcas de direção saem (contas/regras.js faz o mesmo com o apelido): com eles um
  // texto pode inverter o que está em volta na tela de quem lê, ou parecer vazio sem ser.
  // A classe é montada pelos códigos, e não com os caracteres escritos: invisíveis no arquivo,
  // eles não se leem nem se conferem numa revisão.
  const faixa = (de, ate) => `${String.fromCharCode(de)}-${String.fromCharCode(ate)}`;
  const INVISIVEIS = new RegExp(`[\\p{Cc}${faixa(0x200b, 0x200f)}${faixa(0x202a, 0x202e)}${faixa(0x2066, 0x2069)}${String.fromCharCode(0xfeff)}]`, 'gu');
  function texto(valor, maximo, { linhas = 1 } = {}) {
    if (typeof valor !== 'string') return '';
    let limpo = valor.normalize('NFC').replace(/\r\n?/g, '\n');
    if (linhas > 1) {
      limpo = limpo.split('\n').map(l => l.replace(INVISIVEIS, '').replace(/[ \t]+/g, ' ').trim());
      // Linhas vazias seguidas viram uma só, e a bio tem no máximo `linhas` linhas.
      limpo = limpo.filter((l, i, todas) => l || (i > 0 && todas[i - 1])).slice(0, linhas).join('\n').trim();
    } else {
      limpo = limpo.replace(/\n/g, ' ').replace(INVISIVEIS, '').replace(/\s+/g, ' ').trim();
    }
    return [...limpo].slice(0, maximo).join('').trim();
  }
  // Um emoji só: o primeiro grafema. Um emoji de família ou de bandeira são vários pontos de
  // código, e cortar no meio deixaria meio desenho.
  function umEmoji(valor) {
    if (typeof valor !== 'string' || !valor.trim()) return '';
    // Só os controles saem: o "juntador" de largura zero (U+200D) é o que cola as partes de um
    // emoji composto, e tirá-lo desmontaria o desenho.
    const limpo = valor.replace(/\p{Cc}/gu, '').trim();
    let primeiro = '';
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      for (const { segment } of new Intl.Segmenter('pt', { granularity: 'grapheme' }).segment(limpo)) { primeiro = segment; break; }
    } else primeiro = [...limpo][0] || '';
    // Letra e número não são emoji: um "A" ali seria um apelido escondido.
    if (!primeiro || /^[\p{L}\p{N}\s]/u.test(primeiro) || primeiro.length > 16) return '';
    return primeiro;
  }

  const BIO_MAXIMA = 190;
  const PRONOMES_MAXIMO = 40;
  const PENSAMENTO_MAXIMO = 70;
  const FRASE_MAXIMA = 80;
  const SELOS_MAXIMOS = 5;
  // A bolha de pensamento é do dia: depois de 24 horas ela some sozinha, como uma nota.
  const VIDA_DO_PENSAMENTO = DIA;
  const BYTES_MAXIMOS_DA_VITRINE = 4096;

  // O que a pessoa pode mandar. `agora` carimba o pensamento novo; um pensamento que não mudou
  // mantém o carimbo antigo, para não renascer a cada salvamento.
  function limparVitrine(bruto, { agora = Date.now(), anterior = null } = {}) {
    const v = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
    const limpa = {
      tema: um(TEMAS, v.tema, TEMA_PADRAO),
      cores: null,
      banner: um(BANNERS, v.banner, PADROES.banner),
      fundo: um(FUNDOS, v.fundo, PADROES.fundo),
      borda: um(BORDAS, v.borda, PADROES.borda),
      moldura: um(MOLDURAS, v.moldura, PADROES.moldura),
      efeito: um(EFEITOS, v.efeito, PADROES.efeito),
      nome: um(NOMES, v.nome, PADROES.nome),
      bio: texto(v.bio, BIO_MAXIMA, { linhas: 4 }),
      pronomes: texto(v.pronomes, PRONOMES_MAXIMO),
      pensamento: null,
      selos: Array.isArray(v.selos) ? [...new Set(v.selos.filter(id => IDS_DAS_CONQUISTAS.has(id)))].slice(0, SELOS_MAXIMOS) : []
    };
    const a = corHex(v.cores?.a), b = corHex(v.cores?.b);
    if (a && b) limpa.cores = { a, b };
    const pensamento = texto(typeof v.pensamento === 'string' ? v.pensamento : v.pensamento?.texto, PENSAMENTO_MAXIMO);
    if (pensamento) {
      const igual = anterior?.pensamento?.texto === pensamento && Number.isFinite(anterior.pensamento.em);
      limpa.pensamento = { texto: pensamento, em: igual ? anterior.pensamento.em : agora };
    }
    return limpa;
  }

  // As imagens são do servidor: a página nunca escreve o id delas.
  function limparImagens(bruto) {
    return { banner: idDeImagem(bruto?.banner), fundo: idDeImagem(bruto?.fundo) };
  }

  const requisitoDe = (grupo, id) => CATALOGO[grupo]?.find(p => p.id === id)?.requer ?? null;
  // Pode usar esta peça agora? `premium` já vem considerando NEXO_PLANOS (quem chama decide).
  function liberada(requer, { premium = false, conquistas = new Set() } = {}) {
    if (!requer) return true;
    if (requer === 'premium') return Boolean(premium);
    return conquistas.has(requer);
  }

  // O que os outros veem: o que não vale agora volta ao padrão (a escolha continua guardada), o
  // pensamento vencido some, os selos são só os ganhos, e a imagem só vai junto quando é ela que
  // está escolhida -- o id de uma imagem guardada e não usada não sai para ninguém.
  function vitrineEfetiva(guardada, { premium = false, conquistas = new Set(), imagens = {}, agora = Date.now() } = {}) {
    const v = limparVitrine(guardada || {}, { agora, anterior: guardada });
    const pode = { premium, conquistas };
    for (const grupo of Object.keys(CATALOGO)) if (!liberada(requisitoDe(grupo, v[grupo]), pode)) v[grupo] = PADROES[grupo];
    if (v.cores && !premium) v.cores = null;
    if (v.pensamento && !(agora - v.pensamento.em < VIDA_DO_PENSAMENTO)) v.pensamento = null;
    v.selos = v.selos.filter(id => conquistas.has(id));
    const ids = limparImagens(imagens);
    if (v.banner === 'imagem' && !ids.banner) v.banner = PADROES.banner;
    if (v.fundo === 'imagem' && !ids.fundo) v.fundo = PADROES.fundo;
    v.imagens = { banner: v.banner === 'imagem' ? ids.banner : null, fundo: v.fundo === 'imagem' ? ids.fundo : null };
    return v;
  }

  // As cores do cartão: as exatas (premium), senão as do tema escolhido.
  function coresDe(vitrine) {
    if (vitrine?.cores?.a && vitrine?.cores?.b) return [vitrine.cores.a, vitrine.cores.b];
    return (TEMAS.find(t => t.id === vitrine?.tema) || TEMAS[0]).cores;
  }

  // ---------- O status ----------
  // `invisivel` aparece como desconectado para os amigos. A frase (emoji + texto) tem prazo
  // opcional; vencida, some sozinha.
  const STATUS = Object.freeze([
    { id: 'online', nome: 'Disponível' },
    { id: 'ausente', nome: 'Ausente' },
    { id: 'ocupado', nome: 'Não incomodar' },
    { id: 'invisivel', nome: 'Invisível' }
  ]);
  // Os prazos que a página oferece para a frase. O servidor aceita qualquer instante futuro até
  // trinta dias; os rótulos são só da tela.
  const PRAZOS_DA_FRASE = Object.freeze([
    { id: '30m', nome: '30 minutos', ms: 30 * 60 * 1000 },
    { id: '1h', nome: '1 hora', ms: HORA },
    { id: '4h', nome: '4 horas', ms: 4 * HORA },
    { id: 'hoje', nome: 'Hoje', ms: null },
    { id: 'nunca', nome: 'Sem prazo', ms: 0 }
  ]);

  // `conferirPrazo` é para o que CHEGA da página: o prazo tem de estar no futuro, e no máximo a
  // trinta dias. O que já está guardado é lido como está, e quem decide se venceu é socialEfetivo.
  function limparSocial(bruto, { agora = Date.now(), conferirPrazo = true } = {}) {
    const s = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
    const limpo = {
      status: um(STATUS, s.status, 'online'),
      frase: null,
      mostrarSala: s.mostrarSala !== false,
      pedidos: s.pedidos !== false
    };
    const frase = texto(s.frase?.texto, FRASE_MAXIMA);
    const emoji = umEmoji(s.frase?.emoji);
    if (frase || emoji) {
      const ate = Number(s.frase?.ate);
      const valido = Number.isFinite(ate) && ate > 0 && (!conferirPrazo || (ate > agora && ate <= agora + 30 * DIA));
      limpo.frase = { texto: frase, emoji, ate: valido ? Math.round(ate) : null };
    }
    return limpo;
  }
  // O que os outros veem do status: a frase vencida some. Invisível continua invisível aqui; quem
  // o transforma em "desconectado" é a presença (social.js), que sabe para quem está mostrando.
  function socialEfetivo(guardado, { agora = Date.now() } = {}) {
    const s = limparSocial(guardado || {}, { conferirPrazo: false });
    if (s.frase?.ate && s.frase.ate <= agora) s.frase = null;
    return s;
  }

  const api = {
    TEMAS, TEMA_PADRAO, ANIMADOS, BANNERS, FUNDOS, BORDAS, MOLDURAS, EFEITOS, NOMES, CATALOGO, PADROES,
    CONQUISTAS, CONTADORES, STATUS, PRAZOS_DA_FRASE,
    BIO_MAXIMA, PRONOMES_MAXIMO, PENSAMENTO_MAXIMO, FRASE_MAXIMA, SELOS_MAXIMOS, VIDA_DO_PENSAMENTO, BYTES_MAXIMOS_DA_VITRINE,
    conquistasDe, ganhas, limparVitrine, limparImagens, vitrineEfetiva, requisitoDe, liberada, coresDe,
    limparSocial, socialEfetivo, umEmoji
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NexoVitrine = api;
})(typeof window === 'undefined' ? globalThis : window);
