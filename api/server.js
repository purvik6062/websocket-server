require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const { ethers } = require("ethers");
const { Client, cacheExchange, fetchExchange, gql } = require("@urql/core");
const fetch = require("cross-fetch");
const mongoose = require("mongoose");
// const userRoutes = require("../../routes/user"); 
const { getAllAddresses } = require("../controllers/userController");
const Notification = require("../models/Notification");

// Contract ABIs and addresses
const arb_abi = require("../arb_proposals_abi.json");
const op_abi = require("../op_proposals_abi.json");
const contractAddress = "0x789fC99093B09aD01C34DC7251D0C89ce743e5a4";
const op_contractAddress = "0xcDF27F107725988f2261Ce2256bDfCdE8B382B10";

// Updated URQL client configuration
const createSubgraphClient = (url) => {
    return new Client({
        url,
        exchanges: [cacheExchange, fetchExchange],
        fetch,
        fetchOptions: {
            headers: {
                "Content-Type": "application/json",
            },
        },
    });
};

let arbClient, optimismClient;

try {
    arbClient = createSubgraphClient(process.env.ARBITRUM_SUBGRAPH_URL);
    optimismClient = createSubgraphClient(process.env.OPTIMISM_SUBGRAPH_URL);
    console.log("URQL clients created successfully");
} catch (error) {
    console.error("Error creating URQL clients:", error);
}

// Constants
const MAX_RETRIES = 5;
const RETRY_INTERVAL = 5000;

const app = express();
const server = http.createServer(app);

// Connect to MongoDB
mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => console.log("Connected to MongoDB"))
    .catch((err) => console.error("Failed to connect to MongoDB", err));

// Middleware to parse JSON
app.use(express.json());

app.use(
    cors({
        origin: process.env.BASE_URL,
        methods: ["GET", "POST"],
        credentials: true,
    })
);

const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true,
    },
});

const activeSockets = {};
const hostSockets = {};

async function processNotificationsWithSocket(commonAddresses, chain) {
    try {
        console.log("Processing notifications with socket:", commonAddresses);
        
        // Process notifications for each common address
        for (const address of commonAddresses) {
            try {
                const notification = {
                    receiver_address: address,
                    content: `New Vote cast detected for address ${address}`,
                    createdAt: Date.now(),
                    read_status: false,
                    notification_name: "Vote cast",
                    notification_title: "casted vote",
                    notification_type: "proposalVote",
                    additionalData: { chain }
                };

                // Save to database
                const notificationToSave = new Notification(notification);
                const savedNotification = await notificationToSave.save();
                console.log("Notification saved to database:", savedNotification);

                // Check if there's an active socket connection for this address
                if (hostSockets[address]) {
                    // Emit directly to the socket without setting up a new connection listener
                    io.to(hostSockets[address]).emit("new_notification", notification);
                    console.log(`Notification sent to socket for address ${address}`);
                } else {
                    console.log(`No active socket connection found for address ${address}`);
                }
            } catch (error) {
                console.error(
                    `Error processing notification for ${address}:`,
                    error
                );
            }
        }
    } catch (error) {
        console.error("Error in processNotificationsWithSocket:", error);
        throw error;
    }
}

function findCommonUsers(array1, array2) {
    // Step 1: Convert array2 to a Set for efficient lookups
    const setArray2 = new Set(array2);

    // Step 2: Filter array1 based on presence in setArray2
    const commonUsers = array1.filter((user) => setArray2.has(user));

    return commonUsers;
}
// Blockchain listener setup
class BlockchainListener {
    constructor() {
        this.retryCount = 0;
        this.isListening = false;
        this.providers = {};
        this.contracts = {};
    }

    async setupProviders() {
        try {
            this.providers.arbitrum = new ethers.WebSocketProvider(
                `wss://arbitrum-mainnet.infura.io/ws/v3/${process.env.RPC_KEY}`
            );
            this.providers.optimism = new ethers.WebSocketProvider(
                `wss://optimism-mainnet.infura.io/ws/v3/${process.env.RPC_KEY}`
            );

            await this.providers.arbitrum.ready;
            await this.providers.optimism.ready;

            // const commonAddresses = [activeSockets];

            // const commonAddresses = ["0x3013bb4E03a7B81106D69C10710EaE148C8410E1"];
            const commonAddresses = ["0xa0f97344e9699F0D5d54c4158F9cf9892828C7F8"];
            const chain = "arbitrum";
            processNotificationsWithSocket(commonAddresses, chain);
            console.log("Providers are ready");
        } catch (error) {
            console.error("Error setting up providers:", error);
            throw error;
        }
    }

