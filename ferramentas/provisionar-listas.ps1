<#
  Cria as listas do Testing Center num site do SharePoint, com os tipos de coluna certos.

  Alternativa a este script: criar cada lista pela interface, com "Nova lista > Do CSV",
  usando os arquivos de dist/listas/. É mais simples e não exige instalar nada, mas o
  SharePoint adivinha os tipos de coluna e costuma criar tudo como texto — datas e
  números precisam ser corrigidos depois, à mão.

  Requisitos deste script: módulo PnP.PowerShell e permissão de proprietário do site.
      Install-Module PnP.PowerShell -Scope CurrentUser

  Uso:
      .\provisionar-listas.ps1 -Site "https://empresa.sharepoint.com/sites/CentroDeTestes"

  O script é idempotente: rodar de novo não duplica listas nem colunas.
  Ele cria a estrutura vazia; os dados entram depois, colando os CSVs na visualização
  em grade de cada lista.
#>

param(
  [Parameter(Mandatory = $true)][string]$Site
)

$ErrorActionPreference = 'Stop'

Connect-PnPOnline -Url $Site -Interactive

# Cada coluna é: nome interno, tipo, e (para Choice) as opções.
$listas = [ordered]@{
  # Parâmetros do centro de testes. Title = nome do parâmetro (HourlyRate).
  'TC_Parametros' = @(
    @{ Nome = 'Valor';    Tipo = 'Currency' },
    @{ Nome = 'Vigencia'; Tipo = 'Text' }
  )
  'TC_Clientes' = @(
    @{ Nome = 'Nome';     Tipo = 'Text' },
    @{ Nome = 'Segmento'; Tipo = 'Text' }
  )
  'TC_Equipamentos' = @(
    @{ Nome = 'Nome';      Tipo = 'Text' },
    @{ Nome = 'Grupo';     Tipo = 'Text' },
    @{ Nome = 'Posicoes';  Tipo = 'Number' },
    @{ Nome = 'Continuo';  Tipo = 'Choice'; Opcoes = @('Sim', 'Não') },
    @{ Nome = 'HorasDia';  Tipo = 'Number' },
    # 0 = domingo. Texto porque não existe coluna de lista de números.
    @{ Nome = 'DiasUteis'; Tipo = 'Text' }
  )
  'TC_Manutencoes' = @(
    @{ Nome = 'EquipamentoId'; Tipo = 'Text' },
    @{ Nome = 'Inicio';        Tipo = 'DateTime' },
    @{ Nome = 'Fim';           Tipo = 'DateTime' },
    @{ Nome = 'Motivo';        Tipo = 'Text' }
  )
  'TC_Pecas' = @(
    @{ Nome = 'Nome';         Tipo = 'Text' },
    @{ Nome = 'Descricao';    Tipo = 'Note' },
    @{ Nome = 'CustoAmostra'; Tipo = 'Currency' }
  )
  'TC_Procedimentos' = @(
    @{ Nome = 'Nome';              Tipo = 'Text' },
    @{ Nome = 'Norma';             Tipo = 'Text' },
    @{ Nome = 'Revisao';           Tipo = 'Text' },
    @{ Nome = 'Area';              Tipo = 'Choice'; Opcoes = @('HOT', 'COLD', 'AMBOS') },
    # Vários valores separados por "; " — o procedimento pode ocupar mais de uma bancada
    # ao mesmo tempo e ser exigido por mais de um cliente.
    @{ Nome = 'EquipamentoGrupos'; Tipo = 'Text' },
    @{ Nome = 'Clientes';          Tipo = 'Text' },
    @{ Nome = 'HorasSetup';        Tipo = 'Number' },
    @{ Nome = 'HorasEnsaio';       Tipo = 'Number' },
    @{ Nome = 'HorasReport';       Tipo = 'Number' },
    @{ Nome = 'Amostras';          Tipo = 'Number' },
    # O hourly rate não é do procedimento: está em TC_Parametros.
    @{ Nome = 'CustoInsumos';      Tipo = 'Currency' },
    @{ Nome = 'Descricao';         Tipo = 'Note' }
  )
  'TC_Demandas' = @(
    @{ Nome = 'ProcedimentoId'; Tipo = 'Text' },
    @{ Nome = 'PecaId';         Tipo = 'Text' },
    @{ Nome = 'ClienteId';      Tipo = 'Text' },
    @{ Nome = 'Projeto';        Tipo = 'Text' },
    @{ Nome = 'PartNumber';     Tipo = 'Text' },
    @{ Nome = 'LTI';            Tipo = 'Text' },
    @{ Nome = 'TipoLTI';        Tipo = 'Choice'; Opcoes = @('COTACAO', 'DV', 'PV', 'VAVE') },
    @{ Nome = 'Prioridade';     Tipo = 'Choice'; Opcoes = @('ALTA', 'MEDIA', 'BAIXA') },
    @{ Nome = 'Quantidade';     Tipo = 'Number' },
    @{ Nome = 'DataAmostras';   Tipo = 'DateTime' },
    @{ Nome = 'Prazo';          Tipo = 'DateTime' },
    @{ Nome = 'InicioFixo';     Tipo = 'DateTime' },
    @{ Nome = 'Observacao';     Tipo = 'Note' },
    @{ Nome = 'Status';         Tipo = 'Choice'; Opcoes = @('PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA') },
    # Registro da execução real: alimenta os indicadores do painel.
    @{ Nome = 'DataConclusao';       Tipo = 'DateTime' },
    @{ Nome = 'DataRelatorio';       Tipo = 'DateTime' },
    @{ Nome = 'RelatorioStatus';     Tipo = 'Choice'; Opcoes = @('NAO_ENVIADO', 'EM_ANALISE', 'CORRECAO', 'APROVADO') },
    @{ Nome = 'RelatorioCorrecoes';  Tipo = 'Number' },
    # Preenchidas pelo motor de planejamento, não pelo usuário.
    @{ Nome = 'InicioPlanejado';      Tipo = 'DateTime' },
    @{ Nome = 'FimPlanejado';         Tipo = 'DateTime' },
    @{ Nome = 'EquipamentosAlocados'; Tipo = 'Text' },
    @{ Nome = 'MotivoBloqueio';       Tipo = 'Note' }
  )
  'TC_Cotacoes' = @(
    @{ Nome = 'ClienteId';        Tipo = 'Text' },
    @{ Nome = 'Projeto';          Tipo = 'Text' },
    @{ Nome = 'PartNumber';       Tipo = 'Text' },
    @{ Nome = 'LTI';              Tipo = 'Text' },
    @{ Nome = 'Solicitante';      Tipo = 'Text' },
    @{ Nome = 'PrevisaoExecucao'; Tipo = 'DateTime' },
    @{ Nome = 'Status';           Tipo = 'Choice'; Opcoes = @('ABERTA', 'ENVIADA', 'APROVADA', 'RECUSADA') },
    @{ Nome = 'Observacao';       Tipo = 'Note' },
    @{ Nome = 'CriadoEm';         Tipo = 'DateTime' }
  )
  # Preço congelado no momento da cotação: mudar o catálogo depois não pode reescrever
  # um orçamento já entregue.
  'TC_CotacaoItens' = @(
    @{ Nome = 'CotacaoNumero';   Tipo = 'Text' },
    @{ Nome = 'ProcedimentoId';  Tipo = 'Text' },
    @{ Nome = 'Nome';            Tipo = 'Text' },
    @{ Nome = 'Revisao';         Tipo = 'Text' },
    @{ Nome = 'Norma';           Tipo = 'Text' },
    @{ Nome = 'HorasFaturaveis'; Tipo = 'Number' },
    @{ Nome = 'HourlyRate';      Tipo = 'Currency' },
    @{ Nome = 'CustoHoras';      Tipo = 'Currency' },
    @{ Nome = 'CustoInsumos';    Tipo = 'Currency' },
    @{ Nome = 'CustoUnitario';   Tipo = 'Currency' },
    @{ Nome = 'Amostras';        Tipo = 'Number' },
    @{ Nome = 'Total';           Tipo = 'Currency' }
  )
}

