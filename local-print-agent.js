const WebSocket = require("ws");
const net = require("net");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const http = require("http");
const express = require("express");
const cors = require("cors");
const PrintFormatter = require("./print-formatter");

// Load environment variables from .env file
dotenv.config();

// Configuration
const config = {
  // Your API URL
  apiUrl: process.env.API_URL || "https://api.restobytes.in/api/printjob",

  // Authentication token for your API
  apiToken: process.env.API_TOKEN || "",

  // WebSocket endpoint
  wsEndpoint: process.env.WS_ENDPOINT || "wss://api.restobytes.in",

  // How often to poll for new print jobs if WebSocket fails
  pollInterval: parseInt(process.env.POLL_INTERVAL || "5000", 10),

  // Restaurant ID
  restaurantId: process.env.RESTAURANT_ID || "",

  // Local printer mappings (from printer ID to local IP:port)
  printerMappings: {},

  // Log level: 'debug', 'info', 'warn', 'error'
  logLevel: process.env.LOG_LEVEL || "info",

  // Enable browser integration
  enableBrowserIntegration: process.env.ENABLE_BROWSER_INTEGRATION === "true",

  // Browser integration port
  browserPort: parseInt(process.env.BROWSER_PORT || "3001", 10),

  // HTTP server port
  port: parseInt(process.env.PORT || "3000", 10),
};

// Initialize the formatter
const formatter = new PrintFormatter();

// Format rules for different printer widths
const formatRules = {
  MM_58: {
    lineWidth: 384,
    charsPerLine: 32,
    normalSize: 0, // Updated to numeric values
    largeSize: 24, // Double width and height (24)
    mediumSize: 16, // Double height (16)
    smallSize: 0, // Normal size (0)
  },
  MM_80: {
    lineWidth: 576,
    charsPerLine: 48,
    normalSize: 0, // Updated to numeric values
    largeSize: 24, // Double width and height (24)
    mediumSize: 16, // Double height (16)
    smallSize: 0, // Normal size (0)
  },
  MM_76: {
    lineWidth: 512,
    charsPerLine: 42,
    normalSize: 0, // Updated to numeric values
    largeSize: 24, // Double width and height (24)
    mediumSize: 16, // Double height (16)
    smallSize: 0, // Normal size (0)
  },
};

// Logger
const logger = {
  debug: (...args) => {
    if (config.logLevel === "debug") console.log("[DEBUG]", ...args);
  },
  info: (...args) => {
    if (["debug", "info"].includes(config.logLevel))
      console.log("[INFO]", ...args);
  },
  warn: (...args) => {
    if (["debug", "info", "warn"].includes(config.logLevel))
      console.log("[WARN]", ...args);
  },
  error: (...args) => {
    console.error("[ERROR]", ...args);
  },
};

// Load printer mappings from a JSON file if it exists
try {
  const mappingsPath = path.join(__dirname, "printer-mappings.json");
  if (fs.existsSync(mappingsPath)) {
    const mappingsData = fs.readFileSync(mappingsPath, "utf8");
    config.printerMappings = JSON.parse(mappingsData);
    logger.info("Loaded printer mappings:", config.printerMappings);
  }
} catch (error) {
  logger.error("Error loading printer mappings:", error);
}

// Function to get printer configuration
function getPrinterConfig(printerId) {
  if (!config.printerMappings[printerId]) {
    logger.error(`Printer ${printerId} not found in mappings`);
    return null;
  }

  // Check if the printer config is in the new format (object)
  if (typeof config.printerMappings[printerId] === "object") {
    const printerConfig = config.printerMappings[printerId];

    // Ensure we have an ipAddress property
    if (!printerConfig.ipAddress && printerConfig.address) {
      printerConfig.ipAddress = printerConfig.address;
    }

    return {
      id: printerId,
      ipAddress: printerConfig.ipAddress || printerConfig.address,
      port: printerConfig.port || 9100,
      type: printerConfig.type || "tcp",
      paperWidth: printerConfig.paperWidth || "MM_58",
    };
  }

  // Legacy format (string)
  const addressString = config.printerMappings[printerId];
  const [ipAddress, portStr] = addressString.split(":");
  const port = parseInt(portStr, 10);

  if (!ipAddress || !port) {
    logger.error(
      `Invalid printer configuration for ${printerId}: ${addressString}`
    );
    return null;
  }

  return {
    id: printerId,
    ipAddress,
    port,
  };
}

/**
 * Update the status of a print job
 * @param {string} jobId - The ID of the job to update
 * @param {boolean} success - Whether the job was successful
 * @param {string} [errorMessage] - Error message if the job failed
 * @param {string} [formattedContent] - The formatted content that was sent to the printer
 * @returns {Promise<void>}
 */
