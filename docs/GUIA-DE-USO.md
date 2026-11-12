# Guia de uso

O ConsoloStruct calcula o **ELU estático local de consolos curtos e muito curtos de concreto armado**. Não substitui o projeto estrutural completo nem a conferência do responsável técnico. Antes do uso profissional, leia [Critérios de cálculo](CRITERIOS-DE-CALCULO.md), [Validação do motor](VALIDACAO-MOTOR.md) e [Detalhamento](DETALHAMENTO.md).

## Ferramentas e fluxo principal

**Início** reúne oito comandos: Novo consolo, Geometria, Ações da peça, Calcular, Sugerir armaduras, Memória, Detalhamento e Exportar. O caminho Novo consolo → editar geometria/ações → Calcular → Memória → Detalhamento pode ser realizado sem trocar de aba superior.

| Aba          | Onde encontrar                                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arquivo      | Novo projeto, Abrir, **Salvar projeto** (`.consolo.json`), Dados do projeto e Exportar                                                                                     |
| Modelo       | Novo consolo, Duplicar, Identificação da peça, Excluir, Geometria, Ações da peça, Materiais, Editar armaduras, Critérios da peça selecionada, Calcular e Sugerir armaduras |
| Exibir       | Vistas, Selecionar/Pan, enquadramento/zoom do modelo, Mostrar cotas/armaduras/cargas/grade e painéis                                                                       |
| Documentação | Memória, Peças do projeto, Detalhamento e exportações diretas Memória PDF, Geometria DXF/SVG e Quantidades CSV                                                             |

**Editar armaduras** muda os parâmetros da peça; **Mostrar armaduras** só altera a representação. **Ações da peça** edita forças; **Mostrar cargas** só controla sua exibição. Os critérios continuam sendo dados da peça selecionada. Geometria, Ações e Critérios reabrem o painel de propriedades quando ele está fechado.

Selecionar uma aba superior apenas escolhe ferramentas e preserva o documento, a peça, os resultados e o histórico. Um campo ainda em edição continua sendo confirmado ou validado ao perder foco; um rascunho inválido não é descartado silenciosamente. Use setas esquerda/direita, `Home` e `End` nas abas e `Tab` para alcançar os comandos; em janelas estreitas, a faixa permite rolagem horizontal.

Os controles de navegação do ribbon retornam à **vista de modelo**. Para navegar no detalhamento sem mudar de documento, use seus controles locais. **Calcular revisão atual**, dentro da memória, mantém o relatório aberto; **Calcular**, no ribbon, retorna ao modelo. **Sugerir armaduras** pode modificar a peça e continua participando do histórico.

O tema fica em **Configurações > Geral / Aparência**, além do acesso rápido. Consulte o [inventário antes/depois e as capturas](REORGANIZACAO-RIBBON.md).

## 1. Criar ou abrir um projeto

Use **Novo projeto** e confirme nome, cliente e responsável em Dados do projeto. Cancelar mantém o projeto anterior. Use **Abrir** para carregar um projeto; o exemplo `examples/casos-validacao.lume.json` permite explorar o motor, e `examples/detalhamento/consolos-detalhados.lume.json` demonstra tirantes simples e duplos.

Novos arquivos usam `.consolo.json`; os antigos `.lume.json` continuam reconhecidos. O esquema atual é 5, com migração dos esquemas 1–4. Projetos antigos precisam da revisão dos parâmetros migrados antes de calcular. Salve com `Ctrl+S` (ou `Cmd+S` no macOS). Rascunhos do navegador e desktop são separados; transfira o arquivo de projeto para mudar de ambiente.

## 2. Conferir entradas

Selecione o consolo e revise geometria, materiais, cargas, armaduras e a aba **Cálculo** das propriedades. Confira apoio, ligação, durabilidade, ancoragens e combinações.

