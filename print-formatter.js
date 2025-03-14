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
      normalSize: config.normalSize || "normal",
      largeSize: config.largeSize || "normal",
      smallSize: config.smallSize || "small",
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
    const DOUBLE_WIDTH = `${ESC}!\x20`;
    const NORMAL_WIDTH = `${ESC}!\x00`;
    const INIT = `${ESC}@`; // Initialize printer
    const CUT = `${ESC}d\x03`; // Cut paper with 3-line feed

    // Initialize printer
    output += INIT;
    output += "\n";

    // Center KOT ORDER with bold and double width
    output += CENTER + BOLD_ON + "KOT ORDER" + BOLD_OFF + "\n";

    // KOT Type
    output += CENTER + BOLD_ON + `(${header.kotType})` + BOLD_OFF + "\n";

    // Restaurant name
    output +=
      CENTER + BOLD_ON + header.restaurantName.toUpperCase() + BOLD_OFF + "\n";

    // Divider
    output += LEFT + this.divider() + "\n";

    // KOT details
    output += LEFT + this.keyValue("KOT No:", header.kotNumber || "N/A") + "\n";
    output += LEFT + this.keyValue("To:", header.customerName) + "\n";
    output += LEFT + this.keyValue("Type:", header.orderType) + "\n";
    output += LEFT + this.keyValue("Date:", header.date) + "\n";

    // Divider
    output += LEFT + this.divider() + "\n";

    // Add table header with bold
    output +=
      LEFT + BOLD_ON + "Item                Qty   Status" + BOLD_OFF + "\n";
    output += LEFT + this.divider() + "\n";

    // Add items with proper spacing
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
        const name = item.name.trim();
        if (name.length <= nameWidth) {
          // Simple case: name fits on one line
          const paddedName = name.padEnd(nameWidth, " ");
          const qty = (item.quantity?.toString() || "0").padStart(3, " ");
          const status = statusDisplay.padStart(6, " ");

          output += LEFT + paddedName + qty + status + "\n";
        } else {
          // Complex case: name needs to be wrapped
          const firstLine = name.substring(0, nameWidth);
          const remainingText = name.substring(nameWidth);

          // First line with quantity and status
          const qty = (item.quantity?.toString() || "0").padStart(3, " ");
          const status = statusDisplay.padStart(6, " ");
          output += LEFT + firstLine + qty + status + "\n";

          // Additional lines for the wrapped text, if any
          if (remainingText) {
            // Split remaining text into chunks of nameWidth
            for (let i = 0; i < remainingText.length; i += nameWidth) {
              const chunk = remainingText.substring(i, i + nameWidth);
              output += LEFT + chunk.padEnd(nameWidth, " ") + "      " + "\n"; // Add spacing where qty and status would be
            }
          }
        }
      });
    }

    // Footer
    output += LEFT + this.divider() + "\n";

    if (footer?.totalItems) {
      output +=
        LEFT +
        this.keyValue("Total Items:", footer.totalItems.toString()) +
        "\n";
    }

    // Divider for ordered by section
    output += "\n";
    output += LEFT + this.divider() + "\n";

    // Ordered By section
    if (orderedBy) {
      output += LEFT + this.keyValue("Ordered By:", orderedBy) + "\n";
    } else if (header.waiterName) {
      output += LEFT + this.keyValue("Ordered By:", header.waiterName) + "\n";
    }

    // Thank you
    output += "\n";
    output += CENTER + "Thank you!" + "\n";
    output += "\n\n";

    // Cut paper
    output += CUT;

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

    // Initialize
    output += "\n";

    // Bill header
    output += this.center(`BILL: ${header.invoice || ""}`) + "\n";
    output += this.center(header.restaurantName.toUpperCase()) + "\n";

    if (header.address) {
      output += this.center(header.address) + "\n";
    }

    if (header.gstin) {
      output += this.center(`GSTIN: ${header.gstin}`) + "\n";
    }

    // Divider
    output += this.divider() + "\n";

    // Bill details
    output += this.keyValue("Customer", header.customerName) + "\n";
    output += this.keyValue("Type", header.orderType) + "\n";
    output += this.keyValue("Date", header.date) + "\n";

    // Divider
    output += this.divider() + "\n";

    // Add table with proper formatting
    if (items && items.length > 0) {
      const tableRows = this.formatBillTable(items);
      tableRows.forEach((row) => {
        output += row + "\n";
      });
    }

    // Summary
    if (summary) {
      output += this.formatBillSummary(summary);
    }

    // Thank you
    output += "\n";
    output += this.center("Thank you!") + "\n";
    output += "\n\n\n";

    return output;
  }

  /**
   * Format bill summary
   * @param {Object} summary - Bill summary
   * @returns {string} Formatted bill summary
   */
  formatBillSummary(summary) {
    let output = "";

    output += this.divider() + "\n";
    output +=
      this.keyValue("Subtotal", `Rs.${summary.subTotal.toFixed(2)}`) + "\n";

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
    output += this.keyValue("Total", `Rs.${summary.total.toFixed(2)}`) + "\n";

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