async function updateJobStatus(
  jobId,
  success,
  errorMessage = null,
  formattedContent = null
) {
  if (!jobId) {
    console.warn("Cannot update status: Job ID is undefined");
    return;
  }

  try {
    const apiUrl = process.env.API_URL;
    const url = `${apiUrl}/print-jobs/${jobId}/status`;

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.API_TOKEN}`,
      },
      body: JSON.stringify({
        status: success ? "COMPLETED" : "FAILED",
        errorMessage: errorMessage,
        formattedContent: formattedContent,
      }),
    });

    if (!response.ok) {
      console.error(
        `Failed to update job status: ${response.status} ${response.statusText}`
      );
    }
  } catch (error) {
    console.error(`Error updating job status: ${error.message}`);
  }
}

// Add this function to extract paper width from various request formats
function extractPaperWidth(job) {
  // Check all possible locations for paperWidth
  if (job.options && job.options.paperWidth) {
    return job.options.paperWidth;
  }

  if (job.content && job.content.options && job.content.options.paperWidth) {
    return job.content.options.paperWidth;
  }

  // For mobile requests that might have a different structure
  if (
    job.content &&
    job.content.content &&
    job.content.content.options &&
    job.content.content.options.paperWidth
  ) {
    return job.content.content.options.paperWidth;
  }

  // Default to MM_58 if not found
  return "MM_80";
}

/**
 * Process and print a job
 * @param {Object} job - The print job to process
 */
async function processJob(job) {
  try {
    console.log(`Processing job: ${job.id}`);

    // Validate job object
    if (!job) {
      console.error("Job object is undefined");
      return { success: false, error: "Job object is undefined" };
    }

    // Get printer mapping
    const printerId = job.printerId;
    if (!printerId) {
      console.error("Printer ID is undefined");
      if (job.id) {
        await updateJobStatus(job.id, false, "Printer ID is undefined");
      }
      return { success: false, error: "Printer ID is undefined" };
    }

    // Check if printer exists in mappings
    if (!config.printerMappings[printerId]) {
      console.error(`Printer ${printerId} not found in mappings`);

      // Try to find a default printer to use instead
      let defaultPrinterId = null;
      if (
        job.content &&
        job.content.type === "KOT" &&
        config.printerMappings["kitchen"]
      ) {
        defaultPrinterId = "kitchen";
      } else if (
        job.content &&
        job.content.type === "BILL" &&
        config.printerMappings["receipt"]
      ) {
        defaultPrinterId = "receipt";
      } else {
        // Try to find any printer
        const printerIds = Object.keys(config.printerMappings);
        if (printerIds.length > 0) {
          defaultPrinterId = printerIds[0];
        }
      }

      if (defaultPrinterId) {
        console.log(
          `Using default printer ${defaultPrinterId} instead of ${printerId}`
        );
        job.printerId = defaultPrinterId;
      } else {
        if (job.id) {
          await updateJobStatus(job.id, false, "Printer not found in mappings");
        }
        return { success: false, error: "Printer not found in mappings" };
      }
    }

    const printerConfig = getPrinterConfig(job.printerId);

    if (!printerConfig) {
      console.error(
        `No printer configuration found for printer ID: ${job.printerId}`
      );
      if (job.id) {
        await updateJobStatus(job.id, false, "Printer not configured");
      }
      return { success: false, error: "Printer not configured" };
    }

    // Parse the content and options
    let content = job.content;
    const options = job.options || {};

    console.log("Original content type:", typeof content);
    if (typeof content === "string") {
      console.log(
        "Original content (first 100 chars):",
        content.substring(0, 100)
      );
    } else if (content && typeof content === "object") {
      console.log(
        "Original content (object):",
        JSON.stringify(content).substring(0, 100)
      );
    } else {
      console.log("Original content: undefined or null");
    }

    // Handle direct JSON object in content field
    if (content && typeof content === "object") {
      // If content is already an object with type and content properties, use it directly
      if (content.type && content.content) {
        console.log(
          `Content is already a structured object with type: ${content.type}`
        );
      }
      // If content is a raw object without type/content structure, wrap it
      else if (!content.type && !content.content) {
        console.log(
          "Content is a raw object, wrapping it with proper structure"
        );
        // Try to determine the type based on content properties
        let type = "UNKNOWN";
        if (content.items && content.header && content.header.kotNumber) {
          type = "KOT";
        } else if (content.items && content.summary) {
          type = "BILL";
        }

        // Wrap the content in a proper structure
        content = {
          type: type,
          content: content,
        };
      }
    }
    // Clean up content if it's a string with "VA" prefixes
    else if (typeof content === "string") {
      try {
        // First, try to parse the content directly as JSON
        content = JSON.parse(content);
        console.log("Successfully parsed content from JSON string");
      } catch (parseError) {
        console.warn("Initial JSON parse failed:", parseError.message);

        // Handle the specific pattern with multiple VA prefixes
        // First, try to extract the first valid JSON object
        const jsonRegex = /\{.*?\}/;
        const match = content.match(jsonRegex);

        if (match) {
          // Use the first valid JSON object found
          const jsonStr = match[0];
          console.log(
            "Extracted first JSON object:",
            jsonStr.substring(0, 100)
          );

          try {
            content = JSON.parse(jsonStr);
            console.log("Successfully parsed extracted JSON object");
          } catch (extractError) {
            console.warn(
              "Failed to parse extracted JSON:",
              extractError.message
            );

            // Try to fix common JSON issues
            let fixedJson = jsonStr;
            // Fix missing closing braces
            const openBraces = (jsonStr.match(/\{/g) || []).length;
            const closeBraces = (jsonStr.match(/\}/g) || []).length;
            if (openBraces > closeBraces) {
              fixedJson += "}".repeat(openBraces - closeBraces);
              console.log("Added missing closing braces");
            }

            try {
              content = JSON.parse(fixedJson);
              console.log("Successfully parsed fixed JSON");
            } catch (fixError) {
              console.warn("Failed to parse fixed JSON:", fixError.message);
              // Keep content as string if all parsing attempts fail
            }
          }
        } else {
          // If no valid JSON object found, try removing VA prefixes
          content = content.replace(/VA/g, "");

          // Check if the content appears to be duplicated (same JSON object repeated)
          if (content.includes("}{")) {
            // Split by closing and opening braces to get individual JSON objects
            const parts = content.split("}{");
            if (parts.length > 1) {
              // Take only the first part and add the closing brace back
              content = parts[0] + "}";
              console.log("Detected and fixed duplicated content");

              try {
                content = JSON.parse(content);
                console.log("Successfully parsed fixed duplicated content");
              } catch (dupError) {
                console.warn(
                  "Failed to parse fixed duplicated content:",
                  dupError.message
                );
              }
            }
          }
        }
      }

      console.log(
        "Cleaned content:",
        typeof content === "string" ? content.substring(0, 100) : "Object"
      );
    }

    // Check if we have structured content in options (added by the backend)
    if (
      options.structuredContent &&
      typeof options.structuredContent === "object"
    ) {
      console.log("Using structured content from options");
      content = options.structuredContent;
    }

    // Extract rawData from options if it exists there
    const rawData = job.rawData || (options && options.rawData);

    // Check if content is defined
    if (!content && !rawData) {
      console.error("Print content and raw data are undefined");
      if (job.id) {
        await updateJobStatus(job.id, false, "Print content is undefined");
      }
      return { success: false, error: "Print content is undefined" };
    }

    // Handle direct string content (for test prints)
    if (typeof content === "string" && !content.trim().startsWith("{")) {
      const success = await printToTCPPrinter(
        printerConfig.ipAddress,
        printerConfig.port || 9100,
        content
      );

      if (job.id) {
        await updateJobStatus(
          job.id,
          success,
          success ? null : "Failed to print"
        );
      }

      return { success, error: success ? null : "Failed to print" };
    }

    // Handle raw data if it's a base64 string and no structured content is available
    if (
      !content ||
      (typeof content === "object" && Object.keys(content).length === 0)
    ) {
      if (rawData && typeof rawData === "string") {
        try {
          // Try to decode the base64 data
          const decodedData = Buffer.from(rawData, "base64").toString("utf8");
          const success = await printToTCPPrinter(
            printerConfig.ipAddress,
            printerConfig.port || 9100,
            decodedData
          );

          if (job.id) {
            await updateJobStatus(
              job.id,
              success,
              success ? null : "Failed to print raw data"
            );
          }

          return {
            success,
            error: success ? null : "Failed to print raw data",
          };
        } catch (error) {
          console.error("Error decoding raw data:", error);
          // Continue to try other methods
        }
      }
    }

    // Extract paper width from the job
    const paperWidth = extractPaperWidth(job);
    console.log(
      `Using paper width: ${paperWidth} for job:`,
      job.id || "unknown"
    );

    // Get format rules for the paper width
    const formatConfig = formatRules[paperWidth] || formatRules.MM_58;

    // Update formatter configuration
    formatter.updateConfig(formatConfig);

    // Format the content based on type
    let formattedContent = "";

    // Check if we have structured content with type and content properties
    if (content && content.type && content.content) {
      console.log(`Formatting structured ${content.type} content`);
      if (content.type === "KOT") {
        formattedContent = await formatter.printContentAsImage(
          content.content,
          "kot"
        );
      } else if (content.type === "BILL") {
        formattedContent = await formatter.printContentAsImage(
          content.content,
          "bill"
        );
      } else {
        console.warn(`Unknown content type: ${content.type}`);
        // Try to format as generic content
        formattedContent = JSON.stringify(content, null, 2);
      }
    } else {
      // If we don't have properly structured content, try to format it as best we can
      console.log("No structured content found, using generic formatting");
      formattedContent = JSON.stringify(content, null, 2);
    }

    console.log(
      "Formatted content preview (first 100 chars):",
      formattedContent.substring(0, 100)
    );

    // Print the formatted content
    const success = await printToTCPPrinter(
      printerConfig.ipAddress,
      printerConfig.port || 9100,
      formattedContent
    );

    // Update job status with formatted content
    if (success) {
      if (job.id) {
        // Store the formatted content when updating job status
        await updateJobStatus(job.id, true, null, formattedContent);

        // Also update the job in the database with the formatted content
        try {
          const apiUrl = process.env.API_URL;
          const url = `${apiUrl}/print-jobs/${job.id}/formatted-content`;

          await fetch(url, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.API_TOKEN}`,
            },
            body: JSON.stringify({
              formattedContent: formattedContent,
            }),
          });

          console.log(`Updated job ${job.id} with formatted content`);
        } catch (error) {
          console.error(
            `Error updating job with formatted content: ${error.message}`
          );
        }
      }
      console.log(`Job ${job.id || "unknown"} printed successfully`);
    } else {
      if (job.id) {
        // Store the formatted content even when the job fails
        await updateJobStatus(
          job.id,
          false,
          "Failed to print",
          formattedContent
        );

        // Also update the job in the database with the formatted content
        try {
          const apiUrl = process.env.API_URL;
          const url = `${apiUrl}/print-jobs/${job.id}/formatted-content`;

          await fetch(url, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.API_TOKEN}`,
            },
            body: JSON.stringify({
              formattedContent: formattedContent,
            }),
          });

          console.log(`Updated failed job ${job.id} with formatted content`);
        } catch (error) {
          console.error(
            `Error updating failed job with formatted content: ${error.message}`
          );
        }
      }
      console.error(`Failed to print job ${job.id || "unknown"}`);
    }

    return { success, error: success ? null : "Failed to print" };
  } catch (error) {
    console.error(`Error processing job ${job.id || "unknown"}:`, error);
    if (job && job.id) {
      await updateJobStatus(job.id, false, error.message);
    }
    return { success: false, error: error.message };
  }
}

/**
 * Print to a TCP printer
 * @param {string} ipAddress - Printer IP address
 * @param {number} port - Printer port
 * @param {string} data - Data to print
 * @returns {Promise<boolean>} Success status
 */
function printToTCPPrinter(ipAddress, port, data) {
  return new Promise((resolve) => {
    try {
      const client = new net.Socket();
      let resolved = false;

      // Set timeout
      client.setTimeout(10000); // 10 seconds

      client.on("connect", () => {
        console.log(`Connected to printer at ${ipAddress}:${port}`);

        try {
          // Convert string to buffer, preserving binary data
          // This ensures ESC/POS commands are properly sent to the printer
          const buffer = Buffer.from(data, "binary");

          // Check if the data already contains a cut command
          // Common cut commands: ESC d, GS V
          const hasCutCommand =
            data.includes("\x1Bd") || // ESC d
            data.includes("\x1BV") || // ESC V
            data.includes("\x1dV"); // GS V

          let finalBuffer;
          if (!hasCutCommand) {
            // Add cut command at the end if not already present
            const cutCommand = Buffer.from([0x1d, 0x56, 0x41, 0x10]); // GS V A 16 - Full cut with feed
            finalBuffer = Buffer.concat([buffer, cutCommand]);
          } else {
            finalBuffer = buffer;
          }

          // Send data
          client.write(finalBuffer, (err) => {
            if (err) {
              console.error("Error writing to printer:", err);
              client.end();
              if (!resolved) {
                resolved = true;
                resolve(false);
              }
            } else {
              console.log("Data sent to printer successfully");
              client.end();
              if (!resolved) {
                resolved = true;
                resolve(true);
              }
            }
          });
        } catch (error) {
          console.error("Error preparing data for printer:", error);
          client.end();
          if (!resolved) {
            resolved = true;
            resolve(false);
          }
        }
      });

      client.on("timeout", () => {
        console.error(
          `Connection to printer at ${ipAddress}:${port} timed out`
        );
        client.destroy();
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });

      client.on("error", (err) => {
        console.error(
          `Error connecting to printer at ${ipAddress}:${port}:`,
          err.message
        );
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });

      client.on("close", () => {
        console.log(`Connection to printer at ${ipAddress}:${port} closed`);
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });

      // Connect to printer
      client.connect(port, ipAddress);
    } catch (error) {
      console.error("Error in printToTCPPrinter:", error);
      resolve(false);
    }
  });
}

// WebSocket connection for real-time print jobs
let ws;
let wsReconnectTimeout;

function connectWebSocket() {
  if (ws) {
    ws.terminate();
  }

  clearTimeout(wsReconnectTimeout);

  try {
    ws = new WebSocket(config.wsEndpoint);

    ws.on("open", () => {
      logger.info("Connected to WebSocket server");

      // Register with restaurant ID
      ws.send(
        JSON.stringify({
          type: "register",
          restaurantId: config.restaurantId,
        })
      );
    });

    ws.on("message", async (message) => {
      try {
        const data = JSON.parse(message);

        if (data.type === "print") {
          logger.info(
            `Received print job via WebSocket: ${message.substring(0, 100)}...`
          );

          // Create a job object
          const job = {
            id: "ws-" + Date.now(),
            printerId: data.printerId,
            content: data.content,
            options: data.options || {}, // Ensure options exists
          };

          // Process the job
          await processJob(job);

          // Send success response
          ws.send(JSON.stringify({ success: true }));
        }
      } catch (error) {
        logger.error("Error processing WebSocket message:", error);
      }
    });

    ws.on("error", (error) => {
      logger.error("WebSocket error:", error);
      wsReconnectTimeout = setTimeout(connectWebSocket, 5000);
    });

    ws.on("close", () => {
      logger.warn("WebSocket connection closed");
      wsReconnectTimeout = setTimeout(connectWebSocket, 5000);

      // Fall back to polling if WebSocket fails
      startPolling();
    });
  } catch (error) {
    logger.error("Error connecting to WebSocket:", error);
    wsReconnectTimeout = setTimeout(connectWebSocket, 5000);
  }
}

// Poll for print jobs as a fallback
let isPolling = false;
let pollTimeout;

function startPolling() {
  if (isPolling) return;

  isPolling = true;
  pollPrintJobs();
}

function stopPolling() {
  isPolling = false;
  clearTimeout(pollTimeout);
}

async function pollPrintJobs() {
  if (!isPolling) return;

  try {
    const url = `${config.apiUrl}/print-jobs/pending`;
    const params = { restaurantId: config.restaurantId };

    const response = await axios.get(url, {
      params,
      headers: config.apiToken
        ? { Authorization: `Bearer ${config.apiToken}` }
        : {},
    });

    const printJobs = response.data.data;

    if (printJobs && printJobs.length > 0) {
      logger.info(`Found ${printJobs.length} pending print jobs`);

      for (const printJob of printJobs) {
        // Log the received print job
        logger.info(
          "Received print job via polling:",
          JSON.stringify(printJob).substring(0, 100) + "..."
        );

        // Check if the content is a direct JSON object (not a string)
        if (
          printJob &&
          printJob.content &&
          typeof printJob.content === "object"
        ) {
          // If it's already an object, we need to format it properly
          logger.info(
            "Print job content is already an object, formatting for printing"
          );

          // Create a properly formatted job with the content
          const formattedJob = {
            ...printJob,
            // Ensure the content is properly structured
            content: printJob.content,
          };

          await processJob(formattedJob);
        } else {
          // Process the job as is
          await processJob(printJob);
        }
      }
    } else {
      logger.debug("No pending print jobs found");
    }
  } catch (error) {
    logger.error("Error polling for print jobs:", error);
  }

  // Schedule next poll
  pollTimeout = setTimeout(pollPrintJobs, config.pollInterval);
}

// Create HTTP server for status page and browser integration
const server = http.createServer((req, res) => {
  // Add CORS headers to all responses
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS, PUT, DELETE"
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Handle OPTIONS requests for CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "running",
        config: {
          ...config,
          apiToken: config.apiToken ? "***" : null,
        },
      })
    );
  } else if (req.url === "/printers") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(config.printerMappings));
  } else if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <html>
        <head>
          <title>Restaurant Print Agent</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { color: #333; }
            .status { padding: 10px; background: #f0f0f0; border-radius: 5px; margin-bottom: 20px; }
            .printers { padding: 10px; background: #f0f0f0; border-radius: 5px; }
            .printer-item { margin-bottom: 5px; }
            .button {
              display: inline-block;
              padding: 10px 15px;
              background-color: #4CAF50;
              color: white;
              text-decoration: none;
              border-radius: 4px;
              margin-top: 10px;
              margin-right: 10px;
              cursor: pointer;
            }
          </style>
        </head>
        <body>
          <h1>Restaurant Print Agent</h1>
          <div class="status">
            <p>Status: Running</p>
            <p>API URL: ${config.apiUrl}</p>
            <p>WebSocket: ${config.wsEndpoint ? "Enabled" : "Disabled"}</p>
            <p>Restaurant ID: ${config.restaurantId || "Not configured"}</p>
            <p>Browser Integration: ${
              config.enableBrowserIntegration
                ? `Enabled (port ${config.browserPort})`
                : "Disabled"
            }</p>
          </div>
          
          <h2>Configured Printers</h2>
          <div class="printers">
            ${Object.entries(config.printerMappings)
              .map(
                ([id, address]) => `
              <div class="printer-item">
                <strong>${id}:</strong> ${address}
              </div>
            `
              )
              .join("")}
          </div>
          
          <h2>Test Print</h2>
          <form id="testPrintForm">
            <select id="printerId">
              ${Object.keys(config.printerMappings)
                .map(
                  (id) => `
                <option value="${id}">${id}</option>
              `
                )
                .join("")}
            </select>
            <button type="submit">Send Test Print</button>
          </form>
          
          <h2>Mobile Printing</h2>
          <p>Access the mobile-friendly interface for printing from mobile devices:</p>
          <a href="/mobile" class="button">Open Mobile Interface</a>
          
          <script>
            document.getElementById('testPrintForm').addEventListener('submit', function(e) {
              e.preventDefault();
              const printerId = document.getElementById('printerId').value;
              
              fetch('/test-print', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  printerId: printerId,
                  // Use a structured KOT content for better formatting
                  content: {
                    type: "KOT",
                    content: {
                      header: {
                        restaurantName: "TEST RESTAURANT",
                        kotNumber: "TEST-001",
                        kotType: "TEST",
                        customerName: "TEST USER",
                        orderType: "TEST",
                        waiterName: "System",
                        date: new Date().toLocaleString()
                      },
                      items: [
                        {
                          name: "Test Item 1",
                          quantity: 1,
                          status: "NEW"
                        },
                        {
                          name: "Test Item with a very long name that should wrap to multiple lines",
                          quantity: 2,
                          status: "NEW"
                        }
                      ],
                      footer: {
                        totalItems: 2
                      },
                      note: "This is a test print"
                    }
                  },
                  options: {
                    paperWidth: "MM_58",
                    cutPaper: true
                  }
                })
              })
              .then(response => response.json())
              .then(data => {
                alert(data.success ? 'Test print sent successfully!' : 'Test print failed: ' + data.error);
              })
              .catch(error => {
                alert('Error sending test print: ' + error);
              });
            });
          </script>
        </body>
      </html>
    `);
  } else if (req.url === "/mobile-print" && req.method === "POST") {
    // Special endpoint for mobile printing
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        const printData = JSON.parse(body);
        const { printerId, content, options } = printData;

        if (!printerId) {
          // If no printer ID is specified, use the first available printer
          const printerIds = Object.keys(config.printerMappings);
          if (printerIds.length === 0) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: false,
                error: "No printers configured",
              })
            );
            return;
          }

          printData.printerId = printerIds[0];
          console.log(
            `No printer specified, using default: ${printData.printerId}`
          );
        }

        // Process the print job
        const result = await processJob(printData);

        // Return the result with the formatted content
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ...result,
            printerId: printData.printerId,
            // Include a preview URL that can be used to view the print
            previewUrl: result.success
              ? `/print-preview/${printData.printerId}/${Date.now()}`
              : null,
          })
        );
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: error.message,
          })
        );
      }
    });
  } else if (req.url.startsWith("/print-preview/") && req.method === "GET") {
    // Endpoint to view a print preview (useful for mobile devices)
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <html>
        <head>
          <title>Print Preview</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { 
              font-family: monospace; 
              margin: 20px;
              background-color: #f5f5f5;
            }
            .print-content {
              background-color: white;
              padding: 10px;
              border: 1px solid #ccc;
              border-radius: 5px;
              white-space: pre;
              overflow-x: auto;
              max-width: 100%;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            h1 { color: #333; font-size: 1.5em; }
            .success { color: green; }
            .error { color: red; }
            .button {
              display: inline-block;
              padding: 10px 15px;
              background-color: #4CAF50;
              color: white;
              text-decoration: none;
              border-radius: 4px;
              margin-top: 20px;
              cursor: pointer;
            }
          </style>
        </head>
        <body>
          <h1>Print Preview</h1>
          <p>This is a preview of what was sent to the printer.</p>
          <div class="print-content" id="printContent">
            Loading print content...
          </div>
          <p id="status" class="success">Print job was successful.</p>
          <a href="/" class="button">Back to Home</a>
          
          <script>
            // In a real implementation, you would fetch the actual print content
            // from the server based on the URL parameters
            document.getElementById('printContent').textContent = 
              "This is a preview of the print content.\\n" +
              "In a real implementation, this would show\\n" +
              "the actual formatted content that was sent\\n" +
              "to the printer.";
          </script>
        </body>
      </html>
    `);
  } else if (req.url === "/mobile" || req.url === "/mobile/") {
    // Mobile-friendly interface
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <html>
        <head>
          <title>Mobile Print Agent</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { 
              font-family: Arial, sans-serif; 
              margin: 0;
              padding: 20px;
              background-color: #f5f5f5;
            }
            h1 { color: #333; font-size: 1.5em; }
            .card {
              background-color: white;
              border-radius: 8px;
              padding: 15px;
              margin-bottom: 15px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .form-group {
              margin-bottom: 15px;
            }
            label {
              display: block;
              margin-bottom: 5px;
              font-weight: bold;
            }
            select, textarea, button {
              width: 100%;
              padding: 10px;
              border: 1px solid #ddd;
              border-radius: 4px;
              font-size: 16px;
            }
            textarea {
              height: 150px;
              font-family: monospace;
            }
            button {
              background-color: #4CAF50;
              color: white;
              border: none;
              cursor: pointer;
              margin-top: 10px;
            }
            button:hover {
              background-color: #45a049;
            }
            .status {
              padding: 10px;
              border-radius: 4px;
              margin-top: 15px;
              display: none;
            }
            .success {
              background-color: #dff0d8;
              color: #3c763d;
            }
            .error {
              background-color: #f2dede;
              color: #a94442;
            }
          </style>
        </head>
        <body>
          <h1>Mobile Print Agent</h1>
          
          <div class="card">
            <div class="form-group">
              <label for="printerId">Select Printer:</label>
              <select id="printerId">
                <option value="">Loading printers...</option>
              </select>
            </div>
            
            <div class="form-group">
              <label for="contentType">Content Type:</label>
              <select id="contentType">
                <option value="KOT">Kitchen Order Ticket (KOT)</option>
                <option value="BILL">Bill/Receipt</option>
                <option value="TEXT">Plain Text</option>
              </select>
            </div>
            
            <div class="form-group" id="textContentGroup" style="display:none;">
              <label for="textContent">Text Content:</label>
              <textarea id="textContent" placeholder="Enter plain text to print"></textarea>
            </div>
            
            <div class="form-group" id="jsonContentGroup">
              <label for="jsonContent">JSON Content:</label>
              <textarea id="jsonContent" placeholder="Enter JSON content to print"></textarea>
            </div>
            
            <button id="printButton">Print</button>
            
            <div id="statusMessage" class="status"></div>
          </div>
          
          <script>
            // Fetch available printers
            fetch('/printers')
              .then(response => response.json())
              .then(printers => {
                const select = document.getElementById('printerId');
                select.innerHTML = '';
                
                Object.keys(printers).forEach(id => {
                  const option = document.createElement('option');
                  option.value = id;
                  option.textContent = id;
                  select.appendChild(option);
                });
                
                if (Object.keys(printers).length === 0) {
                  const option = document.createElement('option');
                  option.value = '';
                  option.textContent = 'No printers available';
                  select.appendChild(option);
                  document.getElementById('printButton').disabled = true;
                }
              })
              .catch(error => {
                console.error('Error fetching printers:', error);
                document.getElementById('statusMessage').textContent = 'Error loading printers: ' + error.message;
                document.getElementById('statusMessage').className = 'status error';
                document.getElementById('statusMessage').style.display = 'block';
              });
            
            // Toggle content type
            document.getElementById('contentType').addEventListener('change', function() {
              const contentType = this.value;
              if (contentType === 'TEXT') {
                document.getElementById('textContentGroup').style.display = 'block';
                document.getElementById('jsonContentGroup').style.display = 'none';
              } else {
                document.getElementById('textContentGroup').style.display = 'none';
                document.getElementById('jsonContentGroup').style.display = 'block';
                
                // Provide a template based on content type
                const jsonContent = document.getElementById('jsonContent');
                if (contentType === 'KOT') {
                  jsonContent.value = JSON.stringify({
                    header: {
                      restaurantName: "RESTAURANT NAME",
                      kotNumber: "KOT-001",
                      kotType: "NEW KOT",
                      customerName: "CUSTOMER",
                      orderType: "DINE IN",
                      date: new Date().toLocaleString()
                    },
                    items: [
                      {
                        name: "Item 1",
                        quantity: 1,
                        status: "NEW"
                      }
                    ],
                    footer: {
                      totalItems: 1
                    },
                    orderedBy: "Staff Name"
                  }, null, 2);
                } else if (contentType === 'BILL') {
                  jsonContent.value = JSON.stringify({
                    header: {
                      restaurantName: "RESTAURANT NAME",
                      invoice: "INV-001",
                      customerName: "CUSTOMER",
                      orderType: "DINE IN",
                      date: new Date().toLocaleString()
                    },
                    items: [
                      {
                        name: "Item 1",
                        quantity: 1,
                        price: 100
                      }
                    ],
                    summary: {
                      subTotal: 100,
                      discount: 0,
                      discountAmount: 0,
                      sgst: 2.5,
                      cgst: 2.5,
                      total: 105,
                      rounded: 105
                    }
                  }, null, 2);
                }
              }
            });
            
            // Handle print button click
            document.getElementById('printButton').addEventListener('click', function() {
              const printerId = document.getElementById('printerId').value;
              const contentType = document.getElementById('contentType').value;
              
              if (!printerId) {
                alert('Please select a printer');
                return;
              }
              
              let content;
              if (contentType === 'TEXT') {
                content = document.getElementById('textContent').value;
              } else {
                try {
                  const jsonContent = document.getElementById('jsonContent').value;
                  const parsedContent = JSON.parse(jsonContent);
                  
                  content = {
                    type: contentType,
                    content: parsedContent
                  };
                } catch (error) {
                  alert('Invalid JSON: ' + error.message);
                  return;
                }
              }
              
              // Send print request
              fetch('/mobile-print', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  printerId: printerId,
                  content: content,
                  options: {
                    paperWidth: "MM_58",
                    cutPaper: true
                  }
                })
              })
              .then(response => response.json())
              .then(result => {
                const statusMessage = document.getElementById('statusMessage');
                if (result.success) {
                  statusMessage.textContent = 'Print job sent successfully!';
                  statusMessage.className = 'status success';
                } else {
                  statusMessage.textContent = 'Print failed: ' + result.error;
                  statusMessage.className = 'status error';
                }
                statusMessage.style.display = 'block';
                
                // If there's a preview URL, offer to show it
                if (result.previewUrl) {
                  if (confirm('Print job sent successfully! Would you like to view a preview?')) {
                    window.location.href = result.previewUrl;
                  }
                }
              })
              .catch(error => {
                const statusMessage = document.getElementById('statusMessage');
                statusMessage.textContent = 'Error: ' + error.message;
                statusMessage.className = 'status error';
                statusMessage.style.display = 'block';
              });
            });
            
            // Initialize with KOT template
            document.getElementById('contentType').dispatchEvent(new Event('change'));
          </script>
        </body>
      </html>
    `);
  } else if (req.url === "/test-print" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        const printJob = JSON.parse(body);
        const result = await processJob(printJob);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
    });
  } else if (req.url === "/favicon.ico") {
    // Serve a simple favicon for ping checks
    res.writeHead(200, { "Content-Type": "image/x-icon" });
    res.end("");
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

// Browser integration WebSocket server
let browserWsServer;

function setupBrowserIntegration() {
  if (!config.enableBrowserIntegration) {
    logger.info("Browser integration is disabled");
    return;
  }

  // Create WebSocket server for browser integration
  const browserServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Print Agent Browser Integration Server");
  });

  browserWsServer = new WebSocket.Server({ server: browserServer });

  browserWsServer.on("connection", (ws) => {
    logger.info("Browser connected to print agent");

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data);

        if (message.type === "print") {
          logger.info("Received print request from browser");

          // Process the print job
          const result = await processJob(message);

          // Send result back to browser
          ws.send(
            JSON.stringify({
              type: "print_result",
              requestId: message.requestId,
              success: result.success,
              error: result.error,
            })
          );
        } else if (message.type === "get_printers") {
          // Get all printers from mappings
          const printers = [];

          // Add legacy format printers
          for (const [id, address] of Object.entries(config.printerMappings)) {
            if (typeof address === "string") {
              const [ipAddress, port] = address.split(":");
              printers.push({
                id,
                address,
                ipAddress,
                port: parseInt(port, 10),
                type: "tcp",
              });
            }
          }

          // Add new format printers
          for (const [id, printerConfig] of Object.entries(
            config.printerMappings
          )) {
            if (typeof printerConfig === "object") {
              printers.push({
                id,
                address: `${printerConfig.ipAddress || printerConfig.address}:${
                  printerConfig.port || 9100
                }`,
                ipAddress: printerConfig.ipAddress || printerConfig.address,
                port: printerConfig.port || 9100,
                type: printerConfig.type || "tcp",
              });
            }
          }

          // Send printer list to browser
          ws.send(
            JSON.stringify({
              type: "printers",
              requestId: message.requestId,
              printers,
            })
          );
        }
      } catch (error) {
        logger.error("Error processing browser message:", error);
        ws.send(
          JSON.stringify({
            type: "error",
            error: error.message,
          })
        );
      }
    });

    ws.on("close", () => {
      logger.info("Browser disconnected from print agent");
    });

    // Send initial printer list
    ws.send(
      JSON.stringify({
        type: "printers",
        printers: Object.keys(config.printerMappings).map((id) => ({
          id,
          address: config.printerMappings[id],
        })),
      })
    );
  });

  // Start browser integration server
  browserServer.listen(config.browserPort, () => {
    logger.info(
      `Browser integration WebSocket server listening on port ${config.browserPort}`
    );
  });
}

// Start the application
async function start() {
  logger.info("Starting Restaurant Print Agent");

  // Start HTTP server
  server.listen(config.port, () => {
    logger.info(`HTTP server listening on port ${config.port}`);
  });

  // Set up browser integration
  setupBrowserIntegration();

  // Connect to WebSocket
  connectWebSocket();

  // Start polling as a fallback
  startPolling();
}

// Start the application
start().catch((error) => {
  logger.error("Failed to start:", error);
  process.exit(1);
});
