#include "Aplicativos.h"

#include <mmdeviceapi.h>
#include <audiopolicy.h>
#include <tlhelp32.h>
#include <wrl/client.h>
#include <algorithm>
#include <map>

#pragma comment(lib, "version.lib")
#pragma comment(lib, "ole32.lib")

using Microsoft::WRL::ComPtr;

std::wstring NomeAmigavelDoProcesso(DWORD pid, const std::wstring& executavel)
{
    std::wstring caminho;
    HANDLE processo = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (processo)
    {
        wchar_t buffer[MAX_PATH] = L"";
        DWORD tamanho = MAX_PATH;
        if (QueryFullProcessImageNameW(processo, 0, buffer, &tamanho)) caminho = buffer;
        CloseHandle(processo);
    }

    if (!caminho.empty())
    {
        DWORD ignorado = 0;
        const DWORD bytes = GetFileVersionInfoSizeW(caminho.c_str(), &ignorado);
        if (bytes)
        {
            std::vector<BYTE> dados(bytes);
            if (GetFileVersionInfoW(caminho.c_str(), 0, bytes, dados.data()))
            {
                struct Idioma { WORD idioma; WORD pagina; };
                Idioma* idiomas = nullptr;
                UINT tamanhoIdiomas = 0;
                if (VerQueryValueW(dados.data(), L"\\VarFileInfo\\Translation",
                                   (void**)&idiomas, &tamanhoIdiomas) && tamanhoIdiomas >= sizeof(Idioma))
                {
                    wchar_t consulta[128];
                    swprintf_s(consulta, L"\\StringFileInfo\\%04x%04x\\FileDescription",
                               idiomas[0].idioma, idiomas[0].pagina);
                    wchar_t* descricao = nullptr;
                    UINT tamanhoDescricao = 0;
                    if (VerQueryValueW(dados.data(), consulta, (void**)&descricao, &tamanhoDescricao)
                        && descricao && *descricao)
                        return descricao;
                }
            }
        }
    }

    std::wstring nome = executavel;
    const size_t ponto = nome.rfind(L'.');
    if (ponto != std::wstring::npos) nome.erase(ponto);
    return nome;
}

DWORD ProcessoRaizDe(const std::wstring& executavel)
{
    if (executavel.empty()) return 0;

    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return 0;

    struct Item { DWORD pid; DWORD pai; };
    std::vector<Item> encontrados;

    PROCESSENTRY32W entrada{};
    entrada.dwSize = sizeof(entrada);
    if (Process32FirstW(snapshot, &entrada))
    {
        do
        {
            if (_wcsicmp(entrada.szExeFile, executavel.c_str()) == 0)
                encontrados.push_back({ entrada.th32ProcessID, entrada.th32ParentProcessID });
        } while (Process32NextW(snapshot, &entrada));
    }
    CloseHandle(snapshot);
    if (encontrados.empty()) return 0;

    // Raiz = processo cujo pai nao e do mesmo programa. Havendo mais de uma instancia,
    // fica com a que tem mais filhos diretos (a janela principal).
    DWORD melhorPid = encontrados[0].pid;
    int melhorFilhos = -1;
    for (const auto& item : encontrados)
    {
        bool paiEhDoMesmo = false;
        for (const auto& outro : encontrados)
            if (outro.pid == item.pai) { paiEhDoMesmo = true; break; }
        if (paiEhDoMesmo) continue;

        int filhos = 0;
        for (const auto& outro : encontrados)
            if (outro.pai == item.pid) filhos++;
        if (filhos > melhorFilhos) { melhorFilhos = filhos; melhorPid = item.pid; }
    }
    return melhorPid;
}

static std::wstring EmMinusculas(std::wstring texto)
{
    for (auto& c : texto) c = towlower(c);
    return texto;
}

