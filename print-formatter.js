/**
 * Print Formatter
 *
 * This utility provides HTML-to-image based printing for thermal printers
 * using ESC/POS commands.
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
   * Generate a unique hash for the content to use as cache key
   * @param {Object} content - Content object (KOT or Bill)
   * @param {String} type - "kot" or "bill"
   * @returns {String} Hash string
   */
  generateContentHash(content, type) {
    // Create a deterministic JSON string (sorted keys)
    const contentString = JSON.stringify({
      content: this.sortObjectKeys(content),
      type,
      config: this.config,
    });

    // Generate SHA-256 hash
    return crypto.createHash("sha256").update(contentString).digest("hex");
  }

  /**
   * Helper to sort object keys for deterministic JSON stringification
   * @private
   */
  sortObjectKeys(obj) {
    if (typeof obj !== "object" || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sortObjectKeys(item));
    }

    return Object.keys(obj)
      .sort()
      .reduce((result, key) => {
        result[key] = this.sortObjectKeys(obj[key]);
        return result;
      }, {});
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
      // Set any printer-specific options
      if (options.printerConfig) {
        this.updateConfig(options.printerConfig);
      }

      // Update cache config if provided
      if (options.cacheConfig) {
        this.updateCacheConfig(options.cacheConfig);
      }

      // Mark the content to indicate it was printed as an image
      content._printMethod = "html-image";

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

      // Format the image for printer
      const printCommands = this.formatImageForPrinter(imageResult);

      // 3. Return the ESC/POS commands
      return printCommands;
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

    const BEEP = `${ESC}B\x02\x01`; // Beep sound (2 beeps, 1 duration)
    const FEED_AND_CUT = `${ESC}d\x03${CUT_FULL_FEED}`; // Feed 8 lines and cut

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
      output += BEEP;

      // Add extra space before cutting - many lines to ensure enough paper is fed
      output += "\n"; // 12 line feeds for extra space

      // Add the cut command sequence - try multiple approaches for compatibility
      output += FEED_AND_CUT; // This is the most reliable cutting sequence

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
        
        <div class="center medium">INVOICE: ${header.invoice || "NA"}</div>
        
        <div class="divider"></div>
        
        <div class="key-value-row">
          <div style="flex: 1;">
            <span>To: ${header.customerName}</span>
          </div>
          <div style="flex: 1; text-align: right;">
            <span class="bold">Order Mode: ${header.orderType}</span>
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
}

module.exports = PrintFormatter;
