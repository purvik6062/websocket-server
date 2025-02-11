require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const { ethers } = require("ethers");
const { Client, cacheExchange, fetchExchange, gql } = require("@urql/core");
const fetch = require("cross-fetch");
const mongoose = require("mongoose");
const { getAllAddresses } = require("../controllers/userController");
const Notification = require("../models/Notification");
const User = require("../models/User");
const { EmailService } = require("../emailService.js");

// Contract ABIs and addresses
const arb_abi = require("../arb_proposals_abi.json");
const op_abi = require("../op_proposals_abi.json");
const { template } = require("handlebars");
const contractAddress = "0x789fC99093B09aD01C34DC7251D0C89ce743e5a4";
const op_contractAddress = "0xcDF27F107725988f2261Ce2256bDfCdE8B382B10";

// Constants
const MAX_RETRIES = 5;
const RETRY_INTERVAL = 5000;
const hostSockets = {};
const activeSockets = {};

// URQL client configuration
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
console.log(
  "process.env.ARBITRUM_SUBGRAPH_URL",
  process.env.ARBITRUM_SUBGRAPH_URL
);
try {
  arbClient = createSubgraphClient(process.env.ARBITRUM_SUBGRAPH_URL);
  optimismClient = createSubgraphClient(process.env.OPTIMISM_SUBGRAPH_URL);
  console.log("URQL clients created successfully");
} catch (error) {
  console.error("Error creating URQL clients:", error);
}

// Notification Manager Class
class NotificationManager {
  constructor(io) {
    this.io = io;
    this.connectedClients = new Map();
    this.retryQueue = [];
    this.initialize();
  }

