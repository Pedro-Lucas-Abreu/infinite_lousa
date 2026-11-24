# Lousa

Lousa digital de código aberto para aulas de matemática. Inclui caneta, marca-texto, borracha, seleção, fundos, imagens, anotação de PDFs, quadros, exportação, texto, formas, equações e apresentação. A lousa mantém autosave e arquivos `.board` e pode ser instalada para uso offline.

## Executar localmente

Use Node.js 24 e pnpm 11. Execute os comandos abaixo no PowerShell do Windows, a partir da pasta do projeto.

```powershell
pnpm.cmd --config.store-dir=.pnpm-store install --frozen-lockfile
pnpm.cmd dev
```

Abra a URL exibida no terminal no Chrome ou Edge. O Firefox é o navegador secundário do projeto.

Pressione **?** ou abra **Arquivo → Atalhos** para consultar a lista completa, incluindo os gestos de mouse e as expansões do editor de equações. Use **Esc** para fechar o painel.

| Ação | Comando |
| --- | --- |
| Desenhar | Caneta, tecla `P` ou botão esquerdo na lousa |
| Marcar / apagar | `H` para marca-texto, `E` para borracha, segurar `X` para apagar temporariamente |
| Trocar cor e espessura | `1` a `6`. Edite o favorito atual em **Ajustes** |
| Mover a barra | Arraste a alça até uma borda ou escolha a posição em **Ajustes** |
| Selecionar | `V` retângulo, `B` laço, `Ctrl+A` para todos os objetos destravados e `Esc` para limpar |
| Transformar seleção | Arraste a seleção ou seus puxadores. Use `Alt` + setas para mover, `Alt` + `+` ou `−` para redimensionar e `R` / `Shift+R` para girar |
| Copiar, recortar, colar, duplicar e excluir | `Ctrl+C`, `Ctrl+X`, `Ctrl+V`, `Ctrl+D` e `Delete` |
| Inserir e editar texto | `T` e clique na lousa. Dê duplo clique em um texto com **Texto** ou **Seleção** para editar. `Enter` confirma, `Shift+Enter` insere nova linha e `Esc` cancela |
| Inserir e editar equação | `Q` abre o editor LaTeX no ponteiro ou no centro da lousa. `Enter` insere. Com **Seleção**, dê duplo clique na equação para reabrir o código |
| Desenhar formas | `L` linha, `A` seta, `W` retângulo, `O` elipse e `C` polígono. Arraste para desenhar. No polígono, clique nos vértices e confirme com `Enter` ou duplo clique |
| Inserir e editar plano cartesiano | `F2` ou **Formas → Plano cartesiano** para inserir. Com **Seleção** ou **Laço**, dê duplo clique para editar |
| Restringir formas | Segure `Shift` para ângulos de 45° em linhas, setas ou segmentos do polígono e para desenhar quadrados ou círculos |
| Suavizar o traço | Controle Estabilizador de 0 a 100 |
| Mover a lousa | O botão direito arrasta a lousa. Também funcionam Espaço ou Ctrl + arrastar e a ferramenta Mão (`M`) |
| Dar zoom | Roda do mouse, `+` e `−` ou controles na barra |
| Exigir Ctrl para zoom com a roda | Marcar “Exigir Ctrl para zoom” |
| Voltar à origem e ao zoom de 100% | Tecla `0` ou clique no percentual |
| Desfazer / refazer | `Ctrl+Z` / `Ctrl+Y` ou `Ctrl+Shift+Z` |
| Abrir / salvar `.board` | Menu Arquivo ou `Ctrl+O` / `Ctrl+S` |
| Inserir imagem / PDF | `I` / `D`, arraste o arquivo ou use `Ctrl+V` quando o navegador disponibilizar o arquivo |
| Trocar o fundo | `G` ou menu **Fundo** |
| Travar uma página | `U` na página selecionada ou no quadro vinculado. Também disponível em **Quadros** |
| Criar e navegar quadros | `N` cria um quadro 16:9. Use as setas para navegar e `Enter` para enquadrar |
| Exportar | `Y` para PDF por quadros, `Shift+Y` para PDF de todo o conteúdo e `J` para PNG do quadro atual |
| Apresentar | `F` alterna a apresentação. Mova o ponteiro até a borda superior para mostrar a faixa de controles. `K` ativa o laser e `S` o spotlight |

Experimente `2x = 10`, `x_1^2`, `\frac{1}{2}`, `\sqrt{x}`, `\sqrt[3]{x}` e `\log x + \ln x`. Para letras gregas e símbolos, use por exemplo `\alpha`, `\le`, `\ge`, `\ne`, `\pm` e `\infty`. A equação usa a cor ativa ao ser inserida e permanece vetorial na lousa e no PDF.

