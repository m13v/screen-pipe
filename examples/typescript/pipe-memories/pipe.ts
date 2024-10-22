import * as fs from "fs";
import * as path from "path";
import * as process from "process";
import { z } from "zod";
import axios from "axios";
import { pipe, queryScreenpipe, loadPipeConfig, ContentItem } from "screenpipe";
import { generateObject, generateText } from "ai";
import { createOllama } from "ollama-ai-provider";
import { deduplicateData } from './deduplicate-pipe.ts';

interface DailyLog {
  activity: string;
  category: string;
  tags: string[];
  timestamp: string;
}

const dailyLog = z.object({
  activity: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
});


function saveDailyLog(logEntry: DailyLog): void {
  console.log("creating logs dir");
  const logsDir = `${process.env.PIPE_DIR}/logs`;
  console.log("logs dir:", logsDir);
  
  // Ensure the logs directory exists
  fs.mkdirSync(logsDir, { recursive: true });
  
  console.log("saving log entry:", logEntry);
  console.log("logs dir:", logsDir);
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\..+/, "");
  const filename = `${timestamp}-${logEntry.category.replace("/", "-")}.json`;
  console.log("filename:", filename);
  fs.writeFileSync(`${logsDir}/${filename}`, JSON.stringify(logEntry, null, 2));
}

async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delay: number = 3000
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      console.log(`attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("this should never happen");
}

async function callLlama(prompt: string, context: string, model: string, apiUrl: string, expectJson: boolean): Promise<string> {
  const fullPrompt = `${context}\n\n${prompt}`;

  try {
    const response = await fetch(`${apiUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        prompt: fullPrompt,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.response;
  } catch (error) {
    console.error("error calling llama:", error);
    throw error;
  }
}

async function callAI(prompt: string, context: string, expectJson: boolean): Promise<string> {
  const client = axios.create();

  const messages = [
    {
      role: "system",
      content: context
    },
    {
      role: "user",
      content: prompt
    }
  ];

  const body: any = {
    model: "gpt-4o",
    messages: messages,
    temperature: 0.2
  };

  if (expectJson) {
    body.response_format = { type: "json_object" };
  }

  try {
    const response = await client.post("https://ai-proxy.i-f9f.workers.dev/v1/chat/completions", body);
    const data = response.data;

    if (data.error) {
      throw new Error(data.error.message || "Unknown error");
    }

    const content = data.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Failed to extract content from response");
    }

    if (expectJson) {
      const jsonValue = JSON.parse(content);
      if (Array.isArray(jsonValue.response)) {
        return jsonValue.response.join("\n");
      } else if (typeof jsonValue.response === "string") {
        return jsonValue.response;
      } else {
        return content;
      }
    } else {
      return content;
    }
  } catch (error) {
    console.error("Error calling AI:", error);
    throw error;
  }
}

async function getUserContent(
  screenData: ContentItem[],
  // ollamaModel: string,
  // ollamaApiUrl: string,
  gptModel: string,
  searchKeyword: string
): Promise<string> {
  const prompt = `based on this content, identify the user's ${searchKeyword}:

    ${JSON.stringify(screenData)}

    VERY IMPORTANT: return only value for "${searchKeyword}", nothing else.
    If there is no proper response, return "N/A"`;

  const context = `You are an assistant tasked to identify user data from screen data. the screen data includes varous applications, browser history, messenger apps`;
  
  try {
    const response = await callAI(prompt, context, false);
    // const response = await callLlama(prompt, context, ollamaModel, ollamaApiUrl, false);
    return response.trim();
  } catch (error) {
    console.error("Error calling Llama:", error);
    throw error;
  }
}

function getTodayLogs(): DailyLog[] {
  try {
    const logsDir = `${process.env.PIPE_DIR}/logs`;
    const today = new Date().toISOString().replace(/:/g, "-").split("T")[0]; // Get today's date in YYYY-MM-DD format

    console.log("reading logs dir:", logsDir);
    const files = fs.readdirSync(logsDir);
    console.log("files:", files);
    const todayFiles = files.filter((file) => file.startsWith(today));
    console.log("today's files:", todayFiles);

    const logs: DailyLog[] = [];
    for (const file of todayFiles) {
      const content = fs.readFileSync(`${logsDir}/${file}`, "utf8");
      logs.push(JSON.parse(content));
    }

    return logs;
  } catch (error) {
    console.warn("error getting today's logs:", error);
    return [];
  }
}

