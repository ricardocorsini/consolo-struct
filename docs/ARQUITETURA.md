# Arquitetura 0.3

O aplicativo usa React/TypeScript no frontend e Tauri 2 para arquivos/janela desktop. O motor é uma biblioteca TypeScript determinística, independente de React, DOM, rede e Tauri. O mesmo código roda no Ubuntu e nas compilações para Windows/macOS, evitando duas implementações normativas divergentes. Não requer servidor Python, FastAPI ou conexão para calcular.

| Módulo                                 | Responsabilidade                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| `src/domain/model.ts`                  | Projeto, unidades, validação, geometria, assinatura das entradas e migração v1→v2 |
| `src/domain/design.ts`                 | Esquema Zod dos dados de dimensionamento e padrões não conferidos                 |
| `src/domain/engine.ts`                 | Materiais, altura útil, modelos, verificações e envelope das combinações          |
| `src/domain/autodesign.ts`             | Busca finita de armaduras; cada candidato chama o mesmo motor                     |
| `src/components/DesignPanel.tsx`       | Edição dos dados específicos de dimensionamento                                   |
| `src/components/CalculationReport.tsx` | Estados, equações, referências e memória numérica                                 |
| `src/lib/exports.ts`                   | Exportações recalculadas, snapshot auditável e geometria CAD                      |

## Contrato do motor

`calculate(piece): CalculationResult` não altera a entrada. O resultado contém versão do motor, política, assinatura, hipóteses, razões de bloqueio, combinações, valores intermediários e verificações. Cada verificação contém identificação estável, exigência, capacidade, unidade, razão, equação, referência, detalhe e estado. Comparações de mínimos usam exigência/capacidade, assim como máximos: uma razão >1 representa falha.

`pass/fail/review` são estados de cálculo. `invalid/unsupported` impedem apresentar uma solução calculada. Dados não finitos não passam como números válidos. Uma combinação não resolve ou mascara a pendência de outra. O envelope escolhe o pior estado de cada verificação e depois a maior razão.

O cálculo é explícito pelo botão; o desenho responde imediatamente à geometria, sem prometer verificação em tempo real. A assinatura inclui todos os dados de cálculo, inclusive parâmetros e combinações. O resultado visível é invalidado após mudança; exportação recalcula sempre.

## Busca discreta

Pesquisa φ 6,3/8/10/12,5/16/20/25 mm em ordem crescente, até 24 ramos e 3 camadas. Alças exigem ramos pares por camada. Recalcula o centroide, classificação e resistências em cada candidato, dimensiona suas quantidades de armadura secundária e recalcula antes de julgá-lo. Filtra armadura principal, concreto, compatibilidade geométrica e as verificações secundárias descritas nos critérios de cálculo. A pontuação continua `área + camadas·0,001 + contagem·0,00001`.

Para cada bitola, testa todas as camadas da primeira contagem viável e encerra essa bitola. Uma contagem que falha não encerra a bitola. A poda só interrompe contagens com área **estritamente maior** que a melhor área encontrada; áreas iguais continuam participando do desempate. `candidates` conta os arranjos efetivamente avaliados após os descartes geométricos, não as chamadas repetidas ao motor.

A busca não é otimizador executivo: não muda seção, aparelhos, diâmetro interno da alça, bitolas secundárias, procedimento de solda, barras do suporte, dados de exposição ou confirmações de execução. Pode devolver arranjo com pendências externas ao conjunto crítico ou com conferências `review`, explicitamente mostradas. Sem solução, cita os rótulos críticos comuns a todos os candidatos; sem interseção, cita as falhas do último arranjo avaliado da maior bitola. Domínios sem resultado calculável são explicados pelas razões do motor. Uma busca sem solução não altera o projeto. Uma sugestão inteira é uma operação reversível no histórico.

## Dados e extensão

Projetos no esquema 5, com migração dos esquemas 1–4. O aço secundário passa de `design.fykTransverse` para `materials.fykTransverse`; tirante legado CA-60 é preservado no arquivo e bloqueado no motor. Esquema 1 migra com parâmetros não conferidos. Resultados não são restaurados do projeto como se fossem atuais. `.calc.json` é uma saída distinta, com todas as entradas e resultados; pode ser usada por auditoria externa.

Para acrescentar um modelo, inclua critérios, domínio, razões de bloqueio, memória e casos independentes antes de habilitá-lo na interface. Dentes Gerber exigem tipo próprio e modelo próprio; não basta inverter o desenho do consolo. ELS exige combinações de serviço e dados adicionais; não reutilizar ações ELU por conveniência.

## Aplicativo 0.4 — vistas 3D

O aplicativo 0.4.0 inclui `src/components/ThreeViewport.tsx`, carregado sob demanda. O contrato de enquadramento/zoom é o mesmo do Viewport 2D. As propriedades, o histórico e o motor permanecem no estado do documento; a câmera é estado da vista.

`src/visualization/model3d.ts` converte as entradas canônicas em contorno, cotas, cargas e eixos de armaduras. `scene3d.ts` gera os objetos Three.js e gerencia seu descarte. O renderer WebGL 2 usa geometria sólida; SVGRenderer é a alternativa local automática. Não existe backend ou recurso externo de renderização.

A versão do aplicativo é 0.4.0. O motor mantém a identificação 0.3.0 e a política LC-ELU-2026.1, pois este recurso acrescenta representação gráfica e não altera os modelos resistentes. Veja `VISUALIZACAO-3D.md`.
