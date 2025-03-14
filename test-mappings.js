/**
 * Test script for printer mappings
 *
 * This script tests the printer mappings configuration in the print agent.
 * It loads the printer mappings from the configuration file and displays them.
 */

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

// Function to load printer mappings
function loadPrinterMappings() {
  try {
    const mappingsPath = path.join(__dirname, "printer-mappings.json");

    if (fs.existsSync(mappingsPath)) {
      const mappingsData = fs.readFileSync(mappingsPath, "utf8");
      return JSON.parse(mappingsData);
    } else {
      console.log("No printer mappings file found. Creating a default one.");

      // Create default mappings for testing
      const defaultMappings = {
        "test-printer-1": "127.0.0.1:9100",
        "test-printer-2": "127.0.0.1:9100",
      };

      // Save default mappings
      fs.writeFileSync(mappingsPath, JSON.stringify(defaultMappings, null, 2));

      return defaultMappings;
    }
  } catch (error) {
    console.error("Error loading printer mappings:", error);
    return {};
  }
}

// Function to test TCP connection to a printer
async function testPrinterConnection(ipAddress, port) {
  const net = require("net");

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let connected = false;

    // Set a timeout for the connection attempt
    socket.setTimeout(3000);

    socket.on("connect", () => {
      connected = true;
      console.log(`Successfully connected to ${ipAddress}:${port}`);
      socket.end();
      resolve(true);
    });

    socket.on("timeout", () => {
      console.log(`Connection to ${ipAddress}:${port} timed out`);
      socket.destroy();
      resolve(false);
    });

    socket.on("error", (error) => {
      console.log(`Error connecting to ${ipAddress}:${port}: ${error.message}`);
      resolve(false);
    });

    // Attempt to connect
    socket.connect(port, ipAddress);
  });
}

// Main function
async function main() {
  console.log("=== Print Agent Printer Mappings Test ===");

  // Load printer mappings
  const printerMappings = loadPrinterMappings();

  console.log("\nPrinter Mappings:");
  console.log(JSON.stringify(printerMappings, null, 2));

  // Test connections to all printers
  console.log("\nTesting printer connections:");

  for (const [printerId, address] of Object.entries(printerMappings)) {
    const [ipAddress, portStr] = address.split(":");
    const port = parseInt(portStr, 10);

    console.log(
      `\nTesting connection to printer "${printerId}" at ${ipAddress}:${port}...`
    );
    const connected = await testPrinterConnection(ipAddress, port);

    console.log(
      `Printer "${printerId}" is ${connected ? "ONLINE" : "OFFLINE"}`
    );
  }

  console.log("\n=== Test Complete ===");
}

// Run the main function
main().catch((error) => {
  console.error("Error running test:", error);
});
