# Plano de Overhaul: Remote Control (Flutter)

Este documento detalha as etapas para o polimento da UI/UX, melhorias de persistência e novas funcionalidades do aplicativo de controle remoto.

## Etapa 1: Polimento Visual (UI/UX)
- [ ] **Background Limpo:** Remover as bolhas animadas e definir o fundo como `#07080A` (Preto puro/profundo).
- [ ] **Status Bar no Header:**
    - [ ] Implementar listener para `status/update` no `ChatController`.
    - [ ] Exibir a frase de status do agente logo abaixo do path do projeto no Header.
    - [ ] Remover o custo duplicado abaixo do título do chat no dropdown.
- [ ] **Refatoração de Mensagens:**
    - [ ] Ajustar as bolhas de mensagens do usuário para incluir um ângulo/chanfro específico.
    - [ ] Remover a tool `report_status` do histórico de mensagens do chat (agora ela vive apenas no Header).
- [ ] **Modernização de Tools:**
    - [ ] Remover o header redundante das tools (ícone de chave de boca e contador).
    - [ ] Expandir a largura das tools para ocupar mais espaço horizontal.
    - [ ] **read_file & Code Tools:** Implementar limite de altura (max-height) com scroll interno e fundo escuro contrastante para blocos de código.
- [ ] **Correção do Patch Widget:** Garantir que o conteúdo editado permaneça visível mesmo após o estado mudar para `success`.

## Etapa 2: Persistência e Dados (Firestore)
- [ ] **Sincronização de Chats:** Alterar a lógica para listar chats persistidos no Firestore/SQLite da extensão, permitindo restaurar sessões anteriores.
- [ ] **Listagem de Instâncias:** Corrigir a visualização de instâncias ativas do VS Code para seleção.
- [ ] **Abertura de Projetos:** Implementar a interface para navegar e abrir novos projetos/pastas via Remote Control.

## Etapa 3: Internacionalização (i18n)
- [ ] Implementar sistema de tradução (GetX Translations ou similar).
- [ ] Adicionar suporte para `PT-BR` e `EN`.
- [ ] Garantir que a extensão do VS Code permaneça em `EN` por padrão.

## Etapa 4: Limpeza e Otimização
- [ ] Revisão geral de contrastes e acessibilidade.
- [ ] Testes de performance no scroll de conversas longas.
- [ ] Remoção de códigos mortos e logs desnecessários.

---
*Plano gerado em 16/04/2026*