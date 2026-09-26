import express from "express";
import mongoose, { mongo } from "mongoose";
import Redis from "ioredis";

const app = express();
const PORT = 3000;

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

app.get("/redis", async (req, res) => {
  const reply = await redis.ping();
  res.json({ redis: reply });
});

app.get("/mongo", async (req, res) => {
  const url =
    process.env.MONGO_URL || "mongodb://localhost:27017/chai_aur_redis";
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(url);
  }
  res.json({ mongo: "connected", database: mongoose.connection.name });
});
app.listen(PORT, () => {
  console.log("App is running");
});
