import express, { json } from "express";
import Redis from "ioredis";

const app = express();
app.use(express.json());
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

app.post("/user/:id/json", async (req, res) => {
  await redis.set(`user:${req.params.id}:json`, JSON.stringify(req.body));
  res.json({ savedAs: "json" });
}); // using set method redis stores the value as a string

app.get("/user/:id/json", async (req, res) => {
  const raw = await redis.get(`user:${req.params.id}:json`);
  res.json({ user: raw ? JSON.parse(raw) : null });
});

//------------------------------------------------------------------------------------------------------

app.post("/user/:id/hash", async (req, res) => {
  await redis.hset(`user:${req.params.id}:hash`, req.body);
  res.json({ savedAs: "hash" });
}); // using hset method redis stores the value as an object

app.get("/user/:id/hash", async (req, res) => {
  const data = await redis.hgetall(`user:${req.params.id}:hash`);
  res.json({ data });
});

//------------------------------------------------------------------------------------------------------------
// Notes - 
// WE can not update strings in redis , we have to replace it completely that is why hset is used . It stores the object directly.
// methods - 
// set -> store single variable 
// hset -> store Object
// hgetall -> getting entire Object
// hget -> getting a single value from Object
// hdel -> delete a single value from Object
// hexists -> check for existance
//------------------------------------------------------------------------------------------------------------

app.listen(3000, () => {
  console.log("app is running");
});