Em um plano cartesiano, ajuste os limites dos eixos, o passo e a proporção 1:1. Use **Adicionar função** para desenhar várias curvas, cada uma com sua cor. A ajuda no editor descreve a sintaxe. Exemplos incluem `2x+1`, `0,5x^2`, `2^x`, `sqrt(x)`, `abs(x)`, `1/x` e `sin(x)`. Use vírgula ou ponto como separador decimal. `log(x)` usa base 10, `ln(x)` usa base natural e as funções trigonométricas usam radianos.

As páginas PDF entram travadas para anotação e geram quadros na ordem. Em **Quadros**, destrave uma página para movê-la ou desative a criação automática antes de importar. Ao mover uma página, a tinta ancorada e o quadro vinculado a acompanham. Na exportação, o PDF de origem é incorporado quando possível. Páginas incompatíveis são renderizadas em alta resolução e a lousa informa quantas usaram essa alternativa.

## Salvamento e uso offline

O navegador grava a lousa e o histórico local em IndexedDB. “Salvo neste navegador” indica que a última gravação terminou. Ao reabrir o mesmo endereço no mesmo perfil do navegador, a lousa recupera a revisão gravada. Para levar a lousa a outro dispositivo ou guardar uma cópia, use **Arquivo → Salvar lousa** ou **Baixar cópia**. **Abrir via upload** seleciona um arquivo do próprio dispositivo e funciona mesmo em navegadores sem o seletor nativo usado por Chrome e Edge. Se já houver traços na lousa, o aplicativo pede confirmação antes de substituí-la pelo arquivo. O histórico de desfazer e refazer fica no armazenamento local e começa novamente ao abrir um `.board`.

Para usar offline, abra a lousa com internet e aguarde “Pronto offline”. Use **Instalar** quando o navegador oferecer a opção. Se aparecer **Atualizar**, essa ação conclui o salvamento antes de recarregar. Para validar offline localmente, rode `pnpm.cmd build` seguido de `pnpm.cmd preview`. Use o mesmo endereço do preview ao recarregar.

## Formato `.board` v1

Um `.board` é um ZIP de um único volume com entradas Store (0) ou Deflate (8). Os JSON usam UTF-8. Os caminhos internos usam `/`.

| Entrada | Conteúdo |
| --- | --- |
| `manifest.json` | Objeto com `format: "board"`, `version: 1`, `scenePath: "scene.json"` e `assets`. Cada item em `assets` tem `id`, `path: "assets/<id>"`, `mime` e `size` em bytes. Use `assets: []` quando a lousa não tiver arquivos incorporados. |
| `scene.json` | Objeto com `version: 1` e lista `objects`. Aceita traços, imagens, páginas PDF, quadros, texto, formas, equações e planos cartesianos. Arquivos anteriores continuam legíveis. |
| `assets/<id>` | Bytes do PDF ou da imagem catalogados no manifesto. |

`image` e `pdfPage` usam `props` com `width`, `height` e `assetId`. `pdfPage` também tem `pageIndex` a partir de zero. `frame` usa `width`, `height`, `name` e `order`. Traços e quadros podem ter `parentId` com o ID de uma página PDF. Traços têm `brush.opacity` opcional para marca-texto.

Uma `equation` guarda o `latex` editável, `width`, `height`, `fontSize`, `color` e `paths`. Cada caminho contém os comandos SVG em `d` e sua transformação afim local. As prévias, o cursor e os efeitos de apresentação não fazem parte do arquivo.

Um `plot` guarda `width`, `height`, `color`, `size`, `settings` com `xmin`, `xmax`, `ymin`, `ymax`, `step` e `lockAspect`, e uma lista `functions` com `expression` e `color` em cada item.

Cada traço tem `id`, `type`, `transform`, `zIndex`, `locked` e `props`. IDs têm de 1 a 128 caracteres e usam letras ASCII, dígitos, `_` e `-`. `transform` é uma matriz afim invertível `[a, b, c, d, e, f]`. Ela leva o ponto local `(x, y)` a `(ax + cy + e, bx + dy + f)` no mundo, com Y crescente para baixo. `zIndex` define a ordem de pintura. `props` contém `version: 1`, uma lista `points` com `x`, `y` e pressão opcional entre 0 e 1, e `brush` com `color` em `#RRGGBB`, `size` em unidades locais, `stabilizer` entre 0 e 100 e `simulatePressure` booleano.

