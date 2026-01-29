/**
 * WhatsApp Web.js - Send Message Script
 * 
 * Usage: node src/sendMessage.js [phone] [message]
 * Example: node src/sendMessage.js 14155551234 "Hello!"
 */

import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';

dotenv.config();

// Get phone number and message from args or env
const phoneNumber = process.argv[2] || process.env.TEST_PHONE_NUMBER;
const messageText = process.argv[3] || process.env.DEFAULT_MESSAGE || 'Hello from WhatsApp Web.js!';

if (!phoneNumber) {
    console.error('❌ Error: Phone number is required');
    console.log('\nUsage: node src/sendMessage.js [phone] [message]');
    console.log('Example: node src/sendMessage.js 14155551234 "Hello!"');
    console.log('\nOr set TEST_PHONE_NUMBER in your .env file');
    process.exit(1);
}

// Format phone number for WhatsApp (number@c.us)
const chatId = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;

console.log(`📱 Target: ${phoneNumber}`);
console.log(`💬 Message: ${messageText}\n`);

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
        // Check if number is registered on WhatsApp
        const isRegistered = await client.isRegisteredUser(chatId);
        
        if (!isRegistered) {
            console.error(`❌ Number ${phoneNumber} is not registered on WhatsApp`);
            await client.destroy();
            process.exit(1);
        }
        
        console.log(`✅ Number is registered on WhatsApp`);
        
        // Send the message
        const result = await client.sendMessage(chatId, messageText);
        
        console.log('\n✅ Message sent successfully!');
        console.log(`   ID: ${result.id._serialized}`);
        console.log(`   Timestamp: ${new Date(result.timestamp * 1000).toLocaleString()}`);
        
    } catch (error) {
        console.error('❌ Error sending message:', error.message);
    }
    
    // Cleanup
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
