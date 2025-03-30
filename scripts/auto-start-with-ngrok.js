const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
require("dotenv").config();

const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";

// Get the full path to start-with-ngrok.js
const scriptPath = path.join(__dirname, "start-with-ngrok.js");
const nodePath = process.execPath;

async function setupAutoStart() {
  try {
    if (isWindows) {
      const startupFolder = path.join(
        process.env.APPDATA,
        "Microsoft\\Windows\\Start Menu\\Programs\\Startup"
      );
      const batPath = path.join(startupFolder, "restaurant-print-agent.bat");

      const batContent = `@echo off
start "" "${nodePath}" "${scriptPath}"`;

      fs.writeFileSync(batPath, batContent);
      console.log("Windows auto-start configured successfully!");
    } else if (isMac) {
      const plistPath = path.join(
        process.env.HOME,
        "Library/LaunchAgents/com.restaurant.printagent.plist"
      );

      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.restaurant.printagent</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${scriptPath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/restaurant-print-agent.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/restaurant-print-agent.error.log</string>
</dict>
</plist>`;

      fs.writeFileSync(plistPath, plistContent);
      exec(`launchctl load ${plistPath}`);
      console.log("macOS auto-start configured successfully!");
    } else if (isLinux) {
      const desktopPath = path.join(
        process.env.HOME,
        ".config/autostart/restaurant-print-agent.desktop"
      );

      const desktopContent = `[Desktop Entry]
Type=Application
Name=Restaurant Print Agent
Exec="${nodePath}" "${scriptPath}"
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true`;

      fs.writeFileSync(desktopPath, desktopContent);
      console.log("Linux auto-start configured successfully!");
    }

    console.log(
      "Auto-start setup complete! The print agent with ngrok will start automatically on system boot."
    );
    console.log(
      "Note: The ngrok URL will be updated in your API when the service starts."
    );
  } catch (error) {
    console.error("Error setting up auto-start:", error);
    process.exit(1);
  }
}

setupAutoStart();
