'use strict';

const crypto = require('node:crypto');

const TOOL_CALL_START = '<<TOOL_CALL>>';
const TOOL_CALL_END = '<<END_TOOL_CALL>>';

const STOP_SEQUENCES = [
  '\n\n---\n\n',
  '\n---\n',
  '\nUser:',
  '\nHuman:',
  '\n[Tool Result'
];

function findFirstStopSequence(buffer, patterns = STOP_SEQUENCES) {
  let earliestIdx = -1;
  let matchedSeq = null;
  for (const pat of patterns) {
    const idx = buffer.indexOf(pat);
    if (idx !== -1) {
      if (earliestIdx === -1 || idx < earliestIdx) {
        earliestIdx = idx;
        matchedSeq = pat;
      }
    }
  }
  if (earliestIdx !== -1) {
    return { index: earliestIdx, pattern: matchedSeq };
  }
  return null;
}

function findPotentialSuffixLength(buffer, patterns) {
  let maxMatched = 0;
  for (const pat of patterns) {
    const maxLen = Math.min(buffer.length, pat.length - 1);
    for (let len = maxLen; len >= 1; len--) {
      const suffix = buffer.slice(-len);
      if (pat.startsWith(suffix)) {
        if (len > maxMatched) {
          maxMatched = len;
        }
        break;
      }
    }
  }
  return maxMatched;
}

/**
 * Normaliza a lista de ferramentas vinda do cliente (seja no formato Anthropic ou OpenAI)
 * para um formato padronizado com name, description e input_schema.
 */
function normalizeTools(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.map(t => {
    if (!t) return null;
    if (t.function) {
      return {
        name: t.function.name,
        description: t.function.description || '',
        input_schema: t.function.parameters || { type: 'object', properties: {} }
      };
    }
    return {
      name: t.name,
      description: t.description || '',
      input_schema: t.input_schema || { type: 'object', properties: {} }
    };
  }).filter(t => Boolean(t && t.name));
}

/**
 * Renderiza o catálogo de ferramentas e instruções de chamada para inclusão no System Instructions.
 */
function renderToolsPrompt(tools) {
  const normTools = normalizeTools(tools);
  if (normTools.length === 0) return '';

  const toolsCatalogue = normTools.map(t => {
    const parts = [`- Tool: ${t.name}`];
    if (t.description) parts.push(`  Description: ${t.description.trim()}`);
    parts.push(`  Input Schema: ${JSON.stringify(t.input_schema)}`);
    return parts.join('\n');
  }).join('\n\n');

  return [
    '# AVAILABLE TOOLS',
    'You have access to the following tools:',
    '',
    toolsCatalogue,
    '',
    '## TOOL CALLING INSTRUCTIONS',
    'When you need to execute one or more tools, you MUST output each tool call wrapped in the exact markers:',
    `${TOOL_CALL_START}{"name":"<tool_name>","input":{<parameters>}}${TOOL_CALL_END}`,
    '',
    'Rules:',
    '1. The JSON inside the markers MUST be a single valid JSON object containing "name" (string) and "input" (object). You may optionally include "id" (string).',
    '2. "name" must match one of the available tool names listed above.',
    '3. "input" must match the parameters described in the tool\'s input schema.',
    '4. You may emit brief conversational or explanatory text BEFORE tool calls. Once you start emitting tool calls, do NOT emit conversational text after them.',
    '5. You can call multiple tools in the same turn by outputting multiple tool call blocks sequentially without intervening text.',
    '6. CRITICAL: Never simulate, invent, or hallucinate tool execution results, user responses, or dialogue turns (such as "User:", "---", or "[Tool Result]"). Stop your response immediately after the tool call(s) so the real environment can execute the tool and provide the actual result.',
    `7. If no tool is needed, respond normally without using ${TOOL_CALL_START} markers.`,
    '',
    '## Example Tool Call:',
    'I will read the configuration file.',
    `${TOOL_CALL_START}{"name":"Read","input":{"file_path":"config.json"}}${TOOL_CALL_END}`
  ].join('\n');
}

/**
 * Gera um ID de chamada de ferramenta compatível com Anthropic (toolu_...).
 */
