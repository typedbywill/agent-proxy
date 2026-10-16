#!/usr/bin/env node

/**
 * agent-proxy: Servidor OpenAI-compatível & Anthropic Messages-compatível.
 *
 * Conceito do modelo coringa ("ai-proxy"):
 * - No Cursor IDE e no Claude Code, você configura o modelo como `ai-proxy`
 * - Sempre que uma requisição chega com `ai-proxy` (ou modelo vazio), o proxy despacha
 *   para o provedor e modelo atualmente definidos em `~/.config/agent-proxy/providers.json` ("active")!
 * - Você pode mudar o provedor e modelo ativos instantaneamente via comando:
 *     agent-proxy use <provedor> [modelo]
 *     ex: agent-proxy use antigravity gemini-3.8-flash-medium
 *     ex: agent-proxy use openrouter deepseek/deepseek-r1
 */

const http = require('node:http');
const https = require('node:https');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  TOOL_CALL_START,
  TOOL_CALL_END,
  renderToolsPrompt,
  parseNonStreamResponse,
  createStreamingToolParser
} = require('./tool-parser');

const PORT = parseInt(process.env.AGENT_PROXY_PORT || '8080', 10);
const HOST = process.env.AGENT_PROXY_HOST || '127.0.0.1';
const AGY_BIN = process.env.AGY_BIN || path.join(os.homedir(), '.local/bin/agy');
const LOG_FILE = process.env.AGENT_PROXY_LOG || path.join(os.homedir(), '.agent-proxy.log');
const CONFIG_FILE = process.env.AGENT_PROXY_CONFIG || path.join(os.homedir(), '.config/agent-proxy/providers.json');

const ALIAS_MODEL_NAMES = ['ai-proxy', 'agent-proxy', 'default', 'custom', 'auto'];

const DEFAULT_ANTIGRAVITY_MODELS = [
  'gemini-4-argon-high',
  'gemini-4-argon-medium',
  'gemini-4-argon-low',
  'gemini-3.8-flash-high',
  'gemini-3.8-flash-medium',
  'gemini-3.8-flash-low',
  'claude-sonnet-5-5-high',
  'claude-sonnet-5-5-medium',
  'claude-sonnet-5-5-low',
  'claude-opus-5-5-high',
  'claude-opus-5-5-medium',
  'claude-opus-5-5-low',
  'gpt-oss-120b-medium'
];

function log(msg) {
  const timestamp = new Date().toLocaleTimeString('pt-BR');
  const line = `[${timestamp}] ${msg}\n`;
  process.stdout.write(line);

  // Evita duplicação quando stdout já estiver redirecionado para o arquivo de log (ex: via systemd)
  let isStdoutLogFile = false;
  try {
    const stdoutStat = fs.fstatSync(1);
    if (fs.existsSync(LOG_FILE)) {
      const fileStat = fs.statSync(LOG_FILE);
      isStdoutLogFile = (stdoutStat.ino === fileStat.ino && stdoutStat.dev === fileStat.dev);
    }
  } catch (_) {}

  if (!isStdoutLogFile) {
    try {
      fs.appendFileSync(LOG_FILE, line);
    } catch (_) {}
  }
}

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      log(`⚠️  Erro ao ler ${CONFIG_FILE}: ${e.message}`);
    }
  }
  return {
    active: { provider: 'antigravity', model: 'gemini-3.8-flash-medium' },
    providers: {}
  };
}

function getAvailableModels() {
  const config = loadConfig();
  const models = [];

  // Modelo Coringa principal
  models.push({
    id: 'ai-proxy',
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'ai-proxy-active'
  });

  // Antigravity models
  const agyModels = (config.providers?.antigravity?.models) || DEFAULT_ANTIGRAVITY_MODELS;
  for (const m of agyModels) {
    models.push({
      id: m,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'antigravity'
    });
  }

  // Remote providers models
  if (config.providers) {
    for (const [providerKey, provider] of Object.entries(config.providers)) {
      if (providerKey === 'antigravity') continue;
      if (Array.isArray(provider.models)) {
        for (const m of provider.models) {
          models.push({
            id: m,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: providerKey
          });
        }
      }
    }
  }
  return models;
}