std::vector<AplicativoComAudio> AplicativosComAudio()
{
    std::vector<AplicativoComAudio> lista;
    std::map<std::wstring, size_t> porExecutavel;

    ComPtr<IMMDeviceEnumerator> enumerador;
    if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
        IID_PPV_ARGS(&enumerador)))) return lista;

    ComPtr<IMMDevice> dispositivo;
    if (FAILED(enumerador->GetDefaultAudioEndpoint(eRender, eConsole, &dispositivo))) return lista;

    ComPtr<IAudioSessionManager2> gerente;
    if (FAILED(dispositivo->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr,
        (void**)gerente.GetAddressOf()))) return lista;

    ComPtr<IAudioSessionEnumerator> sessoes;
    if (FAILED(gerente->GetSessionEnumerator(&sessoes))) return lista;

    int total = 0;
    if (FAILED(sessoes->GetCount(&total))) return lista;

    const DWORD meuPid = GetCurrentProcessId();
    for (int i = 0; i < total; i++)
    {
        ComPtr<IAudioSessionControl> controle;
        if (FAILED(sessoes->GetSession(i, &controle))) continue;
        ComPtr<IAudioSessionControl2> controle2;
        if (FAILED(controle.As(&controle2))) continue;

        // Sons do proprio Windows: nao tem processo dono que faca sentido escolher.
        if (controle2->IsSystemSoundsSession() == S_OK) continue;

        DWORD pid = 0;
        if (FAILED(controle2->GetProcessId(&pid)) || !pid || pid == meuPid) continue;

        wchar_t caminho[MAX_PATH] = L"";
        HANDLE processo = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if (!processo) continue;
        DWORD tamanho = MAX_PATH;
        const bool obteve = QueryFullProcessImageNameW(processo, 0, caminho, &tamanho) != 0;
        CloseHandle(processo);
        if (!obteve) continue;

        const wchar_t* barra = wcsrchr(caminho, L'\\');
        std::wstring executavel = barra ? barra + 1 : caminho;
        if (executavel.empty()) continue;
        // Motor de audio do proprio Windows e o nosso helper: nao sao escolhas validas.
        if (_wcsicmp(executavel.c_str(), L"audiodg.exe") == 0) continue;
        if (_wcsicmp(executavel.c_str(), L"ApplicationLoopback.exe") == 0) continue;
        if (_wcsnicmp(executavel.c_str(), L"AgenteAudio", 11) == 0) continue;

        AudioSessionState estado = AudioSessionStateInactive;
        controle->GetState(&estado);
        const bool tocando = (estado == AudioSessionStateActive);

        const std::wstring chave = EmMinusculas(executavel);
        auto achado = porExecutavel.find(chave);
        if (achado != porExecutavel.end())
        {
            // Mesmo programa em outro processo: continua sendo uma linha so.
            lista[achado->second].tocando = lista[achado->second].tocando || tocando;
            continue;
        }
        porExecutavel[chave] = lista.size();
        lista.push_back({ executavel, NomeAmigavelDoProcesso(pid, executavel), tocando, false });
    }
    return lista;
}

std::vector<AplicativoComAudio> AplicativosComAudioComNavegador(const std::wstring& navegador)
{
    std::vector<AplicativoComAudio> lista = AplicativosComAudio();
    if (navegador.empty()) return lista;

    const DWORD raiz = ProcessoRaizDe(navegador);
    if (!raiz) return lista;   // navegador nem esta aberto

    const std::wstring chave = EmMinusculas(navegador);
    auto achado = std::find_if(lista.begin(), lista.end(),
        [&](const AplicativoComAudio& a) { return EmMinusculas(a.executavel) == chave; });

    if (achado != lista.end())
    {
        achado->padrao = true;
        std::rotate(lista.begin(), achado, achado + 1);   // o padrao vem primeiro
    }
    else
    {
        lista.insert(lista.begin(),
            { navegador, NomeAmigavelDoProcesso(raiz, navegador), false, true });
    }
    return lista;
}

std::string ParaUtf8(const std::wstring& texto)
{
    if (texto.empty()) return {};
    const int bytes = WideCharToMultiByte(CP_UTF8, 0, texto.c_str(), -1, nullptr, 0, nullptr, nullptr);
    if (bytes <= 1) return {};
    std::string saida(static_cast<size_t>(bytes) - 1, '\0');
    WideCharToMultiByte(CP_UTF8, 0, texto.c_str(), -1, &saida[0], bytes, nullptr, nullptr);
    return saida;
}

std::string EscaparJson(const std::string& texto)
{
    std::string saida;
    for (const char c : texto)
    {
        if (c == '"' || c == '\\') { saida += '\\'; saida += c; }
        else if (static_cast<unsigned char>(c) < 0x20) saida += ' ';
        else saida += c;
    }
    return saida;
}

std::string ListaEmJson(const std::vector<AplicativoComAudio>& lista, const std::wstring& atual)
{
    std::string json = "{\"atual\":\"" + EscaparJson(ParaUtf8(atual)) + "\",\"lista\":[";
    bool primeiro = true;
    for (const auto& app : lista)
    {
        if (!primeiro) json += ",";
        primeiro = false;
        json += "{\"executavel\":\"" + EscaparJson(ParaUtf8(app.executavel)) + "\"";
        json += ",\"nome\":\"" + EscaparJson(ParaUtf8(app.nome)) + "\"";
        json += ",\"tocando\":" + std::string(app.tocando ? "true" : "false");
        json += ",\"padrao\":" + std::string(app.padrao ? "true" : "false") + "}";
    }
    json += "]}";
    return json;
}
