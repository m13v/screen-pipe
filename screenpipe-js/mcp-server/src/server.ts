import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { pipe as browserPipe } from "./browser-sdk-wrapper.js";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Add at the top after imports
console.log("browser pipe operator methods:", Object.keys(browserPipe.operator));
console.log("browser pipe implementation type:", typeof browserPipe.operator.get_text);

// Define interfaces for tool inputs
interface GetTextInput {
  app: string;
  window?: string;
}

interface ClickElementInput {
  app: string;
  window?: string;
  text?: string;
  role?: string;
  label?: string;
}

interface FillTextInput {
  app: string;
  window?: string;
  text?: string;
  label?: string;
  value: string;
}

interface ListElementsInput {
  app: string;
  window?: string;
  text_only?: boolean;
  max_elements?: number;
}

// Create the server
const server = new McpServer({
  name: "computer-control-sdk",
  version: "1.0.0"
});

// Tool 1: Get text from an application
server.tool(
  "get_text",
  {
    app: z.string().describe("The application name (e.g., 'Chrome', 'Firefox')"),
    window: z.string().optional().describe("Optional window name")
  },
  async ({ app, window }: { app: string, window?: string }) => {
    console.log(`executing get_text for app: ${app}`);
    
    try {
      const result = await browserPipe.operator.get_text({
        app,
        window
      });
      
      return {
        content: [{ 
          type: "text", 
          text: result.text 
        }]
      };
    } catch (error) {
      console.error("error in get_text:", error);
      return {
        content: [{ 
          type: "text", 
          text: `failed to get text: ${error}` 
        }],
        isError: true
      };
    }
  }
);

// Tool 2: Click an element
server.tool(
  "click_element",
  {
    app: z.string().describe("The name of the application (e.g., 'Chrome', 'Firefox', 'Safari')"),
    window: z.string().optional().describe("Optional window name"),
    text: z.string().optional().describe("Text content of the element to click"),
    role: z.string().optional().describe("Role of the element (e.g., 'button', 'checkbox', 'link')"),
    label: z.string().optional().describe("Accessibility label of the element")
  },
  async (input: ClickElementInput) => {
    console.log(`executing click_element for app: ${input.app}, text: ${input.text}`);
    
    try {
      const result = await browserPipe.operator.click({
        app: input.app,
        window: input.window,
        text: input.text,
        role: input.role,
        label: input.label
      });
      
      console.log(`click result: ${JSON.stringify(result)}`);
      return {
        content: [{ 
          type: "text", 
          text: `successfully clicked element using ${result.method}` 
        }]
      };
    } catch (error) {
      console.error("error in click_element:", error);
      return {
        content: [{ 
          type: "text", 
          text: `failed to click element: ${error}` 
        }],
        isError: true
      };
    }
  }
);

// Tool 3: Fill a text field
server.tool(
  "fill_text",
  {
    app: z.string().describe("The name of the application (e.g., 'Chrome', 'Firefox', 'Safari')"),
    window: z.string().optional().describe("Optional window name"),
    text: z.string().optional().describe("Text content of the field to target"),
    label: z.string().optional().describe("Accessibility label of the field"),
    value: z.string().describe("The text to type into the field")
  },
  async (input: FillTextInput) => {
    console.log(`executing fill_text for app: ${input.app}`);
    
    try {
      const success = await browserPipe.operator.fill({
        app: input.app,
        window: input.window,
        text: input.text,
        label: input.label,
        value: input.value
      });
      
      console.log(`fill result: ${success}`);
      return {
        content: [{ 
          type: "text", 
          text: success ? `successfully entered text` : `failed to enter text` 
        }]
      };
    } catch (error) {
      console.error("error in fill_text:", error);
      return {
        content: [{ 
          type: "text", 
          text: `failed to fill text field: ${error}` 
        }],
        isError: true
      };
    }
  }
);

// Tool 4: List interactable elements
server.tool(
  "list_interactable_elements",
  {
    app: z.string().describe("The name of the application (e.g., 'Chrome', 'Firefox', 'Safari')"),
    window: z.string().optional().describe("Optional window name"),
    text_only: z.boolean().optional().describe("Only include elements with text"),
    max_elements: z.number().optional().describe("Maximum number of elements to return")
  },
  async (input: ListElementsInput) => {
    console.log(`executing list_interactable_elements for app: ${input.app}`);
    
    try {
      const result = await browserPipe.operator.get_interactable_elements({
        app: input.app,
        window: input.window,
        with_text_only: input.text_only,
        max_elements: input.max_elements
      });
      
      console.log(`found ${result.elements.length} interactable elements`);
      
      // Format the output in a readable way
      const elementList = result.elements.map(e => 
        `${e.index}: ${e.role} "${e.text}" (${e.interactability})`
      ).join('\n');
      
      return {
        content: [{ 
          type: "text", 
          text: `interactable elements in ${input.app}:\n${elementList}` 
        }]
      };
    } catch (error) {
      console.error("error in list_interactable_elements:", error);
      return {
        content: [{ 
          type: "text", 
          text: `failed to list interactable elements: ${error}` 
        }],
        isError: true
      };
    }
  }
);

// Check if this file is being run directly
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (process.argv[1] === __filename) {
  console.log("starting desktop control mcp server");
  const transport = new StdioServerTransport();
  server.connect(transport)
    .then(() => console.log("desktop control mcp server started"))
    .catch((err: Error) => console.error("server error:", err));
}