$ErrorActionPreference = 'Stop'
$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) { throw 'Visual Studio Build Tools com C++ nao foi encontrado.' }
$vsDevCmd = Join-Path $vsPath 'Common7\Tools\VsDevCmd.bat'

# ApplicationLoopback.exe: captura de audio por processo usada pelo proprio servidor.
# AgenteAudio.exe: mesma captura, mas empacotada para rodar no PC de cada participante.
$projetos = @(
  (Join-Path $PSScriptRoot 'native\audio-helper\ApplicationLoopback.vcxproj'),
  (Join-Path $PSScriptRoot 'native\audio-agent\AgenteAudio.vcxproj')
)

foreach ($projeto in $projetos) {
  cmd /c "call `"$vsDevCmd`" -arch=x64 && msbuild `"$projeto`" /p:Configuration=Release /p:Platform=x64 /m /nologo /v:minimal"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
