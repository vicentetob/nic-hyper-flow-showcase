// Tipos locais para substituir @google/generative-ai
enum SchemaType {
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  INTEGER = 'INTEGER',
  BOOLEAN = 'BOOLEAN',
  OBJECT = 'OBJECT',
  ARRAY = 'ARRAY'
}

export const TOOL_DEFINITIONS: Record<string, any> = {
    // =========================
    // LEITURA, BUSCA, NAVEGAÇÃO
    // =========================
    read_file: {
        name: 'read_file',
        description: 'Lê o conteúdo de um arquivo do workspace. Pode ler o arquivo inteiro ou um intervalo de linhas (1-based).',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                path: { type: SchemaType.STRING, description: 'Caminho relativo do arquivo' },
                startLine: { type: SchemaType.INTEGER, description: 'Linha inicial (1-based, opcional)' },
                endLine: { type: SchemaType.INTEGER, description: 'Linha final (1-based, opcional, inclusiva)' }
            },
            required: ['path']
        }
    },
    read_multiple_files: {
        name: 'read_multiple_files',
        description: 'Lê o conteúdo de múltiplos arquivos de uma vez. Útil para obter contexto de vários arquivos em uma única chamada.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                files: {
                    type: SchemaType.ARRAY,
                    description: 'Lista de arquivos para ler',
                    items: {
                        type: SchemaType.OBJECT,
                        properties: {
                            path: { type: SchemaType.STRING, description: 'Caminho relativo do arquivo' },
                            startLine: { type: SchemaType.INTEGER, description: 'Linha inicial (1-based, opcional)' },
                            endLine: { type: SchemaType.INTEGER, description: 'Linha final (1-based, opcional, inclusiva)' }
                        },
                        required: ['path']
                    }
                }
            },
            required: ['files']
        }
    },

    list_dir_recursive: {
        name: 'list_dir_recursive',
        description: 'Lista recursivamente a árvore de diretórios com filtros inteligentes.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                path: { type: SchemaType.STRING, description: 'Caminho relativo do diretório (use "." para raiz)' },
                maxDepth: { type: SchemaType.INTEGER, description: 'Profundidade máxima da recursão (padrão: 5)' },
                exclude: { 
                    type: SchemaType.ARRAY, 
                    description: 'Lista de nomes de diretórios/arquivos a excluir',
                    items: { type: SchemaType.STRING }
                },
                includeHidden: { type: SchemaType.BOOLEAN, description: 'Se deve incluir arquivos ocultos (padrão: false)' },
                maxFiles: { type: SchemaType.INTEGER, description: 'Limite de segurança para o número total de arquivos listados (padrão: 1000)' }
            },
            required: ['path']
        }
    },
    search: {
        name: 'search',
        description: `Busca textual (substring/regex) no workspace. Varre conteúdo e nomes de arquivos.

RETORNO: { structure, fileCount, matchCount, truncated, pkb_content }
  structure = bloco "arquivo.ts\\n  L42: preview..." — sem JSON, pronto pra leitura.
  pkb_content = memória persistente do agente (sempre retornada).

ESTRATÉGIA:
- Use termos CURTOS e genéricos primeiro ("thinking", não "thinkingBubble").
- Se retornar 0 results, tente termo mais curto ou isRegex:true.
- Use queries[] com termos relacionados em vez de chamar a tool várias vezes.
- Nunca repita o mesmo termo em chamadas consecutivas.`,
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                query: { type: SchemaType.STRING, description: 'Termo ou regex de busca (use para busca única)' },
                queries: {
                    type: SchemaType.ARRAY,
                    description: 'Lista de termos/regex (até 10) para executar em uma única varredura do workspace.',
                    items: { type: SchemaType.STRING }
                },
                path: {
                    type: SchemaType.STRING,
                    description: 'Caminho base para restringir a busca (opcional).'
                },
                include: {
                    type: SchemaType.STRING,
                    description: 'Filtro glob opcional. Ex: "**/*.ts"'
                },
                isRegex: { type: SchemaType.BOOLEAN, description: 'Interpreta query/queries como regex (padrão: false). Ex: "hideThinking|stripThinking".' },
                caseSensitive: { type: SchemaType.BOOLEAN, description: 'Busca case-sensitive (padrão: false)' },
                wholeWord: { type: SchemaType.BOOLEAN, description: 'Corresponde apenas palavras inteiras (padrão: false)' },
                exclude: { type: SchemaType.STRING, description: 'Glob de exclusão adicional. Padrão já exclui node_modules, dist, .git, etc.' },
                maxResults: { type: SchemaType.INTEGER, description: 'Limite de resultados por termo (padrão: 1000)' },
                maxTotalResults: { type: SchemaType.INTEGER, description: 'Limite total somando todos os termos (padrão: 2000)' },
                maxLinesPerFile: { type: SchemaType.INTEGER, description: 'Máximo de linhas por arquivo no structure (padrão: 20)' },
                maxPreviewChars: { type: SchemaType.INTEGER, description: 'Máximo de chars por preview no structure (padrão: 180)' }
            },
            required: []
        }
    },

// ─── Adicionar em TOOL_DEFINITIONS (definitions.ts) ──────────────────────────

call_claude: {
    name: 'call_claude',
    description: `Delega uma tarefa para o Claude Code CLI rodando de forma autônoma no workspace.
Use para raciocínio pesado, refatorações grandes, layout web refinado ou pra economizar tokens — o usuário tem assinatura mensal do Claude Code trazendo um custo-benefício significativo.

O Claude Code lê o workspace, age autonomamente (edita arquivos, roda comandos, testa) e retorna
um resumo estruturado: o que foi feito, arquivos modificados com snippets, erros e sugestões.

WAIT=TRUE: você aguardará o resultado antes de continuar. Seu loop será pausado e retomado somente após o retorno do agente. Use para tarefas que bloqueiam o fluxo.
WAIT=FALSE: Claude Code roda em background e você recebe um job_id. Continue trabalhando e chame call_claude_check quando quiser o resultado.

QUANDO USAR:
- Arquitetura de novos módulos ou features complexas
- Debugging que você não resolveu em 2 tentativas
- Layout web / UI que precisa de qualidade visual alta
- Refatorações que envolvem múltiplos arquivos
- Quando você travou em algum problema e não conseguiu progredir depois de diversas tentativas`,
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            task: {
                type: SchemaType.STRING,
                description: `Descrição completa da tarefa. Seja específico: inclua contexto do problema, arquivos relevantes, o que já foi tentado, e o resultado que obteve. Você deve contextualizar o problema ou nova implementação antes de passar pro Claude. Você já sabe o que tentou, o que falhou, qual arquivo é pode ser o culpado, qual linha suspeita — e passa tudo isso destilado por aqui. note que o humano descreve o problema como sente — "tá quebrando não sei por quê". Você descreve como observou — "tentei X, Y e Z, o erro ocorre na linha 47 do arquivo tal quando o estado é esse, suspeito do race condition nesse fluxo específico".`
            },
            wait: {
                type: SchemaType.BOOLEAN,
                description: 'true (padrão): aguarda o Claude terminar antes de retornar. false: dispara em background e retorna job_id imediatamente.'
            },
            send_multiple_files: {
                type: SchemaType.ARRAY,
                description: 'Arquivos a injetar no prompt antes da tarefa. O conteúdo raw é embutido diretamente, evitando que o Claude Code precise chamar uma tool de leitura logo de início — economiza um turno e já chega contextualizado.',
                items: {
                    type: SchemaType.OBJECT,
                    properties: {
                        path:      { type: SchemaType.STRING,  description: 'Caminho relativo à raiz do workspace (ou absoluto).' },
                        startLine: { type: SchemaType.INTEGER, description: 'Linha inicial (1-based, opcional). Omitir = início do arquivo.' },
                        endLine:   { type: SchemaType.INTEGER, description: 'Linha final (1-based, opcional, inclusiva). Omitir = fim do arquivo.' }
                    },
                    required: ['path']
                }
            },
            cwd: {
                type: SchemaType.STRING,
                description: 'Diretório de trabalho (padrão: workspace root). Use para apontar um subprojeto específico.'
            },
            system_context: {
                type: SchemaType.STRING,
                description: 'Contexto extra de sistema: convenções do projeto, stack, regiões críticas que não devem ser tocadas, decisões de arquitetura relevantes para esta tarefa.'
            }
        },
        required: ['task']
    }
},

call_claude_check: {
    name: 'call_claude_check',
    description: `Verifica o status de um job do Claude Code iniciado em background (wait=false).
Retorna "running" com tempo decorrido se ainda estiver trabalhando, ou "done" com o resultado completo se terminou.
Chame periodicamente até receber status "done".`,
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            job_id: {
                type: SchemaType.STRING,
                description: 'O job_id retornado pela call_claude com wait=false.'
            }
        },
        required: ['job_id']
    }
},

