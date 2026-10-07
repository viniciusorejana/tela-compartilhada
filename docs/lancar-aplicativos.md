# O lançamento dos aplicativos

Um comando leva os aplicativos do Nexo do código até o ar. Ele decide sozinho se o aplicativo de
mesa e o Android precisam de versão nova, sobe o número, gera o Windows e o Android no PC, gera o
Linux na própria máquina do servidor, manda tudo, confere e, no caminho, garante que o ramo está no
GitHub e que a máquina roda o mesmo commit.

```powershell
npm run lancar:plano        # só mostra o que faria (lê a máquina, não muda nada)
npm run lancar              # mostra o plano e pergunta antes de fazer
npm run lancar -- --sim     # faz sem perguntar
```

O código mora em `deploy/lancamento/`. A configuração, com a máquina, o ramo e o endereço, fica em
`deploy/lancamento/config.json`, fora do Git. O modelo é `config.exemplo.json`.

## 1. O que ele faz, em ordem

| # | Passo | Onde |
|---|---|---|
| 1 | Confere o ramo: é o do `config.json`, não tem mudança sem commit no que entra nos builds e não está atrás do GitHub | PC |
| 2 | Lê a máquina: o commit, o `versao.json`, os arquivos do `app/dist` e quantas pessoas estão em chamada | máquina (SSH, só leitura) |
| 3 | Decide, por produto, se precisa de versão nova e quais builds saem, e mostra o plano | PC |
| 4 | Sobe a versão (`app/package.json`, `android/app/build.gradle`) e faz o commit | PC |
| 5 | Envia o ramo ao GitHub | PC → GitHub |
| 6 | Gera o Windows (instalador e portátil) e o Android | PC |
| 7 | Leva a máquina para o commit do lançamento e reinicia o serviço, se ela estiver atrás | máquina |
| 8 | Manda os builds, confere o SHA-256 lá, troca no `app/dist` e anota as versões | PC → máquina |
| 9 | Gera o Linux (AppImage e `.deb`) e o põe no `app/dist` | máquina |
| 10 | Confere pelo endereço público: `/api/desktop-app`, `latest.yml` e `latest-linux.yml` | PC → endereço público |

Quando não há nada para lançar, ele ainda faz os passos 1, 2, 5 e 7: envia o ramo e atualiza a
máquina se for preciso. Depois confere o que está no ar e termina.

## 2. Como ele decide

**O que vale é o que está no ar, e não o código.** A decisão parte do `app/dist/versao.json` da
máquina, que diz o que o servidor anuncia, e não de um registro do próprio lançamento. Por isso
rodar de novo depois de uma falha retoma de onde parou: o que já está no ar não sai de novo, e o
que faltou sai.

**Cada build diz de onde saiu.** O `app/escrever-versao.js` anota em cada linha do `versao.json`
três coisas:

- a versão;
- o `commit` de onde o build saiu;
- o `servidor` que o aplicativo traz preenchido.

Ele faz isso tanto no lançamento quanto num `npm run empacotar` à mão. Um build feito com mudanças
sem commit no que entra nele fica marcado `sujo`, porque o commit não diz o que ele tem.

**Um número que está no ar fica congelado.** Se algum build anunciado com o número que está no
código saiu de um código diferente do atual, é preciso um número novo. O aplicativo instalado só
troca de arquivo quando o número sobe. Um build novo com o número velho nunca chegaria a ninguém,
e no portátil ainda faria o aviso de atualização girar em looping.

**O que conta como mudança**:

- **Aplicativo de mesa:** só o que o electron-builder empacota (`build.files` do
  `app/package.json`), o `package.json`, o `package-lock.json` e o `native/audio-agent`. Mexer no
  `escrever-versao.js`, num teste ou na página não pede versão nova. A página vem do servidor, e o
  passo 7 já a atualiza.
- **Android:** a pasta `android/`.
- **Para os dois:** um servidor padrão diferente do que o build traz, e um build marcado `sujo`.

Builds anotados antes deste lançamento existir não têm commit. Para eles vale o commit que pôs
aquele número no código, ou seja, o mais antigo que mexeu na linha da versão.

**O número novo:**

- Se um dos commits que mudaram o produto começa com `feat`, sobe o número do meio
  (1.3.0 → 1.4.0).
- Se não, sobe o último (1.3.0 → 1.3.1).
- O primeiro número só sobe com `--nivel major`.
- No Android, o `versionCode` sobe sempre, porque é por ele que o Android aceita instalar por cima.

**Versão já subida e ainda não lançada:** se o código já está à frente do que está no ar, o
lançamento não sobe de novo, só gera. Isso cobre quem subiu à mão e a nova tentativa depois de uma
falha.

**Quando só falta um build** (o Linux falhou, um arquivo sumiu do `app/dist`), ele sai sozinho,
com o número que já está no ar.

**A unidade é o build, não a chave.** O instalador e o portátil saem do mesmo comando, e o
AppImage e o `.deb` também. Refazer um refaz o outro.

## 3. A configuração

