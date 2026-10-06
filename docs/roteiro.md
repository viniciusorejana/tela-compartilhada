# Roteiro do Nexo

Atualizado em 23/09/2026, com a fase 1 feita. Junta num lugar só a ordem e o estado dos planos:
[`lancamento.md`](lancamento.md) (custo e degraus), [`plano-contas.md`](plano-contas.md),
[`seguranca-e-privacidade.md`](seguranca-e-privacidade.md) e
[`plano-webcodecs.md`](plano-webcodecs.md). Os planos guardam o **porquê**; aqui fica o
**quê**, em que ordem, e o que já está feito.

Este arquivo muda quando uma etapa fecha. Os planos mudam quando uma decisão muda.

**Ordem:** feito (com a fase 1) → **2. antes de abrir** → *lançamento* → **3. pagamento** →
**4. guiado pelo uso**

O pagamento fica **depois** do lançamento de propósito: o uso real diz se R$ 10 converte antes
de se gastar dias numa integração, e o atalho da fase 3 permite receber de apoiadores antes
dela.

---

## Já feito

| o quê | onde |
|---|---|
| **Fase 1, etapa A:** banco, cadastro, login e sessão sem atraso; usuário único, senha de 10+, freio por conta; origem do Socket.IO fixada; laço de eventos no painel | `5b03c4a` |
| **Fase 1, etapa B:** perfil que segue a pessoa (leitor único das preferências); baixar meus dados; apagar a conta | `899e056` |
| **Fase 1, etapa C:** só conta abre sala; carência de 60 s; dono sobrevive ao F5; banimento sem homônimos; sons e mensagens com conta | `f7c1f23` |
| **Fase 1, etapa D:** os três níveis conferidos no servidor; teto de pessoas (25, e 50 com assinante); nível completo à mão pelo painel | `12410d7` |
| A imagem encolhe em vez de perder quadros | `761944f` |
| O seletor diz, antes da escolha, o que a máquina entrega (metade do degrau 4) | `ed9ef79` |
| Relatos de problema chegam ao painel (degrau 2) | `b18cde9` |
| Sugestões com caminho próprio, em lista separada | `e18dc5f` |
| Sala com dono: expulsar, banir, desbanir, transferir (primeiro item do degrau 6) | `bd73c01`, `e18dc5f` |
| Apagar sons da mesa virou moderação: só quem abriu a sala, até as contas existirem | `5e81f75` |
| O aplicativo de desktop fica preso ao servidor escolhido — janela, funções nativas e permissões; o seletor de tela roda isolado | `ae0c9db` |
| Aplicativo para Linux e macOS; a página oferece só o que existe | `3668834`, `92740d6` |
| `npm start` roda no Linux (era pendência do degrau 1) | `540fc6c` |
| Melhorias de sala: chat, layout, controles, latência desde a entrada | `779dc3e` a `633265c` |
| Planos: custo e lançamento, contas, segurança e privacidade, WebCodecs | `docs/` |

### Os instaladores

A correção do aplicativo (`ae0c9db`) só chega a quem usa quando o instalador é gerado de novo.

- **Windows:** gerar de novo com `npm --prefix app run empacotar` e substituir em `app/dist`. O
  `.exe` que o servidor oferece hoje ainda é o antigo.
- **Linux:** depois da correção do ícone, rodar `npm --prefix app run empacotar:linux` no Linux e
  conferir que o `.AppImage` abre. O build novo já sai com a correção.
- **macOS:** nunca rodou, e só sai de um Mac. Sem a assinatura paga da Apple, o macOS bloqueia a
  primeira abertura até a pessoa liberar nas configurações de segurança.

---

## Fase 1 — Contas · *feita*

Plano completo em [`plano-contas.md`](plano-contas.md); o que a implementação decidiu está no
fim dele.

| etapa | entrega | commit |
|---|---|---|
| A | banco, cadastro, login e sessão — com o "sem atraso" garantido por teste; **nome de usuário único para entrar**, senha de 10+ caracteres, freio por conta, e a origem do Socket.IO fixada antes de o cookie existir | `5b03c4a` |
| B | perfil que segue a pessoa; apagar a conta; **baixar meus dados** | `899e056` |
| C | só conta abre sala; carência de 60 s; dono sobrevive ao F5; banimento sem atingir homônimos; enviar e apagar sons exigem conta; a própria mensagem continua editável depois do F5 | `f7c1f23` |
| D | os níveis 720p30 / 720p60 / 1080p–1440p, com o teto conferido no servidor; teto de pessoas maior com assinante na sala; nível completo à mão pelo painel | `12410d7` |

