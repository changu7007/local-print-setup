# Mobile and Tablet Integration Guide

This guide explains how to integrate the Restaurant Print Agent with your mobile and tablet applications using the PrintService.

## Overview

The PrintService now includes mobile and tablet support, allowing you to:

1. Print receipts and kitchen order tickets (KOTs) from any mobile device or tablet
2. Automatically detect device type and use the appropriate printing method
3. Seamlessly integrate with your existing web application or PWA
4. Fall back to alternative printing methods when needed

## Integration Steps

### 1. Update Your Application

First, make sure you're using the latest version of the PrintService in your application:

```typescript
import { PrinterService } from "@/lib/service/printers/print-service";

// Initialize the service with your restaurant ID
const printerService = new PrinterService("your-restaurant-id");
```

### 2. Print from Mobile or Tablet

Use the `printFromMobile` method to print content from mobile devices:

```typescript
// Example: Print a KOT from a mobile device
async function printKOTFromMobile(kotData, printerId) {
  const content = {
    type: "KOT",
    header: {
      restaurantName: "RESTAURANT NAME",
      kotNumber: "KOT-001",
      kotType: "NEW KOT",
      customerName: "CUSTOMER",
      orderType: "DINE IN",
      date: new Date().toLocaleString(),
    },
    items: [
      {
        name: "Item 1",
        quantity: 1,
        status: "NEW",
      },
    ],
    footer: {
      totalItems: 1,
    },
    orderedBy: "Staff Name",
  };

  const success = await printerService.printFromMobile(content, printerId, {
    paperWidth: "MM_58",
    cutPaper: true,
  });

  if (success) {
    console.log("Print job sent successfully!");
  } else {
    console.error("Failed to print");
  }
}
```

### 3. Get Available Printers

To display a list of available printers to your users:

```typescript
async function loadPrinters() {
  const printers = await printerService.getAvailablePrinters();

  // Display printers in your UI
  const printerSelect = document.getElementById("printer-select");
  printerSelect.innerHTML = "";

  printers.forEach((printer) => {
    const option = document.createElement("option");
    option.value = printer.id;
    option.textContent = `${printer.id} (${printer.address})`;
    printerSelect.appendChild(option);
  });
}
```

### 4. Create a Print Button in Your UI

Add a print button to your application:

```html
<button id="print-button">Print Receipt</button>

<script>
  document
    .getElementById("print-button")
    .addEventListener("click", async () => {
      const printerId = document.getElementById("printer-select").value;

      // Get receipt data from your application
      const receiptData = getReceiptData();

      // Print using the service
      const success = await printerService.printFromMobile(
        receiptData,
        printerId
      );

      if (success) {
        showSuccessMessage("Receipt printed successfully!");
      } else {
        showErrorMessage("Failed to print receipt. Please try again.");
      }
    });
</script>
```

## How It Works

The PrintService automatically detects whether the user is on a mobile device or tablet and uses the appropriate printing method:

1. **Mobile/Tablet Devices**: Uses the HTTP API endpoint (`/mobile-print`) to send print jobs
2. **Desktop Devices**: Uses WebSocket connection for real-time printing
3. **Fallback Mechanism**: If the preferred method fails, falls back to alternative methods

## Technical Details

### Device Detection

The service uses a combination of user agent detection and screen size to determine if the user is on a mobile device or tablet:

```typescript
private isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;

  const userAgent = window.navigator.userAgent.toLowerCase();
  const isMobile = /iphone|ipad|ipod|android|blackberry|windows phone|opera mini|silk/i.test(userAgent);

  // Also check screen size for tablets
  const isTablet =
    (window.innerWidth <= 1024 && window.innerWidth > 480) ||
    /ipad/i.test(userAgent);

  return isMobile || isTablet;
}
```

### API Endpoints

The service communicates with the following endpoints:

- **GET /printers**: Retrieves a list of available printers
- **POST /mobile-print**: Sends a print job to a specific printer

### Print Request Format

When sending a print job, the request should have this format:

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

## Troubleshooting

### Common Issues

1. **Cannot connect to print agent**

   - Ensure the print agent is running on your network
   - Check that mobile devices can access the print agent's IP address
   - Verify that port 3000 is open in your firewall

2. **Print job fails**

   - Check if the printer is online and has paper
   - Verify the printer ID exists in the print agent's configuration
   - Check the JSON format for errors

3. **Device detection issues**
   - If your device is not correctly detected as mobile/tablet, you can force mobile mode:
   ```typescript
   // Force mobile printing mode
   const success = await printerService.printFromMobile(
     content,
     printerId,
     options
   );
   ```

## Security Considerations

When implementing mobile printing, consider these security aspects:

1. **Network Security**: The print agent should only be accessible on trusted networks
2. **Authentication**: Consider adding authentication to the print agent API
3. **HTTPS**: Use HTTPS for secure connections in production environments
4. **Access Control**: Restrict access to the print agent to specific IP addresses

## Next Steps

1. **Test on Various Devices**: Test printing from different mobile devices and tablets
2. **Customize UI**: Create a mobile-friendly UI for your printing interface
3. **Error Handling**: Implement robust error handling for network issues
4. **Offline Support**: Consider adding offline queuing for print jobs

For more information, see the [Mobile Printing Guide](./mobile-printing-guide.md) for end users.
