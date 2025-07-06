import { readdir, readFile } from "fs/promises";
import { join } from "path";
import * as readline from "readline";
import * as fs from "fs";

const port = 8000;
const baseResultsDir = "./results";
const TASKS_PATH = join(__dirname, "data", "patchedTasks.jsonl");

interface Task {
  web_name: string;
  id: string;
  ques: string;
  web: string;
}

interface EvalData {
  result: string;
  reasoning?: string;
}

async function findTaskById(taskId: string): Promise<Task | null> {
  const fileStream = fs.createReadStream(TASKS_PATH);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    try {
      const task: Task = JSON.parse(line);
      if (task.id === taskId) {
        return task;
      }
    } catch (error) {
      console.error("Error parsing JSON line:", error);
    }
  }
  return null;
}

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const resultsPath = url.searchParams.get("resultsPath");
    const resultsDir = resultsPath ? join(baseResultsDir, resultsPath) : baseResultsDir;

    // API endpoints
    if (path === "/api/results-folders") {
      return await getResultsFolders();
    } else if (path === "/api/tasks") {
      return await getTasksList(resultsDir);
    } else if (path === "/api/tasks-summary") {
      return await getTasksSummary(resultsDir);
    } else if (path.startsWith("/api/task/")) {
      const taskName = decodeURIComponent(path.slice(10));
      return await getTaskData(taskName, resultsDir);
    } else if (path === "/api/stats") {
      return await getStats(resultsDir);
    } else if (path === "/" || path === "") {
      // Serve the HTML file
      try {
        const html = await Bun.file("./viewer.html").text();
        return new Response(html, {
          headers: { "content-type": "text/html" },
        });
      } catch {
        return new Response("visualizer.html not found", { status: 404 });
      }
    }

    return new Response("Not found", { status: 404 });
  },
});

