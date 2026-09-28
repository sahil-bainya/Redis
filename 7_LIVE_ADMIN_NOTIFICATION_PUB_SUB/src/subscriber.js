import Redis from "ioredis";

const subscriber = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

subscriber.subscribe("notification", (err) => { // channel
  if (err) {
    console.log("failed to subscribe: ", err.message);
    return;
  }
  console.log("Subscribed successfully!");
});

subscriber.on("message", (channel, message) => {
  console.log("Received on ", channel, ":", JSON.parse(message));
});
