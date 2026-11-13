# Checagem de atualizações (issue #45)

## Estado anterior e causa

Na triagem em `fa8c890` (0.7.1), o executável nativo (`src-tauri/src/lib.rs`) registrava apenas
os plugins de diálogo e de arquivos. Não havia comando, plugin de updater ou interface que
consultasse versões: o aplicativo não verificava atualizações ao ser aberto em nenhum sistema.
A oferta vista no Struct Launcher é do próprio Launcher e só aparece quando ele é aberto. A
causa no Linux, portanto, é **implementação ausente**, e não falha de rede ou de pacote; a
mesma ausência vale para o Windows.

Esta conclusão vem da leitura do código e da distribuição. A instalação usada no relato do
Linux (versão, formato e caminho do executável) não foi reproduzida nesta contribuição.

Atalhos que abrem uma cópia antiga são outro problema, acompanhado em
[Launcher #3](https://github.com/ricardocorsini/launcher-struct/issues/3). O aplicativo agora
detecta e informa esse caso depois de uma atualização (ver _Conferência após reiniciar_).

## Fonte oficial e contratos reutilizados

A consulta usa o catálogo assinado do hub `ricardocorsini/openstruct-catalog`, o mesmo lido pelo
Launcher, e não a última release do hub nem o feed `launcher/latest.json`, que é exclusivo do
Launcher. Os contratos são os de `scripts/security.mjs` e `release-lib.mjs` do catálogo:

1. `catalog.signed.json` é um envelope `{payload, signature, keyId}`. O aplicativo exige
   `keyId = catalog-v1` e confere a assinatura Ed25519 com a chave pública fixada no binário.
2. `schemaVersion` deve ser 1; outro esquema é erro, nunca “atualizado”.
3. Somente o produto `consolostruct` é considerado. Um ID ausente ou duplicado é erro.
4. Versões: SemVer canônico, canal `stable`, sem pré-lançamento nem build metadata, e
   estritamente maior que a versão em execução. Versão igual ou mais antiga nunca é oferecida.
5. Pacote: mesmo `platform`, `arch` e `kind` da instalação (`windows/x86_64/nsis` ou
   `linux/x86_64/appimage`), `keyId = consolostruct-packages-v1`, URL dentro de
   `https://github.com/ricardocorsini/consolo-struct/releases/download/vX.Y.Z/`, tamanho e
   SHA-256 válidos e assinatura Ed25519 da mensagem `OPENSTRUCT-PACKAGE-V1` conferida.
6. Se a versão mais nova para o sistema for recusada, o aplicativo mostra o erro e não oferece
   silenciosamente uma versão anterior.

A assinatura do catálogo não é uma assinatura Tauri: o ConsoloStruct não é publicado com
artefatos do updater Tauri, que continuam exclusivos do Launcher. O SHA-256 não substitui a
autenticidade: ele só é aceito porque vem do pacote assinado. Nenhuma chave privada ou token é
incluído no binário. A consulta é um GET anônimo à URL fixa; nenhum arquivo ou dado do projeto
é enviado.

## Comportamento

- **Ao abrir** (inclusive por atalho, sem o Launcher), a consulta é feita 4 s depois da
  inicialização, em segundo plano, uma vez por sessão. O resultado automático fica em cache por
  10 minutos no processo; não há polling.
- **Sem conexão, timeout (10 s para conectar, 20 s no total), catálogo inválido ou assinatura
  recusada** aparecem como “Atualizações não verificadas” na barra de status, sem interromper o
  trabalho. Clicar mostra o motivo e permite tentar de novo.
- **Oferta**: um aviso não modal mostra a versão em execução, a oferecida, o pacote e as notas
  da versão. “Atualizar” e “Agora não”. Adiar não baixa nem instala e silencia somente aquela
  versão por 24 horas; a barra de status continua indicando a atualização disponível.
- **Manual**: Configurações > Geral > Verificar atualizações, ou clique na barra de status.
- **Download** só após “Atualizar”. O catálogo é consultado de novo: se a versão oferecida mudou
  ou saiu do catálogo, nada é baixado e a nova oferta precisa ser confirmada. O progresso é
  exibido e pode ser cancelado. Tamanho e SHA-256 são conferidos durante o fluxo; um arquivo
  divergente, interrompido ou maior que o declarado é apagado.
- **Antes de reiniciar**, o usuário escolhe “Salvar projeto e reiniciar”, “Reiniciar agora” ou
  “Cancelar”. O rascunho local é gravado e reaberto pela nova versão; se ele não puder ser
  gravado, só o salvamento em arquivo libera o reinício. Cancelar ou falhar ao salvar impede o
  reinício. Exportações em curso também impedem.
- **Instalação**: o arquivo é conferido de novo imediatamente antes do uso. Uma trava entre
  processos impede duas cópias de instalar ao mesmo tempo, e cliques repetidos não iniciam
  outra operação.

## Por tipo de instalação

| Instalação                                         | Detecção                                                                             | Comportamento                                                                                                                                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Struct Launcher (Windows/Linux)                    | `.openstruct-managed.json` com `appId: consolostruct` ao lado do executável/AppImage | Mostra a oferta, mas não baixa nem executa instalador próprio: o Launcher mantém o inventário (`state.json`, hash do executável), a versão ativa e os atalhos. No Windows, o botão abre o Struct Launcher instalado em `%LOCALAPPDATA%\Struct Launcher`. |
| NSIS independente (Windows)                        | `uninstall.exe` na pasta do executável, sem a marca do Launcher                      | Executa o instalador oficial conferido com `/P /R /UPDATE /D=<pasta atual>`: modo passivo com progresso, mesma pasta, preserva as escolhas de atalho, recusa downgrade e reabre o aplicativo.                                                            |
| AppImage independente (Linux)                      | `$APPIMAGE` aponta para um arquivo existente                                         | Baixa ao lado do AppImage (exige permissão de escrita na pasta), aplica as permissões do arquivo atual e substitui com `rename` atômico. Reabre o mesmo caminho. Falhas antes do `rename` mantêm o AppImage anterior intacto.                            |
| Pacote do sistema (`.deb` em `/usr`/`/opt`)        | Executável fora de AppImage                                                          | Sem atualização interna; orienta usar o gerenciador de pacotes ou o AppImage oficial pelo Launcher. Não troca o método de instalação.                                                                                                                    |
| Executável avulso ou compilação de desenvolvimento | Sem instalador/AppImage, ou `debug_assertions`                                       | A consulta funciona; a instalação é recusada com a explicação e a página oficial de releases.                                                                                                                                                            |

O pacote oficial só existe para x86_64. Em outra arquitetura, uma versão nova aparece como
“sem pacote compatível”, nunca como atualizada.

## Conferência após reiniciar

Antes de aplicar, o aplicativo grava `{from, to, mode}`. Na abertura seguinte compara com a
versão realmente em execução: confirma “atualizado de X para Y” ou avisa que a versão anterior
foi aberta (instalador cancelado ou atalho apontando para outra cópia).

## Testes

- `cargo test --manifest-path src-tauri/Cargo.toml` (job `native` do CI): assinatura e esquema
  do catálogo, catálogo real publicado com as chaves fixadas, seleção de produto, SemVer e
  canal, downgrade, pacote incompatível, assinatura/URL/tamanho/hash adulterados, versões
  duplicadas, detecção Launcher/NSIS/AppImage/pacote/avulso, hosts e redirecionamentos HTTPS,
  download interrompido, timeout, hash divergente, cancelamento, disco cheio, permissão e trava
  contra instaladores concorrentes.
- `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored` (manual, exige internet):
  consulta o catálogo oficial como 0.7.0, baixa o pacote real oferecido pelos redirecionamentos
  do GitHub e confere tamanho e SHA-256, sem instalar.
- `tests/updates.test.ts`: transições, cliques repetidos, adiamento, rótulos de erro e
  conferência pós-reinício.
- `tests/e2e/updates.spec.ts`: interface com a ponte Tauri simulada (oferta, Agora não, download
  único, proteção antes de reiniciar, falha de integridade, offline, Launcher e web).

### Validação nativa executada (Windows 11 x64, 13/11/2026)

- Executável de produção (`tauri build --no-bundle`) configurado como 0.7.0 e aberto direto,
  sem o Launcher: consultou o catálogo oficial, ofereceu a 0.7.1 (NSIS x86_64, 5,0 MB, notas da
  release) e identificou o executável avulso, sem oferecer instalação.
- Teste online acima aprovado no mesmo ambiente.
- Não executado: instalação NSIS com reinício, AppImage no Linux e instalação do Launcher.

Testes web e simulados não comprovam a atualização nativa. Antes de publicar uma versão com
este recurso, valide em cada sistema com um pacote anterior instalado e uma versão mais nova no
catálogo: versão de origem/destino, pacote, arquitetura, ambiente, versão aberta após o
reinício, preservação do rascunho e coerência de atalhos e inventário do Launcher.

## Limitações

- A primeira versão capaz de se atualizar é a que contém este código: instalações 0.7.1 ou
  anteriores continuam precisando do Launcher ou de instalação manual para chegar até ela.
- Não há proteção contra a reapresentação de um catálogo antigo, mas válido; o efeito máximo é
  não oferecer a versão mais nova.
- O Windows em instalação por máquina (fora do padrão por usuário) pode pedir elevação ao
  instalador.
- Se outra cópia independente do ConsoloStruct foi instalada pelo NSIS em outra pasta, o
  registro de desinstalação do Windows é compartilhado entre as cópias.
