<#
  Cria as listas do Testing Center num site do SharePoint, com os tipos de coluna certos.

  As colunas NÃO estão escritas aqui: vêm de ferramentas/listas-schema.json, o mesmo arquivo
  que o gerador dos CSVs lê. Antes cada um mantinha a própria lista, e bastou traduzir a
  plataforma para inglês para o script criar "Nome" e o CSV trazer "Name" — a carga só falharia
  na hora de colar. tests/listas.test.js falha se os dois divergirem de novo.

  Alternativa a este script: criar cada lista pela interface, com "Nova lista > Do CSV",
  usando os arquivos de dist/listas/. É mais simples e não exige instalar nada, mas o
  SharePoint adivinha os tipos de coluna e costuma criar tudo como texto — datas, números e
  moeda precisam ser corrigidos depois, à mão.

  Requisitos deste script: módulo PnP.PowerShell e permissão de proprietário do site.
      Install-Module PnP.PowerShell -Scope CurrentUser

  Uso:
      .\provisionar-listas.ps1 -Site "https://empresa.sharepoint.com/sites/CentroDeTestes"
      .\provisionar-listas.ps1 -Site "..." -Conferir     # só compara, não cria nada

  O script é idempotente: rodar de novo não duplica listas nem colunas, e reclama quando uma
  coluna existente está com o tipo errado — o caso que mais dá trabalho para achar depois,
  porque a lista carrega e só as contas saem erradas.

  Ele cria a estrutura vazia; os dados entram depois, colando os CSVs na visualização em
  grade de cada lista.
#>

param(
  [Parameter(Mandatory = $true)][string]$Site,
  [switch]$Conferir
)

$ErrorActionPreference = 'Stop'

$caminhoEsquema = Join-Path $PSScriptRoot 'listas-schema.json'
if (-not (Test-Path $caminhoEsquema)) {
  throw "Esquema não encontrado em $caminhoEsquema"
}
$esquema = Get-Content $caminhoEsquema -Raw -Encoding UTF8 | ConvertFrom-Json

Connect-PnPOnline -Url $Site -Interactive

$criadas = 0
$colunasNovas = 0
$divergencias = @()

foreach ($nomeLista in $esquema.PSObject.Properties.Name) {
  # As chaves iniciadas por _ são documentação do esquema, não listas.
  if ($nomeLista.StartsWith('_')) { continue }

  $colunas = $esquema.$nomeLista

  $existente = Get-PnPList -Identity $nomeLista -ErrorAction SilentlyContinue
  if ($null -eq $existente) {
    if ($Conferir) {
      Write-Host "FALTA lista $nomeLista" -ForegroundColor Yellow
      $divergencias += "lista $nomeLista não existe"
      continue
    }
    Write-Host "Criando lista $nomeLista"
    New-PnPList -Title $nomeLista -Template GenericList -EnableVersioning | Out-Null
    $criadas++
  } else {
    Write-Host "Lista $nomeLista já existe"
  }

  foreach ($coluna in $colunas) {
    $jaTem = Get-PnPField -List $nomeLista -Identity $coluna.nome -ErrorAction SilentlyContinue

    if ($null -ne $jaTem) {
      # Coluna certa com tipo errado carrega dado e estraga conta: vale avisar alto.
      $tipoAtual = $jaTem.TypeAsString
      if ($tipoAtual -ne $coluna.tipo) {
        Write-Host "  ! $($coluna.nome): esperado $($coluna.tipo), encontrado $tipoAtual" -ForegroundColor Red
        $divergencias += "$nomeLista.$($coluna.nome): $tipoAtual em vez de $($coluna.tipo)"
      }
      continue
    }

    if ($Conferir) {
      Write-Host "  FALTA coluna $($coluna.nome) ($($coluna.tipo))" -ForegroundColor Yellow
      $divergencias += "$nomeLista.$($coluna.nome) não existe"
      continue
    }

    Write-Host "  + coluna $($coluna.nome) ($($coluna.tipo))"
    if ($coluna.tipo -eq 'Choice') {
      # Vazio é opção legítima em algumas colunas (resultado da última calibração, por
      # exemplo, que só existe depois do primeiro certificado) — mas não vira escolha.
      $opcoes = @($coluna.opcoes | Where-Object { $_ -ne '' })
      Add-PnPField -List $nomeLista -DisplayName $coluna.nome -InternalName $coluna.nome `
        -Type Choice -Choices $opcoes -AddToDefaultView | Out-Null
    } else {
      Add-PnPField -List $nomeLista -DisplayName $coluna.nome -InternalName $coluna.nome `
        -Type $coluna.tipo -AddToDefaultView | Out-Null

      # DateTime nasce com hora, e toda data daqui é data de calendário: validade de
      # calibração, prazo, chegada de amostra. Sem isto a lista mostra "14/05/2026 00:00"
      # em 20 colunas, e o fuso do site ainda pode empurrar para o dia anterior.
      if ($coluna.tipo -eq 'DateTime') {
        Set-PnPField -List $nomeLista -Identity $coluna.nome `
          -Values @{ DisplayFormat = 0 } | Out-Null
      }
    }
    $colunasNovas++
  }
}

Write-Host ''
if ($Conferir) {
  if ($divergencias.Count -eq 0) {
    Write-Host 'Site conferido: as listas batem com o esquema.' -ForegroundColor Green
  } else {
    Write-Host "$($divergencias.Count) divergência(s):" -ForegroundColor Yellow
    $divergencias | ForEach-Object { Write-Host "  - $_" }
  }
  return
}

Write-Host "Pronto: $criadas lista(s) criada(s), $colunasNovas coluna(s) acrescentada(s)."
if ($divergencias.Count -gt 0) {
  Write-Host "$($divergencias.Count) coluna(s) com tipo diferente do esperado:" -ForegroundColor Red
  $divergencias | ForEach-Object { Write-Host "  - $_" }
  Write-Host 'O SharePoint não converte tipo de coluna com dado dentro: apague a coluna e rode de novo.'
}
Write-Host ''
Write-Host 'A coluna Title guarda o código do registro (TP-GM-01, CLI-GM, COT-2026-0001).'
Write-Host 'Para carregar os dados: abra cada lista, mude para a visualização em grade e cole o'
Write-Host 'conteúdo do CSV correspondente de dist/listas/, na ordem em que o README lista.'