Cada etapa subiu sozinha, com testes próprios (`npm test`, `npm run test:contas`,
`npm run test:planos`, e os de antes). Três coisas para saber antes de pôr no ar:

- **Duas janelas de transição**, porque o grupo atual abre salas e transmite em 1440p sem conta:
  `NEXO_ANONIMO_ABRE_SALA=1` e `NEXO_PLANOS=0`. Sem elas, "só conta abre sala" e os tetos valem
  no primeiro minuto. Ver "Avisar o grupo atual", na fase 2.
- **O teto base de pessoas veio junto**, na etapa D — o aumento pelo assinante dependia dele. Saiu
  da fase 2.
- **Os limites conhecidos**: o servidor confere a resolução, não os quadros (a webhook não traz a
  taxa); e confere a resolução declarada pelo cliente, não a que chega. Um cliente modificado
  passa pelos dois. Está escrito em `plano-contas.md`, com o caminho se um dia importar.

---

## Fase 2 — Antes de abrir para desconhecidos · alguns dias

**Pode andar junto com a fase 1**: quase tudo aqui é operação, não código.

- **Sair de casa** (degrau 1): VPS de ~€14/mês. O código já está pronto; falta
  - **medir a latência antes de contratar**: a Europa é simples pela LGPD, mas fica a ~200 ms
    de ida e volta do Brasil, e o `lancamento.md` não considerou isso;
  - um proxy com TLS (Caddy) — a criptografia passa a terminar no seu servidor, e não mais na
    Cloudflare;
  - endurecer o servidor: SSH só com chave, firewall, atualizações automáticas, Node sem
    privilégio e o painel só pelo túnel SSH;
  - backups cifrados fora da máquina, com uma restauração testada;
  - copiar os instaladores do aplicativo para `app/dist` do servidor (o agente de áudio já vai
    dentro deles);
  - o teste que fecha o degrau: alguém em 4G, alguém em Wi-Fi corporativo com UDP bloqueado, e
    um iPhone, os três recebendo tela.
- **Cabeçalhos de segurança nas páginas públicas**, com a CSP primeiro em modo relatório.
- ~~**Teto de pessoas por sala**~~ — **feito na etapa D** (25, e 50 com um assinante na sala;
  `NEXO_PESSOAS_POR_SALA` ajusta). O que falta aqui é olhar o painel: quantas salas encostam no
  teto e quantas entradas ele recusou dizem se os números estão certos.
- **Cópia do banco de contas fora da máquina** (a local diária já existe): Litestream, ou a cópia
  do dia cifrada e enviada para fora, com uma restauração testada. É o primeiro dado
  insubstituível do projeto — ver "Contas" no README.
- **O estado do Nexo na página inicial** (a metade do degrau 4 que falta): 720p60 e 1080p30
  cabem em software; 1080p60 e 1440p cedem resolução para não travar.
- **Política de privacidade, termos de uso e um canal de contato** — precisam existir no dia em
  que houver senha guardada (LGPD). O registro de tudo o que se guarda já está pronto em
  `seguranca-e-privacidade.md`, e é o esqueleto da política.
- **Procedimento de incidente escrito**: o prazo para comunicar a ANPD é de 6 dias úteis para
  pequeno porte, e isso não dá tempo de inventar o procedimento na hora.
- **Relatos com prazo de 180 dias**, e ACL na pasta das chaves do servidor de mídia.
- **Parecer jurídico sobre o ECA Digital**, em vigor desde março de 2026. É fora do código, e é
  o maior risco jurídico do lançamento.
- **Relatar uma pessoa ao mantenedor** (degrau 6): cabe na rota dos relatos, agora com o
  código da conta — que o cartão de perfil da sala já mostra. Com o ECA Digital, deixa de ser
  conveniência e passa a ser obrigação.
- **Avisar o grupo atual** e dar uma janela antes de "só conta abre sala" valer. Sugestão:
  nível completo de cortesia para esse grupo por alguns meses, pelo painel ("Contas e planos", já
  pronto). Hoje eles transmitem em 1440p de graça; assim viram os primeiros apoiadores, em vez de
  sentirem que perderam algo. A janela existe no código: `NEXO_ANONIMO_ABRE_SALA=1` e
  `NEXO_PLANOS=0` até todos terem conta — e no dia de criarem as contas, lembrar do teto diário
  de cadastros por origem atrás do túnel (`docs/telemetria.md`).