- A interface utiliza cm, kN e cm² conforme o campo; bitolas são em mm. O motor trabalha internamente em mm, N e MPa.
- Use ponto ou vírgula decimal, sem separador de milhar.
- No modo H estimado, H digitado é **adicional** ao coeficiente do apoio. No modo análise, é a resultante total e exige justificativa.
- Ações já de cálculo devem incluir γf e γn; não há segunda majoração.
- N1 conta ramos longitudinais. N2/N3/N4/N5 contam estribos fechados com dois ramos efetivos.
- Alterar bitolas, camadas, estribos ou cobrimento pode modificar a altura útil e o modelo resistente.
- As combinações são fornecidas pelo projetista; não há geração automática segundo NBR 8681.

Em **Modelo > Materiais**, o grupo **CONCRETO** contém Fck; em **AÇO DAS ARMADURAS**, selecione **Aço do tirante** (CA-25 ou CA-50) e **Aço da costura e estribos** (CA-25, CA-50 ou CA-60). O padrão dos dois é CA-50. O campo do tirante mostra η1 da aderência (1,00 para CA-25 e 2,25 para CA-50). As resistências de cálculo são limitadas a 435 MPa, inclusive na ancoragem do tirante.

Arquivos antigos migram o aço secundário de Cálculo para Materiais, preservando seu valor; o seletor não aparece mais em Durabilidade e disposição. Um tirante legado CA-60 permanece 600 MPa, aparece como não suportado e impede o cálculo até escolha explícita de CA-25/CA-50. Um valor personalizado, como 420 MPa, também permanece salvo e não suportado. Não há conversão automática. A abertura com migração pode ser desfeita/refeita, assim como as edições dos materiais; as escolhas afetam somente a peça selecionada e invalidam resultados anteriores. Salve com **Salvar projeto**. Consulte [os critérios](CRITERIOS-DE-CALCULO.md#classes-de-aço-do-tirante-e-das-secundárias) e [a validação da issue #35](VALIDACAO-ACO-SEPARADO.md).

## 3. Calcular e ler a memória

Clique em **Calcular** e consulte **Memória**. Expanda combinações e verificações para examinar fórmulas, resultados e referências. Alterações nas entradas invalidam o resultado anterior; recalcule antes de interpretar a peça.

Os estados distinguem: atendimento às verificações implementadas, verificações não atendidas, necessidade de conferência complementar, entradas inválidas e mecanismo fora do domínio. **Atender às verificações implementadas não equivale à aprovação executiva.**

**Sugerir armaduras** pesquisa candidatos de bitola, quantidade e camadas. A sugestão não resolve geometria, solda ou armadura existente no suporte. Confira as pendências mesmo após aceitar um arranjo.

Para experimentar uma falha conhecida, no exemplo Curto-ELU reduza a ancoragem disponível no suporte para 5 cm, recalcule e leia a memória. Desfaça a alteração antes de prosseguir. O exemplo Muito-curto-ELU conserva pendência explícita de ductilidade; Junta-rugosa exige confirmação da preparação da interface.

## 4. Navegar pelas vistas

- Em 2D: botão central ou Espaço + arrastar para pan; roda para zoom no cursor; `F` enquadra.
- Clique em uma cota para editar; `Enter` confirma e `Esc` cancela. `Ctrl+Z` desfaz e `Ctrl+Shift+Z` refaz.
- Em **Vista 3D**, arraste com o botão esquerdo para orbitar e com central/direito ou Espaço para pan. Use os presets Frontal, Superior, Lateral e Isométrica.
- Em **Exibir**, use Mostrar cotas, Mostrar cargas, Mostrar armaduras e Mostrar grade. A transparência fica junto à Vista 3D.
- A árvore pode manter vários consolos expandidos. Expandir não troca a seleção. Clique em ×n para editar a quantidade.
- Feche abas pelo × e reabra pelo navegador ou faixa de ferramentas. Fechar uma vista preserva o projeto.

A vista 3D e suas armaduras são representações esquemáticas, não análise resistente espacial nem detalhamento executivo. As setas mostram ações de entrada da combinação Principal, sem escala de intensidade. A câmera não altera os dados de cálculo.

### Configurações

A aba superior **Configurações**, após **Documentação**, centraliza os acessos abaixo. Ela pertence à faixa de ferramentas (ribbon), independentemente das abas de documentos. Abri-la preserva o documento ativo, a peça selecionada, os resultados e o histórico de desfazer/refazer.

| Grupo             | Disponível agora                                                                                                                                                             | Em breve (itens desabilitados)                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Geral / Aparência | **Tema escuro**, com o mesmo estado e a persistência do acesso na barra superior                                                                                             | Preferências gerais                                              |
| Desenho           | **Mostrar cotas**, **Mostrar armaduras**, **Mostrar cargas** e **Mostrar grade**, sincronizados com Exibir                                                                   | Cores, espessuras e estilo de cotas                              |
| Modelo 3D         | —                                                                                                                                                                            | Preferências de visualização e câmera padrão                     |
| Dimensionamento   | **Critérios da peça selecionada**, atalho ao painel Cálculo, **Limite da biela da peça selecionada** e **Coeficientes dos materiais da peça selecionada**, para editar γc/γs | Padrões gerais de dimensionamento                                |
| Detalhamento      | —                                                                                                                                                                            | Padrões de apresentação, textos, cotas e identificação de barras |

O tema é uma preferência do aplicativo. As alternâncias de desenho mantêm os efeitos e limites atuais de cada vista, sem nova persistência; elas não configuram o desenho de detalhamento. O atalho de critérios abre os **dados da peça selecionada**, não preferências globais. Os comandos de edição ficam em Modelo e as alternâncias de desenho também continuam em Exibir; Início mantém os oito atalhos do fluxo principal.

Itens **Em breve** são informativos, não executam ações nem salvam configurações. Não há formulário de preferências futuras nem botão Salvar/Aplicar. Nenhum critério ou resultado de engenharia é alterado por abrir esta aba.

Capturas da aba: [tema claro](images/configuracoes-claro.png) e [tema escuro](images/configuracoes-escuro.png).

#### Configurar o limite da biela

Em **Configurações > Dimensionamento > Limite da biela da peça selecionada**, confira o nome da peça e escolha o critério. O mesmo seletor está em **Modelo > Critérios da peça selecionada > Modelo e ações**, nas propriedades.

- **Padrão conservador · fcd2** mantém o comportamento anterior. É o padrão de novas peças e de arquivos sem o campo.
- **fcd3**, **0,85·fcd (carga indireta)** e **fcd (carga direta)** são alternativas menos conservadoras. As opções incompatíveis com a introdução da carga ficam desabilitadas.
- O controle mostra o limite escolhido e o padrão em MPa. O critério vale somente para a biela no modelo de bielas e tirantes, sem mudar nós, apoio, escoamento prévio, inclinação, complemento de El Debs, atrito-cisalhamento ou viga em balanço.

A escolha altera imediatamente **somente a peça selecionada** e entra em Desfazer/Refazer. Não muda padrões globais nem outras peças. **Concluir** ou `Esc` fecha a janela; não desfaz uma escolha já feita. Abrir e fechar sem escolher não altera o projeto. Depois de alterar, use **Calcular** para gerar a nova revisão e **Salvar projeto** para guardar a escolha no arquivo.

Alternativas aplicadas à biela geram a pendência **Conferir**, com os limites escolhido e padrão na memória, PDF e cálculo auditável. Elas não aprovam o projeto por si só. Se mudar a introdução da carga e o critério atual se tornar incompatível, escolha uma opção válida; o programa não troca o critério silenciosamente. Consulte a [tabela de limites e o alcance das referências](CRITERIOS-DE-CALCULO.md#critério-selecionável-do-limite-da-biela).

Capturas do controle: [tema claro](images/limite-biela-claro.png), [tema escuro](images/limite-biela-escuro.png) e [janela estreita](images/limite-biela-janela-estreita.png). Os [resultados de validação da contribuição](VALIDACAO-LIMITE-BIELA.md) registram o baseline e os limites dos testes.

#### Coeficientes dos materiais da peça

Em **Configurações > Dimensionamento > Coeficientes dos materiais da peça selecionada**, confira o nome da peça e edite γc e γs (números entre 1 e 2, com vírgula ou ponto decimal). Enter ou a saída do campo confirma uma entrada válida. O diálogo mostra os valores adotados, o par de referência do processo e cada valor abaixo da referência, quando houver. Os mesmos controles ficam nas propriedades **Cálculo**, junto ao processo de produção; a aba **Materiais** também exibe os valores atuais.

Os padrões são 1,40/1,15, inclusive ao abrir arquivos antigos. Selecionar **Pré-fabricado (controle de fábrica)** mostra a referência 1,30/1,10 e mantém os valores que já estavam adotados. A redução é uma permissão informada na issue #2, atribuída à NBR 9062:2017 §8.1, e uma decisão do responsável técnico. O programa não certifica o enquadramento do elemento. Para pré-moldado e moldado no local, a referência é 1,40/1,15.

As mudanças afetam somente a peça selecionada e entram em **Desfazer/Refazer**. **Concluir** ou Esc fecha a janela e devolve o foco ao comando; não desfaz edições já confirmadas. Use **Calcular** para conferir a nova revisão e **Salvar projeto** para guardar os valores no arquivo. A memória, o PDF e o cálculo auditável registram adotados e referências; coeficientes abaixo da referência geram **Conferir**, sem aprovação automática nem bloqueio da edição. Os desenhos de detalhamento incluem os coeficientes alterados e essas pendências nas notas.

Capturas e verificações: [validação da issue #2](VALIDACAO-COEFICIENTES-MATERIAIS.md).

Na lista de abas do ribbon, use as setas esquerda/direita, `Home` e `End` para navegar, e `Tab` para alcançar os controles. O estado dos controles funcionais é indicado visualmente e por tecnologia assistiva; os itens futuros são anunciados como desabilitados e ficam fora da sequência de foco. Em janelas estreitas, as abas e os grupos têm rolagem horizontal; o painel de Configurações também recebe foco por `Tab` e pode ser rolado com as setas esquerda/direita para consultar os grupos futuros.

## 5. Detalhar e exportar

Em **Detalhamento**, escolha **Somente este consolo** ou **Todos os consolos**, confira revisão, notas, camadas e armaduras. A quantidade multiplica o quadro de aço. Tirante duplo significa duas camadas na mesma face, não consolos nas duas faces do pilar.

- **DXF/SVG/PDF/CSV de detalhamento:** desenhos e comprimentos em cm, bitolas em mm. O quadro conta barras físicas, não apenas ramos.
- **Geometria DXF:** exportação antiga de contornos em mm, diferente do detalhamento.
- **Memória de cálculo:** relatório separado do desenho.
- **Cálculo auditável (`.calc.json`):** entradas e resultado com precisão completa; não é um arquivo importável como projeto.

As exportações de cálculo usam entradas atuais. No detalhamento, exportar pode ser permitido mesmo com pendências para revisão. A identificação **Para conferência do responsável técnico** não libera a execução; **Pendências impeditivas** exige correção. Consulte as convenções de corte, escala e fabricação em [DETALHAMENTO.md](DETALHAMENTO.md).

## Limites essenciais

Peças com 1 < a/d ≤ 2 são calculadas como viga em balanço (flexão simples e cisalhamento pelo Modelo I) quando o modelo resistente está em **Automático por a/d**; bielas e tirantes ou atrito escolhidos explicitamente nessa faixa são recusados. Acima de 600 mm de altura, a armadura de pele dessa faixa aparece como pendência a conferir, pois não é detalhada pelo programa. A viga em balanço não tem verificação de ELS, fissuração ou flecha.

Não estão incluídos dentes Gerber, consolos duplos/contínuos, a/d > 2, fadiga, ELS/fissuração, estrutura global, análise resistente espacial, dimensionamento dos pinos/chumbadores, aparelho de apoio completo, metalurgia das soldas ou compatibilização integral com as armaduras do suporte. Ductilidade do modelo de atrito e situações especiais de alça/gancho continuam com pendências explícitas.

O aplicativo aceita até 200 tipos de peça, 20 combinações adicionais por peça e projetos JSON de até 2 MB. Salve cópias de seus arquivos e retire dados privados antes de compartilhar exemplos em issues.
