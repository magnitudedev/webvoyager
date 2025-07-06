import { readdir, readFile } from "fs/promises";
import { join } from "path";
import * as fs from "fs";

const baseResultsDir = process.env.RESULTS_DIR || "./results";
const TASKS_PATH = process.env.TASKS_PATH || "./data/patchedTasks.jsonl";

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
  try {
    const content = await readFile(TASKS_PATH, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      try {
        const task: Task = JSON.parse(line);
        if (task.id === taskId) {
          return task;
        }
      } catch (error) {
        console.error("Error parsing JSON line:", error);
      }
    }
  } catch (error) {
    console.error("Error reading tasks file:", error);
  }
  return null;
}

async function getResultsFolders(): Promise<string[]> {
  try {
    const entries = await readdir(baseResultsDir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
  } catch (error) {
    console.error("Error reading results folders:", error);
    return [];
  }
}

async function getTasksList(resultsDir: string): Promise<string[]> {
  try {
    const files = await readdir(resultsDir);
    return files
      .filter(file => file.endsWith(".json") && !file.endsWith(".eval.json"))
      .map(file => file.slice(0, -5))
      .sort();
  } catch (error) {
    console.error("Error reading tasks:", error);
    return [];
  }
}

async function getTasksSummary(resultsDir: string): Promise<Record<string, any>> {
  try {
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
        const taskData = JSON.parse(await readFile(join(resultsDir, file), "utf-8"));
        
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
        categorizedTasks[category].push({ id: taskId });
      }
    }
    
    // Sort tasks within each category
    for (const category in categorizedTasks) {
      categorizedTasks[category]!.sort((a, b) => {
        const aNum = parseInt(a.id.split("--")[1] || "0");
        const bNum = parseInt(b.id.split("--")[1] || "0");
        return aNum - bNum;
      });
    }
    
    return categorizedTasks;
  } catch (error) {
    console.error("Error getting tasks summary:", error);
    return {};
  }
}

async function getStats(resultsDir: string): Promise<any> {
  try {
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
    const avgTime = totalTasks > 0 ? totalTime / totalTasks / 1000 / 60 : 0;
    const avgTokens = totalTasks > 0 ? totalTokens / totalTasks : 0;
    
    return {
      totalTasks,
      successfulTasks,
      successRate,
      avgActions,
      avgTime,
      avgTokens,
      categoryStats
    };
  } catch (error) {
    console.error("Error getting stats:", error);
    return {
      totalTasks: 0,
      successfulTasks: 0,
      successRate: 0,
      avgActions: 0,
      avgTime: 0,
      avgTokens: 0,
      categoryStats: {}
    };
  }
}

async function getTaskData(taskName: string, resultsDir: string): Promise<any> {
  try {
    const filePath = join(resultsDir, `${taskName}.json`);
    const evalFilePath = join(resultsDir, `${taskName}.eval.json`);
    
    const data = await readFile(filePath, "utf-8");
    const parsedData = JSON.parse(data);
    
    let evalData: EvalData | null = null;
    try {
      const evalContent = await readFile(evalFilePath, "utf-8");
      evalData = JSON.parse(evalContent) as EvalData;
    } catch {
      // Eval file doesn't exist
    }
    
    const task = await findTaskById(taskName);
    
    return {
      ...parsedData,
      evaluation: evalData,
      task: task
    };
  } catch (error: any) {
    throw new Error(`Task not found: ${taskName}`);
  }
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const resultsPath = url.searchParams.get("resultsPath");
  const resultsDir = resultsPath ? join(baseResultsDir, resultsPath) : baseResultsDir;

  // Enable CORS
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers });
  }

  try {
    // API endpoints
    if (path === "/api/results-folders") {
      const folders = await getResultsFolders();
      return new Response(JSON.stringify(folders), {
        headers: { ...headers, "content-type": "application/json" },
      });
    } else if (path === "/api/tasks") {
      const tasks = await getTasksList(resultsDir);
      return new Response(JSON.stringify(tasks), {
        headers: { ...headers, "content-type": "application/json" },
      });
    } else if (path === "/api/tasks-summary") {
      const summary = await getTasksSummary(resultsDir);
      return new Response(JSON.stringify(summary), {
        headers: { ...headers, "content-type": "application/json" },
      });
    } else if (path.startsWith("/api/task/")) {
      const taskName = decodeURIComponent(path.slice(10));
      const data = await getTaskData(taskName, resultsDir);
      return new Response(JSON.stringify(data), {
        headers: { ...headers, "content-type": "application/json" },
      });
    } else if (path === "/api/stats") {
      const stats = await getStats(resultsDir);
      return new Response(JSON.stringify(stats), {
        headers: { ...headers, "content-type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404, headers });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...headers, "content-type": "application/json" },
    });
  }
}