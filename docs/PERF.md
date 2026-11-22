# Desempenho da lousa

## Referência do Marco 1

Com 10 mil traços distribuídos pela cena, o pan e o zoom ficaram próximos de **60 FPS** nas três repetições em Chrome e Edge. Com os **10 mil traços visíveis ao mesmo tempo**, o pan e o zoom ficaram abaixo de 60 FPS em todas as configurações. A escrita com câmera estática ficou dentro da meta de 33 ms no p95 nas 24 repetições. O usuário autorizou avançar para o Marco 2 com essa limitação. O renderizador de referência usa cache de `Path2D` e culling via RBush.

### Método

- Medição em 22/11/2026, em build de produção local do Marco 1. Windows Arm64, build 10.0.26300, Snapdragon X Elite X1E80100, 12 processadores lógicos. GPU Qualcomm Adreno X1-85, driver 31.0.148.0. Os navegadores informaram aceleração de Canvas 2D, rasterização e composição por GPU habilitadas.
- Chrome 157.0.8103.80 e Edge 158.0.4370.33 em modo headless. Viewport de 1920 × 1080 pixels CSS em DPR 1 e 2. A área da lousa ocupa o espaço entre as barras da interface.
- Semente `24301`, 12 pontos por traço, 3 repetições por navegador, DPR e cenário. Cada trecho de pan e zoom foi medido por 120 intervalos de `requestAnimationFrame`, após 24 frames de aquecimento. O teste de escrita simulou um gesto de mouse com a câmera parada, capturando 120 ou 121 amostras de desenho ao vivo por repetição.
- Os FPS são estimados pelos intervalos de `requestAnimationFrame`. Conta-se como atrasado o intervalo maior que 25 ms. A latência do traço mede o instante do evento até o fim da chamada de desenho, incluindo espera por frame. A apresentação física no monitor, o compartilhamento pelo Meet e o Firefox requerem testes próprios.

### Resultados

As tabelas usam a mediana de três repetições. Os percentis são calculados por repetição. Onde indicado, os intervalos são o mínimo e o máximo observados entre as três repetições.

| Navegador | DPR | Pan distribuído (FPS) | Zoom distribuído (FPS) | Pan denso (FPS) | Zoom denso (FPS) | Escrita distribuída / densa, p95 (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| Chrome | 1 | 60,0 | 60,0 | 21,6 | 22,2 | 21,7 / 17,1 |
| Chrome | 2 | 60,0 | 60,0 | 22,7 | 34,4 | 22,2 / 16,0 |
| Edge | 1 | 60,0 | 60,0 | 34,0 | 32,7 | 18,0 / 19,3 |
| Edge | 2 | 60,0 | 60,0 | 3,3 | 2,6 | 18,0 / 22,9 |

O cenário distribuído começou com 1.300 traços visíveis, variando de 1.250 a 1.326 no pan e 968 a 1.800 no zoom. O intervalo p50 de frame foi 16,7 ms em todas as repetições distribuídas. O p95 variou entre 16,8 e 17,3 ms no conjunto. Houve até 3 intervalos de pan e 5 de zoom acima de 25 ms em uma repetição. O cenário denso manteve 10 mil traços visíveis e zero faltas de cache nas janelas medidas de pan e zoom.

| Navegador | DPR | Pan denso, p50 / p95 / p99 (ms) | Zoom denso, p50 / p95 / p99 (ms) | Atrasados no pan / zoom, de 120 | Primeiro desenho denso, cache frio (ms) |
| --- | --- | --- | --- | --- | --- |
| Chrome | 1 | 49,7 / 83,4 / 83,6 | 49,7 / 83,4 / 99,9 | 79 / 76 | 29,5–47,0 |
| Chrome | 2 | 33,4 / 83,4 / 100,2 | 33,2 / 50,0 / 50,3 | 76 / 73 | 26,8–71,6 |
| Edge | 1 | 33,3 / 50,0 / 83,3 | 33,2 / 50,2 / 83,1 | 69 / 67 | 33,3–64,5 |
| Edge | 2 | 266,8 / 450,0 / 566,7 | 382,9 / 533,6 / 600,1 | 120 / 120 | 62,4–198,6 |

A preparação da cena e do índice levou 80,6–251,2 ms no conjunto. O primeiro desenho a frio do cenário distribuído levou 4,4–18,9 ms. Na escrita, o maior p95 foi 24,5 ms. Uma repetição densa no Edge em DPR 2 teve p99 de 75,8 ms.

### Reproduzir

```powershell
pnpm.cmd build
pnpm.cmd bench --hidpi
```

`test-results/perf-*.json` recebe as medições por repetição. Use `chrome` ou `msedge` como argumento adicional para selecionar um navegador e `--headed` para medir com janela visível. Guarde os resultados de uma rodada antes de rodar outra com o mesmo navegador e DPR. A comparação com 50 mil traços continua como objetivo de capacidade.
