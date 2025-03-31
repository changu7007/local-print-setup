/**
 * Print Formatter
 *
 * This utility provides HTML-to-image based printing and raw text-based printing
 * for thermal printers using ESC/POS commands.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

class PrintFormatter {
  constructor(config = {}) {
    // Default configuration for the printer
    this.config = {
      lineWidth: config.lineWidth || 384, // Default printer width in pixels
      deviceScaleFactor: config.deviceScaleFactor || 1,
      fontSize: config.fontSize || 24,
      charsPerLine: config.charsPerLine || 32,
      normalSize: config.normalSize || 0, // Normal size (0)
      largeSize: config.largeSize || 24, // Double width and height (24)
      mediumSize: config.mediumSize || 16, // Double height (16)
      smallSize: config.smallSize || 0, // Normal size (0)
      ...config,
    };

    // Initialize the cache
    this.imageCache = new Map();
    this.cacheDir = path.join(process.cwd(), "print-cache");

    // Create cache directory if it doesn't exist
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }

    // Cache configuration
    this.cacheConfig = {
      enabled: true, // Enable/disable caching
      maxAge: 24 * 60 * 60 * 1000, // Cache expiration: 24 hours
      persistToDisk: true, // Save cache to disk
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
   * Update cache configuration
   * @param {Object} cacheConfig - New cache configuration
   */
  updateCacheConfig(cacheConfig) {
    this.cacheConfig = {
      ...this.cacheConfig,
      ...cacheConfig,
    };
  }

  /**
   * Main entry point for printing content
   * @param {Object} content - Content to print (KOT or Bill object)
   * @param {String} type - "kot" or "bill"
   * @param {Object} options - Additional options including printMethod: "text" or "image"
   * @returns {Promise<string>} ESC/POS commands for printing
   */
  async printContent(content, type, options = {}) {
    try {
      // Determine print method - default to "text"
      const printMethod = options.printMethod || "text";

      // Set any printer-specific options
      if (options.printerConfig) {
        this.updateConfig(options.printerConfig);
      }

      // Add print method as metadata
      content._printMethod = printMethod;

      // Choose formatting method based on printMethod
      if (printMethod === "image") {
        return await this.printContentAsImage(content, type, options);
      } else {
        // Default to text-based printing
        return this.printContentAsText(content, type, options);
      }
    } catch (error) {
      console.error(`Error printing ${type}:`, error);
      throw new Error(`Failed to print ${type}: ${error.message}`);
    }
  }

  /**
   * Print content as text using direct ESC/POS commands
   * @param {Object} content - Content to print (KOT or Bill object)
   * @param {String} type - "kot" or "bill"
   * @param {Object} options - Additional options
   * @returns {string} ESC/POS commands for printing
   */
  printContentAsText(content, type, options = {}) {
    try {
      // Format content based on type
      let formattedContent;
      if (type.toLowerCase() === "kot") {
        formattedContent = this.formatKOTContent(content);
      } else if (type.toLowerCase() === "bill") {
        formattedContent = this.formatBillContent(content);
      } else {
        throw new Error(`Unsupported format type: ${type}`);
      }

      // Add the cutting commands to the end
      formattedContent = this.addCuttingCommands(formattedContent);

      return formattedContent;
    } catch (error) {
      console.error(`Error printing ${type} as text:`, error);
      throw error;
    }
  }

  /**
   * Add cutting and beep commands to formatted content
   * @param {string} content - Formatted content
   * @returns {string} Content with cutting and beep commands
   */
  addCuttingCommands(content) {
    // ESC/POS commands
    const ESC = "\x1B";
    const GS = "\x1D";
    const BEL = "\x07"; // Bell character for beep

    // Add just enough line feeds for clean cutting
    content += `${ESC}d\x03`; // Feed 3 lines instead of 8

    // Add beep command - simple and effective
    content += BEL + BEL; // Two beeps using standard bell character

    // Add single cut command - avoid multiple cuts
    content += `${GS}V\x00`; // Full cut (most common)

    return content;
  }

  /**
   * Main entry point for printing content as image
   * @param {Object} content - Content to print (KOT or Bill object)
   * @param {String} type - "kot" or "bill"
   * @param {Object} options - Additional options like printer configuration
   * @returns {Promise<string>} ESC/POS commands for printing
   */
  async printContentAsImage(content, type, options = {}) {
    try {
      // Update cache config if provided
      if (options.cacheConfig) {
        this.updateCacheConfig(options.cacheConfig);
      }

      // Generate a unique hash for this content
      const contentHash = this.generateContentHash(content, type);

      // Check if content is in memory cache
      let imageResult;
      let useCache = this.cacheConfig.enabled && !options.skipCache;

      if (useCache) {
        // Try to get from memory cache first
        imageResult = this.imageCache.get(contentHash);

        // If not in memory but disk cache is enabled, try to load from disk
        if (!imageResult && this.cacheConfig.persistToDisk) {
          imageResult = await this.loadCacheFromDisk(contentHash);

          // If found on disk, add to memory cache too
          if (imageResult) {
            this.imageCache.set(contentHash, imageResult);
          }
        }

        if (imageResult) {
          console.log("Using cached rasterized image");
        }
      }

      // If not cached or cache disabled, generate the image
      if (!imageResult) {
        console.log("Generating new rasterized image");

        // 1. Generate HTML from content
        const htmlContent = this.formatToHTML(content, type);

        // 2. Convert HTML to image and format for printer
        imageResult = await this.convertHTMLToImageNode(htmlContent);

        // 3. Store in cache if enabled
        if (useCache) {
          this.imageCache.set(contentHash, imageResult);

          // Save to disk if configured
          if (this.cacheConfig.persistToDisk) {
            await this.saveCacheToDisk(contentHash, imageResult);
          }
        }
      }

      // Format the image for printer and add cutting commands
      const printCommands = this.formatImageForPrinter(imageResult);

      // ESC/POS commands for cutting and beeping
      const ESC = "\x1B";
      const GS = "\x1D";
      const INIT = `${ESC}@`; // Initialize printer
      const BEL = "\x07"; // Bell character for beep

      // Create the complete print command sequence
      let output = INIT;
      output += printCommands;

      // Add multiple line feeds to ensure enough paper before cutting
      output += `${ESC}d\x08`; // Feed 8 lines

      // Add beep
      output += BEL + BEL;
      output += `${ESC}B\x03\x03\x01`; // 3 beeps, duration 3, interval 1

      // Add cuts
      output += `${GS}V\x00`; // Full cut
      output += `${GS}V\x41\x03`; // Partial cut with 3-dot feed

      return output;
    } catch (error) {
      console.error(`Error printing ${type} as image:`, error);
      throw new Error(`Failed to print ${type}: ${error.message}`);
    }
  }

  /**
   * Save cache entry to disk
   * @param {String} hash - Content hash
   * @param {Object} imageResult - Image data to cache
   */
  async saveCacheToDisk(hash, imageResult) {
    try {
      const cachePath = path.join(this.cacheDir, `${hash}.json`);

      // Create a cache entry with metadata
      const cacheEntry = {
        timestamp: Date.now(),
        imageData: imageResult.imageData.toString("base64"), // Convert buffer to base64
        width: imageResult.width,
        height: imageResult.height,
        monochromeData: Buffer.from(imageResult.monochromeData).toString(
          "base64"
        ),
      };

      // Write to disk
      fs.writeFileSync(cachePath, JSON.stringify(cacheEntry));
      console.log(`Cache saved to disk: ${cachePath}`);
    } catch (error) {
      console.error("Error saving cache to disk:", error);
    }
  }

  /**
   * Load cache entry from disk
   * @param {String} hash - Content hash
   * @returns {Object|null} Image data or null if not found/expired
   */
  async loadCacheFromDisk(hash) {
    try {
      const cachePath = path.join(this.cacheDir, `${hash}.json`);

      // Check if cache file exists
      if (!fs.existsSync(cachePath)) {
        return null;
      }

      // Read and parse cache file
      const cacheData = JSON.parse(fs.readFileSync(cachePath, "utf8"));

      // Check if cache is expired
      if (Date.now() - cacheData.timestamp > this.cacheConfig.maxAge) {
        console.log(`Cache expired for ${hash}, removing file`);
        fs.unlinkSync(cachePath);
        return null;
      }

      // Reconstruct image data from cache
      return {
        imageData: Buffer.from(cacheData.imageData, "base64"),
        width: cacheData.width,
        height: cacheData.height,
        monochromeData: Buffer.from(cacheData.monochromeData, "base64"),
      };
    } catch (error) {
      console.error("Error loading cache from disk:", error);
      return null;
    }
  }

  /**
   * Clears all cache entries
   */
  clearCache() {
    // Clear memory cache
    this.imageCache.clear();

    // Clear disk cache if enabled
    if (this.cacheConfig.persistToDisk) {
      try {
        const files = fs.readdirSync(this.cacheDir);
        for (const file of files) {
          if (file.endsWith(".json")) {
            fs.unlinkSync(path.join(this.cacheDir, file));
          }
        }
        console.log("Disk cache cleared");
      } catch (error) {
        console.error("Error clearing disk cache:", error);
      }
    }
  }

  /**
   * Print HTML content as image using ESC/POS
   * @param {string} htmlContent - HTML content to print
   * @returns {Promise<string>} ESC/POS commands for printing the image
   */
  async printAsImage(htmlContent) {
    // ESC/POS commands
    const ESC = "\x1B";
    const GS = "\x1D";
    const INIT = `${ESC}@`; // Initialize printer

    // Cut commands - try different standard ones for maximum compatibility
    const CUT_PARTIAL = `${GS}V\x01`; // Partial cut (most common partial cut command)
    const CUT_FULL = `${GS}V\x00`; // Full cut (most common full cut command)
    const CUT_PARTIAL_FEED = `${GS}V\x41\x03`; // Partial cut with 3-dot feed
    const CUT_FULL_FEED = `${GS}V\x42\x03`; // Full cut with 3-dot feed

    // More robust beep command (different printers might use different formats)
    const BEEP = `${ESC}B\x05\x09\x01`; // 5 beeps, duration 9, interval 1

    try {
      console.log("Converting HTML to image...");

      // Try to convert HTML to image
      let imageResult;
      try {
        imageResult = await this.convertHTMLToImageNode(htmlContent);
        console.log("Image conversion successful, formatting for printer...");
      } catch (conversionError) {
        console.error("HTML to image conversion failed:", conversionError);
        throw conversionError;
      }

      // Format the image data for ESC/POS
      const printCommands = this.formatImageForPrinter(imageResult);

      console.log("Formatting complete, preparing final output...");

      // Create the complete print command sequence
      let output = INIT;
      output += printCommands;

      // Add multiple line feeds to ensure enough paper before cutting
      output += `${ESC}d\x08`; // Feed 8 lines

      // Add the beep command (try more robust beep)
      output += BEEP;

      // Try multiple cutting methods for better compatibility
      // Some printers might respond to one but not the other
      output += CUT_FULL_FEED; // Try full cut with feed
      output += CUT_FULL; // Try standard full cut

      // As a fallback, add a line feed and partial cut in case full cut isn't supported
      output += `${ESC}d\x03${CUT_PARTIAL}`;

      // Add alternative beep and cut commands for broader printer compatibility
      output += `${ESC}@`; // Re-initialize printer before final commands
      output += `${ESC}d\x05`; // Feed 5 more lines to ensure enough space for cutting

      // Try alternative beep commands
      output += `${BEL}`; // Simple bell/beep character (0x07)
      output += `${ESC}B\x02\x05\x01`; // Alternate beep format (2 beeps, duration 5, interval 1)

      // Try additional cut commands with different formats
      output += `${ESC}m`; // Alternative partial cut for some Epson printers
      output += `${GS}V1`; // Alternative partial cut (no feed)
      output += `${GS}i`; // Alternative cut for some printer models

      return output;
    } catch (error) {
      console.error("Error converting HTML to image:", error);
      throw error;
    }
  }

  /**
   * Convert HTML to image in Node.js environment
   * @param {string} htmlContent - HTML content
   * @returns {Promise<Object>} Image data and dimensions
   */
  async convertHTMLToImageNode(htmlContent) {
    const puppeteer = require("puppeteer");
    const fs = require("fs");
    const path = require("path");
    const { createCanvas, loadImage } = require("canvas");

    let browser = null;
    let tempImagePath = null;

    try {
      browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      const page = await browser.newPage();
      await page.setContent(htmlContent);
      await page.setViewport({
        width: this.config.lineWidth,
        height: 800,
        deviceScaleFactor: this.config.deviceScaleFactor,
      });

      const bodyHeight = await page.evaluate(() => {
        return document.body.scrollHeight;
      });

      await page.setViewport({
        width: this.config.lineWidth,
        height: bodyHeight,
        deviceScaleFactor: this.config.deviceScaleFactor,
      });

      const imageBuffer = await page.screenshot({
        type: "png",
        fullPage: true,
      });
      console.log(`Screenshot captured: ${imageBuffer.length} bytes`);

      // Create a temporary file to save the image
      // This works around the "Image given has not completed loading" issue
      tempImagePath = path.join(
        process.cwd(),
        `temp-print-image-${Date.now()}.png`
      );

      fs.writeFileSync(tempImagePath, imageBuffer);
      console.log(`Saved temporary image to: ${tempImagePath}`);

      // Load the image from the saved file
      const image = await loadImage(tempImagePath);
      console.log(`Image loaded successfully: ${image.width}x${image.height}`);

      // Create canvas with the image dimensions
      const canvasInstance = createCanvas(image.width, image.height);
      const ctx = canvasInstance.getContext("2d");

      // Draw the image
      ctx.drawImage(image, 0, 0);

      // Get image data
      const imageData = ctx.getImageData(0, 0, image.width, image.height);
      const pixels = imageData.data;

      // Convert to monochrome
      const width = image.width;
      const height = image.height;
      const widthBytes = Math.ceil(width / 8);
      const monochromeData = new Uint8Array(widthBytes * height);

      // Process each pixel
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const r = pixels[idx];
          const g = pixels[idx + 1];
          const b = pixels[idx + 2];

          // Grayscale conversion
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;

          // Threshold to black or white
          const bit = gray < 128 ? 1 : 0;

          // Set bit in monochrome data
          const byteIdx = y * widthBytes + Math.floor(x / 8);
          const bitPos = 7 - (x % 8); // MSB first
          if (bit) {
            monochromeData[byteIdx] |= 1 << bitPos;
          }
        }
      }

      return {
        imageData: imageBuffer,
        width: width,
        height: height,
        monochromeData: monochromeData,
      };
    } catch (error) {
      console.error("Error rendering HTML to image:", error);
      throw error;
    } finally {
      // Clean up resources
      if (browser) {
        await browser.close();
      }

      // Delete the temporary image file
      if (tempImagePath && fs.existsSync(tempImagePath)) {
        try {
          // fs.unlinkSync(tempImagePath);
          console.log(`Deleted temporary image: ${tempImagePath}`);
        } catch (e) {
          console.error(`Failed to delete temporary image: ${e.message}`);
        }
      }
    }
  }

  /**
   * Format image data for ESC/POS printer
   * @param {Object} imageData - Image data object from convertHTMLToImage
   * @returns {string} ESC/POS image commands
   */
  formatImageForPrinter(imageResult) {
    // This is a simplified example for raster bitmap printing
    // ESC/POS has several image printing modes; this uses GS v 0
    const GS = "\x1D";

    // Validate that we have the required data
    if (
      !imageResult ||
      !imageResult.width ||
      !imageResult.height ||
      !imageResult.monochromeData
    ) {
      throw new Error("Invalid image data: missing required properties");
    }

    const { width, height, monochromeData } = imageResult;

    // Calculate width in bytes (each byte contains 8 horizontal pixels)
    const widthBytes = Math.ceil(width / 8);

    // Width bytes in little-endian format
    const xL = widthBytes & 0xff;
    const xH = (widthBytes >> 8) & 0xff;

    // Height in little-endian format
    const yL = height & 0xff;
    const yH = (height >> 8) & 0xff;

    // Create command
    let cmd = `${GS}v0\x00${String.fromCharCode(xL)}${String.fromCharCode(
      xH
    )}${String.fromCharCode(yL)}${String.fromCharCode(yH)}`;

    // Append image data
    for (let i = 0; i < monochromeData.length; i++) {
      cmd += String.fromCharCode(monochromeData[i]);
    }

    return cmd;
  }

  /**
   * Check if browser or Node environment
   * @private
   */
  isNodeEnvironment() {
    return typeof window === "undefined";
  }

  /**
   * Convert formatted content to HTML
   * @param {Object} content - Content object (KOT or Bill)
   * @param {String} type - "kot" or "bill"
   * @returns {string} HTML representation
   */
  formatToHTML(content, type) {
    if (type.toLowerCase() === "kot") {
      return this.formatKOTToHTML(content);
    } else if (type.toLowerCase() === "bill") {
      return this.formatBillToHTML(content);
    }
    throw new Error(`Unsupported format type: ${type}`);
  }

  /**
   * Format KOT content as HTML
   * @param {Object} content - KOT content
   * @returns {string} HTML representation of KOT
   */
  formatKOTToHTML(content) {
    const { header, items, footer, note, orderedBy } = content;

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: Arial, 'Helvetica Neue', sans-serif;
            width: ${this.config.lineWidth}px;
            margin: 0;
            padding: 0;
            font-size: 30px;
          }
          .center { text-align: center; }
          .left { text-align: left; }
          .right { text-align: right; }
          .bold { font-weight: bold; }
          .large { 
            font-size: 32px;
          }
          .medium { 
            font-size: 30px;
          }
          .small {
            font-size: 24px;
          }
          .divider {
            border-bottom: 3px dashed #000000;
            width: 100%;
            margin: 10px 0;
          }
          .key-value-row {
            display: flex;
            justify-content: space-between;
            margin: 8px 0;
          }
          .key-value-left {
            display: flex;
            justify-content: flex-start;
            margin: 8px 0;
            flex: 1;
          }
          .key-value-right {
            display: flex;
            justify-content: flex-end;
            margin: 8px 0;
            flex: 1;
            text-align: right;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          th, td {
            padding: 8px 4px;
            text-align: left;
            vertical-align: top;
          }
          td.item {
            text-transform: uppercase;
            padding-right: 15px;
            width: 80%;
            font-weight: bold;
          }
          th.status, td.status {
            text-align: right;
            width: 20%;
          }
          .print-method {
            color: transparent;
            font-size: 1px;
            position: absolute;
            bottom: 0;
            left: 0;
          }
          .instructions {
            font-style: italic;
            margin-top: 10px;
          }
          .order-type {
            font-size: 30px;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <!-- Hidden marker to identify this was printed using HTML method -->
        <div class="print-method">HTML-IMAGE-PRINT</div>

        <div class="center">(${header.kotType})</div>
        <div class="center bold">Order No: #${
          header.kotNumber || "2403250001"
        }</div>
        
        <div class="divider"></div>
        
        <div class="key-value-row small">
          <div style="flex: 1;">
            <span>To: ${header.customerName}</span>
          </div>
          <div style="flex: 1; text-align: right;">
            <span class="order-type">Table: ${header.orderType}</span>
          </div>
        </div>
        
        <div class="key-value-row small">
          <div style="flex: 1;">
            <span>Date: ${
              header.date ? header.date.split(" ")[0] : "24/03/2025"
            }</span>
          </div>
          <div style="flex: 1; text-align: right;">
            <span>Time: ${
              header.date ? header.date.split(" ")[1] : "10:00 AM"
            }</span>
          </div>
        </div>
        
        <div class="divider"></div>
        
        <table>
          <tr>
            <th>Qty x Item</th>
            <th class="status">Status</th>
          </tr>
        </table>
        
        <div class="divider"></div>
        
        <table>
          ${items
            .map((item) => {
              const statusIndicator = this.getStatusIndicator(
                item.status || ""
              );
              const statusDisplay = statusIndicator
                ? `[${statusIndicator}]`
                : "";

              return `
              <tr>
                <td class="item">${
                  item.quantity || 0
                } <span style="font-size: 16px;">x</span> ${item.name}</td>
                <td class="status">${statusDisplay}</td>
              </tr>
            `;
            })
            .join("")}
        </table>
        
        <div class="divider"></div>
        
        <div class="key-value-row">
          <div class="key-value-left">
            <span>Ordered By:</span>
          </div>
          <div class="key-value-right">
            <span>${orderedBy || header.waiterName || ""}</span>
          </div>
        </div>
        
        <div class="divider"></div>
        
        ${
          note &&
          `
          <div class="instructions">
            <span>Instructions: ${note}</span>
          </div>
        `
        }
        
        <!-- Add extra space at the bottom for cutting -->
        <div style="height: 30px;"></div>
      </body>
      </html>
    `;
  }

  /**
   * Format Bill content as HTML
   * @param {Object} content - Bill content
   * @returns {string} HTML representation of Bill
   */
  formatBillToHTML(content) {
    const { header, items, summary } = content;

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: Arial, 'Helvetica Neue', sans-serif;
            width: ${this.config.lineWidth}px;
            margin: 0;
            padding: 0;
            font-size: 28px;
          }
          .center { text-align: center; }
          .left { text-align: left; }
          .right { text-align: right; }
          .bold { font-weight: bold; }
          .large { 
            font-size: 30px;
            font-weight: bold;
          }
          .medium { 
            font-size: 28px;
            font-weight: bold;
          }
          .small {
            font-size: 22px;
          }
          .divider {
            border-bottom: 3px dashed #000000;
            width: 100%;
            margin: 10px 0;
          }
          .key-value-row {
            display: flex;
            justify-content: space-between;
            margin: 8px 0;
          }
          .key-value-full {
            display: flex;
            justify-content: space-between;
            margin: 8px 0;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }
          th, td {
            padding: 6px 4px;
            text-align: left;
            vertical-align: top;
          }
          th {
            font-weight: normal;
          }
          th.item-name, td.item-name {
            width: 50%;
            text-align: left;
            word-wrap: break-word;
            text-transform: uppercase;
          }
          th.price, td.price {
            width: 18%;
            text-align: right;
          }
          th.qty, td.qty {
            width: 12%;
            text-align: right;
          }
          th.total, td.total {
            width: 20%;
            text-align: right;
          }
          .thank-you {
            text-align: center;
            margin: 20px 0;
            font-size: 28px;
            font-weight: bold;
          }
          .print-method {
            color: transparent;
            font-size: 1px;
            position: absolute;
            bottom: 0;
            left: 0;
          }
          .gst-box {
            margin: 10px auto;
            border: 1px solid #000;
            width: 95%;
            text-align: center;
            padding: 5px;
          }
          .gst-title {
            text-align: center;
            padding: 3px 0;
            border-bottom: 1px dashed #000;
          }
          .gst-values {
            text-align: center;
            padding: 3px 0;
          }
          .summary-row {
            display: flex;
            justify-content: space-between;
            margin: 5px 0;
          }
          .summary-label {
            text-align: left;
          }
          .summary-value {
            text-align: right;
          }
          .total-row {
            font-weight: bold;
            font-size: 28px;
          }
        </style>
      </head>
      <body>
        <!-- Hidden marker to identify this was printed using HTML method -->
        <div class="print-method">HTML-IMAGE-PRINT</div>

        <div class="center large">${header.restaurantName.toUpperCase()}</div>
        ${
          header.description
            ? `<div class="center">(${header.description})</div>`
            : ""
        }
        ${header.address ? `<div class="center">${header.address}</div>` : ""}
        ${header.phoneNo ? `<div class="center">${header.phoneNo}</div>` : ""}
         ${
           header.email ? `<div class="center small">${header.email}</div>` : ""
         }
        ${
          header.gstin ? `<div class="center">GSTIN: ${header.gstin}</div>` : ""
        }

        
        <div class="divider"></div>
        
        <div class="center medium">Bill No: ${header.invoice || "NA"}</div>
        
        <div class="divider"></div>
        
        <div class="key-value-row">
          <div style="flex: 1;">
            <span>To: ${header.customerName}</span>
          </div>
          <div style="flex: 1; text-align: right;">
            <span class="bold"> ${header.orderType}</span>
          </div>
        </div>
        
        <div class="key-value-row">
          <div style="flex: 1;">
            <span>Date: ${
              header.date ? header.date.split(" ")[0] : "24/03/2025"
            }</span>
          </div>
          <div style="flex: 1; text-align: right;">
            <span>Time: ${
              header.date ? header.date.split(" ")[1] : "10:00 AM"
            }</span>
          </div>
        </div>
        
        <div class="divider"></div>
        
        <table>
          <thead>
            <tr>
              <th class="item-name">Item</th>
              <th class="price">Price (Rs)</th>
              <th class="qty">Qty</th>
              <th class="total">Total (Rs)</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colspan="4"><div class="divider" style="margin: 4px 0;"></div></td></tr>
            ${items
              .map((item) => {
                // Ensure price and quantity are numbers
                const price = Number(item.price || 0);
                const quantity = Number(item.quantity || 0);
                const total = price * quantity;

                return `
                <tr>
                  <td class="item-name">${item.name}</td>
                  <td class="price">${price.toFixed(2)}</td>
                  <td class="qty">${quantity}</td>
                  <td class="total">${total.toFixed(2)}</td>
                </tr>
              `;
              })
              .join("")}
          </tbody>
        </table>
        
        <div class="divider"></div>
        
        <div class="key-value-full">
          <div class="summary-label">Subtotal:</div>
          <div class="summary-value">Rs. ${Number(
            summary.subTotal || 0
          ).toFixed(2)}</div>
        </div>
        
        <div class="divider"></div>
        
        <div class="key-value-full">
          <div class="summary-label">Discount (${summary.discount || 0}%)</div>
          <div class="summary-value">-Rs. ${Number(
            summary.discountAmount || 0
          ).toFixed(2)}</div>
        </div>
        
        <div class="key-value-full">
          <div class="summary-label">GST</div>
          <div class="summary-value">+Rs. ${(
            Number(summary.sgst || 0) + Number(summary.cgst || 0)
          ).toFixed(2)}</div>
        </div>
        
        <div class="gst-box">
          <div class="gst-title">SGST+CGST=GST</div>
          <div class="gst-values">Rs.${Number(summary.sgst || 0).toFixed(
            2
          )} + Rs.${Number(summary.cgst || 0).toFixed(2)} = Rs.${(
      Number(summary.sgst || 0) + Number(summary.cgst || 0)
    ).toFixed(2)}</div>
        </div>
        
        <div class="key-value-full">
          <div class="summary-label">Round Off</div>
          <div class="summary-value">-Rs. ${Number(
            summary.rounded || 0
          ).toFixed(2)}</div>
        </div>
        
        <div class="divider"></div>
        
        <div class="key-value-full total-row">
          <div class="summary-label">Total Payable</div>
          <div class="summary-value">Rs. ${Number(summary.total || 0).toFixed(
            2
          )}</div>
        </div>
        
        <div class="divider"></div>
        
        <div class="thank-you">Thank you & Visit us again!</div>
        
       
        <!-- Add extra space at the bottom for cutting -->
        <div style="height: 30px;"></div>
      </body>
      </html>
    `;
  }

  /**
   * Get status indicator for KOT items
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

    // Font size commands - adjust sizes as needed
    const NORMAL_SIZE = `${ESC}!\x00`; // Normal size
    const LARGE_SIZE = `${ESC}!\x18`; // Double width and height (24 = 0x18) - medium large
    const MEDIUM_SIZE = `${ESC}!\x10`; // Double height (16 = 0x10)
    const SMALL_SIZE = `${ESC}!\x00`; // Small size (0 = 0x00)

    // Initialize printer
    output += INIT;

    // KOT Type
    output += CENTER + MEDIUM_SIZE + `(${header.kotType})` + NORMAL_SIZE + "\n";

    // KOT Number
    output +=
      CENTER +
      BOLD_ON +
      MEDIUM_SIZE +
      `Order No: #${header.kotNumber || ""}` +
      NORMAL_SIZE +
      BOLD_OFF +
      "\n";

    // Divider
    output += LEFT + this.divider() + "\n";

    // Customer and Table info - Make orderType bold and medium large
    output +=
      LEFT +
      SMALL_SIZE +
      `To: ${header.customerName}` +
      " ".repeat(
        Math.max(0, this.config.charsPerLine - header.customerName.length - 15)
      ) +
      BOLD_ON +
      LARGE_SIZE +
      `${header.orderType}` +
      NORMAL_SIZE +
      BOLD_OFF +
      "\n";

    // Date and Time info
    const dateStr = header.date ? header.date.split(" ")[0] : "";
    const timeStr = header.date ? header.date.split(" ")[1] : "";

    output +=
      LEFT +
      SMALL_SIZE +
      `Date: ${dateStr}` +
      " ".repeat(
        Math.max(
          0,
          this.config.charsPerLine - dateStr.length - timeStr.length - 12
        )
      ) +
      `Time: ${timeStr}` +
      NORMAL_SIZE +
      "\n";

    // Divider
    output += LEFT + this.divider() + "\n";

    // Table header
    output +=
      LEFT +
      BOLD_ON +
      "Qty x Item" +
      " ".repeat(Math.max(0, this.config.charsPerLine - 16)) +
      "Status" +
      BOLD_OFF +
      "\n";

    // Divider below header
    output += LEFT + this.divider() + "\n";

    // Add items with MEDIUM-LARGE formatting instead of LARGE
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

        // Calculate available width for item name
        const nameWidth = Math.max(10, this.config.charsPerLine - 10);

        // Format the item name with proper wrapping if needed
        // Convert item name to uppercase for better visibility
        const name = item.name.trim().toUpperCase();
        const qtyStr = `${item.quantity || 0}`;

        // Format with QTY x ITEM - MEDIUM-LARGE instead of LARGE
        if (name.length <= nameWidth - qtyStr.length - 3) {
          const itemText = `${qtyStr} x ${name}`;
          const paddingWidth =
            this.config.charsPerLine - itemText.length - statusDisplay.length;

          output +=
            LEFT +
            BOLD_ON +
            LARGE_SIZE + // Use LARGE_SIZE (0x18) which is medium-large
            itemText +
            " ".repeat(Math.max(0, paddingWidth)) +
            statusDisplay +
            NORMAL_SIZE +
            BOLD_OFF +
            "\n";
        } else {
          // Complex case: name needs to be wrapped
          const firstLinePart = name.substring(
            0,
            nameWidth - qtyStr.length - 3
          );
          const firstLine = `${qtyStr} x ${firstLinePart}`;
          const remainingText = name.substring(nameWidth - qtyStr.length - 3);
          const paddingWidth =
            this.config.charsPerLine - firstLine.length - statusDisplay.length;

          output +=
            LEFT +
            BOLD_ON +
            LARGE_SIZE + // Use LARGE_SIZE (0x18) which is medium-large
            firstLine +
            " ".repeat(Math.max(0, paddingWidth)) +
            statusDisplay +
            NORMAL_SIZE +
            BOLD_OFF +
            "\n";

          // Additional lines for the wrapped text, if any
          if (remainingText) {
            // Split remaining text into chunks
            for (let i = 0; i < remainingText.length; i += nameWidth) {
              const chunk = remainingText.substring(
                i,
                Math.min(i + nameWidth, remainingText.length)
              );
              output +=
                LEFT +
                BOLD_ON +
                LARGE_SIZE + // Use LARGE_SIZE (0x18) which is medium-large
                " ".repeat(qtyStr.length + 3) + // Indent to align with first line text
                chunk +
                NORMAL_SIZE +
                BOLD_OFF +
                "\n";
            }
          }
        }
      });
    }

    // Divider
    output += LEFT + this.divider() + "\n";

    // Ordered By section
    output +=
      LEFT +
      "Ordered By:" +
      " ".repeat(
        Math.max(
          0,
          this.config.charsPerLine -
            15 -
            (orderedBy || header.waiterName || "").length
        )
      ) +
      (orderedBy || header.waiterName || "") +
      "\n";

    // Divider
    output += LEFT + this.divider() + "\n";

    // Chef notes
    if (note) {
      output += LEFT + BOLD_ON + "Instructions: " + BOLD_OFF + note + "\n";
    }

    // Only add 1 line of extra space instead of multiple
    output += "\n";

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

    // Font size commands
    const NORMAL_SIZE = `${ESC}!\x00`; // Normal size
    const LARGE_SIZE = `${ESC}!\x18`; // Double width and height (24 = 0x18)
    const MEDIUM_SIZE = `${ESC}!\x10`; // Double height (16 = 0x10)
    const SMALL_SIZE = `${ESC}!\x00`; // Small size (0 = 0x00)

    // Initialize
    output += INIT;
    // Start BOLD for the entire content
    output += BOLD_ON;

    // Restaurant name
    output +=
      CENTER +
      MEDIUM_SIZE +
      header.restaurantName.toUpperCase() +
      NORMAL_SIZE +
      "\n";

    // Restaurant details
    if (header.description) {
      output += CENTER + `(${header.description})` + "\n";
    }

    if (header.address) {
      output += CENTER + header.address + "\n";
    }

    if (header.phoneNo) {
      output += CENTER + header.phoneNo + "\n";
    }

    if (header.email) {
      output += CENTER + SMALL_SIZE + header.email + NORMAL_SIZE + "\n";
    }

    if (header.gstin) {
      output += CENTER + `GSTIN: ${header.gstin}` + "\n";
    }

    // Divider
    output += this.divider() + "\n";

    // Invoice number
    output +=
      CENTER +
      MEDIUM_SIZE +
      `BILL NO: ${header.invoice || "NA"}` +
      NORMAL_SIZE +
      "\n";

    // Divider
    output += this.divider() + "\n";

    // Customer and Order Type
    output +=
      LEFT +
      `To: ${header.customerName}` +
      " ".repeat(
        Math.max(
          0,
          this.config.charsPerLine -
            header.customerName.length -
            4 - // "To: " is 4 characters
            header.orderType.length
        )
      ) +
      `${header.orderType}` +
      "\n";

    // Date and Time
    const dateStr = header.date ? header.date.split(" ")[0] : "";
    const timeStr = header.date ? header.date.split(" ")[1] : "";

    output +=
      LEFT +
      `Date: ${dateStr}` +
      " ".repeat(
        Math.max(
          0,
          this.config.charsPerLine - dateStr.length - timeStr.length - 12
        )
      ) +
      `Time: ${timeStr}` +
      "\n";

    // Divider
    output += this.divider() + "\n";

    // Table header
    const itemWidth = Math.floor(this.config.charsPerLine * 0.5);
    const priceWidth = Math.floor(this.config.charsPerLine * 0.2);
    const qtyWidth = Math.floor(this.config.charsPerLine * 0.1);
    const totalWidth =
      this.config.charsPerLine - itemWidth - priceWidth - qtyWidth;

    output +=
      LEFT +
      "Item".padEnd(itemWidth) +
      "Price(Rs)".padStart(priceWidth) +
      "Qty".padStart(qtyWidth) +
      "Total(Rs)".padStart(totalWidth) +
      "\n";

    // Divider below header
    output += this.divider() + "\n";

    // Add items with formatting matching the HTML table
    if (items && items.length > 0) {
      items.forEach((item) => {
        // Ensure price and quantity are numbers
        const price = Number(item.price || 0);
        const quantity = Number(item.quantity || 0);
        const total = price * quantity;

        // Format item name to fit in itemWidth
        let nameLines = [];
        let tempName = item.name.trim();

        // Create word-wrapping for names that are too long
        while (tempName.length > itemWidth) {
          const cutPoint = tempName.substring(0, itemWidth).lastIndexOf(" ");
          if (cutPoint === -1) {
            // No space found, just cut at itemWidth
            nameLines.push(tempName.substring(0, itemWidth));
            tempName = tempName.substring(itemWidth);
          } else {
            // Cut at last space
            nameLines.push(tempName.substring(0, cutPoint));
            tempName = tempName.substring(cutPoint + 1);
          }
        }

        if (tempName.length > 0) {
          nameLines.push(tempName);
        }

        // First line with all columns
        output +=
          LEFT +
          nameLines[0].padEnd(itemWidth) +
          price.toFixed(2).padStart(priceWidth) +
          quantity.toString().padStart(qtyWidth) +
          total.toFixed(2).padStart(totalWidth) +
          "\n";

        // If there are wrapped lines, print them
        for (let i = 1; i < nameLines.length; i++) {
          output +=
            LEFT +
            nameLines[i].padEnd(itemWidth) +
            "".padStart(priceWidth + qtyWidth + totalWidth) +
            "\n";
        }
      });
    }

    // Divider
    output += this.divider() + "\n";

    // Summary section
    output +=
      LEFT +
      "Subtotal:" +
      " ".repeat(
        Math.max(
          0,
          this.config.charsPerLine - 15 - summary.subTotal.toFixed(2).length
        )
      ) +
      `Rs. ${summary.subTotal.toFixed(2)}` +
      "\n";

    // Divider
    output += this.divider() + "\n";

    // Discount
    output +=
      LEFT +
      `Discount (${summary.discount || 0}%)` +
      " ".repeat(
        Math.max(
          0,
          this.config.charsPerLine -
            16 -
            summary.discount.toString().length -
            summary.discountAmount.toFixed(2).length
        )
      ) +
      `-Rs. ${summary.discountAmount.toFixed(2)}` +
      "\n";

    // GST
    const gstTotal = (
      Number(summary.sgst || 0) + Number(summary.cgst || 0)
    ).toFixed(2);
    output +=
      LEFT +
      "GST" +
      " ".repeat(Math.max(0, this.config.charsPerLine - 10 - gstTotal.length)) +
      `+Rs. ${gstTotal}` +
      "\n";

    // GST box - simplified
    output += LEFT + this.divider() + "\n";
    output += LEFT + "SGST+CGST=GST" + "\n";
    output +=
      LEFT +
      `Rs.${Number(summary.sgst || 0).toFixed(2)} + Rs.${Number(
        summary.cgst || 0
      ).toFixed(2)} = Rs.${gstTotal}` +
      "\n";
    output += LEFT + this.divider() + "\n";

    // Round off
    output +=
      LEFT +
      "Round Off" +
      " ".repeat(
        Math.max(
          0,
          this.config.charsPerLine - 15 - summary.rounded.toFixed(2).length
        )
      ) +
      `-Rs. ${summary.rounded.toFixed(2)}` +
      "\n";

    // Divider
    output += this.divider() + "\n";

    // Total Payable
    output +=
      LEFT +
      MEDIUM_SIZE +
      "Total Payable" +
      " ".repeat(
        Math.max(
          0,
          this.config.charsPerLine - 20 - summary.total.toFixed(2).length
        )
      ) +
      `Rs. ${summary.total.toFixed(2)}` +
      NORMAL_SIZE +
      "\n";

    // Divider
    output += this.divider() + "\n";

    // Thank you message
    output +=
      CENTER + MEDIUM_SIZE + "Thank you & Visit us again!" + NORMAL_SIZE + "\n";

    // Only add 1 line of extra space
    output += "\n";

    // End BOLD for the entire content
    output += BOLD_OFF;

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
   * Generate a unique hash for content caching
   * @param {Object} content - Content to hash
   * @param {String} type - Content type
   * @returns {string} Content hash
   * @private
   */
  generateContentHash(content, type) {
    try {
      // Create a string that includes both content and type
      const contentString = JSON.stringify({
        content,
        type,
        config: this.config, // Include config to ensure different configs get different caches
      });

      // Generate SHA-256 hash
      return crypto.createHash("sha256").update(contentString).digest("hex");
    } catch (error) {
      console.error("Error generating content hash:", error);
      // Fallback to a timestamp-based hash if JSON stringify fails
      return `${type}-${Date.now()}`;
    }
  }
}

module.exports = PrintFormatter;
