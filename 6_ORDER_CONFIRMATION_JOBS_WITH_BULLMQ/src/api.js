import express from "express";
import { emailQueue } from "./queue.js";

const app = express();
app.use(express.json());

// add function takes name , data , configurations
app.post("/welcome-email", async (req, res) => {
  const job = emailQueue.add(
    "send-welcome-email",
    {
      to: req.body.to,
      name: req.body.name || "Learner",
    },
    {
      attempts: 3, // how many times it will attempt when worker get failed to process the job
      backoff: {
        // backoff controls how long BullMQ waits before retrying a failed job.
        type: "exponential", // means the delay increases exponentially after each failure.
        delay: 1000,
      },
    },
  );
});

app.listen(3000, () => {
  console.log("app is running on port 3000");
});
