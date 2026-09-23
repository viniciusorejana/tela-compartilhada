# Telemetria do NEXO

O painel sobe com o servidor em **`/painel`**. Usa Web Components, store reativo pequeno e
SVG com tabelas equivalentes, sem novas dependências, CDN, bundler, banco ou serviço separado.
Os tokens de `public/tema.css` são compartilhados com a sala.

## Acesso

1. Inicie normalmente com `npm start` ou `npm run dev` se os binários já estiverem instalados.
2. Na máquina do servidor, execute **`npm run painel:chave`** — ou `npm run painel:chave:dev`
   para o servidor de desenvolvimento, que tem chave própria em `native/dev/painel`.
3. Abra `http://localhost:3000/painel` e cole a chave (ajuste a porta se usar `PORT`).

A chave aleatória de 256 bits fica em `native/painel/segredo.json`, fora do Git. Nunca é
impressa automaticamente no log. No Windows, a pasta recebe ACL do usuário do servidor e
de SYSTEM; em Unix, pasta 0700 e arquivo 0600. Se essa proteção falhar, o painel fica fechado.
Corrija a pasta e reinicie; execute o comando da chave com o mesmo usuário do servidor.

**`npm run painel:chave -- --rotacionar`** troca a chave e revoga sessões em até 10 segundos.
O cookie é HttpOnly, SameSite=Strict, restrito a `/painel`, Secure em HTTPS. A sessão dura
8 horas no máximo ou 30 minutos sem atividade, com até cinco sessões administrativas.
Login confere a origem; logout e renovação também conferem token CSRF. HTML privado,
scripts, API e SSE exigem autenticação. A entrada é genérica, sem salas, nomes ou métricas.

### O painel para na máquina do servidor

Por padrão `/painel` só responde a quem chega pelo loopback, com `Host` local e sem
cabeçalhos de encaminhamento. De qualquer outro lugar a rota inteira devolve **404** — não
403 — inclusive a tela de login: quem varre a porta de fora não descobre que existe um
painel aqui.

Isso **não** depende de `NEXO_PROXIES_CONFIAVEIS` nem de `PUBLIC_URL`. Antes dependia, por
acidente: um túnel declarado como proxy confiável passava a valer como origem legítima do
painel, e ligar os limites por IP abria o login junto. Com um túnel de Funnel ativo isso
significava expor o login à internet inteira, protegido só pela chave. São duas decisões
sem relação e agora ficam em variáveis separadas.

Para abrir o painel fora da máquina, é preciso pedir por escrito:

```powershell
$env:NEXO_PAINEL_REMOTO = '1'   # exige também PUBLIC_URL https e proxy declarado
```

### Limites por IP atrás de um túnel

`NEXO_PROXIES_CONFIAVEIS` agora governa só o que sempre deveria: de quem o servidor aceita
`X-Forwarded-For`. Sem ela, todo mundo que chega por um túnel compartilha o mesmo orçamento
de origem — uma pessoa reconectando em laço gasta a cota das outras, e a sala fica lenta
para entrar sem nenhum culpado aparente.

```ini
# .env.prod
PUBLIC_URL=https://seu-servidor.ts.net
NEXO_PROXIES_CONFIAVEIS=127.0.0.1,::1
```

Declare somente os IPs dos proxies administrados por você. Cadeias são percorridas da
direita para a esquerda até o primeiro IP não confiável, para que ninguém escolha o próprio
endereço escrevendo um cabeçalho.

## Contabilidade por funcionalidade

`medicao.js` grava janelas de aproximadamente 60 s em `native/medicao/banda.jsonl`, sem
identidade, IP ou conteúdo. O formato v2 separa tela, câmera, voz, som da tela, música,
soundboard, chat e outros. O bot marcado `ehBot` vai para `musica`; voz humana fica em
`micAudio`. No legado, `micAudio` aparece em **Voz + música · legado**: a separação antiga
é desconhecida, portanto não se inventa consumo zero de música.

