/**
 * db/client.js — SQLite database client
 *
 * Singleton SQLite connection for the application.
 * Uses better-sqlite3 for synchronous, fast queries.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATABASE_URL = process.env.DATABASE_URL || 'sqlite:./data/portal.db';
const dbPath = DATABASE_URL.replace('sqlite:', '');
const absolutePath = path.resolve(dbPath);

let db = null;

/**
 * Get or create the database connection.
 */
function getDb() {
  if (db) return db;

  const dbDir = path.dirname(absolutePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(absolutePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  return db;
}

/**
 * Close the database connection.
 */
function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  closeDb,
};