call_claude_stop: {
    name: 'call_claude_stop',
    description: `Interrompe imediatamente um job do Claude Code rodando em background.
Use quando quiser cancelar uma tarefa em andamento — por exemplo, se percebeu que o escopo mudou,
que o agente está no caminho errado, ou simplesmente quer liberar a cota do plano Pro.`,
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            job_id: {
                type: SchemaType.STRING,
                description: 'O job_id retornado pela call_claude com wait=false.'
            }
        },
        required: ['job_id']
    }
},
call_claude_reply: {
    name: 'call_claude_reply',
    description: `Envia uma resposta para uma sessão do Claude Code que fez uma pergunta ou pediu mais contexto.
Use quando call_claude retornar raw_result com uma pergunta em vez de uma ação — o Claude pediu esclarecimento.
Retoma a mesma sessão via session_id, mantendo todo o histórico e contexto da conversa anterior.
 
WAIT=TRUE (padrão): aguarda a resposta antes de continuar.
WAIT=FALSE: dispara em background e retorna job_id — use call_claude_check para verificar.
CRITICAL: VOCÊ DEVE USAR ESSA TOOL PARA INTERAGIR COM O CLAUDE SE ELE SOLICITAR ALGO OU NÃO TERMINAR A TAREFA OU A PEDIDO DO USUÁRIO PARA FORMULAR MELHORES SOLUÇÕES COMBINANDO O SEU RACIOCÍNIO COM O DELE
EXTREME CRITICAL: NÃO USE A TOOL CALL_CLAUDE PARA TENTAR RESPONDER AO CLAUDE A TOOL CALL_CLAUDE_REPLY SERVE PRA ISSO E NÃO ESQUEÇA DE PASSAR O SESSION_ID CORRETO!`,
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            session_id: {
                type: SchemaType.STRING,
                description: 'O session_id retornado pelo call_claude anterior. Identifica a sessão a retomar.'
            },
            message: {
                type: SchemaType.STRING,
                description: 'Sua resposta à pergunta do Claude Code. Seja específico — inclua o que ele pediu: arquivo, linha, conteúdo exato, etc.'
            },
            wait: {
                type: SchemaType.BOOLEAN,
                description: 'true (padrão): aguarda o Claude terminar. false: dispara em background e retorna job_id.'
            },
            cwd: {
                type: SchemaType.STRING,
                description: 'Diretório de trabalho (padrão: workspace root).'
            }
        },
        required: ['session_id', 'message']
    }
},

    web_search: {
        name: 'web_search',
        description: 'Pesquisa na web usando Serper (Google Search API) com suporte a operadores avançados. OPERADORES: site: (domínio específico), filetype:/ext: (tipo arquivo), intitle:/inbody:/inpage: (localização), lang: (idioma ISO 639-1), loc: (país ISO 3166-1), + (forçar termo), - (excluir), "" (frase exata), AND/OR/NOT (lógica, UPPERCASE). Aceita 1 termo (query) ou múltiplos (queries, até 10).',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                query: { type: SchemaType.STRING, description: 'Termo de busca com operadores opcionais. Ex: "machine learning filetype:pdf lang:en"' },
                queries: {
                    type: SchemaType.ARRAY,
                    description: 'Lista de termos de busca (até 10) para executar em uma única chamada.',
                    items: { type: SchemaType.STRING }
                },
                limit: { type: SchemaType.INTEGER, description: 'Quantidade de resultados (por query, padrão 5, máx 10)' },
                country: { type: SchemaType.STRING, description: 'Código do país ISO 3166-1 (ex: "us", "br", "gb") para resultados regionais (usado como gl no Serper)' },
                searchLang: { type: SchemaType.STRING, description: 'Código do idioma ISO 639-1 (ex: "en", "pt", "es") para interface de busca (usado como hl no Serper)' },
                freshness: { type: SchemaType.STRING, description: 'Filtro temporal (Suportado nativamente via operadores na query como "after:2023-01-01"): "pd" (último dia), "pw" (última semana), "pm" (último mês), "py" (último ano)' },
                timeoutMs: { type: SchemaType.INTEGER, description: 'Timeout por requisição em ms (padrão 10000, máx 300000)' },
                fetchPages: { type: SchemaType.BOOLEAN, description: 'Se deve buscar prévia do conteúdo das páginas (opcional)' },
                maxPages: { type: SchemaType.INTEGER, description: 'Máximo de páginas para prévia por query (opcional, máx 5)' },
                maxPageChars: { type: SchemaType.INTEGER, description: 'Máximo de caracteres por prévia de página (opcional, máx 10000)' },
                debug: { type: SchemaType.BOOLEAN, description: 'Retorna metadados de debug (opcional)' }
            },
            required: []
        }
    },
    wikipedia: {
        name: 'wikipedia',
        description: 'Consulta a Wikipedia para obter resumos ou listas de artigos sobre um tópico.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                query: { type: SchemaType.STRING, description: 'Tópico ou termo a pesquisar' },
                lang: { type: SchemaType.STRING, description: 'Código do idioma (ex: "pt", "en"). Padrão: "pt"' },
                limit: { type: SchemaType.INTEGER, description: 'Número de resultados (padrão: 3)' },
                fullContent: { type: SchemaType.BOOLEAN, description: 'Se true, traz o resumo detalhado do primeiro resultado. (padrão: false)' }
            },
            required: ['query']
        }
    },
    read_url: {
        name: 'read_url',
        description: 'Extrai o conteúdo principal de uma página web como texto limpo (Reader Mode). Remove scripts, estilos e anúncios MAS MANTÉM LINKS PARA NAVEGAÇÃO.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                url: { type: SchemaType.STRING, description: 'URL da página a ser lida' }
            },
            required: ['url']
        }
    },
    http_request: {
        name: 'http_request',
        description: 'Realiza requisições HTTP controladas para testar APIs. Suporta métodos GET/POST/PUT/PATCH/DELETE, autenticação, headers, query params e body (JSON/Text/Multipart/Binary).',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                url: { type: SchemaType.STRING, description: 'URL completa da requisição' },
                method: { type: SchemaType.STRING, description: 'Método HTTP (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS). Padrão: POST' },
                query: { type: SchemaType.OBJECT, description: 'Parâmetros de query string como objeto key-value' },
                headers: { type: SchemaType.OBJECT, description: 'Headers da requisição como objeto key-value' },
                timeoutMs: { type: SchemaType.INTEGER, description: 'Timeout da requisição em ms (padrão 15000, máx 60000)' },
                bodyType: { type: SchemaType.STRING, description: 'Tipo do corpo: json, text, form_urlencoded, multipart, binary_base64, none' },
                body: { type: SchemaType.STRING, description: 'Conteúdo do corpo da requisição (ou objeto JSON se bodyType for json)' },
                auth: { 
                    type: SchemaType.ARRAY, 
                    description: 'Lista de itens de autenticação (bearer, basic, api_key)',
                    items: { type: SchemaType.OBJECT }
                },
                followRedirects: { type: SchemaType.BOOLEAN, description: 'Se deve seguir redirecionamentos (padrão: true)' },
                maxResponseBytes: { type: SchemaType.INTEGER, description: 'Limite de tamanho da resposta em bytes (padrão: 1MB)' }
            },
            required: ['url']
        }
    },
    read_pdf_ref: {
        name: 'read_pdf_ref',
        description: 'Lê texto de arquivos PDF com suporte a referências semânticas (pdf:path.pdf#p:118-120). Remove headers/footers repetidos automaticamente.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                ref: { 
                    type: SchemaType.STRING, 
                    description: 'Referência semântica no formato pdf:path.pdf#p:118 ou pdf:path.pdf#p:118-120 ou pdf:path.pdf#ps:10#pe:12' 
                },
                path: { 
                    type: SchemaType.STRING, 
                    description: 'Caminho relativo do arquivo PDF (alternativa à ref)' 
                },
                page: { 
                    type: SchemaType.INTEGER, 
                    description: 'Número da página específica (1-based)' 
                },
                pageStart: { 
                    type: SchemaType.INTEGER, 
                    description: 'Página inicial do intervalo (1-based)' 
                },
                pageEnd: { 
                    type: SchemaType.INTEGER, 
                    description: 'Página final do intervalo (1-based)' 
                },
                expandPages: { 
                    type: SchemaType.INTEGER, 
                    description: 'Quantidade de páginas para expandir antes/depois do intervalo (padrão: 0, máx: 10)' 
                },
                maxPdfBytes: { 
                    type: SchemaType.INTEGER, 
                    description: 'Tamanho máximo do PDF em bytes (padrão: 1MB, máx: 20MB)' 
                },
                maxPdfPages: { 
                    type: SchemaType.INTEGER, 
                    description: 'Número máximo de páginas a extrair (padrão: 400)' 
                },
                maxPdfCharsPerPage: { 
                    type: SchemaType.INTEGER, 
                    description: 'Número máximo de caracteres por página (padrão: 60k)' 
                }
            },
            required: []
        }
    },
    read_docx: {
        name: 'read_docx',
        description: 'Lê texto de arquivos Word (.docx) usando Python.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                path: { 
                    type: SchemaType.STRING, 
                    description: 'Caminho relativo do arquivo DOCX' 
                },
                maxDocxBytes: { 
                    type: SchemaType.INTEGER, 
                    description: 'Tamanho máximo do arquivo em bytes (padrão: 1MB, máx: 20MB)' 
                },
                maxDocxChars: { 
                    type: SchemaType.INTEGER, 
                    description: 'Número máximo de caracteres a extrair (padrão: 100k)' 
                }
            },
            required: ['path']
        }
    },
    get_image: {
        name: 'get_image',
        description: 'Lê uma imagem do repositório local.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                path: { type: SchemaType.STRING, description: 'Caminho da imagem' }
            },
            required: ['path']
        }
    },
    adb_screenshot: {
        name: 'adb_screenshot',
        description: 'Captura a tela de um dispositivo Android via ADB. Tenta primeiro adb exec-out screencap -p e, se a saída vier inválida/corrompida, faz fallback para screencap em arquivo no device + pull. Retorna a screenshot capturada e salva o PNG localmente.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                deviceId: { type: SchemaType.STRING, description: 'Serial do dispositivo (omitir se houver apenas um conectado)' },
                savePath: { type: SchemaType.STRING, description: 'Caminho local para salvar o PNG (padrão: /tmp/adb_screenshot_<ts>.png)' },
                displayId: { type: SchemaType.STRING, description: 'ID do display para passar em -d no screencap quando o device reporta múltiplos displays (opcional)' }
            },
            required: []
        }
    },
    adb_input: {
        name: 'adb_input',
        description: `Envia eventos de interação para um dispositivo Android via ADB.
Complementa adb_screenshot: use screenshot para ver a tela, identifique as coordenadas, depois use adb_input para interagir.

AÇÕES DISPONÍVEIS:
- tap:       Toque em coordenadas absolutas (x, y)
- long_tap:  Toque longo — útil para menus de contexto (x, y, durationMs?)
- swipe:     Swipe entre dois pontos — scroll, drag, dismiss (x1, y1, x2, y2, durationMs?)
- text:      Digita texto no campo atualmente focado
- keyevent:  Envia uma tecla: BACK | HOME | MENU | ENTER | DEL | DPAD_UP | DPAD_DOWN | DPAD_LEFT | DPAD_RIGHT | VOLUME_UP | VOLUME_DOWN | POWER | TAB | ESCAPE (ou número direto)
- get_size:  Retorna a resolução do device (ex: "1080x2400") — use antes de calcular coordenadas

EXEMPLO — abrir app, scrollar e voltar:
{
  "actions": [
    { "type": "get_size" },
    { "type": "tap", "x": 540, "y": 960 },
    { "type": "swipe", "x1": 540, "y1": 1400, "x2": 540, "y2": 400, "durationMs": 400 },
    { "type": "keyevent", "keycode": "BACK" }
  ]
}`,
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                actions: {
                    type: SchemaType.ARRAY,
                    description: 'Lista de ações a executar em sequência.',
                    items: {
                        type: SchemaType.OBJECT,
                        properties: {
                            type: {
                                type: SchemaType.STRING,
                                enum: ['tap', 'long_tap', 'swipe', 'text', 'keyevent', 'get_size'],
                                description: 'Tipo da ação'
                            },
                            x:          { type: SchemaType.INTEGER, description: 'Coordenada X (tap, long_tap)' },
                            y:          { type: SchemaType.INTEGER, description: 'Coordenada Y (tap, long_tap)' },
                            x1:         { type: SchemaType.INTEGER, description: 'X inicial (swipe)' },
                            y1:         { type: SchemaType.INTEGER, description: 'Y inicial (swipe)' },
                            x2:         { type: SchemaType.INTEGER, description: 'X final (swipe)' },
                            y2:         { type: SchemaType.INTEGER, description: 'Y final (swipe)' },
                            durationMs: { type: SchemaType.INTEGER, description: 'Duração em ms (long_tap padrão: 800, swipe padrão: 300)' },
                            value:      { type: SchemaType.STRING,  description: 'Texto a digitar (text)' },
                            keycode:    { type: SchemaType.STRING,  description: 'Keycode nomeado ou número (keyevent)' }
                        },
                        required: ['type']
                    }
                },
                deviceId: { type: SchemaType.STRING,  description: 'Serial do dispositivo (omitir se houver apenas um conectado)' },
                delayMs:  { type: SchemaType.INTEGER, description: 'Delay entre ações em ms (padrão: 100)' }
            },
            required: ['actions']
        }
    },
    search_assets: {
        name: 'search_assets',
        description: 'Busca assets no registro inteligente do projeto.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                query: { type: SchemaType.STRING, description: 'Nome ou tag do asset' }
            },
            required: ['query']
        }
    },
    generate_assets: {
        name: 'generate_assets',
        description: 'Gera assets visuais (imagens) usando modelos de IA generativa (OpenAI GPT Image 1.5 ou Nano Banana 2). Esta tool SEMPRE salva os arquivos localmente.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                prompt: { type: SchemaType.STRING, description: 'Descrição visual detalhada do asset a ser gerado.' },
                path: { type: SchemaType.STRING, description: 'Caminho local para salvar o asset (ex: "assets/logo.png").' },
                background: { 
                  type: SchemaType.STRING, 
                  enum: ['transparent', 'opaque'], 
                  description: 'Fundo da imagem. Use "transparent" para ícones, logos ou sprites. Padrão: "transparent".' 
                },
                size: { 
                  type: SchemaType.STRING, 
                  enum: ['1024x1024', '1024x1792', '1792x1024', 'a4', 'a4-landscape'], 
                  description: 'Resolução da imagem. Use "a4" para retrato ou "a4-landscape" para paisagem (upscale automático para 300 dpi).' 
                },
                n: { type: SchemaType.INTEGER, description: 'Número de imagens a gerar (1-4). Padrão: 1.' }
            },
            required: ['prompt', 'path']
        }
    },
  save_chat_image_as_asset: {
        name: 'save_chat_image_as_asset',
        description: 'Salva uma imagem recebida no chat como um asset no workspace. Prioriza a imagem atual pelo index; se não encontrada, busca no histórico pela query.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { 
                    type: SchemaType.STRING, 
                    description: 'O nome do arquivo de destino (ex: "screenshot_erro.png").' 
                },
                query: { 
                    type: SchemaType.STRING, 
                    description: 'Termo de busca contextual para o histórico (ex: "última imagem enviada", "print do terminal", "imagem anterior"). Evite descrever o conteúdo visual, prefira a ordem de envio.' 
                },
                index: { 
                    type: SchemaType.INTEGER, 
                    description: 'O índice da imagem nos anexos da mensagem atual (0-based). Use 0 para capturar a imagem que o usuário acabou de enviar.' 
                },
                origin_prompt: { 
                    type: SchemaType.STRING, 
                    description: 'O prompt que originou a imagem caso ela tenha sido gerada por IA (opcional).' 
                },
                path: { 
                    type: SchemaType.STRING, 
                    description: 'Diretório relativo à raiz do workspace onde o arquivo será salvo (padrão: "assets").' 
                }
            },
            required: ['name', 'query']
        }
    },

    // =========================
    // IMAGENS E ASSETS
    // =========================
    tinify_api: {
        name: 'tinify_api',
        description: 'Comprime e transforma imagens usando a API do TinyPNG/Tinify. Suporta PNG, JPEG, WebP e AVIF.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                source: { type: SchemaType.STRING, enum: ['file', 'url'], description: 'Fonte da imagem (arquivo local ou URL)' },
                filePath: { type: SchemaType.STRING, description: 'Caminho do arquivo local (se source=file)' },
                url: { type: SchemaType.STRING, description: 'URL da imagem (se source=url)' },
                resize: {
                    type: SchemaType.OBJECT,
                    description: 'Opções de redimensionamento',
                    properties: {
                        method: { type: SchemaType.STRING, enum: ['scale', 'fit', 'cover', 'thumb'], description: 'Método de redimensionamento' },
                        width: { type: SchemaType.INTEGER, description: 'Largura desejada' },
                        height: { type: SchemaType.INTEGER, description: 'Altura desejada' }
                    }
                },
                convert: {
                    type: SchemaType.OBJECT,
                    description: 'Opções de conversão',
                    properties: {
                        type: { type: SchemaType.STRING, description: 'Formato alvo (ex: image/webp, image/png)' }
                    }
                },
                preserve: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                    description: 'Metadados para preservar (copyright, creation, location)'
                },
                outputPath: { type: SchemaType.STRING, description: 'Diretório ou caminho para salvar o resultado' },
                apiKey: { type: SchemaType.STRING, description: 'Chave da API (opcional, usa padrão se omitida)' }
            },
            required: ['source']
        }
    },

    // =========================
    // EDIÇÃO (TOOL CALLING)
    // =========================

    copy_and_paste_symbol: {
        name: 'copy_and_paste_symbol',
        description: `Move ou copia um símbolo (função, classe, const, interface, type, enum) de um arquivo para outro pelo nome — sem passar o conteúdo, sem diff, sem número de linha.

Token-eficiente por design: o modelo declara o que quer mover e para onde. A tool faz o parsing, encontra o símbolo, move com rollback atômico e retorna apenas confirmação. Nenhum conteúdo do símbolo trafega no contexto.

Inclui automaticamente comentários JSDoc, decorators e linhas de documentação acima do símbolo.

POSIÇÕES SUPORTADAS:
- "inicio"                    → antes de tudo no arquivo destino
- "final"                     → depois de tudo no arquivo destino
- "apos_imports"              → depois do último import, antes do primeiro símbolo
- "antes_de_simbolo:NomeFn"  → imediatamente antes do símbolo NomeFn
- "apos_simbolo:NomeFn"      → imediatamente depois do símbolo NomeFn

SÍMBOLOS SUPORTADOS:
function, async function, const, let, var (arrow ou assignment), class, interface, type, enum — com ou sem export/export default.

ROLLBACK AUTOMÁTICO: se qualquer etapa falhar, ambos os arquivos voltam ao estado original. Nunca deixa arquivo em estado inconsistente.

SE O SÍMBOLO NÃO FOR ENCONTRADO: retorna sugestões fuzzy de nomes próximos no arquivo.`,
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                operacao: {
                    type: SchemaType.STRING,
                    enum: ['mover', 'copiar'],
                    description: 'mover: remove da origem e insere no destino. copiar: mantém na origem e insere no destino.'
                },
                origem: {
                    type: SchemaType.OBJECT,
                    description: 'Arquivo e símbolo de origem.',
                    properties: {
                        arquivo: {
                            type: SchemaType.STRING,
                            description: 'Caminho relativo ao workspace (ex: "src/services/auth.ts").'
                        },
                        simbolo: {
                            type: SchemaType.STRING,
                            description: 'Nome exato do símbolo a mover/copiar (ex: "validateToken", "AuthService", "UserType").'
                        }
                    },
                    required: ['arquivo', 'simbolo']
                },
                destino: {
                    type: SchemaType.OBJECT,
                    description: 'Arquivo destino e posição de inserção.',
                    properties: {
                        arquivo: {
                            type: SchemaType.STRING,
                            description: 'Caminho relativo ao workspace. Se o arquivo não existir, será criado.'
                        },
                        posicao: {
                            type: SchemaType.STRING,
                            description: `Onde inserir no arquivo destino:
- "inicio" — antes de tudo
- "final" — depois de tudo
- "apos_imports" — depois do último import
- "antes_de_simbolo:NomeFn" — antes do símbolo NomeFn
- "apos_simbolo:NomeFn" — depois do símbolo NomeFn`
                        }
                    },
                    required: ['arquivo', 'posicao']
                }
            },
            required: ['operacao', 'origem', 'destino']
        }
    },

    screenshot: {
        name: 'screenshot',
        description: 'Captura a tela atual do editor VS Code (e janelas visíveis se suportado). Retorna o caminho do arquivo PNG salvo.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                savePath: {
                    type: SchemaType.STRING,
                    description: 'Caminho local para salvar o PNG (opcional). Se omitido, salva em um diretório temporário.'
                }
            },
            required: []
        }
    },

    patch_file: {
        name: 'patch_file',
        description: 'Edit a specific section of a file by replacing exact text. Always read the file first to get the exact text to match.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                file_path: { type: SchemaType.STRING, description: 'Full path to the file to edit' },
                exact_match: { type: SchemaType.STRING, description: 'EXACT text to find and replace (including whitespace/indentation). Must be unique in the file. Use actual newlines in the string, not literal \"\\n\" unless the code literally contains that string.' },
                replacement: { type: SchemaType.STRING, description: 'New text to insert in place of exact_match. Use actual newlines in the string, not literal \"\\n\".' }
            },
            required: ['file_path', 'exact_match', 'replacement']
        }
    },
    create: {
        name: 'create',
        description: 'Cria um novo arquivo.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                path: { type: SchemaType.STRING, description: 'Caminho' },
                content: { type: SchemaType.STRING, description: 'Conteúdo' }
            },
            required: ['path', 'content']
        }
    },
    delete: {
        name: 'delete',
        description: 'Remove um arquivo.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                path: { type: SchemaType.STRING, description: 'Caminho' }
            },
            required: ['path']
        }
    },
    replace: {
        name: 'replace',
        description: 'Substitui um arquivo inteiro.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                path: { type: SchemaType.STRING, description: 'Caminho' },
                content: { type: SchemaType.STRING, description: 'Novo conteúdo' }
            },
            required: ['path', 'content']
        }
    },
    // =========================
    // UTILITIES / FS
    // =========================
    create_dir: {
        name: 'create_dir',
        description: 'Cria um novo diretório.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                path: { type: SchemaType.STRING, description: 'Caminho do diretório' }
            },
            required: ['path']
        }
    },
    move_file: {
        name: 'move_file',
        description: 'Move ou renomeia um arquivo.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                from: { type: SchemaType.STRING, description: 'Origem' },
                to: { type: SchemaType.STRING, description: 'Destino' }
            },
            required: ['from', 'to']
        }
    },
    rename: {
        name: 'rename',
        description: 'Renomeia um arquivo com proteções de segurança. Bloqueia arquivos protegidos, imagens, diretórios do sistema e acesso fora do workspace. Use para renomear arquivos de texto/código dentro do workspace.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                from: { type: SchemaType.STRING, description: 'Caminho do arquivo de origem' },
                to: { type: SchemaType.STRING, description: 'Novo caminho ou nome do arquivo' }
            },
            required: ['from', 'to']
        }
    },
    copy_file: {
        name: 'copy_file',
        description: 'Copia um arquivo de um local para outro.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                from: { type: SchemaType.STRING, description: 'Caminho do arquivo de origem' },
                to: { type: SchemaType.STRING, description: 'Caminho do arquivo de destino' }
            },
            required: ['from', 'to']
        }
    },
    delete_file: {
        name: 'delete_file',
        description: 'Remove um arquivo do workspace.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                path: { type: SchemaType.STRING, description: 'Caminho do arquivo' }
            },
            required: ['path']
        }
    },
    download_web_file: {
        name: 'download_web_file',
        description: 'Baixa arquivo da web.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                url: { type: SchemaType.STRING, description: 'URL' },
                path: { type: SchemaType.STRING, description: 'Caminho local' },
                mode: { type: SchemaType.STRING, description: 'Modo (text/binary)' }
            }
        }
    },

    parse_lint_errors: {
        name: 'parse_lint_errors',
        description: 'Coleta erros do projeto.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                delayMs: {
                    type: SchemaType.INTEGER,
                    description: 'Tempo de espera em ms para garantir que o VS Code atualizou os diagnósticos (padrão: 500ms).'
                }
            }
        }
    },
    git_status: {
        name: 'git_status',
        description: 'Mostra o status do Git.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {}
        }
    },
    run_command: {
        name: 'run_command',
        description: 'Executa um comando no terminal do windows.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                cmd: { type: SchemaType.STRING, description: 'Comando' }
            },
            required: ['cmd']
        }
    },
    wait: {
        name: 'wait',
        description: 'Pausa a execução por um tempo determinado (max 10 min). Útil para aguardar processos em background (compilação, testes, etc) do terminal persistente antes de verificar o resultado.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                ms: { type: SchemaType.INTEGER, description: 'Tempo de espera em milissegundos. Mínimo: 1000 (1s), Máximo: 600000 (10 min).' },
                reason: { type: SchemaType.STRING, description: 'O motivo pelo qual você está aguardando (ex: \"Aguardando build terminar\").' }
            },
            required: ['ms']
        }
    },
    terminal_start: {
        name: 'terminal_start',
        description: 'Abre uma sessão de terminal persistente no cmd do Windows e só depois envia o comando solicitado dentro dela. Use para processos que pedem input, menus interativos, watchers e servidores que continuam vivos. Assuma que a sessão já nasce em cmd.exe, então o campo command deve conter apenas o comando que você quer rodar no prompt (ex: npm run dev, flutter build web, python -m http.server 5500), sem prefixar com cmd.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                session_id: { type: SchemaType.STRING, description: 'ID único da sessão PTY.' },
                command: { type: SchemaType.STRING, description: 'Comando a enviar para o cmd.exe já aberto na sessão. Não inclua prefixos como cmd /c ou cmd.exe.' },
                cwd: { type: SchemaType.STRING, description: 'Diretório de trabalho relativo ao workspace.' },
                shell: { type: SchemaType.STRING, description: 'Shell opcional do Windows a usar. Padrão e recomendado: cmd.exe.' },
                cols: { type: SchemaType.INTEGER, description: 'Largura do terminal em colunas (padrão: 220).' },
                rows: { type: SchemaType.INTEGER, description: 'Altura do terminal em linhas (padrão: 50).' },
                initial_wait_ms: { type: SchemaType.INTEGER, description: 'Tempo, em ms, que a tool espera após abrir o cmd.exe e enviar o comando antes de devolver a primeira resposta. Use um valor maior quando o comando demora para produzir a primeira saída visível (ex: builds, installs, dev servers). Se o processo continuar rodando depois disso, acompanhe com terminal_read. Padrão: 1200.' }
            },
            required: ['session_id', 'command']
        }
    },
    terminal_read: {
        name: 'terminal_read',
        description: 'Lê a saída incremental mais recente de uma sessão de terminal persistente sem enviar nenhum input novo. Use para acompanhar processos longos que continuam rodando após o terminal_start ou terminal_send, como builds, instalações, dev servers, watchers e scripts ainda em execução.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                session_id: { type: SchemaType.STRING, description: 'ID da sessão PTY.' },
                wait_ms: { type: SchemaType.INTEGER, description: 'Tempo, em ms, que a tool fica esperando por saída nova da sessão antes de responder. Use um valor maior quando você espera que o processo ainda vá imprimir algo em breve (ex: build em andamento, servidor iniciando, instalação baixando pacotes). Se nada novo aparecer dentro desse tempo, a tool retorna com o que já tiver disponível. Padrão: 800.' }
            },
            required: ['session_id']
        }
    },
    terminal_send: {
        name: 'terminal_send',
        description: 'Envia input para uma sessão de terminal persistente já aberta. Use para responder prompts interativos, confirmar opções, navegar em menus, mandar Enter, ou executar novos comandos dentro da mesma sessão sem recriar o terminal. Suporta texto normal e sequências de controle como \\n, \\r, \\t e \\x03 para Ctrl+C.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                session_id: { type: SchemaType.STRING, description: 'ID da sessão PTY.' },
                input: { type: SchemaType.STRING, description: 'Input a enviar para stdin da sessão.' },
                wait_ms: { type: SchemaType.INTEGER, description: 'Tempo, em ms, que a tool espera após enviar o input para capturar a resposta do terminal antes de retornar. Use um valor maior quando o comando digitado ou a resposta ao prompt demora um pouco para aparecer. Se a sessão continuar processando depois disso, acompanhe com terminal_read. Padrão: 1000.' }
            },
            required: ['session_id', 'input']
        }
    },
    terminal_stop: {
        name: 'terminal_stop',
        description: 'Encerra uma sessão de terminal persistente ativa. Use signal=SIGINT para simular Ctrl+C quando quiser interromper um processo em execução sem fechar de forma abrupta; use SIGTERM ou SIGKILL quando precisar forçar o encerramento da sessão.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                session_id: { type: SchemaType.STRING, description: 'ID da sessão PTY.' },
                signal: { type: SchemaType.STRING, enum: ['SIGINT', 'SIGTERM', 'SIGKILL'], description: 'Sinal lógico para encerramento da sessão.' },
                wait_ms: { type: SchemaType.INTEGER, description: 'Tempo para aguardar output final após o encerramento.' }
            },
            required: ['session_id']
        }
    },
    terminal_list: {
        name: 'terminal_list',
        description: 'Lista as sessões PTY ativas e recentes mantidas em memória, com status, pid, cwd e quantidade de output pendente.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {},
            required: []
        }
    },
    name_chat: {
        name: 'name_chat',
        description: 'Define um nome para o chat.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                title: { type: SchemaType.STRING, description: 'Título (max 40 chars)' }
            },
            required: ['title']
        }
    },

    // =========================
