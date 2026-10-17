// Issue #1056: Server-sent events endpoint GET /sse/balance for live balance updates
// Pushes real-time balance updates when collect, squeeze, or receive_streams events are indexed

import { Router, Request, Response } from 'express';
import { EventEmitter } from 'events';

const router = Router();

/**
 * Event emitter for balance updates
 * Shared across all SSE connections
 */
class BalanceUpdateEmitter extends EventEmitter {
  private static instance: BalanceUpdateEmitter;

  private constructor() {
    super();
    this.setMaxListeners(1000); // Support many concurrent connections
  }

  static getInstance(): BalanceUpdateEmitter {
    if (!BalanceUpdateEmitter.instance) {
      BalanceUpdateEmitter.instance = new BalanceUpdateEmitter();
    }
    return BalanceUpdateEmitter.instance;
  }

  /**
   * Emit balance update for specific account
   */
  emitBalanceUpdate(account: string, data: BalanceUpdateData): void {
    this.emit(`balance:${account}`, data);
  }

  /**
   * Subscribe to balance updates for account
   */
  subscribeToAccount(account: string, callback: (data: BalanceUpdateData) => void): void {
    this.on(`balance:${account}`, callback);
  }

  /**
   * Unsubscribe from balance updates
   */
  unsubscribeFromAccount(account: string, callback: (data: BalanceUpdateData) => void): void {
    this.off(`balance:${account}`, callback);
  }
}

export interface BalanceUpdateData {
  account: string;
  balance: string;
  timestamp: string;
  event_type: 'collect' | 'squeeze' | 'receive_streams';
  event_id: string;
}

/**
 * SSE connection manager
 */
class SSEConnection {
  private heartbeatInterval?: NodeJS.Timeout;
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds

  constructor(
    private res: Response,
    private account: string,
  ) {
    this.setupConnection();
    this.startHeartbeat();
  }

  private setupConnection(): void {
    // Set SSE headers
    this.res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Send initial connection message
    this.sendEvent('connected', {
      account: this.account,
      timestamp: new Date().toISOString(),
    });
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, this.HEARTBEAT_INTERVAL);
  }

  private sendHeartbeat(): void {
    this.res.write(': heartbeat\n\n');
  }

  sendEvent(event: string, data: any): void {
    this.res.write(`event: ${event}\n`);
    this.res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.res.end();
  }
}

/**
 * GET /sse/balance
 * 
 * Server-Sent Events endpoint for real-time balance updates
 * 
 * Query params:
 * - account: Stellar account address to monitor
 * 
 * Events:
 * - connected: Initial connection established
 * - balance_update: Balance changed (collect, squeeze, receive_streams)
 * - error: Error occurred
 * 
 * Example usage:
 * ```javascript
 * const eventSource = new EventSource('/sse/balance?account=GABC123...');
 * 
 * eventSource.addEventListener('balance_update', (event) => {
 *   const data = JSON.parse(event.data);
 *   console.log('New balance:', data.balance);
 * });
 * 
 * eventSource.addEventListener('connected', (event) => {
 *   console.log('Connected:', event.data);
 * });
 * ```
 */
router.get('/balance', (req: Request, res: Response) => {
  const { account } = req.query;

  // Validate account parameter
  if (!account || typeof account !== 'string') {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Missing or invalid account parameter',
    });
  }

  // Validate Stellar account format (G... public key, 56 chars)
  if (!/^G[A-Z2-7]{55}$/.test(account)) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Invalid Stellar account format',
    });
  }

  // Create SSE connection
  const connection = new SSEConnection(res, account);

  // Get balance update emitter
  const emitter = BalanceUpdateEmitter.getInstance();

  // Balance update handler
  const handleBalanceUpdate = (data: BalanceUpdateData) => {
    connection.sendEvent('balance_update', data);
  };

  // Subscribe to balance updates for this account
  emitter.subscribeToAccount(account, handleBalanceUpdate);

  // Cleanup on client disconnect
  req.on('close', () => {
    emitter.unsubscribeFromAccount(account, handleBalanceUpdate);
    connection.close();
  });
});

/**
 * Trigger balance update (called by indexer when events are processed)
 * 
 * This function should be called from the event indexer when:
 * - collect event is indexed
 * - squeeze event is indexed
 * - receive_streams event is indexed
 * 
 * @param account Stellar account address
 * @param balance New balance value
 * @param eventType Type of event that triggered the update
 * @param eventId Unique event identifier
 */
export function triggerBalanceUpdate(
  account: string,
  balance: string,
  eventType: 'collect' | 'squeeze' | 'receive_streams',
  eventId: string,
): void {
  const emitter = BalanceUpdateEmitter.getInstance();

  const updateData: BalanceUpdateData = {
    account,
    balance,
    timestamp: new Date().toISOString(),
    event_type: eventType,
    event_id: eventId,
  };

  emitter.emitBalanceUpdate(account, updateData);
}

/**
 * Get SSE connection statistics
 */
export function getSSEStats(): {
  activeConnections: number;
  eventListeners: number;
} {
  const emitter = BalanceUpdateEmitter.getInstance();

  return {
    activeConnections: emitter.listenerCount('balance:*'),
    eventListeners: emitter.eventNames().length,
  };
}

export default router;
