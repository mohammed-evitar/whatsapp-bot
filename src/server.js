/**
 * WhatsApp Web.js - Jira Integration + Alloe AI
 * 
 * Listens to "Alloe.Life Product Engineering" group
 * Commands: #add P0-P5 <task>, #p0, #p1, #today, #ask, etc.
 */

import express from 'express';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

// OpenAI Client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Jira Config
const JIRA_DOMAIN = process.env.JIRA_DOMAIN;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY || 'KAN';

// Priority mapping (P0-P5 to Jira priority IDs)
// Jira default: Highest=1, High=2, Medium=3, Low=4, Lowest=5
const PRIORITY_MAP = {
    'p0': { id: '1', name: 'Highest (P0)' },
    'p1': { id: '1', name: 'Highest (P1)' },
    'p2': { id: '2', name: 'High (P2)' },
    'p3': { id: '3', name: 'Medium (P3)' },
    'p4': { id: '4', name: 'Low (P4)' },
    'p5': { id: '5', name: 'Lowest (P5)' }
};

// State
let client = null;
let isReady = false;
let clientInfo = null;

const incomingMessages = [];
const WATCHED_CONTACT = 'Alloe.Life Product Engineering';

// Team members for quick assignment (shortcut -> search name)
const TEAM_MEMBERS = {
    'suhan': 'suhan ahmed',
    'amit': 'Amit',
    'mohammed': 'mohammed',
    'mahesh': 'Mahesh Puli'
};

// ============================================
// JIRA API FUNCTIONS
// ============================================

async function jiraRequest(endpoint, method = 'GET', body = null) {
    const url = `https://${JIRA_DOMAIN}/rest/api/3${endpoint}`;
    const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
    
    const options = {
        method,
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    };
    
    if (body) {
        options.body = JSON.stringify(body);
    }
    
    const response = await fetch(url, options);
    
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Jira API error: ${response.status} - ${error}`);
    }
    
    // Handle empty response (like from transitions)
    const text = await response.text();
    if (!text) return {};
    
    return JSON.parse(text);
}

async function createJiraTask(fullText, priority) {
    const priorityKey = priority.toLowerCase();
    const priorityInfo = PRIORITY_MAP[priorityKey] || PRIORITY_MAP['p3'];
    
    // First 15 words as title, full text as description
    const words = fullText.split(/\s+/);
    const title = words.slice(0, 15).join(' ') + (words.length > 15 ? '...' : '');
    const description = fullText;
    
    const body = {
        fields: {
            project: { key: JIRA_PROJECT_KEY },
            summary: title,
            description: {
                type: 'doc',
                version: 1,
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: description
                            }
                        ]
                    }
                ]
            },
            issuetype: { name: 'Task' },
            priority: { id: priorityInfo.id },
            labels: [priorityKey.toUpperCase(), 'whatsapp-bot']
        }
    };
    
    const result = await jiraRequest('/issue', 'POST', body);
    return {
        key: result.key,
        id: result.id,
        title: title,
        url: `https://${JIRA_DOMAIN}/browse/${result.key}`
    };
}

async function searchJiraUser(query) {
    // Search for user by name or email
    const result = await jiraRequest(`/user/search?query=${encodeURIComponent(query)}&maxResults=1`);
    if (result && result.length > 0) {
        return result[0];
    }
    return null;
}

async function assignTicket(issueKey, accountId) {
    await jiraRequest(`/issue/${issueKey}/assignee`, 'PUT', {
        accountId: accountId
    });
}

async function getTicketDetails(issueKey) {
    const result = await jiraRequest(`/issue/${issueKey}?fields=summary,status,priority,assignee,reporter,created,updated,description,labels`);
    return result;
}

async function markTicketDone(issueKey) {
    // First get available transitions
    const transitions = await jiraRequest(`/issue/${issueKey}/transitions`);
    
    // Find "Done" transition (usually id 31 or 41, but we search by name)
    const doneTransition = transitions.transitions.find(t => 
        t.name.toLowerCase().includes('done')
    );
    
    if (!doneTransition) {
        throw new Error('Could not find "Done" transition for this ticket');
    }
    
    // Perform the transition
    await jiraRequest(`/issue/${issueKey}/transitions`, 'POST', {
        transition: { id: doneTransition.id }
    });
    
    return { 
        key: issueKey, 
        status: 'Done',
        url: `https://${JIRA_DOMAIN}/browse/${issueKey}`
    };
}

async function uploadAttachmentToJira(issueKey, mediaData, filename) {
    const url = `https://${JIRA_DOMAIN}/rest/api/3/issue/${issueKey}/attachments`;
    const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
    
    // Create form data boundary
    const boundary = '----FormBoundary' + Date.now();
    
    // Convert base64 to buffer
    const fileBuffer = Buffer.from(mediaData, 'base64');
    
    // Build multipart form data manually
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    
    const bodyBuffer = Buffer.concat([
        Buffer.from(header),
        fileBuffer,
        Buffer.from(footer)
    ]);
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${auth}`,
            'X-Atlassian-Token': 'no-check',
            'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: bodyBuffer
    });
    
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to upload attachment: ${response.status} - ${error}`);
    }
    
    return response.json();
}

