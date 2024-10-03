interface DailyLog {
  activity: string;
  category: string;
  tags: string[];
  timestamp: string;
}

async function generateDailyLog(
  screenData: ContentItem[],
  dailylogPrompt: string,
  gptModel: string,
  gptApiUrl: string,
  openaiApiKey: string
): Promise<DailyLog> {
  const prompt = `${dailylogPrompt}

    Based on the following screen data, generate a concise daily log entry:

    ${JSON.stringify(screenData)}

    Return a JSON object with the following structure:
    {
        "activity": "Brief description of the activity",
        "category": "Category of the activity like work, email, slack, etc"
        "tags": ["productivity", "work", "email", "john", "salesforce", "etc"]
    }
        
    
    Rules:
    - Do not add backticks to the JSON eg \`\`\`json\`\`\` is WRONG
    - DO NOT RETURN ANYTHING BUT JSON. NO COMMENTS BELOW THE JSON.
        
    `;

  const response = await fetch(gptApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: gptModel,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    console.log("gpt response:", await response.text());
    throw new Error(`http error! status: ${response.status}`);
  }

  const result = await response.json();

  console.log("ai answer:", result);
  // clean up the result
  const cleanedResult = result.choices[0].message.content
    .trim()
    .replace(/^```(?:json)?\s*|\s*```$/g, "") // remove start and end code block markers
    .replace(/\n/g, "") // remove newlines
    .replace(/\\n/g, "") // remove escaped newlines
    .trim(); // trim any remaining whitespace

  let content;
  try {
    content = JSON.parse(cleanedResult);
  } catch (error) {
    console.warn("failed to parse ai response:", error);
    console.warn("cleaned result:", cleanedResult);
    throw new Error("invalid ai response format");
  }

  return content;
}

async function saveDailyLog(logEntry: DailyLog): Promise<void> {
  console.log("creating logs dir");
  const logsDir = `${process.env.PIPE_DIR}/logs`;
  console.log("logs dir:", logsDir);
  console.log("saving log entry:", logEntry);
  console.log("logs dir:", logsDir);
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\..+/, "");
  const filename = `${timestamp}-${logEntry.category.replace("/", "-")}.json`;
  console.log("filename:", filename);
  await fs.writeFile(
    `${logsDir}/${filename}`,
    JSON.stringify(logEntry, null, 2)
  );
}

async function generateRedditKeywords(
  screenData: ContentItem[],
  customPrompt: string,
  gptModel: string,
  gptApiUrl: string,
  openaiApiKey: string
): Promise<string[]> {
  const prompt = `${customPrompt}

  based on the following screen data, generate a list of 1-2 word keyword searches for finding relevant reddit threads:

  ${JSON.stringify(screenData)}

  rules:
  - be specific and concise
  - return a list of 1-2 word keyword searches, one per line
  - focus on topics that would be interesting to discuss on reddit
  - avoid very personal or sensitive information
  `;

  console.log("reddit keywords prompt:", prompt);
  const response = await fetch(gptApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: gptModel,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    console.log("gpt response:", await response.text());
    throw new Error(`http error! status: ${response.status}`);
  }

  const result = await response.json();
  console.log("ai reddit keywords:", result);

  const content = result.choices[0].message.content;
  return content.split('\n').map(keyword => keyword.trim()).filter(Boolean);
}

