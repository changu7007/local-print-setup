const ngrok = require("ngrok");
const axios = require("axios");
const { spawn } = require("child_process");
require("dotenv").config();

async function startServices() {
  try {
    // Start the print agent server in the background
    const printAgent = spawn("node", ["local-print-agent.js"], {
      stdio: "inherit",
    });

    // Wait a moment for the server to start
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Start ngrok
    const url = await ngrok.connect({
      addr: 3000,
      authtoken: process.env.NGROK_AUTH_TOKEN, // You'll need to add this to your .env file
    });

    console.log("Ngrok URL:", url);

    // Update the API with the new URL
    const restaurantId = process.env.RESTAURANT_ID; // Add this to your .env file
    const apiBaseUrl = process.env.API_BASE_URL; // Add this to your .env file

    await axios.patch(
      `${apiBaseUrl}/${restaurantId}/print-details/update-local-print-url`,
      {
        url: url,
      }
    );

    console.log("Successfully updated print URL in API");

    // Handle process termination
    process.on("SIGTERM", async () => {
      await ngrok.kill();
      printAgent.kill();
      process.exit(0);
    });
  } catch (error) {
    console.error("Error starting services:", error);
    process.exit(1);
  }
}

startServices();
