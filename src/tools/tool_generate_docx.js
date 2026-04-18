/**
 * tool_generate_docx.js
 * Tool definition para o agente Node.js — delega geração de .docx ao Python.
 *
 * Integração: importe e adicione ao seu array de tools.
 * O agente passa o JSON spec completo; este módulo chama o Python e retorna o resultado.
 */

const { execFile } = require("child_process");
const path = require("path");

// ── configuração ─────────────────────────────────────────────────────────────

const PYTHON_BIN    = process.env.DOCX_PYTHON_BIN    || "python3";
const GENERATOR_PY  = process.env.DOCX_GENERATOR_PY  ||
                      path.join(__dirname, "generate_docx.py");
const TIMEOUT_MS    = Number(process.env.DOCX_TIMEOUT_MS) || 30_000;

// ── executor ──────────────────────────────────────────────────────────────────

/**
 * Chama o Python generator e retorna { ok, path } ou { ok: false, error }.
 * @param {object} spec  - JSON spec completo do documento
 * @returns {Promise<{ok: boolean, path?: string, error?: string}>}
 */
function runPythonGenerator(spec) {
  return new Promise((resolve) => {
    const specJson = JSON.stringify(spec);

    const child = execFile(
      PYTHON_BIN,
      [GENERATOR_PY, "--spec", specJson],
      { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          return resolve({
            ok: false,
            error: stderr || err.message,
          });
        }
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch {
          resolve({ ok: false, error: `Saída inesperada do Python: ${stdout}` });
        }
      }
    );

    // stderr em tempo real para debug (opcional)
    child.stderr?.on("data", (d) => process.stderr.write(d));
  });
}

// ── tool definition ───────────────────────────────────────────────────────────
// Formato compatível com qualquer agente que use { name, description, parameters, execute }
// Adapte o formato se o teu agente usar outro schema (ex: OpenAI function calling).

