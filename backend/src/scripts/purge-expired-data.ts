import 'dotenv/config';
import { homedir } from 'os';
import { join } from 'path';
import { purgeExpiredData } from '../modules/retention/retention.service';

const backupDir = process.env.RETENTION_BACKUP_DIR || join(homedir(), 'retention-backups');

purgeExpiredData(backupDir)
    .then(summary => {
        console.info(JSON.stringify({ event: 'retention_purge_completed', ...summary }));
        process.exit(0);
    })
    .catch((err: unknown) => {
        console.error(JSON.stringify({ event: 'retention_purge_failed', backupDir, error: err instanceof Error ? err.message : String(err) }));
        process.exit(1);
    });
