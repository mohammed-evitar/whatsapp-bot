# WhatsApp Web.js POC

A Proof of Concept for WhatsApp automation using [whatsapp-web.js](https://wwebjs.dev/).

## Features

- ✅ QR Code authentication
- ✅ Persistent session (no re-scan needed)
- ✅ Send messages to contacts
- ✅ Send messages to groups
- ✅ Send media (images, documents, etc.)
- ✅ List contacts and groups
- ✅ Receive and reply to messages
- ✅ Bot commands (!ping, !help, !time, etc.)

## Prerequisites

- Node.js 18+ 
- A WhatsApp account
- Chromium browser (installed automatically by puppeteer)

## Installation

```bash
cd whatsapp-web-poc
npm install
```

## Configuration

1. Copy the example env file:
```bash
cp .env.example .env
```

2. Edit `.env` with your settings:
```env
TEST_PHONE_NUMBER=14155551234  # For quick testing
DEFAULT_MESSAGE=Hello from WhatsApp Bot!
```

## Usage

### 1. Start the Bot (Listen for Messages)

```bash
npm start
```

This will:
- Show a QR code in terminal
- Scan with WhatsApp (Settings → Linked Devices → Link a Device)
- Bot starts listening for messages
- Responds to commands like `!ping`, `!help`, `!time`, `!info`, `!echo [text]`

### 2. Send a Message

```bash
# Using command line args
npm run send -- 14155551234 "Hello there!"

# Or using env variable (set TEST_PHONE_NUMBER in .env)
npm run send -- "" "Hello!"

# Direct node command
node src/sendMessage.js 14155551234 "Your message here"
```

### 3. Send Media

```bash
node src/sendMedia.js 14155551234 ./path/to/image.png "Check this out!"
```

### 4. List Your Groups

```bash
npm run groups
```

### 5. List Your Contacts

```bash
npm run contacts
```

### 6. Send Message to Group

```bash
node src/groupMessage.js "Family" "Hello everyone!"
```

## Bot Commands

When the bot is running (`npm start`), users can send these commands:

| Command | Description |
|---------|-------------|
| `!ping` | Check if bot is online |
| `!help` | Show available commands |
| `!time` | Get current time |
| `!info` | Get chat information |
| `!echo [text]` | Bot echoes back your text |

## Project Structure

```
whatsapp-web-poc/
├── src/
│   ├── index.js          # Main bot with message handling
│   ├── sendMessage.js    # Send message to a contact
│   ├── sendMedia.js      # Send images/files
│   ├── listGroups.js     # List all groups
│   ├── listContacts.js   # List all contacts
│   └── groupMessage.js   # Send message to a group
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Session Persistence

After first QR scan, the session is saved in `.wwebjs_auth/`. Future runs will auto-authenticate without scanning again.

To reset/re-link:
```bash
rm -rf .wwebjs_auth
npm start  # Will show new QR code
```

## API Examples

### Send Message Programmatically

```javascript
import { Client, LocalAuth } from 'whatsapp-web.js';

const client = new Client({
    authStrategy: new LocalAuth()
});

client.on('ready', async () => {
    // Send to phone number
    await client.sendMessage('14155551234@c.us', 'Hello!');
    
    // Send to group (use group ID)
    await client.sendMessage('123456789@g.us', 'Hello group!');
});

client.initialize();
```

### Send Media

```javascript
import { MessageMedia } from 'whatsapp-web.js';

// From file
const media = MessageMedia.fromFilePath('./image.png');
await client.sendMessage('14155551234@c.us', media, { caption: 'Check this!' });

// From URL
const mediaUrl = await MessageMedia.fromUrl('https://example.com/image.jpg');
await client.sendMessage('14155551234@c.us', mediaUrl);

// From base64
const media64 = new MessageMedia('image/png', base64Data, 'filename.png');
await client.sendMessage('14155551234@c.us', media64);
```

### Get Chat History

```javascript
client.on('ready', async () => {
    const chat = await client.getChatById('14155551234@c.us');
    const messages = await chat.fetchMessages({ limit: 50 });
    
    messages.forEach(msg => {
        console.log(`${msg.from}: ${msg.body}`);
    });
});
```

## Important Notes

⚠️ **WhatsApp Terms of Service**: This library works by automating WhatsApp Web. Use responsibly and avoid:
- Bulk messaging / spam
- Automated messages without consent
- Any activity that violates WhatsApp ToS

Your account could be banned for misuse.

## Troubleshooting

### "Puppeteer failed to launch"
```bash
# On Ubuntu/Debian
sudo apt-get install -y chromium-browser

# On macOS (usually works out of box)
# If issues, try:
brew install chromium
```

### "Session expired / Authentication failed"
```bash
rm -rf .wwebjs_auth
npm start  # Scan QR again
```

### "Execution context was destroyed"
This usually means WhatsApp Web reloaded. The client will auto-reconnect.

## Resources

- [whatsapp-web.js Documentation](https://wwebjs.dev/)
- [whatsapp-web.js GitHub](https://github.com/pedroslopez/whatsapp-web.js)
- [API Reference](https://docs.wwebjs.dev/)

## License

MIT
