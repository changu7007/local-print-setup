/**
 * Restaurant Print Client
 *
 * This client allows web applications to connect to the local print agent
 * and send print jobs to local printers.
 */

(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    // AMD. Register as an anonymous module
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    // Node. Does not work with strict CommonJS, but
    // only CommonJS-like environments that support module.exports,
    // like Node.
    module.exports = factory();
  } else {
    // Browser globals (root is window)
    root.PrintClient = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * PrintClient class for connecting to the local print agent
   */
  class PrintClient {
    /**
     * Create a new PrintClient instance
     * @param {Object} options - Configuration options
     * @param {string} options.agentUrl - WebSocket URL of the print agent (default: 'ws://localhost:3000')
     * @param {number} options.reconnectInterval - Reconnection interval in ms (default: 5000)
     * @param {boolean} options.debug - Enable debug logging (default: false)
     * @param {Function} options.onStatusChange - Callback function for status changes
     * @param {Function} options.onError - Callback function for errors
     * @param {Function} options.onConnect - Callback function for connection events
     * @param {Function} options.onDisconnect - Callback function for disconnection events
     */
    constructor(options = {}) {
      this.options = {
        agentUrl: options.agentUrl || "ws://localhost:8080",
        reconnectInterval: options.reconnectInterval || 5000,
        debug: options.debug || false,
        onStatusChange: options.onStatusChange || (() => {}),
        onError: options.onError || (() => {}),
        onConnect: options.onConnect || (() => {}),
        onDisconnect: options.onDisconnect || (() => {}),
      };

      this.ws = null;
      this.connected = false;
      this.reconnectTimer = null;
      this.printers = [];

      // Bind methods
      this.connect = this.connect.bind(this);
      this.disconnect = this.disconnect.bind(this);
      this.reconnect = this.reconnect.bind(this);
      this.sendMessage = this.sendMessage.bind(this);
      this.printReceipt = this.printReceipt.bind(this);
      this.printKOT = this.printKOT.bind(this);
      this.getPrinters = this.getPrinters.bind(this);
      this.log = this.log.bind(this);
    }

    /**
     * Connect to the print agent
     * @returns {Promise} Promise that resolves when connected
     */
    connect() {
      return new Promise((resolve, reject) => {
        if (this.ws && this.connected) {
          resolve(true);
          return;
        }

        // Clear any existing reconnect timer
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }

        this.log("Connecting to print agent at", this.options.agentUrl);

        try {
          this.ws = new WebSocket(this.options.agentUrl);
        } catch (error) {
          this.log("Error creating WebSocket:", error);
          this.options.onError(error);
          reject(error);
          this.scheduleReconnect();
          return;
        }

        // Connection opened
        this.ws.addEventListener("open", () => {
          this.connected = true;
          this.log("Connected to print agent");
          this.options.onStatusChange("connected");
          this.options.onConnect();

          // Get available printers
          this.getPrinters();

          resolve(true);
        });

        // Connection closed
        this.ws.addEventListener("close", () => {
          this.connected = false;
          this.log("Disconnected from print agent");
          this.options.onStatusChange("disconnected");
          this.options.onDisconnect();
          this.scheduleReconnect();
          reject(new Error("Connection closed"));
        });

        // Connection error
        this.ws.addEventListener("error", (error) => {
          this.log("WebSocket error:", error);
          this.options.onError(error);
          this.options.onStatusChange("error");
          reject(error);
        });

        // Listen for messages
        this.ws.addEventListener("message", (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            this.log("Error parsing message:", error);
          }
        });
      });
    }

    /**
     * Disconnect from the print agent
     */
    disconnect() {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }

      this.connected = false;

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    }

    /**
     * Schedule a reconnect attempt
     * @private
     */
    scheduleReconnect() {
      if (!this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnect();
        }, this.options.reconnectInterval);
      }
    }

    /**
     * Reconnect to the print agent
     * @private
     */
    reconnect() {
      this.reconnectTimer = null;
      this.log("Attempting to reconnect...");
      this.options.onStatusChange("connecting");
      this.connect().catch(() => {
        // Error is already handled in connect()
      });
    }

    /**
     * Send a message to the print agent
     * @param {Object} message - Message to send
     * @returns {Promise} Promise that resolves when the message is sent
     */
    sendMessage(message) {
      return new Promise((resolve, reject) => {
        if (!this.connected) {
          this.connect()
            .then(() => {
              this.sendMessage(message).then(resolve).catch(reject);
            })
            .catch(reject);
          return;
        }

        try {
          this.ws.send(JSON.stringify(message));
          resolve();
        } catch (error) {
          this.log("Error sending message:", error);
          reject(error);
        }
      });
    }

    /**
     * Handle incoming messages
     * @param {Object} message - Message received
     * @private
     */
    handleMessage(message) {
      this.log("Received message:", message);

      if (message.type === "printers") {
        this.printers = message.data;
        this.options.onStatusChange("printers_updated");
      } else if (message.type === "print_result") {
        // Handle print result
        if (message.success) {
          this.log("Print job successful");
        } else {
          this.log("Print job failed:", message.error);
          this.options.onError(new Error(message.error));
        }
      }
    }

    /**
     * Get available printers
     * @returns {Promise} Promise that resolves with the list of printers
     */
    getPrinters() {
      return this.sendMessage({ type: "get_printers" }).then(
        () => this.printers
      );
    }

    /**
     * Print a receipt
     * @param {Object} options - Print options
     * @returns {Promise} Promise that resolves when the print job is sent
     */
    printReceipt(options) {
      const { printerId, content } = options;

      if (!printerId) {
        return Promise.reject(new Error("Printer ID is required"));
      }

      if (!content) {
        return Promise.reject(new Error("Content is required"));
      }

      // Validate content structure
      if (!content.header || !content.items) {
        return Promise.reject(new Error("Invalid content structure"));
      }

      return this.sendMessage({
        type: "print",
        printerId,
        content: {
          type: "BILL",
          content,
        },
        options: {
          cutPaper: true,
        },
      });
    }

    /**
     * Print a KOT (Kitchen Order Ticket)
     * @param {Object} options - Print options
     * @returns {Promise} Promise that resolves when the print job is sent
     */
    printKOT(options) {
      const { printerId, content } = options;

      if (!printerId) {
        return Promise.reject(new Error("Printer ID is required"));
      }

      if (!content) {
        return Promise.reject(new Error("Content is required"));
      }

      // Validate content structure
      if (!content.header || !content.items) {
        return Promise.reject(new Error("Invalid content structure"));
      }

      return this.sendMessage({
        type: "print",
        printerId,
        content: {
          type: "KOT",
          content,
        },
        options: {
          cutPaper: true,
        },
      });
    }

    /**
     * Log a message if debug is enabled
     * @private
     */
    log(...args) {
      if (this.options.debug) {
        console.log("[PrintClient]", ...args);
      }
    }
  }

  return PrintClient;
});
