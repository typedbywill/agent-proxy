'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TOOL_CALL_START,
  TOOL_CALL_END,
  normalizeTools,
  renderToolsPrompt,
  validateToolCall,
  parseNonStreamResponse,
  createStreamingToolParser
} = require('../src/tool-parser');

const sampleTools = [
  {
    name: 'Read',
    description: 'Read file contents from filesystem',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string' }
      },
      required: ['file_path']
    }
  },
  {
    name: 'Write',
    description: 'Write file contents to filesystem',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        content: { type: 'string' }
      },
      required: ['file_path', 'content']
    }
  }
];

test('renderToolsPrompt includes catalogue and delimiter instructions', () => {
  const prompt = renderToolsPrompt(sampleTools);
  assert.ok(prompt.includes('# AVAILABLE TOOLS'));
  assert.ok(prompt.includes('Tool: Read'));
  assert.ok(prompt.includes('Tool: Write'));
  assert.ok(prompt.includes(TOOL_CALL_START));
  assert.ok(prompt.includes(TOOL_CALL_END));
  assert.ok(prompt.includes('Example Tool Call'));
});

test('normalizeTools works for both Anthropic and OpenAI formats', () => {
  const openAITools = [
    {
      type: 'function',
      function: {
        name: 'Bash',
        description: 'Run bash command',
        parameters: { type: 'object', properties: { command: { type: 'string' } } }
      }
    }
  ];
  const normalized = normalizeTools(openAITools);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].name, 'Bash');
  assert.equal(normalized[0].description, 'Run bash command');
  assert.deepEqual(normalized[0].input_schema, {
    type: 'object',
    properties: { command: { type: 'string' } }
  });
});

test('parseNonStreamResponse - Marcador completo com texto antes e depois', () => {
  const raw = 'Vou verificar o arquivo agora.\n<<TOOL_CALL>>{"name":"Read","input":{"file_path":"test.txt"}}<<END_TOOL_CALL>>\nPronto.';
  const res = parseNonStreamResponse(raw, sampleTools);

  assert.equal(res.hasToolCalls, true);
  assert.equal(res.toolCalls.length, 1);
  assert.equal(res.toolCalls[0].name, 'Read');
  assert.deepEqual(res.toolCalls[0].input, { file_path: 'test.txt' });
  assert.ok(res.toolCalls[0].id.startsWith('toolu_'));

  assert.equal(res.segments.length, 3);
  assert.equal(res.segments[0].type, 'text');
  assert.equal(res.segments[0].text, 'Vou verificar o arquivo agora.\n');
  assert.equal(res.segments[1].type, 'tool_use');
  assert.equal(res.segments[2].type, 'text');
  assert.equal(res.segments[2].text, '\nPronto.');
});

test('parseNonStreamResponse - Múltiplas chamadas no mesmo turno', () => {
  const raw = '<<TOOL_CALL>>{"name":"Read","input":{"file_path":"a.txt"}}<<END_TOOL_CALL>>\n' +
              '<<TOOL_CALL>>{"name":"Read","input":{"file_path":"b.txt"}}<<END_TOOL_CALL>>';
  const res = parseNonStreamResponse(raw, sampleTools);

  assert.equal(res.hasToolCalls, true);
  assert.equal(res.toolCalls.length, 2);
  assert.equal(res.toolCalls[0].input.file_path, 'a.txt');
  assert.equal(res.toolCalls[1].input.file_path, 'b.txt');
});

test('parseNonStreamResponse - JSON inválido vira texto sem quebrar', () => {
  const logged = [];
  const raw = 'Início <<TOOL_CALL>>{invalido: 123<<END_TOOL_CALL>> fim';
  const res = parseNonStreamResponse(raw, sampleTools, msg => logged.push(msg));

  assert.equal(res.hasToolCalls, false);
  assert.equal(res.toolCalls.length, 0);
  assert.equal(res.segments.length, 1);
  assert.equal(res.segments[0].type, 'text');
  assert.equal(res.segments[0].text, 'Início <<TOOL_CALL>>{invalido: 123<<END_TOOL_CALL>> fim');
  assert.ok(logged.some(m => m.includes('Chamada inválida ignorada')));
});