async function fetchJiraTasks(jql) {
    // Using new /search/jql endpoint
    const body = {
        jql: jql,
        maxResults: 20,
        fields: ['summary', 'priority', 'status', 'created', 'labels']
    };
    const result = await jiraRequest('/search/jql', 'POST', body);
    return result.issues || [];
}

async function getTodaysTasks() {
    const jql = `project = ${JIRA_PROJECT_KEY} AND created >= startOfDay() ORDER BY created DESC`;
    return fetchJiraTasks(jql);
}

async function getYesterdaysTasks() {
    const jql = `project = ${JIRA_PROJECT_KEY} AND created >= startOfDay(-1) AND created < startOfDay() ORDER BY created DESC`;
    return fetchJiraTasks(jql);
}

async function getThisWeeksTasks() {
    const jql = `project = ${JIRA_PROJECT_KEY} AND created >= startOfWeek() ORDER BY created DESC`;
    return fetchJiraTasks(jql);
}

async function getTasksByDate(date) {
    // date format: YYYY-MM-DD
    // Calculate next day
    const dateObj = new Date(date);
    dateObj.setDate(dateObj.getDate() + 1);
    const nextDay = dateObj.toISOString().split('T')[0];
    
    const jql = `project = ${JIRA_PROJECT_KEY} AND created >= "${date}" AND created < "${nextDay}" ORDER BY created DESC`;
    return fetchJiraTasks(jql);
}

async function getTasksByPriority(priority) {
    const priorityKey = priority.toUpperCase();
    // Search by label since we add priority as label
    const jql = `project = ${JIRA_PROJECT_KEY} AND labels in ("${priorityKey}") AND status != Done ORDER BY created DESC`;
    return fetchJiraTasks(jql);
}

async function getTasksByAssignee(assigneeName) {
    // Search for open tasks assigned to this person (not done)
    const jql = `project = ${JIRA_PROJECT_KEY} AND assignee = "${assigneeName}" AND status != Done ORDER BY created DESC`;
    return fetchJiraTasks(jql);
}

async function getPendingTasksByAssignee(assigneeName) {
    // Search for pending/To Do tasks only (not in progress, not done)
    const jql = `project = ${JIRA_PROJECT_KEY} AND assignee = "${assigneeName}" AND status = "To Do" ORDER BY created DESC`;
    return fetchJiraTasks(jql);
}

async function getAllTasksByAssignee(assigneeName) {
    // Search for ALL tasks (including done) assigned to this person
    const jql = `project = ${JIRA_PROJECT_KEY} AND assignee = "${assigneeName}" ORDER BY created DESC`;
    return fetchJiraTasks(jql);
}

async function getAllOpenTasks() {
    const jql = `project = ${JIRA_PROJECT_KEY} AND status != Done ORDER BY priority ASC, created DESC`;
    return fetchJiraTasks(jql);
}

async function getAllTasksByPriority(priority) {
    const priorityKey = priority.toUpperCase();
    // All tasks of this priority (including done)
    const jql = `project = ${JIRA_PROJECT_KEY} AND labels in ("${priorityKey}") ORDER BY created DESC`;
    return fetchJiraTasks(jql);
}

async function getAllTasks() {
    // All tasks regardless of status
    const jql = `project = ${JIRA_PROJECT_KEY} ORDER BY created DESC`;
    return fetchJiraTasks(jql);
}

async function getTasksByPriorityAndAssignee(priority, assigneeName) {
    const priorityKey = priority.toUpperCase();
    const jql = `project = ${JIRA_PROJECT_KEY} AND labels in ("${priorityKey}") AND assignee = "${assigneeName}" ORDER BY created DESC`;
    return fetchJiraTasks(jql);
}

function formatTaskList(tasks, title) {
    if (tasks.length === 0) {
        return `📋 *${title}*\n\nNo tasks found.`;
    }
    
    let msg = `📋 *${title}* (${tasks.length})\n\n`;
    
    tasks.forEach((task, i) => {
        const priority = task.fields.labels?.find(l => /^P\d$/i.test(l)) || 'P3';
        const status = task.fields.status?.name || 'Unknown';
        const link = `https://${JIRA_DOMAIN}/browse/${task.key}`;
        msg += `${i + 1}. *${task.key}* - ${task.fields.summary}\n`;
        msg += `   ${priority} | ${status}\n`;
        msg += `   🔗 ${link}\n\n`;
    });
    
    return msg;
}

// ============================================
// OPENAI FUNCTIONS
// ============================================

