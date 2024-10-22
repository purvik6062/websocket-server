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

    socket.on('reject_session', ({
        attendee_address,
        dataToSendGuest }) => {
        console.log("received reject session notification");
        console.log("host_address", attendee_address);
        console.log("dataToSendHost", dataToSendGuest);
        console.log("hostSockets", hostSockets)
        if (hostSockets[attendee_address]) {
            io.to(hostSockets[attendee_address]).emit('new_notification', dataToSendGuest);
            console.log("new reject notification message emitted to guest");
        }
    });

    socket.on('session_started_by_host', ({
        attendeeAddress,
        dataToSendGuest }) => {
        console.log("received reject session notification");
        console.log("attendeeAddress", attendeeAddress);
        console.log("dataToSendGuest", dataToSendGuest);
        console.log("hostSockets", hostSockets)
        if (hostSockets[attendeeAddress]) {
            io.to(hostSockets[attendeeAddress]).emit('new_notification', dataToSendGuest);
            console.log("new session started notification message emitted to guest");
        }
    });

    socket.on('session_started_by_guest', ({
        hostAddress,
        dataToSendHost }) => {
        console.log("received reject session notification");
        console.log("hostAddress", hostAddress);
        console.log("dataToSendHost", dataToSendHost);
        console.log("hostSockets", hostSockets)
        if (hostSockets[hostAddress]) {
            io.to(hostSockets[hostAddress]).emit('new_notification', dataToSendHost);
            console.log("new session started by guest notification message emitted to guest");
        }
    });

    socket.on('received_offchain_attestation', ({
        receiver_address,
        dataToSend }) => {
        console.log("received reject session notification");
        console.log("receiver_address", receiver_address);
        console.log("dataToSend", dataToSend);
        console.log("hostSockets", hostSockets)
        if (hostSockets[receiver_address]) {
            io.to(hostSockets[receiver_address]).emit('new_notification', dataToSend);
            console.log("new session started by guest notification message emitted to guest");
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