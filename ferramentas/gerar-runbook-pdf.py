#!/usr/bin/env python3
"""Builds the phase-3 runbook PDF from the markdown guides in docs/.

    pip install markdown playwright
    python3 ferramentas/gerar-runbook-pdf.py [output-dir]

Chromium comes from Playwright. The PDF is a hand-out for the people building the three
tracks in parallel — the markdown in docs/ stays the source, this only lays it out.
"""

import html
import os
import re
import sys
from pathlib import Path

import markdown
from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else REPO / "dist"

BRAND = "#0f5c8c"

TRACKS = [
    {
        "n": "1",
        "file": "docs/power-automate-calibracao.md",
        "title": "Alerta de calibração",
        "sub": "Power Automate · fluxo semanal",
        "who": "Pessoa A",
        "time": "~1 hora",
        "dep": "Nenhuma. Pode começar agora.",
        "tool": "Power Automate",
    },
    {
        "n": "2",
        "file": "docs/power-automate-agendamento.md",
        "title": "Agendamento",
        "sub": "Office Script + Power Automate",
        "who": "Pessoa B",
        "time": "~4 horas",
        "dep": "Office Scripts liberado pelo TI — já está.",
        "tool": "Excel na web + Power Automate",
    },
    {
        "n": "3",
        "file": "docs/power-bi.md",
        "title": "Power BI",
        "sub": "Gantt e indicadores",
        "who": "Pessoa C",
        "time": "~6 horas",
        "dep": "O Gantt só tem dados depois que a trilha 2 rodar. O resto é independente.",
        "tool": "Power BI Desktop",
    },
]

APPENDIX = {
    "n": "A",
    "file": "docs/power-automate-importar-calibracoes.md",
    "title": "Importar a planilha de calibração",
    "sub": "Apêndice da trilha 1",
    "who": "Apêndice · Pessoa A",
    "time": "~45 minutos",
    "dep": "Mesma pessoa da trilha 1. O alerta só vale o que valem as datas embaixo dele.",
    "tool": "Power Automate + Excel",
}