`deploy/lancamento/config.json`:

| Campo | Para que serve | Padrão |
|---|---|---|
| `ramo` | O ramo que se lança. O PC precisa estar nele | (obrigatório) |
| `remoto` | O remoto do Git, o mesmo de onde a máquina baixa | `origin` |
| `urlPublica` | O endereço público do servidor, por onde a conferência final olha | (obrigatório) |
| `servidorPadrao` | O endereço que os aplicativos trazem preenchido na primeira vez | o `urlPublica` |
| `vps.host` | O IP ou o nome da máquina | (obrigatório) |
| `vps.porta` | A porta da SSH | `22` |
| `vps.usuario` | O usuário da SSH. Precisa de `sudo` sem senha | `ubuntu` |
| `vps.chave` | A chave privada da SSH (`~` vale). Vazio, usa a do agente ou a padrão do ssh | — |
| `vps.pasta` | Onde o Nexo está instalado | `/opt/nexo` |
| `vps.usuarioDoServico` | O dono da pasta, quem roda o Node | `nexo` |
| `vps.servico` | O serviço do systemd | `nexo` |
| `construir.windows` / `.android` / `.linux` | Liga e desliga cada build | `true` |
| `javaHome` | O JDK do Android (17 ou 21). Vazio, procura nas pastas de sempre | — |

Opções de uma vez só, na linha de comando:

| Opção | O que faz |
|---|---|
| `--plano` | Só mostra o plano |
| `--sim` | Segue sem perguntar |
| `--nivel patch\|minor\|major` | Força o nível da versão nova |
| `--ramo <nome>` | Outro ramo que o do `config.json` |
| `--config <arquivo>` | Outro arquivo de configuração, por exemplo uma segunda máquina |
| `--reiniciar-com-gente` | Reinicia o serviço mesmo com gente em chamada |

O servidor padrão vai para os builds pela variável `NEXO_SERVIDOR_PADRAO`, que vence a do
`.env.prod`. Por isso o Windows (feito no PC) e o Linux (feito na máquina) saem com o mesmo
endereço, seja qual for o `.env.prod` de cada um. Se o `.env.prod` da máquina disser outro
endereço, o lançamento avisa e segue com o do `config.json`.

## 4. O que ele garante

- **Não reinicia o servidor com gente em chamada.** Ele lê quantas pessoas estão em chamada pelas
  métricas do servidor de mídia, confere antes dos builds e de novo logo antes de reiniciar. Se não
  der para saber quantas são, também para. Para reiniciar mesmo assim, use
  `--reiniciar-com-gente`.
- **Só manda o que este lançamento gerou.** O Windows sai em `app/dist-lancamento` e o Linux em
  `app/dist-lancamento` da máquina. Um build que falhasse no meio deixaria no `app/dist` o arquivo
  da vez anterior, que seria mandado como se fosse o novo.
- **Nenhum download pela metade.** Na máquina, cada arquivo só entra depois de conferido o SHA-256
  e entra por rename, que é atômico: quem está baixando termina o arquivo velho inteiro. A ficha
  (`latest.yml`) entra depois do executável que ela cita, e o `versao.json` entra por último.
- **Não passa por cima de nada.** Ele para se há mudança sem commit no que entra nos builds, se o
  ramo está atrás do GitHub ou divergiu dele, ou se o código na máquina tem mudança local.
- **Pergunta antes.** O commit da versão, o envio ao GitHub e o reinício só acontecem depois de
  você confirmar o plano (ou com `--sim`). Sem terminal e sem `--sim`, ele para depois do plano.
- **Confere de fora.** No fim, a versão e o tamanho de cada build são lidos pelo endereço público,
  pelo mesmo caminho que a página e os aplicativos usam.

## 5. O que precisa estar pronto

**No PC (Windows):**

- Node 24, Git e o cliente OpenSSH (`ssh` e `scp`).
- O agente de áudio compilado em `native/audio-agent/x64/Release/AgenteAudio.exe`. O lançamento não
  o compila, só avisa se o código dele tem commit mais novo que o executável.
- Para o Android: o Android SDK, um JDK 17 ou 21 e a chave de assinatura
  (`android/keystore.properties`, ver `docs/android.md`).
- As dependências do aplicativo se resolvem sozinhas: quando o `app/package-lock.json` muda, ele
  roda `npm ci` em `app/`. Ele guarda o hash do lock em `app/node_modules/.nexo-lock`.

**Na máquina:**

- O Nexo instalado, pelo `deploy/oracle/instalar.sh` ou equivalente: um clone do repositório na
  `vps.pasta`, de dono `vps.usuarioDoServico`, e o serviço do systemd.
- O usuário da SSH com `sudo` sem senha. Na Oracle, o `ubuntu` já vem assim.
- O `binutils`, que o `.deb` precisa, é instalado sozinho na primeira vez.
- O Linux é gerado com `nice -n 19`. Numa máquina de 1 GB leva alguns minutos e usa a swap que o
  `instalar.sh` cria.

## 6. Trocar de máquina

