// Issue #1059: Nightly SQLite snapshot backup with 7-day retention
// Scheduled job that backs up SQLite database at 02:00 UTC daily

import * as fs from 'fs/promises';
import * as path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import * as schedule from 'node-schedule';

export interface BackupConfig {
  /** Path to source SQLite database file */
  sourcePath: string;
  /** Directory to store backups */
  backupDir: string;
  /** Retention period in days */
  retentionDays?: number;
  /** Backup schedule (cron format) */
  schedule?: string;
  /** Enable backup job */
  enabled?: boolean;
}

const DEFAULT_CONFIG: Required<BackupConfig> = {
  sourcePath: './data/indexer.sqlite',
  backupDir: './data/backups',
  retentionDays: 7,
  schedule: '0 2 * * *', // 02:00 UTC daily
  enabled: true,
};

export interface BackupResult {
  success: boolean;
  timestamp: string;
  backupPath?: string;
  sourceSize?: number;
  backupSize?: number;
  duration?: number;
  error?: string;
}

/**
 * SQLite Backup Manager
 * 
 * Features:
 * - Scheduled daily backups at 02:00 UTC
 * - Timestamped backup files (indexer-YYYY-MM-DD.sqlite)
 * - Automatic cleanup of backups older than 7 days
 * - Verification of backup integrity
 * - Detailed logging of success/failure
 */
export class SQLiteBackupManager {
  private config: Required<BackupConfig>;
  private job?: schedule.Job;

