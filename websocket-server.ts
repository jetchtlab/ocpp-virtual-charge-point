import WebSocket, { WebSocketServer } from "ws";
import crypto from "crypto";

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * OCPP Message Types
 */
enum OCPPMessageType {
  CALL = 2,
  CALLRESULT = 3,
  CALLERROR = 4,
}

/**
 * OCPP Message structure
 */
type OCPPCall = [OCPPMessageType.CALL, string, string, any];
type OCPPCallResult = [OCPPMessageType.CALLRESULT, string, any];
type OCPPCallError = [OCPPMessageType.CALLERROR, string, string, string, any?];
type OCPPMessage = OCPPCall | OCPPCallResult | OCPPCallError;

/**
 * Handler function type for OCPP actions
 */
type OCPPActionHandler = (messageId: string, payload: any) => any | Promise<any>;

interface OCPPServerOptions {
  port?: number;
  enablePostBootActions?: boolean;
}

// ============================================================================
// OCPP 1.6 Handlers Configuration
// ============================================================================

/**
 * OCPP 1.6 Action Handlers
 */
const ocpp16Handlers: Record<string, OCPPActionHandler> = {
  BootNotification: async (messageId, payload) => {
    return {
      currentTime: new Date().toISOString(),
      interval: 30,
      status: "Accepted",
    };
  },

  StatusNotification: async (messageId, payload) => {
    return {};
  },

  Heartbeat: async (messageId, payload) => {
    return {
      currentTime: new Date().toISOString(),
    };
  },

  Authorize: async (messageId, payload) => {
    return {
      idTagInfo: {
        status: "Accepted",
      },
    };
  },

  StartTransaction: async (messageId, payload) => {
    return {
      transactionId: Math.floor(Math.random() * 1000000),
      idTagInfo: {
        status: "Accepted",
      },
    };
  },

  StopTransaction: async (messageId, payload) => {
    return {
      idTagInfo: {
        status: "Accepted",
      },
    };
  },

  MeterValues: async (messageId, payload) => {
    return {};
  },

  DataTransfer: async (messageId, payload) => {
    return {
      status: "Accepted",
    };
  },
};

/**
 * Post-BootNotification actions to send to client
 */
const postBootNotificationActions = [
  {
    action: "ChangeConfiguration",
    payload: {
      key: "MeterValueSampleInterval",
      value: "60",
    },
    delay: 100,
  },
  {
    action: "GetConfiguration",
    payload: {
      key: ["SupportedFeatureProfiles"],
    },
    delay: 200,
  },
  {
    action: "SetChargingProfile",
    payload: {
      connectorId: 0,
      csChargingProfiles: {
        chargingProfileId: 30,
        stackLevel: 0,
        chargingProfilePurpose: "ChargePointMaxProfile",
        chargingProfileKind: "Absolute",
        chargingSchedule: {
          chargingRateUnit: "A",
          chargingSchedulePeriod: [{ startPeriod: 0, limit: 10.0 }],
        },
      },
    },
    delay: 300,
  },
];

// ============================================================================
// Message Router Class
// ============================================================================

/**
 * OCPPMessageRouter handles routing of OCPP messages to appropriate handlers
 */
class OCPPMessageRouter {
  private handlers: Map<string, OCPPActionHandler> = new Map();

  /**
   * Register a handler for a specific OCPP action
   */
  registerHandler(action: string, handler: OCPPActionHandler): void {
    this.handlers.set(action, handler);
  }

  /**
   * Register multiple handlers at once
   */
  registerHandlers(handlers: Record<string, OCPPActionHandler>): void {
    for (const [action, handler] of Object.entries(handlers)) {
      this.registerHandler(action, handler);
    }
  }

  /**
   * Handle an incoming OCPP message
   */
  async handleMessage(message: OCPPMessage): Promise<OCPPCallResult | null> {
    const messageType = message[0];

    if (messageType === OCPPMessageType.CALL) {
      return await this.handleCall(message as OCPPCall);
    } else if (messageType === OCPPMessageType.CALLRESULT) {
      this.handleCallResult(message);
      return null;
    } else if (messageType === OCPPMessageType.CALLERROR) {
      this.handleCallError(message);
      return null;
    }

    console.warn(`[ROUTER] Unknown message type: ${messageType}`);
    return null;
  }

  /**
   * Handle CALL messages (requests from client)
   */
  private async handleCall(message: OCPPCall): Promise<OCPPCallResult> {
    const [, messageId, action, payload] = message;
    console.log(`[CALL] Action: ${action}, MessageId: ${messageId}`);

    const handler = this.handlers.get(action);

    if (handler) {
      try {
        const responsePayload = await handler(messageId, payload);
        return [OCPPMessageType.CALLRESULT, messageId, responsePayload];
      } catch (error) {
        console.error(`[HANDLER ERROR] Action ${action}:`, error);
        return [OCPPMessageType.CALLRESULT, messageId, { status: "Accepted" }];
      }
    }

    console.warn(`[ROUTER] No handler found for action: ${action}`);
    return [OCPPMessageType.CALLRESULT, messageId, { status: "Accepted" }];
  }

  /**
   * Handle CALLRESULT messages (responses from client)
   */
  private handleCallResult(message: OCPPMessage): void {
    const [, messageId, payload] = message;
    console.log(`[CALLRESULT] MessageId: ${messageId}, Payload:`, payload);
  }