    setupContracts() {
        this.contracts.arbitrum = new ethers.Contract(
            contractAddress,
            arb_abi,
            this.providers.arbitrum
        );
        this.contracts.optimism = new ethers.Contract(
            op_contractAddress,
            op_abi,
            this.providers.optimism
        );
    }

    createVoteCastHandler(chain) {
        return async (voter, proposalId, support, votes, event) => {
            console.log(`Vote cast detected on ${chain}:`, {
                voter,
                proposalId: proposalId.toString(),
                support,
                votes: votes.toString(),
            });

            try {
                const subgraphData = await this.getSubgraphUserData(voter, chain);
                console.log(`Subgraph data for ${voter} on ${chain}:`, subgraphData);
                const dbAddresses = await getAllAddresses(); // Direct call to getAllAddresses
                console.log("user data from db", dbAddresses);

                // Step 1: Create an array for subgraph addresses (if applicable)
                const subgraphAddresses = subgraphData?.delegators; // Adjust this to match the structure of your subgraph data
                let commonAddresses = [];
                if (subgraphAddresses) {
                    // Step 2: Use findCommonUsers to find common addresses
                    commonAddresses = findCommonUsers(subgraphAddresses, dbAddresses);
                } else {
                    console.log("no subgraph data found");
                    return;
                }
                // Step 3: Process the common addresses
                if (commonAddresses.length > 0) {
                    console.log("Common addresses found:", commonAddresses);
                    processNotificationsWithSocket(commonAddresses, chain);
                } else {
                    // const commonAddresses = [
                    //   "0xa0f97344e9699F0D5d54c4158F9cf9892828C7F8",
                    // ];
                    // processNotificationsWithSocket(commonAddresses, chain);
                    console.log("No common addresses found");
                }
                // io.emit("votecast", {
                //   chain,
                //   voter,
                //   proposalId: proposalId.toString(),
                //   support: Number(support),
                //   votes: votes.toString(),
                //   subgraphData,
                // });

                // if (activeSockets[voter.toLowerCase()]) {
                //     io.to(activeSockets[voter.toLowerCase()]).emit('vote_notification', {
                //         chain,
                //         proposalId: proposalId.toString(),
                //         votes: votes.toString()
                //     });
                // }
            } catch (error) {
                console.error(`Error processing vote cast on ${chain}:`, error);
            }
        };
    }

    async getSubgraphUserData(address, chain) {
        const DELEGATE_QUERY = gql`
      query GetUserData($address: String!) {
        delegate(id: $address) {
          blockTimestamp
          delegatedFromCount
          delegators
          id
          latestBalance
        }
      }
    `;

        try {
            const client = chain === "arbitrum" ? arbClient : optimismClient;
            if (!client) {
                throw new Error(`No client available for chain: ${chain}`);
            }

            const result = await client
                .query(DELEGATE_QUERY, {
                    address: address.toLowerCase(),
                })
                .toPromise();

            if (result.error) {
                throw result.error;
            }

            return result.data?.delegate || null;
        } catch (error) {
            console.error(`Error fetching subgraph data for ${chain}:`, error);
            return null;
        }
    }

    async start() {
        try {
            await this.setupProviders();
            this.setupContracts();

            const arbHandler = this.createVoteCastHandler("arbitrum");
            const opHandler = this.createVoteCastHandler("optimism");

            this.contracts.arbitrum.on("VoteCast", arbHandler);
            this.contracts.optimism.on("VoteCast", opHandler);
            this.contracts.arbitrum.on("VoteCastWithParams", arbHandler);
            this.contracts.optimism.on("VoteCastWithParams", opHandler);
            this.isListening = true;
            console.log("Blockchain listener started successfully");
        } catch (error) {
            console.error("Error starting blockchain listener:", error);

            if (this.retryCount < MAX_RETRIES) {
                console.log(
                    `Retrying in ${RETRY_INTERVAL}ms... (Attempt ${this.retryCount + 1})`
                );
                setTimeout(() => this.start(), RETRY_INTERVAL);
                this.retryCount++;
            } else {
                console.error("Max retries reached. Please check the connection.");
            }
        }
    }

    stop() {
        if (this.contracts.arbitrum) {
            this.contracts.arbitrum.removeAllListeners();
        }
        if (this.contracts.optimism) {
            this.contracts.optimism.removeAllListeners();
        }

        Object.values(this.providers).forEach((provider) => {
            if (provider) provider.destroy();
        });

        this.isListening = false;
        console.log("Blockchain listener stopped");
    }
}