1. **Instale o Nexo na máquina nova**, pelo `docs/oracle.md`: portas, `instalar.sh` e endereço.
2. **Copie os dados**, com o serviço parado nas duas máquinas, para nada ser escrito no meio:

   ```bash
   # na máquina velha
   sudo systemctl stop nexo
   sudo tar -czf /tmp/nexo-dados.tgz -C /opt/nexo native/contas native/painel native/medicao native/livekit/chaves.json
   ```

   Passe o `/tmp/nexo-dados.tgz` para a nova, por exemplo com `scp` pelo PC. Depois, na nova:

   ```bash
   sudo systemctl stop nexo
   sudo tar -xzf /tmp/nexo-dados.tgz -C /opt/nexo
   sudo rm -f /opt/nexo/native/contas/nexo.db-wal /opt/nexo/native/contas/nexo.db-shm
   sudo chown -R nexo:nexo /opt/nexo/native
   sudo systemctl start nexo
   ```

   - **O que vai junto:** `native/contas` tem as contas (o banco), `native/painel` tem os alertas, a
     chave do painel e a chave do WebCodecs, e `native/medicao` tem as medições, as sugestões e os
     relatos.
   - **Por que a chave do servidor de mídia:** a `chaves.json` mantém válidos os links do OBS do
     Estúdio, que são assinados com ela.
   - **Fora do pacote:** copie à parte os cookies do YouTube (`native/musica/cookies.txt`) e os
     ajustes do `.env.prod`, como `NEXO_FUSO`, `NEXO_YTDLP_ARGS` e `NEXO_SERVIDOR_PADRAO`.
3. **Aponte o lançamento para a máquina nova** no `config.json`: `vps.host`, `vps.chave` e
   `urlPublica` (e `servidorPadrao`, se for outro endereço). Outro caminho, usuário ou serviço vão em
   `vps.pasta`, `vps.usuarioDoServico` e `vps.servico`. Para manter as duas, faça um segundo arquivo
   e use `--config`.
4. **Rode `npm run lancar:plano`.** Na máquina nova não há nada lançado, então ele gera os builds
   com o número que está no código, já com o endereço novo. Os aplicativos instalados continuam
   ligados ao servidor que cada pessoa escolheu: quem quiser trocar usa "Trocar de servidor" nas
   configurações da sala.

**Máquina ARM (Ampere):** o Linux é gerado com `--x64` fixo, porque a página anuncia "Linux x64".
Se o electron-builder não conseguir montar o x64 numa máquina ARM, use `"construir": { "linux":
false }` e gere o Linux noutra máquina x64 (`npm --prefix app run empacotar:linux`), mandando o
AppImage, o `.deb` e o `latest-linux.yml` para o `app/dist`.

## 7. Quando algo falha

Rode de novo. Tudo o que já está no ar é reconhecido, e só o que faltou sai.

| Mensagem | O que fazer |
|---|---|
| `Há N pessoa(s) em chamada` | Espere a sala esvaziar, ou use `--reiniciar-com-gente` |
| `Há mudanças não commitadas no que entra nos builds` | Faça o commit ou descarte |
| `O ... tem N commit(s) que você não tem` / `divergiu` | `git pull` (ou `--rebase`) antes |
| `... terminou com o código 255` | A SSH não conectou: `vps.host`, `vps.porta` ou `vps.chave` |
| `sudo: a password is required` | O usuário da SSH precisa de `sudo` sem senha |
| `O código na máquina tem mudanças locais` | Desfaça lá (`git -C /opt/nexo status`) |
| `O Android precisa de um JDK 17 ou 21` | Instale um, ou aponte `javaHome` |
| `O APK saiu SEM assinatura` | Falta a chave: `docs/android.md`, "A chave" |
| `O servidor não anuncia o esperado` | Veja o que ficou diferente na lista e rode de novo |

Se o build do Linux morrer por memória, confira a swap na máquina (`free -h`).

## 8. O que ele não faz

- **Não compila o agente de áudio.** Ele é do Visual Studio e entra pronto no build.
- **Não gera o macOS.** O `.dmg` só sai num Mac (`npm --prefix app run empacotar:mac`).
- **Não muda o `.env.prod` da máquina.** O servidor padrão vai pela variável do build.
- **Não instala a máquina do zero.** Isso é o `deploy/oracle/instalar.sh`.

## 9. Onde mora

| Assunto | Arquivo |
|---|---|
| O lançamento, passo a passo | `deploy/lancamento/lancar.cjs` |
| As decisões (versão nova, número, quais builds) | `deploy/lancamento/versoes.cjs`, testadas em `tests/lancamento.test.js` |
| O que roda na máquina | `deploy/lancamento/remoto/`: `estado.sh` (só lê), `sincronizar.sh`, `publicar.sh`, `linux.sh` |
| A anotação de cada build e o que entra em cada um | `app/escrever-versao.js` (`anotar`, `caminhosDoBuild`) |
| A configuração | `deploy/lancamento/config.json` (fora do Git); modelo em `config.exemplo.json` |
