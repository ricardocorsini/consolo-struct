# Validação — política do coeficiente γn (issue #1)

Contribuição da [PR #40](https://github.com/ricardocorsini/consolo-struct/pull/40) para [a issue #1](https://github.com/ricardocorsini/consolo-struct/issues/1). O commit original `2cae3a0`, de PFelipe23, foi preparado sobre `fa8c890` e é preservado na integração sobre a master `38e4fb1`, que já inclui N3/N4 e o esquema 5.

## Implementado

- Novos campos de projeto: `gammaNPolicy`, com padrão `floor12`, e `gammaNJustification`, com padrão vazio e máximo de 1000 caracteres. A integração mantém o esquema atual **5**, os dados de N3/N4 e a migração dos esquemas 1–4; o campo numérico `gammaN` conserva a faixa anterior, de 1,2 a 3.
- **Piso conservador de 1,2 (padrão)** mantém `max(1,2; γn9062; γn informado)`. A opção **Tabela NBR 9062, sem piso de 1,2** ignora o mínimo informado, exige justificativa com ao menos dez caracteres após `trim` e gera a verificação `gammaNPolicy`, sempre `review`.
- O controle fica em Cálculo, perto do processo de produção e da ação permanente predominante, acessível também por **Configurações > Dimensionamento > Critérios da peça selecionada**. O mínimo informado fica oculto na tabela, mas é guardado e reaparece ao voltar ao padrão. As escolhas são por peça, entram no histórico e são salvas no arquivo.
- A tabela fica desabilitada para moldado no local. Mesmo se um arquivo solicitar a tabela nesse processo, aplica-se a expressão conservadora anterior, incluindo o mínimo informado. Não há redução automática nem exigência de uma justificativa para uma política que ficou inativa.
- A tela, memória, PDF, cálculo auditável, notas de desenhos e CSVs registram a escolha e a justificativa. SVG/DXF geométricos e desenhos de detalhamento recebem notas quando há solicitação da tabela. CSVs acrescentam colunas nessas condições; projetos inteiramente no padrão mantêm o formato anterior.

`src/domain/gammaN.ts` concentra a decisão e os textos comuns. Os valores da tabela foram movidos do motor sem alteração. `values.gammaN` e `values.gammaN9062` continuam numéricos em ambos os modelos. O resultado acrescenta `gammaNDecision` somente quando houve solicitação explícita de tabela, distinguindo política solicitada e efetiva. Sem justificativa válida na tabela ativa, o motor retorna `unsupported`, com `values` vazio e sem combinações calculadas.

## Valores conferidos

Vk = 350 kN, γf = 1,4 e mínimo informado de γn = 3,0, que é ignorado pela tabela:

| Produção      | Permanente predominante | γn da tabela/adotado | Vd (kN) |
| ------------- | ----------------------- | -------------------- | ------- |
| Pré-fabricado | Sim                     | 1,00                 | 490     |
| Pré-fabricado | Não                     | 1,10                 | 539     |
| Pré-moldado   | Sim                     | 1,10                 | 539     |
| Pré-moldado   | Não                     | 1,20                 | 588     |

A tabela usa os quatro números existentes na base, sem interpretação nova de norma. No exemplo pré-moldado predominante, a comparação com o padrão foi feita com mínimo 1,2: **588 kN no padrão e 539 kN na tabela**. H característico e peso próprio recebem o mesmo fator de ações. Para forças já de cálculo, o fator continua **1**, inclusive nas combinações adicionais; a escolha não aplica nova majoração.

Moldado no local mantém o coeficiente histórico de referência 1,2 e `max(1,2; mínimo informado)`: mínimo 1,2 produz γn = 1,2; mínimo 1,5 produz γn = 1,5. Essa é a preservação do comportamento atual solicitada na issue. Uma solicitação `table9062` fica sem efeito enquanto a produção for `cast`; pode permanecer guardada no arquivo, e a política efetiva conservadora é explicada na tela e na auditoria.

## Verificações da contribuição original

O registro da contribuição original informa **280 testes** antes da alteração e os resultados abaixo. Sua [CI original](https://github.com/ricardocorsini/consolo-struct/actions/runs/43288406911) foi aprovada; a validação da composição com N3/N4 é registrada separadamente adiante.

| Comando                                                    | Resultado                               |
| ---------------------------------------------------------- | --------------------------------------- |
| `npm run format:check`                                     | Aprovado                                |
| `npm run check`                                            | Aprovado: **304 testes em 17 arquivos** |
| `npm run build`                                            | Aprovado                                |
| `npm run test:e2e`                                         | Aprovado: **83 testes em 16 arquivos**  |
| `npx vitest run tests/gammaN.test.ts tests/domain.test.ts` | Aprovado: **41 testes**                 |
| `npx playwright test tests/e2e/gamma-n.spec.ts`            | Aprovado: **6 testes**                  |

Os testes novos cobrem os quatro valores, 539/588 kN, mínimo ignorado na tabela, H por análise/estimativa, piso horizontal bibliográfico, peso próprio, forças já de cálculo, combinações, `review` persistente, sugestão de armadura, regras de moldado no local, justificativa vazia/curta/espaços/dez caracteres, máximo de 1000, abertura de legado, salvamento por peça, assinatura de entradas e rastreabilidade nas saídas. Os textos de usuário são escapados no SVG e preservam a proteção existente contra fórmulas nas novas colunas de CSV.

Na interface foram conferidos acesso por Configurações, opção desabilitada para `cast`, mínimo oculto/restaurado, justificativa obrigatória, isolamento por peça, Desfazer/Refazer, reabertura do arquivo, memória, PDF e auditoria de consolo e viga, teclado, ambos os temas e janela de 390 px.

O registro original relata a comparação de **432 resultados completos** com entradas legadas idênticas: três produções × duas predominâncias × três resistências de concreto × dois mínimos γn × dois níveis de forças × três modelos × duas escolhas de peso próprio. Também registra a comparação de sugestões, detalhamento e exportações. Essa matriz foi ampliada na integração para incluir as duas opções de ramos N3.

Os três hashes SHA-256 históricos de `fa8c890` continuam fixados em `tests/gammaN.test.ts`. Suas entradas não incluem campos posteriores, e o helper `legacyN4Labels` reverte somente os rótulos públicos de N4/N5/N6, sem retirar números ou estados. Seis hashes adicionais, capturados na master `38e4fb1` antes da integração, verificam os resultados completos de bielas, atrito e viga com dois e quatro ramos, sem normalização do resultado.

Nenhuma expectativa numérica ou hash existente foi alterada. Em duas fixtures de snapshots históricos, somente os campos novos foram retirados da entrada para que continuassem representando arquivos anteriores ao recurso, como já era feito com outros campos posteriores. `tests/engine.test.ts`, inclusive os testes existentes de γn mínimo e superior, permaneceu inalterado.

## Verificações da integração com N3/N4

- A master `38e4fb1` passou em `npm run check` com **331 testes**, antes da integração. A composição passou com **364 testes em 20 arquivos**, além de `npm run build` e `npm run format:check`.
- Foram capturados antes da integração e comparados depois **864 resultados completos**: a matriz acima com N3 de dois e quatro ramos. Os JSONs permaneceram idênticos byte a byte, incluindo assinatura, valores, textos e estados. A comparação incluiu também SVG/DXF geométricos, SVG/DXF de detalhamento e os dois CSVs, em quatro cenários de consolo/viga e dois/quatro ramos. SHA-256 do registro combinado: `3b57370109c25588aaa4fe71c53d6d1c4525d7eade369345508d1146216ad2eb`.
- Testes adicionais verificam o alinhamento das colunas N3/N4 e γn em CSVs de projetos com políticas diferentes; migração do esquema 4 e abertura do esquema 5 sem os campos novos; round-trip da tabela com N3 de quatro ramos e N4 Ø10.
- A suíte E2E da composição contém **102 testes**. A tentativa local foi bloqueada antes das interações: o Chromium encerra com `socket() failed: Operation not permitted`. O resultado E2E desta integração deve ser conferido na execução da CI vinculada à PR de integração.
- Os E2E de γn incluem salvamento/reabertura com quatro ramos N3 e N4 Ø10, isolamento por peça, histórico, teclado, ambos os temas e janela de 390 px. Anexam capturas de memória e dos controles nos dois temas/larguras aos artefatos da CI. As capturas abaixo pertencem à contribuição original.

## Capturas

- [Controle em Configurações, tema claro](images/gamma-n-claro.png)
- [Memória e coeficientes, tema escuro](images/gamma-n-memoria-escuro.png)
- [Controle em janela estreita](images/gamma-n-janela-estreita.png)

## Limites e pendências

Não houve alteração de γc/γs, classes de aço, limite de biela, γf, combinações, geometria, bitolas ou outras fórmulas. As novas políticas mudam somente a seleção de γn e sua rastreabilidade. Uma verificação independente pode continuar reprovando a peça; a conferência da tabela não vira aprovação, inclusive quando γn tabelado for 1,2.

O build conserva os avisos preexistentes de anotação de otimização do Zod, importação estática/dinâmica de `detailing/job.ts` e chunks acima de 500 kB. Não houve alteração de dependências.

O fluxo nativo Tauri não foi executado: Rust/Cargo e os pré-requisitos nativos não estão disponíveis neste ambiente. A validação web não substitui validação nativa.

A escolha cabe ao responsável técnico e não declara equivalência entre os textos da NBR 6118 e da NBR 9062 nem certifica o enquadramento do elemento. Referências citadas: **NBR 9062:2017 §7.3.1.1; NBR 6118:2026 §22.2**. Os textos normativos não foram consultados nem reproduzidos; os valores existentes coincidem com os descritos na issue. Não foi necessário interromper por divergência de tabela.

Esta implementação cobre a escolha de política descrita na issue #1. A conclusão da revisão e os resultados da CI da integração ficam registrados na PR vinculada à #40.
