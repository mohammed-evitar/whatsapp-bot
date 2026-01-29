/**
 * WhatsApp Web.js - List Contacts Script
 * 
 * Lists all your WhatsApp contacts
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
        // Get all contacts
        const contacts = await client.getContacts();
        
        // Filter out non-user contacts (groups, broadcasts, etc.)
        const userContacts = contacts.filter(contact => 
            contact.isUser && 
            !contact.isMe && 
            !contact.isGroup &&
            contact.isWAContact
        );
        
        console.log(`📋 Found ${userContacts.length} contacts:\n`);
        console.log('─'.repeat(60));
        
        // Sort by name
        userContacts.sort((a, b) => {
            const nameA = a.pushname || a.name || a.number || '';
            const nameB = b.pushname || b.name || b.number || '';
            return nameA.localeCompare(nameB);
        });
        
        for (const contact of userContacts) {
            const name = contact.pushname || contact.name || 'Unknown';
            const number = contact.number || 'N/A';
            const savedName = contact.name || '';
            
            console.log(`\n👤 ${name}`);
            console.log(`   Phone: ${number}`);
            if (savedName && savedName !== name) {
                console.log(`   Saved as: ${savedName}`);
            }
            console.log(`   ID: ${contact.id._serialized}`);
        }
        
        console.log('\n' + '─'.repeat(60));
        console.log(`\n✅ Total: ${userContacts.length} contacts`);
        
    } catch (error) {
        console.error('❌ Error listing contacts:', error.message);
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
