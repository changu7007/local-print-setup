/**
 * Print Agent Launcher
 *
 * This script checks if the print agent is running and starts it if needed.
 * It can be called from the Next.js application to ensure the print agent is running.
 */

const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

// Configuration
const PRINT_AGENT_PORT = process.env.PORT || 3000;
const PRINT_AGENT_SCRIPT = path.join(__dirname, "local-print-agent.js");

/**
 * Check if the print agent is running
 * @returns {Promise<boolean>} True if running, false otherwise
 */
function isPrintAgentRunning() {
  return new Promise((resolve) => {
    const req = http.get(
      `http://localhost:${PRINT_AGENT_PORT}/status`,
      (res) => {
        if (res.statusCode === 200) {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            try {
              const status = JSON.parse(data);
              resolve(status.status === "running");
            } catch (e) {
              resolve(false);
            }
          });
        } else {
          resolve(false);
        }
      }
    );

    req.on("error", () => {
      resolve(false);
    });

    req.setTimeout(1000, () => {
      req.abort();
      resolve(false);
    });
  });
}

/**
 * Start the print agent
 * @returns {Promise<boolean>} True if started successfully, false otherwise
 */
async function startPrintAgent() {
  console.log("Starting print agent...");

  // Check if already running
  const isRunning = await isPrintAgentRunning();
  if (isRunning) {
    console.log("Print agent is already running.");
    return true;
  }

  try {
    // Set environment variables for the print agent
    const env = {
      ...process.env,
      // Ensure CORS is enabled
      CORS_ENABLED: "true",
      // Allow requests from any origin (or specify your Next.js app origin)
      CORS_ORIGIN: "*",
      // Ensure the browser port is set correctly
      BROWSER_PORT: "3001",
      // Ensure browser integration is enabled
      ENABLE_BROWSER_INTEGRATION: "true",
      // Set the HTTP server port
      PORT: "3000",
    };

    // Start the print agent as a detached process
    const child = spawn("node", [PRINT_AGENT_SCRIPT], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: env,
    });

    // Unref the child process so it can run independently
    child.unref();

    console.log(`Print agent started with PID: ${child.pid}`);

    // Wait for the print agent to start
    let attempts = 0;
    while (attempts < 10) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const running = await isPrintAgentRunning();
      if (running) {
        console.log("Print agent is now running.");
        return true;
      }
      attempts++;
    }

    console.error("Print agent failed to start within the timeout period.");
    return false;
  } catch (error) {
    console.error("Error starting print agent:", error);
    return false;
  }
}

/**
 * Main function
 */
async function main() {
  const isRunning = await isPrintAgentRunning();

  if (isRunning) {
    console.log("Print agent is already running.");
    process.exit(0);
  } else {
    const started = await startPrintAgent();
    process.exit(started ? 0 : 1);
  }
}

// If this script is run directly
if (require.main === module) {
  main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
} else {
  // Export functions for use in other modules
  module.exports = {
    isPrintAgentRunning,
    startPrintAgent,
  };
}
