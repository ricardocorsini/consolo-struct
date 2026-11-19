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

Projetos no esquema 6, com migração dos esquemas 1–5, incluindo a preservação de N3/N4 do esquema 5. O aço secundário passa de `design.fykTransverse` para `materials.fykTransverse`; tirante legado CA-60 é preservado no arquivo e bloqueado no motor. Esquema 1 migra com parâmetros não conferidos. Resultados não são restaurados do projeto como se fossem atuais. `.calc.json` é uma saída distinta, com todas as entradas e resultados; pode ser usada por auditoria externa.

Para acrescentar um modelo, inclua critérios, domínio, razões de bloqueio, memória e casos independentes antes de habilitá-lo na interface. Dentes Gerber exigem tipo próprio e modelo próprio; não basta inverter o desenho do consolo. ELS exige combinações de serviço e dados adicionais; não reutilizar ações ELU por conveniência.

## Aplicativo 0.4 — vistas 3D

O aplicativo 0.4.0 inclui `src/components/ThreeViewport.tsx`, carregado sob demanda. O contrato de enquadramento/zoom é o mesmo do Viewport 2D. As propriedades, o histórico e o motor permanecem no estado do documento; a câmera é estado da vista.

`src/visualization/model3d.ts` converte as entradas canônicas em contorno, cotas, cargas e eixos de armaduras. `scene3d.ts` gera os objetos Three.js e gerencia seu descarte. O renderer WebGL 2 usa geometria sólida; SVGRenderer é a alternativa local automática. Não existe backend ou recurso externo de renderização.

A versão do aplicativo é 0.4.0. O motor mantém a identificação 0.3.0 e a política LC-ELU-2026.1, pois este recurso acrescenta representação gráfica e não altera os modelos resistentes. Veja `VISUALIZACAO-3D.md`.

## Fonte única das armaduras

Cada posição registra `totalQuantity`, `totalLength` em mm, `mass` por peça e `totalMass` em kg. A relação de aço, os resumos e as exportações usam esses campos.

Todas as vistas, cortes, quadros e quantitativos de aço/concreto leem a mesma definição de armaduras (issue #63). Nenhum renderizador reconstrói coordenadas de barras.

| Módulo                            | Responsabilidade                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/detailing/model.ts`          | `buildRebarGeometry`: instancia uma vez cada posição (N1, N2, N2I, N3, N3G, N4, P1, TS, PINO) e suas barras físicas    |
| `src/detailing/rebarPlacement.ts` | Partes planas exatas (linhas e arcos) nos planos `xy`, `xz` ou `yz`; projeção ortográfica e interseção com o plano `x` |
| `src/detailing/rebarModel.ts`     | `rebarModel` memorizado por conteúdo; `projectElevation`, `projectPlan`, `intersectSectionX`, `scenePaths`             |
| `src/detailing/projection.ts`     | Agrupamentos por família para os renderizadores (ligações, N1 com gancho, seção com o par N3/N3G)                      |

Cada posição contém marca, família, função estrutural, bitola, classe de aço, quantidade por peça (e total, multiplicada pela quantidade de peças), espaçamento quando uniforme, forma de fabricação com raios e ganchos, provisões de ancoragem de cada extremidade, comprimentos desenvolvido (`exactLength`) e de corte (`cutLength`), e as barras físicas (`instances`), uma por unidade da quantidade. Eixos do modelo em mm: `x` a partir da face do suporte, `y` a partir de uma face lateral e `z` como profundidade abaixo do topo. A massa, o resumo por classe/bitola, o volume de concreto (`pieceVolume`) e a taxa de aço (kg/m³) saem de `rebarQuantities`, a mesma função usada pelo detalhamento e pelas exportações.

`buildRebarGeometry` usa as ancoragens do motor para construir as barras. Calcula os valores uma vez quando ainda não foram fornecidos. Detalhamento, CSV e PDF reaproveitam os valores ELU já obtidos. Elevação, seção A–A e 3D compartilham `rebarModel`, memorizado pelo conteúdo da peça. O modelo guarda um retrato dos dados que geraram a geometria. Projeções paralelas preservam os arcos e projeções perpendiculares mostram suas extensões. Cortes intersectam linhas e arcos e representam trechos coplanares como linhas.

Na seção A–A, o N3G projetado pertence explicitamente ao N3 cortado e cada N4 é cortada no plano do estribo que a contém. O 3D e a planta mostram os ganchos de N2/N2I pela projeção nominal usada na forma de fabricação. Nos cortes da prancha conserva-se o perímetro do estribo, pois os trechos de fechamento se sobrepõem fora do plano, conforme a convenção do #58.
