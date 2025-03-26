import { desktopClient } from './start-here';
import Anthropic from "@anthropic-ai/sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages";

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Use the correct type from Anthropic SDK
let conversationHistory: {role: "user" | "assistant"; content: any}[] = [];

export async function processUserQuery(query: string, maxTokens = 1000000, maxIterations = 100) {
  // Get available tools
  const toolsResponse = await desktopClient.listTools();
  const tools = toolsResponse.tools.map(tool => ({
    name: tool.name,
    description: tool.description || "",
    input_schema: tool.inputSchema
  }));
  
  // Add new user message with correct literal type
  conversationHistory.push({ 
    role: "user" as const, 
    content: query 
  });
  
  // Implement proper agent loop
  let isProcessing = true;
  let finalResponse = "";
  let totalTokensUsed = 0;
  let iterations = 0;
  
  console.log("starting agent loop with query:", query);
  
  while (isProcessing) {
    // Safety check - prevent infinite loops or excessive token usage
    iterations++;
    if (iterations > maxIterations) {
      console.log(`reached maximum iterations (${maxIterations}), stopping loop`);
      finalResponse += "\n[maximum iterations reached. process stopped.]";
      break;  
    }
    
    if (totalTokensUsed > maxTokens) {
      console.log(`exceeded maximum token limit (${maxTokens}), stopping loop`);
      finalResponse += "\n[maximum token limit reached. process stopped.]";
      break;
    }
    
    // Call Claude with tools and history
    const response = await anthropic.messages.create({
      model: "claude-3-7-sonnet-20250219",
      max_tokens: 1024,
      messages: conversationHistory,
      tools,
    });
    
    // Track token usage
    totalTokensUsed += response.usage.output_tokens + response.usage.input_tokens;
    console.log(`iteration ${iterations}: total tokens used: ${totalTokensUsed}`);
    
    // Add Claude's response to conversation history
    conversationHistory.push({
      role: "assistant" as const,
      content: response.content
    });
    
    // Check if any tool calls were made
    let hasToolCalls = false;
    let toolResultContent = [];
    
    for (const content of response.content) {
      if (content.type === "text") {
        finalResponse += content.text;
      } else if (content.type === "tool_use") {
        hasToolCalls = true;
        // Extract tool call information
        const toolName = content.name;
        const toolArgs = content.input;
        
        // Execute the tool via MCP
        try {
          const result = await desktopClient.callTool(toolName, toolArgs as Record<string, any>);
          
          // Format tool result for conversation history
          // Convert object results to strings to match Anthropic's API requirements
          const resultContent = typeof result === 'object' ? 
            JSON.stringify(result) : 
            String(result);
          
          toolResultContent.push({
            type: "tool_result",
            tool_use_id: content.id,
            content: resultContent
          });
          
        } catch (error) {
          // Add error result as string
          toolResultContent.push({
            type: "tool_result",
            tool_use_id: content.id,
            content: `Error: ${error}`,
            is_error: true
          });
        }
      }
    }
    
    // If tools were used, add results to history and continue loop
    if (hasToolCalls) {
      conversationHistory.push({
        role: "user" as const,
        content: toolResultContent
      });
      console.log("added tool results, continuing agent loop");
    } else {
      // No tools used, we're done
      isProcessing = false;
      console.log("agent loop complete, no more tool calls");
    }
  }
  
  return finalResponse;
}