function generateToolId() {
  return `toolu_${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * Validação básica da chamada de ferramenta:
 * - Objeto JSON válido
 * - Nome existente na lista de ferramentas permitidas
 * - Input do tipo objeto
 * - Presença de campos obrigatórios (required) se definidos no schema
 */
function validateToolCall(callObj, toolsMap) {
  if (!callObj || typeof callObj !== 'object' || Array.isArray(callObj)) {
    return { valid: false, reason: 'Payload must be a JSON object' };
  }
  const { name, input } = callObj;
  if (!name || typeof name !== 'string') {
    return { valid: false, reason: 'Tool name missing or invalid' };
  }
  if (toolsMap && toolsMap.size > 0 && !toolsMap.has(name)) {
    return { valid: false, reason: `Tool '${name}' not in allowed tools` };
  }
  if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input))) {
    return { valid: false, reason: 'Tool input must be an object' };
  }
  const toolDef = toolsMap?.get(name);
  if (toolDef?.input_schema) {
    const schema = toolDef.input_schema;
    if (Array.isArray(schema.required) && input) {
      for (const req of schema.required) {
        if (input[req] === undefined) {
          return { valid: false, reason: `Missing required property '${req}'` };
        }
      }
    }
  }
  return { valid: true };
}

/**
 * Parser não-stream:
 * Extrai todos os blocos <<TOOL_CALL>>...<<END_TOOL_CALL>> do texto completo.
 * Retorna segmentos ordenados (text e tool_use), lista de chamadas válidas e indicador.
 */
function parseNonStreamResponse(text, tools = [], onLog = null) {
  // Trunca em qualquer sequência de parada detectada
  const stopMatch = findFirstStopSequence(text, STOP_SEQUENCES);
  if (stopMatch) {
    text = text.slice(0, stopMatch.index);
  }

  const normTools = normalizeTools(tools);
  const toolsMap = new Map(normTools.map(t => [t.name, t]));

  const segments = [];
  let lastIndex = 0;

  while (true) {
    const startIdx = text.indexOf(TOOL_CALL_START, lastIndex);
    if (startIdx === -1) {
      const remaining = text.slice(lastIndex);
      if (remaining) segments.push({ type: 'text', text: remaining });
      break;
    }

    if (startIdx > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, startIdx) });
    }

    const endIdx = text.indexOf(TOOL_CALL_END, startIdx + TOOL_CALL_START.length);
    if (endIdx === -1) {
      // Marcador de fechamento não encontrado -> trata restante como texto
      segments.push({ type: 'text', text: text.slice(startIdx) });
      break;
    }

    const rawJson = text.slice(startIdx + TOOL_CALL_START.length, endIdx);
    let parsed = null;
    try {
      parsed = JSON.parse(rawJson.trim());
    } catch (_) {}

    const val = parsed ? validateToolCall(parsed, toolsMap) : { valid: false, reason: 'Invalid JSON' };

    if (val.valid) {
      segments.push({
        type: 'tool_use',
        id: parsed.id || generateToolId(),
        name: parsed.name,
        input: parsed.input || {}
      });
    } else {
      if (typeof onLog === 'function') {
        onLog(`⚠️ [Tool Parser] Chamada inválida ignorada (${val.reason}): ${rawJson.trim()}`);
      }
      segments.push({
        type: 'text',
        text: text.slice(startIdx, endIdx + TOOL_CALL_END.length)
      });
    }

    lastIndex = endIdx + TOOL_CALL_END.length;
  }

  // Condensa blocos contíguos de texto e limpa resíduos de fechamento como !] ou !]?>
  const condensed = [];
  for (const seg of segments) {
    if (seg.type === 'text') {
      let cleanedText = seg.text.replace(/!\](?:\?>)?\s*$/g, '');
      if (condensed.length > 0 && condensed[condensed.length - 1].type === 'text') {
        condensed[condensed.length - 1].text += cleanedText;
      } else {
        condensed.push({ ...seg, text: cleanedText });
      }
    } else {
      condensed.push(seg);
    }
  }

  const toolCalls = condensed.filter(s => s.type === 'tool_use');
  return {
    segments: condensed,
    toolCalls,
    hasToolCalls: toolCalls.length > 0
  };
}

/**
 * Cria um parser de streaming com máquina de estados para separar texto e tool calls.
 * Não vaza fragmentos de marcadores, descarta alucinações pós-ferramenta e emite eventos ordenados.
 */
function createStreamingToolParser({ tools = [], onText, onToolCall, onStop, onLog }) {
  const normTools = normalizeTools(tools);
  const toolsMap = new Map(normTools.map(t => [t.name, t]));

  let state = 'TEXT';
  let buffer = '';
  let stopped = false;
  let justFinishedTool = false;
  const toolCalls = [];

  function processBuffer() {
    let progressed = true;
    while (progressed && !stopped) {
      progressed = false;

      if (state === 'TEXT') {
        if (justFinishedTool) {
          buffer = buffer.replace(/^!\](?:\?>)?/, '');
          if (buffer.length > 0 && !buffer.startsWith('!')) {
            justFinishedTool = false;
          }
        }

        const startIdx = buffer.indexOf(TOOL_CALL_START);
        const stopMatch = findFirstStopSequence(buffer, STOP_SEQUENCES);

        // Se uma ferramenta começa antes de qualquer stop sequence
        if (startIdx !== -1 && (!stopMatch || startIdx < stopMatch.index)) {
          if (startIdx > 0) {
            const textToEmit = buffer.slice(0, startIdx);
            if (typeof onText === 'function') onText(textToEmit);
          }
          buffer = buffer.slice(startIdx + TOOL_CALL_START.length);
          state = 'INSIDE_TOOL';
          progressed = true;
          continue;
        }

        // Se uma sequência de parada (ex: "---", "User:") foi encontrada antes de ferramenta
        if (stopMatch) {
          if (stopMatch.index > 0) {
            const safeText = buffer.slice(0, stopMatch.index);
            if (typeof onText === 'function') onText(safeText);
          }
          if (typeof onLog === 'function') {
            onLog(`🛑 [Streaming Tool Parser] Sequência de parada detectada: ${JSON.stringify(stopMatch.pattern)}`);
          }
          buffer = '';
          stopped = true;
          if (typeof onStop === 'function') onStop('stop_sequence');
          break;
        }

        // Verifica se o sufixo do buffer pode ser o prefixo de <<TOOL_CALL>> ou de STOP_SEQUENCES
        const allPatterns = [TOOL_CALL_START, ...STOP_SEQUENCES];
        const matchedLen = findPotentialSuffixLength(buffer, allPatterns);

        if (matchedLen > 0) {
          if (buffer.length > matchedLen) {
            const safeText = buffer.slice(0, buffer.length - matchedLen);
            if (typeof onText === 'function') onText(safeText);
            buffer = buffer.slice(-matchedLen);
          }
        } else {
          if (buffer.length > 0) {
            if (typeof onText === 'function') onText(buffer);
            buffer = '';
          }
        }
      } else if (state === 'INSIDE_TOOL') {
        const endIdx = buffer.indexOf(TOOL_CALL_END);
        if (endIdx !== -1) {
          const rawJson = buffer.slice(0, endIdx);
          let remaining = buffer.slice(endIdx + TOOL_CALL_END.length);
          // Limpa artefatos sintáticos comuns (como !] ou !]?>) que ocorrem imediatamente após fechamento
          remaining = remaining.replace(/^!\](?:\?>)?/g, '');

          let parsed = null;
          try {
            parsed = JSON.parse(rawJson.trim());
          } catch (_) {}

          const val = parsed ? validateToolCall(parsed, toolsMap) : { valid: false, reason: 'Invalid JSON' };

          if (val.valid) {
            const call = {
              id: parsed.id || generateToolId(),
              name: parsed.name,
              input: parsed.input || {}
            };
            toolCalls.push(call);
            justFinishedTool = true;
            if (typeof onToolCall === 'function') onToolCall(call);
          } else {
            if (typeof onLog === 'function') {
              onLog(`⚠️ [Streaming Tool Parser] Chamada inválida ignorada (${val.reason}): ${rawJson.trim()}`);
            }
            const fallbackText = `${TOOL_CALL_START}${rawJson}${TOOL_CALL_END}`;
            if (typeof onText === 'function') onText(fallbackText);
          }

          buffer = remaining;
          state = 'TEXT';
          progressed = true;
        }
      }
    }
  }

  return {
    feed(chunk) {
      if (stopped || !chunk) return;
      buffer += chunk;
      processBuffer();
    },
    flush() {
      if (stopped) return;
      if (state === 'INSIDE_TOOL') {
        const unclosedText = `${TOOL_CALL_START}${buffer}`;
        buffer = '';
        state = 'TEXT';
        if (typeof onText === 'function') onText(unclosedText);
      } else if (state === 'TEXT' && buffer.length > 0) {
        const stopMatch = findFirstStopSequence(buffer, STOP_SEQUENCES);
        const safeText = stopMatch ? buffer.slice(0, stopMatch.index) : buffer;
        if (safeText && typeof onText === 'function') onText(safeText);
        buffer = '';
      } else if (state === 'AFTER_TOOL') {
        buffer = '';
      }
    },
    getToolCalls() {
      return toolCalls;
    },
    hasToolCalls() {
      return toolCalls.length > 0;
    },
    isStopped() {
      return stopped;
    }
  };
}

module.exports = {
  TOOL_CALL_START,
  TOOL_CALL_END,
  STOP_SEQUENCES,
  findFirstStopSequence,
  normalizeTools,
  renderToolsPrompt,
  generateToolId,
  validateToolCall,
  parseNonStreamResponse,
  createStreamingToolParser
};
