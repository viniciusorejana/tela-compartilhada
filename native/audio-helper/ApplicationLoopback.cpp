// ApplicationLoopback.cpp : This file contains the 'main' function. Program execution begins and ends there.
//

#include <Windows.h>
#include <fcntl.h>
#include <iostream>
#include <io.h>
#include "LoopbackCapture.h"
#include "Aplicativos.h"
#include <string>

void usage()
{
    std::wcout <<
        L"Usage: ApplicationLoopback <pid> <includetree|excludetree> <outputfilename>\n"
        L"\n"
        L"<pid> is the process ID to capture or exclude from capture\n"
        L"includetree includes audio from that process and its child processes\n"
        L"excludetree includes audio from all processes except that process and its child processes\n"
        L"<outputfilename> is the WAV file to receive the captured audio (10 seconds)\n"
        L"\n"
        L"Examples:\n"
        L"\n"
        L"ApplicationLoopback 1234 includetree CapturedAudio.wav\n"
        L"\n"
        L"  Captures audio from process 1234 and its children.\n"
        L"\n"
        L"ApplicationLoopback 1234 excludetree CapturedAudio.wav\n"
        L"\n"
        L"  Captures audio from all processes except process 1234 and its children.\n";
}

int wmain(int argc, wchar_t* argv[])
{
    // Modo listagem: imprime em JSON os programas com audio neste computador. E o que
    // permite escolher qual nao transmitir tambem para quem abre a sala na propria maquina
    // do servidor, sem precisar baixar o agente.
    //   ApplicationLoopback.exe --listar [chrome.exe]
    if (argc >= 2 && wcscmp(argv[1], L"--listar") == 0)
    {
        CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        const std::wstring navegador = (argc >= 3) ? argv[2] : L"";
        const auto lista = AplicativosComAudioComNavegador(navegador);
        const std::string json = ListaEmJson(lista, navegador);
        fwrite(json.data(), 1, json.size(), stdout);
        CoUninitialize();
        return 0;
    }

    // Exclusao por NOME do programa: o helper mesmo descobre a raiz da arvore. Antes quem
    // descobria era o servidor, por PowerShell, o que exigia montar um filtro com texto
    // vindo de fora -- agora nao passa mais nome nenhum para um shell.
    //   ApplicationLoopback.exe --excluir chrome.exe
    if (argc >= 3 && wcscmp(argv[1], L"--excluir") == 0)
    {
        const DWORD raiz = ProcessoRaizDe(argv[2]);
        if (!raiz)
        {
            fwprintf(stderr, L"programa nao encontrado: %s\n", argv[2]);
            return 2;
        }
        _setmode(_fileno(stdout), _O_BINARY);
        CLoopbackCapture captura;
        HRESULT hr = captura.StartCaptureAsync(raiz, false, nullptr);
        if (FAILED(hr)) { fwprintf(stderr, L"falha ao iniciar a captura: 0x%08x\n", hr); return 3; }
        // Mesma espera do modo antigo: quem encerra e o servidor, matando o processo.
        // (stdin vem fechado no spawn, entao esperar por ele terminaria na hora.)
        Sleep(INFINITE);
        return 0;
    }

    if (argc != 3)
    {
        usage();
        return 0;
    }

    DWORD processId = wcstoul(argv[1], nullptr, 0);
    if (processId == 0)
    {
        usage();
        return 0;
    }

    _setmode(_fileno(stdout), _O_BINARY);
    const bool includeProcessTree = wcscmp(argv[2], L"include") == 0;
    if (!includeProcessTree && wcscmp(argv[2], L"exclude") != 0)
    {
        usage();
        return 1;
    }

    CLoopbackCapture loopbackCapture;
    HRESULT hr = loopbackCapture.StartCaptureAsync(processId, includeProcessTree, nullptr);
    if (FAILED(hr))
    {
        wil::unique_hlocal_string message;
        FormatMessageW(FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS | FORMAT_MESSAGE_ALLOCATE_BUFFER, nullptr, hr,
            MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT), (PWSTR)&message, 0, nullptr);
        std::wcout << L"Failed to start capture\n0x" << std::hex << hr << L": " << message.get() << L"\n";
    }
    else
    {
        Sleep(INFINITE);
    }

    return 0;
}
