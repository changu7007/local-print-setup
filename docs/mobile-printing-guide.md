# Mobile Printing Guide

This guide explains how to use the Restaurant Print Agent with mobile devices, tablets, and web browsers.

## Overview

The Restaurant Print Agent now includes a mobile-friendly interface that allows you to:

1. Print receipts and kitchen order tickets (KOTs) from any device with a web browser
2. Preview print content before sending it to the printer
3. Use templates for common print formats
4. Send custom text or JSON content to printers

## Getting Started

### Accessing the Mobile Interface

1. Make sure your Restaurant Print Agent is running on your local network
2. From your mobile device, open a web browser and navigate to:
   ```
   http://<print-agent-ip>:3000/mobile
   ```
   Replace `<print-agent-ip>` with the IP address of the computer running the print agent.

### Setting Up Network Access

For mobile devices to access the print agent, ensure:

1. The device running the print agent and your mobile device are on the same network
2. Your firewall allows connections to port 3000
3. The print agent is configured with the correct printer mappings

## Using the Mobile Interface

### Printing a Kitchen Order Ticket (KOT)

1. Open the mobile interface in your browser
2. Select the printer from the dropdown menu
3. Choose "Kitchen Order Ticket (KOT)" as the content type
4. Edit the JSON template with your order details:
   - Update restaurant name, KOT number, and customer details
   - Add or modify items with quantities and statuses
5. Click the "Print" button to send the job to the printer

### Printing a Bill/Receipt

1. Open the mobile interface in your browser
2. Select the printer from the dropdown menu
3. Choose "Bill/Receipt" as the content type
4. Edit the JSON template with your bill details:
   - Update restaurant name, invoice number, and customer details
   - Add or modify items with quantities and prices
   - Adjust tax and total amounts
5. Click the "Print" button to send the job to the printer

### Printing Plain Text

1. Open the mobile interface in your browser
2. Select the printer from the dropdown menu
3. Choose "Plain Text" as the content type
4. Enter the text you want to print
5. Click the "Print" button to send the job to the printer

## Integrating with Your PWA or Web App

You can integrate the print agent with your Progressive Web App (PWA) or web application by making API calls to the print agent's endpoints.

### API Endpoints

#### Send Print Job

```
POST http://<print-agent-ip>:3000/mobile-print
```

Request body:

```json
{
  "printerId": "printer-id",
  "content": {
    "type": "KOT",
    "content": {
      "header": {
        "restaurantName": "RESTAURANT NAME",
        "kotNumber": "KOT-001",
        "kotType": "NEW KOT",
        "customerName": "CUSTOMER",
        "orderType": "DINE IN",
        "date": "5/15/2023, 10:30:45 AM"
      },
      "items": [
        {
          "name": "Item 1",
          "quantity": 1,
          "status": "NEW"
        }
      ],
      "footer": {
        "totalItems": 1
      },
      "orderedBy": "Staff Name"
    }
  },
  "options": {
    "paperWidth": "MM_58",
    "cutPaper": true
  }
}
```

Response:

```json
{
  "success": true,
  "error": null,
  "printerId": "printer-id",
  "previewUrl": "/print-preview/printer-id/1684123456789"
}
```

#### Get Printers

```
GET http://<print-agent-ip>:3000/printers
```

Response:

```json
{
  "printer-1": "192.168.1.100:9100",
  "kitchen": "192.168.1.101:9100",
  "receipt": "192.168.1.102:9100"
}
```

### Example JavaScript Integration

```javascript
// Function to send a print job from your web app
async function sendPrintJob(printerId, content) {
  try {
    const response = await fetch("http://print-agent-ip:3000/mobile-print", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        printerId,
        content,
        options: {
          paperWidth: "MM_58",
          cutPaper: true,
        },
      }),
    });

    const result = await response.json();

    if (result.success) {
      console.log("Print job sent successfully!");
      return result;
    } else {
      console.error("Print failed:", result.error);
      throw new Error(result.error);
    }
  } catch (error) {
    console.error("Error sending print job:", error);
    throw error;
  }
}
```

## Troubleshooting

### Common Issues

1. **Cannot connect to print agent**

   - Ensure your device and the print agent are on the same network
   - Check if the print agent is running
   - Verify the IP address and port are correct

2. **Print job fails**

   - Check if the printer is online and has paper
   - Verify the printer ID exists in the print agent's configuration
   - Check the JSON format for errors

3. **Formatting issues**
   - Adjust the content structure to match the expected format
   - Check the paper width setting matches your printer
   - For text wrapping issues, try reducing the text length or using a wider paper format

### Getting Help

If you encounter issues not covered in this guide, check the print agent logs for more detailed error messages. The logs can be found in the console where the print agent is running.

## Security Considerations

The mobile interface is designed for use on trusted networks only. For production use, consider:

1. Adding authentication to the print agent
2. Using HTTPS for secure connections
3. Restricting access to the print agent to specific IP addresses
4. Running the print agent behind a reverse proxy with proper security controls

## Next Steps

- Customize the print templates to match your restaurant's branding
- Integrate the print agent with your existing POS system
- Set up multiple printers for different purposes (kitchen, receipts, etc.)
- Configure automatic failover to backup printers
