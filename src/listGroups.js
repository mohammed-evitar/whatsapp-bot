/**
 * WhatsApp Web.js - List Groups Script
 * 
 * Lists all WhatsApp groups you're a member of
 */

import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';

dotenv.config();

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
        
        // Filter only groups
        const groups = chats.filter(chat => chat.isGroup);
        
        console.log(`📋 Found ${groups.length} groups:\n`);
        console.log('─'.repeat(60));
        
        for (const group of groups) {
            const participantCount = group.participants?.length || 'Unknown';
            const unreadCount = group.unreadCount || 0;
            
            console.log(`\n👥 ${group.name}`);
            console.log(`   ID: ${group.id._serialized}`);
            console.log(`   Participants: ${participantCount}`);
            console.log(`   Unread: ${unreadCount}`);
            
            // Get last message if available
            const lastMsg = group.lastMessage;
            if (lastMsg) {
                const preview = lastMsg.body?.substring(0, 50) || '[Media]';
                console.log(`   Last message: ${preview}${lastMsg.body?.length > 50 ? '...' : ''}`);
            }
        }
        
        console.log('\n' + '─'.repeat(60));
        console.log(`\n✅ Total: ${groups.length} groups`);
        
    } catch (error) {
        console.error('❌ Error listing groups:', error.message);
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