function resolveRoute(requestedModel) {
  const config = loadConfig();
  const reqLower = String(requestedModel || '').toLowerCase().trim();

  // 1. Se for o alias coringa "ai-proxy" (ou derivado)
  if (!reqLower || ALIAS_MODEL_NAMES.includes(reqLower)) {
    const active = config.active || { provider: 'antigravity', model: 'gemini-3.8-flash-medium' };
    log(`🎯 Modelo coringa 'ai-proxy' detectado -> Roteando para [${active.provider}] '${active.model}'`);

    if (active.provider === 'antigravity') {
      return { type: 'antigravity', model: active.model || 'gemini-3.8-flash-medium' };
    }

    const providerObj = config.providers?.[active.provider];
    if (providerObj) {
      return {
        type: 'remote',
        providerKey: active.provider,
        provider: providerObj,
        model: active.model
      };
    }

    return { type: 'antigravity', model: 'gemini-3.8-flash-medium' };
  }

  // 2. Se for especificado um modelo Antigravity direto
  const agyModels = (config.providers?.antigravity?.models) || DEFAULT_ANTIGRAVITY_MODELS;
  if (agyModels.includes(requestedModel)) {
    return { type: 'antigravity', model: requestedModel };
  }

  // 2.1 Aliases amigáveis para modelos Gemini no Antigravity
  if (reqLower === 'gemini' || reqLower === 'gemini-flash' || reqLower === 'gemini-3.8-flash' || reqLower === 'flash') {
    return { type: 'antigravity', model: 'gemini-3.8-flash-medium' };
  }
  if (reqLower === 'gemini-flash-high' || reqLower === 'gemini-high' || reqLower === 'flash-high') {
    return { type: 'antigravity', model: 'gemini-3.8-flash-high' };
  }
  if (reqLower === 'gemini-flash-low' || reqLower === 'gemini-low' || reqLower === 'flash-low') {
    return { type: 'antigravity', model: 'gemini-3.8-flash-low' };
  }
  if (reqLower === 'gemini-argon' || reqLower === 'gemini-4-argon' || reqLower === 'argon') {
    return { type: 'antigravity', model: 'gemini-4-argon-medium' };
  }
  if (reqLower === 'gemini-argon-high' || reqLower === 'argon-high') {
    return { type: 'antigravity', model: 'gemini-4-argon-high' };
  }
  if (reqLower === 'gemini-argon-low' || reqLower === 'argon-low') {
    return { type: 'antigravity', model: 'gemini-4-argon-low' };
  }

  // 2.2 Busca aproximada para modelos gemini
  if (reqLower.startsWith('gemini') || reqLower.startsWith('argon')) {
    const matched = agyModels.find(m => m.toLowerCase().includes(reqLower) || reqLower.includes(m.toLowerCase()));
    if (matched) {
      return { type: 'antigravity', model: matched };
    }
  }

  // 3. Se for de algum provedor cadastrado
  if (config.providers) {
    for (const [providerKey, provider] of Object.entries(config.providers)) {
      if (providerKey === 'antigravity') continue;

      if (Array.isArray(provider.models) && provider.models.includes(requestedModel)) {
        return { type: 'remote', providerKey, provider, model: requestedModel };
      }

      if (requestedModel.startsWith(`${providerKey}/`)) {
        const actualModel = requestedModel.slice(providerKey.length + 1);
        return { type: 'remote', providerKey, provider, model: actualModel };
      }
    }

    if (requestedModel.includes('/') && config.providers.openrouter && config.providers.openrouter.apiKey) {
      return {
        type: 'remote',
        providerKey: 'openrouter',
        provider: config.providers.openrouter,
        model: requestedModel
      };
    }
  }

  // Fallback padrão: rota ativa configurada
  const active = config.active || { provider: 'antigravity', model: 'gemini-3.8-flash-medium' };
  log(`⚠️  Modelo '${requestedModel}' não catalogado -> Usando fallback da rota ativa [${active.provider}] '${active.model}'`);

  if (active.provider === 'antigravity') {
    return { type: 'antigravity', model: active.model || 'gemini-3.8-flash-medium' };
  }

  const providerObj = config.providers?.[active.provider];
  if (providerObj) {
    return {
      type: 'remote',
      providerKey: active.provider,
      provider: providerObj,
      model: active.model
    };
  }

  return { type: 'antigravity', model: 'gemini-3.8-flash-medium' };
}

function sanitizeAssistantText(text) {
  if (typeof text !== 'string') return '';
  // Remove delimitações simuladas de turnos futuros (ex: "--- \n User:")
  const stopIndex = text.search(/\n+---+\n+(?:User|Human):/i);
  if (stopIndex !== -1) {
    text = text.slice(0, stopIndex);
  }
  // Remove blocos de tool result alucinados
  text = text.replace(/\[Tool Result \([^)]+\):[\s\S]*?\]/g, '');
  // Remove resíduos de fechamento como !] ou !]?> no final
  text = text.replace(/!\](?:\?>)?\s*$/g, '');
  return text.trim();
}

function formatMessagesToPrompt(payloadOrMessages) {
  let messages = [];
  let systemText = '';
  let tools = [];

  if (Array.isArray(payloadOrMessages)) {
    messages = payloadOrMessages;
  } else if (payloadOrMessages && typeof payloadOrMessages === 'object') {
    messages = payloadOrMessages.messages || [];
    if (payloadOrMessages.system) {
      systemText = typeof payloadOrMessages.system === 'string'
        ? payloadOrMessages.system
        : Array.isArray(payloadOrMessages.system)
          ? payloadOrMessages.system.map(s => (typeof s === 'string' ? s : s.text || s.content || '')).join('\n')
          : '';
    }
    if (Array.isArray(payloadOrMessages.tools) && payloadOrMessages.tools.length > 0) {
      tools = payloadOrMessages.tools;
    }
  }

  const parts = [];

  // Se houver catálogo de ferramentas, renderiza as instruções correspondentes
  if (tools.length > 0) {
    const toolsPrompt = renderToolsPrompt(tools);
    if (toolsPrompt) {
      systemText = systemText ? `${systemText}\n\n${toolsPrompt}` : toolsPrompt;
    }
  }

  if (systemText && systemText.trim()) {
    parts.push(`System Instructions:\n${systemText.trim()}`);
  }

  for (const m of messages) {
    const role = m.role === 'assistant' ? 'Model' : m.role === 'system' ? 'System Instructions' : 'User';
    let content = m.content;
    const extraParts = [];

    // Suporte a tool_calls formato OpenAI em mensagens de assistente
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      for (const tc of m.tool_calls) {
        let inputObj = {};
        try {
          inputObj = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function?.arguments || {};
        } catch (_) {
          inputObj = { raw: tc.function?.arguments || '' };
        }
        extraParts.push(`${TOOL_CALL_START}${JSON.stringify({ id: tc.id, name: tc.function?.name || '', input: inputObj })}${TOOL_CALL_END}`);
      }
    }

    // Suporte a respostas de ferramentas formato OpenAI (role: 'tool')
    if (m.role === 'tool') {
      const toolResText = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
      parts.push(`User:\n[Tool Result (${m.tool_call_id || ''}): ${toolResText}]`);
      continue;
    }

    if (Array.isArray(content)) {
      content = content
        .map(c => {
          if (typeof c === 'string') return m.role === 'assistant' ? sanitizeAssistantText(c) : c;
          if (c.type === 'text') {
            const raw = c.text || '';
            return m.role === 'assistant' ? sanitizeAssistantText(raw) : raw;
          }
          if (c.type === 'tool_use') {
            return `${TOOL_CALL_START}${JSON.stringify({ id: c.id, name: c.name, input: c.input || {} })}${TOOL_CALL_END}`;
          }
          if (c.type === 'tool_result') {
            let resText = c.content;
            if (Array.isArray(resText)) {
              resText = resText.map(rc => (typeof rc === 'string' ? rc : rc.text || JSON.stringify(rc))).join('\n');
            } else if (typeof resText !== 'string') {
              resText = JSON.stringify(resText || '');
            }
            return `[Tool Result (${c.tool_use_id || ''}): ${resText}]`;
          }
          return c.text || c.content || JSON.stringify(c);
        })
        .join('\n');
    } else if (typeof content === 'string') {
      content = m.role === 'assistant' ? sanitizeAssistantText(content) : content;
    } else if (typeof content !== 'string') {
      content = JSON.stringify(content || '');
    }

    let fullMessageContent = (content || '').trim();
    if (extraParts.length > 0) {
      fullMessageContent = fullMessageContent ? `${fullMessageContent}\n${extraParts.join('\n')}` : extraParts.join('\n');
    }

    parts.push(`${role}:\n${fullMessageContent}`);
  }

  if (parts.length === 0) return '';
  if (parts.length === 1 && !systemText && messages.length === 1 && messages[0].role === 'user') {
    const firstContent = messages[0].content;
    if (typeof firstContent === 'string') return firstContent;
  }

  return parts.join('\n\n---\n\n') + '\n\nModel:\n';
}

