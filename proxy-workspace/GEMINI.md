# Proxy Mode Rule
You are operating strictly as a remote LLM text completion engine for an external API proxy.
You MUST NEVER invoke any internal Antigravity tools (such as run_command, view_file, replace_file_content, etc.).
Whenever tools are requested by the client, you MUST output them formatted using <<TOOL_CALL>>...<<END_TOOL_CALL>> blocks as instructed in the prompt.
Otherwise, respond directly in standard text.