foreach ($nomeLista in $listas.Keys) {
  $existente = Get-PnPList -Identity $nomeLista -ErrorAction SilentlyContinue
  if ($null -eq $existente) {
    Write-Host "Criando lista $nomeLista"
    New-PnPList -Title $nomeLista -Template GenericList -EnableVersioning | Out-Null
  } else {
    Write-Host "Lista $nomeLista já existe"
  }

  foreach ($coluna in $listas[$nomeLista]) {
    $jaTem = Get-PnPField -List $nomeLista -Identity $coluna.Nome -ErrorAction SilentlyContinue
    if ($null -ne $jaTem) { continue }

    Write-Host "  + coluna $($coluna.Nome) ($($coluna.Tipo))"
    if ($coluna.Tipo -eq 'Choice') {
      Add-PnPField -List $nomeLista -DisplayName $coluna.Nome -InternalName $coluna.Nome `
        -Type Choice -Choices $coluna.Opcoes -AddToDefaultView | Out-Null
    } else {
      Add-PnPField -List $nomeLista -DisplayName $coluna.Nome -InternalName $coluna.Nome `
        -Type $coluna.Tipo -AddToDefaultView | Out-Null
    }
  }
}

Write-Host ''
Write-Host 'Listas prontas. A coluna Title guarda o código do registro (TP-GM-01, CLI-GM, DM-0001).'
Write-Host 'Para carregar os dados: abra cada lista, mude para a visualização em grade e cole o'
Write-Host 'conteúdo do CSV correspondente de dist/listas/.'