const generateDocxTool = {
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
  `.trim(),

  parameters: {
    type: "object",
    required: ["output_path", "content"],
    properties: {

      output_path: {
        type: "string",
        description: "Caminho absoluto ou relativo onde salvar o .docx. Ex: '/tmp/proposta.docx'",
      },

      append_to: {
        type: "string",
        description: "Se fornecido, abre este .docx existente e ANEXA o conteúdo como nova página (página incremental). Passe o 'path' retornado pela chamada anterior. output_path pode ser igual ao append_to para sobrescrever no lugar.",
      },

      page_index: {
        type: "integer",
        description: "Índice da página sendo gerada (0 = primeira). Apenas informativo — é retornado no resultado.",
      },

      page: {
        type: "object",
        description: "Configuração da página (opcional — padrão A4 portrait, margens 1 inch)",
        properties: {
          size:          { type: "string", enum: ["A4", "letter", "A3"], default: "A4" },
          landscape:     { type: "boolean", default: false },
          margin_top:    { type: "number", description: "Margem superior em inches" },
          margin_bottom: { type: "number" },
          margin_left:   { type: "number" },
          margin_right:  { type: "number" },
        },
      },

      styles: {
        type: "object",
        description: "Estilos globais do documento",
        properties: {
          font: { type: "string", description: "Fonte padrão. Ex: 'Calibri', 'Arial'" },
          size: { type: "number", description: "Tamanho padrão em pt" },
          heading1: {
            type: "object",
            properties: {
              size:  { type: "number" },
              bold:  { type: "boolean" },
              color: { type: "string", description: "Hex sem #, ex: '1F3864'" },
              font:  { type: "string" },
            },
          },
          heading2: { "$ref": "#/properties/styles/properties/heading1" },
          heading3: { "$ref": "#/properties/styles/properties/heading1" },
        },
      },

      header: {
        type: "object",
        description: "Cabeçalho do documento",
        properties: {
          text:        { type: "string" },
          runs:        { type: "array" },
          align:       { type: "string", enum: ["left", "center", "right"] },
          page_number: { type: "boolean" },
        },
      },

      footer: {
        type: "object",
        description: "Rodapé do documento",
        properties: {
          text:        { type: "string" },
          runs:        { type: "array" },
          align:       { type: "string", enum: ["left", "center", "right"] },
          page_number: { type: "boolean", description: "Insere campo PAGE (número de página)" },
        },
      },

      content: {
        type: "array",
        description: "Array de blocos de conteúdo do documento, em ordem.",
        items: {
          type: "object",
          required: ["type"],
          properties: {

            type: {
              type: "string",
              enum: ["paragraph", "p", "h1", "h2", "h3", "h4", "h5", "h6",
                     "list", "table", "image", "img", "page_break", "hr", "toc"],
              description: "Tipo do bloco",
            },

            // ── paragraph / headings ──
            text: {
              type: "string",
              description: "Texto simples (alternativa a 'runs')",
            },
            style: {
              type: "string",
              description: "Estilo Word nativo. Ex: 'Normal', 'Quote', 'Intense Quote'",
            },
            runs: {
              type: "array",
              description: "Runs formatados. Cada item: string simples OU objeto { text, bold, italic, underline, size, color, font, url }",
              items: {
                oneOf: [
                  { type: "string" },
                  {
                    type: "object",
                    properties: {
                      text:      { type: "string" },
                      bold:      { type: "boolean" },
                      italic:    { type: "boolean" },
                      underline: { type: "boolean" },
                      strike:    { type: "boolean" },
                      size:      { type: "number", description: "Tamanho em pt" },
                      color:     { type: "string", description: "Hex com ou sem #. Ex: '#FF0000'" },
                      font:      { type: "string" },
                      url:       { type: "string", description: "Se presente, cria hyperlink clicável" },
                      highlight: { type: "string", enum: ["yellow", "green", "cyan", "blue", "red"] },
                    },
                  },
                ],
              },
            },
            fmt: {
              type: "object",
              description: "Formatação de parágrafo/run",
              properties: {
                align:        { type: "string", enum: ["left", "center", "right", "justify"] },
                space_before: { type: "number", description: "Espaço antes em pt" },
                space_after:  { type: "number" },
                line_spacing: { type: "number" },
                left_indent:  { type: "number", description: "Recuo em inches" },
                first_line:   { type: "number" },
                bold:         { type: "boolean" },
                italic:       { type: "boolean" },
                size:         { type: "number" },
                color:        { type: "string" },
                font:         { type: "string" },
              },
            },

            // ── list ──
            ordered: {
              type: "boolean",
              description: "true = numerada, false = com marcadores",
            },
            items: {
              type: "array",
              description: "Itens da lista. Cada item: string OU { text, level, bold, ... }",
            },

            // ── table ──
            headers: {
              type: "array",
              items: { type: "string" },
              description: "Textos do cabeçalho da tabela",
            },
            rows: {
              type: "array",
              description: "Linhas de dados. Cada linha: array de strings OU array de { text, bold, align, bg, ... }",
            },
            col_widths: {
              type: "array",
              items: { type: "number" },
              description: "Largura de cada coluna em inches",
            },
            header_bg:    { type: "string", description: "Cor de fundo do header da tabela. Hex. Ex: '#2E75B6'" },
            header_color: { type: "string", description: "Cor do texto do header. Ex: '#FFFFFF'" },

            // ── image ──
            path:   { type: "string", description: "Caminho para o arquivo de imagem" },
            width:  { type: "number", description: "Largura em inches" },
            height: { type: "number", description: "Altura em inches" },
            align:  { type: "string", enum: ["left", "center", "right"] },

            // ── hr ──
            thickness: { type: "number", description: "Espessura da linha em pts (padrão 6)" },
            color:     { type: "string", description: "Cor da linha HR. Hex. Ex: '#CCCCCC'" },
          },
        },
      },
    },
  },

  /**
   * Executa a tool.
   * @param {object} args  - parâmetros validados pelo modelo
   * @returns {Promise<string>}  - resposta em texto para o agente
   */
  async execute(args) {
    const result = await runPythonGenerator(args);

    if (result.ok) {
      const mode = result.appended ? "Página anexada" : "Documento criado";
      const page = result.pages_so_far !== "?" ? ` (página ${result.pages_so_far})` : "";
      return `${mode}${page}: ${result.path}`;
    } else {
      return `Falha ao gerar o documento:\n${result.error}`;
    }
  },
};

module.exports = { generateDocxTool, runPythonGenerator };

// ── exemplo de uso direto (node tool_generate_docx.js) ───────────────────────
if (require.main === module) {
  const exampleSpec = {
    output_path: "/tmp/teste_docx.docx",
    page: { size: "A4", margin_top: 1, margin_bottom: 1, margin_left: 1.25, margin_right: 1.25 },
    styles: {
      font: "Calibri",
      size: 11,
      heading1: { size: 18, bold: true, color: "#1F3864" },
      heading2: { size: 14, bold: true, color: "#2E75B6" },
    },
    header: { text: "Papai Solar — Documento de Teste", align: "right" },
    footer: { text: "Página ", align: "center", page_number: true },
    content: [
      { type: "h1", text: "Proposta Comercial" },
      { type: "paragraph", text: "Este é um parágrafo de introdução gerado automaticamente." },
      { type: "h2", text: "Especificações do Sistema" },
      {
        type: "paragraph",
        runs: [
          "Potência instalada: ",
          { text: "12 kWp", bold: true, color: "#2E75B6" },
          " — suficiente para cobrir 100% do consumo.",
        ],
      },
      {
        type: "list",
        ordered: false,
        items: ["Módulos 550W Canadian Solar", "Inversor Growatt 10kW", "Estrutura em alumínio"],
      },
      {
        type: "table",
        headers: ["Item", "Qtd", "Valor Unit.", "Total"],
        header_bg: "#2E75B6",
        header_color: "#FFFFFF",
        col_widths: [3.0, 1.0, 2.0, 2.0],
        rows: [
          ["Módulo Solar 550W", "22", "R$ 850,00", "R$ 18.700,00"],
          ["Inversor 10kW",     "1",  "R$ 4.200,00", "R$ 4.200,00"],
          [{ text: "TOTAL", bold: true }, "", "", { text: "R$ 22.900,00", bold: true, color: "#1F3864" }],
        ],
      },
      { type: "page_break" },
      { type: "h2", text: "Termos e Condições" },
      {
        type: "paragraph",
        text: "Validade desta proposta: 15 dias corridos a partir da data de emissão.",
        fmt: { align: "justify", space_before: 6, space_after: 6 },
      },
    ],
  };

  generateDocxTool.execute(exampleSpec).then(console.log).catch(console.error);
}
