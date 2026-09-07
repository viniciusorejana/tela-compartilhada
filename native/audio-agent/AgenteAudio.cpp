// Agente de audio local.
//
// Roda no computador de cada participante e faz uma coisa so: captura todo o audio do
// sistema EXCETO a arvore de processos do navegador (a mesma API de loopback por processo
// do Windows que o ApplicationLoopback.exe usa) e envia esse PCM pelo WebSocket para o
// servidor da sala, que devolve o audio ao navegador desta mesma pessoa.
//
// O agente e sempre CLIENTE: ele conecta para fora. Por isso nao precisa de certificado
// nem de porta aberta, e nao esbarra na regra de mixed content do navegador.

// winsock2.h antes de Windows.h de proposito: na ordem inversa o Windows.h puxa o
// winsock.h antigo e os dois entram em conflito.
#include <winsock2.h>
#include <ws2tcpip.h>
#include <Windows.h>
#include <winhttp.h>
#include <bcrypt.h>
#include <tlhelp32.h>
#include <mfapi.h>
#include "../audio-helper/Aplicativos.h"
#include <iostream>
#include <string>
#include <vector>
#include <deque>
#include <mutex>
#include <condition_variable>
#include <thread>
#include <atomic>

#include "../audio-helper/LoopbackCapture.h"

#pragma comment(lib, "winhttp.lib")
#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "bcrypt.lib")
#pragma comment(lib, "crypt32.lib")

// ---------------------------------------------------------------------------
// Configuracao pelo NOME DO ARQUIVO.
//
// O servidor entrega o executavel com um nome do tipo
//     AgenteAudio.cfg-<base64url da URL>.exe
// e o agente le o proprio nome ao iniciar. Assim o participante so da um duplo clique,
// sem digitar nada, e o binario entregue e byte a byte igual ao compilado.
//
// (A primeira versao gravava a URL dentro do proprio .exe. Funcionava, mas alterar um
// binario depois de compilado e um padrao que o Windows Defender associa a malware: a
// copia modificada era barrada como Trojan:Win32/Wacatac.B!ml, enquanto a original
// passava sem problema.)
// ---------------------------------------------------------------------------
static const wchar_t* kMarcadorNoNome = L".cfg-";

static std::wstring CaminhoDoProprioExecutavel()
{
    // Buffer generoso: com MAX_PATH o caminho seria truncado em pastas profundas e a
    // configuracao no nome se perderia.
    std::vector<wchar_t> caminho(32768, L'\0');
    const DWORD tamanho = GetModuleFileNameW(nullptr, caminho.data(), static_cast<DWORD>(caminho.size()));
    return std::wstring(caminho.data(), tamanho);
}

// Guarda a configuracao para o caso de a pessoa renomear ou mover o executavel depois.
static std::wstring CaminhoDoArquivoDeConfig()
{
    wchar_t* base = nullptr;
    size_t tamanho = 0;
    if (_wdupenv_s(&base, &tamanho, L"LOCALAPPDATA") != 0 || !base) return std::wstring();
    std::wstring pasta(base);
    free(base);
    pasta += L"\\AgenteAudioSala";
    CreateDirectoryW(pasta.c_str(), nullptr);
    return pasta + L"\\config.txt";
}

