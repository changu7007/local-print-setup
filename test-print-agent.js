/**
 * Print Agent Test Script
 *
 * This script tests the print agent by sending a test print job to a printer.
 */

const http = require("http");
const readline = require("readline");

// Configuration
const PRINT_AGENT_PORT = process.env.PORT || 3000;

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

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
 * Get the list of printers from the print agent
 * @returns {Promise<Array>} Array of printers
 */
function getPrinters() {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `http://localhost:${PRINT_AGENT_PORT}/printers`,
      (res) => {
        if (res.statusCode === 200) {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            try {
              const printers = JSON.parse(data);
              resolve(printers);
            } catch (e) {
              reject(new Error("Failed to parse printer list"));
            }
          });
        } else {
          reject(new Error(`Failed to get printers: ${res.statusCode}`));
        }
      }
    );

    req.on("error", (err) => {
      reject(new Error(`Failed to connect to print agent: ${err.message}`));
    });

    req.setTimeout(1000, () => {
      req.abort();
      reject(new Error("Request timed out"));
    });
  });
}

/**
 * Send a test print job to a printer
 * @param {string} printerId Printer ID
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
function sendTestPrint(printerId) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      printerId,
      content: `\n\n    TEST PRINT\n\n    Printer ID: ${printerId}\n    Time: ${new Date().toLocaleString()}\n\n\n\n`,
      options: {
        cutPaper: true,
      },
    });

    const options = {
      hostname: "localhost",
      port: PRINT_AGENT_PORT,
      path: "/test-print",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": data.length,
      },
    };

    const req = http.request(options, (res) => {
      let responseData = "";
      res.on("data", (chunk) => {
        responseData += chunk;
      });
      res.on("end", () => {
        try {
          const result = JSON.parse(responseData);
          if (result.success) {
            resolve(true);
          } else {
            reject(new Error(result.error || "Unknown error"));
          }
        } catch (e) {
          reject(new Error("Failed to parse response"));
        }
      });
    });

    req.on("error", (err) => {
      reject(new Error(`Failed to send test print: ${err.message}`));
    });

    req.write(data);
    req.end();
  });
}

/**
 * Main function
 */
async function main() {
  try {
    console.log("Checking if print agent is running...");
    const isRunning = await isPrintAgentRunning();

    if (!isRunning) {
      console.error("Print agent is not running. Please start it first.");
      process.exit(1);
    }

    console.log("Print agent is running.");
    console.log("Getting list of printers...");

    const printers = await getPrinters();
    const printerIds = Object.keys(printers);

    if (printerIds.length === 0) {
      console.error(
        "No printers found. Please configure printer mappings first."
      );
      process.exit(1);
    }

    console.log("Available printers:");
    printerIds.forEach((id, index) => {
      console.log(
        `${index + 1}. ${id} (${
          typeof printers[id] === "object" ? printers[id].address : printers[id]
        })`
      );
    });

    rl.question("Enter the number of the printer to test: ", async (answer) => {
      const index = parseInt(answer, 10) - 1;

      if (isNaN(index) || index < 0 || index >= printerIds.length) {
        console.error("Invalid printer selection.");
        rl.close();
        process.exit(1);
      }

      const selectedPrinterId = printerIds[index];
      console.log(`Sending test print to ${selectedPrinterId}...`);

      try {
        await sendTestPrint(selectedPrinterId);
        console.log("Test print sent successfully!");
      } catch (error) {
        console.error(`Failed to send test print: ${error.message}`);
      }

      rl.close();
    });
  } catch (error) {
    console.error(`Error: ${error.message}`);
    rl.close();
    process.exit(1);
  }
}

// Run the main function
main();