async function searchReddit(keyword: string): Promise<string> {
  const encodedKeyword = encodeURIComponent(keyword);
  const url = `https://www.reddit.com/search.json?q=${encodedKeyword}&limit=10&sort=relevance`;
  
  const response = await fetch(url, {
    headers: {
      "User-Agent": "MyBot/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`http error! status: ${response.status}`);
  }

  const data = await response.json();
  let result = `search results for "${keyword}":\n\n`;

  data.data.children.forEach((post: any, index: number) => {
    result += `${index + 1}. ${post.data.title}\n`;
    result += `   subreddit: r/${post.data.subreddit}\n`;
    result += `   url: https://www.reddit.com${post.data.permalink}\n\n`;
  });

  return result;
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

async function sendEmail(
  to: string,
  password: string,
  subject: string,
  body: string
): Promise<void> {
  const from = to; // assuming the sender is the same as the recipient
  await retry(async () => {
    const result = await pipe.sendEmail({
      to,
      from,
      password,
      subject,
      body,
    });
    if (!result) {
      throw new Error("failed to send email");
    }
    console.log(`email sent to ${to} with subject: ${subject}`);
  });
}

async function getTodayLogs(): Promise<DailyLog[]> {
  try {
    const logsDir = `${process.env.PIPE_DIR}/logs`;
    const today = new Date().toISOString().replace(/:/g, "-").split("T")[0]; // Get today's date in YYYY-MM-DD format

    console.log("reading logs dir:", logsDir);
    const files = await fs.readdir(logsDir);
    console.log("files:", files);
    const todayFiles = files.filter((file) => file.startsWith(today));
    console.log("today's files:", todayFiles);

    const logs: DailyLog[] = [];
    for (const file of todayFiles) {
      const content = await fs.readFile(`${logsDir}/${file}`);
      logs.push(JSON.parse(content));
    }

    return logs;
  } catch (error) {
    console.warn("error getting today's logs:", error);
    return [];
  }
}

async function dailyLogPipeline(): Promise<void> {
  console.log("starting daily log pipeline");

  const config = await pipe.loadConfig();
  console.log("loaded config:", JSON.stringify(config, null, 2));

  const interval = config.interval * 1000;
  const summaryFrequency = config.summaryFrequency;
  const emailTime = config.emailTime;
  const emailAddress = config.emailAddress;
  const emailPassword = config.emailPassword;
  const customPrompt = config.customPrompt!;
  const dailylogPrompt = config.dailylogPrompt!;
  const gptModel = config.gptModel;
  const gptApiUrl = config.gptApiUrl;
  const openaiApiKey = config.openaiApiKey;
  const windowName = config.windowName || "";
  const pageSize = config.pageSize;
  const contentType = config.contentType || "ocr"; // Default to 'ocr' if not specified

  console.log("creating logs dir");
  const logsDir = `${process.env.PIPE_DIR}/logs`;
  console.log("logs dir:", logsDir);
  await fs.mkdir(logsDir).catch((error) => {
    console.warn("error creating logs dir:", error);
  });

  let lastEmailSent = new Date(0); // Initialize to a past date

  // send a welcome email to announce what will happen, when it will happen, and what it will do
  const welcomeEmail = `
    Welcome to the daily reddit questions pipeline!

    This pipe will send you a daily list of reddit questions based on your screen data.
    ${
      summaryFrequency === "daily"
        ? `It will run at ${emailTime} every day.`
        : `It will run every ${summaryFrequency} hours.`
    }
    
  `;
  await sendEmail(
    emailAddress,
    emailPassword,
    "daily reddit questions",
    welcomeEmail
  );

  while (true) {
    try {
      const now = new Date();
      const oneMinuteAgo = new Date(now.getTime() - interval);

      const screenData = await pipe.queryScreenpipe({
        start_time: oneMinuteAgo.toISOString(),
        end_time: now.toISOString(),
        window_name: windowName,
        limit: pageSize,
        content_type: contentType,
      });

      if (screenData && screenData.data && screenData.data.length > 0) {
        const logEntry = await generateDailyLog(
          screenData.data,
          dailylogPrompt,  // Use dailylogPrompt here instead of customPrompt
          gptModel,
          gptApiUrl,
          openaiApiKey
        );
        console.log("log entry:", logEntry);
        await saveDailyLog(logEntry);
      }

      let shouldSendSummary = false;

      if (summaryFrequency === "daily") {
        const [emailHour, emailMinute] = emailTime.split(":").map(Number);
        const emailTimeToday = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          emailHour,
          emailMinute
        );
        shouldSendSummary =
          now >= emailTimeToday &&
          now.getTime() - lastEmailSent.getTime() > 24 * 60 * 60 * 1000;
      } else if (summaryFrequency.startsWith("hourly:")) {
        const hours = parseInt(summaryFrequency.split(":")[1], 10);
        shouldSendSummary =
          now.getTime() - lastEmailSent.getTime() >= hours * 60 * 60 * 1000;
      }

      if (shouldSendSummary) {
        const screenData = await pipe.queryScreenpipe({
          start_time: oneMinuteAgo.toISOString(),
          end_time: now.toISOString(),
          window_name: windowName,
          limit: pageSize,
          content_type: contentType,
        });

        if (screenData && screenData.data && screenData.data.length > 0) {
          const keywords = await generateRedditKeywords(
            screenData.data,
            customPrompt,
            gptModel,
            gptApiUrl,
            openaiApiKey
          );
          console.log("reddit keywords:", keywords);

          let emailBody = "reddit search results:\n\n";
          for (const keyword of keywords) {
            const searchResults = await searchReddit(keyword);
            emailBody += searchResults + "\n";
          }

          await sendEmail(
            emailAddress,
            emailPassword,
            "reddit search results",
            emailBody
          );
          lastEmailSent = now;
        }
      }
    } catch (error) {
      console.warn("error in daily log pipeline:", error);
    }
    console.log("sleeping for", interval, "ms");
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

dailyLogPipeline();