test('parseNonStreamResponse - Nome inexistente vira texto sem quebrar', () => {
  const logged = [];
  const raw = 'Chamando <<TOOL_CALL>>{"name":"Inexistente","input":{}}<<END_TOOL_CALL>> agora';
  const res = parseNonStreamResponse(raw, sampleTools, msg => logged.push(msg));

  assert.equal(res.hasToolCalls, false);
  assert.equal(res.segments.length, 1);
  assert.equal(res.segments[0].type, 'text');
  assert.equal(res.segments[0].text, raw);
  assert.ok(logged.some(m => m.includes('not in allowed tools')));
});

test('createStreamingToolParser - Marcador partido entre múltiplos chunks pequenos', () => {
  const receivedText = [];
  const receivedTools = [];

  const parser = createStreamingToolParser({
    tools: sampleTools,
    onText: t => receivedText.push(t),
    onToolCall: tc => receivedTools.push(tc)
  });

  // Simula chunks picados propositalmente dividindo os marcadores
  const chunks = [
    'Ola, ',
    'vou ',
    'ler ',
    '<',
    '<T',
    'OOL_',
    'CALL>>{"na',
    'me":"Read","in',
    'put":{"file_path":"/tmp/x.txt"}}<<END_',
    'TOOL_',
    'CALL>>',
    ' finalizado!'
  ];

  for (const c of chunks) {
    parser.feed(c);
  }
  parser.flush();

  const fullText = receivedText.join('');
  assert.equal(fullText, 'Ola, vou ler  finalizado!');
  assert.equal(receivedTools.length, 1);
  assert.equal(receivedTools[0].name, 'Read');
  assert.deepEqual(receivedTools[0].input, { file_path: '/tmp/x.txt' });
});

test('createStreamingToolParser - 1 caractere por chunk (stress test de stream)', () => {
  const receivedText = [];
  const receivedTools = [];

  const parser = createStreamingToolParser({
    tools: sampleTools,
    onText: t => receivedText.push(t),
    onToolCall: tc => receivedTools.push(tc)
  });

  const fullInput = 'Pré <<TOOL_CALL>>{"name":"Write","input":{"file_path":"f.txt","content":"ok"}}<<END_TOOL_CALL>> Pós';

  for (let i = 0; i < fullInput.length; i++) {
    parser.feed(fullInput[i]);
  }
  parser.flush();

  assert.equal(receivedText.join(''), 'Pré  Pós');
  assert.equal(receivedTools.length, 1);
  assert.equal(receivedTools[0].name, 'Write');
  assert.deepEqual(receivedTools[0].input, { file_path: 'f.txt', content: 'ok' });
});

test('createStreamingToolParser - Falso alarme de marcador (< ou << que não vira marcador)', () => {
  const receivedText = [];
  const receivedTools = [];

  const parser = createStreamingToolParser({
    tools: sampleTools,
    onText: t => receivedText.push(t),
    onToolCall: tc => receivedTools.push(tc)
  });

  parser.feed('se x <');
  parser.feed(' y && a <');
  parser.feed('< b entao ok');
  parser.flush();

  assert.equal(receivedText.join(''), 'se x < y && a << b entao ok');
  assert.equal(receivedTools.length, 0);
});

test('createStreamingToolParser - Stream encerra no meio de um marcador incompleto (flush)', () => {
  const receivedText = [];
  const parser = createStreamingToolParser({
    tools: sampleTools,
    onText: t => receivedText.push(t)
  });

  parser.feed('Texto antes <<TOOL_');
  parser.flush();

  assert.equal(receivedText.join(''), 'Texto antes <<TOOL_');
});

test('createStreamingToolParser - Stream encerra com marcador não fechado (flush)', () => {
  const receivedText = [];
  const parser = createStreamingToolParser({
    tools: sampleTools,
    onText: t => receivedText.push(t)
  });

  parser.feed('Texto antes <<TOOL_CALL>>{"name":"Read"');
  parser.flush();

  assert.equal(receivedText.join(''), 'Texto antes <<TOOL_CALL>>{"name":"Read"');
});

test('createStreamingToolParser - JSON inválido no stream faz fallback para texto', () => {
  const receivedText = [];
  const logged = [];
  const parser = createStreamingToolParser({
    tools: sampleTools,
    onText: t => receivedText.push(t),
    onLog: m => logged.push(m)
  });

  parser.feed('Começo <<TOOL_CALL>>{bad_json}<<END_TOOL_CALL>> fim');
  parser.flush();

  assert.equal(receivedText.join(''), 'Começo <<TOOL_CALL>>{bad_json}<<END_TOOL_CALL>> fim');
  assert.ok(logged.some(m => m.includes('Chamada inválida')));
});
