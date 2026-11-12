# Validação — aços separados por função (issue #35)

Contribuição para [a issue #35](https://github.com/ricardocorsini/consolo-struct/issues/35), na branch `feat/separate-steel-materials`. Base: `fa8c8908f58ce05ccd5bfc17ba123045da166a54`, master do original. O fork `PFelipe23/consolo-struct` foi sincronizado antes da implementação. A entrega é um commit no fork; o PR será aberto manualmente pelo autor.

## Implementado

Em Modelo > Materiais, CONCRETO contém Fck e AÇO DAS ARMADURAS contém **Aço do tirante** (CA-25/CA-50) e **Aço da costura e estribos** (CA-25/CA-50/CA-60). Os dois campos têm identificadores e descrições acessíveis distintos. O seletor secundário foi removido de Cálculo > Durabilidade e disposição. O padrão de ambos continua 500 MPa.

O esquema 5 move `design.fykTransverse` para `materials.fykTransverse`, removendo o campo antigo. A migração aceita os esquemas 1–4 e captura o aço antes da reposição dos parâmetros ilustrativos da versão 1. Preserva 500/600 legados; quando ausente, usa 500. Tirantes legados de 600 MPa e personalizados como 420/420,5 MPa continuam numéricos e serializáveis, sem conversão, mas o motor retorna `unsupported`, explica as classes admitidas e não fornece valores ou combinações dimensionadas.

A abertura de arquivo usa o histórico existente e limpa os resultados; Desfazer/Refazer restaura os projetos normalizados. Não se reinsere o campo antigo no modelo ativo ao desfazer. Edições dos aços afetam somente a peça selecionada, participam do histórico e invalidam o cálculo pela assinatura das entradas. A restauração inicial do rascunho não cria uma edição artificial, preservando o comportamento anterior.

Em mm, N e MPa, sem arredondamento intermediário:

```text
fyd = fydLimited = min(fyk_tirante / γs, 435)
fywd = min(fyk_secundarias / γs, 435)
lb = max(φ fyd / (4 fbd), 25φ)
```

`fyd` passa a representar a resistência adotada, já limitada; `fydLimited` permanece como alias compatível. Isso aplica o teto também ao mínimo de flexão, numerador do confinamento e piso resistente de solda, que antes consumiam fyd integral. Costura N2 nas parcelas obtidas por força, estribos resistentes de viga, suspensão, fendilhamento e confinamento usam o aço secundário. Os mínimos definidos por área continuam iguais; o mínimo de estribos de viga que depende de fywk mantém a resistência **característica** secundária. Memória e PDF identificam as duas resistências e o fyd adotado na ancoragem; auditoria registra entradas e valores adotados. Desenhos e quadro de aço leem o novo campo secundário.

Não se alteram bitolas, arranjos, η1, fatores de pino, regras geométricas, γc/γs, γf/γn ou a estrutura das verificações. Os geradores de exemplos passam a emitir esquema 5; arquivos de exemplos existentes não foram regenerados, permitindo testar sua migração.

## Exemplos reproduzíveis

Os quatro valores de referência da issue estão cobertos em `tests/steelSeparation.test.ts`:

| Aço / γs                | Resistência adotada (MPa) |
| ----------------------- | ------------------------: |
| CA-25 / 1,15            |         217,3913043478261 |
| CA-50 / 1,15            |         434,7826086956522 |
| CA-60 secundário / 1,15 |                435 exatos |
| CA-50 / 1,10            |                435 exatos |

Ancoragem: `shortFixture()` de `tests/fixtures.ts`, tirante CA-50, secundárias CA-50, φ20 mm, aderência `poor`, γc = 1,40. Demais entradas da fixture inalteradas; fbd = 2,2809686711308 MPa em ambos os casos:

| γs   |   lb na base (mm) | lb adotado agora (mm) | Motivo                                         |
| ---- | ----------------: | --------------------: | ---------------------------------------------- |
| 1,15 | 953,0657176455362 |     953,0657176455362 | Quociente abaixo do teto; resultado preservado |
| 1,10 | 996,3868866294241 |      953,542250504359 | Ancoragem passa a usar exatamente 435 MPa      |

A tabela não afirma atendimento da peça. Conferências e falhas existentes continuam ativas. Nas secundárias, trocar CA-50 por CA-25 com γs = 1,15 dobra as parcelas de área obtidas pela divisão de uma mesma força por fywd; não dobra automaticamente o envelope quando governa um mínimo por área. Testes cobrem essa distinção, a independência de fbd/lb/As do tirante em relação ao aço secundário e os três modelos resistentes.

## Validado

A base passou antes da implementação: formatação, 280 testes unitários em 16 arquivos, build, instalação/disponibilidade do Chromium e 77 testes de interface em 15 arquivos.

| Comando final                     | Resultado                                       |
| --------------------------------- | ----------------------------------------------- |
| `npm run format:check`            | Aprovado                                        |
| `npm run check`                   | Aprovado: 309 testes em 17 arquivos             |
| `npm run build`                   | Aprovado                                        |
| `npx playwright install chromium` | Executado antes dos testes; Chromium disponível |
| `npm run test:e2e`                | Aprovado: 79 testes em 15 arquivos              |

Cobertura dos critérios:

| Critério  | Evidência                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| CA1 / CA2 | Seletores em Materiais, opções distintas, secundárias ausentes de Cálculo, salvamento apenas em `materials`, isolamento entre peças   |
| CA3       | Migração 1–4, preservação dos aços inclusive v1, reabertura, CA-60 legado bloqueado, histórico da abertura e das edições, invalidação |
| CA4       | Valores de referência, tetos exatos, resistência secundária nas famílias por força e mínimos por área preservados                     |
| CA5       | lb limitado, independência do aço secundário, memória, PDF e auditoria com resistências adotadas                                      |
| CA6       | Ambos os seletores por teclado, claro/escuro, 1440/390 px, sem rolagem horizontal da página                                           |

Comparação direta com uma cópia sem alterações da base fa8c890: **108 cenários** (3 modelos × 3 fck, 20/30/60 MPa × 3 processos de produção × 2 modos de forças × complementos bibliográficos ligados/desligados), sempre CA-50/CA-50 e γs = 1,15. Todos os valores numéricos, estados, demandas, capacidades, referências e detalhes das verificações permaneceram exatamente iguais. A assinatura mudou pelo novo contrato; o texto da fórmula N2 passou a identificar fywd. Também foram comparadas as 11 peças dos quatro arquivos oficiais, preservando 5 `pass`, 2 `review`, 3 `fail` e 1 `unsupported`. Para um caso de cada modelo, SVG, DXF e CSV permaneceram idênticos (9 saídas).

Três regressões permanentes fixam os hashes dos valores e das verificações da base para bielas, atrito e viga padrão; excluem somente a assinatura e o texto das fórmulas. Os cinco snapshots completos históricos de `materialSafety.test.ts` e `steel.test.ts` foram atualizados para o novo contrato, e o snapshot calculável de CA-60 no tirante foi substituído por testes explícitos de preservação/bloqueio. Não se apresenta igualdade desses snapshots completos antigos: além da assinatura, N2 muda intencionalmente quando as classes diferem. As expectativas de fyd sem teto com γs = 1,10 passam a exigir 435.

As primeiras execuções durante o desenvolvimento identificaram expectativas antigas de esquema/classe/resistência, uma asserção sobre `message` em vez de `reasons` e dois ajustes de teste de interface (propriedade `disabled` de uma option e abertura da memória numérica recolhida). Foram corrigidas antes da suíte final; não foram ignoradas falhas para declarar aprovação.

Capturas conferidas visualmente:

- [Materiais no tema claro](images/acos-separados-claro.png)
- [Materiais no tema escuro](images/acos-separados-escuro.png)
- [Legado CA-60 em 390 px](images/acos-separados-legado-estreito.png)

## Não validado

O aplicativo nativo Tauri não foi compilado/executado: Rust/Cargo e pré-requisitos nativos não estão disponíveis neste ambiente. Os testes web não substituem essa verificação.

O teto, as classes e as fórmulas seguem a decisão confirmada pelo usuário na issue, que cita NBR 6118:2026 §§9.4, 17.4.1.1, 22.3 e 22.4/22.4.1; NBR 9062:2017 §7.3. Não havia textos normativos disponíveis no repositório/issue para conferência; não foram buscados na internet nem reproduzidos. A aprovação normativa não foi validada de forma independente.

Não houve revisão por outra sessão/pessoa nem seleção de modelo/esforço pela interface desta execução. A comparação com o checkout original é automatizada, feita na mesma sessão. **Solicita-se revisão humana independente do cálculo e da migração antes da integração.**

## Divergências e limitações de integração

Não foram encontradas divergências que impedissem implementar o comportamento confirmado na master atualizada. O build mantém os avisos preexistentes de anotação do Zod, importação estática/dinâmica de `detailing/job.ts` e tamanho de chunks.

Esta branch parte da master e não incorpora PRs ainda abertos. Em particular, **o PR #41 (N4/N3) também propõe schemaVersion 5, com outro contrato**. Antes de integrar/publicar os dois, é necessário compor as migrações, preservar os novos campos de ambos e decidir uma versão inequívoca; esta contribuição só valida esquemas 1–4 da master e seu próprio esquema 5. Arquivos da proposta independente #41 não devem ser tratados como compatíveis com esta branch isolada. O PR #43 de ductilidade usava fyd integral no cálculo de x/d: ao integrá-lo, deve ser reconciliado com a decisão posterior da issue #35 de limitar as resistências de cálculo. As suítes combinadas desses PRs não foram executadas aqui.

## Sugestão para o PR manual

Título: **Separa aços do tirante e das secundárias e limita a ancoragem a 435 MPa**.

Cada peça passa a editar os dois aços em Materiais, com tirante CA-25/CA-50 e secundárias CA-25/CA-50/CA-60. O esquema 5 migra o campo secundário sem perder os valores; tirantes CA-60 legados permanecem salvos e são explicitamente não suportados. O motor aplica a resistência correta por família e o teto também em lb; memória, PDF, auditoria, critérios e guia foram atualizados.

Validação: formatação, 309 testes unitários, build e 79 testes de interface aprovados. Comparação com a base em 108 cenários padrão e nas 11 peças oficiais preservou valores e estados. Tauri, conferência dos textos normativos e revisão humana independente não executados. Conciliar o esquema 5 do PR #41 e o uso de fyd no PR #43 antes de integrar essas contribuições juntas.

Closes #35