  constructor(config: Partial<BackupConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the backup scheduler
   */
  start(): void {
    if (!this.config.enabled) {
      console.log('SQLite backup job is disabled');
      return;
    }

    console.log(`Starting SQLite backup scheduler with cron: ${this.config.schedule}`);
    console.log(`Source: ${this.config.sourcePath}`);
    console.log(`Backup directory: ${this.config.backupDir}`);
    console.log(`Retention: ${this.config.retentionDays} days`);

    this.job = schedule.scheduleJob(this.config.schedule, async () => {
      console.log('Running scheduled SQLite backup...');
      const result = await this.performBackup();
      this.logBackupResult(result);
    });

    console.log('SQLite backup scheduler started');
  }

  /**
   * Stop the backup scheduler
   */
  stop(): void {
    if (this.job) {
      this.job.cancel();
      console.log('SQLite backup scheduler stopped');
    }
  }

  /**
   * Perform a manual backup
   */
  async performBackup(): Promise<BackupResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    try {
      // Ensure backup directory exists
      await fs.mkdir(this.config.backupDir, { recursive: true });

      // Generate backup filename with current date
      const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const backupFilename = `indexer-${date}.sqlite`;
      const backupPath = path.join(this.config.backupDir, backupFilename);

      // Check if source file exists
      try {
        await fs.access(this.config.sourcePath);
      } catch {
        throw new Error(`Source database not found: ${this.config.sourcePath}`);
      }

      // Get source file size
      const sourceStats = await fs.stat(this.config.sourcePath);
      const sourceSize = sourceStats.size;

      console.log(`Backing up database (${formatBytes(sourceSize)})...`);

      // Copy database file
      await this.copyDatabase(this.config.sourcePath, backupPath);

      // Verify backup
      const backupStats = await fs.stat(backupPath);
      const backupSize = backupStats.size;

      if (backupSize === 0 || backupSize !== sourceSize) {
        throw new Error('Backup verification failed: size mismatch');
      }

      console.log(`Backup created: ${backupPath} (${formatBytes(backupSize)})`);

      // Clean up old backups
      const deletedCount = await this.cleanupOldBackups();
      if (deletedCount > 0) {
        console.log(`Cleaned up ${deletedCount} old backup(s)`);
      }

      const duration = Date.now() - startTime;

      return {
        success: true,
        timestamp,
        backupPath,
        sourceSize,
        backupSize,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      console.error('Backup failed:', errorMessage);

      return {
        success: false,
        timestamp,
        duration,
        error: errorMessage,
      };
    }
  }

  /**
   * Copy database file using streaming for memory efficiency
   */
  private async copyDatabase(source: string, destination: string): Promise<void> {
    const readStream = createReadStream(source);
    const writeStream = createWriteStream(destination);

    await pipeline(readStream, writeStream);
  }

  /**
   * Clean up backups older than retention period
   */
  private async cleanupOldBackups(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

    try {
      const files = await fs.readdir(this.config.backupDir);
      let deletedCount = 0;

      for (const file of files) {
        // Only process backup files matching pattern
        if (!file.match(/^indexer-\d{4}-\d{2}-\d{2}\.sqlite$/)) {
          continue;
        }

        const filePath = path.join(this.config.backupDir, file);
        const stats = await fs.stat(filePath);

        // Delete if older than retention period
        if (stats.mtime < cutoffDate) {
          await fs.unlink(filePath);
          console.log(`Deleted old backup: ${file}`);
          deletedCount++;
        }
      }

      return deletedCount;
    } catch (error) {
      console.error('Error cleaning up old backups:', error);
      return 0;
    }
  }

  /**
   * List all backup files
   */
  async listBackups(): Promise<Array<{
    filename: string;
    path: string;
    size: number;
    created: Date;
  }>> {
    try {
      const files = await fs.readdir(this.config.backupDir);
      const backups = [];

      for (const file of files) {
        if (!file.match(/^indexer-\d{4}-\d{2}-\d{2}\.sqlite$/)) {
          continue;
        }

        const filePath = path.join(this.config.backupDir, file);
        const stats = await fs.stat(filePath);

        backups.push({
          filename: file,
          path: filePath,
          size: stats.size,
          created: stats.mtime,
        });
      }

      // Sort by creation date, newest first
      backups.sort((a, b) => b.created.getTime() - a.created.getTime());

      return backups;
    } catch (error) {
      console.error('Error listing backups:', error);
      return [];
    }
  }

  /**
   * Get backup statistics
   */
  async getBackupStats(): Promise<{
    totalBackups: number;
    totalSize: number;
    oldestBackup?: Date;
    newestBackup?: Date;
  }> {
    const backups = await this.listBackups();

    const totalSize = backups.reduce((sum, backup) => sum + backup.size, 0);

    return {
      totalBackups: backups.length,
      totalSize,
      oldestBackup: backups.length > 0 ? backups[backups.length - 1].created : undefined,
      newestBackup: backups.length > 0 ? backups[0].created : undefined,
    };
  }

  /**
   * Restore database from backup
   */
  async restoreFromBackup(backupFilename: string): Promise<void> {
    const backupPath = path.join(this.config.backupDir, backupFilename);

    // Check if backup exists
    try {
      await fs.access(backupPath);
    } catch {
      throw new Error(`Backup not found: ${backupFilename}`);
    }

    // Create backup of current database before restoring
    const currentBackupPath = `${this.config.sourcePath}.before-restore`;
    await this.copyDatabase(this.config.sourcePath, currentBackupPath);

    console.log(`Created safety backup: ${currentBackupPath}`);

    // Restore from backup
    await this.copyDatabase(backupPath, this.config.sourcePath);

    console.log(`Database restored from: ${backupFilename}`);
  }

  /**
   * Log backup result
   */
  private logBackupResult(result: BackupResult): void {
    if (result.success) {
      console.log('✓ SQLite backup completed successfully');
      console.log(`  Timestamp: ${result.timestamp}`);
      console.log(`  Backup path: ${result.backupPath}`);
      console.log(`  Source size: ${formatBytes(result.sourceSize!)}`);
      console.log(`  Backup size: ${formatBytes(result.backupSize!)}`);
      console.log(`  Duration: ${result.duration}ms`);
    } else {
      console.error('✗ SQLite backup failed');
      console.error(`  Timestamp: ${result.timestamp}`);
      console.error(`  Error: ${result.error}`);
      console.error(`  Duration: ${result.duration}ms`);
    }
  }
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Initialize backup manager singleton
 */
let backupManager: SQLiteBackupManager | null = null;

export function initializeBackupManager(config?: Partial<BackupConfig>): SQLiteBackupManager {
  if (!backupManager) {
    backupManager = new SQLiteBackupManager(config);
  }
  return backupManager;
}

export function getBackupManager(): SQLiteBackupManager | null {
  return backupManager;
}

/**
 * Start backup scheduler (call from app startup)
 */
export function startBackupScheduler(config?: Partial<BackupConfig>): void {
  const manager = initializeBackupManager(config);
  manager.start();
}

/**
 * Stop backup scheduler (call from app shutdown)
 */
export function stopBackupScheduler(): void {
  if (backupManager) {
    backupManager.stop();
  }
}
