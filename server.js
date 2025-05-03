// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

// Connect to MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB Atlas'))
  .catch(err => console.error('Could not connect to MongoDB Atlas', err));

// Define MongoDB Schemas
const MessageSchema = new mongoose.Schema({
  room: String,
  username: String,
  message: String,
  timestamp: { type: Date, default: Date.now }
});

const RoomSchema = new mongoose.Schema({
  name: String,
  createdAt: { type: Date, default: Date.now }
});

// Create MongoDB Models
const Message = mongoose.model('Message', MessageSchema);
const Room = mongoose.model('Room', RoomSchema);

// API Routes
app.get('/api/rooms', async (req, res) => {
  try {
    const rooms = await Room.find().sort({ createdAt: -1 });
    res.json(rooms);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/rooms', async (req, res) => {
  try {
    const { name } = req.body;
    const existingRoom = await Room.findOne({ name });
    
    if (existingRoom) {
      return res.json(existingRoom);
    }
    
    const newRoom = new Room({ name });
    await newRoom.save();
    res.status(201).json(newRoom);
    io.emit('room-created', newRoom);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/rooms/:room/messages', async (req, res) => {
  try {
    const messages = await Message.find({ room: req.params.room })
      .sort({ timestamp: 1 })
      .limit(100);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Socket.IO event handlers
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('join-room', async (roomName, username) => {
    // Leave previous rooms
    const prevRooms = [...socket.rooms].slice(1);
    prevRooms.forEach(room => {
      socket.leave(room);
      socket.to(room).emit('user-left', username);
    });
    
    // Join new room
    socket.join(roomName);
    
    // Notify others in the room
    socket.to(roomName).emit('user-joined', username);
    
    console.log(`${username} joined room: ${roomName}`);
    
    // Check if room exists, if not create it
    const room = await Room.findOne({ name: roomName });
    if (!room) {
      const newRoom = new Room({ name: roomName });
      await newRoom.save();
      io.emit('room-created', newRoom);
    }
  });
  
  socket.on('send-message', async (data) => {
    const { room, username, message } = data;
    
    // Save message to database
    const newMessage = new Message({
      room,
      username,
      message
    });
    
    await newMessage.save();
    
    // Broadcast message to the room
    io.to(room).emit('receive-message', {
      _id: newMessage._id,
      room,
      username,
      message,
      timestamp: newMessage.timestamp
    });
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});