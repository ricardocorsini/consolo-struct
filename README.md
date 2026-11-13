<p align="center">
  <img src="public/brand/consolostruct-128.png" alt="Atlas sustentando uma viga: ícone do ConsoloStruct" width="104" height="104" />
</p>

<h1 align="center">ConsoloStruct</h1>

<p align="center">Cálculo e detalhamento de consolos de concreto armado.<br />Um aplicativo livre do ecossistema <strong>OpenStruct</strong>.</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/licen%C3%A7a-MIT-3448D1" alt="Licença MIT" /></a>
  <img src="https://img.shields.io/badge/aplicativo-0.7.1-FF8A3D" alt="Aplicativo 0.7.1" />
  <a href="https://github.com/ricardocorsini/consolo-struct/actions/workflows/ci.yml"><img src="https://github.com/ricardocorsini/consolo-struct/actions/workflows/ci.yml/badge.svg?branch=master" alt="Integração contínua" /></a>
</p>

ConsoloStruct reúne geometria paramétrica, verificações no estado limite último, memória de cálculo e desenhos com quadro de aço em uma interface desktop. O processamento é local e o uso não exige conta nem servidor de aplicação. Após a instalação das dependências, os cálculos e as exportações funcionam sem conexão.

O projeto está em desenvolvimento. **Atender às verificações implementadas não equivale à aprovação executiva de uma peça ou estrutura.** Consulte as hipóteses, as pendências de cada resultado e os [critérios do motor](docs/CRITERIOS-DE-CALCULO.md).

## Recursos

- Consolos simples curtos e muito curtos, com modelos de bielas e tirantes e de atrito-cisalhamento.
- Complementos de El Debs, reação deslocada e comparação de modelos na memória.
- Entradas, combinações simultâneas, verificações e memória rastreável por peça.
- Sugestão de armaduras, com revisão dos critérios e histórico de alterações.
- Vistas 2D e 3D, pan/zoom e edição das dimensões pelo desenho.
- Detalhamento com elevação, planta, cortes, formas de dobramento e tirante em uma ou duas camadas.
- Quantidades por tipo de consolo, quadro de aço e exportação de uma peça ou de todo o projeto.
- Saídas DXF em centímetros, SVG, PDF vetorial, CSV e arquivo de cálculo auditável.
- Temas claro/escuro, painéis redimensionáveis, abas fecháveis e navegação por árvore.
- Arquivos de projeto locais `.consolo.json`, com leitura dos projetos anteriores `.lume.json`.

## Começar

Instale **Node.js 22.12 ou superior**; o projeto recomenda Node 24. Com o Git instalado:

```bash
git clone https://github.com/ricardocorsini/consolo-struct.git
cd consolo-struct
npm ci
npm run dev
```