CSS = """
@page { size: A4; margin: 18mm 16mm 20mm 16mm; }

* { box-sizing: border-box; }

body {
  font-family: "Segoe UI", -apple-system, system-ui, sans-serif;
  font-size: 9.6pt;
  line-height: 1.5;
  color: #17222f;
  margin: 0;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

h1, h2, h3, h4 { line-height: 1.25; margin: 0; font-weight: 600; }

h1 {
  font-size: 19pt;
  color: BRAND;
  margin: 0 0 4mm 0;
  padding-bottom: 2.5mm;
  border-bottom: 2.5px solid BRAND;
}

h2 {
  font-size: 13pt;
  color: BRAND;
  margin: 7mm 0 2.5mm 0;
  page-break-after: avoid;
  break-after: avoid;
}

h3 {
  font-size: 10.8pt;
  color: #17222f;
  margin: 5mm 0 2mm 0;
  page-break-after: avoid;
  break-after: avoid;
}

h4 { font-size: 9.8pt; margin: 4mm 0 1.5mm 0; }

p { margin: 0 0 2.6mm 0; }
ul, ol { margin: 0 0 2.6mm 0; padding-left: 5mm; }
li { margin-bottom: 1.2mm; }

strong { font-weight: 600; }

code {
  font-family: "Cascadia Mono", Consolas, "Liberation Mono", monospace;
  font-size: 8.4pt;
  background: #eef2f7;
  border: 1px solid #dde5ee;
  border-radius: 3px;
  padding: 0.3mm 1mm;
  color: #0b3a59;
}

pre {
  background: #f7fafc;
  border: 1px solid #dde5ee;
  border-left: 3px solid BRAND;
  border-radius: 4px;
  padding: 2.5mm 3mm;
  margin: 0 0 3mm 0;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  page-break-inside: avoid;
  break-inside: avoid;
}

pre code {
  background: none;
  border: none;
  padding: 0;
  font-size: 8.1pt;
  line-height: 1.45;
  color: #17222f;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 3.5mm 0;
  font-size: 8.6pt;
  page-break-inside: avoid;
  break-inside: avoid;
}

th {
  background: BRAND;
  color: #fff;
  text-align: left;
  font-weight: 600;
  padding: 1.6mm 2mm;
  border: 1px solid BRAND;
}

td {
  padding: 1.5mm 2mm;
  border: 1px solid #dde5ee;
  vertical-align: top;
}

tbody tr:nth-child(even) td { background: #f7fafc; }

td code, th code { font-size: 7.9pt; word-break: break-word; }

blockquote {
  margin: 0 0 3mm 0;
  padding: 2.5mm 3mm;
  background: #fdf3e3;
  border-left: 3px solid #b45309;
  border-radius: 0 4px 4px 0;
}
blockquote p:last-child { margin-bottom: 0; }
blockquote code { background: #f6e7cd; border-color: #e6d4b4; }

hr { border: none; border-top: 1px solid #dde5ee; margin: 5mm 0; }

/* ---- cover ---- */

.cover {
  height: 252mm;
  display: flex;
  flex-direction: column;
  page-break-after: always;
}

.cover-badge {
  display: inline-block;
  background: BRAND;
  color: #fff;
  font-size: 8.5pt;
  font-weight: 600;
  letter-spacing: 0.9px;
  padding: 1.6mm 3.5mm;
  border-radius: 3px;
  align-self: flex-start;
}

.cover h1 {
  font-size: 30pt;
  border: none;
  margin: 7mm 0 0 0;
  padding: 0;
  letter-spacing: -0.4px;
}

.cover .lede {
  font-size: 12pt;
  color: #475569;
  margin: 3mm 0 0 0;
  max-width: 135mm;
  line-height: 1.45;
}

.cover-meta {
  margin-top: 6mm;
  font-size: 9pt;
  color: #64748b;
}

.track-cards { margin-top: 9mm; display: flex; flex-direction: column; gap: 3mm; }

.track-card {
  border: 1px solid #dde5ee;
  border-left: 4px solid BRAND;
  border-radius: 5px;
  padding: 3mm 4mm;
  background: #fbfdff;
}

.track-card.appendix { border-left-color: #94a3b8; background: #fafbfc; }
.track-card.appendix .tc-num { color: #94a3b8; }

.track-card .tc-head {
  display: flex;
  align-items: baseline;
  gap: 3mm;
}

.tc-num {
  font-size: 15pt;
  font-weight: 700;
  color: BRAND;
  min-width: 7mm;
}

.tc-title { font-size: 12pt; font-weight: 600; }
.tc-sub { font-size: 8.8pt; color: #64748b; margin-left: auto; }

.tc-grid {
  margin-top: 2mm;
  display: grid;
  grid-template-columns: 22mm 1fr;
  gap: 1.1mm 3mm;
  font-size: 8.7pt;
}
.tc-grid dt { color: #64748b; }
.tc-grid dd { margin: 0; }

.cover-foot {
  margin-top: auto;
  font-size: 8.3pt;
  color: #94a3b8;
  border-top: 1px solid #e2e8f0;
  padding-top: 3mm;
}

/* ---- section opener ---- */

.opener { page-break-before: always; }

.opener .eyebrow {
  font-size: 8.5pt;
  font-weight: 600;
  letter-spacing: 1.1px;
  color: #64748b;
  text-transform: uppercase;
  margin-bottom: 2mm;
}

.opener-meta {
  display: flex;
  gap: 4mm;
  margin: 0 0 6mm 0;
  font-size: 8.6pt;
}

.opener-meta div {
  background: #eef4f9;
  border: 1px solid #d7e3ee;
  border-radius: 4px;
  padding: 1.8mm 3mm;
}
.opener-meta span { color: #64748b; }

/* ---- how-to-use page ---- */

.flowbox {
  border: 1px solid #dde5ee;
  border-radius: 5px;
  padding: 4mm;
  background: #fbfdff;
  margin-bottom: 4mm;
  page-break-inside: avoid;
}

.flowbox pre {
  background: none;
  border: none;
  margin: 0;
  padding: 0;
  font-size: 8.3pt;
  line-height: 1.6;
  color: #334155;
}

.callout {
  background: #e6f5ec;
  border-left: 3px solid #15803d;
  border-radius: 0 4px 4px 0;
  padding: 3mm 3.5mm;
  margin-bottom: 3.5mm;
}
.callout p:last-child { margin-bottom: 0; }
.callout strong { color: #14532d; }

.warn {
  background: #fdecec;
  border-left: 3px solid #b91c1c;
}
.warn strong { color: #7f1d1d; }
""".replace("BRAND", BRAND)


