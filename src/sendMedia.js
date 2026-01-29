/**
 * WhatsApp Web.js - Send Media Script
 * 
 * Demonstrates sending images, documents, and other media
 * 
 * Usage: node src/sendMedia.js [phone] [filepath] [caption]
 */

import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const phoneNumber = process.argv[2] || process.env.TEST_PHONE_NUMBER;
const filePath = process.argv[3];
const caption = process.argv[4] || '';

if (!phoneNumber) {
    console.error('❌ Error: Phone number is required');
    console.log('\nUsage: node src/sendMedia.js [phone] [filepath] [caption]');
    console.log('Example: node src/sendMedia.js 14155551234 ./image.png "Check this out!"');
    process.exit(1);
}

if (!filePath) {
    console.error('❌ Error: File path is required');
    console.log('\nUsage: node src/sendMedia.js [phone] [filepath] [caption]');
    process.exit(1);
}

if (!fs.existsSync(filePath)) {
    console.error(`❌ Error: File not found: ${filePath}`);
    process.exit(1);
}

const chatId = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;

console.log(`📱 Target: ${phoneNumber}`);
console.log(`📎 File: ${filePath}`);
if (caption) console.log(`💬 Caption: ${caption}`);
console.log('');

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: process.env.SESSION_DATA_PATH || '.wwebjs_auth'
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    }
});

client.on('qr', (qr) => {
    console.log('\n📱 Scan this QR code with your WhatsApp:\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('🚀 Client ready!\n');
    
    try {
        // Check if number is registered
        const isRegistered = await client.isRegisteredUser(chatId);
        
        if (!isRegistered) {
            console.error(`❌ Number ${phoneNumber} is not registered on WhatsApp`);
            await client.destroy();
            process.exit(1);
        }
        
        // Create media from file
        const media = MessageMedia.fromFilePath(filePath);
        console.log(`📊 Media type: ${media.mimetype}`);
        console.log(`📏 File size: ${(media.data.length / 1024).toFixed(2)} KB (base64)`);
        
        // Send media
        const result = await client.sendMessage(chatId, media, {
            caption: caption || undefined
        });
        
        console.log('\n✅ Media sent successfully!');
        console.log(`   ID: ${result.id._serialized}`);
        console.log(`   Timestamp: ${new Date(result.timestamp * 1000).toLocaleString()}`);
        
    } catch (error) {
        console.error('❌ Error sending media:', error.message);
    }
    
    console.log('\n👋 Closing connection...');
    await client.destroy();
    process.exit(0);
});

client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failed:', msg);
    process.exit(1);
});

console.log('🔄 Initializing client...\n');
client.initialize();
