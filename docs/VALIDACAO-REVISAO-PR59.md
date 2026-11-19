# Revisão do PR #59 — Detalhamento e Memória

Integra a contribuição de @guinardelli (`6189a6195c837b60faaf95c20bb64777dc2d3e3d`) sobre a master `3e99a5e4a7bbbfa88bfe5e9e1d2139bd059d4219`, preservando seu commit. Referência: [issue #54](https://github.com/ricardocorsini/consolo-struct/issues/54).

## Escopo e correções da revisão

- Detalhamento reutiliza a chave enquanto projeto, peça e escopo não mudam; no escopo individual, o worker recebe metadados do projeto e somente a peça solicitada. Todos os consolos continuam recebendo o projeto completo.
- Detalhamento/Memória ocultos ignoram novas propriedades até serem reativados. A reativação recebe os dados, resultados e callbacks atuais. O comparador original retornava sempre `false` nas abas visíveis: a revisão restaura a comparação superficial que `memo` já fazia.
- A seleção de seções visíveis usa primeiro/último índice e só aloca a lista quando a faixa muda. Isso depende das seções ordenadas, não sobrepostas, produzidas por `DetailBuilder`.
- A soltura incorpora a última coordenada mesmo sem `pointermove` intermediário. O gesto só é encerrado pelo ponteiro correto; uma segunda entrada não substitui o arrasto ativo.
- Troca de peça/escopo/aba, fit/F, Escape, resize, blur, cancelamento e perda de captura encerram o arrasto. A troca de contexto cancela o frame pendente e a reativação redesenha com a câmera lógica atual, evitando aplicar um gesto antigo ao contexto novo.
- Não altera motor de cálculo, formato do projeto, geometria física, modelo 3D, dependências ou fórmulas de exportação.

## Evidência de custo menor, com limites

Fixture sintética versionada em `tests/reference/views59.ts`: cenário leve de 1 peça sem combinações adicionais; cenário maior de 20 peças com 20 combinações adicionais por peça, alternando N3 de 2/4 ramos. Não usa projetos reais.

Comando reproduzível: `node scripts/benchmark-views.mjs`. Microbenchmark isolado de `structuredClone`, Node v24.22.1, Linux x64, AMD EPYC 9V74. Dez rodadas de aquecimento; 100 amostras de 100 operações cada; ordem completa/reduzida alternada. Mediana/p95 abaixo são dos tempos médios por operação de cada lote, não percentis de latência de eventos da interface.

| Cenário                             | JSON completo → individual | Cópia completa mediana / p95 | Cópia individual mediana / p95 |
| ----------------------------------- | -------------------------- | ---------------------------- | ------------------------------ |
| 1 peça, 0 combinações adicionais    | 2.136 → 2.136 bytes        | 0,0101 / 0,0202 ms           | 0,0102 / 0,0203 ms             |
| 20 peças, 20 combinações adicionais | 67.127 → 3.486 bytes       | 0,3544 / 0,3853 ms           | 0,0194 / 0,0222 ms             |

No cenário maior, são aproximadamente 94,8% menos bytes JSON representando o objeto enviado no escopo individual. `postMessage` usa clonagem estruturada, não transporte JSON; os bytes servem como indicador reproduzível do volume de dados. O escopo de todas as peças não tem essa redução.

**Isso não mede FPS, tempo de abertura, latência percebida, heap ou Tauri/WebKit.** Os tempos variam por hardware e runtime. As medições únicas do autor no Chromium/Windows não demonstram melhora geral: abertura fria do Detalhamento 392→405 ms, todas as peças 378→367 ms, cálculo da Memória 64→75 ms, PDF 194→183 ms. Não se conclui que a lentidão reportada esteja resolvida.

Uma comparação estática com `v0.7.1` mostrou `TechnicalViewport`, serviço e job de detalhamento inalterados na master anterior a esta integração. Isso confirma a arquitetura preexistente de worker/cache/rAF; não substitui executar a versão estável e a nova no mesmo computador.

## Regressões automatizadas

- `tests/retained-views.test.ts`: comparação das propriedades e callbacks; mesma chave, bundle, quantitativos, SVG, DXF, CSV e PDF para o projeto completo e reduzido, selecionando primeira, segunda e última peça. PDF ignora apenas data de criação e identificador aleatório; conteúdo comprimido, dimensões e estrutura continuam comparados.
- `tests/e2e/retained-views.spec.ts`: carga individual/todas, retenção de expansão da Memória, nenhuma atualização enquanto oculta, nova quantidade/altura após retorno, aviso de resultado desatualizado, seleção de outra peça, recalcular e exportar com callback atual, CSV da quantidade nova, posição final do pan, âncora do zoom e cancelamento em nove transições.
- O E2E anexa as contagens/tamanhos efetivamente enviados aos workers e captura da interface com 20 peças. Os cenários preexistentes de navegação, falha do worker, câmera, quadros e exportações permanecem na suíte.
- `npm run check`: 453 testes passaram localmente. Formatação, build, E2E completo e verificações nativas são executados pelo CI da integração. Resultados finais e artefatos ficam vinculados na descrição do PR.

## Pendência mantida na #54

Reproduzir a lentidão no Tauri/Linux e comparar `v0.7.1` e o SHA integrado no mesmo ambiente/projeto: aberturas frias/quentes, alternância, pan/zoom, edição, cálculo/expansão da Memória e exportação. Repetir amostras, medir mediana/p95, frames longos e heap, registrando SO, WebKit, hardware e dimensões. A Memória continua calculando na thread principal; esta contribuição não muda esse caminho. Testes nativos do CI validam atualização/instalação e não constituem medição de fluidez. A issue #54 permanece aberta.
