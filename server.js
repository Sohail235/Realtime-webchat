const express = require('express');
const socketio = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory storage (persists until server restarts)
const users = {};
const messages = {};
const profilePics = {};
const activeSockets = {};

// Routes
app.post('/register', (req, res) => {
    const { username, profilePic } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });
    
    if (Object.values(users).some(u => u.username.toLowerCase() === username.toLowerCase())) {
        return res.status(400).json({ error: 'Username taken' });
    }
    
    const userId = uuidv4();
    users[userId] = { id: userId, username };
    
    if (profilePic) {
        profilePics[userId] = profilePic;
    }
    
    res.json({ userId, username });
});

app.post('/login', (req, res) => {
    const { userId } = req.body;
    if (!userId || !users[userId]) {
        return res.status(400).json({ error: 'Invalid user' });
    }
    res.json({ 
        ...users[userId], 
        profilePic: profilePics[userId] || null,
        messages: getMessagesForUser(userId)
    });
});

function getMessagesForUser(userId) {
    const userMessages = [];
    
    // Get global messages
    if (messages['main']) {
        userMessages.push(...messages['main'].map(m => ({
            ...m,
            type: 'global'
        })));
    }
    
    // Get private messages
    Object.keys(messages).forEach(chatId => {
        if (chatId.includes(userId) && chatId !== 'main') {
            userMessages.push(...messages[chatId].map(m => ({
                ...m,
                type: 'private',
                chatId
            })));
        }
    });
    
    return userMessages;
}

const server = app.listen(3000, () => {
    console.log('Server running on port 3000');
});

const io = socketio(server);

io.on('connection', (socket) => {
    console.log('New connection');
    
    socket.on('authenticate', (userId) => {
        if (users[userId]) {
            socket.userId = userId;
            activeSockets[userId] = socket.id;
            
            socket.join(userId);
            socket.join('main');
            
            updateOnlineUsers();
        }
    });
    
    socket.on('sendMessage', ({ fromUserId, toUserId, text }) => {
        if (!users[fromUserId] || (toUserId && !users[toUserId])) return;
        
        const chatId = toUserId ? 
            [fromUserId, toUserId].sort().join('_') : 'main';
            
        const message = {
            id: uuidv4(),
            fromUserId,
            toUserId,
            username: users[fromUserId].username,
            text,
            timestamp: new Date().toISOString()
        };
        
        if (!messages[chatId]) messages[chatId] = [];
        messages[chatId].push(message);
        
        if (toUserId) {
            io.to(fromUserId).to(toUserId).emit('newMessage', message);
        } else {
            io.to('main').emit('newMessage', message);
        }
    });
    
    socket.on('disconnect', () => {
        if (socket.userId) {
            delete activeSockets[socket.userId];
            updateOnlineUsers();
        }
    });
});

function updateOnlineUsers() {
    const onlineUsers = Object.keys(activeSockets).map(id => ({
        ...users[id],
        profilePic: profilePics[id] || null
    }));
    io.emit('onlineUsers', onlineUsers);
          }