async function userContentPipeline(): Promise<void> {
  console.log("Current working directory:", process.cwd());

  console.log("starting user content pipeline");

  let config;
  try {
    config = await loadPipeConfig();
  } catch (error) {
    console.warn("error loading pipe.json:", error);
    config = {}; // use default empty config if file doesn't exist
  }
  console.log("loaded config:", JSON.stringify(config, null, 2));

  const interval = (config.interval || 60) * 1000; // default to 60 seconds if not set
  const summaryFrequency = config.summaryFrequency || "daily";
  const customPrompt = config.customPrompt || "";
  const gptModel = config.gptModel || "gpt-4o";
  const pageSize = config.pageSize || 20;
  const contentType = config.contentType || "all";
  const ollamaModel = config.ollamaModel || "llama3.1:70b";
  const ollamaApiUrl = config.ollamaApiUrl || "http://localhost:11434";
  const similarityThreshold = config.similarityThreshold || 0.1;

  console.log("interval:", interval);

  // load memories-queries-prompts.json
  let memoriesQueriesPrompts;
  let memoriesFilePath;
  try {
    const pipeDir = process.env.PIPE_DIR;
    if (pipeDir) {
      memoriesFilePath = path.join(pipeDir, "memories-queries-prompts.json");
      memoriesQueriesPrompts = JSON.parse(fs.readFileSync(memoriesFilePath, "utf8"));
    } else {
      throw new Error("PIPE_DIR not set");
    }
  } catch (error) {
    console.warn("error loading memories-queries-prompts.json from PIPE_DIR:", error);
    try {
      memoriesFilePath = path.join("examples", "typescript", "pipe-memories", "memories-queries-prompts.json");
      memoriesQueriesPrompts = JSON.parse(fs.readFileSync(memoriesFilePath, "utf8"));
      console.log("loaded memories-queries-prompts.json from fallback location");
    } catch (fallbackError) {
      console.error("error loading memories-queries-prompts.json from fallback location:", fallbackError);
      throw new Error("failed to load memories-queries-prompts.json from both locations");
    }
  }

  // schedule regular log generation
  pipe.scheduler
    .task("generateLog")
    .every(interval)
    .do(async () => {
      for (const category in memoriesQueriesPrompts) {
        for (const searchKeyword in memoriesQueriesPrompts[category]) {
          const searchQueries = memoriesQueriesPrompts[category][searchKeyword].search_queries;
          // const appsAndWindows = memoriesQueriesPrompts[category][searchKeyword].apps_and_windows;

          for (const searchTerm in searchQueries) {
            console.log(`querying screenpipe for '${searchTerm}' with keyword: ${searchKeyword}`);

            try {
              const screenData = await queryScreenpipe({
                q: searchKeyword, // Use searchKeyword in the query
                limit: pageSize,
                contentType: contentType,
                offset: 0,
                // appName: appsAndWindows.join(","), // Commented out as requested
              });

              if (screenData && screenData.data && screenData.data.length > 0) {
                console.log("search results:");
                screenData.data.forEach((item, index) => {
                  if (item && typeof item === 'object' && item.content) {
                    console.log(`result ${index + 1}:`);
                    console.log(`  length: ${(item.content.text || item.content.transcription || '').length}`);
                    console.log(`  app_name: ${item.content.appName || 'N/A'}`);
                    console.log(`  windowName: ${item.content.windowName || 'N/A'}`);
                    console.log(`  timestamp: ${item.content.timestamp || 'N/A'}`);
                    console.log(`  content_type: ${item.type || 'N/A'}`);
                    console.log("---");
                  } else {
                    console.log(`result ${index + 1}: invalid data structure`);
                  }
              
                });
                const deduplicatedData = await deduplicateData(screenData.data, similarityThreshold);

                try {
                  const resultDeduplicated = await getUserContent(
                    deduplicatedData,
                    gptModel,
                    // ollamaModel,
                    // ollamaApiUrl,
                    searchTerm // Use searchTerm here
                  );
                  console.log(`identified ${searchKeyword} (deduplicated):`, resultDeduplicated);

                  // Compare results with original data IF NEEDED
                  // const resultOriginal = await getUserContent(
                  //   screenData.data,
                  //   gptModel,
                  //   searchTerm
                  // );
                  // console.log(`identified ${searchKeyword} (original):`, resultOriginal);

                  // save the result (you can choose which one to save, or save both)
                  // saveDailyLog({
                  //   activity: `identified ${searchKeyword}`,
                  //   category: category,
                  //   tags: [searchKeyword, searchTerm],
                  //   timestamp: new Date().toISOString(),
                  // });

                  // Write the updated object back to the file
                  // Update the memories-queries-prompts object with the result
                  memoriesQueriesPrompts[category][searchKeyword].search_queries[searchTerm] = resultDeduplicated;
                  fs.writeFileSync(memoriesFilePath, JSON.stringify(memoriesQueriesPrompts, null, 2));
                  console.log(`updated ${searchKeyword} in memories-queries-prompts.json`);
                  
                } catch (error) {
                  console.error("error processing screen data:", error);
                }
              } else {
                console.log("no search results found");
              }
            } catch (error) {
              console.error("error querying screenpipe:", error);
            }
          }
        }
      }
    });

  // Schedule summary generation and email sending
  // if (summaryFrequency === "daily") {
  //   pipe.scheduler
  //     .task("dailySummary")
  //     .every("1 day")
  //     .at("00:00") // At midnight
  //     .do(async () => {
  //       await generateAndSendSummary();
  //     });
  // } else if (summaryFrequency.startsWith("hourly:")) {
  //   const hours = parseInt(summaryFrequency.split(":")[1], 10);
  //   pipe.scheduler
  //     .task("hourlySummary")
  //     .every(`${hours} hours`)
  //     .do(async () => {
  //       await generateAndSendSummary();
  //     });
  // }

  // Add a new task to send a daily start notification
  pipe.scheduler
    .task("dailyStartNotification")
    .every("1 day")
    .at("00:01") // Just after midnight
    .do(async () => {
      await pipe.inbox.send({
        title: "Daily Log Started",
        body: "A new day of activity logging has begun. Your summary will be sent later as scheduled.",
        actions: [
          {
            label: "View Yesterday's Summary",
            action: "view_yesterday_summary",
          },
          {
            label: "Dismiss",
            action: "dismiss",
          },
        ],
      });
    });

  // Start the scheduler
  pipe.scheduler.start();
}

userContentPipeline();
