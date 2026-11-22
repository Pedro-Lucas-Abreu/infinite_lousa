# Plano da lousa digital de matemática

O plano foi aprovado com os ajustes desta revisão. A proposta é uma PWA gratuita, com código próprio sob licença MIT, interface em português do Brasil e código, comentários e identificadores em inglês. O público inicial usa mouse no Windows, com Chrome e Edge como navegadores prioritários e Firefox como secundário.

## 1. Arquitetura

A aplicação será distribuída como arquivos estáticos. Cada lousa, PDF e imagem fica no dispositivo do professor. O Google Meet recebe o compartilhamento da aba pelo próprio navegador. A aplicação funciona sem conta, backend, colaboração em tempo real, telemetria ou serviços externos em tempo de execução.

| Área | Responsabilidade |
| --- | --- |
| Interface | React e Zustand para ferramenta ativa, preferências, diálogos, lista de quadros e estado de salvamento. Atalhos passam pelo mesmo conjunto de ações dos botões. |
| Cena | TypeScript estrito, sem dependência do DOM. Aplica comandos reversíveis, resolve transformações, ordenação e seleção. |
| Entrada e desenho | Controladores de Pointer Events e câmera, renderizador Canvas 2D próprio e índice RBush. Movimento do mouse e animação rodam fora do ciclo de renderização do React. |
| Documento | IndexedDB para recuperação, ZIP para `.board`, adaptadores de arquivo e edição local. PDF.js e rotinas de arquivo/exportação com trabalho pesado em workers. |
| Exportação | Uma descrição de desenho compartilhada por Canvas, SVG e PDF. O exportador lê um snapshot da revisão selecionada e resolve os ativos locais. |
| PWA | Vite para desenvolvimento e build estático. Manifesto e service worker próprios, com pré-cache versionado dos recursos locais. |

### Modelo da cena

- `Scene` tem `id`, revisão, configuração de fundo, objetos indexados por `id` e uma lista ordenada de quadros. Cada `SceneObject` contém `id`, `type`, `transform`, `zIndex`, `locked` e `props` tipadas por `type`. Empates de ordem têm desempate estável por `id`.
- As coordenadas do mundo usam números em precisão dupla com Y para baixo. A geometria é local ao objeto, com transformação afim `[a, b, c, d, e, f]` que mapeia `(x, y)` para `(ax + cy + e, bx + dy + f)`. O índice usa caixas de mundo conservadoras, incluindo espessura e rotação. Câmera e preferências podem ser restauradas, mas seleção, cursor, índices, bitmaps e caches são derivados ou transitórios.
- `stroke` guarda pontos filtrados em coordenadas locais, pressão medida quando disponível, estilo, opacidade e versão do algoritmo. A aparência exportável é um contorno vetorial derivado da geometria e do perfil gravado. Fragmentos da borracha também guardam o recorte vetorial necessário para conservar a largura e o acabamento junto ao corte.
- `shape` contém geometria e estilo de linha, seta, retângulo, elipse ou polígono. `text` guarda texto, estilo e medidas de layout. `equation` guarda LaTeX, modo de exibição e estilo. `image` guarda a referência ao ativo e suas dimensões. `pdfPage` guarda `assetId`, índice de página começando em zero, geometria original e transformação para o mundo.
- `frame` é uma região retangular nomeada com ordem própria. A ordem define navegação e exportação. Quadros delimitam regiões e não duplicam os objetos. A câmera pode enquadrar qualquer quadro, inclusive os de proporção diferente de 16:9.
- Cada PDF é armazenado uma vez. Por padrão, tinta iniciada sobre uma página fica ancorada àquela página e a acompanha quando ela se move. A transformação local mantém a anotação independente para editar e apagar. Travar uma página impede sua seleção e transformação direta, deixando a escrita livre, e um controle no painel de páginas permite destravá-la. Ao excluir uma página, as anotações ficam na lousa na mesma posição e a ação é reversível.

## 2. Entrada, câmera e desenho