  /**
   * Handle CALLERROR messages
   */
  private handleCallError(message: OCPPMessage): void {
    const [, messageId, errorCode, errorDescription, errorDetails] = message;
    console.log(
      `[CALLERROR] MessageId: ${messageId}, Error: ${errorCode} - ${errorDescription}`,
      errorDetails
    );
  }

  /**
   * Create a CALL message
   */
  static createCall(action: string, payload: any): OCPPCall {
    return [OCPPMessageType.CALL, crypto.randomUUID(), action, payload];
  }

  /**
   * Create a CALLRESULT message
   */
  static createCallResult(messageId: string, payload: any): OCPPCallResult {
    return [OCPPMessageType.CALLRESULT, messageId, payload];
  }
}

// ============================================================================
// OCPP Server Class
// ============================================================================

/**
 * OCPP WebSocket Server
 */
class OCPPServer {
  private wss: WebSocketServer;
  private router: OCPPMessageRouter;
  private enablePostBootActions: boolean;

  constructor(options: OCPPServerOptions = {}) {
    const port = options.port ?? 8080;
    this.enablePostBootActions = options.enablePostBootActions ?? true;

    this.wss = new WebSocketServer({ port });
    this.router = new OCPPMessageRouter();

    // Register default OCPP 1.6 handlers
    this.router.registerHandlers(ocpp16Handlers);

    this.setupServerListeners();
    console.log(`[SERVER] WebSocket server is running on ws://localhost:${port}`);
  }

  /**
   * Register a custom handler for an OCPP action
   */
  registerHandler(
    action: string,
    handler: (messageId: string, payload: any) => any | Promise<any>
  ): void {
    this.router.registerHandler(action, handler);
  }

  /**
   * Setup server event listeners
   */
  private setupServerListeners(): void {
    this.wss.on("connection", (ws: WebSocket, req) => {
      this.handleConnection(ws, req);
    });

    this.wss.on("error", (error: Error) => {
      console.error("[SERVER ERROR]", error.message);
      console.error(error.stack);
    });

    this.wss.on("close", () => {
      console.log("[SERVER] WebSocket server closed");
    });
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, req: any): void {
    const clientAddress = req.socket.remoteAddress;
    console.log(`[CONNECTION] New client connected from ${clientAddress}`);
    console.log(`[CONNECTION] Total clients: ${this.wss.clients.size}`);

    ws.on("message", async (data: WebSocket.RawData, isBinary: boolean) => {
      await this.handleMessage(ws, data, isBinary, clientAddress);
    });

    ws.on("close", (code: number, reason: Buffer) => {
      console.log(`[CLOSE] Client ${clientAddress} disconnected`);
      console.log(`[CLOSE] Code: ${code}, Reason: ${reason.toString()}`);
      console.log(`[CLOSE] Total clients: ${this.wss.clients.size}`);
    });

    ws.on("error", (error: Error) => {
      console.error(`[ERROR] Client ${clientAddress} error:`, error.message);
      console.error(error.stack);
    });

    ws.on("ping", (data: Buffer) => {
      console.log(`[PING] Received from ${clientAddress}:`, data.toString());
    });

    ws.on("pong", (data: Buffer) => {
      console.log(`[PONG] Received from ${clientAddress}:`, data.toString());
    });

    console.log(`[SERVER] Ready to accept OCPP messages from ${clientAddress}`);
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(
    ws: WebSocket,
    data: WebSocket.RawData,
    isBinary: boolean,
    clientAddress: string | undefined
  ): Promise<void> {
    const messageStr = isBinary ? data.toString() : data.toString();
    console.log(`[MESSAGE] Received from ${clientAddress}:`, messageStr);

    try {
      const message: OCPPMessage = JSON.parse(messageStr);
      const response = await this.router.handleMessage(message);

      if (response) {
        this.sendMessage(ws, response);

        // Check if this was a BootNotification and send follow-up messages
        if (this.enablePostBootActions && message[0] === 2 && message[2] === "BootNotification") {
          this.sendPostBootNotificationActions(ws);
        }
      }
    } catch (error) {
      console.error(`[PARSE ERROR] Failed to parse message:`, error);
    }
  }

  /**
   * Send a message to the client
   */
  sendMessage(ws: WebSocket, message: OCPPMessage): void {
    const messageStr = JSON.stringify(message);
    console.log(`[RESPONSE] Sending:`, messageStr);
    ws.send(messageStr);
  }

  /**
   * Send post-BootNotification actions
   */
  private sendPostBootNotificationActions(ws: WebSocket): void {
    for (const { action, payload, delay } of postBootNotificationActions) {
      setTimeout(() => {
        const call = OCPPMessageRouter.createCall(action, payload);
        const callStr = JSON.stringify(call);
        console.log(`[SERVER CALL] Sending:`, callStr);
        ws.send(callStr);
      }, delay);
    }
  }

  /**
   * Close the server
   */
  close(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.close(() => {
        console.log("[SERVER] WebSocket server closed");
        resolve();
      });
    });
  }

  /**
   * Get the number of connected clients
   */
  get clientCount(): number {
    return this.wss.clients.size;
  }
}

// ============================================================================
// Server Initialization
// ============================================================================

const PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT) : 8080;

// Create OCPP server instance
const server = new OCPPServer({
  port: PORT,
  enablePostBootActions: true,
});

// Example: Register custom handlers if needed
// server.registerHandler("CustomAction", async (messageId, payload) => {
//   return { status: "Accepted", customData: "example" };
// });

// Graceful shutdown
const shutdown = async () => {
  console.log("\n[SERVER] Shutting down gracefully...");
  await server.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
