// configuration file for queue
import { Queue } from "bullmq";

const connection = {
  host: "localhost",
  port: 6379,
};

const emailQueue = new Queue("emails", { connection });
                            // name , connection
export { emailQueue, connection };