function handleAntigravityChat(model, payload, res, apiFormat) {
  const prompt = formatMessagesToPrompt(payload);
  const isStream = payload.stream === true;
  log(`🤖 [Antigravity] Modelo: ${model} | Formato: ${apiFormat} | Stream: ${isStream} | Prompt: ${prompt.length} chars`);

  const completionId = `chatcmpl-${Date.now()}`;
  const msgId = `msg_${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  // Evita o limite E2BIG (Argument list too long) do Linux passando o prompt via stdin em formato stream-json
  const args = [
    `--model=${model}`,
    '--disable-slash-commands',
    '--input-format=stream-json',
    '--output-format=stream-json'
  ];

  const proc = spawn(AGY_BIN, args, { stdio: ['pipe', 'pipe', 'pipe'] });

  const inputPayload = JSON.stringify({
    event: 'user',
    message: {
      content: prompt || ' '
    }
  });

  proc.stdin.on('error', err => {
    log(`⚠️  [Antigravity proc.stdin]: ${err.message}`);
  });

  proc.on('error', err => {
    log(`❌ [Antigravity spawn error]: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Falha ao iniciar processo Antigravity: ${err.message}`, type: 'api_error' } }));
    }
  });

  proc.stdin.write(inputPayload + '\n', () => {
    proc.stdin.end();
  });

  let stderrOutput = '';
  let stdoutBuffer = '';
  let sentAnyChunk = false;
  let accumulatedText = '';
  let finalResponse = '';
  let usageData = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let resultError = null;
  let pingInterval = null;

  proc.stderr.on('data', errData => {
    const text = errData.toString();
    stderrOutput += text;
    log(`⚠️  [agy stderr]: ${text.trim()}`);
  });

  let currentBlockIndex = 0;
  let textBlockStarted = false;
  let textBlockClosed = false;
  let isCompleted = false;
  let toolCallIndex = 0;

  const streamingParser = createStreamingToolParser({
    tools: payload.tools || [],
    onText: textChunk => {
      sentAnyChunk = true;
      if (apiFormat === 'anthropic') {
        if (!textBlockStarted || textBlockClosed) {
          res.write(`event: content_block_start\ndata: ${JSON.stringify({
            type: 'content_block_start',
            index: currentBlockIndex,
            content_block: { type: 'text', text: '' }
          })}\n\n`);
          textBlockStarted = true;
          textBlockClosed = false;
        }
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({
          type: 'content_block_delta',
          index: currentBlockIndex,
          delta: { type: 'text_delta', text: textChunk }
        })}\n\n`);
      } else {
        const sseData = {
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: { content: textChunk }, finish_reason: null }]
        };
        res.write(`data: ${JSON.stringify(sseData)}\n\n`);
      }
    },
    onToolCall: call => {
      sentAnyChunk = true;
      if (apiFormat === 'anthropic') {
        if (textBlockStarted && !textBlockClosed) {
          res.write(`event: content_block_stop\ndata: ${JSON.stringify({
            type: 'content_block_stop',
            index: currentBlockIndex
          })}\n\n`);
          textBlockClosed = true;
          currentBlockIndex++;
        }

        const toolBlockIdx = currentBlockIndex++;
        res.write(`event: content_block_start\ndata: ${JSON.stringify({
          type: 'content_block_start',
          index: toolBlockIdx,
          content_block: {
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: {}
          }
        })}\n\n`);

        res.write(`event: content_block_delta\ndata: ${JSON.stringify({
          type: 'content_block_delta',
          index: toolBlockIdx,
          delta: {
            type: 'input_json_delta',
            partial_json: JSON.stringify(call.input || {})
          }
        })}\n\n`);

        res.write(`event: content_block_stop\ndata: ${JSON.stringify({
          type: 'content_block_stop',
          index: toolBlockIdx
        })}\n\n`);
      } else {
        const tcChunk = {
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: toolCallIndex++,
                    id: call.id,
                    type: 'function',
                    function: {
                      name: call.name,
                      arguments: JSON.stringify(call.input || {})
                    }
                  }
                ]
              },
              finish_reason: null
            }
          ]
        };
        res.write(`data: ${JSON.stringify(tcChunk)}\n\n`);
      }
    },
    onStop: reason => {
      log(`🛑 [Antigravity] Encerramento solicitado pelo parser (${reason})`);
      finishAntigravityResponse(0);
    },
    onLog: log
  });

  if (isStream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    if (apiFormat === 'anthropic') {
      res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: msgId, type: 'message', role: 'assistant', model, content: [], usage: { input_tokens: 0, output_tokens: 0 } } })}\n\n`);
    } else {
      const initialChunk = {
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]
      };
      res.write(`data: ${JSON.stringify(initialChunk)}\n\n`);
    }

    // Heartbeat keep-alive para evitar timeout em clientes HTTP (ex: Claude Code / Cursor)
    pingInterval = setInterval(() => {
      if (res.writableEnded || res.destroyed) {
        if (pingInterval) clearInterval(pingInterval);
        return;
      }
      if (apiFormat === 'anthropic') {
        res.write(`event: ping\ndata: ${JSON.stringify({ type: 'ping' })}\n\n`);
      } else {
        res.write(': ping\n\n');
      }
    }, 5000);
  }

  function finishAntigravityResponse(exitCode = 0) {
    if (isCompleted) return;
    isCompleted = true;

    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }

    if (isStream) {
      streamingParser.flush();
      const hasTools = streamingParser.hasToolCalls();

      if (exitCode !== 0 && !sentAnyChunk && (resultError || stderrOutput)) {
        let cleanErr = (resultError || stderrOutput).trim();
        try {
          const m = cleanErr.match(/AGY_ERROR:\s*(\{.*\})/);
          if (m) {
            const parsed = JSON.parse(m[1]);
            cleanErr = parsed.short_error || parsed.status || cleanErr;
          }
        } catch (_) {}
        const errorMsg = `\n⚠️ [agent-proxy]: ${cleanErr}\n`;
        if (apiFormat === 'anthropic') {
          if (!textBlockStarted || textBlockClosed) {
            res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: currentBlockIndex, content_block: { type: 'text', text: '' } })}\n\n`);
            textBlockStarted = true;
          }
          res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: currentBlockIndex, delta: { type: 'text_delta', text: errorMsg } })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ id: completionId, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: errorMsg }, finish_reason: null }] })}\n\n`);
        }
      }

      if (apiFormat === 'anthropic') {
        if (textBlockStarted && !textBlockClosed) {
          res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: currentBlockIndex })}\n\n`);
          textBlockClosed = true;
        }

        if (!textBlockStarted && !hasTools) {
          res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`);
          res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
        }

        const stopReason = hasTools ? 'tool_use' : 'end_turn';
        res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: usageData.output_tokens || 0 } })}\n\n`);
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
      } else {
        const finalChunk = {
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: hasTools ? 'tool_calls' : 'stop' }],
          usage: {
            prompt_tokens: usageData.input_tokens || 0,
            completion_tokens: usageData.output_tokens || 0,
            total_tokens: usageData.total_tokens || 0
          }
        };
        res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        res.write('data: [DONE]\n\n');
      }
      res.end();
      log(`✅ [Antigravity] Stream finalizado com sucesso (stop: ${hasTools ? 'tool_use' : 'end_turn'})`);
    } else {
      let output = finalResponse || accumulatedText;
      if (exitCode !== 0 && !output && (resultError || stderrOutput)) {
        output = `⚠️ [agent-proxy]: ${(resultError || stderrOutput).trim()}`;
      }

      let parsedTools = null;
      if (payload.tools && Array.isArray(payload.tools) && payload.tools.length > 0) {
        parsedTools = parseNonStreamResponse(output, payload.tools, log);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (apiFormat === 'anthropic') {
        let contentBlocks = [];
        let stopReason = 'end_turn';

        if (parsedTools && parsedTools.segments.length > 0) {
          contentBlocks = parsedTools.segments.map(seg => {
            if (seg.type === 'tool_use') {
              return {
                type: 'tool_use',
                id: seg.id,
                name: seg.name,
                input: seg.input
              };
            }
            return {
              type: 'text',
              text: seg.text
            };
          });
          if (parsedTools.hasToolCalls) {
            stopReason = 'tool_use';
          }
        } else {
          contentBlocks = [{ type: 'text', text: output.trim() }];
        }

        res.end(JSON.stringify({
          id: msgId,
          type: 'message',
          role: 'assistant',
          model,
          content: contentBlocks,
          stop_reason: stopReason,
          usage: {
            input_tokens: usageData.input_tokens || 0,
            output_tokens: usageData.output_tokens || 0
          }
        }));
      } else {
        let messageObj = { role: 'assistant', content: output.trim() };
        let finishReason = 'stop';

        if (parsedTools && parsedTools.hasToolCalls) {
          const textOnly = parsedTools.segments
            .filter(s => s.type === 'text')
            .map(s => s.text)
            .join('')
            .trim();
          messageObj.content = textOnly || null;
          messageObj.tool_calls = parsedTools.toolCalls.map((tc, idx) => ({
            id: tc.id || `call_${Date.now()}_${idx}`,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.input || {})
            }
          }));
          finishReason = 'tool_calls';
        }

        res.end(JSON.stringify({
          id: completionId,
          object: 'chat.completion',
          created,
          model,
          choices: [
            {
              index: 0,
              message: messageObj,
              finish_reason: finishReason
            }
          ],
          usage: {
            prompt_tokens: usageData.input_tokens || 0,
            completion_tokens: usageData.output_tokens || 0,
            total_tokens: usageData.total_tokens || 0
          }
        }));
      }
      log(`✅ [Antigravity] Resposta enviada com sucesso (código ${exitCode})`);
    }

    if (!proc.killed) {
      try { proc.kill('SIGTERM'); } catch (_) {}
    }
  }

  res.on('close', () => {
    if (pingInterval) clearInterval(pingInterval);
    if (!proc.killed) {
      try { proc.kill('SIGTERM'); } catch (_) {}
    }
  });

  function processStdoutLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (_) {
      return;
    }

    if (parsed.event === 'step_update' && parsed.step_update) {
      const step = parsed.step_update;
      if (step.step_type === 'agent_response' && step.text_delta) {
        const text = step.text_delta;
        accumulatedText += text;

        if (isStream) {
          streamingParser.feed(text);
        }
      }
      if (step.usage) {
        usageData = {
          input_tokens: step.usage.input_tokens ?? usageData.input_tokens,
          output_tokens: step.usage.output_tokens ?? usageData.output_tokens,
          total_tokens: step.usage.total_tokens ?? usageData.total_tokens
        };
      }
    } else if (parsed.event === 'result' && parsed.result) {
      if (parsed.result.response) {
        finalResponse = parsed.result.response;
      }
      if (parsed.result.usage) {
        usageData = {
          input_tokens: parsed.result.usage.input_tokens ?? usageData.input_tokens,
          output_tokens: parsed.result.usage.output_tokens ?? usageData.output_tokens,
          total_tokens: parsed.result.usage.total_tokens ?? usageData.total_tokens
        };
      }
      if (parsed.result.status === 'ERROR' && parsed.result.error) {
        resultError = parsed.result.error;
      }

      // Requisito 5: Encerra imediatamente no evento result para evitar travamento aguardando close do processo
      finishAntigravityResponse(0);
    }
  }

  proc.stdout.on('data', chunk => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop();
    for (const l of lines) {
      processStdoutLine(l);
    }
  });

  proc.on('close', code => {
    if (stdoutBuffer.trim()) {
      processStdoutLine(stdoutBuffer);
      stdoutBuffer = '';
    }
    finishAntigravityResponse(code);
  });
}