- **Mídia:** deltas de `inbound-rtp.bytesReceived` declarados pelos navegadores.
- **Soundboard:** upload conta bytes efetivamente lidos, inclusive tentativa abortada;
  saída conta corpos enviados. Reprodução em cache não gera novo download.
- **Chat:** mensagens por destinatário e histórico entregue na entrada.
- **Outros:** arquivos públicos, instaladores e sinalização de controle, incluindo comandos
  do bot. O áudio do bot permanece em Música. O próprio painel fica fora dessa conta.

Upload aparece separado como **entrada**, sem somar ao custo de saída. São bytes de
aplicação, sem todo o overhead RTP/RTCP, TLS, TCP, retransmissões e túneis. Entrega ao
transporte do Node não comprova recebimento pelo destinatário. Faixas encerradas antes da
leitura, abas fechadas e clientes que não reportam deixam lacunas. O envio final ao sair
melhora a coleta, sem garantia de entrega. **Esses dados nunca decidem bloqueios ou alertas.**

O módulo `telemetria/agregacao.js` é compartilhado pelo painel e pelo relatório:

```powershell
npm run banda
npm run banda -- --dias 7 --sala squad
```

Mbps médio usa a união dos intervalos: salas simultâneas somam bytes, não relógio. O pico
da aplicação é o maior intervalo de minuto, combinando salas; não é pico instantâneo.
O pico de rede usa deltas de 15 s das interfaces, inclui outros programas e pode perder
rajadas curtas. Para evitar dupla contagem de VPN, usa a maior interface, sem somá-las.

`uso.jsonl` registra tempo observado, inclusive ocioso. Projeção automática exige ao menos
24 h de cobertura e todas as amostras do período cobertas; antes de sete dias é preliminar.
O cenário manual de horas/dia exige 30 min com dados e aparece como hipótese. US$ 0,09/GB é
ilustrativo e editável; base, franquia e excedente também. GB é decimal (1 bilhão de bytes);
quotas de proteção usam MiB (1.048.576 bytes). A coleta não equivale à fatura do provedor.

## Antiabuso medido no servidor

Contadores por sessão/sala ficam em memória. O painel mostra eventos Socket.IO por tipo e
pseudônimos temporários dos maiores emissores. Verificações internas de bytes e operações
ficam em tabela separada, para não inflar a taxa. Recusados continuam contando como
tentativas. Janelas têm fatias conservadoras: um minuto pode levar cerca de 65 s para liberar.

A credencial privada da aba vincula token de mídia, Socket.IO e HTTP. Ela não é `socket.id`,
não vai na URL e não pode ser deduzida da lista de participantes. Oscilações retomam a mesma
sessão e orçamento; abas novas recebem outros. Nomes são livres: identificam a sessão, sem
comprovar identidade pessoal. Um limite coletivo acusa a sala, não o último participante.

Só ultrapassar um teto produz alerta com nome, sala, regra, quantidade, janela e ação.
Incidente persistente atualiza o mesmo alerta no máximo uma vez/min. Há no máximo 500
alertas por sete dias; a fotografia em disco é substituída para retirar nomes expirados.
Com o servidor desligado não há limpeza: os expirados são filtrados ao reiniciar e
eliminados na próxima gravação. Não se guardam chat, sons, URLs de música, tokens ou IP bruto.

### Tetos padrão

Valores por minuto, salvo indicação. HTTP devolve 429 com `Retry-After`; Socket.IO devolve
erro quando há callback e aviso com intervalo mínimo de dois segundos.