def convert(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    # The first H1 becomes the section opener title; drop it from the body.
    text = re.sub(r"\A#\s+.*\n", "", text, count=1)
    return markdown.markdown(
        text,
        extensions=["tables", "fenced_code", "sane_lists", "attr_list"],
    )


def track_card(t: dict, appendix: bool = False) -> str:
    cls = "track-card appendix" if appendix else "track-card"
    return f"""
    <div class="{cls}">
      <div class="tc-head">
        <span class="tc-num">{t['n']}</span>
        <span class="tc-title">{html.escape(t['title'])}</span>
        <span class="tc-sub">{html.escape(t['sub'])}</span>
      </div>
      <dl class="tc-grid">
        <dt>Ferramenta</dt><dd>{html.escape(t['tool'])}</dd>
        <dt>Tempo</dt><dd>{html.escape(t['time'])}</dd>
        <dt>Depende de</dt><dd>{html.escape(t['dep'])}</dd>
      </dl>
    </div>"""


COVER = """
<div class="cover">
  <span class="cover-badge">TESTING CENTER · FASE 3</span>
  <h1>Três trilhas paralelas</h1>
  <p class="lede">Alerta de calibração, agendamento e Power BI — o passo a passo
     de cada uma, para três pessoas trabalharem ao mesmo tempo.</p>
  <div class="cover-meta">Limeira Testing Center · SharePoint + Power Platform</div>
  <div class="track-cards">
    TRACK_CARDS
  </div>
  <div class="cover-foot">
    As três trilhas escrevem nas mesmas listas do SharePoint e não se atrapalham.
    Só uma dependência real entre elas: o Gantt da trilha 3 fica vazio até a trilha 2 rodar
    pela primeira vez.
  </div>
</div>
"""

HOWTO = """
<div class="opener">
  <div class="eyebrow">Antes de dividir o trabalho</div>
  <h1>Como usar este documento</h1>

  <p>O aplicativo no Power Apps já está pronto e publicado: catálogo, nova solicitação, fila de
  solicitações, cotações e o fluxo de aprovação com histórico. O que falta é o que não cabe
  dentro do Power Apps — um alerta que chega sozinho, o motor de agendamento e os gráficos.</p>

  <p>Cada trilha abaixo é independente e tem seu próprio responsável. Entregue uma trilha por
  pessoa e não fatie uma trilha entre duas pessoas: a metade de um fluxo do Power Automate não
  roda, e as expressões referenciam as ações pelo nome exato.</p>

  <div class="flowbox">
<pre>SharePoint Lists          os dados, num lugar só, com permissão e histórico
        |
        +-- Power App (pronto)      catálogo, solicitações, cotações
        |
        +-- Trilha 1  Power Automate .......... alerta de calibração, toda segunda
        |        +-- Apêndice ................. importar a planilha de calibração
        |
        +-- Trilha 2  Office Script + Flow .... agendamento: data de início, fim e bancada
        |
        +-- Trilha 3  Power BI ................ Gantt e indicadores</pre>
  </div>

  <h2>O que cada pessoa precisa antes de começar</h2>

  <table>
    <thead><tr><th>Trilha</th><th>Acesso necessário</th><th>Onde trabalha</th></tr></thead>
    <tbody>
      <tr><td>1 — Calibração</td><td>Criar fluxos no Power Automate; leitura na lista
        <code>TC_Instrumentos</code>; uma caixa de e-mail para enviar</td>
        <td>make.powerautomate.com</td></tr>
      <tr><td>Apêndice — Importar</td><td>Escrita em <code>TC_Instrumentos</code> e
        <code>TC_Calibracoes</code>; subir a planilha na biblioteca
        <code>Documentos</code> do site</td>
        <td>Excel na web + make.powerautomate.com</td></tr>
      <tr><td>2 — Agendamento</td><td>Office Scripts habilitado (já liberado pelo TI); permissão
        de contribuição em <code>TC_Demandas</code>; criar arquivo na biblioteca
        <code>Documentos</code> do site</td>
        <td>Excel na web + make.powerautomate.com</td></tr>
      <tr><td>3 — Power BI</td><td>Power BI Desktop instalado; licença Pro para publicar e
        compartilhar</td>
        <td>Power BI Desktop</td></tr>
    </tbody>
  </table>

  <div class="callout">
    <p><strong>A licença do Power BI é a única pendência real.</strong> Construir é grátis
    (Power BI Desktop). Compartilhar o relatório exige licença Pro para quem publica
    <em>e</em> para quem abre, a menos que o workspace esteja em capacidade Premium/Fabric.
    Confirme isso antes que a trilha 3 avance muito — se não houver Pro para todos, a saída é
    licenciar só o test centre e exportar PDF para o resto, e isso muda o que vale construir.</p>
  </div>

  <div class="callout warn">
    <p><strong>Os nomes das ações importam.</strong> No Power Automate, as expressões referenciam
    as ações pelo nome — <code>outputs('Get_equipment')</code> aponta para a ação chamada
    <em>Get equipment</em>. Renomeie cada ação exatamente como o documento manda, no momento em
    que criá-la. Renomear depois quebra todas as expressões que já a citavam, silenciosamente.</p>
  </div>

  <h2>Regra comum às três</h2>

  <p>Nunca invente um nome de coluna. O arquivo <code>ferramentas/listas-schema.json</code> no
  repositório é a fonte única da verdade sobre as colunas das listas, e todas as expressões
  destes guias saíram dele. Se uma coluna não existir com aquele nome exato, o valor chega vazio
  e nada falha — que é o pior tipo de erro, porque só aparece semanas depois.</p>

  <p>Ao terminar cada trilha, rode a seção <em>Testando antes de confiar</em> do guia
  correspondente. Não é formalidade: as três têm um teste que pega o erro mais comum daquela
  trilha, e todos os três já aconteceram de verdade durante a construção.</p>
</div>
"""


def opener(t: dict, body: str) -> str:
    return f"""
<div class="opener">
  <div class="eyebrow">{html.escape(t['who'])}</div>
  <h1>{html.escape(t['title'])}</h1>
  <div class="opener-meta">
    <div><span>Ferramenta</span> &nbsp;{html.escape(t['tool'])}</div>
    <div><span>Tempo estimado</span> &nbsp;{html.escape(t['time'])}</div>
  </div>
  {body}
</div>"""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    cards = "\n".join(track_card(t) for t in TRACKS)
    cards += track_card(APPENDIX, appendix=True)

    parts = [COVER.replace("TRACK_CARDS", cards), HOWTO]
    parts.append(opener(TRACKS[0], convert(REPO / TRACKS[0]["file"])))
    parts.append(opener(APPENDIX, convert(REPO / APPENDIX["file"])))
    for t in TRACKS[1:]:
        parts.append(opener(t, convert(REPO / t["file"])))

    page = f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Testing Center — Fase 3</title>
<style>{CSS}</style></head>
<body>{''.join(parts)}</body></html>"""

    html_path = OUT / "fase3.html"
    html_path.write_text(page, encoding="utf-8")

    pdf_path = OUT / "Testing-Center-Fase3-Runbook.pdf"
    footer = (
        '<div style="width:100%;font-size:7pt;color:#94a3b8;'
        'font-family:Segoe UI,sans-serif;padding:0 16mm;display:flex;'
        'justify-content:space-between;">'
        "<span>Testing Center · Fase 3 · três trilhas paralelas</span>"
        '<span class="pageNumber"></span></div>'
    )

    launch = {}
    chrome = os.environ.get("CHROMIUM_PATH")
    if chrome:
        launch["executable_path"] = chrome

    with sync_playwright() as p:
        browser = p.chromium.launch(**launch)
        pg = browser.new_page()
        pg.goto(html_path.as_uri(), wait_until="networkidle")
        pg.pdf(
            path=str(pdf_path),
            format="A4",
            print_background=True,
            display_header_footer=True,
            header_template="<div></div>",
            footer_template=footer,
            margin={"top": "14mm", "bottom": "16mm", "left": "16mm", "right": "16mm"},
        )
        browser.close()

    html_path.unlink()
    print(f"wrote {pdf_path} ({pdf_path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