Exemplo de `scene.json` com um traço de um ponto.

```json
{
  "version": 1,
  "objects": [{
    "id": "traco-1",
    "type": "stroke",
    "transform": [1, 0, 0, 1, 40, 20],
    "zIndex": 0,
    "locked": false,
    "props": {
      "version": 1,
      "points": [{ "x": 0, "y": 0 }],
      "brush": { "color": "#192038", "size": 3.5, "stabilizer": 35, "simulatePressure": true }
    }
  }]
}
```

O leitor verifica a estrutura ZIP, tamanhos, CRC-32, caminhos e campos antes de substituir a lousa. Limites atuais por arquivo: 128 MiB compactados, 192 MiB descompactados, 1.024 entradas incluindo os dois JSON, 512 KiB no manifesto, 64 MiB na cena, 64 MiB por ativo, 100 mil traços e 2 milhões de pontos no total.

## Testes e benchmark

```powershell
pnpm.cmd test
pnpm.cmd build
pnpm.cmd test:browser
pnpm.cmd test:documents
pnpm.cmd bench
```

Os comandos de navegador usam instalações locais do Chrome e do Edge e a compilação de produção. O benchmark gera medições brutas em `test-results/`. Consulte [PERF.md](docs/PERF.md) para o ambiente, o método e os resultados. O escopo e os critérios de aceite dos próximos marcos estão no [plano](docs/PLAN.md).

## Hospedagem

A [lousa no GitHub Pages](https://pedro-lucas-abreu.github.io/whiteboard_/) usa o build estático gerado em `dist/`. Para relatar um problema observado em aula, informe o navegador, o que estava fazendo e o que ocorreu. [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

## Licenças

Licença do projeto: [MIT](LICENSE). A regra admite licenças permissivas, OFL para fontes e MPL-2.0 em dependências usadas sem modificação. GPL e AGPL embutidas e o SDK do tldraw são vetados.

Licenças declaradas pelos pacotes da Etapa A, incluindo dependências transitivas. As versões exatas estão no `pnpm-lock.yaml`.

| Licença | Pacotes |
| --- | --- |
| MIT | `fflate`, `perfect-freehand`, `rbush`, `react`, `react-dom`, `scheduler`, `zustand` |
| MIT | `@esbuild/*`, `@types/node`, `@types/rbush`, `@types/react`, `@types/react-dom`, `csstype`, `esbuild`, `undici-types` |
| Apache-2.0 | `typescript` |
| ISC | `idb`, `quickselect` |
| MIT | `@cantoo/pdf-lib` 2.11.1, `culori` 4.0.2, `html-entities` 2.6.0, `node-html-better-parser` 1.5.9 |
| 0BSD | `tslib` 2.9.1 |
| Apache-2.0 | `pdfjs-dist` 6.5.438 (API e workers) |
| Apache-2.0 | `@mathjax/src` 4.1.3 e os módulos do adaptador `@mathjax/mathjax-stix2-font` 4.1.3 |
| OFL-1.1 | Contornos tipográficos STIX Two usados nas fórmulas |

O build inclui os CMaps Adobe e fontes Foxit sob BSD-3-Clause, OpenJPEG sob BSD-2-Clause, qcms sob MIT e o decodificador JBIG2 do PDFium sob BSD-3-Clause e Apache-2.0. As fontes Liberation licenciadas sob GPL-2.0 e os recursos opcionais fora dessa seleção ficam fora do build. Os avisos acompanham o pacote publicado. [Recursos da distribuição do PDF.js](https://github.com/mozilla/pdf.js/tree/v6.5.438/external)

As equações usam o MathJax com saída em caminhos SVG e dados locais da fonte STIX Two. O módulo carrega quando o editor é usado. Os avisos do MathJax e da fonte acompanham o build. [Saída SVG do MathJax](https://docs.mathjax.org/en/latest/output/svg.html) · [Licença STIX Two](src/equations/STIX-OFL.txt)

O pacote opcional com o binário do esbuild varia conforme o sistema operacional e a arquitetura. Consulte as licenças instaladas na sua plataforma com o comando abaixo.

```powershell
pnpm.cmd --config.store-dir=.pnpm-store licenses list --json
```

O inventário acima cobre as licenças declaradas no npm. Os avisos do TypeScript 5.9.3 registram termos do W3C e CC BY 4.0 para material da especificação do DOM. O compilador é usado localmente para verificar tipos. O build da lousa deixa o compilador e as declarações de tipos fora dos arquivos distribuídos.
