require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

app.use(cors({
    origin: process.env.BASE_URL,
    methods: ["GET", "POST"],
    credentials: true
}));

const io = socketIo(server, {
    cors: {
        origin: process.env.BASE_URL,
        methods: ["GET", "POST"],
        credentials: true
    }
});

const activeSockets = {};
const hostSockets = {};

io.on('connection', (socket) => {
    console.log("A client just connected");

    socket.on('sum', (result) => {
        console.log("Sum result received: " + result);
        io.emit("sum_result", result);
    });

    socket.on('register', (address) => {
        console.log("address from socket", address);
        activeSockets[address] = socket.id;
    });

    socket.on('register_host', ({ hostAddress, socketId }) => {
        console.log("Host address registered for notifications:", hostAddress);
        hostSockets[hostAddress] = socketId;
    });

    socket.on('send_message', ({ addresses, message }) => {
        console.log("Sending message to addresses: ", addresses);
        addresses.forEach((address) => {
            if (activeSockets[address]) {
                console.log(`Emitting message to ${address}`);
                io.to(activeSockets[address]).emit('receive_message', message);
            } else {
                console.log(`No active socket for ${address}`);
            }
        });
    });

    socket.on('new_session', ({ host_address,
        dataToSendHost,
        attendee_address,
        dataToSendGuest }) => {
        console.log("received new session notification");
        console.log("host_address", host_address);
        console.log("dataToSendHost", dataToSendHost);
        console.log("hostSockets", hostSockets)
        if (hostSockets[host_address]) {
            io.to(hostSockets[host_address]).emit('new_notification', dataToSendHost);
            console.log("new notification message emitted to host");
        }
        if (hostSockets[attendee_address]) {
            io.to(hostSockets[attendee_address]).emit('new_notification', dataToSendGuest);
            console.log("new notification message emitted to guest");
        }
    });

    socket.on('disconnect', () => {
        for (let address in activeSockets) {
            if (activeSockets[address] === socket.id) {
                delete activeSockets[address];
                break;
            }
        }

        for (let hostAddress in hostSockets) {
            if (hostSockets[hostAddress] === socket.id) {
                delete hostSockets[hostAddress];
                break;
            }
        }
    });
});

app.use((req, res) => res.send('Socket server running'));

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;