  initialize() {
    this.io.on("connection", (socket) => {
      console.log("New client connected:", socket.id);

      // // Handle other socket events
      // socket.on("notification_received", (data) => {
      //     this.handleNotificationAcknowledgment(data);
      // });

      // socket.on("mark_notification_read", async (data) => {
      //     await this.markNotificationAsRead(data);
      // });

      socket.on("sum", (result) => {
        console.log("Sum result received: " + result);
        io.emit("sum_result", result);
      });

      socket.on("register", (address) => {
        console.log("address from socket", address);
        activeSockets[address] = socket.id;
      });

      socket.on("register_host", ({ hostAddress, socketId }) => {
        console.log("Host address registered for notifications:", hostAddress);
        hostSockets[hostAddress] = socketId;
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

      // Session booking handler
      socket.on(
        "new_session",
        ({
          host_address,
          dataToSendHost,
          attendee_address,
          dataToSendGuest,
        }) => {
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
      // Session rejection handler
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

      socket.on(
        "session_started_by_guest",
        ({ hostAddress, dataToSendHost }) => {
          console.log("received reject session notification");
          console.log("hostAddress", hostAddress);
          console.log("dataToSendHost", dataToSendHost);
          console.log("hostSockets", hostSockets);
          if (hostSockets[hostAddress]) {
            io.to(hostSockets[hostAddress]).emit(
              "new_notification",
              dataToSendHost
            );
            console.log(
              "new session started by guest notification message emitted to guest"
            );
          }
        }
      );

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

      socket.on("officehours_scheduled", ({ notifications }) => {
        console.log("connected");

        notifications.forEach(async (notification) => {
          console.log("notification", notification);
          const receiverAddress = notification.receiver_address;
          if (hostSockets[receiverAddress]) {
            this.io.to(hostSockets[receiverAddress]).emit("new_notification", {
              ...notification,
            });
            console.log(
              `Office hours scheduled notification sent to ${receiverAddress}`
            );
          } else {
            console.log(`No active socket for ${receiverAddress}`);
          }
        });
      });

      socket.on("officehours_started", ({ notifications }) => {
        console.log(
          "Received office hours started notifications:",
          notifications
        );
        notifications.forEach(async (notification) => {
          const receiverAddress = notification.receiver_address;
          if (hostSockets[receiverAddress]) {
            this.io.to(hostSockets[receiverAddress]).emit("new_notification", {
              ...notification,
            });
            console.log(
              `Office hours scheduled notification sent to ${receiverAddress}`
            );
          } else {
            console.log(`No active socket for ${receiverAddress}`);
          }
        });
      });

      socket.on("officehours_deleted", ({ notifications }) => {
        console.log(
          "Received office hours started notifications:",
          notifications
        );
        notifications.forEach(async (notification) => {
          const receiverAddress = notification.receiver_address;
          if (hostSockets[receiverAddress]) {
            this.io.to(hostSockets[receiverAddress]).emit("new_notification", {
              ...notification,
            });
            console.log(
              `Office hours scheduled notification sent to ${receiverAddress}`
            );
          } else {
            console.log(`No active socket for ${receiverAddress}`);
          }
        });
      });

      socket.on("disconnect", () => {
        this.handleDisconnect(socket);
      });
    });

    // Start retry mechanism for failed notifications
    setInterval(() => this.processRetryQueue(), 30000);
  }

  async sendNotification(notification, emailContent) {
    try {
      // Save to database
      const notificationDoc = new Notification(notification);
      // const savedNotification = await notificationDoc.save();

      // Find user email from database using receiver address
      const user = await User.findOne({
        address: notification.receiver_address,
      });
      if (user && user.emailId) {
        emailContent.to = user.emailId;
      }
      // Send to connected client
      const receiverAddress = notification.receiver_address;
      if (this.connectedClients.has(receiverAddress)) {
        this.io.to(receiverAddress).emit("new_notification", notificationDoc);

        // Add to pending notifications until acknowledged
        // this.pendingNotifications.set(savedNotification._id.toString(), {
        //   notification: savedNotification,
        //   attempts: 1,
        //   lastAttempt: Date.now(),
        // });

        console.log(`Notification sent to ${receiverAddress}`);
      } else {
        console.log(
          `Client ${receiverAddress} not connected, notification saved to DB`
        );
        // this.addToRetryQueue(savedNotification);
        // Send email if receiver_email exists
        if (emailContent.to) {
          try {
            console.log("Sending email to:", emailContent);
            await EmailService.sendTemplatedEmail(emailContent);
          } catch (emailError) {
            console.error("Error sending email:", emailError);
            // Continue with the function even if email fails
          }
        }
      }
    } catch (error) {
      console.error("Error sending notification:", error);
    }
  }

  addToRetryQueue(notification) {
    this.retryQueue.push({
      notification,
      attempts: 0,
      nextAttempt: Date.now() + RETRY_INTERVAL,
    });
  }

  async processRetryQueue() {
    const now = Date.now();
    this.retryQueue = this.retryQueue.filter(async (item) => {
      if (item.nextAttempt <= now && item.attempts < MAX_RETRIES) {
        try {
          await this.sendNotification(item.notification);
          item.attempts++;
          item.nextAttempt = now + RETRY_INTERVAL * Math.pow(2, item.attempts);
          return true;
        } catch (error) {
          console.error("Retry failed:", error);
          return item.attempts < MAX_RETRIES;
        }
      }
      return false;
    });
  }

  async markNotificationAsRead(data) {
    try {
      await Notification.findByIdAndUpdate(data.notificationId, {
        read_status: true,
      });
      console.log(`Notification ${data.notificationId} marked as read`);
    } catch (error) {
      console.error("Error marking notification as read:", error);
    }
  }

  // handleNotificationAcknowledgment(data) {
  //   if (this.pendingNotifications.has(data.notificationId)) {
  //     this.pendingNotifications.delete(data.notificationId);
  //     console.log(`Notification ${data.notificationId} acknowledged`);
  //   }
  // }

  handleDisconnect(socket) {
    for (const [address, data] of this.connectedClients.entries()) {
      if (data.socketId === socket.id) {
        this.connectedClients.delete(address);
        console.log(`Client disconnected: ${address}`);
        break;
      }
    }
  }
}

// Blockchain Listener Class
class BlockchainListener {
  constructor(notificationManager) {
    this.notificationManager = notificationManager;
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
      // await this.processNotificationsWithSocket(commonAddresses, chain,voter,proposalId);
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
        const dbAddresses = await getAllAddresses();

        const subgraphAddresses = subgraphData?.delegators || [];
        const commonAddresses = findCommonUsers(subgraphAddresses, dbAddresses);

        if (commonAddresses.length > 0) {
          console.log("Common addresses found:", commonAddresses);
          await this.processNotificationsWithSocket(
            commonAddresses,
            chain,
            voter,
            proposalId.toString(),
            support
          );
        } else {
          console.log("No common addresses found");
        }
      } catch (error) {
        console.error(`Error processing vote cast on ${chain}:`, error);
      }
    };
  }

  async getSubgraphUserData(address, chain) {
    let DELEGATE_QUERY;
    if (chain === "Arbitrum DAO") {
      DELEGATE_QUERY = gql`
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
    } else if (chain === "Optimism Collective") {
      DELEGATE_QUERY = gql`
        query GetUserData($address: String!) {
          Delegate_by_pk(id: $address) {
            delegatedFromCount
            delegators
            id
            latestBalance
          }
        }
      `;
    }

    try {
      const client = chain === "Arbitrum DAO" ? arbClient : optimismClient;
      if (!client) {
        throw new Error(`No client available for chain: ${chain}`);
      }
      let result;
      if (chain === "Arbitrum DAO") {
        result = await client
          .query(DELEGATE_QUERY, {
            address: address.toLowerCase(),
          })
          .toPromise();
      } else if (chain === "Optimism Collective") {
        result = await client
          .query(DELEGATE_QUERY, {
            address: address,
          })
          .toPromise();
      }
      if (result.error) throw result.error;
      return result.data?.delegate || null;
    } catch (error) {
      console.error(`Error fetching subgraph data for ${chain}:`, error);
      return null;
    }
  }

  async processNotificationsWithSocket(
    commonAddresses,
    chain,
    voter,
    proposalId,
    support
  ) {
    console.log(
      "commonAddresses------------",
      commonAddresses,
      chain,
      voter,
      proposalId
    );
    for (const address of commonAddresses) {
      const proposalLink = `/${chain}/proposals/${proposalId}`;
      const notification = {
        receiver_address: address,
        content: `Your Delegate (${voter}) has voted on a proposal in the ${chain}. Stay informed about the latest decisions that may affect your interests.Check out the proposal details now!`,
        createdAt: Date.now(),
        read_status: false,
        notification_name: "Vote cast",
        notification_title: "casted vote",
        notification_type: "proposalVote",
        additionalData: { chain, proposalLink },
      };
      const emailContent = {
        name: "Chora Club",
        subject: `🎉 Your Delegate Casted their Vote on a Proposal in the ${chain} 🎉`,
        template: "proposalVote",
        templateData: {
          title: "🎉 Your Delegate Has Voted! 🎉",
          content: {
            proposalId: proposalId,
            voter: voter,
            chain: chain,
            shortVoter: `${voter.slice(0, 6)}...${voter.slice(-4)}`,
            shortProposalId: `${proposalId.slice(0, 6)}...${proposalId.slice(
              -4
            )}`,
          },
          VoteContent: ` ${
            support === 1 ? "For" : support === 0 ? "Against" : "Abstain"
          }.`,
          endContent: `By trusting your delegate, you have actively contributed to shaping the community’s future.`,
        },
      };

      // console.log("notification",notification);
      await this.notificationManager.sendNotification(
        notification,
        emailContent
      );
    }
  }

  async start() {
    try {
      await this.setupProviders();
      this.setupContracts();

      const arbHandler = this.createVoteCastHandler("Arbitrum DAO");
      const opHandler = this.createVoteCastHandler("Optimism Collective");
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

// Utility Functions
function findCommonUsers(array1, array2) {
  const setArray2 = new Set(array2);
  return array1.filter((user) => setArray2.has(user));
}

// Express Server Setup
const app = express();
const server = http.createServer(app);

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: process.env.BASE_URL,
    methods: ["GET", "POST"],
    credentials: true,
  })
);

// Socket.io Setup
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// MongoDB Connection
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("Failed to connect to MongoDB", err));

// Initialize Notification Manager and Blockchain Listener
const notificationManager = new NotificationManager(io);
const blockchainListener = new BlockchainListener(notificationManager);

// Start Blockchain Listener
blockchainListener.start();

// Graceful Shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down gracefully...");
  blockchainListener.stop();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

// Default route
app.use((req, res) => res.send("Socket server running"));

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