io.on("connection", (socket) => {
    console.log("A client just connected");

    socket.on("sum", (result) => {
        console.log("Sum result received: " + result);
        io.emit("sum_result", result);
    });

    socket.on("register", (address) => {
        console.log("address from socket", address);
        activeSockets[address] = socket.id;
    });

    // socket.on("register_host", ({ hostAddress, socketId }) => {
    //     console.log("Host address registered for notifications:", hostAddress);
    //     hostSockets[hostAddress] = socketId;
    // });
  
  socket.on("register_host", ({ hostAddress, socketId }) => {
        console.log("Host address registered for notifications:", hostAddress);
        hostSockets[hostAddress] = socketId;
        // Emit any pending notifications for this address
        Notification.find({
            receiver_address: hostAddress,
            read_status: false
        })
        .sort({ createdAt: -1 })
        .limit(10)
        .then(notifications => {
            if (notifications.length > 0) {
                notifications.forEach(notification => {
                    io.to(socketId).emit("new_notification", notification);
                });
            }
        })
        .catch(error => {
            console.error("Error fetching pending notifications:", error);
        });
    });

    socket.on("send_message", ({ addresses, message }) => {
        console.log("Sending message to addresses: ", addresses);
        addresses.forEach((address) => {
            if (activeSockets[address]) {
                console.log(`Emitting message to ${address}`);
                io.to(activeSockets[address]).emit("receive_message", message);
            } else {
                console.log(`No active socket for ${address}`);
            }
        });
    });
  
      socket.on("vote_casted", ({ receiver_address, savedNotification }) => {
        console.log("Sending message to addresses: ", receiver_address);
        if (hostSockets[receiver_address]) {
            io.to(hostSockets[receiver_address]).emit(
                "new_notification",
                savedNotification
            );
            console.log("new notification message emitted to host");
        };
    });


    socket.on(
        "new_session",
        ({ host_address, dataToSendHost, attendee_address, dataToSendGuest }) => {
            console.log("received new session notification");
            console.log("host_address", host_address);
            console.log("dataToSendHost", dataToSendHost);
            console.log("hostSockets", hostSockets);
            if (hostSockets[host_address]) {
                io.to(hostSockets[host_address]).emit(
                    "new_notification",
                    dataToSendHost
                );
                console.log("new notification message emitted to host");
            }
            if (hostSockets[attendee_address]) {
                io.to(hostSockets[attendee_address]).emit(
                    "new_notification",
                    dataToSendGuest
                );
                console.log("new notification message emitted to guest");
            }
        }
    );
    socket.on("reject_session", ({ attendee_address, dataToSendGuest }) => {
        console.log("received reject session notification");
        console.log("host_address", attendee_address);
        console.log("dataToSendHost", dataToSendGuest);
        console.log("hostSockets", hostSockets);
        if (hostSockets[attendee_address]) {
            io.to(hostSockets[attendee_address]).emit(
                "new_notification",
                dataToSendGuest
            );
            console.log("new reject notification message emitted to guest");
        }
    });

    socket.on(
        "session_started_by_host",
        ({ attendeeAddress, dataToSendGuest }) => {
            console.log("received reject session notification");
            console.log("attendeeAddress", attendeeAddress);
            console.log("dataToSendGuest", dataToSendGuest);
            console.log("hostSockets", hostSockets);
            if (hostSockets[attendeeAddress]) {
                io.to(hostSockets[attendeeAddress]).emit(
                    "new_notification",
                    dataToSendGuest
                );
                console.log(
                    "new session started notification message emitted to guest"
                );
            }
        }
    );

    socket.on("session_started_by_guest", ({ hostAddress, dataToSendHost }) => {
        console.log("received reject session notification");
        console.log("hostAddress", hostAddress);
        console.log("dataToSendHost", dataToSendHost);
        console.log("hostSockets", hostSockets);
        if (hostSockets[hostAddress]) {
            io.to(hostSockets[hostAddress]).emit("new_notification", dataToSendHost);
            console.log(
                "new session started by guest notification message emitted to guest"
            );
        }
    });

    socket.on(
        "received_offchain_attestation",
        ({ receiver_address, dataToSend }) => {
            console.log("received reject session notification");
            console.log("receiver_address", receiver_address);
            console.log("dataToSend", dataToSend);
            console.log("hostSockets", hostSockets);
            if (hostSockets[receiver_address]) {
                io.to(hostSockets[receiver_address]).emit(
                    "new_notification",
                    dataToSend
                );
                console.log(
                    "new session started by guest notification message emitted to guest"
                );
            }
        }
    );

    socket.on("disconnect", () => {
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

const blockchainListener = new BlockchainListener();
blockchainListener.start();

process.on("SIGTERM", () => {
    console.log("SIGTERM received. Shutting down gracefully...");
    blockchainListener.stop();
    server.close(() => {
        console.log("Server closed");
        process.exit(0);
    });
});

app.use((req, res) => res.send("Socket server running"));

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;
