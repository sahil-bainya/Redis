import { Worker } from "bullmq";
import { connection } from "./queue.js";

// it takes three things -
// 1. name of the queue
// 2. Bussiness function
// 3. connection

const worker = new Worker(
    "emails",
    async (job) => {
        console.log("Processing email job...",job.id,job.name,job.data);
        (await new Promise((resolve) => setTimeout(resolve, 1500)),
         console.log("Email job completed! ", job.id, job.name, job.data));
        },
    {connection}
);

worker.on('completed',(job)=>{
    console.log("Job completed!",job.id,job.name,job.data)
})

worker.on('failed',(job, err)=>{
    console.log("Job failed!",job.id,job.name,job.data,err)
})