function isReasoningModel(model) {
  const m = String(model || '').toLowerCase();
  return (
    m.includes('o1') ||
    m.includes('o3') ||
    m.includes('o4') ||
    m.includes('reason') ||
    m.includes('gpt-5') ||
    m.includes('gpt-6') ||
    m.includes('deepseek-r1') ||
    m.startsWith('o1') ||
    m.startsWith('o3')
  );
}

function convertAnthropicToolsToOpenAI(anthropicTools) {
  if (!Array.isArray(anthropicTools)) return undefined;
  return anthropicTools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || { type: 'object', properties: {} }
    }
  }));
}

function convertAnthropicToolChoiceToOpenAI(toolChoice) {
  if (!toolChoice) return undefined;
  if (typeof toolChoice === 'string') return toolChoice;
  if (toolChoice.type === 'auto') return 'auto';
  if (toolChoice.type === 'any') return 'required';
  if (toolChoice.type === 'none') return 'none';
  if (toolChoice.type === 'tool' && toolChoice.name) {
    return { type: 'function', function: { name: toolChoice.name } };
  }
  return undefined;
}

function convertAnthropicMessagesToOpenAI(messages, reasoning) {
  const openAIMessages = [];

  for (const m of messages) {
    if (typeof m.content === 'string') {
      openAIMessages.push({ role: m.role, content: m.content });
      continue;
    }

    if (!Array.isArray(m.content)) {
      openAIMessages.push({ role: m.role, content: String(m.content || '') });
      continue;
    }

    if (m.role === 'assistant') {
      let textContent = '';
      const toolCalls = [];

      for (const block of m.content) {
        if (typeof block === 'string') {
          textContent += block;
        } else if (block.type === 'text') {
          textContent += (block.text || '');
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id || `call_${Date.now()}_${toolCalls.length}`,
            type: 'function',
            function: {
              name: block.name,
              arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {})
            }
          });
        }
      }

      const assistantMsg = {
        role: 'assistant',
        content: textContent || (toolCalls.length > 0 ? null : '')
      };
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls;
      }
      openAIMessages.push(assistantMsg);
    } else if (m.role === 'user') {
      const toolResults = [];
      const userContentParts = [];

      for (const block of m.content) {
        if (typeof block === 'string') {
          userContentParts.push({ type: 'text', text: block });
        } else if (block.type === 'text') {
          userContentParts.push({ type: 'text', text: block.text || '' });
        } else if (block.type === 'image' && block.source?.data) {
          userContentParts.push({
            type: 'image_url',
            image_url: {
              url: `data:${block.source.media_type || 'image/png'};base64,${block.source.data}`
            }
          });
        } else if (block.type === 'tool_result') {
          toolResults.push(block);
        }
      }

      // No OpenAI, respostas de ferramentas exigem role: 'tool' com tool_call_id
      for (const tr of toolResults) {
        let resultContent = tr.content;
        if (Array.isArray(resultContent)) {
          resultContent = resultContent
            .map(c => (typeof c === 'string' ? c : c.text || JSON.stringify(c)))
            .join('\n');
        } else if (typeof resultContent !== 'string') {
          resultContent = JSON.stringify(resultContent || '');
        }
        if (tr.is_error && !resultContent.startsWith('Error:')) {
          resultContent = `Error: ${resultContent}`;
        }
        openAIMessages.push({
          role: 'tool',
          tool_call_id: tr.tool_use_id,
          content: resultContent
        });
      }

      if (userContentParts.length > 0) {
        if (userContentParts.length === 1 && userContentParts[0].type === 'text') {
          openAIMessages.push({ role: 'user', content: userContentParts[0].text });
        } else {
          openAIMessages.push({ role: 'user', content: userContentParts });
        }
      }
    } else {
      openAIMessages.push({ role: m.role, content: JSON.stringify(m.content) });
    }
  }

  return openAIMessages;
}