| Operação | Sessão | Sala | Regra adicional |
|---|---:|---:|---|
| Tocar soundboard | 30 | 90 | Intervalo de 400 ms |
| Upload de som | 6 | 24 | Bytes: 12 / 48 MiB |
| Converter upload | 1 simultâneo | — | 2 globais; 15 s para receber o corpo |
| Baixar som | 90 | 900 | Bytes: 48 / 512 MiB |
| Remover / listar som | 30 / 30 | 90 / 300 | Exige presença na sala |
| Comando de música | 20 | 60 | Busca/expansão: 6 / 24 |
| Busca de música | 1 simultânea | 2 simultâneas | 4 globais; fila permanece em 60 |
| Chat | 40 | 240 | Rajada: 6 em 2 s |
| Imagem de chat | 4 | 40 | Bytes: 4 / 20 MiB |
| Entrar na sala | 6 | 120 | 20 por sessão em 10 min |
| Estado de mídia | 30 | 600 | Não comprova publicação real |
| Medição de banda | 3 | 1.536 | Sequência monotônica; até 2 GiB/amostra |
| Iniciar/trocar captura de áudio | 12 | 60 | Parar/sair podem liberar recursos |
| Estado/saúde do bot | 30 | 300 | — |
| Token de sala | 20 | 300 | 120 emissões por origem |
| Conexão Socket.IO | 60 por origem | — | Orçamento global e mapas limitados |
| Controle do agente WebSocket | 120 | — | Até 128 agentes conectados |
| Áudio do agente WebSocket | 12.000 pacotes | — | 32 MiB/min; mensagem de até 256 KiB |
| Total de eventos | 300 | — | Rajada: 60 em 5 s |
| Publicação de faixa | 20 | — | Observar e alertar |
| Republicação da mesma fonte | 4 | — | 12 em 5 min; observar e alertar |
| Publicar/despublicar faixa | 12 | — | Observar e alertar |
| Entrar/sair do SFU | 12 | — | Observar e alertar |
| Criar conta | 3 por origem | — | 3 por origem **por dia** |
| Entrar na conta | 10 por origem | — | 30 por origem em 15 min |
| Recuperar a conta | 5 por origem | — | 10 por origem em 1 h |
| Tentativas numa mesma conta | 5 | — | 10 em 15 min; entrar e recuperar somam juntos |
| Tentativas no servidor inteiro | 120 | — | Vem antes da fila de derivação de senha |
| Alterar a conta (senha, perfil, apagar) | 20 por conta | — | 120 em 1 h |

Os tetos das contas vêm **antes** da fila de derivação de senha (uma por vez, até 16
esperando; cheia, responde 429 na hora). Uma enxurrada é recusada sem ocupar lugar na fila de
quem está tentando entrar de verdade. O alerta de tentativas numa conta não leva o nome de
usuário: ele ficaria sete dias em disco dizendo quem foi alvo.

**Atenção com o teto diário de cadastros atrás de um túnel.** Sem `NEXO_PROXIES_CONFIAVEIS`,
toda conexão chega como `127.0.0.1` e todo mundo divide a mesma origem — o teto de três
cadastros por dia passa a ser do servidor inteiro. No dia de chamar o grupo para criar
contas, ou declare o proxy, ou suba o teto por `NEXO_LIMITES` (`{"cadastrar":{"sessao":20,"longa":[20,86400000]}}`).

Uma correção que as contas exigiram: a limpeza dos contadores esquecia qualquer um parado
havia dez minutos, e com ele qualquer janela mais longa — o teto diário voltava a três depois
de dez minutos de silêncio. Agora cada contador vive até acabar a janela mais longa que ele
carrega.

Publicações e churn vêm de webhooks assinados: emissor, prazo e SHA-256 do corpo são
conferidos; eventos repetidos são descartados. Primeiro minuto após subir o SFU e eventos
atrasados não geram alertas de churn, para acomodar recuperação coletiva. Trocar codec ou
qualidade continua permitido. A lista mostra resolução e o histórico guarda somente quantidade
observada de telas. Publicar um perfil não prova qual camada foi recebida; compartilhamentos
breves entre coletas podem não aparecer.

A mesma webhook alimenta o **teto do plano** (server.js, `conferirTela`): uma tela publicada
acima do plano de quem transmite, com 10% de folga, recebe um aviso pelo socket e, se continuar
acima depois de `NEXO_ESPERA_TETO_MS` (5 s), é desligada com `MutePublishedTrack` — só a tela. A
reconciliação de 30 s confere de novo, porque a resolução pode subir depois da publicação. A
resolução conferida é a que o cliente declara ao servidor de mídia; um cliente modificado que
declare menos do que manda não é pego.

