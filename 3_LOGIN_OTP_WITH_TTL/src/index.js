import express from "express";
import Redis from "ioredis";

const app = express();
app.use(express.json());

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

function otpKey(phone) {
  return `otp:${phone}`;
}

app.post("/otp", async (req, res) => {
  const { phone } = req.body;
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  await redis.set(otpKey(phone), otp, "EX", 30); // valid only for 30 sec.
  // key,value ,expiry ,time
  res.json({ message: "otp send", otp });
});

app.post("/verify", async (req, res) => {
  const { phone, otp } = req.body;
  const savedOtp = await redis.get(otpKey(phone));
  if (!savedOtp) {
    res.status(400).json({ message: "OTP expired or not found" });
  }
  if (otp !== savedOtp) {
    res.status(400).json({ message: "Invalid OTP" });
  }
  await redis.del(otpKey(phone));
  res.json({ message: "OTP verified successfully" });
});

app.get("/otp/:phone/ttl", async (req, res) => {
  const ttl = await redis.ttl(otpKey(req.params.phone));
  // if timer expired then ttl shows -2
  res.json({ ttl });
});



app.listen(3000, () => {
  console.log("app is running on port 3000");
});