---

## Lançamento

Com as fases 1 e 2 prontas, o Nexo pode receber desconhecidos: contas existem, só conta abre
sala, os níveis valem no servidor, e o servidor não depende mais da sua máquina ligada. O
nível completo aparece no seletor com cadeado desde aqui; antes de a fase 3 existir, quem quiser pode
recebê-lo pelo atalho do painel.

---

## Fase 3 — Pagamento · ~3–5 dias

Estimativa deste roteiro; nenhum plano mediu esta fase ainda.

- **R$ 10/mês**, com PIX (Mercado Pago, Asaas ou Pagar.me). A webhook do provedor muda
  `conta.plano` — é a superfície inteira, e ela já existe desde a etapa A.
- O e-mail passa a ser obrigatório aqui, e com ele entra o remetente transacional.
- **Nenhum dado de cartão passa pelo servidor**: o pagamento acontece na página do provedor, e a
  assinatura de cada aviso da webhook é conferida.
- **Fora do código:** receber como pessoa física ou como MEI é conversa com contador, e precisa
  estar resolvido antes do primeiro pagamento.
- **Atalho, pronto desde a etapa D:** o painel marca uma conta de nível completo à mão, para quem
  pagar por PIX direto. Valida se R$ 10 converte antes de gastar dias na integração.
- **Vitalício só como captação limitada** ("primeiros apoiadores"): o custo é mensal e a
  receita seria única — ver `lancamento.md`, degrau 5.

---

## Fase 4 — Guiada pelo uso real

A ordem aqui é decidida pelo que a comunidade reclamar mais, e não antes.

- **WebCodecs** (degrau 7): **implementado na branch `nexo-webcodecs`** (27/09/2026), as dez
  etapas, com `npm run test:webcodecs`. A 0.2 foi respondida (a 1.13.6 aceita faixa de dados) e a
  0.1 e a 0.3 foram medidas em loopback, e a placa de vídeo desta máquina entrega as seis
  combinações de 720p a 1440p60 (`npm run test:webcodecs:placa`); o que falta é de campo: a
  **0.4** (quanto o jogo ganha, com 0, 1 e 3 espectadores — o portão de valor), a faixa de dados
  pelo túnel, uma placa AMD ou Intel, e o iPhone. **O servidor de mídia padrão passou a ser a
  1.13.7** (Windows e Linux, hashes conferidos) — a 1.13.6 trava a sinalização de quem assina uma
  faixa de dados no instante em que ela sai, e nela o automático não liga. Depois do primeiro
  teste em rede de verdade, a tela ganhou um ritmador contra o portão de 100 ms que o servidor
  aplica a cada espectador. Nos testes seguintes (28/09/2026): fluida no alt+tab, a falha que
  tenta de novo sozinha, a captura do Windows presa em ~30 percebida e oferecida para capturar
  de novo, e a opção e o Diagnóstico reescritos. **Publicado na edição 2 das novidades.** O que
  foi decidido e medido está no fim de `plano-webcodecs.md`.
- **Janela sem derrubar o jogo** (depende de decisão): com WebCodecs, recortar a janela da captura
  da tela inteira ficou barato; falta o agente nativo devolver o retângulo da janela, e aceitar
  que o que passar por cima dela aparece. Ver o fim da primeira parte de `captura-de-tela.md`.
- **Salas e conversas persistentes**, preparadas no plano de contas. A sala que não expira é
  por onde o nível completo cresce.
- Entrar com Discord; senha de sala; avatar enviado por arquivo; agentes de áudio nativos no
  Linux (PipeWire) e no macOS (ScreenCaptureKit).

---

## O custo ao longo do caminho

| a partir de | custo mensal |
|---|---|
| hoje | zero — o servidor é a sua máquina |
| fase 2 | ~€14 (VPS) |
| fase 3 | + remetente de e-mail e taxas do meio de pagamento |

A R$ 10, **~9 assinantes pagam o VPS de €14** (até ~2.000 ativos) e **~26 pagam o de €40**
(até ~3.000), na conversão usada no `lancamento.md` e antes das taxas.