1. Capturar ponteiro e manter `touch-action` restrito à lousa. Consumir `getCoalescedEvents()` quando disponível, com fallback para o evento original. Tratar cancelamento, perda de captura, mudança de foco, clique que vira ponto, dois dedos para navegação e saída do canvas.
2. Filtrar as amostras em pixels CSS antes de convertê-las ao mundo. O filtro One Euro adapta a suavização à velocidade. O estabilizador de 0 a 100 controla a pré-filtragem e ajusta parâmetros do pincel em conjunto. Em 0, desativar a pré-filtragem. Calibrar atraso, cantos e pontas com escrita rápida em mouse real antes de fixar os valores iniciais.
3. Gerar o contorno com `perfect-freehand`. Usar `simulatePressure` no mouse e quando não houver pressão útil. Usar pressão medida para caneta e touch capazes de fornecê-la. Ajustar `streamline`, `smoothing` e espessura por ferramenta. Renderizar no máximo uma vez por `requestAnimationFrame`, com contorno final no término do gesto. Tratar traços longos em testes de custo por frame antes de decidir se é necessário estabilizar um prefixo e recalcular só a cauda. [Pointer Events](https://www.w3.org/TR/pointerevents3/) · [One Euro](https://gery.casiez.net/1euro/) · [perfect-freehand](https://github.com/steveruizok/perfect-freehand)
4. Usar dois canvases do tamanho da janela útil, dimensionados em pixels físicos pelo DPR. O estático contém fundo e objetos confirmados. O canvas ao vivo contém o traço atual e demais itens transitórios de interação, como cursor, seleção de gesto, laser e spotlight. Confirmar o traço e atualizar o índice sem deixar um frame em branco entre as duas camadas.
5. Guardar a câmera como centro e escala, com zoom logarítmico ancorado no cursor. Subtrair a origem da câmera antes de multiplicar pela escala. Grade adaptativa, culling e região de trabalho dependem da câmera, sem alocação de uma superfície para todo o mundo. Testar deslocamentos distantes, reversibilidade e zoom extremo com guardas contra perda de precisão, valores não finitos e overflow. O pan e o zoom não têm bordas de página. Precisão numérica e resolução do dispositivo definem os extremos verificáveis.
6. Consultar RBush para viewport e hit-testing, carregar em lote na abertura e atualizar só os objetos afetados pelo comando. Ordenar candidatos por Z e, em seguida, testar geometria exata em coordenadas locais. Considerar índice por segmentos para traços muito longos. A seleção tem tolerância em pixels CSS. A borracha parcial usa o caminho varrido e reverte em uma única ação. [RBush](https://github.com/mourner/rbush)
7. Cachear `Path2D` por revisão de objeto e combinar o cache com culling por viewport via RBush. O Marco 1 mede a meta inicial de 10 mil traços a 60 FPS com essa arquitetura. Se o benchmark falhar, registrar as medições e avisar o usuário antes de implementar tiles com `OffscreenCanvas`. Se adotados, os tiles usam escala, DPR e alinhamento compatíveis, com redesenho vetorial no zoom ou quando não houver tile válido. [Canvas 2D e OffscreenCanvas](https://html.spec.whatwg.org/multipage/canvas.html)

## 3. Histórico, recuperação e `.board`

Cada intenção concluída, como escrever, mover um grupo ou apagar um pedaço de traço, produz um comando com as mudanças e suas inversas. Movimentos intermediários são prévias. O histórico persiste em IndexedDB com cursor de undo/redo, sem teto arbitrário de ações. Uma nova edição após desfazer descarta o redo anterior. Ativos compartilhados são referenciados por ID e ficam retidos enquanto alcançáveis pela cena ou pelo histórico.

O autosave enfileira edições concluídas e grava objetos alterados, comandos, revisão, cursor de histórico e ativos relevantes em uma transação. A última revisão confirmada é o ponto de recuperação. Mostrar “Salvando…” durante a gravação e “Salvo neste navegador” após a confirmação. Em falha ou falta de espaço, manter as mudanças pendentes e permitir salvar uma cópia portátil. Solicitar armazenamento persistente quando disponível e usar `visibilitychange` como oportunidade extra de gravação. Interrupção antes do commit, limpeza de dados do navegador e falta de espaço têm limites que o status de salvamento deve tornar visíveis. [IndexedDB](https://www.w3.org/TR/IndexedDB-3/) · [Ciclo de vida da página](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)

### Contrato proposto do arquivo v1

| Entrada ZIP | Conteúdo |
| --- | --- |
| `manifest.json` | JSON UTF-8 com `format: "board"`, `version: 1`, `scenePath: "scene.json"` e catálogo de ativos com ID, caminho, MIME e tamanho. |
| `scene.json` | JSON UTF-8 com o snapshot editável da cena, fundo, ordem dos quadros e câmera inicial opcional. |
| `assets/<id>` | Bytes originais de PDFs e imagens. Caminhos internos usam `/`. PDF é referenciado por ID e índice de página. |

- Usar ZIP padrão com métodos Store e Deflate. A versão identifica o contrato inteiro. Incluir no README a especificação, unidades, campos obrigatórios, tipos de objetos, exemplos e limites. O arquivo portátil representa a revisão salva. O histórico de recuperação da sessão fica no IndexedDB.
- Em worker, verificar versão, esquema, contagem e nomes únicos de entradas, dados numéricos finitos, transformações, tamanhos declarados dos ativos, IDs e referências. Limitar expansão real por entrada e no total. Validar e migrar antes de instalar a cena em uma transação, preservando a lousa ativa se a abertura falhar. Testar arquivos truncados, referências ausentes e versões desconhecidas.
- Em Chrome e Edge, abrir seletores a partir do gesto do usuário e confirmar salvamento só depois de fechar a escrita. Pedir permissão quando o handle reutilizado exigir. Fallback de abrir por seletor/upload local e salvar por download quando a API não estiver disponível ou o usuário escolher baixar. Cancelar o seletor encerra a ação. [File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)

Depois do Marco 5, avaliar com baixa prioridade a detecção de duas abas editando a mesma lousa, o hash SHA-256 por ativo e checkpoints de histórico para acelerar a reabertura. Arquivos `.board` iniciais devem continuar legíveis após a adoção de verificações adicionais.

## 4. PDFs, equações e exportação

### PDFs na lousa

- Importar o original como `Blob` imutável e passar uma cópia dos bytes à biblioteca. Criar objetos de página em ordem, com dimensão e rotação de cada uma. Cancelar trabalhos quando o documento ou a câmera tornar o resultado obsoleto.
- No Marco 3, executar protótipos de todas as APIs de PDF.js e da biblioteca de exportação que serão usadas. Registrar versão, API, fixture, resultado e alternativa para cada incompatibilidade. Comparar `pdf-lib` com um fork mantido, como `@cantoo/pdf-lib` se confirmado no marco, antes de escolher, verificando licença, atividade de manutenção, comportamento em navegador e os mesmos testes de exportação. [Repositório do fork Cantoo](https://github.com/cantoo-scribe/pdf-lib)
- No protótipo de PDF.js, validar abertura, leitura de páginas, dimensões, rotação, rasterização, cancelamento e os mecanismos candidatos `workerSrc`, `rendererSrc` e `RenderTask.isWorkerRendering`. Exercitar Chrome e Edge, com teste secundário no Firefox. Priorizar a área visível, ajustar a resolução da prévia ao zoom e ao DPR e limitar dimensões, trabalhos simultâneos e memória. Um PDF escaneado mantém a resolução do original. [PDF.js](https://github.com/mozilla/pdf.js) · [Configuração dos workers](https://github.com/mozilla/pdf.js/blob/v6.5.438/src/display/worker_options.js) · [RenderTask](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-RenderTask.html)
- Testar fontes embutidas, substituição local de fontes ausentes, páginas recortadas, PDFs grandes e escaneados. Recusar importações sem suporte com mensagem em português e preservar a cena existente. PDFs cifrados ou protegidos dependem de suporte para leitura **e** exportação com preservação, a verificar no marco de PDF.

### Equações editáveis

- `Q`, digitação e Enter inserem a equação. Duplo clique reabre o LaTeX original. O editor mostra falhas junto à expressão e Esc cancela. O mesmo layout deve participar de Z, seleção e exportação.
- No Marco 4, prototipar KaTeX com suas fontes OFL-1.1 e MathJax com saída SVG. Usar o mesmo conjunto de expressões para comparar frações, radicais, índices, expoentes, letras gregas, delimitadores, matrizes, somatórios, integrais e texto em português. Publicar exemplos e a quantidade de expressões atendidas, o tempo em ms da inicialização até a primeira expressão pronta com cache frio e quente, os bytes do bundle de produção incluindo fontes, e o trabalho necessário para gerar primitivas vetoriais para Canvas e PDF. Verificar o resultado do PDF com suas operações vetoriais. Escolher com base nos resultados e apresentá-los ao usuário. Considerar `opentype.js` e Go Fonts somente se os dois protótipos não atenderem aos requisitos. [Opções do KaTeX](https://katex.org/docs/options) · [Saída SVG do MathJax](https://docs.mathjax.org/en/latest/output/svg.html)

### Exportação

- **PDF por quadros.** Um quadro por página, na ordem definida. Recortar cada página à região e compor objetos em Z, convertendo mundo com Y para baixo para PDF com Y para cima. Em **Tudo**, usar a caixa de todo o conteúdo, inclusive o que estiver fora dos quadros. Em extensões que ultrapassem o tamanho de página compatível com leitores, oferecer paginação e mostrar as dimensões antes de exportar.
- **Tinta vetorial.** Emitir operações de caminho e preenchimento a partir dos mesmos contornos da tela, com opacidade do marca-texto. Formas também usam caminhos. Cursor, spotlight, laser, seleção e guias de quadro pertencem apenas à visualização.
- **Fundo PDF original.** Embutir conteúdo e recursos da página a partir dos bytes originais como Form XObject via `embedPage` ou adaptador equivalente. Compor as matrizes de `CropBox`/`MediaBox`, `/Rotate`, `/UserUnit`, transformação na cena e recorte do quadro. Evitar dupla inversão e dimensionamento por dimensões inferidas da prévia. Testar páginas com transparência, anotações ou formulários já presentes. `embedPage` copia o conteúdo e os recursos, por isso as aparências que ficam em estruturas separadas exigem preservação vetorial adicional ou aviso explícito de incompatibilidade antes da exportação. [API `embedPage`](https://pdf-lib.js.org/docs/api/classes/pdfdocument#embedpage) · [Implementação do embedder](https://github.com/Hopding/pdf-lib/blob/master/src/core/embedders/PDFPageEmbedder.ts)
- **SVG e PNG.** SVG exporta tinta e formas como caminhos, com imagens e prévias das páginas PDF incorporadas como ativos raster. PNG usa renderização dedicada na resolução escolhida. Os limites de dimensões e memória para exportação raster ficam visíveis, com redução explícita de resolução quando necessária.

## 5. Uso em aula e offline

- Ferramentas principais em barra reposicionável com alvos grandes. Seis favoritos guardam cor e espessura e podem ser aplicados por clique ou teclas `1` a `6`. Estabilizador, tema, escala de UI e tamanho padrão do texto ficam disponíveis nas configurações. Fundos infinitos branco, escuro, pontilhado, quadriculado e milimetrado. Grade de milímetros na cena com referência nominal de 96 unidades por polegada a 100% de zoom.
- Pan por botão do meio, Espaço + arrastar, Ctrl + arrastar ou ferramenta mão. Zoom com scroll, opção de exigir Ctrl, atalhos `+`/`−` e foco no cursor. Minimapa e “Voltar ao conteúdo” reenquadram a cena.
- O mapa inicial de atalhos usa `P` para caneta, `H` para marca-texto, `E` para borracha, `V` para seleção retangular, `B` para laço, `T` para texto, `Q` para equação, `L` para linha, `A` para seta, `R` para retângulo, `O` para elipse, `G` para polígono e `M` para mão. Segurar `X` ativa a borracha temporária. Arrastar com botão direito pode apagar ou mover a câmera, conforme preferência. `Shift` trava ângulos em múltiplos de 45° e limita a proporção das formas. A ajuda lista atalhos de ferramentas, arquivo, exportação, edição e navegação. Editores e diálogos preservam as teclas de digitação e navegação.
- Seleção retangular ou por laço, com mover, redimensionar, girar, duplicar e deletar. Snapping a grade, pontos relevantes e guias conforme ferramenta e configuração. Borracha de traço inteiro e parcial. Importar imagens locais por colagem ou arraste. Ctrl+Z, Ctrl+Y e Ctrl+Shift+Z operam sobre comandos.
- `F` ativa a apresentação. A área de desenho cresce quando os controles recolhem. Mover o mouse até a borda revela uma faixa de UI que reserva espaço no layout, com câmera estável, mantendo controles fora do conteúdo desenhado. O canvas exibe cursor com ferramenta, cor e espessura e opção de esconder o cursor nativo. `K` ativa laser e `S` spotlight. Quadros podem ser criados, reordenados e percorridos com setas. “Enquadrar quadro” centraliza e ajusta a região sem cortar bordas, com preset 16:9 na criação.
- Pré-cache de uma versão completa, incluindo chunks carregados sob demanda, workers e ativos auditados. Indicar prontidão offline após confirmação. Atualizações aguardam uma troca segura de versão e salvamento concluído, sem recarregar a aba durante a aula. Testar instalação e reabertura por HTTPS ou `localhost`. Chrome e Edge têm prioridade na instalação. Testar Firefox para uso offline com as opções de instalação disponíveis na versão utilizada. Para o Meet, usar a aba da lousa no navegador. [Service Workers](https://www.w3.org/TR/service-workers/) · [Manifesto](https://www.w3.org/TR/appmanifest/) · [Apps web no Firefox para Windows](https://support.mozilla.org/en-US/kb/web-apps-firefox-windows) · [Compartilhamento no Google Meet](https://support.google.com/meet/answer/9308856)

## 6. Dependências propostas e licenças

Inventário inicial. A coluna indica a licença declarada ou candidata para os componentes selecionados. A adoção depende do artefato exato, incluindo o código embutido, arquivos auxiliares e dependências transitivas do runtime e do desenvolvimento. Fixar versões, registrar origem e integridade, conservar avisos e publicar a lista completa no README a cada marco que mexer em dependências.

| Componente | Licença | Uso e condição |
| --- | --- | --- |
| [React e React DOM](https://github.com/facebook/react/blob/main/LICENSE) | MIT | Interface. |
| [Zustand](https://github.com/pmndrs/zustand/blob/main/LICENSE) | MIT | Estado da interface. |
| [perfect-freehand](https://github.com/steveruizok/perfect-freehand/blob/main/LICENSE) | MIT | Contornos com pressão simulada ou real. |
| [RBush](https://github.com/mourner/rbush/blob/main/LICENSE) e [quickselect](https://github.com/mourner/quickselect/blob/main/LICENSE) | MIT e ISC | Índice espacial e sua dependência. |
| [idb](https://github.com/jakearchibald/idb/blob/main/package.json) | ISC | Interface TypeScript para IndexedDB. |
| [fflate](https://github.com/101arrowz/fflate/blob/master/LICENSE) | MIT | ZIP e compressão Deflate/zlib. |
| [KaTeX](https://github.com/KaTeX/KaTeX/blob/main/LICENSE) | MIT no motor, OFL-1.1 nas fontes | Protótipo do Marco 4 com as fontes oficiais. [Licença das fontes](https://github.com/KaTeX/KaTeX/issues/339) |
| [MathJax](https://github.com/mathjax/MathJax-src/blob/master/LICENSE) | Apache-2.0 no motor | Protótipo do Marco 4 com saída SVG e auditoria dos dados de glifos e fontes da distribuição. |
| [opentype.js](https://github.com/opentypejs/opentype.js/blob/master/LICENSE) e [Go Fonts](https://go.dev/blog/go-fonts) | MIT e BSD-3-Clause | Alternativas condicionais ao resultado dos dois protótipos de equações. [Licença das fontes](https://github.com/golang/image/blob/master/font/gofont/ttfs/README) |
| [PDF.js](https://github.com/mozilla/pdf.js/blob/master/LICENSE) | Apache-2.0 no motor | Usar recorte auditado da distribuição com API e workers. CMaps, substitutos de fontes, ICC e decodificadores WASM passam por auditoria individual. Excluir Liberation Sans 1.07.4 sob GPL-2.0 com exceção de fontes. Validar substituição do sistema e ativos permitidos. [Correção de licença no PDF.js](https://github.com/mozilla/pdf.js/pull/21750) |
| [pdf-lib](https://github.com/Hopding/pdf-lib/blob/master/LICENSE.md), [standard-fonts](https://github.com/Hopding/standard-fonts/blob/master/LICENSE.md) e [UPNG](https://github.com/Hopding/upng/blob/master/package.json) | MIT nas bases | Candidatos para exportação, sujeitos a protótipo e comparação com um fork mantido. [Dependências de pdf-lib](https://github.com/Hopding/pdf-lib/blob/master/package.json) |
| [pako](https://github.com/nodeca/pako/blob/1.0.11/package.json) | MIT AND Zlib na versão de referência | Dependência autorizada de compressão do `pdf-lib`. Preservar a dependência e os avisos aplicáveis se adotada a biblioteca. |
| [tslib 1.11.1](https://github.com/microsoft/tslib/blob/1.11.1/package.json) | Apache-2.0 | Dependência transitiva candidata do pdf-lib. Confirmar avisos no artefato a incorporar. |
| [TypeScript](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt) e [Vite](https://github.com/vitejs/vite/blob/main/LICENSE) | Apache-2.0 e MIT | Checagem e build. Validar também bundler, tipos, licenças encadeadas e binários de desenvolvimento. |
| [Vitest](https://github.com/vitest-dev/vitest/blob/main/LICENSE) e [Playwright](https://github.com/microsoft/playwright/blob/main/LICENSE) | MIT e Apache-2.0 | Testes. Priorizar canais Chrome/Edge instalados no Windows. Firefox pode passar por roteiro manual quando a distribuição automatizada não se enquadrar no inventário. |
| [mathjs](https://github.com/josdejong/mathjs/blob/develop/LICENSE) | Apache-2.0 | Candidata apenas para a Fase 2, sujeita à mesma auditoria. |

O build e o inventário aceitam MIT, Apache-2.0, BSD, ISC e Zlib, além de OFL-1.1 exclusivamente para fontes. GPL e AGPL continuam vetadas no código, assim como o SDK do tldraw. Dependências ambíguas, fora da lista ou sem atribuição verificável precisam ser substituídas ou removidas antes da adoção. Em distribuições mistas, provisionar por lista de arquivos permitidos e checksums. O npm e os avisos de pacote são apenas uma entrada da auditoria. Fontes do sistema usadas pelo navegador e arquivos do professor continuam locais. A lousa usa renderizador próprio, com Whiteboard, Excalidraw, Xournal++ e tldraw apenas como referências de interação.

## 7. Marcos e verificação

### Fase 1

| Marco | Entrega | Aceite antes de avançar |
| --- | --- | --- |
| 1. Câmera e tinta | Núcleo da cena, pan e zoom, caneta com mouse, estabilizador, duas camadas, cache de `Path2D`, culling e RBush. | Abrir o build, escrever com mouse e medir 10 mil traços a 60 FPS. Verificar nitidez no zoom, pressão simulada no mouse e latência. Se a meta falhar, comunicar o resultado antes de implementar tiles com `OffscreenCanvas`. |
| 2. Documentos locais | Comandos, undo/redo, recuperação, `.board`, seletores, fallback, PWA instalável offline e deploy gratuito no GitHub Pages ou Cloudflare Pages. | Validar ida e volta, fechar/reabrir, histórico, erro de importação e falha de gravação. Testar o build implantado por HTTPS e repetir os testes offline. Entregar a URL para uso em aula e registrar os problemas relatados. |
| 3. PDF e quadros | Protótipos das APIs de PDF.js e `pdf-lib`, avaliação de um fork mantido, importação, movimento/trava, anotações, quadros, navegação e exportação. | Executar os protótipos com fixtures antes da escolha de biblioteca. Confirmar rasterização em worker, comparar conteúdo, ordem, recorte e fundo e verificar os operadores vetoriais da tinta no PDF. Repetir benchmark com PDF ativo. |
| 4. Ferramentas e LaTeX | Marca-texto, borracha total/parcial, seleção e transformação, formas/snapping, texto, imagens e equações. | Testar as ferramentas e publicar medições comparáveis de KaTeX com fontes OFL-1.1 e MathJax SVG. Validar criação e edição de equações, vetores no Canvas e PDF e repetir a inspeção de tinta vetorial. |
| 5. Aula e apresentação | Fundos, temas, minimapa, voltar ao conteúdo, barra/favoritos, apresentação, cursor, laser, spotlight, enquadramento 16:9, PNG e SVG. | Conferir captura da aba em uma chamada real do Meet com um segundo participante, verificar exportações e tarefa de aula em Windows, Chrome e Edge. Validar o fluxo principal no Firefox. |
| 6. Fechamento da fase | Correções de integração, documentação, inventário de licenças e checklist manual em português. | Rodar build, testes, benchmark de regressão e roteiro final, com resultado ou pendência de cada critério. |

Em cada marco, rodar a aplicação, repetir os testes pertinentes, atualizar `CLAUDE.md` com convenções e decisões e registrar verificações e pendências. Fazer commits pequenos e descritivos por mudança verificada.

No Marco 2, escolher o serviço pelo custo, pelo acesso ao repositório e pela configuração de assets e escopo do service worker. GitHub Pages no GitHub Free exige repositório público. Cloudflare Pages é a alternativa para manter o repositório privado. Entregar uma versão estática acessível por HTTPS e registrar os relatos de aula com versão, ambiente, passos, impacto e situação. [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) · [Cloudflare Pages](https://developers.cloudflare.com/pages/configuration/git-integration/)

### Testes automatizados

- **Serialização:** fixtures estáveis de `.board`, ida e volta de objetos e ativos, versão e migração, rejeição de ZIP inválido e recuperação sem sobrescrita.
- **Undo/redo:** ponteiro após nova edição, divisão de traço em uma ação, transformação múltipla, ativos referenciados e restauração pós-reabertura.
- **Hit-testing:** traço fino e grosso, objetos sobrepostos e girados, seleção, trava de página e apagamento parcial em vários zooms.
- **Importação de PDF:** número de páginas, bytes originais, dimensões, origem de recorte, rotação, PDF escaneado, worker ativo, atualização de nível de detalhe, trava e recuperação offline.
- **Exportação de PDF:** reabrir as saídas em PDF.js e checar dimensões, contagem, ordem, recorte e texto/cores de referência. Comparar renderização em duas resoluções para validar alinhamento visual. Inspecionar streams descomprimidos ou lista de operadores. Uma fixture só com tinta deve conter caminhos preenchidos e zero operações de imagem. Uma fixture com fundo vetorial deve manter seus objetos e texto. Uma com fundo escaneado deve preservar a imagem de origem sob a tinta vetorial. Incluir fundo assimétrico com `CropBox` deslocado, rotação e opacidade do marca-texto.
- **Navegador:** smoke test de carregamento, desenho com mouse, salvar/abrir, reload offline, atalhos e configuração de apresentação. Acesso ao seletor nativo, instalação da PWA e recepção real do Meet entram também no roteiro manual, com resultados registrados por navegador.

### Desempenho e teste manual

Em `docs/PERF.md`, registrar hardware, Windows, versões dos navegadores, GPU, aceleração gráfica, resolução, DPR, build, semente, pontos por traço, contagem visível e repetições. No Marco 1, usar cenas determinísticas com 10 mil traços distribuídos e com os 10 mil visíveis. Medir preparação/cache frio, pan com cache quente, zoom contínuo e escrita rápida, em 1080p/DPR 1 e num cenário HiDPI. Repetir com PDF visível quando chegar ao Marco 3. Os 50 mil traços continuam como objetivo de capacidade, além da meta inicial revisada.

Em uma tela de 60 Hz, a meta é sustentar 60 FPS nas interações de referência, com orçamento de 16,67 ms por frame. Registrar FPS, proporção de frames atrasados, tempos p50/p95/p99 e latência da entrada até o primeiro desenho, com meta inicial p95 de 33 ms. Essa instrumentação mede o aplicativo. A latência e a qualidade percebidas no Meet requerem observação no dispositivo do participante. Publicar os números medidos e os casos abaixo da meta. [Referência do Chrome DevTools](https://developer.chrome.com/docs/devtools/performance/reference)

O checklist manual de fim de fase deve incluir escrita de uma equação à mão, anotação em PDF com trava e movimento, enquadramento de slide, salvar/reabrir offline e exportar. No teste real do Meet, compartilhar a aba da lousa com um segundo participante, testar temas claro e escuro, cursor nativo oculto, laser, spotlight, UI na borda e leitura de traço/equações no quadro 16:9. Registrar quais navegadores, tamanhos de janela e condições de rede foram usados. Repetir o teste em cada fase entregue.

### Fases seguintes

- **Fase 2.** Plano cartesiano com eixos, grade, escala, zoom e arraste. Gráficos com `mathjs` e tratamento de descontinuidades. Instrumentos de régua, esquadro, transferidor e compasso com snapping. Reconhecimento de reta, círculo, retângulo e triângulo ao segurar o mouse parado no fim. Templates de eixos, tabelas e folhas de exercícios. Esses itens entram só após a Fase 1.
- **Fase 3, opcional.** Avaliar Tauri se o PWA não atender ao uso. Estudar reconhecimento de escrita para LaTeX em separado, sem compromisso de implementação.

## 8. Riscos e mitigação

| Risco | Mitigação e ponto de decisão |
| --- | --- |
| Culling tem pouco efeito quando quase todos os traços estão visíveis. | Medir o caso denso já no Marco 1 e registrar o custo de desenho. Se o benchmark ficar abaixo da meta, avisar o usuário com os números antes de adicionar tiles com `OffscreenCanvas`. |
| Suavização excessiva atrasa o mouse ou arredonda símbolos. | Calibrar com letras, sinais, frações, ângulos e escrita rápida. Preservar a ponta ao soltar e testar pressão, DPR e zoom. A qualidade do padrão e os extremos de 0 e 100 entram no roteiro. |
| PDF real contém recursos que faltam nos casos simples. | Antecipar provas de compatibilidade, transformações, embutimento, fontes ausentes e aparências. Verificar qualidade do fundo e do worker nos navegadores-alvo. Informar incompatibilidades por arquivo, sem rasterizar a tinta ou substituir silenciosamente o fundo no PDF. |
| Fontes ou dependências de uma distribuição têm licença diferente da raiz. | Auditar versões, arquivos e código transitivo. Preservar os avisos de Zlib e OFL-1.1 em componentes autorizados e verificar substituição das fontes Liberation sob GPL na distribuição de PDF.js. |
| Falha de gravação, limite de quota ou encerramento no meio da operação. | Persistência transacional por gesto, status real, cópia portátil e testes de interrupção. Recuperar a última revisão confirmada e tornar visível qualquer falha de salvamento. |
| O compartilhamento pode reduzir legibilidade mesmo quando a tela local está boa. | Verificar com participante real, quadro 16:9, contraste, espessura e cursor dentro do canvas. Registrar o resultado obtido em aula ou chamada de teste. |
