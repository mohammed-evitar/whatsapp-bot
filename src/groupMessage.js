/**
 * WhatsApp Web.js - Send Group Message Script
 * 
 * Send a message to a WhatsApp group
 * 
 * Usage: node src/groupMessage.js [groupName] [message]
 */

import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';

dotenv.config();

const groupName = process.argv[2];
const messageText = process.argv[3] || 'Hello group!';

if (!groupName) {
    console.error('❌ Error: Group name is required');
    console.log('\nUsage: node src/groupMessage.js [groupName] [message]');
    console.log('Example: node src/groupMessage.js "Family Group" "Hello everyone!"');
    console.log('\nTip: Use "npm run groups" to list available groups');
    process.exit(1);
}

console.log(`👥 Target group: ${groupName}`);
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
        // Get all chats
        const chats = await client.getChats();
        
        // Find the group by name (case-insensitive partial match)
        const group = chats.find(chat => 
            chat.isGroup && 
            chat.name.toLowerCase().includes(groupName.toLowerCase())
        );
        
        if (!group) {
            console.error(`❌ Group "${groupName}" not found`);
            console.log('\nAvailable groups:');
            const groups = chats.filter(c => c.isGroup);
            groups.forEach(g => console.log(`   - ${g.name}`));
            await client.destroy();
            process.exit(1);
        }
        
        console.log(`✅ Found group: ${group.name}`);
        console.log(`   Participants: ${group.participants?.length || 'Unknown'}`);
        
        // Send the message
        const result = await client.sendMessage(group.id._serialized, messageText);
        
        console.log('\n✅ Message sent successfully!');
        console.log(`   ID: ${result.id._serialized}`);
        console.log(`   Timestamp: ${new Date(result.timestamp * 1000).toLocaleString()}`);
        
    } catch (error) {
        console.error('❌ Error sending message:', error.message);
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
