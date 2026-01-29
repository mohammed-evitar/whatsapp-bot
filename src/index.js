/**
 * WhatsApp Web.js - Main Client Setup
 * 
 * This is the main entry point that:
 * 1. Initializes the WhatsApp client
 * 2. Generates QR code for authentication
 * 3. Listens for incoming messages
 * 4. Demonstrates basic message handling
 */

import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';

dotenv.config();

// Initialize client with local authentication (persists session)
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
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// ============================================
// EVENT HANDLERS
// ============================================

// Generate QR Code for authentication
client.on('qr', (qr) => {
    console.log('\n📱 Scan this QR code with your WhatsApp:\n');
    qrcode.generate(qr, { small: true });
    console.log('\n⏳ Waiting for scan...\n');
});

// Client is authenticated
client.on('authenticated', () => {
    console.log('✅ Authentication successful!');
});

// Authentication failure
client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failed:', msg);
});

// Client is ready
client.on('ready', async () => {
    console.log('🚀 WhatsApp client is ready!\n');
    
    // Get client info
    const info = client.info;
    console.log('📋 Client Info:');
    console.log(`   Name: ${info.pushname}`);
    console.log(`   Phone: ${info.wid.user}`);
    console.log(`   Platform: ${info.platform}\n`);
    
    console.log('💡 Listening for messages...');
    console.log('   Send "!ping" to any chat to test\n');
});

// Handle incoming messages
client.on('message', async (message) => {
    const contact = await message.getContact();
    const chat = await message.getChat();
    
    console.log(`📨 New message from ${contact.pushname || contact.number}:`);
    console.log(`   Chat: ${chat.name || 'Private'}`);
    console.log(`   Message: ${message.body}\n`);

    // Command handlers
    const body = message.body.toLowerCase();

    // Ping command
    if (body === '!ping') {
        await message.reply('🏓 Pong!');
        console.log('   → Replied with Pong!\n');
    }

    // Help command
    if (body === '!help') {
        const helpText = `🤖 *WhatsApp Bot Commands*\n
!ping - Check if bot is alive
!help - Show this help message
!time - Get current time
!info - Get chat info
!echo [text] - Echo back your message`;
        
        await message.reply(helpText);
        console.log('   → Sent help message\n');
    }

    // Time command
    if (body === '!time') {
        const now = new Date().toLocaleString();
        await message.reply(`🕐 Current time: ${now}`);
        console.log('   → Sent current time\n');
    }

    // Info command
    if (body === '!info') {
        const isGroup = chat.isGroup;
        let infoText = `📊 *Chat Info*\n\n`;
        infoText += `Type: ${isGroup ? 'Group' : 'Private'}\n`;
        infoText += `Name: ${chat.name || 'N/A'}\n`;
        
        if (isGroup) {
            infoText += `Participants: ${chat.participants?.length || 'Unknown'}\n`;
        }
        
        await message.reply(infoText);
        console.log('   → Sent chat info\n');
    }

    // Echo command
    if (body.startsWith('!echo ')) {
        const echoText = message.body.substring(6);
        await message.reply(`📢 ${echoText}`);
        console.log('   → Echoed message\n');
    }
});

// Handle message creation (for sent messages tracking)
client.on('message_create', (message) => {
    if (message.fromMe) {
        console.log(`📤 Sent message: ${message.body.substring(0, 50)}...\n`);
    }
});

// Disconnection handler
client.on('disconnected', (reason) => {
    console.log('🔌 Client was disconnected:', reason);
});

// ============================================
// INITIALIZE CLIENT
// ============================================

console.log('🔄 Initializing WhatsApp Web client...\n');
client.initialize();

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down...');
    await client.destroy();
    process.exit(0);
});
