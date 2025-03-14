# Restaurant Print Agent

A local print agent for restaurant POS systems that allows printing from web applications to local printers.

## Features

- Connect to network printers (TCP/IP)
- WebSocket integration for real-time printing from web applications
- Fallback polling mechanism for reliability
- Browser integration for web-based POS systems
- Auto-start with system (when using Electron app)
- Status page and test print functionality

## Requirements

- Node.js 14.x or higher
- Network-connected printers with TCP/IP support

## Installation

### Basic Installation (Node.js)

1. Clone or download this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Copy `.env.example` to `.env` and configure your settings:
   ```
   cp .env.example .env
   ```
4. Edit the `.env` file with your restaurant's API token and ID
5. Configure your printers in `printer-mappings.json`
6. Start the agent:
   ```
   npm start
   ```

### Desktop Application Installation (Electron)

1. Clone or download this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Copy `.env.example` to `.env` and configure your settings:
   ```
   cp .env.example .env
   ```
4. Edit the `.env` file with your restaurant's API token and ID
5. Configure your printers in `printer-mappings.json`
6. Build the desktop application:
   ```
   npm run build-electron
   ```
7. Install the generated application from the `dist` folder
8. The application will start automatically and can be configured to run at system startup

## Configuration

### Environment Variables

Edit the `.env` file to configure the following settings:

- `API_URL`: URL of your restaurant API
- `API_TOKEN`: Authentication token for your API
- `RESTAURANT_ID`: ID of your restaurant
- `WS_ENDPOINT`: WebSocket endpoint for real-time updates
- `POLL_INTERVAL`: How often to poll for new print jobs (in milliseconds)
- `LOG_LEVEL`: Logging level (debug, info, warn, error)
- `ENABLE_BROWSER_INTEGRATION`: Enable browser integration (true/false)
- `BROWSER_PORT`: Port for browser WebSocket server
- `AUTO_START`: Start with system (Electron only)
- `MINIMIZE_TO_TRAY`: Minimize to system tray (Electron only)
- `PORT`: HTTP server port

### Printer Mappings

Edit the `printer-mappings.json` file to map printer IDs to local IP addresses and ports:

```json
{
  "printer-1": "192.168.1.100:9100",
  "kitchen-printer": "192.168.1.102:9100",
  "bar-printer": "192.168.1.103:9100",
  "receipt-printer": "192.168.1.104:9100"
}
```

## Web Integration

To integrate with your web application, include the `browser-print-client.js` file in your web application:

```html
<script src="path/to/browser-print-client.js"></script>
```

Then use the PrintClient class to connect to the local print agent:

```javascript
// Initialize print client
const printClient = new PrintClient({
  agentHost: "localhost",
  agentPort: 3001,
  autoReconnect: true,
});

// Connect to the print agent
printClient
  .connect()
  .then(() => {
    console.log("Connected to print agent");

    // Get available printers
    return printClient.getPrinters();
  })
  .then((printers) => {
    console.log("Available printers:", printers);
  })
  .catch((error) => {
    console.error("Error:", error);
  });

// Print a receipt
async function printReceipt() {
  try {
    const receipt = {
      title: "RESTAURANT RECEIPT",
      items: [
        { name: "Burger", price: 9.99, quantity: 1 },
        { name: "Fries", price: 3.99, quantity: 2 },
        { name: "Soda", price: 1.99, quantity: 2 },
      ],
      total: 21.95,
    };

    const options = {
      cutPaper: true,
      openCashDrawer: false,
    };

    // Format the receipt
    const content = printClient.formatReceipt(receipt, options);

    // Send to printer
    const result = await printClient.print("receipt-printer", content, options);

    if (result.success) {
      console.log("Print job completed successfully");
    } else {
      console.error("Print job failed:", result.error);
    }
  } catch (error) {
    console.error("Print error:", error);
  }
}
```

See the `browser-print-example.html` file for a complete example.

## API Server Integration

The print agent communicates with your API server to get print jobs and update their status. You need to implement the following endpoints in your API:

1. `GET /api/print-jobs/pending?restaurantId=<id>` - Get pending print jobs for a restaurant
2. `PUT /api/print-jobs/:jobId/status` - Update print job status

## Auto-Start Configuration

### Windows

1. Create a shortcut to the application
2. Press `Win+R` and type `shell:startup`
3. Copy the shortcut to the Startup folder

### macOS

1. Go to System Preferences > Users & Groups
2. Select your user and click on "Login Items"
3. Click the "+" button and select the application

### Linux

1. Create a `.desktop` file in `~/.config/autostart/`
2. Add the following content:
   ```
   [Desktop Entry]
   Type=Application
   Name=Restaurant Print Agent
   Exec=/path/to/restaurant-print-agent
   Hidden=false
   NoDisplay=false
   X-GNOME-Autostart-enabled=true
   ```

## Troubleshooting

### Print Agent Not Starting

- Check if Node.js is installed correctly
- Verify that all dependencies are installed
- Check the log files for errors

### Cannot Connect to Printers

- Verify that the printer IP addresses are correct
- Check if the printers are turned on and connected to the network
- Try pinging the printer IP addresses
- Check if port 9100 is open on the printers

### Browser Cannot Connect to Print Agent

- Make sure the print agent is running
- Check if browser integration is enabled in the `.env` file
- Verify that the browser WebSocket port is not blocked by a firewall
- Check if the browser supports WebSockets

## License

This project is licensed under the MIT License - see the LICENSE file for details.