function convertAnthropicToOpenAIPayload(payload, model) {
  const reasoning = isReasoningModel(model);
  const messages = [];

  if (payload.system) {
    const systemText = typeof payload.system === 'string'
      ? payload.system
      : Array.isArray(payload.system)
        ? payload.system.map(s => s.text || '').join('\n')
        : '';
    if (systemText) {
      const role = reasoning ? 'developer' : 'system';
      messages.push({ role, content: systemText });
    }
  }

  if (Array.isArray(payload.messages)) {
    const converted = convertAnthropicMessagesToOpenAI(payload.messages, reasoning);
    messages.push(...converted);
  }

  const result = {
    model,
    messages,
    stream: payload.stream === true,
  };

  // Conversão de ferramentas (Tools)
  if (Array.isArray(payload.tools) && payload.tools.length > 0) {
    result.tools = convertAnthropicToolsToOpenAI(payload.tools);
    if (payload.tool_choice) {
      const tc = convertAnthropicToolChoiceToOpenAI(payload.tool_choice);
      if (tc !== undefined) {
        result.tool_choice = tc;
      }
    }
    // Modelos com reasoning (ex: gpt-6-luna / o1) na OpenAI exigem reasoning_effort 'none' ao utilizar function tools no endpoint chat/completions
    if (reasoning) {
      result.reasoning_effort = 'none';
    }
  }

  const tokenLimit = payload.max_tokens || payload.max_completion_tokens;
  if (tokenLimit) {
    result.max_completion_tokens = tokenLimit;
  }

  if (!reasoning) {
    if (payload.temperature !== undefined) result.temperature = payload.temperature;
    if (payload.top_p !== undefined) result.top_p = payload.top_p;
  }

  return result;
}