// BROWSER / PLAYWRIGHT
// =========================
// Cole este bloco dentro do objeto TOOL_DEFINITIONS em definitions.ts,
// logo antes do fechamento do objeto (antes do último `};`).

browser_action: {
    name: 'browser_action',
    description: `Controla um browser real (Chromium) via Playwright. Executa sequências de ações: navegar, clicar, digitar, extrair texto/HTML, tirar screenshots e mais.

Diferente de read_url (que faz fetch estático), esta tool renderiza JavaScript, mantém cookies/sessão entre chamadas e interage com a página como um humano.

SESSÃO PERSISTENTE: por padrão usa sessionId="default". A sessão (cookies, login, localStorage) persiste entre chamadas até você usar close_session.

AÇÕES DISPONÍVEIS:
- navigate:     Navega para uma URL
- click:        Clica num elemento (selector CSS, "text=Texto visível", ou "xpath=...")  
- type:         Preenche um campo com texto (usa fill — limpa antes de digitar)
- clear:        Limpa um campo de input
- select:       Seleciona opção num <select> por value
- hover:        Passa o mouse sobre um elemento
- scroll:       Rola a página (direction: up/down/left/right) ou scrolla um seletor até aparecer
- wait:         Aguarda um seletor aparecer (selector) ou tempo fixo em ms (delay)
- screenshot:   Captura a tela; salva PNG em disco e também anexa a imagem no resultado estruturado da tool para visão do modelo, sem serializar os bytes no texto. Evite usar fullpage:true; prefira fullpage:false para melhor qualidade. Se precisar de mais conteúdo, use scroll e screenshot novamente.
- get_text:     Extrai innerText de um seletor ou da página toda
- get_html:     Extrai innerHTML de um seletor ou HTML completo da página
- get_url:      Retorna a URL atual
- get_title:    Retorna o <title> da página
- eval:         Executa JavaScript na página (expression: "document.cookie")
- download:     Clica num elemento ou vai até uma URL e aguarda o download de um arquivo. Requer "path" para salvar.
- close_session: Fecha o browser e limpa a sessão

SELETORES SUPORTADOS:
- CSS normal:      "#login-btn", ".submit", "input[name=email]"
- Texto visível:   "text=Entrar", "text=Sign in"
- XPath:           "xpath=//button[@type='submit']"

EXEMPLO — login e extração:
{
  "actions": [
    { "type": "navigate", "url": "https://app.exemplo.com/login" },
    { "type": "type", "selector": "#email", "text": "eu@email.com" },
    { "type": "type", "selector": "#password", "text": "minha_senha" },
    { "type": "click", "selector": "text=Entrar" },
    { "type": "wait", "selector": ".dashboard", "timeout": 8000 },
    { "type": "screenshot", "fullPage": true },
    { "type": "get_text", "selector": ".main-content" }
  ]
}`,
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            actions: {
                type: SchemaType.ARRAY,
                description: 'Lista de ações a executar em sequência.',
                items: {
                    type: SchemaType.OBJECT,
                    properties: {
                        type: {
                            type: SchemaType.STRING,
                            enum: [
                                'navigate', 'click', 'type', 'clear', 'select',
                                'hover', 'scroll', 'wait', 'screenshot',
                                'get_text', 'get_html', 'get_url', 'get_title',
                                'eval', 'download', 'close_session'
                            ],
                            description: 'Tipo da ação'
                        },
                        selector: { type: SchemaType.STRING, description: 'Seletor CSS, "text=...", ou "xpath=..."' },
                        url: { type: SchemaType.STRING, description: 'URL para navigate ou download' },
                        text: { type: SchemaType.STRING, description: 'Texto para type' },
                        value: { type: SchemaType.STRING, description: 'Valor para select' },
                        expression: { type: SchemaType.STRING, description: 'Código JS para eval' },
                        direction: { type: SchemaType.STRING, description: 'Direção para scroll: up | down | left | right' },
                        amount: { type: SchemaType.INTEGER, description: 'Pixels para scroll (padrão: 300)' },
                        timeout: { type: SchemaType.INTEGER, description: 'Timeout desta ação em ms (padrão: 10000)' },
                        delay: { type: SchemaType.INTEGER, description: 'Tempo fixo de espera em ms (para action=wait)' },
                        fullPage: { type: SchemaType.BOOLEAN, description: 'Captura a página inteira no screenshot (padrão: false)' },
                        path: { type: SchemaType.STRING, description: 'Salvar screenshot ou download em disco (opcional para screenshot, obrigatório para download)' }
                    },
                    required: ['type']
                }
            },
            sessionId: {
                type: SchemaType.STRING,
                description: 'ID da sessão (padrão: "default"). Use IDs diferentes para múltiplas sessões simultâneas.'
            },
            headless: {
                type: SchemaType.BOOLEAN,
                description: 'Rodar em modo invisível (padrão: true). Use false para ver o browser abrir.'
            },
            viewportWidth: { type: SchemaType.INTEGER, description: 'Largura do viewport em pixels (padrão: 1280)' },
            viewportHeight: { type: SchemaType.INTEGER, description: 'Altura do viewport em pixels (padrão: 800)' },
            userAgent: { type: SchemaType.STRING, description: 'User-agent customizado (opcional)' },
            timeoutMs: { type: SchemaType.INTEGER, description: 'Timeout global por ação em ms (padrão: 10000)' }
        },
        required: ['actions']
    }
},

    /*
    report_cognitive_state: {
        name: 'report_cognitive_state',
        description: 'Reporta o estado cognitivo atual do modelo para atualizar a UI.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                state: { 
                    type: SchemaType.STRING, 
                    description: 'O slug do estado cognitivo (ex: idle-receptive, comprehension, deep-focus, execution, etc).',
                    enum: [
                        'idle-receptive',
                        'comprehension',
                        'disambiguation',
                        'planning-strategy',
                        'deep-focus',
                        'execution',
                        'monitoring',
                        'cognitive-tension',
                        'insight-restructuring',
                        'consolidation',
                        'final-validation',
                        'closure'
                    ]
                }
            },
            required: ['state']
        }
    },
    */

    report_status: {
        name: 'report_status',
        description: `Reporta um status customizado com PRIORIDADE MÁXIMA na barra de status do agente.
Bypassa o sistema de prioridades — o status reportado aqui SEMPRE aparece, mesmo que outro estado de menor prioridade esteja ativo.
Use para comunicar ao usuário o que você está fazendo de forma clara e visual.

Você pode customizar:
- text: O texto exibido na barra de status (obrigatório)
- dotColor: Cor da bolinha pulsante (hex, ex: "#FF6B6B")
- backgroundColor: Cor de fundo do texto (hex, ex: "#1E3A5F")
- autoHideMs: Tempo em ms para esconder automaticamente (0 = não esconde)

Exemplos de uso:
- "Analisando dependências do projeto..."
- "Refatorando módulo de autenticação..."
- "Testando integração com API externa..."
- "Gerando documentação..."`,
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                text: {
                    type: SchemaType.STRING,
                    description: 'Texto a exibir na barra de status. Seja descritivo e claro sobre o que está fazendo.'
                },
                dotColor: {
                    type: SchemaType.STRING,
                    description: 'Cor da bolinha pulsante em formato hex (ex: "#FF6B6B", "#4ECDC4", "#FFE66D"). Se omitido, usa a cor padrão do estado.'
                },
                backgroundColor: {
                    type: SchemaType.STRING,
                    description: 'Cor de fundo do texto em formato hex (ex: "#1E3A5F", "#2D1B69"). Se omitido, usa o fundo padrão.'
                },
                autoHideMs: {
                    type: SchemaType.INTEGER,
                    description: 'Tempo em milissegundos para esconder o status automaticamente. Use 0 para manter visível até o próximo status. Padrão: 0.'
                }
            },
            required: ['text']
        }
    },

    current_plan: {
        name: 'current_plan',
        description: 'Gerencia um checklist de tarefas (plano) para o objetivo atual. O plano é injetado automaticamente no prompt.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                action: { 
                    type: SchemaType.STRING, 
                    enum: ['create', 'mark_done', 'update', 'abort'],
                    description: 'Ação a ser realizada no plano. quando concluir uma etapa, use mark_done. Quando você der mark_done em todas as etapas o plano some da UI automaticamente.'
                },
                plan_description: { 
                    type: SchemaType.STRING, 
                    description: 'Descrição geral do objetivo do plano (obrigatório para create e update).' 
                },
                steps: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                    description: 'Lista de descrições das etapas (obrigatório para create e update).'
                },
                completed_indices: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.INTEGER },
                    description: 'Índices das etapas a serem marcadas como concluídas (0-based, usado em mark_done).'
                },
                update_reason: {
                    type: SchemaType.STRING,
                    description: 'Justificativa para a atualização do plano (obrigatório para update).'
                }
            },
            required: ['action']
        }
    },

    replace_text: {
        name: 'replace_text',
        description: 'Substitui um texto por outro em múltiplos arquivos do workspace, com controle de escopo e opção de preview.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                search: { 
                    type: SchemaType.STRING, 
                    description: 'Texto a procurar (modo literal) ou expressão regular (modo regex)' 
                },
                replace: { 
                    type: SchemaType.STRING, 
                    description: 'Texto de substituição' 
                },
                include: { 
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                    description: 'Padrões glob dos arquivos onde aplicar (ex: ["src/**/*.ts"])' 
                },
                exclude: { 
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                    description: 'Padrões glob dos arquivos a ignorar (opcional)' 
                },
                mode: { 
                    type: SchemaType.STRING, 
                    enum: ['literal', 'regex'],
                    description: 'Modo de busca: "literal" para texto exato, "regex" para expressão regular' 
                },
                preview: { 
                    type: SchemaType.BOOLEAN, 
                    description: 'Se true, apenas mostra o que mudaria sem gravar (dry-run)' 
                }
            },
            required: ['search', 'replace', 'include']
        }
    },

    // =========================
    // WEB CRAWLING / DOWNLOADS
    // =========================
    read_robots_txt: {
        name: 'read_robots_txt',
        description: 'Read and interpret robots.txt for a site.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                url: { type: SchemaType.STRING, description: 'URL do site' },
                user_agent: { type: SchemaType.STRING, description: 'User-agent string (padrão: "*")' },
                timeout_ms: { type: SchemaType.INTEGER, description: 'Timeout em ms (padrão: 5000)' },
                parse_rules: { type: SchemaType.BOOLEAN, description: 'Se deve analisar as regras (padrão: true)' }
            },
            required: ['url']
        }
    },
    crawl_site: {
        name: 'crawl_site',
        description: 'Map internal URLs by following <a href>.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                url: { type: SchemaType.STRING, description: 'URL inicial' },
                max_depth: { type: SchemaType.INTEGER, description: 'Profundidade máxima (padrão: 5)' },
                same_domain_only: { type: SchemaType.BOOLEAN, description: 'Apenas no mesmo domínio (padrão: true)' },
                timeout_ms: { type: SchemaType.INTEGER, description: 'Timeout em ms (padrão: 10000)' },
                user_agent: { type: SchemaType.STRING, description: 'User-agent string' }
            },
            required: ['url']
        }
    },
    list_downloadable_files: {
        name: 'list_downloadable_files',
        description: 'List downloadable files on a site by extension/pattern.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                url: { type: SchemaType.STRING, description: 'URL para listar' },
                extensions: { 
                    type: SchemaType.ARRAY, 
                    items: { type: SchemaType.STRING },
                    description: 'Extensões de arquivo (padrão: common)' 
                },
                max_depth: { type: SchemaType.INTEGER, description: 'Profundidade máxima (padrão: 2)' },
                timeout_ms: { type: SchemaType.INTEGER, description: 'Timeout em ms (padrão: 10000)' },
                user_agent: { type: SchemaType.STRING, description: 'User-agent string' },
                include_patterns: { 
                    type: SchemaType.ARRAY, 
                    items: { type: SchemaType.STRING },
                    description: 'Regex para incluir' 
                },
                exclude_patterns: { 
                    type: SchemaType.ARRAY, 
                    items: { type: SchemaType.STRING },
                    description: 'Regex para excluir' 
                }
            },
            required: ['url']
        }
    },
    download_resource: {
        name: 'download_resource',
        description: 'Download a file from the web and save locally.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                url: { type: SchemaType.STRING, description: 'URL do arquivo' },
                save_as: { type: SchemaType.STRING, description: 'Caminho local (opcional)' },
                max_bytes: { type: SchemaType.INTEGER, description: 'Tamanho máximo em bytes (padrão: 10MB)' },
                timeout_ms: { type: SchemaType.INTEGER, description: 'Timeout em ms (padrão: 30000)' }
            },
            required: ['url']
        }
    },
    download_site_assets: {
        name: 'download_site_assets',
        description: 'Clone site assets (HTML, CSS, JS, images, PDFs, fonts, videos, audios).',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                url: { type: SchemaType.STRING, description: 'URL do site' },
                include: { 
                    type: SchemaType.ARRAY, 
                    items: { type: SchemaType.STRING },
                    description: 'Tipos para incluir' 
                },
                exclude: { 
                    type: SchemaType.ARRAY, 
                    items: { type: SchemaType.STRING },
                    description: 'Tipos para excluir' 
                },
                max_depth: { type: SchemaType.INTEGER, description: 'Profundidade máxima (padrão: 3)' },
                max_files: { type: SchemaType.INTEGER, description: 'Limite de arquivos (padrão: 100)' },
                timeout_ms: { type: SchemaType.INTEGER, description: 'Timeout em ms (padrão: 15000)' },
                user_agent: { type: SchemaType.STRING, description: 'User-agent string' },
                preserve_structure: { type: SchemaType.BOOLEAN, description: 'Preservar estrutura de diretórios (padrão: true)' }
            },
            required: ['url']
        }
    },
    extract_links: {
        name: 'extract_links',
        description: 'Extract links/assets/downloads from raw HTML.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                html: { type: SchemaType.STRING, description: 'HTML para processar' },
                base_url: { type: SchemaType.STRING, description: 'URL base para resolver caminhos relativos' },
                filter_types: { 
                    type: SchemaType.ARRAY, 
                    items: { type: SchemaType.STRING },
                    description: 'Filtrar por tipo de link' 
                },
                include_assets: { type: SchemaType.BOOLEAN, description: 'Incluir links de assets (padrão: true)' },
                include_iframes: { type: SchemaType.BOOLEAN, description: 'Incluir iframes (padrão: true)' }
            },
            required: ['html']
        }
    },

    generate_docx: {
        name: "generate_docx",
        description: `
Gera um arquivo Word (.docx) profissional a partir de um spec JSON e retorna o caminho do arquivo.
Use para criar relatórios, propostas, contratos, documentos técnicos, manuais, etc.

Recursos suportados:
- Parágrafos com formatação rica (bold, italic, underline, cor, fonte, tamanho)
- Títulos H1–H6
- Listas com marcadores ou numeradas (multi-nível)
- Tabelas com header colorido, larguras de coluna, cores de células
- Imagens inline
- Hyperlinks clicáveis
- Cabeçalho e rodapé (com número de página)
- Sumário automático (TOC)
- Quebras de página e linhas horizontais
- Configuração de página: tamanho, orientação, margens
- Estilos globais: fonte padrão, tamanho, cores de heading
- Geração incremental: use append_to para anexar páginas ao arquivo existente
        `.trim(),
        parameters: {
            type: SchemaType.OBJECT,
            required: ["output_path", "content"],
            properties: {

                output_path: {
                    type: SchemaType.STRING,
                    description: "Caminho absoluto ou relativo onde salvar o .docx. Ex: '/tmp/proposta.docx'",
                },

                append_to: {
                    type: SchemaType.STRING,
                    description: "Se fornecido, abre este .docx existente e ANEXA o conteúdo como nova página. Passe o 'path' retornado pela chamada anterior. output_path pode ser igual ao append_to para sobrescrever no lugar.",
                },

                page_index: {
                    type: SchemaType.INTEGER,
                    description: "Índice da página sendo gerada (0 = primeira). Apenas informativo — retornado no resultado.",
                },

                page: {
                    type: SchemaType.OBJECT,
                    description: "Configuração da página (opcional — padrão A4 portrait, margens 1 inch)",
                    properties: {
                        size:          { type: SchemaType.STRING, description: "A4 | letter | A3" },
                        landscape:     { type: SchemaType.BOOLEAN },
                        margin_top:    { type: SchemaType.NUMBER, description: "Margem superior em inches" },
                        margin_bottom: { type: SchemaType.NUMBER },
                        margin_left:   { type: SchemaType.NUMBER },
                        margin_right:  { type: SchemaType.NUMBER },
                    },
                },

                styles: {
                    type: SchemaType.OBJECT,
                    description: "Estilos globais do documento",
                    properties: {
                        font:     { type: SchemaType.STRING, description: "Fonte padrão. Ex: 'Calibri', 'Arial'" },
                        size:     { type: SchemaType.NUMBER, description: "Tamanho padrão em pt" },
                        heading1: {
                            type: SchemaType.OBJECT,
                            properties: {
                                size:  { type: SchemaType.NUMBER },
                                bold:  { type: SchemaType.BOOLEAN },
                                color: { type: SchemaType.STRING, description: "Hex sem #. Ex: '1F3864'" },
                                font:  { type: SchemaType.STRING },
                            },
                        },
                        heading2: {
                            type: SchemaType.OBJECT,
                            properties: {
                                size:  { type: SchemaType.NUMBER },
                                bold:  { type: SchemaType.BOOLEAN },
                                color: { type: SchemaType.STRING },
                                font:  { type: SchemaType.STRING },
                            },
                        },
                        heading3: {
                            type: SchemaType.OBJECT,
                            properties: {
                                size:  { type: SchemaType.NUMBER },
                                bold:  { type: SchemaType.BOOLEAN },
                                color: { type: SchemaType.STRING },
                                font:  { type: SchemaType.STRING },
                            },
                        },
                    },
                },

                header: {
                    type: SchemaType.OBJECT,
                    description: "Cabeçalho do documento",
                    properties: {
                        text:        { type: SchemaType.STRING },
                        runs:        { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT } },
                        align:       { type: SchemaType.STRING, description: "left | center | right" },
                        page_number: { type: SchemaType.BOOLEAN },
                    },
                },

                footer: {
                    type: SchemaType.OBJECT,
                    description: "Rodapé do documento",
                    properties: {
                        text:        { type: SchemaType.STRING },
                        runs:        { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT } },
                        align:       { type: SchemaType.STRING, description: "left | center | right" },
                        page_number: { type: SchemaType.BOOLEAN, description: "Insere campo PAGE (número de página)" },
                    },
                },

                content: {
                    type: SchemaType.ARRAY,
                    description: "Array de blocos de conteúdo do documento, em ordem.",
                    items: {
                        type: SchemaType.OBJECT,
                        required: ["type"],
                        properties: {

                            type: {
                                type: SchemaType.STRING,
                                description: "paragraph | p | h1 | h2 | h3 | h4 | h5 | h6 | list | table | image | img | page_break | hr | toc",
                            },

                            // ── paragraph / headings ──
                            text: {
                                type: SchemaType.STRING,
                                description: "Texto simples (alternativa a 'runs')",
                            },
                            style: {
                                type: SchemaType.STRING,
                                description: "Estilo Word nativo. Ex: 'Normal', 'Quote'",
                            },
                            runs: {
                                type: SchemaType.ARRAY,
                                description: "Runs formatados. Cada item: string simples OU objeto { text, bold, italic, underline, size, color, font, url }",
                                items: {
                                    type: SchemaType.OBJECT,
                                    properties: {
                                        text:      { type: SchemaType.STRING },
                                        bold:      { type: SchemaType.BOOLEAN },
                                        italic:    { type: SchemaType.BOOLEAN },
                                        underline: { type: SchemaType.BOOLEAN },
                                        strike:    { type: SchemaType.BOOLEAN },
                                        size:      { type: SchemaType.NUMBER, description: "Tamanho em pt" },
                                        color:     { type: SchemaType.STRING, description: "Hex com ou sem #. Ex: '#FF0000'" },
                                        font:      { type: SchemaType.STRING },
                                        url:       { type: SchemaType.STRING, description: "Se presente, cria hyperlink clicável" },
                                        highlight: { type: SchemaType.STRING, description: "yellow | green | cyan | blue | red" },
                                    },
                                },
                            },
                            fmt: {
                                type: SchemaType.OBJECT,
                                description: "Formatação de parágrafo",
                                properties: {
                                    align:        { type: SchemaType.STRING, description: "left | center | right | justify" },
                                    space_before: { type: SchemaType.NUMBER, description: "Espaço antes em pt" },
                                    space_after:  { type: SchemaType.NUMBER },
                                    line_spacing: { type: SchemaType.NUMBER },
                                    left_indent:  { type: SchemaType.NUMBER, description: "Recuo em inches" },
                                    first_line:   { type: SchemaType.NUMBER },
                                    bold:         { type: SchemaType.BOOLEAN },
                                    italic:       { type: SchemaType.BOOLEAN },
                                    size:         { type: SchemaType.NUMBER },
                                    color:        { type: SchemaType.STRING },
                                    font:         { type: SchemaType.STRING },
                                },
                            },

                            // ── list ──
                            ordered: {
                                type: SchemaType.BOOLEAN,
                                description: "true = numerada, false = com marcadores",
                            },
                            items: {
                                type: SchemaType.ARRAY,
                                description: "Itens da lista.",
                                items: {
                                    type: SchemaType.OBJECT,
                                    properties: {
                                        text:   { type: SchemaType.STRING },
                                        level:  { type: SchemaType.INTEGER, description: "Nível de indentação (0-based)" },
                                        bold:   { type: SchemaType.BOOLEAN },
                                        italic: { type: SchemaType.BOOLEAN },
                                        runs:   { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT } },
                                    },
                                },
                            },

                            // ── table ──
                            headers: {
                                type: SchemaType.ARRAY,
                                items: { type: SchemaType.STRING },
                                description: "Textos do cabeçalho da tabela",
                            },
                            rows: {
                                type: SchemaType.ARRAY,
                                description: "Linhas de dados. Cada linha é um array de células.",
                                items: {
                                    type: SchemaType.ARRAY,
                                    items: {
                                        type: SchemaType.OBJECT,
                                        properties: {
                                            text:   { type: SchemaType.STRING },
                                            bold:   { type: SchemaType.BOOLEAN },
                                            italic: { type: SchemaType.BOOLEAN },
                                            align:  { type: SchemaType.STRING, description: "left | center | right" },
                                            bg:     { type: SchemaType.STRING, description: "Cor de fundo. Hex. Ex: '#FFFF00'" },
                                            runs:   { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT } },
                                        },
                                    },
                                },
                            },
                            col_widths: {
                                type: SchemaType.ARRAY,
                                items: { type: SchemaType.NUMBER },
                                description: "Largura de cada coluna em inches",
                            },
                            header_bg:    { type: SchemaType.STRING, description: "Cor de fundo do header. Hex. Ex: '#2E75B6'" },
                            header_color: { type: SchemaType.STRING, description: "Cor do texto do header. Ex: '#FFFFFF'" },

                            // ── image ──
                            path:   { type: SchemaType.STRING, description: "Caminho para o arquivo de imagem" },
                            width:  { type: SchemaType.NUMBER, description: "Largura em inches" },
                            height: { type: SchemaType.NUMBER, description: "Altura em inches" },
                            align:  { type: SchemaType.STRING, description: "left | center | right" },

                            // ── hr ──
                            thickness: { type: SchemaType.NUMBER, description: "Espessura da linha em pts (padrão 6)" },
                            color:     { type: SchemaType.STRING, description: "Cor da linha HR. Hex. Ex: '#CCCCCC'" },
                        },
                    },
                },
            },
        },
    },
      // =========================
      // FIREBASE / FIRESTORE
      // =========================
      firebase_list_projects: {
          name: 'firebase_list_projects',
          description: 'Lista os IDs dos projetos Firebase vinculados à conta autenticada. Use esta tool para descobrir quais projetos estão disponíveis antes de realizar operações no Firestore ou Storage.',
          parameters: {
              type: SchemaType.OBJECT,
              properties: {},
              required: []
          }
      },
      firestore_get_schema_map: {
          name: 'firestore_get_schema_map',
          description: 'Extrai a estrutura (schema) do banco de dados Firestore de forma inteligente. Mapeia coleções raiz, amostra alguns documentos para identificar campos e tipos, e descobre subcoleções. Útil para dar contexto ao modelo sobre a fonte da verdade sem estourar o limite de tokens.',
          parameters: {
              type: SchemaType.OBJECT,
              properties: {
                  projectId: { type: SchemaType.STRING, description: 'ID do projeto Firebase.' },
                  depth: { type: SchemaType.INTEGER, description: 'Profundidade máxima para explorar subcoleções (padrão: 2).' },
                  sampleSize: { type: SchemaType.INTEGER, description: 'Quantidade de documentos por coleção para analisar a estrutura (padrão: 2).' }
              },
              required: ['projectId']
          }
      },
      firestore_run_query: {
          name: 'firestore_run_query',
          description: 'Executa uma consulta de leitura (query) no Firestore. Permite buscar documentos ou filtrar coleções baseado em condições. Esta tool é estritamente de leitura.',
          parameters: {
              type: SchemaType.OBJECT,
              properties: {
                  projectId: { type: SchemaType.STRING, description: 'ID do projeto Firebase.' },
                  collectionPath: { type: SchemaType.STRING, description: 'Caminho da coleção ou subcoleção (ex: "users" ou "users/ID/orders").' },
                  filters: {
                      type: SchemaType.ARRAY,
                      description: 'Lista de filtros (condições WHERE).',
                      items: {
                          type: SchemaType.OBJECT,
                          properties: {
                              field: { type: SchemaType.STRING, description: 'Nome do campo.' },
                              operator: { 
                                  type: SchemaType.STRING, 
                                  enum: ['==', '!=', '>', '>=', '<', '<=', 'array-contains', 'in', 'array-contains-any', 'not-in'],
                                  description: 'Operador de comparação.' 
                              },
                              value: { type: SchemaType.STRING, description: 'Valor para comparação.' }
                          },
                          required: ['field', 'operator', 'value']
                      }
                  },
                  orderBy: { type: SchemaType.STRING, description: 'Campo para ordenação.' },
                  limit: { type: SchemaType.INTEGER, description: 'Máximo de resultados (padrão: 10, máx: 50).' }
              },
              required: ['projectId', 'collectionPath']
          }
      },
      firebase_list_storage_buckets: {
          name: 'firebase_list_storage_buckets',
          description: 'Lista os buckets do Google Cloud Storage vinculados ao projeto informado.',
          parameters: {
              type: SchemaType.OBJECT,
              properties: {
                  projectId: { type: SchemaType.STRING, description: 'ID do projeto Firebase.' }
              },
              required: ['projectId']
          }
      },

 /*
 copy_and_paste_code: {
  name: 'copy_and_paste_code',
  description: `
🔥 SEMANTIC PATCH TOOL — Move ou copia blocos de código usando CONTEXTO REAL (estilo git patch)

✅ Objetivo
Você fornece âncoras (trechos REAIS do arquivo), a tool encontra no código e move/copia o conteúdo ENTRE elas.
Ela é feita pra ser “cirúrgica” e provar o que aconteceu (diff real) — e, se falhar, provar o porquê falhou.

────────────────────────────────────────────────────────────
AGORA SUPORTA (e melhora muito) ÂNCORAS MULTI-LINHA
- contexto_inicial / contexto_final podem ser trechos com "\\n"
- quebras de linha fazem parte do match (match contíguo)
- trim automático das âncoras (remove vazias no início/fim, preserva vazias internas)
- normalização automática de line endings (\\r\\n -> \\n)

ROBUSTEZ CONTRA “ALUCINAÇÕES DE ESPAÇO” (DEFAULT)
- Por padrão a tool ignora diferenças de espaços/tabs “entre tokens”
  Ex: "class A {" casa com "class A{"
- Ela remove caracteres invisíveis comuns (NBSP / zero-width) antes do match

AUTO-FALLBACK (para o modelo não precisar chutar parâmetro óbvio)
- A tool tenta match forte primeiro e, se falhar, tenta fuzzy automaticamente
- O modelo NÃO precisa enviar whitespace_mode nem fuzzy_match na maioria dos casos

INTELIGÊNCIA DE ESCOPO (BALA DE PRATA)
- Se auto_find_scope=true (ou se contexto_final não for fornecido), a tool encontra o "}" correspondente
  contando chaves (ignorando strings/comments)
  Isso evita o modelo “adivinhar” onde termina classe/função

MODO INSERT MAIS SIMPLES
- replacement_text: permite inserir código direto sem arquivo_origem/âncoras de origem (edits simples)
- insert_at_line: permite inserir logo abaixo de contexto_alvo_inicial sem contexto_alvo_final
  (se contexto_alvo_final faltar e auto_find_scope_alvo não estiver ativo, insert_at_line pode ser inferido automaticamente)

GESTÃO DE INDENTAÇÃO (QUALIDADE)
- smart_indent (default true): ajusta indent do bloco inserido para casar com o destino
- dedent_on_move (default true): se recortar+new_file, remove indent comum do bloco

FEEDBACK DE ERRO ACIONÁVEL (PROVAS)
- Se falhar match: retorna snippet real do arquivo e mini-diff mostrando onde divergiu
- Se achar início mas não achar fim: retorna as próximas linhas reais após o início

EXTREME CRITICAL
!!!!!PENSE NAS ÂNCORAS COMO SE VOCÊ ESTIVESSE APLICANDO PATCH NELAS!!!!!
- Use âncoras de 3 a 5 linhas (copie/cole literal do arquivo) para match único.
- Sempre read_file no arquivo antes de chamar a tool (estado mais recente + indent real).
- Se estiver refatorando, use recortar:true para limpar a origem automaticamente.
- No mode=new_file você DEVE informar arquivo_destino (ex: "src/index.ts").

RETORNO CRÍTICO
- Em sucesso (sem dry_run) a tool retorna applied_diff (diff real do que foi aplicado).
`,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      mode: {
        type: SchemaType.STRING,
        enum: ['new_file', 'insert'],
        description: 'new_file: cria novo arquivo | insert: insere em arquivo existente'
      },

      // ========== ORIGEM (2 formas) ==========
      // A) Extração por âncoras (estilo git patch)
      arquivo_origem: {
        type: SchemaType.STRING,
        description: '[Extração] Caminho do arquivo de origem (ex: "src/index.ts"). Obrigatório se NÃO usar replacement_text.'
      },
      contexto_inicial: {
        type: SchemaType.STRING,
        description: `Âncora inicial no arquivo de origem (pode ser multi-linha com "\\n").

IMPORTANTE:
- Deve existir literalmente no arquivo (copie/cole).
- Recomendo 3 a 5 linhas para match único.
- O conteúdo extraído começa DEPOIS do final desta âncora.`
      },
      contexto_final: {
        type: SchemaType.STRING,
        description: `Âncora final no arquivo de origem (pode ser multi-linha com "\\n").

IMPORTANTE:
- Deve aparecer DEPOIS do contexto_inicial no arquivo.
- O conteúdo extraído termina ANTES do início desta âncora.
- Se omitido, você pode usar auto_find_scope=true para achar o fechamento por chaves.`
      },

      // B) Texto direto (edições simples)
      replacement_text: {
        type: SchemaType.STRING,
        description: `[Texto direto] Se fornecido, elimina necessidade de arquivo_origem/contexto_* de origem.
Use para inserir/criar código diretamente sem extração.`
      },

      linhas_contexto: {
        type: SchemaType.NUMBER,
        description: `LIMITADOR de linhas DA ÂNCORA (não do arquivo).
- Se a âncora for multi-linha e você setar 2, usa só as 2 primeiras linhas do trecho pra match.
- Se omitido, usa TODAS as linhas do trecho (multi-linha) ou 1 (single-line).
Recomendado: omitido (usa o trecho inteiro).`
      },

      // ========== DESTINO (mode=new_file) ==========
      arquivo_destino: {
        type: SchemaType.STRING,
        description: '[mode=new_file] Caminho do novo arquivo a ser criado (ex: "src/services/email.ts")'
      },

      // ========== DESTINO (mode=insert) ==========
      arquivo_alvo: {
        type: SchemaType.STRING,
        description: '[mode=insert] Caminho do arquivo onde inserir o código'
      },
      contexto_alvo_inicial: {
        type: SchemaType.STRING,
        description: `[mode=insert] Âncora inicial no arquivo alvo (pode ser multi-linha com "\\n").
A inserção ocorre APÓS o final desta âncora.`
      },
      contexto_alvo_final: {
        type: SchemaType.STRING,
        description: `[mode=insert] Âncora final no arquivo alvo (pode ser multi-linha com "\\n").
A inserção ocorre ANTES do início desta âncora.

Se omitido:
- você pode usar auto_find_scope_alvo=true (substitui até o "}" correspondente)
- ou insert_at_line=true (insere abaixo da âncora inicial, sem precisar do final)`
      },

      // ========== COMPORTAMENTO ==========
      recortar: {
        type: SchemaType.BOOLEAN,
        description: `true: MOVE o código (remove da origem quando houver arquivo_origem)
false: COPIA o código (mantém na origem)`
      },
      dry_run: {
        type: SchemaType.BOOLEAN,
        description: `Testa sem aplicar as mudanças (padrão: false).
Retorna preview do que vai acontecer sem modificar nada.`
      },

      // ========== OPÇÕES AVANÇADAS (normalmente suprimidas do modelo) ==========
      fuzzy_match: {
        type: SchemaType.BOOLEAN,
        description: `Se definido, força o comportamento de fuzzy match:
- true: aceita match aproximado
- false: exige match forte
Se omitido, a tool faz AUTO-FALLBACK (exato -> fuzzy) internamente.`
      },
      whitespace_mode: {
        type: SchemaType.STRING,
        enum: ['strict', 'normalize', 'ignore_between_tokens'],
        description: `Modo de whitespace no match. Se omitido, usa DEFAULT "ignore_between_tokens".
- strict: mais rígido (debug, ou whitespace semântico)
- normalize: trim + colapsa espaços
- ignore_between_tokens: ignora espaços/tabs entre tokens (melhor default)`
      },

      // Escopo automático
      auto_find_scope: {
        type: SchemaType.BOOLEAN,
        description: `Se true, ignora contexto_final e encontra o fechamento "}" correspondente a partir do contexto_inicial (origem).
Se omitido e contexto_final não vier, a tool pode inferir auto_find_scope=true.`
      },
      auto_find_scope_alvo: {
        type: SchemaType.BOOLEAN,
        description: `Se true, quando inserindo no alvo, substitui o miolo até o "}" correspondente ao contexto_alvo_inicial.
Útil quando não quer fornecer contexto_alvo_final.`
      },

      // Insert simplificado
      insert_at_line: {
        type: SchemaType.BOOLEAN,
        description: `[mode=insert] Se true, insere o bloco logo ABAIXO da âncora contexto_alvo_inicial.
Se omitido e contexto_alvo_final não vier (e auto_find_scope_alvo não estiver ativo), a tool pode inferir insert_at_line=true.`
      },

      // Indentação
      smart_indent: {
        type: SchemaType.BOOLEAN,
        description: `Ajusta indent do bloco inserido para casar com o destino (padrão: true).`
      },
      dedent_on_move: {
        type: SchemaType.BOOLEAN,
        description: `No mode=new_file com recortar=true, remove indent comum do bloco para o novo arquivo não nascer com recuo extra (padrão: true).`
      }
    },

    // ✅ Requeridos mínimos (com defaults fortes + ORIGEM flexível):
    // - mode + recortar sempre
    // - destino depende do mode
    // - origem: ou replacement_text, ou arquivo_origem+contexto_inicial (contexto_final é opcional via auto scope)
    required: ['mode', 'recortar'],

    // JSON Schema puro não permite “required condicional” facilmente.
    // A validação condicional fica no runtime da tool.
  }
}
*/

    // =========================
    // CONTEXT & MEMORY
    // =========================
    get_project_context: {
        name: 'get_project_context',
        description: `Retorna contexto completo do projeto em uma única chamada: tipo, stack, frameworks, manifests, entrypoints, arquivos de config, top-level dirs, estrutura completa de diretórios, hints de arquitetura, arquivos recentemente modificados e dependências. Use no início de qualquer tarefa para onboarding rápido sem precisar de list_dir_recursive + múltiplos read_file.`,
        parameters: {
            type: SchemaType.OBJECT,
            properties: {},
            required: []
        }
    },

    apply_patch_batch: {
        name: 'apply_patch_batch',
        description: `Aplica múltiplas operações de edição de arquivo atomicamente em série. Se qualquer operação falhar e rollbackOnFailure=true (padrão), todas as anteriores são revertidas automaticamente. Ideal para refatorações que envolvem múltiplos arquivos. Suporta dry-run para validação prévia.`,
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                transactionId: { type: SchemaType.STRING, description: 'ID opcional para identificar a transação' },
                rollbackOnFailure: { type: SchemaType.BOOLEAN, description: 'Se true (padrão), reverte tudo caso alguma operação falhe' },
                dryRun: { type: SchemaType.BOOLEAN, description: 'Se true, valida sem aplicar nenhuma mudança' },
                operations: {
                    type: SchemaType.ARRAY,
                    description: 'Lista de operações a aplicar em série',
                    items: {
                        type: SchemaType.OBJECT,
                        properties: {
                            type: { type: SchemaType.STRING, description: '"patch_file" | "create" | "replace" | "delete"' },
                            path: { type: SchemaType.STRING, description: 'Caminho relativo do arquivo' },
                            exact_match: { type: SchemaType.STRING, description: '[patch_file] Texto exato a ser substituído' },
                            content: { type: SchemaType.STRING, description: '[patch_file] Replacement. [create/replace] Conteúdo completo' },
                            occurrence: { type: SchemaType.INTEGER, description: '[patch_file] Qual ocorrência substituir (0-based)' }
                        },
                        required: ['type', 'path']
                    }
                }
            },
            required: ['operations']
        }
    },

    session_memory: {
        name: 'session_memory',
        description: `Memória persistente entre sessões. Salva e recupera informações em .nic-hyper-flow/memory.json no workspace. Três categorias: "task" (objetivo atual, hipóteses, decisões), "project" (arquitetura, convenções, riscos), "user" (preferências, estilo de código). Use para não re-descobrir contexto em tarefas futuras. Os dados salvos aqui aparecem automaticamente nos resultados da tool search.`,
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                operation: { type: SchemaType.STRING, description: '"set" | "get" | "list" | "delete" | "clear" | "append"' },
                category: { type: SchemaType.STRING, description: '"task" (padrão) | "project" | "user"' },
                key: { type: SchemaType.STRING, description: 'Chave da memória (obrigatório para set/get/delete/append)' },
                value: { description: 'Valor a salvar — qualquer tipo JSON (obrigatório para set/append). append faz push em array.' }
            },
            required: ['operation']
        }
    },

    summarize_changes: {
        name: 'summarize_changes',
        description: `Retorna um resumo estruturado das mudanças git: arquivos modificados/adicionados/deletados, linhas +/- por arquivo, diff compacto e último commit. Use antes de commitar ou para entender o estado atual sem ler arquivo por arquivo. Suporta comparar contra qualquer base (HEAD, branch, commit hash).`,
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                base: { type: SchemaType.STRING, description: 'Base de comparação (padrão: "HEAD"). Aceita branch, tag ou commit hash.' },
                includeDiff: { type: SchemaType.BOOLEAN, description: 'Se true (padrão), inclui diff compacto por arquivo' },
                maxDiffCharsPerFile: { type: SchemaType.INTEGER, description: 'Limite de chars do diff por arquivo (padrão: 3000)' },
                maxFiles: { type: SchemaType.INTEGER, description: 'Máximo de arquivos a processar (padrão: 30)' }
            },
            required: []
        }
    },

    // =========================
    // SUBAGENTES
    // =========================
    run_subagent: {
        name: 'run_subagent',
        description: `Lança um subagente com loop próprio de IA que executa uma tarefa de forma autônoma.

O subagente:
- Usa as mesmas tools que o agente principal (read_file, search, patch_file, run_command, etc.)
- Tem seu próprio histórico e contexto isolado
- Reporta estado via tool \`report_subagent_state\` durante a execução
- Quando termina, injeta um payload rico no seu contexto (output, histórico de estados, tools usadas, duração)
- Se o loop principal estiver parado quando terminar, ele é reiniciado automaticamente

Use wait=false (padrão) para disparar em background e continuar trabalhando.
Use wait=true para aguardar o resultado antes de continuar.`,
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                task: { type: SchemaType.STRING, description: 'Descrição completa do que o subagente deve fazer. Seja específico.' },
                label: { type: SchemaType.STRING, description: 'Nome de exibição na UI (ex: "Analisador", "Escritor de Testes"). Padrão: "Subagente".' },
                wait: { type: SchemaType.BOOLEAN, description: 'true = aguarda o subagente terminar antes de retornar. false (padrão) = dispara em background.' },
                subagent_id: { type: SchemaType.STRING, description: 'ID customizado (opcional). Se omitido, um ID único é gerado automaticamente.' }
            },
            required: ['task']
        }
    },

    stop_subagent: {
        name: 'stop_subagent',
        description: `Para um subagente rodando em background pelo ID. O subagente para mas mantém o contexto (não perde histórico).`,
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                agent_id: { type: SchemaType.STRING, description: 'O ID do subagente retornado por run_subagent.' }
            },
            required: ['agent_id']
        }
    },

    report_subagent_state: {
        name: 'report_subagent_state',
        description: `EXCLUSIVO PARA SUBAGENTES — Reporta o estado atual do subagente em uma frase curta.

Use para comunicar progresso ao agente principal:
- O estado aparece na UI abaixo do status principal
- É injetado no contexto do agente principal no início do próximo turno
- NÃO reinicia o loop principal (apenas o payload final ao terminar faz isso)

Exemplos: "Analisando arquivos TypeScript", "Encontrei 3 bugs no módulo de autenticação", "Escrevendo testes..."`,
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                state: { type: SchemaType.STRING, description: 'Frase curta descrevendo o estado atual (máx ~100 chars).' }
            },
            required: ['state']
        }
    },
};
