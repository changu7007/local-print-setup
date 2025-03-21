/**
 * Print Formatter
 *
 * This utility provides formatting functions that match the ContentFormatter class
 * from the print-service.ts file to ensure consistent print output.
 */

class PrintFormatter {
  constructor(config = {}) {
    // Default configuration matching the MM_58 format from print-service.ts
    this.config = {
      lineWidth: config.lineWidth || 384,
      charsPerLine: config.charsPerLine || 32,
      normalSize: config.normalSize || 0, // Normal size (0)
      largeSize: config.largeSize || 24, // Double width and height (24)
      mediumSize: config.mediumSize || 16, // Double height (16)
      smallSize: config.smallSize || 0, // Normal size (0)
      ...config,
    };
  }

  /**
   * Update the formatter configuration
   * @param {Object} newConfig - New configuration
   */
  updateConfig(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig,
    };
  }

  /**
   * Center text within the line width
   * @param {string} text - Text to center
   * @returns {string} Centered text
   */
  center(text) {
    if (text.length >= this.config.charsPerLine) {
      return text.substring(0, this.config.charsPerLine);
    }

    const padding = Math.floor((this.config.charsPerLine - text.length) / 2);
    const leftPadding = " ".repeat(Math.max(0, padding));
    const rightPadding = " ".repeat(
      Math.max(0, this.config.charsPerLine - text.length - padding)
    );

    return leftPadding + text + rightPadding;
  }

  /**
   * Create a divider line
   * @returns {string} Divider line
   */
  divider() {
    return "-".repeat(this.config.charsPerLine);
  }

  /**
   * Format key-value pair
   * @param {string} key - Key
   * @param {string} value - Value
   * @returns {string} Formatted key-value pair
   */
  keyValue(key, value) {
    const maxKeyLength = Math.floor(this.config.charsPerLine * 0.4);
    const truncatedKey = key.slice(0, maxKeyLength);
    const padding =
      this.config.charsPerLine - truncatedKey.length - value.length;
    return `${truncatedKey}${" ".repeat(Math.max(0, padding))}${value}`;
  }

  /**
   * Format a bill item
   * @param {string} name - Item name
   * @param {number} quantity - Quantity
   * @param {number} price - Price
   * @returns {string} Formatted bill item
   */
  billItem(name, quantity, price) {
    const maxNameLength = this.config.charsPerLine - 20; // Reserve space for qty and price
    const truncatedName = name.slice(0, maxNameLength);
    const qtyStr = `x${quantity}`;
    const priceStr = `Rs.${price.toFixed(2)}`;
    const padding =
      this.config.charsPerLine -
      truncatedName.length -
      qtyStr.length -
      priceStr.length;
    return `${truncatedName}${" ".repeat(
      Math.max(0, padding)
    )}${qtyStr} ${priceStr}`;
  }

  /**
   * Format a KOT item
   * @param {string} name - Item name
   * @param {number} quantity - Quantity
   * @returns {string} Formatted KOT item
   */
  kotItem(name, quantity) {
    const maxNameLength = this.config.charsPerLine - 6; // Reserve space for quantity
    const truncatedName = name.slice(0, maxNameLength);
    const qtyStr = `x${quantity}`;
    const padding =
      this.config.charsPerLine - truncatedName.length - qtyStr.length;
    return `${truncatedName}${" ".repeat(Math.max(0, padding))}${qtyStr}`;
  }

  /**
   * Wrap text to fit within the line width
   * @param {string} text - Text to wrap
   * @returns {string} Wrapped text
   */
  wrapText(text) {
    const words = text.split(" ");
    const lines = [];
    let currentLine = "";

    words.forEach((word) => {
      if (currentLine.length + word.length + 1 <= this.config.charsPerLine) {
        currentLine += (currentLine.length === 0 ? "" : " ") + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    });

    if (currentLine.length > 0) {
      lines.push(currentLine);
    }

    return lines.join("\n");
  }

  /**
   * Format a KOT table
   * @param {Array} items - Array of items
   * @returns {Array} Array of formatted lines
   */
  formatKOTTable(items) {
    const ratios = [8, 2, 4]; // Adjusted ratios for better spacing: Item, Qty, Status
    const header = ["Item", "Qty", "Status"];
    const rows = [];

    // Add header with proper spacing
    const headerRow = this.tableRow(header, ratios)[0];
    rows.push(headerRow);
    rows.push(this.divider());

    // Add items with proper spacing
    items.forEach((item) => {
      // Get status indicator if available
      let statusDisplay = "";
      if (item.status) {
        const statusIndicator = this.getStatusIndicator(item.status);
        if (statusIndicator) {
          statusDisplay = `[${statusIndicator}]`;
        }
      }

      const itemRows = this.tableRow(
        [
          item.name,
          (item.quantity?.toString() || "0").padStart(2, " "), // Right align numbers
          statusDisplay,
        ],
        ratios
      );
      rows.push(...itemRows);
    });

    return rows;
  }

  /**
   * Get status indicator
   * @private
   */
  getStatusIndicator(status) {
    switch (status.toUpperCase()) {
      case "NEW":
        return "N";
      case "MODIFIED":
        return "M";
      case "CANCEL":
      case "CANCELLED":
        return "C";
      case "REPEAT":
        return "R";
      default:
        return "";
    }
  }

  /**
   * Format a bill table
   * @param {Array} items - Array of items
   * @returns {Array} Array of formatted lines
   */
  formatBillTable(items) {
    const ratios = [6, 5, 2, 10]; // Adjusted ratios for better spacing: Item, Price, Qty, Total
    const header = ["Item", "Price", "Qty", "Total"];
    const rows = [];

    // Add header with proper spacing
    const headerRow = this.tableRow(header, ratios)[0];
    rows.push(headerRow);
    rows.push(this.divider());

    // Add items with proper spacing
    items.forEach((item) => {
      const total = (item.price || 0) * (item.quantity || 0);
      const itemRows = this.tableRow(
        [
          item.name,
          `Rs.${item.price || 0}`,
          (item.quantity?.toString() || "0").padStart(2, " "), // Right align numbers
          `Rs.${total.toFixed(2)}`,
        ],
        ratios
      );
      rows.push(...itemRows);
    });

    return rows;
  }

  /**
   * Format a table row
   * @private
   */
  tableRow(columns, ratios) {
    const totalWidth = this.config.charsPerLine;
    const columnWidths = this.calculateColumnWidths(totalWidth, ratios);

    // Process each column
    const processedColumns = columns.map((col, index) => {
      const width = columnWidths[index];
      return this.wrapColumnText(col, width);
    });

    // Combine into rows
    const maxRows = Math.max(...processedColumns.map((col) => col.length));
    const rows = [];

    for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
      let row = "";
      processedColumns.forEach((col, colIndex) => {
        const cell = col[rowIndex] || "";
        const width = columnWidths[colIndex];
        const padding = width - cell.length;
        // Add extra space between columns
        const columnSpacing =
          colIndex < processedColumns.length - 1 ? "  " : "";

        // For wrapped lines (not first line), add proper column padding
        if (rowIndex > 0 && colIndex > 0) {
          // Calculate the total width of previous columns including spacing
          const previousColumnsWidth =
            columnWidths.slice(0, colIndex).reduce((sum, w) => sum + w, 0) +
            colIndex * 2; // Add spacing between columns
          row += " ".repeat(previousColumnsWidth);
        }

        row += cell + " ".repeat(Math.max(0, padding)) + columnSpacing;
      });
      rows.push(row.trimEnd());
    }

    return rows;
  }

  /**
   * Wrap text for a specific column width
   * @private
   */
  wrapColumnText(text, width) {
    if (!text) return [""];

    const words = text.split(" ");
    const lines = [];
    let currentLine = "";

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const nextWord = words[i + 1];

      // If adding this word would exceed the width
      if (currentLine.length + word.length + 1 > width) {
        // If we have a current line, add it
        if (currentLine.length > 0) {
          lines.push(currentLine.trim());
        }

        // If the word itself is longer than the width, split it
        if (word.length > width) {
          let remainingWord = word;
          while (remainingWord.length > 0) {
            lines.push(remainingWord.substring(0, width));
            remainingWord = remainingWord.substring(width);
          }
        } else {
          currentLine = word;
        }
      } else {
        // Add word to current line
        currentLine += (currentLine.length === 0 ? "" : " ") + word;

        // If this is the last word or next word would exceed width, add current line
        if (
          i === words.length - 1 ||
          (nextWord && currentLine.length + nextWord.length + 1 > width)
        ) {
          lines.push(currentLine.trim());
          currentLine = "";
        }
      }
    }

    // Add any remaining text
    if (currentLine.length > 0) {
      lines.push(currentLine.trim());
    }

    return lines;
  }

  /**
   * Calculate column widths based on printer width
   * @private
   */
  calculateColumnWidths(totalWidth, columns) {
    const totalRatio = columns.reduce((a, b) => a + b, 0);
    return columns.map((ratio) =>
      Math.floor((ratio / totalRatio) * totalWidth)
    );
  }

  /**
   * Format a KOT content
   * @param {Object} content - KOT content
   * @returns {string} Formatted KOT content
   */
  formatKOTContent(content) {
    const { header, items, footer, note, orderedBy } = content;
    let output = "";

    // ESC/POS commands for text alignment and formatting
    const ESC = "\x1B";
    const CENTER = `${ESC}a\x01`;
    const LEFT = `${ESC}a\x00`;
    const BOLD_ON = `${ESC}E\x01`;
    const BOLD_OFF = `${ESC}E\x00`;
    const INIT = `${ESC}@`; // Initialize printer
    const CUT = `${ESC}d\x03`; // Cut paper with 3-line feed
    const BEEP = `${ESC}B\x02\x01`; // Beep sound (2 beeps, 1 duration)

    // Font size commands - using fixed hex values
    const NORMAL_SIZE = `${ESC}!\x00`; // Normal size
    const LARGE_SIZE = `${ESC}!\x18`; // Double height and width (24 = 0x18)
    const MEDIUM_SIZE = `${ESC}!\x10`; // Double height (16 = 0x10)
    const SMALL_SIZE = `${ESC}!\x00`; // Small size (0 = 0x00)

    // Initialize printer
    output += INIT;
    output += "\n"; // Extra spacing at the top

    // Center KOT ORDER with bold and large size
    // output +=
    //   CENTER +
    //   BOLD_ON +
    //   LARGE_SIZE +
    //   "KOT ORDER" +
    //   NORMAL_SIZE +
    //   BOLD_OFF +
    //   "\n";

    // KOT Type
    output +=
      CENTER +
      BOLD_ON +
      MEDIUM_SIZE +
      `(${header.kotType})` +
      NORMAL_SIZE +
      BOLD_OFF +
      "\n";

    // Restaurant name
    output +=
      CENTER +
      BOLD_ON +
      MEDIUM_SIZE +
      header.restaurantName.toUpperCase() +
      NORMAL_SIZE +
      BOLD_OFF +
      "\n\n";

    // Divider
    output += LEFT + this.divider() + "\n";

    // KOT details with extra spacing
    output +=
      LEFT +
      BOLD_ON +
      MEDIUM_SIZE +
      this.keyValue("KOT No:", header.kotNumber || "N/A") +
      NORMAL_SIZE +
      BOLD_OFF +
      "\n";
    output +=
      LEFT +
      BOLD_ON +
      NORMAL_SIZE +
      this.keyValue("To:", header.customerName) +
      NORMAL_SIZE +
      BOLD_OFF +
      "\n";
    output +=
      LEFT +
      BOLD_ON +
      MEDIUM_SIZE +
      this.keyValue("Type:", header.orderType) +
      NORMAL_SIZE +
      BOLD_OFF +
      "\n";
    output +=
      LEFT +
      BOLD_ON +
      NORMAL_SIZE +
      this.keyValue("Date:", header.date) +
      NORMAL_SIZE +
      BOLD_OFF +
      "\n";

    // Divider
    output += LEFT + this.divider() + "\n";

    // Add table header with bold and medium size
    output +=
      LEFT +
      BOLD_ON +
      "Item                                Qty Status" +
      BOLD_OFF +
      "\n";
    output += LEFT + this.divider() + "\n";

    // Add items with proper spacing and capitalization
    if (items && items.length > 0) {
      items.forEach((item) => {
        // Get status indicator if available
        let statusDisplay = "";
        if (item.status) {
          const statusIndicator = this.getStatusIndicator(item.status);
          if (statusIndicator) {
            statusDisplay = `[${statusIndicator}]`;
          }
        }

        // Calculate available width for item name based on printer width
        const nameWidth = Math.max(10, this.config.charsPerLine - 12); // Reserve space for qty and status

        // Format the item name with proper wrapping if needed
        // Convert item name to uppercase for better visibility
        const name = item.name.trim().toUpperCase();

        if (name.length <= nameWidth) {
          // Simple case: name fits on one line
          const paddedName = name.padEnd(nameWidth, " ");
          const qty = (item.quantity?.toString() || "0").padStart(3, " ");
          const status = statusDisplay.padStart(6, " ");

          output +=
            LEFT +
            MEDIUM_SIZE + // Use medium size for item names
            paddedName +
            BOLD_ON +
            qty +
            BOLD_OFF +
            status +
            NORMAL_SIZE +
            "\n";
        } else {
          // Complex case: name needs to be wrapped
          const firstLine = name.substring(0, nameWidth);
          const remainingText = name.substring(nameWidth);

          // First line with quantity and status
          const qty = (item.quantity?.toString() || "0").padStart(3, " ");
          const status = statusDisplay.padStart(6, " ");

          output +=
            LEFT +
            MEDIUM_SIZE + // Use medium size for item names
            firstLine +
            BOLD_ON +
            qty +
            BOLD_OFF +
            status +
            NORMAL_SIZE +
            "\n";

          // Additional lines for the wrapped text, if any
          if (remainingText) {
            // Split remaining text into chunks of nameWidth
            for (let i = 0; i < remainingText.length; i += nameWidth) {
              const chunk = remainingText.substring(i, i + nameWidth);
              output +=
                LEFT +
                MEDIUM_SIZE + // Use medium size for item names
                chunk.padEnd(nameWidth, " ") +
                "      " +
                NORMAL_SIZE +
                "\n"; // Add spacing where qty and status would be
            }
          }
        }

        // Add extra spacing between items
        output += "\n";
      });
    }

    // Footer
    output += LEFT + this.divider() + "\n";

    if (footer?.totalItems) {
      output +=
        LEFT +
        BOLD_ON +
        NORMAL_SIZE +
        this.keyValue("Total Items:", footer.totalItems.toString()) +
        NORMAL_SIZE +
        BOLD_OFF +
        "\n";
    }

    // Divider for ordered by section
    output += LEFT + this.divider() + "\n";

    // Ordered By section
    if (orderedBy) {
      output +=
        LEFT +
        BOLD_ON +
        this.keyValue("Ordered By:", orderedBy) +
        BOLD_OFF +
        "\n\n";
    } else if (header.waiterName) {
      output +=
        LEFT +
        BOLD_ON +
        this.keyValue("Ordered By:", header.waiterName) +
        BOLD_OFF +
        "\n\n";
    }

    if (note) {
      output +=
        LEFT +
        BOLD_ON +
        NORMAL_SIZE +
        this.keyValue("Cheff Note:", note) +
        NORMAL_SIZE +
        BOLD_OFF +
        "\n\n";
    }

    // Thank you
    // output += "\n";
    // output += CENTER + MEDIUM_SIZE + "Thank you!" + NORMAL_SIZE + "\n";
    // output += "\n\n";

    // Add beep sound
    output += BEEP;

    // Cut paper
    // output += CUT;

    return output;
  }

  /**
   * Format a bill content
   * @param {Object} content - Bill content
   * @returns {string} Formatted bill content
   */
  formatBillContent(content) {
    const { header, items, summary } = content;
    let output = "";

    // ESC/POS commands for text alignment and formatting
    const ESC = "\x1B";
    const CENTER = `${ESC}a\x01`;
    const LEFT = `${ESC}a\x00`;
    const BOLD_ON = `${ESC}E\x01`;
    const BOLD_OFF = `${ESC}E\x00`;
    const INIT = `${ESC}@`; // Initialize printer
    const BEEP = `${ESC}B\x02\x01`; // Beep sound (2 beeps, 1 duration)

    // Font size commands - using fixed hex values
    const NORMAL_SIZE = `${ESC}!\x00`; // Normal size
    const LARGE_SIZE = `${ESC}!\x18`; // Double height and width (24 = 0x18)
    const MEDIUM_SIZE = `${ESC}!\x10`; // Double height (16 = 0x10)
    const SMALL_SIZE = `${ESC}!\x00`; // Small size (0 = 0x00)

    // Initialize
    output += INIT;
    output += "\n\n"; // Extra spacing at the top

    // Bill header
    output +=
      CENTER +
      BOLD_ON +
      NORMAL_SIZE +
      `BILL: ${header.invoice || ""}` +
      NORMAL_SIZE +
      BOLD_OFF +
      "\n";
    output +=
      CENTER +
      BOLD_ON +
      LARGE_SIZE +
      header.restaurantName.toUpperCase() +
      NORMAL_SIZE +
      BOLD_OFF +
      "\n";

    if (header.description) {
      output += CENTER + header.description + "\n";
    }

    if (header.address) {
      output += CENTER + header.address + "\n";
    }

    if (header.gstin) {
      output += CENTER + `GSTIN: ${header.gstin}` + "\n";
    }

    if (header.phoneNo) {
      output += CENTER + `${header.phoneNo}` + "\n";
    }

    if (header.email) {
      output += CENTER + `${header.email}` + "\n\n";
    }

    // Divider
    output += this.divider() + "\n";

    // Bill details with extra spacing
    output +=
      BOLD_ON +
      this.keyValue("Customer", header.customerName) +
      BOLD_OFF +
      "\n";
    output += this.keyValue("Type", header.orderType) + "\n";
    output += this.keyValue("Date", header.date) + "\n";

    // Divider
    output += this.divider() + "\n";

    // Add table header with bold and medium size
    output +=
      LEFT +
      BOLD_ON +
      "Item                         Price  Qty  Total" +
      BOLD_OFF +
      "\n";

    output += this.divider() + "\n";

    // Add items with proper formatting and extra spacing
    if (items && items.length > 0) {
      items.forEach((item) => {
        const total = (item.price || 0) * (item.quantity || 0);

        // Calculate available width for item name
        const nameWidth = Math.max(10, this.config.charsPerLine - 22); // Reserve space for price, qty, total

        // Format the item name with proper wrapping if needed
        // Convert item name to uppercase for better visibility
        const name = item.name.trim();

        if (name.length <= nameWidth) {
          // Simple case: name fits on one line
          const paddedName = name.padEnd(nameWidth, " ");
          const price = `${item.price || 0}`.padStart(8, " ");
          const qty = (item.quantity?.toString() || "0").padStart(3, " ");
          const totalStr = `${total.toFixed(2)}`.padStart(10, " ");

          output +=
            LEFT +
            NORMAL_SIZE + // Use medium size for item names
            paddedName +
            price +
            BOLD_ON +
            qty +
            BOLD_OFF +
            totalStr +
            NORMAL_SIZE +
            "\n";
        } else {
          // Complex case: name needs to be wrapped
          const firstLine = name.substring(0, nameWidth);
          const remainingText = name.substring(nameWidth);

          const price = `Rs.${item.price || 0}`.padStart(8, " ");
          const qty = (item.quantity?.toString() || "0").padStart(3, " ");
          const totalStr = `Rs.${total.toFixed(2)}`.padStart(10, " ");

          output +=
            LEFT +
            NORMAL_SIZE + // Use medium size for item names
            firstLine +
            price +
            BOLD_ON +
            qty +
            BOLD_OFF +
            totalStr +
            NORMAL_SIZE +
            "\n";

          // Additional lines for the wrapped text, if any
          if (remainingText) {
            // Split remaining text into chunks of nameWidth
            for (let i = 0; i < remainingText.length; i += nameWidth) {
              const chunk = remainingText.substring(i, i + nameWidth);
              output +=
                LEFT +
                NORMAL_SIZE + // Use medium size for item names
                chunk.padEnd(nameWidth - 4, " ") +
                "                 " +
                NORMAL_SIZE +
                "\n"; // Add spacing where price, qty, total would be
            }
          }
        }

        // Add extra spacing between items
        output += "\n";
      });
    }

    // Summary with improved formatting
    if (summary) {
      output += this.formatBillSummary(summary);
    }

    // Thank you
    output += "\n";
    output += CENTER + MEDIUM_SIZE + "Thank you!" + NORMAL_SIZE + "\n";
    output += "\n\n\n";

    // Add beep sound
    output += BEEP;

    return output;
  }

  /**
   * Format bill summary
   * @param {Object} summary - Bill summary
   * @returns {string} Formatted bill summary
   */
  formatBillSummary(summary) {
    // ESC/POS commands for text alignment and formatting
    const ESC = "\x1B";
    const BOLD_ON = `${ESC}E\x01`;
    const BOLD_OFF = `${ESC}E\x00`;
    const MEDIUM_SIZE = `${ESC}!\x10`; // Double height (16 = 0x10)
    const NORMAL_SIZE = `${ESC}!\x00`; // Normal size

    let output = "";

    output += this.divider() + "\n";
    output +=
      BOLD_ON +
      this.keyValue("Subtotal", `Rs.${summary.subTotal.toFixed(2)}`) +
      BOLD_OFF +
      "\n";

    output += this.divider() + "\n";
    output +=
      this.keyValue(
        `Discount(${summary.discount}%)`,
        `-Rs.${summary.discountAmount.toFixed(2)}`
      ) + "\n";

    // Always print SGST and CGST, even if they are zero
    output +=
      this.keyValue("SGST (2.5%)", `Rs.${(summary.sgst || 0).toFixed(2)}`) +
      "\n";
    output +=
      this.keyValue("CGST (2.5%)", `Rs.${(summary.cgst || 0).toFixed(2)}`) +
      "\n";
    output +=
      this.keyValue("Round Off", `-Rs.${summary.rounded.toFixed(2)}`) + "\n";

    output += this.divider() + "\n";
    output +=
      BOLD_ON +
      MEDIUM_SIZE +
      this.keyValue("Total", `Rs.${summary.total.toFixed(2)}`) +
      NORMAL_SIZE +
      BOLD_OFF +
      "\n";

    // Payment details
    if (summary.payment) {
      output += this.formatPaymentDetails(summary.payment);
    }

    return output;
  }

  /**
   * Format payment details
   * @param {Object} payment - Payment details
   * @returns {string} Formatted payment details
   */
  formatPaymentDetails(payment) {
    let output = "";

    if (payment.type === "SPLIT" && payment.details) {
      payment.details.forEach((detail) => {
        output +=
          this.keyValue(detail.method, `Rs.${detail.amount.toFixed(2)}`) + "\n";
      });
    }

    return output;
  }
}

module.exports = PrintFormatter;