Abra [http://127.0.0.1:1420](http://127.0.0.1:1420). Esta opção roda no navegador e não exige Rust. Se você usa nvm, `nvm use` seleciona a versão indicada em `.nvmrc`.

Para experimentar um caso conhecido, abra [examples/casos-validacao.lume.json](examples/casos-validacao.lume.json), selecione **Curto-ELU** e clique em **Calcular**. Para os desenhos, use [o projeto de detalhamento](examples/detalhamento/consolos-detalhados.lume.json), que contém tirante simples e duplo.

### Aplicativo desktop no Ubuntu

Além do Node, são necessários **Rust estável** e as bibliotecas nativas do Tauri 2. O [guia de instalação](docs/INSTALACAO.md) apresenta os comandos para Ubuntu 24.04 e as referências para outros sistemas.

Depois de preparar o ambiente:

```bash
bash scripts/check-ubuntu.sh
npm ci
npm run desktop:dev
```

Para avaliar o executável de produção:

```bash
npm run desktop:build -- --no-bundle
./src-tauri/target/release/consolostruct
```

Para gerar um `.deb`:

```bash
npm run desktop:build -- --bundles deb
```

O pacote será criado em `src-tauri/target/release/bundle/deb/`. **O repositório contém os fontes; não inclui instaladores ou `dist/` versionados.** A configuração padrão prioriza Linux. Windows e macOS exigem compilação e validação no respectivo sistema; veja o guia de instalação.

### Interface compilada no navegador

```bash
npm run build
npm run preview
```

Abra o endereço informado pelo Vite. Após gerar `dist/`, também é possível executar `bash INICIAR_WEB.sh` para servir a interface com Python 3 em [http://127.0.0.1:8320](http://127.0.0.1:8320). Evite abrir `dist/index.html` diretamente por `file://`.

## Escopo de engenharia

O **motor 0.4.0**, política **LC-ELU-2026.2**, trata o ELU estático local de consolos simples de concreto armado. Os critérios implementados se apoiam nas NBR 6118:2026 e 9062:2017 e nos modelos documentados de Araújo e El Debs. A versão do aplicativo e a do motor são identificações independentes.

Para `1 < a/d ≤ 2`, o modo automático calcula a peça como viga em balanço (flexão simples e cisalhamento pelo Modelo I, com costura até 600 mm de altura e pele a conferir acima disso), sem ELS, fissuração ou flecha.

O escopo atual não inclui dentes Gerber, consolos duplos/contínuos, `a/d > 2`, análise resistente espacial, fadiga, ELS/fissuração, estrutura global, verificação completa do aparelho de apoio, pinos/chumbadores ou compatibilização integral com a armadura do suporte. As combinações são fornecidas pelo usuário. Há situações que exigem conferência complementar, inclusive no modelo de atrito e em ligações especiais.

O motor distingue atendimento, falha, revisão necessária, entrada inválida e domínio não implementado. O desenho 3D é uma visualização; os [limites do detalhamento](docs/DETALHAMENTO.md) e do modelo resistente continuam aplicáveis. A responsabilidade de projeto e revisão permanece com o profissional habilitado.

Normas, livros e desenhos de terceiros usados como referência **não são redistribuídos neste repositório**. Os exemplos incluídos são casos de estudo para conferência.

Confira a [comparação minuciosa com Base Consolo](docs/COMPARACAO-BASE-CONSOLO.md) e o exemplo [base-consolo.lume.json](examples/base-consolo.lume.json).

## Documentação

| Documento                                            | Conteúdo                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| [Instalação](docs/INSTALACAO.md)                     | Ambiente, execução, produção, `.deb`, AppImage e outras plataformas       |
| [Atualizações](docs/ATUALIZACOES.md)                 | Checagem ao abrir, catálogo assinado e atualização por tipo de instalação |
| [Guia de uso](docs/GUIA-DE-USO.md)                   | Navegação, arquivos, vistas, exemplos e convenções de entrada             |
| [Critérios de cálculo](docs/CRITERIOS-DE-CALCULO.md) | Equações, fontes, hipóteses e limites do motor                            |
| [Validação do motor](docs/VALIDACAO-MOTOR.md)        | Casos de referência e resultados esperados                                |
| [Detalhamento](docs/DETALHAMENTO.md)                 | Barras, cotas, quantidades, saídas e pendências                           |
| [Visualização 3D](docs/VISUALIZACAO-3D.md)           | Representação espacial, navegação e limitações                            |
| [Arquitetura](docs/ARQUITETURA.md)                   | Módulos e separação entre interface e cálculo                             |
| [Desempenho](docs/DESEMPENHO-0.6.md)                 | Worker, cache, navegação e medições indicativas                           |
| [Validação da distribuição](docs/VALIDACAO.md)       | Verificações executadas e limites do ambiente testado                     |
| [Histórico](CHANGELOG.md)                            | Mudanças registradas por versão                                           |

## Desenvolvimento

A interface usa **React 19, TypeScript e Vite**; a janela desktop usa **Tauri 2/Rust**. Os cálculos são implementados em TypeScript, sem dependência de React ou de um backend. A vista 3D usa Three.js, as exportações PDF usam jsPDF e as entradas são validadas com Zod.

| Caminho              | Responsabilidade                                            |
| -------------------- | ----------------------------------------------------------- |
| `src/domain/`        | Modelo do projeto, validação, motor e sugestão de armaduras |
| `src/detailing/`     | Geometria das barras, desenhos, worker, cache e exportações |
| `src/visualization/` | Geometria e cena 3D                                         |
| `src/components/`    | Interface desktop e vistas                                  |
| `src/lib/`           | Arquivos e exportações gerais                               |
| `src-tauri/`         | Janela nativa, permissões e empacotamento                   |
| `tests/`             | Testes de domínio, cálculo, desenho e interface             |
| `examples/`          | Projetos de estudo e saídas para conferência                |

Comandos principais, depois de `npm ci`:

```bash
npm run check            # TypeScript e testes unitários
npm run build            # Interface de produção
npm run format:check     # Conferir formatação
npx playwright install --with-deps chromium
npm run test:e2e         # Fluxos de interface no Chromium
```

O workflow [CI](.github/workflows/ci.yml) executa formatação, tipos, testes unitários, build e testes de interface em pushes e pull requests. A compilação nativa não faz parte desse workflow. Os testes ajudam a detectar regressões; não substituem a validação técnica independente do projeto.

## Contribuir

Correções, casos de validação, melhorias de acessibilidade e sugestões são bem-vindos. Leia [CONTRIBUTING.md](CONTRIBUTING.md), abra uma [issue](https://github.com/ricardocorsini/consolo-struct/issues/new/choose) ou envie um pull request. Alterações no motor devem vir acompanhadas de referência técnica, hipóteses e exemplo reproduzível.

Há [modelos de issues](.github/ISSUE_TEMPLATE/) para bugs, divergências de cálculo e propostas de recursos. Para problemas de segurança, consulte [SECURITY.md](SECURITY.md).

## Licença e autoria

Criado por **Ricardo Corsini**, como parte do **OpenStruct**.

Código sob a [licença MIT](LICENSE). Dependências e fontes mantêm suas respectivas licenças; consulte [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) e [third-party-licenses/](third-party-licenses/).
