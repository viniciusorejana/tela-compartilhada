# Roteiro do Nexo

Atualizado em 22/09/2026. Junta num lugar só a ordem e o estado dos três planos:
[`lancamento.md`](lancamento.md) (custo e degraus), [`plano-contas.md`](plano-contas.md) e
[`plano-webcodecs.md`](plano-webcodecs.md). Os planos guardam o **porquê**; aqui fica o
**quê**, em que ordem, e o que já está feito.

Este arquivo muda quando uma etapa fecha. Os planos mudam quando uma decisão muda.

**Ordem:** feito → **1. contas** → **2. antes de abrir** → *lançamento* → **3. pagamento** →
**4. guiado pelo uso**

O pagamento fica **depois** do lançamento de propósito: o uso real diz se R$ 10 converte antes
de se gastar dias numa integração, e o atalho da fase 3 permite receber de apoiadores antes
dela.

---

## Já feito

| o quê | onde |
|---|---|
| A imagem encolhe em vez de perder quadros | `761944f` |
| O seletor diz, antes da escolha, o que a máquina entrega (metade do degrau 4) | `ed9ef79` |
| Relatos de problema chegam ao painel (degrau 2) | `b18cde9` |
| Sugestões com caminho próprio, em lista separada | `e18dc5f` |
| Sala com dono: expulsar, banir, desbanir, transferir (primeiro item do degrau 6) | `bd73c01`, `e18dc5f` |
| Apagar sons da mesa virou moderação: só quem abriu a sala, até as contas existirem | `5e81f75` |
| Aplicativo para Linux e macOS; a página oferece só o que existe | `3668834`, `92740d6` |
| `npm start` roda no Linux (era pendência do degrau 1) | `540fc6c` |
| Melhorias de sala: chat, layout, controles, latência desde a entrada | `779dc3e` a `633265c` |
| Planos: custo e lançamento, contas, WebCodecs | `docs/` |

### Esperando confirmação

- **Build do Linux** depois da correção do ícone — rodar `npm --prefix app run empacotar:linux`
  no Linux e conferir que o `.AppImage` abre.
- **Build do macOS** — nunca rodou, e só sai de um Mac. Sem a assinatura paga da Apple, o
  macOS bloqueia a primeira abertura até a pessoa liberar nas configurações de segurança.

---

## Fase 1 — Contas · ~11–13 dias · *próxima*

Plano completo em [`plano-contas.md`](plano-contas.md).

| etapa | entrega | dias |
|---|---|---|
| A | banco, cadastro, login e sessão — com o "sem atraso" garantido por teste | 3 |
| B | perfil que segue a pessoa; apagar a conta | 2 |
| C | só conta abre sala; carência de 60 s; dono sobrevive ao F5; banimento sem atingir homônimos; enviar e apagar sons exigem conta; a própria mensagem continua editável depois do F5 | 3,5 |
| D | os níveis 720p30 / 720p60 / 1080p–1440p, com o teto conferido no servidor; teto de pessoas maior com assinante na sala; premium à mão pelo painel | 2,5 |

Cada etapa sobe sozinha. A etapa A não muda nada para quem já usa.

---

## Fase 2 — Antes de abrir para desconhecidos · alguns dias

**Pode andar junto com a fase 1**: quase tudo aqui é operação, não código.

- **Sair de casa** (degrau 1): VPS de ~€14/mês. O código já está pronto; falta
  - um proxy com TLS (Caddy);
  - copiar os instaladores do aplicativo para `app/dist` do servidor (o agente de áudio já vai
    dentro deles);
  - o teste que fecha o degrau: alguém em 4G, alguém em Wi-Fi corporativo com UDP bloqueado, e
    um iPhone, os três recebendo tela.
- **Teto de pessoas por sala** (degrau 6, ainda não existe): **25** para começar. Uma sala de
  15 em 1440p são ~90 Mbps, e quem paga é você. O aumento para **50** com um assinante na sala
  vem na etapa D, porque depende de o plano existir.
- **O estado do Nexo na página inicial** (a metade do degrau 4 que falta): 720p60 e 1080p30
  cabem em software; 1080p60 e 1440p cedem resolução para não travar.
- **Página de privacidade** — precisa existir no dia em que houver senha guardada (LGPD).
- **Relatar uma pessoa ao mantenedor** (degrau 6): cabe na rota dos relatos, agora com o
  código da conta.
- **Avisar o grupo atual** e dar uma janela antes de "só conta abre sala" valer. Sugestão:
  premium de cortesia para esse grupo por alguns meses, pelo painel. Hoje eles transmitem em
  1440p de graça; assim viram os primeiros apoiadores, em vez de sentirem que perderam algo.

---

## Lançamento

Com as fases 1 e 2 prontas, o Nexo pode receber desconhecidos: contas existem, só conta abre
sala, os níveis valem no servidor, e o servidor não depende mais da sua máquina ligada. O
premium aparece no seletor com cadeado desde aqui; antes de a fase 3 existir, quem quiser pode
recebê-lo pelo atalho do painel.

---

## Fase 3 — Pagamento · ~3–5 dias

Estimativa deste roteiro; nenhum plano mediu esta fase ainda.

- **R$ 10/mês**, com PIX (Mercado Pago, Asaas ou Pagar.me). A webhook do provedor muda
  `conta.plano` — é a superfície inteira, e ela já existe desde a etapa A.
- O e-mail passa a ser obrigatório aqui, e com ele entra o remetente transacional.
- **Fora do código:** receber como pessoa física ou como MEI é conversa com contador, e precisa
  estar resolvido antes do primeiro pagamento.
- **Atalho, pronto desde a etapa D:** o painel marca uma conta como premium à mão, para quem
  pagar por PIX direto. Valida se R$ 10 converte antes de gastar dias na integração.
- **Vitalício só como captação limitada** ("primeiros apoiadores"): o custo é mensal e a
  receita seria única — ver `lancamento.md`, degrau 5.

---

## Fase 4 — Guiada pelo uso real

A ordem aqui é decidida pelo que a comunidade reclamar mais, e não antes.

- **WebCodecs** (degrau 7): começa pela etapa 0 — quatro medições de até um dia. A 0.4 (quanto
  o jogo ainda perde com 0, 1 e 3 espectadores) é o portão de valor. Se valer, são dez etapas,
  abandonáveis em qualquer ponto sem deixar a sala pior.
- **Salas e conversas persistentes**, preparadas no plano de contas. A sala que não expira é
  por onde o premium cresce.
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
