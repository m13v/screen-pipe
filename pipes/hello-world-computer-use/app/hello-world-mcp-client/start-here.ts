import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import Anthropic from "@anthropic-ai/sdk";

// simple logging utility with colors for better readability
const log = {
  info: (msg: string, ...args: any[]) => console.log(`\x1b[36m[info]\x1b[0m ${msg}`, ...args), 
  success: (msg: string, ...args: any[]) => console.log(`\x1b[32m[success]\x1b[0m ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`\x1b[31m[error]\x1b[0m ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => console.log(`\x1b[33m[warn]\x1b[0m ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.log(`\x1b[90m[debug]\x1b[0m ${msg}`, ...args),
  tool: (name: string, result: any) => {
    const truncateJSON = (obj: any, maxLength = 500): string => {
      const str = JSON.stringify(obj);
      if (str.length <= maxLength) return str;
      return str.substring(0, maxLength) + '... [truncated]';
    };
    
    if (result?.isError) {
      console.log(`\x1b[31m[tool ${name}]\x1b[0m ${truncateJSON(result)}`);
    } else {
      console.log(`\x1b[32m[tool ${name}]\x1b[0m ${truncateJSON(result)}`);
    }
  }
};

class DesktopControlClient {
  private client: Client | null = null;
  private anthropic = new Anthropic();
  
  // Connect to the MCP server via stdio
  async connect(command: string, args: string[] = []) {
    log.info(`connecting to mcp server: ${command} ${args.join(' ')}`);
    
    try {
      const transport = new StdioClientTransport({
        command,
        args
      });
      
      this.client = new Client(
        {
          name: "desktop-control-client",
          version: "1.0.0"
        },
        {
          capabilities: {
            prompts: {},
            resources: {},
            tools: {}
          }
        }
      );
      
      await this.client.connect(transport);
      log.success('mcp client session established successfully');
      return true;
    } catch (error) {
      log.error('failed to establish mcp client session:', error);
      return false;
    }
  }
  
  // Check if connected
  isConnected(): boolean {
    return this.client !== null;
  }
  
  // List available resources
  async listResources() {
    if (!this.client) {
      log.error('cannot list resources: not connected');
      throw new Error('Not connected to MCP server');
    }
    
    try {
      const resources = await this.client.listResources();
      log.info('available resources:', resources);
      return resources;
    } catch (error) {
      log.error('failed to list resources:', error);
      throw error;
    }
  }
  
  // List available tools
  async listTools() {
    if (!this.client) {
      log.error('cannot list tools: not connected');
      throw new Error('Not connected to MCP server');
    }
    
    try {
      const tools = await this.client.listTools();
      
      // Create simplified view - one line per tool
      const simplifiedTools = tools.tools.map(tool => {
        const propertyNames = Object.keys(tool.inputSchema.properties || {}).join(', ');
        return `${tool.name}: ${propertyNames}`;
      });
      
      // Log the simplified format
      log.info('available tools:');

      simplifiedTools.forEach(toolInfo => log.debug(`- ${toolInfo}`));
      
      return tools; // Still return full data for programmatic use
    } catch (error) {
      log.error('failed to list tools:', error);
      throw error;
    }
  }
  
  // Call a tool
  async callTool(name: string, args: Record<string, any>) {
    if (!this.client) {
      log.error('cannot call tool: not connected');
      throw new Error('Not connected to MCP server');
    }
    
    log.info(`calling tool "${name}" with args: ${JSON.stringify(args)}`);
    
    try {
      const result = await this.client.callTool({
        name,
        arguments: args
      });
      // truncate long results for better logging
      const truncateJSON = (obj: any, maxLength = 500): string => {
        const str = JSON.stringify(obj);
        if (str.length <= maxLength) return str;
        return str.substring(0, maxLength) + '... [truncated]';
      };
      log.tool(name, result);
      return result;
    } catch (error) {
      log.error(`error calling tool "${name}":`, error);
      throw error;
    }
  }
  
  // Disconnect from the server
  async disconnect() {
    if (this.client) {
      try {
        await this.client.close();
        log.success('mcp client session closed');
      } catch (error) {
        log.error('error closing mcp client session:', error);
      } finally {
        this.client = null;
      }
    }
  }
}

// Export an instance that can be used throughout your application
export const desktopClient = new DesktopControlClient();