// Define tools for OpenAI function calling
const openaiTools = [
    {
        type: 'function',
        function: {
            name: 'create_task',
            description: 'Create a new Jira task with specified priority',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Task title/description' },
                    priority: { type: 'string', enum: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'], description: 'Priority level (p0=critical, p1=highest, p2=high, p3=medium, p4=low, p5=lowest)' },
                    assignee: { type: 'string', description: 'Team member to assign (optional): suhan, amit, mohammed, mahesh' }
                },
                required: ['title', 'priority']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_tasks_by_priority',
            description: 'Get open tasks filtered by priority level',
            parameters: {
                type: 'object',
                properties: {
                    priority: { type: 'string', enum: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'], description: 'Priority level to filter' }
                },
                required: ['priority']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_tasks_by_assignee',
            description: 'Get tasks assigned to a team member',
            parameters: {
                type: 'object',
                properties: {
                    assignee: { type: 'string', description: 'Team member name: suhan, amit, mohammed, mahesh' },
                    status: { type: 'string', enum: ['open', 'pending', 'all'], description: 'Filter by status: open (not done), pending (to do only), all (including done)' }
                },
                required: ['assignee']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_tasks_by_priority_and_assignee',
            description: 'Get tasks filtered by BOTH priority level AND assignee. Use this when user asks for tasks of a specific priority from a specific person.',
            parameters: {
                type: 'object',
                properties: {
                    priority: { type: 'string', enum: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'], description: 'Priority level' },
                    assignee: { type: 'string', description: 'Team member name: suhan, amit, mohammed, mahesh' }
                },
                required: ['priority', 'assignee']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_tasks_by_date',
            description: 'Get tasks created on a specific date or time range',
            parameters: {
                type: 'object',
                properties: {
                    period: { type: 'string', enum: ['today', 'yesterday', 'week'], description: 'Time period' },
                    date: { type: 'string', description: 'Specific date in YYYY-MM-DD format (optional, use instead of period)' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_all_tasks',
            description: 'Get all open tasks or all tasks',
            parameters: {
                type: 'object',
                properties: {
                    include_done: { type: 'boolean', description: 'Include completed tasks (default false)' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_ticket_details',
            description: 'Get details of a specific Jira ticket',
            parameters: {
                type: 'object',
                properties: {
                    ticket_key: { type: 'string', description: 'Jira ticket key like KAN-4' }
                },
                required: ['ticket_key']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'mark_ticket_done',
            description: 'Mark a Jira ticket as done/completed',
            parameters: {
                type: 'object',
                properties: {
                    ticket_key: { type: 'string', description: 'Jira ticket key like KAN-4' }
                },
                required: ['ticket_key']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'chat_response',
            description: 'Respond to general questions, chat analysis, or conversation summaries',
            parameters: {
                type: 'object',
                properties: {
                    response: { type: 'string', description: 'The response message to send' }
                },
                required: ['response']
            }
        }
    }
];

async function processAIRequest(chatMessages, userQuery) {
    // Format chat history for context
    const chatContext = chatMessages.map(msg => {
        const time = new Date(msg.timestamp * 1000).toLocaleString();
        const sender = msg.fromMe ? 'You' : (msg._data?.notifyName || 'User');
        return `[${time}] ${sender}: ${msg.body || '[media]'}`;
    }).join('\n');
    
    const systemPrompt = `You are Alloe, a Lifemaxing AI assistant in a WhatsApp group that helps manage Jira tasks and team productivity. You are helpful, concise, and friendly. You can:

1. CREATE TASKS: When user wants to add/create a task, use create_task function
   - "add a P1 task for fixing login" → create_task(title="fixing login", priority="p1")
   - "create urgent task about payment bug assign to suhan" → create_task(title="payment bug", priority="p0", assignee="suhan")

2. FETCH TASKS: When user wants to see/list/show tasks
   - "show P0 tasks" → get_tasks_by_priority(priority="p0")
   - "what are suhan's tasks" → get_tasks_by_assignee(assignee="suhan", status="open")
   - "show all pending tasks for amit" → get_tasks_by_assignee(assignee="amit", status="pending")
   - "get all P0 from mohammed" → get_tasks_by_priority_and_assignee(priority="p0", assignee="mohammed")
   - "suhan's P1 tasks" → get_tasks_by_priority_and_assignee(priority="p1", assignee="suhan")
   - "today's tasks" → get_tasks_by_date(period="today")
   - "all open tasks" → get_all_tasks(include_done=false)

3. TICKET ACTIONS:
   - "details of KAN-5" → get_ticket_details(ticket_key="KAN-5")
   - "mark KAN-5 as done" → mark_ticket_done(ticket_key="KAN-5")

4. CHAT/GENERAL: For summaries, analysis, or general questions → use chat_response

Priority guide: p0/p1=critical/urgent, p2=high, p3=medium, p4=low, p5=lowest
Team: suhan, amit, mohammed, mahesh

Current Jira project: ${JIRA_PROJECT_KEY}

Remember: You are Alloe - be helpful and keep responses concise for WhatsApp.`;

    const userMessage = `Recent chat messages:\n${chatContext}\n\n---\nUser request: ${userQuery}`;
    
    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
            ],
            tools: openaiTools,
            tool_choice: 'required',
            max_tokens: 1000,
            temperature: 0.3
        });
        
        const message = response.choices[0].message;
        
        if (message.tool_calls && message.tool_calls.length > 0) {
            const toolCall = message.tool_calls[0];
            const functionName = toolCall.function.name;
            const args = JSON.parse(toolCall.function.arguments);
            
            console.log(`   → AI detected: ${functionName}`, args);
            
            return { action: functionName, args: args };
        }
        
        // Fallback to text response
        return { action: 'chat_response', args: { response: message.content || 'I could not process that request.' } };
    } catch (error) {
        console.error('Alloe error:', error.message);
        throw new Error(`Alloe Error: ${error.message}`);
    }
}

async function executeAIAction(action, args) {
    switch (action) {
        case 'create_task': {
            const result = await createJiraTask(args.title, args.priority);
            let hasWarning = false;
            let warningMsg = null;
            
            if (args.assignee) {
                try {
                    const searchName = TEAM_MEMBERS[args.assignee.toLowerCase()] || args.assignee;
                    const user = await searchJiraUser(searchName);
                    if (user) {
                        await assignTicket(result.key, user.accountId);
                        console.log(`   → Assigned to ${user.displayName}`);
                    } else {
                        hasWarning = true;
                        warningMsg = `⚠️ Created ${result.key} but user "${args.assignee}" not found\n🔗 ${result.url}`;
                    }
                } catch (e) {
                    hasWarning = true;
                    warningMsg = `⚠️ Created ${result.key} but couldn't assign\n🔗 ${result.url}`;
                }
            }
            
            console.log(`   → Created ${result.key}`);
            // Return ticket info so handler can upload attachments
            return { 
                reactOnly: !hasWarning, 
                ticketKey: result.key,
                response: warningMsg
            };
        }
        
        case 'get_tasks_by_priority': {
            const tasks = await getTasksByPriority(args.priority);
            return formatTaskList(tasks, `${args.priority.toUpperCase()} Tasks`);
        }
        
        case 'get_tasks_by_assignee': {
            const searchName = TEAM_MEMBERS[args.assignee.toLowerCase()] || args.assignee;
            let tasks;
            let title;
            
            if (args.status === 'pending') {
                tasks = await getPendingTasksByAssignee(searchName);
                title = `${args.assignee}'s Pending Tasks`;
            } else if (args.status === 'all') {
                tasks = await getAllTasksByAssignee(searchName);
                title = `All ${args.assignee}'s Tasks`;
            } else {
                tasks = await getTasksByAssignee(searchName);
                title = `${args.assignee}'s Open Tasks`;
            }
            return formatTaskList(tasks, title);
        }
        
        case 'get_tasks_by_priority_and_assignee': {
            const searchName = TEAM_MEMBERS[args.assignee.toLowerCase()] || args.assignee;
            const tasks = await getTasksByPriorityAndAssignee(args.priority, searchName);
            const title = `${args.assignee}'s ${args.priority.toUpperCase()} Tasks`;
            return formatTaskList(tasks, title);
        }
        
        case 'get_tasks_by_date': {
            let tasks;
            let title;
            
            if (args.date) {
                tasks = await getTasksByDate(args.date);
                title = `Tasks from ${args.date}`;
            } else if (args.period === 'today') {
                tasks = await getTodaysTasks();
                title = "Today's Tasks";
            } else if (args.period === 'yesterday') {
                tasks = await getYesterdaysTasks();
                title = "Yesterday's Tasks";
            } else if (args.period === 'week') {
                tasks = await getThisWeeksTasks();
                title = "This Week's Tasks";
            } else {
                tasks = await getTodaysTasks();
                title = "Today's Tasks";
            }
            return formatTaskList(tasks, title);
        }
        
        case 'get_all_tasks': {
            const tasks = args.include_done ? await getAllTasks() : await getAllOpenTasks();
            const title = args.include_done ? 'All Tasks' : 'All Open Tasks';
            return formatTaskList(tasks, title);
        }
        
        case 'get_ticket_details': {
            const ticketKey = args.ticket_key.toUpperCase();
            const ticket = await getTicketDetails(ticketKey);
            const fields = ticket.fields;
            
            const priority = fields.labels?.find(l => /^P\d$/i.test(l)) || 'N/A';
            const status = fields.status?.name || 'Unknown';
            const assignee = fields.assignee?.displayName || 'Unassigned';
            
            return `📋 *${ticketKey}*\n\n*Title:* ${fields.summary}\n*Priority:* ${priority}\n*Status:* ${status}\n*Assignee:* ${assignee}\n\n🔗 https://${JIRA_DOMAIN}/browse/${ticketKey}`;
        }
        
        case 'mark_ticket_done': {
            const ticketKey = args.ticket_key.toUpperCase();
            await markTicketDone(ticketKey);
            console.log(`   → ${ticketKey} marked as Done`);
            return { reactOnly: true }; // Just react with ✅
        }
        
        case 'chat_response': {
            return args.response;
        }
        
        default:
            return '❌ Unknown action';
    }
}

// ============================================
// WHATSAPP CLIENT
// ============================================

function initializeClient() {
    client = new Client({
        authStrategy: new LocalAuth({
            dataPath: process.env.SESSION_DATA_PATH || '.wwebjs_auth'
        }),
        puppeteer: {
            headless: true,
            executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        }
    });

    client.on('qr', (qr) => {
        console.log('\n📱 Scan QR code:\n');
        qrcode.generate(qr, { small: true });
    });

    client.on('authenticated', () => console.log('✅ Authenticated'));

    client.on('ready', async () => {
        isReady = true;
        clientInfo = client.info;
        console.log(`🚀 WhatsApp ready! (${clientInfo.pushname})\n`);
    });

    client.on('disconnected', (reason) => {
        console.log('🔌 Disconnected:', reason);
        isReady = false;
    });

    // Listen for incoming messages
    client.on('message', async (message) => {
        const chat = await message.getChat();
        const chatName = chat.name || '';
        
        if (chatName.toLowerCase().includes(WATCHED_CONTACT.toLowerCase())) {
            console.log(`📨 ${chatName}: ${message.body}`);
            incomingMessages.push({
                body: message.body,
                time: new Date().toLocaleString()
            });
        }
    });

    // Listen for commands from ANYONE in the watched group (including yourself)
    client.on('message_create', async (message) => {
        const body = message.body.trim();
        if (!body.startsWith('#')) return;
        
        const chat = await message.getChat();
        const chatName = chat.name || '';
        
        if (!chatName.toLowerCase().includes(WATCHED_CONTACT.toLowerCase())) return;
        
        let senderName = 'Unknown';
        if (message.fromMe) {
            senderName = 'You';
        } else {
            try {
                const contact = await message.getContact();
                senderName = contact.pushname || contact.number || 'Unknown';
            } catch (e) {
                senderName = 'Group Member';
            }
        }
        
        const command = body.toLowerCase();
        console.log(`\n⚡ COMMAND from ${senderName}: ${body}`);
        
        try {
            // #help
            if (command === '#help') {
                await message.reply(`🤖 *Alloe Commands*\n
*Add Tasks:*
#addP0 <title> - Critical
#addP1 <title> - Highest
#addP2 <title> - High
#addP3 <title> - Medium
#addP4 <title> - Low
#addP5 <title> - Lowest

📎 *With Image:* Send image with caption #addP1 description
📎 *Or:* Reply to an image with #addP1 description
👤 *Assign:* #addP1 Fix bug =suhan

*Fetch Open Tasks:*
#p0 - Open P0 tasks
#p1 - Open P1 tasks
#tasks - All open tasks

*By Team Member:*
#pending suhan - Suhan's To Do tasks
#tasks suhan - Suhan's open tasks
#alltasks suhan - All Suhan's tasks

*Fetch by Date:*
#today - Today's tasks
#yesterday - Yesterday's tasks
#week - This week's tasks
#date 2026-01-29 - Specific date

*Fetch All (incl. done):*
#allp0 - All P0 tickets
#allp1 - All P1 tickets
#all - All tickets

*Ticket Actions:*
#ticket KAN-4 - View ticket details
#done KAN-4 - Mark ticket as done

*Chat History:*
#history - Last 20 messages
#history 50 - Last 50 messages
#search keyword - Search messages

*Alloe (Natural Language):*
#ask <question> - Talk to Alloe!
  • #ask create P1 task for login bug
  • #ask add task about payment =suhan
  • #ask show suhan's pending tasks
  • #ask what are the P0 tasks?
  • #ask mark KAN-5 as done
  • #ask summarize last discussion

*Other:*
#ping - Check bot
#status - Bot status
#team - Show team members`);
            }
            
            // #ping
            else if (command === '#ping') {
                await message.reply('🏓 Pong!');
            }
            
            // #status
            else if (command === '#status') {
                const mins = Math.floor(process.uptime() / 60);
                await message.reply(`✅ Bot running ${mins} mins\nJira: ${JIRA_DOMAIN}\nProject: ${JIRA_PROJECT_KEY}`);
            }
            
            // #team - Show team members
            else if (command === '#team') {
                const members = Object.entries(TEAM_MEMBERS)
                    .map(([shortcut, name]) => `=${shortcut} → ${name}`)
                    .join('\n');
                await message.reply(`👥 *Team Members*\n\n${members}\n\nUse: #addP1 Task description =suhan`);
            }
            
            // #addP0, #addP1, #addP2, #addP3, #addP4, #addP5 <task> [@assignee]
            else if (/^#addp[0-5](\s|$)/i.test(command)) {
                // Match command with optional multi-line content
                const match = body.match(/^#addp([0-5])[\s\n]+(.+)/is);
                
                if (!match || !match[2]?.trim()) {
                    await message.reply('❌ Format: #addP1 Task title here\nWith assignee: #addP1 Task title =suhan');
                    return;
                }
                
                const priority = `p${match[1]}`;
                let taskText = match[2];
                
                // Check if there's an assignee (=name at the end)
                let assigneeName = null;
                const assigneeMatch = taskText.match(/\s+=(\S+)$/);
                if (assigneeMatch) {
                    assigneeName = assigneeMatch[1];
                    taskText = taskText.replace(/\s+=\S+$/, '').trim();
                }
                
                // Create task (no "Creating..." message - just react when done)
                const result = await createJiraTask(taskText, priority);
                
                // Try to assign if assignee specified
                let hasWarning = false;
                if (assigneeName) {
                    try {
                        const searchName = TEAM_MEMBERS[assigneeName.toLowerCase()] || assigneeName;
                        const user = await searchJiraUser(searchName);
                        if (user) {
                            await assignTicket(result.key, user.accountId);
                            console.log(`   → Assigned to ${user.displayName}`);
                        } else {
                            hasWarning = true;
                            await message.reply(`⚠️ Created ${result.key} but user "${assigneeName}" not found\n🔗 ${result.url}`);
                        }
                    } catch (err) {
                        console.error('Assign error:', err.message);
                        hasWarning = true;
                        await message.reply(`⚠️ Created ${result.key} but couldn't assign to ${assigneeName}\n🔗 ${result.url}`);
                    }
                }
                
                // Check if message has media (image attached)
                if (message.hasMedia) {
                    try {
                        const media = await message.downloadMedia();
                        if (media) {
                            const ext = media.mimetype.split('/')[1] || 'jpg';
                            const filename = `whatsapp_${Date.now()}.${ext}`;
                            await uploadAttachmentToJira(result.key, media.data, filename);
                            console.log(`   → Attachment uploaded`);
                        }
                    } catch (err) {
                        console.error('Attachment error:', err.message);
                    }
                }
                
                // Check if replying to a message with media
                if (message.hasQuotedMsg) {
                    try {
                        const quotedMsg = await message.getQuotedMessage();
                        if (quotedMsg.hasMedia) {
                            const media = await quotedMsg.downloadMedia();
                            if (media) {
                                const ext = media.mimetype.split('/')[1] || 'jpg';
                                const filename = `whatsapp_${Date.now()}.${ext}`;
                                await uploadAttachmentToJira(result.key, media.data, filename);
                                console.log(`   → Attachment from quoted message uploaded`);
                            }
                        }
                    } catch (err) {
                        console.error('Quoted attachment error:', err.message);
                    }
                }
                
                // React with 👍 on success (no message unless there was a warning)
                if (!hasWarning) {
                    try {
                        await message.react('👍');
                    } catch (reactErr) {
                        // If react fails, send minimal confirmation
                        await message.reply(`✅ ${result.key}\n🔗 ${result.url}`);
                    }
                }
                console.log(`   → Created ${result.key}`);
            }
            
            // #today
            else if (command === '#today') {
                const tasks = await getTodaysTasks();
                const response = formatTaskList(tasks, "Today's Tasks");
                await message.reply(response);
            }
            
            // #yesterday
            else if (command === '#yesterday') {
                const tasks = await getYesterdaysTasks();
                const response = formatTaskList(tasks, "Yesterday's Tasks");
                await message.reply(response);
            }
            
            // #week
            else if (command === '#week') {
                const tasks = await getThisWeeksTasks();
                const response = formatTaskList(tasks, "This Week's Tasks");
                await message.reply(response);
            }
            
            // #date YYYY-MM-DD
            else if (command.startsWith('#date ')) {
                const match = body.match(/^#date\s+(\d{4}-\d{2}-\d{2})$/i);
                
                if (!match) {
                    await message.reply('❌ Format: #date 2026-01-29');
                    return;
                }
                
                const date = match[1];
                const tasks = await getTasksByDate(date);
                const response = formatTaskList(tasks, `Tasks from ${date}`);
                await message.reply(response);
            }
            
            // #p0, #p1, #p2, #p3, #p4, #p5
            else if (/^#p[0-5]$/.test(command)) {
                const priority = command.substring(1);
                const tasks = await getTasksByPriority(priority);
                const response = formatTaskList(tasks, `${priority.toUpperCase()} Tasks`);
                await message.reply(response);
            }
            
            // #tasks
            else if (command === '#tasks') {
                const tasks = await getAllOpenTasks();
                const response = formatTaskList(tasks, 'All Open Tasks');
                await message.reply(response);
            }
            
            // #tasks suhan - Get tasks assigned to a team member
            else if (command.startsWith('#tasks ')) {
                const shortcut = body.substring(7).trim().toLowerCase();
                const searchName = TEAM_MEMBERS[shortcut];
                
                if (!searchName) {
                    const validNames = Object.keys(TEAM_MEMBERS).join(', ');
                    await message.reply(`❌ Unknown team member: ${shortcut}\n\nValid: ${validNames}`);
                    return;
                }
                
                const tasks = await getTasksByAssignee(searchName);
                const response = formatTaskList(tasks, `${shortcut.charAt(0).toUpperCase() + shortcut.slice(1)}'s Tasks`);
                await message.reply(response);
            }
            
            // #pending suhan - Get pending (To Do) tasks for a team member
            else if (command.startsWith('#pending ')) {
                const shortcut = body.substring(9).trim().toLowerCase();
                const searchName = TEAM_MEMBERS[shortcut];
                
                if (!searchName) {
                    const validNames = Object.keys(TEAM_MEMBERS).join(', ');
                    await message.reply(`❌ Unknown team member: ${shortcut}\n\nValid: ${validNames}`);
                    return;
                }
                
                const tasks = await getPendingTasksByAssignee(searchName);
                const response = formatTaskList(tasks, `${shortcut.charAt(0).toUpperCase() + shortcut.slice(1)}'s Pending Tasks`);
                await message.reply(response);
            }
            
            // #alltasks suhan - Get ALL tasks (including done) for a team member
            else if (command.startsWith('#alltasks ')) {
                const shortcut = body.substring(10).trim().toLowerCase();
                const searchName = TEAM_MEMBERS[shortcut];
                
                if (!searchName) {
                    const validNames = Object.keys(TEAM_MEMBERS).join(', ');
                    await message.reply(`❌ Unknown team member: ${shortcut}\n\nValid: ${validNames}`);
                    return;
                }
                
                const tasks = await getAllTasksByAssignee(searchName);
                const response = formatTaskList(tasks, `All ${shortcut.charAt(0).toUpperCase() + shortcut.slice(1)}'s Tasks`);
                await message.reply(response);
            }
            
            // #allp0, #allp1, etc. - All tickets of priority (including done)
            else if (/^#allp[0-5]$/.test(command)) {
                const priorityNum = command.substring(5);
                const tasks = await getAllTasksByPriority(`P${priorityNum}`);
                const response = formatTaskList(tasks, `All P${priorityNum} Tickets`);
                await message.reply(response);
            }
            
            // #all - All tickets
            else if (command === '#all') {
                const tasks = await getAllTasks();
                const response = formatTaskList(tasks, 'All Tickets');
                await message.reply(response);
            }
            
            // #ticket KAN-XX - Get ticket details
            else if (command.startsWith('#ticket ')) {
                const match = body.match(/^#ticket\s+(\S+)$/i);
                
                if (!match) {
                    await message.reply('❌ Format: #ticket KAN-4');
                    return;
                }
                
                const ticketKey = match[1].toUpperCase();
                const ticket = await getTicketDetails(ticketKey);
                const fields = ticket.fields;
                
                const priority = fields.labels?.find(l => /^P\d$/i.test(l)) || 'N/A';
                const status = fields.status?.name || 'Unknown';
                const assignee = fields.assignee?.displayName || 'Unassigned';
                const reporter = fields.reporter?.displayName || 'Unknown';
                const created = new Date(fields.created).toLocaleDateString();
                const updated = new Date(fields.updated).toLocaleDateString();
                
                let details = `📋 *${ticketKey}*\n\n`;
                details += `*Title:* ${fields.summary}\n`;
                details += `*Priority:* ${priority}\n`;
                details += `*Status:* ${status}\n`;
                details += `*Assignee:* ${assignee}\n`;
                details += `*Reporter:* ${reporter}\n`;
                details += `*Created:* ${created}\n`;
                details += `*Updated:* ${updated}\n`;
                details += `\n🔗 https://${JIRA_DOMAIN}/browse/${ticketKey}`;
                
                await message.reply(details);
                console.log(`   → Fetched ${ticketKey} details`);
            }
            
            // #done KAN-XX - Mark ticket as done
            else if (command.startsWith('#done ')) {
                const match = body.match(/^#done\s+(\S+)$/i);
                
                if (!match) {
                    await message.reply('❌ Format: #done KAN-4');
                    return;
                }
                
                const ticketKey = match[1].toUpperCase();
                const result = await markTicketDone(ticketKey);
                
                // React with ✅ on success
                try {
                    await message.react('✅');
                } catch (reactErr) {
                    await message.reply(`✅ ${result.key} Done\n🔗 ${result.url}`);
                }
                console.log(`   → ${ticketKey} marked as Done`);
            }
            
            // #history - Fetch recent messages from this group
            else if (command === '#history' || command.startsWith('#history ')) {
                const match = body.match(/^#history\s*(\d*)$/i);
                const limit = match && match[1] ? parseInt(match[1]) : 20;
                const maxLimit = 50;
                const fetchLimit = Math.min(limit, maxLimit);
                
                const chat = await message.getChat();
                const messages = await chat.fetchMessages({ limit: fetchLimit });
                
                let history = `📜 *Last ${messages.length} Messages*\n\n`;
                
                for (const msg of messages.reverse()) {
                    const time = new Date(msg.timestamp * 1000).toLocaleTimeString('en-US', { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                    });
                    const sender = msg.fromMe ? 'You' : (msg._data.notifyName || 'Unknown');
                    const text = msg.body?.substring(0, 100) || '[media]';
                    history += `[${time}] *${sender}*: ${text}${msg.body?.length > 100 ? '...' : ''}\n`;
                }
                
                await message.reply(history);
                console.log(`   → Fetched ${messages.length} messages`);
            }
            
            // #search <query> - Search messages in this group
            else if (command.startsWith('#search ')) {
                const query = body.substring(8).trim().toLowerCase();
                
                if (!query) {
                    await message.reply('❌ Format: #search keyword');
                    return;
                }
                
                const chat = await message.getChat();
                const messages = await chat.fetchMessages({ limit: 100 });
                
                const matches = messages.filter(msg => 
                    msg.body?.toLowerCase().includes(query)
                ).slice(0, 10);
                
                if (matches.length === 0) {
                    await message.reply(`❌ No messages found containing "${query}"`);
                    return;
                }
                
                let results = `🔍 *Search: "${query}"* (${matches.length} found)\n\n`;
                
                for (const msg of matches) {
                    const date = new Date(msg.timestamp * 1000).toLocaleDateString();
                    const time = new Date(msg.timestamp * 1000).toLocaleTimeString('en-US', { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                    });
                    const sender = msg.fromMe ? 'You' : (msg._data.notifyName || 'Unknown');
                    const text = msg.body?.substring(0, 80) || '[media]';
                    results += `[${date} ${time}] *${sender}*:\n${text}${msg.body?.length > 80 ? '...' : ''}\n\n`;
                }
                
                await message.reply(results);
                console.log(`   → Found ${matches.length} messages for "${query}"`);
            }
            
            // #ask <question> - Alloe assistant for chat analysis and Jira commands
            else if (command.startsWith('#ask ') || command.startsWith('#ask\n') || command === '#ask') {
                // Extract query - handle both "#ask query" and "#ask\nquery"
                const query = body.replace(/^#ask[\s\n]*/i, '').trim();
                
                if (!query) {
                    await message.reply(`🤖 *Hey, I'm Alloe!* Your Lifemaxing AI

*Ask me to manage Jira:*
• #ask create a P1 task for login bug
• #ask add urgent task about payment assign to suhan
• #ask show suhan's tasks
• #ask what are the P0 tasks?
• #ask mark KAN-5 as done
• #ask show today's tasks

*Or ask about the chat:*
• #ask summarize the last discussion
• #ask what was decided?
• #ask who mentioned the bug?`);
                    return;
                }
                
                // Check if OpenAI is configured
                if (!process.env.OPENAI_API_KEY) {
                    await message.reply('❌ Alloe is not configured yet. Add OPENAI_API_KEY to .env');
                    return;
                }
                
                // React with 🤔 to show we're processing
                try {
                    await message.react('🤔');
                } catch (e) {}
                
                try {
                    // Fetch recent messages for context
                    const chat = await message.getChat();
                    const chatMessages = await chat.fetchMessages({ limit: 30 });
                    
                    console.log(`   → Alloe processing: "${query.substring(0, 50)}..."`);
                    
                    // Get Alloe to determine intent and action
                    const { action, args } = await processAIRequest(chatMessages, query);
                    console.log(`   → Alloe detected action: ${action}`, args);
                    
                    // Execute the action
                    const result = await executeAIAction(action, args);
                    console.log(`   → Alloe result type: ${typeof result}`);
                    
                    // If task was created, check for attachments
                    if (action === 'create_task' && result?.ticketKey) {
                        // Check if message has media (image attached)
                        if (message.hasMedia) {
                            try {
                                const media = await message.downloadMedia();
                                if (media) {
                                    const ext = media.mimetype.split('/')[1] || 'jpg';
                                    const filename = `whatsapp_${Date.now()}.${ext}`;
                                    await uploadAttachmentToJira(result.ticketKey, media.data, filename);
                                    console.log(`   → Attachment uploaded to ${result.ticketKey}`);
                                }
                            } catch (err) {
                                console.error('Attachment error:', err.message);
                            }
                        }
                        
                        // Check if replying to a message with media
                        if (message.hasQuotedMsg) {
                            try {
                                const quotedMsg = await message.getQuotedMessage();
                                if (quotedMsg.hasMedia) {
                                    const media = await quotedMsg.downloadMedia();
                                    if (media) {
                                        const ext = media.mimetype.split('/')[1] || 'jpg';
                                        const filename = `whatsapp_${Date.now()}.${ext}`;
                                        await uploadAttachmentToJira(result.ticketKey, media.data, filename);
                                        console.log(`   → Quoted attachment uploaded to ${result.ticketKey}`);
                                    }
                                }
                            } catch (err) {
                                console.error('Quoted attachment error:', err.message);
                            }
                        }
                    }
                    
                    // Handle different result types
                    if (result && typeof result === 'object' && result.reactOnly) {
                        // Just react with ✅ (for create/done actions)
                        try { await message.react('✅'); } catch (e) {}
                    } else if (result && typeof result === 'object' && result.response) {
                        // Has a specific response (like a warning)
                        await message.reply(result.response);
                        try { await message.react('✅'); } catch (e) {}
                    } else if (action === 'chat_response') {
                        // Chat/general response - add Alloe branding
                        await message.reply(`🤖 *Alloe*\n\n${result}`);
                        try { await message.react('✅'); } catch (e) {}
                    } else if (typeof result === 'string' && result.length > 0) {
                        // Jira fetch results - send as-is
                        await message.reply(result);
                        try { await message.react('✅'); } catch (e) {}
                    } else {
                        await message.reply('✅ Done');
                    }
                    
                    console.log(`   → Alloe completed: ${action}`);
                } catch (askError) {
                    console.error('Alloe error:', askError);
                    await message.reply(`❌ Alloe Error: ${askError.message}`);
                    try { await message.react('❌'); } catch (e) {}
                }
            }
            
        } catch (error) {
            console.error('Command error:', error.message);
            await message.reply(`❌ Error: ${error.message}`);
        }
    });

    console.log('🔄 Initializing WhatsApp...\n');
    client.initialize();
}

// ============================================
// API ROUTES
// ============================================

app.get('/health', (req, res) => {
    res.json({ status: 'ok', ready: isReady, jira: JIRA_DOMAIN });
});

app.get('/status', (req, res) => {
    res.json({
        ready: isReady,
        user: clientInfo?.pushname || null,
        jira: { domain: JIRA_DOMAIN, project: JIRA_PROJECT_KEY }
    });
});

// ============================================
// START
// ============================================

app.listen(PORT, () => {
    console.log(`\n🌐 Server: http://localhost:${PORT}`);
    console.log(`\n📋 Jira: ${JIRA_DOMAIN} (${JIRA_PROJECT_KEY})`);
    console.log(`🤖 Alloe AI: ${process.env.OPENAI_API_KEY ? 'Ready' : 'Not configured (add OPENAI_API_KEY)'}`);
    console.log(`👀 Watching: ${WATCHED_CONTACT}`);
    console.log(`\n💬 Commands: #help #addP1 <task> #today #p1 #tasks #ask\n`);
    
    initializeClient();
});

process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down...');
    if (client) await client.destroy();
    process.exit(0);
});