Flood persistente acima de 900 eventos/min pode desconectar a sessão no Socket.IO e no SFU,
com bloqueio de um minuto. Sessões e origens novas continuam possíveis: a proteção do
aplicativo não substitui proteção de rede contra DDoS. Não há histórico de banda individual.
O canal de dados do LiveKit mantém as permissões anteriores da sala para preservar a
compatibilidade de negociação/republicação desta versão. Os limites de chat e comandos
valem para Socket.IO; tráfego enviado diretamente pelo canal de dados do SFU não passa
por esses handlers e não recebe esses mesmos limites.

`NEXO_LIMITES` aceita ajustes das regras em JSON. Exemplo:

```powershell
$env:NEXO_LIMITES = '{"soundboard-tocar":{"sessao":40,"sala":120},"chat-message":{"sessao":60}}'
npm run dev
```

Veja os demais tetos, incluindo agente de áudio, em **Consultar os limites em vigor**.
O download portátil preserva ETag/revalidação, Range, até três transferências simultâneas
e 20 inícios em dez minutos por origem; seu mapa agora também tem teto de 2.048 origens.

## Contas e planos no painel

A seção **Contas e planos** busca por conta própria, paginada (25 por página, do cadastro mais
novo para o mais antigo), como os relatos: não viaja no resumo de dez em dez segundos. Mostra
quantas contas existem, quantas estão premium e quantas suspensas, os cadastros por dia dos
últimos 30 dias, e a lista com apelido, usuário, código, plano, criação e último uso. Nada de
senha, sessão ou id interno: a conta é achada pelo **código** (ou pelo usuário, na busca exata —
sem `LIKE`, que se comporta diferente no SQLite e no Postgres).

As ações, todas com CSRF como o resto das escritas do painel:

- **Premium por N dias** ou **sem prazo** — o atalho do roteiro para receber por PIX direto antes
  da integração de pagamento. Grava `conta.plano` e `conta.plano_ate`, a mesma superfície que a
  webhook do pagamento vai mudar depois. Vencido o prazo, a conta volta sozinha ao grátis.
- **Voltar ao grátis.**
- **Suspender por N dias** e **reativar**. Suspender apaga as sessões da conta e a tira da sala em
  que estiver — sinalização e mídia.

Quem está numa sala recebe o plano novo na hora, pelo socket.

**O teto de pessoas** aparece em **Salas e uso**: o teto em vigor (base e com alguém premium),
quantas salas estão no teto base agora, o pico no período e quantas entradas foram recusadas por
lotação. Os dois últimos vão para `uso.jsonl` a cada minuto (`salasNoTetoBase`,
`recusasPorLotacao`), sem nome e sem sala. É esta linha que diz se 25 e 50 são os números certos.

## Coleta, retenção e recursos

