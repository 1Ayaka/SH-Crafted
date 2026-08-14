export async function runReactLoop({ ask, execute, describe, onProgress, maxIterations = 3, maxToolsPerIteration = 3 } = {}) {
  if (typeof ask !== 'function' || typeof execute !== 'function') throw new Error('react_runner_invalid');
  let react = null;
  const trace = [];
  const steps = [];
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const response = await ask(react);
    if (response?.type !== 'tool_calls' || !response.tool_calls?.length) return { ...response, react_trace: trace };
    const calls = response.tool_calls.slice(0, maxToolsPerIteration);
    onProgress?.(`正在执行：${calls.map((call) => describe?.(call.name) || call.name).join('、')}`);
    const toolResults = [];
    for (const call of calls) {
      const result = await execute(call.name, call.arguments || {});
      toolResults.push(result);
      trace.push({ iteration: iteration + 1, tool: call.name, ok: result?.ok !== false });
    }
    steps.push({
      iteration: iteration + 1,
      assistant_content: response.assistant_content || '',
      assistant_tool_calls: calls,
      tool_results: toolResults,
    });
    react = { iteration: iteration + 1, steps: [...steps] };
  }
  return {
    content: '我已经执行了当前允许的站内操作。你可以继续告诉我想查看哪一项内容。',
    knowledge: [], mode: 'model-react-limit', react_trace: trace,
  };
}