function convertOpenAIToAnthropicResponse(openaiJson, model) {
  const choice = openaiJson.choices?.[0];
  const message = choice?.message || {};
  const content = [];

  if (message.content) {
    content.push({ type: 'text', text: message.content });
  }

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    for (const tc of message.tool_calls) {
      let inputObj = {};
      try {
        inputObj = JSON.parse(tc.function?.arguments || '{}');
      } catch (_) {
        inputObj = { raw: tc.function?.arguments || '' };
      }
      content.push({
        type: 'tool_use',
        id: tc.id || `call_${Date.now()}`,
        name: tc.function?.name || '',
        input: inputObj
      });
    }
  }

  if (content.length === 0) {
    content.push({ type: 'text', text: '' });
  }

  let stopReason = 'end_turn';
  if (choice?.finish_reason === 'tool_calls' || (Array.isArray(message.tool_calls) && message.tool_calls.length > 0)) {
    stopReason = 'tool_use';
  } else if (choice?.finish_reason === 'length') {
    stopReason = 'max_tokens';
  } else if (choice?.finish_reason === 'stop') {
    stopReason = 'end_turn';
  }

  return {
    id: `msg_${openaiJson.id || Date.now()}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: stopReason,
    usage: {
      input_tokens: openaiJson.usage?.prompt_tokens || 0,
      output_tokens: openaiJson.usage?.completion_tokens || 0,
    }
  };
}

function handleRemoteProviderChat(routeInfo, payload, res, apiFormat) {
  const { providerKey, provider, model } = routeInfo;
  const isStream = payload.stream === true;
  // OpenRouter suporta endpoint nativo /messages apenas para modelos Claude Anthropic
  const isAnthropicModel = model.startsWith('anthropic/');
  const isAnthropicToOpenRouter = apiFormat === 'anthropic' && providerKey === 'openrouter' && isAnthropicModel;
  const isAnthropicToGenericOpenAI = apiFormat === 'anthropic' && !isAnthropicToOpenRouter;

  const targetPath = isAnthropicToOpenRouter ? '/messages' : '/chat/completions';
  log(`🌐 [${providerKey}] Encaminhando modelo: ${model} para ${provider.baseUrl}${targetPath} (Formato: ${apiFormat}, Stream: ${isStream})`);

  if (!provider.apiKey) {
    const errorMsg = `API Key do provedor '${providerKey}' não configurada em ~/.config/agent-proxy/providers.json!`;
    log(`❌ ${errorMsg}`);
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: errorMsg, type: 'authentication_error' } }));
    return;
  }

  let remotePayload;
  if (isAnthropicToGenericOpenAI) {
    remotePayload = convertAnthropicToOpenAIPayload(payload, model);
  } else {
    remotePayload = {
      ...payload,
      model
    };
    if (isReasoningModel(model)) {
      if (remotePayload.max_tokens !== undefined) {
        if (!remotePayload.max_completion_tokens) {
          remotePayload.max_completion_tokens = remotePayload.max_tokens;
        }
        delete remotePayload.max_tokens;
      }
      delete remotePayload.temperature;
      delete remotePayload.top_p;
    }
  }

  const parsedUrl = new URL(provider.baseUrl.replace(/\/+$/, '') + targetPath);
  const isHttps = parsedUrl.protocol === 'https:';
  const transport = isHttps ? https : http;

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${provider.apiKey}`,
  };

  if (providerKey === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/typedbywill/WillOS';
    headers['X-Title'] = 'WillOS Agent Proxy';
    if (isAnthropicToOpenRouter) {
      headers['anthropic-version'] = '2023-06-01';
    }
  }

  function sendRemoteRequest(payloadToSend, isRetry = false) {
    const postData = JSON.stringify(payloadToSend);
    headers['Content-Length'] = Buffer.byteLength(postData);

    const clientReq = transport.request(parsedUrl, {
      method: 'POST',
      headers,
      timeout: 600000 // 10 minutos
    }, remoteRes => {
      // Se a API retornar 400 por parâmetro incompatível (max_tokens / temperature / reasoning_effort), corrige e tenta novamente
      if (remoteRes.statusCode === 400 && !isRetry) {
        let errBody = '';
        remoteRes.on('data', c => { errBody += c; });
        remoteRes.on('end', () => {
          if (
            errBody.includes('max_tokens') ||
            errBody.includes('max_completion_tokens') ||
            errBody.includes('temperature') ||
            errBody.includes('top_p') ||
            errBody.includes('reasoning_effort')
          ) {
            log(`⚠️  [${providerKey}] Parâmetro incompatível (${errBody.trim()}). Ajustando e repetindo...`);
            const retryPayload = { ...payloadToSend };
            if (retryPayload.max_tokens !== undefined) {
              retryPayload.max_completion_tokens = retryPayload.max_tokens;
              delete retryPayload.max_tokens;
            }
            if (errBody.includes('reasoning_effort') || retryPayload.tools) {
              retryPayload.reasoning_effort = 'none';
            }
            delete retryPayload.temperature;
            delete retryPayload.top_p;
            sendRemoteRequest(retryPayload, true);
            return;
          }

          const responseHeaders = { ...remoteRes.headers };
          delete responseHeaders['content-length'];
          res.writeHead(400, responseHeaders);
          res.end(errBody);
        });
        return;
      }

      // Caso 1: Passthrough direto (OpenRouter Anthropic nativo ou OpenAI -> OpenAI)
      if (!isAnthropicToGenericOpenAI) {
        const responseHeaders = { ...remoteRes.headers };
        delete responseHeaders['content-length'];
        res.writeHead(remoteRes.statusCode, responseHeaders);
        remoteRes.pipe(res);
        remoteRes.on('end', () => {
          log(`✅ [${providerKey}] Resposta concluída com status ${remoteRes.statusCode}`);
        });
        return;
      }

      // Caso 2: Tradução de OpenAI genérico para cliente Anthropic (ex: Claude Code)
      if (remoteRes.statusCode !== 200) {
        const responseHeaders = { ...remoteRes.headers };
        delete responseHeaders['content-length'];
        res.writeHead(remoteRes.statusCode, responseHeaders);
        remoteRes.pipe(res);
        return;
      }

      if (!isStream) {
        let rawData = '';
        remoteRes.on('data', chunk => { rawData += chunk; });
        remoteRes.on('end', () => {
          try {
            const json = JSON.parse(rawData);
            const anthropicMsg = convertOpenAIToAnthropicResponse(json, model);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(anthropicMsg));
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: `Erro ao converter resposta: ${e.message}` } }));
          }
          log(`✅ [${providerKey}] Resposta traduzida para Anthropic com sucesso`);
        });
      } else {
        // Streaming SSE: traduz chunks OpenAI para chunks Anthropic (com suporte completo a Tools)
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        const msgId = `msg_${Date.now()}`;
        res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: msgId, type: 'message', role: 'assistant', model, content: [], usage: { input_tokens: 0, output_tokens: 0 } } })}\n\n`);

        let currentBlockIndex = 0;
        let textBlockStarted = false;
        let textBlockClosed = false;
        const activeToolCalls = new Map(); // openaiIndex -> { anthropicIndex, id, name, started, closed }
        let hasToolCalls = false;
        let finishReason = null;

        // Ping periódico keep-alive durante streaming para evitar timeout no Claude Code
        const pingInterval = setInterval(() => {
          if (res.writableEnded || res.destroyed) {
            clearInterval(pingInterval);
            return;
          }
          res.write(`event: ping\ndata: ${JSON.stringify({ type: 'ping' })}\n\n`);
        }, 5000);

        res.on('close', () => {
          clearInterval(pingInterval);
          try { remoteRes.destroy(); } catch (_) {}
        });

        let buffer = '';
        remoteRes.on('data', chunk => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop(); // mantém linha incompleta no buffer

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.slice(5).trim();
            if (dataStr === '[DONE]') continue;

            try {
              const parsedChunk = JSON.parse(dataStr);
              const choice = parsedChunk.choices?.[0];
              if (!choice) continue;

              if (choice.finish_reason) {
                finishReason = choice.finish_reason;
              }

              // 1. Processar delta de texto
              const deltaText = choice.delta?.content;
              if (deltaText) {
                if (!textBlockStarted) {
                  res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: currentBlockIndex, content_block: { type: 'text', text: '' } })}\n\n`);
                  textBlockStarted = true;
                }
                res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: currentBlockIndex, delta: { type: 'text_delta', text: deltaText } })}\n\n`);
              }

              // 2. Processar delta de tool_calls
              const deltaToolCalls = choice.delta?.tool_calls;
              if (Array.isArray(deltaToolCalls) && deltaToolCalls.length > 0) {
                hasToolCalls = true;

                // Se havia bloco de texto aberto, encerra-o antes de abrir blocos de tool_use
                if (textBlockStarted && !textBlockClosed) {
                  res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: currentBlockIndex })}\n\n`);
                  textBlockClosed = true;
                  currentBlockIndex++;
                }

                for (const tc of deltaToolCalls) {
                  const oIdx = tc.index !== undefined ? tc.index : 0;
                  let toolState = activeToolCalls.get(oIdx);

                  if (!toolState) {
                    const toolBlockIndex = currentBlockIndex++;
                    toolState = {
                      anthropicIndex: toolBlockIndex,
                      id: tc.id || `call_${Date.now()}_${oIdx}`,
                      name: tc.function?.name || '',
                      started: false,
                      closed: false
                    };
                    activeToolCalls.set(oIdx, toolState);
                  }

                  if (tc.id) toolState.id = tc.id;
                  if (tc.function?.name) toolState.name = tc.function.name;

                  if (!toolState.started && toolState.name) {
                    res.write(`event: content_block_start\ndata: ${JSON.stringify({
                      type: 'content_block_start',
                      index: toolState.anthropicIndex,
                      content_block: {
                        type: 'tool_use',
                        id: toolState.id,
                        name: toolState.name,
                        input: {}
                      }
                    })}\n\n`);
                    toolState.started = true;
                  }

                  if (tc.function?.arguments) {
                    if (!toolState.started) {
                      res.write(`event: content_block_start\ndata: ${JSON.stringify({
                        type: 'content_block_start',
                        index: toolState.anthropicIndex,
                        content_block: {
                          type: 'tool_use',
                          id: toolState.id,
                          name: toolState.name || 'tool',
                          input: {}
                        }
                      })}\n\n`);
                      toolState.started = true;
                    }

                    res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                      type: 'content_block_delta',
                      index: toolState.anthropicIndex,
                      delta: {
                        type: 'input_json_delta',
                        partial_json: tc.function.arguments
                      }
                    })}\n\n`);
                  }
                }
              }
            } catch (_) {}
          }
        });

        remoteRes.on('end', () => {
          clearInterval(pingInterval);

          if (textBlockStarted && !textBlockClosed) {
            res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: currentBlockIndex })}\n\n`);
            textBlockClosed = true;
          }

          for (const toolState of activeToolCalls.values()) {
            if (toolState.started && !toolState.closed) {
              res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: toolState.anthropicIndex })}\n\n`);
              toolState.closed = true;
            }
          }

          if (!textBlockStarted && activeToolCalls.size === 0) {
            res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`);
            res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
          }

          let stopReason = 'end_turn';
          if (hasToolCalls || finishReason === 'tool_calls') {
            stopReason = 'tool_use';
          } else if (finishReason === 'length') {
            stopReason = 'max_tokens';
          } else if (finishReason === 'stop') {
            stopReason = 'end_turn';
          }

          res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 0 } })}\n\n`);
          res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
          res.end();
          log(`✅ [${providerKey}] Stream traduzido para Anthropic com sucesso`);
        });
      }
    });

    clientReq.on('timeout', () => {
      clientReq.destroy(new Error(`Timeout de 10 minutos excedido com ${providerKey}`));
    });

    clientReq.on('error', err => {
      log(`❌ [${providerKey}] Erro na conexão: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `Erro ao conectar com ${providerKey}: ${err.message}` } }));
      }
    });

    clientReq.write(postData);
    clientReq.end();
  }

  sendRemoteRequest(remotePayload);
}