- Prometheus local: `SFU_METRICAS_PORT`, padrão 7883, com Basic Auth derivada do segredo
  do SFU. Não encaminhe essa porta publicamente. O YAML usa `prometheus.port`, suportado
  no binário 1.13.6. Métricas usam lista fechada; labels pessoais não são persistidos;
  pacotes não são convertidos em bytes. Latência/jitter são convertidos de ns para ms,
  conforme [ForwardStats 1.13.6](https://github.com/livekit/livekit/blob/v1.13.6/pkg/sfu/forwardstats.go).
- CPU/RAM de Node/SFU e métricas: 15 s. Windows usa uma consulta PowerShell assíncrona
  por coleta, com prazo de cinco segundos. 100% CPU representa um núcleo.
- Laço de eventos do Node: pior atraso e p99 da janela de 15 s (`monitorEventLoopDelay`) e a
  fração do tempo ocupado (`eventLoopUtilization`). O pior de cada minuto vai para `uso.jsonl`
  como `picoLacoMs`, e o painel mostra o pior do período. É por esse laço que passam chat,
  entrada e sinalização da mídia de todas as salas. **No Windows o relógio tem granularidade de
  ~15,6 ms**, e esse é o piso do histograma: o laço ocioso mede 15,5. Qualquer valor até ~16 ms
  significa "nada"; no Linux do VPS o piso é ~1 ms. Acima de 100 ms, algo síncrono está
  segurando as salas — é o mesmo limite que `tests/contas.test.js` impõe a uma rajada de logins.
- Presença/faixas: webhook e reconciliação a cada 30 s, duas consultas simultâneas e
  orçamento de seis segundos por rodada. Confirmações com mais de 90 s saem da lista.
  Mute pode aguardar reconciliação. Webhook perdido não é reconstruído como churn.
- Disco de `native/`: cinco minutos, até 50 mil entradas/15 s, sem seguir links.
  Parcialidade aparece no painel. Sons ficam em RAM e música usa pipelines, como antes.
- SSE: fotografia a cada 10 s, até dez conexões globais/três por sessão. Cliente lento
  é encerrado; SSE sozinho não renova atividade administrativa.
- Cada JSONL contábil: atual e anterior de até 8 MiB cada. **30 dias/tudo filtra o que
  ainda está retido**, sem prometer retenção de 30 dias. Fila de escrita assíncrona de
  512 KiB por arquivo; perdas/falhas aparecem no painel.
- Agregação histórica: thread nativa do Node sob demanda, cache de 60 s/quatro consultas,
  heap limitado e prazo de 30 s, encerrada após cinco minutos ociosa. O event loop que
  entrega chat/áudio não executa a agregação histórica.
- Memória: 2.048 sessões e 512 salas por conjunto de contadores; ociosas expiram em dez
  minutos; 8.192 IDs de webhook por dez minutos; 2.048 participantes com até 16 faixas.
  Saturação recusa trabalho novo sem expulsar contadores ativos.

Duração/permanência medem sessões **de sinalização concluídas**. Queda de Socket.IO fecha
o intervalo mesmo que a mídia continue. Sessões abertas não entram na média de duração;
distribuição de tamanho integra tempo de pessoas, sem bots. Reinícios do SFU são contados
desde a inicialização deste processo Node.

Variáveis opcionais: `NEXO_FUSO` (fuso do sistema por padrão), `NEXO_DADOS_TELEMETRIA` e
`NEXO_PASTA_PAINEL` para pastas. `NEXO_SEM_MIDIA=1` permite operar só chat/painel.
`NEXO_PASTA_SFU` isola YAML e chaves; `NEXO_BINARIO_SFU` diz onde está o executável. Os
testes usam as duas juntas: configuração numa pasta sorteada a cada execução, executável
num caminho fixo em `%TEMP%\nexo-sfu-de-teste`.

A separação existe por causa do firewall do Windows, que cria a regra por caminho de
executável — com o binário viajando junto da pasta sorteada, cada rodada de teste pedia
uma permissão nova. Continua sendo uma cópia, e não o binário instalado, porque a limpeza
de órfãos encerra processos casando pelo caminho exato: apontar para `native/livekit` faria
um teste derrubar a sala de quem estivesse usando o servidor na mesma máquina.

## Testes

```powershell
npm test
npm run test:painel
```

Node cobre agregação/legado, cobertura, rotação, contadores limitados, credenciais, webhook
e acesso privado. HTTP testa o servidor real, flood e upload abortado. Playwright cobre
desktop/celular/1440p, foco, tabelas, SSE, logout, primeiro dia, chat sem mídia e publicação
sintética real de 1440p com webhook assinado. Capturas ficam em `test-results/painel/`;
dados de exemplo existem somente em pastas temporárias dos testes.

### Pendência de investigação

O teste amplo `npm run test:browser` apresentou uma falha intermitente ao encerrar a
tela depois de trocar qualidade/codec: a câmera permanecia ativa no emissor, mas sumia
da lista de publicações do receptor. A última execução completa passou; isso não
comprova que a intermitência foi resolvida. A investigação ficou adiada a pedido do
responsável. O teste mantém diagnóstico das publicações/eventos para uma nova ocorrência.
