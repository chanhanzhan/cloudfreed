import express from "express";
import CloudFreed from "./CloudFreed.js";
import Queue from "better-queue";
import path from "path";
import { fileURLToPath } from "url";

const validTypes = [
  "CloudflareChallenge",
  "Turnstile",
  "CloudflareInvisible",
  "RecaptchaInvisible",
];

class Server {
  constructor(config) {
    // Initialize class properties
    this.instances = [];
    this.currentInstanceIndex = 0;
    this.taskResults = new Map();
    
    // Get current file's directory
    const __filename = fileURLToPath(import.meta.url);
    this.__dirname = path.dirname(__filename);
    
    // Configuration
    this.clientKey = config.clientKey;
    this.maxConcurrentTasks = config.maxConcurrentTasks || 1;
    this.port = config.port || 3000;
    this.host = config.host || "localhost";
    this.logError = config.logError || false;
    this.timeout = config.timeout || 60;

    // Initialize Express app
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupCleanupInterval();
  }

  setupMiddleware() {
    this.app.use(
      express.json({
        limit: "1mb",
        verify: (req, res, buf, encoding) => {
          req.rawBody = buf;
        },
      })
    );

    this.app.use((err, req, res, next) => {
      if (err.type === "request.aborted") {
        return;
      }
      next(err);
    });
  }

  validateClientKey = (req, res, next) => {
    const { clientKey } = req.body;
    if (clientKey !== this.clientKey) {
      return res.status(401).json({ error: "Invalid client key" });
    }
    next();
  };

  setupRoutes() {
    this.app.post("/createTask", this.validateClientKey, this.createTask.bind(this));
    this.app.post("/getTaskResult", this.validateClientKey, this.getTaskResult.bind(this));
  }

  createTask = (req, res) => {
    const { type, url, sitekey, action, userAgent, proxy, content } = req.body;

    if (!type || !url) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: "Unsupported type" });
    }

    const taskId = Date.now().toString(36) + Math.random().toString(36).substr(2);

    this.taskResults.set(taskId, {
      status: "pending",
      timestamp: Date.now(),
    });

    this.taskQueue.push({
      taskId,
      type,
      url,
      sitekey,
      action,
      userAgent,
      proxy,
      content,
    });

    res.json({ taskId });
  };

  getTaskResult = (req, res) => {
    const { taskId } = req.body;

    if (!taskId) {
      return res.status(400).json({ error: "Missing taskId" });
    }

    const taskResult = this.taskResults.get(taskId);

    if (!taskResult) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json(taskResult);
  };

  setupCleanupInterval() {
    setInterval(() => {
      const oneHourAgo = Date.now() - 3600000;
      for (const [taskId, result] of this.taskResults.entries()) {
        if (result.timestamp < oneHourAgo) {
          this.taskResults.delete(taskId);
        }
      }
    }, 300000);
  }

  initializeTaskQueue() {
    this.taskQueue = new Queue(
      async (task, cb) => {
        try {
          const instance = this.instances[this.currentInstanceIndex];
          this.currentInstanceIndex = (this.currentInstanceIndex + 1) % this.instances.length;

          // Ensure task timeout doesn't exceed the configured maximum timeout
          const timeout = Math.min(task.timeout || this.timeout, this.timeout);
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(
              () => reject(new Error(`Task timeout after ${timeout + 30} seconds`)),
              (timeout + 30) * 1000
            );
          });
          
          try {
            const result = await Promise.race([
              instance.Solve({
                type: task.type,
                url: task.url,
                sitekey: task.sitekey,
                action: task.action,
                proxy: task.proxy,
                content: task.content,
                timeout: timeout,
              }),
              timeoutPromise,
            ]);

            if (result.errormessage) {
              console.error(`Task ${task.taskId} error: ${result.errormessage}`);
              if (this.logError && result.errormessage) {
                console.log(result.error);
              }
            }
            this.taskResults.set(task.taskId, {
              status: result.success ? "completed" : "failed",
              result: result,
              timestamp: Date.now(),
            });
            cb(null, result);
          } catch (error) {
            if (error.message.includes("Task timeout")) {
              console.log("Task timeout, replacing instance...");
              const closePromise = Promise.race([
                instance.Close(),
                new Promise((resolve) => setTimeout(resolve, 10000)),
              ]);
              await closePromise;

              const newInstance = new CloudFreed();
              const startedInstance = await newInstance.start(false, false);
              this.instances[this.currentInstanceIndex] = startedInstance;
            }
            throw error;
          }
        } catch (error) {
          console.error(`Task ${task.taskId} failed: ${error.message}`);
          this.taskResults.set(task.taskId, {
            status: "failed",
            error: error.message,
            timestamp: Date.now(),
          });
          cb(error);
        }
      },
      {
        concurrent: this.maxConcurrentTasks,
        maxRetries: 2,
        retryDelay: 1000,
        timeout: 65000,
      }
    );
  }

  async initialize() {
    if (!this.clientKey) {
      console.error("Error: clientKey environment variable is not set");
      process.exit(1);
    }

    const instancePool = [];
    for (let i = 0; i < this.maxConcurrentTasks; i++) {
      const CF = new CloudFreed();
      instancePool.push(CF.start(false, false));
    }
    this.instances = await Promise.all(instancePool);
    
    this.initializeTaskQueue();
    
    // Setup shutdown handlers
    process.on("SIGTERM", this.stop.bind(this));
    process.on("SIGINT", this.stop.bind(this));
  }

  async stop() {
    await Promise.all(this.instances.map((instance) => instance.Close()));
    if (this.taskQueue) {
      this.taskQueue.destroy();
    }
  }

  listen() {
    return this.app.listen(this.port, this.host, () => {
      console.log(`Server running on ${this.host}:${this.port}`);
    });
  }
}

export default Server;