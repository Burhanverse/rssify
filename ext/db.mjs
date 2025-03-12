// db.mjs - Extension Module for MongoDB Connection
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { log } from './colorLog.mjs';

dotenv.config();

const MONGO_URI = process.env.DB_URI;
const DATABASE_NAME = process.env.DB_NAME || 'rssify';

const client = new MongoClient(MONGO_URI);

export let db;
export let chatCollection;
export let logCollection;
export let spamCollection;

export async function connectDB() {
    if (db) return;

    try {
        await client.connect();
        db = client.db(DATABASE_NAME);
        chatCollection = db.collection('chats');
        logCollection = db.collection('logs');
        spamCollection = db.collection('spam');
        log.success('Connected to MongoDB');
    } catch (err) {
        log.error('Failed to connect to MongoDB:', err.message);
        process.exit(1);
    }
}