const server = http.createServer((req, res) => {
  log(`➡️  ${req.method} ${req.url}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const rawUrl = (req.url || '').split('?')[0].replace(/\/+$/, ''); const url = rawUrl;

  // 1. Endpoint /v1/models (listagem unificada)
  if (req.method === 'GET' && (url === '/v1/models' || url === '/models')) {
    const models = getAvailableModels();
    log(`📋 Listando ${models.length} modelos disponíveis`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: models }));
    return;
  }

  // 2. Endpoint OpenAI Chat /v1/chat/completions OU Anthropic Messages /v1/messages
  const isAnthropic = url === '/v1/messages' || url === '/messages';
  const isOpenAIChat = url === '/v1/chat/completions' || url === '/chat/completions';

  if (req.method === 'POST' && (isOpenAIChat || isAnthropic)) {
    req.socket.setTimeout(0);
    res.setTimeout(0);
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const requestedModel = payload.model || 'ai-proxy';
        const route = resolveRoute(requestedModel);

        const apiFormat = isAnthropic ? 'anthropic' : 'openai';

        if (route.type === 'antigravity') {
          handleAntigravityChat(route.model, payload, res, apiFormat);
        } else if (route.type === 'remote') {
          handleRemoteProviderChat(route, payload, res, apiFormat);
        } else {
          handleAntigravityChat('gemini-3.8-flash-medium', payload, res, apiFormat);
        }
      } catch (err) {
        log(`❌ Erro no processamento: ${err.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: err.message, type: 'invalid_request_error' } }));
      }
    });
    return;
  }

  if (req.url === '/api/hello' || req.url?.startsWith('/api/hello')) { res.writeHead(200); res.end(); return; }
  // 3. Health check & status da rota ativa
  if (req.method === 'GET' && (url === '/health' || url === '')) {
    const config = loadConfig();
    const active = config.active || { provider: 'antigravity', model: 'gemini-3.8-flash-medium' };
    const activeProviders = ['antigravity', ...Object.keys(config.providers || {})];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      name: 'agent-proxy',
      port: PORT,
      active,
      providers: activeProviders
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Not found', code: 404 } }));
});

// Desativa limites de timeout no servidor para suportar requisições demoradas
server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 65000;
server.timeout = 0;

server.listen(PORT, HOST, () => {
  log(`🚀 agent-proxy ativo em http://${HOST}:${PORT}`);
  log(`   Endpoint OpenAI Base URL: http://${HOST}:${PORT}/v1`);
  log(`   Endpoint Anthropic Base URL: http://${HOST}:${PORT}/v1`);
});