static std::string LerConfigSalva()
{
    const std::wstring caminho = CaminhoDoArquivoDeConfig();
    if (caminho.empty()) return std::string();
    HANDLE arquivo = CreateFileW(caminho.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (arquivo == INVALID_HANDLE_VALUE) return std::string();
    char buffer[1024]{};
    DWORD lidos = 0;
    ReadFile(arquivo, buffer, sizeof(buffer) - 1, &lidos, nullptr);
    CloseHandle(arquivo);
    std::string texto(buffer, lidos);
    while (!texto.empty() && (texto.back() == '\r' || texto.back() == '\n')) texto.pop_back();
    return texto;
}

static void SalvarConfig(const std::string& url)
{
    const std::wstring caminho = CaminhoDoArquivoDeConfig();
    if (caminho.empty()) return;
    HANDLE arquivo = CreateFileW(caminho.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (arquivo == INVALID_HANDLE_VALUE) return;
    DWORD escritos = 0;
    WriteFile(arquivo, url.data(), static_cast<DWORD>(url.size()), &escritos, nullptr);
    CloseHandle(arquivo);
}

// Nome esperado:  AgenteAudio.cfg-<token>-<host>.exe
// Ex.:            AgenteAudio.cfg-a1b2...-minha-sala.trycloudflare.com.exe
//
// Legivel de proposito: a pessoa consegue ver a qual servidor o agente vai se conectar.
// O ':' de uma porta vira '_', porque ':' nao e valido em nome de arquivo no Windows.
static std::string LerConfiguracaoDoNome()
{
    const std::wstring caminho = CaminhoDoProprioExecutavel();
    const size_t inicioMarcador = caminho.rfind(kMarcadorNoNome);
    if (inicioMarcador == std::wstring::npos) return std::string();

    std::wstring resto = caminho.substr(inicioMarcador + wcslen(kMarcadorNoNome));

    // Primeiro tira o ".exe" do fim, depois eventuais sufixos que o navegador acrescenta
    // em downloads repetidos ("... (1).exe"). Nesta ordem: o host termina em ".com" e uma
    // remocao generica de extensao comeria justamente esse pedaco.
    if (resto.size() >= 4)
    {
        const std::wstring fim = resto.substr(resto.size() - 4);
        if (_wcsicmp(fim.c_str(), L".exe") == 0) resto = resto.substr(0, resto.size() - 4);
    }
    const size_t espaco = resto.find(L' ');
    if (espaco != std::wstring::npos) resto = resto.substr(0, espaco);

    const size_t separador = resto.find(L'-');
    if (separador == std::wstring::npos) return std::string();

    std::wstring token = resto.substr(0, separador);
    std::wstring host = resto.substr(separador + 1);
    if (token.empty() || host.empty()) return std::string();
    for (auto& c : host) if (c == L'_') c = L':';

    const bool local = host.rfind(L"localhost", 0) == 0 || host.rfind(L"127.0.0.1", 0) == 0;
    std::wstring url = (local ? L"ws://" : L"wss://") + host + L"/agente?token=" + token;

    std::string saida;
    saida.reserve(url.size());
    for (wchar_t c : url) saida.push_back(static_cast<char>(c));  // a URL e sempre ASCII
    return saida;
}

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------
struct EnderecoWs
{
    bool seguro = true;
    std::wstring host;
    INTERNET_PORT porta = 443;
    std::wstring caminho;  // inclui a query string
};

static std::wstring ParaWide(const std::string& texto)
{
    if (texto.empty()) return std::wstring();
    int tamanho = MultiByteToWideChar(CP_UTF8, 0, texto.c_str(), -1, nullptr, 0);
    std::wstring saida(tamanho > 0 ? tamanho - 1 : 0, L'\0');
    if (tamanho > 0) MultiByteToWideChar(CP_UTF8, 0, texto.c_str(), -1, &saida[0], tamanho);
    return saida;
}

static bool AnalisarUrl(const std::string& url, EnderecoWs& saida)
{
    std::string resto;
    if (url.rfind("wss://", 0) == 0) { saida.seguro = true; saida.porta = 443; resto = url.substr(6); }
    else if (url.rfind("ws://", 0) == 0) { saida.seguro = false; saida.porta = 80; resto = url.substr(5); }
    else return false;

    const size_t barra = resto.find('/');
    std::string autoridade = (barra == std::string::npos) ? resto : resto.substr(0, barra);
    std::string caminho = (barra == std::string::npos) ? "/" : resto.substr(barra);

    const size_t doisPontos = autoridade.rfind(':');
    if (doisPontos != std::string::npos && autoridade.find(']') == std::string::npos)
    {
        saida.porta = static_cast<INTERNET_PORT>(atoi(autoridade.substr(doisPontos + 1).c_str()));
        autoridade = autoridade.substr(0, doisPontos);
    }
    if (autoridade.empty()) return false;

    saida.host = ParaWide(autoridade);
    saida.caminho = ParaWide(caminho);
    return true;
}

// ---------------------------------------------------------------------------
static std::wstring ExecutavelDaFamilia(const std::string& familia)
{
    if (familia == "chrome") return L"chrome.exe";
    if (familia == "msedge") return L"msedge.exe";
    if (familia == "firefox") return L"firefox.exe";
    if (familia == "opera") return L"opera.exe";
    if (familia == "brave") return L"brave.exe";
    if (familia == "vivaldi") return L"vivaldi.exe";
    return std::wstring();
}

// ---------------------------------------------------------------------------
// Fila de PCM: a captura roda numa thread do Media Foundation e nao pode bloquear
// esperando a rede. Ela so enfileira; quem envia e outra thread.
// ---------------------------------------------------------------------------
static std::mutex g_mutexFila;
static std::condition_variable g_filaTemDados;
static std::deque<std::vector<BYTE>> g_fila;
static std::atomic<bool> g_encerrando{ false };
// Teto curto de proposito. Guardar 1,5 s aqui nao evitava perda nenhuma: so empurrava
// o audio inteiro para tras, porque tudo enfileirado ainda precisa ser tocado em tempo
// real do outro lado. Melhor descartar cedo e manter a conversa em sincronia.
static const size_t kMaximoDeBlocosNaFila = 20;  // ~250 ms de audio

static void EnfileirarPcm(const BYTE* dados, DWORD bytes)
{
    if (!bytes) return;
    std::lock_guard<std::mutex> trava(g_mutexFila);
    // Se a rede engasgar, descarta o audio mais antigo em vez de crescer sem limite.
    while (g_fila.size() >= kMaximoDeBlocosNaFila) g_fila.pop_front();
    g_fila.emplace_back(dados, dados + bytes);
    g_filaTemDados.notify_one();
}

static void LimparFila()
{
    std::lock_guard<std::mutex> trava(g_mutexFila);
    g_fila.clear();
}

// ---------------------------------------------------------------------------
// WebSocket (WinHTTP cuida do TLS)
// ---------------------------------------------------------------------------
class ConexaoWebSocket
{
public:
    ~ConexaoWebSocket() { Fechar(); }

    bool Conectar(const EnderecoWs& endereco)
    {
        m_sessao = WinHttpOpen(L"AgenteAudioTelaCompartilhada/1.0",
            WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
        if (!m_sessao) return false;

        m_conexao = WinHttpConnect(m_sessao, endereco.host.c_str(), endereco.porta, 0);
        if (!m_conexao) return false;

        HINTERNET requisicao = WinHttpOpenRequest(m_conexao, L"GET", endereco.caminho.c_str(),
            nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
            endereco.seguro ? WINHTTP_FLAG_SECURE : 0);
        if (!requisicao) return false;

        bool ok = WinHttpSetOption(requisicao, WINHTTP_OPTION_UPGRADE_TO_WEB_SOCKET, nullptr, 0) &&
            WinHttpSendRequest(requisicao, WINHTTP_NO_ADDITIONAL_HEADERS, 0, nullptr, 0, 0, 0) &&
            WinHttpReceiveResponse(requisicao, nullptr);

        if (ok) m_websocket = WinHttpWebSocketCompleteUpgrade(requisicao, 0);
        WinHttpCloseHandle(requisicao);
        return m_websocket != nullptr;
    }

    bool EnviarBinario(const BYTE* dados, DWORD bytes)
    {
        std::lock_guard<std::mutex> trava(m_mutexEnvio);
        if (!m_websocket) return false;
        return WinHttpWebSocketSend(m_websocket, WINHTTP_WEB_SOCKET_BINARY_MESSAGE_BUFFER_TYPE,
            const_cast<BYTE*>(dados), bytes) == NO_ERROR;
    }

    bool EnviarTexto(const std::string& texto)
    {
        std::lock_guard<std::mutex> trava(m_mutexEnvio);
        if (!m_websocket) return false;
        return WinHttpWebSocketSend(m_websocket, WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE,
            const_cast<char*>(texto.data()), static_cast<DWORD>(texto.size())) == NO_ERROR;
    }

    // Devolve false quando a conexao cai.
    bool Receber(std::string& mensagem)
    {
        mensagem.clear();
        BYTE buffer[2048];
        for (;;)
        {
            DWORD lidos = 0;
            WINHTTP_WEB_SOCKET_BUFFER_TYPE tipo{};
            if (!m_websocket) return false;
            const DWORD resultado = WinHttpWebSocketReceive(m_websocket, buffer, sizeof(buffer), &lidos, &tipo);
            if (resultado != NO_ERROR) return false;
            if (tipo == WINHTTP_WEB_SOCKET_CLOSE_BUFFER_TYPE) return false;

            mensagem.append(reinterpret_cast<char*>(buffer), lidos);
            if (tipo == WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE ||
                tipo == WINHTTP_WEB_SOCKET_BINARY_MESSAGE_BUFFER_TYPE)
                return true;  // mensagem completa
        }
    }

    void Fechar()
    {
        std::lock_guard<std::mutex> trava(m_mutexEnvio);
        if (m_websocket) { WinHttpWebSocketClose(m_websocket, WINHTTP_WEB_SOCKET_SUCCESS_CLOSE_STATUS, nullptr, 0); WinHttpCloseHandle(m_websocket); m_websocket = nullptr; }
        if (m_conexao) { WinHttpCloseHandle(m_conexao); m_conexao = nullptr; }
        if (m_sessao) { WinHttpCloseHandle(m_sessao); m_sessao = nullptr; }
    }

private:
    HINTERNET m_sessao = nullptr;
    HINTERNET m_conexao = nullptr;
    HINTERNET m_websocket = nullptr;
    std::mutex m_mutexEnvio;
};

static ConexaoWebSocket g_conexao;

// ---------------------------------------------------------------------------
// JSON minimo: as mensagens de controle sao curtas e de formato fixo.
// ---------------------------------------------------------------------------
static std::string ValorDeTexto(const std::string& json, const std::string& chave)
{
    const std::string alvo = "\"" + chave + "\"";
    size_t posicao = json.find(alvo);
    if (posicao == std::string::npos) return std::string();
    posicao = json.find(':', posicao + alvo.size());
    if (posicao == std::string::npos) return std::string();
    posicao = json.find('"', posicao);
    if (posicao == std::string::npos) return std::string();
    const size_t fim = json.find('"', posicao + 1);
    if (fim == std::string::npos) return std::string();
    return json.substr(posicao + 1, fim - posicao - 1);
}

// ---------------------------------------------------------------------------
// Captura
// ---------------------------------------------------------------------------
// CLoopbackCapture e uma RuntimeClass do WRL: precisa de Make<>, nao de new.
static ComPtr<CLoopbackCapture> g_captura;
static std::atomic<bool> g_capturando{ false };

static void PararCaptura()
{
    if (!g_capturando.exchange(false)) return;
    if (g_captura)
    {
        g_captura->StopCaptureAsync();
        g_captura.Reset();
    }
    LimparFila();
    std::wcout << L"[agente] captura parada\n";
}

// Qual programa fica de fora da captura. Vazio = o navegador de quem esta compartilhando,
// que e o padrao e evita o eco. Escolher outro serve para quem conversa por fora (Discord,
// por exemplo) e quer o resto do som do computador na transmissao.
static std::mutex g_mutexDaEscolha;
static std::wstring g_executavelExcluido;
static std::string g_ultimaFamilia;

static void EnviarListaDeAplicativos(const std::string& familia)
{
    std::wstring escolhidoAgora;
    {
        std::lock_guard<std::mutex> trava(g_mutexDaEscolha);
        escolhidoAgora = g_executavelExcluido;
    }
    const std::wstring navegador = ExecutavelDaFamilia(familia);
    if (escolhidoAgora.empty()) escolhidoAgora = navegador;

    const std::string corpo = ListaEmJson(AplicativosComAudioComNavegador(navegador), escolhidoAgora);
    // O corpo ja vem como objeto JSON; basta anunciar o evento junto.
    g_conexao.EnviarTexto("{\"evento\":\"aplicativos\"," + corpo.substr(1));
}

static std::wstring ExecutavelParaExcluir(const std::string& familia)
{
    std::lock_guard<std::mutex> trava(g_mutexDaEscolha);
    if (!g_executavelExcluido.empty()) return g_executavelExcluido;
    return ExecutavelDaFamilia(familia);
}

static void IniciarCaptura(const std::string& familia)
{
    PararCaptura();
    g_ultimaFamilia = familia;

    const std::wstring executavel = ExecutavelParaExcluir(familia);
    if (executavel.empty())
    {
        g_conexao.EnviarTexto("{\"evento\":\"erro\",\"mensagem\":\"navegador desconhecido\"}");
        return;
    }

    const DWORD pid = ProcessoRaizDe(executavel);
    if (!pid)
    {
        g_conexao.EnviarTexto("{\"evento\":\"erro\",\"mensagem\":\"programa escolhido nao esta aberto\"}");
        return;
    }

    DefinirDestinoPcm(EnfileirarPcm);
    g_captura = Make<CLoopbackCapture>();
    if (!g_captura)
    {
        g_conexao.EnviarTexto("{\"evento\":\"erro\",\"mensagem\":\"falha ao criar a captura\"}");
        return;
    }
    // false = excluir a arvore de processos indicada (todo o som, menos o navegador).
    const HRESULT hr = g_captura->StartCaptureAsync(pid, false, nullptr);
    if (FAILED(hr))
    {
        g_captura.Reset();
        g_conexao.EnviarTexto("{\"evento\":\"erro\",\"mensagem\":\"falha ao iniciar a captura\"}");
        std::wcout << L"[agente] falha ao iniciar a captura: 0x" << std::hex << hr << std::dec << L"\n";
        return;
    }

    g_capturando = true;
    g_conexao.EnviarTexto("{\"evento\":\"capturando\",\"excluindo\":\""
                          + EscaparJson(ParaUtf8(executavel)) + "\"}");
    std::wcout << L"[agente] capturando o audio do sistema, excluindo o processo " << pid
               << L" (" << executavel << L") e seus filhos\n";
}

// ---------------------------------------------------------------------------
// Servidor WebSocket local (so 127.0.0.1).
//
// O audio do sistema fazia um desvio absurdo: saia daqui, atravessava a internet ate o
// servidor da sala e voltava para o navegador desta MESMA maquina. Duas travessias do
// tunel para percorrer meio milimetro de placa de rede -- enquanto o video, que vai
// direto P2P, chegava muito na frente. Era essa a origem do audio atrasado.
//
// Agora o agente tambem escuta no loopback e entrega o PCM direto ao navegador ao lado.
// O caminho pelo servidor continua existindo como reserva, para quando o navegador nao
// conseguir abrir a conexao local.
//
// Escutar em 127.0.0.1 nao exige abrir porta no roteador nem excecao de firewall: o
// trafego de loopback nao passa por nenhum dos dois.
// ---------------------------------------------------------------------------
static SOCKET g_escutaLocal = INVALID_SOCKET;
static std::atomic<SOCKET> g_navegadorLocal{ INVALID_SOCKET };
static unsigned short g_portaLocal = 0;
static std::string g_tokenEsperado;

static std::string Base64(const BYTE* dados, DWORD bytes)
{
    DWORD tamanho = 0;
    if (!CryptBinaryToStringA(dados, bytes, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, nullptr, &tamanho)) return std::string();
    std::string saida(tamanho, '\0');
    if (!CryptBinaryToStringA(dados, bytes, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, saida.data(), &tamanho)) return std::string();
    saida.resize(strlen(saida.c_str()));
    return saida;
}

static bool Sha1(const std::string& entrada, BYTE saida[20])
{
    BCRYPT_ALG_HANDLE alg = nullptr;
    if (BCryptOpenAlgorithmProvider(&alg, BCRYPT_SHA1_ALGORITHM, nullptr, 0) != 0) return false;
    BCRYPT_HASH_HANDLE hash = nullptr;
    const bool ok = BCryptCreateHash(alg, &hash, nullptr, 0, nullptr, 0, 0) == 0
        && BCryptHashData(hash, (PUCHAR)entrada.data(), (ULONG)entrada.size(), 0) == 0
        && BCryptFinishHash(hash, saida, 20, 0) == 0;
    if (hash) BCryptDestroyHash(hash);
    BCryptCloseAlgorithmProvider(alg, 0);
    return ok;
}

static bool EnviarTudo(SOCKET s, const BYTE* dados, size_t bytes)
{
    size_t enviados = 0;
    while (enviados < bytes)
    {
        const int n = send(s, reinterpret_cast<const char*>(dados + enviados), static_cast<int>(bytes - enviados), 0);
        if (n <= 0) return false;
        enviados += static_cast<size_t>(n);
    }
    return true;
}

// Quadro do servidor para o cliente: nunca mascarado, sempre completo (FIN=1).
static bool EnviarQuadroBinario(SOCKET s, const BYTE* dados, size_t bytes)
{
    BYTE cabecalho[10];
    size_t tamanhoCabecalho = 0;
    cabecalho[tamanhoCabecalho++] = 0x82;  // FIN + opcode binario
    if (bytes < 126)
    {
        cabecalho[tamanhoCabecalho++] = static_cast<BYTE>(bytes);
    }
    else if (bytes <= 0xFFFF)
    {
        cabecalho[tamanhoCabecalho++] = 126;
        cabecalho[tamanhoCabecalho++] = static_cast<BYTE>((bytes >> 8) & 0xFF);
        cabecalho[tamanhoCabecalho++] = static_cast<BYTE>(bytes & 0xFF);
    }
    else
    {
        cabecalho[tamanhoCabecalho++] = 127;
        for (int i = 7; i >= 0; i--) cabecalho[tamanhoCabecalho++] = static_cast<BYTE>((bytes >> (i * 8)) & 0xFF);
    }
    return EnviarTudo(s, cabecalho, tamanhoCabecalho) && EnviarTudo(s, dados, bytes);
}

static std::string CabecalhoDe(const std::string& pedido, const std::string& nome)
{
    // Comparacao sem diferenciar maiusculas: o navegador escolhe a grafia que quiser.
    std::string alvoMinusculo = nome;
    for (auto& c : alvoMinusculo) c = static_cast<char>(tolower(c));
    std::string pedidoMinusculo = pedido;
    for (auto& c : pedidoMinusculo) c = static_cast<char>(tolower(c));

    size_t posicao = pedidoMinusculo.find(alvoMinusculo);
    if (posicao == std::string::npos) return std::string();
    posicao = pedido.find(':', posicao);
    if (posicao == std::string::npos) return std::string();
    size_t fim = pedido.find('\r', posicao);
    if (fim == std::string::npos) return std::string();
    std::string valor = pedido.substr(posicao + 1, fim - posicao - 1);
    while (!valor.empty() && (valor.front() == ' ' || valor.front() == '\t')) valor.erase(valor.begin());
    return valor;
}

// O token e a unica coisa que impede outra pagina aberta no computador de pedir o audio
// do sistema da pessoa. Ele e o mesmo da sala: so quem tem o par navegador/agente o
// conhece.
static bool TokenConfere(const std::string& pedido)
{
    const size_t inicio = pedido.find("token=");
    if (inicio == std::string::npos) return false;
    size_t fim = inicio + 6;
    while (fim < pedido.size() && (isalnum(static_cast<unsigned char>(pedido[fim])) != 0)) fim++;
    const std::string recebido = pedido.substr(inicio + 6, fim - inicio - 6);
    if (recebido.empty() || recebido.size() != g_tokenEsperado.size()) return false;
    return _stricmp(recebido.c_str(), g_tokenEsperado.c_str()) == 0;
}

static bool ApertoDeMao(SOCKET cliente)
{
    std::string pedido;
    char buffer[1024];
    while (pedido.find("\r\n\r\n") == std::string::npos)
    {
        if (pedido.size() > 8192) return false;  // cabecalho absurdo: nao e o nosso navegador
        const int n = recv(cliente, buffer, sizeof(buffer), 0);
        if (n <= 0) return false;
        pedido.append(buffer, n);
    }

    if (!TokenConfere(pedido)) return false;
    const std::string chave = CabecalhoDe(pedido, "sec-websocket-key");
    if (chave.empty()) return false;

    BYTE digest[20];
    if (!Sha1(chave + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11", digest)) return false;

    const std::string resposta =
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Accept: " + Base64(digest, 20) + "\r\n\r\n";
    return EnviarTudo(cliente, reinterpret_cast<const BYTE*>(resposta.data()), resposta.size());
}

static void FecharNavegadorLocal()
{
    const SOCKET antigo = g_navegadorLocal.exchange(INVALID_SOCKET);
    if (antigo != INVALID_SOCKET) closesocket(antigo);
}

static void ThreadDeEscutaLocal()
{
    while (!g_encerrando)
    {
        sockaddr_in de{};
        int tamanho = sizeof(de);
        const SOCKET cliente = accept(g_escutaLocal, reinterpret_cast<sockaddr*>(&de), &tamanho);
        if (cliente == INVALID_SOCKET) { if (g_encerrando) return; continue; }

        if (!ApertoDeMao(cliente)) { closesocket(cliente); continue; }

        // Sem Nagle: blocos de audio sao pequenos e frequentes, e esperar para agrupar
        // seria justamente devolver o atraso que viemos eliminar.
        int ligado = 1;
        setsockopt(cliente, IPPROTO_TCP, TCP_NODELAY, reinterpret_cast<const char*>(&ligado), sizeof(ligado));

        const SOCKET antigo = g_navegadorLocal.exchange(cliente);  // recarregar a pagina troca o cliente
        if (antigo != INVALID_SOCKET) closesocket(antigo);
        std::wcout << L"[agente] navegador conectado direto, sem passar pelo servidor.\n";
    }
}

// Porta 0 = o Windows escolhe uma livre. O navegador descobre qual foi pelo proprio
// servidor da sala, entao nao existe porta fixa para dar conflito com outro programa.
static bool IniciarServidorLocal()
{
    WSADATA wsa{};
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return false;

    g_escutaLocal = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (g_escutaLocal == INVALID_SOCKET) return false;

    sockaddr_in endereco{};
    endereco.sin_family = AF_INET;
    endereco.sin_port = 0;
    inet_pton(AF_INET, "127.0.0.1", &endereco.sin_addr);  // so loopback: nunca exposto na rede
    if (bind(g_escutaLocal, reinterpret_cast<sockaddr*>(&endereco), sizeof(endereco)) != 0) return false;
    if (listen(g_escutaLocal, 4) != 0) return false;

    sockaddr_in atribuido{};
    int tamanho = sizeof(atribuido);
    if (getsockname(g_escutaLocal, reinterpret_cast<sockaddr*>(&atribuido), &tamanho) != 0) return false;
    g_portaLocal = ntohs(atribuido.sin_port);
    return true;
}

// ---------------------------------------------------------------------------
// Envio do PCM: prefere o navegador local; o servidor da sala e a reserva.
static void ThreadDeEnvio()
{
    while (!g_encerrando)
    {
        std::vector<BYTE> bloco;
        {
            std::unique_lock<std::mutex> trava(g_mutexFila);
            g_filaTemDados.wait_for(trava, std::chrono::milliseconds(200),
                [] { return !g_fila.empty() || g_encerrando; });
            if (g_encerrando) return;
            if (g_fila.empty()) continue;
            bloco = std::move(g_fila.front());
            g_fila.pop_front();
        }
        if (bloco.empty()) continue;

        // Caminho curto: o navegador esta do lado, no mesmo computador. Se ele cair, o
        // bloco seguinte ja volta a sair pelo servidor sem perder a transmissao.
        const SOCKET local = g_navegadorLocal.load();
        if (local != INVALID_SOCKET)
        {
            if (EnviarQuadroBinario(local, bloco.data(), bloco.size())) continue;
            FecharNavegadorLocal();
            std::wcout << L"[agente] conexao direta caiu; voltando a enviar pelo servidor.\n";
        }
        g_conexao.EnviarBinario(bloco.data(), static_cast<DWORD>(bloco.size()));
    }
}

// ---------------------------------------------------------------------------
// Instancia unica, com substituicao pela mais nova.
//
// O endereco do servidor vive no NOME do executavel. Quando ele muda, a pessoa baixa o
// agente de novo -- e ficaria com dois agentes disputando o mesmo token: o servidor
// derruba a conexao antiga, o agente antigo reconecta e derruba a nova, sem parar.
//
// Por isso o agente que acaba de abrir avisa o antigo para sair e assume o lugar dele.
// A pessoa so precisa dar um duplo clique no arquivo novo; nao ha o que fechar antes.
// ---------------------------------------------------------------------------
// Nomes sem prefixo ficam no namespace da sessao atual, que e exatamente o alcance que
// queremos: um agente por usuario logado, sem exigir privilegio para criar objeto global.
static const wchar_t* kNomeDoMutex = L"AgenteAudioSala.Instancia";
static const wchar_t* kNomeDoEvento = L"AgenteAudioSala.Sair";

static HANDLE g_mutexInstancia = nullptr;
static HANDLE g_eventoDeSaida = nullptr;

// Devolve false se um agente antigo se recusar a sair (nesse caso nao vale a pena
// continuar: os dois ficariam brigando pelo mesmo token).
static bool AssumirInstanciaUnica()
{
    g_eventoDeSaida = CreateEventW(nullptr, FALSE, FALSE, kNomeDoEvento);
    g_mutexInstancia = CreateMutexW(nullptr, TRUE, kNomeDoMutex);
    if (!g_mutexInstancia) return true;  // sem controle de instancia, mas da para rodar

    if (GetLastError() != ERROR_ALREADY_EXISTS) return true;  // somos o unico agente

    std::wcout << L"[agente] ja havia um agente aberto. Pedindo para ele sair...\n";
    if (g_eventoDeSaida) SetEvent(g_eventoDeSaida);

    // Ao terminar, o processo antigo solta o mutex; se ele morrer sem soltar, o Windows
    // devolve WAIT_ABANDONED e a posse passa para nos do mesmo jeito.
    const DWORD espera = WaitForSingleObject(g_mutexInstancia, 10000);
    if (espera != WAIT_OBJECT_0 && espera != WAIT_ABANDONED)
    {
        std::wcout << L"\nO agente que ja estava aberto nao respondeu.\n"
                   << L"Feche a janela dele e abra este de novo.\n\n"
                   << L"Pressione Enter para sair...";
        std::wcin.get();
        return false;
    }
    return true;
}

static void LiberarInstanciaUnica()
{
    if (g_mutexInstancia) { ReleaseMutex(g_mutexInstancia); CloseHandle(g_mutexInstancia); g_mutexInstancia = nullptr; }
    if (g_eventoDeSaida) { CloseHandle(g_eventoDeSaida); g_eventoDeSaida = nullptr; }
}

// Fica esperando o pedido de saida vindo de uma instancia mais nova.
static void ThreadDeSubstituicao()
{
    if (!g_eventoDeSaida) return;
    WaitForSingleObject(g_eventoDeSaida, INFINITE);
    if (g_encerrando) return;

    std::wcout << L"\n[agente] um agente mais novo foi aberto. Encerrando este.\n";
    g_encerrando = true;
    // Fechar o handle e a forma que a WinHTTP oferece para abortar um Receber() que esta
    // bloqueado em outra thread.
    g_conexao.Fechar();
    g_filaTemDados.notify_all();
}

// Espera em pedacos curtos para que um pedido de saida nao fique preso atras do backoff.
static void EsperarInterrompivel(int segundos)
{
    for (int i = 0; i < segundos * 4 && !g_encerrando; i++)
        std::this_thread::sleep_for(std::chrono::milliseconds(250));
}

int wmain(int argc, wchar_t* argv[])
{
    SetConsoleTitleW(L"Agente de audio - Sala compartilhada");
    // Sem buffer: o status precisa aparecer na hora, inclusive quando a saida e
    // redirecionada para um arquivo em vez de ir para a janela do console.
    std::wcout.setf(std::ios::unitbuf);
    std::wcout << L"=== Agente de audio da sala ===\n";

    // Prioridade: argumento na linha de comando > nome do arquivo > config salva antes.
    std::string url;
    if (argc >= 2)
    {
        char buffer[1024]{};
        WideCharToMultiByte(CP_UTF8, 0, argv[1], -1, buffer, sizeof(buffer) - 1, nullptr, nullptr);
        url = buffer;
    }
    if (url.empty()) url = LerConfiguracaoDoNome();
    if (url.empty()) url = LerConfigSalva();

    if (url.rfind("ws://", 0) != 0 && url.rfind("wss://", 0) != 0)
    {
        std::wcout << L"\nEste agente nao veio configurado.\n"
                   << L"Baixe-o pelo botao da sala (ele ja vem pronto, nao renomeie o arquivo)\n"
                   << L"ou informe a URL manualmente:\n"
                   << L"  AgenteAudio.exe wss://seu-endereco/agente?token=SEU_TOKEN\n\n"
                   << L"Pressione Enter para sair...";
        std::wcin.get();
        return 1;
    }

    EnderecoWs endereco;
    if (!AnalisarUrl(url, endereco))
    {
        std::wcout << L"URL invalida na configuracao.\nPressione Enter para sair...";
        std::wcin.get();
        return 1;
    }

    if (!AssumirInstanciaUnica()) return 1;

    // O token da URL e o mesmo que o navegador vai apresentar na conexao local.
    const size_t posToken = url.find("token=");
    if (posToken != std::string::npos) g_tokenEsperado = url.substr(posToken + 6);

    if (IniciarServidorLocal())
        std::wcout << L"Conexao direta com o navegador: 127.0.0.1:" << g_portaLocal << L"\n";
    else
        std::wcout << L"Sem conexao direta com o navegador; o audio vai pelo servidor.\n";

    std::wcout << L"Servidor: " << endereco.host << L"\n";
    if (FAILED(MFStartup(MF_VERSION, MFSTARTUP_LITE)))
    {
        std::wcout << L"Nao foi possivel inicializar o Media Foundation.\nPressione Enter para sair...";
        std::wcin.get();
        LiberarInstanciaUnica();
        return 1;
    }

    std::thread envio(ThreadDeEnvio);
    std::thread substituicao(ThreadDeSubstituicao);
    substituicao.detach();
    if (g_escutaLocal != INVALID_SOCKET) { std::thread escuta(ThreadDeEscutaLocal); escuta.detach(); }

    int tentativa = 0;
    bool jaAvisouDoEndereco = false;
    while (!g_encerrando)
    {
        std::wcout << L"[agente] conectando...\n";
        if (!g_conexao.Conectar(endereco))
        {
            g_conexao.Fechar();
            tentativa++;

            // O agente nao tem como descobrir sozinho um endereco novo: ele so conhece o
            // que veio no nome do arquivo. Entao, em vez de tentar em silencio para
            // sempre, ele diz o que a pessoa precisa fazer.
            if (tentativa == 5 && !jaAvisouDoEndereco)
            {
                jaAvisouDoEndereco = true;
                std::wcout << L"\n  --------------------------------------------------------\n"
                           << L"  Nao estou conseguindo falar com " << endereco.host << L"\n"
                           << L"  Ou o servidor esta desligado, ou o endereco dele mudou.\n"
                           << L"  Se mudou, baixe o agente de novo pelo botao da sala e\n"
                           << L"  abra o arquivo novo -- este aqui se fecha sozinho.\n"
                           << L"  --------------------------------------------------------\n\n";
            }

            const int espera = (tentativa < 5) ? 2 : (tentativa < 15 ? 10 : 30);
            std::wcout << L"[agente] sem conexao. Nova tentativa em " << espera << L"s\n";
            EsperarInterrompivel(espera);
            continue;
        }

        tentativa = 0;
        jaAvisouDoEndereco = false;
        std::wcout << L"[agente] conectado. Pode compartilhar a tela pelo navegador.\n";
        g_conexao.EnviarTexto("{\"evento\":\"pronto\"}");
        // O navegador nao adivinha a porta: ele a recebe pelo servidor da sala, que ja
        // sabe qual navegador corresponde a este token.
        if (g_portaLocal)
            g_conexao.EnviarTexto("{\"evento\":\"porta-local\",\"porta\":" + std::to_string(g_portaLocal) + "}");
        SalvarConfig(url);  // permite reabrir mesmo se o arquivo for renomeado depois

        std::string mensagem;
        while (g_conexao.Receber(mensagem))
        {
            const std::string acao = ValorDeTexto(mensagem, "acao");
            if (acao == "iniciar") IniciarCaptura(ValorDeTexto(mensagem, "familia"));
            else if (acao == "parar") PararCaptura();
            else if (acao == "listar-aplicativos") EnviarListaDeAplicativos(ValorDeTexto(mensagem, "familia"));
            else if (acao == "excluir")
            {
                // Troca ao vivo: se ja estiver capturando, a captura e refeita na hora com
                // o novo alvo. E o que permite passar o microfone do Discord para o
                // navegador no meio da conversa, sem parar o compartilhamento.
                {
                    std::lock_guard<std::mutex> trava(g_mutexDaEscolha);
                    g_executavelExcluido = ParaWide(ValorDeTexto(mensagem, "executavel"));
                }
                if (g_capturando) IniciarCaptura(g_ultimaFamilia);
                EnviarListaDeAplicativos(ValorDeTexto(mensagem, "familia"));
            }
        }

        PararCaptura();
        g_conexao.Fechar();
        if (g_encerrando) break;
        std::wcout << L"[agente] conexao encerrada. Reconectando...\n";
        EsperarInterrompivel(2);
    }

    g_encerrando = true;
    g_filaTemDados.notify_all();
    if (envio.joinable()) envio.join();
    FecharNavegadorLocal();
    if (g_escutaLocal != INVALID_SOCKET) { closesocket(g_escutaLocal); WSACleanup(); }
    MFShutdown();
    LiberarInstanciaUnica();
    return 0;
}
