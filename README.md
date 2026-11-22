# Lousa

Lousa digital de código aberto para aulas de matemática. O Marco 2 oferece caneta com estabilizador, pan, zoom, histórico, recuperação da última lousa salva no navegador e arquivos portáteis `.board`. Os traços são redesenhados a partir da geometria vetorial. A lousa pode ser instalada e usada offline depois que os recursos estiverem disponíveis no dispositivo.

## Executar localmente

Use Node.js 24 e pnpm 11. Execute os comandos abaixo no PowerShell do Windows, a partir da pasta do projeto.

```powershell
pnpm.cmd --config.store-dir=.pnpm-store install --frozen-lockfile
pnpm.cmd dev
```

Abra a URL exibida no terminal no Chrome ou Edge. O Firefox é o navegador secundário do projeto.

| Ação | Comando |
| --- | --- |
| Desenhar | Caneta, tecla `P` ou botão esquerdo na lousa |
| Suavizar o traço | Controle Estabilizador de 0 a 100 |
| Mover a lousa | Arrastar com botão do meio, Espaço ou Ctrl, ou selecionar Mão (`M`) |
| Dar zoom | Roda do mouse, `+` e `−` ou controles na barra |
| Exigir Ctrl para zoom com a roda | Marcar “Exigir Ctrl para zoom” |
| Voltar à origem e ao zoom de 100% | Tecla `0` ou clique no percentual |
| Desfazer / refazer | `Ctrl+Z` / `Ctrl+Y` ou `Ctrl+Shift+Z` |
| Abrir / salvar `.board` | Menu Arquivo ou `Ctrl+O` / `Ctrl+S` |

## Salvamento e uso offline

O navegador grava a lousa e o histórico local em IndexedDB. “Salvo neste navegador” indica que a última gravação terminou. Ao reabrir o mesmo endereço no mesmo perfil do navegador, a lousa recupera a revisão gravada. Para levar a lousa a outro dispositivo ou guardar uma cópia, use **Arquivo → Salvar lousa** ou **Baixar cópia**. **Abrir via upload** seleciona um arquivo do próprio dispositivo e funciona mesmo em navegadores sem o seletor nativo usado por Chrome e Edge. Se já houver traços na lousa, o aplicativo pede confirmação antes de substituí-la pelo arquivo. O histórico de desfazer e refazer fica no armazenamento local e começa novamente ao abrir um `.board`.

Para usar offline, abra a lousa com internet e aguarde “Pronto offline”. Use **Instalar** quando o navegador oferecer a opção. Se aparecer **Atualizar**, essa ação conclui o salvamento antes de recarregar. Para validar offline localmente, rode `pnpm.cmd build` seguido de `pnpm.cmd preview`. Use o mesmo endereço do preview ao recarregar.

## Formato `.board` v1

Um `.board` é um ZIP de um único volume com entradas Store (0) ou Deflate (8). Os JSON usam UTF-8. Os caminhos internos usam `/`.

| Entrada | Conteúdo |
| --- | --- |
| `manifest.json` | Objeto com `format: "board"`, `version: 1`, `scenePath: "scene.json"` e `assets`. Cada item em `assets` tem `id`, `path: "assets/<id>"`, `mime` e `size` em bytes. Use `assets: []` quando a lousa não tiver arquivos incorporados. |
| `scene.json` | Objeto com `version: 1` e lista `objects`. No Marco 2, cada objeto é um traço (`type: "stroke"`). |
| `assets/<id>` | Bytes do ativo catalogado no manifesto. A importação de PDF e imagens na interface pertence a marcos seguintes. |

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

Licença do projeto: [MIT](LICENSE). A regra do plano admite MIT, Apache-2.0, BSD, ISC e Zlib, além de OFL-1.1 para fontes. GPL e AGPL são vetadas para código. O SDK do tldraw fica fora do projeto.

Licenças declaradas pelos pacotes do Marco 2, incluindo dependências transitivas. As versões exatas estão no `pnpm-lock.yaml`.

| Licença | Pacotes |
| --- | --- |
| MIT | `fflate`, `perfect-freehand`, `rbush`, `react`, `react-dom`, `scheduler`, `zustand` |
| MIT | `@esbuild/*`, `@types/node`, `@types/rbush`, `@types/react`, `@types/react-dom`, `csstype`, `esbuild`, `undici-types` |
| Apache-2.0 | `typescript` |
| ISC | `idb`, `quickselect` |

O pacote opcional com o binário do esbuild varia conforme o sistema operacional e a arquitetura. Consulte as licenças instaladas na sua plataforma com o comando abaixo.

```powershell
pnpm.cmd --config.store-dir=.pnpm-store licenses list --json
```

O inventário acima cobre as licenças declaradas no npm. Os avisos do TypeScript 5.9.3 registram termos do W3C e CC BY 4.0 para material da especificação do DOM. O compilador é usado localmente para verificar tipos. O build da lousa deixa o compilador e as declarações de tipos fora dos arquivos distribuídos.
