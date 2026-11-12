# Validação — ductilidade, armadura máxima e rotação plástica (issue #4)

Contribuição para [a issue #4](https://github.com/ricardocorsini/consolo-struct/issues/4), na branch `feat/ductility-checks`, baseada no `master` original `fa8c8908f58ce05ccd5bfc17ba123045da166a54`. O fork foi sincronizado antes da implementação. As contribuições anteriores ainda não integradas ao original não foram incluídas nesta branch.

## Implementado

- Três verificações adicionais para **bielas e tirantes** e **atrito-cisalhamento**: `ductilityXd`, `maxSteel` e `plasticRotation`, sempre `pass` ou `fail`. O domínio existente de cada método é preservado; elas não são acrescentadas ao modelo de viga em balanço.
- `ductilityXd`: `x = As,ef fyd/(λ b fcd)`, comparando `x/d` com **0,45** até C50 e **0,35** acima de C50. Usa `fyd = fyk/γs` conforme a issue, sem modificar o teto de 435 MPa das fórmulas anteriores.
- `maxSteel`: compara a área do tirante adotado com `0,04 b h`.
- `plasticRotation`: `fcdCCC = 0,85 αv2 fcd`, `a1 = Vd/(b fcdCCC)`, `aexc = a1/2 + a + (Hd/Vd)d′`, `R = d² − 2 a1 aexc`; quando há raiz real, `x = d − √R` e `x/(λd) ≤ lim`. Usa b da seção, os coeficientes adotados, a reação de cálculo e o par Vd/Hd simultâneo já calculado pelo motor, sem nova majoração.
- R negativo gera **falha com valor indeterminado**, exibido como **sem solução**. O resultado conserva R e o limite e omite `plastic_x`/`plastic_ratio`. A verificação usa `demand: null`, `capacity: lim`, `utilization: null`, sem armazenar um número sentinela.
- Os ids entram no envelope separadamente. Uma rotação sem raiz real tem precedência sobre uma falha finita da mesma verificação; as prioridades das verificações anteriores não mudam. Valores de cada combinação permanecem disponíveis, sem misturar seus esforços.
- `domain/ductility.ts` concentra os cálculos novos e os rótulos comuns da memória. A memória por combinação, PDF e auditoria registram os intermediários. O CSV geral acrescenta estado, valor, limite, unidade, fórmula, referência e detalhe/combinação para cada id quando há peças com essas verificações; um projeto inteiramente de viga conserva o CSV anterior.
- A sugestão considera os três ids como restrições; não modifica as demais fórmulas nem transforma pendências em aprovação.

`result.values` continua associado à combinação determinante do tirante, conforme o contrato anterior. Para a combinação crítica de cada verificação, consulte o `check` envelopado (com o nome do caso no detalhe) e os `values` da combinação correspondente. A memória numérica apresenta cada caso separadamente.

A comparação de **escoamento do tirante antes do concreto** em bielas continua intacta. A nota **`ductility`, com estado `review`, no atrito é preservada**; os três critérios novos não a substituem. O limite histórico ω ≤ 0,15 não foi reintroduzido. Não há campos novos de entrada nem migração: o esquema permanece **4**.

## Valores conferidos

Seção 300 × 400 mm, quatro barras Ø20, fck = 30 MPa, fyk = 500 MPa, γc = 1,4, γs = 1,15, d′ = 41,3 mm e d = 358,7 mm:

- `As,ef = 1256,6370614359173 mm²`.
- `x da seção = 106,23743273008961 mm`; `x/d = 0,29617349520515646`, abaixo de 0,45.
- `As,máx = 4800 mm²`.

Para Vd = 588 000 N e Hd = 94 080 N: `fcdCCC = 16,02857142857143 MPa` e `a1 = 122,28163992869874 mm`.

| a (mm) | aexc (mm)          | R (mm²)            | x do nó (mm)       | x/(λd)              | Resultado da rotação |
| ------ | ------------------ | ------------------ | ------------------ | ------------------- | -------------------- |
| 125    | 192,74881996434937 | 81526,40640087568  | 73,1717064792428   | 0,254989219679547   | Passa                |
| 250    | 317,74881996434937 | 50955,996418701005 | 132,96565077795313 | 0,46335953017128917 | Falha                |

São os valores obtidos sem arredondamento intermediário; as diferenças em relação aos números abreviados da issue são apenas suas casas decimais de apresentação. Os testes usam os números completos, com tolerâncias menores que 1e−4.

O caso a = 125 mm foi exercitado nos dois métodos. O caso a = 250 mm tem a/d > 0,5 e é exercitado em bielas: o motor anterior já interrompe atrito escolhido explicitamente nesse domínio. Essa interrupção foi mantida e testada, sem forçar um cálculo fora do domínio para reproduzir um número.

C60 mantém `λ = 0,775` e usa limite **0,35**. Foram cobertos também C50, C50,001 e C90. O radicando exatamente zero conserva x = d e a razão finita; um radicando estritamente negativo não é arredondado para zero.

## Compatibilidade e exemplos oficiais

A inspeção anterior à implementação aplicou as fórmulas propostas às saídas do motor original. Depois da alteração, foram comparados os resultados completos, excluindo somente os três itens novos e seus intermediários. Os **11 consolos nos quatro arquivos de exemplo** conservaram seus estados:

| Arquivo                                               | Estados preservados, na ordem das peças |
| ----------------------------------------------------- | --------------------------------------- |
| `examples/casos-validacao.lume.json`                  | `pass`, `review`, `review`              |
| `examples/detalhamento/consolos-detalhados.lume.json` | `pass`, `pass`                          |
| `examples/base-consolo.lume.json`                     | `pass`, `pass`, `fail`, `unsupported`   |
| `examples/pavilhao-horizonte.lume.json`               | `fail`, `fail`                          |

As verificações novas passam em todos os casos calculáveis desses arquivos. `shortFixture()` continua `pass` e `cantileverFixture()` conserva seu resultado anterior. **Nenhum exemplo oficial ou expectativa de estado precisou ser alterado; não ocorreu a condição de interrupção/discussão exigida pela issue para nova reprovação de exemplo oficial.** Os exemplos versionados não foram modificados.

Uma comparação entre checkouts separados do motor original e do atual cobriu **162 entradas**: três modelos × três fck × três classes do tirante × dois níveis de forças × três mínimos γn. Os números e verificações anteriores, inclusive fórmulas, referências e estados individuais, permaneceram idênticos. Nessa matriz também não houve mudança de estado global. Resultado completo de viga, seu CSV e as geometrias SVG/DXF foram comparados sem normalização e permaneceram idênticos.

Os hashes históricos de materiais/classes de aço não foram substituídos. Duas fixtures usam `tests/reference/without-added-ductility.ts` para excluir **somente os três ids novos e os dez campos intermediários novos** antes da comparação histórica. O helper não remove nem recalcula estados globais, estados das verificações, valores anteriores, assinaturas, fórmulas ou referências. O hash de viga permanece igual inclusive sem essa exclusão.

## Verificações executadas

Antes de editar, `npm run check` passou com **280 testes**.

| Comando                                           | Resultado                               |
| ------------------------------------------------- | --------------------------------------- |
| `npm run format:check`                            | Aprovado                                |
| `npm run check`                                   | Aprovado: **309 testes em 17 arquivos** |
| `npm run build`                                   | Aprovado                                |
| `npx playwright test tests/e2e/ductility.spec.ts` | Aprovado: **6 testes**                  |
| `npm run test:e2e`                                | Aprovado: **83 testes em 16 arquivos**  |

Os **29 testes unitários novos** cobrem os números da issue, ambos os métodos em seu domínio, λ/limite por fck, fyd não limitado e coeficientes adotados, esforços de cálculo/característicos, largura da seção, reação deslocada, peso próprio, radicandos zero/negativo, armadura excessiva, combinações independentes e raiz ausente governando sobre falha finita em ambas as ordens, sugestão, domínio de viga, exemplos e saídas.

No teste de combinações, o caso crítico do tirante difere do caso crítico da rotação. x/d e As,máx são constantes entre combinações da mesma peça, pois suas entradas não dependem dos esforços; por isso não se inventa uma combinação de carga que altere essas duas razões. O envelope conserva o primeiro caso quando os valores são iguais, como antes.

A tabela de verificações permite quebrar fórmulas e referências longas sem deslocar a coluna de resultado para fora da área visível. A memória nova usa uma coluna em janela estreita. Os testes conferem os limites visíveis da tabela e que o valor consultado na janela estreita não está coberto por outro painel.

Os seis fluxos de Chromium conferem tabela, fórmulas/referências, memória por combinação, valores auditáveis, manutenção da pendência do atrito, ausência de raiz em ambos os temas, PDF/CSV, C60 em janela estreita e armadura excessiva sem mutação de entradas. O PDF translitera a raiz como `sqrt(R)`, preservando a operação na saída com fonte ASCII.

## Capturas reais de Chromium

- [Memória numérica das novas verificações](images/ductility-memory.png).
- [Rotação sem solução, tema escuro](images/ductility-unsolved-dark.png).
- [C60 e λ em janela estreita](images/ductility-narrow.png).

## Não validado e limites

As referências foram registradas como **citadas no GN Corbel, com conferência pendente**: NBR 6118:2023 §17.2.3, §17.3.5.2.4 e §22.3; NBR 9062:2017 §5.1.2.9. Os textos normativos não foram consultados ou reproduzidos; a contribuição não certifica sua aplicação nem presume equivalência com a edição 2026 usada em outros critérios do programa. O uso de b da seção segue exatamente a fórmula solicitada na issue.

Esses critérios não certificam ductilidade global, capacidade de rotação da estrutura, ancoragens ou detalhamento executivo. A pendência complementar do atrito e as demais limitações do motor continuam aplicáveis. Não houve alteração de γ, classes de aço, limite de biela, geometrias ou fórmulas anteriores. O build mantém os avisos preexistentes de otimização do Zod, importação estática/dinâmica de `detailing/job.ts` e tamanho dos chunks; nenhuma dependência foi acrescentada.

O aplicativo nativo Tauri não foi executado: Rust/Cargo e seus pré-requisitos não estão disponíveis no ambiente. Os testes web não substituem essa validação nem revisão técnica independente.

PR manual sugerido: **Adiciona verificações de x/d, armadura máxima e rotação plástica**. Relacionar com **Closes #4** e citar os resultados, a compatibilidade e as limitações acima.
