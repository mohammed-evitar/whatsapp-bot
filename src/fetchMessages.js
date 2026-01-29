/**
 * WhatsApp Web.js - Fetch Messages from Contact
 * 
 * Fetches chat history from a specific contact
 * 
 * Usage: node src/fetchMessages.js [contactName] [limit]
 * Example: node src/fetchMessages.js "Suhan" 50
 */

import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';

dotenv.config();

const contactName = process.argv[2] || 'Suhan';
const messageLimit = parseInt(process.argv[3]) || 50;

console.log(`🔍 Looking for contact: ${contactName}`);
console.log(`📊 Message limit: ${messageLimit}\n`);

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
        // Get all chats
        const chats = await client.getChats();
        
        // Find the chat by contact name (case-insensitive partial match)
        const chat = chats.find(c => {
            const chatName = c.name || '';
            return chatName.toLowerCase().includes(contactName.toLowerCase());
        });
        
        if (!chat) {
            console.error(`❌ Contact "${contactName}" not found`);
            console.log('\n📋 Available chats (showing first 20):');
            chats.slice(0, 20).forEach(c => {
                const type = c.isGroup ? '👥' : '👤';
                console.log(`   ${type} ${c.name || c.id.user}`);
            });
            await client.destroy();
            process.exit(1);
        }
        
        console.log(`✅ Found chat: ${chat.name}`);
        console.log(`   Type: ${chat.isGroup ? 'Group' : 'Private'}`);
        console.log(`   ID: ${chat.id._serialized}\n`);
        
        // Fetch messages
        console.log(`📨 Fetching last ${messageLimit} messages...\n`);
        const messages = await chat.fetchMessages({ limit: messageLimit });
        
        console.log('─'.repeat(70));
        
        for (const msg of messages) {
            const timestamp = new Date(msg.timestamp * 1000).toLocaleString();
            const sender = msg.fromMe ? '📤 You' : `📥 ${chat.name}`;
            const body = msg.body || '[Media/No text]';
            
            // Message type indicator
            let typeIndicator = '';
            if (msg.hasMedia) typeIndicator = '📎 ';
            if (msg.type === 'sticker') typeIndicator = '🎨 ';
            if (msg.type === 'image') typeIndicator = '🖼️ ';
            if (msg.type === 'video') typeIndicator = '🎥 ';
            if (msg.type === 'audio' || msg.type === 'ptt') typeIndicator = '🎵 ';
            if (msg.type === 'document') typeIndicator = '📄 ';
            if (msg.type === 'location') typeIndicator = '📍 ';
            
            console.log(`\n[${timestamp}] ${sender}`);
            console.log(`   ${typeIndicator}${body.substring(0, 200)}${body.length > 200 ? '...' : ''}`);
        }
        
        console.log('\n' + '─'.repeat(70));
        console.log(`\n✅ Fetched ${messages.length} messages from ${chat.name}`);
        
        // Summary stats
        const myMessages = messages.filter(m => m.fromMe).length;
        const theirMessages = messages.length - myMessages;
        console.log(`\n📊 Summary:`);
        console.log(`   Your messages: ${myMessages}`);
        console.log(`   Their messages: ${theirMessages}`);
        
    } catch (error) {
        console.error('❌ Error fetching messages:', error.message);
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
