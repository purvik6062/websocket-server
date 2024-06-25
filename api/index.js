require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// const io = socketIo(server, {
//     cors: {
//         origin: process.env.BASE_URL,
//         methods: ["POST", "GET"],
//     },
// });

// app.use(cors());

const io = socketIo(server, {
    cors: {
        origin: ["http://localhost:3000"],
        methods: ["GET", "POST"],
        credentials: true
    }
});

app.use(cors({
    origin: ["http://localhost:3000"],
    credentials: true
}));

io.on('connection', function (socket) {
    // Some feedback on the console
    console.log("A client just connected");

    // Attach some behavior to the incoming socket
    socket.on('message', function (msg) {
        console.log("Received message from client: " + msg);
        // socket.send("Take this back: " + msg);

        // Broadcast that message to all connected clients
        io.clients.forEach(function (client) {
            client.send("Someone said: " + msg);
        });

    });

    socket.on("message2", (data) => {
        console.log("Message received:", data);
        io.emit("message2", data);
    });

    socket.on('close', function () {
        console.log('Client disconnected');
    })

});

app.use((req, res) => res.send('Socket server running'));

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;