async function getResultsFolders(): Promise<Response> {
  try {
    const entries = await readdir(baseResultsDir, { withFileTypes: true });
    const folders = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
    
    return new Response(JSON.stringify(folders), {
      headers: { "content-type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

async function getTasksList(resultsDir: string): Promise<Response> {
  try {
    // Check if directory exists
    try {
      await readdir(resultsDir);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return new Response(JSON.stringify([]), {
          headers: { "content-type": "application/json" },
        });
      }
      throw error;
    }
    
    const files = await readdir(resultsDir);
    const tasks = files
      .filter(file => file.endsWith(".json") && !file.endsWith(".eval.json"))
      .map(file => file.slice(0, -5)) // Remove .json extension
      .sort();
    
    return new Response(JSON.stringify(tasks), {
      headers: { "content-type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

async function getTasksSummary(resultsDir: string): Promise<Response> {
  try {
    // Check if directory exists
    try {
      await readdir(resultsDir);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return new Response(JSON.stringify({}), {
          headers: { "content-type": "application/json" },
        });
      }
      throw error;
    }
    
    const files = await readdir(resultsDir);
    const taskFiles = files.filter(file => file.endsWith(".json") && !file.endsWith(".eval.json"));
    
    const categorizedTasks: Record<string, Array<{
      id: string;
      success?: boolean;
      time?: number;
      tokens?: number;
      actions?: number;
    }>> = {};
    
    for (const file of taskFiles) {
      const taskId = file.slice(0, -5);
      const category = taskId.split("--")[0]!;
      
      if (!categorizedTasks[category]) {
        categorizedTasks[category] = [];
      }
      
      try {
        // Read task data
        const taskData = JSON.parse(await readFile(join(resultsDir, file), "utf-8"));
        
        // Try to read eval data
        let evalData: EvalData | null = null;
        try {
          const evalContent = await readFile(join(resultsDir, `${taskId}.eval.json`), "utf-8");
          evalData = JSON.parse(evalContent) as EvalData;
        } catch {
          // No eval data
        }
        
        categorizedTasks[category].push({
          id: taskId,
          success: evalData ? evalData.result === "SUCCESS" : undefined,
          time: taskData.time,
          tokens: (taskData.totalInputTokens || 0) + (taskData.totalOutputTokens || 0),
          actions: taskData.actionCount
        });
      } catch (error) {
        console.error(`Error processing ${taskId}:`, error);
        categorizedTasks[category].push({
          id: taskId
        });
      }
    }
    
    // Sort tasks within each category by numeric suffix
    for (const category in categorizedTasks) {
      categorizedTasks[category]!.sort((a, b) => {
        const aNum = parseInt(a.id.split("--")[1] || "0");
        const bNum = parseInt(b.id.split("--")[1] || "0");
        return aNum - bNum;
      });
    }
    
    return new Response(JSON.stringify(categorizedTasks), {
      headers: { "content-type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

async function getTaskData(taskName: string, resultsDir: string): Promise<Response> {
  try {
    const filePath = join(resultsDir, `${taskName}.json`);
    const evalFilePath = join(resultsDir, `${taskName}.eval.json`);
    
    const data = await readFile(filePath, "utf-8");
    const parsedData = JSON.parse(data);
    
    // Try to read evaluation data if it exists
    let evalData: EvalData | null = null;
    try {
      const evalContent = await readFile(evalFilePath, "utf-8");
      evalData = JSON.parse(evalContent) as EvalData;
    } catch {
      // Eval file doesn't exist, that's okay
    }
    
    // Get task information
    const task = await findTaskById(taskName);
    
    // Combine task data with eval data and task info
    const combinedData = {
      ...parsedData,
      evaluation: evalData,
      task: task
    };
    
    return new Response(JSON.stringify(combinedData), {
      headers: { "content-type": "application/json" },
    });
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return new Response(JSON.stringify({ error: `Task not found: ${taskName}` }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

async function getStats(resultsDir: string): Promise<Response> {
  try {
    // Check if directory exists
    try {
      await readdir(resultsDir);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return new Response(JSON.stringify({
          totalTasks: 0,
          successfulTasks: 0,
          successRate: 0,
          avgActions: 0,
          avgTime: 0,
          avgTokens: 0,
          categoryStats: {}
        }), {
          headers: { "content-type": "application/json" },
        });
      }
      throw error;
    }
    
    const files = await readdir(resultsDir);
    const evalFiles = files.filter(f => f.endsWith(".eval.json"));
    
    let totalTasks = 0;
    let successfulTasks = 0;
    let totalActions = 0;
    let totalTime = 0;
    let totalTokens = 0;
    
    const categoryStats: Record<string, { total: number; success: number }> = {};
    
    for (const evalFile of evalFiles) {
      const taskId = evalFile.replace(".eval.json", "");
      const category = taskId.split("--")[0]!;
      const evalPath = join(resultsDir, evalFile);
      const resultPath = join(resultsDir, `${taskId}.json`);
      
      try {
        const evalData = JSON.parse(await readFile(evalPath, "utf-8")) as EvalData;
        const isSuccess = evalData.result === "SUCCESS";
        
        totalTasks++;
        if (isSuccess) successfulTasks++;
        
        if (!categoryStats[category]) {
          categoryStats[category] = { total: 0, success: 0 };
        }
        categoryStats[category].total++;
        if (isSuccess) categoryStats[category].success++;
        
        // Get task data for additional stats
        if (fs.existsSync(resultPath)) {
          const taskData = JSON.parse(await readFile(resultPath, "utf-8"));
          totalActions += taskData.actionCount || 0;
          totalTime += taskData.time || 0;
          totalTokens += (taskData.totalInputTokens || 0) + (taskData.totalOutputTokens || 0);
        }
      } catch (error) {
        console.error(`Error processing ${evalFile}:`, error);
      }
    }
    
    const successRate = totalTasks > 0 ? (successfulTasks / totalTasks) * 100 : 0;
    const avgActions = totalTasks > 0 ? totalActions / totalTasks : 0;
    const avgTime = totalTasks > 0 ? totalTime / totalTasks / 1000 / 60 : 0; // in minutes
    const avgTokens = totalTasks > 0 ? totalTokens / totalTasks : 0;
    
    return new Response(JSON.stringify({
      totalTasks,
      successfulTasks,
      successRate,
      avgActions,
      avgTime,
      avgTokens,
      categoryStats
    }), {
      headers: { "content-type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

console.log(`WebVoyager visualizer server running at http://localhost:${port}`);
console.log("Available results folders will be listed in the UI");
console.log("Press Ctrl+C to stop the server");