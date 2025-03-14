/**
 * Auto-Start Setup Script for Restaurant Print Agent
 *
 * This script helps set up auto-start for the print agent on Windows, macOS, and Linux.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const os = require("os");

// Get the current platform
const platform = process.platform;

// Get the current directory
const currentDir = __dirname;

// Get the path to the main script
const mainScriptPath = path.join(currentDir, "local-print-agent.js");

// Function to set up auto-start on Windows
function setupWindowsAutoStart() {
  try {
    console.log("Setting up auto-start on Windows...");

    // Create a shortcut in the startup folder
    const startupFolder = path.join(
      os.homedir(),
      "AppData",
      "Roaming",
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Startup"
    );

    // Create a VBScript to create the shortcut
    const vbsPath = path.join(currentDir, "create-shortcut.vbs");
    const shortcutPath = path.join(startupFolder, "Restaurant Print Agent.lnk");
    const nodePath = process.execPath;

    const vbsContent = `
      Set WshShell = WScript.CreateObject("WScript.Shell")
      Set shortcut = WshShell.CreateShortcut("${shortcutPath.replace(
        /\\/g,
        "\\\\"
      )}")
      shortcut.TargetPath = "${nodePath.replace(/\\/g, "\\\\")}"
      shortcut.Arguments = "${mainScriptPath.replace(/\\/g, "\\\\")}"
      shortcut.WorkingDirectory = "${currentDir.replace(/\\/g, "\\\\")}"
      shortcut.Description = "Restaurant Print Agent"
      shortcut.Save
    `;

    fs.writeFileSync(vbsPath, vbsContent);

    // Run the VBScript
    execSync(`cscript //nologo "${vbsPath}"`);

    // Delete the VBScript
    fs.unlinkSync(vbsPath);

    console.log(`Auto-start shortcut created at: ${shortcutPath}`);
    console.log(
      "The print agent will now start automatically when you log in."
    );

    return true;
  } catch (error) {
    console.error("Error setting up auto-start on Windows:", error);
    return false;
  }
}

// Function to set up auto-start on macOS
function setupMacOSAutoStart() {
  try {
    console.log("Setting up auto-start on macOS...");

    // Create a launch agent plist file
    const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");

    // Create the directory if it doesn't exist
    if (!fs.existsSync(launchAgentsDir)) {
      fs.mkdirSync(launchAgentsDir, { recursive: true });
    }

    const plistPath = path.join(
      launchAgentsDir,
      "com.restaurant.printagent.plist"
    );
    const nodePath = process.execPath;

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.restaurant.printagent</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${mainScriptPath}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${currentDir}</string>
  <key>StandardOutPath</key>
  <string>${path.join(currentDir, "stdout.log")}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(currentDir, "stderr.log")}</string>
</dict>
</plist>`;

    fs.writeFileSync(plistPath, plistContent);

    // Load the launch agent
    execSync(`launchctl load "${plistPath}"`);

    console.log(`Launch agent created at: ${plistPath}`);
    console.log(
      "The print agent will now start automatically when you log in."
    );

    return true;
  } catch (error) {
    console.error("Error setting up auto-start on macOS:", error);
    return false;
  }
}

// Function to set up auto-start on Linux
function setupLinuxAutoStart() {
  try {
    console.log("Setting up auto-start on Linux...");

    // Create a desktop entry in the autostart directory
    const autostartDir = path.join(os.homedir(), ".config", "autostart");

    // Create the directory if it doesn't exist
    if (!fs.existsSync(autostartDir)) {
      fs.mkdirSync(autostartDir, { recursive: true });
    }

    const desktopPath = path.join(
      autostartDir,
      "restaurant-print-agent.desktop"
    );
    const nodePath = process.execPath;

    const desktopContent = `[Desktop Entry]
Type=Application
Name=Restaurant Print Agent
Exec=${nodePath} ${mainScriptPath}
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
Comment=Local print agent for restaurant POS system
`;

    fs.writeFileSync(desktopPath, desktopContent);

    // Make the file executable
    fs.chmodSync(desktopPath, "755");

    console.log(`Desktop entry created at: ${desktopPath}`);
    console.log(
      "The print agent will now start automatically when you log in."
    );

    return true;
  } catch (error) {
    console.error("Error setting up auto-start on Linux:", error);
    return false;
  }
}

// Main function
function main() {
  console.log("Restaurant Print Agent - Auto-Start Setup");
  console.log("=========================================");
  console.log(`Platform: ${platform}`);
  console.log(`Current directory: ${currentDir}`);
  console.log(`Main script: ${mainScriptPath}`);
  console.log("");

  let success = false;

  switch (platform) {
    case "win32":
      success = setupWindowsAutoStart();
      break;
    case "darwin":
      success = setupMacOSAutoStart();
      break;
    case "linux":
      success = setupLinuxAutoStart();
      break;
    default:
      console.error(`Unsupported platform: ${platform}`);
      process.exit(1);
  }

  if (success) {
    console.log("");
    console.log("Auto-start setup completed successfully!");
    process.exit(0);
  } else {
    console.error("");
    console.error(
      "Auto-start setup failed. Please try again or set up auto-start manually."
    );
    process.exit(1);
  }
}

// Run the main function
main();
