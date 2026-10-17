// Issue #1057: GET /lists/:id/funding-history for historical funding rate changes
// Returns history of total funding rate changes for a drips list

import { Router, Request, Response } from 'express';

const router = Router();

export interface FundingRateChange {
  timestamp: string;
  total_rate_per_sec: string;
  funder_count: number;
  event_id?: string;
}

export interface FundingHistoryResponse {
  list_id: string;
  history: FundingRateChange[];
  pagination: {
    cursor?: string;
    has_more: boolean;
    total_count: number;
  };
}

/**
 * GET /lists/:id/funding-history
 * 
 * Returns the historical funding rate changes for a drips list
 * 
 * Path params:
 * - id: Drips list ID
 * 
 * Query params:
 * - cursor: Pagination cursor (timestamp of last item from previous page)
 * - limit: Number of items per page (default: 50, max: 200)
 * 
 * Response:
 * ```json
 * {
 *   "list_id": "123",
 *   "history": [
 *     {
 *       "timestamp": "2024-01-15T10:00:00Z",
 *       "total_rate_per_sec": "100000000",
 *       "funder_count": 5
 *     },
 *     ...
 *   ],
 *   "pagination": {
 *     "cursor": "2024-01-20T15:30:00Z",
 *     "has_more": true,
 *     "total_count": 150
 *   }
 * }
 * ```
 */
router.get('/:id/funding-history', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { cursor, limit = '50' } = req.query;

  // Validate list ID
  if (!id || !/^\d+$/.test(id)) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Invalid list ID format',
    });
  }

  // Validate limit
  const parsedLimit = parseInt(limit as string, 10);
  if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Limit must be between 1 and 200',
    });
  }

  try {
    // Check if list exists
    const listExists = await checkListExists(req.db, id);
    if (!listExists) {
      return res.status(404).json({
        error: 'Not Found',
        message: `List ${id} not found`,
      });
    }

    // Fetch funding history
    const history = await getFundingHistory(
      req.db,
      id,
      cursor as string | undefined,
      parsedLimit,
    );

    // Get total count
    const totalCount = await getFundingHistoryCount(req.db, id);

    // Determine if there are more results
    const hasMore = history.length === parsedLimit;

    // Get next cursor
    const nextCursor = hasMore ? history[history.length - 1].timestamp : undefined;

    const response: FundingHistoryResponse = {
      list_id: id,
      history,
      pagination: {
        cursor: nextCursor,
        has_more: hasMore,
        total_count: totalCount,
      },
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching funding history:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch funding history',
    });
  }
});

/**
 * Check if list exists in database
 */
async function checkListExists(db: any, listId: string): Promise<boolean> {
  const result = await db.query(
    'SELECT id FROM drips_lists WHERE id = ?',
    [listId],
  );
  return result.length > 0;
}

/**
 * Get funding history from database
 */
async function getFundingHistory(
  db: any,
  listId: string,
  cursor: string | undefined,
  limit: number,
): Promise<FundingRateChange[]> {
  let query = `
    SELECT 
      timestamp,
      total_rate_per_sec,
      funder_count,
      event_id
    FROM funding_rate_changes
    WHERE list_id = ?
  `;

  const params: any[] = [listId];

  // Apply cursor for pagination
  if (cursor) {
    query += ' AND timestamp > ?';
    params.push(cursor);
  }

  // Sort oldest first and apply limit
  query += ' ORDER BY timestamp ASC LIMIT ?';
  params.push(limit);

  const results = await db.query(query, params);

  return results.map((row: any) => ({
    timestamp: row.timestamp,
    total_rate_per_sec: row.total_rate_per_sec.toString(),
    funder_count: row.funder_count,
    event_id: row.event_id,
  }));
}

/**
 * Get total count of funding rate changes
 */
async function getFundingHistoryCount(db: any, listId: string): Promise<number> {
  const result = await db.query(
    'SELECT COUNT(*) as count FROM funding_rate_changes WHERE list_id = ?',
    [listId],
  );
  return result[0]?.count || 0;
}

/**
 * Record funding rate change (called by indexer)
 * 
 * This should be called when indexing events that change funding rates:
 * - add_funder
 * - remove_funder
 * - update_funder_rate
 * 
 * @param db Database connection
 * @param listId Drips list ID
 * @param totalRatePerSec New total rate per second
 * @param funderCount Current number of funders
 * @param eventId Event ID that triggered the change
 */
export async function recordFundingRateChange(
  db: any,
  listId: string,
  totalRatePerSec: string,
  funderCount: number,
  eventId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO funding_rate_changes 
     (list_id, timestamp, total_rate_per_sec, funder_count, event_id)
     VALUES (?, datetime('now'), ?, ?, ?)`,
    [listId, totalRatePerSec, funderCount, eventId],
  );
}

/**
 * Get latest funding rate for a list
 */
export async function getLatestFundingRate(
  db: any,
  listId: string,
): Promise<FundingRateChange | null> {
  const results = await db.query(
    `SELECT timestamp, total_rate_per_sec, funder_count, event_id
     FROM funding_rate_changes
     WHERE list_id = ?
     ORDER BY timestamp DESC
     LIMIT 1`,
    [listId],
  );

  if (results.length === 0) {
    return null;
  }

  const row = results[0];
  return {
    timestamp: row.timestamp,
    total_rate_per_sec: row.total_rate_per_sec.toString(),
    funder_count: row.funder_count,
    event_id: row.event_id,
  };
}

/**
 * Database migration for funding_rate_changes table
 * 
 * Run this to create the table:
 * ```sql
 * CREATE TABLE IF NOT EXISTS funding_rate_changes (
 *   id INTEGER PRIMARY KEY AUTOINCREMENT,
 *   list_id TEXT NOT NULL,
 *   timestamp TEXT NOT NULL,
 *   total_rate_per_sec TEXT NOT NULL,
 *   funder_count INTEGER NOT NULL,
 *   event_id TEXT,
 *   FOREIGN KEY (list_id) REFERENCES drips_lists(id)
 * );
 * 
 * CREATE INDEX idx_funding_rate_changes_list_timestamp 
 * ON funding_rate_changes(list_id, timestamp);
 * ```
 */

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      db?: any;
    }
  }
}

export default router;
